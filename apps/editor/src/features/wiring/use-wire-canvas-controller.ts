import { useEffect, useMemo, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import type {
  WireCornerOrder,
  WireDraftStep,
  WireRoutingMode,
  WireSource,
} from "@icm/edit-engine";
import {
  endpointKey,
  resolveRouteTap,
  type RoutedComponent,
} from "@icm/derived";
import type { Point, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import {
  freeWireDraftTarget,
  type EditorTool,
  type WireDraftTarget,
} from "../../interaction/interaction-state";
import type { SnapGuideLine } from "../../snap/engine";
import type { VisualSelection } from "../selection/visual-selection";
import { planSelectionMove } from "../selection/selection-move-plan";
import {
  looseRouteAnchorIds,
  type RouteGeometryRecord,
} from "./route-interaction-geometry";
import type {
  CurrentWireSession,
  RouteStretchPreview,
} from "./use-wire-interaction";
import {
  buildWireCanvasSnapIndex,
  resolveWireCanvasSnap as resolveWireCanvasSnapModel,
  type WireCanvasSnapResult,
} from "./wire-canvas-snap";
import { wireDraftTargetFromSnap } from "./wire-draft-preview";
import { nextWireCornerShape } from "./wire-corner-shape";
import { wireCaptureRadius } from "../../canvas/canvas-viewport";

const SNAP_CAPTURE_RADIUS_PX = 7;

export interface UseWireCanvasControllerOptions {
  model: {
    document: SchematicDocument;
    resolver: SymbolResolver;
    wiringEndpoints: readonly WireSource[];
    routeGeometryRecords: readonly RouteGeometryRecord[];
    contactComponents: readonly RoutedComponent[];
  };
  session: {
    wireSource: WireSource | null;
    wireDraftSteps: readonly WireDraftStep[];
    wireRoutingMode: WireRoutingMode;
    wireCornerOrder: WireCornerOrder;
    tool: EditorTool;
    vddRailMode: boolean;
    componentPlacementPending: boolean;
    getInteractionKind: () => string;
    cancelInteraction: () => void;
    setWireSource: (source: WireSource, revision: number) => void;
    setWirePreview: (target: WireDraftTarget | null) => void;
    setWireDraftSteps: (steps: WireDraftStep[]) => void;
    setWireRoutingMode: (mode: WireRoutingMode) => void;
    setWireCornerOrder: (order: WireCornerOrder) => void;
    readCurrentWireSession: () => CurrentWireSession;
  };
  selection: {
    selectedInstanceIds: readonly string[];
    selection: VisualSelection;
    beginInstanceMove: (
      event: ReactPointerEvent<SVGElement>,
      instanceId: string,
      hitTarget: SVGElement,
    ) => void;
    beginVisualSelectionMove: (
      event: ReactPointerEvent<SVGElement>,
      selection: VisualSelection,
      hitTarget: SVGElement,
    ) => void;
  };
  routes: {
    handlePointerDown: (
      event: ReactPointerEvent<SVGElement>,
      routeId: string,
      hitTarget: SVGElement,
    ) => void;
    select: (routeId: string, segmentIndex?: number) => void;
    beginStretch: (
      event: ReactPointerEvent<SVGElement>,
      routeId: string,
      segmentIndex: number,
      intent: RouteStretchPreview["intent"],
      hitTarget: SVGElement,
    ) => void;
    sourceForTarget: (target: WireDraftTarget) => WireSource | null;
  };
  viewport: {
    pointFromClient: (
      clientX: number,
      clientY: number,
      svg: SVGSVGElement,
    ) => Point;
    logicalRadiusForPixels: (svg: SVGSVGElement, pixels: number) => number;
    paintSnapGuides: (guides: readonly SnapGuideLine[]) => void;
  };
  commands: {
    commitWire: (source: WireSource) => void;
    fixWirePoint: (point: Point) => void;
    finishWireAtPoint: (point: Point) => void;
    completeWire: () => void;
    setStatus: (status: string) => void;
  };
}

/** Route hits, canvas wire snapping, and the remembered corner preference. */
export function useWireCanvasController({
  model: {
    document,
    resolver,
    wiringEndpoints,
    routeGeometryRecords,
    contactComponents,
  },
  session: {
    wireSource,
    wireDraftSteps,
    wireRoutingMode,
    wireCornerOrder,
    tool,
    vddRailMode,
    componentPlacementPending,
    getInteractionKind,
    cancelInteraction,
    setWireSource,
    setWirePreview,
    setWireDraftSteps,
    setWireRoutingMode,
    setWireCornerOrder,
    readCurrentWireSession,
  },
  selection: {
    selectedInstanceIds,
    selection,
    beginInstanceMove,
    beginVisualSelectionMove,
  },
  routes: {
    handlePointerDown: handleWireRoutePointerDown,
    select: selectRoute,
    beginStretch: beginRouteStretch,
    sourceForTarget,
  },
  viewport: { pointFromClient, logicalRadiusForPixels, paintSnapGuides },
  commands: {
    commitWire,
    fixWirePoint,
    finishWireAtPoint,
    completeWire,
    setStatus,
  },
}: UseWireCanvasControllerOptions) {
  const lastWireShapeRef = useRef<{
    routingMode: WireRoutingMode;
    cornerOrder: WireCornerOrder;
  }>({ routingMode: "orthogonal", cornerOrder: "auto" });
  /**
   * The point a just-committed leg has to keep drawing from.
   *
   * A click draws, so the conductor is already in the Document by the time
   * the next leg starts; the continuation has to attach to that new geometry,
   * which only exists in the next render. The effect below re-resolves this
   * point against the fresh Document and re-anchors the wire there.
   */
  const continueFromRef = useRef<{ point: Point; svg: SVGSVGElement } | null>(
    null,
  );
  const wireCanvasSnapIndex = useMemo(
    () => buildWireCanvasSnapIndex(wiringEndpoints, routeGeometryRecords),
    [routeGeometryRecords, wiringEndpoints],
  );

  useEffect(() => {
    if (tool !== "wire" || wireSource !== null || wireDraftSteps.length > 0) {
      return;
    }
    const remembered = lastWireShapeRef.current;
    if (remembered.routingMode !== wireRoutingMode) {
      setWireRoutingMode(remembered.routingMode);
    }
    if (remembered.cornerOrder !== wireCornerOrder) {
      setWireCornerOrder(remembered.cornerOrder);
    }
  }, [
    tool,
    wireSource,
    wireDraftSteps.length,
    wireRoutingMode,
    wireCornerOrder,
    setWireRoutingMode,
    setWireCornerOrder,
  ]);

  const resolveWireCanvasSnap = (
    point: Point,
    svg: SVGSVGElement,
    suppressSnap: boolean,
  ): WireCanvasSnapResult => {
    const wire = readCurrentWireSession();
    return resolveWireCanvasSnapModel(
      {
        document,
        resolver,
        wiringEndpoints,
        routeGeometryRecords,
        contactComponents,
        wireSource: wire.source,
        wireWaypoints: wire.steps.map((step) => step.point),
        captureTolerance: wireCaptureRadius(svg),
        snapIndex: wireCanvasSnapIndex,
      },
      point,
      suppressSnap,
    );
  };

  const cycleWireCornerShape = (): void => {
    const wire = readCurrentWireSession();
    const next = nextWireCornerShape(
      wire.routingMode,
      wire.cornerOrder,
      wire.source,
      wire.steps,
    );
    lastWireShapeRef.current = next;
    if (next.routingMode !== wire.routingMode) {
      setWireRoutingMode(next.routingMode);
    }
    setWireCornerOrder(next.cornerOrder);
    setStatus(`Wire corner: ${next.label}`);
  };

  /**
   * One primary click on the canvas, a Pin or a Route.
   *
   * The first click anchors the wire; every later one draws the leg it has
   * been previewing and keeps drawing from there, the way Virtuoso does. No
   * gesture waits for a double-click to become real geometry — the
   * double-click only stops the wire.
   */
  const applyWireCanvasPoint = (
    rawPoint: Point,
    svg: SVGSVGElement,
    suppressSnap: boolean,
  ): void => {
    const resolved = resolveWireCanvasSnap(rawPoint, svg, suppressSnap);
    paintSnapGuides([]);
    const liveSource = readCurrentWireSession().source;
    if (resolved.ambiguous) {
      setStatus(
        "Ambiguous connection: choose one endpoint or conductor away from the overlap",
      );
      return;
    }
    // The press reads the snap through the same function the hover preview
    // reads it through, so what the draft has been drawing is what this
    // click acts on.
    const target = wireDraftTargetFromSnap(resolved);
    if (target.kind === "free") {
      const wire = readCurrentWireSession();
      if (!wire.source) {
        // The first click only anchors the wire; there is nothing to draw yet.
        fixWirePoint(target.point);
        return;
      }
      // The active endpoint is excluded from capture, so this is a click on
      // the point the wire is already drawing from. A zero-length leg is not
      // geometry, so the wire simply keeps waiting for a real one.
      if (
        wire.steps.length === 0 &&
        target.point.x === wire.source.connection.gridLanding.x &&
        target.point.y === wire.source.connection.gridLanding.y
      )
        return;
      finishWireAtPoint(target.point);
      // `finishWireAtPoint` clears the session on a successful commit; the
      // effect below picks the wire back up on the leg it just created.
      if (readCurrentWireSession().source === null) {
        continueFromRef.current = { point: target.point, svg };
      }
      return;
    }
    const candidate = sourceForTarget(target);
    if (!candidate) {
      setStatus("That connection target is no longer on the sheet");
      return;
    }
    if (!liveSource) {
      setWireSource(candidate, document.revision);
      setWirePreview(freeWireDraftTarget(candidate.connection.contactPoint));
      setWireDraftSteps([]);
      setStatus(
        target.kind === "route"
          ? `Wire source: route ${target.routeId}`
          : `Wire source: ${endpointKey(candidate.endpoint)}`,
      );
      return;
    }
    if (endpointKey(liveSource.endpoint) === endpointKey(candidate.endpoint)) {
      setStatus("Choose a different endpoint");
      return;
    }
    commitWire(candidate);
  };

  // Re-anchor a drawing wire on the leg its own click just committed. The
  // commit bumped the revision, so this render is the first one whose
  // connectivity contains the new Route endpoint to attach to.
  useEffect(() => {
    const pending = continueFromRef.current;
    if (!pending) return;
    if (tool !== "wire" || wireSource !== null) {
      // Esc, a tool change or an unrelated edit got here first.
      continueFromRef.current = null;
      return;
    }
    continueFromRef.current = null;
    const resolved = resolveWireCanvasSnap(pending.point, pending.svg, false);
    if (resolved.ambiguous) return;
    const target = wireDraftTargetFromSnap(resolved);
    const source = target.kind === "free" ? null : sourceForTarget(target);
    if (!source) return;
    setWireSource(source, document.revision);
    setWirePreview(freeWireDraftTarget(pending.point));
    setWireDraftSteps([]);
    setStatus(
      `Committed route at revision ${document.revision} · Drawing on from here · double-click, Enter or Esc ends the wire`,
    );
  });

  /**
   * Stop the wire after the leg the current gesture has already drawn.
   *
   * The double-click that ends a wire arrives while the continuation its own
   * first click scheduled may still be pending, so this reads the live session
   * and drops that continuation instead of trusting the last rendered source.
   */
  const endWireSession = (): void => {
    continueFromRef.current = null;
    if (readCurrentWireSession().source) completeWire();
    setStatus("Wire finished · Esc exits");
  };

  const handleRoutePointerDown = (
    event: ReactPointerEvent<SVGElement>,
    routeId: string,
    hitTarget: SVGElement = event.currentTarget,
  ): void => {
    if (vddRailMode || componentPlacementPending) return;
    if (
      getInteractionKind() === "moving-selection" &&
      selectedInstanceIds.length > 0
    ) {
      const primaryInstanceId = selectedInstanceIds.at(-1);
      if (primaryInstanceId) {
        beginInstanceMove(event, primaryInstanceId, hitTarget);
      }
      return;
    }
    if (tool !== "pointer") {
      // The middle button never places or taps. Its one rule — pan, and cycle
      // the corner shape on a release that did not drag — lives in the
      // gesture controller, which is where the canvas background already sent
      // it; this controller used to carry a second copy. Other non-primary
      // buttons leave the conductor untouched so right-click keeps cancelling
      // through the context-menu path.
      if (event.button !== 0) return;
      if (tool === "wire") {
        event.stopPropagation();
        // The canvas click capture resolves every wire target, including this
        // hit band, through the same resolver as the hover preview.
      } else {
        handleWireRoutePointerDown(event, routeId, hitTarget);
      }
      return;
    }
    event.stopPropagation();
    if (event.altKey) {
      setStatus("Snap suppressed while Alt is held");
      return;
    }
    const routeRecord = routeGeometryRecords.find(
      (candidate) => candidate.route.id === routeId,
    );
    if (!routeRecord) return;
    const svg = (hitTarget.ownerSVGElement ?? hitTarget) as SVGSVGElement;
    const pointer = pointFromClient(event.clientX, event.clientY, svg);
    const tap = resolveRouteTap(
      routeRecord.geometry,
      pointer,
      logicalRadiusForPixels(svg, SNAP_CAPTURE_RADIUS_PX),
    );
    const segmentIndex = tap?.address.segmentIndex ?? 0;
    if (getInteractionKind() === "moving-selection") {
      const movePlan = planSelectionMove(document, selection);
      if (movePlan.previewObjectIds.length > 0) {
        beginVisualSelectionMove(event, selection, hitTarget);
        return;
      }
      cancelInteraction();
    }
    selectRoute(routeId, segmentIndex);
    beginRouteStretch(
      event,
      routeId,
      segmentIndex,
      routeRecord.route.presentation === "power-rail"
        ? "move-power-rail"
        : looseRouteAnchorIds(document, routeRecord.route) !== null
          ? "move-loose-route"
          : "stretch-segment",
      hitTarget,
    );
  };

  return {
    resolveWireCanvasSnap,
    cycleWireCornerShape,
    applyWireCanvasPoint,
    endWireSession,
    handleRoutePointerDown,
  };
}
