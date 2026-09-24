import { describe, expect, it } from "vitest";
import { deviceDescriptor } from "@icm/devices";
import { POWER_MARKER_SYMBOL_IDS, powerMarkerContract } from "@icm/model";

import { builtInSymbols } from "./builtins.js";

/**
 * `@icm/model` owns the power-marker table because every layer below the
 * editor reads it, but the model cannot see artwork or device descriptors. A
 * contract naming a Symbol that does not exist, or a pin the Symbol does not
 * have, would fail as a silently skipped marker rather than as an error, so
 * the two halves are compared here, where both are visible.
 */
describe("power marker contracts", () => {
  it.each(POWER_MARKER_SYMBOL_IDS)(
    "matches the authored %s component",
    (symbolId) => {
      const contract = powerMarkerContract(symbolId)!;
      const symbol = builtInSymbols.find((item) => item.id === symbolId);
      expect(symbol).toBeDefined();
      expect(symbol!.pins.map((pin) => pin.name)).toEqual([contract.pinName]);

      // A marker names a Net; it never prints a card or takes a designator.
      const descriptor = deviceDescriptor(symbolId)!;
      expect(descriptor.deviceClass).toBe("net-marker");
      expect(descriptor.referencePrefix).toBeNull();
      expect(descriptor.targetPolicy).toBe("none");
      expect(descriptor.pinOrder).toEqual([contract.pinName]);
    },
  );

  it("keeps one canonical marker per supply domain", () => {
    const canonical = POWER_MARKER_SYMBOL_IDS.filter(
      (symbolId) => powerMarkerContract(symbolId)!.canonical,
    ).map((symbolId) => powerMarkerContract(symbolId)!.domain);
    expect(canonical.sort()).toEqual(["ground", "vdd"]);
  });
});
