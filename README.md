# Schematic Draft

Schematic Draft is an offline, connectivity-aware schematic editor for analog
circuits, packaged as a Windows desktop application. Draw hierarchical circuits
whose connectivity is an explicit fact rather than a guess about geometry, from
a component library calibrated against a published reference, and take the
result out as a deterministic SPICE or Spectre netlist, a publication-ready
SVG/PDF/PNG, or a `.vsdx` you can go on editing in Visio.

It is a fork of [Analog Canvas](https://github.com/cascode-ai/analog-canvas)
(AGPL-3.0-only) with the hosted half removed: no accounts, no cloud projects, no
hosted Gallery, no Agent API, no analytics, no simulation service. The desktop
shell refuses every outbound request, so "offline" is enforced rather than
promised.

[Download](#download) · [Documentation](docs/README.md) · [中文说明](apps/desktop/README.md) · [Upstream project](https://github.com/cascode-ai/analog-canvas)

## Download

Windows 10 or 11, x64, from the
[latest release](https://github.com/LXY-freshman/schematic-draft/releases/latest).
Both files are the same program; pick whichever suits you:

- **`schematic-draft-<version>-win-x64.zip`** — extract it and the
  `Schematic Draft\` folder inside is a complete installation. Run
  `schematic-draft.exe` in it. Nothing else to do, nothing to uninstall: the
  folder holds the Projects and the preferences it writes, so moving it to
  another drive or another machine moves your work with it.
- **`schematic-draft-<version>-win-x64-setup.exe`** — installs for the current
  user, so no administrator is needed. It asks which folder to install into, adds
  Start-menu and desktop shortcuts, and appears in Apps & features.
  **Uninstalling keeps the Projects you saved** and tells you where they are.

Either way the program writes nothing outside its own folder except the per-user
registry entries that let Explorer open a `.schdraft` file by double-click, which
the **Open `.schdraft` files with this copy** checkbox in **Help → About**
turns off. Both copies can coexist;
they do not share data. The build is not code-signed, so Windows SmartScreen may
warn about an unknown publisher — **More info → Run anyway**.

Chinese usage notes: [apps/desktop/README.md](apps/desktop/README.md).
To build it yourself, see [Build it](#build-it).

## Highlights

- **Connectivity is an electrical fact, not a drawing accident.** Net
  membership, Junctions, Cell terminals and typed Instance terminals are
  recorded; geometry never silently creates a connection, and a Crossing is
  never quietly promoted to a Junction. An ambiguous intersection is rejected
  rather than guessed at. Every edit goes through one typed transaction, so
  multi-object changes undo as one.
- **Reusable hierarchy.** Author each schematic as a Cell, give it independent
  Cell Pins, place it as a block inside another, and navigate between callers
  and child Cells. The Cell interface is derived from the drawing, so a block's
  pins cannot drift from what is inside it.
- **A component library calibrated against a reference.** Built-in symbol
  artwork is generated from a manifest of measurements taken from a published
  analog-design text, which is the sole visual authority for it; parts with no
  such evidence live in a separate Extended Devices library and say so. Each
  component carries its symbol, its electrical rules and its catalog metadata
  in one file. Transistors holds the MOS and BJT pairs with the depletion-mode
  and DMOS variants, two GaN HEMTs and an IGBT beside them; Power and Ports
  keeps Ground, a dedicated analog and digital ground, and supply rails. Five
  worked circuits ship in the toolbar's Gallery panel — starter Projects inside
  the application, nothing fetched.
- **Deterministic netlists.** Export structural SPICE or Spectre — to the
  clipboard or straight to a file — and get the same text for the same circuit
  every time. Structural `.cir`, `.sp`, `.spi` and `.scs` import back in, and a
  block can be bound to a `.subckt` you brought with you. A part no standard
  SPICE card describes — a GaN HEMT, an IGBT — is reported as non-netlistable
  rather than dressed up as a MOSFET and handed silicon model parameters; bind
  it to a vendor `.subckt` and it prints as an ordinary subcircuit call.
- **The drawing is yours to set for the page it goes on.** Six document-wide
  factors — font size, wire, symbol and drawing thickness, junction dot size,
  and line jump size — scale between half and twice the size the drawing was
  tuned at, and the set is one copyable Style code that carries to the next
  document. Over that, any one wire or component takes its own colour and its
  own stroke weight, from a quarter to four times. A MOSFET can be drawn three-
  or four-terminal without the device changing underneath it, a wire can be told
  to hop over the wires it crosses, and the background grid can mark every
  seventh dot so a distance is read rather than counted.
- **Publication-ready drawings.** SVG and PDF stay vector; PNG renders at 3×.
  LaTeX formulas in rich-text annotations are typeset locally, with no web font
  and no service.
- **A Visio file you can keep editing.** `.vsdx` export writes real Visio
  shapes: devices carrying their reference, parameters and pins, and wires as
  chains of segments glued to those pins and to a draggable node at every
  corner. Each hop over a crossing is a link in that chain rather than geometry
  baked into the wire, so it can be selected, moved or deleted on its own. A
  `.vssx` stencil of the symbol library alone is there too. Whatever the
  package could not carry is counted in the status line as the file is written,
  not left for you to find later.
- **Real files, plus a net underneath.** **Open** and **Save As…** use the
  operating system's dialogs; **Save** and Ctrl+S overwrite the file you opened,
  in place, without asking. Alongside that, a bounded crash-safety copy lives in
  local storage — a net, never the authority.
- **Offline by construction.** The Electron main process blocks every network
  request, serves the editor from a privileged local scheme, and hands an
  external link to your system browser instead of loading it in-app. There is
  no account to make and no telemetry to turn off.

## How your work is stored

The file you opened is the Project — `.schdraft` for a Project this application
saved, or the portable `.icproj.json` interchange form. **Save** writes that
file; the
File menu names the exact path so overwriting is never a guess. **Save As…** is
the only command that prompts. A new Project has no file yet, so its first
**Save** asks once, then remembers.

Alongside that, the application keeps a crash-safety copy in its own IndexedDB,
reachable through **File / Recover Local Work…**. It is a safety net, not a
backup and not authoritative — the file on disk is.

**Check and Save** runs ERC and visual checks on demand and shows findings in
Issues and on the canvas before saving. Findings never block a save; editing
invalidates the last check without rerunning it.

## Start here

- **Learn the editor:** [Getting started](docs/user/getting-started.md),
  [schematic hierarchy](docs/user/schematic-hierarchy.md),
  [compatibility](docs/user/project-compatibility.md), and
  [troubleshooting](docs/user/troubleshooting.md).
- **Understand the product:** [current architecture](docs/overall-product-plan.md)
  and [documentation map](docs/README.md).
- **Develop:** [working rules](AGENTS.md),
  [reading set](docs/README.md#contributor-reading-order), and
  [test system](docs/testing/README.md).

## Build it

Requires Node.js 24 or newer, pnpm 11.16.0 or newer, and — for the packaged
`.exe` — a Windows machine or a Windows build step.

```bash
pnpm install --frozen-lockfile
pnpm build          # once after install, and after pulling package changes
pnpm dev            # editor in a browser at http://localhost:5173
pnpm desktop:start  # editor in the Electron window
pnpm desktop:dist   # the release zip and installer under output/desktop/
```

`pnpm build` is not optional before the first `pnpm dev`: the development
server's Vite configuration loads some workspace packages from their built
`dist/` output.

`pnpm desktop:dist` produces the two downloads a release offers: the ready-to-run
program folder as a zip, and a per-user installer that lays the same folder down
with shortcuts. Either way there is no service, and nothing is written outside
the program's own folder and the files you save; uninstalling keeps the Projects
saved inside that folder. The zip needs `zip` on the PATH. Building the installer
on Linux needs Wine, which is the only thing that can run the NSIS stub that
writes `Uninstall.exe`. See
[`apps/desktop/README.md`](apps/desktop/README.md) for the shell's window, file
bridge, and network-lockdown contract.

Development is plain local Git work: make a change, run the checks that cover it
(`pnpm test:local <paths>`, then `pnpm check` or `pnpm verify` as the change
warrants), and commit. There is no CI, no PR gate, and no deployment — see
[working rules](AGENTS.md) and the [test system](docs/testing/README.md).

## What the repository contains

- `apps/editor/`: the React/SVG editor.
- `apps/desktop/`: the Electron shell — window, file dialogs, file bridge,
  network lockdown, and Windows packaging.
- `packages/model/`, `packages/project-protocol/`, and `packages/edit-engine/`:
  current persisted circuit model, bounded file compatibility, and the atomic
  mutation boundary every edit goes through.
- `packages/derived/`: read-only connectivity, diagnostic, and geometry
  projections over the persisted model.
- [`packages/components/`](packages/components/README.md): one canonical JSON
  file per built-in component, containing its symbol, electrical rules and
  catalog metadata; runtime packages consume generated projections.
- `packages/spice/`, `packages/devices/`, `packages/symbols/`, and
  `packages/netlist/`: structural SPICE import and dialect conversion, built-in
  device facts, symbol semantics, and deterministic design-netlist export.
- `packages/exporters/` and `packages/render-svg/`: formal SVG, PNG, and PDF
  output.
- `packages/visio/`: `.vsdx` drawings and `.vssx` stencils — a sibling
  projection of the document, not of the flat SVG scene, because Visio needs
  shapes, pins and glue a picture no longer carries.
- `packages/math-typesetting/`: bounded LaTeX formula typesetting for rich-text
  annotations.
- `netlists/`: one circuit per directory, the SPICE import and export corpus.
- `fixtures/`: Project, SPICE, export, and visual-reference test inputs and
  goldens.
- `scripts/`: symbol and component generators, golden checks, the production
  smoke check, the desktop close-guard window check, the Windows sync helper,
  and the Visio open check.
- `docs/`: current architecture, user guides, normative contracts, ADRs, and
  remaining work.

The [Razavi reference manifest](fixtures/visual-reference/razavi-reference-v1/)
is the sole visual authority for component artwork.

## Netlist conversion

`convertNetlist` in `packages/spice` translates structural SPICE and Spectre
netlists in-process; SCS import uses it. No daemon, simulator or account is
involved. The structural subset adapts
[netlist-crawler](https://github.com/Arcadia-1/netlist-crawler) under its MIT
license. See the [conversion contract](docs/specs/netlist-conversion.md) for
supported syntax and the
[attribution](packages/spice/third-party/netlist-crawler/README.md).

## License

Upstream Analog Canvas: copyright © 2026 Zengchun Chen and Zhishuai Zhang.

Except where otherwise noted, this software is licensed under the
[GNU Affero General Public License v3.0 only](LICENSE.md) (`AGPL-3.0-only`),
inherited from upstream. Modified versions that are distributed or made available
for remote network interaction must provide their Corresponding Source under the
same license. Third-party dependencies, reference material, and assets retain
their respective copyright and license terms.

Upstream work this fork is derived from:

> Zengchun Chen and Zhishuai Zhang. _Analog Canvas_. 2026.
> Source code: https://github.com/cascode-ai/analog-canvas
