import { describe, expect, it } from "vitest";

import {
  parseSignalFlowFormulaSegments,
  resolveAdaptiveSignalFlowBlockLayout,
  resolveSignalFlowFormulaLayout,
  resolveSignalFlowPinAt,
} from "./signal-flow-layout.js";

const definition = {
  formulaPresentation: {
    defaultFormula: "z^-1/(1-z^-1)",
    supportsCoefficient: true,
    center: { x: 0, y: 0 },
    fontSize: 12,
    adaptiveFrame: {
      minBodyWidth: 120,
      minBodyHeight: 60,
      horizontalPadding: 16,
      verticalPadding: 12,
      leadLength: 20,
    },
  },
} as const;

const baseParameters = { formula: "1/s", coefficient: "K" } as const;

describe("signal-flow layout", () => {
  it("keeps 1/s, z^-1, and z^-1/(1-z^-1) at fontSize 12 and grows fractions vertically", () => {
    const inline = resolveSignalFlowFormulaLayout(
      definition.formulaPresentation,
      {
        formula: "1/s",
      },
    );
    const unitDelay = resolveSignalFlowFormulaLayout(
      definition.formulaPresentation,
      { formula: "z^-1" },
    );
    const fraction = resolveSignalFlowFormulaLayout(
      definition.formulaPresentation,
      { formula: "z^-1/(1-z^-1)" },
    );

    expect(inline?.fontSize).toBe(12);
    expect(unitDelay?.fontSize).toBe(12);
    expect(fraction?.fontSize).toBe(12);
    expect(fraction?.bounds.height).toBeGreaterThanOrEqual(
      inline!.bounds.height,
    );
    expect(fraction?.contentHeight).toBeGreaterThanOrEqual(
      inline!.contentHeight,
    );
    expect(fraction?.formulaWidth).toBeGreaterThanOrEqual(43.2);
    expect(
      fraction!.denominatorBaseline - fraction!.fractionBarY,
    ).toBeGreaterThanOrEqual(fraction!.fontSize * 1.25);
    expect(
      fraction!.fractionBarY - fraction!.numeratorBaseline,
    ).toBeGreaterThanOrEqual(fraction!.fontSize * 0.4);
  });

  it("snaps adaptive geometry to the 10-grid without exceeding its lead limit", () => {
    const layout = resolveAdaptiveSignalFlowBlockLayout(definition, {
      ...baseParameters,
      bodyWidth: 121,
      bodyHeight: 61,
    });
    expect(layout?.body.width).toBe(130);
    expect(layout?.body.height).toBe(70);
    expect(layout?.pinSpan).toBe(80);
    expect(layout?.bounds.width).toBe(160);
    expect(layout?.bounds.height).toBe(70);
    expect(layout!.pinSpan - layout!.body.width / 2).toBeLessThanOrEqual(
      definition.formulaPresentation.adaptiveFrame.leadLength,
    );

    const larger = resolveAdaptiveSignalFlowBlockLayout(definition, {
      formula: "very_long_custom_transfer_function",
      bodyWidth: 160,
      bodyHeight: 90,
    });
    expect(larger).toBeDefined();
    expect(larger!.body.width).toBeGreaterThanOrEqual(160);
    expect(larger!.body.height).toBeGreaterThanOrEqual(90);
    expect(larger!.body.width % 10).toBe(0);
    expect(larger!.body.height % 10).toBe(0);
    expect(larger!.body.width).toBeGreaterThanOrEqual(layout!.body.width);
    expect(larger!.pinSpan % 10).toBe(0);
    expect(larger!.pinSpan - larger!.body.width / 2).toBeLessThanOrEqual(
      definition.formulaPresentation.adaptiveFrame.leadLength,
    );
  });

  it("lands one-cell Signal Flow leads on the first eligible grid point", () => {
    const oneCellDefinition = {
      formulaPresentation: {
        ...definition.formulaPresentation,
        adaptiveFrame: {
          ...definition.formulaPresentation.adaptiveFrame,
          minBodyWidth: 40,
          leadLength: 10,
        },
      },
    };
    const halfGridBody = resolveAdaptiveSignalFlowBlockLayout(
      oneCellDefinition,
      { formula: "x", bodyWidth: 40 },
    );
    const alignedBody = resolveAdaptiveSignalFlowBlockLayout(
      oneCellDefinition,
      { formula: "x", bodyWidth: 60 },
    );

    expect(halfGridBody).toMatchObject({
      body: { width: 50 },
      pinSpan: 30,
    });
    expect(alignedBody).toMatchObject({
      body: { width: 60 },
      pinSpan: 40,
    });
    for (const layout of [alignedBody, halfGridBody]) {
      expect(layout).toBeDefined();
      expect(layout!.pinSpan % 10).toBe(0);
      expect(layout!.pinSpan - layout!.body.width / 2).toBeLessThanOrEqual(10);
    }
  });

  it("preserves a right-tapered transconductance frame while expanding long formulas", () => {
    const trapezoid = {
      formulaPresentation: {
        ...definition.formulaPresentation,
        defaultFormula: "g_m",
        adaptiveFrame: {
          ...definition.formulaPresentation.adaptiveFrame,
          shape: "right-tapered-trapezoid" as const,
          minBodyWidth: 40,
          horizontalPadding: 4,
          minBodyHeight: 70,
        },
      },
    };
    const preset = resolveAdaptiveSignalFlowBlockLayout(trapezoid, {
      formula: "gₘ₁",
    });
    const expanded = resolveAdaptiveSignalFlowBlockLayout(trapezoid, {
      formula: "-g_mL_with_a_long_suffix",
    });

    expect(preset).toMatchObject({
      shape: "right-tapered-trapezoid",
      body: { width: 40, height: 70 },
      pinSpan: 40,
    });
    expect(expanded!.shape).toBe("right-tapered-trapezoid");
    expect(expanded!.body.width).toBeGreaterThan(preset!.body.width);
    expect(expanded!.body.height).toBe(70);
    expect(expanded!.pinSpan).toBeGreaterThan(preset!.pinSpan);
  });

  it("keeps adaptive body, pinSpan, and pin coordinates aligned around the same center", () => {
    const layout = resolveAdaptiveSignalFlowBlockLayout(definition, {
      formula: "z^-1/(1-z^-1)",
      coefficient: "A",
    });
    const west = resolveSignalFlowPinAt(
      definition,
      { at: { x: -40, y: 0 }, direction: "west" },
      { formula: "z^-1/(1-z^-1)" },
    );
    const east = resolveSignalFlowPinAt(
      definition,
      { at: { x: 40, y: 0 }, direction: "east" },
      { formula: "z^-1/(1-z^-1)" },
    );

    expect(layout?.body.x).toBe(-layout!.body.width / 2);
    expect(layout?.body.y).toBe(-layout!.body.height / 2);
    expect(west.x).toBe(-layout!.pinSpan);
    expect(east.x).toBe(layout!.pinSpan);
    expect(west.y).toBe(0);
    expect(east.y).toBe(0);
  });
});

