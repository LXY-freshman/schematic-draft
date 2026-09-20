import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { CONTENT_TYPES_PART, packOpcPackage } from "./opc.js";
import {
  DEFAULT_PAGE_NAME,
  buildVisioDrawingParts,
  packVisioDrawing,
} from "./drawing.js";
import { buildSymbolLibraryMasters } from "./stencil.js";
import { VISIO_NAMESPACE } from "./xml.js";

const page = {
  name: DEFAULT_PAGE_NAME,
  widthInches: 11,
  heightInches: 8.5,
};

function readPackage(bytes: Uint8Array): Map<string, string> {
  const decoder = new TextDecoder();
  const entries = unzipSync(bytes);
  return new Map(
    Object.entries(entries).map(([path, content]) => [
      path,
      decoder.decode(content),
    ]),
  );
}

describe("packOpcPackage", () => {
  it("refuses a package without a content type manifest", () => {
    expect(() =>
      packOpcPackage([{ path: "visio/document.xml", content: "<a/>" }]),
    ).toThrow(/\[Content_Types\]\.xml/);
  });

  it("refuses duplicate and absolute part paths", () => {
    const manifest = { path: CONTENT_TYPES_PART, content: "<Types/>" };
    expect(() => packOpcPackage([manifest, manifest])).toThrow(/Duplicate/);
    expect(() =>
      packOpcPackage([manifest, { path: "/visio/a.xml", content: "<a/>" }]),
    ).toThrow(/package-relative/);
  });

  it("writes the content type manifest as the first entry", () => {
    const bytes = packOpcPackage([
      { path: "visio/document.xml", content: "<a/>" },
      { path: CONTENT_TYPES_PART, content: "<Types/>" },
    ]);
    const firstEntryName = new TextDecoder().decode(
      bytes.slice(30, 30 + CONTENT_TYPES_PART.length),
    );
    expect(firstEntryName).toBe(CONTENT_TYPES_PART);
  });
});

describe("packVisioDrawing", () => {
  it("writes every part a drawing declares", () => {
    const parts = readPackage(packVisioDrawing({ page }));
    const declared = parts.get(CONTENT_TYPES_PART) ?? "";
    const overrides = [...declared.matchAll(/PartName="\/([^"]+)"/g)].map(
      (match) => match[1],
    );

    expect([...parts.keys()].sort()).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "docProps/core.xml",
      "visio/_rels/document.xml.rels",
      "visio/document.xml",
      "visio/pages/_rels/pages.xml.rels",
      "visio/pages/page1.xml",
      "visio/pages/pages.xml",
      "visio/windows.xml",
    ]);
    for (const override of overrides) {
      expect(parts.has(override as string)).toBe(true);
    }
  });

  it("resolves every relationship target to a part in the package", () => {
    const parts = readPackage(packVisioDrawing({ page }));
    for (const [path, content] of parts) {
      if (!path.endsWith(".rels")) continue;
      const base = path.slice(0, path.lastIndexOf("_rels/"));
      for (const match of content.matchAll(/Target="([^"]+)"/g)) {
        expect(parts.has(`${base}${match[1]}`)).toBe(true);
      }
    }
  });

  it("uses the desktop Visio namespace in every Visio part", () => {
    const parts = readPackage(packVisioDrawing({ page }));
    for (const path of ["visio/document.xml", "visio/pages/pages.xml"]) {
      expect(parts.get(path)).toContain(`xmlns="${VISIO_NAMESPACE}"`);
    }
    expect(parts.get("visio/pages/page1.xml")).toContain(
      `xmlns="${VISIO_NAMESPACE}"`,
    );
  });

  it("sizes the page as asked and starts it empty", () => {
    const parts = readPackage(packVisioDrawing({ page }));
    expect(parts.get("visio/pages/pages.xml")).toContain(
      '<Cell N="PageWidth" V="11"/><Cell N="PageHeight" V="8.5"/>',
    );
    expect(parts.get("visio/pages/page1.xml")).toMatch(
      /<PageContents[^>]*><\/PageContents>$/,
    );
  });

  it("produces the same bytes for the same drawing", () => {
    const first = packVisioDrawing({ page });
    const second = packVisioDrawing({ page });
    expect(Array.from(second)).toEqual(Array.from(first));
  });

  it("rejects a page that cannot be drawn on", () => {
    expect(() =>
      packVisioDrawing({ page: { ...page, widthInches: 0 } }),
    ).toThrow(/positive dimensions/);
    expect(() => packVisioDrawing({ page: { ...page, name: " " } })).toThrow(
      /needs a name/,
    );
  });

  it("carries masters only when the drawing has some", () => {
    const bare = readPackage(packVisioDrawing({ page }));
    expect([...bare.keys()].some((path) => path.includes("masters"))).toBe(
      false,
    );
    expect(bare.get("visio/_rels/document.xml.rels")).not.toContain("masters");

    const [master] = buildSymbolLibraryMasters().map((built) => built.master);
    const stocked = readPackage(packVisioDrawing({ page, masters: [master!] }));
    expect(stocked.has("visio/masters/masters.xml")).toBe(true);
    expect(stocked.has(`visio/masters/master${master!.id}.xml`)).toBe(true);
    expect(stocked.get("visio/_rels/document.xml.rels")).toContain(
      'Target="masters/masters.xml"',
    );
    // The page still exists to be drawn on, unlike a stencil's.
    expect(stocked.has("visio/pages/page1.xml")).toBe(true);
  });

  it("titles the document after the page unless told otherwise", () => {
    const [, , defaulted] = buildVisioDrawingParts({ page });
    const [, , titled] = buildVisioDrawingParts({ page, title: "Bandgap" });
    expect(defaulted?.content).toContain(
      `<dc:title>${DEFAULT_PAGE_NAME}</dc:title>`,
    );
    expect(titled?.content).toContain("<dc:title>Bandgap</dc:title>");
  });
});
