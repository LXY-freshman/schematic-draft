import { useEffect, useRef, useState } from "react";

import { createEmptyProject, createId } from "@icm/model";
import type { CircuitProject, GridRect, SchematicDocument } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";
import {
  builtInSymbols,
  findUnsupportedProjectSymbolIds,
  InMemorySymbolResolver,
} from "@icm/symbols";

import { materializeRazaviProjectBulkConnections } from "../presentation/razavi-presentation";
import type {
  BrowserRecoveryFormalFileHint,
  BrowserRecoveryGeneration,
  BrowserRecoverySource,
} from "./browser-recovery-contract";
import type { RecoveryCoordinator } from "./recovery-coordinator";
import {
  formatProjectOpenDiagnostics,
  projectFileBaseName,
  stageProjectFile,
} from "./project-file-service";
import { projectChangeToken } from "./project-session-lifecycle";
import { projectHasMeaningfulContent } from "./project-content";
import { normalizeImportedProjectConductors } from "./project-conductor-normalization";
import {
  fileNameFromPath,
  openProjectFileFromDisk,
  readProjectFileAt,
  saveTextAsFile,
  writeProjectFile,
  type OpenedProjectFile,
  type ProjectFileBinding,
  type ProjectFileSaveOutcome,
} from "../features/editor-shell/project-files";

export const REFRESH_RESTORE_STORAGE_KEY = "icm.restore-after-refresh.v1";
/** The file to offer on the next launch, so the editor reopens where it left off. */
const RECENT_PATH_STORAGE_KEY = "icm.recent-project-path.v1";

function readRecentProjectPath(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(RECENT_PATH_STORAGE_KEY);
    return stored === null || stored === "" ? null : stored;
  } catch {
    return null;
  }
}

function rememberRecentProjectPath(path: string): void {
  try {
    window.localStorage.setItem(RECENT_PATH_STORAGE_KEY, path);
  } catch {
    // A blocked storage only costs the reopen convenience.
  }
}

function forgetRecentProjectPath(): void {
  try {
    window.localStorage.removeItem(RECENT_PATH_STORAGE_KEY);
  } catch {
    // Nothing to forget if storage is unavailable.
  }
}

const projectImportSymbolResolver = new InMemorySymbolResolver(builtInSymbols);

export interface SavedProjectBaseline {
  project: CircuitProject;
  viewBox: GridRect;
}

export type PersistenceState =
  "unbound" | "clean" | "dirty" | "saving" | "failed";

interface ReplaceGuardState {
  intent: string;
  perform: () => void | Promise<void>;
}

export interface ReplaceProjectOptions {
  source?: BrowserRecoverySource;
  keepWorkingCopy?: boolean;
  formalFileHint?: BrowserRecoveryFormalFileHint;
  persistenceState?: PersistenceState;
  fileBinding?: ProjectFileBinding | null;
  savedBaseline?: SavedProjectBaseline | null;
}

type RecoveryLifecycle = Pick<
  RecoveryCoordinator,
  | "workingCopyId"
  | "stage"
  | "cancelPending"
  | "flushNow"
  | "beginWorkingCopy"
  | "noteFormalFileHint"
  | "discover"
  | "readSessionProject"
  | "deleteSession"
> & {
  ready: boolean;
  sessions: RecoveryCoordinator["sessions"];
};

export interface UseProjectFileLifecycleOptions {
  restoreWorkingSession?: boolean;
  project: CircuitProject;
  projectSessionId: string;
  viewBox: GridRect;
  defaultViewBox: GridRect;
  recovery: RecoveryLifecycle;
  installProject(project: CircuitProject, viewBox: GridRect): SchematicDocument;
  setStatus(message: string): void;
  /** Commit feature-owned text buffers before taking a durable Project snapshot. */
  beforeSnapshot?(): Promise<CircuitProject | null>;
  hasPendingEdits?(): boolean;
  /** Feature-local drafts follow an explicit recovery fork, never an arbitrary import. */
  onRecoverBuffers?(
    from: string,
    to: string,
    projectId: string,
  ): string | undefined;
}

