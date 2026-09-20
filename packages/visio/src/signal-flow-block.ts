/**
 * Signal-flow blocks whose body is drawn from the formula inside them.
 *
 * An integrator's frame is as wide as the expression it holds, so two
 * integrators carrying different formulas are two different drawings and no one
 * master serves both. Rather than give the page a second kind of instance
 * shape, such a block is resolved into an ordinary symbol definition whose
 * artwork happens to have been computed instead of authored: the master
 * builder, the connection points, the glue and the placement all then work on
 * it unchanged. The only thing that differs is that one symbol may need more
 * than one master, which is what {@link visioAdaptiveBodyKey} distinguishes.
 *
 * The formula text itself is not drawn here. The resolved definition keeps its
 * `formulaPresentation`, and the page writes the text from that — upright, per
 * instance, glued to the block; see `formula-text.ts`.
 */

import {
  resolveAdaptiveSignalFlowBlockLayout,
  resolveSignalFlowPinAt,
} from "@icm/symbols";
import type {
  SignalFlowLayoutParameters,
  SymbolDefinition,
  SymbolPrimitive,
} from "@icm/symbols";

/**
 * A `right-tapered-trapezoid` slopes its right edge in by a quarter of the
 * body's height at each end, which is the cut the SVG renderer makes.
 */
const TRAPEZOID_TAPER = 4;

type Box = { readonly x: number; readonly y: number };
type Sized = Box & { readonly width: number; readonly height: number };

function framePoints(body: Sized, tapered: boolean): Box[] {
  const right = body.x + body.width;
  const bottom = body.y + body.height;
  if (!tapered) {
    return [
      { x: body.x, y: body.y },
      { x: right, y: body.y },
      { x: right, y: bottom },
      { x: body.x, y: bottom },
    ];
  }
  const taper = body.height / TRAPEZOID_TAPER;
  return [
    { x: body.x, y: body.y },
    { x: right, y: body.y + taper },
    { x: right, y: bottom - taper },
    { x: body.x, y: bottom },
  ];
}

/**
 * The definition an instance is drawn from, with any adaptive body resolved.
 *
 * A symbol with a fixed frame is returned untouched, so every caller can ask
 * without first knowing which kind it has.
 */
export function resolveVisioInstanceSymbol(
  definition: SymbolDefinition,
  parameters: SignalFlowLayoutParameters | undefined,
): SymbolDefinition {
  const adaptive = resolveAdaptiveSignalFlowBlockLayout(definition, parameters);
  if (!adaptive) return definition;
  const presentation = definition.formulaPresentation!;
  const { center } = presentation;
  const { body } = adaptive;
  const style = { strokeRole: "emphasis" } as const;
  // The pins sit at the ends of two leads the frame does not reach, so the
  // block is drawn as lead, frame, lead — the three parts the SVG renderer
  // draws, under the part names it gives them.
  const primitives: SymbolPrimitive[] = [
    {
      kind: "line",
      from: { x: center.x - adaptive.pinSpan, y: center.y },
      to: { x: body.x, y: center.y },
      part: "input-a-lead",
    },
    {
      kind: "polygon",
      points: framePoints(body, adaptive.shape === "right-tapered-trapezoid"),
      fill: "none",
      part: "body",
      style,
    },
    {
      kind: "line",
      from: { x: body.x + body.width, y: center.y },
      to: { x: center.x + adaptive.pinSpan, y: center.y },
      part: "output-y-lead",
    },
  ];
  // Dropping `adaptiveFrame` is what makes this a fixed-frame symbol: its body
  // has been resolved, and resolving it again from the result would widen the
  // frame a second time. The formula it resolved to becomes the presentation's
  // own, so whatever reads the definition later — the caveat that says the body
  // text is missing, above all — names the text this block would have shown
  // rather than the one the symbol is named for.
  const { adaptiveFrame, ...fixedFrame } = presentation;
  void adaptiveFrame;
  return {
    ...definition,
    viewBox: adaptive.bounds,
    primitives,
    pins: definition.pins.map((pin) => ({
      ...pin,
      at: resolveSignalFlowPinAt(definition, pin, parameters),
    })),
    formulaPresentation: {
      ...fixedFrame,
      defaultFormula: adaptive.formula.formula,
    },
  };
}

/**
 * What the block draws: its expression, plus its size when the expression does
 * not already imply one.
 *
 * A size is only worth naming when the instance asked for one, which is the
 * rarer half of a field the editor has no handle for yet. Leaving it out of the
 * usual key keeps the master named after the formula a reader recognizes, and
 * the two cases still cannot collide: an unstated size is one particular size.
 */
function drawnBody(
  definition: SymbolDefinition,
  parameters: SignalFlowLayoutParameters | undefined,
): string {
  const adaptive = resolveAdaptiveSignalFlowBlockLayout(
    definition,
    parameters,
  )!;
  const { formula } = adaptive;
  const expression = formula.coefficient
    ? `${formula.coefficient}·${formula.formula}`
    : formula.formula;
  const unsized = resolveAdaptiveSignalFlowBlockLayout(definition, {
    formula: parameters?.formula,
    coefficient: parameters?.coefficient,
  })!;
  return unsized.body.width === adaptive.body.width &&
    unsized.body.height === adaptive.body.height
    ? expression
    : `${expression} ${adaptive.body.width}×${adaptive.body.height}`;
}

/**
 * What separates two masters of one adaptive symbol, or nothing for a symbol
 * whose frame is fixed or whose block draws what the symbol is named for.
 *
 * The key is what the block reads as, because it names the master as well as
 * telling it apart: two integrators that draw differently are two entries in
 * Visio's Shapes window and a reader has to be able to see which is which. An
 * Integrator is already called `Integrator (1/s)`, so only a block saying
 * something other than that has anything to add. Keying by the drawing rather
 * than by the instance is what lets ten copies of one block share one master.
 */
export function visioAdaptiveBodyKey(
  definition: SymbolDefinition,
  parameters: SignalFlowLayoutParameters | undefined,
): string | undefined {
  if (!resolveAdaptiveSignalFlowBlockLayout(definition, parameters)) {
    return undefined;
  }
  const key = drawnBody(definition, parameters);
  return key === drawnBody(definition, undefined) ? undefined : key;
}
