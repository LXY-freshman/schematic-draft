import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { APP_ORIGIN, createAppProtocolHandler } from "./app-protocol.js";
import { canWriteDirectory, resolveInstallRoot } from "./install-paths.js";
import {
  projectNameFromPath,
  type ProjectFileDialogs,
} from "./project-files.js";

const INDEX_HTML = [
  "<!doctype html><title>Schematic Draft</title>",
  "<script>console.log('theme')</script>",
  '<script type="module" src="/assets/index.js"></script>',
].join("\n");

/** A stub for the native dialogs: the answers a person would have given. */
interface StubDialogs extends ProjectFileDialogs {
  openAnswers: (string | null)[];
  saveAnswers: (string | null)[];
  saveRequests: { name: string; currentPath: string | null }[];
}

function stubDialogs(): StubDialogs {
  const dialogs: StubDialogs = {
    openAnswers: [],
    saveAnswers: [],
    saveRequests: [],
    promptOpen: () => Promise.resolve(dialogs.openAnswers.shift() ?? null),
    promptSave: (suggestion) => {
      dialogs.saveRequests.push(suggestion);
      return Promise.resolve(dialogs.saveAnswers.shift() ?? null);
    },
  };
  return dialogs;
}

async function shell() {
  const editorRoot = await mkdtemp(join(tmpdir(), "sd-editor-"));
  await writeFile(join(editorRoot, "index.html"), INDEX_HTML);
  await writeFile(join(editorRoot, "app.js"), "export {};");
  const workspace = await mkdtemp(join(tmpdir(), "sd-files-"));
  const dialogs = stubDialogs();
  const handle = await createAppProtocolHandler({ editorRoot, dialogs });
  const request = (path: string, init?: RequestInit) =>
    handle(new Request(`${APP_ORIGIN}${path}`, init));
  const post = (path: string, body?: unknown) =>
    request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { handle, request, post, dialogs, workspace };
}

const PROJECT_TEXT = '{"schemaVersion":57,"name":"Low-pass filter"}';

describe("desktop app protocol", () => {
  it("serves the editor with a hash-based CSP and a SPA fallback", async () => {
    const { handle, request } = await shell();

    const index = await request("/");
    expect(index.status).toBe(200);
    expect(await index.text()).toContain("Schematic Draft");
    const csp = index.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toMatch(/script-src 'self' 'sha256-[A-Za-z0-9+/=]+'/u);
    expect(csp).not.toContain("unsafe-inline");
    expect(index.headers.get("cache-control")).toBe("no-cache");

    const route = await request("/editor");
    expect(route.status).toBe(200);
    expect(await route.text()).toContain("Schematic Draft");

    const asset = await request("/app.js");
    expect(asset.headers.get("content-type")).toContain("text/javascript");
    expect(asset.headers.get("cache-control")).toContain("immutable");

    expect((await request("/assets/missing.js")).status).toBe(404);
    expect((await request("/..%2F..%2Fetc/passwd")).status).toBe(404);
    expect((await request("/app.js", { method: "POST" })).status).toBe(405);
    expect((await request("/api/auth/me")).status).toBe(404);
    expect((await handle(new Request("app://elsewhere/"))).status).toBe(404);
  });

  it("opens a Project file the person picks", async () => {
    const { post, dialogs, workspace } = await shell();
    const path = join(workspace, "Low-pass filter.icproj.json");
    await writeFile(path, PROJECT_TEXT, "utf8");
    dialogs.openAnswers.push(path);

    expect(await (await post("/api/file/open")).json()).toEqual({
      status: "opened",
      file: { path, name: "Low-pass filter", text: PROJECT_TEXT },
    });

    // A cancelled dialog is an outcome, not a failure: the editor keeps the
    // Project it already had.
    expect(await (await post("/api/file/open")).json()).toEqual({
      status: "cancelled",
    });

    expect(await (await post("/api/file/read", { path })).json()).toEqual({
      status: "opened",
      file: { path, name: "Low-pass filter", text: PROJECT_TEXT },
    });
    expect(
      await (
        await post("/api/file/read", { path: join(workspace, "gone.json") })
      ).json(),
    ).toEqual(expect.objectContaining({ status: "failed" }));
  });

  it("saves in place and only prompts without a path or for Save As", async () => {
    const { post, dialogs, workspace } = await shell();
    const chosen = join(workspace, "Filter.icproj");
    dialogs.saveAnswers.push(chosen);

    const created = await post("/api/file/save", {
      path: null,
      name: "Filter",
      text: PROJECT_TEXT,
    });
    expect(await created.json()).toEqual({
      status: "saved",
      file: { path: chosen, name: "Filter" },
    });
    expect(dialogs.saveRequests).toEqual([
      { name: "Filter", currentPath: null },
    ]);
    expect(await readFile(chosen, "utf8")).toBe(PROJECT_TEXT);

    // The path is known now, so Ctrl+S overwrites without a dialog.
    const overwritten = await post("/api/file/save", {
      path: chosen,
      name: "Filter",
      text: `${PROJECT_TEXT} `,
    });
    expect(await overwritten.json()).toEqual({
      status: "saved",
      file: { path: chosen, name: "Filter" },
    });
    expect(dialogs.saveRequests).toHaveLength(1);
    expect(await readFile(chosen, "utf8")).toBe(`${PROJECT_TEXT} `);

    // Save As asks even though the same file is open.
    const copy = join(workspace, "Filter copy.icproj");
    dialogs.saveAnswers.push(copy);
    const savedAs = await post("/api/file/save", {
      path: chosen,
      name: "Filter",
      text: PROJECT_TEXT,
      saveAs: true,
    });
    expect(await savedAs.json()).toEqual({
      status: "saved",
      file: { path: copy, name: "Filter copy" },
    });
    expect(dialogs.saveRequests.at(-1)).toEqual({
      name: "Filter",
      currentPath: chosen,
    });

    dialogs.saveAnswers.push(null);
    expect(
      await (
        await post("/api/file/save", { path: null, name: "Filter", text: "{}" })
      ).json(),
    ).toEqual({ status: "cancelled" });
  });

  it("refuses malformed and mis-addressed file requests", async () => {
    const { request, post } = await shell();

    expect((await request("/api/file/open")).status).toBe(405);
    expect((await post("/api/file/save", { name: "x" })).status).toBe(400);
    expect(
      (await post("/api/file/save", { text: "{}", name: "  " })).status,
    ).toBe(400);
    expect((await post("/api/file/read", {})).status).toBe(400);
    // Too large is reported, never silently truncated, and no dialog opens.
    expect(
      await (
        await post("/api/file/save", {
          path: null,
          name: "x",
          text: "x".repeat(16 * 1024 * 1024 + 1),
        })
      ).json(),
    ).toEqual(expect.objectContaining({ status: "failed" }));
    expect((await post("/api/file/bogus")).status).toBe(404);
    expect((await post("/api/projects")).status).toBe(404);
  });
});

