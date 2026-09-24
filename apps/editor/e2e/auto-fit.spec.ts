import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

// Opening any schematic lands fitted, exactly as if F were pressed once.
test("an opened Project is auto-fitted to the camera", async ({ page }) => {
  await page.goto("/editor");
  await page
    .getByTestId("project-file")
    .setInputFiles(
      resolve(
        process.cwd(),
        "fixtures/projects/phase-3-routing/project.icproj.json",
      ),
    );
  // The landing fit is silent: the open's own status survives.
  await expect(page.getByTestId("status")).toContainText("Opened");
  const canvas = page.getByTestId("schematic-canvas");
  // The default camera never survives an open with content.
  await expect
    .poll(async () => canvas.getAttribute("viewBox"))
    .not.toBe("0 0 960 640");
  const afterOpen = await canvas.getAttribute("viewBox");
  await page.keyboard.press("f");
  await expect.poll(async () => canvas.getAttribute("viewBox")).toBe(afterOpen);
});

// The camera is fitted inside the panel undistorted, so a window whose shape
// differs from the camera's shows more of the drawing than the camera asked
// for. The layers drawn across the camera have to cover what is shown, not what
// was asked: sized to the camera they stop short, and the band they leave is
// blank paper the grid never reaches and the pointer cannot draw in.
test("the grid and the input planes reach the edges of a window of any shape", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/editor");
  const canvas = page.getByTestId("schematic-canvas");
  await canvas.waitFor();
  // Both dot layers, so the coarse one is covered too: it appears later than
  // the fine one, and a layer that arrives late is a layer that can be missed.
  await page.getByRole("button", { name: "Grid", exact: true }).click();
  await page.keyboard.press("w");
  await expect(page.getByTestId("wire-input-plane")).toBeVisible();

  /** How far the worst edge of a layer falls inside the panel, in pixels. */
  const shortfall = async (testId: string) => {
    const panel = (await canvas.boundingBox())!;
    const layer = (await page.getByTestId(testId).boundingBox())!;
    return Math.max(
      layer.x - panel.x,
      layer.y - panel.y,
      panel.x + panel.width - (layer.x + layer.width),
      panel.y + panel.height - (layer.y + layer.height),
    );
  };
  const layers = [
    "canvas-grid-dots",
    "canvas-grid-major-dots",
    "wire-input-plane",
  ];
  for (const viewport of [
    // A window far wider than any camera, then one far taller — letterboxed on
    // the other axis, and reached by resizing rather than by loading.
    { width: 2400, height: 700 },
    { width: 800, height: 1200 },
  ]) {
    await page.setViewportSize(viewport);
    for (const testId of layers) {
      // A negative shortfall is overhang, which the panel clips and nobody
      // sees; half a pixel of slack is the rounding of a measured layout.
      await expect.poll(() => shortfall(testId)).toBeLessThanOrEqual(0.5);
    }
  }

  // And the layer covering the panel is the layer the pointer meets there: a
  // press a few pixels inside the edge lands on the wire plane, which is what
  // makes the band drawable rather than merely dotted. Measured inside the
  // page, against the panel as it stands at that moment, so a layout still
  // settling after the resize is retried rather than believed.
  await page.setViewportSize({ width: 2400, height: 700 });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const panel = document
          .querySelector('[data-testid="schematic-canvas"]')!
          .getBoundingClientRect();
        return document
          .elementsFromPoint(panel.x + 4, panel.y + panel.height * 0.8)
          .some(
            (element) =>
              element.getAttribute("data-testid") === "wire-input-plane",
          );
      }),
    )
    .toBe(true);
});
