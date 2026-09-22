import type { CircuitProject } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";

/**
 * The editor's side of the desktop file bridge.
 *
 * The renderer cannot touch the filesystem, so opening and saving a circuit
 * is a request to the shell's main process: it runs the native dialogs and
 * moves the bytes. A Project that came from a file carries its path, and
 * saving writes that path back in place — only a first save and Save As open
 * a dialog.
 */

export interface ProjectFileBinding {
  /** Absolute path on this computer. */
  path: string;
  /** The file's base name, which the editor shows as the Project name. */
  name: string;
}

export interface OpenedProjectFile extends ProjectFileBinding {
  text: string;
}

export type ProjectFileOpenOutcome =
  | { status: "opened"; file: OpenedProjectFile }
  | { status: "cancelled" }
  | { status: "failed"; message: string };

export type ProjectFileSaveOutcome =
  | { status: "saved"; file: ProjectFileBinding }
  | { status: "cancelled" }
  | { status: "failed"; message: string };

const ENDPOINT = "/api/file";

declare global {
  interface Window {
    __ICM_TEST_FILE_BRIDGE__?: boolean;
  }
}

/**
 * Whether a shell is there to answer the bridge at all.
 *
 * The shell serves the editor over `app://`, and nothing else can register
 * that scheme; every other way of running the editor — the dev server, the
 * preview server, a browser test — is plain http, where `/api/file/*` is a
 * static path that does not exist. Asking anyway costs a 404 the browser logs
 * as a console error, which is why this is checked before a request the editor
 * makes on its own rather than at the user's word.
 *
 * Browser tests that stand a fake main process in front of the bridge say so
 * with `__ICM_TEST_FILE_BRIDGE__`. Like the crash hooks, the flag is read only
 * under `import.meta.env.DEV`, so a production build eliminates the check and
 * the escape hatch cannot be taken in a shipped editor.
 */
function fileBridgeIsPresent(): boolean {
  if (typeof window === "undefined") return false;
  if (window.location.protocol === "app:") return true;
  return import.meta.env.DEV && window.__ICM_TEST_FILE_BRIDGE__ === true;
}

async function post(path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`${ENDPOINT}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    throw new Error(`The file bridge answered ${response.status}`);
  }
  return response.json();
}

function openOutcome(payload: unknown): ProjectFileOpenOutcome {
  const body = payload as Partial<ProjectFileOpenOutcome> & {
    file?: Partial<OpenedProjectFile>;
  };
  if (body.status === "cancelled") return { status: "cancelled" };
  if (
    body.status === "opened" &&
    typeof body.file?.path === "string" &&
    typeof body.file.name === "string" &&
    typeof body.file.text === "string"
  ) {
    return {
      status: "opened",
      file: {
        path: body.file.path,
        name: body.file.name,
        text: body.file.text,
      },
    };
  }
  return {
    status: "failed",
    message:
      typeof (body as { message?: unknown }).message === "string"
        ? (body as { message: string }).message
        : "The file could not be read",
  };
}

function failure(
  error: unknown,
  fallback: string,
): { status: "failed"; message: string } {
  return {
    status: "failed",
    message: error instanceof Error ? error.message : fallback,
  };
}

/** Ask for a Project file and read it. */
export async function openProjectFileFromDisk(): Promise<ProjectFileOpenOutcome> {
  try {
    return openOutcome(await post("/open"));
  } catch (error) {
    return failure(error, "The open dialog is unavailable");
  }
}

/** Re-read a path the editor already knows, with no dialog. */
export async function readProjectFileAt(
  path: string,
): Promise<ProjectFileOpenOutcome> {
  try {
    return openOutcome(await post("/read", { path }));
  } catch (error) {
    return failure(error, "The file could not be read");
  }
}

/**
 * The DOM event the shell's main process dispatches when a file arrives while
 * the editor is already running — a second double-click. It carries nothing;
 * the path is collected over the bridge like any other read. The name matches
 * `PROJECT_OPEN_REQUEST_EVENT` in `apps/desktop/src/open-request.ts`.
 */
export const PROJECT_OPEN_REQUEST_EVENT = "schematic-draft:open-request";

/**
 * The file the shell was asked to open — a double-click in Explorer, or a path
 * on the command line — taken once, so a later re-check does not reopen it.
 *
 * Null in a plain browser, where nothing can hand the editor a file. This is
 * the one bridge call the editor makes unprompted, on every load, so with no
 * shell it is not made at all: the answer is already known, and asking would
 * only leave a 404 in the console of a build that is otherwise clean.
 */
export async function takeRequestedProjectPath(): Promise<string | null> {
  if (!fileBridgeIsPresent()) return null;
  try {
    const body = (await post("/pending")) as {
      status?: unknown;
      path?: unknown;
    } | null;
    return body?.status === "requested" && typeof body.path === "string"
      ? body.path
      : null;
  } catch {
    return null;
  }
}

/**
 * Write arbitrary Project text to a file the person picks — a recovery copy
 * or a backup, neither of which should rebind the Project being edited.
 */
export async function saveTextAsFile(
  text: string,
  suggestedName: string,
): Promise<ProjectFileSaveOutcome> {
  try {
    return saveOutcome(
      await post("/save", { path: null, name: suggestedName, text }),
    );
  } catch (error) {
    return failure(error, "The save dialog is unavailable");
  }
}

function saveOutcome(payload: unknown): ProjectFileSaveOutcome {
  const body = payload as Partial<ProjectFileSaveOutcome> & {
    file?: Partial<ProjectFileBinding>;
  };
  if (body.status === "cancelled") return { status: "cancelled" };
  if (
    body.status === "saved" &&
    typeof body.file?.path === "string" &&
    typeof body.file.name === "string"
  ) {
    return {
      status: "saved",
      file: { path: body.file.path, name: body.file.name },
    };
  }
  return {
    status: "failed",
    message:
      typeof (body as { message?: unknown }).message === "string"
        ? (body as { message: string }).message
        : "The file could not be written",
  };
}

/**
 * Write a Project. With a `binding` and no `saveAs`, this overwrites that
 * file silently; otherwise the shell asks where to put it.
 */
export async function writeProjectFile(
  project: CircuitProject,
  binding: ProjectFileBinding | null,
  options: { saveAs?: boolean } = {},
): Promise<ProjectFileSaveOutcome> {
  let text: string;
  try {
    text = serializeProject(project);
  } catch (error) {
    return failure(error, "The Project could not be serialized");
  }
  try {
    return saveOutcome(
      await post("/save", {
        path: binding?.path ?? null,
        name: project.name,
        text,
        ...(options.saveAs === true ? { saveAs: true } : {}),
      }),
    );
  } catch (error) {
    return failure(error, "The save dialog is unavailable");
  }
}
