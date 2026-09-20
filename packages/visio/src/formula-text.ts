/**
 * A signal-flow block's body text on the page.
 *
 * The expression inside a Transfer Function block is the block: an integrator
 * and a unit delay are the same rectangle with different text in it. So it is
 * written as Visio text a person can select and retype — `z` with a real
 * superscript `-1`, a coefficient in front of it, a fraction stacked over a
 * ruled bar — rather than as outlines, and it is not drawn into the master.
 *
 * Two reasons it stays off the master. The formula belongs to the instance:
 * two blocks sharing a master may carry different coefficients, which is what
 * `supportsCoefficient` means on a symbol whose frame never changes. And the
 * schematic draws the text upright whatever the block's rotation — a quarter
 * turn moves the body but never lays the letters on their side — which a
 * master's own text, rotating with the group, could not do.
 *
 * What this module resolves is therefore geometry in symbol-local units: the
 * page translates it to where the instance sits and glues each piece to the
 * instance with a pin formula, so the text still travels when the block moves.
 */

import type { SchematicStyleProfile } from "@icm/derived";
import type { RichTextDocument, RichTextRun } from "@icm/model";
import {
  approximateSignalFlowInlineWidth,
  parseSignalFlowFormulaSegments,
  resolveSignalFlowFormulaLayout,
} from "@icm/symbols";
import type {
  SignalFlowLayoutParameters,
  SymbolFormulaPresentation,
} from "@icm/symbols";

import { pinCells } from "./follow.js";
import type { VisioShapeFollow } from "./follow.js";
import type { DocumentPoint, PagePoint } from "./geometry.js";
import { formatVisioNumber } from "./xml.js";

/**
 * A line of text occupies this much of its own height.
 *
 * The same figure the layout uses for an inline formula's content height, so a
 * box measured here and the frame measured around it agree.
 */
const LINE_HEIGHT = 1.25;

/**
 * Where the middle of a line sits above its baseline, as a fraction of the
 * font size. The layout puts the baseline `0.34` below the block's centre, so
 * this is the same number read the other way.
 */
const BASELINE_TO_MIDDLE = 0.34;

/** Below this the profile's math weight is a normal face, above it a bold one. */
const BOLD_THRESHOLD = 600;

/** How tall the box around a fraction bar is, in document units. */
export const FORMULA_RULE_BOX_HEIGHT = 2;

/** One text box of a formula, measured in the symbol's own coordinates. */
export interface VisioFormulaPiece {
  readonly role: "coefficient" | "formula" | "numerator" | "denominator";
  readonly content: RichTextDocument;
  /** Which edge of the box the text is pinned to, as the schematic anchors it. */
  readonly alignment: "start" | "middle" | "end";
  /** Centre of the box, in symbol-local units. */
  readonly center: DocumentPoint;
  readonly width: number;
  readonly height: number;
}

/** The bar of a stacked fraction, in symbol-local units. */
export interface VisioFormulaRule {
  readonly from: DocumentPoint;
  readonly to: DocumentPoint;
  /** Stroke weight in document units. */
  readonly weight: number;
}

export interface VisioFormulaBody {
  /** Font size in document units, one size for every piece. */
  readonly fontSize: number;
  readonly pieces: readonly VisioFormulaPiece[];
  readonly rule: VisioFormulaRule | undefined;
  /** What the formula covers in symbol-local units, for the page extent. */
  readonly bounds: { x: number; y: number; width: number; height: number };
}

/**
 * A formula as RichText runs.
 *
 * Visio has real superscript and subscript positions, so the scripts survive
 * as scripts rather than as raised literal text — `z^-1` is `z` with a
 * superscript `-1` in the Visio text block too, and retyping the `1` keeps it
 * a superscript. The math weight the profile draws the body in has no cell of
 * its own beyond bold, so a bold-enough weight becomes bold.
 */
function formulaContent(
  value: string,
  bold: boolean,
  suffix = "",
): RichTextDocument {
  const runs: RichTextRun[] = parseSignalFlowFormulaSegments(value).map(
    (segment): RichTextRun =>
      segment.kind === "text"
        ? { kind: "text", value: segment.value }
        : {
            kind: "span",
            style: segment.kind,
            children: [{ kind: "text", value: segment.value }],
          },
  );
  if (suffix) runs.push({ kind: "text", value: suffix });
  return {
    runs: bold ? [{ kind: "span", style: "bold", children: runs }] : runs,
  };
}

/**
 * The centre of a box whose text is anchored at `anchorX` on its baseline.
 *
 * The schematic measures text from an anchor — the middle of a formula, the
 * right edge of a coefficient — while a Visio shape is placed by the middle of
 * its box. The two agree only as far as the width estimate does, which is why
 * the alignment travels with the piece: whatever Arial makes of the text, the
 * anchored edge stays where the schematic put it.
 */
function boxCenter(
  anchorX: number,
  alignment: VisioFormulaPiece["alignment"],
  width: number,
  baseline: number,
  fontSize: number,
): DocumentPoint {
  const x =
    alignment === "middle"
      ? anchorX
      : alignment === "end"
        ? anchorX - width / 2
        : anchorX + width / 2;
  return { x, y: baseline - fontSize * BASELINE_TO_MIDDLE };
}