export function useProjectFileLifecycle({
  restoreWorkingSession = false,
  project,
  projectSessionId,
  viewBox,
  defaultViewBox,
  recovery,
  installProject,
  setStatus,
  beforeSnapshot,
  hasPendingEdits,
  onRecoverBuffers,
}: UseProjectFileLifecycleOptions) {
  // Read-only initializer: consuming the one-shot flag here would be a render
  // side effect, and a discarded render (StrictMode's double pass, a Suspense
  // retry) would eat the flag before the committed render sees it.
  const [restoreAfterRefresh] = useState(
    () =>
      typeof window !== "undefined" &&
      (restoreWorkingSession ||
        window.sessionStorage.getItem(REFRESH_RESTORE_STORAGE_KEY) === "true"),
  );
  const [startupRestoreReady, setStartupRestoreReady] =
    useState(!restoreAfterRefresh);
  useEffect(() => {
    if (restoreAfterRefresh) {
      window.sessionStorage.removeItem(REFRESH_RESTORE_STORAGE_KEY);
    }
  }, [restoreAfterRefresh]);
  const [startupProjectPath] = useState(readRecentProjectPath);
  const refreshRestoreAttemptedRef = useRef(false);
  const saveInFlightRef = useRef<Promise<ProjectFileSaveOutcome> | null>(null);
  const liveProjectRef = useRef(project);
  liveProjectRef.current = project;
  const liveSessionRef = useRef(projectSessionId);
  liveSessionRef.current = projectSessionId;
  const [persistenceState, setPersistenceState] =
    useState<PersistenceState>("unbound");
  const [fileBinding, setFileBinding] = useState<ProjectFileBinding | null>(
    null,
  );
  const [savedProjectBaseline, setSavedProjectBaseline] =
    useState<SavedProjectBaseline | null>(null);
  const persistenceChangeRef = useRef<{
    session: string;
    token: string;
  } | null>(null);
  const [replaceGuard, setReplaceGuard] = useState<ReplaceGuardState | null>(
    null,
  );
  const [replaceGuardSaving, setReplaceGuardSaving] = useState(false);
  const [recoveryDialogOpen, setRecoveryDialogOpen] = useState(false);
  const [
    dismissedStartupRecoveryRecordId,
    setDismissedStartupRecoveryRecordId,
  ] = useState<string | null>(null);

  function isDirtyWork(): boolean {
    return (
      hasPendingEdits?.() === true ||
      persistenceState === "dirty" ||
      persistenceState === "saving" ||
      persistenceState === "failed"
    );
  }

  /**
   * The one predicate every leave/replace/refresh guard shares: there is
   * meaningful drawing and the persistence state says it has not reached a
   * file. A saved Project is "clean", so a save silently clears every guard.
   */
  function hasUnsafeWork(): boolean {
    if (hasPendingEdits?.()) return true;
    if (!isDirtyWork()) return false;
    return projectHasMeaningfulContent(liveProjectRef.current);
  }

  function replaceActiveProject(
    nextProject: CircuitProject,
    nextViewBox: GridRect = defaultViewBox,
    options: ReplaceProjectOptions = {},
  ): SchematicDocument {
    recovery.cancelPending();
    if (options.keepWorkingCopy !== true) {
      recovery.beginWorkingCopy(options.source ?? "new");
    }
    if (options.formalFileHint !== undefined) {
      recovery.noteFormalFileHint(options.formalFileHint);
    }
    const prepared = materializeRazaviProjectBulkConnections(nextProject);
    const nextDocument = installProject(prepared.project, nextViewBox);
    const nextPersistenceState =
      options.persistenceState ??
      (options.source === "spice-import" || options.source === "recovered"
        ? "dirty"
        : "unbound");
    setPersistenceState(nextPersistenceState);
    const nextFileBinding = options.fileBinding ?? null;
    setFileBinding(nextFileBinding);
    setSavedProjectBaseline(options.savedBaseline ?? null);
    if (nextFileBinding) {
      rememberRecentProjectPath(nextFileBinding.path);
    } else {
      forgetRecentProjectPath();
    }
    recovery.stage(prepared.project, {
      unsavedAtSnapshot:
        nextPersistenceState !== "clean" && nextPersistenceState !== "unbound",
      fileBinding: nextFileBinding,
    });
    return nextDocument;
  }

  async function performProjectSave(
    candidate: CircuitProject,
    options: { saveAs?: boolean },
  ): Promise<ProjectFileSaveOutcome> {
    // Capture before the recovery/dialog awaits: save exactly the checked version.
    const savedCandidate = structuredClone(candidate);
    const savedCandidateToken = projectChangeToken(savedCandidate);
    setPersistenceState("saving");
    setStatus(`Saving ${savedCandidate.name}`);
    recovery.stage(savedCandidate, { unsavedAtSnapshot: true, fileBinding });
    await recovery.flushNow();
    const outcome = await writeProjectFile(
      savedCandidate,
      fileBinding,
      options,
    );
    if (liveSessionRef.current !== projectSessionId) return outcome;
    if (outcome.status === "saved") {
      const nextBinding = outcome.file;
      setFileBinding(nextBinding);
      rememberRecentProjectPath(nextBinding.path);
      setSavedProjectBaseline({
        project: savedCandidate,
        viewBox: { ...viewBox },
      });
      const liveProject = liveProjectRef.current;
      let stillMatchesSavedCandidate =
        projectChangeToken(liveProject) === savedCandidateToken;
      recovery.stage(liveProject, {
        unsavedAtSnapshot: !stillMatchesSavedCandidate,
        fileBinding: nextBinding,
      });
      await recovery.flushNow();
      if (liveSessionRef.current !== projectSessionId) return outcome;
      stillMatchesSavedCandidate =
        projectChangeToken(liveProjectRef.current) === savedCandidateToken;
      setPersistenceState(stillMatchesSavedCandidate ? "clean" : "dirty");
      setStatus(
        stillMatchesSavedCandidate
          ? `Saved ${nextBinding.path}`
          : `Saved ${nextBinding.path}; newer edits remain unsaved`,
      );
      return outcome;
    }
    if (outcome.status === "cancelled") {
      // Nothing was written, so the work is exactly as unsaved as before.
      setPersistenceState(
        fileBinding === null && savedProjectBaseline === null
          ? "unbound"
          : "dirty",
      );
      setStatus("Save cancelled");
      return outcome;
    }
    setPersistenceState("failed");
    setStatus(`Save failed; work remains in the editor (${outcome.message})`);
    return outcome;
  }

  /**
   * Save the Project. With an open file and no `saveAs`, this overwrites it
   * silently; a first save and Save As ask where to write.
   */
  function saveProject(
    options: { saveAs?: boolean } = {},
    candidate?: CircuitProject,
  ): Promise<ProjectFileSaveOutcome> {
    const inFlight = saveInFlightRef.current;
    if (inFlight) return inFlight;
    const operation = (async (): Promise<ProjectFileSaveOutcome> => {
      const snapshot =
        candidate ??
        (beforeSnapshot ? await beforeSnapshot() : liveProjectRef.current);
      if (!snapshot)
        return {
          status: "failed",
          message: "Source edits need attention; no work was discarded",
        };
      return performProjectSave(snapshot, options);
    })().catch((error: unknown): ProjectFileSaveOutcome => {
      const message = error instanceof Error ? error.message : "Save failed";
      if (liveSessionRef.current === projectSessionId) {
        setPersistenceState("failed");
        setStatus(`Save failed; work remains in the editor (${message})`);
      }
      return { status: "failed", message };
    });
    saveInFlightRef.current = operation;
    const clear = () => {
      if (saveInFlightRef.current === operation) saveInFlightRef.current = null;
    };
    void operation.then(clear, clear);
    return operation;
  }

  /**
   * Write a copy somewhere else without rebinding the open file — the escape
   * hatch offered when browser recovery itself is failing.
   */
  async function saveProjectBackup(): Promise<void> {
    const snapshot = beforeSnapshot
      ? await beforeSnapshot()
      : liveProjectRef.current;
    if (!snapshot) return;
    let projectText: string;
    try {
      projectText = serializeProject(snapshot);
    } catch (error) {
      setStatus(
        `Backup failed: ${error instanceof Error ? error.message : "serialization failed"}`,
      );
      return;
    }
    const outcome = await saveTextAsFile(
      projectText,
      `${projectFileBaseName(snapshot.name)}-backup`,
    );
    setStatus(
      outcome.status === "saved"
        ? `Backup written to ${outcome.file.path}`
        : outcome.status === "cancelled"
          ? "Backup cancelled"
          : `Backup failed: ${outcome.message}`,
    );
  }

  async function guardDirtyReplacement(
    intent: string,
    perform: () => void | Promise<void>,
  ): Promise<void> {
    const snapshot = beforeSnapshot
      ? await beforeSnapshot()
      : liveProjectRef.current;
    if (!snapshot) return;
    if (!hasUnsafeWork()) {
      await perform();
      return;
    }
    recovery.stage(snapshot, { unsavedAtSnapshot: true, fileBinding });
    await recovery.flushNow();
    setReplaceGuard({
      intent,
      perform,
    });
  }

  function cancelReplaceGuard(): void {
    if (replaceGuardSaving) return;
    setReplaceGuard(null);
  }

  function confirmReplaceGuard(): void {
    if (replaceGuardSaving) return;
    const guard = replaceGuard;
    if (!guard) return;
    setReplaceGuardSaving(true);
    void (async () => {
      recovery.cancelPending();
      await recovery.deleteSession(recovery.workingCopyId);
      setReplaceGuard(null);
      await guard.perform();
      setReplaceGuardSaving(false);
    })();
  }

  function saveAndContinueReplaceGuard(): void {
    const guard = replaceGuard;
    if (!guard || replaceGuardSaving) return;
    setReplaceGuardSaving(true);
    void (async () => {
      const outcome = await saveProject();
      if (outcome.status === "saved") {
        setReplaceGuard(null);
        await guard.perform();
      }
      setReplaceGuardSaving(false);
    })();
  }

  function createNewProject(): void {
    void guardDirtyReplacement("Create a new Project", () => {
      const next = createEmptyProject(
        createId("project"),
        "New Circuit",
        createId("document"),
      );
      replaceActiveProject(next, defaultViewBox, { source: "new" });
      setStatus("Created a new Project");
    });
  }

  function revertToSavedProjectBaseline(): void {
    const baseline = savedProjectBaseline;
    if (!baseline || !isDirtyWork()) return;
    void guardDirtyReplacement("Revert to the last saved Project", () => {
      const restored = replaceActiveProject(
        baseline.project,
        baseline.viewBox,
        {
          source: "opened-file",
          persistenceState: "clean",
          fileBinding,
          savedBaseline: baseline,
        },
      );
      setStatus(`Reverted to saved Project revision ${restored.revision}`);
    });
  }

  function openRecoveryDialog(): void {
    void (async () => {
      await recovery.discover();
      setRecoveryDialogOpen(true);
    })();
  }

  function restoreRecoverySession(
    workingCopyId: string,
    generation: BrowserRecoveryGeneration,
  ): void {
    void (async () => {
      const read = await recovery.readSessionProject(workingCopyId, generation);
      if (read.status !== "valid") {
        setStatus(
          read.status === "unsupported-schema"
            ? "Recovery uses a newer Project schema and cannot be restored; download it instead"
            : `Recovery is not readable: ${
                read.status === "missing" ? "no stored record" : read.message
              }`,
        );
        return;
      }
      const unsupported = findUnsupportedProjectSymbolIds(
        read.project,
        builtInSymbols,
      );
      if (unsupported.length > 0) {
        setStatus(
          `Recovery uses unsupported non-Razavi symbols: ${unsupported.join(", ")}`,
        );
        return;
      }
      await guardDirtyReplacement(
        `Restore recovered Project ${read.project.name}`,
        async () => {
          const nextWorkingCopy = recovery.beginWorkingCopy("recovered");
          const bufferNotice = onRecoverBuffers?.(
            workingCopyId,
            nextWorkingCopy,
            read.project.id,
          );
          const recoveredDocument = replaceActiveProject(
            read.project,
            defaultViewBox,
            {
              source: "recovered",
              keepWorkingCopy: true,
              persistenceState: "dirty",
              fileBinding: read.record.fileBinding ?? null,
            },
          );
          setRecoveryDialogOpen(false);
          await recovery.discover();
          setStatus(
            `Restored recovery revision ${recoveredDocument.revision}${bufferNotice ? `. ${bufferNotice}` : ""}`,
          );
        },
      );
    })();
  }

  function saveRecoveryBackup(
    workingCopyId: string,
    generation: BrowserRecoveryGeneration,
  ): void {
    void (async () => {
      const read = await recovery.readSessionProject(workingCopyId, generation);
      const summary = recovery.sessions.find(
        (session) => session.workingCopyId === workingCopyId,
      );
      if (read.status === "valid" || read.status === "unsupported-schema") {
        const text =
          read.status === "valid" ? read.record.projectText : read.projectText;
        const name =
          summary?.projectName ??
          (read.status === "valid" ? read.record.projectName : "recovery");
        const outcome = await saveTextAsFile(
          text,
          `${projectFileBaseName(name)}-backup`,
        );
        setStatus(
          outcome.status === "saved"
            ? `Recovery copy written to ${outcome.file.path}`
            : outcome.status === "cancelled"
              ? "Recovery copy not written"
              : `Recovery copy failed: ${outcome.message}`,
        );
        return;
      }
      setStatus(
        `Backup not available: ${
          read.status === "missing" ? "no stored record" : read.message
        }`,
      );
    })();
  }

  function deleteRecoverySessionFromDialog(workingCopyId: string): void {
    void (async () => {
      const removed = await recovery.deleteSession(workingCopyId);
      await recovery.discover();
      setStatus(
        removed ? "Deleted recovery copy" : "Could not delete recovery copy",
      );
    })();
  }

  function refreshApp(): void {
    void (async () => {
      recovery.stage(project, {
        unsavedAtSnapshot: isDirtyWork(),
        fileBinding,
      });
      await recovery.flushNow();
      window.sessionStorage.setItem(REFRESH_RESTORE_STORAGE_KEY, "true");
      window.location.reload();
    })();
  }

  /**
   * Load a Project file as a copy: validated, upgraded if need be, and left
   * bound to nothing, so the first Save asks where it should go.
   *
   * The argument is only ever read for its name and its text, which is what a
   * browser `File` and a file the shell read both supply.
   */
  async function openProjectFile(
    file: { name: string; text(): Promise<string> } | null,
    options: { allowExactCurrentReplacement?: boolean } = {},
  ): Promise<void> {
    if (!file) return;
    const staged = await stageProjectFile(file, (candidate) =>
      findUnsupportedProjectSymbolIds(candidate, builtInSymbols),
    );
    if (staged.status === "rejected") {
      setStatus(
        `Project not opened — ${formatProjectOpenDiagnostics(staged.diagnostics)}`,
      );
      return;
    }
    const normalized = normalizeImportedProjectConductors(
      staged.project,
      projectImportSymbolResolver,
    );
    const openedProject = normalized.project;
    const normalizedDocumentCount = normalized.changedDocumentIds.length;
    const performOpen = () => {
      replaceActiveProject(openedProject, defaultViewBox, {
        source: "opened-file",
        formalFileHint: { name: staged.fileName },
        persistenceState:
          staged.migrated || normalizedDocumentCount > 0 ? "dirty" : "unbound",
      });
      setStatus(
        staged.migrated
          ? `Imported and upgraded ${staged.fileName} from schema ${staged.sourceSchemaVersion} to schema ${openedProject.schemaVersion}${normalizedDocumentCount > 0 ? ` and normalized connectivity and Wire topology in ${normalizedDocumentCount} Cell${normalizedDocumentCount === 1 ? "" : "s"}` : ""} — save to keep the upgrade`
          : normalizedDocumentCount > 0
            ? `Opened ${staged.fileName} and normalized connectivity and Wire topology in ${normalizedDocumentCount} Cell${normalizedDocumentCount === 1 ? "" : "s"} — save to keep the repair`
            : `Opened ${staged.fileName} at revision ${staged.topDocumentRevision}`,
      );
    };
    if (
      options.allowExactCurrentReplacement &&
      serializeProject(openedProject) === serializeProject(project)
    ) {
      performOpen();
      return;
    }
    await guardDirtyReplacement(`Open ${file.name}`, performOpen);
  }

  /** Stage a file the shell just read and install it once the guard allows. */
  async function installOpenedFile(
    file: OpenedProjectFile,
    options: { allowExactCurrentReplacement?: boolean } = {},
  ): Promise<void> {
    const staged = await stageProjectFile(
      {
        name: `${file.name}.icproj.json`,
        text: () => Promise.resolve(file.text),
      },
      (candidate) => findUnsupportedProjectSymbolIds(candidate, builtInSymbols),
    );
    if (staged.status === "rejected") {
      setStatus(
        `Project not opened — ${formatProjectOpenDiagnostics(staged.diagnostics)}`,
      );
      return;
    }
    const normalized = normalizeImportedProjectConductors(
      staged.project,
      projectImportSymbolResolver,
    );
    const openedProject = normalized.project;
    const normalizedDocumentCount = normalized.changedDocumentIds.length;
    // An upgraded or repaired Project differs from the bytes on disk, so it
    // is dirty until saved back; otherwise the file is the baseline.
    const changed = staged.migrated || normalizedDocumentCount > 0;
    const binding = { path: file.path, name: file.name };
    const install = () => {
      replaceActiveProject(openedProject, defaultViewBox, {
        source: "opened-file",
        formalFileHint: { name: staged.fileName },
        persistenceState: changed ? "dirty" : "clean",
        fileBinding: binding,
        savedBaseline: changed
          ? null
          : {
              project: structuredClone(openedProject),
              viewBox: { ...defaultViewBox },
            },
      });
      setStatus(
        staged.migrated
          ? `Opened and upgraded ${file.path} from schema ${staged.sourceSchemaVersion} to schema ${openedProject.schemaVersion}${normalizedDocumentCount > 0 ? ` and normalized connectivity and Wire topology in ${normalizedDocumentCount} Cell${normalizedDocumentCount === 1 ? "" : "s"}` : ""} — save to keep the upgrade`
          : normalizedDocumentCount > 0
            ? `Opened ${file.path} and normalized connectivity and Wire topology in ${normalizedDocumentCount} Cell${normalizedDocumentCount === 1 ? "" : "s"} — save to keep the repair`
            : `Opened ${file.path}`,
      );
    };
    if (
      options.allowExactCurrentReplacement &&
      serializeProject(openedProject) === serializeProject(project)
    ) {
      install();
      return;
    }
    await guardDirtyReplacement(`Open ${file.name}`, install);
  }

  /** File / Open Project…: the shell shows its dialog and reads the pick. */
  async function openProjectFromDisk(): Promise<void> {
    const outcome = await openProjectFileFromDisk();
    if (outcome.status === "cancelled") return;
    if (outcome.status === "failed") {
      setStatus(`Could not open the Project file (${outcome.message})`);
      return;
    }
    await installOpenedFile(outcome.file);
  }

  /**
   * File / Open a Copy…: the same dialog, deliberately without the binding.
   *
   * Opening a copy is how a portable `.icproj.json` is inspected or brought
   * forward without claiming the file it came from — a later Save asks where
   * to put it rather than writing over the original.
   */
  async function openProjectCopyFromDisk(): Promise<void> {
    const outcome = await openProjectFileFromDisk();
    if (outcome.status === "cancelled") return;
    if (outcome.status === "failed") {
      setStatus(`Could not open the Project file (${outcome.message})`);
      return;
    }
    await openProjectFile({
      name: fileNameFromPath(outcome.file.path),
      text: () => Promise.resolve(outcome.file.text),
    });
  }

  /** Reopen a path the editor already knows (the last file, a Cell import). */
  async function reopenProjectPath(path: string): Promise<void> {
    const outcome = await readProjectFileAt(path);
    if (outcome.status !== "opened") {
      if (outcome.status === "failed") forgetRecentProjectPath();
      setStatus(
        outcome.status === "failed"
          ? `Could not reopen ${path} (${outcome.message})`
          : "Reopen cancelled",
      );
      return;
    }
    await installOpenedFile(outcome.file, {
      allowExactCurrentReplacement: true,
    });
  }

  useEffect(() => {
    if (!restoreAfterRefresh || !recovery.ready) return;
    if (refreshRestoreAttemptedRef.current) return;
    refreshRestoreAttemptedRef.current = true;
    void (async () => {
      const read = await recovery.readSessionProject(
        recovery.workingCopyId,
        "latest",
      );
      if (read.status !== "valid") {
        setStatus("No restorable recovery was found for this refresh");
        return;
      }
      const unsupported = findUnsupportedProjectSymbolIds(
        read.project,
        builtInSymbols,
      );
      if (unsupported.length > 0) {
        setStatus(
          `Recovery uses unsupported non-Razavi symbols: ${unsupported.join(", ")}`,
        );
        return;
      }
      const restoredDocument = replaceActiveProject(
        read.project,
        defaultViewBox,
        {
          source: "recovered",
          keepWorkingCopy: true,
          persistenceState:
            read.record.unsavedAtSnapshot === false && read.record.fileBinding
              ? "clean"
              : read.record.unsavedAtSnapshot === false
                ? "unbound"
                : "dirty",
          fileBinding: read.record.fileBinding ?? null,
          savedBaseline:
            read.record.unsavedAtSnapshot === false && read.record.fileBinding
              ? {
                  project: structuredClone(read.project),
                  viewBox: { ...defaultViewBox },
                }
              : null,
        },
      );
      setStatus(`Restored recovery revision ${restoredDocument.revision}`);
      setStartupRestoreReady(true);
    })();
    // The recovery coordinator methods are stable for one mounted editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restoreAfterRefresh, recovery.ready, recovery.workingCopyId]);

  const currentProjectChangeToken = projectChangeToken(project);
  useEffect(() => {
    const baseline = persistenceChangeRef.current;
    if (baseline === null || baseline.session !== projectSessionId) {
      persistenceChangeRef.current = {
        session: projectSessionId,
        token: currentProjectChangeToken,
      };
      return;
    }
    if (baseline.token !== currentProjectChangeToken) {
      persistenceChangeRef.current = {
        session: projectSessionId,
        token: currentProjectChangeToken,
      };
      const matchesSavedProject =
        savedProjectBaseline !== null &&
        projectChangeToken(savedProjectBaseline.project) ===
          currentProjectChangeToken;
      setPersistenceState(matchesSavedProject ? "clean" : "dirty");
    }
  }, [currentProjectChangeToken, projectSessionId, savedProjectBaseline]);

  const startupRecovery =
    !restoreAfterRefresh && !isDirtyWork()
      ? (recovery.sessions.find(
          (session) =>
            session.workingCopyId === recovery.workingCopyId &&
            session.latest?.review === "valid" &&
            session.latest.unsavedAtSnapshot === true &&
            session.latest.recordId !== dismissedStartupRecoveryRecordId &&
            // Tiny sketches are not worth a banner; the manual Recover menu
            // still lists every snapshot.
            session.latest.meaningfulContent,
        ) ?? null)
      : null;
  const canRestoreStartupProject =
    recovery.ready &&
    !restoreAfterRefresh &&
    !isDirtyWork() &&
    startupRecovery === null;

  return {
    startupRestoreReady,
    persistenceState,
    fileBinding,
    savedProjectBaseline,
    replaceGuard,
    replaceGuardSaving,
    recoveryDialogOpen,
    startupRecovery,
    startupProjectPath,
    canRestoreStartupProject,
    restoreAfterRefresh,
    setRecoveryDialogOpen,
    isDirtyWork,
    hasUnsafeWork,
    replaceActiveProject,
    saveProject,
    isSaveInFlight: () => saveInFlightRef.current !== null,
    saveBusy: persistenceState === "saving",
    saveProjectBackup,
    guardDirtyReplacement,
    cancelReplaceGuard,
    confirmReplaceGuard,
    saveAndContinueReplaceGuard,
    dismissStartupRecovery: () =>
      setDismissedStartupRecoveryRecordId(
        startupRecovery?.latest?.recordId ?? null,
      ),
    createNewProject,
    revertToSavedProjectBaseline,
    openRecoveryDialog,
    restoreRecoverySession,
    saveRecoveryBackup,
    deleteRecoverySessionFromDialog,
    refreshApp,
    openProjectFile,
    openProjectCopyFromDisk,
    openProjectFromDisk,
    reopenProjectPath,
  };
}
