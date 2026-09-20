import type { RichTextDocument, RichTextRun, RichTextStyle } from "@icm/model";
import { describe, expect, it } from "vitest";

import { textShape, visioTextContent } from "./text.js";

const style = { fontSizeInches: 0.18895, color: "#1a2b3c" };

/** `styled("R", "italic", "bold")` is an italic span around a bold one. */
function styled(value: string, ...styles: RichTextStyle[]): RichTextRun {
  return styles.reduceRight<RichTextRun>(
    (child, name) => ({ kind: "span", style: name, children: [child] }),
    { kind: "text", value },
  );
}

/** The `<Row …>` elements of a Character section, in order. */
function rows(section: string): string[] {
  return [...section.matchAll(/<Row IX="\d+">.*?<\/Row>/gs)].map(
    (match) => match[0],
  );
}

describe("visioTextContent", () => {
  it("writes one Character row per distinct format and points each run at it", () => {
    // What `semanticTextDocument` makes of a reference designator: the symbol
    // bold italic, the index bold in a subscript.
    const designator: RichTextDocument = {
      runs: [styled("R", "italic", "bold"), styled("1", "subscript", "bold")],
    };
    const content = visioTextContent(designator, style);
    expect(rows(content.characterSection)).toHaveLength(2);
    expect(content.characterSection).toContain(
      '<Cell N="Style" V="3"/><Cell N="Pos" V="0"/>',
    );
    expect(content.characterSection).toContain(
      '<Cell N="Style" V="1"/><Cell N="Pos" V="2"/>',
    );
    expect(content.text).toBe(
      '<Text><pp IX="0"/><cp IX="0"/>R<cp IX="1"/>1\n</Text>',
    );
  });

  it("points a format that comes back at the row it already has", () => {
    const content = visioTextContent(
      {
        runs: [
          styled("A", "bold"),
          { kind: "text", value: "b" },
          styled("C", "bold"),
        ],
      },
      style,
    );
    expect(rows(content.characterSection)).toHaveLength(2);
    expect(content.text).toBe(
      '<Text><pp IX="0"/><cp IX="0"/>A<cp IX="1"/>b<cp IX="0"/>C\n</Text>',
    );
  });

  it("asks for the face, the size and the color the schematic set", () => {
    const content = visioTextContent(
      { runs: [{ kind: "text", value: "x" }] },
      style,
    );
    expect(content.characterSection).toContain(
      '<Cell N="Font" V="Arial"/><Cell N="Size" V="0.18895" U="PT"/>' +
        '<Cell N="Color" V="#1A2B3C"/>',
    );
  });

  it("scales every row, not just the one Visio would default", () => {
    // Read back from Visio, a row past the first has an empty `FontScale`
    // where row 0 has 100%, and an empty one is no scale rather than full
    // size: the run's characters all land on the same x. Every row carries
    // the cell so no run depends on being first.
    const content = visioTextContent(
      { runs: [styled("V", "italic"), styled("out", "subscript")] },
      style,
    );
    expect(rows(content.characterSection)).toHaveLength(2);
    for (const row of rows(content.characterSection)) {
      expect(row).toContain('<Cell N="FontScale" V="1"/>');
    }
  });

  it("still has a format for text that has no runs", () => {
    const content = visioTextContent({ runs: [] }, style);
    expect(rows(content.characterSection)).toHaveLength(1);
    expect(content.text).toBe('<Text><pp IX="0"/>\n</Text>');
  });

  it("escapes text the way the rest of the package does", () => {
    const content = visioTextContent(
      { runs: [{ kind: "text", value: "R<1> & R2" }] },
      style,
    );
    expect(content.text).toContain("R&lt;1&gt; &amp; R2");
  });

  it("flattens a stacked fraction and says it did", () => {
    const content = visioTextContent(
      {
        runs: [
          {
            kind: "fraction",
            numerator: { runs: [{ kind: "text", value: "96u" }] },
            denominator: { runs: [{ kind: "text", value: "1u" }] },
          },
        ],
      },
      style,
      "instance-value a1",
    );
    expect(content.caveats).toEqual([
      { kind: "stacked-fraction", detail: "instance-value a1" },
    ]);
    expect(content.text).toContain("96u/1u");
  });

  it("falls back to the LaTeX source of a typeset formula and says it did", () => {
    const content = visioTextContent(
      { runs: [{ kind: "math", latex: "g_m", display: "inline" }] },
      style,
      "route-marker a2",
    );
    expect(content.caveats).toEqual([
      { kind: "formula-text", detail: "route-marker a2" },
    ]);
    expect(content.text).toContain("g_m");
  });

  it("keeps the name under a lost overbar and says the rule is gone", () => {
    const content = visioTextContent(
      { runs: [styled("EN", "overbar")] },
      style,
      "net-label a3",
    );
    expect(content.caveats).toEqual([
      { kind: "overbar-text", detail: "net-label a3" },
    ]);
    expect(content.text).toContain("EN");
    expect(content.characterSection).toContain('<Cell N="Style" V="0"/>');
  });
});

