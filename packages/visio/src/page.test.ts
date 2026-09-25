import {
  createEmptyDocument,
  createRoutePath,
  transformPoint,
} from "@icm/model";
import type { SchematicDocument } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { buildVisioPage, packVisioDocument } from "./page.js";
import { PAGE_CONTENTS_PART } from "./parts.js";
import { DOCUMENT_UNITS_PER_INCH } from "./units.js";
import { formatVisioNumber } from "./xml.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

/** Where a placed resistor's pin sits in the document. */
function pinPoint(
  instance: SchematicDocument["instances"][number],
  pinName: string,
): { x: number; y: number } {
  const symbol = resolver.resolve(instance.symbolId, instance.symbolVariantId)!;
  const pin = symbol.definition.pins.find(
    (candidate) => candidate.name === pinName,
  )!;
  const placement = instance.placement!;
  return transformPoint(pin.at, placement.position, placement);
}

function resistor(
  id: string,
  reference: string,
  x: number,
  y: number,
  rotation: 0 | 90 = 0,
): SchematicDocument["instances"][number] {
  return {
    id,
    symbolId: "resistor",
    reference,
    placement: { position: { x, y }, rotation, mirror: "none" },
    netlist: {
      binding: { kind: "primitive", deviceClass: "resistor" },
      parameters: { r: "10k" },
    },
  };
}

/**
 * Two resistors joined by one wire that turns a right angle on the way: the
 * smallest document whose Route has a corner Visio has to hold open.
 */
function cornerDocument(): SchematicDocument {
  const document = createEmptyDocument("doc-corner", "Corner");
  const left = resistor("R1", "R1", 0, 0);
  const right = resistor("R2", "R2", 120, 80);
  document.instances.push(left, right);
  document.nets.push({
    id: "net-corner",
    terminals: [
      { instanceId: "R1", pinName: "2" },
      { instanceId: "R2", pinName: "1" },
    ],
  });
  const from = pinPoint(left, "2");
  const to = pinPoint(right, "1");
  document.routes.push(
    createRoutePath({
      id: "route-corner",
      netId: "net-corner",
      start: { kind: "terminal", instanceId: "R1", pinName: "2" },
      end: { kind: "terminal", instanceId: "R2", pinName: "1" },
      // Along, then down: neither leg is degenerate, so the corner is real.
      bends: [{ x: to.x, y: from.y }],
      modes: ["manual", "manual"],
    }),
  );
  return document;
}

/**
 * Three resistors meeting at one Junction: the smallest document with a branch
 * in it, which is what makes a junction dot, three glued wire ends at one node,
 * and a bend all appear at once.
 */
function branchDocument(): SchematicDocument {
  const document = createEmptyDocument("doc-branch", "Branch");
  const top = resistor("R1", "R1", 0, -40);
  const bottom = resistor("R2", "R2", 0, 60);
  const side = resistor("R3", "R3", 80, 20, 90);
  document.instances.push(top, bottom, side);
  document.nets.push({
    id: "net-mid",
    terminals: [
      { instanceId: "R1", pinName: "2" },
      { instanceId: "R2", pinName: "1" },
      { instanceId: "R3", pinName: "1" },
    ],
  });
  document.junctions.push({
    id: "J1",
    netId: "net-mid",
    position: { x: 0, y: 20 },
  });
  const sidePin = pinPoint(side, "1");
  document.routes.push(
    createRoutePath({
      id: "route-top",
      netId: "net-mid",
      start: { kind: "terminal", instanceId: "R1", pinName: "2" },
      end: { kind: "junction", junctionId: "J1" },
      bends: [],
      modes: ["manual"],
    }),
    createRoutePath({
      id: "route-bottom",
      netId: "net-mid",
      start: { kind: "junction", junctionId: "J1" },
      end: { kind: "terminal", instanceId: "R2", pinName: "1" },
      bends: [],
      modes: ["manual"],
    }),
    createRoutePath({
      id: "route-side",
      netId: "net-mid",
      start: { kind: "junction", junctionId: "J1" },
      end: { kind: "terminal", instanceId: "R3", pinName: "1" },
      bends: [{ x: sidePin.x, y: 20 }],
      modes: ["manual", "manual"],
    }),
  );
  return document;
}

