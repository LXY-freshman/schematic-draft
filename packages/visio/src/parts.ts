/**
 * The XML parts of a Visio drawing package.
 *
 * Every part here was checked against a drawing Visio itself wrote, then cut
 * back to what a schematic needs: no theme, no thumbnail, no extended or custom
 * document properties. What remains is the manifest, the relationships, one
 * style sheet that shapes inherit from, and the page.
 */

import type { OpcPart } from "./opc.js";
import { CONTENT_TYPES_PART } from "./opc.js";
import { MASTERS_PART } from "./masters.js";
import {
  PACKAGE_RELATIONSHIPS_NAMESPACE,
  RELATIONSHIP_NAMESPACE,
  VISIO_NAMESPACE,
  XML_DECLARATION,
  escapeXmlAttribute,
  escapeXmlText,
  formatVisioNumber,
} from "./xml.js";
import { CONNECTION_GRID_INCHES } from "./units.js";

export const DOCUMENT_PART = "visio/document.xml";
export const PAGES_PART = "visio/pages/pages.xml";
export const PAGE_CONTENTS_PART = "visio/pages/page1.xml";
export const WINDOWS_PART = "visio/windows.xml";
export const CORE_PROPERTIES_PART = "docProps/core.xml";

/**
 * What a package is for. The two kinds share every part but one: the content
 * type of the document part is the only thing that tells Visio whether to open
 * a drawing window or a stencil window.
 */
export type VisioPackageKind = "drawing" | "stencil";

const DOCUMENT_CONTENT_TYPES: Record<VisioPackageKind, string> = {
  drawing: "application/vnd.ms-visio.drawing.main+xml",
  stencil: "application/vnd.ms-visio.stencil.main+xml",
};

export interface VisioPageDescription {
  /** Universal page name; Visio also shows it on the page tab. */
  readonly name: string;
  readonly widthInches: number;
  readonly heightInches: number;
}

export interface VisioDocumentMetadata {
  readonly title: string;
  readonly creator: string;
}

export interface VisioPackageLayout {
  readonly kind: VisioPackageKind;
  /** Paths of the `masterN.xml` parts, if the package carries masters. */
  readonly masterPaths: readonly string[];
  /** A stencil has a page sheet but no page contents to declare. */
  readonly hasPageContents: boolean;
}

export function contentTypesPart(layout: VisioPackageLayout): OpcPart {
  const masters =
    layout.masterPaths.length === 0
      ? ""
      : `<Override PartName="/${MASTERS_PART}" ContentType="application/vnd.ms-visio.masters+xml"/>` +
        layout.masterPaths
          .map(
            (path) =>
              `<Override PartName="/${path}" ContentType="application/vnd.ms-visio.master+xml"/>`,
          )
          .join("");
  const pageContents = layout.hasPageContents
    ? `<Override PartName="/${PAGE_CONTENTS_PART}" ContentType="application/vnd.ms-visio.page+xml"/>`
    : "";
  return {
    path: CONTENT_TYPES_PART,
    content: `${XML_DECLARATION}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/${DOCUMENT_PART}" ContentType="${DOCUMENT_CONTENT_TYPES[layout.kind]}"/>${masters}<Override PartName="/${PAGES_PART}" ContentType="application/vnd.ms-visio.pages+xml"/>${pageContents}<Override PartName="/${WINDOWS_PART}" ContentType="application/vnd.ms-visio.windows+xml"/><Override PartName="/${CORE_PROPERTIES_PART}" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
  };
}

export function packageRelationshipsPart(): OpcPart {
  return {
    path: "_rels/.rels",
    content: `${XML_DECLARATION}<Relationships xmlns="${PACKAGE_RELATIONSHIPS_NAMESPACE}"><Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/document" Target="${DOCUMENT_PART}"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="${CORE_PROPERTIES_PART}"/></Relationships>`,
  };
}

/**
 * Document properties. No timestamps: they would be the one part of the package
 * that changed between two exports of the same drawing, and the file on disk
 * already carries the time it was written.
 */
export function corePropertiesPart(metadata: VisioDocumentMetadata): OpcPart {
  return {
    path: CORE_PROPERTIES_PART,
    content: `${XML_DECLARATION}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${escapeXmlText(metadata.title)}</dc:title><dc:creator>${escapeXmlText(metadata.creator)}</dc:creator><cp:lastModifiedBy>${escapeXmlText(metadata.creator)}</cp:lastModifiedBy></cp:coreProperties>`,
  };
}

