/** Schema 60 adds an optional line-jump radius factor to the document style
 * overrides. Existing drawings keep the hop size they have always been drawn
 * with, because the field is absent and absence means "one". */
export function upgradeSchema59To60(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  return { ...raw, schemaVersion: 60 };
}