describe("textShape", () => {
  const content = visioTextContent(
    { runs: [{ kind: "text", value: "VDD" }] },
    style,
  );
  const base = {
    id: 20,
    pin: { x: 2.5, y: 3 },
    widthInches: 0.5,
    heightInches: 0.2,
    angleRadians: 0,
    alignment: "start" as const,
    content,
  };

  it("is nothing but its text", () => {
    const shape = textShape(base);
    expect(shape).not.toContain('<Section N="Geometry"');
    expect(shape).not.toContain("Master=");
    expect(shape).toContain('<Cell N="LinePattern" V="0"/>');
    expect(shape).toContain('<Cell N="FillPattern" V="0"/>');
    expect(shape).toContain(content.text);
  });

  it("pins a following label to the shape it belongs to", () => {
    const shape = textShape({
      ...base,
      follows: { sheetId: 5, offset: { x: 0.375, y: -0.25 } },
    });
    expect(shape).toContain('<Cell N="PinX" V="2.5" F="Sheet.5!PinX+0.375"/>');
    expect(shape).toContain('<Cell N="PinY" V="3" F="Sheet.5!PinY-0.25"/>');
  });

  it("leaves a label that follows nothing at a plain coordinate", () => {
    expect(textShape(base)).toContain('<Cell N="PinX" V="2.5"/>');
  });

  it("aligns the text the way the annotation is aligned", () => {
    for (const [alignment, value] of [
      ["start", "0"],
      ["middle", "1"],
      ["end", "2"],
    ] as const) {
      expect(textShape({ ...base, alignment })).toContain(
        `<Cell N="HorzAlign" V="${value}"/>`,
      );
    }
  });

  it("hangs the text block's spare width off the unaligned edge", () => {
    // The block is wider than the shape so nothing wraps, and the edge the
    // text is aligned to is the one held against the shape: a left-aligned
    // label starts at the shape's left edge and runs right, a right-aligned
    // one ends at its right edge.
    const left = textShape(base);
    expect(left).toContain('<Cell N="TxtWidth" V="2" F="Width*4"/>');
    expect(left).toContain('<Cell N="TxtPinX" V="0" F="0"/>');
    expect(left).toContain('<Cell N="TxtLocPinX" V="0" F="0"/>');

    const right = textShape({ ...base, alignment: "end" });
    expect(right).toContain('<Cell N="TxtPinX" V="0.5" F="Width"/>');
    expect(right).toContain('<Cell N="TxtLocPinX" V="2" F="TxtWidth"/>');

    const centred = textShape({ ...base, alignment: "middle" });
    expect(centred).toContain('<Cell N="TxtPinX" V="0.25" F="Width*0.5"/>');
    expect(centred).toContain('<Cell N="TxtLocPinX" V="1" F="TxtWidth*0.5"/>');
  });

  it("centres the text block in the shape that carries it", () => {
    // Visio gives an unwritten cell nothing rather than the default a shape it
    // authored would inherit, so a shape that states the horizontal text-block
    // cells has to state the vertical ones too. Left out, `TxtHeight` is zero
    // and the line lands on the shape's bottom edge — every label half a box
    // low against the thing it names.
    const shape = textShape(base);
    expect(shape).toContain('<Cell N="TxtHeight" V="0.2" F="Height"/>');
    expect(shape).toContain('<Cell N="TxtPinY" V="0.1" F="Height*0.5"/>');
    expect(shape).toContain('<Cell N="TxtLocPinY" V="0.1" F="TxtHeight*0.5"/>');
  });
});
