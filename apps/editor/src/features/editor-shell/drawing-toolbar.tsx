import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { EditorTool } from "../../interaction/interaction-state";
import { ToolIcon } from "./tool-icon";

interface ToolbarCommand {
  enabled: boolean;
  execute: () => void;
}

/** How close to the window edge a tooltip may come before it is pushed back. */
const TOOLTIP_EDGE_MARGIN = 8;

/**
 * Where a tooltip centred under its button has to sit to stay in the window.
 *
 * The buttons at either end of the toolbar are the problem: the tooltip for the
 * first one reaches past the left edge and the window clips whatever hangs over
 * — the text is not merely cropped, it is gone. Sliding the tooltip back inside
 * keeps it readable while it still points at its button. A tooltip wider than
 * the window cannot be placed at all, so it is centred, which shows as much of
 * it as there is room for.
 */
export function tooltipCenter(
  center: number,
  width: number,
  viewport: number,
): number {
  const half = width / 2;
  if (width + TOOLTIP_EDGE_MARGIN * 2 >= viewport) return viewport / 2;
  return Math.min(
    Math.max(center, TOOLTIP_EDGE_MARGIN + half),
    viewport - TOOLTIP_EDGE_MARGIN - half,
  );
}

interface TooltipAnchor {
  left: number;
  top: number;
}

function ToolbarTooltip({
  id,
  text,
  anchor,
}: {
  id: string;
  text: string;
  anchor: TooltipAnchor;
}) {
  const element = useRef<HTMLSpanElement>(null);
  const [left, setLeft] = useState(anchor.left);
  // Measured rather than estimated: the text is translated and the font is the
  // one the machine actually has. Laid out before the browser paints, so the
  // tooltip never appears at the edge first and then jumps.
  useLayoutEffect(() => {
    const node = element.current;
    if (node === null) return;
    setLeft(
      tooltipCenter(
        anchor.left,
        node.getBoundingClientRect().width,
        window.innerWidth,
      ),
    );
  }, [anchor.left, text]);
  return createPortal(
    <span
      ref={element}
      id={id}
      role="tooltip"
      className="instant-toolbar-tooltip"
      style={{ left, top: anchor.top }}
    >
      {text}
    </span>,
    document.body,
  );
}

export interface DrawingToolbarProps {
  leftPanelMode: "examples" | "library";
  libraryPanelOpen: boolean;
  projectPanel: "netlist" | "project-code" | null;
  leftPanelsDisabled?: boolean;
  tool: EditorTool;
  documentSettingsOpen: boolean;
  undo: ToolbarCommand;
  redo: ToolbarCommand;
  simulation?: { open: boolean; onToggle: () => void };
  onToggleExamples: () => void;
  onToggleLibrary: () => void;
  onToggleNetlist: () => void;
  onToggleProjectCode: () => void;
  onActivateTool: (tool: EditorTool) => void;
  onAddText: () => void;
  onOpenDocumentSettings: () => void;
}

function ImmediatePanelButton({
  testId,
  label,
  tooltip,
  pressed,
  controls,
  disabled,
  onClick,
  children,
}: {
  testId: string;
  label: string;
  tooltip: string;
  pressed: boolean;
  controls?: string;
  disabled?: boolean;
  onClick(): void;
  children: ReactNode;
}) {
  const tooltipId = useId();
  const [position, setPosition] = useState<TooltipAnchor | null>(null);
  const show = (target: HTMLElement): void => {
    const bounds = target.getBoundingClientRect();
    setPosition({
      left: bounds.left + bounds.width / 2,
      top: bounds.bottom + 6,
    });
  };
  return (
    <>
      <button
        type="button"
        className="draw-tool"
        aria-label={label}
        aria-describedby={position ? tooltipId : undefined}
        aria-pressed={pressed}
        aria-expanded={pressed}
        aria-controls={controls}
        data-testid={testId}
        disabled={disabled}
        onClick={onClick}
        onPointerEnter={(event) => show(event.currentTarget)}
        onPointerLeave={() => setPosition(null)}
        onFocus={(event) => show(event.currentTarget)}
        onBlur={() => setPosition(null)}
      >
        {children}
      </button>
      {position && typeof document !== "undefined" ? (
        <ToolbarTooltip id={tooltipId} text={tooltip} anchor={position} />
      ) : null}
    </>
  );
}