const document = branchDocument();
const built = buildVisioPage(document, resolver);

/**
 * The same branch, labelled: a designator that belongs to a device and a Net
 * Label that belongs to nobody, which are the two ways a label is placed.
 */
function labelledDocument(): SchematicDocument {
  const labelled = branchDocument();
  labelled.connectivityEvidence.push({
    id: "claim-mid",
    kind: "name-claim",
    netId: "net-mid",
    name: "MID",
    owner: { kind: "net-label", annotationId: "ann-net" },
    scope: "global",
  });
  labelled.annotations.push(
    {
      id: "ann-label",
      kind: "instance-label",
      binding: { kind: "instance-reference", instanceId: "R3" },
      anchor: {
        kind: "object",
        objectId: "R3",
        // To the right of R3, which is the right of the whole drawing: a
        // designator is often the outermost thing on a schematic.
        localOffset: { x: 24, y: -6 },
        fallbackPosition: { x: 104, y: 14 },
      },
      alignment: "start",
      rotation: 0,
      locked: false,
    },
    {
      id: "ann-net",
      kind: "net-label",
      netId: "net-mid",
      binding: { kind: "net-name", netId: "net-mid" },
      anchor: { kind: "free", position: { x: 8, y: 16 } },
      alignment: "start",
      rotation: 0,
      locked: false,
    },
  );
  return labelled;
}

/** Every page-level `<Shape …>` opening tag, in document order. */
function shapeTags(body: string): string[] {
  return [...body.matchAll(/<Shape [^>]* Master="[^"]*">/g)].map(
    (match) => match[0],
  );
}

/** Every `<Shape …>` tag, page-level and group child alike. */
function everyShapeTag(body: string): string[] {
  return [...body.matchAll(/<Shape [^>]*\/?>/g)].map((match) => match[0]);
}

function attribute(tag: string, name: string): string | undefined {
  return new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1];
}

/** `V` of a named cell within one shape's XML. */
function cell(shape: string, name: string): string | undefined {
  return new RegExp(`<Cell N="${name}" V="([^"]*)"`).exec(shape)?.[1];
}

function shapeXml(body: string, id: number): string {
  const start = body.indexOf(`<Shape ID="${id}" `);
  expect(start).toBeGreaterThanOrEqual(0);
  return body.slice(start, body.indexOf("</Shape>", start));
}

