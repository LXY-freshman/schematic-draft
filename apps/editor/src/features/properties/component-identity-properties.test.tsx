import { createEmptyDocument } from "@icm/model";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  ComponentIdentityProperties,
  componentTargetDescription,
} from "./component-identity-properties";

describe("component identity properties", () => {
  it("omits the internal target description for a built-in primitive", () => {
    const document = createEmptyDocument("cell", "Cell");
    const instance: (typeof document.instances)[number] = {
      id: "R1",
      symbolId: "resistor",
      placement: null,
      reference: "R1",
      netlist: {
        parameters: {},
        binding: { kind: "primitive", deviceClass: "resistor" },
      },
    };
    expect(componentTargetDescription(instance)).toBeNull();
    delete instance.netlist!.binding;
    expect(componentTargetDescription(instance)).toBeNull();
  });

  it("names the bound target a component cannot choose from a model list", () => {
    const document = createEmptyDocument("cell", "Cell");
    const instance: (typeof document.instances)[number] = {
      id: "X1",
      symbolId: "adder",
      placement: null,
      netlist: {
        parameters: {},
        binding: { kind: "subcircuit", childDocumentId: "cell" },
      },
    };
    expect(componentTargetDescription(instance, "summing_stage")).toBe(
      "Internal Cell: summing_stage",
    );
  });

  it("shows the electrical terminals and the SPICE line, and nothing editable", () => {
    const markup = renderToStaticMarkup(
      <ComponentIdentityProperties
        capacitorPlateRows={[
          {
            role: "capacitor-top-plate",
            label: "Top plate",
            pinName: "p",
            sourceNodePosition: 0,
            netId: "n1",
            netName: "out",
          },
          {
            role: "capacitor-bottom-plate",
            label: "Bottom plate",
            pinName: "n",
            sourceNodePosition: 1,
            netId: null,
            netName: null,
          },
        ]}
        sourceCode={{ code: "C1 out 0 1p", exact: true, note: null }}
      />,
    );
    expect(markup).toContain('aria-label="Top plate terminal"');
    expect(markup).toContain("Pin p · out");
    expect(markup).toContain("Pin n · Unconnected");
    // Placement, identity, parameters and appearance belong to the form now.
    expect(markup).not.toContain('aria-label="Netlist Reference"');
    expect(markup).not.toContain('aria-label="Component model target"');
    expect(markup).not.toContain("Edit annotation");
    expect(markup).toMatch(
      /<div class="component-source-code"[^>]*><code>C1 out 0 1p<\/code><\/div>$/u,
    );
  });

  it("offers the property-only terminal its Nets and marks a template SPICE line", () => {
    const onChange = vi.fn();
    const markup = renderToStaticMarkup(
      <ComponentIdentityProperties
        capacitorPlateRows={null}
        propertyTerminal={{
          label: "Substrate Net",
          pinName: "b",
          netId: "n2",
          options: [
            { netId: "n2", label: "VSS" },
            { netId: "n3", label: "VDD" },
          ],
          onChange,
        }}
        sourceCode={{
          code: "X2 <in> <out> <subcircuit-model>",
          exact: false,
          note: "Subcircuit template — choose a concrete model before export.",
        }}
      />,
    );
    expect(markup).toContain('aria-label="Substrate Net"');
    expect(markup).toContain('<option value="">Unconnected</option>');
    expect(markup).toContain("Property-only terminal · no canvas pin or wire");
    expect(markup).toContain('data-exact="false"');
    expect(markup).toContain(
      "<code>X2 &lt;in&gt; &lt;out&gt; &lt;subcircuit-model&gt;</code>",
    );
    expect(markup).toContain(
      "Subcircuit template — choose a concrete model before export.",
    );
    expect(onChange).not.toHaveBeenCalled();
  });
});
