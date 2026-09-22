// Drives the desktop close guard in a real Electron window.
//
// AGENTS.md requires an Electron shell change to be exercised in a real
// window, and no unit test can: the guard only exists as the interaction
// between a `close` event, a native modal, and the renderer answering across
// `executeJavaScript`. Everything here is the shipping main process — the
// window, the `close` handler, the file bridge, the editor's own Save,
// `saveWindowState` and `destroy()`. Only `dialog.showMessageBox` and
// `dialog.showSaveDialog` are stubbed, because a native modal cannot be
// clicked from outside the process.
//
//   pnpm desktop:build && node scripts/close-guard-window-check.mjs
//
// Run it from the workspace root. It needs a display; under WSL that is WSLg
// plus whatever library path Electron's sandbox needs on the machine (see the
// repository notes on running Chromium here) — the environment is inherited
// as-is, this script sets none of it.
//
// It starts from an empty installation, so it deletes `output/desktop-data`,
// the dev shell's ignored userData folder. Nothing else is touched. Close any
// running dev shell first: the single-instance lock hands the launch to that
// window instead, and this one never gets a page.

import { strict as assert } from "node:assert";
import { createRequire } from "node:module";
import { readFile, rm, stat } from "node:fs/promises";
import { resolve } from "node:path";

import { _electron as electron } from "@playwright/test";

const workspace = process.cwd();
const shellRoot = resolve(workspace, "apps/desktop");
const dataRoot = resolve(workspace, "output/desktop-data");
const saveTarget = resolve(dataRoot, "Projects/close-guard-check.schdraft");
// Electron belongs to the shell package, not the root, so resolve it there.
const electronBinary = createRequire(resolve(shellRoot, "package.json"))(
  "electron",
);

async function launch() {
  const app = await electron.launch({
    args: [shellRoot],
    executablePath: electronBinary,
  });
  const page = await app.firstWindow();
  await page.getByTestId("schematic-canvas").waitFor({ timeout: 30_000 });
  return { app, page };
}

/** Three authored objects: enough that the guard sees unsaved work. */
async function drawSomething(page) {
  for (const x of [300, 380, 460]) {
    const summary = page
      .locator("summary", { hasText: "Edit" })
      .filter({ hasText: /^Edit$/u });
    const menu = summary.locator("..");
    if ((await menu.getAttribute("open")) === null) await summary.click();
    await menu
      .getByRole("button", { name: "Insert component… (I)", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Insert Component" });
    await dialog.getByLabel("Component search").fill("resistor");
    await dialog.getByTestId("insert-component-resistor").click();
    await page
      .getByTestId("schematic-canvas")
      .click({ position: { x, y: 230 } });
    await page.keyboard.press("Escape");
  }
}

function bridgeState(page) {
  return page.evaluate(() => {
    const bridge = window.__schematicDraftShell;
    return bridge ? bridge.unsavedWork() : null;
  });
}

/** Answer every message box with `response`, and record what it was asked. */
async function stubDialogs(app, { response, savePick }) {
  await app.evaluate(
    ({ dialog }, answer) => {
      globalThis.__boxes = [];
      dialog.showMessageBox = (_window, options) => {
        globalThis.__boxes.push({
          message: options.message,
          detail: options.detail,
          buttons: options.buttons,
        });
        return Promise.resolve({
          response: answer.response,
          checkboxChecked: false,
        });
      };
      dialog.showSaveDialog = () =>
        Promise.resolve(
          answer.savePick === null
            ? { canceled: true, filePath: undefined }
            : { canceled: false, filePath: answer.savePick },
        );
    },
    { response, savePick: savePick ?? null },
  );
}

const boxes = (app) => app.evaluate(() => globalThis.__boxes ?? []);
const closeWindow = (app) =>
  app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.close(),
  );
const windowCount = (app) =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
const settle = (ms) => new Promise((done) => setTimeout(done, ms));

async function expectExit(app, what) {
  await Promise.race([
    app.waitForEvent("close"),
    settle(15_000).then(() => {
      throw new Error(`${what}: the window never closed`);
    }),
  ]);
}

/** End a case the window survived, without asking the guard again. */
async function abandon(app) {
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.destroy(),
  );
  await app.close().catch(() => {});
}

const results = [];
function pass(name) {
  results.push(name);
  console.log(`  ok  ${name}`);
}

// The bound file is remembered across launches, so leftovers from an earlier
// run would change what Save does.
await rm(dataRoot, { recursive: true, force: true });