describe("buildVisioPage", () => {
  it("puts one shape on the page for every drawn object", () => {
    // Every Route here runs straight, so every Route is one link and no seam
    // node is needed to hold a corner together.
    expect(built.counts).toEqual({
      instanceShapes: 3,
      nodeShapes: 1,
      seamNodeShapes: 0,
      wireShapes: 3,
      textShapes: 0,
      formulaShapes: 0,
      glue: 6,
    });
    expect(shapeTags(built.body)).toHaveLength(7);
  });

  it("gives every shape a distinct sheet ID", () => {
    // Group children included: they take page IDs too, and a collision is how
    // Visio comes to drop a shape that the file plainly contains.
    const ids = everyShapeTag(built.body).map((tag) => attribute(tag, "ID"));
    expect(ids).toHaveLength(10);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => Number(id) >= 5)).toBe(true);
  });

  it("declares the artwork a placed group instantiates", () => {
    // Visio numbers the children of a placed group from the group's own ID up,
    // taking the page's IDs whether or not the file offered them. A page that
    // leaves them out loses the shapes holding those numbers, silently, on
    // open — so each instance declares its master's artwork and the next
    // instance starts past it.
    const instance = shapeXml(built.body, 5);
    expect(instance).toContain(
      '<Shapes><Shape ID="6" Type="Shape" MasterShape="6"/></Shapes>',
    );
    expect(attribute(shapeTags(built.body)[0]!, "Type")).toBe("Group");
    expect(
      shapeTags(built.body).map((tag) => Number(attribute(tag, "ID"))),
    ).toEqual([5, 7, 9, 11, 12, 13, 14]);
  });

  it("carries one master for each symbol plus the wire and the node", () => {
    expect(built.masters.map((master) => master.name)).toEqual([
      "Resistor",
      "Wire",
      "Node",
    ]);
  });

  it("names a master every page shape can resolve", () => {
    const declared = new Set(built.masters.map((master) => String(master.id)));
    for (const tag of shapeTags(built.body)) {
      expect(declared).toContain(attribute(tag, "Master"));
    }
  });

  it("draws a wire as a line segment Visio may not re-route", () => {
    const wire = built.masters.find((master) => master.name === "Wire")!;
    // ObjType 1 is "explicitly not routable". Omitting the cell is not the
    // same thing: Visio then decides for itself, and a one-dimensional shape
    // glued at both ends is exactly what it decides is a connector — which is
    // free to throw away the path the schematic drew and compute its own.
    expect(wire.shapes).toContain('<Cell N="ObjType" V="1"/>');
    expect(wire.shapes).not.toContain("NoLiveDynamics");
    expect(wire.shapes).not.toContain("ShapeSplittable");
    // Gluing survives: that is a property of the one-dimensional shape, and it
    // is the whole reason a wire end follows its pin.
    expect(wire.shapes).toContain('<Cell N="GlueType" V="2"/>');
  });

  it("glues both ends of every wire", () => {
    const connects = [...built.body.matchAll(/<Connect [^>]*>/g)].map(
      (match) => match[0],
    );
    expect(connects).toHaveLength(6);
    expect(
      connects.filter((connect) => attribute(connect, "FromPart") === "9"),
    ).toHaveLength(3);
    expect(
      connects.filter((connect) => attribute(connect, "FromPart") === "12"),
    ).toHaveLength(3);
  });

  it("points every glue record at a connection row that exists", () => {
    const shapesById = new Map(
      shapeTags(built.body).map((tag) => [attribute(tag, "ID")!, tag]),
    );
    const mastersById = new Map(
      built.masters.map((master) => [String(master.id), master]),
    );
    for (const match of built.body.matchAll(/<Connect [^>]*>/g)) {
      const connect = match[0];
      const toSheet = attribute(connect, "ToSheet")!;
      const shape = shapesById.get(toSheet);
      expect(shape, `shape ${toSheet}`).toBeDefined();
      const master = mastersById.get(attribute(shape!, "Master")!)!;
      const rows = [
        ...master.shapes.matchAll(/<Section N="Connection">(.*?)<\/Section>/gs),
      ].flatMap((section) =>
        [...section[1]!.matchAll(/<Row N="([^"]+)"/g)].map(
          (row) => row[1] as string,
        ),
      );
      const rowName = /Connections\.([^.]+)\.X/.exec(
        attribute(connect, "ToCell")!,
      )?.[1];
      expect(rows).toContain(rowName);
      // ToPart counts from 100 up in row order, which is how Visio finds the
      // row again after the shape is renamed or the file round-trips.
      expect(Number(attribute(connect, "ToPart"))).toBe(
        100 + rows.indexOf(rowName!),
      );
    }
  });

  it("glues a wire end to the pin the Route names", () => {
    const connects = [...built.body.matchAll(/<Connect [^>]*>/g)].map(
      (match) => match[0],
    );
    // route-top starts at R1 pin 2, which is the resistor's second connection
    // row; the wire shapes follow the instances, so its sheet ID is the highest.
    const toRowTwo = connects.filter(
      (connect) => attribute(connect, "ToCell") === "Connections.Row_2.X",
    );
    expect(toRowTwo).toHaveLength(1);
    expect(attribute(toRowTwo[0]!, "ToPart")).toBe("101");
  });

  it("keeps every shape on the page", () => {
    for (const name of ["PinX", "BeginX", "EndX"]) {
      for (const match of built.body.matchAll(
        new RegExp(`<Cell N="${name}" V="([^"]*)"`, "g"),
      )) {
        const value = Number(match[1]);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(built.page.widthInches);
      }
    }
    for (const name of ["PinY", "BeginY", "EndY"]) {
      for (const match of built.body.matchAll(
        new RegExp(`<Cell N="${name}" V="([^"]*)"`, "g"),
      )) {
        const value = Number(match[1]);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(built.page.heightInches);
      }
    }
  });

  it("places the junction dot where the schematic draws it", () => {
    const node = shapeXml(built.body, 11);
    expect(attribute(node, "Master")).toBe("3");
    // The branch is at document (0, 20); the drawing's left edge is the left
    // of R1's box at x = -10, and the page adds its quarter-inch margin.
    expect(Number(cell(node, "PinX"))).toBeCloseTo(
      0.25 + 10 / DOCUMENT_UNITS_PER_INCH,
      9,
    );
    // Visible: a three-way branch is dotted, so the node keeps its fill.
    expect(cell(node, "FillPattern")).toBeUndefined();
  });

  it("writes every link as the two-point segment its master already is", () => {
    // No link carries a bend, so none of them has a coordinate that a moved
    // end could contradict; each far end tracks the shape's own frame.
    for (const id of [12, 13, 14]) {
      const link = shapeXml(built.body, id);
      const rows = [...link.matchAll(/<Row T="([^"]+)"/g)].map((row) => row[1]);
      expect(rows).toEqual(["MoveTo", "LineTo"]);
      expect(link).toContain('F="Width*1"');
      expect(link).toContain('F="Height*1"');
    }
  });

  it("publishes the electrical facts as Shape Data", () => {
    const instance = shapeXml(built.body, 5);
    expect(instance).toContain('<Row N="Reference"><Cell N="Value" V="R1"');
    expect(instance).toContain('<Row N="Param_r"><Cell N="Value" V="10k"');
    expect(instance).toContain('<Row N="IcmInstanceId"><Cell N="Value" V="R1"');
    const wire = shapeXml(built.body, 14);
    expect(wire).toContain('<Row N="IcmRouteId"><Cell N="Value" V="route-top"');
  });

  it("has nothing to apologise for in a document it can draw", () => {
    expect(built.caveats).toEqual([]);
  });
});

