import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

import {
  isMissingApplicationFile,
  isTemporaryModuleLoadFailure,
} from "./module-load-diagnosis";

export interface EditorErrorBoundaryProps {
  children: ReactNode;
}

interface EditorErrorBoundaryState {
  error: Error | null;
}

/**
 * Last-resort boundary around the whole editor: an exception thrown during
 * rendering shows a recovery screen instead of an unmounted blank page. The
 * screen keeps the user actionable — reload the editor, knowing that recent
 * committed work is kept in the browser recovery copies — while the error is
 * logged for diagnosis.
 */
export class EditorErrorBoundary extends Component<
  EditorErrorBoundaryProps,
  EditorErrorBoundaryState
> {
  override state: EditorErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): EditorErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(
      "Editor crashed during rendering:",
      error,
      info.componentStack,
    );
  }

  override render(): ReactNode {
    if (this.state.error !== null) {
      const missingFile = isMissingApplicationFile(this.state.error);
      const moduleLoadFailure = isTemporaryModuleLoadFailure(this.state.error);
      return (
        <EditorCrashScreen
          message={this.state.error.message}
          missingFile={missingFile}
          moduleLoadFailure={moduleLoadFailure}
          onReload={() => window.location.reload()}
        />
      );
    }
    return this.props.children;
  }
}

export interface EditorCrashScreenProps {
  message: string;
  onReload(): void;
  /**
   * The installation does not have a file the editor asked for, confirmed by
   * a probe rather than guessed. Reported in #493.
   */
  missingFile?: boolean;
  /** The named module was not missing, so do not mislabel it as damaged. */
  moduleLoadFailure?: boolean;
}

export function EditorCrashScreen({
  message,
  onReload,
  missingFile = false,
  moduleLoadFailure = false,
}: EditorCrashScreenProps) {
  const kind = missingFile ? "missing" : moduleLoadFailure ? "load" : "crash";
  return (
    <div
      className="editor-crash-screen"
      data-testid="editor-crash-screen"
      role="alert"
      aria-labelledby="editor-crash-title"
    >
      <div className="editor-crash-panel" data-kind={kind}>
        <h1 id="editor-crash-title">
          {missingFile
            ? "Part of the installation is missing"
            : moduleLoadFailure
              ? "The editor could not finish loading"
              : "The editor hit an unexpected problem"}
        </h1>
        <p>
          {missingFile
            ? "A file the editor needs is not in this installation, so part of it can no longer load. Reinstalling the application restores it. Your recent committed work is kept in the local recovery copies."
            : moduleLoadFailure
              ? "A required application file was temporarily unavailable. Try again; if the problem continues, reinstall the application. The local recovery copies are safe."
              : "Rendering stopped with an internal error. Your recent committed work is kept in the local recovery copies."}
        </p>
        <p>
          <code>{message}</code>
        </p>
        <div className="editor-crash-actions">
          <button type="button" onClick={onReload}>
            {moduleLoadFailure ? "Try again" : "Reload editor"}
          </button>
        </div>
        <p className="editor-crash-note">
          After reloading, use File / Recover Local Work… if your latest changes
          are missing.
        </p>
      </div>
    </div>
  );
}
