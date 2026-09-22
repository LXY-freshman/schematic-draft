/**
 * The unsaved-work guard the window close runs through.
 *
 * The editor's own `beforeunload` guard is a browser mechanism: Chromium shows
 * a leave prompt there, but Electron treats the same `preventDefault()` as a
 * silent refusal, so in the shell a dirty window simply ignored the close. The
 * decision therefore belongs to the main process, and it lives here as a pure
 * function over four ports so every branch can be tested without a window.
 */

/** What the editor says about the Project in the window right now. */
export interface UnsavedWorkState {
  dirty: boolean;
  /** The Project name, as shown in the title field. */
  name: string;
  /** The file Save would overwrite, or null when nothing is bound yet. */
  path: string | null;
}

export type CloseAnswer = "save" | "discard" | "cancel";

export interface SaveAttempt {
  status: "saved" | "cancelled" | "failed";
  /** Why nothing was written; only read for a failure. */
  message?: string;
}

export interface CloseGuardPorts {
  /**
   * Ask the editor whether it holds unsaved work. Null means the question
   * could not be answered — see `decideClose`.
   */
  readState(): Promise<UnsavedWorkState | null>;
  ask(state: UnsavedWorkState): Promise<CloseAnswer>;
  save(): Promise<SaveAttempt>;
  reportFailure(message: string): Promise<void>;
}

/**
 * Whether this close may proceed.
 *
 * An unanswerable or failing `readState` closes the window. A guard that
 * cannot read the editor must not be able to trap a person in a window that
 * refuses to shut; the recovery copy is the backstop for that case, and the
 * editor answers this question in a single synchronous call, so a silent
 * refusal here would almost always mean the renderer is already gone.
 */
export async function decideClose(
  ports: CloseGuardPorts,
): Promise<"close" | "stay"> {
  const state = await ports.readState().catch(() => null);
  if (state === null || !state.dirty) return "close";

  // The work is known to be unsaved, so a broken prompt keeps the window:
  // staying is recoverable, closing is not.
  const answer = await ports.ask(state).catch((): CloseAnswer => "cancel");
  if (answer === "cancel") return "stay";
  if (answer === "discard") return "close";

  const attempt = await ports.save().catch((error: unknown): SaveAttempt => ({
    status: "failed",
    message: error instanceof Error ? error.message : "Save failed",
  }));
  if (attempt.status === "saved") return "close";
  // A cancelled Save As is a change of mind about closing, not about saving.
  if (attempt.status === "failed") {
    await ports.reportFailure(attempt.message ?? "Save failed");
  }
  return "stay";
}

/**
 * The three answers, in the order Windows shows them. Save leads because it is
 * the one that loses nothing; Cancel is last so Escape and the title bar's X
 * both land on it.
 */
export const CLOSE_BUTTONS = ["Save", "Don't Save", "Cancel"] as const;

export const CLOSE_DEFAULT_BUTTON = 0;
export const CLOSE_CANCEL_BUTTON = 2;

/** Read the button a person pressed. Anything unexpected keeps the window. */
export function closeAnswerFromButton(index: number): CloseAnswer {
  if (index === 0) return "save";
  if (index === 1) return "discard";
  return "cancel";
}

/**
 * What the prompt says. The wording matches the in-editor replace guard
 * (`apps/editor/src/components/replace-guard-dialog.tsx`), because both
 * dialogs are answering the same question about the same Save command.
 */
export function closePrompt(state: UnsavedWorkState): {
  message: string;
  detail: string;
} {
  return {
    message: `Save changes to ${state.name}?`,
    detail: [
      state.path === null
        ? "Save writes a new .icproj.json file — it asks where to put it."
        : `Save writes ${state.path}.`,
      "Don't Save closes the window and drops every change made since the",
      "last save.",
    ].join("\n"),
  };
}

/** What the window says when the save it was asked for did not happen. */
export function saveFailureNotice(message: string): {
  message: string;
  detail: string;
} {
  return {
    message: "The Project was not saved, so the window stayed open.",
    detail: [
      message,
      "",
      "Your work is still in the editor. Save it somewhere else from the",
      "File menu, or close again and choose Don't Save to discard it.",
    ].join("\n"),
  };
}

/**
 * The global the editor answers on. As with `PROJECT_OPEN_REQUEST_EVENT`,
 * there is no module shared between the two halves, so each side declares its
 * own copy; the editor's is in
 * `apps/editor/src/features/editor-shell/shell-close-bridge.ts`.
 */
export const SHELL_CLOSE_BRIDGE_KEY = "__schematicDraftShell";

/** Reads the editor's answer, or null when nothing is listening. */
export const READ_UNSAVED_WORK_SCRIPT = `(() => {
  const bridge = window.${SHELL_CLOSE_BRIDGE_KEY};
  return bridge ? bridge.unsavedWork() : null;
})()`;

/** Runs the editor's own Save, dialogs and all, and resolves with its result. */
export const REQUEST_SAVE_SCRIPT = `(() => {
  const bridge = window.${SHELL_CLOSE_BRIDGE_KEY};
  return bridge
    ? bridge.save()
    : { status: "failed", message: "The editor stopped answering." };
})()`;

/**
 * Both values arrive as whatever the page returned, so they are read
 * defensively: a malformed answer about unsaved work is no answer at all.
 */
export function unsavedWorkState(raw: unknown): UnsavedWorkState | null {
  if (raw === null || typeof raw !== "object") return null;
  const value = raw as Partial<UnsavedWorkState>;
  if (typeof value.dirty !== "boolean") return null;
  const name =
    typeof value.name === "string" && value.name.trim().length > 0
      ? value.name
      : "this Project";
  return {
    dirty: value.dirty,
    name,
    path: typeof value.path === "string" ? value.path : null,
  };
}

export function saveAttempt(raw: unknown): SaveAttempt {
  const value = (raw ?? null) as Partial<SaveAttempt> | null;
  if (value?.status === "saved" || value?.status === "cancelled") {
    return { status: value.status };
  }
  return {
    status: "failed",
    message:
      typeof value?.message === "string" && value.message.length > 0
        ? value.message
        : "Save failed",
  };
}
