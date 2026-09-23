import { afterEach, describe, expect, it, vi } from "vitest";

import {
  openProjectsFolder,
  readShellInstallInfo,
  setFileAssociation,
} from "./shell-commands";

/**
 * The editor's side of the commands the system menu bar used to hold. The
 * contract under test is the same one the file bridge has: outside the shell
 * nothing is asked, because `/api/shell/*` is a path a dev server answers with
 * a 404 the console keeps.
 */

function standIn(protocol: string): void {
  vi.stubGlobal("window", { location: { protocol } });
}

function answers(payload: unknown, ok = true): { calls: () => number } {
  const fetchMock = vi.fn(() =>
    Promise.resolve({
      ok,
      status: ok ? 200 : 404,
      json: () => Promise.resolve(payload),
    } as unknown as Response),
  );
  vi.stubGlobal("fetch", fetchMock);
  return { calls: () => fetchMock.mock.calls.length };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("shell commands", () => {
  it("reads where this installation keeps its files", async () => {
    standIn("app:");
    answers({
      projectsDirectory: "D:\\Schematic Draft\\Projects",
      settingsDirectory: "D:\\Schematic Draft\\AppData",
      selfContained: true,
      association: "on",
    });

    await expect(readShellInstallInfo()).resolves.toEqual({
      projectsDirectory: "D:\\Schematic Draft\\Projects",
      settingsDirectory: "D:\\Schematic Draft\\AppData",
      selfContained: true,
      association: "on",
    });
  });

  it("does not ask a browser, where nothing can answer", async () => {
    standIn("http:");
    const asked = answers({ projectsDirectory: "/tmp" });

    await expect(readShellInstallInfo()).resolves.toBeNull();
    await expect(openProjectsFolder()).resolves.toBe(false);
    await expect(setFileAssociation(true)).resolves.toBe("unavailable");
    expect(asked.calls()).toBe(0);
  });

  it("reports an answer it cannot use as no installation at all", async () => {
    // Half of About is worse than none: a missing path would render as an
    // empty row that looks like a place with no name.
    standIn("app:");
    answers({ projectsDirectory: "D:\\Projects" });
    await expect(readShellInstallInfo()).resolves.toBeNull();

    answers(null, false);
    await expect(readShellInstallInfo()).resolves.toBeNull();
  });

  it("treats an unrecognized association as not applying", async () => {
    standIn("app:");
    answers({
      projectsDirectory: "D:\\Projects",
      settingsDirectory: "D:\\AppData",
      selfContained: false,
      association: "maybe",
    });

    const info = await readShellInstallInfo();
    expect(info?.association).toBe("unavailable");
    expect(info?.selfContained).toBe(false);
  });

  it("passes on the association the shell reached, not the one requested", async () => {
    standIn("app:");
    answers({ status: "ok", association: "off" });
    await expect(setFileAssociation(true)).resolves.toBe("off");
  });
});
