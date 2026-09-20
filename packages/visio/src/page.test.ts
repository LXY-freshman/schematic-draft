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
    expect(built.counts).toEqual({
      instanceShapes: 3,
      nodeShapes: 1,
      wireShapes: 3,
      textShapes: 0,
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

  it("gives a wire the bends the Route was drawn with", () => {
    // Wires follow the instances and the node, in Route ID order: route-bottom,
    // route-side, route-top.
    const side = shapeXml(built.body, 13);
    const rows = [...side.matchAll(/<Row T="(MoveTo|LineTo)" IX="\d+"/g)];
    expect(rows.map((row) => row[1])).toEqual(["MoveTo", "LineTo", "LineTo"]);
    // A straight wire keeps the two rows its master already has.
    const straight = shapeXml(built.body, 12);
    expect([...straight.matchAll(/<Row T="(MoveTo|LineTo)"/g)]).toHaveLength(2);
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
      wireShapes: 0,
      textShapes: 0,
      glue: 0,
    });
    expect(empty.masters).toEqual([]);
    expect(empty.page.widthInches).toBeGreaterThan(0);
    expect(empty.page.heightInches).toBeGreaterThan(0);
  });
});
