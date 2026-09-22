import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { APP_ORIGIN, createAppProtocolHandler } from "./app-protocol.js";
import {
  associationCommands,
  associationTargets,
  claimsExtension,
  EXTENSION_KEY,
  LEGACY_EXTENSION_KEY,
  PROG_ID_KEY,
  registryValue,
  releaseExtensionCommands,
  removalCommands,
  targetFingerprint,
} from "./file-association.js";
import {
  APP_DATA_FOLDER,
  canWriteDirectory,
  PROJECTS_FOLDER,
  resolveInstallRoot,
} from "./install-paths.js";
import { projectPathFromArgv } from "./open-request.js";
import {
  LEGACY_PROJECT_FILE_EXTENSION,
  PROJECT_FILE_EXTENSION,
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
  // What the shell was asked to open, as the main process would hold it.
  const requested: { path: string | null } = { path: null };
  const handle = await createAppProtocolHandler({
    editorRoot,
    dialogs,
    pendingOpen: {
      take: () => {
        const path = requested.path;
        requested.path = null;
        return path;
      },
    },
  });
  const request = (path: string, init?: RequestInit) =>
    handle(new Request(`${APP_ORIGIN}${path}`, init));
  const post = (path: string, body?: unknown) =>
    request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { handle, request, post, dialogs, requested, workspace };
}

const PROJECT_TEXT = '{"schemaVersion":58,"name":"Low-pass filter"}';

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

  it("hands over a file the shell was asked to open, exactly once", async () => {
    const { request, post, requested, workspace } = await shell();

    expect(await (await post("/api/file/pending")).json()).toEqual({
      status: "idle",
    });

    const path = join(workspace, "Double-clicked.schdraft");
    requested.path = path;
    expect(await (await post("/api/file/pending")).json()).toEqual({
      status: "requested",
      path,
    });
    // Taken: a later check must not reopen the same file behind the person's
    // back, and the editor reads the bytes over `/read` like any other path.
    expect(await (await post("/api/file/pending")).json()).toEqual({
      status: "idle",
    });
    expect((await request("/api/file/pending")).status).toBe(405);
  });

  it("saves in place and only prompts without a path or for Save As", async () => {
    const { post, dialogs, workspace } = await shell();
    const chosen = join(workspace, "Filter.schdraft");
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
    const copy = join(workspace, "Filter copy.schdraft");
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
    // `.schdraft` is what a new Project is saved as, so Windows can associate
    // it; the extension earlier builds wrote, the longer interchange name and a
    // plain `.json` file all still open.
    expect(
      projectNameFromPath(join("D:", "C", "Low-pass filter.schdraft")),
    ).toBe("Low-pass filter");
    expect(projectNameFromPath(join("D:", "C", "amp.SCHDRAFT"))).toBe("amp");
    expect(projectNameFromPath(join("D:", "C", "amp.icproj"))).toBe("amp");
    expect(projectNameFromPath(join("D:", "C", "amp.ICPROJ"))).toBe("amp");
    expect(projectNameFromPath(join("D:", "C", "amp.icproj.json"))).toBe("amp");
    expect(projectNameFromPath(join("D:", "C", "amp.json"))).toBe("amp");
    // Anything else keeps its name: guessing at an unknown extension would
    // silently rename the Project.
    expect(projectNameFromPath(join("D:", "C", "amp.schdraft.bak"))).toBe(
      "amp.schdraft.bak",
    );
  });
});

