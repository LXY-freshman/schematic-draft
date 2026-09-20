import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { createFormalExportSource } from "../packages/exporters/dist/index.js";
import { exportFormalArtifacts } from "../packages/exporters/dist/node.js";
import { parseProject } from "../packages/project-protocol/dist/index.js";
import {
  InMemorySymbolResolver,
  builtInSymbols,
} from "../packages/symbols/dist/index.js";
import {
  buildVisioDrawingParts,
  packVisioDrawing,
  visioDrawingForDocument,
} from "../packages/visio/dist/index.js";

const check = process.argv.includes("--check");
const fixtureRoot = resolve("fixtures/exports/phase-7-dense-analog");
/** Where the Visio package's parts are written out, one file per OPC part. */
const partDirectory = "vsdx";
const project = parseProject(
  await readFile(
    resolve("fixtures/projects/phase-5-dense-analog/project.icproj.json"),
    "utf8",
  ),
);
const document = project.documents.find(
  (candidate) => candidate.id === project.topDocumentId,
);
if (!document) throw new Error("Dense analog top Document is missing");
const resolver = new InMemorySymbolResolver(builtInSymbols);
const source = createFormalExportSource(document, resolver, {
  title: project.name,
});
const artifacts = await exportFormalArtifacts(source, 3);

// The Visio drawing is a sibling projection rather than a rendering of the SVG,
// so it is built from the Document again. The title override matches what the
// editor's own command does, so the golden is the file a user would get.
const visio = visioDrawingForDocument(document, resolver);
const drawing = { ...visio.drawing, title: project.name };
const visioParts = buildVisioDrawingParts(drawing);

const outputs = {
  "schematic.svg": artifacts.svg,
  "schematic.png": artifacts.png.bytes,
  "schematic.pdf": artifacts.pdf,
  "schematic.vsdx": packVisioDrawing(drawing),
};
/**
 * Renders a part one element per line.
 *
 * The package writes each part as a single line, which is right for the file
 * and useless for review: a page part is 13 kB of it, and every change reads
 * as "the line changed". Breaking only where a `>` already abuts a `<` leaves
 * text content — including the newlines inside an annotation — exactly where
 * it was, so an element never gains or loses characters of its own.
 */
function renderPartForReview(content) {
  const lines = content.split(/(?<=>)(?=<)/u);
  let depth = 0;
  return `${lines
    .map((line) => {
      if (line.startsWith("</")) depth -= 1;
      const indented = `${"  ".repeat(Math.max(depth, 0))}${line}`;
      const opensAnElement =
        !line.startsWith("</") &&
        !line.startsWith("<?") &&
        !line.endsWith("/>") &&
        !/<\/[^<>]+>$/u.test(line);
      if (opensAnElement) depth += 1;
      return indented;
    })
    .join("\n")}\n`;
}

/**
 * The same parts, unpacked and indented.
 *
 * A `.vsdx` is a deflated zip, so its bytes diff as noise: a pin that moved a
 * grid step and a wire end that lost its glue record look exactly alike. These
 * are what a reviewer actually reads, and they come from the same call that
 * packs the file, so they cannot drift from it. The manifest still hashes the
 * packed part rather than this rendering, so the indentation can never stand
 * between a content change and a failing check.
 */
const unpacked = Object.fromEntries(
  visioParts.map((part) => {
    const rendered = renderPartForReview(part.content);
    // Removing what was inserted has to give the part back. If a part ever
    // carries its own newline between two tags the rendering stops being
    // reversible, and this says so instead of quietly losing the difference.
    if (rendered.replaceAll(/>\n\s*(?=<)/gu, ">").slice(0, -1) !== part.content)
      throw new Error(`Visio part ${part.path} did not survive rendering`);
    return [`${partDirectory}/${part.path}`, Buffer.from(rendered, "utf8")];
  }),
);

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const describe = (bytes) => ({
  byteLength: bytes.byteLength,
  sha256: sha256(bytes),
});
const countByKind = (caveats) => {
  const counts = {};
  for (const caveat of caveats)
    counts[caveat.kind] = (counts[caveat.kind] ?? 0) + 1;
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) =>
      left.localeCompare(right, "en"),
    ),
  );
};

const manifest = Buffer.from(
  `${JSON.stringify(
    {
      version: "0.2.0",
      sourceProject:
        "fixtures/projects/phase-5-dense-analog/project.icproj.json",
      bounds: source.bounds,
      raster: {
        scale: 3,
        width: artifacts.png.width,
        height: artifacts.png.height,
      },
      files: Object.fromEntries(
        Object.entries(outputs).map(([name, bytes]) => [name, describe(bytes)]),
      ),
      visio: {
        page: visio.page.page,
        masterCount: visio.page.masters.length,
        // Shape and glue counts are the drawing's editability in one line: a
        // change that silently stops gluing wire ends shows up here before
        // anyone has to read the page XML.
        counts: visio.page.counts,
        caveats: countByKind(visio.page.caveats),
        parts: Object.fromEntries(
          visioParts.map((part) => [
            `${partDirectory}/${part.path}`,
            describe(Buffer.from(part.content, "utf8")),
          ]),
        ),
      },
    },
    null,
    2,
  )}\n`,
);
const written = { ...outputs, ...unpacked, "manifest.json": manifest };

async function listPartFiles() {
  const entries = await readdir(resolve(fixtureRoot, partDirectory), {
    recursive: true,
    withFileTypes: true,
  }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      resolve(entry.parentPath, entry.name)
        .slice(resolve(fixtureRoot).length + 1)
        .replaceAll("\\", "/"),
    );
}

if (check) {
  // A part that disappeared would otherwise pass unnoticed: its stale file
  // stays on disk and nothing compares it. The manifest would catch it, but
  // not by name.
  const stale = (await listPartFiles()).filter((name) => !(name in written));
  if (stale.length > 0)
    throw new Error(`Export golden has stale Visio parts: ${stale.join(", ")}`);
  for (const [name, bytes] of Object.entries(written)) {
    const expected = await readFile(resolve(fixtureRoot, name));
    if (!expected.equals(Buffer.from(bytes)))
      throw new Error(`Export golden differs: ${name}`);
  }
  process.stdout.write("Phase 7 export goldens match.\n");
} else {
  // The part directory holds nothing but generated files, so it is rebuilt
  // rather than merged into; otherwise a renamed part lingers forever.
  await rm(resolve(fixtureRoot, partDirectory), {
    recursive: true,
    force: true,
  });
  await mkdir(fixtureRoot, { recursive: true });
  for (const [name, bytes] of Object.entries(written)) {
    const target = resolve(fixtureRoot, name);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  process.stdout.write(`${fixtureRoot}\n`);
}
