import { createFormalExportSource, safeExportBaseName } from "@icm/exporters";
import {
  createDesignNetlistExport,
  unfinishedDrawingDiagnostics,
} from "@icm/netlist";
import type {
  NetlistFormat,
  NetlistNamingProfile,
  NetlistExportProfile,
  NetlistPortCase,
} from "@icm/netlist";
import type { CircuitProject, SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import type { VisioPageCaveat } from "@icm/visio";
import { prepareDocumentFormulaArtifacts } from "../text-editing/formula-artifacts";
import {
  ChunkLoadError,
  chunkLoadStatus,
  importChunk,
} from "../../components/chunk-import";

export interface EditorExportArtifact {
  bytes: BlobPart;
  mediaType: string;
  extension: string;
  report: string;
  /**
   * What to call the file, when the project's name is the wrong answer. The
   * symbol stencil is the only one so far: it is the same library whatever
   * circuit is open, and naming three copies of it after three projects would
   * suggest they differ.
   */
  baseName?: string;
}

async function preparedFormalExportSource(
  document: SchematicDocument,
  resolver: SymbolResolver,
  projectName: string,
) {
  const prepared = await prepareDocumentFormulaArtifacts(document);
  try {
    return createFormalExportSource(document, resolver, {
      title: projectName,
    });
  } finally {
    prepared.release();
  }
}

export type DesignNetlistExportPlan =
  | { status: "blocked"; message: string }
  | { status: "ready"; artifact: EditorExportArtifact };

export async function createSvgExportArtifact(
  document: SchematicDocument,
  resolver: SymbolResolver,
  projectName: string,
): Promise<EditorExportArtifact> {
  const source = await preparedFormalExportSource(
    document,
    resolver,
    projectName,
  );
  return {
    bytes: source.svg,
    mediaType: "image/svg+xml",
    extension: "svg",
    report: `Exported revision ${document.revision}`,
  };
}

export function planDesignNetlistExport({
  format,
  project,
  namingProfile = "native",
  profile,
  portCase,
  electricalWarningsPresent = false,
  delivery = "clipboard",
}: {
  format: NetlistFormat;
  project: CircuitProject;
  namingProfile?: NetlistNamingProfile;
  profile?: NetlistExportProfile;
  portCase?: NetlistPortCase;
  electricalWarningsPresent?: boolean;
  /**
   * Where the netlist is going. The netlist itself and every reason to refuse
   * to produce one are identical either way — this only decides whether the
   * report says the text was copied or the file was written, so the two
   * commands cannot drift apart on what counts as exportable.
   */
  delivery?: "clipboard" | "file";
}): DesignNetlistExportPlan {
  const result = createDesignNetlistExport(project, {
    format,
    namingProfile,
    ...(profile ? { profile } : {}),
    ...(portCase ? { portCase } : {}),
  });
  if (result.status === "blocked") {
    return {
      status: "blocked",
      message: "Resolve the Check Report findings before export",
    };
  }
  // An unbound model or width is handed out as a TODO placeholder; a node
  // only one pin reaches is not a value somebody can fill in later, so this
  // netlist is not something to hand out at all.
  const unfinished = unfinishedDrawingDiagnostics(result.diagnostics);
  if (unfinished.length > 0) {
    return {
      status: "blocked",
      message:
        unfinished.length === 1
          ? unfinished[0]!.message
          : `${unfinished.length} dead-end nodes. ${unfinished[0]!.message}`,
    };
  }
  const printed = result.file;
  const label = format === "spice" ? "SPICE" : "Spectre";
  const note = result.placeholders.length
    ? `; incomplete netlist: ${result.placeholders.length} TODO field${result.placeholders.length === 1 ? "" : "s"}`
    : result.diagnostics.length || electricalWarningsPresent
      ? "; see Check Report for findings"
      : "";
  return {
    status: "ready",
    artifact: {
      bytes: printed.text,
      mediaType: printed.mediaType,
      extension: printed.extension.slice(1),
      report:
        delivery === "clipboard"
          ? `${label} netlist copied${note}`
          : `Exported ${label} netlist${note}`,
    },
  };
}

export async function createVisualExportArtifact(
  format: "png" | "pdf",
  document: SchematicDocument,
  resolver: SymbolResolver,
  projectName: string,
): Promise<EditorExportArtifact> {
  const source = await preparedFormalExportSource(
    document,
    resolver,
    projectName,
  );
  if (format === "png") {
    const { rasterizeFormalSvgInBrowser } = await importChunk(
      "PNG export",
      () => import("@icm/exporters/browser-raster"),
    );
    const png = await rasterizeFormalSvgInBrowser(source);
    return {
      bytes: png.bytes as BlobPart,
      mediaType: png.mediaType,
      extension: "png",
      report: `Exported PNG revision ${document.revision}`,
    };
  }
  const { vectorizeFormalSvgInBrowser } = await importChunk(
    "PDF export",
    () => import("@icm/exporters/browser-pdf"),
  );
  const pdf = await vectorizeFormalSvgInBrowser(source);
  return {
    bytes: pdf as BlobPart,
    mediaType: "application/pdf",
    extension: "pdf",
    report: `Exported PDF revision ${document.revision}`,
  };
}

/**
 * What each Visio caveat means to someone who is about to open the file.
 *
 * A `.vsdx` is exported to be worked in, not looked at, so anything the package
 * could not carry is something the user would otherwise discover by moving a
 * transistor. Each phrase is printed with its count after it, which is why none
 * of them is inflected for one.
 */
const VISIO_CAVEAT_PHRASES: Record<VisioPageCaveat["kind"], string> = {
  "annotation-ornament": "annotation ornaments dropped",
  "body-text": "symbol body text drawn on the page instead of in the symbol",
  "formula-text": "formulas written as their source",
  "overbar-text": "overbar rules dropped",
  "pin-name-text": "pin names left off the symbol",
  "stacked-fraction": "fractions flattened onto one line",
  "unglued-wire-end": "wire ends not glued to a pin",
  "unplaced-instance": "instances left off the page for want of a placement",
  "unresolved-route": "wires left off the page for want of geometry",
  "upright-mark": "symbol marks that turn with the shape",
};

/** Names every kind of loss the page reported, with how often it happened. */
function summarizeVisioCaveats(caveats: readonly VisioPageCaveat[]): string {
  const counts = new Map<VisioPageCaveat["kind"], number>();
  for (const caveat of caveats) {
    counts.set(caveat.kind, (counts.get(caveat.kind) ?? 0) + 1);
  }
  return [...counts]
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([kind, count]) => `${VISIO_CAVEAT_PHRASES[kind]} (${count})`)
    .join(", ");
}

