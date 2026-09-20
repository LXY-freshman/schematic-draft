import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { CONTENT_TYPES_PART } from "./opc.js";
import {
  buildSymbolLibraryMasters,
  buildVisioStencilParts,
  packSymbolLibraryStencil,
  packVisioStencil,
} from "./stencil.js";

function readPackage(bytes: Uint8Array): Map<string, string> {
  const decoder = new TextDecoder();
  return new Map(
    Object.entries(unzipSync(bytes)).map(([path, content]) => [
      path,
      decoder.decode(content),
    ]),
  );
}

const symbolMasters = buildSymbolLibraryMasters();
const masters = symbolMasters.map((symbolMaster) => symbolMaster.master);
const parts = readPackage(packSymbolLibraryStencil());

describe("packVisioStencil", () => {
  it("declares a content type for every part and a part for every override", () => {
    const declared = parts.get(CONTENT_TYPES_PART) ?? "";
    const overrides = [...declared.matchAll(/PartName="\/([^"]+)"/g)].map(
      (match) => match[1] as string,
    );
    for (const override of overrides) {
      expect(parts.has(override)).toBe(true);
    }
    for (const path of parts.keys()) {
      if (path === CONTENT_TYPES_PART || path.endsWith(".rels")) continue;
      expect(overrides).toContain(path);
    }
  });

  it("opens as a stencil rather than a drawing", () => {
    expect(parts.get(CONTENT_TYPES_PART)).toContain(
      '<Override PartName="/visio/document.xml" ContentType="application/vnd.ms-visio.stencil.main+xml"/>',
    );
    // Nothing is drawn on a stencil's page, so it has no page contents part to
    // relate to.
    expect(parts.has("visio/pages/page1.xml")).toBe(false);
    expect(parts.get("visio/pages/pages.xml")).not.toContain("<Rel ");
  });

  it("resolves every relationship target to a part in the package", () => {
    for (const [path, content] of parts) {
      if (!path.endsWith(".rels")) continue;
      const base = path.slice(0, path.lastIndexOf("_rels/"));
      for (const match of content.matchAll(/Target="([^"]+)"/g)) {
        expect(parts.has(`${base}${match[1] as string}`)).toBe(true);
      }
    }
  });

  it("gives every catalog entry a master part to load its shapes from", () => {
    const catalog = parts.get("visio/masters/masters.xml") ?? "";
    const rels = parts.get("visio/masters/_rels/masters.xml.rels") ?? "";
    const targets = new Map(
      [...rels.matchAll(/Id="([^"]+)" Type="[^"]+" Target="([^"]+)"/g)].map(
        (match) => [match[1] as string, match[2] as string],
      ),
    );
    const referenced = [...catalog.matchAll(/<Rel r:id="([^"]+)"\/>/g)].map(
      (match) => match[1] as string,
    );

    expect(referenced).toHaveLength(masters.length);
    expect(new Set(referenced).size).toBe(masters.length);
    for (const id of referenced) {
      const target = targets.get(id);
      expect(target).toBeDefined();
      expect(parts.get(`visio/masters/${target as string}`)).toContain(
        "<MasterContents",
      );
    }
  });

  it("puts a master's shapes in its own part, starting at the reserved ID", () => {
    // Visio loads a master with no shapes at all when they start at 1: the
    // catalog entry survives and the artwork silently does not.
    for (const built of symbolMasters) {
      const part = parts.get(`visio/masters/master${built.master.id}.xml`);
      expect(part).toContain('<Shape ID="5"');
      expect(part).toContain(`NameU="${built.master.name}"`);
    }
  });

  it("produces the same bytes for the same library", () => {
    expect(Array.from(packSymbolLibraryStencil())).toEqual(
      Array.from(packSymbolLibraryStencil()),
    );
  });

  it("refuses a stencil with nothing in it", () => {
    expect(() => packVisioStencil({ masters: [] })).toThrow(/at least one/);
  });

  it("refuses masters Visio could not tell apart", () => {
    const [first] = masters;
    expect(first).toBeDefined();
    expect(() => buildVisioStencilParts({ masters: [first!, first!] })).toThrow(
      /Duplicate Visio master ID/,
    );
    expect(() =>
      buildVisioStencilParts({
        masters: [first!, { ...first!, id: first!.id + 1 }],
      }),
    ).toThrow(/Duplicate Visio master name/);
  });
});
