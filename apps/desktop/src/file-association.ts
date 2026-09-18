import {
  LEGACY_PROJECT_FILE_EXTENSION,
  PROJECT_FILE_EXTENSION,
} from "./project-files.js";

/**
 * The Windows registry entries that let Explorer open a Project here.
 *
 * Double-clicking a file is the only thing this application cannot do from
 * inside its own folder: Windows needs an association, and an association is a
 * registry entry. So this is deliberately the smallest one that works —
 * per-user keys under `HKCU\Software\Classes`, which need no elevation, touch
 * no other account, and can be handed back in full. The command names this
 * copy's own executable, so a folder that moved re-points the association at
 * its new home the next time it runs.
 */

/** This application's document type, distinct from anything else on the machine. */
export const PROJECT_PROG_ID = "SchematicDraft.Project";

const CLASSES = "HKCU\\Software\\Classes";

export const EXTENSION_KEY = `${CLASSES}\\${PROJECT_FILE_EXTENSION}`;

/**
 * The extension earlier builds claimed. One extension is owned at a time, so
 * claiming the current one releases this: squatting a name this application no
 * longer writes would leave exactly the kind of collision the rename avoided.
 * Files with the old extension still open from inside the application.
 */
export const LEGACY_EXTENSION_KEY = `${CLASSES}\\${LEGACY_PROJECT_FILE_EXTENSION}`;

export const PROG_ID_KEY = `${CLASSES}\\${PROJECT_PROG_ID}`;
export const OPEN_COMMAND_KEY = `${PROG_ID_KEY}\\shell\\open\\command`;

/** What Explorer runs for a double-click: this executable, that file. */
export function openCommand(executablePath: string): string {
  return `"${executablePath}" "%1"`;
}

/**
 * A value of this application's own recording which executable the command
 * names, so a copy can tell its own claim from a claim left behind by the same
 * program in a folder that has since moved.
 *
 * It exists because `reg.exe` prints its output in the console's codepage, which
 * Node decodes as UTF-8: a path through `D:\电路\` comes back mangled and would
 * never match itself. The fingerprint is Base64 of the lower-cased path, so what
 * is read back is ASCII whatever the codepage, and Windows' case-insensitivity
 * is preserved. It lives under this application's own key and goes away with it.
 */
export const TARGET_VALUE_NAME = "SchematicDraftTarget";

export function targetFingerprint(executablePath: string): string {
  return Buffer.from(executablePath.toLowerCase(), "utf8").toString(
    "base64url",
  );
}

/** `reg.exe` argument lists that claim the Project extension for this executable. */
export function associationCommands(
  executablePath: string,
  description: string,
): string[][] {
  return [
    ["add", EXTENSION_KEY, "/ve", "/d", PROJECT_PROG_ID, "/f"],
    ["add", PROG_ID_KEY, "/ve", "/d", description, "/f"],
    [
      "add",
      PROG_ID_KEY,
      "/v",
      TARGET_VALUE_NAME,
      "/d",
      targetFingerprint(executablePath),
      "/f",
    ],
    [
      "add",
      `${PROG_ID_KEY}\\DefaultIcon`,
      "/ve",
      "/d",
      `${executablePath},0`,
      "/f",
    ],
    ["add", OPEN_COMMAND_KEY, "/ve", "/d", openCommand(executablePath), "/f"],
  ];
}

/**
 * `reg.exe` argument lists that release an extension key — but only while it
 * still names this application's document type. Once something else owns the
 * extension, that entry is its own, not this application's to delete.
 */
export function releaseExtensionCommands(
  key: string,
  owned: boolean,
): string[][] {
  return owned ? [["delete", key, "/f"]] : [];
}

/**
 * `reg.exe` argument lists that give the whole claim back: both extensions this
 * application has ever claimed, and its document type.
 */
export function removalCommands(owned: {
  extension: boolean;
  legacyExtension: boolean;
}): string[][] {
  return [
    ...releaseExtensionCommands(EXTENSION_KEY, owned.extension),
    ...releaseExtensionCommands(LEGACY_EXTENSION_KEY, owned.legacyExtension),
    ["delete", PROG_ID_KEY, "/f"],
  ];
}

/**
 * The string value in `reg query` output.
 *
 * Matched on the `REG_SZ` type rather than the value's name, because the name
 * Windows prints for a default value is translated — `(Default)` on an English
 * install, `(默认)` on a Chinese one. Only values this application wrote itself
 * are read, and it writes them in ASCII, so the console codepage cannot spoil
 * the answer.
 */
export function registryValue(queryOutput: string): string | null {
  for (const line of queryOutput.split(/\r?\n/u)) {
    const match = /\bREG_SZ\s+(.*?)\s*$/u.exec(line);
    if (match?.[1] !== undefined && match[1].length > 0) return match[1];
  }
  return null;
}

/** Whether the recorded target is this executable. */
export function associationTargets(
  queryOutput: string,
  executablePath: string,
): boolean {
  return registryValue(queryOutput) === targetFingerprint(executablePath);
}

/** Whether an extension key still points at this application's document type. */
export function claimsExtension(queryOutput: string): boolean {
  return registryValue(queryOutput) === PROJECT_PROG_ID;
}
