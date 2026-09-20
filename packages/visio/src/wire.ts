/**
 * Wires and nodes on the page.
 *
 * A Route becomes a Visio dynamic connector glued to the connection points of
 * the symbols it joins. That is the whole reason this export exists: a glued
 * connector follows the pin when the transistor moves, so the drawing stays a
 * circuit under editing instead of coming apart into loose lines.
 *
 * Every cell here was taken from the dynamic connector Visio itself ships
 * (`BASICELECTRICAL_DIAGRAM_M.VSTX`, master 23) rather than invented. The
 * connector's frame is defined by its endpoints — `Width` is `EndX-BeginX` and
 * the geometry is expressed in a local frame whose origin is the begin point —
 * so gluing an end moves the frame, and the line follows.
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

/** Which end of a connector a `<Connect>` record glues. */
export const CONNECT_BEGIN_PART = 9;
export const CONNECT_END_PART = 12;

/** `ToPart` of the first connection point row; later rows count up from it. */
export const CONNECTION_POINT_PART = 100;

/**
 * The connector master.
 *
 * `ObjType` 2 marks the shape routable, which is what makes Visio treat it as a
 * connector: it can be glued, it is skipped by layout, and the connector tools
 * in the ribbon act on it. `LockHeight` and `LockCalcWH` stop a user from
 * resizing a wire by its handles — the endpoints own its extent.
 *
 * The geometry is a plain segment whose far end tracks `Width`/`Height`, so a
 * straight wire needs no geometry of its own and stretches exactly with its
 * endpoints. A wire with bends overrides the section.
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
    `<Cell N="NoAlignBox" V="1"/><Cell N="DynFeedback" V="2"/><Cell N="GlueType" V="2"/>` +
    `<Cell N="ObjType" V="2"/><Cell N="NoLiveDynamics" V="1"/><Cell N="ShapeSplittable" V="1"/>` +
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
    masterType: "connector",
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

export interface WireShape {
  readonly id: number;
  readonly masterId: number;
  /** Page points, begin first; at least two. */
  readonly points: readonly PagePoint[];
  readonly begin: WireGlue | undefined;
  readonly end: WireGlue | undefined;
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
 * A wire on the page.
 *
 * The geometry rows are absolute coordinates in a local frame whose origin is
 * the begin point, which is why every bend is written as an offset from it. The
 * last row carries `Width`/`Height` formulas so the far end of the line follows
 * the far end of the shape.
 */
export function wireShape(wire: WireShape): string {
  const [begin, ...rest] = wire.points;
  const last = wire.points.at(-1);
  if (!begin || !last || wire.points.length < 2) {
    throw new Error(
      `A Visio wire needs at least two points (shape ${wire.id})`,
    );
  }
  const width = last.x - begin.x;
  const height = last.y - begin.y;
  const rows = [
    `<Row T="MoveTo" IX="1"><Cell N="X" V="0"/><Cell N="Y" V="0"/></Row>`,
    ...rest.map((point, index) => {
      const x = point.x - begin.x;
      const y = point.y - begin.y;
      const isLast = index === rest.length - 1;
      return (
        `<Row T="LineTo" IX="${index + 2}">` +
        `<Cell N="X" V="${formatVisioNumber(x)}"${isLast ? ' F="Width*1"' : ""}/>` +
        `<Cell N="Y" V="${formatVisioNumber(y)}"${isLast ? ' F="Height*1"' : ""}/>` +
        `</Row>`
      );
    }),
  ];
  const trigger = (which: "Beg" | "End", glue: WireGlue | undefined): string =>
    glue
      ? `<Cell N="${which}Trigger" V="2" F="_XFTRIGGER(Sheet.${glue.sheetId}!EventXFMod)"/>`
      : "";
  return (
    `<Shape ID="${wire.id}" Type="Shape" Master="${wire.masterId}">` +
    `<Cell N="PinX" V="${formatVisioNumber(begin.x + width / 2)}" F="GUARD((BeginX+EndX)/2)"/>` +
    `<Cell N="PinY" V="${formatVisioNumber(begin.y + height / 2)}" F="GUARD((BeginY+EndY)/2)"/>` +
    `<Cell N="Width" V="${formatVisioNumber(width)}" F="GUARD(EndX-BeginX)"/>` +
    `<Cell N="Height" V="${formatVisioNumber(height)}" F="GUARD(EndY-BeginY)"/>` +
    `<Cell N="LocPinX" V="${formatVisioNumber(width / 2)}" F="GUARD(Width*0.5)"/>` +
    `<Cell N="LocPinY" V="${formatVisioNumber(height / 2)}" F="GUARD(Height*0.5)"/>` +
    endpointCells("X", "Begin", begin.x, wire.begin) +
    endpointCells("Y", "Begin", begin.y, wire.begin) +
    endpointCells("X", "End", last.x, wire.end) +
    endpointCells("Y", "End", last.y, wire.end) +
    trigger("Beg", wire.begin) +
    trigger("End", wire.end) +
    wire.propertySection +
    `<Section N="Geometry" IX="0">${rows.join("")}</Section>` +
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
