import { describe, expect, it } from "vitest";

import { createEmptyDocument, createRoutePath } from "@icm/model";
import type { RouteStyleOverride, SchematicDocument } from "@icm/model";
import { InMemorySymbolResolver } from "@icm/symbols";

import {
  ROUTE_LINE_JUMP_RADIUS,
  deriveRouteLineJumps,
} from "./route-line-jump.js";

const resolver = new InMemorySymbolResolver([]);

interface WireSpec {
  id: string;
  netId: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
  styleOverride?: RouteStyleOverride;
}

function documentWith(wires: readonly WireSpec[]): SchematicDocument {
  const document = createEmptyDocument("jumps", "Jumps");
  const netIds = [...new Set(wires.map((wire) => wire.netId))];
  document.nets.push(...netIds.map((id) => ({ id, terminals: [] })));
  for (const wire of wires) {
    document.junctions.push(
      { id: `${wire.id}-start`, netId: wire.netId, position: wire.from },
      { id: `${wire.id}-end`, netId: wire.netId, position: wire.to },
    );
    document.routes.push(
      createRoutePath({
        id: wire.id,
        netId: wire.netId,
        start: { kind: "junction", junctionId: `${wire.id}-start` },
        end: { kind: "junction", junctionId: `${wire.id}-end` },
        bends: [],
        modes: ["manual"],
        ...(wire.styleOverride ? { styleOverride: wire.styleOverride } : {}),
      }),
    );
  }
  return document;
}

/** A horizontal wire on net-a crossed by a vertical wire on net-b at (50, 0). */
function crossingPair(
  horizontalStyle?: RouteStyleOverride,
  verticalStyle?: RouteStyleOverride,
): SchematicDocument {
  return documentWith([
    {
      id: "route-a-horizontal",
      netId: "net-a",
      from: { x: 0, y: 0 },
      to: { x: 100, y: 0 },
      ...(horizontalStyle ? { styleOverride: horizontalStyle } : {}),
    },
    {
      id: "route-b-vertical",
      netId: "net-b",
      from: { x: 50, y: -50 },
      to: { x: 50, y: 50 },
      ...(verticalStyle ? { styleOverride: verticalStyle } : {}),
    },
  ]);
}

