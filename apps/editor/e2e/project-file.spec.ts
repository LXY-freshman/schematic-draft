import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createEmptyProject,
  createRoutePath,
  CURRENT_PROJECT_SCHEMA_VERSION,
} from "@icm/model";

import {
  chooseComponent,
  openMenu,
  recoveryProjectTexts,
} from "./editor-fixtures.js";

/**
 * Opening and saving go through the desktop shell's file bridge
 * (`POST /api/file/*`), which a plain Vite server does not answer. These specs
 * stand a fake main process in front of it: an in-memory filesystem plus the
 * two dialog picks. That keeps the editor's real code path — serialize, write,
 * rebind, report — under test, and makes the dialog policy observable: only a
 * first save and Save As ask where to write.
 */
interface SaveRequest {
  path: string | null;
  name: string;
  text: string;
  saveAs?: boolean;
}

interface FileBridge {
  /** The fake filesystem, by absolute path. */
  files: Map<string, string>;
  /** Every `/save` body the editor sent, in order. */
  saves: SaveRequest[];
  /** What the Open dialog returns; `null` cancels. */
  openPick: string | null;
  /** Where the Save dialog puts the file; `null` cancels. */
  savePick: string | null;
  /**
   * A file handed to the shell — a double-click in Explorer — which the editor
   * collects once, exactly as the main process hands it over once.
   */
  requestedOpen: string | null;
}

function baseName(path: string): string {
  return path.split(/[\\/]/u).at(-1) ?? path;
}

async function mockFileBridge(page: Page): Promise<FileBridge> {
  const bridge: FileBridge = {
    files: new Map(),
    saves: [],
    openPick: null,
    savePick: null,
    requestedOpen: null,
  };
  const read = (path: string) => {
    const text = bridge.files.get(path);
    return text === undefined
      ? { status: "failed", message: `${path} could not be read` }
      : { status: "opened", file: { path, name: baseName(path), text } };
  };
  // The editor only asks for a pending file where a shell can answer, which it
  // tells by the `app://` scheme it is served over. These specs are http, so
  // the fake main process says it is there the way a browser test is meant to.
  await page.addInitScript(() => {
    window.__ICM_TEST_FILE_BRIDGE__ = true;
  });
  await page.route("**/api/file/open", (route) =>
    route.fulfill({
      json:
        bridge.openPick === null
          ? { status: "cancelled" }
          : read(bridge.openPick),
    }),
  );
  await page.route("**/api/file/read", (route) => {
    const { path } = route.request().postDataJSON() as { path: string };
    return route.fulfill({ json: read(path) });
  });
  await page.route("**/api/file/pending", (route) => {
    const path = bridge.requestedOpen;
    bridge.requestedOpen = null;
    return route.fulfill({
      json: path === null ? { status: "idle" } : { status: "requested", path },
    });
  });
  await page.route("**/api/file/save", (route) => {
    const body = route.request().postDataJSON() as SaveRequest;
    bridge.saves.push(body);
    // The shell only raises a dialog without a bound path, or for Save As.
    const target =
      body.saveAs === true || body.path === null ? bridge.savePick : body.path;
    if (target === null)
      return route.fulfill({ json: { status: "cancelled" } });
    bridge.files.set(target, body.text);
    return route.fulfill({
      json: { status: "saved", file: { path: target, name: baseName(target) } },
    });
  });
  return bridge;
}

/** Save through the bridge and hand back the bytes that reached the file. */
async function saveAndRead(page: Page, bridge: FileBridge): Promise<string> {
  const before = bridge.saves.length;
  const menu = await openMenu(page, "File");
  await menu.getByTestId("save-project-file").click();
  await expect.poll(() => bridge.saves.length).toBeGreaterThan(before);
  await expect(page.getByTestId("status")).toContainText("Saved ");
  return bridge.saves.at(-1)!.text;
}

async function savedProject<T>(page: Page, bridge: FileBridge): Promise<T> {
  return JSON.parse(await saveAndRead(page, bridge)) as T;
}

/** Which path each save aimed at, and whether it asked for a dialog. */
function saveTargets(
  bridge: FileBridge,
): Array<{ path: string | null; saveAs: boolean }> {
  return bridge.saves.map((request) => ({
    path: request.path,
    saveAs: request.saveAs === true,
  }));
}

