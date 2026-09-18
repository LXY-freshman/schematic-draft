import { expect, test } from "@playwright/test";

import { chooseComponent, clickCommand } from "./editor-fixtures.js";

// These cases deliberately break and reload the shared editor origin. Keep
// them in one worker so cache cleanup and failed chunk requests cannot race.
test.describe.configure({ mode: "default" });

test("a render crash shows the recovery screen instead of a blank page", async ({
  page,
}) => {
  await page.goto("/editor");
  await expect(page.getByTestId("schematic-canvas")).toBeVisible();

  // Arm the DEV-only render crash probe and force one more App render.
  page.on("pageerror", (error) => console.log("PAGEERROR:", error.message));
  await page.evaluate(() => {
    window.__ICM_TEST_RENDER_CRASH__ = true;
  });
  await page.keyboard.press("i");

  const crashScreen = page.getByTestId("editor-crash-screen");
  await expect(crashScreen).toBeVisible();
  await expect(crashScreen).toContainText(
    "The editor hit an unexpected problem",
  );
  await expect(crashScreen).toContainText("render crashed (test hook)");
  // The crash screen is entirely local: it names the failure and offers a
  // reload, with no outbound report path.
  await expect(crashScreen.getByRole("link")).toHaveCount(0);
  await expect(crashScreen).toContainText("File / Recover Local Work…");

  // Reloading brings the editor back without the transient crash flag.
  await crashScreen.getByRole("button", { name: "Reload editor" }).click();
  await expect(page.getByTestId("schematic-canvas")).toBeVisible();
});

test("a repeated route chunk failure is not misreported as an old build", async ({
  page,
}) => {
  // #529 named the App chunk from the current deployment. Aborting its route
  // reproduces a transient dynamic-import failure rather than a retired 404.
  await page.route("**/src/app/App.tsx*", (route) => route.abort());
  await page.goto("/editor");

  // The loader retries one navigation. The second failure reaches a neutral,
  // correctly diagnosed loading screen instead of blaming the installation.
  const crashScreen = page.getByTestId("editor-crash-screen");
  await expect(crashScreen).toBeVisible();
  await expect(crashScreen).toContainText(
    "The editor could not finish loading",
  );
  await expect(crashScreen).toContainText("temporarily unavailable");
  await expect(crashScreen).not.toContainText(
    "Part of the installation is missing",
  );
  await expect(
    crashScreen.getByRole("button", { name: "Try again" }),
  ).toBeVisible();
});

/**
 * The recovery screen's own promise, tested end to end.
 *
 * #529 was reported twice by the same person. Everything shipped for it so
 * far made the failure honest — an accurate message, a correct diagnosis —
 * and none of it proved the way out actually works. The unit tests show the
 * loader reloads once and then names the diagnosis; they cannot show that the
 * page boots again once the file is readable, which is the only part the
 * person cares about.
 *
 * These specs run against source served by Vite, so the route chunk is not an
 * `/assets/` file and the diagnosis stays deliberately unconfirmed. That is
 * the honest half of the contract; the confirmed missing-file branch belongs
 * to the module-load-diagnosis unit tests.
 */
test("a readable chunk boots the editor from the crash screen's button", async ({
  page,
}) => {
  let chunkUnreadable = true;
  await page.route("**/src/app/App.tsx*", (route) => {
    if (chunkUnreadable) return route.fulfill({ status: 404, body: "" });
    return route.continue();
  });
  await page.goto("/editor");

  // One automatic reload, then the diagnosis rather than a loop.
  const crashScreen = page.getByTestId("editor-crash-screen");
  await expect(crashScreen).toBeVisible();
  await expect(crashScreen).toContainText("temporarily unavailable");
  const retry = crashScreen.getByRole("button", { name: "Try again" });
  await expect(retry).toBeVisible();

  chunkUnreadable = false;
  await retry.click();

  await expect(page.getByTestId("schematic-canvas")).toBeVisible();
  await expect(crashScreen).toHaveCount(0);
});

test("a failed dialog chunk degrades to a scoped notice, not the crash screen", async ({
  page,
}) => {
  await page.goto("/editor");
  await chooseComponent(page, "resistor");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 360, y: 230 } });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("hit-R1")).toBeVisible();

  // A tab that survives a redeploy asks for chunk names the server no longer
  // has. Aborting the request reproduces the same rejected dynamic import.
  await page.route("**/cell-manager-dialog*", (route) => route.abort());
  await clickCommand(page, "Edit", "Manage Cells…");

  const fallback = page.getByTestId("dialog-chunk-load-fallback");
  await expect(fallback).toBeVisible();
  await expect(fallback).toContainText("This dialog could not be loaded");
  await expect(page.getByTestId("editor-crash-screen")).toHaveCount(0);

  // Closing the notice hands the intact editor back.
  await fallback.getByRole("button", { name: "Close" }).click();
  await expect(fallback).toHaveCount(0);
  await expect(page.getByTestId("hit-R1")).toBeVisible();

  // Refreshing from the notice restores the circuit automatically.
  await clickCommand(page, "Edit", "Manage Cells…");
  const navigated = page.waitForEvent("framenavigated");
  await page.unroute("**/cell-manager-dialog*");
  await page
    .getByTestId("dialog-chunk-load-fallback")
    .getByRole("button", { name: "Refresh app" })
    .click();
  await navigated;
  await expect(page.getByTestId("hit-R1")).toBeVisible();
  await expect(page.getByTestId("status")).toHaveText(
    "Restored recovery revision 1",
  );
});

test("a scene build failure degrades to the last good view and recovers", async ({
  page,
}) => {
  await page.goto("/editor");
  await chooseComponent(page, "resistor");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 360, y: 230 } });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("hit-R1")).toBeVisible();
  await expect(page.getByTestId("revision")).toHaveText("1");

  // Break formal scene building: further commits must not crash the page,
  // the canvas keeps showing the last good scene, and the model still edits.
  await page.evaluate(() => {
    window.__ICM_TEST_SCENE_CRASH__ = true;
  });
  await chooseComponent(page, "resistor");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 520, y: 230 } });
  await expect(page.getByTestId("revision")).toHaveText("2");
  // The degraded status fires on the commit itself; assert it before the
  // closing Escape overwrites the status line.
  await expect(page.getByTestId("status")).toContainText(
    "Scene rendering failed",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("hit-R1")).toBeVisible();
  // Hit targets are React-rendered, but the formal scene stays at the last
  // good view, so R2's painted symbol must be absent from it.
  await expect(
    page.locator('[data-layer="symbols"] [data-object-id="R2"]'),
  ).toHaveCount(0);

  // Once scene building works again, the next commit renders fresh content.
  await page.evaluate(() => {
    window.__ICM_TEST_SCENE_CRASH__ = false;
  });
  await chooseComponent(page, "resistor");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 640, y: 230 } });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("revision")).toHaveText("3");
  await expect(page.getByTestId("hit-R3")).toBeVisible();
  await expect(
    page.locator('[data-layer="symbols"] [data-object-id="R2"]'),
  ).toBeVisible();
  await expect(
    page.locator('[data-layer="symbols"] [data-object-id="R3"]'),
  ).toBeVisible();
});
