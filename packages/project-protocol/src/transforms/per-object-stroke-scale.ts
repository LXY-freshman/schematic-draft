/** Schema 59 adds an optional stroke multiplier to Routes and Instances.
 * Existing drawings keep the profile stroke they have always been drawn with,
 * because the field is absent and absence means "one". */
export function upgradeSchema58To59(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  return { ...raw, schemaVersion: 59 };
}
