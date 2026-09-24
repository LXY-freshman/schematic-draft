/**
 * A Route's centerline as a chain of two-point links.
 *
 * A one-dimensional Visio shape has exactly two ends a hand can reach. Write a
 * whole Route as one shape and every corner in it becomes a number in the file
 * instead of a handle on the page; write it as a chain of links glued at the
 * seams, and every corner becomes a node to drag. This module decides where
 * those seams fall. It works in document units, before anything is placed on a
 * page, because the page frame's y-flip has nothing to say about which points
 * a wire turns at.
 *
 * A hop over a crossing is a link like any other — one arc between the point
 * the wire leaves the straight path and the point it rejoins it — so deleting
 * a hop in Visio leaves the gap it occupied rather than silently straightening
 * the wire. That is the honest outcome: the drawing says a piece is missing,
 * which it is.
 */

import type { DocumentPoint } from "./geometry.js";

/** One link: a straight run, or the arc that hops a crossing. */
export interface WireChainLink {
  readonly from: DocumentPoint;
  readonly to: DocumentPoint;
  /** A point on the arc; present only on a hop. */
  readonly through?: DocumentPoint;
}

/**
 * One hop to build into the chain, as `deriveRouteLineJumps` states it.
 *
 * `segmentIndex` counts centerline segments, so hop `i` interrupts the run
 * from `centerline[i]` to `centerline[i + 1]`.
 */
export interface WireChainJump {
  readonly segmentIndex: number;
  readonly from: DocumentPoint;
  readonly apex: DocumentPoint;
  readonly to: DocumentPoint;
}

function samePoint(left: DocumentPoint, right: DocumentPoint): boolean {
  return left.x === right.x && left.y === right.y;
}

/**
 * Splits a centerline into the links the page will draw.
 *
 * Every corner and every hop boundary becomes a seam. Zero-length pieces are
 * dropped rather than written: a Visio shape whose two ends coincide has no
 * direction to be glued along, and a repeated centerline point is a corner that
 * turns through nothing. A Route that reduces to nothing at all still yields
 * one link, because a Route with no shape on the page would take its Net name
 * and its glue with it.
 */
export function planWireChain(
  centerline: readonly DocumentPoint[],
  jumps: readonly WireChainJump[] = [],
): readonly WireChainLink[] {
  const links: WireChainLink[] = [];
  const push = (link: WireChainLink): void => {
    if (!samePoint(link.from, link.to) || link.through) links.push(link);
  };
  for (let index = 0; index + 1 < centerline.length; index += 1) {
    const start = centerline[index]!;
    const end = centerline[index + 1]!;
    let cursor = start;
    for (const jump of jumps) {
      if (jump.segmentIndex !== index) continue;
      push({ from: cursor, to: jump.from });
      push({ from: jump.from, to: jump.to, through: jump.apex });
      cursor = jump.to;
    }
    push({ from: cursor, to: end });
  }
  const first = centerline[0];
  const last = centerline.at(-1);
  if (links.length === 0 && first && last) return [{ from: first, to: last }];
  return links;
}
