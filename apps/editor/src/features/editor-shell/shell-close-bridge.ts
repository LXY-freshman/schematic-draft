import { useEffect, useRef } from "react";

/**
 * The editor's answer to the shell's close guard.
 *
 * There is no preload bridge, so the main process reads this the same way it
 * announces a double-clicked file: `webContents.executeJavaScript`. The
 * surface is deliberately two calls wide — whether there is work to lose, and
 * the Save the person asked for — because everything else about closing is the
 * shell's decision, not the editor's. See `apps/desktop/src/close-guard.ts`.
 */

export interface ShellUnsavedWork {
  dirty: boolean;
  /** The Project name, for "Save changes to …?". */
  name: string;
  /** The file Save would overwrite, or null before a first save. */
  path: string | null;
}

export interface ShellSaveResult {
  status: "saved" | "cancelled" | "failed";
  message?: string;
}

export interface ShellCloseBridge {
  unsavedWork(): ShellUnsavedWork;
  save(): Promise<ShellSaveResult>;
}

declare global {
  interface Window {
    __schematicDraftShell?: ShellCloseBridge;
  }
}

export const SHELL_CLOSE_BRIDGE_KEY = "__schematicDraftShell";

export function installShellCloseBridge(
  target: Window,
  bridge: ShellCloseBridge,
): () => void {
  target[SHELL_CLOSE_BRIDGE_KEY] = bridge;
  return () => {
    if (target[SHELL_CLOSE_BRIDGE_KEY] === bridge) {
      delete target[SHELL_CLOSE_BRIDGE_KEY];
    }
  };
}

/**
 * Publish the bridge for as long as the editor is mounted. The installed
 * object is stable and reads the current render's callbacks, so the shell
 * never holds a stale view of the Project.
 */
export function useShellCloseBridge(bridge: ShellCloseBridge): void {
  const latest = useRef(bridge);
  latest.current = bridge;
  useEffect(() => {
    if (typeof window === "undefined") return;
    return installShellCloseBridge(window, {
      unsavedWork: () => latest.current.unsavedWork(),
      save: () => latest.current.save(),
    });
  }, []);
}
