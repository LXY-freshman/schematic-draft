import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  annotationPropertyValue,
  type AnnotationPropertyValue,
} from "./annotation-property-code";
import { AnnotationPropertyForm } from "./annotation-property-form";

/** The option a select renders as chosen, so a projection can be asserted. */
function selectedOption(markup: string, ariaLabel: string): string | null {
  const select = new RegExp(
    `<select[^>]*aria-label="${ariaLabel}"[^>]*>(.*?)</select>`,
    "su",
  ).exec(markup);
  if (!select) return null;
  return /<option value="([^"]*)" selected=""/u.exec(select[1]!)?.[1] ?? "";
}

function disclosure(markup: string, ariaLabel: string): string {
  return (
    new RegExp(`<details[^>]*aria-label="${ariaLabel}"[^>]*>`, "u").exec(
      markup,
    )?.[0] ?? ""
  );
}

function render(
  value: AnnotationPropertyValue,
  props: Partial<Parameters<typeof AnnotationPropertyForm>[0]> = {},
): string {
  return renderToStaticMarkup(
    <AnnotationPropertyForm
      value={value}
      colorLabel="Text"
      parse={(source) => ({
        ok: true,
        value: JSON.parse(source) as AnnotationPropertyValue,
      })}
      onApply={vi.fn(() => ({ ok: true }))}
      defaultColor="#101828"
      title="Text"
      codeAriaLabel="Text property code"
      code={<textarea aria-label="Editable Canvas property code" />}
      {...props}
    />,
  );
}

const netLabel: AnnotationPropertyValue = annotationPropertyValue({
  id: "net-label-1",
  kind: "net-label",
  content: { runs: [{ kind: "text", value: "OUT" }] },
  anchor: { kind: "free", position: { x: 40, y: -20 } },
  alignment: "middle",
  rotation: 90,
  locked: false,
  textColor: "#2563eb",
  sizeScale: 1.5,
});

describe("AnnotationPropertyForm", () => {
  it("draws a control per available field, with the JSON collapsed underneath", () => {
    const markup = render(netLabel);

    expect(disclosure(markup, "Annotation placement")).toContain('open=""');
    expect(markup).toContain('aria-label="Annotation X position"');
    expect(markup).toContain('value="40"');
    expect(selectedOption(markup, "Annotation rotation")).toBe("90");
    expect(selectedOption(markup, "Annotation text alignment")).toBe("middle");
    expect(selectedOption(markup, "Annotation visibility")).toBe("true");
    expect(selectedOption(markup, "Annotation lock")).toBe("false");
    expect(markup).toContain("#2563eb");
    expect(markup).toContain('value="1.5"');
    // A text annotation has no border, fill, arrow, or shape geometry.
    expect(markup).not.toContain('aria-label="Annotation line style"');
    expect(markup).not.toContain('aria-label="Annotation start style"');
    expect(disclosure(markup, "Annotation size")).toBe("");

    const json = disclosure(markup, "Text property code");
    expect(json).not.toBe("");
    expect(json).not.toContain('open=""');
    expect(markup).toContain("Code (JSON)");
  });

  it("keeps an attached annotation's anchor out of the form", () => {
    const markup = render(
      annotationPropertyValue({
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
      }),
    );

    expect(markup).not.toContain('aria-label="Annotation X position"');
    expect(markup).toContain("Attached to the object it labels");
  });

  it("offers the lock first and refuses the rest while locked", () => {
    const markup = render({ ...netLabel, locked: true });

    expect(selectedOption(markup, "Annotation lock")).toBe("true");
    expect(markup).toMatch(
      /<select aria-label="Annotation rotation" disabled=""/u,
    );
    expect(markup).toMatch(
      /<input aria-label="Annotation X position"[^>]*disabled=""/u,
    );
    expect(markup).not.toMatch(
      /<select aria-label="Annotation lock" disabled=""/u,
    );
  });

  it("leaves fields the panel's own buttons own out of the form", () => {
    const markup = render(
      { ...netLabel, stacking: { layer: "front" } },
      { ownedByActions: ["stacking.layer", "locked"] },
    );

    expect(markup).not.toContain('aria-label="Annotation layer"');
    expect(markup).not.toContain('aria-label="Annotation lock"');
    expect(selectedOption(markup, "Annotation visibility")).toBe("true");
  });
});
