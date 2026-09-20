import { useRef, useState, type ReactNode, type RefObject } from "react";

export interface FileCommandMenuProps {
  /** The file currently open, shown so Save's target is never a guess. */
  openFilePath: string | null;
  canRevert: boolean;
  hasRecoverySessions: boolean;
  projectInputRef: RefObject<HTMLInputElement | null>;
  onNewProject: () => void;
  onOpenProject: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onRefresh: () => void;
  onImportProject: (file: File | null) => void;
  onImportSpice: (
    files: FileList | null,
    namingProfile?: "native" | "cadence-bang",
  ) => void;
  onExportSvg: () => void;
  onExportRaster: (format: "png" | "pdf") => void;
  onExportVisio: (kind: "drawing" | "stencil") => void;
  onRevert: () => void;
  onOpenRecovery: () => void;
}

function ExportSubmenu({
  title,
  open,
  onToggle,
  onClose,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <div
      className="export-submenu"
      onKeyDown={(event) => {
        if (open && event.key === "ArrowLeft") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
          trigger.current?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls="export-drawing-options"
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight" || event.key === "ArrowDown") {
            event.preventDefault();
            if (!open) onToggle();
            requestAnimationFrame(() =>
              trigger.current?.parentElement
                ?.querySelector<HTMLButtonElement>(
                  ".export-submenu-options button",
                )
                ?.focus(),
            );
          }
        }}
      >
        {title}
        <span aria-hidden="true">›</span>
      </button>
      <div
        className="export-submenu-options"
        id="export-drawing-options"
        role="group"
        aria-label={title}
        hidden={!open}
      >
        {children}
      </div>
    </div>
  );
}

export function FileCommandMenu({
  openFilePath,
  canRevert,
  hasRecoverySessions,
  projectInputRef,
  onNewProject,
  onOpenProject,
  onSave,
  onSaveAs,
  onRefresh,
  onImportProject,
  onImportSpice,
  onExportSvg,
  onExportRaster,
  onExportVisio,
  onRevert,
  onOpenRecovery,
}: FileCommandMenuProps) {
  const [drawingExportOpen, setDrawingExportOpen] = useState(false);
  return (
    <details
      className="command-menu"
      name="editor-command-menu"
      onToggle={(event) => {
        if (!event.currentTarget.open) setDrawingExportOpen(false);
      }}
    >
      <summary>File</summary>
      <div className="command-popover">
        <button type="button" onClick={onNewProject}>
          New Project
        </button>
        <button
          type="button"
          data-testid="open-project-file"
          onClick={onOpenProject}
        >
          Open Project…
        </button>
        <button
          type="button"
          data-testid="save-project-file"
          title={
            openFilePath === null
              ? "Choose where to save this Project"
              : `Save to ${openFilePath}`
          }
          onClick={onSave}
        >
          Save
        </button>
        <button
          type="button"
          data-testid="save-project-file-as"
          onClick={onSaveAs}
        >
          Save As…
        </button>
        {openFilePath === null ? null : (
          <span className="command-group-label" title={openFilePath}>
            {openFilePath}
          </span>
        )}
        <label className="file-import">
          Import Project File…
          <input
            ref={projectInputRef}
            data-testid="project-file"
            type="file"
            accept=".schdraft,.icproj,.json,.icproj.json,application/json"
            onChange={(event) =>
              onImportProject(event.currentTarget.files?.[0] ?? null)
            }
          />
        </label>
        <label className="file-import">
          Import SPICE / SCS…
          <input
            data-testid="spice-files"
            type="file"
            accept=".spi,.cir,.sp,.scs,.inc,.lib"
            multiple
            onChange={(event) => onImportSpice(event.currentTarget.files)}
          />
        </label>
        <label className="file-import">
          Import Cadence SPICE (`!` globals)…
          <input
            data-testid="cadence-spice-files"
            type="file"
            accept=".spi,.cir,.sp,.scs,.inc,.lib"
            multiple
            onChange={(event) =>
              onImportSpice(event.currentTarget.files, "cadence-bang")
            }
          />
        </label>
        <div>
          <ExportSubmenu
            title="Export drawing"
            open={drawingExportOpen}
            onToggle={() => setDrawingExportOpen(!drawingExportOpen)}
            onClose={() => setDrawingExportOpen(false)}
          >
            <button type="button" aria-label="Export SVG" onClick={onExportSvg}>
              SVG
            </button>
            <button
              type="button"
              aria-label="Export PNG"
              onClick={() => onExportRaster("png")}
            >
              PNG
            </button>
            <button
              type="button"
              aria-label="Export PDF"
              onClick={() => onExportRaster("pdf")}
            >
              PDF
            </button>
            <button
              type="button"
              aria-label="Export Visio"
              onClick={() => onExportVisio("drawing")}
            >
              Visio
            </button>
            <button
              type="button"
              aria-label="Export Visio stencil"
              onClick={() => onExportVisio("stencil")}
            >
              Visio stencil
            </button>
          </ExportSubmenu>
        </div>
        <button type="button" onClick={onRefresh}>
          Refresh app
        </button>
        <button type="button" onClick={onRevert} disabled={!canRevert}>
          Revert to Last Saved
        </button>
        {hasRecoverySessions ? (
          <button type="button" onClick={onOpenRecovery}>
            Recover Local Work…
          </button>
        ) : null}
      </div>
    </details>
  );
}
