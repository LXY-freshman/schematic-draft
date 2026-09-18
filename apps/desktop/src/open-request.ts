import { isAbsolute, resolve } from "node:path";

/**
 * The Project file a launch was asked to open.
 *
 * Windows starts the program with the double-clicked file as an argument, and a
 * second double-click while it is already running delivers that argument list to
 * the running copy instead. Chromium's own switches travel in the same list, so
 * only a plain path to a file that exists is taken: a switch, a leftover token,
 * or a path that is not there leaves the editor on the Project it had.
 */
export function projectPathFromArgv(
  argv: readonly string[],
  context: {
    /** `app.isPackaged`. */
    packaged: boolean;
    /** The directory the launching shell was in. */
    workingDirectory: string;
    /** Whether the path names a file that exists. */
    isFile: (path: string) => boolean;
  },
): string | null {
  // argv[0] is the executable. An unpackaged run is `electron .`, where argv[1]
  // is the application directory rather than a file to open.
  for (const argument of argv.slice(context.packaged ? 1 : 2)) {
    const candidate = argument.trim();
    if (candidate.length === 0 || candidate.startsWith("-")) continue;
    const path = isAbsolute(candidate)
      ? candidate
      : resolve(context.workingDirectory, candidate);
    if (context.isFile(path)) return path;
  }
  return null;
}

/**
 * How the main process tells the editor a file is waiting.
 *
 * There is no preload bridge, so the renderer collects the path over the same
 * `/api/file` route it uses for every other read; this event only says "ask
 * again", which is what a double-click on an already-running copy needs. The
 * editor listens for the same name in
 * `apps/editor/src/features/editor-shell/project-files.ts`.
 */
export const PROJECT_OPEN_REQUEST_EVENT = "schematic-draft:open-request";
