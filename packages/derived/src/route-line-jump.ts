/**
 * Line jumps: the little hops a Wire makes over the conductors it merely
 * crosses.
 *
 * A jump is drawing, and only drawing. It is requested per Route through
 * `styleOverride.lineJump`, it never appears where the two Routes could be
 * connected, and it changes nothing about Net membership — a crossing is not a
 * Junction before the hop is drawn and it is not one afterwards.
 *
 * The rule lives here rather than in a renderer because two renderers need the
 * same answer: `@icm/render-svg` draws the hop as an arc in the formal scene,
 * and `@icm/visio` bakes it into an exported shape's geometry. One
 * implementation is the only way those two can agree.
 */

import type { Point, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import type { ResolvedDocumentRoutingGeometry } from "./resolved-route-geometry.js";
import { resolveDocumentRoutingGeometry } from "./resolved-route-geometry.js";
import type { Crossing } from "./route-query.js";
import { deriveCrossings } from "./route-query.js";
import {
  pointOnSegment,
  segmentLength,
  unitDirection,
} from "./segment-geometry.js";

/**
 * Arc radius in Document units. Smaller than a grid step (10) so a hop stays
 * inside the cell it happens in, and larger than the Wire stroke (1.6) so it
 * reads as a hop rather than a thickening.
 */
export const ROUTE_LINE_JUMP_RADIUS = 4;

const EPSILON = 1e-6;

/** One hop, addressed to the segment of the Route that makes it. */
export interface RouteLineJump {
  routeId: string;
  /** Index into the Route's resolved segments, which share centerline order. */
  segmentIndex: number;
  /** Distance of the crossing from the segment's first vertex. */
  distance: number;
  /** Where the Wire leaves the straight path. */
  from: Point;
  /** The top of the hop; a point on the arc, so it needs no sweep convention. */
  apex: Point;
  /** Where the Wire rejoins the straight path. */
  to: Point;
  radius: number;
  /** Arc sense in a y-down frame, which is SVG's sweep flag. */
  clockwise: boolean;
}

export interface RouteLineJumpOptions {
  /** Revision-scoped routing read model supplied by a shared caller. */
  routingGeometry?: ResolvedDocumentRoutingGeometry;
  /** Crossings already derived from the same geometry. */
  crossings?: readonly Crossing[];
  radius?: number;
}

interface SegmentHit {
  segmentIndex: number;
  from: Point;
  to: Point;
  direction: Point;
  length: number;
  distance: number;
}

/** Locate the segment of `routeId` the crossing point sits on. */
function findSegment(
  geometry: ResolvedDocumentRoutingGeometry,
  routeId: string,
  point: Point,
): SegmentHit | null {
  const route = geometry.routes.get(routeId);
  if (!route) return null;
  for (const segment of route.segments) {
    if (!pointOnSegment(point, segment.from, segment.to)) continue;
    const direction = unitDirection(segment.from, segment.to);
    if (!direction) continue;
    return {
      segmentIndex: segment.address.segmentIndex,
      from: segment.from,
      to: segment.to,
      direction,
      length: segmentLength(segment.from, segment.to),
      distance: segmentLength(segment.from, point),
    };
  }
  return null;
}

/** How horizontal a direction is, as |cos| of its angle to the x axis. */
function horizontality(direction: Point): number {
  return Math.abs(direction.x);
}

/**
 * The hop's shape.
 *
 * The apex sits on the segment normal taken from the *canonical* direction —
 * the one pointing right, or down when the segment is vertical — so a wire
 * drawn right to left hops the same way as the one drawn left to right. A
 * horizontal Wire therefore hops upward and a vertical one to its right,
 * whichever way each was authored.
 */
function shapeJump(
  routeId: string,
  hit: SegmentHit,
  point: Point,
  radius: number,
): RouteLineJump | null {
  // The arc has to fit between the crossing and both ends of its segment,
  // or the hop would swallow a bend.
  if (
    hit.distance <= radius + EPSILON ||
    hit.distance >= hit.length - radius - EPSILON
  ) {
    return null;
  }
  const direction = hit.direction;
  const forward =
    direction.x > EPSILON ||
    (Math.abs(direction.x) <= EPSILON && direction.y > 0);
  const canonical = forward ? direction : { x: -direction.x, y: -direction.y };
  const normal = { x: canonical.y, y: -canonical.x };
  return {
    routeId,
    segmentIndex: hit.segmentIndex,
    distance: hit.distance,
    from: {
      x: point.x - direction.x * radius,
      y: point.y - direction.y * radius,
    },
    apex: { x: point.x + normal.x * radius, y: point.y + normal.y * radius },
    to: {
      x: point.x + direction.x * radius,
      y: point.y + direction.y * radius,
    },
    radius,
    clockwise: forward,
  };
}

/**
 * Every hop the Document asks for, keyed by the Route that makes it.
 *
 * Who hops: the Route carrying the flag. When both carry it the more
 * horizontal segment hops, and two equally horizontal ones are settled by
 * Route id, so exactly one of the pair hops and the choice is stable. A
 * collinear overlap never hops — there is nothing to hop over — and neither
 * does a crossing between two Routes of the same Net, because an arc there
 * would deny a connection the Document actually makes.
 *
 * The map is empty unless some Route asked, which is what keeps an untouched
 * Document byte-identical to the one this code was added to.
 */
export function deriveRouteLineJumps(
  document: SchematicDocument,
  resolver: SymbolResolver,
  options: RouteLineJumpOptions = {},
): Map<string, RouteLineJump[]> {
  const jumps = new Map<string, RouteLineJump[]>();
  const marked = new Set(
    document.routes
      .filter((route) => route.styleOverride?.lineJump === true)
      .map((route) => route.id),
  );
  if (marked.size === 0) return jumps;

  const radius = options.radius ?? ROUTE_LINE_JUMP_RADIUS;
  const geometry =
    options.routingGeometry ??
    resolveDocumentRoutingGeometry(document, resolver);
  const crossings =
    options.crossings ?? deriveCrossings(document, resolver, geometry);

  for (const crossing of crossings) {
    if (crossing.kind === "overlap") continue;
    // Two Routes of one Net meet electrically wherever they touch; drawing a
    // hop there would state the opposite.
    if (crossing.netAId === crossing.netBId) continue;
    const aMarked = marked.has(crossing.routeAId);
    const bMarked = marked.has(crossing.routeBId);
    if (!aMarked && !bMarked) continue;

    const a = findSegment(geometry, crossing.routeAId, crossing.point);
    const b = findSegment(geometry, crossing.routeBId, crossing.point);
    if (!a || !b) continue;

    let jumper: { routeId: string; hit: SegmentHit };
    if (aMarked && bMarked) {
      // `routeAId` sorts before `routeBId`, so preferring A settles a tie.
      const aJumps = horizontality(a.direction) >= horizontality(b.direction);
      jumper = aJumps
        ? { routeId: crossing.routeAId, hit: a }
        : { routeId: crossing.routeBId, hit: b };
    } else if (aMarked) {
      jumper = { routeId: crossing.routeAId, hit: a };
    } else {
      jumper = { routeId: crossing.routeBId, hit: b };
    }

    const jump = shapeJump(jumper.routeId, jumper.hit, crossing.point, radius);
    if (!jump) continue;
    const existing = jumps.get(jump.routeId);
    if (existing) existing.push(jump);
    else jumps.set(jump.routeId, [jump]);
  }

  for (const [routeId, list] of jumps) {
    list.sort(
      (left, right) =>
        left.segmentIndex - right.segmentIndex ||
        left.distance - right.distance,
    );
    // Two crossings closer together than the arc is wide cannot both hop
    // without the second arc starting inside the first.
    const spaced: RouteLineJump[] = [];
    for (const jump of list) {
      const previous = spaced.at(-1);
      if (
        previous &&
        previous.segmentIndex === jump.segmentIndex &&
        jump.distance - previous.distance < jump.radius + previous.radius
      ) {
        continue;
      }
      spaced.push(jump);
    }
    jumps.set(routeId, spaced);
  }
  return jumps;
}
