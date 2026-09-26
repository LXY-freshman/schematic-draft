/**
 * Build the frozen Project samples handed to the Analog Canvas upstream so
 * their Schematic Draft reader has real bytes to work against (issue #1003,
 * their `03-integration-plan.md` §4 and `02-target-architecture.md` §7).
 *
 * Every circuit here is a synthetic textbook topology. No real design work
 * appears in these files; confidentiality is the whole reason this fork exists.
 *
 * The generator runs in two phases with the author in between:
 *
 *   --drafts    Write every sample at the current schema version, so the real
 *               Windows shell can open all of them, and copy them into the
 *               Windows Projects folder for review. Drafts are not committed.
 *
 *   --finalize  Read the corrected bytes back, check the declared extension
 *               fields against what is actually in them, run ERC, stamp the
 *               historical schema version each sample is meant to carry,
 *               render the previews and write the manifest.
 *
 * Stamping a historical version onto current output is exact rather than
 * approximate: 57→58, 58→59 and 59→60 are all pure version bumps (see
 * `packages/project-protocol/src/transforms/`), and all three fork features
 * are optional fields whose absence means the default. The same fact is why
 * the review loop works at all — the app saves version 60 and the number is
 * stamped last.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

import {
  CURRENT_PROJECT_SCHEMA_VERSION,
  CircuitProjectSchema,
  createEmptyProject,
  createRoutePath,
  deriveStableId,
  powerMarkerContract,
  routeEnd,
} from "../packages/model/dist/index.js";
import {
  serializeProject,
  tryParseProjectWithMetadata,
} from "../packages/project-protocol/dist/index.js";
import {
  buildProjectConnectivityIndex,
  defaultInstanceLabelPlacement,
  defaultVddPowerLabelPlacement,
  displayableInstanceValue,
  placeUprightInstanceLabel,
  resolveDocumentStyleProfile,
  resolveEndpointConnection,
  runErcChecks,
  visibleSymbolInkBounds,
} from "../packages/derived/dist/index.js";
import { renderDocumentSvg } from "../packages/render-svg/dist/index.js";
import {
  InMemorySymbolResolver,
  builtInSymbols,
  createProjectHierarchicalSymbols,
  hierarchicalSymbolId,
} from "../packages/symbols/dist/index.js";

const OUTPUT_DIRECTORY = "fixtures/upstream-handoff";
const WINDOWS_REVIEW_DIRECTORY =
  "/mnt/d/AI/Claude/schematic-draft/Schematic Draft/Projects";

/**
 * The persisted paths the three fork-only features occupy. A sample declares
 * which of these it uses; `--finalize` refuses to write a manifest whose
 * declaration disagrees with the bytes, so a slip during hand review cannot
 * ship a false claim. `drafting.objects[].strokeScale` predates schema 59 and
 * is deliberately not on this list.
 */
const EXTENSION_FIELD_PATHS = {
  routeLineJump: "documents[].routes[].styleOverride.lineJump",
  routeStrokeScale: "documents[].routes[].styleOverride.strokeScale",
  instanceStrokeScale: "documents[].instances[].styleOverride.strokeScale",
  lineJumpRadiusScale:
    "documents[].presentation.styleOverrides.lineJumpRadiusScale",
};

const RAZAVI_PRESENTATION = {
  styleProfileId: "razavi-textbook-v1",
  grid: 10,
  compactness: "normal",
  flow: { power: "top", ground: "bottom", input: "left", output: "right" },
};

function presentation(styleOverrides, cellSymbol) {
  return {
    ...RAZAVI_PRESENTATION,
    ...(styleOverrides ? { styleOverrides } : {}),
    ...(cellSymbol ? { cellSymbol } : {}),
  };
}

/**
 * A drawn, designated device with no netlist target. This is the honest state
 * for a synthetic sample: the fork runs no simulator, and inventing model or
 * vendor-subcircuit names would put fabricated data in a file we are asking
 * someone else to treat as evidence.
 */
function device(id, symbolId, x, y, options = {}) {
  return {
    id,
    symbolId,
    ...(options.variant ? { symbolVariantId: options.variant } : {}),
    ...(options.bulkNetId
      ? { mosBulkBinding: { origin: "cell-default", netId: options.bulkNetId } }
      : {}),
    placement: {
      position: { x, y },
      rotation: options.rotation ?? 0,
      mirror: options.mirror ?? "none",
    },
    reference: id,
    ...(options.styleScale
      ? { styleOverride: { strokeScale: options.styleScale } }
      : {}),
  };
}

/** A passive whose value is part of the schematic rather than a PDK model. */
function passive(id, symbolId, deviceClass, value, x, y, options = {}) {
  return {
    ...device(id, symbolId, x, y, options),
    netlist: {
      binding: { kind: "primitive", deviceClass },
      parameters: { value },
    },
  };
}

/** A Port, power marker or other glyph: no reference, no netlist card. */
function marker(id, symbolId, x, y, rotation = 0) {
  return {
    id,
    symbolId,
    placement: { position: { x, y }, rotation, mirror: "none" },
  };
}

function net(id, ...terminals) {
  return {
    id,
    terminals: terminals.map((spec) => {
      const split = spec.lastIndexOf(".");
      return {
        instanceId: spec.slice(0, split),
        pinName: spec.slice(split + 1),
      };
    }),
  };
}

function endpoint(spec) {
  if (spec.startsWith("@")) {
    return { kind: "junction", junctionId: spec.slice(1) };
  }
  const split = spec.lastIndexOf(".");
  return {
    kind: "terminal",
    instanceId: spec.slice(0, split),
    pinName: spec.slice(split + 1),
  };
}

function junction(id, netId, x, y) {
  return { id, netId, position: { x, y }, role: "branch" };
}

/**
 * Corner preference for wires whose two pins escape along the same axis, or
 * whose default corner would land inside a symbol body. Keyed by Route id
 * because the shape is authoring intent and has nowhere to live in the model.
 */
const ROUTE_SHAPES = new Map();

/**
 * Supply Net names that differ from the marker's default claim, keyed
 * `documentId/netId`. A VDD Power marker on a rail the schematic calls `VBUS`
 * is a rename the shell supports, and the sample should read the way the
 * circuit is actually named rather than the way the glyph defaults.
 */
const POWER_NET_NAMES = new Map();

/**
 * Net Labels the author placed by hand, keyed by document id. A ground glyph
 * carries no text of its own, and the shell only auto-labels the VDD domain
 * (`use-component-placement.ts`), so a schematic whose whole subject is "which
 * ground is this" needs the same Net Label a user would draw.
 */
const NET_LABELS = new Map();

/**
 * Wires are declared as bare endpoint pairs; `orthogonalize` below inserts the
 * corners once the whole Project exists and pin geometry can be resolved.
 */
function wires(documentId, specs) {
  return specs.map(([netId, from, to, options = {}], index) => {
    const id = `route-${documentId}-${index}`;
    if (options.shape) ROUTE_SHAPES.set(id, options.shape);
    return createRoutePath({
      id,
      netId,
      start: endpoint(from),
      end: endpoint(to),
      bends: [],
      modes: ["manual"],
      ...(options.style ? { styleOverride: options.style } : {}),
    });
  });
}

function terminal(name, netId, portInstanceId, direction = "passive") {
  return {
    id: `cell-terminal-${name.toLowerCase()}`,
    name,
    netId,
    direction,
    interfaceInstanceIds: [portInstanceId],
  };
}

