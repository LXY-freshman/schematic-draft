/**
 * Schematic Draft desktop build (Deployment rationale).
 *
 * The same editor source serves the hosted site and the offline desktop
 * application. The desktop shell has no account, Gallery, analytics, Agent
 * relay or hosted simulation: every `/api/*` route it answers is backed by
 * files on this computer, and its renderer cannot reach any other origin.
 * Surfaces that only make sense on the hosted site read this flag and stay
 * out of the desktop chrome instead of failing on a missing backend.
 *
 * Resolved at build time so the hosted build carries none of the branching;
 * `VITE_ICM_DESKTOP=enabled` is set by `apps/desktop` when it builds the
 * editor it embeds.
 */
export const DESKTOP_BUILD = import.meta.env.VITE_ICM_DESKTOP === "enabled";

export const DESKTOP_PRODUCT_NAME = "Schematic Draft";
