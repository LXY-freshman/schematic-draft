import { builtInSymbols } from "@icm/symbols";
import type { SymbolDefinition } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import {
  resolveVisioInstanceSymbol,
  visioAdaptiveBodyKey,
} from "./signal-flow-block.js";
import { buildSymbolMaster, symbolHasVisioMaster } from "./symbol-master.js";

function definition(id: string): SymbolDefinition {
  const found = builtInSymbols.find((symbol) => symbol.id === id);
  if (!found) throw new Error(`No built-in symbol "${id}"`);
  return found;
}

const integrator = definition("integrator");
const transconductance = definition("transconductance");

describe("resolveVisioInstanceSymbol", () => {
  it("leaves a symbol whose artwork was authored alone", () => {
    const resistor = definition("resistor");
    expect(resolveVisioInstanceSymbol(resistor, undefined)).toBe(resistor);
  });

  it("draws an adaptive block as lead, frame, lead", () => {
    // The same three parts, under the same names, as the SVG renderer: the
    // body is a 40-unit frame around the expression and the pins sit 30 units
    // out on either side of the centre.
    const drawn = resolveVisioInstanceSymbol(integrator, undefined);
    expect(drawn.primitives.map((primitive) => primitive.part)).toEqual([
      "input-a-lead",
      "body",
      "output-y-lead",
    ]);
    const [input, , output] = drawn.primitives;
    expect(input).toMatchObject({
      kind: "line",
      from: { x: -30, y: 0 },
      to: { x: -20, y: 0 },
    });
    expect(output).toMatchObject({
      kind: "line",
      from: { x: 20, y: 0 },
      to: { x: 30, y: 0 },
    });
    const frame = drawn.primitives[1]!;
    expect(frame).toMatchObject({ kind: "polygon", fill: "none" });
    expect(frame.kind === "polygon" ? frame.points : []).toEqual([
      { x: -20, y: -25 },
      { x: 20, y: -25 },
      { x: 20, y: 25 },
      { x: -20, y: 25 },
    ]);
    expect(drawn.viewBox).toEqual({ x: -30, y: -25, width: 60, height: 50 });
  });

  it("moves the pins out with the leads", () => {
    // A wider expression pushes the pins apart; the authored pin positions
    // belong to the default formula and would leave the leads unconnected.
    const wide = resolveVisioInstanceSymbol(integrator, { bodyWidth: 80 });
    expect(wide.pins.map((pin) => pin.at)).toEqual([
      { x: -50, y: 0 },
      { x: 50, y: 0 },
    ]);
    expect(wide.viewBox.width).toBe(100);
    expect(integrator.pins.map((pin) => pin.at)).toEqual([
      { x: -30, y: 0 },
      { x: 30, y: 0 },
    ]);
  });

  it("slopes the right edge of a block that is drawn tapered", () => {
    const drawn = resolveVisioInstanceSymbol(transconductance, undefined);
    const frame = drawn.primitives[1]!;
    expect(frame.kind === "polygon" ? frame.points : []).toEqual([
      { x: -20, y: -35 },
      { x: 20, y: -17.5 },
      { x: 20, y: 17.5 },
      { x: -20, y: 35 },
    ]);
  });

  it("hands the master builder a symbol it will draw", () => {
    // The point of resolving: what comes back is an ordinary fixed-frame
    // symbol, so the shared master builder takes it without a second path.
    expect(symbolHasVisioMaster(integrator)).toBe(false);
    const drawn = resolveVisioInstanceSymbol(integrator, { formula: "K/s" });
    expect(symbolHasVisioMaster(drawn)).toBe(true);
    // Resolving what was already resolved would widen the frame again.
    expect(resolveVisioInstanceSymbol(drawn, { formula: "K/s" })).toBe(drawn);
    const built = buildSymbolMaster(
      {
        definition: drawn,
        variant: undefined,
        disambiguate: false,
        bodyKey: visioAdaptiveBodyKey(integrator, { formula: "K/s" }),
      },
      1,
    );
    expect(built.connections.map((point) => point.pinName)).toEqual(["A", "Y"]);
    expect(built.master.name).toBe("Integrator (1/s) · K/s");
  });
});

describe("visioAdaptiveBodyKey", () => {
  it("has nothing to say about a symbol whose frame is fixed", () => {
    expect(
      visioAdaptiveBodyKey(definition("resistor"), undefined),
    ).toBeUndefined();
  });

  it("has nothing to add to the block the symbol is named for", () => {
    // The symbol is called `Integrator (1/s)`; a master called
    // `Integrator (1/s) · 1/s` says it twice.
    expect(visioAdaptiveBodyKey(integrator, undefined)).toBeUndefined();
    expect(
      visioAdaptiveBodyKey(integrator, { formula: "1/s" }),
    ).toBeUndefined();
  });

  it("is the same for two blocks that draw the same", () => {
    expect(visioAdaptiveBodyKey(integrator, { formula: "K/s" })).toBe("K/s");
    expect(visioAdaptiveBodyKey(integrator, { formula: "K/s" })).toBe(
      visioAdaptiveBodyKey(integrator, { formula: "K/s" }),
    );
  });

  it("names the coefficient the block is multiplied by", () => {
    expect(visioAdaptiveBodyKey(integrator, { coefficient: "K" })).toBe(
      "K·1/s",
    );
  });

  it("names a size the expression does not imply", () => {
    // Two integrators reading `1/s` are still two drawings when one was given
    // a body to fill, and a master serves only one of them.
    expect(visioAdaptiveBodyKey(integrator, { bodyWidth: 80 })).toBe(
      "1/s 80×50",
    );
    // A size the expression already reaches is the block the symbol draws.
    expect(visioAdaptiveBodyKey(integrator, { bodyWidth: 40 })).toBeUndefined();
  });
});
