/**
 * The document-unit to Visio-unit mapping.
 *
 * Visio measures a drawing in inches and puts the page origin at the bottom
 * left; schematic documents measure in their own units with the origin at the
 * top left. Both differences are resolved here so no other module converts
 * coordinates by hand.
 */

import { SYMBOL_CONNECTION_GRID } from "@icm/symbols";

/**
 * One connection-grid step is one eighth of an inch — Visio's classic grid.
 * Pin spacing therefore lands on grid intersections, so dragging a symbol in
 * Visio snaps to the same lattice the schematic editor snaps to.
 */
export const CONNECTION_GRID_INCHES = 0.125;

/** 80 document units per inch, by construction of the grid above. */
export const DOCUMENT_UNITS_PER_INCH =
  SYMBOL_CONNECTION_GRID / CONNECTION_GRID_INCHES;

/** Blank margin between the drawing's bounding box and the page edge. */
export const PAGE_MARGIN_INCHES = 0.25;

export function inchesFromUnits(units: number): number {
  return units / DOCUMENT_UNITS_PER_INCH;
}

export function unitsFromInches(inches: number): number {
  return inches * DOCUMENT_UNITS_PER_INCH;
}

/**
 * Converts a document y coordinate to a page y coordinate. Visio's y axis grows
 * upward from the bottom of the page, so the whole drawing is mirrored about
 * the page's vertical midpoint rather than translated.
 */
export function pageYInchesFromUnits(
  units: number,
  pageHeightInches: number,
): number {
  return pageHeightInches - inchesFromUnits(units);
}
