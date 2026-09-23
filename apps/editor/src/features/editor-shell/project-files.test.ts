import { createSourceBundle } from "@icm/spice";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  openSourceFilesFromDisk,
  takeRequestedProjectPath,
} from "./project-files";

/**
 * The startup probe is the one bridge call the editor makes unprompted, on
 * every load. Whether it is made at all is the contract under test: with a
 * shell it asks, and without one it answers itself rather than leaving a 404
 * in the console of a build that is otherwise clean.
 */

function standIn(protocol: string, testFlag?: boolean): void {
  vi.stubGlobal("window", {
    location: { protocol },
    ...(testFlag === undefined ? {} : { __ICM_TEST_FILE_BRIDGE__: testFlag }),
  });
}

/** Answers every request with a pending file, and counts the asking. */
function countingFetch(): { calls: () => number } {
  const fetchMock = vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({ status: "requested", path: "C:\\a.schdraft" }),
    } as unknown as Response),
  );
  vi.stubGlobal("fetch", fetchMock);
  return { calls: () => fetchMock.mock.calls.length };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("takeRequestedProjectPath", () => {
  it("asks the shell, which is the only thing serving `app://`", async () => {
    standIn("app:");
    const fetched = countingFetch();
    await expect(takeRequestedProjectPath()).resolves.toBe("C:\\a.schdraft");
    expect(fetched.calls()).toBe(1);
  });

  it("does not ask a plain browser, where nothing can answer", async () => {
    standIn("http:");
    const fetched = countingFetch();
    await expect(takeRequestedProjectPath()).resolves.toBeNull();
    // Not merely "returns null": the request must never be made, because the
    // 404 it would earn is what `test:production-smoke` counts as a failure.
    expect(fetched.calls()).toBe(0);
  });

  it("asks when a browser test stands a fake main process in front", async () => {
    // The escape hatch is read only under `import.meta.env.DEV`, which Vitest
    // and the dev server the e2e suite runs on both set; a production build
    // eliminates it.
    standIn("http:", true);
    const fetched = countingFetch();
    await expect(takeRequestedProjectPath()).resolves.toBe("C:\\a.schdraft");
    expect(fetched.calls()).toBe(1);
  });

  it("answers null with no window at all", async () => {
    const fetched = countingFetch();
    await expect(takeRequestedProjectPath()).resolves.toBeNull();
    expect(fetched.calls()).toBe(0);
  });
});

describe("openSourceFilesFromDisk", () => {
  /** What the shell would answer, with the bytes base64 as the route sends them. */
  function shellAnswers(payload: unknown): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(payload),
        } as unknown as Response),
      ),
    );
  }

  const base64 = (bytes: Uint8Array): string =>
    btoa(String.fromCharCode(...bytes));

  it("carries a UTF-16 netlist through as bytes, not as text", async () => {
    // The whole reason the bridge moves base64 rather than a string. The SPICE
    // loader tells the encoding from the byte-order mark and records it; a
    // bridge that read the file as UTF-8 would not lose a validation step, it
    // would turn this netlist into mojibake. A Spectre `.scs` cannot make the
    // same trip — the converter requires UTF-8 and says so — which is why the
    // file under test is a `.spi`.
    const text = "* circuit\nR0 in out 1k\n";
    const utf16 = new Uint8Array([
      0xff,
      0xfe,
      ...[...text].flatMap((character) => [character.charCodeAt(0), 0]),
    ]);
    shellAnswers({
      status: "opened",
      files: [
        {
          path: "D:\\Circuits\\circuit.spi",
          name: "circuit.spi",
          base64: base64(utf16),
        },
      ],
    });

    const outcome = await openSourceFilesFromDisk();
    expect(outcome.status).toBe("opened");
    if (outcome.status !== "opened") return;
    // The importer resolves an `.include` against a file name, so that is what
    // the bytes arrive under — the same thing a browser's picker hands over.
    expect(outcome.files[0]!.path).toBe("circuit.spi");
    expect([...outcome.files[0]!.bytes]).toEqual([...utf16]);

    const bundle = await createSourceBundle(outcome.files, "circuit.spi");
    expect(bundle.files[0]!.encoding).toBe("utf-16-le");
    expect(bundle.files[0]!.text).toBe(text);
  });

  it("reports a cancelled dialog and a refusal apart", async () => {
    shellAnswers({ status: "cancelled" });
    expect(await openSourceFilesFromDisk()).toEqual({ status: "cancelled" });

    shellAnswers({ status: "failed", message: "too large" });
    expect(await openSourceFilesFromDisk()).toEqual({
      status: "failed",
      message: "too large",
    });
  });
});
