/**
 * Wires and nodes on the page.
 *
 * A Route becomes a *chain* of one-dimensional Visio shapes — one straight link
 * per run, one more for each hop over a crossing — whose ends are glued to the
 * connection points of the symbols it joins and, in between, to invisible nodes
 * at each seam. That is the whole reason this export exists: a glued end
 * follows the pin when the transistor moves, so the drawing stays a circuit
 * under editing instead of coming apart into loose lines.
 *
 * The chain is what makes a bend editable. A one-dimensional shape has exactly
 * two adjustable ends, so a run written as one shape offers two handles no
 * matter how many corners it turns; every interior bend is a number in the
 * file rather than something the hand can reach. Give each run its own shape
 * and glue the seams, and every corner becomes a node a user can drag with
 * both of its links following.
 *
 * Gluing is a property of a one-dimensional shape, not of a connector, so the
 * wire is deliberately *not* routable. A routable shape is Visio's dynamic
 * connector: it treats the path as its own to recompute, and it re-routes the
 * wire the moment anything moves or is nudged. The path here is the one the
 * schematic drew, and Visio must leave it alone; the cost is that dragging one
 * end turns that link into a diagonal, which is what a drawn line does.
 *
 * The frame is defined by the endpoints — `Width` is `EndX-BeginX` and the
 * geometry is expressed in a local frame whose origin is the begin point — so
 * gluing an end moves the frame, and the link follows.
 */

import type { VisioMaster } from "./masters.js";
import { visioGuid } from "./identifier.js";
import type { PagePoint } from "./geometry.js";
import { formatVisioNumber } from "./xml.js";

/** Namespace the wiring identifiers are hashed under. */
const GUID_NAMESPACE = "schematic-draft/visio/wire";

export const WIRE_MASTER_NAME = "Wire";
export const NODE_MASTER_NAME = "Node";

/** Shape ID the shapes inside a master part must start at; see `symbol-master`. */
const MASTER_SHAPE_ID = 5;

/** The connector master's own size; every instance overrides it. */
const WIRE_EXTENT_INCHES = 0.125;

/** Which end of a wire a `<Connect>` record glues. */
export const CONNECT_BEGIN_PART = 9;
export const CONNECT_END_PART = 12;

/** `ToPart` of the first connection point row; later rows count up from it. */
export const CONNECTION_POINT_PART = 100;

/**
 * The wire master.
 *
 * `ObjType` 1 marks the shape explicitly non-routable. The cell has to be
 * written rather than omitted: left unset, Visio decides for itself, and a
 * one-dimensional shape glued at both ends is exactly what it decides is a
 * connector. `LockHeight` and `LockCalcWH` stop a user from resizing a wire by
 * its handles — the endpoints own its extent.
 *
 * The geometry is a plain segment whose far end tracks `Width`/`Height`, which
 * is exactly what a straight link needs, so a link stretches with its
 * endpoints and nothing else. A link that hops a crossing overrides the
 * section with an arc.
 */
