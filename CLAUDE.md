# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Project

Schematic Draft is an **offline, connectivity-aware schematic editor** for
analog circuits, packaged as a Windows Electron application. Hierarchical Cells,
structural SPICE/Spectre interchange, formal SVG/PDF/PNG and netlist export,
real file open/save, and local crash recovery. There is no server, no account,
and no simulator: the Electron main process blocks every outbound request, so
circuit data cannot leave the machine.

It is a fork of [Analog Canvas](https://github.com/cascode-ai/analog-canvas)
(AGPL-3.0-only) with the hosted half removed — Cloud Projects, the Gallery,
accounts and moderation, the Agent API and MCP server, analytics, and the
hosted simulation service. **The fork does not merge from upstream.** Deleting a
hosted feature is the correct answer; adding a degraded offline imitation of one
is not. [Product architecture](docs/overall-product-plan.md) owns the boundary.

- pnpm workspace: `apps/*` and `packages/*` (13 projects: `@icm/desktop`,
  `@icm/editor`, and 11 `@icm/*` libraries). The private root package
  `schematic-draft` carries the product version; [CHANGELOG.md](CHANGELOG.md)
  records user-facing changes.
- Node >= 24, pnpm >= 11.16 (`packageManager: pnpm@11.16.0`), ESM only. Pinned
  toolchain: TypeScript 7, Vite 8, Vitest 4, Playwright 1.62, Prettier 3,
  Electron 44.
- License: AGPL-3.0-only ([LICENSE.md](LICENSE.md)).

## Commands

```bash
pnpm install --frozen-lockfile    # setup
pnpm build                        # build everything (pnpm -r, topological); needed once after install
pnpm dev                          # editor dev server (Vite, http://localhost:5173) — browser, no file bridge
pnpm desktop:build                # editor bundle + Electron main process
pnpm desktop:start                # run the Electron shell
pnpm desktop:dist                 # portable Windows .exe + installer into output/desktop/

pnpm typecheck                    # single root tsc pass (also the only typecheck of test files)
pnpm format:check                 # Prettier for code/JSON/YAML (pnpm format to write); Markdown is not covered
pnpm docs:check                   # Markdown links + ADR/spec index contracts

# Focused loops — preferred during development
pnpm test:local <test-paths>                        # Vitest, 2 workers
pnpm test:local <test-path> -t "<name>"             # single test by name
pnpm test:e2e:local <spec-paths> --grep <pattern>   # Playwright, 2 workers
pnpm setup:e2e                                      # once per machine: install Playwright Chromium

# Suites and aggregate checks
pnpm test                         # all unit/module tests
pnpm test:e2e                     # all Playwright specs
pnpm check                        # format:check + docs:check + components:check + typecheck
pnpm verify                       # check + unit suite + build + production smoke
pnpm verify:goldens               # build + visual/export goldens + performance budgets
```

Unit tests sit beside their implementation under one root `vitest.config.ts`:
`*.test.ts(x)` in `apps/` and `packages/`, and `*.test.mjs` in `scripts/`.
Workspace packages have no test scripts of their own. Playwright specs live in
`apps/editor/e2e/`; the config auto-starts a Vite server on `127.0.0.1:4173`
(`ICM_E2E_PORT`), reuses a running one unless `CI` or `ICM_E2E_ISOLATED=1` is
set, and drives system Chrome locally
(`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` overrides).

There is no CI. Validation is whatever you run locally before committing; see
[AGENTS.md](AGENTS.md) for the ladder.

### Generated artifacts

Component data flows one way.
`packages/components/definitions/<symbol-id>.json` (symbol + electrical +
catalog, indexed by `packages/components/catalog.json`) is the authoring source;
see [packages/components/README.md](packages/components/README.md).
Reference-derived geometry inside those files is written by family generators
from `fixtures/visual-reference/razavi-reference-v1/` — change the generator or
its evidence, not the JSON.

Never hand-edit these; each generator has a paired `:check` drift gate:

- `packages/devices/src/components.generated.ts` and
  `packages/symbols/src/{expanded-components,razavi-catalog}.generated.ts`
  (`components:generate`, also part of `symbols:razavi`),
  `packages/derived/src/razavi-peripheral-geometry.generated.ts`
  (`symbols:razavi-peripherals`).
- `fixtures/visual-golden/*` (`visual:golden`), `fixtures/exports/*`
  (`export:golden`), and `fixtures/editor-production-smoke/report.json`
  (`test:production-smoke`).

Regeneration order when symbol data changes:

1. Base family generators: `symbols:razavi-{mos,peripherals,inductor,opamp,common,logic,buffer-dff,delay-cell,zener}`, `symbols:converters`.
2. Derived siblings: `symbols:lettered-amps`, then `symbols:swap-inputs`.
3. `pnpm symbols:razavi` — the signal-flow and magnetic families, then the
   component-library projections and the Razavi catalog. After editing
   definitions by hand, `pnpm components:generate` is enough.
4. `pnpm build`, then as affected: `visual:golden`, `export:golden`.

`pnpm check` enforces `components:check`; `symbols:razavi:check` covers the
Razavi chain; `pnpm verify:goldens` runs the golden, icon, and performance
checks.

## Required workflow (AGENTS.md)

[AGENTS.md](AGENTS.md) defines the working discipline; read it before working.
Summary:

- **One bounded target at a time**, each ending in its own local commit with the
  validation that backs it. Track an in-progress batch in the untracked
  `plan/local-batch.md`. Never push, tag, or bump the version unless asked.
- **Before editing tracked files**: run `git status --short --branch` and audit
  dirty paths by ownership (unrelated dirty files don't block; overlapping or
  unclear ones do). Know the target's goal, owned paths, and shared contracts;
  `plan/` is the untracked scratch area.
- **Validation is risk-proportional**: run the smallest deterministic checks
  that cover the change (documentation-only → `pnpm docs:check`); full suites
  only when breadth or risk justifies them. An Electron shell, packaging, or
  file-bridge change must be exercised in a real window — unit tests do not
  cover it.
- Every target closes with `git diff --check`, `git status --short --branch`,
  and a commit message that stands alone: what changed, why, and the validation.
- **Circuit assets**: one circuit per `netlists/<name>/` directory; `.subckt`
  interfaces and instance pin order are shared contracts (check every caller
  before changing); never claim electrical correctness from syntax inspection
  alone — this edition runs no simulator; never silently replace vendor/foundry
  model data with illustrative values.
- Commit subjects use conventional scopes: `feat(editor):`, `fix(netlist):`,
  `docs(specs):`, `test(editor):`, `chore(desktop):`.

## Architecture

### Repository layout

- `apps/` — `editor` and `desktop` (below).
- `packages/` — the `@icm/*` libraries below, plus the `components/` data
  directory.
- `netlists/<circuit>/` — one SPICE interchange example per directory.
- `fixtures/` — cross-package test data: the Razavi visual reference, visual and
  export goldens, legacy and redline Projects, SPICE baselines and vendor decks,
  production-smoke report.
- `scripts/` — symbol/component generators, golden and smoke checks, the
  performance baseline, the Markdown link checker, and `sync-to-windows.sh`,
  with `*.test.mjs` beside them.
- `docs/` — product plan, ADRs, specs, user guides, roadmap, testing.

### Package layering

Dependencies flow strictly downward and pnpm's topological order is the only
build order. `@icm/math-typesetting` is a leaf; `@icm/model` (which depends only
on math-typesetting) is the root every domain package shares. Roughly bottom-up:

- `@icm/math-typesetting` — MathJax TeX → SVG formula typesetting with a fixed
  profile and bounded cache; used by model, derived, render-svg, and the editor.
- `@icm/model` — Zod schemas and branded IDs for the persisted Project
  (documents, instances, nets, routes, annotations, rich text, geometry,
  retained simulation source folders). The single source of type truth.
- `@icm/devices` — built-in device descriptor registry (projected from component
  definitions): device facts, reference-designator rules, parameter validation.
- `@icm/symbols` — symbol semantics and artwork (projected from component
  definitions): built-in symbols, generated Razavi catalog, pin anchors.
- `packages/components/` — not a workspace package: the canonical component
  definitions and catalog behind `devices` and `symbols`.
- `@icm/derived` — pure read-only projections over the model: connectivity
  index, Base/Logical Nets, ERC/diagnostics, anchors, label placement, resolved
  route geometry, electrical topology hash, search.
- `@icm/spice` — structural SPICE import (lexer, dialects, expression eval →
  transient Circuit IR) and the pure SPICE → Spectre converter
  (`convertNetlist`); Node-only `./node` entry.
- `@icm/netlist` — deterministic design-netlist extraction and printing
  (transient DesignNetlistIR) and formal cell-interface derivation. Its
  simulation-source modules exist only to serve schema migration.
- `@icm/project-protocol` — bounded `.icproj.json` parse/migrate/serialize
  compatibility boundary with load diagnostics.
- `@icm/edit-engine` — **the sole mutation boundary**: typed schematic edits,
  dry-run/commit transactions, revision checks, undo history, and planners
  (routing, power/named nets, references, hierarchy).
- `@icm/render-svg` — persisted document → formal SVG scene, including rich-text
  and formula layout.
- `@icm/exporters` — SVG/PNG/PDF artifacts; browser entries (`./browser`,
  `./browser-raster`, `./browser-pdf`) plus Node-only `./node` (resvg, pdf-lib).
- `apps/editor` — the React/SVG editor the shell loads. It is a plain bundle:
  no service worker, no web app manifest, nothing that assumes a server.
- `apps/desktop` — the Electron shell: privileged `app://schematic-draft`
  scheme, `webRequest` network lockdown, external links handed to the system
  browser, native file dialogs, and the `/api/file/{open,read,save}` bridge.
  `electron-builder` produces the portable `.exe`. See
  [apps/desktop/README.md](apps/desktop/README.md).

### Build mechanics

- Packages build with plain `tsc`; only `apps/editor` uses Vite, and
  `apps/desktop` bundles its main process with esbuild. Build order comes solely
  from pnpm topological ordering (no `tsc -b` project references).
- The `development` package-export condition maps `@icm/*` to `src/*.ts`, so the
  browser code served by Vite dev and Vitest runs from source with no build.
  Node consumers (`scripts/*.mjs`, the packaged release) resolve `dist/` — that
  is why those npm scripts are prefixed with a build. The Vite config loader and
  the Node-side Playwright specs also resolve `dist/`, so a fresh checkout needs
  `pnpm build` before `pnpm dev` or browser tests.
- `pnpm typecheck` (`tsconfig.check.json`) maps `@icm/*` straight to source and
  covers `apps/` and `packages/`, including the `*.test.ts` files that package
  builds exclude.

### Editor internals

[apps/editor/src/README.md](apps/editor/src/README.md) is the normative layering
doc. Dependency direction:
`main → app → features/components/document/interaction/canvas → packages/*`.
Each directory under `features/` (clipboard, component-insert, drafting,
editor-shell, hierarchy, instance-display, netlist-export, project-code,
properties, search, selection, text-editing, wiring) owns its pure proposals,
view adapters, and tests; other source roots include `commands/`, `demos/` (test
fixtures), `examples/` (bundled starter Projects), `presentation/`, `snap/`, and
`styles/`. Rules: feature and infrastructure modules never import
`app/App.tsx`; pure proposal/reducer/geometry modules never import React
components; avoid cross-feature imports — the tree already contains many, so do
not treat them as precedent; promote a genuinely shared primitive to `canvas/`,
`document/`, `interaction/`, `snap/`, or a workspace package instead; no barrel
files added just to shorten imports; stylesheets load from the route-level
entries in `styles/`, never from a lazy component.

File open and save live in `features/editor-shell/`: `project-files.ts` speaks
to the main-process bridge, `editor-file-commands.ts` owns the command
semantics, and `file-command-menu.tsx` is the surface. **Save** overwrites the
bound path with no dialog; only **Save As…** prompts.

### Core invariants

- **Nothing leaves the machine.** A feature that would need a server does not
  get a degraded offline version; it gets removed, and the removal is recorded.
- Connectivity is explicit: net membership, Junctions, formal cell terminals,
  and typed Instance terminals are electrical facts. Drawing geometry never
  silently creates a connection; a Crossing is not a Junction — ambiguous
  intersections are rejected, not guessed.
- Routes are visible geometry only; they may stretch during movement without
  changing logical connectivity.
- Every mutation goes through one typed Edit Engine transaction with an expected
  revision. There is no second command language and no DOM-automation mutation
  path.
- The `.icproj.json` file the user opened is the authoritative Project. Local
  recovery is a bounded, non-authoritative crash copy.
- The Razavi reference manifest
  (`fixtures/visual-reference/razavi-reference-v1/`) is the sole visual
  authority.

## Documentation authority

Specifications own accepted contracts; topic ADRs explain reasons and link to
specs. When code and a spec disagree, inspect behavior and tests, preserve
deliberate coherent behavior, and surface unresolved choices. Follow
`docs/README.md`; do not treat an old ADR as a competing rule or silently
endorse an implementation accident. Prose inherited from upstream may still
describe a feature this fork deleted — verify against the code before trusting
it, and fix the prose when you find it.

- Default reading set for product work:
  [docs/README.md](docs/README.md#contributor-reading-order).
- Test layers and contract ownership:
  [docs/testing/README.md](docs/testing/README.md) and its contract matrix.
- `pnpm docs:check` validates links in `README.md` and `docs/`, and requires
  every ADR and spec to be indexed with a `Status:` line (specs also need an
  owner line). `format:check` skips Markdown, though most docs are
  Prettier-formatted.
- Some docs are test-pinned:
  `packages/{model,edit-engine}/src/protocol-documentation.test.ts` read spec and
  plan text (for example the current Project schema version), so editing those
  documents can fail a unit test.
