/**
 * The symbol stencil.
 *
 * A `.vssx` is the same package as a drawing with the document part typed as a
 * stencil and no page contents: Visio opens it in the shapes window instead of
 * a drawing window. Exporting one alongside the drawing is what lets someone
 * add a transistor to the schematic in Visio rather than only rearrange the
 * ones already on the page.
 *
 * Symbols whose artwork depends on their formula have no stencil entry, for the
 * same reason they have no master — there is no one outline to put in the
 * window. `buildSymbolMasters` leaves them out.
 */

import { builtInSymbols } from "@icm/symbols";
import type { SymbolDefinition } from "@icm/symbols";

import { VISIO_CREATOR } from "./drawing.js";
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
  pagesPart,
  windowsPart,
} from "./parts.js";
import type { VisioPackageLayout, VisioPageDescription } from "./parts.js";
import { buildSymbolMasters } from "./symbol-master.js";
import type { VisioSymbolMaster } from "./symbol-master.js";

export const VISIO_STENCIL_MEDIA_TYPE = "application/vnd.ms-visio.stencil";

export const VISIO_STENCIL_EXTENSION = "vssx";

export const DEFAULT_STENCIL_TITLE = "Schematic Draft symbols";

/**
 * The page a stencil carries. Nothing is ever drawn on it; Visio just wants a
 * page sheet to exist, and letter paper is the least surprising thing to name.
 */
const STENCIL_PAGE: VisioPageDescription = {
  name: "Stencil",
  widthInches: 8.5,
  heightInches: 11,
};

export interface VisioStencil {
  readonly masters: readonly VisioMaster[];
  readonly title?: string;
}

export function buildVisioStencilParts(stencil: VisioStencil): OpcPart[] {
  if (stencil.masters.length === 0) {
    throw new Error("A Visio stencil needs at least one master");
  }
  const layout: VisioPackageLayout = {
    kind: "stencil",
    masterPaths: stencil.masters.map((master) =>
      masterContentsPartPath(master),
    ),
    hasPageContents: false,
  };
  return [
    contentTypesPart(layout),
    packageRelationshipsPart(),
    corePropertiesPart({
      title: stencil.title ?? DEFAULT_STENCIL_TITLE,
      creator: VISIO_CREATOR,
    }),
    documentPart(),
    documentRelationshipsPart(layout),
    ...masterParts(stencil.masters),
    pagesPart(STENCIL_PAGE, layout),
    windowsPart(STENCIL_PAGE),
  ];
}

/** Writes a stencil as `.vssx` bytes. */
export function packVisioStencil(stencil: VisioStencil): Uint8Array {
  return packOpcPackage(buildVisioStencilParts(stencil));
}

/** Every built-in symbol that has a fixed outline, as masters. */
export function buildSymbolLibraryMasters(
  definitions: readonly SymbolDefinition[] = builtInSymbols,
): VisioSymbolMaster[] {
  return buildSymbolMasters(definitions);
}

/** The whole built-in symbol library as a `.vssx`. */
export function packSymbolLibraryStencil(
  definitions: readonly SymbolDefinition[] = builtInSymbols,
): Uint8Array {
  return packVisioStencil({
    masters: buildSymbolLibraryMasters(definitions).map(
      (symbolMaster) => symbolMaster.master,
    ),
  });
}
