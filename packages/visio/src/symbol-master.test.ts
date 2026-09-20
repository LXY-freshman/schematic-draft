import { builtInSymbols } from "@icm/symbols";
import type { SymbolDefinition } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import {
  buildSymbolMaster,
  buildSymbolMasters,
  enumerateVisioMasterSources,
  symbolHasVisioMaster,
} from "./symbol-master.js";
import type { VisioSymbolMaster } from "./symbol-master.js";

function definition(id: string): SymbolDefinition {
  const found = builtInSymbols.find((symbol) => symbol.id === id);
  if (!found) throw new Error(`No built-in symbol "${id}"`);
  return found;
}

const masters = buildSymbolMasters(builtInSymbols);
const byKey = new Map(masters.map((master) => [master.key, master]));

function master(key: string): VisioSymbolMaster {
  const found = byKey.get(key);
  if (!found) throw new Error(`No master for "${key}"`);
  return found;
}

/** `V="…"` of every cell named `name`, in document order. */
function cellValues(shapes: string, name: string): string[] {
  const pattern = new RegExp(`<Cell N="${name}" V="([^"]*)"`, "g");
  return [...shapes.matchAll(pattern)].map((match) => match[1] as string);
}

describe("enumerateVisioMasterSources", () => {
  it("leaves out symbols drawn from their formula", () => {
    // A Transfer Function block's frame widens to fit its text, so two
    // instances of one symbol are two different outlines — there is no single
    // shape to put in a stencil.
    const adaptive = definition("transconductance");
    expect(symbolHasVisioMaster(adaptive)).toBe(false);
    expect(byKey.has("transconductance")).toBe(false);
    expect(() =>
      buildSymbolMaster(
        { definition: adaptive, variant: undefined, disambiguate: false },
        1,
      ),
    ).toThrow(/drawn from its formula/);
  });

  it("leaves out artwork a default variant makes unreachable", () => {
    // `nmos` always resolves to `textbook-3terminal`, so its four-terminal
    // drawing is never what a document shows.
    const nmos = definition("nmos");
    expect(nmos.defaultVariantId).toBe("textbook-3terminal");
    const keys = enumerateVisioMasterSources([nmos]).map(
      (source) => source.variant?.id,
    );
    expect(keys).toEqual(["textbook-3terminal"]);
  });

  it("keeps the base artwork when no variant is the default", () => {
    const opamp = definition("opamp");
    expect(opamp.defaultVariantId).toBeUndefined();
    const sources = enumerateVisioMasterSources([opamp]);
    expect(sources[0]?.variant).toBeUndefined();
  });
});

describe("buildSymbolMaster", () => {
  it("frames a symbol at its view box and anchors each pin on it", () => {
    const resistor = master("resistor");
    expect(resistor.master.name).toBe("Resistor");
    // 20 x 48 document units at 80 units to the inch.
    expect(resistor.master.widthInches).toBeCloseTo(0.25, 6);
    expect(resistor.master.heightInches).toBeCloseTo(0.6, 6);
    expect(resistor.connections).toEqual([
      {
        pinName: "1",
        rowName: "Row_1",
        xFraction: 0.5,
        yFraction: 0.916667,
      },
      {
        pinName: "2",
        rowName: "Row_2",
        xFraction: 0.5,
        yFraction: 0.083333,
      },
    ]);
    // Pin 1 points up the page and pin 2 down it: y is flipped against the
    // schematic, where pin 1 sits at the negative y end.
    expect(cellValues(resistor.master.shapes, "DirY")).toEqual(["1", "-1"]);
    expect(resistor.master.shapes).toContain(
      '<Cell N="Y" V="0.55" F="Height*0.916667"/>',
    );
  });

  it("names the connection rows a Connect record can reach", () => {
    for (const { connections, master: built } of masters) {
      for (const connection of connections) {
        expect(built.shapes).toContain(`<Row N="${connection.rowName}">`);
      }
    }
  });

  it("applies a variant's hidden pins and wiring anchors", () => {
    const nmos = master("nmos#textbook-3terminal");
    // The three-terminal drawing hides the bulk pin but still lets a wire land
    // on the channel, so B moves rather than disappearing.
    expect(nmos.connections.map((pin) => pin.pinName)).toEqual([
      "D",
      "G",
      "S",
      "B",
    ]);
    const bulk = nmos.connections.at(-1);
    expect(bulk?.xFraction).toBeCloseTo((-4 + 24) / 48, 6);
    expect(bulk?.yFraction).toBeCloseTo(0.5, 6);
    // One reachable master, so the name carries no variant suffix.
    expect(nmos.master.name).toBe("NMOS");
  });

  it("splits artwork into one child shape per drawn stroke", () => {
    const opamp = master("opamp");
    const weights = cellValues(opamp.master.shapes, "LineWeight");
    const caps = cellValues(opamp.master.shapes, "LineCap");
    // Leads (normal, butt), body outline (emphasis, butt), polarity marks
    // (normal, round): three children from two weights and two caps, because
    // Visio keeps both on the shape rather than on the geometry.
    expect(weights).toHaveLength(3);
    expect(caps).toHaveLength(3);
    expect(new Set(weights).size).toBe(2);
    expect(new Set(caps)).toEqual(new Set(["0", "1"]));
    const asNumbers = weights.map(Number);
    expect(Math.max(...asNumbers)).toBeGreaterThan(Math.min(...asNumbers));
    // Children cover the whole group, so their geometry fractions and the
    // group's connection fractions are the same numbers.
    expect(opamp.master.shapes).toContain(
      '<Cell N="Width" V="1.1" F="Sheet.5!Width*1"/>',
    );
  });

  it("fills only the primitives that ask for it", () => {
    // A diode's triangle is an outline; an NPN's arrowhead is solid.
    expect(cellValues(master("diode").master.shapes, "NoFill")).toContain("1");
    expect(cellValues(master("npn").master.shapes, "NoFill")).toContain("0");
  });

  it("records the marks a fixed master cannot keep upright", () => {
    // The minus bar turns into a vertical stroke when the shape rotates; the
    // plus sign survives rotation, which is why only one is recorded.
    expect(master("opamp").caveats).toEqual([
      { kind: "upright-mark", detail: "upright-input-polarity-negative" },
    ]);
    expect(master("resistor").caveats).toEqual([]);
  });

  it("numbers masters from one and keeps names distinct", () => {
    expect(masters.map((built) => built.master.id)).toEqual(
      masters.map((_, index) => index + 1),
    );
    expect(new Set(masters.map((built) => built.master.name)).size).toBe(
      masters.length,
    );
  });

  it("gives the same master the same identifiers every time", () => {
    const again = buildSymbolMasters(builtInSymbols);
    expect(again.map((built) => built.master.uniqueId)).toEqual(
      masters.map((built) => built.master.uniqueId),
    );
    expect(again[0]?.master.shapes).toBe(masters[0]?.master.shapes);
  });
});

