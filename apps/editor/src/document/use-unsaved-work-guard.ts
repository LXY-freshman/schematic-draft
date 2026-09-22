import { useCallback, useEffect, useRef } from "react";

export interface BeforeUnloadTarget {
  addEventListener(
    type: "beforeunload",
    listener: (event: BeforeUnloadEvent) => void,
  ): void;
  removeEventListener(
    type: "beforeunload",
    listener: (event: BeforeUnloadEvent) => void,
  ): void;
}

/**
 * Install the browser-owned leave prompt. This deliberately does not save,
 * flush recovery, or manipulate history: those are separate lifecycle
 * responsibilities and unload is not a reliable asynchronous work boundary.
 *
 * This is the browser's guard only. Electron reads the same
 * `preventDefault()` as a silent refusal to close rather than a prompt, so in
 * the desktop shell the question is asked by the main process instead — see
 * `apps/desktop/src/close-guard.ts` and the bridge it reads,
 * `../features/editor-shell/shell-close-bridge.ts`.
 */
export interface InstalledUnsavedWorkGuard {
  /** Allow one application-controlled unload, then resume normal protection. */
  allowNextUnload(): void;
  dispose(): void;
}

export function installUnsavedWorkGuard(
  target: BeforeUnloadTarget,
): InstalledUnsavedWorkGuard {
  let allowNextUnload = false;
  const onBeforeUnload = (event: BeforeUnloadEvent): void => {
    if (allowNextUnload) {
      allowNextUnload = false;
      return;
    }
    event.preventDefault();
    // Legacy Chromium/Edge still consult this field. Browsers choose the
    // visible copy; the application never supplies custom prompt text.
    event.returnValue = true;
  };
  target.addEventListener("beforeunload", onBeforeUnload);
  return {
    allowNextUnload: () => {
      allowNextUnload = true;
    },
    dispose: () => target.removeEventListener("beforeunload", onBeforeUnload),
  };
}

/** Register the native browser prompt only while formal work is unsaved. */
export function useUnsavedWorkGuard(isDirty: boolean): () => void {
  const installedRef = useRef<InstalledUnsavedWorkGuard | null>(null);
  useEffect(() => {
    if (!isDirty || typeof window === "undefined") return;
    const installed = installUnsavedWorkGuard(window);
    installedRef.current = installed;
    return () => {
      installed.dispose();
      if (installedRef.current === installed) installedRef.current = null;
    };
  }, [isDirty]);
  return useCallback(() => installedRef.current?.allowNextUnload(), []);
}