describe("a wire that turns a corner", () => {
  const corner = buildVisioPage(cornerDocument(), resolver);

  it("breaks the Route at the corner and hangs both links on one node", () => {
    // The corner is a shape to drag rather than a number inside a longer wire.
    // That is the whole point of the chain: a one-dimensional Visio shape has
    // two ends a hand can reach, so a Route written as one shape offers two
    // handles however many times it turns.
    expect(corner.counts).toEqual({
      instanceShapes: 2,
      nodeShapes: 0,
      seamNodeShapes: 1,
      wireShapes: 2,
      textShapes: 0,
      formulaShapes: 0,
      glue: 4,
    });
    // A page with no Junction on it still needs the node master now.
    expect(corner.masters.map((master) => master.name)).toEqual([
      "Resistor",
      "Wire",
      "Node",
    ]);
    const seam = shapeXml(corner.body, 9);
    expect(attribute(seam, "Master")).toBe("3");
    // Invisible: the schematic draws no dot where a wire merely turns.
    expect(cell(seam, "FillPattern")).toBe("0");
    for (const axis of ["X", "Y"] as const) {
      const at = Number(cell(seam, `Pin${axis}`));
      expect(Number(cell(shapeXml(corner.body, 10), `End${axis}`))).toBe(at);
      expect(Number(cell(shapeXml(corner.body, 11), `Begin${axis}`))).toBe(at);
    }
  });

  it("glues both links to the seam node rather than to each other", () => {
    // Visio glues a one-dimensional shape to a connection point, never to
    // another wire. The node is what lets two links hold the same corner, and
    // moving it moves both of them.
    const connects = [...corner.body.matchAll(/<Connect [^>]*>/g)]
      .map((match) => match[0])
      .filter((connect) => attribute(connect, "ToSheet") === "9");
    expect(
      connects.map((connect) => [
        attribute(connect, "FromSheet"),
        attribute(connect, "FromPart"),
        attribute(connect, "ToCell"),
      ]),
    ).toEqual([
      ["10", "12", "Connections.Row_1.X"],
      ["11", "9", "Connections.Row_1.X"],
    ]);
  });

  it("gives every link of a Route the same Shape Data", () => {
    for (const id of [10, 11]) {
      expect(shapeXml(corner.body, id)).toContain(
        '<Row N="IcmRouteId"><Cell N="Value" V="route-corner"',
      );
    }
  });

  it("caps a wire round, so no corner of the chain is left with a hole", () => {
    // Two links meet at the corner as two separate shapes, with no line join
    // between them. A cap that stops at the endpoint leaves the outside of the
    // angle uncovered — a square hole, half a line weight on a side, at every
    // corner and at both feet of every hop arc. Round is the only other cap
    // Visio has, and it fills that hole at whatever weight the wire is set to.
    const wire = corner.masters.find((master) => master.name === "Wire")!;
    expect(wire.shapes).toContain('<Cell N="LineCap" V="0"/>');
    // Only the master says it: a link that overrode the cell would reopen the
    // hole on one side of its own corner.
    for (const id of [10, 11]) {
      expect(shapeXml(corner.body, id)).not.toContain('N="LineCap"');
    }
  });
});

