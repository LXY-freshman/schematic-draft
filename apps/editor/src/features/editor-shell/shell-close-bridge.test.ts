import { describe, expect, it } from "vitest";

import {
  installShellCloseBridge,
  SHELL_CLOSE_BRIDGE_KEY,
  type ShellCloseBridge,
} from "./shell-close-bridge";

function fakeWindow(): Window {
  return {} as unknown as Window;
}

const BRIDGE: ShellCloseBridge = {
  unsavedWork: () => ({ dirty: false, name: "Circuit", path: null }),
  save: () => Promise.resolve({ status: "saved" }),
};

describe("shell close bridge", () => {
  it("publishes the bridge under the name the shell evaluates", () => {
    const target = fakeWindow();
    installShellCloseBridge(target, BRIDGE);
    expect(target[SHELL_CLOSE_BRIDGE_KEY]).toBe(BRIDGE);
    // The key the main process interpolates into its script must not drift
    // from the one installed here; see `apps/desktop/src/close-guard.ts`.
    expect(SHELL_CLOSE_BRIDGE_KEY).toBe("__schematicDraftShell");
  });

  it("removes only its own bridge on teardown", () => {
    const target = fakeWindow();
    const uninstall = installShellCloseBridge(target, BRIDGE);
    uninstall();
    expect(target[SHELL_CLOSE_BRIDGE_KEY]).toBeUndefined();

    installShellCloseBridge(target, BRIDGE);
    const later: ShellCloseBridge = { ...BRIDGE };
    installShellCloseBridge(target, later);
    // A remount installs before the old effect tears down; the newer editor
    // must keep answering.
    uninstall();
    expect(target[SHELL_CLOSE_BRIDGE_KEY]).toBe(later);
  });
});
