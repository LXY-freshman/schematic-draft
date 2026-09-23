import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ComponentPropertyForm } from "./component-property-form";

const RESISTOR = {
  id: "R1",
  symbolId: "resistor",
  reference: "R1",
  placement: {
    position: { x: 360, y: 240 },
    rotation: 0 as const,
    mirror: "none" as const,
  },
  netlist: { parameters: { r: "10k" } },
};

function disclosure(markup: string, ariaLabel: string): string {
  return (
    new RegExp(`<details[^>]*aria-label="${ariaLabel}"[^>]*>`, "u").exec(
      markup,
    )?.[0] ?? ""
  );
}

describe("ComponentPropertyForm", () => {
  it("edits placement, identity and parameters as controls, with the JSON collapsed underneath", () => {
    const markup = renderToStaticMarkup(
      <ComponentPropertyForm
        instance={RESISTOR}
        revision={7}
        displayName="RL"
        referenceVisible
        valueVisible={false}
        details={{
          parameters: [
            {
              key: "r",
              label: "Resistance",
              unit: "Ω",
              placeholder: "10k",
              help: "Resistance written to the netlist",
              inputMode: "decimal",
            },
          ],
        }}
        onApply={vi.fn(() => ({ ok: true as const }))}
      />,
    );

    expect(disclosure(markup, "Component placement")).toContain('open=""');
    expect(markup).toContain('aria-label="Component X position"');
    expect(markup).toContain('value="360"');
    expect(markup).toContain('aria-label="Component Y position"');
    expect(markup).toContain('aria-label="Component rotation"');
    expect(markup).toContain('aria-label="Component mirror"');
    expect(markup).toContain('aria-label="Netlist name"');
    expect(markup).toContain('value="R1"');
    expect(markup).toContain('aria-label="Display name"');
    expect(markup).toContain('value="RL"');
    expect(markup).toContain('aria-label="Component resistance"');
    expect(markup).toContain('value="10k"');
    expect(markup).toContain("Resistance / Ω");
    // Reference and value visibility are display facts, not netlist facts.
    expect(disclosure(markup, "Component display")).toContain('open=""');
    expect(markup).toContain("<span>Visual annotation</span>");
    expect(markup).toContain("<span>Value</span>");

    // The code surface stays reachable but never opens first, and its editor
    // does not load until a reader asks for it.
    const json = disclosure(markup, "Component property code");
    expect(json).not.toBe("");
    expect(json).not.toContain('open=""');
    expect(markup).toContain("Code (JSON)");
    expect(markup).not.toContain('aria-label="Loading Canvas property code"');
    expect(markup).not.toContain("<strong>JSON</strong>");
  });

  it("offers the component's own stroke multiplier beside its colour", () => {
    const scaled = {
      ...RESISTOR,
      styleOverride: { strokeScale: 0.5 as const },
    };
    const markup = renderToStaticMarkup(
      <ComponentPropertyForm
        instance={scaled}
        revision={3}
        referenceVisible
        valueVisible={false}
        onApply={vi.fn(() => ({ ok: true as const }))}
      />,
    );

    // Paint and weight are the same kind of fact about one component, so they
    // sit together; neither changes a pin or a netlist line.
    expect(markup).toContain('aria-label="Component stroke width"');
    expect(markup).toContain('value="0.5"');
    expect(markup).toContain('min="0.25"');
    expect(markup).toContain('max="4"');
  });

  it("offers the bulk switch to a MOS and to nothing else", () => {
    const mos = renderToStaticMarkup(
      <ComponentPropertyForm
        instance={{
          id: "M1",
          symbolId: "nmos",
          symbolVariantId: "textbook-3terminal",
          placement: {
            position: { x: 0, y: 0 },
            rotation: 0 as const,
            mirror: "none" as const,
          },
        }}
        revision={4}
        referenceVisible
        valueVisible={false}
        onApply={vi.fn(() => ({ ok: true as const }))}
      />,
    );

    // Which drawing a MOS wears is an appearance fact, so it sits with the
    // colour and the weight rather than with its netlist identity.
    expect(disclosure(mos, "Component appearance")).not.toBe("");
    expect(mos).toContain("<span>Bulk terminal</span>");

    const resistor = renderToStaticMarkup(
      <ComponentPropertyForm
        instance={RESISTOR}
        revision={4}
        referenceVisible
        valueVisible={false}
        onApply={vi.fn(() => ({ ok: true as const }))}
      />,
    );
    expect(resistor).not.toContain("Bulk terminal");
  });

  it("offers no control for a fact this component does not carry", () => {
    const markup = renderToStaticMarkup(
      <ComponentPropertyForm
        instance={{ id: "R2", symbolId: "resistor", placement: null }}
        revision={2}
        referenceVisible={null}
        valueVisible={null}
        onApply={vi.fn(() => ({ ok: true as const }))}
      />,
    );

    // A component waiting in the Placement Tray has no coordinates to edit.
    expect(markup).not.toContain('aria-label="Component X position"');
    expect(markup).toContain("waiting in the Placement Tray");
    expect(markup).not.toContain('aria-label="Netlist name"');
    expect(markup).not.toContain('aria-label="Display name"');
    expect(markup).not.toContain('aria-label="Connection"');
    expect(markup).not.toContain('aria-label="Net name"');
    expect(markup).not.toContain('aria-label="Component model target"');
    expect(markup).not.toContain('aria-label="Component display"');
    expect(disclosure(markup, "Component appearance")).not.toContain('open=""');
  });

  it("names the netlist target and says when it is an external subcircuit", () => {
    const markup = renderToStaticMarkup(
      <ComponentPropertyForm
        instance={{
          id: "X1",
          symbolId: "nmos",
          reference: "X1",
          placement: {
            position: { x: 0, y: 0 },
            rotation: 0,
            mirror: "none",
          },
          netlist: {
            parameters: {},
            binding: {
              kind: "external-subcircuit",
              definitionId: "nfet_01v8",
            },
          },
        }}
        revision={3}
        referenceVisible={null}
        valueVisible={null}
        externalSubcircuit
        details={{
          parameters: [],
          modelTarget: {
            defaultValue: "nfet_01v8",
            suggestions: ["nfet_01v8", "nfet_03v3"],
          },
        }}
        onApply={vi.fn(() => ({ ok: true as const }))}
      />,
    );

    expect(markup).toContain('aria-label="Component model target"');
    expect(markup).toContain('value="nfet_01v8" selected=""');
    expect(markup).toContain("Custom…");
    expect(markup).toContain("External subcircuit · SPICE emits an X card");
  });

  it("shows a read-only target summary when there is no model to choose", () => {
    const markup = renderToStaticMarkup(
      <ComponentPropertyForm
        instance={{
          id: "X2",
          symbolId: "adder",
          placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
        }}
        revision={4}
        referenceVisible={null}
        valueVisible={null}
        targetDescription="Internal Cell: summing_stage"
        onApply={vi.fn(() => ({ ok: true as const }))}
      />,
    );

    expect(markup).toContain("Internal Cell: summing_stage");
    expect(markup).not.toContain('aria-label="Component model target"');
  });
});
