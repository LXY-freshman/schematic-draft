/**
 * Symbols as Visio masters.
 *
 * This is the half of the export that decides whether the result can be edited
 * at all. A symbol becomes one Visio group: the group carries the connection
 * points a wire glues to, and its children carry the artwork.
 *
 * The children exist because of a Visio rule with no way around it — line
 * weight, colour and cap belong to a shape, while fill belongs to an individual
 * geometry section. A resistor drawn with one weight throughout is one child; a
 * MOSFET whose gate bar is heavier than its leads is two. Grouping by drawn
 * weight keeps the artwork faithful to the Razavi reference instead of flattening
 * every stroke to one width, and it is what Microsoft's own electrical stencils
 * do.
 */

import {
  razaviTextbookProfile,
  resolvePrimitiveStrokeWidth,
} from "@icm/derived";
import type { SchematicStyleProfile } from "@icm/derived";
import type {
  SymbolDefinition,
  SymbolPrimitive,
  SymbolVariant,
} from "@icm/symbols";

import { visioGuid } from "./identifier.js";
import type { VisioMaster } from "./masters.js";
import { parseSymbolPathData } from "./path-data.js";
import type { PathPoint } from "./path-data.js";
import { inchesFromUnits } from "./units.js";
import { escapeXmlAttribute, formatVisioNumber } from "./xml.js";

/** Namespace the master identifiers are hashed under. */
const GUID_NAMESPACE = "schematic-draft/visio/master";

/**
 * The group shape's ID inside a master part; children reference it by name.
 *
 * Five, not one: Visio reserves the low sheet IDs inside a master, and a master
 * whose shapes start at 1 loads with no shapes at all — the catalog entry
 * survives, the artwork silently does not. Every master in Microsoft's own
 * stencils starts at 5, which is why their children read `Sheet.5!Width`.
 */
const GROUP_SHAPE_ID = 5;

/**
 * A pin, as the page can glue to it. `rowName` is what a `<Connect>` record
 * names, which is why the row is written with a name rather than an index.
 */
export interface VisioConnectionPoint {
  readonly pinName: string;
  /** Row name inside the group's Connection section, such as `Row_1`. */
  readonly rowName: string;
  /** Position as a fraction of the master's width, measured from its left. */
  readonly xFraction: number;
  /** Position as a fraction of the master's height, measured from its bottom. */
  readonly yFraction: number;
}

/**
 * Something the symbol draws that its master does not.
 *
 * Recorded rather than dropped: an export that quietly loses part of a symbol
 * is worse than one that says what it lost. The page and the fidelity contract
 * both read this.
 */
export type VisioMasterCaveat =
  | { readonly kind: "pin-name-text"; readonly detail: string }
  | { readonly kind: "body-text"; readonly detail: string }
  | { readonly kind: "upright-mark"; readonly detail: string };

export interface VisioSymbolMaster {
  /** `symbolId`, or `symbolId#variantId` when the symbol has variants. */
  readonly key: string;
  readonly symbolId: string;
  readonly variantId: string | undefined;
  readonly master: VisioMaster;
  readonly connections: readonly VisioConnectionPoint[];
  readonly caveats: readonly VisioMasterCaveat[];
}

export interface VisioMasterSource {
  readonly definition: SymbolDefinition;
  /** Undefined when the symbol's own artwork is what the master draws. */
  readonly variant: SymbolVariant | undefined;
  /** False when the symbol yields one master and the name needs no suffix. */
  readonly disambiguate: boolean;
}

export function visioSymbolMasterKey(
  symbolId: string,
  variantId: string | undefined,
): string {
  return variantId === undefined ? symbolId : `${symbolId}#${variantId}`;
}

/**
 * Whether a symbol's artwork can live in a master at all.
 *
 * A Transfer Function block is drawn from its formula, not from its primitives:
 * the frame widens to fit the text, so two instances of one symbol are two
 * different outlines. A master is a single fixed outline by definition, so
 * these are drawn straight onto the page instead.
 */
