/**
 * A document as a Visio page.
 *
 * This is where the export stops being a drawing and becomes a circuit: each
 * instance is a shape that carries its own connection points, each Route is a
 * connector glued to two of them, and each branch is a node the connectors hold
 * on to. Move a transistor in Visio and its wires follow, because Visio is
 * reading the same electrical facts the schematic does — not because anything
 * here tried to redraw them.
 *
 * What the page cannot say yet is recorded as a caveat rather than dropped.
 */

import {
  contactRequiresJunctionDot,
  deriveDocumentContactEvidence,
  resolveDocumentLogicalNets,
  resolveDocumentRoutingGeometry,
  resolveDocumentStyleProfile,
} from "@icm/derived";
import type { CoincidentContact, SchematicStyleProfile } from "@icm/derived";
import type { Point, RouteEndpoint, SchematicDocument } from "@icm/model";
import { routeEnd } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import { DEFAULT_PAGE_NAME, packVisioDrawing } from "./drawing.js";
import type { VisioDrawing } from "./drawing.js";
import {
  boundsOfPoints,
  pageFrameForBounds,
  placedSymbolBoxCorners,
  visioShapePlacement,
} from "./geometry.js";
import type { DocumentPoint, PagePoint, VisioPageFrame } from "./geometry.js";
import type { VisioMaster } from "./masters.js";
import type { VisioPageDescription } from "./parts.js";
import { instanceShapeData, shapeDataSection } from "./shape-data.js";
import type { VisioShapeDataRow } from "./shape-data.js";
import {
  buildSymbolMaster,
  symbolHasVisioMaster,
  visioMasterSourcesForSymbol,
  visioSymbolMasterKey,
} from "./symbol-master.js";
import type { VisioMasterCaveat, VisioSymbolMaster } from "./symbol-master.js";
import { inchesFromUnits } from "./units.js";
import {
  connectRecord,
  nodeMaster,
  nodeShape,
  wireMaster,
  wireShape,
} from "./wire.js";
import type { WireGlue } from "./wire.js";
import { formatVisioNumber } from "./xml.js";

/**
 * The first page shape ID.
 *
 * Visio reserves the low sheet IDs of a container — a master whose shapes start
 * at 1 loads with none of them — so a page starts where a master does. Nothing
 * refers to these numbers but the page itself.
 */
const FIRST_PAGE_SHAPE_ID = 5;

/** What an empty document exports as: a blank page of ordinary paper. */
const EMPTY_PAGE_WIDTH_INCHES = 8.5;
const EMPTY_PAGE_HEIGHT_INCHES = 11;

/** Something the page could not say. Nothing here is dropped quietly. */
export type VisioPageCaveat =
  | VisioMasterCaveat
  | { readonly kind: "adaptive-symbol"; readonly detail: string }
  | { readonly kind: "unplaced-instance"; readonly detail: string }
  | { readonly kind: "unresolved-route"; readonly detail: string }
  | { readonly kind: "unglued-wire-end"; readonly detail: string };

/** What the page holds, for the structural assertions the tests make. */
export interface VisioPageCounts {
  readonly instanceShapes: number;
  readonly nodeShapes: number;
  readonly wireShapes: number;
  /** Wire ends glued to a connection point. */
  readonly glue: number;
}

export interface VisioPageContents {
  readonly page: VisioPageDescription;
  readonly masters: readonly VisioMaster[];
  /** The `<Shapes>` and `<Connects>` elements of the page part. */
  readonly body: string;
  readonly caveats: readonly VisioPageCaveat[];
  readonly counts: VisioPageCounts;
}

interface PlacedInstance {
  readonly instance: SchematicDocument["instances"][number];
  readonly symbolMaster: VisioSymbolMaster;
  readonly shapeId: number;
  /** Page IDs for the master's artwork children, in the master's order. */
  readonly childShapeIds: readonly number[];
  readonly glueByPinName: ReadonlyMap<string, Omit<WireGlue, "sheetId">>;
}

/**
 * The masters a document reaches, numbered from 1 in the order its instances
 * first use them.
 *
 * Naming goes through the symbol's full set of variants rather than the ones
 * this document happens to use, so a master called `NMOS (textbook-3terminal)`
 * is called that in every export and in the stencil.
 */