export function wireMaster(id: number, strokeInches: number): VisioMaster {
  const extent = formatVisioNumber(WIRE_EXTENT_INCHES);
  const half = formatVisioNumber(WIRE_EXTENT_INCHES / 2);
  const shape =
    `<Shape ID="${MASTER_SHAPE_ID}" Type="Shape" LineStyle="0" FillStyle="0" TextStyle="0">` +
    `<Cell N="PinX" V="${half}" F="GUARD((BeginX+EndX)/2)"/>` +
    `<Cell N="PinY" V="${half}" F="GUARD((BeginY+EndY)/2)"/>` +
    `<Cell N="Width" V="${extent}" F="GUARD(EndX-BeginX)"/>` +
    `<Cell N="Height" V="0" F="GUARD(EndY-BeginY)"/>` +
    `<Cell N="LocPinX" V="${half}" F="GUARD(Width*0.5)"/>` +
    `<Cell N="LocPinY" V="0" F="GUARD(Height*0.5)"/>` +
    `<Cell N="Angle" V="0" F="GUARD(0DA)"/>` +
    `<Cell N="FlipX" V="0" F="GUARD(FALSE)"/><Cell N="FlipY" V="0" F="GUARD(FALSE)"/>` +
    `<Cell N="ResizeMode" V="0"/>` +
    `<Cell N="BeginX" V="0"/><Cell N="BeginY" V="${half}"/>` +
    `<Cell N="EndX" V="${extent}"/><Cell N="EndY" V="${half}"/>` +
    `<Cell N="LockHeight" V="1"/><Cell N="LockCalcWH" V="1"/>` +
    `<Cell N="NoAlignBox" V="1"/><Cell N="GlueType" V="2"/>` +
    `<Cell N="ObjType" V="1"/>` +
    `<Cell N="LineWeight" V="${formatVisioNumber(strokeInches)}" U="PT"/>` +
    `<Cell N="LineColor" V="0"/><Cell N="LinePattern" V="1"/><Cell N="Rounding" V="0"/>` +
    // Visio has no butt cap; square ends the stroke at the endpoint too, and a
    // wire meets a pin exactly on it.
    `<Cell N="LineCap" V="1"/>` +
    `<Cell N="BeginArrow" V="0"/><Cell N="EndArrow" V="0"/>` +
    `<Cell N="FillPattern" V="0"/><Cell N="ShdwPattern" V="0"/>` +
    `<Section N="Geometry" IX="0">` +
    `<Cell N="NoFill" V="1"/><Cell N="NoLine" V="0"/>` +
    `<Cell N="NoShow" V="0"/><Cell N="NoSnap" V="0"/><Cell N="NoQuickDrag" V="0"/>` +
    `<Row T="MoveTo" IX="1"><Cell N="X" V="0"/><Cell N="Y" V="0"/></Row>` +
    `<Row T="LineTo" IX="2">` +
    `<Cell N="X" V="${extent}" F="Width*1"/><Cell N="Y" V="0" F="Height*1"/>` +
    `</Row>` +
    `</Section>` +
    `</Shape>`;
  return {
    id,
    name: WIRE_MASTER_NAME,
    prompt: "Schematic wire",
    uniqueId: visioGuid(`${GUID_NAMESPACE}/unique/wire`),
    baseId: visioGuid(`${GUID_NAMESPACE}/base/wire`),
    widthInches: WIRE_EXTENT_INCHES,
    heightInches: WIRE_EXTENT_INCHES,
    shapes: `<Shapes>${shape}</Shapes>`,
  };
}

/**
 * The node master: the filled dot that marks a branch, and the thing a wire
 * glues to when it ends on a Junction rather than a pin.
 *
 * Its single connection point sits at the centre, so any number of wires meet
 * at one place and stay met when the node is dragged. A node that no dot is
 * drawn for still exists as a shape — invisible, but a glue target — because a
 * corner where two Routes meet has to hold together as well as a branch does.
 */
