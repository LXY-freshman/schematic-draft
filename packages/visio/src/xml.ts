/**
 * XML serialization primitives shared by every Visio part.
 *
 * Parts are written as strings rather than through a DOM. Each part in this
 * package has a fixed shape, and string concatenation is what keeps the output
 * bytes reproducible — the export goldens compare packages byte for byte.
 */

export const XML_DECLARATION =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

/**
 * Visio's own namespace. The desktop format uses the 2012 revision; the 2011
 * `core` namespace that the published MS-VSDX prose describes belongs to Visio
 * Services, and a package written with it opens as a damaged file.
 */
export const VISIO_NAMESPACE =
  "http://schemas.microsoft.com/office/visio/2012/main";

/** Relationship namespace behind the `r:id` attributes inside Visio parts. */
export const RELATIONSHIP_NAMESPACE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/** Namespace of the `.rels` parts themselves, which is a different one. */
export const PACKAGE_RELATIONSHIPS_NAMESPACE =
  "http://schemas.openxmlformats.org/package/2006/relationships";

/**
 * Characters XML 1.0 cannot represent at all — the C0 controls other than tab,
 * newline and carriage return. Project text reaches Visio parts verbatim, so a
 * stray control character would produce a package no reader accepts; dropping
 * it keeps the rest of the document exportable.
 */
const INVALID_XML_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g;

export function escapeXmlText(value: string): string {
  return value
    .replace(INVALID_XML_CHARACTERS, "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value)
    .replaceAll('"', "&quot;")
    .replaceAll("\t", "&#9;")
    .replaceAll("\n", "&#10;")
    .replaceAll("\r", "&#13;");
}

/**
 * Formats a number for a ShapeSheet cell value. `toFixed` is deliberate: Visio
 * rejects exponent notation, which `String(1e-7)` would otherwise produce. The
 * magnitude bound keeps that guarantee total — `toFixed` itself falls back to
 * exponent notation past 1e21 — and no drawing coordinate comes near it.
 */
export function formatVisioNumber(value: number): string {
  if (!Number.isFinite(value) || Math.abs(value) >= 1e15) {
    throw new RangeError(
      `Visio cell values must be finite and below 1e15, received ${value}`,
    );
  }
  const rounded = Math.round(value * 1e6) / 1e6;
  const text = (Object.is(rounded, -0) ? 0 : rounded).toFixed(6);
  return text.replace(/0+$/, "").replace(/\.$/, "");
}