function documentOf(input) {
  for (const [netId, name] of Object.entries(input.powerNames ?? {})) {
    POWER_NET_NAMES.set(`${input.id}/${netId}`, name);
  }
  if (input.netLabels) NET_LABELS.set(input.id, input.netLabels);
  return {
    id: input.id,
    name: input.name,
    revision: 0,
    sourceStatus: "in-sync",
    netlist: {
      name: input.cellName,
      terminals: input.terminals ?? [],
      formalParameters: [],
    },
    instances: input.instances,
    nets: input.nets,
    connectivityEvidence: [],
    routes: wires(input.id, input.wires ?? []),
    junctions: (input.junctions ?? []).map((spec) => junction(...spec)),
    annotations: [],
    presentation: presentation(input.styleOverrides, input.cellSymbol),
    ...(input.mosBulkDefaults
      ? { mosBulkDefaults: input.mosBulkDefaults }
      : {}),
    layoutGroups: [],
    constraints: [],
    noConnects: [],
    drafting: { objects: [] },
  };
}

function projectOf(id, name, documents, topDocumentId) {
  return annotate(
    orthogonalize(
      CircuitProjectSchema.parse({
        schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
        id,
        name,
        source: {
          entry: null,
          dialect: "none",
          sourcePolicy: "copy",
          files: [],
        },
        symbolLibrary: {
          id: "razavi-symbols",
          version: "1",
          hash: "razavi-reference-v1",
        },
        structureRevision: 0,
        topDocumentId: topDocumentId ?? documents[0].id,
        documents,
        simulationFolders: [],
      }),
    ),
  );
}

// --- Right-angle wire geometry ----------------------------------------------

/**
 * Give every Route explicit corners.
 *
 * A resolved centerline is literally `[contact, ...bends, contact]`
 * (`packages/derived/src/resolved-route-geometry.ts`): `SegmentMode` is
 * metadata and nothing orthogonalizes a bend-free leg, so two pins that share
 * neither an x nor a y would be joined by a diagonal. Schematic wires are
 * orthogonal, so the corners are computed here rather than left for the review
 * pass to drag into shape by hand.
 *
 * Corners follow each pin's own escape direction, which is what
 * `compileWireDraft` in `packages/edit-engine/src/routing-planner.ts` does when
 * the user draws a wire in the shell.
 */
function orthogonalize(project) {
  const resolver = sampleResolver(project);
  return CircuitProjectSchema.parse({
    ...project,
    documents: project.documents.map((document) => ({
      ...document,
      routes: document.routes.map((route) =>
        orthogonalRoute(document, resolver, route),
      ),
    })),
  });
}

function orthogonalRoute(document, resolver, route) {
  const end = routeEnd(route);
  const from = resolveEndpointConnection(document, resolver, route.start);
  const to = resolveEndpointConnection(document, resolver, end);
  if (!from || !to) {
    throw new Error(`Route ${route.id} has an endpoint that does not resolve`);
  }
  const grid = document.presentation.grid;
  const fromLanding = from.gridLanding ?? from.contactPoint;
  const toLanding = to.gridLanding ?? to.contactPoint;
  // Mirrors `appendAuthored` in `compileWireDraft`: a pin-to-landing stub is an
  // escape, everything the generator decided is authored wire, and a corner
  // that lands on the previous point contributes no leg at all.
  const path = [{ point: from.contactPoint, mode: null }];
  const push = (point, mode) => {
    const previous = path.at(-1).point;
    if (previous.x === point.x && previous.y === point.y) return;
    path.push({ point, mode });
  };
  push(fromLanding, "escape");
  for (const corner of orthogonalCorners(
    fromLanding,
    toLanding,
    from.outward,
    to.outward,
    grid,
    ROUTE_SHAPES.get(route.id),
  )) {
    push(corner, "manual");
  }
  push(toLanding, "manual");
  push(to.contactPoint, "escape");
  const bends = path.slice(1, -1).map((step) => step.point);
  if (path.length < 2) {
    throw new Error(`Route ${route.id} joins two pins that already touch`);
  }
  for (const bend of bends) {
    if (bend.x % grid !== 0 || bend.y % grid !== 0) {
      throw new Error(
        `Route ${route.id} wants an off-grid bend at ${bend.x},${bend.y}`,
      );
    }
  }
  for (let index = 1; index < path.length; index += 1) {
    const previous = path[index - 1].point;
    const current = path[index].point;
    if (previous.x !== current.x && previous.y !== current.y) {
      throw new Error(
        `Route ${route.id} has a diagonal leg ${previous.x},${previous.y} → ${current.x},${current.y}`,
      );
    }
  }
  return createRoutePath({
    id: route.id,
    netId: route.netId,
    start: route.start,
    end,
    bends,
    modes: path.slice(1).map((step) => step.mode),
    ...(route.presentation ? { presentation: route.presentation } : {}),
    ...(route.styleOverride ? { styleOverride: route.styleOverride } : {}),
  });
}

function orthogonalCorners(from, to, fromOutward, toOutward, grid, shape) {
  // An explicit corner list is the only way to steer a wire around a body that
  // sits between its two pins, so it wins even when the pins do share an axis.
  if (Array.isArray(shape)) return shape.map(([x, y]) => ({ x, y }));
  if (from.x === to.x || from.y === to.y) return [];
  if (shape === "hv") return [{ x: to.x, y: from.y }];
  if (shape === "vh") return [{ x: from.x, y: to.y }];
  const axisOf = (outward) =>
    outward === null || (outward.x === 0 && outward.y === 0)
      ? null
      : Math.abs(outward.x) > Math.abs(outward.y)
        ? "horizontal"
        : "vertical";
  const other = (axis) => (axis === "horizontal" ? "vertical" : "horizontal");
  let fromAxis = axisOf(fromOutward);
  let toAxis = axisOf(toOutward);
  // A junction has no escape direction of its own; let the pin at the far end
  // pick, and default to leaving horizontally when neither end constrains it.
  fromAxis ??= toAxis ? other(toAxis) : "horizontal";
  toAxis ??= other(fromAxis);
  if (fromAxis === "horizontal" && toAxis === "vertical") {
    return [{ x: to.x, y: from.y }];
  }
  if (fromAxis === "vertical" && toAxis === "horizontal") {
    return [{ x: from.x, y: to.y }];
  }
  const snap = (value) => Math.round(value / grid) * grid;
  if (fromAxis === "horizontal") {
    const middle = snap((from.x + to.x) / 2);
    return [
      { x: middle, y: from.y },
      { x: middle, y: to.y },
    ];
  }
  const middle = snap((from.y + to.y) / 2);
  return [
    { x: from.x, y: middle },
    { x: to.x, y: middle },
  ];
}

// --- Labels and supply-name evidence ----------------------------------------

/**
 * Give every sample the visual and naming layer a hand-drawn file carries.
 *
 * Reference designators, values, Port names and the supply label are all
 * Annotations bound to the objects they describe, and a Net's *name* is not a
 * field on the Net at all: `NetSchema` is `{ id, terminals }`, so the name lives
 * in a `name-claim` under `connectivityEvidence`
 * (`packages/derived/src/logical-net.ts`). Authoring them here rather than
 * leaving both lists empty is what makes `07-split-grounds` mean anything —
 * without the claims, AGND and DGND are two anonymous Nets that merely happen
 * to wear different glyphs.
 *
 * The factories are deliberately the same ones the shell uses on insert
 * (`defaultInstanceLabelPlacement`, `defaultVddPowerLabelPlacement`,
 * `powerMarkerContract`, `deriveStableId`), so the review pass in the real
 * window sees labels where it would have put them itself.
 */
function annotate(project) {
  const resolver = sampleResolver(project);
  return CircuitProjectSchema.parse({
    ...project,
    documents: project.documents.map((document) =>
      annotateDocument(document, resolver),
    ),
  });
}