export function symbolHasVisioMaster(definition: SymbolDefinition): boolean {
  return definition.formulaPresentation?.adaptiveFrame === undefined;
}

/**
 * The symbol and variant combinations a document can actually reach.
 *
 * A symbol with a default variant never resolves to its variant-free artwork,
 * so that artwork is not worth a master: the four-terminal MOSFET drawing
 * behind `nmos` is unreachable once `textbook-3terminal` is its default.
 */
export function enumerateVisioMasterSources(
  definitions: readonly SymbolDefinition[],
): VisioMasterSource[] {
  const sources: VisioMasterSource[] = [];
  for (const definition of definitions) {
    if (!symbolHasVisioMaster(definition)) continue;
    const reachable: (SymbolVariant | undefined)[] = [];
    if (
      definition.variants.length === 0 ||
      definition.defaultVariantId === undefined
    ) {
      reachable.push(undefined);
    }
    reachable.push(...definition.variants);
    const disambiguate = reachable.length > 1;
    for (const variant of reachable) {
      sources.push({ definition, variant, disambiguate });
    }
  }
  return sources;
}

interface MasterFrame {
  readonly widthInches: number;
  readonly heightInches: number;
  /** Symbol-local point to a fraction of the master's box, y flipped. */
  fraction(point: { x: number; y: number }): PathPoint;
  /** Symbol-local length to a fraction of the master's width. */
  xScale(units: number): number;
  yScale(units: number): number;
}

function masterFrame(definition: SymbolDefinition): MasterFrame {
  const { x, y, width, height } = definition.viewBox;
  return {
    widthInches: inchesFromUnits(width),
    heightInches: inchesFromUnits(height),
    fraction: (point) => ({
      x: round((point.x - x) / width),
      y: round(1 - (point.y - y) / height),
    }),
    xScale: (units) => round(units / width),
    yScale: (units) => round(units / height),
  };
}

/** The precision `formatVisioNumber` keeps, applied before a value is reused. */
function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function visiblePrimitives(
  definition: SymbolDefinition,
  variant: SymbolVariant | undefined,
): SymbolPrimitive[] {
  const hidden = new Set(variant?.hiddenPrimitiveParts ?? []);
  return [
    ...definition.primitives,
    ...(variant?.additionalPrimitives ?? []),
  ].filter((primitive) => !primitive.part || !hidden.has(primitive.part));
}

interface StrokeStyle {
  /** Line weight in inches, as a Visio `LineWeight` cell holds it. */
  readonly weightInches: number;
  /** Visio `LineCap`: 0 round, 1 square. */
  readonly cap: 0 | 1;
}

/**
 * Visio offers a round cap and a square cap, and nothing else. The butt cap the
 * schematic profile uses is closest to square — both end the stroke at the
 * endpoint rather than past it — and the difference, half a line weight, is a
 * hundredth of an inch at schematic scale.
 */
function strokeStyle(
  primitive: SymbolPrimitive,
  profile: SchematicStyleProfile,
): StrokeStyle {
  const units =
    resolvePrimitiveStrokeWidth(
      profile,
      primitive.style?.strokeRole,
      primitive.style?.strokeWidth,
    ) ?? profile.strokes.symbol;
  const cap = primitive.style?.lineCap ?? profile.lineCap;
  return {
    weightInches: round(inchesFromUnits(units)),
    cap: cap === "round" ? 0 : 1,
  };
}

function strokeStyleKey(style: StrokeStyle): string {
  return `${style.weightInches}/${style.cap}`;
}

function relRow(type: string, index: number, point: PathPoint): string {
  return (
    `<Row T="${type}" IX="${index}">` +
    `<Cell N="X" V="${formatVisioNumber(point.x)}"/><Cell N="Y" V="${formatVisioNumber(point.y)}"/>` +
    `</Row>`
  );
}

