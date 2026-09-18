import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  RecoveryAvailableBanner,
  recoveryStateLabel,
} from "./recovery-banners";

describe("recovery banners", () => {
  it("keeps normal recovery writes silent and exposes only failures", () => {
    expect(recoveryStateLabel("idle")).toBeNull();
    expect(recoveryStateLabel("pending")).toBeNull();
    expect(recoveryStateLabel("stored")).toBeNull();
    expect(recoveryStateLabel("failed")).toContain("failed");
  });

  it("offers non-modal restore, save-a-copy, and ignore actions", () => {
    const html = renderToStaticMarkup(
      <RecoveryAvailableBanner
        projectName="OTA"
        updatedAt="2026-08-28T08:30:00.000Z"
        onRestore={vi.fn()}
        onSaveCopy={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(html).toContain("startup-recovery-banner");
    expect(html).toContain("OTA");
    expect(html).toContain("Restore");
    expect(html).toContain("Save a copy…");
    expect(html).toContain("Ignore");
    expect(html).not.toContain('role="dialog"');
  });
});
