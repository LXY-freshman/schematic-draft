import { createEmptyProject } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it, vi } from "vitest";

import {
  createVisioExportArtifact,
  createVisioStencilArtifact,
  describeExportFailure,
  planDesignNetlistExport,
} from "./editor-export-commands";
import { importChunk } from "../../components/chunk-import";

describe("editor export commands", () => {
  it("blocks structurally incomplete extraction", () => {
    const project = createEmptyProject("project", "Circuit");
    project.documents[0]!.netlist = undefined;
    expect(planDesignNetlistExport({ format: "spice", project })).toEqual({
      status: "blocked",
      message: "Resolve the Check Report findings before export",
    });
  });

  it("blocks a netlist whose drawing has a dead-end node", () => {
    // A TODO placeholder is a value somebody will bind later; a node only one
    // pin reaches is a wire nobody drew, and the message names it so the
    // author can go to it.
    const project = createEmptyProject("project", "Circuit");
    const document = project.documents[0]!;
    document.instances.push({
      id: "R1",
      symbolId: "resistor",
      reference: "R1",
      netlist: {
        binding: { kind: "primitive", deviceClass: "resistor" },
        parameters: { value: "10k" },
      },
      placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
    });
    document.nets.push(
      { id: "net-a", terminals: [{ instanceId: "R1", pinName: "1" }] },
      { id: "net-b", terminals: [{ instanceId: "R1", pinName: "2" }] },
    );
    const plan = planDesignNetlistExport({ format: "spice", project });
    expect(plan.status).toBe("blocked");
    if (plan.status !== "blocked") return;
    expect(plan.message).toContain("2 dead-end nodes");
    expect(plan.message).toContain("only R1.1 reaches it");
  });

  it.each(["spice", "spectre"] as const)(
    "prepares clean %s with findings only in the status",
    (format) => {
      const project = createEmptyProject("project", "Circuit");
      const plan = planDesignNetlistExport({
        format,
        project,
        electricalWarningsPresent: true,
      });
      expect(plan.status).toBe("ready");
      if (plan.status !== "ready") return;
      expect(plan.artifact.bytes).not.toContain(
        `${format === "spice" ? "*" : "//"} Electrical findings remain; see Netlist > Check Report.`,
      );
      expect(plan.artifact.report).toContain("see Check Report for findings");
    },
  );

  it("prepares a complete printable artifact without a confirmation step", () => {
    const project = createEmptyProject("project", "My Circuit");
    const plan = planDesignNetlistExport({ format: "spice", project });
    expect(plan.status).toBe("ready");
    if (plan.status !== "ready") return;
    expect(plan.artifact.extension).toBe("spi");
    expect(plan.artifact.mediaType).toBe("application/x-spice");
    expect(plan.artifact.report).toBe("SPICE netlist copied");
  });
});

describe("Visio export", () => {
  const resolver = new InMemorySymbolResolver(builtInSymbols);

  function circuit() {
    const project = createEmptyProject("project", "My Circuit");
    const document = project.documents[0]!;
    document.instances.push({
      id: "R1",
      symbolId: "resistor",
      reference: "R1",
      placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
    });
    return { project, document };
  }

  it("writes the Document as an OPC package Visio can open", async () => {
    const { document } = circuit();
    const artifact = await createVisioExportArtifact(
      document,
      resolver,
      "My Circuit",
    );
    expect(artifact.mediaType).toBe("application/vnd.ms-visio.drawing");
    expect(artifact.extension).toBe("vsdx");
    // A `.vsdx` is an OPC package, so its bytes begin the way every zip does.
    const bytes = artifact.bytes as Uint8Array;
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    // Nothing about a resistor on a page is beyond what Visio can carry.
    expect(artifact.report).toBe(
      `Exported Visio revision ${document.revision}`,
    );
    expect(artifact.baseName).toBeUndefined();
  });

  it("says in the status what the page could not carry", async () => {
    // An instance with no placement is not on the page at all, which is the
    // kind of loss a reader has to be told about rather than left to find.
    const { document } = circuit();
    document.instances.push({
      id: "R2",
      symbolId: "resistor",
      reference: "R2",
      placement: null,
    });
    const artifact = await createVisioExportArtifact(
      document,
      resolver,
      "My Circuit",
    );
    expect(artifact.report).toContain(
      "instances left off the page for want of a placement (1)",
    );
  });

  it("names the stencil after the library rather than the open project", async () => {
    // The stencil is the same symbols whatever circuit is open; three copies
    // named after three projects would suggest they differ.
    const artifact = await createVisioStencilArtifact();
    expect(artifact.extension).toBe("vssx");
    expect(artifact.baseName).toBe("Schematic Draft symbols");
    expect(artifact.report).toBe("Exported the Visio symbol stencil");
  });
});

describe("describeExportFailure", () => {
  it("turns a missing chunk into the refresh remedy and names the feature", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const chunkError = await importChunk("PDF export", () =>
      Promise.reject(
        new TypeError(
          "Failed to fetch dynamically imported module: app://schematic-draft/assets/browser-pdf-D-HT6q.js",
        ),
      ),
    ).then(
      () => null,
      (error: unknown) => error,
    );
    spy.mockRestore();

    const failure = describeExportFailure(chunkError);
    expect(failure.chunkFeature).toBe("PDF export");
    expect(failure.status).toContain("PDF export could not load");
    expect(failure.status).toContain("Refresh");
    expect(failure.status).not.toContain("Failed to fetch");
  });

  it("keeps an ordinary export error's own message without a banner", () => {
    expect(describeExportFailure(new Error("Canvas too large"))).toEqual({
      status: "Canvas too large",
    });
    expect(describeExportFailure("boom")).toEqual({ status: "Export failed" });
  });
});