function annotateDocument(document, resolver) {
  const profile = resolveDocumentStyleProfile(document.presentation);
  const grid = document.presentation.grid;
  const annotations = [];
  const evidence = [];
  for (const instance of document.instances) {
    const resolved = resolver.resolve(
      instance.symbolId,
      instance.symbolVariantId,
    );
    if (!resolved) {
      throw new Error(`Instance ${instance.id} resolves to no Symbol`);
    }
    const power = powerMarkerContract(instance.symbolId);
    if (power) {
      const net = netOfPin(document, instance.id, power.pinName);
      evidence.push({
        id: deriveStableId(
          "connectivity-evidence",
          "marker-ownership",
          document.id,
          instance.id,
        ),
        kind: "name-claim",
        netId: net.id,
        name: POWER_NET_NAMES.get(`${document.id}/${net.id}`) ?? power.name,
        scope: power.scope,
        powerDomain: power.domain,
        owner: { kind: "power-marker", objectId: instance.id },
      });
      // Only the VDD marker carries visible text: `use-component-placement.ts`
      // adds a `power-label` for the `vdd` domain alone, because a ground glyph
      // is already unambiguous on sight.
      if (power.domain === "vdd") {
        const placement = defaultVddPowerLabelPlacement(
          instance,
          resolved,
          grid,
        );
        if (placement) {
          annotations.push({
            id: `power-label-${instance.id.toLowerCase()}`,
            kind: "power-label",
            binding: { kind: "net-name", netId: net.id },
            netId: net.id,
            anchor: objectAnchor(instance, placement.position),
            alignment: placement.alignment,
            rotation: 0,
            locked: false,
          });
        }
      }
      continue;
    }
    const formalTerminal = (document.netlist?.terminals ?? []).find(
      (terminal) => terminal.interfaceInstanceIds.includes(instance.id),
    );
    if (resolved.definition.labelVisibility !== "hidden") {
      const placement = defaultInstanceLabelPlacement(
        instance,
        resolved,
        profile,
        grid,
        "reference",
      );
      const binding = formalTerminal
        ? { kind: "cell-terminal-name", terminalId: formalTerminal.id }
        : instance.reference
          ? { kind: "instance-reference", instanceId: instance.id }
          : null;
      if (placement && binding) {
        annotations.push({
          id: `instance-label-${instance.id}`,
          kind: "instance-label",
          binding,
          anchor: objectAnchor(instance, placement.position),
          alignment: placement.alignment,
          rotation: 0,
          locked: false,
        });
      }
    }
    if (displayableInstanceValue(instance).kind === "displayable") {
      const placement = valueLabelPlacement(instance, resolved, profile, grid);
      if (placement) {
        annotations.push({
          id: `instance-value-${instance.id}`,
          kind: "instance-value",
          binding: { kind: "instance-value", instanceId: instance.id },
          anchor: objectAnchor(instance, placement.position),
          alignment: placement.alignment,
          rotation: 0,
          locked: false,
        });
      }
    }
  }
  for (const [netId, anchorId, dx, dy] of NET_LABELS.get(document.id) ?? []) {
    const anchorInstance = document.instances.find(
      (candidate) => candidate.id === anchorId,
    );
    if (!anchorInstance)
      throw new Error(`Net Label anchor ${anchorId} missing`);
    const position = {
      x: anchorInstance.placement.position.x + dx,
      y: anchorInstance.placement.position.y + dy,
    };
    annotations.push({
      id: `net-label-${netId}`,
      kind: "net-label",
      binding: { kind: "net-name", netId },
      netId,
      anchor: objectAnchor(anchorInstance, position),
      alignment: "start",
      rotation: 0,
      locked: false,
    });
  }
  return { ...document, annotations, connectivityEvidence: evidence };
}

function objectAnchor(instance, position) {
  return {
    kind: "object",
    objectId: instance.id,
    localOffset: {
      x: position.x - instance.placement.position.x,
      y: position.y - instance.placement.position.y,
    },
    fallbackPosition: position,
  };
}

/**
 * Put a device's value on the far side of its body from the reference.
 *
 * The default value slot is "one text row below the reference"
 * (`placeUprightInstanceLabel`), which is right while the reference sits beside
 * the body and wrong once a quarter turn has moved it above: the row then
 * marches down into the symbol and its wire. A horizontal resistor labelled
 * `R1` above and `10k` below is the drawing every textbook uses, so when the
 * reference lands centred over the body the value is placed against the
 * opposite edge instead of stacked under it.
 */
function valueLabelPlacement(instance, resolved, profile, grid) {
  const stacked = defaultInstanceLabelPlacement(
    instance,
    resolved,
    profile,
    grid,
    "value",
  );
  if (!stacked || stacked.alignment !== "middle") return stacked;
  const bounds = visibleSymbolInkBounds(
    resolved,
    instance.signalFlowParameters,
  );
  return (
    placeUprightInstanceLabel(
      instance,
      resolved,
      profile,
      {
        x: bounds.x - grid,
        y:
          bounds.y +
          bounds.height / 2 +
          profile.typography.instanceFontSize * 0.35,
      },
      "left",
      grid,
      1,
      0,
    ) ?? stacked
  );
}

function netOfPin(document, instanceId, pinName) {
  const net = document.nets.find((candidate) =>
    candidate.terminals.some(
      (terminal) =>
        terminal.instanceId === instanceId && terminal.pinName === pinName,
    ),
  );
  if (!net) {
    throw new Error(`${instanceId}.${pinName} joins no Net`);
  }
  return net;
}

// --- 01: RC low-pass, the control sample with no fork fields at all ---------

function rcDivider() {
  return projectOf("handoff-rc-divider", "RC Low-Pass", [
    documentOf({
      id: "document-rc",
      name: "RC Low-Pass",
      cellName: "rc_lowpass",
      instances: [
        marker("PIN", "port", 60, 200),
        passive("R1", "resistor", "resistor", "10k", 180, 200, {
          rotation: 270,
        }),
        passive("C1", "capacitor", "capacitor", "1n", 300, 270),
        marker("POUT", "port-filled", 420, 200, 180),
        marker("GND1", "ground", 300, 350),
      ],
      nets: [
        net("net-in", "PIN.P", "R1.1"),
        net("net-out", "R1.2", "C1.1", "POUT.P"),
        net("net-gnd", "C1.2", "GND1.0"),
      ],
      terminals: [
        terminal("VIN", "net-in", "PIN", "input"),
        terminal("VOUT", "net-out", "POUT", "output"),
      ],
      junctions: [["junction-out", "net-out", 300, 200]],
      wires: [
        ["net-in", "PIN.P", "R1.1"],
        ["net-out", "R1.2", "@junction-out"],
        ["net-out", "@junction-out", "POUT.P"],
        ["net-out", "@junction-out", "C1.1"],
        ["net-gnd", "C1.2", "GND1.0"],
      ],
    }),
  ]);
}

// --- 02 / 04 / 10: the cross-coupled pair, whose crossing is topological ----

/**
 * A resistively loaded NMOS cross-coupled pair. Q feeds M2's gate and QB feeds
 * M1's gate, so the two cross-coupling wires have to cross each other: the
 * crossing is a property of the circuit rather than something staged to make a
 * line jump look necessary. The gates face inward, which puts the single
 * crossing at (230, 210) where the Q arm runs east and the QB arm runs south.
 */
