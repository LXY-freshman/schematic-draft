/**
 * Open Packaging Convention writer.
 *
 * A `.vsdx` (and a `.vssx` stencil) is a zip of XML parts. This module owns the
 * zip half of that: the part list comes from the callers in this package, the
 * byte layout comes from here.
 */

import { zipSync } from "fflate";

/**
 * A fixed modification stamp, so exporting the same drawing twice produces the
 * same bytes. It is written as a local-time string on purpose: fflate derives
 * the MS-DOS date fields with `Date#getHours` and friends, so an epoch number
 * would move the stamp — and the bytes — with the exporting machine's time
 * zone. Midday avoids the daylight-saving discontinuities that sit at midnight.
 */
const FIXED_PART_TIMESTAMP = "1980-01-01T12:00:00";

/** Part name Visio (and every other OPC reader) looks for first. */
export const CONTENT_TYPES_PART = "[Content_Types].xml";

export interface OpcPart {
  /** Package-relative path, with no leading slash. */
  readonly path: string;
  readonly content: string;
}

/**
 * Packs parts into an OPC package.
 *
 * `[Content_Types].xml` is written as the first entry because that is where a
 * reader expects it, and the remaining parts keep the order they were given so
 * a package diff reads in the order the code builds it.
 */
export function packOpcPackage(parts: readonly OpcPart[]): Uint8Array {
  const seen = new Set<string>();
  for (const part of parts) {
    if (part.path.startsWith("/") || part.path.includes("\\")) {
      throw new Error(
        `OPC part paths are package-relative and slash-separated, received "${part.path}"`,
      );
    }
    if (seen.has(part.path)) {
      throw new Error(`Duplicate OPC part "${part.path}"`);
    }
    seen.add(part.path);
  }
  if (!seen.has(CONTENT_TYPES_PART)) {
    throw new Error(`An OPC package must contain ${CONTENT_TYPES_PART}`);
  }

  const encoder = new TextEncoder();
  const entries: Record<string, Uint8Array> = {};
  for (const part of [
    ...parts.filter((part) => part.path === CONTENT_TYPES_PART),
    ...parts.filter((part) => part.path !== CONTENT_TYPES_PART),
  ]) {
    entries[part.path] = encoder.encode(part.content);
  }

  return zipSync(entries, { level: 9, mtime: FIXED_PART_TIMESTAMP });
}