function collectSymbolMasters(
  instances: readonly SchematicDocument["instances"][number][],
  resolver: SymbolResolver,
  profile: SchematicStyleProfile,
  caveats: VisioPageCaveat[],
): Map<string, VisioSymbolMaster> {
  const masters = new Map<string, VisioSymbolMaster>();
  for (const instance of instances) {
    const resolved = resolver.resolve(
      instance.symbolId,
      instance.symbolVariantId,
    );
    if (!resolved) {
      throw new Error(`Unresolved symbol: ${instance.symbolId}`);
    }
    if (!symbolHasVisioMaster(resolved.definition)) continue;
    const key = visioSymbolMasterKey(
      resolved.definition.id,
      resolved.variant?.id,
    );
    if (masters.has(key)) continue;
    const source = visioMasterSourcesForSymbol(resolved.definition).find(
      (candidate) => candidate.variant?.id === resolved.variant?.id,
    );
    if (!source) {
      throw new Error(
        `Symbol "${resolved.definition.id}" resolved to a variant it does not declare`,
      );
    }
    const symbolMaster = buildSymbolMaster(source, masters.size + 1, profile);
    masters.set(key, symbolMaster);
    caveats.push(...symbolMaster.caveats);
  }
  return masters;
}

/** Junction dots the schematic draws, by the rule the SVG renderer uses. */
function visibleContacts(
  document: SchematicDocument,
  contacts: readonly CoincidentContact[],
): CoincidentContact[] {
  const logicalNets = resolveDocumentLogicalNets(document);
  const powerRailRouteIds = new Set(
    document.routes
      .filter(
        (route) =>
          route.presentation === "power-rail" &&
          logicalNets.byBaseNetId.get(route.netId)?.powerDomain === "vdd",
      )
      .map((route) => route.id),
  );
  return contacts
    .filter(
      (contact) =>
        !contact.incidents.some(
          (incident) =>
            incident.kind === "route" &&
            powerRailRouteIds.has(incident.objectId),
        ),
    )
    .filter((contact) => contactRequiresJunctionDot(contact));
}

function junctionEndpointId(endpoint: RouteEndpoint): string | undefined {
  return endpoint.kind === "junction" ? endpoint.junctionId : undefined;
}

interface NodePlan {
  /** Junction ID, or the derived contact's ID when no Junction is persisted. */
  readonly id: string;
  readonly at: Point;
  readonly visible: boolean;
  /** Undefined for a derived contact, which no Route endpoint names. */
  readonly junctionId: string | undefined;
}

/**
 * The nodes the page needs.
 *
 * Two different things want a node shape and they only partly overlap: a
 * Junction a Route ends on needs one whether or not a dot is drawn there, since
 * that is what the connector glues to, and a contact the schematic dots needs
 * one whether or not a Junction is persisted there. A node that carries no dot
 * is still on the page, just not filled.
 */
function planNodes(
  document: SchematicDocument,
  contacts: readonly CoincidentContact[],
): NodePlan[] {
  const dotted = new Set<string>();
  const derived: NodePlan[] = [];
  for (const contact of contacts) {
    const junctionId = contact.endpoints
      .map(junctionEndpointId)
      .find((id) => id !== undefined);
    if (junctionId) dotted.add(junctionId);
    else {
      derived.push({
        id: contact.id,
        at: contact.point,
        visible: true,
        junctionId: undefined,
      });
    }
  }

  const glued = new Set<string>();
  for (const route of document.routes) {
    for (const endpoint of [route.start, routeEnd(route)]) {
      const id = junctionEndpointId(endpoint);
      if (id) glued.add(id);
    }
  }

  const junctions = document.junctions
    .filter((junction) => glued.has(junction.id) || dotted.has(junction.id))
    .map((junction): NodePlan => ({
      id: junction.id,
      at: junction.position,
      visible: dotted.has(junction.id),
      junctionId: junction.id,
    }));
  return [...junctions, ...derived].sort((left, right) =>
    left.id.localeCompare(right.id, "en"),
  );
}

function netShapeDataRows(
  document: SchematicDocument,
  route: SchematicDocument["routes"][number],
): VisioShapeDataRow[] {
  const name = resolveDocumentLogicalNets(document).byBaseNetId.get(
    route.netId,
  )?.name;
  const rows: VisioShapeDataRow[] = [];
  if (name) rows.push({ name: "Net", label: "Net", value: name });
  rows.push({ name: "IcmNetId", label: "icm:netId", value: route.netId });
  rows.push({ name: "IcmRouteId", label: "icm:routeId", value: route.id });
  return rows;
}

