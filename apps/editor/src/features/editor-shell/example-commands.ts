import type { CircuitProject, GridRect } from "@icm/model";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";

import { normalizeImportedProjectConductors } from "../../document/project-conductor-normalization";
import {
  createLibraryExampleProject,
  type LibraryProjectExample,
} from "../../examples/library-examples";
import {
  clipboardPlacementAnchor,
  type SchematicClipboard,
} from "../clipboard/clipboard";
import { captureProjectCopy } from "../clipboard/project-copy";

export interface ExampleCommandDependencies {
  defaultViewBox: GridRect;
  replaceActiveProject: (
    project: CircuitProject,
    viewBox?: GridRect,
  ) => unknown;
  guardDirtyReplacement: (
    intent: string,
    perform: () => void | Promise<void>,
  ) => Promise<void>;
  beginCopyPlacement: (
    clipboard: SchematicClipboard,
    anchor: { x: number; y: number },
  ) => void;
  cancelAllTransientInteraction: () => void;
  setStatus: (status: string) => void;
}

/**
 * Owns bundled-example project loading decisions. React keeps the panel state,
 * while this facade owns guarded replacement and the single-Document
 * import-to-clipboard boundary.
 */
export function createExampleCommands({
  replaceActiveProject,
  guardDirtyReplacement,
  beginCopyPlacement,
  cancelAllTransientInteraction,
  setStatus,
}: ExampleCommandDependencies) {
  const normalizeImportedProject = (imported: CircuitProject): CircuitProject =>
    normalizeImportedProjectConductors(
      imported,
      createProjectSymbolResolver(imported, builtInSymbols),
    ).project;

  const beginProjectImportPlacement = (
    imported: CircuitProject,
    label: string,
  ): boolean => {
    const normalized = normalizeImportedProject(imported);
    const importedDocument = normalized.documents.find(
      (candidate) => candidate.id === normalized.topDocumentId,
    );
    if (!importedDocument) return false;
    const clipboard = captureProjectCopy(normalized, importedDocument);
    const anchor = clipboard ? clipboardPlacementAnchor(clipboard) : null;
    if (!clipboard || !anchor) return false;
    try {
      cancelAllTransientInteraction();
      beginCopyPlacement(clipboard, anchor);
    } catch (error) {
      setStatus(
        `Cannot copy ${label}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return true;
    }
    setStatus(
      `Place ${label} on the canvas · R rotates · Shift+R / Ctrl+R mirrors · Esc cancels`,
    );
    return true;
  };

  const openLibraryExample = (example: LibraryProjectExample): void => {
    const exampleProject = createLibraryExampleProject(example.id);
    if (!exampleProject) {
      setStatus(`Example is unavailable: ${example.name}`);
      return;
    }
    if (beginProjectImportPlacement(exampleProject, example.name)) return;
    void guardDirtyReplacement(`Open ${example.name} example`, () => {
      replaceActiveProject(exampleProject);
      setStatus(`Opened example: ${example.name}`);
    });
  };

  return { beginProjectImportPlacement, openLibraryExample };
}