function crossCoupledPair({ styleOverrides, jumpNet, heavyRail, heavyDevice }) {
  return [
    documentOf({
      id: "document-latch",
      name: "Cross-Coupled Pair",
      cellName: "cross_coupled_pair",
      styleOverrides,
      mosBulkDefaults: { nmosNetId: "net-gnd" },
      instances: [
        marker("VDD1", "vdd-port", 280, 60),
        // High enough that the value row under each Reference clears the QB
        // lane; the stacked value slot is a fixed row, not a collision solver.
        passive("R1", "resistor", "resistor", "20k", 200, 120),
        passive("R2", "resistor", "resistor", "20k", 360, 120),
        device("M1", "nmos", 210, 260, {
          mirror: "horizontal",
          bulkNetId: "net-gnd",
          ...(heavyDevice ? { styleScale: 2 } : {}),
        }),
        device("M2", "nmos", 350, 260, { bulkNetId: "net-gnd" }),
        marker("PQ", "port-filled", 100, 210),
        marker("PQB", "port-filled", 460, 180, 180),
        marker("GND1", "ground", 280, 360),
      ],
      nets: [
        net("net-vdd", "VDD1.P", "R1.1", "R2.1"),
        net("net-q", "R1.2", "M1.D", "M2.G", "PQ.P"),
        net("net-qb", "R2.2", "M2.D", "M1.G", "PQB.P"),
        net("net-gnd", "M1.S", "M2.S", "M1.B", "M2.B", "GND1.0"),
      ],
      terminals: [
        terminal("Q", "net-q", "PQ", "output"),
        terminal("QB", "net-qb", "PQB", "output"),
      ],
      junctions: [
        ["junction-q", "net-q", 200, 210],
        ["junction-qb", "net-qb", 360, 180],
        ["junction-gnd", "net-gnd", 280, 320],
      ],
      wires: [
        [
          "net-vdd",
          "VDD1.P",
          "R1.1",
          { shape: "hv", ...(heavyRail ? { style: { strokeScale: 2 } } : {}) },
        ],
        [
          "net-vdd",
          "VDD1.P",
          "R2.1",
          { shape: "hv", ...(heavyRail ? { style: { strokeScale: 2 } } : {}) },
        ],
        ["net-q", "R1.2", "@junction-q"],
        ["net-q", "@junction-q", "M1.D"],
        ["net-q", "@junction-q", "PQ.P"],
        // The wire that has to hop: Q reaches across to M2's gate.
        [
          "net-q",
          "@junction-q",
          "M2.G",
          {
            shape: "hv",
            ...(jumpNet === "net-q" ? { style: { lineJump: true } } : {}),
          },
        ],
        ["net-qb", "R2.2", "@junction-qb"],
        ["net-qb", "@junction-qb", "M2.D"],
        ["net-qb", "@junction-qb", "PQB.P"],
        ["net-qb", "@junction-qb", "M1.G", { shape: "hv" }],
        ["net-gnd", "M1.S", "@junction-gnd", { shape: "vh" }],
        ["net-gnd", "M2.S", "@junction-gnd", { shape: "vh" }],
        ["net-gnd", "@junction-gnd", "GND1.0"],
      ],
    }),
  ];
}

// --- 03: common-source stage carrying both stroke-scale fields -------------

function strokeScaleStage() {
  return projectOf("handoff-stroke-scale", "Common-Source Stage", [
    documentOf({
      id: "document-cs",
      name: "Common-Source Stage",
      cellName: "common_source",
      mosBulkDefaults: { nmosNetId: "net-gnd" },
      instances: [
        marker("VDD1", "vdd-port", 220, 60),
        passive("R1", "resistor", "resistor", "10k", 220, 140),
        device("M1", "nmos", 210, 260, {
          bulkNetId: "net-gnd",
          styleScale: 2.5,
        }),
        marker("PIN", "port", 80, 260),
        marker("POUT", "port-filled", 360, 200, 180),
        marker("GND1", "ground", 220, 360),
      ],
      nets: [
        net("net-vdd", "VDD1.P", "R1.1"),
        net("net-out", "R1.2", "M1.D", "POUT.P"),
        net("net-in", "PIN.P", "M1.G"),
        net("net-gnd", "M1.S", "M1.B", "GND1.0"),
      ],
      terminals: [
        terminal("VIN", "net-in", "PIN", "input"),
        terminal("VOUT", "net-out", "POUT", "output"),
      ],
      junctions: [["junction-out", "net-out", 220, 200]],
      wires: [
        ["net-vdd", "VDD1.P", "R1.1", { style: { strokeScale: 2 } }],
        ["net-out", "R1.2", "@junction-out"],
        ["net-out", "@junction-out", "M1.D"],
        ["net-out", "@junction-out", "POUT.P"],
        ["net-in", "PIN.P", "M1.G"],
        ["net-gnd", "M1.S", "GND1.0"],
      ],
    }),
  ]);
}

// --- 06: hierarchy, a 5T OTA instantiated twice ----------------------------

