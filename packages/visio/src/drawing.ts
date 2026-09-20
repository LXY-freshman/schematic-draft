/**
 * Assembling a Visio drawing package.
 *
 * The public entry point of this package: a description of what the drawing
 * should contain goes in, the bytes of a `.vsdx` come out. Nothing here reads
 * or writes files, and nothing here needs Visio to be installed.
 */

import { masterContentsPartPath, masterParts } from "./masters.js";
import type { VisioMaster } from "./masters.js";
import { packOpcPackage } from "./opc.js";
import type { OpcPart } from "./opc.js";
import {
  contentTypesPart,
  corePropertiesPart,
  documentPart,
  documentRelationshipsPart,
  packageRelationshipsPart,
  pageContentsPart,
  pagesPart,
  pagesRelationshipsPart,
  windowsPart,
} from "./parts.js";
import type { VisioPackageLayout, VisioPageDescription } from "./parts.js";

export const DEFAULT_PAGE_NAME = "Schematic";

/** Media type a browser download or a file dialog should carry for a `.vsdx`. */
export const VISIO_DRAWING_MEDIA_TYPE = "application/vnd.ms-visio.drawing";

export const VISIO_DRAWING_EXTENSION = "vsdx";

export interface VisioDrawing {
  readonly page: VisioPageDescription;
  /** Shown in Visio's document properties; defaults to the page name. */
  readonly title?: string;
  /** Reusable shape definitions the page's shapes refer to by name. */
  readonly masters?: readonly VisioMaster[];
}

/** Recorded as the author of every package this exporter writes. */
export const VISIO_CREATOR = "Schematic Draft";

export function buildVisioDrawingParts(drawing: VisioDrawing): OpcPart[] {
  const page = drawing.page;
  if (!(page.widthInches > 0) || !(page.heightInches > 0)) {
    throw new RangeError(
      `A Visio page needs positive dimensions, received ${page.widthInches} x ${page.heightInches} inches`,
    );
  }
  if (page.name.trim().length === 0) {
    throw new Error("A Visio page needs a name");
  }

  const masters = drawing.masters ?? [];
  const layout: VisioPackageLayout = {
    kind: "drawing",
    masterPaths: masters.map((master) => masterContentsPartPath(master)),
    hasPageContents: true,
  };

  return [
    contentTypesPart(layout),
    packageRelationshipsPart(),
    corePropertiesPart({
      title: drawing.title ?? page.name,
      creator: VISIO_CREATOR,
    }),
    documentPart(),
    documentRelationshipsPart(layout),
    ...masterParts(masters),
    pagesPart(page, layout),
    pagesRelationshipsPart(),
    pageContentsPart(""),
    windowsPart(page),
  ];
}

/** Writes a drawing as `.vsdx` bytes. Two calls with the same drawing produce the same bytes. */
export function packVisioDrawing(drawing: VisioDrawing): Uint8Array {
  return packOpcPackage(buildVisioDrawingParts(drawing));
}