/**
 * The open Document as a Visio drawing.
 *
 * Unlike the other three this is not derived from the formal SVG: a flat scene
 * would arrive in Visio as loose geometry, which is the one thing a drawing
 * exported to be edited must not be. It comes from the Document instead, so the
 * instances are shapes, the wires are connectors glued to their pins, and the
 * connectivity survives being rearranged.
 */
export async function createVisioExportArtifact(
  document: SchematicDocument,
  resolver: SymbolResolver,
  projectName: string,
): Promise<EditorExportArtifact> {
  const {
    VISIO_DRAWING_EXTENSION,
    VISIO_DRAWING_MEDIA_TYPE,
    packVisioDrawing,
    visioDrawingForDocument,
  } = await importChunk("Visio export", () => import("@icm/visio"));
  const { drawing, page } = visioDrawingForDocument(document, resolver);
  const lost = summarizeVisioCaveats(page.caveats);
  return {
    // The package is titled after the project, the way the SVG export titles
    // its scene; the page keeps the Document's own name, since a project with
    // several Documents exports one of them at a time.
    bytes: packVisioDrawing({ ...drawing, title: projectName }) as BlobPart,
    mediaType: VISIO_DRAWING_MEDIA_TYPE,
    extension: VISIO_DRAWING_EXTENSION,
    report:
      `Exported Visio revision ${document.revision}` +
      (lost === "" ? "" : `; ${lost}`),
  };
}

/**
 * The built-in symbol library as a Visio stencil.
 *
 * The drawing alone only lets someone rearrange the devices already on the
 * page. The stencil is what lets them add one, so it is offered beside the
 * drawing rather than left as something only the repository can produce.
 */
export async function createVisioStencilArtifact(): Promise<EditorExportArtifact> {
  const {
    DEFAULT_STENCIL_TITLE,
    VISIO_STENCIL_EXTENSION,
    VISIO_STENCIL_MEDIA_TYPE,
    packSymbolLibraryStencil,
  } = await importChunk("Visio export", () => import("@icm/visio"));
  return {
    bytes: packSymbolLibraryStencil() as BlobPart,
    mediaType: VISIO_STENCIL_MEDIA_TYPE,
    extension: VISIO_STENCIL_EXTENSION,
    baseName: DEFAULT_STENCIL_TITLE,
    report: "Exported the Visio symbol stencil",
  };
}

/** Deliver a prepared artifact through the browser download surface. */
export function requestBrowserDownload(
  artifact: EditorExportArtifact,
  baseName: string,
): void {
  const url = URL.createObjectURL(
    new Blob([artifact.bytes], { type: artifact.mediaType }),
  );
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = `${safeExportBaseName(artifact.baseName ?? baseName)}.${artifact.extension}`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * User-facing account of a failed export. A vanished on-demand chunk gets
 * the refresh remedy and names the feature so the App can raise the banner;
 * anything else keeps its own message.
 */
export function describeExportFailure(error: unknown): {
  status: string;
  chunkFeature?: string;
} {
  if (error instanceof ChunkLoadError) {
    return {
      status: chunkLoadStatus(error.feature),
      chunkFeature: error.feature,
    };
  }
  return {
    status: error instanceof Error ? error.message : "Export failed",
  };
}
