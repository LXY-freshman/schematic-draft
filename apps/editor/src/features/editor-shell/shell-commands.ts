import { nativeFileDialogsAvailable } from "./project-files";

/**
 * The editor's side of the shell's own commands.
 *
 * Three facts about this installation live in the main process and nowhere
 * else: where Projects are kept, where settings and recovery copies are kept,
 * and whether Explorer opens a Project with this copy. They used to be shown
 * in a system menu bar that carried nothing else; the About section shows them
 * now, and asks for them over this bridge.
 *
 * In a plain browser none of it exists, so every call here answers null and
 * the surfaces that use it render nothing rather than an empty row.
 */

/** Whether Explorer opens a Project with this copy; see `AssociationState`. */
export type FileAssociationState = "on" | "off" | "unavailable";

export interface ShellInstallInfo {
  projectsDirectory: string;
  settingsDirectory: string;
  /** Whether moving this folder moves the whole installation. */
  selfContained: boolean;
  association: FileAssociationState;
}

const ENDPOINT = "/api/shell";

async function post(path: string, body?: unknown): Promise<unknown> {
  if (!nativeFileDialogsAvailable()) return null;
  const response = await fetch(`${ENDPOINT}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    throw new Error(`The shell answered ${response.status}`);
  }
  return response.json();
}

function association(value: unknown): FileAssociationState {
  return value === "on" || value === "off" ? value : "unavailable";
}

/** What this installation looks like on disk, or null outside the shell. */
export async function readShellInstallInfo(): Promise<ShellInstallInfo | null> {
  let payload: unknown;
  try {
    payload = await post("/info");
  } catch {
    // A shell that cannot answer is reported as no shell at all: these are
    // facts to display, and a half-filled About is worse than none.
    return null;
  }
  const body = payload as Partial<ShellInstallInfo> | null;
  if (
    typeof body?.projectsDirectory !== "string" ||
    typeof body.settingsDirectory !== "string"
  ) {
    return null;
  }
  return {
    projectsDirectory: body.projectsDirectory,
    settingsDirectory: body.settingsDirectory,
    selfContained: body.selfContained === true,
    association: association(body.association),
  };
}

/** Show the Projects folder in Explorer; false when it could not be opened. */
export async function openProjectsFolder(): Promise<boolean> {
  try {
    const body = (await post("/open-projects-folder")) as {
      status?: unknown;
    } | null;
    return body?.status === "opened";
  } catch {
    return false;
  }
}

/**
 * Claim or release the double-click association, answering the state it
 * actually reached — which is not always the state that was asked for, because
 * Windows can refuse a registry write.
 */
export async function setFileAssociation(
  enabled: boolean,
): Promise<FileAssociationState> {
  try {
    const body = (await post("/set-association", { enabled })) as {
      association?: unknown;
    } | null;
    return association(body?.association);
  } catch {
    return "unavailable";
  }
}