/**
 * The document part. `DefaultLineStyle` and its siblings name style sheet 0,
 * the only style sheet written here, so every shape inherits plain black
 * hairlines and no fill instead of a theme this package does not ship.
 */
export function documentPart(): OpcPart {
  const styleSheet =
    `<StyleSheet ID="0" NameU="No Style" IsCustomNameU="1" Name="No Style" IsCustomName="1">` +
    `<Cell N="EnableLineProps" V="1"/><Cell N="EnableFillProps" V="1"/><Cell N="EnableTextProps" V="1"/><Cell N="HideForApply" V="0"/>` +
    `<Cell N="LineWeight" V="0.01"/><Cell N="LineColor" V="0"/><Cell N="LinePattern" V="1"/><Cell N="Rounding" V="0"/>` +
    `<Cell N="LineCap" V="0"/><Cell N="LineColorTrans" V="0"/><Cell N="CompoundType" V="0"/>` +
    `<Cell N="BeginArrow" V="0"/><Cell N="EndArrow" V="0"/><Cell N="BeginArrowSize" V="2"/><Cell N="EndArrowSize" V="2"/>` +
    `<Cell N="FillForegnd" V="1"/><Cell N="FillBkgnd" V="1"/><Cell N="FillPattern" V="0"/>` +
    `<Cell N="FillForegndTrans" V="0"/><Cell N="FillBkgndTrans" V="0"/>` +
    `<Cell N="ShdwForegnd" V="0"/><Cell N="ShdwPattern" V="0"/><Cell N="ShdwForegndTrans" V="0"/>` +
    `<Cell N="LeftMargin" V="0" U="PT"/><Cell N="RightMargin" V="0" U="PT"/><Cell N="TopMargin" V="0" U="PT"/><Cell N="BottomMargin" V="0" U="PT"/>` +
    `<Cell N="VerticalAlign" V="1"/><Cell N="TextBkgnd" V="0"/><Cell N="TextBkgndTrans" V="0"/><Cell N="TextDirection" V="0"/><Cell N="DefaultTabStop" V="0.5"/>` +
    `</StyleSheet>`;
  return {
    path: DOCUMENT_PART,
    content:
      `${XML_DECLARATION}<VisioDocument xmlns="${VISIO_NAMESPACE}" xmlns:r="${RELATIONSHIP_NAMESPACE}" xml:space="preserve">` +
      `<DocumentSettings TopPage="0" DefaultTextStyle="0" DefaultLineStyle="0" DefaultFillStyle="0">` +
      `<GlueSettings>9</GlueSettings><SnapSettings>65847</SnapSettings><SnapExtensions>34</SnapExtensions>` +
      `<DynamicGridEnabled>1</DynamicGridEnabled><ProtectStyles>0</ProtectStyles><ProtectShapes>0</ProtectShapes>` +
      `<ProtectMasters>0</ProtectMasters><ProtectBkgnds>0</ProtectBkgnds>` +
      `</DocumentSettings>` +
      `<StyleSheets>${styleSheet}</StyleSheets>` +
      `<DocumentSheet NameU="TheDoc" IsCustomNameU="1" Name="TheDoc" IsCustomName="1" LineStyle="0" FillStyle="0" TextStyle="0">` +
      `<Cell N="OutputFormat" V="0"/><Cell N="LockPreview" V="0"/><Cell N="PreviewQuality" V="0"/><Cell N="PreviewScope" V="0"/>` +
      `</DocumentSheet>` +
      `</VisioDocument>`,
  };
}

export function documentRelationshipsPart(layout: VisioPackageLayout): OpcPart {
  const masters =
    layout.masterPaths.length === 0
      ? ""
      : `<Relationship Id="rId3" Type="http://schemas.microsoft.com/visio/2010/relationships/masters" Target="masters/masters.xml"/>`;
  return {
    path: "visio/_rels/document.xml.rels",
    content: `${XML_DECLARATION}<Relationships xmlns="${PACKAGE_RELATIONSHIPS_NAMESPACE}"><Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/pages" Target="pages/pages.xml"/><Relationship Id="rId2" Type="http://schemas.microsoft.com/visio/2010/relationships/windows" Target="windows.xml"/>${masters}</Relationships>`,
  };
}