/**
 * The text a block states, or nothing for a symbol that states none.
 *
 * Every measurement comes from the shared layout, so the Visio text lands
 * where the canvas draws it rather than where a second guess would put it.
 */
export function resolveVisioFormulaBody(
  presentation: SymbolFormulaPresentation | undefined,
  parameters: SignalFlowLayoutParameters | undefined,
  profile: SchematicStyleProfile,
): VisioFormulaBody | undefined {
  const layout = resolveSignalFlowFormulaLayout(presentation, parameters);
  if (!layout || layout.formula.length === 0) return undefined;
  const { fontSize } = layout;
  const height = fontSize * LINE_HEIGHT;
  const bold = profile.typography.mathWeight >= BOLD_THRESHOLD;
  const pieces: VisioFormulaPiece[] = [];

  if (layout.coefficient) {
    pieces.push({
      role: "coefficient",
      // The multiplication sign belongs to the coefficient: it is drawn only
      // when there is one, and it is what the coefficient is anchored by.
      content: formulaContent(layout.coefficient, bold, "·"),
      alignment: "end",
      center: boxCenter(
        layout.coefficientX,
        "end",
        layout.coefficientWidth,
        layout.inlineBaseline,
        fontSize,
      ),
      width: layout.coefficientWidth,
      height,
    });
  }

  if (layout.fraction) {
    const { numerator, denominator } = layout.fraction;
    const stacked = [
      {
        role: "numerator",
        value: numerator,
        baseline: layout.numeratorBaseline,
      },
      {
        role: "denominator",
        value: denominator,
        baseline: layout.denominatorBaseline,
      },
    ] as const;
    for (const part of stacked) {
      const width = approximateSignalFlowInlineWidth(part.value, fontSize);
      pieces.push({
        role: part.role,
        content: formulaContent(part.value, bold),
        alignment: "middle",
        center: boxCenter(
          layout.formulaX,
          "middle",
          width,
          part.baseline,
          fontSize,
        ),
        width,
        height,
      });
    }
  } else {
    pieces.push({
      role: "formula",
      content: formulaContent(layout.formula, bold),
      alignment: "middle",
      center: boxCenter(
        layout.formulaX,
        "middle",
        layout.formulaWidth,
        layout.inlineBaseline,
        fontSize,
      ),
      width: layout.formulaWidth,
      height,
    });
  }

  return {
    fontSize,
    pieces,
    rule: layout.fraction
      ? {
          from: {
            x: layout.formulaX - layout.formulaWidth / 2,
            y: layout.fractionBarY,
          },
          to: {
            x: layout.formulaX + layout.formulaWidth / 2,
            y: layout.fractionBarY,
          },
          weight: profile.strokes.annotation,
        }
      : undefined,
    bounds: layout.bounds,
  };
}

export interface VisioRuleShape {
  readonly id: number;
  /** Middle of the rule, on the page. */
  readonly pin: PagePoint;
  readonly follows?: VisioShapeFollow;
  readonly widthInches: number;
  readonly heightInches: number;
  readonly weightInches: number;
}

/**
 * The fraction bar, as a page shape of its own.
 *
 * It is a plain stroked line rather than a connector: a connector would offer
 * to glue itself to whatever it passes and reroute when the block moves, which
 * is the opposite of what a fraction bar does. The box around it is a couple of
 * document units tall so the bar can be selected and moved like anything else
 * on the page, with the line drawn across its middle.
 */
export function formulaRuleShape(shape: VisioRuleShape): string {
  return (
    `<Shape ID="${shape.id}" Type="Shape">` +
    pinCells(shape.pin, shape.follows) +
    `<Cell N="Width" V="${formatVisioNumber(shape.widthInches)}"/>` +
    `<Cell N="Height" V="${formatVisioNumber(shape.heightInches)}"/>` +
    `<Cell N="LocPinX" V="${formatVisioNumber(shape.widthInches / 2)}" F="Width*0.5"/>` +
    `<Cell N="LocPinY" V="${formatVisioNumber(shape.heightInches / 2)}" F="Height*0.5"/>` +
    `<Cell N="Angle" V="0"/><Cell N="FlipX" V="0"/><Cell N="FlipY" V="0"/>` +
    `<Cell N="LineWeight" V="${formatVisioNumber(shape.weightInches)}" U="PT"/>` +
    `<Cell N="LineColor" V="0"/><Cell N="LinePattern" V="1"/>` +
    `<Cell N="LineCap" V="1"/><Cell N="Rounding" V="0"/>` +
    `<Cell N="BeginArrow" V="0"/><Cell N="EndArrow" V="0"/>` +
    `<Cell N="FillPattern" V="0"/><Cell N="ShdwPattern" V="0"/>` +
    `<Cell N="LockTextEdit" V="1"/>` +
    `<Section N="Geometry" IX="0">` +
    `<Cell N="NoFill" V="1"/><Cell N="NoLine" V="0"/>` +
    `<Cell N="NoShow" V="0"/><Cell N="NoSnap" V="0"/><Cell N="NoQuickDrag" V="0"/>` +
    `<Row T="RelMoveTo" IX="1"><Cell N="X" V="0"/><Cell N="Y" V="0.5"/></Row>` +
    `<Row T="RelLineTo" IX="2"><Cell N="X" V="1"/><Cell N="Y" V="0.5"/></Row>` +
    `</Section></Shape>`
  );
}
