import type { WireCornerOrder, WireRoutingMode } from "@icm/edit-engine";

import type { EditorTool } from "../../interaction/interaction-state";
import { ToolIcon } from "./tool-icon";

function toolLabel(
  tool: EditorTool,
  vddRailMode: boolean,
  pendingSymbolId: string | null,
): string {
  if (vddRailMode) return "Drawing Power Rail";
  if (pendingSymbolId) return `Placing ${pendingSymbolId}`;
  if (tool === "pointer") return "Select";
  if (tool === "construction-line") return "Line";
  return tool.charAt(0).toUpperCase() + tool.slice(1);
}

/**
 * The background grid is one button with three states, so each of them has to
 * say what it is and what the next click does.
 */
function gridMode(visible: boolean, major: boolean): "off" | "fine" | "coarse" {
  if (!visible) return "off";
  return major ? "coarse" : "fine";
}

function gridToggleLabel(visible: boolean, major: boolean): string {
  const mode = gridMode(visible, major);
  if (mode === "off") return "Grid Off";
  return mode === "coarse" ? "Grid On · Coarse" : "Grid On";
}

function gridToggleTitle(visible: boolean, major: boolean): string {
  const mode = gridMode(visible, major);
  if (mode === "off") return "Grid Off — click to show the background grid";
  if (mode === "fine")
    return "Grid On — click to mark every 7th dot as a coarse one";
  return "Grid On · Coarse — every 7th dot is a coarse one; click to hide the background grid";
}

function issuesBadge(issues: {
  errorCount: number;
  warningCount: number;
  checkStatus?: import("../../app/project-check").ProjectCheckStatus;
}): {
  severity: "error" | "warning" | "none";
  label: string;
  title: string;
} {
  if (issues.checkStatus && issues.checkStatus !== "current") {
    return {
      severity: "none",
      label:
        issues.checkStatus === "stale"
          ? "Check out of date"
          : issues.checkStatus === "failed"
            ? "Check failed"
            : issues.checkStatus === "checking"
              ? "Checking…"
              : "Not checked",
      title: "Open Issues — use Check and Save to check",
    };
  }
  const plural = (count: number, noun: string) =>
    `${count} ${noun}${count === 1 ? "" : "s"}`;
  if (issues.errorCount > 0) {
    return {
      severity: "error",
      label:
        issues.warningCount > 0
          ? `${plural(issues.errorCount, "error")}, ${plural(issues.warningCount, "warning")}`
          : plural(issues.errorCount, "error"),
      title: "Action required — open the issues list",
    };
  }
  if (issues.warningCount > 0) {
    return {
      severity: "warning",
      label: plural(issues.warningCount, "warning"),
      title: "Review findings — open the issues list",
    };
  }
  return {
    severity: "none",
    label: "No issues found",
    title: "Open the issues list",
  };
}

