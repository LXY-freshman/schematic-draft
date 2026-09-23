import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { APP_ORIGIN, createAppProtocolHandler } from "./app-protocol.js";
import type { ShellCommandPorts } from "./shell-commands.js";
import {
  steppedZoomLevel,
  windowCommand,
  ZOOM_LEVEL_LIMIT,
  type KeyChord,
} from "./window-shortcuts.js";

/**
 * The shell's own commands, which used to be a system menu bar.
 *
 * The routes are exercised through the protocol handler rather than in
 * isolation, because "the editor can reach this" is the claim: the same
 * handler that refuses an unknown API path has to answer these.
 */

const NO_DIALOGS = {
  promptOpen: () => Promise.resolve(null),
  promptOpenMany: () => Promise.resolve(null),
  promptSave: () => Promise.resolve(null),
};

async function editorRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "sd-shell-"));
  await writeFile(
    join(root, "index.html"),
    "<!doctype html><html><head></head><body></body></html>",
  );
  return root;
}

async function shell(ports: Partial<ShellCommandPorts> = {}) {
  const opened: string[] = [];
  const associationCalls: boolean[] = [];
  const handle = await createAppProtocolHandler({
    editorRoot: await editorRoot(),
    dialogs: NO_DIALOGS,
    shell: {
      projectsDirectory: () => "D:\\Schematic Draft\\Projects",
      settingsDirectory: () => "D:\\Schematic Draft\\AppData",
      selfContained: () => true,
      associationState: () => Promise.resolve("on"),
      setAssociation: (enabled) => {
        associationCalls.push(enabled);
        return Promise.resolve(enabled ? "on" : "off");
      },
      openFolder: (path) => {
        opened.push(path);
        return Promise.resolve("");
      },
      ...ports,
    },
  });
  const post = (path: string, body?: unknown) =>
    handle(
      new Request(`${APP_ORIGIN}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  return { handle, post, opened, associationCalls };
}

describe("shell commands", () => {
  it("reports where this installation keeps its files", async () => {
    const { post } = await shell();
    const response = await post("/api/shell/info");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      projectsDirectory: "D:\\Schematic Draft\\Projects",
      settingsDirectory: "D:\\Schematic Draft\\AppData",
      selfContained: true,
      association: "on",
    });
  });

  it("says the association does not apply rather than saying it is off", async () => {
    // A development run writes nothing to the registry. Reporting `off` would
    // offer a switch that cannot do anything; `unavailable` hides it.
    const { post } = await shell({
      associationState: () => Promise.resolve("unavailable"),
    });

    const info = (await (await post("/api/shell/info")).json()) as {
      association: string;
    };
    expect(info.association).toBe("unavailable");
  });

  it("opens the Projects folder it reports, not a path it was handed", async () => {
    const { post, opened } = await shell();
    const response = await post("/api/shell/open-projects-folder");

    expect(await response.json()).toEqual({
      status: "opened",
      path: "D:\\Schematic Draft\\Projects",
    });
    expect(opened).toEqual(["D:\\Schematic Draft\\Projects"]);
  });

  it("reports a folder Explorer would not open", async () => {
    const { post } = await shell({
      openFolder: () => Promise.resolve("The folder is gone"),
    });
    const response = await post("/api/shell/open-projects-folder");

    expect(await response.json()).toEqual({
      status: "failed",
      message: "The folder is gone",
    });
  });

  it("answers the association state Windows reached, not the one asked for", async () => {
    const { post, associationCalls } = await shell();
    expect(
      await (
        await post("/api/shell/set-association", { enabled: false })
      ).json(),
    ).toEqual({ status: "ok", association: "off" });
    expect(associationCalls).toEqual([false]);

    // A refused registry write is the case this exists for: the editor shows
    // what is true, so its checkbox snaps back rather than lying.
    const refused = await shell({
      setAssociation: () => Promise.resolve("off"),
    });
    expect(
      await (
        await refused.post("/api/shell/set-association", { enabled: true })
      ).json(),
    ).toEqual({ status: "ok", association: "off" });
  });

  it("refuses a request that does not say what it wants", async () => {
    const { post } = await shell();

    expect((await post("/api/shell/set-association")).status).toBe(400);
    expect(
      (await post("/api/shell/set-association", { enabled: "yes" })).status,
    ).toBe(400);
  });

  it("refuses a GET and does not invent routes", async () => {
    const { handle, post } = await shell();

    const read = await handle(new Request(`${APP_ORIGIN}/api/shell/info`));
    expect(read.status).toBe(405);
    expect((await post("/api/shell/quit")).status).toBe(404);
  });

  it("answers nothing about the shell when no shell is behind it", async () => {
    // The protocol handler is also built in tests and could be built by a
    // future caller without these ports; the API must 404 rather than throw.
    const handle = await createAppProtocolHandler({
      editorRoot: await editorRoot(),
      dialogs: NO_DIALOGS,
    });

    const response = await handle(
      new Request(`${APP_ORIGIN}/api/shell/info`, { method: "POST" }),
    );
    expect(response.status).toBe(404);
  });
});

const press = (chord: Partial<KeyChord>): KeyChord => ({
  type: "keyDown",
  key: "a",
  control: false,
  shift: false,
  alt: false,
  meta: false,
  ...chord,
});

describe("window shortcuts", () => {
  it("matches the chords the View menu used to own", () => {
    expect(windowCommand(press({ key: "0", control: true }))).toBe(
      "zoom-reset",
    );
    expect(windowCommand(press({ key: "=", control: true }))).toBe("zoom-in");
    expect(windowCommand(press({ key: "-", control: true }))).toBe("zoom-out");
    expect(windowCommand(press({ key: "F11" }))).toBe("fullscreen");
    expect(windowCommand(press({ key: "I", control: true, shift: true }))).toBe(
      "devtools",
    );
  });

  it("takes the shifted plus, because that is what the key gives", () => {
    // On most layouts `Ctrl +` arrives as Ctrl, Shift and `+`. Requiring an
    // unshifted `=` would leave the chord people actually press unmatched.
    expect(windowCommand(press({ key: "+", control: true, shift: true }))).toBe(
      "zoom-in",
    );
    expect(windowCommand(press({ key: "_", control: true, shift: true }))).toBe(
      "zoom-out",
    );
  });

  it("leaves the editor's own keys alone", () => {
    // Every one of these reaches the page: the schematic owns single letters,
    // and nothing here may swallow one.
    for (const key of ["I", "W", "Q", "F", "R", "U", "T", "P"]) {
      expect(windowCommand(press({ key }))).toBeNull();
    }
    expect(windowCommand(press({ key: "0" }))).toBeNull();
    expect(windowCommand(press({ key: "-" }))).toBeNull();
    expect(windowCommand(press({ key: "=", control: true, alt: true }))).toBe(
      null,
    );
    expect(windowCommand(press({ key: "F11", control: true }))).toBeNull();
    // Key-up repeats the same chord; acting twice would zoom twice per press.
    expect(
      windowCommand(press({ key: "0", control: true, type: "keyUp" })),
    ).toBeNull();
  });

  it("steps the window zoom and stops at a level that can be read", () => {
    expect(steppedZoomLevel(0, "zoom-in")).toBe(0.5);
    expect(steppedZoomLevel(0.5, "zoom-out")).toBe(0);
    expect(steppedZoomLevel(3, "zoom-reset")).toBe(0);
    // Without a menu there is no chrome left to undo an unreadable zoom with,
    // so the limit is the way back.
    expect(steppedZoomLevel(ZOOM_LEVEL_LIMIT, "zoom-in")).toBe(
      ZOOM_LEVEL_LIMIT,
    );
    expect(steppedZoomLevel(-ZOOM_LEVEL_LIMIT, "zoom-out")).toBe(
      -ZOOM_LEVEL_LIMIT,
    );
    expect(steppedZoomLevel(0, "fullscreen")).toBeNull();
  });
});
