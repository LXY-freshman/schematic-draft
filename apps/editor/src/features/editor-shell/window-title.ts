import { PRODUCT_NAME } from "../../product";

/**
 * What the window caption says while a Project is open.
 *
 * A desktop window is expected to name the document it holds; only an
 * application with nothing open is titled after itself. The shell used to pin
 * the caption to the product name, so a user with several windows could not
 * tell them apart, and the one place that already showed unsaved work — the
 * dot beside the Project name in the toolbar — is small and easy to miss.
 *
 * The caption is the same fact rendered where Windows puts it: the taskbar,
 * Alt-Tab, and the window list all read this string.
 */

export interface WindowTitleFacts {
  /** Absolute path of the bound file, or null when nothing is bound. */
  filePath: string | null;
  /** The editable Project name, used when no file is bound yet. */
  projectName: string;
  /** Whether there is work the file on disk does not have. */
  dirty: boolean;
}

/**
 * The bound file's own name, extension included.
 *
 * `ProjectFileBinding.name` deliberately strips the extension — it is the
 * Project name the editor shows in the toolbar. The caption names the *file*,
 * so `Low-pass filter.schdraft` and a legacy `Low-pass filter.icproj` are
 * distinguishable at a glance.
 */
function fileNameFromPath(path: string): string {
  const separator = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return separator === -1 ? path : path.slice(separator + 1);
}

export function formatWindowTitle(facts: WindowTitleFacts): string {
  const subject =
    facts.filePath === null
      ? facts.projectName.trim()
      : fileNameFromPath(facts.filePath).trim();
  if (subject === "") return PRODUCT_NAME;
  const marker = facts.dirty ? " *" : "";
  return `${subject}${marker} — ${PRODUCT_NAME}`;
}
