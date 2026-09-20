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
  annotationFontSize,
  annotationOwningInstanceId,
  contactRequiresJunctionDot,
  deriveDocumentContactEvidence,
  isSchematicAnnotationVisible,
  resolveAnnotationPresentation,
  resolveAnnotationText,
  resolveAnnotationTextColor,
  resolveDocumentLogicalNets,
  resolveDocumentRoutingGeometry,
  resolveDocumentStyleProfile,
} from "@icm/derived";
import type {
  AnnotationPresentation,
  CoincidentContact,
  SchematicStyleProfile,
} from "@icm/derived";
import type {
  Annotation,
  Point,
  RouteEndpoint,
  SchematicDocument,
} from "@icm/model";
import { routeEnd, transformPoint } from "@icm/model";
import type {
  SymbolDefinition,
  SymbolResolver,
  SymbolVariant,
} from "@icm/symbols";

import { DEFAULT_PAGE_NAME, packVisioDrawing } from "./drawing.js";
import type { VisioDrawing } from "./drawing.js";
import type { VisioShapeFollow } from "./follow.js";
import {
  FORMULA_RULE_BOX_HEIGHT,
  formulaRuleShape,
  resolveVisioFormulaBody,
} from "./formula-text.js";
import type { VisioFormulaBody } from "./formula-text.js";
import {
  boundsOfPoints,
  pageFrameForBounds,
  placedSymbolBoxCorners,
  visioShapePlacement,
} from "./geometry.js";
import type {
  DocumentPoint,
  PagePoint,
  VisioShapePlacement,
} from "./geometry.js";
import type { VisioMaster } from "./masters.js";
import type { VisioPageDescription } from "./parts.js";
import { instanceShapeData, shapeDataSection } from "./shape-data.js";
import type { VisioShapeDataRow } from "./shape-data.js";
import {
  resolveVisioInstanceSymbol,
  visioAdaptiveBodyKey,
} from "./signal-flow-block.js";
import {
  buildSymbolMaster,
  symbolHasVisioMaster,
  visioMasterSourcesForSymbol,
  visioSymbolMasterKey,
} from "./symbol-master.js";
import type { VisioMasterCaveat, VisioSymbolMaster } from "./symbol-master.js";
import { textShape, visioTextContent } from "./text.js";
import type { VisioTextCaveat } from "./text.js";
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
  | VisioTextCaveat
  | { readonly kind: "annotation-ornament"; readonly detail: string }
  | { readonly kind: "unplaced-instance"; readonly detail: string }
  | { readonly kind: "unresolved-route"; readonly detail: string }
  | { readonly kind: "unglued-wire-end"; readonly detail: string };

/** What the page holds, for the structural assertions the tests make. */
export interface VisioPageCounts {
  readonly instanceShapes: number;
  readonly nodeShapes: number;
  readonly wireShapes: number;
  readonly textShapes: number;
  /** Shapes drawn for a block's body text, its fraction bar included. */
  readonly formulaShapes: number;
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
  readonly placement: VisioShapePlacement;
  /** Page IDs for the master's artwork children, in the master's order. */
  readonly childShapeIds: readonly number[];
  readonly glueByPinName: ReadonlyMap<string, Omit<WireGlue, "sheetId">>;
}

/**
 * The symbol an instance is drawn from, resolved once per instance.
 *
 * A signal-flow block's body comes out of its own formula, so the definition
 * the page draws is not always the one the resolver returned. Everything
 * downstream — the master, the placement, the page extent — has to agree on
 * which it is, so the answer is computed once and carried.
 */