export function nodeMaster(id: number, radiusInches: number): VisioMaster {
  const size = formatVisioNumber(radiusInches * 2);
  const half = formatVisioNumber(radiusInches);
  const shape =
    `<Shape ID="${MASTER_SHAPE_ID}" NameU="${NODE_MASTER_NAME}" IsCustomNameU="1"` +
    ` Name="${NODE_MASTER_NAME}" IsCustomName="1" Type="Shape" LineStyle="0" FillStyle="0" TextStyle="0">` +
    `<Cell N="PinX" V="${half}"/><Cell N="PinY" V="${half}"/>` +
    `<Cell N="Width" V="${size}"/><Cell N="Height" V="${size}"/>` +
    `<Cell N="LocPinX" V="${half}" F="Width*0.5"/><Cell N="LocPinY" V="${half}" F="Height*0.5"/>` +
    `<Cell N="Angle" V="0"/><Cell N="FlipX" V="0"/><Cell N="FlipY" V="0"/>` +
    `<Cell N="ResizeMode" V="0"/><Cell N="LockAspect" V="1"/>` +
    `<Cell N="LineWeight" V="0"/><Cell N="LineColor" V="0"/><Cell N="LinePattern" V="0"/>` +
    `<Cell N="FillForegnd" V="0"/><Cell N="FillBkgnd" V="0"/><Cell N="FillPattern" V="1"/>` +
    `<Cell N="FillForegndTrans" V="0"/><Cell N="FillBkgndTrans" V="0"/><Cell N="ShdwPattern" V="0"/>` +
    `<Cell N="LockTextEdit" V="1"/>` +
    `<Section N="Connection"><Row N="Row_1">` +
    `<Cell N="X" V="${half}" F="Width*0.5"/><Cell N="Y" V="${half}" F="Height*0.5"/>` +
    `<Cell N="DirX" V="0"/><Cell N="DirY" V="0"/><Cell N="Type" V="0"/>` +
    `</Row></Section>` +
    `<Section N="Geometry" IX="0">` +
    `<Cell N="NoFill" V="0"/><Cell N="NoLine" V="1"/>` +
    `<Cell N="NoShow" V="0"/><Cell N="NoSnap" V="0"/><Cell N="NoQuickDrag" V="0"/>` +
    `<Row T="Ellipse" IX="1">` +
    `<Cell N="X" V="${half}" F="Width*0.5"/><Cell N="Y" V="${half}" F="Height*0.5"/>` +
    `<Cell N="A" V="${size}" F="Width*1"/><Cell N="B" V="${half}" F="Height*0.5"/>` +
    `<Cell N="C" V="${half}" F="Width*0.5"/><Cell N="D" V="${size}" F="Height*1"/>` +
    `</Row></Section>` +
    `</Shape>`;
  return {
    id,
    name: NODE_MASTER_NAME,
    prompt: "Schematic node",
    uniqueId: visioGuid(`${GUID_NAMESPACE}/unique/node`),
    baseId: visioGuid(`${GUID_NAMESPACE}/base/node`),
    widthInches: radiusInches * 2,
    heightInches: radiusInches * 2,
    shapes: `<Shapes>${shape}</Shapes>`,
  };
}

/** Where a wire end is glued, when it is glued to anything. */
export interface WireGlue {
  /** Page shape ID of the shape being glued to. */
  readonly sheetId: number;
  /** Connection row name on that shape, such as `Row_2`. */
  readonly rowName: string;
  /** Zero-based position of that row in its Connection section. */
  readonly rowIndex: number;
}

/**
 * One link of a wire chain: a straight run between two page points, or the
 * single arc that hops a crossing.
 *
 * Both ends may be glued — to a pin, to a Junction's node, or to the invisible
 * node the page puts at the seam this link shares with its neighbour.
 */
export interface WireShape {
  readonly id: number;
  readonly masterId: number;
  /** Where the link begins. */
  readonly from: PagePoint;
  /** Where it ends. */
  readonly to: PagePoint;
  /**
   * A point *on* the arc, for the link that hops a crossing. Omitted for a
   * straight run, which is what almost every link is.
   *
   * Visio has no line-jump of its own, so a hop has to be drawn. Stating it as
   * a point the arc passes through rather than as a direction and a sweep flag
   * is what lets the same numbers survive the page frame's y-flip without a
   * second handedness rule.
   */
  readonly through?: PagePoint;
  readonly begin: WireGlue | undefined;
  readonly end: WireGlue | undefined;
  /**
   * Line weight in inches for this link alone. Omitted when the wire is drawn
   * at the master's weight, so a drawing that scales nothing writes the shape
   * it always wrote and every link keeps inheriting one cell.
   */
  readonly lineWeightInches?: number;
  /** Shape Data rows, already serialized by `shapeDataSection`. */
  readonly propertySection: string;
}

function endpointCells(
  axis: "X" | "Y",
  which: "Begin" | "End",
  value: number,
  glue: WireGlue | undefined,
): string {
  const formula = glue
    ? ` F="PAR(PNT(Sheet.${glue.sheetId}!Connections.${glue.rowName}.X,Sheet.${glue.sheetId}!Connections.${glue.rowName}.Y))"`
    : "";
  return `<Cell N="${which}${axis}" V="${formatVisioNumber(value)}"${formula}/>`;
}

/**
 * One link of a wire on the page.
 *
 * The geometry is a single row in a local frame whose origin is the begin
 * point, and it carries `Width`/`Height` formulas so the far end of the drawn
 * line follows the far end of the shape. That is the whole point of the chain:
 * a two-point link has nothing written into it that a moved end could
 * contradict, so gluing an end is enough to keep the drawing honest.
 *
 * An arc keeps its apex as a literal local offset. A hop is a fixed-size
 * detour around a crossing rather than a proportion of the run, so it should
 * not scale when the link it belongs to is stretched.
 */
