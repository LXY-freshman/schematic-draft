import { DESKTOP_BUILD } from "../desktop/desktop-mode";

/**
 * Which release channel this editor is being served from (Deployment rationale).
 *
 * The same build serves the public site and the preview; only the Worker
 * knows which, and it says so at /api/channel. Anything short of a clear
 * "preview" answer is production: a failed request, an old Worker without
 * the endpoint, or a test with no network must never dress the public site
 * up as a preview.
 */
export type ReleaseChannel = "production" | "preview";

export interface ProjectStoreCopy {
  singular: "Cloud Project" | "Preview Project" | "Local Project";
  plural: "Cloud Projects" | "Preview Projects" | "Local Projects";
  destination: "Cloud" | "Preview Projects" | "this computer";
}

/** Human-facing storage identity; the underlying Project API is shared. */
export function projectStoreCopy(channel: ReleaseChannel): ProjectStoreCopy {
  // The desktop shell answers the same Project API from files on this
  // computer, so its store is named for where the bytes actually live.
  if (DESKTOP_BUILD) {
    return {
      singular: "Local Project",
      plural: "Local Projects",
      destination: "this computer",
    };
  }
  return channel === "preview"
    ? {
        singular: "Preview Project",
        plural: "Preview Projects",
        destination: "Preview Projects",
      }
    : {
        singular: "Cloud Project",
        plural: "Cloud Projects",
        destination: "Cloud",
      };
}

export async function loadReleaseChannel(
  fetchLike: typeof fetch | null = typeof fetch === "function" ? fetch : null,
): Promise<ReleaseChannel> {
  // The desktop shell has no Worker and no channel to ask about.
  if (DESKTOP_BUILD) return "production";
  if (!fetchLike) return "production";
  try {
    const response = await fetchLike("/api/channel", {
      credentials: "same-origin",
    });
    if (!response.ok) return "production";
    const body = (await response.json()) as { channel?: unknown };
    return body.channel === "preview" ? "preview" : "production";
  } catch {
    return "production";
  }
}
