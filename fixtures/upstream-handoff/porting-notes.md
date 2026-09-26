# Porting notes: why each feature ended up this shape

The other half of what we promised in
[issue #1003](https://github.com/cascode-ai/analog-canvas/issues/1003). For each
feature your integration plan lists, this records the defects we actually hit
while building it, what caused them, and why the final shape is the answer —
so the port does not rediscover them one by one.

Commit links point at the fork,
[`LXY-freshman/schematic-draft`](https://github.com/LXY-freshman/schematic-draft);
the final reference tree is
[`5231840f`](https://github.com/LXY-freshman/schematic-draft/tree/5231840f31b551f231441976efc0d18e6f9e5f80).
Each section links to the spec that owns the contract rather than restating it.

One thing this document cannot tell you: whether any of these circuits works.
This edition ships no simulator, and nothing here was validated electrically —
the sample files are drawings that were reviewed by eye.

## F1 — Visio export, and the wire in particular

Contract: [`docs/specs/export.md`](../../docs/specs/export.md).

The wire export went through four shapes before it settled, and each step was
forced by something Visio does rather than by anything in the schematic model.
Porting the end state directly is fine; porting the first one is a trap.

1. [`34f268ee`](https://github.com/LXY-freshman/schematic-draft/commit/34f268eeb94d3eeff7637ac6f2513ee83252a01f)
   drew a Document as a page of glued shapes. Wires were Visio's own dynamic
   connectors — `ObjType 2`, `MasterType 541`.
2. [`496fa612`](https://github.com/LXY-freshman/schematic-draft/commit/496fa6125130dd95705997acd423502a9d9f4e57):
   declaring a wire routable hands the path to Visio's routing engine, and the
   engine takes it. Nudging any device made Visio discard the run the schematic
   drew and lay out its own — "the wires jump around the moment you touch
   them". The key finding is that **glue and routability are separable**: the
   `PAR(PNT(…))` formulas, the `<Connect>` records and the `_XFTRIGGER` cells
   all stay exactly as they were, and a wire end still follows its pin. Only
   `ObjType` goes to 1, with `DynFeedback`, `NoLiveDynamics` and
   `ShapeSplittable` removed. The cell must be *written*, not omitted: left
   unset, Visio decides for itself, and a one-dimensional shape glued at both
   ends is precisely what it decides is a connector.
3. [`35803f38`](https://github.com/LXY-freshman/schematic-draft/commit/35803f388b656a9807e5b299caf9c685d1af72c1):
   a one-dimensional Visio shape has exactly two ends a hand can reach, so a
   wire that turned four corners offered two handles and the corners were
   literal offsets inside the shape's geometry, editable only by retyping
   ShapeSheet cells. A Route is now written as a *chain*: `planWireChain` splits
   the centerline into two-point links — one per straight run, one more per hop
   — and each seam is glued to an invisible node shape both neighbouring links
   hold. Where a Junction or a dotted contact already sits on a seam point, the
   chain hangs on that node rather than adding one, so dragging a branch dot
   still takes every wire through it along. Two Routes that merely corner on the
   same point keep separate seams: that is a crossing, not a connection, and the
   export does not invent one.
4. [`593244b2`](https://github.com/LXY-freshman/schematic-draft/commit/593244b2b479fb939ca929a10d953093746770a7):
   the chain's own cost, unnoticed for a release. Each corner is two separate
   strokes meeting at an angle with **no line join between them**, and the wire
   master capped square, so the outside of every angle was left uncovered — a
   square hole half a line weight on a side at every corner and at both feet of
   every hop arc. The fix is to cap the master round: two round caps at a corner
   union into a full disc, and it follows whatever weight the user later sets
   inside Visio, which a drawn-in patch shape would not. Symbol artwork is
   untouched, because a symbol is one shape with one geometry section and its
   corners are line joins already.

**The seam that lets you take this without our schema.** `planWireChain`
([`packages/visio/src/wire-chain.ts`](../../packages/visio/src/wire-chain.ts))
is declared `planWireChain(centerline, jumps = [])` — the hop list defaults to
empty and the module does not import `deriveRouteLineJumps`. Every dependency on
our line-jump and stroke-width fields lives in
[`packages/visio/src/page.ts`](../../packages/visio/src/page.ts): one
`deriveRouteLineJumps` call feeding `planWireChain`, and one
`styleOverride.strokeScale` read that writes a shape-level `LineWeight`. Drop
those and the chain, the glue, the seam nodes and the round cap all still work
on a Project that has never heard of either field.

Two limits worth stating before somebody reports them as bugs. Dragging one end
of a wire moves that end alone, so the last stretch goes diagonal — that is what
a drawn line does, and it is the point. And a Route is `runs + 2 × hops` shapes
rather than one, so the package is larger and selecting a whole wire takes a
rubber band or a few Ctrl-clicks.

## F3 / F4 — line jumps and per-object stroke width

Contracts: [`docs/specs/connectivity-and-routing.md`](../../docs/specs/connectivity-and-routing.md)
and [`docs/specs/project-file-format.md`](../../docs/specs/project-file-format.md).

Both features are **drawing and nothing else**. A jump arc records an intent
about a crossing, never a connection; connectivity stays owned by Net
membership, Junctions and typed terminals. A heavier wire carries no more
current and a heavier symbol is the same device with the same pins. No derived
model, netlist or connectivity fact reads either field.

- [`30ced96b`](https://github.com/LXY-freshman/schematic-draft/commit/30ced96b63710f5be3ae0d9e4bdea10c62d23c19)
  — `lineJump` on `RouteStyleOverrideSchema`, schema 57→58. The non-obvious
  part: `transaction-route-style.ts` decides whether an override is "empty" by
  enumerating its members, so a jump-only override was silently dropped on the
  way through the Edit Engine until that list learned the new key. Any optional
  field added to a `strictObject` override has this same failure mode.
- [`6671e54e`](https://github.com/LXY-freshman/schematic-draft/commit/6671e54ee3fb679fe0e91e9cafa5ea3cf2c94651)
  — the drawing. **Who hops is decided once, in `@icm/derived`, not in a
  renderer**, which is the only way the canvas and an exported drawing can
  agree: the marked Route hops; when both are marked the more horizontal segment
  does, with Route id settling a tie; a collinear overlap never hops; and a
  crossing between two Routes of one Net never hops, because those conductors
  really are connected there and an arc would say otherwise. A hop that will not
  fit clear of both ends of its segment, or that would collide with its
  neighbour, is dropped rather than drawn distorted.
- [`fce5f040`](https://github.com/LXY-freshman/schematic-draft/commit/fce5f0403c2134e27a18f065ca2bb1304050dba3)
  — the control. Unticking deletes the key rather than storing `false`, so a
  Route that wants nothing special carries no `styleOverride` at all.
- [`8ed248ee`](https://github.com/LXY-freshman/schematic-draft/commit/8ed248ee43d15dcb667771685255480123879827)
  — **the bug to expect.** The Net highlight was a separate React overlay
  painting a `<polyline>` from the same centerline, so the blue halo ran
  straight through every arc the wire went around: two painters of one
  centerline that disagreed about its shape. Anything else that redraws a
  route's path independently — a hover halo, a selection outline, a
  print/preview layer — has the same defect waiting. The fix was to export
  `routePathData` from `@icm/render-svg` and let the overlay use it.
- [`7d480ef2`](https://github.com/LXY-freshman/schematic-draft/commit/7d480ef2b95ba9dae6a2df07f3d5f7eedc4b6391)
  — `strokeScale` on Routes and Instances, schema 58→59, composing
  multiplicatively on the document-wide scales. Note that drafting objects had
  carried a free `strokeScale` since before the fork; that one is *not* this
  feature, and its presence does not mean Routes and Instances were covered.
  Visio can honour a scaled wire (a shape-level `LineWeight` cell) but not a
  scaled component, because every instance of one symbol instantiates one shared
  master — so the package raises a dropped-instance-paint caveat.
- [`6e80494b`](https://github.com/LXY-freshman/schematic-draft/commit/6e80494b52e2633b7f86527f1b0d4256cb34bb88)
  — hop radius, schema 59→60. It is deliberately **per document, not per wire**:
  how wide a hop is drawn is a drawing convention that should hold across a
  schematic, while *which* wires hop at all stays the per-wire flag. It is the
  sixth entry in `STYLE_KNOBS`, bounded 0.5–2 like the five beside it, which
  keeps the arc between the wire stroke (1.6) and a grid step (10) at every
  reachable setting. One consequence to document rather than fix: a wider arc
  needs more straight wire around a crossing, so raising the factor can leave a
  crossing near a corner drawn flat.

In all three, absence means the pre-existing default and only absence is stored.
That is what makes the version stamping in this bundle exact, and it is why
every golden in the repository moved by nothing but the `schemaVersion` line at
each bump.

## F5 — the coarse grid

Contract: [`docs/specs/editor-interaction.md`](../../docs/specs/editor-interaction.md).

[`63614d6f`](https://github.com/LXY-freshman/schematic-draft/commit/63614d6f6f28b90db122c6c353a36e652b8c8ab6)
draws every seventh fine dot larger and darker, cycling Grid Off → Grid On →
Grid On · Coarse. Both patterns tile in the same user space anchored on the same
origin, so a coarse dot always lands exactly on a fine one and panning cannot
drift them apart. Drawing the larger dot exposed a defect that had been
invisible for the whole life of the fine one: each dot was centred on the
*corner* of its tile, so three quarters of it fell outside and only a quarter
was ever painted — unnoticeable at r=0.7, an obvious wedge at r=1.5. Both tiles
are now offset by their own radius.

[`d08705e0`](https://github.com/LXY-freshman/schematic-draft/commit/d08705e057b45b7bda05fec787af3a6609ac7fda)
is the one to read before porting anything grid-shaped. The canvas fits the
camera inside the panel undistorted, so a window whose aspect differs from the
camera's shows more of the drawing than the camera asked for. The grid dots and
**the input planes** were sized to the camera rect, which in such a window is
the middle of the panel: the dots stopped in a band either side of the drawing,
and that band was not merely undotted — the layer the pointer draws on ended
with them, so a click there placed nothing and started no wire. Maximised on a
wide screen that band was 620px on each side. The fix sizes every
`[data-camera-bounds]` layer to the rect the panel actually shows while keeping
the `viewBox` the plain camera, re-lays-out on resize, states the
`preserveAspectRatio` the arithmetic depends on, and refuses to cache a panel
measured before layout — because the gesture code reads the same cache and would
otherwise map the pointer through a zero-size rect.

This was never a coarse-grid regression: the camera runtime was unchanged since
the fork point and the release before sized the same rects the same wrong way.
The coarse dots only made it visible. If your camera code shares that ancestry,
you may already have the bug.

## F6 — the MOS body variant

Contract: [`docs/specs/symbol-dsl.md`](../../docs/specs/symbol-dsl.md).

[`f6732d98`](https://github.com/LXY-freshman/schematic-draft/commit/f6732d9829eeaa0295bba39fe75562c23306159d)
adds an Appearance switch between the three- and four-terminal drawings. Every
MOS already carried B as a fourth terminal; only the artwork left it out. B is a
declared pin of the same Symbol in both drawings — an auxiliary pin in the
three-terminal one — so pin order, the netlist projection and existing
connections are identical either way. Only the anchor B routes to moves, from
`(-4,0)` to `(20,0)`, which stretches a wire already on the body. The test that
pins this exports the same document through `analyzeDesignNetlist` +
`printSpiceNetlist` across the switch and requires byte-identical output.

The one thing that did not work as designed: the switch was meant to be
`textbook-3terminal` ↔ undefined, but the resolver falls back to
`definition.defaultVariantId`, so clearing the variant reproduces the
three-terminal drawing rather than the base artwork. All six MOS definitions
therefore needed an explicit `four-terminal` variant that hides nothing.

Two artwork defects followed, both only visible in the four-terminal drawing —
which is why sample
[`09-four-terminal-mos.v60`](09-four-terminal-mos.v60.schdraft) exists and why
its reviewer drew both body ties out by hand:

- Selecting the variant used to move the transistor's only triangle out to the
  body pin, 24 units from the channel, so the arrowhead read as a mark on the
  bulk wire rather than as the device's polarity, and the channel bar was left
  bare
  ([`b3f5773b`](https://github.com/LXY-freshman/schematic-draft/commit/b3f5773b995b98d15a0d583e28fc9ff5ddf5d6f4)).
  The source arrow now stays beside the channel and the body is one unmarked
  lead, so the two variants differ by exactly one thing.
- The depletion parts inherit the enhancement MOS's body lead, which runs from
  the gate-side channel edge out to B — straight through the middle of the solid
  channel bar that is the whole point of a depletion symbol, crossing it at
  right angles so the bar reads as cut in two
  ([`5e926c00`](https://github.com/LXY-freshman/schematic-draft/commit/5e926c004799a61e8e48a312feb2c16de43ffbac)).
  The lead now starts on the mark's centre line instead of behind it, which is
  also what it means: the body belongs to the channel.

## F7 — the power devices

Contracts: [`docs/specs/symbol-dsl.md`](../../docs/specs/symbol-dsl.md) and
[`packages/components/README.md`](../../packages/components/README.md).

[`4afcc1d2`](https://github.com/LXY-freshman/schematic-draft/commit/4afcc1d2c1b2c2a50d0efadf943a0939df1c7d27)
adds E-GaN, D-GaN and IGBT. The decisions worth inheriting:

- Both GaN HEMTs carry D/G/S and **no bulk terminal**, because a GaN HEMT has no
  body diode and copying `mosBulkClass` across would have claimed one.
- All three declare `deviceClass: "switch"` with `targetPolicy: "none"`. The
  alternatives were both dishonest: `"mos"` is rejected by the descriptor
  validator unless it declares a bulk class, and `"bjt"` would send the IGBT
  through `netlistDeviceFamily()` as an NPN and hand it sky130 NPN model
  targets. `"none"` makes extraction report `NON_NETLISTABLE_DEVICE` rather than
  print a card with nothing where the model name belongs. An instance bound to a
  vendor `.subckt` still netlists, because extraction dispatches an
  `external-subcircuit` binding ahead of the device path.
- Artwork is hand-drawn on the 10-unit connection grid, because the Razavi
  reference manifest holds no evidence for any of these parts.

Then [`b3f5773b`](https://github.com/LXY-freshman/schematic-draft/commit/b3f5773b995b98d15a0d583e28fc9ff5ddf5d6f4)
fixed three defects from issue #33, two of which are portable lessons:

- An IGBT is a MOS gate on a bipolar output, so its terminals are a gate with a
  collector and an emitter. That answers to neither transistor predicate the
  default label placement knows, and a symbol that answers to none of them falls
  through to "label under the symbol" — directly under the emitter lead, where
  the designator reads as belonging to whatever the emitter is wired to. **If
  your label placement dispatches on device family, check what a new family
  falls through to.**
- An eGaN HEMT is normally-off: it has no channel until the gate induces one,
  and the symbol says so with three separated channel segments. Ours drew two,
  which is not a convention for anything.

**Do not "fix" the D-GaN or the IGBT channel bar.** A continuous bar is correct
for a normally-on device, and it is exactly the distinction the eGaN/dGaN pair
exists to make. The two symbols now differ by precisely that, and a test asserts
both sides of it.

Sample [`08-power-devices.v60`](08-power-devices.v60.schdraft) places all of
these. It is a drawing, reviewed by eye; it is not a claim that the half bridge
would work.

## F8 — AGND and DGND

Contracts: [`docs/specs/netlist-export.md`](../../docs/specs/netlist-export.md)
and [`docs/specs/schematic-model.md`](../../docs/specs/schematic-model.md).

[`d8c8c00b`](https://github.com/LXY-freshman/schematic-draft/commit/d8c8c00b0a73e30212a3ed7a8c856aa136e2fcc3).
The electrical rule first, because it is the part that matters:
**Ground keeps SPICE node `0` to itself. AGND and DGND are ordinary global rails
named AGND and DGND**, which the SPICE printer declares `.global` like any
other. They are markers, not devices — `net-marker`, null reference prefix,
`targetPolicy: "none"` — so each prints no card, takes no designator, and the
Net name underneath it is its entire electrical content. The one unambiguous
mistake, a ground glyph on a VDD Net, is a new `INVALID_NET_MARKER`. VDD Port's
stricter "must be explicitly classified" rule was deliberately *not* copied to
them: it would abort a whole netlist because a rail was named by a label instead
of a claim.

The structural lesson: eight sites across model, derived, edit-engine, netlist
and the editor spelled out `symbolId === "ground" || symbolId === "vdd-port"` by
hand, and every one would have had to learn two more ids. They now read one
table,
[`packages/model/src/power-marker.ts`](../../packages/model/src/power-marker.ts)
— pin name, default Net name, domain, scope, and whether the marker is its
domain's canonical node. Model is the right home because the document schema
already hard-coded the pair and every other package depends on model. The
`canonical` flag is what lets Ground's node-`0` strictness and the clipboard's
per-domain body default read from one place instead of two more id checks. The
two `project-protocol/src/transforms/` sites stay hard-coded on purpose: a
migration describes historical data, and these symbols never appeared in an
older file.

That consolidation also surfaced a latent bug: `derived/visual.ts` tested for
symbol id `"vdd"` — an id that does not exist, the real one being `vdd-port` —
so the symbol-overlap diagnostic was never suppressed for a VDD Power marker
sitting exactly on a pin. **Worth grepping for on your side**, since that check
predates the fork.

If you port this, note what sample
[`07-split-grounds.v60`](07-split-grounds.v60.schdraft) actually shows: the
glyphs differ, but only the *names* say which rail is which. A Net has no name
field — `NetSchema` is `{ id, terminals }` — so the names live in `name-claim`
entries under `connectivityEvidence`. Without those claims, AGND and DGND are
two anonymous Nets wearing different hats.