function relCubicRow(
  index: number,
  segment: { control1: PathPoint; control2: PathPoint; to: PathPoint },
): string {
  return (
    `<Row T="RelCubBezTo" IX="${index}">` +
    `<Cell N="X" V="${formatVisioNumber(segment.to.x)}"/><Cell N="Y" V="${formatVisioNumber(segment.to.y)}"/>` +
    `<Cell N="A" V="${formatVisioNumber(segment.control1.x)}"/><Cell N="B" V="${formatVisioNumber(segment.control1.y)}"/>` +
    `<Cell N="C" V="${formatVisioNumber(segment.control2.x)}"/><Cell N="D" V="${formatVisioNumber(segment.control2.y)}"/>` +
    `</Row>`
  );
}

/**
 * An ellipse is the one row type with no relative form, so its cells carry a
 * formula against `Width` and `Height` instead. That is also what keeps a
 * circle circular when the shape is resized, which `LockAspect` guarantees.
 */
function ellipseRow(
  frame: MasterFrame,
  center: PathPoint,
  xRadius: number,
  yRadius: number,
): string {
  const cell = (
    name: string,
    axis: "Width" | "Height",
    fractionValue: number,
  ): string => {
    const size = axis === "Width" ? frame.widthInches : frame.heightInches;
    return `<Cell N="${name}" V="${formatVisioNumber(fractionValue * size)}" F="${axis}*${formatVisioNumber(fractionValue)}"/>`;
  };
  return (
    `<Row T="Ellipse" IX="1">` +
    cell("X", "Width", center.x) +
    cell("Y", "Height", center.y) +
    cell("A", "Width", round(center.x + xRadius)) +
    cell("B", "Height", center.y) +
    cell("C", "Width", center.x) +
    cell("D", "Height", round(center.y + yRadius)) +
    `</Row>`
  );
}

function geometrySection(
  index: number,
  primitive: SymbolPrimitive,
  frame: MasterFrame,
): string {
  const rows: string[] = [];
  let noFill = 1;
  let noLine = 0;

  switch (primitive.kind) {
    case "line": {
      rows.push(relRow("RelMoveTo", 1, frame.fraction(primitive.from)));
      rows.push(relRow("RelLineTo", 2, frame.fraction(primitive.to)));
      break;
    }
    case "polyline": {
      for (const [pointIndex, point] of primitive.points.entries()) {
        rows.push(
          relRow(
            pointIndex === 0 ? "RelMoveTo" : "RelLineTo",
            pointIndex + 1,
            frame.fraction(point),
          ),
        );
      }
      break;
    }
    case "polygon": {
      noFill = primitive.fill === "foreground" ? 0 : 1;
      noLine = primitive.stroke === "none" ? 1 : 0;
      for (const [pointIndex, point] of primitive.points.entries()) {
        rows.push(
          relRow(
            pointIndex === 0 ? "RelMoveTo" : "RelLineTo",
            pointIndex + 1,
            frame.fraction(point),
          ),
        );
      }
      // Visio closes a figure when the last vertex repeats the first; saying so
      // explicitly keeps the outline joined however the reader treats the rest.
      rows.push(
        relRow(
          "RelLineTo",
          rows.length + 1,
          frame.fraction(primitive.points[0]!),
        ),
      );
      break;
    }
    case "circle": {
      noFill = primitive.fill === "foreground" ? 0 : 1;
      noLine = primitive.stroke === "none" ? 1 : 0;
      rows.push(
        ellipseRow(
          frame,
          frame.fraction(primitive.center),
          frame.xScale(primitive.radius),
          frame.yScale(primitive.radius),
        ),
      );
      break;
    }
    case "path": {
      for (const subpath of parseSymbolPathData(primitive.data)) {
        rows.push(
          relRow("RelMoveTo", rows.length + 1, frame.fraction(subpath.start)),
        );
        for (const segment of subpath.segments) {
          rows.push(
            segment.kind === "line"
              ? relRow("RelLineTo", rows.length + 1, frame.fraction(segment.to))
              : relCubicRow(rows.length + 1, {
                  control1: frame.fraction(segment.control1),
                  control2: frame.fraction(segment.control2),
                  to: frame.fraction(segment.to),
                }),
          );
        }
        if (subpath.closed) {
          rows.push(
            relRow("RelLineTo", rows.length + 1, frame.fraction(subpath.start)),
          );
        }
      }
      break;
    }
  }

  return (
    `<Section N="Geometry" IX="${index}">` +
    `<Cell N="NoFill" V="${noFill}"/><Cell N="NoLine" V="${noLine}"/>` +
    `<Cell N="NoShow" V="0"/><Cell N="NoSnap" V="0"/><Cell N="NoQuickDrag" V="0"/>` +
    `${rows.join("")}</Section>`
  );
}

