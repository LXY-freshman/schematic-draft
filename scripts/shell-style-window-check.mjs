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

console.log(`\n${results.length} checks passed`);
