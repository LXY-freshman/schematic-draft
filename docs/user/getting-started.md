# Getting Started

## Run the desktop application

Launch `schematic-draft.exe`. Whether you extracted the release zip or ran the
installer, the folder it sits in is the whole installation: no service, and
nothing written outside that folder. It holds the program,
the `Projects/` directory new Projects are saved into, and the `AppData/`
directory that keeps the window size and the crash-recovery copy, so moving the
folder moves the whole installation. A copy placed somewhere it cannot write —
`C:\Program Files`, a read-only share — falls back to the per-user AppData and
Documents locations, and **Help → About** reports which paths are in use. The
window opens on an empty `New Circuit` Project whose one Cell is `dut`, ready for
palette-first manual authoring — no file needs to be opened first.

Nothing in the application reaches the network. Every outbound request is
refused by the desktop shell, and an external link opens in your system browser
instead of inside the application.

## Run from source

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm dev            # browser at http://localhost:5173
pnpm desktop:start  # the Electron window
```

Run `pnpm build` once after installing, and again after pulling package
changes: the development server's Vite configuration loads some workspace
packages from their built `dist/` output. In a plain browser, **Open Project…**
and **Save** report a failure — the file bridge they call exists only in the
desktop shell — so use **Open a Copy…** there instead, which falls back to the
browser's own file picker. **Import SPICE / SCS…** falls back the same way.

## Bring in an existing netlist

Open **File** and use **Import SPICE / SCS…** to select one `.cir`, `.sp`,
`.spi`, or `.scs` entry plus its local include files. **Import Cadence SPICE
(`!` globals)…** also treats net names ending in `!` as global Nets. In the
desktop application both open this application's own dialog — titled, starting
in `Projects\`, and taking as many files at once as the entry names. Imported
instances begin unplaced so that you decide the presentation.

New Resistor, Capacitor, and Inductor instances—including their adjustable
variants—start with `1k`, `1p`, and `1n` respectively. T-coil starts with
`L1=1n`, `L2=1n`, `K=1`, and `CB=1p`; XFMR starts with `Lp=1n`, `Ls=1n`, and
`K=1`. These are authored parameter values rather than placeholders. T-coil
and XFMR remain manual-only compound devices until structural netlist lowering
is defined.

## Edit and connect

- Open **Library** to choose a categorized built-in symbol by its inline
  preview, or press `I` (**Edit / Insert component…**) to search the full
  library, then click the canvas to place it. The
  **Placement Tray** keeps imported or returned Instances without deleting
  their netlist facts: drag one to the canvas, select **Place…** for a cursor
  placement, or use **Place all** for a deterministic starter grid. **Return
  to tray** is reversible through Undo and is distinct from permanent Delete.
- Click to select, `Shift`/`Ctrl`-click to extend the selection, or drag blank
  canvas to box-select. Dragging one selected instance moves the whole
  selection atomically.
- Internal wires and Junctions move with a selected component group; only
  wires leaving the group stretch. Press `C` to pick up a copy of the selected
  group and its internal wiring, then click to place it.
- Use **Wire** or press `W`, then choose two pins, Junctions, or route segments.
  Passing across a conductor remains a Crossing; ending on one creates a
  Junction automatically. An exact multi-route intersection is rejected as
  ambiguous instead of silently merging Nets.
- While wiring, every click draws. The first click anchors the wire; each later
  click lays down the leg it was previewing and keeps drawing on from that
  point, the way Virtuoso does. Double-click or press `Enter` to stop after the
  current leg, and `Escape` leaves the wire. The wire you get is the one the
  preview drew, so a leg starting at a Pin still leaves along that Pin's lead
  before it turns.
- Select any route segment to expose its movement handle. Drag the handle
  perpendicular to that segment to stretch adjacent geometry without rerouting
  the rest of the wire. If the moved segment lands exactly on a component pin,
  the pin connects and a junction dot appears; crossing another wire's
  interior remains unconnected. The contextual **Delete wire** action removes
  that electrical branch, not only its drawing, and can split its Net.
- Select a component and press `Q` to open **Properties**. It opens as a form
  holding the sections that component actually has: **Placement** (position as
  X and Y, 45-degree-step rotation, and an independent mirror), **Identity**
  (`netlistName`, `displayName`, the compatible drawing variant, and — for a
  supply marker — its connection and Net name), **Parameters** (one row per
  declared parameter, plus the target netlist Model where the device takes
  one), **Display** (the Visual annotation, Value, and per-parameter visibility
  switches), and **Appearance** (line color, internal mark text, and the
  differential swap switches). A section appears only when the selection has
  those fields, so a schematic-only block offers no Parameters and no Display
  section rather than dead controls. Placement and Identity start open;
  Appearance starts collapsed.
  Type in a field and press Enter — or click away — to apply it; Escape puts the
  previous value back. Selects, switches, and color presets apply on the spot.
  Valid edits update the drawing immediately; invalid or rejected edits keep the
  last accepted drawing and say why. Undo restores prior edits.
  `displayName` changes only the drawing label, while `netlistName` is the
  exported electrical instance name; the Visual annotation switch likewise only
  controls the drawing label. Parameter values are strings: type unit suffixes
  yourself; `EV` remains `EV`, and `2u` is not changed to `2um`. Declared units
  appear beside their fields without becoming data. Mirror is horizontal,
  vertical, or both, and never changes the rotation value. Line color offers
  light gray, red, green, blue, black, and one RGB tuple input such as
  `[220,38,38]`; **Auto** inherits document ink. Components expose no background
  or fill color; those belong only to drawable shapes that can contain paint.
  Differential-input blocks expose **Swap inputs**; fully differential
  amplifiers also expose **Swap outputs**. They exchange the +/− positions
  independently, connections follow their named pins, and internal marks stay
  intact.
- **Code (JSON)** sits collapsed at the bottom of the same panel. It is the same
  properties by another route — form and code share one value and one apply
  path, so an edit in either shows up in the other. Open it to paste a whole
  component's properties at once, to read the exact spelling of a field, to set
  a Signal Flow formula override, or to reach **Defaults**, **Copy JSON**, and
  **Discard draft** (Discard draft appears when the text is invalid or
  rejected). Defaults restores known defaults immediately without moving,
  renaming or rebinding the component; Copy JSON copies the whole draft.
  The code area is ordinary selectable raw JSON: press Enter to confirm without
  inserting a line break, and Shift+Enter when you want a new JSON line.
  Position is written as `"coordinate": [x, y]`, mirror as `"horizontal"`,
  `"vertical"`, or `"both"`, and a fixed color as `[R, G, B]` (0–255) — hex
  input also works, and `"auto"` inherits document ink. The editor's own inline
  switches and buttons are drawing aids: they are absent from selected, copied,
  and saved JSON. JSON expands completely; scroll the panel rather than a nested
  text area. Escape leaves the editor without discarding incomplete text. Drag
  the panel's left edge to set a comfortable width.
- Select a wire and press `Q` for the same arrangement: a **Net** section
  holding the Net name this wire claims and — once it has a name — whether that
  name is local to the Cell or global across Cells; an **Appearance** section
  with wire color, line style (solid, dashed, or dotted), a direction arrow
  (none, middle, or end), and **Hop over crossings**; then **Highlight Net** and
  **Delete wire**, with **Code (JSON)** collapsed underneath. Naming a wire
  writes its electrical Net label, and clearing the name removes that label.
  Styling changes the drawing only: it never changes what is connected to what,
  nor what the netlist exports. A MOS bulk connection belongs to its transistor
  and offers only its own delete action instead of this panel.
- **Hop over crossings** is off for every wire until you tick it, and it is a
  per-wire choice: tick it on the wire you want to read as passing over, and it
  draws a small arc wherever it crosses a wire on a different Net. Two wires on
  the same Net are connected where they meet, so they never hop. The arc is
  drawing and nothing else — it neither makes nor breaks a connection, and a
  junction dot still means exactly what it meant before. It travels into SVG,
  PNG, PDF, and Visio export along with the rest of the drawing.
- For a MOS device, the compact **Bulk** row shows its current Net or
  **Unconnected** beside **Connect**. Click the button to draw from the bulk
  terminal on the canvas. Hover the status for the terminal name and connection
  source. A configured default connection shows its Net rather than a warning;
  **Draw** lets you make an explicit route. The dashed route follows the MOS
  line color; selecting it shows a Bulk-specific action instead of ordinary
  wire styling controls. Place an unplaced device first.
- Netlist export and simulation use actual Bulk connections, including those
  established by placement defaults. Connect a missing Bulk or mark it NoConnect;
  export presets do not repair it. Module interfaces and hierarchy calls retain
  their authored Pins and order: no VDD/VSS interface is added automatically.
  Explicitly Global supplies stay global, and separate supplies such as `AVDD`
  and `DVDD` retain their connections. Ground remains node `0`, not a VSS Pin.
- Right-click an endpoint for the distinct **Disconnect endpoint** and
  **Delete connection** actions.
- `Delete` on a connected component now removes the component while preserving
  its wires as dangling Junction endpoints at the former pin positions.
- Select an instance to edit its displayed name. Select a wire Route to add an
  electrical Net label; assigning the same name to another Net explicitly
  connects those Nets. Press `T` or choose **Text** for a non-electrical note: move its translucent
  preview with the pointer, click to place it, then edit the text. `Esc` cancels
  placement. Label handles may be dragged near their owner, while plain text moves freely.
  Text notes and text inside drawn boxes default to **bold**. Use **B** to
  switch selected text to normal weight; that choice survives saving and reopening.
- To mix a stacked fraction with other text, use **Insert fraction** (the
  a-over-b button) in the text toolbar. Type the numerator, press `Tab` for the
  denominator, then `Tab` again to continue the line, for example `+ R₁`.
  Subscript and superscript work inside either part. Selecting `1u/150n` before
  clicking the button converts it while preserving character formatting.
  Double-click a note or visual annotation to edit its fractions again.
  Both parts stay centered under the same axis, and the bar follows the wider part.
  Use **ƒx** for a complete mathematical formula such as `\frac{1}{g_{mN}} + R_1`.
- Press `R` to rotate, `F` to fit,
  `Ctrl+Z` to undo, and `Ctrl+Y` or `Ctrl+Shift+Z` to redo. Shortcuts do not
  fire while typing in a field.
- Use `Ctrl`+mouse wheel to zoom around the cursor and middle-button drag to
  pan. While wiring, a middle click cycles **opposite right-angle corner →
  45° → any angle → automatic right-angle corner**. Auto follows the incoming
  leg; it is one of the two right-angle shapes, not a third extra stop.
  View changes do not increment the Document revision.

## Editing multiple components

Select components together with Shift-click or a selection rectangle, then
press `Q`. Properties shows one editable JSON block instead of the per-object
forms: a batch is a set of shared values, not one object's properties. Shared
colors and values
are displayed; differences appear as `""`. Color compares the actual document
ink, so inherited black and explicitly assigned black show the same RGB value.
Set `appearance.color` through its swatch, RGB, or hex to recolor all
selected components, including different types. For one component type, edit
`parameters.value` (or individual parameters such as MOS `w` and `l`) together.
Blank parameters keep each component's existing value. The `symbol` field
shows the common type; it is blank for differing types and is informational.
Each valid code edit applies atomically and can be undone once. Invalid edits
keep the last accepted drawing. Changing selection discards its pending draft.

## Arrow styles

Choose **Arrow** in the Library's **Annotations** group. A new arrow is a line
arrow with a filled end head: click each bend in sequence and double-click or
press `Enter` at the endpoint; it can later be curved. Change its endpoint
styles, or turn a straight arrow into a hollow outline, in Properties.

Arrow and construction-line points snap quietly to nearby pins, wires and
drawing geometry, including any point along a rectangle, circle, line or curve.
Only the transient capture marker is shown; no snap points are added to the
drawing. Hold `Alt` to suppress snapping. A visual snap aligns coordinates but
does not create electrical connectivity or make one drawing follow another.

Select any annotation and press `Q`, or use its right-click Properties action,
to open the same kind of form. **Placement** (position as X and Y, and
rotation) and **Appearance** (color, fill, line style, stroke width, arrow
shape and endpoint styles, text size, weight, italic, and alignment) come
first, then **Size** for a shape that has one, then **Display** (layer,
visibility, and locking). A section holds only the fields the annotation
actually has, so a polarity mark offers no text controls and an arrow offers no
fill. A label attached to a component says so instead of offering coordinates —
drag it on the canvas to move it. A locked annotation disables every control
except the lock itself, so unlocking is always one click away. Words are edited
on the canvas: double-click the annotation. Valid edits update the drawing
immediately as one undoable edit; invalid or rejected edits keep the last
accepted drawing and say why. Semantic labels retain their electrical text
bindings; the panel changes presentation only.

**Code (JSON)** sits collapsed underneath, exactly as it does for components
and wires, and edits the same value by another route: placement and appearance
first, then geometry, stacking, and text content (including rich text runs).
Open it to paste a whole annotation at once, to set an angle the rotation menu
does not offer, or to reach **Copy JSON** and **Discard draft** (Discard draft
appears when the text is invalid or rejected). Values with a fixed set of
choices also carry a small dropdown arrow beside the JSON value: line style,
arrow endpoint styles, layer, text alignment/weight, visibility and locking.
The menu shows the available choices without repeating the selected value.

For arrows, **Start style** and **End style** (`appearance.startStyle` and
`appearance.endStyle`) independently choose `small-arrow`, `medium-arrow`,
`large-arrow`, `dot`, `none`, or `open-arrow`. Start and end follow the first
and last points of the path when it rotates or mirrors. **Arrow shape**
(`appearance.arrowShape`) chooses a line shaft or a straight outline
silhouette; existing curves must be straightened before switching to outline.
**Stroke width ×** (`appearance.strokeScale`) changes stroke weight; an
outline's **Width** (`geometry.width`) changes its shape without changing
weight. **Rotation** (`placement.rotation`) is a clockwise angle in degrees: 0°
points right and 90° points down. For a bent line it is the direction of the
first segment; changing it rotates the whole path. The menu offers common 45°
angles; rectangles and paths also accept custom angles, which the menu keeps
showing rather than snapping to the nearest preset, while text uses 45° steps.
`geometry.tangentAngles` sets the curve angle for each segment and stays in the
code section — the canvas handles are the usual way to curve a path.
Endpoint, width and rotation handles remain available on the canvas.

Rectangles and circles have independent **Border** (`appearance.color`) and
**Fill** (`appearance.fillColor`) controls. Click either control's presets or
open its RGB row; hex and `[R, G, B]` are also accepted in code. **Auto**
inherits the document border color and makes the fill transparent. A drawing's
layer (`stacking.layer`) has no dropdown of its own: **Bring to front** and
**Send to back** place a shape above or below circuit artwork and other
drawings, and the numeric drawing order is managed internally. **Width**,
**Height** and **Radius** are the Size section (`geometry`).

Existing head sizes remain intact when loading or restyling old drawings.
Converting a bent/curved line arrow to an outline is disabled: no bends are
discarded. Changing a selected object's style does not change the next-object
creation default. These are non-electrical drawings, separate from current
markers attached to conductors and arrows inside device symbols.

## Save and recover

**File / Save** (or `Ctrl+S`) writes the file you opened, in place, with no
dialog. The File menu shows that path under **Save As…**, and the Save item's
tooltip names it, so overwriting is never a guess. **Save As…** is the only
command that asks where to put the file. A new or imported drawing has no file
yet, so its first **Save** asks once and then remembers.

A dot beside the Project name means there are changes the file does not have.
The window title says the same thing where it is harder to miss: it names the
open file — `amplifier.schdraft — Schematic Draft` — and adds a `*` while those
changes are unsaved. A Project with no file yet is titled after its Project
name. Refresh and window close then show a leave warning; only a completed Save
clears it.

Edits also stage a recovery copy in the application's own IndexedDB. Recovery is
silent crash protection, not Save, and can be lost if that storage is cleared. A
**Save a copy…** action appears contextually if recovery itself cannot protect
current work; it writes a separate backup file and leaves the Project's own file
binding alone.

New, Open, and Revert ask whether to **Save and continue**, **Continue without
saving**, or **Stay** when the current Project has unsaved changes. The prompt
names the file Save would write, or says it will ask when there is none.
Continue without saving means discard: that working copy is removed before the
action continues. Closing the desktop window with unsaved changes — the title
bar's X, `Alt+F4`, or **File / Exit** — asks the same question in a Windows
dialog: **Save**, **Don't Save**, or **Cancel**. Save runs the ordinary Save
command, so an unbound Project is asked where to go, and a save that is
cancelled or fails leaves the window open with the work still in it. If a newer
unsaved recovery copy is found on a later start, a
small banner offers **Restore**, **Save a copy…**, or **Ignore**. The same
copies remain available through **File / Recover Local Work…**; recovery never
silently replaces the current Project. A Project restored from a recovery copy
has no file binding, so its first **Save** asks where to put it.

Use **Open a Copy…** to validate a portable `.schdraft` or `.icproj.json`
without binding it: the file is loaded but not adopted, so the first **Save**
asks where to put the result and the original is never overwritten. Invalid or
future-version input leaves the current Document unchanged.

SPICE files are import inputs, not embedded source attachments. Saving an
imported Project preserves the editable schematic and source provenance, but
does not preserve `.spi`, `.lib`, or `.inc` contents; keep those original files
when you need to import them again.

## Export

**File / Export drawing** exports the entire current drawing as SVG, PNG, or PDF containing only formal schematic
layers. PNG uses 3x raster scale. PDF converts the same formal SVG to
vector paths and text on a page matching the SVG viewBox, so circuit geometry
stays sharp when enlarged.

The same menu offers **Visio** and **Visio stencil**. These are for editing
rather than looking: **Visio** writes a `.vsdx` in which every device is a
Visio shape carrying its reference, parameters and pins, and every wire is a
line segment whose ends are glued to the pins it joins. Drag a transistor in
Visio and its wire ends come along; the wires themselves keep exactly the path
you drew, because Visio is told not to re-route them. The cost of that is worth
knowing: dragging one end of a wire moves that end only, so the last stretch
becomes a diagonal until you straighten it. A wire you ticked **Hop over
crossings** for arrives with its arcs drawn into the line, since Visio has no
line jump of its own; they sit where the crossings were when the file was
written and, like the bends beside them, stay there if you move things
afterwards. **Visio stencil** writes a `.vssx`
of the symbol library alone, with no drawing, for building a schematic in Visio
by hand. Neither file is read back — the `.schdraft` you opened stays the real
Project, and edits made in Visio stay in Visio. Whatever the package could not
carry (formulas written as their source, pin names left off a symbol, and so
on) is counted in the status line as the file is written, rather than left for
you to discover later.

To reuse only selected content as an image, choose **Edit / Copy selection as
PNG** or **Edit / Copy selection as SVG**, then paste into another application.
Attached visible labels travel with their selected objects, but remote objects
sharing a Net do not. Clipboard copies omit editor overlays, use a transparent
page background, and do not change the circuit or Undo history. PNG is rendered
at 3x with a bounded image size. SVG stays vector; formula glyphs remain paths,
and the receiving application determines paste/editing support. Failures are
reported without silently writing a file or substituting a different format.
These commands do not change the existing **C** copy-placement workflow.

Use **Netlist / Check and Save** to check the whole Project for ERC and
visual issues and then save it to its file.
Findings appear in **Issues**, the bottom status summary, and existing canvas
markers. Observations stay behind their explicit toggle. Neither producer
runs automatically while drawing. Further edits mark the last check out of
date and hide its markers; check again to refresh it. Save still proceeds
when issues exist. This command does not repair Bulk connections or rewrite
the circuit. A Route segment that is neither horizontal, vertical, nor exactly
45° appears as an actionable wiring issue. **Straighten angled wires in this
Cell** replaces only those segments with local right-angle corners in one
undoable edit; intentional 45° segments stay unchanged. Locked and trunk Routes
remain listed for manual repair. **File / Save** and **Ctrl+S** remain save-only.

Click the top **Netlist** copy button to put the netlist on the clipboard and
open its live code in the right sidebar. That panel's **Format** (SPICE or SCS)
and **Process** selectors choose what is copied and are remembered locally;
**Default** restores every preset. Editing the circuit refreshes the
visible code. Clipboard failures leave the code selectable for manual copy.

**Netlist / Save netlist to file…** writes that same netlist to disk instead —
a `.spi` for SPICE or a `.scs` for Spectre, in the format the panel is showing.
The desktop application turns it into a Save As dialog that starts in
`Projects\`. Copying and saving are two ways out of one projection: the bytes
are identical, and a circuit the Check Report blocks from being copied cannot
be saved either.

**Netlist / Instances…** opens the Project's netlist instances as one editable
JSON document in the right sidebar. Paste whole blocks to change references,
model bindings and parameters together. Outer keys are Cell IDs; inner keys are
stable instance IDs. Edit `reference` to renumber, `target` for the typed model
binding, or `parameters` for values. `symbol` is read-only. Omitted instances and
fields remain unchanged; a supplied `parameters` object replaces that instance's
parameter set, so deleting a parameter clears it. Valid edits apply together;
invalid JSON or conflicting references leave the circuit unchanged. **Edit / Undo**
and **Redo** undo or restore the complete batch.

**Netlist / Configuration…** opens one raw JSON document in the right sidebar.
Copy, paste, or replace the whole configuration. Set `selected` to `abstract`,
`sky130`, `tsmc28`, `tsmc180`, or `custom`; edit the corresponding entry under
`profiles`. Valid edits apply immediately and are remembered in this browser.
Invalid JSON pauses copying until corrected. The circuit itself is unchanged.

- `abstract`: ideal R/C/L and generic NMOS/PMOS model names, with editable
  fallback values and dimensions. No transistor model cards are invented.
- `sky130`: real SKY130 transistor wrappers, with ideal R/C by default. For
  physical R/C, set the target to `sky130_fd_pr__res_high_po` or
  `sky130_fd_pr__cap_mim_m3_1` and supply `w`/`l` in metres (for example `5u`),
  plus `mult` or `mf`. The resistor's `substrate` defaults to `0`. Ideal values
  are not converted into geometry. Set `library.path` and `library.section`
  for your installed PDK. SCS exports stay in Spectre syntax and reference that
  configured path with a native `include` declaration.
- `tsmc28` / `tsmc180`: TSMC reference MOS names (`nch_ulvt_mac`/`pch_ulvt_mac`
  with `multi`, or `nch`/`pch` with `m`) and ideal R/C/L. Point `library.path`
  at your installed PDK.
- `custom`: keep authored component targets, and fill missing fields from your
  editable defaults. Existing component values always take priority.

Every preset requires an actual MOS Bulk connection or an explicit NoConnect.
Missing connections block export rather than creating an invisible VDD Net.
Built-in Analog Blocks require their library-declared supply Nets to exist;
export reports missing supplies instead of adding Cell Pins. Use an explicit
external definition when the block needs a different supply interface.

Fields still missing after these defaults use undefined `TODO_…` placeholders;
the sidebar and Check Report identify incomplete output. The Project stays
unchanged. Existing values, connections, and formal pin order are retained.
Copied code contains no generated comments; detailed findings remain in Check
Report. SPICE keeps an empty first title line so a simulator does not consume
the first directive. An explicitly marked NoConnect becomes a floating node
such as `NC0001`; structural errors such as an unmarked non-bulk open pin,
conflicting names, or unsupported devices show an error instead of stale or
partial code.

Choose the arrow beside Netlist, then **Check Report** to inspect the same
SPICE/Spectre preview, change the naming profile, or navigate to a finding.
The report lists structural findings and current-revision ERC readiness
separately. The export includes the library path/section you configured, but does
not add model cards, analyses, or a complete testbench. Exporting a file does not
make the circuit ready for simulation.

## Import Spectre / SCS

Use **File / Import SPICE / SCS…** and select one `.scs` entry together with
its local include files. `circuit.scs` is recognized as the entry when several
netlist files are selected. Conversion happens inside the editor, on this
machine, like everything else here.
The converted structure uses the existing import and placement flow. Errors
show the source filename and line, and leave your current circuit unchanged.

The converter supports common structural devices, ordered subcircuits, parameters,
DC/AC/PULSE/SIN/PWL sources and simple OP/AC/DC/TRAN analyses. It preserves a
SPICE-language section in SCS. Unsupported parameters, native model syntax,
behavioral expressions and ngspice control scripts cannot be translated into
native Spectre; they produce an error instead of a partial circuit. Keep your
original testbench files: import builds the circuit and does not retain the deck.

## Build the Windows application

```bash
pnpm desktop:dist
```

The release zip, the installer, and the program folder they both carry land under
`output/desktop/`. Copy the folder anywhere and run it; it needs no installer and
no privileges, and it keeps its files in its own folder. See
[`apps/desktop/README.md`](../../apps/desktop/README.md) for what the shell does
and does not allow.

Before handing a build to someone, launch it and verify opening a file, saving in
place, **Save As…**, importing SPICE, exporting SVG/PNG/PDF, and recovery.
