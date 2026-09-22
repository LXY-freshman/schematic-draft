import { afterEach, describe, expect, it, vi } from "vitest";

import { takeRequestedProjectPath } from "./project-files";

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
