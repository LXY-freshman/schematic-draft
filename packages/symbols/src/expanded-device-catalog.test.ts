import { describe, expect, it } from "vitest";

import {
  expandedDeviceCatalogEntries,
  expandedDeviceSymbols,
  EXTENDED_DEVICE_CATEGORY,
  HIGH_VOLTAGE_DEVICE_SUBCATEGORY,
  MOS_VARIANT_SUBCATEGORY,
  SUPPLY_MARKER_SUBCATEGORY,
} from "./expanded-device-catalog.js";
import { razaviProductSymbols } from "./razavi-catalog.js";
import { SymbolDefinitionSchema } from "./schema.js";

describe("Extended Devices catalog", () => {
  it("keeps optional MOS families outside the Razavi authority boundary", () => {
    expect(expandedDeviceCatalogEntries).toEqual([
      {
        symbolId: "analog-ground",
        category: EXTENDED_DEVICE_CATEGORY,
        subcategory: SUPPLY_MARKER_SUBCATEGORY,
      },
      {
        symbolId: "depletion-nmos",
        category: EXTENDED_DEVICE_CATEGORY,
        subcategory: MOS_VARIANT_SUBCATEGORY,
      },
      {
        symbolId: "depletion-pmos",
        category: EXTENDED_DEVICE_CATEGORY,
        subcategory: MOS_VARIANT_SUBCATEGORY,
      },
      {
        symbolId: "dgan",
        category: EXTENDED_DEVICE_CATEGORY,
        subcategory: HIGH_VOLTAGE_DEVICE_SUBCATEGORY,
      },
      {
        symbolId: "digital-ground",
        category: EXTENDED_DEVICE_CATEGORY,
        subcategory: SUPPLY_MARKER_SUBCATEGORY,
      },
      {
        symbolId: "egan",
        category: EXTENDED_DEVICE_CATEGORY,
        subcategory: HIGH_VOLTAGE_DEVICE_SUBCATEGORY,
      },
      {
        symbolId: "igbt",
        category: EXTENDED_DEVICE_CATEGORY,
        subcategory: HIGH_VOLTAGE_DEVICE_SUBCATEGORY,
      },
      {
        symbolId: "ndmos",
        category: EXTENDED_DEVICE_CATEGORY,
        subcategory: HIGH_VOLTAGE_DEVICE_SUBCATEGORY,
      },
      {
        symbolId: "pdmos",
        category: EXTENDED_DEVICE_CATEGORY,
        subcategory: HIGH_VOLTAGE_DEVICE_SUBCATEGORY,
      },
    ]);
    for (const symbol of expandedDeviceSymbols) {
      expect(SymbolDefinitionSchema.parse(symbol)).toEqual(symbol);
    }
  });

  it.each([
    ["depletion-nmos", "Depletion NMOS", "nmos", -7.776744],
    // The mark clears whichever channel lead it reaches, and the PMOS source
    // lead is measured from its own screenshot panel: it sits 0.145 above the
    // NMOS channel the rest of the body is drawn from, so the mark starts
    // that much higher.
    ["depletion-pmos", "Depletion PMOS", "pmos", -7.922093],
  ] as const)(
    "keeps %s identical to %s but for one wire-width depletion channel and the body lead that starts on it",
    (id, name, baseId, topY) => {
      const symbol = expandedDeviceSymbols.find(
        (candidate) => candidate.id === id,
      );
      const base = razaviProductSymbols.find(
        (candidate) => candidate.id === baseId,
      );
      expect(symbol).toMatchObject({
        id,
        name,
        defaultVariantId: "textbook-3terminal",
        pins: [{ name: "D" }, { name: "G" }, { name: "S" }, { name: "B" }],
      });
      expect(symbol?.viewBox).toEqual(base?.viewBox);
      expect(symbol?.pins).toEqual(base?.pins);
      const baseLead = base?.primitives.find(
        (primitive) => primitive.part === "bulk-lead",
      );
      const body = symbol?.primitives.slice(0, -1);
      expect(
        body?.map((primitive) =>
          primitive.part === "bulk-lead" ? baseLead : primitive,
        ),
      ).toEqual(base?.primitives);
      // The body belongs to the channel, so on a depletion part the lead
      // starts on the mark instead of crossing it at mid-height and cutting
      // in two the bar that says the device is normally on.
      const lead = body?.find((primitive) => primitive.part === "bulk-lead");
      expect(lead).toMatchObject({ from: { x: -0.368217, y: 0 } });
      expect(symbol?.variants).toEqual(base?.variants);
      expect(symbol?.primitives.at(-1)).toMatchObject({
        kind: "line",
        from: { x: -0.368217, y: topY },
        to: { x: -0.368217, y: 7.776744 },
        part: "depletion-channel",
        style: { strokeRole: "normal", lineCap: "butt" },
      });
    },
  );

  it("splits the enhancement GaN channel into three segments and leaves the depletion one whole", () => {
    const channelOf = (id: "egan" | "dgan", part: string) =>
      expandedDeviceSymbols
        .find((candidate) => candidate.id === id)
        ?.primitives.filter(
          (primitive) => primitive.kind === "line" && primitive.part === part,
        );

    // An enhancement device has no channel until the gate induces one, which
    // is what the three separated segments say; a depletion device conducts
    // at zero bias and gets the continuous bar below. The two GaN symbols are
    // otherwise the same drawing, so this is the whole distinction.
    expect(channelOf("egan", "channel-segment")).toEqual([
      expect.objectContaining({
        from: { x: -6, y: -13.5 },
        to: { x: -6, y: -6.5 },
      }),
      expect.objectContaining({
        from: { x: -6, y: -3.5 },
        to: { x: -6, y: 3.5 },
      }),
      expect.objectContaining({
        from: { x: -6, y: 6.5 },
        to: { x: -6, y: 13.5 },
      }),
    ]);
    expect(channelOf("egan", "channel-bar")).toEqual([]);
    expect(channelOf("dgan", "channel-bar")).toEqual([
      expect.objectContaining({
        from: { x: -6, y: -14 },
        to: { x: -6, y: 14 },
      }),
    ]);
    expect(channelOf("dgan", "channel-segment")).toEqual([]);
  });

  it.each([
    ["ndmos", "N-channel DMOS"],
    ["pdmos", "P-channel DMOS"],
  ] as const)(
    "defines %s as a four-terminal MOS drawn with or without its body",
    (id, name) => {
      const symbol = expandedDeviceSymbols.find(
        (candidate) => candidate.id === id,
      );
      expect(symbol).toMatchObject({
        id,
        name,
        defaultVariantId: "standard-3terminal",
        pins: [{ name: "D" }, { name: "G" }, { name: "S" }, { name: "B" }],
        variants: [
          {
            id: "standard-3terminal",
            hiddenPinNames: ["B"],
            hiddenPrimitiveParts: ["bulk-lead"],
          },
          // B is a terminal in both drawings; this one simply draws its lead.
          { id: "four-terminal", hiddenPinNames: [] },
        ],
      });
    },
  );

  it.each([
    ["ndmos", "nmos"],
    ["pdmos", "pmos"],
  ] as const)(
    "keeps %s identical to %s except for one equal-length drift line",
    (dmosId, baseId) => {
      const dmos = expandedDeviceSymbols.find((symbol) => symbol.id === dmosId);
      const base = razaviProductSymbols.find((symbol) => symbol.id === baseId);
      expect(dmos?.viewBox).toEqual(base?.viewBox);
      expect(dmos?.pins).toEqual(base?.pins);
      expect(dmos?.primitives.slice(0, -1)).toEqual(base?.primitives);

      const extra = dmos?.primitives.at(-1);
      expect(extra).toMatchObject({
        kind: "polyline",
        part: "drift-region",
      });
      const drainBranch = base?.primitives.find(
        (primitive) =>
          primitive.kind === "polyline" &&
          primitive.points.at(-1)?.x ===
            base.pins.find((pin) => pin.name === "D")?.at.x &&
          primitive.points.at(-1)?.y ===
            base.pins.find((pin) => pin.name === "D")?.at.y,
      );
      if (extra?.kind !== "polyline" || drainBranch?.kind !== "polyline") {
        throw new Error("Missing DMOS drift line or base drain branch");
      }
      expect([extra.points[0]?.x, extra.points[1]?.x]).toEqual([
        drainBranch.points[0]?.x,
        drainBranch.points[1]?.x,
      ]);
      expect(
        Math.abs(extra.points[0]?.y ?? Number.POSITIVE_INFINITY),
      ).toBeLessThan(
        Math.abs(drainBranch.points[0]?.y ?? Number.POSITIVE_INFINITY),
      );
      expect(extra.points[2]).toEqual(drainBranch.points[1]);

      const dmosVariant = dmos?.variants.find(
        (variant) => variant.id === "standard-3terminal",
      );
      const baseVariant = base?.variants.find(
        (variant) => variant.id === base.defaultVariantId,
      );
      expect(
        dmosVariant ? { ...dmosVariant, id: baseVariant?.id } : undefined,
      ).toEqual(baseVariant);
    },
  );
});