function instanceShape(
  placed: PlacedInstance,
  document: SchematicDocument,
  resolver: SymbolResolver,
  frame: VisioPageFrame,
): string {
  const { instance, symbolMaster } = placed;
  const placement = instance.placement!;
  const resolved = resolver.resolve(
    instance.symbolId,
    instance.symbolVariantId,
  )!;
  const spot = visioShapePlacement(
    resolved.definition.viewBox,
    placement.position,
    placement,
    frame,
  );
  const rows = instanceShapeData(document, instance, resolved);
  // A symbol master is a group, and Visio gives every child of a placed group a
  // page shape ID of its own. It allocates those IDs by counting up from the
  // group's, so a page that does not declare them loses the shapes that happen
  // to hold the numbers — silently, on open. Declaring them is also what Visio
  // writes itself: `Type="Group"` with one `MasterShape` child per artwork
  // shape.
  const children = placed.childShapeIds
    .map(
      (masterShapeId, index) =>
        `<Shape ID="${placed.shapeId + 1 + index}" Type="Shape" MasterShape="${masterShapeId}"/>`,
    )
    .join("");
  return (
    `<Shape ID="${placed.shapeId}" Type="Group" Master="${symbolMaster.master.id}">` +
    `<Cell N="PinX" V="${formatVisioNumber(spot.pin.x)}"/>` +
    `<Cell N="PinY" V="${formatVisioNumber(spot.pin.y)}"/>` +
    `<Cell N="Angle" V="${formatVisioNumber(spot.angleRadians)}"/>` +
    `<Cell N="FlipX" V="${spot.flipX}"/><Cell N="FlipY" V="${spot.flipY}"/>` +
    shapeDataSection(rows) +
    (children === "" ? "" : `<Shapes>${children}</Shapes>`) +
    `</Shape>`
  );
}

export interface VisioPageOptions {
  readonly pageName?: string;
}