export function wireShape(wire: WireShape): string {
  const { from, to } = wire;
  const width = to.x - from.x;
  const height = to.y - from.y;
  const farEnd =
    `<Cell N="X" V="${formatVisioNumber(width)}" F="Width*1"/>` +
    `<Cell N="Y" V="${formatVisioNumber(height)}" F="Height*1"/>`;
  const path = wire.through
    ? // A, B is a point the arc passes through; C and D make it circular.
      `<Row T="EllipticalArcTo" IX="2">${farEnd}` +
      `<Cell N="A" V="${formatVisioNumber(wire.through.x - from.x)}"/>` +
      `<Cell N="B" V="${formatVisioNumber(wire.through.y - from.y)}"/>` +
      `<Cell N="C" V="0"/><Cell N="D" V="1"/>` +
      `</Row>`
    : `<Row T="LineTo" IX="2">${farEnd}</Row>`;
  const trigger = (which: "Beg" | "End", glue: WireGlue | undefined): string =>
    glue
      ? `<Cell N="${which}Trigger" V="2" F="_XFTRIGGER(Sheet.${glue.sheetId}!EventXFMod)"/>`
      : "";
  return (
    `<Shape ID="${wire.id}" Type="Shape" Master="${wire.masterId}">` +
    `<Cell N="PinX" V="${formatVisioNumber(from.x + width / 2)}" F="GUARD((BeginX+EndX)/2)"/>` +
    `<Cell N="PinY" V="${formatVisioNumber(from.y + height / 2)}" F="GUARD((BeginY+EndY)/2)"/>` +
    `<Cell N="Width" V="${formatVisioNumber(width)}" F="GUARD(EndX-BeginX)"/>` +
    `<Cell N="Height" V="${formatVisioNumber(height)}" F="GUARD(EndY-BeginY)"/>` +
    `<Cell N="LocPinX" V="${formatVisioNumber(width / 2)}" F="GUARD(Width*0.5)"/>` +
    `<Cell N="LocPinY" V="${formatVisioNumber(height / 2)}" F="GUARD(Height*0.5)"/>` +
    endpointCells("X", "Begin", from.x, wire.begin) +
    endpointCells("Y", "Begin", from.y, wire.begin) +
    endpointCells("X", "End", to.x, wire.end) +
    endpointCells("Y", "End", to.y, wire.end) +
    trigger("Beg", wire.begin) +
    trigger("End", wire.end) +
    (wire.lineWeightInches === undefined
      ? ""
      : `<Cell N="LineWeight" V="${formatVisioNumber(wire.lineWeightInches)}" U="PT"/>`) +
    wire.propertySection +
    `<Section N="Geometry" IX="0">` +
    `<Row T="MoveTo" IX="1"><Cell N="X" V="0"/><Cell N="Y" V="0"/></Row>` +
    path +
    `</Section>` +
    `</Shape>`
  );
}

/** One `<Connect>` record; the page collects them after its shapes. */
export function connectRecord(
  wireId: number,
  which: "begin" | "end",
  glue: WireGlue,
): string {
  const fromCell = which === "begin" ? "BeginX" : "EndX";
  const fromPart = which === "begin" ? CONNECT_BEGIN_PART : CONNECT_END_PART;
  return (
    `<Connect FromSheet="${wireId}" FromCell="${fromCell}" FromPart="${fromPart}"` +
    ` ToSheet="${glue.sheetId}" ToCell="Connections.${glue.rowName}.X"` +
    ` ToPart="${CONNECTION_POINT_PART + glue.rowIndex}"/>`
  );
}

/** A node shape placed at a page point. */
export function nodeShape(
  id: number,
  masterId: number,
  at: PagePoint,
  visible: boolean,
): string {
  return (
    `<Shape ID="${id}" Type="Shape" Master="${masterId}">` +
    `<Cell N="PinX" V="${formatVisioNumber(at.x)}"/>` +
    `<Cell N="PinY" V="${formatVisioNumber(at.y)}"/>` +
    // A dotless node is still a glue target; hiding it keeps a corner from
    // growing a branch dot the schematic does not draw.
    (visible ? "" : `<Cell N="FillPattern" V="0"/>`) +
    `</Shape>`
  );
}
