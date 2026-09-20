/**
 * The master parts of a Visio package.
 *
 * A master is a reusable shape definition: the stencil window lists them, and a
 * page shape that names one inherits its geometry. Splitting them out of the
 * page is what makes a schematic editable in Visio rather than a pile of loose
 * lines — moving a transistor moves one shape, and its connection points come
 * along.
 *
 * Visio stores them in two places at once: `masters.xml` holds the catalog
 * entry for each master, and a `masterN.xml` part holds its shapes. Both are
 * written here; the shapes themselves come from `symbol-master.ts`.
 */

import type { OpcPart } from "./opc.js";
import {
  PACKAGE_RELATIONSHIPS_NAMESPACE,
  RELATIONSHIP_NAMESPACE,
  VISIO_NAMESPACE,
  XML_DECLARATION,
  escapeXmlAttribute,
  formatVisioNumber,
} from "./xml.js";

export const MASTERS_PART = "visio/masters/masters.xml";

/**
 * What kind of thing a master is.
 *
 * Visio keeps this in `MasterType`, and it is not decoration: a master declared
 * a connector is offered by the connector tools and is laid out as a line
 * between two shapes, while a plain master is furniture that happens to have a
 * line in it. The values are Visio's own — 2 for a shape, 541 for a connector —
 * read from the dynamic connector in `BASICELECTRICAL_DIAGRAM_M.VSTX`.
 */
export type VisioMasterType = "shape" | "connector";

const MASTER_TYPE_VALUES: Record<VisioMasterType, string> = {
  shape: "2",
  connector: "541",
};

export interface VisioMaster {
  /** Visio master ID, unique in the package and referenced by page shapes. */
  readonly id: number;
  /** Universal name; also what a page shape's `Master` attribute resolves. */
  readonly name: string;
  /** Tooltip shown over the stencil entry. */
  readonly prompt: string;
  /** Defaults to `"shape"`. */
  readonly masterType?: VisioMasterType;
  readonly uniqueId: string;
  readonly baseId: string;
  readonly widthInches: number;
  readonly heightInches: number;
  /** The `<Shapes>` element of the master's own part. */
  readonly shapes: string;
}

export function masterContentsPartPath(master: VisioMaster): string {
  return `visio/masters/master${master.id}.xml`;
}

function masterRelationshipId(master: VisioMaster): string {
  return `rId${master.id}`;
}

/**
 * The master catalog.
 *
 * `IconUpdate="1"` tells Visio to draw each stencil icon from the shape itself,
 * which is why no `<Icon>` element is written: a hand-built icon bitmap would
 * be one more thing to keep in step with the artwork, and Visio renders a
 * better one than we could encode.
 */
export function mastersPart(masters: readonly VisioMaster[]): OpcPart {
  const entries = masters.map((master) => {
    const name = escapeXmlAttribute(master.name);
    return (
      `<Master ID="${master.id}" NameU="${name}" IsCustomNameU="1" Name="${name}" IsCustomName="1"` +
      ` Prompt="${escapeXmlAttribute(master.prompt)}" IconSize="1" AlignName="2" MatchByName="0" IconUpdate="1"` +
      ` UniqueID="${master.uniqueId}" BaseID="${master.baseId}" PatternFlags="0" Hidden="0" MasterType="${MASTER_TYPE_VALUES[master.masterType ?? "shape"]}">` +
      `<PageSheet LineStyle="0" FillStyle="0" TextStyle="0">` +
      `<Cell N="PageWidth" V="${formatVisioNumber(master.widthInches)}"/>` +
      `<Cell N="PageHeight" V="${formatVisioNumber(master.heightInches)}"/>` +
      `<Cell N="PageScale" V="1" U="IN_F"/><Cell N="DrawingScale" V="1" U="IN_F"/>` +
      `<Cell N="DrawingSizeType" V="0"/><Cell N="DrawingScaleType" V="0"/><Cell N="DrawingResizeType" V="1"/>` +
      `<Cell N="InhibitSnap" V="0"/><Cell N="UIVisibility" V="0"/>` +
      `<Cell N="ShdwType" V="0"/><Cell N="ShdwObliqueAngle" V="0"/><Cell N="ShdwScaleFactor" V="1"/>` +
      `<Cell N="ShdwOffsetX" V="0"/><Cell N="ShdwOffsetY" V="0"/>` +
      `</PageSheet>` +
      `<Rel r:id="${masterRelationshipId(master)}"/>` +
      `</Master>`
    );
  });
  return {
    path: MASTERS_PART,
    content:
      `${XML_DECLARATION}<Masters xmlns="${VISIO_NAMESPACE}" xmlns:r="${RELATIONSHIP_NAMESPACE}" xml:space="preserve">` +
      `${entries.join("")}</Masters>`,
  };
}

export function mastersRelationshipsPart(
  masters: readonly VisioMaster[],
): OpcPart {
  const relationships = masters.map(
    (master) =>
      `<Relationship Id="${masterRelationshipId(master)}" Type="http://schemas.microsoft.com/visio/2010/relationships/master" Target="master${master.id}.xml"/>`,
  );
  return {
    path: "visio/masters/_rels/masters.xml.rels",
    content: `${XML_DECLARATION}<Relationships xmlns="${PACKAGE_RELATIONSHIPS_NAMESPACE}">${relationships.join("")}</Relationships>`,
  };
}

export function masterContentsPart(master: VisioMaster): OpcPart {
  return {
    path: masterContentsPartPath(master),
    content:
      `${XML_DECLARATION}<MasterContents xmlns="${VISIO_NAMESPACE}" xmlns:r="${RELATIONSHIP_NAMESPACE}" xml:space="preserve">` +
      `${master.shapes}</MasterContents>`,
  };
}

/** Every part a package needs to carry `masters`, in package order. */
export function masterParts(masters: readonly VisioMaster[]): OpcPart[] {
  if (masters.length === 0) return [];
  const ids = new Set<number>();
  const names = new Set<string>();
  for (const master of masters) {
    if (!Number.isInteger(master.id) || master.id < 1) {
      throw new RangeError(
        `Visio master IDs start at 1, received ${master.id}`,
      );
    }
    if (ids.has(master.id)) {
      throw new Error(`Duplicate Visio master ID ${master.id}`);
    }
    ids.add(master.id);
    if (names.has(master.name)) {
      throw new Error(`Duplicate Visio master name "${master.name}"`);
    }
    names.add(master.name);
  }
  return [
    mastersPart(masters),
    mastersRelationshipsPart(masters),
    ...masters.map((master) => masterContentsPart(master)),
  ];
}
