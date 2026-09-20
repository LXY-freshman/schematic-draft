import type { SchematicStyleProfile } from "@icm/derived";
import { transformPoint } from "@icm/model";
import type { SchematicDocument } from "@icm/model";
import {
  normalizeSignalFlowFormula,
  parseSignalFlowFormulaSegments,
  parseSignalFlowFraction,
  resolveSignalFlowFormulaLayout,
} from "@icm/symbols";
import type {
  SignalFlowLayoutParameters,
  SymbolDefinition,
} from "@icm/symbols";

/** Renderer-owned presentation metadata for a Transfer Function block. */
export type FormulaPresentation = NonNullable<
  SymbolDefinition["formulaPresentation"]
>;

export interface SignalFlowFormulaRenderOptions {
  /** Instance foreground overrides apply to renderer-owned presentation too. */
  foreground: string;
  profile: {
    typography: Pick<
      SchematicStyleProfile["typography"],
      "fontFamily" | "mathWeight"
    >;
    strokes: Pick<SchematicStyleProfile["strokes"], "annotation">;
  };
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** Render ordinary formula text plus true SVG super/subscript tspans. */
export function renderSignalFlowInlineFormula(value: string): string {
  return parseSignalFlowFormulaSegments(value)
    .map((segment) =>
      segment.kind === "text"
        ? escapeXml(segment.value)
        : `<tspan data-role="formula-${segment.kind}" baseline-shift="${segment.kind === "superscript" ? "super" : "sub"}" font-size="70%">${escapeXml(segment.value)}</tspan>`,
    )
    .join("");
}

/** Formula bounds consumed by formal export crop and adaptive frame layout. */
export function signalFlowFormulaLocalBounds(
  presentation: FormulaPresentation | undefined,
  parameters: SignalFlowLayoutParameters | undefined,
): { x: number; y: number; width: number; height: number } | undefined {
  return resolveSignalFlowFormulaLayout(presentation, parameters)?.bounds;
}

/**
 * Render renderer-owned formula text. Every preset and custom expression uses
 * one font size; fractions expand the frame rather than shrinking their text.
 */
export function renderSignalFlowFormula(
  presentation: FormulaPresentation | undefined,
  parameters: SignalFlowLayoutParameters | undefined,
  options: SignalFlowFormulaRenderOptions,
): string {
  const layout = resolveSignalFlowFormulaLayout(presentation, parameters);
  if (!presentation || !layout) return "";
  const family = escapeXml(options.profile.typography.fontFamily);
  const common = `fill="${escapeXml(options.foreground)}" stroke="none" font-family="${family}" font-weight="${options.profile.typography.mathWeight}"`;
  const body = layout.fraction
    ? `<g data-role="signal-flow-fraction"><text data-role="formula-numerator" x="${layout.formulaX}" y="${layout.numeratorBaseline}" text-anchor="middle" font-size="${layout.fontSize}">${renderSignalFlowInlineFormula(layout.fraction.numerator)}</text><line data-role="formula-fraction-bar" x1="${layout.formulaX - layout.formulaWidth / 2}" y1="${layout.fractionBarY}" x2="${layout.formulaX + layout.formulaWidth / 2}" y2="${layout.fractionBarY}" stroke="${escapeXml(options.foreground)}" stroke-width="${options.profile.strokes.annotation}"/><text data-role="formula-denominator" x="${layout.formulaX}" y="${layout.denominatorBaseline}" text-anchor="middle" font-size="${layout.fontSize}">${renderSignalFlowInlineFormula(layout.fraction.denominator)}</text></g>`
    : `<text data-role="formula-text" x="${layout.formulaX}" y="${layout.inlineBaseline}" text-anchor="middle" font-size="${layout.fontSize}">${renderSignalFlowInlineFormula(layout.formula)}</text>`;
  const coefficientMarkup = layout.coefficient
    ? `<text data-role="formula-coefficient" x="${layout.coefficientX}" y="${layout.inlineBaseline}" text-anchor="end" font-size="${layout.fontSize}">${renderSignalFlowInlineFormula(layout.coefficient)}·</text>`
    : "";
  return `<g data-role="signal-flow-formula" ${common}>${coefficientMarkup}${body}</g>`;
}

/**
 * Render Symbol body text at its transformed centre without transforming the
 * glyphs themselves. A mirrored or quarter-turned Symbol still moves its
 * label with the body, while letters, signs, scripts, and fraction bars stay
 * readable in screen coordinates.
 */
export function renderUprightSignalFlowFormula(
  presentation: FormulaPresentation | undefined,
  parameters: SignalFlowLayoutParameters | undefined,
  placement: NonNullable<SchematicDocument["instances"][number]["placement"]>,
  options: SignalFlowFormulaRenderOptions,
): string {
  if (!presentation) return "";
  const formula = renderSignalFlowFormula(presentation, parameters, options);
  if (!formula) return "";
  const worldCenter = transformPoint(
    presentation.center,
    placement.position,
    placement,
  );
  const translateX = worldCenter.x - presentation.center.x;
  const translateY = worldCenter.y - presentation.center.y;
  return `<g data-role="upright-signal-flow-formula" transform="translate(${translateX} ${translateY})">${formula}</g>`;
}

export { normalizeSignalFlowFormula, parseSignalFlowFraction };
