import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { DrawingToolbar, tooltipCenter } from "./drawing-toolbar";

describe("DrawingToolbar", () => {
  it("projects active panels and tools without owning editor state", () => {
    const markup = renderToStaticMarkup(
      <DrawingToolbar
        leftPanelMode="examples"
        libraryPanelOpen
        projectPanel="project-code"
        tool="wire"
        documentSettingsOpen
        undo={{ enabled: true, execute: vi.fn() }}
        redo={{ enabled: true, execute: vi.fn() }}
        simulation={{ open: true, onToggle: vi.fn() }}
        onToggleExamples={vi.fn()}
        onToggleLibrary={vi.fn()}
        onToggleNetlist={vi.fn()}
        onToggleProjectCode={vi.fn()}
        onActivateTool={vi.fn()}
        onAddText={vi.fn()}
        onOpenDocumentSettings={vi.fn()}
      />,
    );

    expect(markup).toContain('data-testid="draw-toolbar"');
    expect(markup).toContain('data-testid="examples-toggle"');
    expect(markup).toContain('data-testid="netlist-panel-toggle"');
    expect(markup).toContain('data-testid="project-code-toggle"');
    expect(markup).toContain('data-testid="draw-tool-wire"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).not.toContain('data-testid="draw-tool-insert"');
    expect(markup).not.toContain('data-testid="draw-tool-arrow"');
    expect(markup).not.toContain('data-testid="draw-tool-line"');
    expect(markup).not.toContain('data-testid="draw-tool-rectangle"');
    expect(markup).not.toContain('data-testid="draw-tool-circle"');
    expect(markup).toContain("Document settings");
    expect(markup).toContain('data-testid="digital-simulation-toggle"');
    expect(markup).toContain("Digital Simulation");
    expect(markup).toContain('class="draw-toolbar-project-spacer"');
    expect(
      markup.indexOf('data-testid="netlist-panel-toggle"'),
    ).toBeGreaterThan(
      markup.indexOf('data-testid="digital-simulation-toggle"'),
    );
    expect(markup.indexOf('data-testid="project-code-toggle"')).toBeGreaterThan(
      markup.indexOf('data-testid="netlist-panel-toggle"'),
    );
  });
});

describe("toolbar tooltip placement", () => {
  const viewport = 1000;
  // The centre a tooltip is placed at, and the edge that follows from it.
  const leftEdge = (center: number, width: number) =>
    tooltipCenter(center, width, viewport) - width / 2;
  const rightEdge = (center: number, width: number) =>
    tooltipCenter(center, width, viewport) + width / 2;

  it("keeps a tooltip inside the window at either end of the toolbar", () => {
    // Gallery is the first button: centred on it, the tooltip would start off
    // the left edge, where the window clips it away completely.
    expect(leftEdge(59, 150)).toBeGreaterThanOrEqual(0);
    expect(tooltipCenter(59, 150, viewport)).toBe(83);
    // Project Code is the last one, with the same problem mirrored.
    expect(rightEdge(960, 130)).toBeLessThanOrEqual(viewport);
    expect(tooltipCenter(960, 130, viewport)).toBe(927);
  });

  it("leaves a tooltip that already fits where it points", () => {
    expect(tooltipCenter(500, 150, viewport)).toBe(500);
    // Exactly against the margin is inside, so nothing moves.
    expect(tooltipCenter(83, 150, viewport)).toBe(83);
  });

  it("centres a tooltip too wide for the window rather than pinning an edge", () => {
    // Nothing can be inside on both sides; showing the middle of the text beats
    // showing its start and losing the rest off the far edge.
    expect(tooltipCenter(59, 1200, viewport)).toBe(500);
  });
});