/**
 * One child shape per drawn line weight, each covering the whole group so its
 * geometry fractions and the group's are the same numbers.
 */
function artworkShape(
  shapeId: number,
  style: StrokeStyle,
  primitives: readonly SymbolPrimitive[],
  frame: MasterFrame,
): string {
  const width = formatVisioNumber(frame.widthInches);
  const height = formatVisioNumber(frame.heightInches);
  const halfWidth = formatVisioNumber(frame.widthInches / 2);
  const halfHeight = formatVisioNumber(frame.heightInches / 2);
  const sections = primitives.map((primitive, index) =>
    geometrySection(index, primitive, frame),
  );
  return (
    `<Shape ID="${shapeId}" Type="Shape" LineStyle="0" FillStyle="0" TextStyle="0">` +
    `<Cell N="PinX" V="${halfWidth}" F="Sheet.${GROUP_SHAPE_ID}!Width*0.5"/>` +
    `<Cell N="PinY" V="${halfHeight}" F="Sheet.${GROUP_SHAPE_ID}!Height*0.5"/>` +
    `<Cell N="Width" V="${width}" F="Sheet.${GROUP_SHAPE_ID}!Width*1"/>` +
    `<Cell N="Height" V="${height}" F="Sheet.${GROUP_SHAPE_ID}!Height*1"/>` +
    `<Cell N="LocPinX" V="${halfWidth}" F="Width*0.5"/>` +
    `<Cell N="LocPinY" V="${halfHeight}" F="Height*0.5"/>` +
    `<Cell N="Angle" V="0"/><Cell N="FlipX" V="0"/><Cell N="FlipY" V="0"/>` +
    `<Cell N="ResizeMode" V="0"/>` +
    `<Cell N="LineWeight" V="${formatVisioNumber(style.weightInches)}" U="PT"/>` +
    `<Cell N="LineColor" V="0"/><Cell N="LinePattern" V="1"/><Cell N="Rounding" V="0"/>` +
    `<Cell N="LineCap" V="${style.cap}"/><Cell N="LineColorTrans" V="0"/>` +
    `<Cell N="BeginArrow" V="0"/><Cell N="EndArrow" V="0"/>` +
    // A filled primitive says so on its own geometry section, so the shape's
    // fill only has to be black and opaque for those sections to use.
    `<Cell N="FillForegnd" V="0"/><Cell N="FillBkgnd" V="0"/><Cell N="FillPattern" V="1"/>` +
    `<Cell N="FillForegndTrans" V="0"/><Cell N="FillBkgndTrans" V="0"/><Cell N="ShdwPattern" V="0"/>` +
    `<Cell N="LockTextEdit" V="1"/>` +
    `${sections.join("")}</Shape>`
  );
}

interface ResolvedPin {
  readonly name: string;
  readonly at: { x: number; y: number };
  readonly direction: "north" | "east" | "south" | "west";
}

