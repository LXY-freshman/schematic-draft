// Reads the desktop shell's own console, computed styles and window caption in
// a real window.
//
// The shell serves a Content Security Policy that nothing below Electron
// applies: the dev server, the preview server and every Playwright run are
// plain http with no policy at all. A declaration the policy drops is not an
// error the editor can see — the canvas simply renders without it — so the
// only place this is provable is a launched window whose console is being
// read. That is how an editor shipped for two releases with italics upright,
// weights flattened, an active-low overbar missing, the code panels unstyled
// and the round-period font never loaded.
//
// The window caption is here for the same reason: a browser test can only read
// `document.title`, and whether Electron accepts it is the shell's decision.
// So are the absent menu bar and the window zoom keys — a menu Electron
// installs by default, and accelerators it used to register with that menu.
//
//   pnpm desktop:build && node scripts/shell-style-window-check.mjs
//
// Run it from the workspace root. It needs a display; under WSL that is WSLg
// plus whatever library path Electron's sandbox needs on the machine — the
// environment is inherited as-is, this script sets none of it.
//
// It starts from an empty installation, so it deletes `output/desktop-data`,
// the dev shell's ignored userData folder. Nothing else is touched. Close any
// running dev shell first: the single-instance lock hands the launch to that
// window instead, and this one never gets a page.

import { strict as assert } from "node:assert";
import { createRequire } from "node:module";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";

import { _electron as electron } from "@playwright/test";

const workspace = process.cwd();
const shellRoot = resolve(workspace, "apps/desktop");
const dataRoot = resolve(workspace, "output/desktop-data");
// Electron belongs to the shell package, not the root, so resolve it there.
const electronBinary = createRequire(resolve(shellRoot, "package.json"))(
  "electron",
);

const results = [];
function pass(name) {
  results.push(name);
  console.log(`  ok  ${name}`);
}

await rm(dataRoot, { recursive: true, force: true });

const app = await electron.launch({
  args: [shellRoot],
  executablePath: electronBinary,
});
const page = await app.firstWindow();

/** Everything Chromium refused, in the words it refused it. */
const violations = [];
page.on("console", (message) => {
  if (message.type() !== "error") return;
  const text = message.text();
  if (!text.includes("Content Security Policy")) return;
  const at = message.location();
  violations.push(`${text} (${at.url}:${at.lineNumber})`);
});

await page.getByTestId("schematic-canvas").waitFor({ timeout: 30_000 });

/** The caption Windows shows, which only a launched window has. */
const caption = () =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.title);
const cleanCaption = await caption();

// A D flip-flop carries both cases the policy used to break: italic signal
// names, and the overbar that is the only thing separating Q from its
// complement. Inserting it also leaves the Project dirty, which is what the
// caption's unsaved marker is read from below.
{
  const summary = page
    .locator("summary", { hasText: "Edit" })
    .filter({ hasText: /^Edit$/u });
  const menu = summary.locator("..");
  if ((await menu.getAttribute("open")) === null) await summary.click();
  await menu
    .getByRole("button", { name: "Insert component… (I)", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Insert Component" });
  await dialog.getByLabel("Component search").fill("flip-flop");
  await dialog.getByTestId("insert-component-d-flip-flop").click();
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 360, y: 240 } });
  await page.keyboard.press("Escape");
}

// CodeMirror mounts its theme as an inline stylesheet the first time a code
// view opens, so nothing about it is decided until the panel is on screen.
await page.getByTestId("project-code-toggle").click();
await page.locator(".cm-editor").first().waitFor({ timeout: 30_000 });
await page.waitForTimeout(2_000);

const seen = await page.evaluate(async () => {
  await document.fonts.ready;
  const computed = (element) => {
    const style = getComputedStyle(element);
    return {
      fontStyle: style.fontStyle,
      fontWeight: style.fontWeight,
      textDecoration: style.textDecorationLine,
    };
  };
  const gutters = document.querySelector(".cm-gutters");
  return {
    // A `style` attribute React wrote through CSSOM survives any policy; one
    // that was parsed from markup and refused stays in the attribute with
    // nothing applied. The second kind is what a dropped declaration looks
    // like from the page's side.
    inertStyleAttributes: [...document.querySelectorAll("[style]")]
      .filter((element) => element.style.length === 0)
      .map((element) => element.getAttribute("style")),
    inlineSheetRules: [...document.querySelectorAll("style")].map((element) =>
      element.sheet ? element.sheet.cssRules.length : 0,
    ),
    roundPeriodFaces: [...document.fonts].filter(
      (face) => face.family === "ICM Round Period",
    ).length,
    codeMirrorGutterPosition: gutters ? getComputedStyle(gutters).position : "",
    italic: [...document.querySelectorAll('tspan[font-style="italic"]')]
      .slice(0, 1)
      .map(computed)[0],
    overbar: [...document.querySelectorAll('tspan[text-decoration="overline"]')]
      .slice(0, 1)
      .map(computed)[0],
  };
});

const dirtyCaption = await caption();
const pageTitle = await page.title();

// This application has one menu, and it is the editor's. Electron installs a
// default menu bar when none is set, so "there is no menu" is a fact only a
// launched window can confirm — and with it went the only place the window
// shortcuts below were ever registered. Both have to be read from the live
// window, so they are gathered here and asserted with everything else below.
const shellMenu = await app.evaluate(({ Menu, BrowserWindow }) => ({
  application: Menu.getApplicationMenu() === null ? null : "installed",
  barVisible: BrowserWindow.getAllWindows()[0]?.isMenuBarVisible(),
}));

