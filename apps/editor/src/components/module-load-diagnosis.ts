/**
 * Tell a missing application file apart from a failure worth retrying.
 *
 * The editor loads routes and heavy dialogs as content-hashed chunks. The
 * desktop shell answers those requests from its own installation, so a chunk
 * that cannot load means either a file the installation does not have — a
 * damaged or incomplete install, reported as issue #493, where a fresh visit
 * to /editor could not open the editor at all — or a read that failed once
 * and may well succeed on the next try, reported as #529. The browser uses
 * the same message for both, so nothing here guesses: only an observed 404
 * names a file the installation is missing.
 *
 * Nothing here touches a Project. Recovery copies live in IndexedDB and are
 * never cleared on this path.
 */
export type ModuleLoadDiagnosis =
  | {
      kind: "missing-file";
      assetUrl: string;
      status: 404;
    }
  | {
      kind: "temporary";
      assetUrl: string | null;
      status?: number;
    };

export interface ModuleLoadProbeSurfaces {
  readonly currentUrl: string;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export class MissingApplicationFileError extends Error {
  override readonly name = "MissingApplicationFileError";

  constructor(
    readonly assetUrl: string,
    override readonly cause: unknown,
  ) {
    super(`The installation is missing ${new URL(assetUrl).pathname}`);
  }
}

export class TemporaryModuleLoadError extends Error {
  override readonly name = "TemporaryModuleLoadError";

  constructor(
    readonly assetUrl: string | null,
    override readonly cause: unknown,
  ) {
    super(
      assetUrl === null
        ? "A required editor file was temporarily unavailable"
        : `A required editor file was temporarily unavailable: ${new URL(assetUrl).pathname}`,
    );
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function moduleAssetUrl(error: unknown, currentUrl: string): string | null {
  // Any scheme, because the shell serves the bundle over its own `app://`
  // origin while the dev and preview servers use HTTP. The origin check below
  // is what keeps a foreign URL out.
  const match = messageOf(error).match(
    /(?:[a-z][a-z\d+.-]*:\/\/[^\s"'<>]+|\/assets\/[^\s"'<>]+\.js(?:\?[^\s"'<>]*)?)/iu,
  );
  if (!match) return null;
  try {
    const current = new URL(currentUrl);
    const asset = new URL(match[0], current);
    if (
      asset.origin !== current.origin ||
      !asset.pathname.startsWith("/assets/") ||
      !asset.pathname.endsWith(".js")
    ) {
      return null;
    }
    return asset.toString();
  } catch {
    return null;
  }
}

/**
 * Probe the file named by a dynamic-import failure before calling it missing.
 * The browser uses the same error text for an absent file, a read error, and
 * a file that simply lost a race. Only an observed 404 proves absence.
 */
export async function diagnoseModuleLoadFailure(
  error: unknown,
  surfaces: ModuleLoadProbeSurfaces,
): Promise<ModuleLoadDiagnosis> {
  const assetUrl = moduleAssetUrl(error, surfaces.currentUrl);
  if (assetUrl === null) return { kind: "temporary", assetUrl: null };
  try {
    const response = await surfaces.fetch(assetUrl, {
      method: "HEAD",
      cache: "no-store",
      credentials: "same-origin",
    });
    if (response.status === 404) {
      return { kind: "missing-file", assetUrl, status: 404 };
    }
    return {
      kind: "temporary",
      assetUrl,
      status: response.status,
    };
  } catch {
    return { kind: "temporary", assetUrl };
  }
}

/** Whether a failure has been confirmed as an absent file, not guessed. */
export function isMissingApplicationFile(error: unknown): boolean {
  return error instanceof MissingApplicationFileError;
}

export function isTemporaryModuleLoadFailure(error: unknown): boolean {
  return error instanceof TemporaryModuleLoadError;
}
