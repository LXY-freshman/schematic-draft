import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createEmptyDocument, createRoutePath } from "@icm/model";

import { RoutePropertyForm } from "./route-property-form";

function routeFixture(name: string | null) {
  const document = createEmptyDocument("doc", "Route properties");
  document.nets.push({ id: "net-1", terminals: [] });
  document.junctions.push(
    {
      id: "j1",
      netId: "net-1",
      position: { x: 0, y: 0 },
      role: "route-anchor",
    },
    {
      id: "j2",
      netId: "net-1",
      position: { x: 100, y: 0 },
      role: "route-anchor",
    },
  );
  const route = createRoutePath({
    id: "route-1",
    netId: "net-1",
    start: { kind: "junction", junctionId: "j1" },
    end: { kind: "junction", junctionId: "j2" },
    bends: [],
    modes: ["manual"],
  });
  route.styleOverride = { lineStyle: "dashed", arrow: "end", color: "#dc2626" };
  document.routes.push(route);
  if (name === null) return { document, route, netLabel: null };
  const netLabel = {
    id: "net-label-route-1",
    kind: "net-label" as const,
    netId: "net-1",
    binding: { kind: "net-name" as const, netId: "net-1" },
    anchor: { kind: "free" as const, position: { x: 50, y: -8 } },
    alignment: "middle" as const,
    rotation: 0 as const,
    locked: false,
    content: { runs: [{ kind: "text" as const, value: name }] },
  };
  document.annotations.push(netLabel);
  document.connectivityEvidence.push({
    id: "claim-1",
    kind: "name-claim",
    netId: "net-1",
    name,
    scope: "global",
    owner: { kind: "net-label", annotationId: netLabel.id },
  });
  return { document, route, netLabel };
}

function disclosure(markup: string, ariaLabel: string): string {
  return (
    new RegExp(`<details[^>]*aria-label="${ariaLabel}"[^>]*>`, "u").exec(
      markup,
    )?.[0] ?? ""
  );
}

describe("RoutePropertyForm", () => {
  it("edits the Net claim and the wire's drawing, with the JSON collapsed underneath", () => {
    const { document, route, netLabel } = routeFixture("OUT");
    const markup = renderToStaticMarkup(
      <RoutePropertyForm
        document={document}
        route={route}
        netLabel={netLabel}
        defaultColor="#000000"
        onApply={vi.fn(() => ({ ok: true }))}
        actions={<button type="button">Delete wire</button>}
      />,
    );

    expect(disclosure(markup, "Route net")).toContain('open=""');
    expect(markup).toContain('aria-label="Net name"');
    expect(markup).toContain('value="OUT"');
    expect(markup).toContain('aria-label="Net scope"');
    expect(markup).toContain('value="global" selected=""');
    expect(disclosure(markup, "Route appearance")).toContain('open=""');
    expect(markup).toContain('aria-label="Wire line style"');
    expect(markup).toContain('value="dashed" selected=""');
    expect(markup).toContain('aria-label="Wire direction arrow"');
    expect(markup).toContain('value="end" selected=""');
    expect(markup).toContain("#dc2626");
    // Route commands stay visible beside the form instead of trailing the JSON.
    expect(markup).toContain("Delete wire");

    const json = disclosure(markup, "Route property code");
    expect(json).not.toBe("");
    expect(json).not.toContain('open=""');
    expect(markup).toContain("Code (JSON)");
    expect(markup).not.toContain('aria-label="Loading Canvas property code"');
  });

  it("shows the line-jump button unpressed, and pressed once the wire asks to hop", () => {
    const { document, route, netLabel } = routeFixture("OUT");
    const render = () =>
      renderToStaticMarkup(
        <RoutePropertyForm
          document={document}
          route={route}
          netLabel={netLabel}
          defaultColor="#000000"
          onApply={vi.fn(() => ({ ok: true }))}
        />,
      );
    const flat = render();
    // One button that stays down while the hop is on, rather than a checkbox
    // among a row of framed selects.
    expect(flat).toContain("Hop over crossings");
    expect(flat).toContain('class="toggle-action-button"');
    expect(flat).toContain('aria-pressed="false"');
    expect(flat).not.toContain('type="checkbox"');

    route.styleOverride = { ...route.styleOverride, lineJump: true };
    expect(render()).toContain('aria-pressed="true"');
  });

  it("offers no scope until the wire claims a Net name", () => {
    const { document, route } = routeFixture(null);
    const markup = renderToStaticMarkup(
      <RoutePropertyForm
        document={document}
        route={route}
        netLabel={null}
        defaultColor="#000000"
        onApply={vi.fn(() => ({ ok: true }))}
      />,
    );

    expect(markup).toContain('aria-label="Net name"');
    expect(markup).toContain('value=""');
    expect(markup).not.toContain('aria-label="Net scope"');
    expect(markup).toContain("Name the Net to choose whether it crosses Cells");
  });
});