const zoomLevel = () =>
  app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.webContents.getZoomLevel(),
  );

// The chord has to be sent with `sendInputEvent`, which synthesises it in the
// browser process where a real key press arrives. `page.keyboard.press` is
// dispatched over the DevTools protocol straight into the renderer and never
// reaches `before-input-event` at all — verified here: it leaves the zoom at
// 0 whether the shell handles the chord or not, which is worse than no check.
const sendChord = (keyCode) =>
  app.evaluate(({ BrowserWindow }, code) => {
    BrowserWindow.getAllWindows()[0]?.webContents.sendInputEvent({
      type: "keyDown",
      keyCode: code,
      modifiers: ["control"],
    });
  }, keyCode);

await sendChord("-");
await page.waitForTimeout(250);
const zoomedOut = await zoomLevel();
await sendChord("0");
await page.waitForTimeout(250);
const zoomReset = await zoomLevel();

// The rest of what the menu bar carried: a folder the shell opens, and three
// facts about this installation that only the main process knows. Both are
// round trips through `app://` to the browser process and back, so a browser
// test can only see the fallback where the editor says nothing at all.
await app.evaluate(({ shell }) => {
  globalThis.__opened = [];
  // Explorer is the point of this command, and it is not here to be opened.
  shell.openPath = (path) => {
    globalThis.__opened.push(path);
    return Promise.resolve("");
  };
});

{
  const summary = page
    .locator("summary", { hasText: "File" })
    .filter({ hasText: /^File$/u });
  const menu = summary.locator("..");
  if ((await menu.getAttribute("open")) === null) await summary.click();
  await page.getByTestId("open-projects-folder").click();
  await page.keyboard.press("Escape");
}
const opened = await app.evaluate(() => globalThis.__opened);

await page.getByRole("button", { name: "Help" }).click();
await page.getByTestId("install-facts").waitFor({ timeout: 10_000 });
const installFacts = await page.evaluate(() => {
  const facts = document.querySelector('[data-testid="install-facts"]');
  return {
    paths: [...facts.querySelectorAll("dd code")].map(
      (code) => code.textContent,
    ),
    hasAssociation:
      facts.querySelector('[data-testid="file-association"]') !== null,
  };
});

await app.close();

assert.deepEqual(
  violations,
  [],
  `the shell refused something it serves itself:\n  ${violations.join("\n  ")}`,
);
pass("the window's console reports no policy violation");

assert.deepEqual(
  seen.inertStyleAttributes,
  [],
  "a style attribute reached the DOM and applied nothing",
);
pass("every style attribute in the document applies");

assert.ok(
  seen.inlineSheetRules.length >= 2 &&
    seen.inlineSheetRules.every((count) => count > 0),
  `an inline stylesheet parsed to nothing: ${JSON.stringify(seen.inlineSheetRules)}`,
);
assert.equal(
  seen.codeMirrorGutterPosition,
  "sticky",
  "CodeMirror's theme did not reach its gutters",
);
pass("the code panel's own stylesheet is applied");

assert.equal(
  seen.roundPeriodFaces,
  4,
  `the round-period font registered ${seen.roundPeriodFaces} of 4 faces`,
);
pass("the schematic round-period font is loaded");

assert.equal(seen.italic?.fontStyle, "italic", "a signal name renders upright");
assert.equal(
  seen.overbar?.textDecoration,
  "overline",
  "an active-low signal renders as its own complement",
);
pass("schematic italics and the active-low overbar render");

// The caption is the other thing no test below Electron can see: Playwright
// reads `document.title`, and the shell used to refuse every page title, so
// the two could disagree and only a launched window would know.
assert.equal(
  dirtyCaption,
  pageTitle,
  "the window caption and the page title disagree",
);
assert.notEqual(
  cleanCaption,
  "Schematic Draft",
  "the caption is still pinned to the product name",
);
assert.ok(
  !cleanCaption.includes("*") && dirtyCaption.includes(" * "),
  `the caption did not mark unsaved work: ${cleanCaption} → ${dirtyCaption}`,
);
pass("the window caption names the Project and marks unsaved work");

assert.equal(shellMenu.application, null, "a system menu is still installed");
assert.equal(shellMenu.barVisible, false, "the window still shows a menu bar");
pass("the shell installs no menu of its own");

assert.ok(zoomedOut < 0, `Ctrl+- did not zoom the window out: ${zoomedOut}`);
assert.equal(zoomReset, 0, "Ctrl+0 did not reset the window zoom");
pass("the window zoom keys work without a menu to register them");

assert.deepEqual(
  opened,
  [resolve(dataRoot, "Projects")],
  "Open Projects Folder did not ask the shell for this installation's Projects",
);
pass("Open Projects Folder reaches the shell, with the folder in use");

assert.deepEqual(
  installFacts.paths,
  [resolve(dataRoot, "Projects"), resolve(dataRoot, "AppData")],
  "About describes folders this installation is not using",
);
// A development run writes nothing to the registry, so the association is
// `unavailable` and About offers no switch rather than one that cannot work.
// Whether the switch itself writes the keys is a packaged Windows question.
assert.equal(
  installFacts.hasAssociation,
  false,
  "About offered a file association an unpackaged run cannot make",
);
pass("About reports the folders this installation actually uses");

console.log(`\n${results.length} checks passed`);
