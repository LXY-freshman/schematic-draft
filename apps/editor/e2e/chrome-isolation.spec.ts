import { expect, test } from "@playwright/test";

import { chooseComponent } from "./editor-fixtures.js";

test("keeps editor chrome typography from suppressing SVG italics", async ({
  page,
}) => {
  await page.goto("/editor");

  await chooseComponent(page, "resistor");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 320, y: 220 } });

  const italicRun = page
    .getByTestId("schematic-canvas")
    .locator('[data-text-run="span"][font-style="italic"]')
    .first();
  await expect(italicRun).toBeVisible();
  await expect(italicRun).toHaveCSS("font-style", "italic");
  expect(
    await italicRun.evaluate((element) =>
      getComputedStyle(element).getPropertyValue("font-synthesis"),
    ),
  ).not.toBe("none");
});

test("dismisses Help with Escape or a backdrop pointer", async ({ page }) => {
  await page.goto("/editor");
  const help = page.getByRole("dialog", { name: "Help" });

  await page.getByRole("button", { name: "Help" }).click();
  await expect(help).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(help).toHaveCount(0);

  await page.getByRole("button", { name: "Help" }).click();
  await expect(help).toBeVisible();
  await page.locator(".help-backdrop").click({ position: { x: 4, y: 4 } });
  await expect(help).toHaveCount(0);
});

test("carries the version and project resource links inside Help", async ({
  page,
}) => {
  await page.goto("/editor");
  // About and Help said the same thing from two entries; About now lives as a
  // section of Help.
  await expect(page.getByRole("button", { name: "About" })).toHaveCount(0);
  await page.getByRole("button", { name: "Help" }).click();

  const about = page.getByRole("dialog");
  await expect(about).toContainText("About Schematic Draft");
  await expect(about).toContainText("Version 1.3.2");
  // The only outbound links are credit for the upstream project this build
  // forks; nothing here reaches a service the application depends on.
  const repositoryLink = about.getByRole("link", {
    name: "Upstream repository",
  });
  await expect(repositoryLink).toHaveAttribute(
    "href",
    "https://github.com/cascode-ai/analog-canvas",
  );
  await expect(repositoryLink).toHaveAttribute("target", "_blank");
  await expect(about.getByRole("link", { name: "Change Log" })).toHaveAttribute(
    "href",
    "https://github.com/cascode-ai/analog-canvas/commits/main",
  );
  await page.keyboard.press("Escape");
  await expect(about).toHaveCount(0);
});

test("keeps toolbar tooltips inside the window at both ends", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 720 });
  await page.goto("/editor");

  // Gallery leads the toolbar and Project Code ends it, so their tooltips are
  // the two that a centred placement pushes out of the window — where they are
  // clipped away rather than scrolled to, leaving the button unexplained.
  for (const testId of ["examples-toggle", "project-code-toggle"]) {
    await page.getByTestId(testId).hover();
    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toBeVisible();
    const box = await tooltip.boundingBox();
    if (!box) throw new Error(`The ${testId} tooltip is not measurable`);
    expect(box.width).toBeGreaterThan(0);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(1024);
    // Still an explanation of the button it belongs to, not a box parked in a
    // corner: it stays within its own width of the button it points at.
    const button = await page.getByTestId(testId).boundingBox();
    if (!button) throw new Error(`The ${testId} button is not measurable`);
    expect(
      Math.abs(box.x + box.width / 2 - (button.x + button.width / 2)),
    ).toBeLessThanOrEqual(box.width);
    expect(box.y).toBeGreaterThanOrEqual(button.y + button.height);
    await page.mouse.move(512, 600);
    await expect(page.getByRole("tooltip")).toHaveCount(0);
  }
});
