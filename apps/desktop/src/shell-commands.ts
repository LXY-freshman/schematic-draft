/**
 * The shell's own commands, for the editor's menus.
 *
 * This application used to carry two menus: a system menu bar with three
 * entries, and the toolbar menu with every actual command in it. The menu bar
 * is gone, so the three things only the main process knows — where Projects
 * live, where settings and recovery copies live, and whether Explorer opens a
 * Project with this copy — reach the editor over the same kind of bridge the
 * file dialogs already use.
 *
 * Like `project-files.ts`, this is a pure request/response function: the
 * Electron calls behind it are injected, so the routes are testable without a
 * running shell.
 */

/**
 * Whether Explorer opens a Project with this copy.
 *
 * `unavailable` is not a third state of the association; it says the question
 * does not apply — a development run, or a platform with no per-user registry
 * to write to. The editor hides the control rather than showing it switched
 * off, because off is a choice and this is not one.
 */
export type AssociationState = "on" | "off" | "unavailable";

export interface ShellCommandPorts {
  /** Where a first save is offered, and what the folder command opens. */
  projectsDirectory(): string;
  /** Where window state, preferences and recovery copies are kept. */
  settingsDirectory(): string;
  /**
   * Whether everything this copy writes is inside its own folder, so that
   * moving the folder moves the installation. False when the folder turned out
   * to be read-only and the per-user locations are standing in for it.
   */
  selfContained(): boolean;
  associationState(): Promise<AssociationState>;
  /** Apply or withdraw it, answering the state actually reached. */
  setAssociation(enabled: boolean): Promise<AssociationState>;
  /** Show a folder to the person. A non-empty answer is the failure. */
  openFolder(path: string): Promise<string>;
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

/**
 * Answers `/api/shell/*`; returns null for anything else, and for a path this
 * shell does not serve, so the protocol handler answers as it does for any
 * route that is not there.
 */
export async function handleShellApi(
  request: Request,
  pathname: string,
  ports: ShellCommandPorts,
): Promise<Response | null> {
  if (!pathname.startsWith("/api/shell/")) return null;
  if (request.method !== "POST")
    return json({ error: "method-not-allowed" }, 405);

  if (pathname === "/api/shell/info") {
    return json({
      projectsDirectory: ports.projectsDirectory(),
      settingsDirectory: ports.settingsDirectory(),
      selfContained: ports.selfContained(),
      association: await ports.associationState(),
    });
  }

  if (pathname === "/api/shell/open-projects-folder") {
    const directory = ports.projectsDirectory();
    let failure: string;
    try {
      failure = await ports.openFolder(directory);
    } catch (error) {
      failure = error instanceof Error ? error.message : "the folder";
    }
    return failure === ""
      ? json({ status: "opened", path: directory })
      : json({ status: "failed", message: failure });
  }

  if (pathname === "/api/shell/set-association") {
    const body = (await request.json().catch(() => null)) as {
      enabled?: unknown;
    } | null;
    if (typeof body?.enabled !== "boolean") {
      return json({ error: "invalid-fields" }, 400);
    }
    // The answer is the state Windows actually ended in, which is not always
    // the state that was asked for: the editor shows what is true, not what
    // was requested.
    return json({
      status: "ok",
      association: await ports.setAssociation(body.enabled),
    });
  }

  return null;
}
