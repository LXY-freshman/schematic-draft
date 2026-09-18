import {
  createEmptyDocument,
  createEmptyProject,
  createRoutePath,
} from "@icm/model";
import { describe, expect, it, vi } from "vitest";

import { createExampleCommands } from "./example-commands";
import { hierarchicalSymbolId } from "@icm/symbols";

const defaultViewBox = { x: 0, y: 0, width: 960, height: 640 };

function dependencies() {
  return {
    defaultViewBox,
    replaceActiveProject: vi.fn(),
    guardDirtyReplacement: vi.fn(async (_intent, perform) => {
      await perform();
    }),
    beginCopyPlacement: vi.fn(),
    cancelAllTransientInteraction: vi.fn(),
    setStatus: vi.fn(),
  };
}

describe("example commands", () => {
  it("starts a whole-Document placement with interface composition policy", () => {
    const input = dependencies();
    const imported = createEmptyProject("imported", "Imported");
    imported.documents[0]!.instances.push({
      id: "R1",
      symbolId: "resistor",
      placement: {
        position: { x: 100, y: 80 },
        rotation: 0,
        mirror: "none",
      },
    });
    const commands = createExampleCommands(input);

    expect(commands.beginProjectImportPlacement(imported, "Scene")).toBe(true);

    expect(input.cancelAllTransientInteraction).toHaveBeenCalledOnce();
    expect(input.beginCopyPlacement).toHaveBeenCalledWith(
      expect.objectContaining({ instances: imported.documents[0]!.instances }),
      { x: 100, y: 80 },
    );
    expect(input.setStatus).toHaveBeenCalledWith(
      expect.stringContaining("Place Scene on the canvas"),
    );
  });

  it("normalizes a switch Route collapsed by current pins before placement", () => {
    const input = dependencies();
    const imported = createEmptyProject("legacy-switch", "Legacy switch");
    const document = imported.documents[0]!;
    document.instances.push(
      {
        id: "X1",
        symbolId: "ideal-switch",
        placement: {
          position: { x: 500, y: 200 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "P1",
        symbolId: "port",
        placement: {
          position: { x: 520, y: 200 },
          rotation: 0,
          mirror: "none",
        },
      },
    );
    document.nets.push({
      id: "net-contact",
      terminals: [
        { instanceId: "X1", pinName: "2" },
        { instanceId: "P1", pinName: "P" },
      ],
    });
    document.netlist!.terminals.push({
      id: "terminal-p1",
      name: "OUT",
      netId: "net-contact",
      direction: "passive",
      interfaceInstanceIds: ["P1"],
    });
    document.routes.push(
      createRoutePath({
        id: "legacy-ten-unit-route",
        netId: "net-contact",
        start: { kind: "terminal", instanceId: "P1", pinName: "P" },
        end: { kind: "terminal", instanceId: "X1", pinName: "2" },
        bends: [],
        modes: ["manual"],
      }),
    );
    const commands = createExampleCommands(input);

    expect(commands.beginProjectImportPlacement(imported, "Switch")).toBe(true);

    expect(input.beginCopyPlacement).toHaveBeenCalledWith(
      expect.objectContaining({
        routes: [],
        nets: [
          expect.objectContaining({
            terminals: expect.arrayContaining([
              { instanceId: "X1", pinName: "2" },
              { instanceId: "P1", pinName: "P" },
            ]),
          }),
        ],
      }),
      { x: 500, y: 200 },
    );
    expect(document.routes).toHaveLength(1);
  });

  it("places hierarchical content without replacing the active Project", () => {
    const input = dependencies();
    const imported = createEmptyProject("imported", "Imported");
    imported.documents.push(createEmptyDocument("child", "Child"));
    imported.documents[0]!.instances.push({
      id: "X1",
      reference: "X1",
      symbolId: hierarchicalSymbolId("Child"),
      placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
      netlist: {
        binding: { kind: "subcircuit", childDocumentId: "child" },
        parameters: {},
      },
    });
    const commands = createExampleCommands(input);

    expect(commands.beginProjectImportPlacement(imported, "Hierarchy")).toBe(
      true,
    );
    expect(input.beginCopyPlacement).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          documents: [imported.documents[1]],
        }),
      }),
      expect.anything(),
    );
    expect(input.replaceActiveProject).not.toHaveBeenCalled();
  });

  it("starts placement for a drawing-only Project", () => {
    const input = dependencies();
    const imported = createEmptyProject("imported", "Drawing");
    imported.documents[0]!.drafting = {
      objects: [
        {
          id: "drawing-rectangle",
          kind: "rectangle",
          locked: false,
          zIndex: 0,
          anchor: { kind: "free", position: { x: 60, y: 40 } },
          center: { x: 60, y: 40 },
          width: 80,
          height: 40,
          rotation: 0,
          lineStyle: "solid",
        },
      ],
    };
    const commands = createExampleCommands(input);

    expect(commands.beginProjectImportPlacement(imported, "Drawing")).toBe(
      true,
    );
    expect(input.beginCopyPlacement).toHaveBeenCalledWith(
      expect.objectContaining({
        draftingObjects: imported.documents[0]!.drafting.objects,
      }),
      { x: 60, y: 40 },
    );
    expect(input.replaceActiveProject).not.toHaveBeenCalled();
  });
});