function ota5tHierarchy() {
  const cell = documentOf({
    id: "document-ota-5t",
    name: "5T OTA",
    cellName: "ota_5t",
    mosBulkDefaults: { nmosNetId: "net-vss", pmosNetId: "net-vdd" },
    // Without this the derived block puts the supplies on the signal sides —
    // `defaultSide` in `packages/symbols/src/hierarchical-block-geometry.ts`
    // sends a passive terminal to whichever side has room. Rails belong on top
    // and bottom, which is also what makes the parent Document routable.
    cellSymbol: {
      pinPlacements: [
        { terminalId: "cell-terminal-vdd", side: "north", offset: 0 },
        { terminalId: "cell-terminal-vss", side: "south", offset: 0 },
        { terminalId: "cell-terminal-vinp", side: "west", offset: -20 },
        { terminalId: "cell-terminal-vinn", side: "west", offset: 20 },
        { terminalId: "cell-terminal-ibias", side: "west", offset: 60 },
        { terminalId: "cell-terminal-vout", side: "east", offset: 0 },
      ],
    },
    instances: [
      marker("PVDD", "port", 340, 60, 90),
      marker("PVSS", "port", 340, 460, 270),
      marker("PVINP", "port", 100, 260),
      marker("PVINN", "port", 580, 260, 180),
      marker("PIBIAS", "port", 150, 360),
      marker("PVOUT", "port-filled", 560, 200, 180),
      device("M3", "pmos", 250, 140, {
        mirror: "horizontal",
        bulkNetId: "net-vdd",
      }),
      device("M4", "pmos", 430, 140, { bulkNetId: "net-vdd" }),
      device("M1", "nmos", 230, 260, { bulkNetId: "net-vss" }),
      device("M2", "nmos", 450, 260, {
        mirror: "horizontal",
        bulkNetId: "net-vss",
      }),
      device("M5", "nmos", 330, 360, { bulkNetId: "net-vss" }),
    ],
    nets: [
      net("net-vdd", "PVDD.P", "M3.S", "M4.S", "M3.B", "M4.B"),
      net("net-vss", "PVSS.P", "M5.S", "M1.B", "M2.B", "M5.B"),
      net("net-vinp", "PVINP.P", "M1.G"),
      net("net-vinn", "PVINN.P", "M2.G"),
      net("net-ibias", "PIBIAS.P", "M5.G"),
      net("net-vout", "PVOUT.P", "M4.D", "M2.D"),
      net("net-mirror", "M3.D", "M3.G", "M4.G", "M1.D"),
      net("net-tail", "M5.D", "M1.S", "M2.S"),
    ],
    terminals: [
      terminal("VDD", "net-vdd", "PVDD"),
      terminal("VSS", "net-vss", "PVSS"),
      terminal("VINP", "net-vinp", "PVINP", "input"),
      terminal("VINN", "net-vinn", "PVINN", "input"),
      terminal("IBIAS", "net-ibias", "PIBIAS", "input"),
      terminal("VOUT", "net-vout", "PVOUT", "output"),
    ],
    junctions: [
      ["junction-vdd", "net-vdd", 340, 100],
      ["junction-gate", "net-mirror", 340, 140],
      ["junction-mirror", "net-mirror", 240, 200],
      ["junction-vout", "net-vout", 440, 200],
      ["junction-tail", "net-tail", 340, 310],
    ],
    wires: [
      ["net-vdd", "PVDD.P", "@junction-vdd"],
      ["net-vdd", "@junction-vdd", "M3.S", { shape: "hv" }],
      ["net-vdd", "@junction-vdd", "M4.S", { shape: "hv" }],
      ["net-mirror", "M3.G", "@junction-gate"],
      ["net-mirror", "@junction-gate", "M4.G"],
      ["net-mirror", "@junction-gate", "@junction-mirror", { shape: "vh" }],
      ["net-mirror", "@junction-mirror", "M3.D"],
      ["net-mirror", "@junction-mirror", "M1.D"],
      ["net-vout", "M4.D", "@junction-vout"],
      ["net-vout", "@junction-vout", "M2.D"],
      ["net-vout", "@junction-vout", "PVOUT.P"],
      ["net-vinp", "PVINP.P", "M1.G"],
      ["net-vinn", "PVINN.P", "M2.G"],
      ["net-ibias", "PIBIAS.P", "M5.G"],
      ["net-tail", "M1.S", "@junction-tail", { shape: "vh" }],
      ["net-tail", "M2.S", "@junction-tail", { shape: "vh" }],
      ["net-tail", "@junction-tail", "M5.D"],
      ["net-vss", "M5.S", "PVSS.P"],
    ],
  });
  const blockSymbol = hierarchicalSymbolId("ota_5t");
  const block = (id, x, y) => ({
    id,
    symbolId: blockSymbol,
    placement: { position: { x, y }, rotation: 0, mirror: "none" },
    reference: id,
    netlist: {
      binding: { kind: "subcircuit", childDocumentId: "document-ota-5t" },
      parameters: {},
    },
  });
  const top = documentOf({
    id: "document-top",
    name: "Two-Stage Cascade",
    cellName: "two_stage_cascade",
    instances: [
      // A rail marker per block beats one rail crossing the signal lanes: the
      // supplies are net facts, and the drawing says so locally.
      marker("VDDA", "vdd-port", 240, 110),
      marker("VDDB", "vdd-port", 560, 110),
      block("XA", 240, 260),
      block("XB", 560, 260),
      marker("GNDA", "ground", 240, 400),
      marker("GNDB", "ground", 560, 400),
      marker("GNDREF", "ground", 400, 400),
      marker("PINP", "port", 60, 240),
      marker("PINN", "port", 60, 280),
      marker("PBIAS", "port", 100, 320),
      marker("POUT", "port-filled", 720, 260, 180),
    ],
    nets: [
      net("net-top-vdd", "VDDA.P", "VDDB.P", "XA.VDD", "XB.VDD"),
      net(
        "net-top-gnd",
        "GNDA.0",
        "GNDB.0",
        "GNDREF.0",
        "XA.VSS",
        "XB.VSS",
        "XB.VINN",
      ),
      net("net-top-inp", "PINP.P", "XA.VINP"),
      net("net-top-inn", "PINN.P", "XA.VINN"),
      net("net-top-bias", "PBIAS.P", "XA.IBIAS", "XB.IBIAS"),
      net("net-stage1", "XA.VOUT", "XB.VINP"),
      net("net-top-out", "XB.VOUT", "POUT.P"),
    ],
    terminals: [
      terminal("VINP", "net-top-inp", "PINP", "input"),
      terminal("VINN", "net-top-inn", "PINN", "input"),
      terminal("IBIAS", "net-top-bias", "PBIAS", "input"),
      terminal("VOUT", "net-top-out", "POUT", "output"),
    ],
    junctions: [["junction-bias", "net-top-bias", 140, 320]],
    wires: [
      ["net-top-vdd", "VDDA.P", "XA.VDD"],
      ["net-top-vdd", "VDDB.P", "XB.VDD"],
      ["net-top-gnd", "XA.VSS", "GNDA.0"],
      ["net-top-gnd", "XB.VSS", "GNDB.0"],
      ["net-top-gnd", "GNDREF.0", "XB.VINN"],
      ["net-top-inp", "PINP.P", "XA.VINP"],
      ["net-top-inn", "PINN.P", "XA.VINN"],
      ["net-top-bias", "PBIAS.P", "@junction-bias"],
      ["net-top-bias", "@junction-bias", "XA.IBIAS"],
      [
        "net-top-bias",
        "@junction-bias",
        "XB.IBIAS",
        // Round the first block rather than crossing it: the second stage's
        // bias pin sits behind XA on the same lane.
        {
          shape: [
            [140, 470],
            [460, 470],
            [460, 320],
          ],
        },
      ],
      [
        "net-stage1",
        "XA.VOUT",
        "XB.VINP",
        // Jog early so the lane between the blocks keeps three clear tracks:
        // this wire, the reference ground, and the bias detour.
        {
          shape: [
            [340, 260],
            [340, 240],
          ],
        },
      ],
      ["net-top-out", "XB.VOUT", "POUT.P"],
    ],
  });
  return projectOf(
    "handoff-ota-5t-hierarchy",
    "5T OTA Cascade",
    [top, cell],
    "document-top",
  );
}

// --- 07: dedicated analog and digital grounds, no shared node 0 ------------

function splitGrounds() {
  return projectOf("handoff-split-grounds", "Split Grounds", [
    documentOf({
      id: "document-split-grounds",
      name: "Split Grounds",
      cellName: "split_grounds",
      mosBulkDefaults: { nmosNetId: "net-dgnd", pmosNetId: "net-vdd" },
      // The two ground glyphs differ, but only the names say which rail is
      // which — and that is the entire subject of this sample.
      netLabels: [
        ["net-agnd", "AGND1", 20, 20],
        ["net-dgnd", "DGND1", 20, 20],
      ],
      instances: [
        marker("PAIN", "port", 60, 200),
        passive("R1", "resistor", "resistor", "1k", 180, 200, {
          rotation: 270,
        }),
        passive("C1", "capacitor", "capacitor", "100p", 280, 270),
        marker("PAOUT", "port-filled", 400, 200, 180),
        marker("AGND1", "analog-ground", 280, 350),
        marker("VDD1", "vdd-port", 780, 60),
        device("M2", "pmos", 770, 140, { bulkNetId: "net-vdd" }),
        device("M1", "nmos", 770, 280, { bulkNetId: "net-dgnd" }),
        marker("PDIN", "port", 600, 210),
        marker("PDOUT", "port-filled", 900, 210, 180),
        marker("DGND1", "digital-ground", 780, 370),
      ],
      nets: [
        net("net-ain", "PAIN.P", "R1.1"),
        net("net-aout", "R1.2", "C1.1", "PAOUT.P"),
        net("net-agnd", "C1.2", "AGND1.AGND"),
        net("net-vdd", "VDD1.P", "M2.S", "M2.B"),
        net("net-din", "PDIN.P", "M1.G", "M2.G"),
        net("net-dout", "M1.D", "M2.D", "PDOUT.P"),
        net("net-dgnd", "M1.S", "M1.B", "DGND1.DGND"),
      ],
      terminals: [
        terminal("VAIN", "net-ain", "PAIN", "input"),
        terminal("VAOUT", "net-aout", "PAOUT", "output"),
        terminal("VDIN", "net-din", "PDIN", "input"),
        terminal("VDOUT", "net-dout", "PDOUT", "output"),
      ],
      junctions: [
        ["junction-aout", "net-aout", 280, 200],
        ["junction-din", "net-din", 680, 210],
        ["junction-dout", "net-dout", 780, 210],
      ],
      wires: [
        ["net-ain", "PAIN.P", "R1.1"],
        ["net-aout", "R1.2", "@junction-aout"],
        ["net-aout", "@junction-aout", "PAOUT.P"],
        ["net-aout", "@junction-aout", "C1.1"],
        ["net-agnd", "C1.2", "AGND1.AGND"],
        ["net-vdd", "VDD1.P", "M2.S"],
        ["net-din", "PDIN.P", "@junction-din"],
        ["net-din", "@junction-din", "M2.G", { shape: "vh" }],
        ["net-din", "@junction-din", "M1.G", { shape: "vh" }],
        ["net-dout", "M2.D", "@junction-dout"],
        ["net-dout", "@junction-dout", "M1.D"],
        ["net-dout", "@junction-dout", "PDOUT.P"],
        ["net-dgnd", "M1.S", "DGND1.DGND"],
      ],
    }),
  ]);
}

// --- 08: the power-device families on one DC bus ---------------------------

/**
 * Three legs across one bus so each new device appears in the role it is
 * actually drawn in: an E-GaN half bridge, an IGBT low side with its
 * freewheeling diode, and the depletion-mode GaN cascode whose gate ties to
 * the low-voltage LDMOS source.
 *
 * Nothing here is claimed to be electrically verified. This fork runs no
 * simulator and these devices carry no vendor model, so the file is evidence
 * of symbols, pins and connectivity only.
 */
