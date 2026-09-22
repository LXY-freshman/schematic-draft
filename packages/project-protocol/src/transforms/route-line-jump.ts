/** Schema 58 adds the optional per-Route line-jump drawing flag. Existing
 * Routes keep their geometry, connectivity and styling, and draw their
 * crossings flat because the flag is absent. */
export function upgradeSchema57To58(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  return { ...raw, schemaVersion: 58 };
}
