import { SYMBOL_CONNECTION_GRID } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import {
  CONNECTION_GRID_INCHES,
  DOCUMENT_UNITS_PER_INCH,
  inchesFromUnits,
  pageYInchesFromUnits,
  unitsFromInches,
} from "./units.js";
import { escapeXmlAttribute, escapeXmlText, formatVisioNumber } from "./xml.js";

describe("units", () => {
  it("puts one connection-grid step on one Visio grid step", () => {
    expect(inchesFromUnits(SYMBOL_CONNECTION_GRID)).toBe(
      CONNECTION_GRID_INCHES,
    );
    expect(DOCUMENT_UNITS_PER_INCH).toBe(80);
  });

  it("round-trips between units and inches", () => {
    expect(unitsFromInches(inchesFromUnits(320))).toBe(320);
  });

  it("mirrors the y axis about the page", () => {
    expect(pageYInchesFromUnits(0, 8.5)).toBe(8.5);
    expect(pageYInchesFromUnits(80, 8.5)).toBe(7.5);
  });
});

describe("formatVisioNumber", () => {
  it("never writes exponent notation", () => {
    expect(formatVisioNumber(0.0000001)).toBe("0");
    expect(formatVisioNumber(123456789)).toBe("123456789");
  });

  it("trims trailing zeros without eating integers", () => {
    expect(formatVisioNumber(8.5)).toBe("8.5");
    expect(formatVisioNumber(100)).toBe("100");
    expect(formatVisioNumber(0)).toBe("0");
    expect(formatVisioNumber(-0)).toBe("0");
  });

  it("refuses values a ShapeSheet cell cannot hold", () => {
    expect(() => formatVisioNumber(Number.NaN)).toThrow(/finite/);
    expect(() => formatVisioNumber(Number.POSITIVE_INFINITY)).toThrow(/finite/);
    expect(() => formatVisioNumber(1e21)).toThrow(/below 1e15/);
  });
});

describe("xml escaping", () => {
  it("escapes markup in text and attributes", () => {
    expect(escapeXmlText('R1 & <"C2">')).toBe('R1 &amp; &lt;"C2"&gt;');
    expect(escapeXmlAttribute('R1 & <"C2">')).toBe(
      "R1 &amp; &lt;&quot;C2&quot;&gt;",
    );
  });

  it("drops control characters XML cannot carry", () => {
    expect(escapeXmlText("a\u0000b\u001fc")).toBe("abc");
    expect(escapeXmlText("keep\tthis\nand\rthis")).toBe(
      "keep\tthis\nand\rthis",
    );
    expect(escapeXmlAttribute("two\nlines")).toBe("two&#10;lines");
  });
});