describe("the built-in symbol catalog", () => {
  it("converts every symbol that has a fixed outline", () => {
    const convertible = builtInSymbols.filter((symbol) =>
      symbolHasVisioMaster(symbol),
    );
    expect(convertible.length).toBeGreaterThan(60);
    expect(new Set(masters.map((built) => built.symbolId)).size).toBe(
      convertible.length,
    );
  });

  it("gives every visible pin exactly one connection point", () => {
    for (const built of masters) {
      const symbol = definition(built.symbolId);
      const variant = symbol.variants.find(
        (candidate) => candidate.id === built.variantId,
      );
      const hidden = new Set(variant?.hiddenPinNames ?? []);
      const anchored = new Set(
        (variant?.auxiliaryPins ?? []).map((pin) => pin.name),
      );
      const expected = symbol.pins.filter(
        (pin) =>
          pin.presentation.visibility === "visible" &&
          (!hidden.has(pin.name) || anchored.has(pin.name)),
      );
      expect(built.connections.map((pin) => pin.pinName)).toEqual(
        expected.map((pin) => pin.name),
      );
    }
  });

  it("keeps every coordinate inside the symbol's own frame", () => {
    for (const built of masters) {
      for (const connection of built.connections) {
        expect(connection.xFraction).toBeGreaterThanOrEqual(0);
        expect(connection.xFraction).toBeLessThanOrEqual(1);
        expect(connection.yFraction).toBeGreaterThanOrEqual(0);
        expect(connection.yFraction).toBeLessThanOrEqual(1);
      }
      // Geometry rows are fractions of the shape too, so the same bounds hold.
      for (const section of built.master.shapes.matchAll(
        /<Row T="Rel[^"]*"[^>]*>(.*?)<\/Row>/g,
      )) {
        for (const cell of (section[1] as string).matchAll(
          /<Cell N="[A-Z]" V="([^"]*)"/g,
        )) {
          const value = Number(cell[1]);
          expect(Number.isFinite(value)).toBe(true);
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("draws every primitive it was given", () => {
    for (const built of masters) {
      const symbol = definition(built.symbolId);
      const variant = symbol.variants.find(
        (candidate) => candidate.id === built.variantId,
      );
      const hiddenParts = new Set(variant?.hiddenPrimitiveParts ?? []);
      const drawn = [
        ...symbol.primitives,
        ...(variant?.additionalPrimitives ?? []),
      ].filter(
        (primitive) => !primitive.part || !hiddenParts.has(primitive.part),
      );
      const sections = [
        ...built.master.shapes.matchAll(/<Section N="Geometry" IX="\d+">/g),
      ];
      expect(sections).toHaveLength(drawn.length);
    }
  });

  it("names every artwork shape a placed group will instantiate", () => {
    // A page has to reserve a shape ID for each of these: Visio numbers the
    // children of a placed group from the group's ID up, and takes those IDs
    // from the page whether or not the file offered them.
    for (const built of masters) {
      const artwork = [
        ...built.master.shapes.matchAll(/<Shape ID="(\d+)" Type="Shape"/g),
      ].map((match) => Number(match[1]));
      expect(built.childShapeIds).toEqual(artwork);
      expect(artwork.length).toBeGreaterThan(0);
    }
  });
});
