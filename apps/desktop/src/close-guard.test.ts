import { describe, expect, it } from "vitest";

import {
  closeAnswerFromButton,
  closePrompt,
  CLOSE_BUTTONS,
  CLOSE_CANCEL_BUTTON,
  CLOSE_DEFAULT_BUTTON,
  decideClose,
  READ_UNSAVED_WORK_SCRIPT,
  REQUEST_SAVE_SCRIPT,
  saveAttempt,
  saveFailureNotice,
  unsavedWorkState,
  type CloseAnswer,
  type CloseGuardPorts,
  type SaveAttempt,
  type UnsavedWorkState,
} from "./close-guard.js";

const DIRTY: UnsavedWorkState = {
  dirty: true,
  name: "Two Stage Amp",
  path: "D:\\Projects\\amp.icproj.json",
};

interface StubPorts extends CloseGuardPorts {
  asked: UnsavedWorkState[];
  saves: number;
  failures: string[];
}

function stubPorts(script: {
  state?: UnsavedWorkState | null;
  readState?: () => Promise<UnsavedWorkState | null>;
  answer?: CloseAnswer;
  ask?: () => Promise<CloseAnswer>;
  save?: SaveAttempt | (() => Promise<SaveAttempt>);
}): StubPorts {
  const ports: StubPorts = {
    asked: [],
    saves: 0,
    failures: [],
    readState:
      script.readState ?? (() => Promise.resolve(script.state ?? null)),
    ask: (state) => {
      ports.asked.push(state);
      return script.ask?.() ?? Promise.resolve(script.answer ?? "cancel");
    },
    save: () => {
      ports.saves += 1;
      if (typeof script.save === "function") return script.save();
      return Promise.resolve(script.save ?? { status: "saved" });
    },
    reportFailure: (message) => {
      ports.failures.push(message);
      return Promise.resolve();
    },
  };
  return ports;
}

describe("decideClose", () => {
  it("closes a clean window without asking", async () => {
    const ports = stubPorts({ state: { ...DIRTY, dirty: false } });
    expect(await decideClose(ports)).toBe("close");
    expect(ports.asked).toEqual([]);
    expect(ports.saves).toBe(0);
  });

  it("closes when the editor cannot be asked", async () => {
    const unreachable = stubPorts({ state: null });
    expect(await decideClose(unreachable)).toBe("close");

    const broken = stubPorts({
      readState: () => Promise.reject(new Error("render process gone")),
    });
    expect(await decideClose(broken)).toBe("close");
    expect(broken.asked).toEqual([]);
  });

  it("stays when the person cancels", async () => {
    const ports = stubPorts({ state: DIRTY, answer: "cancel" });
    expect(await decideClose(ports)).toBe("stay");
    expect(ports.asked).toEqual([DIRTY]);
    expect(ports.saves).toBe(0);
  });

  it("closes without saving when the person discards", async () => {
    const ports = stubPorts({ state: DIRTY, answer: "discard" });
    expect(await decideClose(ports)).toBe("close");
    expect(ports.saves).toBe(0);
  });

  it("saves, then closes", async () => {
    const ports = stubPorts({
      state: DIRTY,
      answer: "save",
      save: { status: "saved" },
    });
    expect(await decideClose(ports)).toBe("close");
    expect(ports.saves).toBe(1);
    expect(ports.failures).toEqual([]);
  });

  it("stays quietly when the Save As dialog is cancelled", async () => {
    const ports = stubPorts({
      state: DIRTY,
      answer: "save",
      save: { status: "cancelled" },
    });
    expect(await decideClose(ports)).toBe("stay");
    // Backing out of Save As is a change of mind about closing, not a fault
    // to report.
    expect(ports.failures).toEqual([]);
  });

  it("reports a failed save and keeps the window", async () => {
    const ports = stubPorts({
      state: DIRTY,
      answer: "save",
      save: { status: "failed", message: "EPERM: file is read-only" },
    });
    expect(await decideClose(ports)).toBe("stay");
    expect(ports.failures).toEqual(["EPERM: file is read-only"]);
  });

  it("treats a thrown save as a failure rather than a close", async () => {
    const ports = stubPorts({
      state: DIRTY,
      answer: "save",
      save: () => Promise.reject(new Error("the file bridge answered 500")),
    });
    expect(await decideClose(ports)).toBe("stay");
    expect(ports.failures).toEqual(["the file bridge answered 500"]);
  });

  it("keeps the window when the prompt itself fails", async () => {
    const ports = stubPorts({
      state: DIRTY,
      ask: () => Promise.reject(new Error("no window to parent to")),
    });
    expect(await decideClose(ports)).toBe("stay");
    expect(ports.saves).toBe(0);
  });
});

