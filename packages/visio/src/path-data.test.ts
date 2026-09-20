import { describe, expect, it } from "vitest";

import { parseSymbolPathData } from "./path-data.js";

describe("parseSymbolPathData", () => {
  it("reads a closed triangle as one subpath of absolute points", () => {
    expect(parseSymbolPathData("M -30 -30 L -30 30 L 21.5 0 Z")).toEqual([
      {
        start: { x: -30, y: -30 },
        segments: [
          { kind: "line", to: { x: -30, y: 30 } },
          { kind: "line", to: { x: 21.5, y: 0 } },
        ],
        closed: true,
      },
    ]);
  });

  it("continues a move with lines when coordinates repeat", () => {
    const [subpath] = parseSymbolPathData("M 0 0 1 1 2 2");
    expect(subpath?.segments).toEqual([
      { kind: "line", to: { x: 1, y: 1 } },
      { kind: "line", to: { x: 2, y: 2 } },
    ]);
  });

  it("resolves relative commands against the current point", () => {
    const [subpath] = parseSymbolPathData("m 10 10 l 5 0 h 5 v -5");
    expect(subpath?.start).toEqual({ x: 10, y: 10 });
    expect(subpath?.segments).toEqual([
      { kind: "line", to: { x: 15, y: 10 } },
      { kind: "line", to: { x: 20, y: 10 } },
      { kind: "line", to: { x: 20, y: 5 } },
    ]);
  });

  it("keeps both control points of a cubic, in order", () => {
    const [subpath] = parseSymbolPathData("M 0 0 C 1 2 3 4 5 6");
    expect(subpath?.segments).toEqual([
      {
        kind: "cubic",
        control1: { x: 1, y: 2 },
        control2: { x: 3, y: 4 },
        to: { x: 5, y: 6 },
      },
    ]);
  });

  it("starts a new subpath at every move", () => {
    const subpaths = parseSymbolPathData("M 0 0 L 1 0 M 5 5 L 6 5");
    expect(subpaths).toHaveLength(2);
    expect(subpaths[0]?.start).toEqual({ x: 0, y: 0 });
    expect(subpaths[1]?.start).toEqual({ x: 5, y: 5 });
    expect(subpaths.every((subpath) => !subpath.closed)).toBe(true);
  });

  it("does not read the exponent of a number as a command", () => {
    const [subpath] = parseSymbolPathData("M 0 0 L 1e2 -1.5e-1");
    expect(subpath?.segments).toEqual([
      { kind: "line", to: { x: 100, y: -0.15 } },
    ]);
  });

  // Visio has real arc rows, so an arc deserves a translation rather than a
  // chord. Refusing here is what makes the catalog test notice a new one.
  it("refuses a command it cannot translate exactly", () => {
    expect(() => parseSymbolPathData("M 0 0 A 5 5 0 0 1 10 0")).toThrow(
      /Unsupported command "A"/,
    );
    expect(() => parseSymbolPathData("M 0 0 Q 5 5 10 0")).toThrow(
      /Unsupported command "Q"/,
    );
  });

  it("refuses data it cannot place", () => {
    expect(() => parseSymbolPathData("L 1 1")).toThrow(/start with a move/);
    expect(() => parseSymbolPathData("M 0 0 L 1 1 Z 2 2")).toThrow(
      /past a close command/,
    );
    expect(() => parseSymbolPathData("M 0")).toThrow(/missing a number/);
    expect(() => parseSymbolPathData("   ")).toThrow(/describes no geometry/);
  });
});