describe("labels on the page", () => {
  const labelled = buildVisioPage(labelledDocument(), resolver);
  // Instances take 5-10 and their children, the node 11, the wires 12-14; the
  // labels follow in annotation ID order.
  const deviceLabel = shapeXml(labelled.body, 15);
  const netLabel = shapeXml(labelled.body, 16);

  it("puts one text shape on the page for every visible annotation", () => {
    expect(labelled.counts.textShapes).toBe(2);
    // A text shape has no master, so it is not one of the shapes a master is
    // resolved for; the instances, node and wires are unchanged.
    expect(shapeTags(labelled.body)).toHaveLength(7);
  });

  it("keeps a device's label with the device", () => {
    // A label written as a formula moves when Visio recalculates the cell, so
    // dragging R3 takes its designator along. The offset is the only thing the
    // page states; the position is whatever the formula works out to.
    const instancePin = Number(cell(shapeXml(labelled.body, 9), "PinX"));
    const labelPin = Number(cell(deviceLabel, "PinX"));
    expect(deviceLabel).toContain(
      `F="Sheet.9!PinX+${formatVisioNumber(labelPin - instancePin)}"`,
    );
    expect(deviceLabel).toContain('F="Sheet.9!PinY');
  });

  it("leaves a label that belongs to nobody at a plain coordinate", () => {
    expect(netLabel).not.toContain("Sheet.");
  });

  it("writes a designator as the symbol and subscript it is drawn as", () => {
    expect(deviceLabel).toContain(
      '<Cell N="Style" V="3"/><Cell N="Pos" V="0"/>',
    );
    expect(deviceLabel).toContain(
      '<Cell N="Style" V="1"/><Cell N="Pos" V="2"/>',
    );
    expect(deviceLabel).toContain('<cp IX="0"/>R<cp IX="1"/>3');
    expect(netLabel).toContain("MID");
  });

  it("carries the annotation identity back as Shape Data", () => {
    expect(deviceLabel).toContain(
      '<Row N="IcmAnnotationId"><Cell N="Value" V="ann-label"',
    );
  });

  it("names the mark it draws no geometry for", () => {
    expect(labelled.caveats).toEqual([
      {
        kind: "annotation-ornament",
        detail: "net-label ann-net: global net badge",
      },
    ]);
  });

  it("makes the page big enough for text that hangs off the drawing", () => {
    expect(labelled.page.widthInches).toBeGreaterThan(built.page.widthInches);
    for (const name of ["PinX", "PinY"] as const) {
      const limit =
        name === "PinX"
          ? labelled.page.widthInches
          : labelled.page.heightInches;
      for (const match of labelled.body.matchAll(
        new RegExp(`<Cell N="${name}" V="([^"]*)"`, "g"),
      )) {
        expect(Number(match[1])).toBeGreaterThanOrEqual(0);
        expect(Number(match[1])).toBeLessThanOrEqual(limit);
      }
    }
  });
});

