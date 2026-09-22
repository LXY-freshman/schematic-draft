import { createEmptyDocument, createRoutePath } from "@icm/model";
import type { SchematicDocument } from "@icm/model";
import { InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { buildVisioPage } from "./page.js";
import { CONNECTION_GRID_INCHES } from "./units.js";
import { wireShape } from "./wire.js";
import { formatVisioNumber } from "./xml.js";

const resolver = new InMemorySymbolResolver([]);

/** One inch of page per eight document grid steps; a hop of 4 units is this. */
const RADIUS_INCHES = (CONNECTION_GRID_INCHES / 10) * 4;

/**
 * A horizontal wire on one Net crossed at (50, 0) by a vertical wire on
 * another. Nothing is connected at the crossing, and nothing hops until the
 * horizontal wire's style override asks.
 */
function crossingDocument(lineJump: boolean): SchematicDocument {
  const document = createEmptyDocument("doc-jump", "Line jump");
  document.nets.push(
    { id: "net-a", terminals: [] },
    { id: "net-b", terminals: [] },
  );
  document.junctions.push(
    { id: "J1", netId: "net-a", position: { x: 0, y: 0 } },
    { id: "J2", netId: "net-a", position: { x: 100, y: 0 } },
    { id: "J3", netId: "net-b", position: { x: 50, y: -50 } },
    { id: "J4", netId: "net-b", position: { x: 50, y: 50 } },
  );
  document.routes.push(
    createRoutePath({
      id: "horizontal",
      netId: "net-a",
      start: { kind: "junction", junctionId: "J1" },
      end: { kind: "junction", junctionId: "J2" },
      bends: [],
      modes: ["manual"],
      ...(lineJump ? { styleOverride: { lineJump: true } } : {}),
    }),
    createRoutePath({
      id: "vertical",
      netId: "net-b",
      start: { kind: "junction", junctionId: "J3" },
      end: { kind: "junction", junctionId: "J4" },
      bends: [],
      modes: ["manual"],
    }),
  );
  return document;
}

/** The geometry rows of the one shape that has an arc in it. */
function hoppedGeometry(body: string): string {
  const shapes = body.split('<Shape ID="').filter((part) => part.includes("<"));
  const hopped = shapes.filter((shape) => shape.includes("EllipticalArcTo"));
  expect(hopped).toHaveLength(1);
  return /<Section N="Geometry" IX="0">(.*?)<\/Section>/u.exec(hopped[0]!)![1]!;
}

function rows(geometry: string): string[] {
  return [...geometry.matchAll(/<Row [^>]*>.*?<\/Row>/gu)].map(
    (match) => match[0],
  );
}

describe("a wire that hops in Visio", () => {
  it("writes no arc for a Document that asked for none", () => {
    const body = buildVisioPage(crossingDocument(false), resolver).body;
    expect(body).not.toContain("EllipticalArcTo");
  });

  it("bakes the hop into the wire's own geometry", () => {
    const body = buildVisioPage(crossingDocument(true), resolver).body;
    const drawn = rows(hoppedGeometry(body));
    // Leave the line before the crossing, arc over it, carry on to the far end.
    expect(drawn).toHaveLength(4);
    const inches = (units: number) =>
      formatVisioNumber((CONNECTION_GRID_INCHES / 10) * units);
    expect(drawn[0]).toBe(
      '<Row T="MoveTo" IX="1"><Cell N="X" V="0"/><Cell N="Y" V="0"/></Row>',
    );
    expect(drawn[1]).toBe(
      `<Row T="LineTo" IX="2"><Cell N="X" V="${inches(46)}"/><Cell N="Y" V="0"/></Row>`,
    );
    // A and B are a point the arc passes through, so the page frame's y-flip
    // needs no second handedness rule: up in the drawing is up on the page.
    expect(drawn[2]).toBe(
      `<Row T="EllipticalArcTo" IX="3">` +
        `<Cell N="X" V="${inches(54)}"/><Cell N="Y" V="0"/>` +
        `<Cell N="A" V="${inches(50)}"/><Cell N="B" V="${formatVisioNumber(RADIUS_INCHES)}"/>` +
        `<Cell N="C" V="0"/><Cell N="D" V="1"/>` +
        `</Row>`,
    );
    // The far end still tracks the shape, so gluing still drags the wire.
    expect(drawn[3]).toBe(
      `<Row T="LineTo" IX="4">` +
        `<Cell N="X" V="${inches(100)}" F="Width*1"/>` +
        `<Cell N="Y" V="0" F="Height*1"/>` +
        `</Row>`,
    );
  });

  it("leaves the wire it hops over, and every glue, alone", () => {
    const body = buildVisioPage(crossingDocument(true), resolver).body;
    const flat = body
      .split('<Shape ID="')
      .filter(
        (shape) =>
          shape.includes('<Row T="LineTo"') &&
          !shape.includes("EllipticalArcTo"),
      );
    expect(flat).toHaveLength(1);
    expect(buildVisioPage(crossingDocument(true), resolver).counts).toEqual(
      buildVisioPage(crossingDocument(false), resolver).counts,
    );
  });

  it("keeps a hop interior when one sits on a bend's segment", () => {
    // wireShape is handed page points, so this states the row contract on its
    // own: a hop never becomes the last row and never takes Width/Height away.
    const shape = wireShape({
      id: 9,
      masterId: 2,
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ],
      begin: undefined,
      end: undefined,
      jumps: [
        {
          segmentIndex: 1,
          from: { x: 1, y: 0.4 },
          through: { x: 1.05, y: 0.5 },
          to: { x: 1, y: 0.6 },
        },
      ],
      propertySection: "",
    });
    const drawn = rows(shape);
    expect(drawn.map((row) => /T="([^"]+)"/u.exec(row)![1])).toEqual([
      "MoveTo",
      "LineTo",
      "LineTo",
      "EllipticalArcTo",
      "LineTo",
    ]);
    expect(drawn.at(-1)).toContain('F="Width*1"');
    expect(drawn.at(-1)).toContain('F="Height*1"');
    expect(drawn[1]).not.toContain("F=");
  });
});