describe("open requests", () => {
  // Absolute paths under the platform's own temporary root: a relative argument
  // is resolved against the launching shell's directory, so the distinction has
  // to be real on whichever machine runs this.
  const circuits = join(tmpdir(), "sd-argv", "Circuits");
  const project = join(circuits, "Low-pass filter.schdraft");
  const exe = join(tmpdir(), "sd-argv", "Schematic Draft", "app.exe");
  const installed = (
    argv: readonly string[],
    files: readonly string[] = [project],
  ) =>
    projectPathFromArgv(argv, {
      packaged: true,
      workingDirectory: circuits,
      isFile: (path) => files.includes(path),
    });

  it("takes the file a double-click or a command line names", () => {
    expect(installed([exe, project])).toBe(project);
    // Chromium's own switches ride along in the same list.
    expect(installed([exe, "--no-sandbox", project, "--disable-gpu"])).toBe(
      project,
    );
    // Explorer passes an absolute path; a command line need not.
    expect(installed([exe, "Low-pass filter.schdraft"])).toBe(project);
    expect(installed([exe])).toBeNull();
    expect(installed([exe, "--no-sandbox"])).toBeNull();
  });

  it("ignores a path that is not a file there", () => {
    // A stale shortcut, a deleted file, a stray argument: the editor stays on
    // the Project it has rather than reporting a failure nobody asked for.
    expect(installed([exe, join(circuits, "gone.schdraft")])).toBeNull();
    expect(installed([exe, project], [])).toBeNull();
  });

  it("does not mistake a development run's application directory for a file", () => {
    // `electron .` puts the app directory in argv[1]; only a packaged launch
    // starts its arguments there.
    const repo = join(tmpdir(), "sd-argv", "repo");
    const electron = join(repo, "node_modules", "electron", "electron");
    const development = (argv: readonly string[]) =>
      projectPathFromArgv(argv, {
        packaged: false,
        workingDirectory: repo,
        isFile: (path) => path === project || path === join(repo, "apps"),
      });
    expect(development([electron, join(repo, "apps")])).toBeNull();
    expect(development([electron, join(repo, "apps"), project])).toBe(project);
  });
});