function ganHalfBridge() {
  return projectOf("handoff-power-devices", "Power Device Legs", [
    documentOf({
      id: "document-power-legs",
      name: "Power Device Legs",
      cellName: "power_device_legs",
      mosBulkDefaults: { nmosNetId: "net-return" },
      powerNames: { "net-bus": "VBUS" },
      instances: [
        marker("VBUS1", "vdd-port", 100, 60),
        marker("GNDR", "ground", 460, 500),
        // Leg 1: E-GaN half bridge.
        device("Q1", "egan", 210, 160),
        device("Q2", "egan", 210, 340),
        marker("PGH", "port", 80, 160),
        marker("PGL", "port", 80, 340),
        marker("PSW1", "port-filled", 320, 250, 180),
        // Leg 2: boost leg, IGBT low side with its freewheeling diode.
        device("D1", "diode", 460, 160, { rotation: 270 }),
        device("Q3", "igbt", 460, 340),
        marker("PG3", "port", 320, 340),
        marker("PSW2", "port-filled", 560, 250, 180),
        // Leg 3: depletion-mode GaN cascoded with an LDMOS. It sits a column
        // clear of leg 2 so the cascode gate can drop to the return rail
        // without running under the SW2 Port label.
        passive("R1", "resistor", "resistor", "100", 780, 130),
        device("Q4", "dgan", 770, 240),
        device("M5", "ndmos", 790, 340, {
          mirror: "horizontal",
          bulkNetId: "net-return",
        }),
        marker("PSW3", "port-filled", 880, 190, 180),
        marker("PG5", "port", 900, 340, 180),
      ],
      nets: [
        net("net-bus", "VBUS1.P", "Q1.D", "D1.K", "R1.1"),
        net("net-return", "GNDR.0", "Q2.S", "Q3.E", "M5.S", "M5.B", "Q4.G"),
        net("net-sw1", "Q1.S", "Q2.D", "PSW1.P"),
        net("net-gate-high", "PGH.P", "Q1.G"),
        net("net-gate-low", "PGL.P", "Q2.G"),
        net("net-sw2", "D1.A", "Q3.C", "PSW2.P"),
        net("net-gate-igbt", "PG3.P", "Q3.G"),
        net("net-sw3", "R1.2", "Q4.D", "PSW3.P"),
        net("net-cascode-mid", "Q4.S", "M5.D"),
        net("net-gate-cascode", "PG5.P", "M5.G"),
      ],
      terminals: [
        terminal("VSW1", "net-sw1", "PSW1", "output"),
        terminal("VGH", "net-gate-high", "PGH", "input"),
        terminal("VGL", "net-gate-low", "PGL", "input"),
        terminal("VSW2", "net-sw2", "PSW2", "output"),
        terminal("VG3", "net-gate-igbt", "PG3", "input"),
        terminal("VSW3", "net-sw3", "PSW3", "output"),
        terminal("VG5", "net-gate-cascode", "PG5", "input"),
      ],
      junctions: [
        ["junction-bus-1", "net-bus", 220, 100],
        ["junction-bus-2", "net-bus", 460, 100],
        ["junction-bus-3", "net-bus", 780, 100],
        ["junction-sw1", "net-sw1", 220, 250],
        ["junction-sw2", "net-sw2", 460, 250],
        ["junction-sw3", "net-sw3", 780, 190],
        ["junction-return-1", "net-return", 220, 430],
        ["junction-return-2", "net-return", 460, 430],
        ["junction-cascode-gate", "net-return", 700, 430],
        ["junction-return-3", "net-return", 780, 430],
      ],
      wires: [
        ["net-bus", "VBUS1.P", "@junction-bus-1", { shape: "vh" }],
        ["net-bus", "@junction-bus-1", "Q1.D"],
        ["net-bus", "@junction-bus-1", "@junction-bus-2"],
        ["net-bus", "@junction-bus-2", "D1.K"],
        ["net-bus", "@junction-bus-2", "@junction-bus-3"],
        ["net-bus", "@junction-bus-3", "R1.1"],
        ["net-gate-high", "PGH.P", "Q1.G"],
        ["net-gate-low", "PGL.P", "Q2.G"],
        ["net-sw1", "Q1.S", "@junction-sw1"],
        ["net-sw1", "@junction-sw1", "Q2.D"],
        ["net-sw1", "@junction-sw1", "PSW1.P"],
        ["net-sw2", "D1.A", "@junction-sw2"],
        ["net-sw2", "@junction-sw2", "Q3.C"],
        ["net-sw2", "@junction-sw2", "PSW2.P"],
        ["net-gate-igbt", "PG3.P", "Q3.G"],
        ["net-sw3", "R1.2", "@junction-sw3"],
        ["net-sw3", "@junction-sw3", "Q4.D"],
        ["net-sw3", "@junction-sw3", "PSW3.P"],
        ["net-cascode-mid", "Q4.S", "M5.D"],
        ["net-gate-cascode", "PG5.P", "M5.G"],
        ["net-return", "Q2.S", "@junction-return-1"],
        ["net-return", "@junction-return-1", "@junction-return-2"],
        ["net-return", "Q3.E", "@junction-return-2"],
        ["net-return", "@junction-return-2", "GNDR.0"],
        ["net-return", "@junction-return-2", "@junction-cascode-gate"],
        ["net-return", "Q4.G", "@junction-cascode-gate", { shape: "hv" }],
        ["net-return", "@junction-cascode-gate", "@junction-return-3"],
        ["net-return", "M5.S", "@junction-return-3"],
      ],
    }),
  ]);
}

// --- 09: the four-terminal body variant with B drawn and wired -------------

/**
 * A CMOS inverter whose bodies are drawn and wired by hand. There is no
 * `mosBulkDefaults` and no `mosBulkBinding`: those record an editor-
 * materialized implicit connection, and an explicitly drawn B wire needs no
 * parallel metadata. Upstream needs the explicit form and the implicit form
 * to be separable, which is why this is not folded into 08.
 */
function fourTerminalMos() {
  return projectOf("handoff-four-terminal-mos", "Four-Terminal Inverter", [
    documentOf({
      id: "document-four-terminal",
      name: "Four-Terminal Inverter",
      cellName: "four_terminal_inverter",
      instances: [
        marker("VDD1", "vdd-port", 280, 60),
        device("M2", "pmos", 270, 140, { variant: "four-terminal" }),
        device("M1", "nmos", 270, 280, { variant: "four-terminal" }),
        marker("PIN", "port", 100, 210),
        marker("POUT", "port-filled", 440, 210, 180),
        marker("GND1", "ground", 280, 370),
      ],
      nets: [
        net("net-vdd", "VDD1.P", "M2.S", "M2.B"),
        net("net-in", "PIN.P", "M1.G", "M2.G"),
        net("net-out", "M1.D", "M2.D", "POUT.P"),
        net("net-gnd", "M1.S", "M1.B", "GND1.0"),
      ],
      terminals: [
        terminal("VIN", "net-in", "PIN", "input"),
        terminal("VOUT", "net-out", "POUT", "output"),
      ],
      junctions: [
        ["junction-vdd", "net-vdd", 280, 100],
        ["junction-pbody", "net-vdd", 340, 100],
        ["junction-in", "net-in", 180, 210],
        ["junction-out", "net-out", 280, 210],
        ["junction-gnd", "net-gnd", 280, 340],
        ["junction-nbody", "net-gnd", 340, 340],
      ],
      wires: [
        ["net-vdd", "VDD1.P", "@junction-vdd"],
        ["net-vdd", "@junction-vdd", "M2.S"],
        ["net-vdd", "@junction-vdd", "@junction-pbody"],
        ["net-vdd", "@junction-pbody", "M2.B", { shape: "vh" }],
        ["net-in", "PIN.P", "@junction-in"],
        ["net-in", "@junction-in", "M2.G", { shape: "vh" }],
        ["net-in", "@junction-in", "M1.G", { shape: "vh" }],
        ["net-out", "M2.D", "@junction-out"],
        ["net-out", "@junction-out", "M1.D"],
        ["net-out", "@junction-out", "POUT.P"],
        ["net-gnd", "M1.S", "@junction-gnd"],
        ["net-gnd", "@junction-gnd", "GND1.0"],
        ["net-gnd", "@junction-gnd", "@junction-nbody"],
        ["net-gnd", "@junction-nbody", "M1.B", { shape: "vh" }],
      ],
    }),
  ]);
}