/**
 * The pins a wire can reach.
 *
 * A variant that hides a pin may still publish a wiring anchor for it at
 * different geometry — the electrical terminal is the same one, drawn where the
 * variant's artwork puts it — so the auxiliary anchor takes the hidden pin's
 * place rather than adding a second connection point.
 */
function resolvePins(
  definition: SymbolDefinition,
  variant: SymbolVariant | undefined,
): ResolvedPin[] {
  const hidden = new Set(variant?.hiddenPinNames ?? []);
  const auxiliary = new Map(
    (variant?.auxiliaryPins ?? []).map((pin) => [pin.name, pin]),
  );
  const pins: ResolvedPin[] = [];
  for (const pin of definition.pins) {
    if (pin.presentation.visibility !== "visible") continue;
    if (hidden.has(pin.name)) {
      const anchor = auxiliary.get(pin.name);
      if (anchor) {
        pins.push({
          name: anchor.name,
          at: anchor.at,
          direction: anchor.direction,
        });
      }
      continue;
    }
    pins.push({ name: pin.name, at: pin.at, direction: pin.direction });
  }
  return pins;
}

/** Outward normal in Visio's page orientation, where y grows upward. */
const OUTWARD: Record<ResolvedPin["direction"], { x: number; y: number }> = {
  north: { x: 0, y: 1 },
  east: { x: 1, y: 0 },
  south: { x: 0, y: -1 },
  west: { x: -1, y: 0 },
};

function connectionSection(
  anchors: readonly { pin: ResolvedPin; connection: VisioConnectionPoint }[],
  frame: MasterFrame,
): string {
  if (anchors.length === 0) return "";
  const rows = anchors.map(({ pin, connection }) => {
    const outward = OUTWARD[pin.direction];
    return (
      `<Row N="${connection.rowName}">` +
      `<Cell N="X" V="${formatVisioNumber(connection.xFraction * frame.widthInches)}" F="Width*${formatVisioNumber(connection.xFraction)}"/>` +
      `<Cell N="Y" V="${formatVisioNumber(connection.yFraction * frame.heightInches)}" F="Height*${formatVisioNumber(connection.yFraction)}"/>` +
      `<Cell N="DirX" V="${outward.x}"/><Cell N="DirY" V="${outward.y}"/>` +
      `<Cell N="Type" V="0"/>` +
      `<Cell N="Prompt" V="${escapeXmlAttribute(connection.pinName)}"/>` +
      `</Row>`
    );
  });
  return `<Section N="Connection">${rows.join("")}</Section>`;
}

function collectCaveats(
  definition: SymbolDefinition,
  primitives: readonly SymbolPrimitive[],
): VisioMasterCaveat[] {
  const caveats: VisioMasterCaveat[] = [];
  for (const pin of definition.pins) {
    if (pin.presentation.showName !== true) continue;
    caveats.push({
      kind: "pin-name-text",
      detail: pin.presentation.displayName ?? pin.name,
    });
  }
  if (definition.formulaPresentation) {
    caveats.push({
      kind: "body-text",
      detail: definition.formulaPresentation.defaultFormula,
    });
  }
  for (const primitive of primitives) {
    if (primitive.part?.startsWith("upright-")) {
      caveats.push({ kind: "upright-mark", detail: primitive.part });
    }
  }
  return caveats;
}

