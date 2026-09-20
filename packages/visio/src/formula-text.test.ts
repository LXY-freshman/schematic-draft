import { resolveSchematicStyleProfile } from "@icm/derived";
import type { RichTextRun } from "@icm/model";
import { resolveSignalFlowFormulaLayout } from "@icm/symbols";
import type { SymbolFormulaPresentation } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import {
  FORMULA_RULE_BOX_HEIGHT,
  formulaRuleShape,
  resolveVisioFormulaBody,
} from "./formula-text.js";
import type { VisioFormulaPiece } from "./formula-text.js";

const profile = resolveSchematicStyleProfile("razavi-textbook-v1");

function presentation(
  defaultFormula: string,
  supportsCoefficient = false,
): SymbolFormulaPresentation {
  return {
    defaultFormula,
    supportsCoefficient,
    center: { x: 0, y: 0 },
    fontSize: 16,
  };
}

function role(
  body: { pieces: readonly VisioFormulaPiece[] },
  name: VisioFormulaPiece["role"],
): VisioFormulaPiece {
  const piece = body.pieces.find((candidate) => candidate.role === name);
  expect(piece, `no ${name} piece`).toBeDefined();
  return piece!;
}

/** The runs of a piece, with the profile's math weight unwrapped. */
function runs(piece: VisioFormulaPiece): readonly RichTextRun[] {
  expect(piece.content.runs).toHaveLength(1);
  const outer = piece.content.runs[0]!;
  expect(outer).toMatchObject({ kind: "span", style: "bold" });
  return outer.kind === "span" ? outer.children : [];
}

describe("resolveVisioFormulaBody", () => {
  it("has nothing to say for a symbol that states no formula", () => {
    expect(
      resolveVisioFormulaBody(undefined, undefined, profile),
    ).toBeUndefined();
  });

  it("writes an inline formula as one box on the block's centre line", () => {
    const body = resolveVisioFormulaBody(
      presentation("z^-1"),
      undefined,
      profile,
    )!;
    const layout = resolveSignalFlowFormulaLayout(
      presentation("z^-1"),
      undefined,
    )!;
    expect(body.pieces).toHaveLength(1);
    expect(body.rule).toBeUndefined();
    const formula = role(body, "formula");
    expect(formula.alignment).toBe("middle");
    expect(formula.width).toBe(layout.formulaWidth);
    // The schematic draws from a baseline and Visio places by the middle of a
    // box, so the two only line up if the same font size converts them.
    expect(formula.center.x).toBe(layout.formulaX);
    expect(formula.center.y).toBeCloseTo(layout.inlineBaseline - 16 * 0.34, 9);
  });

  it("keeps a script a script Visio can still edit", () => {
    const body = resolveVisioFormulaBody(
      presentation("z^-1"),
      undefined,
      profile,
    )!;
    // Not a raised literal and not an outline: `-1` is a superscript run, so
    // retyping it in Visio leaves it a superscript.
    expect(runs(role(body, "formula"))).toEqual([
      { kind: "text", value: "z" },
      {
        kind: "span",
        style: "superscript",
        children: [{ kind: "text", value: "-1" }],
      },
    ]);
  });

  it("stacks a fraction over a bar as wide as the formula", () => {
    const body = resolveVisioFormulaBody(
      presentation("1/(1-z^-1)"),
      undefined,
      profile,
    )!;
    const layout = resolveSignalFlowFormulaLayout(
      presentation("1/(1-z^-1)"),
      undefined,
    )!;
    const numerator = role(body, "numerator");
    const denominator = role(body, "denominator");
    expect(body.pieces).toHaveLength(2);
    // Document y grows downward, so the numerator is the smaller y.
    expect(numerator.center.y).toBeLessThan(denominator.center.y);
    expect(body.rule).toEqual({
      from: { x: layout.formulaX - layout.formulaWidth / 2, y: 0 },
      to: { x: layout.formulaX + layout.formulaWidth / 2, y: 0 },
      weight: profile.strokes.annotation,
    });
    expect(body.rule!.from.y).toBeGreaterThan(numerator.center.y);
    expect(body.rule!.from.y).toBeLessThan(denominator.center.y);
    // The outer brackets are the fraction's syntax, not part of the text.
    expect(runs(denominator)[0]).toEqual({ kind: "text", value: "1-z" });
  });

  it("draws the multiplication sign with the coefficient it belongs to", () => {
    const body = resolveVisioFormulaBody(
      presentation("1/s", true),
      { coefficient: "K" },
      profile,
    )!;
    const coefficient = role(body, "coefficient");
    // Anchored by its right edge, so however wide Arial makes `K·` the gap to
    // the formula stays the gap the schematic measured.
    expect(coefficient.alignment).toBe("end");
    expect(runs(coefficient)).toEqual([
      { kind: "text", value: "K" },
      { kind: "text", value: "·" },
    ]);
    expect(coefficient.center.x).toBeLessThan(role(body, "numerator").center.x);
  });

  it("offers no coefficient to a symbol that does not take one", () => {
    const body = resolveVisioFormulaBody(
      presentation("1/s"),
      { coefficient: "K" },
      profile,
    )!;
    expect(body.pieces.some((piece) => piece.role === "coefficient")).toBe(
      false,
    );
  });

  it("writes the body in a normal face when the profile is not bold", () => {
    const light = {
      ...profile,
      typography: { ...profile.typography, mathWeight: 400 },
    };
    const body = resolveVisioFormulaBody(presentation("s"), undefined, light)!;
    expect(role(body, "formula").content.runs).toEqual([
      { kind: "text", value: "s" },
    ]);
  });
});

describe("formulaRuleShape", () => {
  const bar = formulaRuleShape({
    id: 12,
    pin: { x: 2, y: 3 },
    widthInches: 0.5,
    heightInches: FORMULA_RULE_BOX_HEIGHT / 80,
    weightInches: 0.02,
  });

  it("draws the line across the middle of its own box", () => {
    // The box is tall enough to grab with the mouse; the bar itself is the one
    // line through it, so the shape can be selected without being fat.
    expect(bar).toContain(
      '<Row T="RelMoveTo" IX="1"><Cell N="X" V="0"/><Cell N="Y" V="0.5"/></Row>',
    );
    expect(bar).toContain(
      '<Row T="RelLineTo" IX="2"><Cell N="X" V="1"/><Cell N="Y" V="0.5"/></Row>',
    );
    expect(bar).toContain('<Cell N="LineWeight" V="0.02" U="PT"/>');
  });

  it("is a drawn line and not a connector", () => {
    // A connector would offer to glue itself to whatever it passes and reroute
    // when the block moves, which is the opposite of what a fraction bar does.
    expect(bar).not.toContain("Master=");
    expect(bar).not.toContain("BeginX");
    expect(bar).toContain('<Cell N="BeginArrow" V="0"/>');
    // Nothing fills it and nothing types into it.
    expect(bar).toContain('<Cell N="FillPattern" V="0"/>');
    expect(bar).toContain('<Cell N="LockTextEdit" V="1"/>');
  });
});
