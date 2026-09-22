import { expect, test } from "@playwright/test";

import {
  chooseComponent,
  expectComponentCodeField,
} from "./editor-fixtures.js";

// Full catalog projection/parse coverage lives in component-property-catalog.test.ts.
// These exercise distinct UI capabilities through placement, selection and Q:
// passive, model, waveform, variant, internal mark, formula, electrical marker,
// expanded-library device and independent magnetic parameter display.
const componentSymbolIds = [
  "resistor",
  "nmos",
  "pulse-voltage-source",
  "ideal-switch",
  "voltage-amplifier",
  "discrete-time-integrator",
  "vdd-port",
  "ndmos",
  "xfmr",
];

for (const symbolId of componentSymbolIds) {
  test(`${symbolId} uses the form-first component Properties surface`, async ({
    page,
  }) => {
    await page.goto("/editor");
    await chooseComponent(page, symbolId);
    const canvas = page.getByTestId("schematic-canvas");
    await canvas.click({ position: { x: 520, y: 350 } });
    await page.keyboard.press("Escape");

    const instance = page.locator('[data-canvas-hit-kind="instance"]');
    await expect(instance).toHaveCount(1);
    await instance.click();
    const shelf = page.getByTestId("selection-shelf");
    if ((await shelf.getAttribute("aria-expanded")) === "true") {
      await shelf.click();
    }
    await page.keyboard.press("q");

    const properties = page.getByRole("region", {
      name: "Component properties",
    });
    await expect(properties).toBeVisible();
    // Every component opens on typed controls; the JSON waits, collapsed.
    await expect(properties.locator(":scope > *").first()).toHaveAttribute(
      "aria-label",
      "Component placement",
    );
    await expect(
      properties.getByLabel("Editable Canvas property code"),
    ).toBeHidden();
    if (symbolId === "vdd-port") {
      await expectComponentCodeField(page, "connection", "cell-pin");
    }
    await expect(properties.locator(":scope > *").last()).toHaveAttribute(
      "aria-label",
      "Component property code",
    );
  });
}