export function EditorStatusbar({
  status,
  tool,
  vddRailMode,
  pendingSymbolId,
  wireOptionsOpen,
  wireRoutingMode,
  wireCornerOrder,
  recoveryLabel,
  zoomPercent,
  gridVisible,
  gridMajorVisible,
  issues,
  selectionFilterSummary,
  onOpenSelectionFilter,
  onToggleWireOptions,
  onWireRoutingModeChange,
  onWireCornerOrderChange,
  onToggleGrid,
  onZoomOut,
  onZoomIn,
  onFitView,
}: {
  status: string;
  tool: EditorTool;
  vddRailMode: boolean;
  pendingSymbolId: string | null;
  wireOptionsOpen: boolean;
  wireRoutingMode: WireRoutingMode;
  wireCornerOrder: WireCornerOrder;
  recoveryLabel: string | null;
  zoomPercent: number;
  /** Whether the canvas paints its background grid dots. */
  gridVisible: boolean;
  /** Whether the visible grid also carries its coarse dots. */
  gridMajorVisible: boolean;
  selectionFilterSummary: string | null;
  issues?: {
    errorCount: number;
    warningCount: number;
    checkStatus?: import("../../app/project-check").ProjectCheckStatus;
    onOpen: () => void;
  };
  onToggleWireOptions: () => void;
  onWireRoutingModeChange: (mode: WireRoutingMode) => void;
  onWireCornerOrderChange: (order: WireCornerOrder) => void;
  onToggleGrid: () => void;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onFitView: () => void;
  onOpenSelectionFilter: () => void;
}) {
  return (
    <footer className="app-statusbar">
      <div className="statusbar-left">
        <p className="editor-status" data-testid="status" aria-live="polite">
          {status}
        </p>
        <span className="statusbar-tool" data-testid="statusbar-tool">
          {toolLabel(tool, vddRailMode, pendingSymbolId)}
        </span>
        {selectionFilterSummary ? (
          <button
            type="button"
            className="statusbar-tool"
            data-testid="selection-filter-status"
            onClick={onOpenSelectionFilter}
            title="Open Selection Filter (Ctrl+F)"
          >
            {selectionFilterSummary}
          </button>
        ) : null}
        {tool === "wire" ? (
          <button
            type="button"
            className="statusbar-tool"
            onClick={onToggleWireOptions}
            aria-expanded={wireOptionsOpen}
          >
            {wireRoutingMode === "orthogonal" ? "Orthogonal" : "45°"} · F3
          </button>
        ) : null}
        {tool === "wire" && wireOptionsOpen ? (
          <span className="wire-options" data-testid="wire-options">
            <label>
              Route
              <select
                value={wireRoutingMode}
                onChange={(event) =>
                  onWireRoutingModeChange(
                    event.currentTarget.value as WireRoutingMode,
                  )
                }
              >
                <option value="orthogonal">Orthogonal</option>
                <option value="octilinear">45° octilinear</option>
                <option value="free">Any angle</option>
              </select>
            </label>
            <label>
              Corner
              <select
                value={wireCornerOrder}
                onChange={(event) =>
                  onWireCornerOrderChange(
                    event.currentTarget.value as WireCornerOrder,
                  )
                }
              >
                <option value="auto">Auto</option>
                <option value="horizontal-first">Horizontal first</option>
                <option value="vertical-first">Vertical first</option>
                <option value="diagonal-first">Diagonal first</option>
                <option value="orthogonal-first">Orthogonal first</option>
              </select>
            </label>
          </span>
        ) : null}
        {recoveryLabel ? (
          <output
            className="statusbar-recovery"
            data-testid="recovery-state"
            aria-label="Browser recovery state"
          >
            {recoveryLabel}
          </output>
        ) : null}
        {issues
          ? (() => {
              const badge = issuesBadge(issues);
              return (
                <button
                  type="button"
                  className="statusbar-issues"
                  data-testid="statusbar-issues"
                  data-check-status={issues.checkStatus ?? "current"}
                  data-severity={badge.severity}
                  title={badge.title}
                  aria-label={`${badge.label}. ${badge.title}`}
                  onClick={issues.onOpen}
                >
                  {badge.label}
                </button>
              );
            })()
          : null}
      </div>
      <div className="statusbar-view-controls">
        {/* One click away, unlike the canvas.showGrid setting. The label
            collapses to the icon in half-width windows. Three states cycle
            through one button: off, fine dots, fine dots under coarse ones.
            `aria-pressed` can only say whether a grid is painted, so which
            grid is named in the title and in `data-grid-mode`. */}
        <button
          type="button"
          className="statusbar-grid-toggle"
          data-testid="statusbar-grid-toggle"
          data-grid-mode={gridMode(gridVisible, gridMajorVisible)}
          aria-label="Grid"
          aria-pressed={gridVisible}
          title={gridToggleTitle(gridVisible, gridMajorVisible)}
          onClick={onToggleGrid}
        >
          <ToolIcon name="grid" />
          <span className="statusbar-grid-label">
            {gridToggleLabel(gridVisible, gridMajorVisible)}
          </span>
        </button>
        <div className="canvas-controls" aria-label="Canvas view controls">
          <button
            type="button"
            aria-label="Zoom out"
            title="Zoom out"
            onClick={onZoomOut}
          >
            <ToolIcon name="zoom-out" />
          </button>
          <output aria-label="Current zoom">{zoomPercent}%</output>
          <button
            type="button"
            aria-label="Zoom in"
            title="Zoom in"
            onClick={onZoomIn}
          >
            <ToolIcon name="zoom-in" />
          </button>
          <button
            type="button"
            aria-label="Fit view"
            title="Fit view (Home)"
            onClick={onFitView}
          >
            <ToolIcon name="fit" />
          </button>
        </div>
      </div>
    </footer>
  );
}
