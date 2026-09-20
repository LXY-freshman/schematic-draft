/**
 * Where a document object lands on a Visio page.
 *
 * Two coordinate systems meet here and disagree about almost everything. A
 * schematic measures in document units from a top-left origin with y growing
 * downward, and places a symbol by rotating its artwork about the instance
 * position. Visio measures in inches from a bottom-left origin with y growing
 * upward, and places a shape by flipping it about its own centre, rotating it
 * counterclockwise, and moving its pin onto the page.
 *
 * Reconciling the two is the keystone of the page export: get the sign of a
 * single angle wrong and every rotated transistor in the drawing is mirrored.
 * Everything that needs a page coordinate asks this module for it.
 */

import { transformPoint } from "@icm/model";
import type { GridPoint, Orientation, SymbolLocalRect } from "@icm/model";

import { PAGE_MARGIN_INCHES, inchesFromUnits } from "./units.js";

/** A point in document units, as the persisted Project measures them. */
export interface DocumentPoint {
  readonly x: number;
  readonly y: number;
}

/** A point in page inches, as a Visio cell holds it. */
export interface PagePoint {
  readonly x: number;
  readonly y: number;
}

export interface DocumentBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface VisioPageFrame {
  readonly widthInches: number;
  readonly heightInches: number;
  /** Converts a document point to its place on the page. */
  point(point: DocumentPoint): PagePoint;
}

export function boundsOfPoints(
  points: Iterable<DocumentPoint>,
): DocumentBounds | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let seen = false;
  for (const point of points) {
    seen = true;
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return seen ? { minX, minY, maxX, maxY } : null;
}

/**
 * The page a drawing of these bounds needs.
 *
 * The page is sized to its contents rather than to a paper size: a schematic is
 * whatever shape the circuit is, and Visio's `DrawingSizeType` 3 exists for
 * exactly this. The margin keeps shapes off the page edge, where Visio's own
 * handles and rulers sit.
 */
export function pageFrameForBounds(
  bounds: DocumentBounds,
  marginInches: number = PAGE_MARGIN_INCHES,
): VisioPageFrame {
  const widthInches =
    inchesFromUnits(bounds.maxX - bounds.minX) + 2 * marginInches;
  const heightInches =
    inchesFromUnits(bounds.maxY - bounds.minY) + 2 * marginInches;
  return {
    widthInches,
    heightInches,
    point: (point) => ({
      x: inchesFromUnits(point.x - bounds.minX) + marginInches,
      // The whole drawing is mirrored about the page's horizontal midline, not
      // translated onto it: Visio counts y from the bottom.
      y: inchesFromUnits(bounds.maxY - point.y) + marginInches,
    }),
  };
}

/** The four corners of a symbol's view box, placed as the instance places it. */
export function placedSymbolBoxCorners(
  box: SymbolLocalRect,
  position: GridPoint,
  orientation: Orientation,
): DocumentPoint[] {
  return [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x + box.width, y: box.y + box.height },
    { x: box.x, y: box.y + box.height },
  ].map((corner) => transformPoint(corner, position, orientation));
}

/**
 * A shape's placement cells.
 *
 * `Angle` is radians counterclockwise; Visio's internal angle unit is the
 * radian whatever unit the display shows.
 */
export interface VisioShapePlacement {
  readonly pin: PagePoint;
  readonly angleRadians: number;
  readonly flipX: 0 | 1;
  readonly flipY: 0 | 1;
}

/**
 * The flip bits and rotation that reproduce a document orientation on the page.
 *
 * A schematic composes `mirror ∘ rotate` in a y-down space; Visio composes
 * `rotate ∘ flip` in a y-up one. Writing the y-flip as `K = diag(1, -1)` and the
 * document mirror as `S`, the page has to satisfy `R(angle)·F = K·S·R(θ)·K`,
 * and `K·R(θ)·K = R(-θ)` turns that into one case per mirror:
 *
 * - no mirror: no flip, and the rotation reverses, because a clockwise turn in
 *   a y-down space is a counterclockwise turn in a y-up one;
 * - one axis mirrored: flip that axis, and the two sign reversals — the mirror's
 *   and the y-flip's — cancel, so the rotation keeps its sign;
 * - both axes mirrored: that is a half turn, not a reflection, so no flip bit is
 *   set and the half turn is folded into the angle.
 */
export function visioOrientation(orientation: Orientation): {
  readonly degrees: number;
  readonly flipX: 0 | 1;
  readonly flipY: 0 | 1;
} {
  switch (orientation.mirror) {
    case "none":
      return { degrees: -orientation.rotation, flipX: 0, flipY: 0 };
    case "horizontal":
      return { degrees: orientation.rotation, flipX: 1, flipY: 0 };
    case "vertical":
      return { degrees: orientation.rotation, flipX: 0, flipY: 1 };
    case "both":
      return { degrees: 180 - orientation.rotation, flipX: 0, flipY: 0 };
  }
}

/**
 * Places an instance's master box on the page.
 *
 * A master's pin sits at the centre of its box, so the page pin is the centre of
 * the symbol's view box carried through the instance transform — not the
 * instance position, which is wherever the symbol author put the origin.
 */
export function visioShapePlacement(
  box: SymbolLocalRect,
  position: GridPoint,
  orientation: Orientation,
  frame: VisioPageFrame,
): VisioShapePlacement {
  const center = {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
  const { degrees, flipX, flipY } = visioOrientation(orientation);
  const normalized = ((degrees % 360) + 360) % 360;
  return {
    pin: frame.point(transformPoint(center, position, orientation)),
    angleRadians: (normalized * Math.PI) / 180,
    flipX,
    flipY,
  };
}