/**
 * Two integrators reading `1/s` and one reading `K/s`, wired in a chain.
 *
 * A signal-flow block's frame is as wide as the expression inside it, so these
 * are two drawings, not three and not one.
 */
function signalFlowDocument(): SchematicDocument {
  const document = createEmptyDocument("doc-flow", "Chain");
  const block = (
    id: string,
    x: number,
    formula?: string,
  ): SchematicDocument["instances"][number] => ({
    id,
    symbolId: "integrator",
    placement: { position: { x, y: 0 }, rotation: 0, mirror: "none" },
    ...(formula ? { signalFlowParameters: { formula } } : {}),
  });
  document.instances.push(
    block("U1", 0),
    block("U2", 200),
    block("U3", 400, "K/s"),
  );
  document.nets.push({
    id: "net-mid",
    terminals: [
      { instanceId: "U1", pinName: "Y" },
      { instanceId: "U2", pinName: "A" },
    ],
  });
  document.routes.push(
    createRoutePath({
      id: "route-chain",
      netId: "net-mid",
      start: { kind: "terminal", instanceId: "U1", pinName: "Y" },
      end: { kind: "terminal", instanceId: "U2", pinName: "A" },
      bends: [],
      modes: ["manual"],
    }),
  );
  return document;
}

describe("signal-flow blocks on the page", () => {
  const flow = buildVisioPage(signalFlowDocument(), resolver);

  it("draws a block whose body comes out of its own formula", () => {
    // The frame and its two leads, as a placed group like any other instance:
    // nothing about an adaptive block reaches the page as a special case.
    expect(flow.counts.instanceShapes).toBe(3);
    expect(shapeXml(flow.body, 5)).toContain(
      '<Shapes><Shape ID="6" Type="Shape" MasterShape="6"/>',
    );
  });

  it("gives one master to every distinct drawing and no more", () => {
    // U1 and U2 read the same, so they are one master; U3 is a second. The
    // master the symbol is named for keeps the symbol's own name.
    expect(flow.masters.map((master) => master.name)).toEqual([
      "Integrator (1/s)",
      "Integrator (1/s) · K/s",
      "Wire",
    ]);
    const [first, second, third] = shapeTags(flow.body).map((tag) =>
      attribute(tag, "Master"),
    );
    expect(first).toBe(second);
    expect(third).not.toBe(first);
  });

  it("glues a wire to a connection point the resolved body put there", () => {
    // The pins moved out with the leads, so this only holds if the master was
    // built from the same resolved definition the page placed.
    expect(flow.counts.glue).toBe(2);
  });

  it("has nothing to apologise for once the body text is written", () => {
    expect(flow.caveats).toEqual([]);
  });

  it("stacks each block's fraction over a ruled bar", () => {
    // 1/s and K/s are both fractions, so each of the three blocks is a
    // numerator, a denominator and the bar between them.
    expect(flow.counts.formulaShapes).toBe(9);
    // Three blocks of three shapes each, after the nine instance shapes and
    // the one wire.
    const numerator = shapeXml(flow.body, 15);
    const denominator = shapeXml(flow.body, 16);
    const bar = shapeXml(flow.body, 17);
    expect(numerator).toContain(">1\n</Text>");
    expect(denominator).toContain(">s\n</Text>");
    // Page y grows upward: the numerator is above the bar, the denominator below.
    expect(Number(cell(numerator, "PinY"))).toBeGreaterThan(
      Number(cell(bar, "PinY")),
    );
    expect(Number(cell(denominator, "PinY"))).toBeLessThan(
      Number(cell(bar, "PinY")),
    );
    // The bar is drawn, not connected: a connector would offer to glue itself
    // to whatever it crosses and reroute when the block moves.
    expect(bar).toContain('<Row T="RelLineTo" IX="2"');
    expect(bar).not.toContain("Master=");
  });

  it("keeps the text with the block it states", () => {
    // U3 is the third block, so its group is sheet 11 and its numerator the
    // first formula shape written for it. Drag the block in Visio and Visio
    // recalculates the text's pin from the block's.
    const instancePin = Number(cell(shapeXml(flow.body, 11), "PinX"));
    const numerator = shapeXml(flow.body, 21);
    expect(numerator).toContain(">K\n</Text>");
    expect(numerator).toContain(
      '<Row N="IcmInstanceId"><Cell N="Value" V="U3"',
    );
    const followed =
      /PinX" V="([-\d.]+)" F="Sheet\.11!PinX([-+])([\d.]+)"/.exec(numerator);
    expect(followed).not.toBeNull();
    const [, pin, sign, offset] = followed!;
    // The formula is not decoration: recalculated against the block's own pin
    // it gives back exactly the value written beside it.
    expect(Number(pin)).toBeCloseTo(
      instancePin + (sign === "-" ? -1 : 1) * Number(offset),
      6,
    );
  });
});

