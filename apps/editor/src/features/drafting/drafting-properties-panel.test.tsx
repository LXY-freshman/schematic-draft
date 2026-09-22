import { createEmptyDocument } from "@icm/model";
import type { DraftingObject } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DraftingPropertiesPanel } from "./drafting-properties-panel";
import { ArrowStylePicker } from "./arrow-style-picker";
import { DEFAULT_ARROW_PRESET } from "./arrow-presets";

const resolver = new InMemorySymbolResolver(builtInSymbols);
const noop = () => undefined;

function arrow(styleOverride?: Record<string, unknown>): DraftingObject {
  return {
    id: "ar-1",
    kind: "arrow",
    locked: false,
    zIndex: 0,
    anchor: { kind: "free", position: { x: 0, y: 0 } },
    from: { kind: "free", position: { x: 0, y: 0 } },
    to: { kind: "free", position: { x: 100, y: 0 } },
    ...(styleOverride ? { styleOverride } : {}),
  } as DraftingObject;
}

function render(object: DraftingObject): string {
  const document = createEmptyDocument("doc", "Drafting");
  document.drafting = { objects: [object] };
  return renderToStaticMarkup(
    <DraftingPropertiesPanel
      document={document}
      resolver={resolver}
      object={object}
      defaultColor="#101828"
      grid={1}
      onApply={() => ({ ok: true })}
      onStackingChange={noop}
      onToggleLock={noop}
    />,
  );
}

function polarityMark(
  polarity: "positive" | "negative",
): Extract<DraftingObject, { kind: "text" }> {
  return {
    id: `polarity-${polarity}`,
    kind: "text",
    locked: false,
    zIndex: 0,
    anchor: { kind: "free", position: { x: 50, y: 50 } },
    content: { runs: [{ kind: "line-break" }] },
    alignment: "middle",
    rotation: 0,
    typographyToken: "label",
    polarity,
  };
}

/** The option a select renders as chosen, so a projection can be asserted. */
function selectedOption(markup: string, ariaLabel: string): string | null {
  const select = new RegExp(
    `<select[^>]*aria-label="${ariaLabel}"[^>]*>(.*?)</select>`,
    "su",
  ).exec(markup);
  if (!select) return null;
  return /<option value="([^"]*)" selected=""/u.exec(select[1]!)?.[1] ?? "";
}

describe("fixed polarity mark properties", () => {
  it.each(["positive", "negative"] as const)(
    "labels the %s sign as a mark rather than editable text",
    (polarity) => {
      const markup = render(polarityMark(polarity));

      expect(markup).toContain("Polarity mark");
      expect(markup).toContain('aria-label="Drawing property code"');
      // A mark carries no words, so it offers none of the text controls.
      expect(markup).not.toContain('aria-label="Annotation text alignment"');
      expect(markup).not.toContain('aria-label="Annotation text weight"');
      expect(markup).not.toContain('aria-label="Annotation italic"');
    },
  );
});

describe("independent arrow endpoint styles", () => {
  it("offers arrow shape and both endpoints as controls", () => {
    const markup = render(arrow());
    expect(selectedOption(markup, "Annotation arrow shape")).toBe("line");
    expect(markup).toContain('aria-label="Annotation start style"');
    expect(markup).toContain('aria-label="Annotation end style"');
    expect(markup).not.toContain("arrowStyle");
    expect(markup).toContain('aria-label="Annotation rotation"');
    // Curve tangents stay in the JSON; the canvas handles own them.
    expect(markup).not.toContain("tangentAngles");
    expect(markup).not.toContain('aria-label="Drawing bearing"');
  });
  it.each(["Arrow style", "New arrow style"])(
    "%s omits reversed line arrows and the headless line",
    (label) => {
      const markup = renderToStaticMarkup(
        <ArrowStylePicker
          value={DEFAULT_ARROW_PRESET}
          onChange={noop}
          label={label}
        />,
      );
      for (const name of [
        "Filled start arrow",
        "Open start arrow",
        "No head",
      ]) {
        expect(markup).not.toContain(`aria-label="${name}"`);
      }
      for (const name of [
        "Filled end arrow",
        "Open end arrow",
        "Filled double arrow",
        "Open double arrow",
        "Outline end arrow",
        "Outline start arrow",
        "Outline double arrow",
      ]) {
        expect(markup).toContain(`aria-label="${name}"`);
      }
    },
  );
  it("projects legacy styles into independent start and end values", () => {
    for (const [style, start, end] of [
      [{}, "none", "medium-arrow"],
      [{ arrowHeadAt: "both" }, "medium-arrow", "medium-arrow"],
      [{ arrowHead: "none" }, "none", "none"],
      [{ arrowHeadAt: "start" }, "medium-arrow", "none"],
      [{ arrowHead: "open", arrowHeadAt: "start" }, "open-arrow", "none"],
    ] as const) {
      const markup = render(arrow(style));
      expect(selectedOption(markup, "Annotation start style")).toBe(start);
      expect(selectedOption(markup, "Annotation end style")).toBe(end);
    }
  });
  it("shows geometric width instead of curve controls for an outline", () => {
    const object = { ...arrow(), outline: { width: 30 } } as DraftingObject;
    const markup = render(object);
    expect(selectedOption(markup, "Annotation arrow shape")).toBe("outline");
    expect(markup).toContain('aria-label="Annotation width"');
    expect(markup).toContain('value="30"');
    expect(markup).not.toContain("tangentAngles");
  });
});

describe("closed-shape paint and layer", () => {
  const rectangle: DraftingObject = {
    id: "rect-1",
    kind: "rectangle",
    locked: false,
    zIndex: 0,
    anchor: { kind: "free", position: { x: 50, y: 50 } },
    center: { x: 50, y: 50 },
    width: 80,
    height: 40,
    rotation: 0,
    lineStyle: "solid",
  };

  it("offers independent border/fill paint and front/back actions", () => {
    const markup = render(rectangle);
    expect(markup).toContain("<legend>Border</legend>");
    expect(markup).toContain("<legend>Fill</legend>");
    expect(markup).toContain(">Bring to front</button>");
    expect(markup).toContain(">Send to back</button>");
    // Stacking and the lock stay buttons; the form draws no second control.
    expect(markup).not.toContain('aria-label="Annotation layer"');
    expect(markup).not.toContain('aria-label="Annotation lock"');
    expect(markup).not.toContain("zIndex");
    expect(markup).toContain("Front is above the circuit");
    expect(markup).not.toContain('type="color"');
  });
});
