/**
 * Keeping one shape with another.
 *
 * Visio recalculates a cell written as a formula, so a shape whose pin reads
 * `Sheet.5!PinX` plus a constant travels with shape 5 when the user drags it —
 * which is how a designator stays with its transistor and a formula stays
 * inside the block that states it. Dragging the follower itself replaces the
 * formula with a value, which is what a user who moves a label away from its
 * device means to happen.
 */

import type { PagePoint } from "./geometry.js";
import { formatVisioNumber } from "./xml.js";

export interface VisioShapeFollow {
  /** Page sheet ID of the shape being followed. */
  readonly sheetId: number;
  /** Page offset from that shape's pin to this one's. */
  readonly offset: PagePoint;
}

/** The `PinX` and `PinY` cells of a shape, following another or not. */
export function pinCells(
  pin: PagePoint,
  follows: VisioShapeFollow | undefined,
): string {
  const cell = (
    name: "PinX" | "PinY",
    value: number,
    offset: number,
  ): string => {
    const formula = follows
      ? ` F="Sheet.${follows.sheetId}!${name}${offset < 0 ? "-" : "+"}${formatVisioNumber(Math.abs(offset))}"`
      : "";
    return `<Cell N="${name}" V="${formatVisioNumber(value)}"${formula}/>`;
  };
  return (
    cell("PinX", pin.x, follows?.offset.x ?? 0) +
    cell("PinY", pin.y, follows?.offset.y ?? 0)
  );
}