export function buildSymbolMaster(
  source: VisioMasterSource,
  masterId: number,
  profile: SchematicStyleProfile = razaviTextbookProfile,
): VisioSymbolMaster {
  const { definition, variant } = source;
  if (!symbolHasVisioMaster(definition)) {
    throw new Error(
      `Symbol "${definition.id}" is drawn from its formula and has no fixed master`,
    );
  }
  const frame = masterFrame(definition);
  const primitives = visiblePrimitives(definition, variant);

  // Grouped by drawn weight, in the order the artwork first uses each one, so
  // the child shapes stack in authoring order.
  const buckets = new Map<
    string,
    { style: StrokeStyle; primitives: SymbolPrimitive[] }
  >();
  for (const primitive of primitives) {
    const style = strokeStyle(primitive, profile);
    const key = strokeStyleKey(style);
    const bucket = buckets.get(key);
    if (bucket) bucket.primitives.push(primitive);
    else buckets.set(key, { style, primitives: [primitive] });
  }

  const pins = resolvePins(definition, variant);
  const anchors = pins.map((pin, index) => {
    const fraction = frame.fraction(pin.at);
    return {
      pin,
      connection: {
        pinName: pin.name,
        rowName: `Row_${index + 1}`,
        xFraction: fraction.x,
        yFraction: fraction.y,
      } satisfies VisioConnectionPoint,
    };
  });
  const connections = anchors.map((anchor) => anchor.connection);

  const children = [...buckets.values()].map((bucket, index) =>
    artworkShape(
      GROUP_SHAPE_ID + 1 + index,
      bucket.style,
      bucket.primitives,
      frame,
    ),
  );

  const variantId = variant?.id;
  const key = visioSymbolMasterKey(definition.id, variantId);
  const name = source.disambiguate
    ? `${definition.name} (${variantId ?? "base"})`
    : definition.name;
  const escapedName = escapeXmlAttribute(name);
  const width = formatVisioNumber(frame.widthInches);
  const height = formatVisioNumber(frame.heightInches);
  const halfWidth = formatVisioNumber(frame.widthInches / 2);
  const halfHeight = formatVisioNumber(frame.heightInches / 2);

  const group =
    `<Shape ID="${GROUP_SHAPE_ID}" NameU="${escapedName}" IsCustomNameU="1" Name="${escapedName}" IsCustomName="1"` +
    ` Type="Group" LineStyle="0" FillStyle="0" TextStyle="0">` +
    `<Cell N="PinX" V="${halfWidth}"/><Cell N="PinY" V="${halfHeight}"/>` +
    `<Cell N="Width" V="${width}"/><Cell N="Height" V="${height}"/>` +
    `<Cell N="LocPinX" V="${halfWidth}" F="Width*0.5"/>` +
    `<Cell N="LocPinY" V="${halfHeight}" F="Height*0.5"/>` +
    `<Cell N="Angle" V="0"/><Cell N="FlipX" V="0"/><Cell N="FlipY" V="0"/>` +
    `<Cell N="ResizeMode" V="0"/>` +
    // Schematic artwork only ever scales uniformly: stretching one axis would
    // move the pins off the connection grid and distort the reference drawing.
    `<Cell N="LockAspect" V="1"/>` +
    `<Cell N="LineColor" V="0"/><Cell N="LinePattern" V="1"/><Cell N="FillPattern" V="0"/>` +
    `<Cell N="ShdwPattern" V="0"/><Cell N="TextBkgnd" V="0"/>` +
    connectionSection(anchors, frame) +
    (children.length === 0 ? "" : `<Shapes>${children.join("")}</Shapes>`) +
    `</Shape>`;

  return {
    key,
    symbolId: definition.id,
    variantId,
    connections,
    caveats: collectCaveats(definition, primitives),
    master: {
      id: masterId,
      name,
      prompt: definition.name,
      uniqueId: visioGuid(`${GUID_NAMESPACE}/unique/${key}`),
      baseId: visioGuid(`${GUID_NAMESPACE}/base/${key}`),
      widthInches: frame.widthInches,
      heightInches: frame.heightInches,
      shapes: `<Shapes>${group}</Shapes>`,
    },
  };
}

/** Every reachable symbol and variant as a master, numbered from 1. */
export function buildSymbolMasters(
  definitions: readonly SymbolDefinition[],
  profile: SchematicStyleProfile = razaviTextbookProfile,
): VisioSymbolMaster[] {
  return enumerateVisioMasterSources(definitions).map((source, index) =>
    buildSymbolMaster(source, index + 1, profile),
  );
}
