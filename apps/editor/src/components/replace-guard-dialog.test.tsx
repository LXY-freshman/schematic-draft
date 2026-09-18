import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ReplaceGuardDialog } from "./replace-guard-dialog";

describe("ReplaceGuardDialog", () => {
  it("states the consequence and names the file Save would write", () => {
    const html = renderToStaticMarkup(
      <ReplaceGuardDialog
        intent="Open OTA.icproj.json"
        openFilePath={"D:\\Circuits\\OTA.icproj.json"}
        saving={false}
        onCancel={vi.fn()}
        onSaveAndContinue={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    expect(html).toContain("Unsaved changes");
    expect(html).toContain("will drop your latest");
    // The copy names the target it was handed, never a store of its own.
    expect(html).toContain(
      "Save writes <code>D:\\Circuits\\OTA.icproj.json</code>",
    );
    expect(html).toContain("Save and continue");
    expect(html).toContain("Continue without saving");
    expect(html).toContain("Stay");
    expect(html).not.toContain("Browser recovery");
  });

  it("says Save will ask when the Project has no file, and locks up while saving", () => {
    const html = renderToStaticMarkup(
      <ReplaceGuardDialog
        intent="Create a new Project"
        openFilePath={null}
        saving={true}
        onCancel={vi.fn()}
        onSaveAndContinue={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    expect(html).toContain("it asks where to put it");
    expect(html).toContain("Saving…");
    expect(html).toContain("disabled");
  });
});