describe("route line jumps", () => {
  it("draws nothing until a Route asks", () => {
    expect(deriveRouteLineJumps(crossingPair(), resolver).size).toBe(0);
  });

  it("hops the marked Route upward over a crossing", () => {
    const jumps = deriveRouteLineJumps(
      crossingPair({ lineJump: true }),
      resolver,
    );
    expect([...jumps.keys()]).toEqual(["route-a-horizontal"]);
    expect(jumps.get("route-a-horizontal")).toEqual([
      {
        routeId: "route-a-horizontal",
        segmentIndex: 0,
        distance: 50,
        from: { x: 50 - ROUTE_LINE_JUMP_RADIUS, y: 0 },
        apex: { x: 50, y: -ROUTE_LINE_JUMP_RADIUS },
        to: { x: 50 + ROUTE_LINE_JUMP_RADIUS, y: 0 },
        radius: ROUTE_LINE_JUMP_RADIUS,
        clockwise: true,
      },
    ]);
  });

  it("hops a marked vertical Route to its right", () => {
    const jumps = deriveRouteLineJumps(
      crossingPair(undefined, { lineJump: true }),
      resolver,
    );
    expect(jumps.get("route-b-vertical")).toEqual([
      expect.objectContaining({
        apex: { x: 50 + ROUTE_LINE_JUMP_RADIUS, y: 0 },
        clockwise: true,
      }),
    ]);
  });

  it("hops the same way whichever direction the Wire was drawn", () => {
    const drawnBackwards = documentWith([
      {
        id: "route-a-horizontal",
        netId: "net-a",
        from: { x: 100, y: 0 },
        to: { x: 0, y: 0 },
        styleOverride: { lineJump: true },
      },
      {
        id: "route-b-vertical",
        netId: "net-b",
        from: { x: 50, y: -50 },
        to: { x: 50, y: 50 },
      },
    ]);
    expect(
      deriveRouteLineJumps(drawnBackwards, resolver).get("route-a-horizontal"),
    ).toEqual([
      expect.objectContaining({
        from: { x: 50 + ROUTE_LINE_JUMP_RADIUS, y: 0 },
        apex: { x: 50, y: -ROUTE_LINE_JUMP_RADIUS },
        to: { x: 50 - ROUTE_LINE_JUMP_RADIUS, y: 0 },
        // The arc still passes above, which in a y-down frame reverses the
        // sweep when the travel direction reverses.
        clockwise: false,
      }),
    ]);
  });

  it("lets the horizontal Route hop when both ask", () => {
    const jumps = deriveRouteLineJumps(
      crossingPair({ lineJump: true }, { lineJump: true }),
      resolver,
    );
    expect([...jumps.keys()]).toEqual(["route-a-horizontal"]);
  });

  it("never hops a crossing between two Routes of one Net", () => {
    const sameNet = documentWith([
      {
        id: "route-a-horizontal",
        netId: "net-a",
        from: { x: 0, y: 0 },
        to: { x: 100, y: 0 },
        styleOverride: { lineJump: true },
      },
      {
        id: "route-b-vertical",
        netId: "net-a",
        from: { x: 50, y: -50 },
        to: { x: 50, y: 50 },
      },
    ]);
    expect(deriveRouteLineJumps(sameNet, resolver).size).toBe(0);
  });

  it("never hops a collinear overlap", () => {
    const overlapping = documentWith([
      {
        id: "route-a-horizontal",
        netId: "net-a",
        from: { x: 0, y: 0 },
        to: { x: 100, y: 0 },
        styleOverride: { lineJump: true },
      },
      {
        id: "route-b-overlap",
        netId: "net-b",
        from: { x: 20, y: 0 },
        to: { x: 80, y: 0 },
      },
    ]);
    expect(deriveRouteLineJumps(overlapping, resolver).size).toBe(0);
  });

  it("skips a crossing the arc cannot fit inside its segment", () => {
    const tooClose = documentWith([
      {
        id: "route-a-horizontal",
        netId: "net-a",
        from: { x: 50 - ROUTE_LINE_JUMP_RADIUS, y: 0 },
        to: { x: 100, y: 0 },
        styleOverride: { lineJump: true },
      },
      {
        id: "route-b-vertical",
        netId: "net-b",
        from: { x: 50, y: -50 },
        to: { x: 50, y: 50 },
      },
    ]);
    expect(deriveRouteLineJumps(tooClose, resolver).size).toBe(0);
  });

  it("drops the second of two crossings closer together than one arc", () => {
    const crowded = documentWith([
      {
        id: "route-a-horizontal",
        netId: "net-a",
        from: { x: 0, y: 0 },
        to: { x: 100, y: 0 },
        styleOverride: { lineJump: true },
      },
      {
        id: "route-b-vertical",
        netId: "net-b",
        from: { x: 50, y: -50 },
        to: { x: 50, y: 50 },
      },
      {
        id: "route-c-vertical",
        netId: "net-c",
        from: { x: 55, y: -50 },
        to: { x: 55, y: 50 },
      },
    ]);
    const jumps = deriveRouteLineJumps(crowded, resolver).get(
      "route-a-horizontal",
    );
    expect(jumps?.map((jump) => jump.distance)).toEqual([50]);
  });

  it("hops both of two crossings a full arc apart", () => {
    const spaced = documentWith([
      {
        id: "route-a-horizontal",
        netId: "net-a",
        from: { x: 0, y: 0 },
        to: { x: 100, y: 0 },
        styleOverride: { lineJump: true },
      },
      {
        id: "route-b-vertical",
        netId: "net-b",
        from: { x: 30, y: -50 },
        to: { x: 30, y: 50 },
      },
      {
        id: "route-c-vertical",
        netId: "net-c",
        from: { x: 70, y: -50 },
        to: { x: 70, y: 50 },
      },
    ]);
    const jumps = deriveRouteLineJumps(spaced, resolver).get(
      "route-a-horizontal",
    );
    expect(jumps?.map((jump) => jump.distance)).toEqual([30, 70]);
  });
});
