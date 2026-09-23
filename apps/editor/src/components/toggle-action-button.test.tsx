import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ToggleActionButton } from "./toggle-action-button";

describe("ToggleActionButton", () => {
  it("keeps one label and reports the state through aria-pressed", () => {
    const off = renderToStaticMarkup(
      <ToggleActionButton
        label="Highlight Net (H)"
        pressed={false}
        onToggle={vi.fn()}
      />,
    );
    const on = renderToStaticMarkup(
      <ToggleActionButton
        label="Highlight Net (H)"
        pressed
        onToggle={vi.fn()}
      />,
    );

    expect(off).toContain('aria-pressed="false"');
    expect(on).toContain('aria-pressed="true"');
    // Anything that clicks this button by name keeps working in both states.
    expect(off).toContain("Highlight Net (H)");
    expect(on).toContain("Highlight Net (H)");
    expect(on).not.toContain("Clear");
  });

  it("carries help text and a test id, and can be disabled", () => {
    const markup = renderToStaticMarkup(
      <ToggleActionButton
        label="Hop over crossings"
        pressed={false}
        disabled
        help="Draw a small arc where this wire crosses another Net"
        testId="route-line-jump"
        onToggle={vi.fn()}
      />,
    );
    expect(markup).toContain('data-testid="route-line-jump"');
    expect(markup).toContain(
      'title="Draw a small arc where this wire crosses another Net"',
    );
    expect(markup).toContain("disabled=");
  });
});
