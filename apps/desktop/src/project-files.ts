import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";

/**
 * The editor's file bridge.
 *
 * The renderer is sandboxed and has no filesystem access, so opening and
 * saving a circuit is a request to this process: it runs the native dialogs,
 * reads and writes the bytes, and hands the editor back a path it can save to
 * again without prompting. Ctrl+S therefore overwrites the open file in
 * place, exactly like every other desktop editor; only Save As asks.
 */

/** The same ceiling the editor's own Project parser is happy with. */
const MAX_PROJECT_BYTES = 16 * 1024 * 1024;

/**
 * What a new Project is saved as.
 *
 * An extension of this application's own, because Windows resolves only the
 * last one: `.icproj.json` looks like `.json`, which every text editor on the
 * machine already claims, so a Project saved that way could never be opened by
 * double-clicking it. The bytes are the same canonical JSON either way.
 *
 * Long and named after the product on purpose. A four-letter extension is the
 * kind of thing another tool picks independently — `.icproj` reads as "IC
 * project" to anyone — and whichever program registered last would own the
 * double-click.
 */
export const PROJECT_FILE_EXTENSION = ".schdraft";

/** What earlier builds of this application saved as, and still open. */
export const LEGACY_PROJECT_FILE_EXTENSION = ".icproj";

/**
 * What the Open dialog offers, most specific first. `.icproj.json` is the
 * portable interchange name — what the browser build downloads and what the
 * repository's own fixtures use — and stays a first-class Project file here.
 */
export const PROJECT_FILE_EXTENSIONS = [
  "schdraft",
  "icproj",
  "icproj.json",
  "json",
];

/**
 * A file the shell was handed — a double-click, or a path on the command line.
 *
 * The renderer polls for it over this same bridge rather than being pushed a
 * path, because there is no preload script and the editor already owns the
 * "replace the open Project?" question.
 */
export interface PendingProjectOpen {
  /** The waiting path, forgotten as it is handed over; null when there is none. */
  take(): string | null;
}

/**
 * What the SPICE import dialog offers. The importer takes one entry file plus
 * the local includes it names, so the dialog is a multi-selection over the
 * whole family of source extensions rather than one file at a time.
 */
export const SOURCE_FILE_EXTENSIONS = ["spi", "cir", "sp", "scs", "inc", "lib"];

export interface ProjectFileDialogs {
  /** Ask which file to open; null when the person cancels. */
  promptOpen(): Promise<string | null>;
  /** Ask which source files to import; null when the person cancels. */
  promptOpenMany(): Promise<readonly string[] | null>;
  /** Ask where to write; null when the person cancels. */
  promptSave(suggestion: {
    /** The Project name, for a first save with no path yet. */
    name: string;
    /** The file currently open, when there is one. */
    currentPath: string | null;
  }): Promise<string | null>;
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

const failed = (error: unknown, fallback: string): Response =>
  json(
    {
      status: "failed",
      message: error instanceof Error ? error.message : fallback,
    },
    200,
  );

/** `Low-pass filter.schdraft` → `Low-pass filter`, and the same for the others. */
export function projectNameFromPath(path: string): string {
  return basename(path).replace(
    /(?:\.icproj)?\.json$|\.icproj$|\.schdraft$/iu,
    "",
  );
}

async function openPath(path: string): Promise<Response> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    return failed(error, "The file could not be read");
  }
  if (Buffer.byteLength(text, "utf8") > MAX_PROJECT_BYTES) {
    return json({ status: "failed", message: "The file is too large to open" });
  }
  return json({
    status: "opened",
    file: { path, name: projectNameFromPath(path), text },
  });
}

/**
 * Answers `/api/file/*`; returns null for any other route so the protocol
 * handler can fall through to the editor's static assets.
 */
export async function handleProjectFileApi(
  request: Request,
  pathname: string,
  deps: {
    dialogs: ProjectFileDialogs;
    /** Absent in a plain browser, where nothing can hand the editor a file. */
    pendingOpen?: PendingProjectOpen;
  },
): Promise<Response | null> {
  if (!pathname.startsWith("/api/file/")) return null;
  if (request.method !== "POST")
    return json({ error: "method-not-allowed" }, 405);

  if (pathname === "/api/file/pending") {
    const path = deps.pendingOpen?.take() ?? null;
    return path === null
      ? json({ status: "idle" })
      : json({ status: "requested", path });
  }

  const body = (await request.json().catch(() => null)) as {
    path?: unknown;
    name?: unknown;
    text?: unknown;
    saveAs?: unknown;
  } | null;

  if (pathname === "/api/file/open") {
    let chosen: string | null;
    try {
      chosen = await deps.dialogs.promptOpen();
    } catch (error) {
      return failed(error, "The open dialog failed");
    }
    if (chosen === null) return json({ status: "cancelled" });
    return openPath(chosen);
  }

  if (pathname === "/api/file/open-many") {
    let chosen: readonly string[] | null;
    try {
      chosen = await deps.dialogs.promptOpenMany();
    } catch (error) {
      return failed(error, "The open dialog failed");
    }
    if (chosen === null || chosen.length === 0)
      return json({ status: "cancelled" });
    const files: { path: string; name: string; base64: string }[] = [];
    let total = 0;
    for (const path of chosen) {
      let bytes: Buffer;
      try {
        bytes = await readFile(path);
      } catch (error) {
        return failed(error, "The file could not be read");
      }
      total += bytes.byteLength;
      if (total > MAX_PROJECT_BYTES) {
        return json({
          status: "failed",
          message: "The selected files are too large to import",
        });
      }
      // Bytes, not text. The SPICE loader sniffs a byte-order mark to tell
      // UTF-8 from UTF-16 and records which it found; decoding here as UTF-8
      // would turn a UTF-16 netlist into mojibake before the importer ever saw
      // it. Base64 because this route family answers in JSON and one response
      // carries several files. Netlists are kilobytes; the overhead is noise.
      files.push({
        path,
        name: basename(path),
        base64: bytes.toString("base64"),
      });
    }
    return json({ status: "opened", files });
  }

  if (pathname === "/api/file/read") {
    const path = typeof body?.path === "string" ? body.path : null;
    if (!path) return json({ error: "invalid-fields" }, 400);
    return openPath(path);
  }

  if (pathname === "/api/file/save") {
    const text = typeof body?.text === "string" ? body.text : null;
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (text === null || name === "") {
      return json({ error: "invalid-fields" }, 400);
    }
    if (Buffer.byteLength(text, "utf8") > MAX_PROJECT_BYTES) {
      return json({
        status: "failed",
        message: "The Project is too large to save",
      });
    }
    const currentPath = typeof body?.path === "string" ? body.path : null;
    // A known path is written straight back; only a first save or an explicit
    // Save As reaches the dialog.
    let target = body?.saveAs === true ? null : currentPath;
    if (target === null) {
      try {
        target = await deps.dialogs.promptSave({ name, currentPath });
      } catch (error) {
        return failed(error, "The save dialog failed");
      }
      if (target === null) return json({ status: "cancelled" });
    }
    try {
      await writeFile(target, text, "utf8");
    } catch (error) {
      return failed(error, "The file could not be written");
    }
    return json({
      status: "saved",
      file: { path: target, name: projectNameFromPath(target) },
    });
  }

  return json({ error: "not-found" }, 404);
}
