import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Where this copy of the program keeps the things it writes.
 *
 * Saved Projects, the window size and the crash-recovery copy all belong inside
 * the program's own folder: moving that folder moves the whole installation, and
 * using the program leaves nothing anywhere else on the machine. A copy that
 * runs from a place it cannot write to (Program Files without elevation, a
 * read-only share, a mounted image) has nowhere to put them and falls back to
 * the per-user AppData and Documents folders.
 */

/** Saved Projects, and the folder the first Save As dialog opens in. */
export const PROJECTS_FOLDER = "Projects";

/** Electron's `userData`: window size, preferences, crash-recovery copy. */
export const APP_DATA_FOLDER = "AppData";

export interface InstallProbe {
  /** `app.getPath("exe")`. */
  executablePath: string;
  /** `app.isPackaged`. */
  packaged: boolean;
  /** Where an unpackaged development run should keep its data. */
  developmentDirectory: string;
  /** Whether that directory exists or can be created, and accepts writes. */
  canWrite: (directory: string) => boolean;
}

/**
 * The folder this copy owns, or `null` when it cannot write there.
 *
 * Both Windows forms — installed, or extracted from the release zip — run from
 * the folder they were put in, so that folder is the installation.
 */
export function resolveInstallRoot(probe: InstallProbe): string | null {
  const root = probe.packaged
    ? dirname(probe.executablePath)
    : probe.developmentDirectory;
  return probe.canWrite(root) ? root : null;
}

/**
 * Prove a directory is usable by writing in it.
 *
 * Windows reports a read-only location through the failing call, not through
 * the file mode, so nothing short of an actual write answers the question.
 */
export function canWriteDirectory(directory: string): boolean {
  const probe = join(directory, ".write-probe");
  try {
    mkdirSync(directory, { recursive: true });
    writeFileSync(probe, "");
    return true;
  } catch {
    return false;
  } finally {
    try {
      rmSync(probe, { force: true });
    } catch {
      // Leaving an empty probe file behind is not worth failing a launch.
    }
  }
}