describe("parseSignalFlowFormulaSegments", () => {
  it("reads a subscript written compactly", () => {
    expect(parseSignalFlowFormulaSegments("g_m")).toEqual([
      { kind: "text", value: "g" },
      { kind: "subscript", value: "m" },
    ]);
  });

  it("keeps a sign with the script it belongs to", () => {
    expect(parseSignalFlowFormulaSegments("z^-1")).toEqual([
      { kind: "text", value: "z" },
      { kind: "superscript", value: "-1" },
    ]);
    // The second sign starts the next term rather than joining the first script.
    expect(parseSignalFlowFormulaSegments("z^-1-1")).toEqual([
      { kind: "text", value: "z" },
      { kind: "superscript", value: "-1" },
      { kind: "text", value: "-1" },
    ]);
  });

  it("unwraps a parenthesised script", () => {
    expect(parseSignalFlowFormulaSegments("s^(n+1)")).toEqual([
      { kind: "text", value: "s" },
      { kind: "superscript", value: "n+1" },
    ]);
  });

  it("leaves a name spelled with underscores alone", () => {
    // One underscore is subscript syntax; several are part of the name.
    expect(parseSignalFlowFormulaSegments("very_long_formula")).toEqual([
      { kind: "text", value: "very_long_formula" },
    ]);
  });

  it("treats a marker with nothing after it as text", () => {
    expect(parseSignalFlowFormulaSegments("g_")).toEqual([
      { kind: "text", value: "g_" },
    ]);
    expect(parseSignalFlowFormulaSegments("a^ b")).toEqual([
      { kind: "text", value: "a^ b" },
    ]);
  });

  it("reads the Unicode spelling the same as the marker spelling", () => {
    expect(parseSignalFlowFormulaSegments("z⁻¹")).toEqual(
      parseSignalFlowFormulaSegments("z^-1"),
    );
  });
});
