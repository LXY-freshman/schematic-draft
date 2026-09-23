import { createEmptyDocument } from "@icm/model";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AnnotationColorProperties } from "./annotation-color-properties";

/** The preset a swatch row renders as chosen, so the shown ink can be read. */
function pressedPreset(markup: string, ariaLabel: string): boolean {
  return new RegExp(
    `aria-label="${ariaLabel}"[^>]*aria-pressed="true"`,
    "u",
  ).test(markup);
}

describe("annotation color properties", () => {
  it("previews an instance label's inherited component ink while Auto", () => {
    const document = createEmptyDocument("cell", "Cell");
    const annotation: (typeof document.annotations)[number] = {
      id: "instance-label-R1",
      kind: "instance-label",
      content: { runs: [{ kind: "text", value: "R1" }] },
      anchor: {
        kind: "object",
        objectId: "R1",
        localOffset: { x: 0, y: -20 },
        fallbackPosition: { x: 0, y: -20 },
      },
      alignment: "middle",
      rotation: 0,
      locked: false,
    };
    const markup = renderToStaticMarkup(
      <AnnotationColorProperties
        annotation={annotation}
        inheritedColor="#a2142f"
        onApply={() => ({ ok: true })}
      />,
    );

    expect(markup).toContain('aria-label="Text properties"');
    expect(markup).toContain(
      '<output aria-label="Text color hex value">Automatic</output>',
    );
    // Auto shows the ink the label would draw with, not an empty swatch.
    expect(pressedPreset(markup, "Use Dark red for text")).toBe(true);
    expect(markup).toContain("Attached to the object it labels");
    expect(markup).toContain('aria-label="Annotation text alignment"');

    // The JSON is the escape hatch below the form, closed until asked for.
    expect(markup).toContain('aria-label="Text property code"');
    expect(markup).not.toContain("Copy JSON");
  });

  it("shows the annotation-owned override instead of inherited ink", () => {
    const document = createEmptyDocument("cell", "Cell");
    const annotation: (typeof document.annotations)[number] = {
      id: "value",
      kind: "instance-value",
      content: { runs: [{ kind: "text", value: "10k" }] },
      anchor: { kind: "free", position: { x: 0, y: 0 } },
      alignment: "middle",
      rotation: 0,
      locked: false,
      textColor: "#0072bd",
    };
    const markup = renderToStaticMarkup(
      <AnnotationColorProperties
        annotation={annotation}
        inheritedColor="#a2142f"
        onApply={() => ({ ok: true })}
      />,
    );

    expect(markup).toContain(
      '<output aria-label="Text color hex value">#0072bd</output>',
    );
    expect(pressedPreset(markup, "Use Blue for text")).toBe(true);
    expect(pressedPreset(markup, "Use Dark red for text")).toBe(false);
    // A free anchor is editable in the form; an attached one is not.
    expect(markup).toContain('aria-label="Annotation X position"');
  });
});