describe("project file names", () => {
  it("reads a Project name out of every extension it saves or opens", () => {
    // `.icproj` is what a new Project is saved as, so Windows can associate it;
    // the longer interchange name and a plain `.json` file still open.
    expect(projectNameFromPath(join("D:", "C", "Low-pass filter.icproj"))).toBe(
      "Low-pass filter",
    );
    expect(projectNameFromPath(join("D:", "C", "amp.ICPROJ"))).toBe("amp");
    expect(projectNameFromPath(join("D:", "C", "amp.icproj.json"))).toBe("amp");
    expect(projectNameFromPath(join("D:", "C", "amp.json"))).toBe("amp");
    // Anything else keeps its name: guessing at an unknown extension would
    // silently rename the Project.
    expect(projectNameFromPath(join("D:", "C", "amp.icproj.bak"))).toBe(
      "amp.icproj.bak",
    );
  });
});

describe("install paths", () => {
  const writable = () => true;

  it("keeps an installed copy's files inside its own folder", () => {
    expect(
      resolveInstallRoot({
        portableDirectory: undefined,
        executablePath: join("D:", "Tools", "Schematic Draft", "app.exe"),
        packaged: true,
        developmentDirectory: join("repo", "output"),
        canWrite: writable,
      }),
    ).toBe(join("D:", "Tools", "Schematic Draft"));
  });

  it("follows the portable build to the folder a person actually sees", () => {
    // The portable .exe unpacks itself into a temporary directory, so the folder
    // holding the executable that was double-clicked is the one that moves.
    const chosen = join("E:", "Circuits");
    for (const portableDirectory of [chosen, `${chosen} `]) {
      expect(
        resolveInstallRoot({
          portableDirectory,
          executablePath: join("C:", "Temp", "unpacked", "app.exe"),
          packaged: true,
          developmentDirectory: join("repo", "output"),
          canWrite: writable,
        }),
      ).toBe(chosen);
    }
  });

  it("sends a development run to its own directory, not the install folder", () => {
    for (const portableDirectory of [undefined, "", "   "]) {
      expect(
        resolveInstallRoot({
          portableDirectory,
          executablePath: join("repo", "node_modules", "electron", "app.exe"),
          packaged: false,
          developmentDirectory: join("repo", "output", "desktop-data"),
          canWrite: writable,
        }),
      ).toBe(join("repo", "output", "desktop-data"));
    }
  });

  it("reports no folder of its own when it cannot write there", () => {
    // Program Files without elevation, a read-only share, a mounted image: the
    // caller falls back to the per-user locations.
    expect(
      resolveInstallRoot({
        portableDirectory: undefined,
        executablePath: join("C:", "Program Files", "sd", "app.exe"),
        packaged: true,
        developmentDirectory: join("repo", "output"),
        canWrite: () => false,
      }),
    ).toBeNull();
  });

  it("answers writability by writing, and leaves nothing behind", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sd-install-"));
    const nested = join(directory, "Projects");

    expect(canWriteDirectory(nested)).toBe(true);
    expect(await readdir(nested)).toEqual([]);

    // A file where a directory has to go is the shape a read-only location
    // reports as: the call fails rather than the mode saying so.
    const blocked = join(directory, "occupied");
    await writeFile(blocked, "");
    expect(canWriteDirectory(join(blocked, "inside"))).toBe(false);
  });
});
