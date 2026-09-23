import { describe, expect, it } from "vitest";
import { createEmptyDocument, createRoutePath } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";

import { buildSvgScene } from "./render.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function documentWithWireAndResistor() {
  const doc = createEmptyDocument("stroke-scale", "Stroke scale");
  doc.nets.push({ id: "net", terminals: [] });
  doc.junctions.push(
    { id: "J1", netId: "net", position: { x: 0, y: 0 } },
    { id: "J2", netId: "net", position: { x: 40, y: 0 } },
    { id: "J3", netId: "net", position: { x: 80, y: 0 } },
  );
  doc.routes.push(
    createRoutePath({
      id: "scaled-wire",
      netId: "net",
      start: { kind: "junction", junctionId: "J1" },
      end: { kind: "junction", junctionId: "J2" },
      bends: [],
      modes: ["manual"],
    }),
    createRoutePath({
      id: "default-wire",
      netId: "net",
      start: { kind: "junction", junctionId: "J2" },
      end: { kind: "junction", junctionId: "J3" },
      bends: [],
      modes: ["manual"],
    }),
  );
  doc.instances.push(
    {
      id: "R1",
      symbolId: "resistor",
      placement: { position: { x: 0, y: 60 }, rotation: 0, mirror: "none" },
    },
    {
      id: "R2",
      symbolId: "resistor",
      placement: { position: { x: 80, y: 60 }, rotation: 0, mirror: "none" },
    },
  );
  return doc;
}

/** The stroke width each object is drawn with when nothing overrides it. */
function baselineWidths() {
  const scene = buildSvgScene(documentWithWireAndResistor(), resolver);
  const wire =
    /data-object-id="default-wire"[^>]*stroke-width="([\d.]+)"/u.exec(
      scene.formalBody,
    );
  const symbol = /data-object-id="R2"[\s\S]*?stroke-width="([\d.]+)"/u.exec(
    scene.formalBody,
  );
  expect(wire, "wire baseline").not.toBeNull();
  expect(symbol, "symbol baseline").not.toBeNull();
  return { wire: Number(wire![1]), symbol: Number(symbol![1]) };
}

/** Every stroke width in one scene, in document order. */
function strokeWidths(body: string): string[] {
  return [...body.matchAll(/stroke-width="([\d.]+)"/gu)].map(
    (match) => match[1]!,
  );
}

describe("per-object stroke scale rendering", () => {
  it("multiplies only the Route that asks for it", () => {
    const base = baselineWidths();
    const doc = documentWithWireAndResistor();
    doc.routes[0]!.styleOverride = { strokeScale: 2.5 };

    const body = buildSvgScene(doc, resolver).formalBody;
    expect(body).toContain(
      `data-object-id="scaled-wire" data-net-id="net" points="0,0 40,0" fill="none" stroke="#000" stroke-width="${base.wire * 2.5}"`,
    );
    expect(body).toContain(
      `data-object-id="default-wire" data-net-id="net" points="40,0 80,0" fill="none" stroke="#000" stroke-width="${base.wire}"`,
    );
  });

  it("multiplies every stroke of the Instance that asks for it, and no other", () => {
    const base = baselineWidths();
    const doc = documentWithWireAndResistor();
    doc.instances[0]!.styleOverride = { strokeScale: 3 };

    const body = buildSvgScene(doc, resolver).formalBody;
    const scaled = /data-object-id="R1"([\s\S]*?)<\/g><\/g><\/g>/u.exec(body);
    const untouched = /data-object-id="R2"([\s\S]*?)<\/g><\/g><\/g>/u.exec(
      body,
    );
    expect(scaled).not.toBeNull();
    expect(untouched).not.toBeNull();
    // Both the symbol group and the primitive that writes its own width move
    // together: one symbol stays in proportion with itself. The expectation is
    // written rounded because the raw product here is 4.800000000000001 — the
    // very noise the renderer promises to keep out of an attribute.
    const tripled = String(Number((base.symbol * 3).toFixed(4)));
    expect(strokeWidths(scaled![1]!)).toEqual([tripled, tripled]);
    expect(strokeWidths(untouched![1]!)).toEqual([
      String(base.symbol),
      String(base.symbol),
    ]);
  });

  it("draws a scale of 1 with exactly the widths of no scale at all", () => {
    const unscaled = buildSvgScene(
      documentWithWireAndResistor(),
      resolver,
    ).formalBody;
    const doc = documentWithWireAndResistor();
    doc.routes[0]!.styleOverride = { strokeScale: 1 };
    doc.instances[0]!.styleOverride = { strokeScale: 1 };

    // A Project carrying an explicit 1 is rare — the Edit Engine collapses it
    // — but a hand-edited file may hold one, and it must not shift a pixel.
    expect(strokeWidths(buildSvgScene(doc, resolver).formalBody)).toEqual(
      strokeWidths(unscaled),
    );
  });

  it("keeps a scaled product out of binary-noise territory", () => {
    const doc = documentWithWireAndResistor();
    doc.routes[0]!.styleOverride = { strokeScale: 0.3 };

    const width =
      /data-object-id="scaled-wire"[^>]*stroke-width="([\d.]+)"/u.exec(
        buildSvgScene(doc, resolver).formalBody,
      )?.[1];
    expect(width).toBeDefined();
    expect(width).not.toContain("0000");
    expect(width).not.toContain("9999");
  });
});
