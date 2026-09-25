# Current Product Architecture

Schematic Draft is an offline schematic editor for analog circuits: hierarchical
Cells, structural SPICE/Spectre interchange, formal SVG/PDF/PNG and netlist
export, packaged as a Windows desktop application. It is a fork of
[Analog Canvas](https://github.com/cascode-ai/analog-canvas) with the hosted half
removed. Circuit data lives in files you name, on your machine, and the
application has no code path that sends it anywhere.

## Product boundary

The editor supports hierarchical circuit authoring, structural SPICE import,
`.icproj.json` files opened and saved through the operating system's own
dialogs, vector/raster publication, and deterministic SPICE/Spectre
design-netlist export. It does not simulate analog circuits: there is no solver,
no simulator process, and no execution service. Export the netlist and run it in
your own simulator.

A Project persists circuit facts. Upstream also stored named simulation source
folders; those fields are still parsed, still round-trip, and are otherwise
inert, because dropping them would break files written by the upstream
application for no gain. Browser recovery copies are a crash-safety lifecycle,
not a second source of circuit facts.

## Sources of truth

| Concern                                      | Authority                                                                        |
| -------------------------------------------- | -------------------------------------------------------------------------------- |
| Circuit facts                                | Current Project schema in `@icm/model`                                           |
| The saved Project                            | The `.icproj.json` file on disk that the File menu names                          |
| Portable file compatibility                  | Parse/upgrade/serialize boundary in `@icm/project-protocol`                      |
| Device semantics and parameters              | Component definition `electrical` section, projected into `@icm/devices`         |
| Project mutations                            | `@icm/edit-engine` transactions                                                  |
| Symbol geometry and pin anchors              | Component definition `symbol` section, projected into `@icm/symbols`             |
| Visual construction and acceptance           | Razavi reference manifest and [visual contract](specs/razavi-visual-contract.md) |
| Electrical read model                        | `@icm/derived` Base-Net/Logical-Net projections and connectivity index           |
| Structural SPICE import                      | `@icm/spice` transient Circuit IR                                                |
| Design-netlist export and source compilation | `@icm/netlist`                                                                   |
| Window, file dialogs, network lockdown       | `apps/desktop` main process                                                      |

## System shape

The core authoring model has two levels: reusable **component definitions** and
**canvas Documents/Instances**. Each built-in component has one canonical file
under [`packages/components/definitions`](../packages/components/README.md),
with symbol, electrical and catalog sections. An Instance references its stable
symbol ID and supplies actual placement and parameter values; the Document owns
connectivity and annotations. Separate runtime symbol/device packages are
generated views of that definition, not competing sources of truth.

```text
human UI
  └─ typed Project edits → Edit Engine → Project / Documents
                                         ├─ connectivity / checks / navigation
                                         ├─ rendering / formal image export
                                         ├─ structural netlist export
                                         └─ open / save a named file
```

The desktop shell adds exactly two things to that picture: a chrome-less window
serving the built editor from a privileged local scheme, and a file bridge whose
three operations — choose a file, read it, write it — are the only way bytes
cross between the renderer and the disk. Everything else the shell does is
subtraction: every outbound request is refused, and an `https://` link is handed
to the system browser rather than followed in-app.

## Core invariants

- A Base Net owns physical membership. Net Labels, Ground, Global VDD, and
  Power Rail naming use one owner-addressed marker system; local VDD Power uses
  the existing formal Cell-Pin owner. Logical Nets are derived.
  Power Rail is a drawing gesture, not a separate electrical object.
- Different supply names remain distinct. Scope and hierarchy interfaces
  determine where a name connects; text equality alone is not a universal
  cross-Cell connection rule.
- A Crossing is not a Junction. Explicit connect/snap operations update topology;
  arbitrary visual overlap does not authorize a connection.
- Movement preserves established connectivity through the common routing plan;
  explicit cut partitions physical connectivity.
- Cell Pins are ordered hierarchy interfaces. Visual variants never delete
  electrical terminal semantics or invent MOS bulk connections.
- Canonical Project content is schema-60, governed by the
  [file-format contract](specs/project-file-format.md). Saving to a file and
  keeping a browser recovery copy are distinct operations with distinct
  lifetimes.
- Electrical checks and publication advice are different decisions from
  correctness. A successful save or a pretty drawing does not establish that the
  circuit works.
- Nothing leaves the machine. A feature that would need a server does not get a
  degraded offline version; it gets removed, and the removal is recorded.

## Read next

- [User workflows](user/getting-started.md).
- [Normative contracts](specs/README.md) and [architectural rationale](adr/README.md).
- [Remaining work](roadmap/README.md).