const minimalProjectText = readFileSync(
  resolve(process.cwd(), "fixtures/projects/minimal/project.icproj.json"),
  "utf8",
);

test("imports and upgrades a portable Project", async ({ page }) => {
  const bridge = await mockFileBridge(page);
  bridge.savePick = "C:\\circuits\\upgraded.icproj.json";
  const source = JSON.parse(minimalProjectText) as Record<string, unknown>;
  const previousVersion = CURRENT_PROJECT_SCHEMA_VERSION - 1;
  source.schemaVersion = previousVersion;
  await page.goto("/editor");
  await page.getByTestId("project-file").setInputFiles({
    name: `minimal-v${previousVersion}.icproj.json`,
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(source)),
  });
  await expect(page.getByTestId("status")).toContainText(
    `upgraded minimal-v${previousVersion}.icproj.json`,
  );
  const saved = await savedProject<{ schemaVersion: number }>(page, bridge);
  expect(saved.schemaVersion).toBe(CURRENT_PROJECT_SCHEMA_VERSION);
});

test("normalizes legacy overlapping Wire topology on Project import", async ({
  page,
}) => {
  const bridge = await mockFileBridge(page);
  bridge.savePick = "C:\\circuits\\legacy-overlap.icproj.json";
  const source = createEmptyProject("legacy-overlap", "Legacy overlap");
  const document = source.documents[0]!;
  document.sourceStatus = "in-sync";
  document.nets.push({ id: "net", terminals: [] });
  document.junctions.push(
    {
      id: "left",
      netId: "net",
      position: { x: 0, y: 0 },
      role: "route-anchor",
    },
    {
      id: "right",
      netId: "net",
      position: { x: 100, y: 0 },
      role: "route-anchor",
    },
    {
      id: "top",
      netId: "net",
      position: { x: 50, y: 50 },
      role: "route-anchor",
    },
  );
  document.routes.push(
    createRoutePath({
      id: "trunk",
      netId: "net",
      start: { kind: "junction", junctionId: "left" },
      end: { kind: "junction", junctionId: "right" },
      bends: [],
      modes: ["manual"],
    }),
    createRoutePath({
      id: "overlapping-branch",
      netId: "net",
      start: { kind: "junction", junctionId: "top" },
      end: { kind: "junction", junctionId: "right" },
      bends: [{ x: 50, y: 0 }],
      modes: ["manual", "manual"],
    }),
  );

  await page.goto("/editor");
  await page.getByTestId("project-file").setInputFiles({
    name: "legacy-overlap.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(source)),
  });
  await expect(page.getByTestId("status")).toContainText(
    "normalized connectivity and Wire topology in 1 Cell",
  );
  const imported = (await savedProject<typeof source>(page, bridge))
    .documents[0]!;
  expect({
    revision: imported.revision,
    sourceStatus: imported.sourceStatus,
    routes: imported.routes.length,
  }).toEqual({
    revision: 1,
    sourceStatus: "geometry-only-changed",
    routes: 3,
  });
});

test("imports split source-ground markers with independent owners", async ({
  page,
}) => {
  const bridge = await mockFileBridge(page);
  bridge.savePick = "C:\\circuits\\split-ground.icproj.json";
  const source = createEmptyProject("split-ground", "Split ground");
  const document = source.documents[0]!;
  for (const [index, id] of ["G1", "G2"].entries()) {
    document.instances.push({
      id,
      symbolId: "ground",
      placement: {
        position: { x: 200 + index * 200, y: 300 },
        rotation: 0,
        mirror: "none",
      },
    });
    document.nets.push({
      id: `net-${id}`,
      terminals: [{ instanceId: id, pinName: "0" }],
    });
    document.connectivityEvidence.push({
      id: `source-${id}`,
      kind: "spice-source",
      netId: `net-${id}`,
      sourceNetId: "original-0",
    });
  }
  document.connectivityEvidence.push({
    id: "global",
    kind: "name-claim",
    netId: "net-G1",
    name: "0",
    scope: "global",
    powerDomain: "ground",
    owner: { kind: "global-declaration", sourceNetId: "original-0" },
  });
  await page.goto("/editor");
  await page.getByTestId("project-file").setInputFiles({
    name: "split-ground.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(source)),
  });
  await expect(page.getByTestId("status")).toContainText(
    "save to keep the repair",
  );
  const repaired = (await savedProject<typeof source>(page, bridge))
    .documents[0]!;
  expect(repaired.nets).toEqual(document.nets);
  expect(repaired.routes).toEqual([]);
  expect(repaired.sourceStatus).toBe("connectivity-modified");
  expect(
    repaired.connectivityEvidence.filter(
      (e) => e.kind === "name-claim" && e.owner.kind === "power-marker",
    ),
  ).toEqual(
    expect.arrayContaining(
      ["G1", "G2"].map((objectId) =>
        expect.objectContaining({
          name: "0",
          scope: "global",
          owner: { kind: "power-marker", objectId },
        }),
      ),
    ),
  );
});

