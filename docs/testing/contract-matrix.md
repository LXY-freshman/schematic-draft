# Test Contract Matrix

This matrix assigns a primary test boundary to current product behavior. It is
an index for change impact, not a claim that the listed suites are exhaustive.

| Contract                                                         | Primary owner and checks                                                                                           | Higher-level confirmation                                       |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| Persisted Project schema, migration, and compatibility rejection | `packages/model/src/schema.test.ts` and `packages/project-protocol/src/{persistence,compatibility-corpus}.test.ts` | project-file and recovery editor tests                          |
| Persisted coordinate domain and grid normalization               | `packages/model/src/coordinate-domain.test.ts`                                                                     | Editor snap and drafting manipulation tests                     |
| Typed edit atomicity, history, and routing constraints           | `packages/edit-engine/src/{transaction,history,routing,wire-editing}.test.ts`                                      | Editor wiring and movement workflows                            |
| Electrical topology identity                                     | `packages/derived/src/electrical-topology-projection.test.ts` over the `topology-hash` implementation               | netlist export and roundtrip tests                              |
| Connectivity, diagnostics, and hierarchy interpretation          | `packages/derived/src/{connectivity-index,logical-net,current-contract,diagnostics/*.test.ts}`                     | Editor net highlighting and diagnostics surfacing               |
| Formal SVG and export artifacts                                  | `packages/render-svg/src/*.test.ts`, `packages/exporters/src/exporters.test.ts`                                    | visual and export golden checks                                 |
| Design-netlist extraction and printing                           | `packages/netlist/src/{current-contract,printers}.test.ts`                                                         | editor netlist authoring workflow                               |
| Structural SPICE and Spectre import and conversion               | `packages/spice/src/*.test.ts`                                                                                     | netlist import editor workflow                                  |
| Retained simulation-folder migration and round-trip             | `packages/project-protocol/src/{simulation-setup,raw-simulation-setup}-migration.test.ts` and `packages/netlist/src/simulation-source-graph.test.ts` | compatibility corpus byte stability                             |
| File open, in-place Save, and Save As                            | `apps/editor/src/features/editor-shell/file-command-menu.test.tsx` over `project-files.ts`                          | `apps/editor/e2e/project-file.spec.ts`                          |
| Local recovery and persistence hardening                         | editor document unit contracts                                                                                     | recovery dialog and hardening Playwright specs                  |
| User-visible editing workflows                                   | focused editor unit contracts                                                                                      | `apps/editor/e2e/` scenarios                                    |
| Component definition to runtime projection                       | `scripts/lib/{component-library,razavi-reference-authority}.test.mjs`                                               | `pnpm components:check` and `pnpm symbols:razavi:check`          |

When a change touches more than one row, add or update a cross-module test only
for the shared fact. Do not duplicate all lower-level cases in Playwright.

## Simulation vocabulary

This edition runs no simulator. "Simulation" in tests and documentation means
only one of two retained things: a netlist this editor exports for an external
simulator, or the simulation-folder data a Project carries so that files written
by the upstream hosted editor round-trip without loss. Nothing in the repository
executes a deck.

Package builders are unit or module-contract fixtures; a Project fixture loaded
in the browser is a workflow fixture. Reusing one authoritative,
human-importable Project across layers is allowed, but each layer asserts only
the contract it owns.
