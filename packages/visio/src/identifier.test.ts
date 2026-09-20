import { describe, expect, it } from "vitest";

import { visioGuid } from "./identifier.js";

describe("visioGuid", () => {
  it("writes the braced form Visio's identifier attributes use", () => {
    expect(visioGuid("resistor")).toMatch(
      /^\{[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}\}$/,
    );
  });

  it("gives one seed the same identifier every time", () => {
    expect(visioGuid("resistor")).toBe(visioGuid("resistor"));
  });

  it("separates seeds that differ anywhere", () => {
    const seeds = [
      "",
      "resistor",
      "resistoR",
      "resistors",
      "nmos#textbook-3terminal",
      "nmos#textbook-4terminal",
    ];
    expect(new Set(seeds.map(visioGuid)).size).toBe(seeds.length);
  });
});
