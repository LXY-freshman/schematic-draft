# Working Rules

Treat the repository as an engineering project: bounded targets, explicit
ownership, risk-proportional validation, and decisions recorded where the work
is. What a change did and why belongs in its commit message, which travels with
the diff through `git log` and `git blame`.

This is a local fork with no CI, no pull-request gate, and no deployment. Every
check runs on this machine, so the only thing that protects a change is the
validation you actually run before committing.

Notes you keep while working — scratch plans, checklists, drafts — belong in the
untracked `plan/` directory.

## The Loop

```text
bounded target -> implementation -> validation -> commit that explains itself
```

A request to change the editor is a request to complete one bounded target and
commit it. It is not a request to bump the version, tag a release, or package
an installer; do those when asked.

## Before Editing

1. Run `git status --short --branch` from the repository root.
2. Audit dirty state by ownership:
   - Proceed normally when the worktree is clean.
   - When it is dirty, identify whether each changed path belongs to the current
     target, the user, or an earlier target.
   - Unrelated dirty paths do not automatically block work.
   - Stop before editing when dirty paths overlap the target's owned files,
     ownership is unclear, or a dirty shared contract affects the target.
   - Say so in the commit message when proceeding with unrelated dirty files
     present.
3. Identify the target's goal, expected files, shared dependencies, and
   validation surface.
4. Read `CLAUDE.md` and any closer domain instructions — `docs/README.md`,
   `apps/editor/src/README.md`, `packages/components/README.md`,
   `apps/desktop/README.md`.
5. Do not edit outside the target's boundary without deciding, deliberately,
   that the boundary has moved.

## During Work

- Keep each target small and reviewable; exclude unrelated cleanup.
- Define a target by one ownership and validation boundary, not by every visible
  symptom. Closely related micro-fixes that share files, contracts, and
  validation belong in one target; independent changes do not.
- Protect shared contracts, generated artifacts, binary assets, and user-owned
  work unless the target explicitly claims them. Never hand-edit a generated
  file: change its generator or its evidence and regenerate.
- Decide deliberately before expanding scope or taking on a new dependency, and
  say so in the commit.
- Prefer the smallest deterministic validation that covers changed behavior,
  direct dependencies, and credible failure risks. Do not run a full suite by
  default; expand when the change crosses shared contracts or subsystems.
- Add tests when behavior changes, a regression needs protection, or a contract
  is best demonstrated automatically. Do not add tests that merely restate an
  implementation.
- Keep one primary test layer per behavior. A test mentioning retired input is
  not automatically dead: retain reachable rejection, migration, history, and
  safety boundaries until their replacement is explicit.
- Report unresolved questions in the commit message; do not leave them only in
  an untracked working note.

## Validation Ladder

Climb only as far as the change's risk requires. See
[the test system](docs/testing/README.md) and its
[contract matrix](docs/testing/contract-matrix.md) for who owns what.

```bash
pnpm test:local <paths>                        # the tests next to what you touched
pnpm test:local <path> -t "<name>"             # one test
pnpm test:e2e:local <specs> --grep <pattern>   # one browser workflow
pnpm check                                     # format, docs, component drift, typecheck
pnpm verify                                    # check + unit suite + build + production smoke
pnpm verify:goldens                            # visual and export goldens, icons, performance
pnpm test && pnpm test:e2e                     # everything
```

- Documentation-only change: `pnpm docs:check`, plus `pnpm test:local` for the
  spec text pinned by `protocol-documentation.test.ts` when you edited one of
  those documents.
- Component definitions or symbol generators: the affected generator, then
  `pnpm components:check`, `pnpm symbols:razavi:check`, and `pnpm visual:golden`.
- Renderer or exporter geometry: `pnpm verify:goldens`.
- Electron shell, packaging, or the file bridge: rebuild with
  `pnpm desktop:build`, then launch and exercise open, in-place Save, Save As,
  and one export. A shell change cannot be validated by unit tests alone.
- Before finishing a batch that crossed several workspace packages: `pnpm verify`.

Do not weaken, skip, or delete a failing check to get past it. When a test or
golden is genuinely obsolete, demonstrate that the accepted behavior is
preserved and update the contract deliberately.

## Circuit Asset Rules

- For accepted Symbol geometry or pin-position changes, historical drawing
  layouts and routes may be left for manual repair. Do not audit or repair every
  old design as a prerequisite to completing the current change, or add a
  general migration layer just to preserve old layouts. A small one-off repair
  script is appropriate when concrete affected cases can be fixed by a few
  clear, deterministic rules with little effort. Record known impacts with the
  change.
- Keep each circuit fixture in its own `netlists/<circuit-name>/` directory.
- Preserve explicit `.subckt` interfaces and instance pin order. Interface
  changes are shared-contract changes and require checking every caller.
- Keep local model files beside the netlist that includes them unless a target
  intentionally introduces a shared model library.
- Do not claim electrical correctness from syntax inspection alone. This edition
  runs no simulator, so a netlist change that alters electrical behavior is
  unverified here — say that plainly instead of implying it was checked.
- Never silently replace foundry or vendor model data with illustrative values.
  Label topology-only fixtures and simplified models clearly.

## After Work

Before considering a target complete:

1. Run the validation the target's risk calls for.
2. Run `git diff --check` and `git status --short --branch`.
3. Review the diff, stage only intended files, and commit.
4. Write the commit message so it stands alone: what changed, why, and the
   validation that backs it. State anything a reader would otherwise have to
   reconstruct — a defect's root cause, a contract that moved, or work
   deliberately left out.

Commit subjects use conventional scopes: `feat(editor):`, `fix(netlist):`,
`docs(specs):`, `test(editor):`, `refactor(repo):`, `chore(desktop):`.

## Boundary and Hygiene Rules

- Do not mix unrelated targets in one commit.
- Do not use model confidence as the only quality gate when deterministic
  validation is available.
- Do not delete review notes or open questions to make the repository appear
  clean. Unresolved work is reported, not tidied away.
- Nothing in this repository may add a network call on a product path. An
  offline guarantee that depends on a user not clicking something is not a
  guarantee.