// --- 11: same era, no fork fields, origin indistinguishable ----------------

function currentMirror() {
  return projectOf("handoff-current-mirror", "NMOS Current Mirror", [
    documentOf({
      id: "document-mirror",
      name: "NMOS Current Mirror",
      cellName: "nmos_current_mirror",
      mosBulkDefaults: { nmosNetId: "net-gnd" },
      instances: [
        marker("PIREF", "port", 80, 180),
        device("M1", "nmos", 230, 260, {
          mirror: "horizontal",
          bulkNetId: "net-gnd",
        }),
        device("M2", "nmos", 370, 260, { bulkNetId: "net-gnd" }),
        marker("POUT", "port-filled", 500, 180, 180),
        marker("GND1", "ground", 300, 370),
      ],
      nets: [
        net("net-ref", "PIREF.P", "M1.D", "M1.G", "M2.G"),
        net("net-out", "M2.D", "POUT.P"),
        net("net-gnd", "M1.S", "M2.S", "M1.B", "M2.B", "GND1.0"),
      ],
      terminals: [
        terminal("IREF", "net-ref", "PIREF", "input"),
        terminal("IOUT", "net-out", "POUT", "output"),
      ],
      junctions: [
        ["junction-ref", "net-ref", 220, 180],
        ["junction-gate", "net-ref", 300, 260],
        ["junction-gnd", "net-gnd", 300, 320],
      ],
      wires: [
        ["net-ref", "PIREF.P", "@junction-ref"],
        ["net-ref", "@junction-ref", "M1.D"],
        ["net-ref", "@junction-ref", "@junction-gate", { shape: "hv" }],
        ["net-ref", "@junction-gate", "M1.G"],
        ["net-ref", "@junction-gate", "M2.G"],
        ["net-out", "M2.D", "POUT.P"],
        ["net-gnd", "M1.S", "@junction-gnd", { shape: "vh" }],
        ["net-gnd", "M2.S", "@junction-gnd", { shape: "vh" }],
        ["net-gnd", "@junction-gnd", "GND1.0"],
      ],
    }),
  ]);
}

// --- the sample table -----------------------------------------------------

const VERSION_AHEAD = "version-ahead-of-upstream";
const VERSION_COLLISION = "schema-version-collision";

const SAMPLES = [
  {
    slug: "01-rc-divider",
    schemaVersion: 57,
    circuit: "RC low-pass with formal IN/OUT ports and a ground marker",
    covers: "pre-fork file with no fork features",
    review: "control sample; upstream should read it unchanged",
    extensionFields: [],
    preview: false,
    build: rcDivider,
  },
  {
    slug: "02-crossing-line-jump",
    schemaVersion: 58,
    circuit: "resistively loaded NMOS cross-coupled pair",
    covers: "the schema-58 per-wire line-jump flag, and the version collision",
    review: "is the hop on the right wire, and does it read as a crossover",
    extensionFields: ["routeLineJump"],
    preview: true,
    build: () =>
      projectOf("handoff-crossing-line-jump", "Cross-Coupled Pair", [
        ...crossCoupledPair({ jumpNet: "net-q" }),
      ]),
  },
  {
    slug: "03-stroke-scale",
    schemaVersion: 59,
    circuit: "common-source stage with a heavy supply rail and a heavy device",
    covers: "the schema-59 per-object stroke width, on a Route and an Instance",
    review: "is the weight contrast strong enough to be worth the field",
    extensionFields: ["routeStrokeScale", "instanceStrokeScale"],
    preview: true,
    build: strokeScaleStage,
  },
  {
    slug: "04-line-jump-radius",
    schemaVersion: 60,
    circuit: "the same cross-coupled pair at a larger line-jump radius",
    covers: "the schema-60 per-document line-jump size",
    review: "compare against 02: is the radius difference visible",
    extensionFields: ["routeLineJump", "lineJumpRadiusScale"],
    preview: true,
    build: () =>
      projectOf("handoff-line-jump-radius", "Cross-Coupled Pair, Large Hops", [
        ...crossCoupledPair({
          jumpNet: "net-q",
          styleOverrides: { lineJumpRadiusScale: 2 },
        }),
      ]),
  },
  {
    slug: "05-empty",
    schemaVersion: 60,
    circuit: "empty Project with one empty Document",
    covers: "empty Project",
    review: "nothing to review",
    extensionFields: [],
    preview: false,
    build: () => createEmptyProject("handoff-empty", "Empty Project"),
  },
  {
    slug: "06-ota-5t-hierarchy",
    schemaVersion: 60,
    circuit: "5T OTA Cell instantiated twice from a top Document",
    covers: "hierarchical circuit with a formal Cell interface",
    review: "is the 5T OTA topology right, and is the cascade sane",
    extensionFields: [],
    preview: false,
    build: ota5tHierarchy,
  },
  {
    slug: "07-split-grounds",
    schemaVersion: 60,
    circuit: "RC on AGND next to a CMOS inverter on DGND, no shared node 0",
    covers: "AGND/DGND as named global rails distinct from SPICE 0",
    review: "does the split match how you would actually draw it",
    extensionFields: [],
    preview: false,
    build: splitGrounds,
  },
  {
    slug: "08-power-devices",
    schemaVersion: 60,
    circuit: "E-GaN half bridge, IGBT leg with freewheeling diode, GaN cascode",
    covers: "the new power-device families, their pins and reference prefixes",
    review: "device artwork and how each leg is wired — the important one",
    extensionFields: [],
    preview: false,
    build: ganHalfBridge,
  },
  {
    slug: "09-four-terminal-mos",
    schemaVersion: 60,
    circuit: "CMOS inverter with both bodies drawn and wired explicitly",
    covers: "the four-terminal body variant",
    review: "are the bulk connections the ones you would draw",
    extensionFields: [],
    preview: false,
    build: fourTerminalMos,
  },
  {
    slug: "10-all-extensions",
    schemaVersion: 60,
    circuit: "cross-coupled pair carrying all three fork fields at once",
    covers: "what a current fork save actually looks like",
    review: "overall feel; this is the one that stands in for real files",
    extensionFields: [
      "routeLineJump",
      "routeStrokeScale",
      "instanceStrokeScale",
      "lineJumpRadiusScale",
    ],
    preview: true,
    build: () =>
      projectOf("handoff-all-extensions", "Cross-Coupled Pair, Fully Styled", [
        ...crossCoupledPair({
          jumpNet: "net-q",
          heavyRail: true,
          heavyDevice: true,
          styleOverrides: { lineJumpRadiusScale: 1.5 },
        }),
      ]),
  },
  {
    slug: "11-origin-indistinguishable",
    schemaVersion: 58,
    circuit: "NMOS current mirror with no fork fields anywhere",
    covers: "origin cannot be determined from the bytes: the refusal case",
    review: "do NOT enable a line jump or a stroke width here",
    extensionFields: [],
    preview: false,
    build: currentMirror,
  },
];

// --- shared machinery -----------------------------------------------------

function sampleFileName(sample) {
  return `${sample.slug}.v${sample.schemaVersion}.schdraft`;
}

function sampleResolver(project) {
  return new InMemorySymbolResolver([
    ...builtInSymbols,
    ...createProjectHierarchicalSymbols(project, builtInSymbols),
  ]);
}

