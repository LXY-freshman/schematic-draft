import { createEmptyDocument, createRoutePath } from "@icm/model";
import type { RouteStyleOverride, SchematicDocument } from "@icm/model";
import { ROUTE_LINE_JUMP_RADIUS, deriveCrossings } from "@icm/derived";
import { InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { buildSvgScene } from "./render.js";

const resolver = new InMemorySymbolResolver([]);

/**
 * A horizontal wire on one Net crossed at (50, 0) by a vertical wire on
 * another, with the crossing drawn flat unless a style override says otherwise.
 */
function crossingDocument(
  horizontalStyle?: RouteStyleOverride,
): SchematicDocument {
  const doc = createEmptyDocument("line-jump", "Line jump");
  doc.nets.push({ id: "net-a", terminals: [] }, { id: "net-b", terminals: [] });
  doc.junctions.push(
    { id: "J1", netId: "net-a", position: { x: 0, y: 0 } },
    { id: "J2", netId: "net-a", position: { x: 100, y: 0 } },
    { id: "J3", netId: "net-b", position: { x: 50, y: -50 } },
    { id: "J4", netId: "net-b", position: { x: 50, y: 50 } },
  );
  doc.routes.push(
    createRoutePath({
      id: "horizontal",
      netId: "net-a",
      start: { kind: "junction", junctionId: "J1" },
      end: { kind: "junction", junctionId: "J2" },
      bends: [],
      modes: ["manual"],
      ...(horizontalStyle ? { styleOverride: horizontalStyle } : {}),
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
  return doc;
}

describe("route line jumps in the formal scene", () => {
  it("leaves an unmarked crossing as the polyline it has always been", () => {
    const body = buildSvgScene(crossingDocument(), resolver).formalBody;
    expect(body).toContain('<polyline data-object-id="horizontal"');
    expect(body).toContain('points="0,0 100,0"');
    expect(body).not.toContain("data-route-line-jumps");
  });

  it("renders a marked Wire byte for byte as before when it crosses nothing", () => {
    const alone = crossingDocument({ lineJump: true });
    alone.routes = alone.routes.filter((route) => route.id === "horizontal");
    alone.junctions = alone.junctions.filter((junction) =>
      ["J1", "J2"].includes(junction.id),
    );
    const flat = crossingDocument();
    flat.routes = flat.routes.filter((route) => route.id === "horizontal");
    flat.junctions = flat.junctions.filter((junction) =>
      ["J1", "J2"].includes(junction.id),
    );
    expect(buildSvgScene(alone, resolver).formalBody).toBe(
      buildSvgScene(flat, resolver).formalBody,
    );
  });

  it("replaces the marked Wire with an arc over the crossing", () => {
    const body = buildSvgScene(
      crossingDocument({ lineJump: true }),
      resolver,
    ).formalBody;
    const conductor = body.match(
      /<path data-object-id="horizontal"[^>]*\/>/u,
    )![0];
    expect(conductor).toContain('data-route-line-jumps="1"');
    expect(conductor).toContain(
      `d="M 0 0 L ${50 - ROUTE_LINE_JUMP_RADIUS} 0 A ${ROUTE_LINE_JUMP_RADIUS} ${ROUTE_LINE_JUMP_RADIUS} 0 0 1 ${50 + ROUTE_LINE_JUMP_RADIUS} 0 L 100 0"`,
    );
    // The wire it hops over, and every electrical fact, are untouched.
    expect(body).toContain('<polyline data-object-id="vertical"');
    expect(body).toContain('points="50,-50 50,50"');
    expect(body).not.toContain("<circle");
  });

  it("accepts crossings derived by a shared caller", () => {
    const doc = crossingDocument({ lineJump: true });
    const shared = buildSvgScene(doc, resolver, {
      crossings: deriveCrossings(doc, resolver),
    }).formalBody;
    expect(shared).toBe(buildSvgScene(doc, resolver).formalBody);
  });

  it.each([0.5, 1.5, 2])(
    "draws the hop at the document's %sx line-jump radius",
    (scale) => {
      const doc = crossingDocument({ lineJump: true });
      doc.presentation.styleOverrides = { lineJumpRadiusScale: scale };
      const radius = ROUTE_LINE_JUMP_RADIUS * scale;
      const conductor = buildSvgScene(doc, resolver).formalBody.match(
        /<path data-object-id="horizontal"[^>]*\/>/u,
      )![0];
      expect(conductor).toContain(
        `d="M 0 0 L ${50 - radius} 0 A ${radius} ${radius} 0 0 1 ${50 + radius} 0 L 100 0"`,
      );
    },
  );
});
