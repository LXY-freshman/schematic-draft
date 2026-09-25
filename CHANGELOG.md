# Changelog

Notable changes to Schematic Draft. Entries describe what changed for the person
using the product, not the commits that got there.

Entries at and below `0.9.2` are inherited from
[Analog Canvas](https://github.com/cascode-ai/analog-canvas), the hosted editor
this application was forked from. They describe the shared editing core; the
hosted features some of them mention are gone.

## 1.3.2 — Right on the page (2026-09-25)

### Added

- **Line jumps can be drawn bigger or smaller.** The hop a wire makes over a
  crossing was fixed at one size, which is right for a dense schematic on
  screen and too small to see in a figure printed at half scale. **Line jump
  size** joins the five factors in the document Style code and scales every
  hop in the document between half and twice the size it was, leaving the
  drawing it was tuned for unchanged at 1×. It is one setting for the whole
  document rather than one per wire, so hops stay the same size as each other
  the way a drawing convention should; which wires hop at all is still the
  per-wire **Hop over crossings** button. The new size travels into SVG, PNG,
  PDF and Visio export. A wider arc needs more straight wire either side of a
  crossing, so at the larger sizes a crossing that sits close to a corner is
  drawn flat instead of distorted — the same rule that has always decided
  whether a hop fits.
  **This changes the Project file.** A Project that sets a line jump size is
  written at schema 60 and **Schematic Draft 1.3.1 will refuse to open it**.
  Files that leave the size alone are unaffected and open in either version,
  and 1.3.2 opens everything older as before.

### Fixed

- **A wire in a Visio export no longer has a hole at every corner.** A Route
  goes to Visio as a chain — one shape per straight run, one more for each hop
  over a crossing — so that every corner is a handle a hand can reach. What the
  chain also meant was two separate strokes meeting at each corner, with no
  line join between them to fill the outside of the angle: the wire came apart
  into a small square notch at every corner it turned, and at both feet of
  every hop arc. Wires now cap round, which fills the notch at whatever line
  weight the drawing is set to, and keeps filling it after the weight is
  changed inside Visio.
- **The grid reaches the edge of the window, whatever shape the window is.**
  Maximised on a wide screen, or taken fullscreen, the dots used to stop in a
  band either side of the drawing — and the blank paper past them was not
  merely undotted: a click there placed nothing and started no wire, because
  the layer the pointer draws on ended with the dots. Both now cover the whole
  canvas, and keep covering it while the window is resized.
- **An IGBT's reference designator sits beside it, like every other
  transistor's.** An IGBT is a MOS gate on a bipolar output, so its pins are a
  gate with a collector and an emitter — neither of the two transistor shapes
  the label placement knew, and a symbol it does not recognise gets its name
  underneath. Underneath an IGBT is directly under the emitter lead, where `Q1`
  reads as the name of whatever the emitter is wired to rather than of the
  device. It is now labelled on its right side, where the MOS and BJT families
  around it are.
- **A four-terminal MOS keeps its polarity arrow beside the channel.**
  Switching a MOSFET to the four-terminal variant used to carry the
  transistor's only arrowhead out to the body pin, 24 units away: it read as a
  mark on the bulk wire instead of as the device's polarity, and the channel it
  left behind was bare. The arrow now stays where it states something, beside
  the channel, and the body is one plain lead out to B — the simpler of the two
  drawings the reference sheet shows side by side. The three-terminal default
  is unchanged, so an existing schematic that uses it is drawn exactly as
  before.
- **The enhancement GaN HEMT has three channel segments.** An E-GaN is
  normally off: it has no channel until the gate induces one, and the symbol
  says so with three separated segments. Ours drew two, which is not the
  convention for anything — it read as a depletion bar with a piece missing.
  D-GaN keeps its continuous bar, correct for a normally-on device, so the two
  symbols now differ by exactly the thing they exist to distinguish.
- **The depletion MOS body lead no longer cuts the channel it should come
  out of.** A depletion MOSFET is drawn with a solid bar between drain and
  source, which is the whole statement the symbol makes: the channel is there
  before the gate does anything. Switching **DNMOS** or **DPMOS** to the
  four-terminal drawing ran the body lead from the gate-side channel edge
  straight out to B — across the middle of that bar, crossing it at right
  angles and leaving it looking cut in two. The lead now starts on the bar and
  goes right from there, which is also what it means: the body belongs to the
  channel. Where the lead ends and where B sits are unchanged, so every wire
  already landing on a body stays where it is, and the three-terminal drawing,
  which never showed the lead at all, is untouched.

## 1.3.1 — Within reach (2026-09-24)

### Added

- **Separate analog and digital grounds.** **Power and Ports** now offers
  **AGND** and **DGND** beside Ground, drawn as a filled and a hollow triangle
  so no two of the three are mistaken for each other at a glance. Ground keeps
  SPICE node `0` to itself; the new pair are ordinary global rails, which is
  what a mixed-signal design wants when its analog return has to stay off the
  digital one all the way through to the netlist — the deck declares each rail
  `.global` and the markers themselves print nothing, because a ground glyph is
  a name, not a device. Putting either one on a supply is refused rather than
  exported, and Ground is still rejected anywhere other than node `0`.
- **Three power switches join Transistors: E-GaN, D-GaN and IGBT.** The two GaN
  HEMTs are the normally-off and normally-on parts, drawn with D/G/S and no
  body lead — a GaN HEMT has no body diode, and the symbol does not pretend
  otherwise; the enhancement part's channel is broken where the depletion
  part's is continuous. The IGBT keeps a MOS gate plate and takes bipolar
  C/G/E leads. All three place, wire, rotate, label and export like any other
  symbol. What they do not have is a SPICE primitive: no standard card
  describes a GaN HEMT or an IGBT, so rather than dress one up as a MOSFET and
  hand it silicon model parameters, netlist export reports the instance as
  non-netlistable. Bind it to a `.subckt` you imported from the vendor and it
  prints as an ordinary subcircuit call, with the vendor's own model behind it.
  They are authored in the Extended Devices library, like the DMOS and
  depletion parts, and filed under **Transistors** for the same reason.
- **A wire or a component can be drawn heavier or lighter than the rest.**
  Appearance now carries **Stroke width ×** beside the colour, on a wire and on
  a component alike: any multiplier from 0.25 to 4 over the weight that object
  is normally drawn at, in steps of a quarter. Use it to make a supply rail read
  as a rail, or a device under discussion stand out on a printed page. It is
  drawing only — a heavier wire carries no more current, and a heavier symbol is
  the same device with the same pins — and `1` means exactly what no setting at
  all meant before. The document-wide Wire, symbol and annotation scales still
  apply on top, so raising one of those moves a scaled object along with
  everything else. A wire's width travels into Visio; a component's does not,
  because every instance of one symbol shares one Visio master. The export's
  status line now names the components that lost it — which it also does, at
  last, for a per-component colour, dropped silently until now.
  **This changes the Project file.** A Project that uses the new field is
  written at schema 59 and **Schematic Draft 1.3.0 will refuse to open it**.
  Files that use no stroke width are unaffected and open in either version, and
  1.3.1 opens everything older as before.
- **A MOSFET can be drawn with its bulk lead.** Every MOS in the library —
  NMOS, PMOS, the two depletion parts and the two DMOS — already carried B as a
  fourth terminal; only the drawing left it out. Appearance now holds a **Bulk
  terminal** switch that draws the lead, turning the familiar three-terminal
  symbol into the four-terminal one without touching the device. B is a real
  pin either way, so the netlist, the pin order and every wire already landing
  on the body stay exactly as they were; what moves is where the wire lands,
  because the body lead comes out of the side of the channel rather than the
  back of the symbol. In Visio the two drawings are two masters, named after
  the device and **… (four-terminal)**.
- **The background grid can mark every seventh dot.** The status bar's grid
  button now cycles **Grid Off → Grid On → Grid On · Coarse**. The coarse state
  keeps the same fine dots and draws every seventh one larger and darker, so
  the canvas reads as big squares of seven small ones and distance can be
  judged without measuring. It is a view setting like the grid itself:
  `canvas.majorGridDots` in Style settings says which state the button is in,
  and no saved file or export carries either layer.

### Changed

- **A wire exported to Visio now has a handle at every corner.** A Visio wire
  used to be one shape, and a one-dimensional Visio shape has exactly two ends
  you can grab — so a wire that turned four corners still offered two handles,
  and the corners themselves were numbers you could only reach by retyping
  geometry. Each wire is now a chain: one straight piece per run, joined at
  small invisible nodes that both neighbouring pieces are glued to. Drag a node
  and the two pieces meeting there move together; everything else about the
  export is unchanged — the ends are still glued to their pins, and Visio is
  still told not to re-route anything. Two costs come with it, both deliberate:
  a wire takes a rubber band or a few `Ctrl`-clicks to select whole, and the
  file is larger. Where a wire branches or a contact is dotted, the chain hangs
  on that node instead of adding one, so dragging a junction still takes every
  wire through it along.
- **A line jump exported to Visio is its own shape.** The arc used to be baked
  into the middle of the wire's geometry, which is why it could not be selected,
  moved or removed on its own. Each hop is now a link in the chain like any
  other, glued to the run on each side, carrying the same net name so clicking
  it still tells you which wire it belongs to. Delete one and the gap it spanned
  stays a gap for you to pull closed — nothing straightens itself behind your
  back.
- **The depletion and DMOS parts sit with the transistors.** D-NMOS, D-PMOS and
  the two DMOS entries were four sections down the Library, under **Extended
  Devices**, because that is the catalog they are authored in. Someone reaching
  for a transistor looks under **Transistors**, so that is where they are now,
  after the four everyday parts. Nothing else about them changed — same
  symbols, same parameters, same library of origin.
- **The colour swatches in Properties are MATLAB's default colour order.** The
  four presets became eight: the neutral light gray, then MATLAB's Blue,
  Orange, Yellow, Purple, Green, Cyan and Dark red. A wire and the plotted
  trace it produced can now be given the same colour without matching hex by
  eye. Colours already saved in a Project are untouched, and any colour at all
  is still reachable through **RGB**.
- **The Appearance section reads as one panel.** Its captions — the colour
  control's title, the **RGB** disclosure, the R/G/B fields — were set in three
  sizes and two weights; they now match the labels on the selects and switches
  beside them. **RGB** also wears the frame of a button, because it is one, and
  each swatch has a darker outline so a pale colour is still a visible chip.
- **Hop over crossings and Highlight Net are buttons that stay pressed.** One
  was a tick box and the other a button that renamed itself to **Clear Net
  highlight** whenever the highlight was on, so telling the current state apart
  meant reading two different kinds of evidence. Both are now the same control:
  one fixed name, and the blue frame a chosen colour swatch wears while what it
  turned on is on. Clicking either still toggles it, and **H** still toggles the
  highlight.

### Fixed

- **Every grid dot is a whole dot.** Each dot was centred on the corner of the
  tile it repeats in, so three quarters of it fell outside and only a quarter
  was ever drawn — invisible at the fine size, and an obvious wedge at the
  coarse one. The dots are now drawn whole, in the same places as before.
- **Highlighting a net no longer cuts across the line jumps on it.** A wire set
  to **Hop over crossings** is drawn with a small arc at each crossing, but
  the blue highlight was painted as a straight line over the same centerline,
  so it ran through every arc the wire went around. Both now trace the same
  path. Wires with no hops are drawn exactly as before.

## 1.3.0 — Native to the desktop (2026-09-23)

### Added

- **The netlist can be written to a file.** Until now the only way out of the
  editor was the clipboard, so handing a netlist to a simulator meant pasting
  it into an editor and saving it by hand. **Netlist / Save netlist to file…**
  writes the netlist the panel is showing as a `.spi` or `.scs`, through the
  same Save As dialog the drawing exports use. It is the same projection as the
  copy button — identical bytes, and a circuit the Check Report blocks from
  being copied cannot be saved either.

### Changed

- **There is one menu now, the one in the window.** The desktop application
  also carried a system menu bar, hidden behind `Alt`, holding not a single
  editing command — only three things the window itself knew. All three have
  moved somewhere they can be found: **Open Projects Folder** is in the
  **File** menu with the rest of the file commands, and the About section of
  **Help** now shows where this installation keeps its Projects and its
  settings, whether that is inside the program folder, and whether `.schdraft`
  files open with this copy — with a checkbox that turns the association on and
  off. The checkbox reports what Windows actually did, so a refused change
  shows as refused instead of looking applied. The window keys are unchanged:
  `Ctrl +`, `Ctrl -` and `Ctrl 0` scale the interface, `F11` is full screen,
  `Ctrl+Shift+I` opens the developer tools. **File → Exit** is gone with the
  menu bar; close the window with its X or `Alt+F4`, which ask about unsaved
  work exactly as before, as does signing out or shutting Windows down.

- **Opening and importing files use this application's own dialogs.** Bringing
  in a netlist or a second Project used to go through a web page's file picker:
  untitled, starting wherever the last one did, offering filters named after a
  browser. In the desktop application **Import SPICE / SCS…** and
  **Open a Copy…** now open the same dialog **Open Project…** does — titled,
  starting in `Projects\`, filtered to the extensions this program reads. The
  SPICE entries still take a whole family of files at once, and files arrive as
  bytes, so a netlist saved as UTF-16 imports as the text it is rather than as
  mojibake. **Import Project File…** is the command now named **Open a Copy…**;
  it still loads without binding, so the first **Save** asks where to put the
  result.

- **The window title names the file you are editing.** It used to read
  `Schematic Draft` no matter what was open, so several windows were
  indistinguishable in the taskbar and in `Alt+Tab`. It now reads
  `amplifier.schdraft — Schematic Draft`, with a `*` after the file name while
  there are changes the file does not have — the same fact as the dot beside
  the Project name, somewhere it cannot be missed. A Project that has never
  been saved is titled after its Project name instead.

### Fixed

- **Switches in Properties are shaped like the controls beside them.** A wire's
  **Hop over crossings**, and a component's **Internal mark**, **Inverting
  input**, **Swap inputs** and **Swap outputs**, came out as a small grey pill
  with the box stranded on a line above its own words, sitting among full-width
  white fields that looked nothing like it — the panel was styling them as
  captions for controls rather than as the controls they are. Each now takes the
  same frame, height and text as the selects it shares a section with, and the
  tick is what says whether it is on. The switches clustered under **Display**
  keep their compact shape: they are one row of related choices, not one control
  each.

## 1.2.0 — Control over the drawing (2026-09-23)

### Added

- **Wires can hop over the wires they cross.** A new **Hop over crossings** box
  in a wire's Appearance section draws a small arc wherever that wire crosses a
  wire on a different Net, which is how a schematic says "these two pass, they
  do not meet". It is a per-wire choice and off until you tick it, so every
  drawing you already have keeps its flat crossings. The hop is drawing and
  nothing else: it neither makes nor breaks a connection, two wires on the same
  Net never hop because they really are connected, and junction dots still say
  what is joined. It shows on the canvas, in SVG, PNG and PDF export, and in a
  Visio `.vsdx`, where the arc is drawn into the wire because Visio has no line
  jump of its own.

### Changed

- **Properties is a form.** Pressing `Q` used to hand you one block of raw JSON
  and nothing else, so changing a rotation or a resistor value meant editing
  punctuation. A component now opens labelled sections — Placement, Identity,
  Parameters, Display, Appearance — showing only the fields that component
  actually has, and a wire opens its Net name and scope above wire color, line
  style and direction arrow. Text, arrows and shapes get the same treatment:
  placement, ink and fill, line style, arrow ends, size, and the visibility and
  lock switches, with an attached label saying it follows what it labels
  instead of offering coordinates, and a locked drawing offering nothing but
  the unlock. The JSON is still there, collapsed under **Code (JSON)**, for
  pasting a whole object at once or reaching **Defaults** and **Copy JSON**;
  both surfaces edit the same properties through the same checks, so neither
  can produce something the other rejects.

- **Wires in an exported `.vsdx` are line segments, not connectors.** They used
  to be Visio's own dynamic connectors, which treat the path as theirs to
  recompute: nudging anything on the page made Visio rearrange the wiring into
  a route of its own invention. A wire is now a drawn line that Visio is told
  not to re-route, so the bends stay exactly where you put them. Both ends are
  still glued to their pins, so dragging a transistor still drags its wires
  along. The trade is that dragging one end of a wire by itself moves only that
  end, leaving the last stretch diagonal until you straighten it.

### Fixed

- **Closing the window with unsaved changes now asks.** It used to do nothing
  at all: the editor's browser-style leave guard reads as a silent refusal in
  the desktop shell, so the X, `Alt+F4` and **File → Exit** were simply
  ignored. Closing a Project that has unsaved work now offers **Save**,
  **Don't Save** or **Cancel** in a Windows dialog that names the file Save
  would write. Save runs the ordinary Save command — a Project that has never
  been saved is asked where to go — and a save that is cancelled or fails
  leaves the window open with the work still in it.

- **Schematic text in the Windows app renders the way it is drawn.** The
  installed application applied a security policy that silently discarded the
  styling the canvas asked for, so signal names came out upright instead of
  italic, bold and plain text were the same weight, and — worst of it — the bar
  over an active-low signal was simply absent, leaving `Q` and its complement
  identical on screen and in anything exported from that window. The same
  policy was throwing away the code panel's layout and the schematic font's
  round period. All of it now renders as intended; the policy still refuses
  everything it was meant to refuse. Browser use was never affected.

## 1.1.0 — Visio export (2026-09-20)

### Export a drawing you can keep editing

- **File → Export drawing → Visio** writes the open Document as a `.vsdx`.
  Devices arrive as Visio shapes rather than loose lines, and each wire is a
  connector glued to the pins at its ends, so dragging a transistor in Visio
  drags its wires along with it. Reference designators, parameters, net names
  and the owning Cell ride along as Shape Data, and the page sits on Visio's
  eighth-inch grid, so anything you draw afterwards lines up with the pins.
- **Visio stencil** exports the symbol library itself as a `.vssx`, so devices
  the drawing did not happen to use can be dragged in beside the ones it did.
  It is named for the library rather than the Project, because it is the same
  stencil whichever circuit is open.
- The status line names what Visio could not be given, counted by kind, at the
  moment the file is written: formulas are written as their source text, marks
  that stay upright on the canvas are baked at the orientation the device was
  placed in, and pin names a symbol draws are left off. The
  [export specification](docs/specs/export.md) lists the whole contract.
- Only the open Document is exported, and nothing reads a `.vsdx` back: the
  Project file you opened stays the original, and an edit made in Visio stays
  in Visio. The export itself is local — Visio does not need to be installed to
  produce the file, and producing it contacts nothing.

## 1.0.0 — Schematic Draft fork (2026-09-19)

The first public release of the fork, and the release everything below `0.9.2`
leads up to: Analog Canvas running entirely on your own machine, packaged
as a Windows desktop application. The schematic editor, hierarchy, SPICE
interchange, and formal export are unchanged. What is gone is everything that
needed a server.

### Offline by construction

- Ship as an Electron desktop application. The main process blocks every
  outbound network request, serves the editor from a private local scheme, and
  opens external links in your system browser instead of loading them in the
  application.
- Remove accounts, Cloud Projects, the Community Gallery, moderation, the Agent
  API and its MCP server, first-party analytics, and the hosted simulation
  service — not disabled, removed. There is no build flag that turns them back
  on and no code path that could contact a service.
- Drop the progressive-web-app surface: no service worker, no offline cache, and
  no web app manifest. The installed application is the installation, so there
  is nothing to install from a page and no cached copy that can go stale.

### Wiring

- Draw each wire leg on its own click. The first click anchors the wire, every
  later click lays down the leg it was previewing and keeps drawing from that
  point, the way Virtuoso's wire command does. Nothing waits for a double-click
  to become real geometry any more; a double-click or `Enter` only stops the
  wire after the leg it has already drawn.
- Because each click now commits what it previewed, a leg leaving a Pin keeps
  the escape along that Pin's lead that the preview always drew. Under the
  hosted editor an intermediate click discarded that escape when the wire was
  finally committed, so wires drawn against a Pin's lead may take a different
  shape than before.

### Real files instead of Cloud Projects

- **Open Project…** and **Save As…** use the operating system's own file
  dialogs. A Project is the file you opened, at the path the File menu names.
- New Projects are saved as `.schdraft` — the same canonical JSON under an
  extension of this application's own, because Windows resolves only the last
  extension and `.icproj.json` is indistinguishable from `.json` to it. The name
  is long and says what wrote the file on purpose: a short generic extension is
  the kind another tool arrives at independently, and whichever registered last
  would own the double-click. Existing `.icproj` Projects from earlier builds,
  `.icproj.json` and plain `.json` Projects open unchanged, and `.icproj.json`
  stays the portable interchange name.
- **Save** and `Ctrl+S` overwrite that file in place, with no dialog. The File
  menu shows the exact path so overwriting is never a guess. A new Project has
  no file yet, so its first **Save** asks once and then remembers.
- A Project file handed to the application — named on the command line, or
  opened with it from Explorer — loads at launch. Handing it a second file while
  it is running opens that file in the window already open instead of starting a
  rival copy, and replacing unsaved work asks first, exactly as **Open
  Project…** does.
- **Import Cell** copies a Cell out of any other Project file on disk.
- Only the main process touches the filesystem; the editor asks it to read and
  write and cannot widen that scope on its own.
- Local crash recovery is unchanged and still non-authoritative: bounded copies
  in the application's own storage, reachable from **File / Recover Local
  Work…**. The file on disk is the record.

### One folder is the whole installation

- Everything the application writes lives inside its own folder: new Projects go
  to `Projects\` beside the executable, and the window size, preferences and
  crash-recovery copies go to `AppData\`. Nothing is left in `%APPDATA%` or your
  Documents folder, so copying or moving that one folder — to another drive, a
  stick, another machine — moves the installation with its work intact. The
  Windows file association below is the single exception, because a double-click
  cannot be taught from inside a folder.
- **File → Open Projects Folder** opens that `Projects\` directory, the Save As
  and export dialogs start there, and **Help → About** reports the paths in use.
  Saving anywhere else still works; the dialogs go wherever you point them.
- A copy placed somewhere it cannot write — `C:\Program Files` without
  elevation, a read-only share — keeps working and falls back to the per-user
  AppData and Documents locations, which About then reports instead.
- The delivered program folder is named `Schematic Draft\` rather than `app\`,
  and a release ships it as a zip whose one top-level entry is that folder:
  extracting it anywhere gives a complete installation. Rebuilding replaces the
  program and leaves `Projects\` and `AppData\` alone.

### Installing it

- A Windows installer ships beside that zip — the same program, laid down with
  shortcuts. It installs for the current user, so it needs no administrator, and
  it asks which folder to install into — that folder is then the whole
  installation, `Projects\` and `AppData\` included.
- **Uninstalling keeps the Projects you saved.** They sit inside the installed
  folder, so the uninstaller removes the program around them and then names the
  path it left them at. Deleting them stays your decision.
- Installing a newer version over an older one also keeps `AppData\`, so a
  version bump is not a reset of window size, preferences and the recovery copy.
  A real uninstall does take that folder, which is nearly all browser cache.
- Uninstalling hands the `.schdraft` association back — and only while it still
  names the copy being removed, so another copy's claim survives.

### Double-clicking a Project

- An installed copy — or one extracted from the release zip — claims `.schdraft`
  for itself the first time it runs, so
  double-clicking a Project in Explorer opens it here. The entries are per-user
  (`HKCU\Software\Classes`): no elevation, no other account affected, and the
  open command names this folder's executable, so a folder that moved re-points
  the association at its new home the next time it starts. Claiming it releases
  the `.icproj` claim an earlier build made rather than holding both — the
  collision the longer name avoids would be back otherwise. Files already saved
  as `.icproj` still open from **File → Open Project…**.
- **Help → Open .schdraft Files With This Copy** shows the real state and turns
  it off, removing those entries. An extension entry is only removed while it
  still points here — if another application has claimed it since, that entry is
  not this one's to delete. Turning it off is remembered, so a later launch does
  not quietly claim the extension again.
- **Help → About** states whether the association is in place.

### Simulation

- The editor no longer runs simulations. It still exports deterministic
  structural SPICE and Spectre netlists for the simulator of your choice, and
  still imports `.cir`, `.sp`, `.spi`, and `.scs` sources.
- Projects written by the hosted editor still open, upgrade, and save without
  losing their simulation setups and source folders. Nothing in this edition acts
  on that data, but nothing discards it either.

The Project file format is untouched: schema 57, byte-for-byte what the upstream
editor writes. Existing Projects are not rewritten when opened.

## 0.9.2 (Preview candidate)

### Wiring

- Keep an existing loose wire endpoint under direct mouse control when it is
  extended. Automatic routing no longer inserts an extra turn or changes the
  direction chosen by the user.
- Join Nets when a dragged wire segment reaches an existing wire endpoint,
  while leaving an ordinary crossing through the middle of another wire
  electrically separate.

Project schema 56 is unchanged. Existing Projects are not rewritten when opened.

## 0.9.1 (Preview candidate)

### Netlist export

- Put `VDD` and `VSS` first on every Canvas-authored module and matching
  hierarchy call. Legacy VDD Power drawings acquire the same interface during
  export without rewriting the saved Project.
- Connect a manually authored PMOS with no explicit Bulk or No Connect to the
  selected profile's PMOS substrate, `VDD` by default. Explicit and imported
  connections remain authoritative.

### Editor interaction

- Let attached Net Labels move freely while retaining their electrical Net.
- Preserve the automatic route shown in the wire preview when finishing with a
  double-click, without reversing the elbow direction.

Project schema 56 is unchanged. Existing Projects are not rewritten when opened.

## 0.9.0 (Preview candidate)

### Netlist and device controls

- Keep SKY130 SCS output in native Spectre syntax without an extra SPICE
  language line, and arrange the compact Format, Process, device-target, copy,
  and Default controls around the live code editor.
- Choose reviewed NMOS, PMOS, resistor, capacitor, and inductor targets for
  SKY130, TSMC 28, and TSMC 180. The editor grows with short netlists, retains
  line numbers, and scrolls once it reaches its useful height.

### Drawing and presentation

- Keep annotation text, fractions, formulas, and polarity symbols upright when
  their attached drawing rotates; attachment positions continue to rotate with
  the drawing.
- Render transistor W/L fractions with the same typeface and a tighter bar that
  follows the actual numerator and denominator width.
- Remove the unintended Capacitor Section symbol from the component library.

### Site operation

- Keep first-party analytics pages, routes, styles, client reporting, and
  Durable Object handling in one module while preserving the existing data
  namespace and stored counters.

Project schema 56 is unchanged. Existing Projects are not rewritten when opened.

## 0.8.0 (Preview candidate)

### Project authoring

- Open complete Project Code and a live Netlist from the main toolbar. Both
  editors show line numbers and syntax colors; Project Code applies validated
  JSON as one undoable edit and protects drafts when the Canvas changes.
- Edit component and drawing Style as concise JSON. The toolbar keeps Gallery
  and Library on the left and Project Code and Netlist on the right, while
  drawing tools remain in the Library instead of taking permanent toolbar
  space.
- New blank circuits use `dut` as the Cell and netlist module name. Existing
  authored Cell names and real Testbench Cells keep their names.

### Netlist export

- Choose Format and Process independently in the live Netlist panel, edit the
  selected NMOS and PMOS targets directly, and restore every cached preset with
  one Default action. Copy uses a compact icon and never downloads a file.
- Keep SKY130 SCS exports entirely in Spectre syntax, including a native
  `include` declaration for the configured model library.
- Put `VDD VSS` first in generated Cell interfaces and hierarchical calls,
  including blank circuits without drawn supply symbols. Unconnected MOS bulk
  terminals use those module supplies, and generated supplies stay out of the
  Canvas probe list.
- Keep visible VDD Power connectivity explicit and editable through component
  property JSON. Built-in OTA labels retain their route positions instead of
  falling back to the upper-left corner.

Project schema 56 is unchanged. Existing Projects are not renamed or rewritten
when opened.

## 0.7.0 (Preview candidate)

### Netlist export

- Choose compact Abstract, SKY130, TSMC 28, TSMC 180, or Custom presets in
  the live Netlist panel. The last choice and edited profile remain cached in
  the browser.
- Export TSMC 28 MOS devices with `nch_ulvt_mac` / `pch_ulvt_mac` and `multi`,
  or TSMC 180 MOS devices with `nch` / `pch` and `m`. NPN and PNP devices also
  support an authored multiplier.
- Recover `0` and `VDD` from visible power markers in older and copied
  drawings. Unnamed internal networks use stable `net0`, `net1`, ... names,
  skipping authored name collisions without guessing meaning from device pins.

### Drawing repair

- Find historical wire segments whose angles are neither orthogonal nor 45
  degrees in Properties Issues, then straighten every repairable segment in
  the current Cell with one undoable action. Protected trunk and locked routes
  remain listed for manual review.

Project schema 56 is unchanged. Existing drawings are not rewritten by
opening them; the angled-wire repair runs only when selected from Issues.

## 0.6.0 (2026-09-15)

### Drawing and properties

- Choose each arrow endpoint independently: small, medium or large arrow,
  a dot, or no marker; existing open arrows remain available.
- Edit shared component parameters and colors together in Properties Code.
  Common values are shown, differing values are blank, and an explicit new
  value applies to the selection in one undoable edit.
- See Smart Snap alignment guides while placing copied components, including
  rotated, mirrored and multi-component copies.
- Mirror attached reference/value text positions with their components while
  keeping the lettering readable. Shorten both Port styles by one grid cell.
- Place DACs and other components reliably when clicking their preview text.
  Cycle from the alternate orthogonal wire corner to diagonal routing without
  an extra redundant corner step.

### Agent and Simulation

- Click Agent once for full editing access and a compact copyable connection
  message. Normal local development starts its Agent relay automatically.
- Recover dropped connections correctly instead of remaining stuck at
  Connected while Agent requests report the editor offline.
- Expire sessions after 30 idle minutes; Agent operations and manual edits
  renew them, so active work has no absolute session time limit.
- Keep manual editing and Agent editing available together during local
  development. Place both Port styles with their actual Cell terminal and Net.
- Display magnetic parameters independently through the shared Agent command.
  Show Simulation files directly under their experiment and initially expand
  only the active experiment.

Project schema 55 adds independent arrow endpoint styles. Existing Projects
remain importable; drawings affected by shortened Port contacts may need manual
route repairs. The currently published MCP 0.9.0 targets schema 54; use the
current HTTP Agent Kit or a compatible adapter for this Preview candidate.

## 0.5.0 (2026-09-13)

### Drawing and properties

- Place text with a cursor-following preview. Mix stacked fractions with other
  text, with centered numerator/denominator and a bar sized to the wider part.
  New text boxes default to bold, and text alignment uses precise text bounds.
- Edit annotations through live property JSON with inline option menus.
  Rectangles and circles have independent border/fill colors and front/back
  layers; rotation and arrow/line styles have discoverable choices.
- Show transformer and T-Coil coupling and inductance parameters independently.
  Swap Analog Block input and output polarities independently in Properties.
- Use consistent equilateral Analog Block triangles, grid-aligned left edges
  and balanced output leads. Digital gate bodies also align from the left;
  selection frames follow their visible artwork.
- Connect visible component pins crossed by a Power Rail when drawing or
  adjusting that rail.

Project schema 54 adds independent magnetic parameter visibility. Existing
Projects remain importable; some older drawings affected by the new symbol
geometry or pin columns may need manual layout or route repairs.

## 0.4.1 (2026-09-13)

### Agent authoring and simulation results

- Place components with native, attached reference/value annotations and real
  power connections. MCP 0.8.0 adds `set-instance-display` to control visibility
  without duplicate text. Net Labels name their Net and attach to its route.
- See Agent-started Project-folder runs, batches and sweeps in the GUI without
  changing the active folder or stealing focus. Open completed results without
  running the simulation again.
- Automatically preserve verified results in this browser's Saved results.
  Export a Project + results evidence ZIP when a verified input snapshot is
  available. Ordinary Project files remain source-only; browser archives are
  not Cloud Save, and storage failures are reported explicitly.
- Keep selected simulation Run targets explicit, avoid duplicate OP/MOS result
  displays, and use consistent names when placing hierarchical Cells.
- Start from four complete simulation example Projects with explicit replacement
  confirmation and source-aware guidance. Maximize Simulation to reclaim the
  application chrome while preserving editor state on restore.

Project schema 53 and the API 3.0 source-workspace contracts are unchanged.
The independently published MCP adapter advances to 0.8.0; existing pinned
installations must update separately.

## 0.4.0 (2026-09-13)

### Simulation and Agent

- Open the Simulation workspace on the public site to edit saved source
  experiments, run the hosted ngspice/SKY130 environment, inspect results,
  and export data. Qualified analyses include OP, DC, AC, TRAN, and Noise.
- Connect an Agent from the public editor through the existing revocable
  Claim Code workflow. The published MCP 0.7.0 adapter and HTTP Kit use the
  same editing and simulation contracts as the Preview channel.
- Hosted runs use bounded queues and owner-scoped results. Production keeps
  its own queue, records, and artifact store; Preview accounts and Projects
  remain separate. Both channels share the existing operator simulator.

### Properties

- Put Placement, Appearance, and Display first, and keep Netlist name and
  Netlist target together at the end of the property code.
- Show a netlist target name once, with a small arrow for choosing another
  model. Direct JSON editing and copying remain available.

Digital Timing remains unavailable on both hosted channels. Project schema 53
and the independently versioned MCP 0.7.0 distribution are unchanged.

## 0.3.0 (2026-09-13)

### Schematic authoring

- Edit component properties through one code surface, including multi-selection,
  visual variants, and compact color controls. Netlist identity and visual labels
  are presented separately; ordinary text selection remains available.
- Rotate components by 90 degrees with the standard controls. Explicit 45-degree
  orientations remain supported, with connected wires following the chosen
  orientation. Horizontal and vertical mirrors are independent.
- Move selected text and mixed selections together, and copy circuit selections
  between Cells and browser tabs.
- Place depletion NMOS and PMOS variants, resettable D flip-flops, and refined
  switch, amplifier, ADC, and DAC symbols from the component library.
- Preserve supply-marker ownership when editing or opening older projects;
  improve Net Label placement, composite wire landing, and terminal approaches.

### Compatibility and release channels

- The editor, portable host, and release package now report product version
  0.3.0. Project files use schema 53 and retain the supported migration chain.
- Production receives the current core editor. Analog Simulation and Agent
  connection controls remain Preview features; Digital Timing stays disabled
  on both hosted channels. Preview and Production accounts and private Projects
  remain isolated.
- The separately versioned MCP adapter remains at 0.7.0.

## 0.2.0

### Simulation

Analog Canvas is no longer only an editor. A circuit drawn here can now be
simulated without leaving it.

Until this release the product's own description ended with "not a simulator",
and that was accurate: you exported a netlist, went to another tool for the
answer, and came back to edit. The loop that matters most in analog design was
the one loop the product did not close.

**What runs.** A circuit whose every instance resolves to a PDK device model,
hierarchy included. A `.subckt` made of transistors is simulatable, and so is
a subcircuit of subcircuits of transistors.

**What does not.** A circuit containing an abstract block, such as a
signal-flow element or a behavioural amplifier, has no device model behind that
block and is refused. The refusal names the blocks responsible rather than
failing vaguely, so the way forward is visible: replace them with device-level
implementations.

**The testbench is yours.** Analog Canvas supplies the circuit and runs the
simulator. Stimulus, loads, analysis statements, and sweeps come from you. We
ship no templates and infer no intent, because a testbench encodes what you are
trying to prove and guessing it would produce confident answers to questions
you never asked.

**Where it runs.** Simulation runs on a hosted simulator (the same container
image, on a server we operate), which means the circuit netlist is uploaded
to run. If your circuit is not yours to upload, the
local host runs the same simulation on your own machine against your own PDK
version, and returns the same results.

**This release covers DC operating point and AC analysis.** Transient, sweeps,
and corner runs follow once this path is proven.

**A Project remembers its simulation setup.** Which Cell is the testbench,
which analyses and probes to run, and which simulator profile to use are saved
in the Project file beside the circuit (schema 37) and follow save, undo, and
the Gallery like everything else; voltage and current sources gain AC magnitude
and phase fields for the small-signal stimulus, and results themselves are
never saved.

### Drawing

**Move a part without dragging its wires along.** `Shift+M` arms the move and
the next click picks the part up; `Shift+drag` does it with the pointer. This
is the Virtuoso distinction: plain `M` stretches the wires with the part,
`Shift` leaves them where they were. The shortcut panel lists it, because a
capability nobody can find is one that does not exist.

**A dragged wire shows the path it will take.** The preview used to pull a
diagonal out of a wire whose far end stayed put, which is not a shape a
schematic wire can have.

**Wire ends that meet, join.** Dragging a wire so its end lands on another
conductor merges the two into one net, and so does dragging a part until its
pin lands on a wire. A wire that merely crosses another still does not
connect, and no longer complains about it. That distinction is the point: the
end you place deliberately is intent, the crossing is not.

**Arrows point both ways.** An arrow chooses whether its head sits at the end,
at the start, or at both, alongside the existing choice of head style.

### Symbols

**Switches reach their wire in one grid cell.** The leads on the three switch
symbols ran nearly two cells; the bodies are untouched. Two more switches
join the library: a plain-line switch without contact circles, and a
single-pole double-throw. The plain switch carries the double-throw as an
option rather than a sixth tile.

**Amplifiers can carry the letter their stage is named by**, editable per
instance, and ADC and DAC blocks join them with their own editable text. The
two converters sit next to each other in the Library, where alphabetical
order had put four tiles between them.

**The crossed differential amplifier is a state, not a second part.** Its
outputs already swapped from the properties panel, so the separate tile was
a duplicate of a control that existed.

**The comparator's glyph clears its body outline**, which it had been
overlapping by about a stroke width, and the quantizer is square rather than
half again as wide as it is tall.

### Text and labels

**A label with no text no longer sits on the canvas as an invisible target.**
Twenty-eight of the palette's parts had no designator to display, so their
labels rendered empty yet stayed clickable. Parts with nothing to show now
also drop the Reference toggle, which had been switching a thing that was
not there.

**Formatting a net name works.** Applying bold or underline to a bound name
used to be refused, because the name was compiled in a way that dropped
characters and the result no longer matched the name it was bound to. The
compiler now preserves every authored character, which also means underscores
and letter case stay as written rather than being reinterpreted.

**A label attached to something other than a part can be dragged.** A power
rail's label hangs off its junction and a drafting label off its rectangle;
neither could be moved, and the gesture silently did nothing.

### Gallery

**The docked Gallery pages, counts, searches, and filters like the wall
does**, through the same code, so the two cannot answer the same question
differently.

**A withdrawn circuit stays in your recycle bin while it is among your 25
most recent withdrawals.** Nothing expires on a clock, so the card states the
rule rather than naming a removal date it cannot honour.

### Reliability

**A failed deploy rolls itself back.** Post-deploy verification already
checked the live site; when it failed it left the site failing. It now
restores the previous version instead.

**A project saved before a schema change still opens.** The loader accepted
only the two most recent versions, which refused files saved the week before;
it now accepts anything the upgrade chain can carry forward.

**A missing code chunk answers with a refresh rather than a stack trace**, and
a stuck page can get itself unstuck.

### Labels

**A component can wear any label.** A Reference still follows its device
prefix — a resistor is `R…` — because the netlist prints it as the element
token. Typing something else over the Reference label, such as `gm`, no longer
ends in a refusal: the editor offers to keep the Reference for the netlist and
show the typed text as a label in its place. Properties gains a `Label` field
for the same free text on any placed component, including blocks that have no
Reference at all. The label is presentation only; it never reaches the
netlist.

### Unchanged

The electrical model is untouched. Connectivity is still explicit, a crossing
is still not a connection, and wires are still drawing. Simulation reads your
circuit and never writes it: a result cannot alter a net, and nothing about a
simulation is saved into the project file.

Existing project files are unaffected. There is no schema change and no
migration. A file that opened yesterday opens identically today.

See ADR 0055 for the reasoning behind the scope change and the alternatives
weighed against it.

## 0.1.0

The connectivity-aware schematic editor: structural SPICE import, a typed
circuit model persisted as one `.icproj.json` file, formal SVG, PNG, and PDF
export, deterministic SPICE and Spectre design netlists, a published gallery,
and an Agent API that edits the same live project as the human interface.
