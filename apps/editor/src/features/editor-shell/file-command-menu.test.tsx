import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { FileCommandMenu } from "./file-command-menu";

const handlers = {
  onNewProject: vi.fn(),
  onOpenProject: vi.fn(),
  onSave: vi.fn(),
  onSaveAs: vi.fn(),
  onRefresh: vi.fn(),
  onImportProject: vi.fn(),
  onImportSpice: vi.fn(),
  onExportSvg: vi.fn(),
  onExportRaster: vi.fn(),
  onExportVisio: vi.fn(),
  onRevert: vi.fn(),
  onOpenRecovery: vi.fn(),
};

describe("FileCommandMenu", () => {
  it("offers one file protocol: open, save in place, save a copy", () => {
    const markup = renderToStaticMarkup(
      <FileCommandMenu
        openFilePath={"D:\\Circuits\\Low-pass filter.icproj.json"}
        canRevert
        hasRecoverySessions
        projectInputRef={createRef<HTMLInputElement>()}
        {...handlers}
      />,
    );

    expect(markup).toContain("Open Project…");
    expect(markup).toContain("Save As…");
    // Save names its target, so overwriting in place is never a guess.
    expect(markup).toContain(
      "Save to D:\\Circuits\\Low-pass filter.icproj.json",
    );
    expect(markup).toContain("Import Project File…");
    expect(markup).toContain("Import SPICE / SCS…");
    expect(markup).toContain("Import Cadence SPICE (`!` globals)…");
    expect(markup).toContain('data-testid="cadence-spice-files"');
    expect(markup).toContain("Recover Local Work…");
    // The drawing submenu offers the Visio file and the stencil beside it: the
    // drawing alone only lets someone rearrange the devices already placed.
    expect(markup).toContain('aria-label="Export Visio"');
    expect(markup).toContain('aria-label="Export Visio stencil"');
    expect(markup).not.toContain("Cloud");
    expect(markup).not.toContain("Export Project File…");
  });

  it("asks where to save a Project that has no file yet", () => {
    const markup = renderToStaticMarkup(
      <FileCommandMenu
        openFilePath={null}
        canRevert={false}
        hasRecoverySessions={false}
        projectInputRef={createRef<HTMLInputElement>()}
        {...handlers}
      />,
    );

    expect(markup).toContain("Choose where to save this Project");
    expect(markup).not.toContain("Recover Local Work…");
  });
});