describe("close prompt", () => {
  it("maps every button, and anything unexpected, to an answer", () => {
    expect(CLOSE_BUTTONS[CLOSE_DEFAULT_BUTTON]).toBe("Save");
    expect(CLOSE_BUTTONS[CLOSE_CANCEL_BUTTON]).toBe("Cancel");
    expect(closeAnswerFromButton(0)).toBe("save");
    expect(closeAnswerFromButton(1)).toBe("discard");
    expect(closeAnswerFromButton(2)).toBe("cancel");
    // Windows reports a dismissed dialog as the cancel button, but a build
    // that reported something else must not lose the drawing.
    expect(closeAnswerFromButton(-1)).toBe("cancel");
  });

  it("names the file Save would overwrite", () => {
    const prompt = closePrompt(DIRTY);
    expect(prompt.message).toBe("Save changes to Two Stage Amp?");
    expect(prompt.detail).toContain("D:\\Projects\\amp.icproj.json");
  });

  it("says a first save asks where to write", () => {
    const prompt = closePrompt({ ...DIRTY, path: null });
    expect(prompt.detail).toContain("asks where to put it");
  });

  it("says the window stayed open when a save failed", () => {
    const notice = saveFailureNotice("disk full");
    expect(notice.message).toContain("stayed open");
    expect(notice.detail).toContain("disk full");
  });
});

describe("reading the editor's answer", () => {
  it("accepts a well-formed state", () => {
    expect(
      unsavedWorkState({
        dirty: true,
        name: "Amp",
        path: "C:\\amp.icproj.json",
      }),
    ).toEqual({ dirty: true, name: "Amp", path: "C:\\amp.icproj.json" });
    expect(unsavedWorkState({ dirty: false, name: "Amp", path: null })).toEqual(
      {
        dirty: false,
        name: "Amp",
        path: null,
      },
    );
  });

  it("treats a missing or malformed answer as no answer", () => {
    expect(unsavedWorkState(null)).toBeNull();
    expect(unsavedWorkState(undefined)).toBeNull();
    expect(unsavedWorkState("dirty")).toBeNull();
    expect(unsavedWorkState({ name: "Amp" })).toBeNull();
  });

  it("still names the Project when the editor sent a useless name", () => {
    expect(unsavedWorkState({ dirty: true, name: "  ", path: 7 })).toEqual({
      dirty: true,
      name: "this Project",
      path: null,
    });
  });

  it("reads a save result, and calls anything else a failure", () => {
    expect(saveAttempt({ status: "saved" })).toEqual({ status: "saved" });
    expect(saveAttempt({ status: "cancelled" })).toEqual({
      status: "cancelled",
    });
    expect(saveAttempt({ status: "failed", message: "read-only" })).toEqual({
      status: "failed",
      message: "read-only",
    });
    expect(saveAttempt(null)).toEqual({
      status: "failed",
      message: "Save failed",
    });
    expect(saveAttempt({ status: "done" })).toEqual({
      status: "failed",
      message: "Save failed",
    });
  });

  it("evaluates to null in a page with no editor on it", () => {
    const window = {} as Record<string, unknown>;
    const read = new Function(
      "window",
      `return ${READ_UNSAVED_WORK_SCRIPT}`,
    ) as (target: unknown) => unknown;
    expect(read(window)).toBeNull();
    const request = new Function("window", `return ${REQUEST_SAVE_SCRIPT}`) as (
      target: unknown,
    ) => unknown;
    expect(saveAttempt(request(window)).status).toBe("failed");
  });
});
