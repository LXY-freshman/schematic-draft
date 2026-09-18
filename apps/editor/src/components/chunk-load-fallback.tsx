import type { ComponentType } from "react";

import { REFRESH_RESTORE_STORAGE_KEY } from "../document/use-project-file-lifecycle";

export interface ChunkLoadFallbackProps {
  onClose?: () => void;
  onCancel?: () => void;
}

export function refreshWithRestore(): void {
  try {
    // The recovery coordinator flushes on pagehide, so the snapshot survives
    // this reload; the flag lets the refreshed page restore it automatically.
    window.sessionStorage.setItem(REFRESH_RESTORE_STORAGE_KEY, "true");
  } catch {
    // Without sessionStorage the reload still recovers via the manual banner.
  }
  window.location.reload();
}

/**
 * Stands in for a lazily loaded dialog or panel whose chunk failed to load.
 * The desktop shell serves every chunk from its own installation, so this
 * means a damaged or incomplete install rather than a missing server file.
 * The failure must stay scoped to the dialog: the schematic keeps running,
 * and the remedy is a refresh that restores the current work, not the
 * whole-editor crash screen.
 */
export function createChunkLoadFallback(
  variant: "dialog" | "inline",
  error: unknown,
): ComponentType<ChunkLoadFallbackProps> {
  const detail = error instanceof Error ? error.message : String(error);
  if (variant === "inline") {
    return function ChunkLoadFallbackSection() {
      return (
        <section
          className="chunk-load-fallback-inline"
          role="alert"
          data-testid="section-chunk-load-fallback"
        >
          <p>
            This panel could not be loaded — part of the installation is missing
            or damaged. Refresh to load it again; your current circuit is
            restored automatically.
          </p>
          <button type="button" onClick={refreshWithRestore}>
            Refresh app
          </button>
        </section>
      );
    };
  }
  return function ChunkLoadFallbackDialog({
    onClose,
    onCancel,
  }: ChunkLoadFallbackProps) {
    const close = onClose ?? onCancel;
    return (
      <div
        className="insert-dialog-backdrop"
        role="presentation"
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) close?.();
        }}
      >
        <section
          className="editor-action-dialog"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="chunk-load-fallback-title"
          data-testid="dialog-chunk-load-fallback"
        >
          <header className="editor-action-dialog-header">
            <p>Dialog unavailable</p>
            <h2 id="chunk-load-fallback-title">
              This dialog could not be loaded
            </h2>
          </header>
          <div className="editor-action-dialog-body">
            <p>
              Part of the installation is missing or damaged. Your circuit is
              unaffected. Refresh to load this dialog again — your current work
              is restored automatically. If it keeps failing, reinstall the
              application.
            </p>
            <p>
              <code>{detail}</code>
            </p>
          </div>
          <footer className="editor-action-dialog-actions">
            {close ? (
              <button type="button" onClick={() => close()}>
                Close
              </button>
            ) : null}
            <button
              type="button"
              className="primary"
              onClick={refreshWithRestore}
            >
              Refresh app
            </button>
          </footer>
        </section>
      </div>
    );
  };
}

/**
 * Dismissible banner for a failed on-demand chunk outside any dialog — an
 * export command whose module would not load. Same remedy as every chunk
 * failure: refresh, with the current circuit restored.
 */
export function ChunkLoadBanner({
  feature,
  onDismiss,
}: {
  feature: string;
  onDismiss: () => void;
}) {
  return (
    <aside
      className="recovery-banner recovery-banner-warning"
      data-testid="chunk-load-banner"
      role="alert"
      aria-label="Feature failed to load"
    >
      <p>
        {feature} could not load — part of the installation is missing or
        damaged. Refresh to load it again; your current circuit is restored
        automatically.
      </p>
      <div>
        <button type="button" onClick={refreshWithRestore}>
          Refresh app
        </button>
        <button type="button" onClick={onDismiss}>
          Not now
        </button>
      </div>
    </aside>
  );
}
