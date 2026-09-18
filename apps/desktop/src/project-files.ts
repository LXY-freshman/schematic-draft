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
 */
export const PROJECT_FILE_EXTENSION = ".icproj";

/**
 * What the Open dialog offers, most specific first. `.icproj.json` is the
 * portable interchange name — what the browser build downloads and what the
 * repository's own fixtures use — and stays a first-class Project file here.
 */
export const PROJECT_FILE_EXTENSIONS = ["icproj", "icproj.json", "json"];

export interface ProjectFileDialogs {
  /** Ask which file to open; null when the person cancels. */
  promptOpen(): Promise<string | null>;
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

/** `Low-pass filter.icproj` → `Low-pass filter`, and the same for the others. */
export function projectNameFromPath(path: string): string {
  return basename(path).replace(/(?:\.icproj)?\.json$|\.icproj$/iu, "");
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
  dialogs: ProjectFileDialogs,
): Promise<Response | null> {
  if (!pathname.startsWith("/api/file/")) return null;
  if (request.method !== "POST")
    return json({ error: "method-not-allowed" }, 405);

  const body = (await request.json().catch(() => null)) as {
    path?: unknown;
    name?: unknown;
    text?: unknown;
    saveAs?: unknown;
  } | null;

  if (pathname === "/api/file/open") {
    let chosen: string | null;
    try {
      chosen = await dialogs.promptOpen();
    } catch (error) {
      return failed(error, "The open dialog failed");
    }
    if (chosen === null) return json({ status: "cancelled" });
    return openPath(chosen);
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
        target = await dialogs.promptSave({ name, currentPath });
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