test("opens a file and then saves over it without a dialog", async ({
  page,
}) => {
  const bridge = await mockFileBridge(page);
  const path = "C:\\circuits\\amplifier.icproj.json";
  bridge.files.set(path, minimalProjectText);
  bridge.openPick = path;
  await page.goto("/editor");
  let fileMenu = await openMenu(page, "File");
  await fileMenu.getByTestId("open-project-file").click();
  await expect(page.getByTestId("status")).toHaveText(`Opened ${path}`);

  // Save's target is stated, not guessed, before it is used.
  fileMenu = await openMenu(page, "File");
  await expect(fileMenu.getByTestId("save-project-file")).toHaveAttribute(
    "title",
    `Save to ${path}`,
  );
  await page.keyboard.press("Escape");

  await chooseComponent(page, "resistor");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 360, y: 230 } });
  await page.keyboard.press("Escape");

  // A Save dialog pick is deliberately absent: needing one would cancel.
  const saved = JSON.parse(await saveAndRead(page, bridge)) as {
    documents: Array<{ instances: unknown[] }>;
  };
  expect(saveTargets(bridge)).toEqual([{ path, saveAs: false }]);
  expect(saved.documents[0]!.instances).toHaveLength(1);
  expect(bridge.files.get(path)).not.toBe(minimalProjectText);
  await expect(page.getByTestId("status")).toHaveText(`Saved ${path}`);
});

/**
 * The window caption names the file, not the product.
 *
 * In the shell this string is the Windows title bar, so it is what the taskbar
 * and Alt-Tab show. Here it is only `document.title` — whether Electron accepts
 * it is the shell's own question, answered by
 * `scripts/shell-style-window-check.mjs` in a launched window.
 */
test("the title names the open file and marks unsaved work", async ({
  page,
}) => {
  const bridge = await mockFileBridge(page);
  const path = "C:\\circuits\\amplifier.icproj.json";
  bridge.files.set(path, minimalProjectText);
  bridge.openPick = path;
  await page.goto("/editor");

  // Nothing is bound yet, so the Project name is all there is to show.
  await expect(page).toHaveTitle(/^.+ — Schematic Draft$/u);
  await expect(page).not.toHaveTitle(/\*/u);

  const fileMenu = await openMenu(page, "File");
  await fileMenu.getByTestId("open-project-file").click();
  await expect(page.getByTestId("status")).toHaveText(`Opened ${path}`);
  // The file's own name, extension included — a `.icproj.json` is a different
  // file from a `.schdraft` of the same circuit.
  await expect(page).toHaveTitle("amplifier.icproj.json — Schematic Draft");

  await chooseComponent(page, "resistor");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 360, y: 230 } });
  await page.keyboard.press("Escape");
  await expect(page).toHaveTitle("amplifier.icproj.json * — Schematic Draft");

  await saveAndRead(page, bridge);
  await expect(page.getByTestId("status")).toHaveText(`Saved ${path}`);
  await expect(page).toHaveTitle("amplifier.icproj.json — Schematic Draft");
});

/**
 * The double-click path, end to end through the renderer.
 *
 * Explorer hands the file to the shell, which queues it; the editor collects it
 * over the same bridge it reads any other path with. A second double-click
 * reaches the running copy, which asks the editor to look again — the event
 * carries no data, so this is the only way the path can arrive.
 */
