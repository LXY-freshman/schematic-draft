import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { EditorStatusbar } from "./editor-statusbar";

describe("editor statusbar", () => {
  it("renders the active wire options and recovery state", () => {
    const markup = renderToStaticMarkup(
      <EditorStatusbar
        status="Ready"
        tool="wire"
        vddRailMode={false}
        pendingSymbolId={null}
        wireOptionsOpen
        wireRoutingMode="orthogonal"
        wireCornerOrder="horizontal-first"
        recoveryLabel="Saved locally"
        zoomPercent={100}
        gridVisible
        gridMajorVisible={false}
        onToggleGrid={vi.fn()}
        selectionFilterSummary={null}
        onOpenSelectionFilter={vi.fn()}
        onToggleWireOptions={vi.fn()}
        onWireRoutingModeChange={vi.fn()}
        onWireCornerOrderChange={vi.fn()}
        onZoomOut={vi.fn()}
        onZoomIn={vi.fn()}
        onFitView={vi.fn()}
      />,
    );
    expect(markup).toContain('data-testid="wire-options"');
    expect(markup).toContain("Saved locally");
    expect(markup).toContain('aria-label="Current zoom"');
    expect(markup).not.toContain('aria-label="Annotation grid"');
    expect(markup).not.toContain('aria-label="Draw angle"');
    expect(markup).not.toContain('aria-label="Scroll wheel"');
  });

  // One button, three states. Each row is a state and the click it promises:
  // off -> fine, fine -> coarse, coarse -> off.
  it.each([
    [false, false, "off", "Grid Off", "click to show the background grid"],
    [true, false, "fine", "Grid On", "click to mark every 7th dot"],
    [
      true,
      true,
      "coarse",
      "Grid On · Coarse",
      "click to hide the background grid",
    ],
  ] as const)(
    "cycles one grid button through its three states (visible=%s major=%s)",
    (gridVisible, gridMajorVisible, mode, label, promise) => {
      const markup = renderToStaticMarkup(
        <EditorStatusbar
          status="Ready"
          tool="pointer"
          vddRailMode={false}
          pendingSymbolId={null}
          wireOptionsOpen={false}
          wireRoutingMode="orthogonal"
          wireCornerOrder="auto"
          recoveryLabel={null}
          zoomPercent={100}
          gridVisible={gridVisible}
          gridMajorVisible={gridMajorVisible}
          onToggleGrid={vi.fn()}
          selectionFilterSummary={null}
          onOpenSelectionFilter={vi.fn()}
          onToggleWireOptions={vi.fn()}
          onWireRoutingModeChange={vi.fn()}
          onWireCornerOrderChange={vi.fn()}
          onZoomOut={vi.fn()}
          onZoomIn={vi.fn()}
          onFitView={vi.fn()}
        />,
      );
      expect(markup).toContain('data-testid="statusbar-grid-toggle"');
      expect(markup).toContain(`data-grid-mode="${mode}"`);
      // Pressed can only say that some grid is painted; which one is in the
      // title and the mode attribute.
      expect(markup).toContain(`aria-pressed="${gridVisible}"`);
      // The label is the full-width form; half-width CSS hides it and the
      // accessible name stays "Grid".
      expect(markup).toContain(
        `<span class="statusbar-grid-label">${label}</span>`,
      );
      expect(markup).toContain('aria-label="Grid"');
      expect(markup).toContain(promise);
    },
  );

  function statusbarWithIssues(issues: {
    checkStatus?: import("../../app/project-check").ProjectCheckStatus;
    errorCount: number;
    warningCount: number;
    onOpen(): void;
  }) {
    return renderToStaticMarkup(
      <EditorStatusbar
        status="Ready"
        tool="pointer"
        vddRailMode={false}
        pendingSymbolId={null}
        wireOptionsOpen={false}
        wireRoutingMode="orthogonal"
        wireCornerOrder="auto"
        recoveryLabel={null}
        zoomPercent={100}
        gridVisible
        gridMajorVisible={false}
        onToggleGrid={vi.fn()}
        selectionFilterSummary={null}
        onOpenSelectionFilter={vi.fn()}
        issues={issues}
        onToggleWireOptions={vi.fn()}
        onWireRoutingModeChange={vi.fn()}
        onWireCornerOrderChange={vi.fn()}
        onZoomOut={vi.fn()}
        onZoomIn={vi.fn()}
        onFitView={vi.fn()}
      />,
    );
  }

  it("shows an error-severity issues badge with combined counts", () => {
    const markup = statusbarWithIssues({
      errorCount: 2,
      warningCount: 1,
      onOpen: vi.fn(),
    });
    expect(markup).toContain('data-testid="statusbar-issues"');
    expect(markup).toContain('data-severity="error"');
    expect(markup).toContain("2 errors, 1 warning");
    expect(markup).toContain("Action required");
  });

  it("shows a compact entry point only while selection is filtered", () => {
    const markup = renderToStaticMarkup(
      <EditorStatusbar
        status="Ready"
        tool="pointer"
        vddRailMode={false}
        pendingSymbolId={null}
        wireOptionsOpen={false}
        wireRoutingMode="orthogonal"
        wireCornerOrder="auto"
        recoveryLabel={null}
        zoomPercent={100}
        gridVisible
        gridMajorVisible={false}
        onToggleGrid={vi.fn()}
        selectionFilterSummary="Filter: Wires"
        onOpenSelectionFilter={vi.fn()}
        onToggleWireOptions={vi.fn()}
        onWireRoutingModeChange={vi.fn()}
        onWireCornerOrderChange={vi.fn()}
        onZoomOut={vi.fn()}
        onZoomIn={vi.fn()}
        onFitView={vi.fn()}
      />,
    );
    expect(markup).toContain('data-testid="selection-filter-status"');
    expect(markup).toContain("Filter: Wires");
  });

  it.each(["unchecked", "checking", "stale", "failed"] as const)(
    "does not present %s evidence as a current verdict",
    (checkStatus) => {
      const markup = statusbarWithIssues({
        checkStatus,
        errorCount: 2,
        warningCount: 3,
        onOpen: vi.fn(),
      });
      expect(markup).toContain('data-severity="none"');
      expect(markup).not.toContain("2 errors");
      expect(markup).not.toContain("No issues");
      expect(markup).toContain(`data-check-status="${checkStatus}"`);
    },
  );

  it("shows a warning-severity issues badge without errors", () => {
    const markup = statusbarWithIssues({
      errorCount: 0,
      warningCount: 3,
      onOpen: vi.fn(),
    });
    expect(markup).toContain('data-severity="warning"');
    expect(markup).toContain("3 warnings");
  });

  it("keeps a quiet zero-state badge as the discoverable entry point", () => {
    const markup = statusbarWithIssues({
      errorCount: 0,
      warningCount: 0,
      onOpen: vi.fn(),
    });
    expect(markup).toContain('data-testid="statusbar-issues"');
    expect(markup).toContain('data-severity="none"');
    expect(markup).toContain("No issues");
  });
});
