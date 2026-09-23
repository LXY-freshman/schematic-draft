import { PRODUCT_NAME } from "../../product";
import { fileNameFromPath } from "./project-files";

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
 * The caption names the *file*, so it uses the bound path rather than
 * `ProjectFileBinding.name`: that deliberately strips the extension, being the
 * Project name the toolbar shows, and `Low-pass filter.schdraft` beside a
 * legacy `Low-pass filter.icproj` should be distinguishable at a glance.
 */
export function formatWindowTitle(facts: WindowTitleFacts): string {
  const subject =
    facts.filePath === null
      ? facts.projectName.trim()
      : fileNameFromPath(facts.filePath).trim();
  if (subject === "") return PRODUCT_NAME;
  const marker = facts.dirty ? " *" : "";
  return `${subject}${marker} — ${PRODUCT_NAME}`;
}