/**
 * The page sheet. `DrawingSizeType` 3 is a custom page size: the page is sized
 * to the drawing, not to whatever paper the machine's default printer holds.
 * `PageScale` equals `DrawingScale`, so the drawing is 1:1 and one grid step is
 * the connection grid.
 *
 * A stencil declares the same page and leaves it empty — Visio wants somewhere
 * to drop a master being edited, and the stencil window never shows it.
 */
export function pagesPart(
  page: VisioPageDescription,
  layout: VisioPackageLayout,
): OpcPart {
  const width = formatVisioNumber(page.widthInches);
  const height = formatVisioNumber(page.heightInches);
  const grid = formatVisioNumber(CONNECTION_GRID_INCHES);
  return {
    path: PAGES_PART,
    content:
      `${XML_DECLARATION}<Pages xmlns="${VISIO_NAMESPACE}" xmlns:r="${RELATIONSHIP_NAMESPACE}" xml:space="preserve">` +
      `<Page ID="0" NameU="${escapeXmlAttribute(page.name)}" IsCustomNameU="1" Name="${escapeXmlAttribute(page.name)}" IsCustomName="1" ViewScale="-1" ViewCenterX="${formatVisioNumber(page.widthInches / 2)}" ViewCenterY="${formatVisioNumber(page.heightInches / 2)}">` +
      `<PageSheet LineStyle="0" FillStyle="0" TextStyle="0">` +
      `<Cell N="PageWidth" V="${width}"/><Cell N="PageHeight" V="${height}"/>` +
      `<Cell N="PageScale" V="1" U="IN_F"/><Cell N="DrawingScale" V="1" U="IN_F"/>` +
      `<Cell N="DrawingSizeType" V="3"/><Cell N="DrawingScaleType" V="0"/><Cell N="DrawingResizeType" V="1"/>` +
      `<Cell N="XGridSpacing" V="${grid}"/><Cell N="YGridSpacing" V="${grid}"/>` +
      `<Cell N="XRulerDensity" V="32"/><Cell N="YRulerDensity" V="32"/>` +
      `<Cell N="InhibitSnap" V="0"/><Cell N="UIVisibility" V="0"/>` +
      `<Cell N="ShdwType" V="0"/><Cell N="ShdwObliqueAngle" V="0"/><Cell N="ShdwScaleFactor" V="1"/>` +
      `<Cell N="ShdwOffsetX" V="0"/><Cell N="ShdwOffsetY" V="0"/>` +
      `<Cell N="PageShapeSplit" V="1"/>` +
      `</PageSheet>` +
      (layout.hasPageContents ? `<Rel r:id="rId1"/>` : "") +
      `</Page></Pages>`,
  };
}

export function pagesRelationshipsPart(): OpcPart {
  return {
    path: "visio/pages/_rels/pages.xml.rels",
    content: `${XML_DECLARATION}<Relationships xmlns="${PACKAGE_RELATIONSHIPS_NAMESPACE}"><Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/page" Target="page1.xml"/></Relationships>`,
  };
}

/** The page's shapes. `body` is empty until this package can emit shapes. */
export function pageContentsPart(body: string): OpcPart {
  const open = `<PageContents xmlns="${VISIO_NAMESPACE}" xmlns:r="${RELATIONSHIP_NAMESPACE}" xml:space="preserve">`;
  return {
    path: PAGE_CONTENTS_PART,
    content: `${XML_DECLARATION}${open}${body}</PageContents>`,
  };
}

/**
 * Window state. Visio rebuilds this the moment the user touches the window, but
 * without it the drawing opens with no page selected.
 */
export function windowsPart(page: VisioPageDescription): OpcPart {
  return {
    path: WINDOWS_PART,
    content:
      `${XML_DECLARATION}<Windows xmlns="${VISIO_NAMESPACE}" xmlns:r="${RELATIONSHIP_NAMESPACE}" xml:space="preserve">` +
      `<Window ID="0" WindowType="Drawing" WindowState="1073741824" ContainerType="Page" Page="0" ViewScale="-1" ViewCenterX="${formatVisioNumber(page.widthInches / 2)}" ViewCenterY="${formatVisioNumber(page.heightInches / 2)}">` +
      `<ShowRulers>1</ShowRulers><ShowGrid>1</ShowGrid><ShowGuides>1</ShowGuides><ShowConnectionPoints>1</ShowConnectionPoints>` +
      `<GlueSettings>9</GlueSettings><SnapSettings>65847</SnapSettings><SnapExtensions>34</SnapExtensions>` +
      `<DynamicGridEnabled>1</DynamicGridEnabled>` +
      `</Window></Windows>`,
  };
}
