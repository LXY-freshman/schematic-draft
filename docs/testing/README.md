# Test System

Tests protect current behavior, explicit rejection boundaries, and safety
invariants. They are not a line-coverage contest and must not silently turn an
implementation detail into a public contract.

The [contract matrix](contract-matrix.md) identifies the primary owner for each
cross-cutting behavior. Co-locate a low-cost unit or module-contract test with
its implementation; keep browser workflows under `apps/editor/e2e/`; keep
release, generated-artifact, and visual checks in their existing scripts.

## Layers

| Layer                 | Purpose                                                          | Typical location                            |
| --------------------- | ---------------------------------------------------------------- | ------------------------------------------- |
| Static and generated  | types, formatting, documentation links, generated-output drift    | root scripts and `pnpm check`               |
| Unit                  | pure algorithms, value boundaries, deterministic transformations | adjacent `*.test.ts`                        |
| Module contract       | one package's public input/output, including rejection cases     | package test beside the public boundary     |
| Cross-module contract | one fact interpreted consistently across package boundaries      | owning boundary package, named for the fact |
| Browser workflow      | a user-visible flow that cannot be proved below the browser      | `apps/editor/e2e/`                          |
| Release and golden    | built product, artifacts, visual reference, packaging            | root scripts and `pnpm verify:goldens`      |

Use the cheapest layer that can prove the behavior. Keep one primary contract
test per behavior; add a higher-layer test only when it proves wiring or a real
user path that the lower layer cannot prove.

## Choosing what to run

There is no CI and no gate catalog: validation is a judgement call, made per
change and stated in the commit message. The cost ladder is:

```bash
pnpm test:local <paths>                        # the tests next to what you touched
pnpm test:local <path> -t "<name>"             # one test
pnpm test:e2e:local <specs> --grep <pattern>   # one browser workflow
pnpm check                                     # format, docs, component drift, typecheck
pnpm verify                                    # check + unit suite + build + production smoke
pnpm verify:goldens                            # visual and export goldens, performance
pnpm test && pnpm test:e2e                     # everything
```

Run the smallest rung that covers the change and its direct dependents. A
documentation-only edit needs `pnpm docs:check`. Editing a `@icm/*` package that
several others read — `model`, `derived`, `edit-engine` — earns the full unit
suite, because the interesting failures are in the consumers. Touching symbol
geometry, rendering, or exporters earns `pnpm verify:goldens`. Touching the
desktop shell earns a Windows launch, since nothing below the browser can prove
that the packaged app boots. One of those launches is scripted:
`scripts/close-guard-window-check.mjs` drives the real main process through
Playwright's Electron driver to cover the unsaved-work close guard. It stubs
only the native modal, and it proves nothing about the rest of the shell — that
still takes a launch. Run `pnpm setup:e2e` once per machine or Playwright
version before the first browser run.

The editor's browser workflows have separate owners: `manual-editor.spec.ts`
retains general integration, `wiring-semantics.spec.ts` owns wire interaction,
`component-property-workflows.spec.ts` owns live property/model/display edits,
`netlist-workflows.spec.ts` owns import and export, and `project-file.spec.ts`
owns open/save through the file bridge. The full component catalog is checked by
`component-property-catalog.test.ts`; browser catalog checks cover representative
capabilities and the VDD exception rather than repeating the same UI for every
symbol. Keep the specialized history, rejection, hierarchy and terminal specs.

## Local iteration

Changes accumulate as ordinary local commits. Use the development server and the
smallest checks that prove each target's behavior, then commit. Nothing in this
repository publishes, deploys, or promotes anything; the only outward-facing step
is copying a built `.exe` to the Windows working directory, and that is manual.

Every commit message states what was validated, so a later reader can tell a
change that ran the full suite from one that ran three files. That statement
replaces the upstream `Test-Impact:` trailer and its checker, both of which were
CI machinery this fork does not have.

## Removing or simplifying a test

A test is not dead merely because it mentions a retired shape. Keep rejection,
migration, authorization, and input-hardening tests while their boundary is
reachable. Remove or merge a test only when all are true:

1. Its protected production surface is unreachable or is covered by a named
   primary contract at the same or stronger boundary.
2. Deletion does not remove the only rejection, compatibility, history, or
   safety assertion for the behavior.
3. The target plan records the replacement protection or why none is needed.

Split an oversized suite by protected behavior, not by arbitrary line count.
Prefer small shared fixture builders over copying an entire Project when only a
few facts are relevant.

## Coverage

Coverage is diagnostic evidence, not a merge threshold. Use it to find an
unexercised critical boundary, then add a behavior-level test. Do not retain
large, brittle tests solely to preserve a percentage.