function assertNoErcErrors(label, project) {
  const resolver = sampleResolver(project);
  const index = buildProjectConnectivityIndex(project, resolver);
  const diagnostics = runErcChecks(project, index, resolver);
  const errors = diagnostics.filter(
    (diagnostic) => diagnostic.severity === "error",
  );
  if (errors.length > 0) {
    throw new Error(
      `${label}: ERC errors\n${errors
        .map((error) => `  ${error.code} ${error.message}`)
        .join("\n")}`,
    );
  }
  return diagnostics.filter((diagnostic) => diagnostic.severity !== "error");
}

/** Collect which of the three fork field paths the raw bytes actually use. */
function presentExtensionFields(raw) {
  const present = new Set();
  for (const document of raw.documents ?? []) {
    for (const route of document.routes ?? []) {
      if (route.styleOverride?.lineJump !== undefined) {
        present.add("routeLineJump");
      }
      if (route.styleOverride?.strokeScale !== undefined) {
        present.add("routeStrokeScale");
      }
    }
    for (const instance of document.instances ?? []) {
      if (instance.styleOverride?.strokeScale !== undefined) {
        present.add("instanceStrokeScale");
      }
    }
    if (
      document.presentation?.styleOverrides?.lineJumpRadiusScale !== undefined
    ) {
      present.add("lineJumpRadiusScale");
    }
  }
  return present;
}

function stampSchemaVersion(project, schemaVersion) {
  const canonical = JSON.parse(serializeProject(project));
  canonical.schemaVersion = schemaVersion;
  return `${JSON.stringify(canonical, null, 2)}\n`;
}

function knownDivergence(schemaVersion) {
  if (schemaVersion === 58) return [VERSION_COLLISION];
  if (schemaVersion > 58) return [VERSION_AHEAD];
  return [];
}

// --- phase 1: drafts ------------------------------------------------------

function runDrafts() {
  const outputDirectory = resolve(process.cwd(), OUTPUT_DIRECTORY);
  mkdirSync(outputDirectory, { recursive: true });
  const reviewable = existsSync(WINDOWS_REVIEW_DIRECTORY);
  const warnings = [];
  for (const sample of SAMPLES) {
    const project = sample.build();
    const declared = new Set(
      sample.extensionFields.map((field) => EXTENSION_FIELD_PATHS[field]),
    );
    if (declared.size !== sample.extensionFields.length) {
      throw new Error(`${sample.slug}: unknown extension field name`);
    }
    for (const note of assertNoErcErrors(sample.slug, project)) {
      warnings.push(`${sample.slug}: ${note.code} ${note.message}`);
    }
    const fileName = sampleFileName(sample);
    const target = resolve(outputDirectory, fileName);
    // Drafts carry the current schema version so the shell opens all of them.
    // The filename already states the version the sample will be stamped to.
    writeFileSync(target, serializeProject(project), "utf8");
    if (reviewable) {
      copyFileSync(target, resolve(WINDOWS_REVIEW_DIRECTORY, fileName));
    }
    process.stdout.write(`drafted ${fileName}\n`);
  }
  if (warnings.length > 0) {
    process.stdout.write(`\nERC notes (not errors):\n${warnings.join("\n")}\n`);
  }
  process.stdout.write(
    reviewable
      ? `\nCopied to ${WINDOWS_REVIEW_DIRECTORY}\n` +
          "Open, correct and save each one in the Windows shell, copy them back\n" +
          `into ${OUTPUT_DIRECTORY}/, then run: pnpm handoff:finalize\n`
      : `\n${WINDOWS_REVIEW_DIRECTORY} is not mounted; drafts were written to ` +
          `${OUTPUT_DIRECTORY}/ only.\n`,
  );
}

// --- phase 2: finalize ----------------------------------------------------

function runFinalize() {
  const outputDirectory = resolve(process.cwd(), OUTPUT_DIRECTORY);
  const entries = [];
  const warnings = [];
  for (const sample of SAMPLES) {
    const fileName = sampleFileName(sample);
    const target = resolve(outputDirectory, fileName);
    if (!existsSync(target)) {
      throw new Error(`${fileName} is missing; run --drafts first`);
    }
    const result = tryParseProjectWithMetadata(readFileSync(target, "utf8"));
    if (!result.ok) {
      throw new Error(
        `${fileName} does not load\n${result.diagnostics
          .map((diagnostic) => `  ${diagnostic.code} ${diagnostic.message}`)
          .join("\n")}`,
      );
    }
    for (const note of assertNoErcErrors(fileName, result.project)) {
      warnings.push(`${fileName}: ${note.code} ${note.message}`);
    }
    const serialized = stampSchemaVersion(result.project, sample.schemaVersion);
    const present = presentExtensionFields(JSON.parse(serialized));
    const declared = new Set(sample.extensionFields);
    const missing = [...declared].filter((field) => !present.has(field));
    const undeclared = [...present].filter((field) => !declared.has(field));
    if (missing.length > 0 || undeclared.length > 0) {
      throw new Error(
        `${fileName} disagrees with its declared extension fields\n` +
          `  declared but absent: ${missing.join(", ") || "none"}\n` +
          `  present but undeclared: ${undeclared.join(", ") || "none"}\n` +
          "Either restore the intent in the shell or change the table in " +
          "scripts/generate-upstream-handoff.mjs.",
      );
    }
    writeFileSync(target, serialized, "utf8");
    const previewFile = `${sample.slug}.svg`;
    if (sample.preview) {
      const document =
        result.project.documents.find(
          (candidate) => candidate.id === result.project.topDocumentId,
        ) ?? result.project.documents[0];
      writeFileSync(
        resolve(outputDirectory, previewFile),
        renderDocumentSvg(document, sampleResolver(result.project), {
          title: sample.circuit,
        }),
        "utf8",
      );
    }
    entries.push({
      file: fileName,
      schemaVersion: sample.schemaVersion,
      circuit: sample.circuit,
      covers: sample.covers,
      extensionFieldPaths: sample.extensionFields.map(
        (field) => EXTENSION_FIELD_PATHS[field],
      ),
      knownDivergence: knownDivergence(sample.schemaVersion),
      ...(sample.preview ? { preview: previewFile } : {}),
    });
    process.stdout.write(`finalized ${fileName}\n`);
  }
  writeFileSync(
    resolve(outputDirectory, "manifest.json"),
    `${JSON.stringify(
      {
        bundle: "schematic-draft-upstream-handoff",
        currentSchemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
        upstreamIssue:
          "https://github.com/cascode-ai/analog-canvas/issues/1003",
        divergenceCodes: {
          [VERSION_COLLISION]:
            "Both projects number this schema version; the fork's meaning is " +
            "the per-wire line-jump flag. Upstream's reader accepts the number " +
            "and migrates it as its own 58, so the file is mis-read with no " +
            "diagnostic. This is the only silent case.",
          [VERSION_AHEAD]:
            "Above upstream's current version, so its reader refuses the file " +
            "with UNSUPPORTED_SCHEMA_VERSION. Loud, and therefore safe — until " +
            "upstream passes this number.",
        },
        samples: entries,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  const stale = readdirSync(outputDirectory).filter(
    (name) =>
      name.endsWith(".schdraft") &&
      !SAMPLES.some((sample) => sampleFileName(sample) === name),
  );
  if (stale.length > 0) {
    throw new Error(
      `${OUTPUT_DIRECTORY} holds files the table does not describe: ${stale.join(", ")}`,
    );
  }
  if (warnings.length > 0) {
    process.stdout.write(`\nERC notes (not errors):\n${warnings.join("\n")}\n`);
  }
  process.stdout.write(`\nWrote ${OUTPUT_DIRECTORY}/manifest.json\n`);
}

const mode = process.argv[2];
if (mode === "--drafts") runDrafts();
else if (mode === "--finalize") runFinalize();
else {
  process.stderr.write(
    "usage: node scripts/generate-upstream-handoff.mjs --drafts|--finalize\n",
  );
  process.exit(2);
}