export function buildVisioPage(
  document: SchematicDocument,
  resolver: SymbolResolver,
  options: VisioPageOptions = {},
): VisioPageContents {
  const caveats: VisioPageCaveat[] = [];
  const profile = resolveDocumentStyleProfile(document.presentation);
  const routingGeometry = resolveDocumentRoutingGeometry(document, resolver);
  const contactEvidence = deriveDocumentContactEvidence(
    document,
    resolver,
    routingGeometry,
  );

  const placeable = [...document.instances].sort((left, right) =>
    left.id.localeCompare(right.id, "en"),
  );
  for (const instance of placeable) {
    if (instance.placement === null) {
      caveats.push({ kind: "unplaced-instance", detail: instance.id });
    }
  }
  const placed = placeable.filter((instance) => instance.placement !== null);
  const symbolMasters = collectSymbolMasters(
    placed,
    resolver,
    profile,
    caveats,
  );
  // The wiring masters follow the symbols, so every ID is known before a shape
  // that refers to one is written.
  const wireMasterId = symbolMasters.size + 1;
  const nodeMasterId = symbolMasters.size + 2;

  // An adaptive block is drawn from its typeset formula, so it has no master
  // and nothing on the page yet; the text half of the export owns it.
  const drawable = placed.filter((instance) => {
    const resolved = resolver.resolve(
      instance.symbolId,
      instance.symbolVariantId,
    )!;
    if (symbolHasVisioMaster(resolved.definition)) return true;
    caveats.push({
      kind: "adaptive-symbol",
      detail: `${instance.reference ?? instance.id} (${resolved.definition.id})`,
    });
    return false;
  });

  for (const route of document.routes) {
    if (!routingGeometry.routes.has(route.id)) {
      caveats.push({ kind: "unresolved-route", detail: route.id });
    }
  }
  const routes = [...routingGeometry.routes.values()];
  const nodes = planNodes(
    document,
    visibleContacts(document, contactEvidence.contacts),
  );

  const extent: DocumentPoint[] = [
    ...drawable.flatMap((instance) => {
      const resolved = resolver.resolve(
        instance.symbolId,
        instance.symbolVariantId,
      )!;
      const placement = instance.placement!;
      return placedSymbolBoxCorners(
        resolved.definition.viewBox,
        placement.position,
        placement,
      );
    }),
    ...routes.flatMap((route) => [...route.centerline]),
    ...nodes.map((node) => node.at),
  ];
  const bounds = boundsOfPoints(extent);
  const frame = bounds
    ? pageFrameForBounds(bounds)
    : {
        widthInches: EMPTY_PAGE_WIDTH_INCHES,
        heightInches: EMPTY_PAGE_HEIGHT_INCHES,
        point: (point: DocumentPoint): PagePoint => point,
      };

  let nextShapeId = FIRST_PAGE_SHAPE_ID;
  const instancesById = new Map<string, PlacedInstance>();
  const instanceShapes = drawable.map((instance) => {
    const resolved = resolver.resolve(
      instance.symbolId,
      instance.symbolVariantId,
    )!;
    const symbolMaster = symbolMasters.get(
      visioSymbolMasterKey(resolved.definition.id, resolved.variant?.id),
    )!;
    const shapeId = nextShapeId;
    // The group's own ID, then one for each child Visio will instantiate.
    nextShapeId += 1 + symbolMaster.childShapeIds.length;
    const entry: PlacedInstance = {
      instance,
      symbolMaster,
      shapeId,
      childShapeIds: symbolMaster.childShapeIds,
      glueByPinName: new Map(
        symbolMaster.connections.map((connection, index) => [
          connection.pinName,
          { rowName: connection.rowName, rowIndex: index },
        ]),
      ),
    };
    instancesById.set(instance.id, entry);
    return instanceShape(entry, document, resolver, frame);
  });

  const nodeIdsToShapeId = new Map<string, number>();
  const nodeShapes = nodes.map((node) => {
    const shapeId = nextShapeId++;
    if (node.junctionId) nodeIdsToShapeId.set(node.junctionId, shapeId);
    return { node, shapeId };
  });

  const glueFor = (
    endpoint: RouteEndpoint,
    routeId: string,
  ): WireGlue | undefined => {
    if (endpoint.kind === "junction") {
      const sheetId = nodeIdsToShapeId.get(endpoint.junctionId);
      if (sheetId === undefined) return undefined;
      return { sheetId, rowName: "Row_1", rowIndex: 0 };
    }
    const placedInstance = instancesById.get(endpoint.instanceId);
    const row = placedInstance?.glueByPinName.get(endpoint.pinName);
    if (!placedInstance || !row) {
      caveats.push({
        kind: "unglued-wire-end",
        detail: `${routeId} at ${endpoint.instanceId}.${endpoint.pinName}`,
      });
      return undefined;
    }
    return { sheetId: placedInstance.shapeId, ...row };
  };

  const connects: string[] = [];
  const wireShapes = routes.map((route) => {
    const shapeId = nextShapeId++;
    const begin = glueFor(
      route.endpointConnections.from.endpoint,
      route.routeId,
    );
    const end = glueFor(route.endpointConnections.to.endpoint, route.routeId);
    if (begin) connects.push(connectRecord(shapeId, "begin", begin));
    if (end) connects.push(connectRecord(shapeId, "end", end));
    const documentRoute = document.routes.find(
      (candidate) => candidate.id === route.routeId,
    )!;
    return wireShape({
      id: shapeId,
      masterId: wireMasterId,
      points: route.centerline.map((point) => frame.point(point)),
      begin,
      end,
      propertySection: shapeDataSection(
        netShapeDataRows(document, documentRoute),
      ),
    });
  });

  const masters: VisioMaster[] = [...symbolMasters.values()].map(
    (symbolMaster) => symbolMaster.master,
  );
  if (wireShapes.length > 0) {
    masters.push(
      wireMaster(wireMasterId, inchesFromUnits(profile.strokes.wire)),
    );
  }
  if (nodeShapes.length > 0) {
    masters.push(
      nodeMaster(nodeMasterId, inchesFromUnits(profile.nodes.junctionRadius)),
    );
  }

  const body =
    `<Shapes>` +
    instanceShapes.join("") +
    nodeShapes
      .map(({ node, shapeId }) =>
        nodeShape(shapeId, nodeMasterId, frame.point(node.at), node.visible),
      )
      .join("") +
    wireShapes.join("") +
    `</Shapes>` +
    (connects.length === 0 ? "" : `<Connects>${connects.join("")}</Connects>`);

  return {
    page: {
      name: options.pageName ?? document.name ?? DEFAULT_PAGE_NAME,
      widthInches: frame.widthInches,
      heightInches: frame.heightInches,
    },
    masters,
    body,
    caveats,
    counts: {
      instanceShapes: instanceShapes.length,
      nodeShapes: nodeShapes.length,
      wireShapes: wireShapes.length,
      glue: connects.length,
    },
  };
}

/** A document as a drawing ready to be packed. */
export function visioDrawingForDocument(
  document: SchematicDocument,
  resolver: SymbolResolver,
  options: VisioPageOptions = {},
): { readonly drawing: VisioDrawing; readonly page: VisioPageContents } {
  const page = buildVisioPage(document, resolver, options);
  return {
    page,
    drawing: {
      page: page.page,
      title: document.name,
      masters: page.masters,
      pageBody: page.body,
    },
  };
}

/** Writes a document as `.vsdx` bytes. */
export function packVisioDocument(
  document: SchematicDocument,
  resolver: SymbolResolver,
  options: VisioPageOptions = {},
): Uint8Array {
  return packVisioDrawing(
    visioDrawingForDocument(document, resolver, options).drawing,
  );
}
