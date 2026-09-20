/**
 * Shape Data: the electrical facts a shape carries in Visio.
 *
 * Visio calls a shape's custom properties Shape Data, and shows them in a
 * docked window beside the drawing. Putting the reference designator, the
 * device parameters and the owning Cell there is what keeps the export a
 * circuit rather than a picture of one: the numbers stay attached to the shape
 * that carries them, survive being moved, and can be reported on.
 *
 * `IcmInstanceId` is deliberate. It is the Project's own instance identifier,
 * carried through unchanged so a drawing that came back from Visio could still
 * be matched against the Project it came from. Nothing reads it yet.
 */

import type { SchematicDocument } from "@icm/model";
import type { ResolvedSymbol } from "@icm/symbols";

import { escapeXmlAttribute } from "./xml.js";

export interface VisioShapeDataRow {
  /** ShapeSheet row name — letters, digits and underscores only. */
  readonly name: string;
  /** Field name as the Shape Data window shows it. */
  readonly label: string;
  readonly value: string;
}

/** Longest row name Visio accepts without truncating it itself. */
const MAX_ROW_NAME_LENGTH = 64;

/**
 * A ShapeSheet row name for an arbitrary parameter name.
 *
 * Row names are ShapeSheet identifiers, so a SPICE parameter spelled `w/l` or
 * `vth0` has to be transliterated. The readable spelling is not lost: it goes
 * on the row's `Label`, which is what the Shape Data window shows.
 */
export function visioRowName(seed: string): string {
  const cleaned = seed
    .replace(/[^A-Za-z0-9_]/g, "_")
    .slice(0, MAX_ROW_NAME_LENGTH);
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `_${cleaned}`;
}

/** Makes row names unique by numbering repeats, leaving the labels alone. */
function withDistinctNames(
  rows: readonly VisioShapeDataRow[],
): VisioShapeDataRow[] {
  const used = new Set<string>();
  return rows.map((row) => {
    let name = row.name;
    for (let suffix = 2; used.has(name); suffix += 1) {
      name = `${row.name}_${suffix}`;
    }
    used.add(name);
    return { ...row, name };
  });
}

/**
 * `Type` 0 is a string property. Every value this export writes is already
 * text — a SPICE parameter is `1u` or `W*2`, not a number Visio could compute
 * with — so declaring them as strings is what keeps them intact.
 */
export function shapeDataSection(rows: readonly VisioShapeDataRow[]): string {
  if (rows.length === 0) return "";
  const written = withDistinctNames(rows).map(
    (row) =>
      `<Row N="${escapeXmlAttribute(row.name)}">` +
      `<Cell N="Value" V="${escapeXmlAttribute(row.value)}" U="STR"/>` +
      `<Cell N="Label" V="${escapeXmlAttribute(row.label)}"/>` +
      `<Cell N="Type" V="0"/>` +
      `</Row>`,
  );
  return `<Section N="Property">${written.join("")}</Section>`;
}

/**
 * What one instance publishes. Order is the order the Shape Data window shows:
 * identity first, then the parameters that change between instances of the same
 * device.
 */
export function instanceShapeData(
  document: SchematicDocument,
  instance: SchematicDocument["instances"][number],
  resolved: ResolvedSymbol,
): VisioShapeDataRow[] {
  const rows: VisioShapeDataRow[] = [];
  if (instance.reference) {
    rows.push({
      name: "Reference",
      label: "Reference",
      value: instance.reference,
    });
  }
  rows.push({
    name: "Symbol",
    label: "Symbol",
    value: resolved.definition.name,
  });
  rows.push({ name: "Cell", label: "Cell", value: document.name });
  const binding = instance.netlist?.binding;
  if (binding?.kind === "primitive" || binding?.kind === "model") {
    rows.push({
      name: "Device",
      label: "Device class",
      value: binding.deviceClass,
    });
  }
  if (binding?.kind === "model") {
    rows.push({ name: "Model", label: "Model", value: binding.name });
  }
  if (binding?.kind === "unresolved-subcircuit") {
    rows.push({ name: "Subcircuit", label: "Subcircuit", value: binding.name });
  }
  for (const [name, value] of Object.entries(
    instance.netlist?.parameters ?? {},
  )) {
    rows.push({ name: `Param_${visioRowName(name)}`, label: name, value });
  }
  rows.push({
    name: "IcmInstanceId",
    label: "icm:instanceId",
    value: instance.id,
  });
  return rows;
}
