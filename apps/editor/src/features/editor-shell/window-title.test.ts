import { describe, expect, it } from "vitest";

import { formatWindowTitle } from "./window-title";

describe("window title", () => {
  it("names the bound file, extension included", () => {
    // The caption names the FILE, while the toolbar names the Project. The
    // extension is part of that: a `.schdraft` and a legacy `.icproj` of the
    // same circuit are two different files on disk.
    expect(
      formatWindowTitle({
        filePath: "C:\\Users\\me\\Documents\\Schematic Draft\\filter.schdraft",
        projectName: "filter",
        dirty: false,
      }),
    ).toBe("filter.schdraft — Schematic Draft");
    expect(
      formatWindowTitle({
        filePath: "/home/me/Projects/filter.icproj.json",
        projectName: "filter",
        dirty: false,
      }),
    ).toBe("filter.icproj.json — Schematic Draft");
  });

  it("marks work the file on disk does not have", () => {
    expect(
      formatWindowTitle({
        filePath: "D:\\work\\ota.schdraft",
        projectName: "ota",
        dirty: true,
      }),
    ).toBe("ota.schdraft * — Schematic Draft");
  });

  it("falls back to the Project name while nothing is bound", () => {
    // A new drawing has never reached a file, so there is no file name to
    // show; the Project name is what the user has been typing at.
    expect(
      formatWindowTitle({
        filePath: null,
        projectName: "Low-pass filter",
        dirty: true,
      }),
    ).toBe("Low-pass filter * — Schematic Draft");
    expect(
      formatWindowTitle({
        filePath: null,
        projectName: "Low-pass filter",
        dirty: false,
      }),
    ).toBe("Low-pass filter — Schematic Draft");
  });

  it("is titled after the product when there is no name at all", () => {
    // An empty Project name is reachable: the toolbar field can be cleared.
    // "  * — Schematic Draft" would be worse than saying nothing.
    expect(
      formatWindowTitle({ filePath: null, projectName: "", dirty: false }),
    ).toBe("Schematic Draft");
    expect(
      formatWindowTitle({ filePath: null, projectName: "   ", dirty: true }),
    ).toBe("Schematic Draft");
  });

  it("does not mistake a directory separator for part of the name", () => {
    // A path with no separator is already a bare file name.
    expect(
      formatWindowTitle({
        filePath: "filter.schdraft",
        projectName: "ignored",
        dirty: false,
      }),
    ).toBe("filter.schdraft — Schematic Draft");
  });
});
