import { describe, expect, it, vi } from "vitest";

import { guardedRouteChunk } from "./route-chunk-loader";
import type { RouteChunkRuntime } from "./route-chunk-loader";
import {
  MissingApplicationFileError,
  TemporaryModuleLoadError,
} from "./module-load-diagnosis";
import type { ModuleLoadDiagnosis } from "./module-load-diagnosis";

function runtime(
  diagnosis: ModuleLoadDiagnosis,
  remembered: string | null = null,
) {
  const reload = vi.fn();
  const rememberReload = vi.fn(() => true);
  const forgetReload = vi.fn();
  const delay = vi.fn(() => Promise.resolve());
  const value: RouteChunkRuntime = {
    pathname: "/editor",
    rememberedReload: () => remembered,
    rememberReload,
    forgetReload,
    diagnose: () => Promise.resolve(diagnosis),
    delay,
    reload,
  };
  return {
    value,
    reload,
    rememberReload,
    forgetReload,
    delay,
  };
}

describe("guardedRouteChunk", () => {
  it("passes a loaded route through and clears the retry guard", async () => {
    const context = runtime({ kind: "temporary", assetUrl: null });
    const module = { default: "editor" };
    await expect(
      guardedRouteChunk(() => Promise.resolve(module), context.value)(),
    ).resolves.toBe(module);
    expect(context.forgetReload).toHaveBeenCalledOnce();
  });

  it("reloads immediately when the named asset is confirmed missing", async () => {
    const context = runtime({
      kind: "missing-file",
      assetUrl: "app://schematic-draft/assets/App-old.js",
      status: 404,
    });
    void guardedRouteChunk(
      () => Promise.reject(new TypeError("dynamic import failed")),
      context.value,
    )();
    await vi.waitFor(() => expect(context.reload).toHaveBeenCalledOnce());
    expect(context.rememberReload).toHaveBeenCalledWith("/editor");
    // Waiting buys nothing for a file that is simply not there.
    expect(context.delay).not.toHaveBeenCalled();
  });

  it("delays before reloading once for a temporary failure", async () => {
    const context = runtime({
      kind: "temporary",
      assetUrl: "app://schematic-draft/assets/App-current.js",
      status: 200,
    });
    void guardedRouteChunk(
      () => Promise.reject(new TypeError("dynamic import failed")),
      context.value,
    )();
    await vi.waitFor(() => expect(context.reload).toHaveBeenCalledOnce());
    expect(context.delay).toHaveBeenCalledWith(750);
  });

  it("surfaces the confirmed diagnosis instead of reloading twice", async () => {
    const missing = runtime(
      {
        kind: "missing-file",
        assetUrl: "app://schematic-draft/assets/App-old.js",
        status: 404,
      },
      "/editor",
    );
    await expect(
      guardedRouteChunk(
        () => Promise.reject(new TypeError("dynamic import failed")),
        missing.value,
      )(),
    ).rejects.toBeInstanceOf(MissingApplicationFileError);
    expect(missing.reload).not.toHaveBeenCalled();

    const temporary = runtime(
      {
        kind: "temporary",
        assetUrl: "app://schematic-draft/assets/App-current.js",
        status: 200,
      },
      "/editor",
    );
    await expect(
      guardedRouteChunk(
        () => Promise.reject(new TypeError("dynamic import failed")),
        temporary.value,
      )(),
    ).rejects.toBeInstanceOf(TemporaryModuleLoadError);
    expect(temporary.reload).not.toHaveBeenCalled();
  });
});
