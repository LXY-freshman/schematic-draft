# Formal Export

Status: `accepted`

Primary owners: `packages/render-svg`, `packages/exporters`, `packages/visio`

Related ADR: [`routing.md`](../adr/routing.md).
Formal export consumes the resolved route geometry (centerline + endpoint joins)
and, as today, excludes editor overlays, flightlines, selection, and
diagnostics.

## Contract

Every export starts from one validated `SchematicDocument` and one symbol
resolver. The picture formats then go through the formal SVG scene; the Visio
formats do not, because a flat scene has no shapes, pins or glue targets left
to join. Editor overlays, hit targets, selections, flightlines, and diagnostics
are never part of a formal artifact.

| Format | Derivation                                  | Media type                         |
| ------ | ------------------------------------------- | ---------------------------------- |
| SVG    | canonical formal scene                      | `image/svg+xml`                    |
| PNG    | white-background raster of that SVG at 3x   | `image/png`                        |
| PDF    | browser: formal SVG converted to vector PDF | `application/pdf`                  |
| VSDX   | Document re-projected as Visio shapes       | `application/vnd.ms-visio.drawing` |
| VSSX   | the same symbol masters, with no page       | `application/vnd.ms-visio.stencil` |

The SVG viewBox is the authoritative page bound. Browser PDF export converts
that same curated, renderer-generated SVG through `svg2pdf.js` into PDF paths
and text; it never embeds the page-cover PNG used by the PNG artifact. The
original SVG is unchanged. Export filenames are normalized; every artifact takes
the Project's name as its base, except the stencil, which is the same symbol
library whatever Project is open and is named after the library instead.

Canonical SVG resolves script typography before serialization: subscript and
superscript runs use numeric font sizes and explicit baseline displacement,
and the next visible run restores the parent baseline. Formal SVG must not
delegate script placement to `baseline-shift` or percentage `font-size`, whose
support is inconsistent in Office-class SVG importers. This keeps searchable,
editable SVG text while making its geometry portable beyond browser engines.

The browser PDF converter still operates on a temporary SVG clone. It
materializes text decorations as vector strokes and defensively expands any
legacy relative text constructs before conversion. This compatibility pass
must not rewrite the downloaded canonical SVG or flatten PDF text into a page
image.

Node/headless export retains a high-resolution raster-PDF fallback for release
tooling because the browser vector converter requires a live DOM. It is not the
interactive editor's user-facing PDF path.

If vector conversion fails, browser export fails visibly; it must not silently
downgrade the requested PDF to a bitmap. SVG remains the portable vector
fallback.

## Visio fidelity

The Visio formats exist so a drawing can be _edited_ in Visio, not looked at, so
what they owe the user is different from what a picture owes. A `.vsdx` is
written locally, needs no Visio installed to produce, and re-exports to the same
bytes from the same Document.

Promised:

- **Topology.** One shape per placed Instance, backed by a master keyed by
  symbol and variant; one one-dimensional line shape per Route; one shape
  per visible Junction. Shape counts equal object counts.
- **Glue.** A wire end that lands on a pin is glued to that pin's connection
  point, through a `PAR(PNT(…))` formula and a matching `<Connect>` record.
  Moving a device in Visio moves the wire ends with it. Every `<Connect>` names
  a connection row that exists.
- **The path.** A wire is a drawn line segment, explicitly marked non-routable,
  so Visio never recomputes the run it was given: the bends are the ones the
  schematic drew and they stay put for as long as nobody drags them. Glue and
  routing are separate things — an end follows its pin because the shape is
  one-dimensional and glued, not because Visio is routing it.
- **Shape Data.** Reference designator, symbol name, device parameters, the
  owning Cell, and `icm:instanceId`; net name on a wire.
- **Grid.** Ten document units are 0.125 in, so pin pitch lands on Visio's
  classic eighth-inch grid, which the page grid is set to. The y axis is
  flipped, because Visio's origin is bottom-left.
- **Text that belongs to a shape** — reference, parameters — is the shape's own
  text, so it travels with the shape rather than being left behind.

Not promised, and not a defect when it happens:

- **Text metrics.** Visio measures, wraps and substitutes fonts itself, so a
  label sits a fraction of a character from where the schematic put it. Its
  position relative to the device is still right.
- **Right angles after a device moves.** Dragging one end of a wire drags that
  end and nothing else, so the last segment becomes a diagonal. That is what a
  line segment does, and it is the price of Visio never rearranging the run on
  its own; straightening it is the user's move to make.
- **Formulas.** A math run is written as its source text, a stacked fraction is
  flattened onto one line, and an overbar rule is dropped. The text is editable;
  the typesetting is not reproduced.
- **Marks that stay upright.** Polarity marks and the like are baked at the
  orientation the Instance was placed in. Rotating that shape inside Visio turns
  the mark with it, where the schematic would have kept it upright.
- **Pin names** drawn by a symbol are left off the master.
- **Annotation ornaments** — voltage polarity marks, current arrowheads, the
  global-net badge — are not drawn; the annotation's text is.
- **Hierarchy.** Only the open Document is exported. Cells do not become pages.
- **The return trip.** Nothing reads a `.vsdx` back. The `.icproj.json` the user
  opened stays the authoritative Project, and an edit made in Visio stays in
  Visio.

Every loss above is counted by kind and named in the export's status line, so it
is stated when the file is written rather than discovered in Visio.

## Validation

- parse the SVG viewBox and reject invalid bounds;
- check PNG signature and dimensions against viewBox times scale;
- reopen browser PDF, check one page and page bounds, assert it contains no
  page-cover image XObject, assert representative rich-text runs retain their
  nonzero scaled fonts and displaced baselines, and visually compare a rendered
  PDF page with the SVG fixture;
- assert canonical formal SVG contains no `baseline-shift` or percentage
  `font-size`, and that a visible run following a script restores its parent
  baseline;
- assert formal SVG has no editor-only layers;
- unpack the `.vsdx` and assert the OPC parts, the Visio 2012 namespace, that
  every shape names a master that exists, and that every `<Connect>` resolves to
  a declared connection row;
- pin the dense-analog Visio export as a golden. The package's own bytes are
  hashed, and its parts are written out beside it under `vsdx/`, one element per
  line, so a change to geometry, glue or Shape Data reads as a diff instead of a
  new zip hash. The manifest hashes the packed part rather than that rendering,
  and records the page size, the master count, the shape and glue counts, and
  the caveats by kind;
- open the file in Visio itself and read back page, shape, connect and master
  counts, then move a glued device and check that its wire ends followed and
  that none of their paths were rewritten — `scripts/visio-open-check.ps1` with
  `-GlueTest`. Only opening it proves Visio accepts the package, and only the
  move separates a recorded `<Connect>` from a live glue, or a drawn segment
  from a connector Visio feels free to re-route.

## Delivery

Every artifact is produced in the renderer and handed to the user through a
local blob download or, for Project JSON, through the desktop file bridge.
Nothing is uploaded, and no export path contacts a network service. Project
text always comes from `serializeProject()` byte-for-byte; the picture formats
always derive from the same formal SVG scene, and the Visio formats from the
same Document. Selection, diagnostics, flightlines, and editor overlays never
enter a formal artifact.
