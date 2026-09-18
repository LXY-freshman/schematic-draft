import {
  diagnoseModuleLoadFailure,
  MissingApplicationFileError,
  TemporaryModuleLoadError,
} from "./module-load-diagnosis";
import type { ModuleLoadDiagnosis } from "./module-load-diagnosis";

const CHUNK_RELOAD_KEY = "icm-chunk-reload";
const TEMPORARY_RETRY_DELAY_MS = 750;

export interface RouteChunkRuntime {
  readonly pathname: string;
  rememberedReload(): string | null;
  rememberReload(pathname: string): boolean;
  forgetReload(): void;
  diagnose(error: unknown): Promise<ModuleLoadDiagnosis>;
  delay(milliseconds: number): Promise<void>;
  reload(): void;
}

function browserRuntime(): RouteChunkRuntime {
  return {
    pathname: window.location.pathname,
    rememberedReload: () => {
      try {
        return sessionStorage.getItem(CHUNK_RELOAD_KEY);
      } catch {
        return window.location.pathname;
      }
    },
    rememberReload: (pathname) => {
      try {
        sessionStorage.setItem(CHUNK_RELOAD_KEY, pathname);
        return true;
      } catch {
        return false;
      }
    },
    forgetReload: () => {
      try {
        sessionStorage.removeItem(CHUNK_RELOAD_KEY);
      } catch {
        // A private browser can refuse storage; there is nothing to forget.
      }
    },
    diagnose: (error) =>
      diagnoseModuleLoadFailure(error, {
        currentUrl: window.location.href,
        fetch: (input, init) => window.fetch(input, init),
      }),
    delay: (milliseconds) =>
      new Promise((resolve) => window.setTimeout(resolve, milliseconds)),
    reload: () => window.location.reload(),
  };
}

function publicFailure(diagnosis: ModuleLoadDiagnosis, cause: unknown): Error {
  return diagnosis.kind === "missing-file"
    ? new MissingApplicationFileError(diagnosis.assetUrl, cause)
    : new TemporaryModuleLoadError(diagnosis.assetUrl, cause);
}

/**
 * Load one route chunk and recover once without guessing why it failed.
 *
 * A confirmed missing file receives an immediate reload; an unconfirmed one
 * receives a delayed reload, since the read may simply have lost a race. The
 * second failure is surfaced with the diagnosis instead of entering a loop.
 */
export function guardedRouteChunk<T>(
  load: () => Promise<T>,
  runtime: RouteChunkRuntime = browserRuntime(),
): () => Promise<T> {
  return async () => {
    try {
      const module = await load();
      runtime.forgetReload();
      return module;
    } catch (cause) {
      const diagnosis = await runtime.diagnose(cause);
      const failure = publicFailure(diagnosis, cause);
      if (runtime.rememberedReload() === runtime.pathname) throw failure;
      if (!runtime.rememberReload(runtime.pathname)) throw failure;

      if (diagnosis.kind === "temporary") {
        await runtime.delay(TEMPORARY_RETRY_DELAY_MS);
      }
      runtime.reload();

      // Navigation replaces this document. Keep React.lazy pending so the
      // failed graph cannot render or report a second error while it unloads.
      return await new Promise<T>(() => {});
    }
  };
}
