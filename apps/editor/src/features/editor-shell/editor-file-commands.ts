import { convertImportSources } from "../netlist-export/convert-import-sources";
import type {
  NetlistFormat,
  NetlistNamingProfile,
  NetlistExportProfile,
  NetlistPortCase,
} from "@icm/netlist";
import type { CircuitProject, GridRect, SchematicDocument } from "@icm/model";
import { importSpiceSources } from "@icm/spice";
import type { SymbolResolver } from "@icm/symbols";

import {
  createVisioExportArtifact,
  createVisioStencilArtifact,
  createVisualExportArtifact,
  createSvgExportArtifact,
  describeExportFailure,
  planDesignNetlistExport,
  requestBrowserDownload,
} from "./editor-export-commands";
import type { DesignNetlistExportPlan } from "./editor-export-commands";

type SpiceImportResult = Awaited<ReturnType<typeof importSpiceSources>>;
export interface SpiceImportReport {
  entryPath: string;
  diagnostics: SpiceImportResult["diagnostics"];
}

export interface EditorFileCommandDependencies {
  project: CircuitProject;
  document: SchematicDocument;
  resolver: SymbolResolver;
  defaultViewBox: GridRect;
  electricalWarningsPresent: () => boolean;
  netlistProfile?: NetlistExportProfile;
  netlistPortCase?: NetlistPortCase;
  netlistConfigurationError?: string | null;
  guardDirtyReplacement: (
    label: string,
    replace: () => void | Promise<void>,
  ) => Promise<void>;
  replaceActiveProject: (
    project: CircuitProject,
    viewBox: GridRect,
    options: { source: "spice-import" },
  ) => void;
  showNetlist: (
    format: NetlistFormat,
    namingProfile: NetlistNamingProfile,
  ) => void;
  setImportReport: (report: SpiceImportReport | null) => void;
  setImportReviewOpen: (open: boolean) => void;
  setSelectionOpen: (open: boolean) => void;
  setStatus: (status: string) => void;
  /** Raise the refresh banner when an on-demand chunk has gone missing. */
  onChunkLoadFailure?: (feature: string) => void;
}

