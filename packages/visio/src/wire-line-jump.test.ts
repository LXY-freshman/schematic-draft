import { createEmptyDocument, createRoutePath } from "@icm/model";
import type { SchematicDocument } from "@icm/model";
import { InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { buildVisioPage } from "./page.js";
import { CONNECTION_GRID_INCHES } from "./units.js";
import { formatVisioNumber } from "./xml.js";

const resolver = new InMemorySymbolResolver([]);

/** Page inches for a length in document units. */
function inches(units: number): string {
  return formatVisioNumber((CONNECTION_GRID_INCHES / 10) * units);
}

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

/** Every page shape, as its XML minus the `<Shape ID="` that opened it. */
function shapeParts(body: string): string[] {
  return body.split('<Shape ID="').slice(1);
}

function shapeId(part: string): number {
  return Number(/^\d+/u.exec(part)![0]);
}

function rows(shape: string): string[] {
  const geometry = /<Section N="Geometry" IX="0">(.*?)<\/Section>/u.exec(
    shape,
  )![1]!;
  return [...geometry.matchAll(/<Row [^>]*>.*?<\/Row>/gu)].map(
    (match) => match[0],
  );
}

describe("a wire that hops in Visio", () => {
  it("writes no arc for a Document that asked for none", () => {
    const built = buildVisioPage(crossingDocument(false), resolver);
    expect(built.body).not.toContain("EllipticalArcTo");
    // Two straight Routes, no corners: nothing is broken up that need not be.
    expect(built.counts.wireShapes).toBe(2);
    expect(built.counts.seamNodeShapes).toBe(0);
  });

  it("gives the hop a shape of its own inside the chain", () => {
    const built = buildVisioPage(crossingDocument(true), resolver);
    // The hopped Route becomes run, arc, run; the Route it hops over is still
    // one piece. Two seam nodes hold the three links together.
    expect(built.counts.wireShapes).toBe(4);
    expect(built.counts.seamNodeShapes).toBe(2);
    const arcs = shapeParts(built.body).filter((shape) =>
      shape.includes("EllipticalArcTo"),
    );
    expect(arcs).toHaveLength(1);
    // A and B are a point the arc passes through, so the page frame's y-flip
    // needs no second handedness rule: up in the drawing is up on the page.
    // X and Y still track the frame, so a moved end drags the arc with it.
    expect(rows(arcs[0]!)).toEqual([
      '<Row T="MoveTo" IX="1"><Cell N="X" V="0"/><Cell N="Y" V="0"/></Row>',
      `<Row T="EllipticalArcTo" IX="2">` +
        `<Cell N="X" V="${inches(8)}" F="Width*1"/>` +
        `<Cell N="Y" V="0" F="Height*1"/>` +
        `<Cell N="A" V="${inches(4)}"/><Cell N="B" V="${inches(4)}"/>` +
        `<Cell N="C" V="0"/><Cell N="D" V="1"/>` +
        `</Row>`,
    ]);
    // The arc answers for the same Net as the runs either side of it, so
    // clicking the hop in Visio names the wire it belongs to.
    expect(arcs[0]).toContain(
      '<Row N="IcmRouteId"><Cell N="Value" V="horizontal"',
    );
  });

  it("holds the arc to its runs at both seams", () => {
    const built = buildVisioPage(crossingDocument(true), resolver);
    const connects = [...built.body.matchAll(/<Connect [^>]*>/gu)].map(
      (match) => match[0],
    );
    const attribute = (connect: string, name: string): string =>
      new RegExp(`${name}="([^"]*)"`, "u").exec(connect)![1]!;
    const arc = shapeId(
      shapeParts(built.body).find((shape) =>
        shape.includes("EllipticalArcTo"),
      )!,
    );
    // Both of the arc's ends are glued, and each seam node is held twice: once
    // by the arc and once by the run beside it. Drag a seam in Visio and the
    // hop travels with the wire instead of being left behind.
    const arcEnds = connects.filter(
      (connect) => Number(attribute(connect, "FromSheet")) === arc,
    );
    expect(arcEnds).toHaveLength(2);
    for (const end of arcEnds) {
      const seam = attribute(end, "ToSheet");
      expect(
        connects.filter((connect) => attribute(connect, "ToSheet") === seam),
      ).toHaveLength(2);
      expect(attribute(end, "ToCell")).toBe("Connections.Row_1.X");
    }
  });

  it("leaves the wire it hops over alone", () => {
    const built = buildVisioPage(crossingDocument(true), resolver);
    const crossed = shapeParts(built.body).filter((shape) =>
      shape.includes('<Cell N="Value" V="vertical"'),
    );
    expect(crossed).toHaveLength(1);
    expect(crossed[0]).not.toContain("EllipticalArcTo");
  });

  // Visio bakes the hop into exported geometry, so a Document that widened its
  // jumps has to arrive in Visio at the width it was drawn at on the canvas.
  it("bakes the document's line-jump radius into the arc", () => {
    const document = crossingDocument(true);
    document.presentation.styleOverrides = { lineJumpRadiusScale: 1.5 };
    const built = buildVisioPage(document, resolver);
    const arc = shapeParts(built.body).find((shape) =>
      shape.includes("EllipticalArcTo"),
    )!;
    expect(rows(arc)[1]).toContain(
      `<Cell N="A" V="${inches(6)}"/><Cell N="B" V="${inches(6)}"/>`,
    );
    expect(rows(arc)[1]).toContain(`<Cell N="X" V="${inches(12)}"`);
  });
});