function drawnSymbol(
  instance: SchematicDocument["instances"][number],
  resolver: SymbolResolver,
): {
  /** What the resolver returned, whose declared variants name the master. */
  shared: SymbolDefinition;
  definition: SymbolDefinition;
  variant: SymbolVariant | undefined;
  bodyKey: string | undefined;
  masterKey: string;
} {
  const resolved = resolver.resolve(
    instance.symbolId,
    instance.symbolVariantId,
  );
  if (!resolved) {
    throw new Error(`Unresolved symbol: ${instance.symbolId}`);
  }
  const bodyKey = visioAdaptiveBodyKey(
    resolved.definition,
    instance.signalFlowParameters,
  );
  return {
    shared: resolved.definition,
    definition: resolveVisioInstanceSymbol(
      resolved.definition,
      instance.signalFlowParameters,
    ),
    variant: resolved.variant,
    bodyKey,
    masterKey: visioSymbolMasterKey(
      resolved.definition.id,
      resolved.variant?.id,
      bodyKey,
    ),
  };
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
    const drawn = drawnSymbol(instance, resolver);
    if (masters.has(drawn.masterKey)) continue;
    // A shared master comes from the symbol's own declared sources, so a
    // variant it does not declare is caught here. A body resolved per instance
    // has no such list to check against: the definition being drawn is the
    // whole source.
    const source = symbolHasVisioMaster(drawn.shared)
      ? visioMasterSourcesForSymbol(drawn.shared).find(
          (candidate) => candidate.variant?.id === drawn.variant?.id,
        )
      : {
          definition: drawn.definition,
          variant: drawn.variant,
          disambiguate: false,
          bodyKey: drawn.bodyKey,
        };
    if (!source) {
      throw new Error(
        `Symbol "${drawn.shared.id}" resolved to a variant it does not declare`,
      );
    }
    const symbolMaster = buildSymbolMaster(source, masters.size + 1, profile);
    masters.set(drawn.masterKey, symbolMaster);
    // A master carries no body text — the page draws that itself, upright and
    // per instance — so the caveat the master raises about it is the stencil's
    // business rather than the page's. The page answers for its own instances.
    caveats.push(
      ...symbolMaster.caveats.filter((caveat) => caveat.kind !== "body-text"),
    );
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
): string {
  const { instance, symbolMaster, placement: spot } = placed;
  const resolved = resolver.resolve(
    instance.symbolId,
    instance.symbolVariantId,
  )!;
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

interface PlannedAnnotation {
  readonly annotation: Annotation;
  readonly presentation: AnnotationPresentation;
}

/** One instance's body text, and where the instance carried it to. */
interface PlannedFormula {
  readonly body: VisioFormulaBody;
  /** Symbol-local to document coordinates; upright, so a shift and no more. */
  readonly translate: DocumentPoint;
}

/**
 * The annotations the page draws, in a stable order.
 *
 * Visibility is the schematic's own rule rather than a second one: an
 * annotation whose text resolves to nothing, or whose Instance is in the Tray,
 * paints no glyph on the canvas and none on the page either.
 */
function planAnnotations(
  document: SchematicDocument,
  resolver: SymbolResolver,
  profile: SchematicStyleProfile,
  routingGeometry: ReturnType<typeof resolveDocumentRoutingGeometry>,
  logicalNets: ReturnType<typeof resolveDocumentLogicalNets>,
): PlannedAnnotation[] {
  return [...document.annotations]
    .filter((annotation) =>
      isSchematicAnnotationVisible(document, annotation, logicalNets),
    )
    .sort((left, right) => left.id.localeCompare(right.id, "en"))
    .map((annotation) => ({
      annotation,
      presentation: resolveAnnotationPresentation(
        document,
        resolver,
        annotation,
        profile,
        routingGeometry,
        logicalNets,
      ),
    }));
}

/**
 * The marks an annotation carries besides its text.
 *
 * A current marker is an arrowhead, a voltage marker a pair of polarity signs,
 * and a global Net Label a badge. All three are geometry the page does not draw
 * yet, so each is named rather than left to be noticed missing.
 */
function annotationOrnament(
  document: SchematicDocument,
  annotation: Annotation,
): string | undefined {
  if (annotation.kind === "route-marker") {
    return annotation.markerKind === "voltage"
      ? "voltage polarity marks"
      : "current arrowhead";
  }
  const global =
    annotation.kind === "net-label" &&
    document.connectivityEvidence.some(
      (evidence) =>
        evidence.kind === "name-claim" &&
        evidence.scope === "global" &&
        evidence.owner.kind === "net-label" &&
        evidence.owner.annotationId === annotation.id,
    );
  return global ? "global net badge" : undefined;
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

  // An adaptive block's body was resolved from its own formula, so by here
  // every placed instance has a master to instantiate.
  const drawnSymbols = new Map(
    placed.map((instance) => [instance.id, drawnSymbol(instance, resolver)]),
  );

  // Body text is upright wherever the block points, so it is translated to the
  // instance rather than transformed with it — the same thing the canvas does.
  const formulaBodies = new Map<string, PlannedFormula>();
  for (const instance of placed) {
    const presentation = drawnSymbols.get(instance.id)!.shared
      .formulaPresentation;
    if (!presentation) continue;
    const body = resolveVisioFormulaBody(
      presentation,
      instance.signalFlowParameters,
      profile,
    );
    if (!body) {
      caveats.push({ kind: "body-text", detail: presentation.defaultFormula });
      continue;
    }
    const placement = instance.placement!;
    const world = transformPoint(
      presentation.center,
      placement.position,
      placement,
    );
    formulaBodies.set(instance.id, {
      body,
      translate: {
        x: world.x - presentation.center.x,
        y: world.y - presentation.center.y,
      },
    });
  }

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
  const logicalNets = resolveDocumentLogicalNets(document);
  const annotations = planAnnotations(
    document,
    resolver,
    profile,
    routingGeometry,
    logicalNets,
  );

  const extent: DocumentPoint[] = [
    ...placed.flatMap((instance) => {
      const placement = instance.placement!;
      return placedSymbolBoxCorners(
        drawnSymbols.get(instance.id)!.definition.viewBox,
        placement.position,
        placement,
      );
    }),
    ...routes.flatMap((route) => [...route.centerline]),
    ...nodes.map((node) => node.at),
    // A label sits outside the symbol it names, so the page is only big enough
    // for the drawing once the text is counted too.
    ...annotations.flatMap(({ presentation }) => [
      { x: presentation.bounds.x, y: presentation.bounds.y },
      {
        x: presentation.bounds.x + presentation.bounds.width,
        y: presentation.bounds.y + presentation.bounds.height,
      },
    ]),
    // A frame is drawn around its formula, but a formula longer than the frame
    // a symbol fixed for it hangs out of the drawing the same way a label does.
    ...[...formulaBodies.values()].flatMap(({ body, translate }) => [
      { x: body.bounds.x + translate.x, y: body.bounds.y + translate.y },
      {
        x: body.bounds.x + body.bounds.width + translate.x,
        y: body.bounds.y + body.bounds.height + translate.y,
      },
    ]),
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
  const instanceShapes = placed.map((instance) => {
    const drawn = drawnSymbols.get(instance.id)!;
    const symbolMaster = symbolMasters.get(drawn.masterKey)!;
    const shapeId = nextShapeId;
    // The group's own ID, then one for each child Visio will instantiate.
    nextShapeId += 1 + symbolMaster.childShapeIds.length;
    const entry: PlacedInstance = {
      instance,
      symbolMaster,
      shapeId,
      placement: visioShapePlacement(
        drawn.definition.viewBox,
        instance.placement!.position,
        instance.placement!,
        frame,
      ),
      childShapeIds: symbolMaster.childShapeIds,
      glueByPinName: new Map(
        symbolMaster.connections.map((connection, index) => [
          connection.pinName,
          { rowName: connection.rowName, rowIndex: index },
        ]),
      ),
    };
    instancesById.set(instance.id, entry);
    return instanceShape(entry, document, resolver);
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

  // The body text of every block that states one, glued to the block by a pin
  // formula so it travels when the block does. It is written after the wires
  // and before the labels, which is the order the schematic paints them in.
  const formulaShapes: string[] = [];
  for (const instance of placed) {
    const planned = formulaBodies.get(instance.id);
    if (!planned) continue;
    const { body, translate } = planned;
    const owner = instancesById.get(instance.id)!;
    const at = (point: DocumentPoint): PagePoint =>
      frame.point({ x: point.x + translate.x, y: point.y + translate.y });
    const follows = (pin: PagePoint): VisioShapeFollow => ({
      sheetId: owner.shapeId,
      offset: {
        x: pin.x - owner.placement.pin.x,
        y: pin.y - owner.placement.pin.y,
      },
    });
    const identity = shapeDataSection([
      {
        name: "IcmInstanceId",
        label: "icm:instanceId",
        value: instance.id,
      },
    ]);
    for (const piece of body.pieces) {
      const pin = at(piece.center);
      const content = visioTextContent(
        piece.content,
        {
          fontSizeInches: inchesFromUnits(body.fontSize),
          color: profile.foreground,
        },
        `${instance.id} ${piece.role}`,
      );
      caveats.push(...content.caveats);
      formulaShapes.push(
        textShape({
          id: nextShapeId++,
          pin,
          follows: follows(pin),
          widthInches: inchesFromUnits(piece.width),
          heightInches: inchesFromUnits(piece.height),
          // Upright: a block turned on its side still states its formula the
          // way round a reader reads it.
          angleRadians: 0,
          alignment: piece.alignment,
          content,
          propertySection: identity,
        }),
      );
    }
    if (body.rule) {
      const from = at(body.rule.from);
      const to = at(body.rule.to);
      const pin = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
      formulaShapes.push(
        formulaRuleShape({
          id: nextShapeId++,
          pin,
          follows: follows(pin),
          widthInches: Math.abs(to.x - from.x),
          heightInches: inchesFromUnits(FORMULA_RULE_BOX_HEIGHT),
          weightInches: inchesFromUnits(body.rule.weight),
        }),
      );
    }
  }

  const instanceById = new Map(
    document.instances.map((instance) => [instance.id, instance]),
  );
  const textShapes = annotations.map(({ annotation, presentation }) => {
    const shapeId = nextShapeId++;
    const detail = `${annotation.kind} ${annotation.id}`;
    const ornament = annotationOrnament(document, annotation);
    if (ornament) {
      caveats.push({
        kind: "annotation-ornament",
        detail: `${detail}: ${ornament}`,
      });
    }
    const ownerId =
      annotationOwningInstanceId(annotation) ??
      (annotation.anchor.kind === "object"
        ? annotation.anchor.objectId
        : undefined);
    const content = visioTextContent(
      resolveAnnotationText(document, annotation, logicalNets),
      {
        fontSizeInches: inchesFromUnits(
          annotationFontSize(annotation, profile) * (annotation.sizeScale ?? 1),
        ),
        color: resolveAnnotationTextColor(
          annotation,
          ownerId ? instanceById.get(ownerId) : undefined,
          profile.foreground,
        ),
      },
      detail,
    );
    caveats.push(...content.caveats);

    // The box is placed by its middle, which a rotation about the anchor moves
    // exactly as it moves the middle of the axis-aligned bounds. So the pin is
    // the centre of `bounds` and the box itself keeps its unrotated size.
    const box = presentation.unrotatedBounds;
    // Document rotation turns clockwise in a y-down space; the page turns
    // counterclockwise in a y-up one, so the same drawing is the negative.
    const radians =
      ((((-annotation.rotation % 360) + 360) % 360) * Math.PI) / 180;
    const pin = frame.point({
      x: presentation.bounds.x + presentation.bounds.width / 2,
      y: presentation.bounds.y + presentation.bounds.height / 2,
    });
    const owner = ownerId ? instancesById.get(ownerId) : undefined;
    return textShape({
      id: shapeId,
      pin,
      ...(owner
        ? {
            follows: {
              sheetId: owner.shapeId,
              offset: {
                x: pin.x - owner.placement.pin.x,
                y: pin.y - owner.placement.pin.y,
              },
            },
          }
        : {}),
      widthInches: inchesFromUnits(box.width),
      heightInches: inchesFromUnits(box.height),
      angleRadians: radians,
      alignment: annotation.alignment,
      content,
      propertySection: shapeDataSection([
        {
          name: "IcmAnnotationId",
          label: "icm:annotationId",
          value: annotation.id,
        },
      ]),
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
    formulaShapes.join("") +
    // Text goes on last so a label paints over the wire it sits beside.
    textShapes.join("") +
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
      textShapes: textShapes.length,
      formulaShapes: formulaShapes.length,
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
