import { describe, expect, it } from "vitest";

import { shapeDataSection, visioRowName } from "./shape-data.js";

describe("visioRowName", () => {
  it("leaves an identifier alone", () => {
    expect(visioRowName("vth0")).toBe("vth0");
  });

  it("transliterates what a ShapeSheet row name cannot hold", () => {
    expect(visioRowName("w/l")).toBe("w_l");
    expect(visioRowName("m.1")).toBe("m_1");
  });

  it("keeps a leading digit from starting a row name", () => {
    expect(visioRowName("2n")).toBe("_2n");
    expect(visioRowName("")).toBe("_");
  });
});

describe("shapeDataSection", () => {
  it("writes nothing for a shape with nothing to say", () => {
    expect(shapeDataSection([])).toBe("");
  });

  it("declares every value a string, so `1u` survives", () => {
    const section = shapeDataSection([
      { name: "Param_w", label: "w", value: "1u" },
    ]);
    expect(section).toBe(
      '<Section N="Property">' +
        '<Row N="Param_w"><Cell N="Value" V="1u" U="STR"/>' +
        '<Cell N="Label" V="w"/><Cell N="Type" V="0"/></Row>' +
        "</Section>",
    );
  });

  it("numbers row names that collide and leaves the labels readable", () => {
    // `w/l` and `w.l` transliterate to the same identifier; both parameters
    // still have to reach the Shape Data window under their own spelling.
    const section = shapeDataSection([
      { name: visioRowName("w/l"), label: "w/l", value: "4" },
      { name: visioRowName("w.l"), label: "w.l", value: "8" },
    ]);
    expect(section).toContain('<Row N="w_l">');
    expect(section).toContain('<Row N="w_l_2">');
    expect(section).toContain('<Cell N="Label" V="w/l"/>');
    expect(section).toContain('<Cell N="Label" V="w.l"/>');
  });

  it("escapes a value that would end the attribute", () => {
    expect(
      shapeDataSection([{ name: "Model", label: "Model", value: 'a"&<b' }]),
    ).toContain('V="a&quot;&amp;&lt;b"');
  });
});