// 1. A clean window closes with no prompt at all.
{
  const { app, page } = await launch();
  const state = await bridgeState(page);
  assert.notEqual(state, null, "the editor published no close bridge");
  assert.equal(state.dirty, false, "a fresh Project is not dirty");
  await stubDialogs(app, { response: 2 });
  await closeWindow(app);
  await expectExit(app, "clean close");
  pass("clean window closes without asking");
}

// 2. Cancel keeps the window, and the prompt names the Save target.
{
  const { app, page } = await launch();
  await drawSomething(page);
  assert.equal((await bridgeState(page)).dirty, true, "drawing left it clean");
  await stubDialogs(app, { response: 2 });
  await closeWindow(app);
  await settle(2_000);
  assert.equal(await windowCount(app), 1, "Cancel closed the window anyway");
  const [prompt] = await boxes(app);
  assert.deepEqual(prompt.buttons, ["Save", "Don't Save", "Cancel"]);
  assert.match(prompt.message, /^Save changes to /u);
  assert.match(prompt.detail, /asks where to put it/u);
  await abandon(app);
  pass("Cancel keeps the window, prompt names the Save target");
}

// 3. Don't Save closes, losing the drawing on purpose.
{
  const { app, page } = await launch();
  await drawSomething(page);
  await stubDialogs(app, { response: 1 });
  await closeWindow(app);
  await expectExit(app, "Don't Save");
  pass("Don't Save closes the window");
}

// 4. Backing out of Save As keeps the window and reports nothing as a fault.
//    Runs before the successful save, because saving binds a file and the
//    next launch reopens it — and then Save no longer asks anything.
await rm(saveTarget, { force: true });
{
  const { app, page } = await launch();
  await drawSomething(page);
  assert.equal(
    (await bridgeState(page)).path,
    null,
    "this case needs an unbound Project",
  );
  await stubDialogs(app, { response: 0, savePick: null });
  await closeWindow(app);
  await settle(3_000);
  assert.equal(await windowCount(app), 1, "a cancelled save closed the window");
  assert.equal(
    (await boxes(app)).length,
    1,
    "a cancelled save was reported as a failure",
  );
  await abandon(app);
  pass("a cancelled Save As keeps the window, quietly");
}

// 5. Save writes the file the editor asked for, then closes.
{
  const { app, page } = await launch();
  await drawSomething(page);
  await stubDialogs(app, { response: 0, savePick: saveTarget });
  await closeWindow(app);
  await expectExit(app, "Save");
  const written = JSON.parse(await readFile(saveTarget, "utf8"));
  assert.ok(written.schemaVersion > 0, "the saved file has no schema version");
  pass("Save writes the Project, then closes");
}

// 6. With a file already bound, Save overwrites it in place: no Save As
//    dialog is involved.
{
  const { app, page } = await launch();
  // The startup reopen of the remembered file lands after the canvas does.
  await page.waitForFunction(
    () => window.__schematicDraftShell?.unsavedWork().path !== null,
    null,
    { timeout: 20_000 },
  );
  assert.equal(
    (await bridgeState(page)).path,
    saveTarget,
    "the saved Project did not come back bound to its file",
  );
  const before = (await stat(saveTarget)).mtimeMs;
  await drawSomething(page);
  await stubDialogs(app, { response: 0, savePick: null });
  await closeWindow(app);
  await expectExit(app, "bound Save");
  assert.ok(
    (await stat(saveTarget)).mtimeMs > before,
    "the bound file was not rewritten",
  );
  pass("a bound Save overwrites in place, then closes");
}

// 7. File → Exit is `app.quit()`, not `window.close()`: Electron abandons the
//    whole quit when the close is held, so the guard has to survive that and
//    still be able to finish the quit afterwards.
{
  const { app, page } = await launch();
  await drawSomething(page);
  await stubDialogs(app, { response: 2 });
  await app.evaluate(({ app: electronApp }) => electronApp.quit());
  await settle(3_000);
  assert.equal(await windowCount(app), 1, "Cancel let the quit through");
  await stubDialogs(app, { response: 1 });
  await app.evaluate(({ app: electronApp }) => electronApp.quit());
  await expectExit(app, "Exit after Don't Save");
  pass("File → Exit asks, and quits once the answer allows it");
}

// 8. The remembered geometry still reaches disk, now that `destroy()` is what
//    shuts the window.
{
  const statePath = resolve(dataRoot, "AppData/window-state.json");
  const state = JSON.parse(await readFile(statePath, "utf8"));
  assert.ok(state.width >= 640 && state.height >= 480, "window state is junk");
  assert.ok(
    Date.now() - (await stat(statePath)).mtimeMs < 10 * 60 * 1000,
    "window-state.json was not rewritten by these runs",
  );
  pass("window geometry is written before the window is destroyed");
}

console.log(`\n${results.length} checks passed`);