test("opens the file the shell was handed, at launch and while running", async ({
  page,
}) => {
  const bridge = await mockFileBridge(page);
  const first = "C:\\circuits\\double-clicked.schdraft";
  const second = "C:\\circuits\\another.schdraft";
  bridge.files.set(first, minimalProjectText);
  bridge.files.set(second, minimalProjectText);
  bridge.requestedOpen = first;

  await page.goto("/editor");
  await expect(page.getByTestId("status")).toHaveText(`Opened ${first}`);

  // Save now belongs to that file, with no dialog: it is a bound Project, not
  // an import.
  const fileMenu = await openMenu(page, "File");
  await expect(fileMenu.getByTestId("save-project-file")).toHaveAttribute(
    "title",
    `Save to ${first}`,
  );
  await page.keyboard.press("Escape");

  bridge.requestedOpen = second;
  await page.evaluate(() => {
    window.dispatchEvent(new Event("schematic-draft:open-request"));
  });
  await expect(page.getByTestId("status")).toHaveText(`Opened ${second}`);
});

test("Save As writes a second file and rebinds the Project to it", async ({
  page,
}) => {
  const bridge = await mockFileBridge(page);
  const original = "C:\\circuits\\amplifier.icproj.json";
  const copy = "C:\\circuits\\amplifier-v2.icproj.json";
  bridge.files.set(original, minimalProjectText);
  bridge.openPick = original;
  bridge.savePick = copy;
  await page.goto("/editor");
  let fileMenu = await openMenu(page, "File");
  await fileMenu.getByTestId("open-project-file").click();
  await expect(page.getByTestId("status")).toHaveText(`Opened ${original}`);

  fileMenu = await openMenu(page, "File");
  await fileMenu.getByTestId("save-project-file-as").click();
  await expect(page.getByTestId("status")).toHaveText(`Saved ${copy}`);
  expect(saveTargets(bridge)).toEqual([{ path: original, saveAs: true }]);
  expect(bridge.files.get(original)).toBe(minimalProjectText);

  // From here Save belongs to the copy, with no further dialog.
  bridge.savePick = null;
  await chooseComponent(page, "resistor");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 360, y: 230 } });
  await page.keyboard.press("Escape");
  await saveAndRead(page, bridge);
  expect(saveTargets(bridge).at(-1)).toEqual({ path: copy, saveAs: false });
  await expect(page.getByTestId("status")).toHaveText(`Saved ${copy}`);
});

test("keeps the work in the editor when a save fails", async ({ page }) => {
  await mockFileBridge(page);
  await page.route("**/api/file/save", (route) =>
    route.fulfill({ json: { status: "failed", message: "disk is full" } }),
  );
  await page.goto("/editor");
  await chooseComponent(page, "resistor");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 360, y: 230 } });
  await page.keyboard.press("Escape");
  const fileMenu = await openMenu(page, "File");
  await fileMenu.getByTestId("save-project-file").click();
  await expect(page.getByTestId("status")).toContainText(
    "Save failed; work remains in the editor (disk is full)",
  );
  await expect(page.getByTestId("revision")).toHaveText("1");
});

test("rejects invalid imports without replacing live or recovered work", async ({
  page,
}) => {
  await page.goto("/editor");
  await chooseComponent(page, "resistor");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 360, y: 230 } });
  await page.keyboard.press("Escape");
  await page.getByTestId("project-file").setInputFiles({
    name: "broken.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from("{ not valid json"),
  });
  await expect(page.getByTestId("status")).toContainText("INVALID_JSON");
  await expect(page.getByTestId("revision")).toHaveText("1");
  await expect
    .poll(() => recoveryProjectTexts(page))
    .toContain('"revision": 1');
});

test("discarding a dirty replacement does not leave a second project stack", async ({
  page,
}) => {
  await page.goto("/editor");
  // The guard protects meaningful drawings: three authored objects.
  for (const x of [300, 380, 460]) {
    await chooseComponent(page, "resistor");
    await page
      .getByTestId("schematic-canvas")
      .click({ position: { x, y: 230 } });
    await page.keyboard.press("Escape");
  }
  let fileMenu = await openMenu(page, "File");
  await fileMenu.getByRole("button", { name: "New Project" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Unsaved changes",
  });
  await dialog.getByRole("button", { name: "Continue without saving" }).click();
  await expect(page.getByTestId("canvas-empty-state")).toBeVisible();
  fileMenu = await openMenu(page, "File");
  await expect(
    fileMenu.getByRole("button", { name: "Revert to Last Saved" }),
  ).toBeDisabled();
});
