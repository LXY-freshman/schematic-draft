import { describe, expect, it } from "vitest";

import { createEmptyProject } from "@icm/model";
import type { CircuitProject, Instance } from "@icm/model";
import { analyzeDesignNetlist, printSpiceNetlist } from "@icm/netlist";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";

import { componentPropertyCodeValue } from "./component-property-code";
import { planComponentPropertyCodeEdits } from "./component-property-code-edits";
import {
  componentBulkTerminalShown,
  variantForBulkTerminal,
} from "./component-visual-variants";

const resolver = new InMemorySymbolResolver(builtInSymbols);

/** Every MOS the palette offers with a bulk to draw. */
const BULK_SYMBOLS = [
  ["nmos", "textbook-3terminal"],
  ["pmos", "textbook-3terminal"],
  ["depletion-nmos", "textbook-3terminal"],
  ["depletion-pmos", "textbook-3terminal"],
  ["ndmos", "standard-3terminal"],
  ["pdmos", "standard-3terminal"],
] as const;

function mosProject(symbolVariantId: string): CircuitProject {
  const project = createEmptyProject("project-bulk", "Bulk terminal");
  const document = project.documents[0]!;
  document.instances.push({
    id: "M1",
    symbolId: "nmos",
    symbolVariantId,
    reference: "M1",
    placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
    netlist: {
      binding: { kind: "model", deviceClass: "mos", name: "nch" },
      parameters: { w: "1u", l: "150n" },
    },
  });
  document.nets.push(
    { id: "net-d", terminals: [{ instanceId: "M1", pinName: "D" }] },
    { id: "net-g", terminals: [{ instanceId: "M1", pinName: "G" }] },
    { id: "net-s", terminals: [{ instanceId: "M1", pinName: "S" }] },
    { id: "net-b", terminals: [{ instanceId: "M1", pinName: "B" }] },
  );
  return project;
}

function codeContext(instance: Instance) {
  return { instance, referenceVisible: true, valueVisible: false };
}

describe("the MOS bulk terminal switch", () => {
  it.each(BULK_SYMBOLS)(
    "reads and sets which drawing of %s is instantiated",
    (symbolId, threeTerminal) => {
      const hidden: Instance = {
        id: "M1",
        symbolId,
        symbolVariantId: threeTerminal,
        placement: null,
      };
      const shown: Instance = {
        ...hidden,
        symbolVariantId: "four-terminal",
      };

      expect(componentBulkTerminalShown(hidden)).toBe(false);
      expect(componentBulkTerminalShown(shown)).toBe(true);
      expect(variantForBulkTerminal(symbolId, false)).toBe(threeTerminal);
      expect(variantForBulkTerminal(symbolId, true)).toBe("four-terminal");
    },
  );

  it.each(["resistor", "npn", "opamp", "vdd-port"])(
    "offers no bulk switch for %s",
    (symbolId) => {
      expect(
        componentBulkTerminalShown({ id: "X1", symbolId, placement: null }),
      ).toBeUndefined();
      for (const shown of [false, true])
        expect(variantForBulkTerminal(symbolId, shown)).toBeUndefined();
    },
  );

  it.each(BULK_SYMBOLS)(
    "draws the bulk lead of %s in one variant and hides it in the other",
    (symbolId, threeTerminal) => {
      const hidden = resolver.resolve(symbolId, threeTerminal)!;
      const shown = resolver.resolve(symbolId, "four-terminal")!;

      expect(hidden.variant?.hiddenPinNames).toEqual(["B"]);
      expect(hidden.variant?.hiddenPrimitiveParts).toContain("bulk-lead");
      expect(shown.variant?.hiddenPinNames).toEqual([]);
      expect(shown.variant?.hiddenPrimitiveParts).toBeUndefined();
      // One symbol, one set of terminals. Only the artwork differs.
      expect(shown.definition.pins).toEqual(hidden.definition.pins);
      expect(shown.definition.pins.map((pin) => pin.name)).toEqual([
        "D",
        "G",
        "S",
        "B",
      ]);
    },
  );

  it("carries the variant on the same typed symbol edit", () => {
    const instance =
      mosProject("textbook-3terminal").documents[0]!.instances[0]!;
    const context = codeContext(instance);
    const value = componentPropertyCodeValue(context);

    expect(value.appearance.bulkTerminal).toBe(false);
    expect(
      planComponentPropertyCodeEdits(
        mosProject("textbook-3terminal").documents[0]!,
        instance,
        { ...value, appearance: { ...value.appearance, bulkTerminal: true } },
      ),
    ).toEqual([
      {
        kind: "set_instance_symbol",
        instanceId: "M1",
        symbolId: "nmos",
        symbolVariantId: "four-terminal",
      },
    ]);
    // Asking for the drawing it already has is not an edit.
    expect(
      planComponentPropertyCodeEdits(
        mosProject("textbook-3terminal").documents[0]!,
        instance,
        value,
      ),
    ).toEqual([]);
  });

  it("leaves a component with no bulk planning exactly the edits it did", () => {
    const project = createEmptyProject("project-plain", "No bulk");
    const document = project.documents[0]!;
    const instance: Instance = {
      id: "R1",
      symbolId: "resistor",
      placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
    };
    document.instances.push(instance);
    const value = componentPropertyCodeValue(codeContext(instance));

    expect(value.appearance).not.toHaveProperty("bulkTerminal");
    expect(planComponentPropertyCodeEdits(document, instance, value)).toEqual(
      [],
    );
  });

  it("changes the drawing and nothing electrical", () => {
    const hidden = analyzeDesignNetlist(mosProject("textbook-3terminal"));
    const shown = analyzeDesignNetlist(mosProject("four-terminal"));

    expect(hidden.ir, JSON.stringify(hidden)).not.toBeNull();
    expect(shown.ir, JSON.stringify(shown)).not.toBeNull();
    // Pin order, node order and net assignment are the device's facts. The
    // bulk switch is a drawing, so it moves none of them. B in particular is
    // a terminal on its own Net in both drawings — the three-terminal artwork
    // hides the lead, it does not drop the pin.
    const nodes = hidden.ir!.cells[0]!.instances[0]!.nodes;
    expect(nodes.map((node) => node.pinName)).toEqual(["D", "G", "S", "B"]);
    expect(new Set(nodes.map((node) => node.netName)).size).toBe(4);
    expect(shown.ir!.cells[0]!.instances[0]!.nodes).toEqual(nodes);
    expect(printSpiceNetlist(shown.ir!)).toBe(printSpiceNetlist(hidden.ir!));
  });
});
