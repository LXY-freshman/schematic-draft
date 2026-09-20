import { expect, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  awaitEditorReady,
  clickCommand,
  downloadBytes,
} from "./editor-fixtures.js";

/**
 * The Visio export from the menu down to the bytes that leave the browser.
 *
 * The package's own tests already say what the XML has to contain; what only a
 * real editor can show is that the command is reachable, that the lazily loaded
 * chunk arrives, and that the file the browser hands over is the one the page
 * built. The circuit is the five-transistor OTA because that is the drawing the
 * export has to survive: five devices, a current mirror, and wires that have to
 * stay attached when someone drags a transistor in Visio.
 */
const OTA = resolve(
  process.cwd(),
  "apps/editor/src/examples/five-transistor-ota-sky130.icproj.json",
);

test("exports the open Document as a Visio drawing, and the symbols as a stencil", async ({
  page,
}) => {
  await page.goto("/editor");
  await awaitEditorReady(page);
  await page.getByTestId("project-file").setInputFiles({
    name: "five-transistor-ota-sky130.icproj.json",
    mimeType: "application/json",
    buffer: readFileSync(OTA),
  });
  await expect(page.getByTestId("status")).toContainText(
    "five-transistor-ota-sky130.icproj.json",
  );

  const drawing = await downloadBytes(page, "File", "Export Visio");
  expect(drawing.subarray(0, 4).toString("latin1")).toBe("PK");
  const parts = unzipSync(new Uint8Array(drawing));
  expect(Object.keys(parts)).toEqual(
    expect.arrayContaining([
      "[Content_Types].xml",
      "_rels/.rels",
      "visio/document.xml",
      "visio/masters/masters.xml",
      "visio/pages/pages.xml",
      "visio/pages/page1.xml",
    ]),
  );
  const pageXml = strFromU8(parts["visio/pages/page1.xml"]!);
  // Every transistor is an instance of a master rather than loose geometry,
  // and every wire end is recorded as glued to the pin it lands on. Those two
  // together are the whole point of exporting a drawing instead of a picture.
  expect(pageXml).toContain('Master="');
  expect(
    [...pageXml.matchAll(/<Connect\b/gu)].length,
    "no glued wire ends",
  ).toBeGreaterThan(0);
  await expect(page.getByTestId("status")).toContainText(
    "Exported Visio revision",
  );

  // The stencil carries the same masters with no page drawn on, and is named
  // for the library rather than the circuit that happened to be open.
  const stencilDownload = page.waitForEvent("download");
  await clickCommand(page, "File", "Export Visio stencil");
  const stencil = await stencilDownload;
  expect(stencil.suggestedFilename()).toBe("schematic-draft-symbols.vssx");
  const stencilParts = unzipSync(
    new Uint8Array(await readDownload(stencil.createReadStream())),
  );
  expect(strFromU8(stencilParts["[Content_Types].xml"]!)).toContain(
    "application/vnd.ms-visio.stencil.main+xml",
  );
  expect(stencilParts["visio/pages/page1.xml"]).toBeUndefined();
  await expect(page.getByTestId("status")).toContainText(
    "Exported the Visio symbol stencil",
  );
});

async function readDownload(
  stream: Promise<NodeJS.ReadableStream>,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of await stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