/** One delay block, quarter-turned, with a coefficient in front of it. */
function delayDocument(): SchematicDocument {
  const document = createEmptyDocument("doc-delay", "Delay");
  document.instances.push({
    id: "U1",
    symbolId: "unit-delay",
    placement: { position: { x: 0, y: 0 }, rotation: 90, mirror: "none" },
    signalFlowParameters: { coefficient: "K" },
  });
  return document;
}

describe("a formula that is not a fraction", () => {
  const delay = buildVisioPage(delayDocument(), resolver);
  // The block takes 5 and its two artwork children; the coefficient and the
  // formula follow it.
  const coefficient = shapeXml(delay.body, 8);
  const formula = shapeXml(delay.body, 9);

  it("writes the coefficient and the expression on one line", () => {
    expect(delay.counts.formulaShapes).toBe(2);
    // The multiplication sign is drawn with the coefficient, and the
    // coefficient is anchored by its right edge so it stays beside the
    // expression whatever Arial makes of the width.
    expect(coefficient).toContain(">K\u00b7\n</Text>");
    expect(coefficient).toContain('<Cell N="HorzAlign" V="2"/>');
    expect(formula).toContain('<Cell N="HorzAlign" V="1"/>');
    expect(Number(cell(coefficient, "PinX"))).toBeLessThan(
      Number(cell(formula, "PinX")),
    );
  });

  it("raises a script as a script Visio can still edit", () => {
    // z with a superscript -1, as two character rows: retyping the 1 in Visio
    // leaves it a superscript, which an outline or a raised literal would not.
    expect(formula).toContain('<Cell N="Style" V="1"/><Cell N="Pos" V="0"/>');
    expect(formula).toContain('<Cell N="Style" V="1"/><Cell N="Pos" V="1"/>');
    expect(formula).toContain('<cp IX="0"/>z<cp IX="1"/>-1');
  });

  it("leaves the text upright however the block is turned", () => {
    // The instance is quarter-turned; its formula is not. A reader reads the
    // expression the way round it was written.
    expect(Number(cell(shapeXml(delay.body, 5), "Angle"))).not.toBe(0);
    expect(cell(coefficient, "Angle")).toBe("0");
    expect(cell(formula, "Angle")).toBe("0");
  });
});

describe("packVisioDocument", () => {
  it("writes the page into a package Visio can open", () => {
    const entries = unzipSync(packVisioDocument(document, resolver));
    const page = new TextDecoder().decode(entries[PAGE_CONTENTS_PART]!);
    expect(page).toContain("<Shapes>");
    expect(page).toContain("<Connects>");
    expect(page).toContain(built.body);
  });

  it("writes the same bytes twice", () => {
    expect(packVisioDocument(document, resolver)).toEqual(
      packVisioDocument(document, resolver),
    );
  });
});

describe("a document with nothing in it", () => {
  it("still exports as a page", () => {
    const empty = buildVisioPage(
      createEmptyDocument("doc-empty", "Empty"),
      resolver,
    );
    expect(empty.counts).toEqual({
      instanceShapes: 0,
      nodeShapes: 0,
      seamNodeShapes: 0,
      wireShapes: 0,
      textShapes: 0,
      formulaShapes: 0,
      glue: 0,
    });
    expect(empty.masters).toEqual([]);
    expect(empty.page.widthInches).toBeGreaterThan(0);
    expect(empty.page.heightInches).toBeGreaterThan(0);
  });
});
