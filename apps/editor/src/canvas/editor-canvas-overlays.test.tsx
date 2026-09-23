import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  deriveRouteLineJumps,
  resolveRouteGeometry,
  type NetHighlight,
} from "@icm/derived";
import type { Diagnostic } from "@icm/derived";
import { createEmptyDocument, createRoutePath } from "@icm/model";
import type { RouteBranch, SchematicDocument } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";

import {
  DiagnosticMarkersOverlay,
  NetHighlightOverlay,
  WireUnderSymbolOverlay,
} from "./editor-canvas-overlays";

const finding: Diagnostic = {
  id: "visual:doc:VISUAL_AMBIGUOUS_JUNCTION:J1",
  domain: "visual",
  code: "VISUAL_AMBIGUOUS_JUNCTION",
  severity: "error",
  confidence: "high",
  gateEligible: true,
  message: "Junction J1 lies on unrelated route R9",
  primary: {
    documentId: "doc",
    hierarchyPath: [],
    kind: "junction",
    objectId: "J1",
  },
  related: [],
  parameters: {},
};

describe("DiagnosticMarkersOverlay", () => {
  it("renders severity-colored rings at finding points", () => {
    const markup = renderToStaticMarkup(
      <DiagnosticMarkersOverlay
        markers={[
          {
            key: "100,40",
            point: { x: 100, y: 40 },
            severity: "error",
            count: 1,
            diagnostic: finding,
          },
          {
            key: "200,40",
            point: { x: 200, y: 40 },
            severity: "warning",
            count: 1,
            diagnostic: { ...finding, id: "erc:2", severity: "warning" },
          },
        ]}
        onSelectMarker={vi.fn()}
      />,
    );
    expect(markup).toContain('data-testid="diagnostic-markers"');
    expect(markup).toContain('data-severity="error"');
    expect(markup).toContain('data-severity="warning"');
    expect(markup).toContain('class="diagnostic-marker-ring"');
  });

  it("adds a numeral only for clustered findings", () => {
    const markup = renderToStaticMarkup(
      <DiagnosticMarkersOverlay
        markers={[
          {
            key: "100,40",
            point: { x: 100, y: 40 },
            severity: "error",
            count: 3,
            diagnostic: finding,
          },
        ]}
        onSelectMarker={vi.fn()}
      />,
    );
    expect(markup).toContain('class="diagnostic-marker-count"');
    expect(markup).toContain(">3</text>");
  });

  it("renders nothing without markers", () => {
    expect(
      renderToStaticMarkup(
        <DiagnosticMarkersOverlay markers={[]} onSelectMarker={vi.fn()} />,
      ),
    ).toBe("");
  });
});

describe("WireUnderSymbolOverlay", () => {
  it("makes its special hit span transparent when Wires are filtered", () => {
    const markup = renderToStaticMarkup(
      <WireUnderSymbolOverlay
        warnings={[
          {
            routeId: "route-1",
            instanceId: "M1",
            from: { x: 0, y: 10 },
            to: { x: 20, y: 10 },
          },
        ]}
        canSelectRoute={() => false}
        onSelectRoute={vi.fn()}
      />,
    );
    expect(markup).toMatch(
      /class="wire-under-symbol-hit"[^>]*pointer-events="none"/u,
    );
  });
});

/**
 * A horizontal wire crossed by a vertical one on another Net. Only the
 * horizontal Route asks to hop, so it is the one that gets an arc.
 */
function crossingFixture(hop: boolean) {
  const document = createEmptyDocument("cell", "Cell");
  document.nets.push(
    { id: "net-1", terminals: [] },
    {
      id: "net-2",
      terminals: [],
    },
  );
  document.junctions.push(
    {
      id: "j1",
      netId: "net-1",
      position: { x: 0, y: 20 },
      role: "route-anchor",
    },
    {
      id: "j2",
      netId: "net-1",
      position: { x: 100, y: 20 },
      role: "route-anchor",
    },
    {
      id: "j3",
      netId: "net-2",
      position: { x: 50, y: 0 },
      role: "route-anchor",
    },
    {
      id: "j4",
      netId: "net-2",
      position: { x: 50, y: 40 },
      role: "route-anchor",
    },
  );
  document.routes.push(
    createRoutePath({
      id: "route-1",
      netId: "net-1",
      start: { kind: "junction", junctionId: "j1" },
      end: { kind: "junction", junctionId: "j2" },
      bends: [],
      modes: ["manual"],
      ...(hop ? { styleOverride: { lineJump: true } } : {}),
    }),
    createRoutePath({
      id: "route-2",
      netId: "net-2",
      start: { kind: "junction", junctionId: "j3" },
      end: { kind: "junction", junctionId: "j4" },
      bends: [],
      modes: ["manual"],
    }),
  );
  const resolver = new InMemorySymbolResolver(builtInSymbols);
  const records = document.routes.map((route) => {
    const geometry = resolveRouteGeometry(document, resolver, route);
    if (!geometry) throw new Error(`Fixture route ${route.id} must resolve`);
    return { route, geometry };
  });
  return {
    document,
    resolver,
    records,
    routeLineJumps: deriveRouteLineJumps(document, resolver),
  };
}

function highlightOf(document: SchematicDocument, routes: RouteBranch[]) {
  return {
    documentId: document.id,
    hierarchyPath: [],
    netId: "net-1",
    visibleEndpoints: [],
    routes: routes.map((route) => route.id),
    junctions: [],
    virtualEdges: [],
    routingGuidance: [],
  } satisfies NetHighlight;
}

describe("NetHighlightOverlay", () => {
  it("traces the hop arcs the wire below it goes around", () => {
    const { document, resolver, records, routeLineJumps } =
      crossingFixture(true);
    expect(routeLineJumps.get("route-1")?.length).toBe(1);

    const markup = renderToStaticMarkup(
      <svg>
        <NetHighlightOverlay
          highlight={highlightOf(document, [records[0]!.route])}
          document={document}
          resolver={resolver}
          routeGeometryRecords={records}
          routeLineJumps={routeLineJumps}
        />
      </svg>,
    );

    expect(markup).toMatch(/class="net-highlight-halo" d="M [^"]*A /u);
    expect(markup).toMatch(/class="net-highlight-core" d="M [^"]*A /u);
    expect(markup).not.toContain("<polyline");
  });

  it("keeps the plain polyline for a Route that asks for no hop", () => {
    const { document, resolver, records, routeLineJumps } =
      crossingFixture(false);
    expect(routeLineJumps.size).toBe(0);

    const markup = renderToStaticMarkup(
      <svg>
        <NetHighlightOverlay
          highlight={highlightOf(document, [records[0]!.route])}
          document={document}
          resolver={resolver}
          routeGeometryRecords={records}
          routeLineJumps={routeLineJumps}
        />
      </svg>,
    );

    expect(markup).toContain('class="net-highlight-halo" points="0,20 100,20"');
    expect(markup).not.toContain("<path");
  });
});