describe("install paths", () => {
  const writable = () => true;

  it("keeps an installed copy's files inside its own folder", () => {
    expect(
      resolveInstallRoot({
        executablePath: join("D:", "Tools", "Schematic Draft", "app.exe"),
        packaged: true,
        developmentDirectory: join("repo", "output"),
        canWrite: writable,
      }),
    ).toBe(join("D:", "Tools", "Schematic Draft"));
  });

  it("sends a development run to its own directory, not the install folder", () => {
    expect(
      resolveInstallRoot({
        executablePath: join("repo", "node_modules", "electron", "app.exe"),
        packaged: false,
        developmentDirectory: join("repo", "output", "desktop-data"),
        canWrite: writable,
      }),
    ).toBe(join("repo", "output", "desktop-data"));
  });

  it("reports no folder of its own when it cannot write there", () => {
    // Program Files without elevation, a read-only share, a mounted image: the
    // caller falls back to the per-user locations.
    expect(
      resolveInstallRoot({
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

describe("windows file association", () => {
  const exe = "D:\\Tools\\Schematic Draft\\schematic-draft.exe";
  const queryOutput = (name: string, value: string) =>
    [
      "",
      `HKEY_CURRENT_USER\\Software\\Classes`,
      `    ${name}    REG_SZ    ${value}`,
      "",
    ].join("\r\n");

  it("claims the extension for this executable and nothing else", () => {
    const commands = associationCommands(exe, "Schematic Draft Project");
    expect(commands.map((command) => command[1])).toEqual([
      "HKCU\\Software\\Classes\\.schdraft",
      "HKCU\\Software\\Classes\\SchematicDraft.Project",
      "HKCU\\Software\\Classes\\SchematicDraft.Project",
      "HKCU\\Software\\Classes\\SchematicDraft.Project\\DefaultIcon",
      "HKCU\\Software\\Classes\\SchematicDraft.Project\\shell\\open\\command",
    ]);
    // Per-user keys only: every one of them is under HKCU, so no elevation is
    // needed and no other account sees the change.
    expect(commands.every((command) => command[1]?.startsWith("HKCU\\"))).toBe(
      true,
    );
    expect(commands.at(-1)?.at(-2)).toBe(`"${exe}" "%1"`);
    expect(commands.at(-2)?.at(-2)).toBe(`${exe},0`);
    // What the copy records about itself is ASCII whatever the path holds, so
    // `reg.exe` output in any console codepage still reads back intact.
    expect(commands[2]?.at(-2)).toBe(targetFingerprint(exe));
    expect(targetFingerprint("D:\\电路\\sd.exe")).toMatch(/^[\w-]+$/u);
  });

  it("reads the value whatever Windows calls a default entry", () => {
    // The name is translated; `(默认)` is what a Chinese install prints.
    expect(registryValue(queryOutput("(默认)", "SchematicDraft.Project"))).toBe(
      "SchematicDraft.Project",
    );
    expect(
      registryValue(queryOutput("SchematicDraftTarget", "RDpcVG9vbHM")),
    ).toBe("RDpcVG9vbHM");
    // Nothing registered: `reg query` prints an error, not a value.
    expect(
      registryValue("ERROR: The system was unable to find the\r\n"),
    ).toBeNull();
  });

  it("recognizes its own claim, and a claim belonging to somewhere else", () => {
    const recorded = (path: string) =>
      queryOutput("SchematicDraftTarget", targetFingerprint(path));
    expect(associationTargets(recorded(exe), exe)).toBe(true);
    // Windows does not care about case in a path; a stale claim from the old
    // location is a different path and has to be rewritten.
    expect(associationTargets(recorded(exe.toUpperCase()), exe)).toBe(true);
    expect(
      associationTargets(recorded("E:\\Elsewhere\\schematic-draft.exe"), exe),
    ).toBe(false);
    expect(associationTargets("", exe)).toBe(false);
  });

  it("gives back only what it claimed", () => {
    expect(
      claimsExtension(queryOutput("(Default)", "SchematicDraft.Project")),
    ).toBe(true);
    expect(claimsExtension(queryOutput("(Default)", "VSCode.json"))).toBe(
      false,
    );
    expect(
      removalCommands({ extension: true, legacyExtension: true }).map(
        (command) => command[1],
      ),
    ).toEqual([
      "HKCU\\Software\\Classes\\.schdraft",
      "HKCU\\Software\\Classes\\.icproj",
      "HKCU\\Software\\Classes\\SchematicDraft.Project",
    ]);
    // Another application owns an extension now: its entry is not ours to
    // delete, whichever of the two it took.
    expect(
      removalCommands({ extension: false, legacyExtension: false }).map(
        (command) => command[1],
      ),
    ).toEqual(["HKCU\\Software\\Classes\\SchematicDraft.Project"]);
  });

  it("stops squatting the extension earlier builds saved as", () => {
    // Projects are `.schdraft` now. Holding `.icproj` as well would keep the
    // name the rename was meant to give up, so claiming the new extension
    // releases the old one — but again, only while it is still ours.
    expect(releaseExtensionCommands(LEGACY_EXTENSION_KEY, true)).toEqual([
      ["delete", "HKCU\\Software\\Classes\\.icproj", "/f"],
    ]);
    expect(releaseExtensionCommands(LEGACY_EXTENSION_KEY, false)).toEqual([]);
    // Nothing in the claim it writes mentions the old extension.
    expect(
      associationCommands(exe, "Schematic Draft Project").flat().join(" "),
    ).not.toContain(".icproj");
  });
});

describe("windows installer script", () => {
  // The uninstaller is NSIS and cannot read any of this, so build/installer.nsh
  // spells the same names again. Pinned here because the drift is silent in both
  // directions: an uninstaller that deletes a folder the application saves work
  // in, or that leaves a registry claim behind under a name it no longer knows.
  const script = async () =>
    readFile(new URL("../build/installer.nsh", import.meta.url), "utf8");
  const defines = async () =>
    new Map(
      [...(await script()).matchAll(/^!define (\w+) "(.*)"$/gmu)].map(
        ([, name, value]) => [name, value],
      ),
    );

  it("names the same folders and registry keys the shell writes", async () => {
    const defined = await defines();
    expect(defined.get("PROJECTS_FOLDER")).toBe(PROJECTS_FOLDER);
    expect(defined.get("APP_STATE_FOLDER")).toBe(APP_DATA_FOLDER);
    expect(defined.get("PROJECT_EXTENSION")).toBe(PROJECT_FILE_EXTENSION);
    expect(defined.get("LEGACY_PROJECT_EXTENSION")).toBe(
      LEGACY_PROJECT_FILE_EXTENSION,
    );
    // NSIS names a hive in the instruction rather than the key path, so the two
    // halves are checked as the one key they add up to.
    expect(
      `HKCU\\${defined.get("CLASSES_KEY")}\\${defined.get("PROJECT_EXTENSION")}`,
    ).toBe(EXTENSION_KEY);
    expect(
      `HKCU\\${defined.get("CLASSES_KEY")}\\${defined.get("PROJECT_PROG_ID")}`,
    ).toBe(PROG_ID_KEY);
  });

  it("never removes the install folder wholesale", async () => {
    // The one line that would undo the point of the script: $INSTDIR holds the
    // user's circuits, so only named entries inside it may be deleted.
    expect(await script()).not.toMatch(/RMDir \/r "?\$INSTDIR"?(\s|$)/u);
  });
});