export function DrawingToolbar({
  leftPanelMode,
  libraryPanelOpen,
  projectPanel,
  leftPanelsDisabled = false,
  tool,
  documentSettingsOpen,
  undo,
  redo,
  onToggleExamples,
  onToggleLibrary,
  onToggleNetlist,
  onToggleProjectCode,
  onActivateTool,
  onAddText,
  onOpenDocumentSettings,
  simulation,
}: DrawingToolbarProps) {
  const examplesOpen = leftPanelMode === "examples" && libraryPanelOpen;
  const libraryOpen = leftPanelMode === "library" && libraryPanelOpen;

  return (
    <div
      className="toolbar-row draw-toolbar"
      aria-label="Drawing tools"
      data-testid="draw-toolbar"
    >
      <ImmediatePanelButton
        testId="examples-toggle"
        label="Circuit gallery"
        tooltip={
          examplesOpen ? "Hide the circuit gallery" : "Show the circuit gallery"
        }
        pressed={examplesOpen}
        controls="examples-panel"
        disabled={leftPanelsDisabled}
        onClick={onToggleExamples}
      >
        <ToolIcon name="examples" />
        <span>Gallery</span>
      </ImmediatePanelButton>
      <ImmediatePanelButton
        testId="library-toggle"
        label="Component library"
        tooltip={
          libraryPanelOpen ? "Hide component library" : "Show component library"
        }
        pressed={libraryOpen}
        controls="shapes-library-panel"
        disabled={leftPanelsDisabled}
        onClick={onToggleLibrary}
      >
        <ToolIcon name="library" />
        <span>Library</span>
      </ImmediatePanelButton>
      <span className="draw-toolbar-divider" aria-hidden="true" />
      <button
        type="button"
        className="draw-tool"
        data-testid="draw-tool-undo"
        title="Undo (Ctrl+Z)"
        onClick={undo.execute}
        disabled={!undo.enabled}
      >
        <ToolIcon name="undo" />
        <span>Undo</span>
      </button>
      <button
        type="button"
        className="draw-tool"
        data-testid="draw-tool-redo"
        title="Redo (Ctrl+Shift+Z)"
        onClick={redo.execute}
        disabled={!redo.enabled}
      >
        <ToolIcon name="redo" />
        <span>Redo</span>
      </button>
      <span className="draw-toolbar-divider" aria-hidden="true" />
      <button
        type="button"
        className="draw-tool"
        data-testid="draw-tool-wire"
        aria-pressed={tool === "wire"}
        title="Wire (W)"
        onClick={() => onActivateTool("wire")}
      >
        <ToolIcon name="wire" />
        <span>Wire</span>
      </button>
      <button
        type="button"
        className="draw-tool"
        data-testid="draw-tool-text"
        aria-label="Text"
        title="Text (T)"
        onClick={onAddText}
      >
        <ToolIcon name="text" />
        <span>Text</span>
      </button>
      <span className="toolbar-divider" aria-hidden="true" />
      <button
        type="button"
        className="draw-tool"
        data-testid="draw-tool-document-style"
        aria-pressed={documentSettingsOpen}
        title="Document settings"
        onClick={onOpenDocumentSettings}
      >
        <ToolIcon name="style" />
        <span>Style</span>
      </button>
      {simulation ? (
        <button
          type="button"
          className="draw-tool"
          data-testid="digital-simulation-toggle"
          aria-pressed={simulation.open}
          title="Digital Simulation"
          onClick={simulation.onToggle}
        >
          <ToolIcon name="simulation" />
          <span>Simulation</span>
        </button>
      ) : null}
      <span className="draw-toolbar-project-spacer" aria-hidden="true" />
      <span className="toolbar-divider" aria-hidden="true" />
      <ImmediatePanelButton
        testId="netlist-panel-toggle"
        label="Netlist"
        tooltip={projectPanel === "netlist" ? "Hide Netlist" : "Show Netlist"}
        pressed={projectPanel === "netlist"}
        onClick={onToggleNetlist}
      >
        <ToolIcon name="netlist" />
        <span>Netlist</span>
      </ImmediatePanelButton>
      <ImmediatePanelButton
        testId="project-code-toggle"
        label="Project Code"
        tooltip={
          projectPanel === "project-code"
            ? "Hide Project Code"
            : "Show Project Code"
        }
        pressed={projectPanel === "project-code"}
        onClick={onToggleProjectCode}
      >
        <ToolIcon name="project-code" />
        <span>Project Code</span>
      </ImmediatePanelButton>
    </div>
  );
}
