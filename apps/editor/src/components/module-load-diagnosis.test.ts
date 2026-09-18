import { describe, expect, it, vi } from "vitest";

import {
  diagnoseModuleLoadFailure,
  isMissingApplicationFile,
  isTemporaryModuleLoadFailure,
  MissingApplicationFileError,
  TemporaryModuleLoadError,
} from "./module-load-diagnosis";

describe("recognising a file the installation does not have", () => {
  it("does not call a browser's ambiguous import message proof of absence", () => {
    // #529 named a module that was part of the installation and later
    // answered 200. Browsers use the same message for that transient failure
    // and for the true missing-file failure from #493.
    expect(
      isMissingApplicationFile(
        new TypeError(
          "Failed to fetch dynamically imported module: app://schematic-draft/assets/App-current.js",
        ),
      ),
    ).toBe(false);
  });

  it("recognises only errors created after the asset probe", () => {
    const raw = new TypeError("dynamic import failed");
    const missing = new MissingApplicationFileError(
      "app://schematic-draft/assets/App-old.js",
      raw,
    );
    const temporary = new TemporaryModuleLoadError(
      "app://schematic-draft/assets/App-current.js",
      raw,
    );
    expect(isMissingApplicationFile(missing)).toBe(true);
    expect(isMissingApplicationFile(temporary)).toBe(false);
    expect(isTemporaryModuleLoadFailure(temporary)).toBe(true);
    expect(isTemporaryModuleLoadFailure(raw)).toBe(false);
  });
});

describe("diagnosing a dynamic module failure", () => {
  const currentUrl = "app://schematic-draft/editor";
  const failure = new TypeError(
    "Failed to fetch dynamically imported module: app://schematic-draft/assets/App-build.js",
  );

  it("confirms a missing file only when the named same-origin asset is 404", async () => {
    const fetch = vi.fn(() =>
      Promise.resolve(new Response(null, { status: 404 })),
    );
    await expect(
      diagnoseModuleLoadFailure(failure, { currentUrl, fetch }),
    ).resolves.toEqual({
      kind: "missing-file",
      assetUrl: "app://schematic-draft/assets/App-build.js",
      status: 404,
    });
    expect(fetch).toHaveBeenCalledWith(
      "app://schematic-draft/assets/App-build.js",
      expect.objectContaining({ method: "HEAD", cache: "no-store" }),
    );
  });

  it("reads the shell's own scheme as well as the dev server's HTTP", async () => {
    // The packaged shell serves the bundle from `app://`; the dev and preview
    // servers use HTTP. A diagnosis that only understood HTTP would report
    // every packaged failure as unconfirmed.
    await expect(
      diagnoseModuleLoadFailure(
        new TypeError(
          "Failed to fetch dynamically imported module: http://127.0.0.1:4173/assets/App-build.js",
        ),
        {
          currentUrl: "http://127.0.0.1:4173/editor",
          fetch: () => Promise.resolve(new Response(null, { status: 404 })),
        },
      ),
    ).resolves.toEqual({
      kind: "missing-file",
      assetUrl: "http://127.0.0.1:4173/assets/App-build.js",
      status: 404,
    });
  });

  it("keeps a present asset's failure temporary when the probe is 200", async () => {
    await expect(
      diagnoseModuleLoadFailure(failure, {
        currentUrl,
        fetch: () => Promise.resolve(new Response(null, { status: 200 })),
      }),
    ).resolves.toEqual({
      kind: "temporary",
      assetUrl: "app://schematic-draft/assets/App-build.js",
      status: 200,
    });
  });

  it("keeps unreadable, cross-origin, and URL-less failures temporary", async () => {
    await expect(
      diagnoseModuleLoadFailure(failure, {
        currentUrl,
        fetch: () => Promise.reject(new Error("unreadable")),
      }),
    ).resolves.toEqual({
      kind: "temporary",
      assetUrl: "app://schematic-draft/assets/App-build.js",
    });
    await expect(
      diagnoseModuleLoadFailure(
        new TypeError(
          "Failed to fetch dynamically imported module: https://other.test/assets/App-build.js",
        ),
        {
          currentUrl,
          fetch: () => Promise.resolve(new Response(null, { status: 404 })),
        },
      ),
    ).resolves.toEqual({ kind: "temporary", assetUrl: null });
    await expect(
      diagnoseModuleLoadFailure(new TypeError("module load failed"), {
        currentUrl,
        fetch: () => Promise.resolve(new Response(null, { status: 404 })),
      }),
    ).resolves.toEqual({ kind: "temporary", assetUrl: null });
  });
});