/** File import/export commands and their user-facing gate/status policy. */
export function createEditorFileCommands({
  project,
  document,
  resolver,
  defaultViewBox,
  electricalWarningsPresent,
  netlistProfile,
  netlistPortCase,
  netlistConfigurationError,
  guardDirtyReplacement,
  replaceActiveProject,
  showNetlist,
  setImportReport,
  setImportReviewOpen,
  setSelectionOpen,
  setStatus,
  onChunkLoadFailure,
}: EditorFileCommandDependencies) {
  const exportSvg = (): void => {
    setStatus("Preparing SVG export");
    void createSvgExportArtifact(document, resolver, project.name)
      .then((artifact) => {
        requestBrowserDownload(artifact, project.name);
        setStatus(artifact.report);
      })
      .catch((error: unknown) => {
        setStatus(error instanceof Error ? error.message : "Export failed");
      });
  };

  /**
   * Everything both netlist commands decide before they differ: the sidebar
   * shows the netlist, a broken configuration stops here, and a drawing the
   * Check Report refuses is refused the same way whether the text is going to
   * the clipboard or to a file. Only the delivery is the caller's.
   */
  const planNetlist = (
    format: NetlistFormat,
    namingProfile: NetlistNamingProfile,
    delivery: "clipboard" | "file",
  ): DesignNetlistExportPlan | null => {
    showNetlist(format, namingProfile);
    if (netlistConfigurationError) {
      setStatus(`Fix Netlist configuration: ${netlistConfigurationError}`);
      return null;
    }
    const plan = planDesignNetlistExport({
      format,
      project,
      namingProfile,
      delivery,
      ...(netlistProfile ? { profile: netlistProfile } : {}),
      ...(netlistPortCase ? { portCase: netlistPortCase } : {}),
      electricalWarningsPresent: electricalWarningsPresent(),
    });
    if (plan.status === "blocked") {
      setStatus(plan.message);
      return null;
    }
    return plan;
  };

  const exportDesignNetlist = (
    format: NetlistFormat,
    namingProfile: NetlistNamingProfile = "native",
  ): void => {
    const plan = planNetlist(format, namingProfile, "clipboard");
    if (plan?.status !== "ready") return;
    void (async () => {
      try {
        await navigator.clipboard.writeText(String(plan.artifact.bytes));
        setStatus(plan.artifact.report);
      } catch {
        setStatus(
          "Clipboard unavailable; select the netlist in the sidebar and copy it",
        );
      }
    })();
  };

  /**
   * The same netlist, written to a file instead of the clipboard. Until now
   * the only way out of the editor was `Ctrl+V` into something else, so a
   * netlist could not be handed to a simulator without a round trip through
   * another program — and a clipboard the browser refuses left no way at all.
   *
   * The delivery is the ordinary export surface: in the shell it is a native
   * Save As dialog that starts in `Projects\`, the same as SVG, PNG and Visio.
   */
  const saveDesignNetlistToFile = (
    format: NetlistFormat,
    namingProfile: NetlistNamingProfile = "native",
  ): void => {
    const plan = planNetlist(format, namingProfile, "file");
    if (plan?.status !== "ready") return;
    requestBrowserDownload(plan.artifact, project.name);
    setStatus(plan.artifact.report);
  };

  const exportRaster = async (format: "png" | "pdf"): Promise<void> => {
    setStatus(`Preparing ${format.toUpperCase()} export`);
    try {
      const artifact = await createVisualExportArtifact(
        format,
        document,
        resolver,
        project.name,
      );
      requestBrowserDownload(artifact, project.name);
      setStatus(artifact.report);
    } catch (error) {
      const failure = describeExportFailure(error);
      setStatus(failure.status);
      if (failure.chunkFeature) onChunkLoadFailure?.(failure.chunkFeature);
    }
  };

  /**
   * The Visio drawing, or the stencil its shapes come from.
   *
   * Both go out through the same download surface the other exports use, and
   * the drawing's status line carries whatever the page could not carry with
   * it — the export is meant to be worked in, so a silent loss would be found
   * by dragging a device rather than by reading.
   */
  const exportVisio = async (
    kind: "drawing" | "stencil" = "drawing",
  ): Promise<void> => {
    setStatus(
      kind === "stencil" ? "Preparing Visio stencil" : "Preparing Visio export",
    );
    try {
      const artifact =
        kind === "stencil"
          ? await createVisioStencilArtifact()
          : await createVisioExportArtifact(document, resolver, project.name);
      requestBrowserDownload(artifact, project.name);
      setStatus(artifact.report);
    } catch (error) {
      const failure = describeExportFailure(error);
      setStatus(failure.status);
      if (failure.chunkFeature) onChunkLoadFailure?.(failure.chunkFeature);
    }
  };

  const importSpiceFiles = async (
    files: FileList | null,
    namingProfile: "native" | "cadence-bang" = "native",
  ): Promise<void> => {
    if (!files || files.length === 0) return;
    const sourceInputs = await Promise.all(
      [...files].map(async (file) => ({
        path: file.webkitRelativePath || file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
      })),
    );
    const conventionalEntries = sourceInputs.filter((input) =>
      /\.(?:cir|sp|spi|scs)$/iu.test(input.path),
    );
    const namedCircuitEntries = conventionalEntries.filter((input) =>
      /^circuit\.(?:spi|scs)$/iu.test(input.path.split("/").at(-1) ?? ""),
    );
    const entryCandidates =
      namedCircuitEntries.length === 1
        ? namedCircuitEntries
        : conventionalEntries;
    if (entryCandidates.length !== 1) {
      setStatus(
        `Select one unambiguous .cir, .sp, .spi, or .scs entry and its local include files; found ${entryCandidates.length}`,
      );
      return;
    }
    setStatus("Importing SPICE sources");
    try {
      const result = await importSpiceSources(
        convertImportSources(sourceInputs),
        entryCandidates[0]!.path,
        {},
        { namingProfile },
      );
      const nextImportReport: SpiceImportReport = {
        entryPath: entryCandidates[0]!.path,
        diagnostics: result.diagnostics,
      };
      if (!result.project || !result.successful) {
        setImportReport(nextImportReport);
        setImportReviewOpen(true);
        setSelectionOpen(true);
        const firstError = result.diagnostics.find(
          (item) => item.severity === "error",
        );
        setStatus(firstError?.message ?? "SPICE import failed");
        return;
      }
      const importedProject = result.project;
      const instanceCount = importedProject.documents.reduce(
        (count, candidate) => count + candidate.instances.length,
        0,
      );
      await guardDirtyReplacement("Import SPICE sources", () => {
        replaceActiveProject(importedProject, defaultViewBox, {
          source: "spice-import",
        });
        setImportReport(nextImportReport);
        setImportReviewOpen(true);
        setSelectionOpen(true);
        setStatus(
          `Imported ${importedProject.documents.length} Documents and ${instanceCount} structural instances`,
        );
      });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "SPICE import failed");
    }
  };

  return {
    exportSvg,
    exportDesignNetlist,
    saveDesignNetlistToFile,
    exportRaster,
    exportVisio,
    importSpiceFiles,
  };
}
