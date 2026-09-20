/**
 * Stable identifiers for Visio masters.
 *
 * Visio wants a `UniqueID` and a `BaseID` on every master, both formatted as a
 * braced GUID. Generating them randomly would make two exports of the same
 * drawing differ, which the export goldens forbid, so they are derived from the
 * symbol the master was built from instead.
 *
 * The derivation is a hash, not an RFC 4122 name-based UUID: that would need
 * SHA-1, which is asynchronous in a browser. Nothing reads these values back —
 * Visio only needs them stable and distinct — so a 128-bit hash wearing the
 * version and variant bits of a UUID is enough, and it keeps this package free
 * of a platform-specific crypto dependency.
 */

const FNV_PRIME = 0x01000193;

/**
 * FNV-1a over the UTF-16 code units of `value`, low byte first. Four different
 * offset bases give the four independent words a 128-bit identifier needs.
 */
function fnv1a(value: string, basis: number): number {
  let hash = basis >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    hash = Math.imul(hash ^ (unit & 0xff), FNV_PRIME) >>> 0;
    hash = Math.imul(hash ^ (unit >>> 8), FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

const OFFSET_BASES = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b] as const;

function hashBytes(seed: string): Uint8Array {
  const bytes = new Uint8Array(16);
  for (const [word, basis] of OFFSET_BASES.entries()) {
    const hash = fnv1a(`${word}:${seed}`, basis);
    bytes[word * 4] = (hash >>> 24) & 0xff;
    bytes[word * 4 + 1] = (hash >>> 16) & 0xff;
    bytes[word * 4 + 2] = (hash >>> 8) & 0xff;
    bytes[word * 4 + 3] = hash & 0xff;
  }
  // Version 4 and variant 10x, so the value is a syntactically valid UUID even
  // though it is derived rather than random.
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  return bytes;
}

/** A braced GUID, the form every Visio identifier attribute is written in. */
export function visioGuid(seed: string): string {
  const hex = [...hashBytes(seed)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const groups = [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ];
  return `{${groups.join("-").toUpperCase()}}`;
}
