import { createEmptyDocument, createRoutePath } from "@icm/model";
import type { SchematicDocument } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { buildVisioPage } from "./page.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function documentWithWireAndResistor(): SchematicDocument {
  const document = createEmptyDocument("doc-weight", "Stroke scale");
  document.nets.push({ id: "net-a", terminals: [] });
  document.junctions.push(
    { id: "J1", netId: "net-a", position: { x: 0, y: 0 } },
    { id: "J2", netId: "net-a", position: { x: 100, y: 0 } },
  );
  document.routes.push(
    createRoutePath({
      id: "wire",
      netId: "net-a",
      start: { kind: "junction", junctionId: "J1" },
      end: { kind: "junction", junctionId: "J2" },
      bends: [],
      modes: ["manual"],
    }),
  );
  document.instances.push({
    id: "R1",
    symbolId: "resistor",
    placement: { position: { x: 0, y: 60 }, rotation: 0, mirror: "none" },
  });
  return document;
}

/** The `LineWeight` cells written on shapes, not on masters. */
function shapeLineWeights(body: string): string[] {
  return [...body.matchAll(/<Cell N="LineWeight" V="([\d.]+)"/gu)].map(
    (match) => match[1]!,
  );
}

describe("per-object stroke scale in a Visio package", () => {
  it("leaves an unscaled wire inheriting the master's weight", () => {
    const body = buildVisioPage(documentWithWireAndResistor(), resolver).body;
    expect(shapeLineWeights(body)).toEqual([]);
  });

  it("gives a scaled wire its own weight cell, in proportion", () => {
    const document = documentWithWireAndResistor();
    document.routes[0]!.styleOverride = { strokeScale: 2 };

    const page = buildVisioPage(document, resolver);
    const doubled = shapeLineWeights(page.body);
    expect(doubled).toHaveLength(1);

    document.routes[0]!.styleOverride = { strokeScale: 4 };
    const quadrupled = shapeLineWeights(
      buildVisioPage(document, resolver).body,
    );
    expect(Number(quadrupled[0])).toBeCloseTo(Number(doubled[0]) * 2, 6);
  });

  it("carries the weight onto every link of a wire that turns", () => {
    const document = documentWithWireAndResistor();
    document.routes[0] = createRoutePath({
      id: "wire",
      netId: "net-a",
      start: { kind: "junction", junctionId: "J1" },
      end: { kind: "junction", junctionId: "J2" },
      bends: [{ x: 60, y: 40 }],
      modes: ["manual", "manual"],
    });
    document.routes[0]!.styleOverride = { strokeScale: 2 };

    // A corner splits the Route into two shapes, and a wire drawn heavier than
    // the rest has to stay heavier the whole way around the corner.
    const weights = shapeLineWeights(buildVisioPage(document, resolver).body);
    expect(weights).toHaveLength(2);
    expect(weights[1]).toBe(weights[0]);
  });

  it("says out loud that a component's own paint did not make it across", () => {
    const document = documentWithWireAndResistor();
    document.instances[0]!.styleOverride = { strokeScale: 2 };

    // Every instance of one symbol shares one master, so per-instance paint
    // has nowhere to live. The caveat is the contract, not the silence.
    expect(buildVisioPage(document, resolver).caveats).toContainEqual({
      kind: "dropped-instance-paint",
      detail: "R1",
    });
  });

  it("reports nothing dropped for a component that asked for nothing", () => {
    const caveats = buildVisioPage(
      documentWithWireAndResistor(),
      resolver,
    ).caveats;
    expect(
      caveats.filter((caveat) => caveat.kind === "dropped-instance-paint"),
    ).toEqual([]);
  });
});
