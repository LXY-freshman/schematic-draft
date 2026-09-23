import { execFile } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  protocol,
  session,
  shell,
} from "electron";

import {
  APP_ORIGIN,
  APP_SCHEME,
  createAppProtocolHandler,
} from "./app-protocol.js";
import {
  closeAnswerFromButton,
  closePrompt,
  CLOSE_BUTTONS,
  CLOSE_CANCEL_BUTTON,
  CLOSE_DEFAULT_BUTTON,
  decideClose,
  READ_UNSAVED_WORK_SCRIPT,
  REQUEST_SAVE_SCRIPT,
  saveAttempt,
  saveFailureNotice,
  unsavedWorkState,
  type CloseGuardPorts,
  type SaveAttempt,
  type UnsavedWorkState,
} from "./close-guard.js";
import {
  associationCommands,
  associationTargets,
  claimsExtension,
  EXTENSION_KEY,
  LEGACY_EXTENSION_KEY,
  OPEN_COMMAND_KEY,
  PROG_ID_KEY,
  releaseExtensionCommands,
  removalCommands,
  TARGET_VALUE_NAME,
} from "./file-association.js";
import {
  APP_DATA_FOLDER,
  canWriteDirectory,
  PROJECTS_FOLDER,
  resolveInstallRoot,
} from "./install-paths.js";
import {
  PROJECT_OPEN_REQUEST_EVENT,
  projectPathFromArgv,
} from "./open-request.js";
import {
  PROJECT_FILE_EXTENSION,
  PROJECT_FILE_EXTENSIONS,
  SOURCE_FILE_EXTENSIONS,
  type ProjectFileDialogs,
} from "./project-files.js";
import {
  type AssociationState,
  type ShellCommandPorts,
} from "./shell-commands.js";
import { steppedZoomLevel, windowCommand } from "./window-shortcuts.js";

const PRODUCT_NAME = "Schematic Draft";
const APP_USER_MODEL_ID = "com.schematicdraft.desktop";
const EDITOR_ROUTE = `${APP_ORIGIN}/editor`;

/**
 * The folder this copy of the program owns, or null when it cannot write there.
 * Everything the program writes lives under it, so moving the folder moves the
 * installation. See `install-paths.ts`.
 */
let installRoot = resolveInstallRoot({
  executablePath: app.getPath("exe"),
  packaged: app.isPackaged,
  // A development run must not litter the repository: `output/` is ignored.
  developmentDirectory: resolve(
    import.meta.dirname,
    "../../../output/desktop-data",
  ),
  canWrite: canWriteDirectory,
});

if (installRoot !== null) {
  try {
    const appData = join(installRoot, APP_DATA_FOLDER);
    // `setPath` requires an existing directory, and this has to happen before
    // the single-instance lock below, which lives in `userData`.
    mkdirSync(appData, { recursive: true });
    app.setPath("userData", appData);
  } catch {
    // The folder passed the write probe and then refused anyway; the per-user
    // locations are still there.
    installRoot = null;
  }
}

/**
 * Where a first save is offered, and what `Open Projects Folder` opens.
 *
 * Inside the program's own folder, so a circuit never lands somewhere a person
 * has to hunt for and the whole installation stays movable. Nothing forces a
 * circuit to stay here — the dialogs go wherever they point.
 */
function projectsDirectory(): string {
  return installRoot === null
    ? join(app.getPath("documents"), PRODUCT_NAME)
    : join(installRoot, PROJECTS_FOLDER);
}

const PROJECT_FILTERS = [
  { name: "Schematic Draft Project", extensions: PROJECT_FILE_EXTENSIONS },
];

const SOURCE_FILTERS = [
  { name: "SPICE / Spectre source", extensions: SOURCE_FILE_EXTENSIONS },
];

/**
 * The native Open/Save dialogs behind the editor's file bridge. They belong
 * to the window, so the editor cannot act while one is up.
 */
function projectFileDialogs(
  window: () => BrowserWindow | null,
): ProjectFileDialogs {
  const parent = () => window() ?? BrowserWindow.getAllWindows()[0] ?? null;
  return {
    async promptOpen() {
      const owner = parent();
      const options = {
        title: "Open Project",
        defaultPath: projectsDirectory(),
        filters: PROJECT_FILTERS,
        properties: ["openFile" as const],
      };
      const result = owner
        ? await dialog.showOpenDialog(owner, options)
        : await dialog.showOpenDialog(options);
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
    async promptOpenMany() {
      const owner = parent();
      const options = {
        title: "Import SPICE / SCS",
        defaultPath: projectsDirectory(),
        filters: SOURCE_FILTERS,
        properties: ["openFile" as const, "multiSelections" as const],
      };
      const result = owner
        ? await dialog.showOpenDialog(owner, options)
        : await dialog.showOpenDialog(options);
      return result.canceled ? null : result.filePaths;
    },
    async promptSave({ name, currentPath }) {
      const owner = parent();
      const options = {
        title: "Save Project As",
        defaultPath:
          currentPath ??
          join(
            projectsDirectory(),
            `${safeFileName(name)}${PROJECT_FILE_EXTENSION}`,
          ),
        filters: PROJECT_FILTERS,
      };
      const result = owner
        ? await dialog.showSaveDialog(owner, options)
        : await dialog.showSaveDialog(options);
      return result.canceled ? null : (result.filePath ?? null);
    },
  };
}

/** Project names are free text; a file name is not. */
function safeFileName(name: string): string {
  const cleaned = name.replace(/[\u0000-\u001f<>:"/\\|?*]/gu, " ").trim();
  return cleaned.length > 0 ? cleaned.slice(0, 120) : "Circuit";
}

function editorRoot(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "editor")
    : resolve(import.meta.dirname, "../../editor/dist");
}

// The scheme must be registered before the app is ready, and as a standard,
// secure scheme so the editor gets a real origin: localStorage, IndexedDB,
// relative fetches and history navigation all behave as they do on https.
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

/**
 * The renderer may talk to exactly one origin: its own. Everything Chromium
 * could otherwise reach (http, https, ws, file, ftp) is cancelled before a
 * connection is attempted, so a circuit cannot leave this computer even if a
 * future editor build tried to send it.
 */
function lockDownNetwork(): void {
  const current = session.defaultSession;
  current.webRequest.onBeforeRequest(
    { urls: ["<all_urls>"] },
    (details, callback) => {
      // Allow the app's own scheme through unconditionally: it is served from
      // bundled files by this process and opens no socket. Everything else is
      // refused, whatever asked for it.
      callback({ cancel: !details.url.startsWith(`${APP_ORIGIN}/`) });
    },
  );
  current.setPermissionRequestHandler((_, permission, callback) =>
    callback(
      permission === "clipboard-read" ||
        permission === "clipboard-sanitized-write",
    ),
  );
  current.setPermissionCheckHandler(
    (_, permission) =>
      permission === "clipboard-read" ||
      permission === "clipboard-sanitized-write",
  );
  // Windows spellcheck fetches dictionaries from the network; the editor's
  // text fields are net names and values, not prose.
  current.setSpellCheckerEnabled(false);
}

/** Exports are downloads to the editor; here they become a Save As dialog. */
function routeDownloadsToSaveDialog(): void {
  session.defaultSession.on("will-download", (_, item) => {
    item.setSaveDialogOptions({
      title: `Save ${item.getFilename()}`,
      // Beside the Projects: accepting the default keeps an exported drawing in
      // the program's folder with the circuit it came from.
      defaultPath: join(projectsDirectory(), item.getFilename()),
    });
  });
}

interface WindowState {
  width: number;
  height: number;
  x?: number;
  y?: number;
  maximized?: boolean;
}

const DEFAULT_WINDOW: WindowState = { width: 1440, height: 900 };

function windowStateFile(): string {
  return join(app.getPath("userData"), "window-state.json");
}

async function loadWindowState(): Promise<WindowState> {
  try {
    const raw = JSON.parse(
      await readFile(windowStateFile(), "utf8"),
    ) as Partial<WindowState>;
    if (
      typeof raw.width === "number" &&
      typeof raw.height === "number" &&
      raw.width >= 640 &&
      raw.height >= 480
    ) {
      return {
        width: raw.width,
        height: raw.height,
        ...(typeof raw.x === "number" ? { x: raw.x } : {}),
        ...(typeof raw.y === "number" ? { y: raw.y } : {}),
        ...(raw.maximized === true ? { maximized: true } : {}),
      };
    }
  } catch {
    // First launch, or a state file this build no longer understands.
  }
  return DEFAULT_WINDOW;
}

async function saveWindowState(window: BrowserWindow): Promise<void> {
  const maximized = window.isMaximized();
  const bounds = maximized ? window.getNormalBounds() : window.getBounds();
  const state: WindowState = { ...bounds, maximized };
  try {
    await mkdir(app.getPath("userData"), { recursive: true });
    await writeFile(windowStateFile(), JSON.stringify(state), "utf8");
  } catch {
    // Losing the remembered size is not worth interrupting a quit.
  }
}

/**
 * Whether Explorer opens `${PROJECT_FILE_EXTENSION}` files with this copy right
 * now, and whether it was ever told not to.
 *
 * The association is the one thing this application writes outside its own
 * folder, so it is kept honest: per-user keys only, the editor's About section
 * shows and flips the real state, and turning it off is remembered instead of
 * being quietly restored at the next launch.
 */
let associationActive = false;
let associationWanted = true;

function associationChoiceFile(): string {
  return join(app.getPath("userData"), "file-association.json");
}

async function loadAssociationChoice(): Promise<void> {
  try {
    const raw = JSON.parse(
      await readFile(associationChoiceFile(), "utf8"),
    ) as Partial<{ enabled: boolean }>;
    associationWanted = raw.enabled !== false;
  } catch {
    // Never asked. A Project that cannot be double-clicked is the thing people
    // report, so the default is to claim the extension.
  }
}

async function rememberAssociationChoice(enabled: boolean): Promise<void> {
  associationWanted = enabled;
  try {
    await mkdir(app.getPath("userData"), { recursive: true });
    await writeFile(
      associationChoiceFile(),
      `${JSON.stringify({ enabled })}\n`,
      "utf8",
    );
  } catch {
    // The choice still holds for this run; it just will not be remembered.
  }
}

/** One `reg.exe` call. Failure is an answer, not an exception. */
function reg(
  args: readonly string[],
): Promise<{ ok: boolean; output: string }> {
  return new Promise((settle) => {
    execFile(
      "reg.exe",
      [...args],
      { windowsHide: true },
      (error, stdout: string) => settle({ ok: error === null, output: stdout }),
    );
  });
}

/**
 * Whether Explorer opens a Project with this copy right now: the extension has
 * to still name this application's document type, and that document type has to
 * still name this executable rather than a copy in a folder that moved.
 */
async function queryAssociation(): Promise<boolean> {
  if (process.platform !== "win32") return false;
  if (!(await ownsExtension(EXTENSION_KEY))) return false;
  const target = await reg(["query", PROG_ID_KEY, "/v", TARGET_VALUE_NAME]);
  return target.ok && associationTargets(target.output, app.getPath("exe"));
}

/** Whether an extension key is still this application's own claim. */
async function ownsExtension(key: string): Promise<boolean> {
  const owner = await reg(["query", key, "/ve"]);
  return owner.ok && claimsExtension(owner.output);
}

async function applyAssociation(): Promise<boolean> {
  for (const args of associationCommands(
    app.getPath("exe"),
    `${PRODUCT_NAME} Project`,
  )) {
    if (!(await reg(args)).ok) return false;
  }
  // An earlier build claimed the old extension. Now that Projects are saved
  // under the current one, holding the old name would squat an extension this
  // application no longer writes; files that already carry it still open from
  // inside the application.
  for (const args of releaseExtensionCommands(
    LEGACY_EXTENSION_KEY,
    await ownsExtension(LEGACY_EXTENSION_KEY),
  )) {
    await reg(args);
  }
  return true;
}

async function withdrawAssociation(): Promise<boolean> {
  for (const args of removalCommands({
    extension: await ownsExtension(EXTENSION_KEY),
    legacyExtension: await ownsExtension(LEGACY_EXTENSION_KEY),
  })) {
    if (!(await reg(args)).ok) return false;
  }
  return true;
}

/**
 * Keep the association pointing at this copy, including after the folder has
 * been moved. A refusal is remembered.
 */
async function ensureFileAssociation(): Promise<void> {
  if (process.platform !== "win32" || !app.isPackaged) return;
  associationActive = await queryAssociation();
  if (associationActive || !associationWanted) return;
  associationActive = await applyAssociation();
}

/**
 * Flip the association at the editor's word, and say what really happened.
 *
 * The confirmation stays a native dialog: it reports a change to this
 * account's registry, which is the one thing this application writes outside
 * its own folder, and that belongs to the shell rather than to a panel inside
 * the page.
 */
async function setFileAssociation(
  window: BrowserWindow,
  wanted: boolean,
): Promise<AssociationState> {
  const done = wanted ? await applyAssociation() : await withdrawAssociation();
  await rememberAssociationChoice(wanted);
  associationActive = done ? wanted : await queryAssociation();
  await dialog.showMessageBox(window, {
    type: done ? "info" : "warning",
    title: PRODUCT_NAME,
    message: done
      ? wanted
        ? `${PROJECT_FILE_EXTENSION} files now open with this copy.`
        : `${PROJECT_FILE_EXTENSION} files are no longer associated with this copy.`
      : `Windows refused the change to this account's registry.`,
    detail: done
      ? wanted
        ? "Explorer may take a moment to show the new icon. Only this account\nis affected, and the entry names this folder, so moving the folder\nand starting it again moves the association with it."
        : "The per-user registry entries this application added are gone.\nOpening a Project from inside the application still works."
      : `Nothing was changed. The keys are under\n${EXTENSION_KEY} and\n${OPEN_COMMAND_KEY}.`,
  });
  return associationState();
}

/**
 * Whether the association is a question worth asking here.
 *
 * A development run writes nothing to the registry, and a non-Windows run has
 * no per-user association to write, so the editor is told the control does not
 * apply rather than being told it is switched off.
 */
function associationState(): AssociationState {
  if (process.platform !== "win32" || !app.isPackaged) return "unavailable";
  return associationActive ? "on" : "off";
}

/** What the editor's own menus call into the shell for. */
function shellCommandPorts(
  window: () => BrowserWindow | null,
): ShellCommandPorts {
  return {
    projectsDirectory,
    settingsDirectory: () => app.getPath("userData"),
    selfContained: () => installRoot !== null,
    associationState: async () => {
      if (process.platform !== "win32" || !app.isPackaged) return "unavailable";
      // Asked rather than remembered: Explorer's claim can be taken by another
      // program, or by another copy of this one, between launches.
      associationActive = await queryAssociation();
      return associationState();
    },
    setAssociation: async (enabled) => {
      const owner = window() ?? BrowserWindow.getAllWindows()[0] ?? null;
      if (owner === null || process.platform !== "win32" || !app.isPackaged) {
        return associationState();
      }
      return setFileAssociation(owner, enabled);
    },
    openFolder: (path) => shell.openPath(path),
  };
}

/**
 * The editor's side of the close guard, over the one channel this shell has:
 * script evaluated in the page, the same way a double-click is announced.
 * `executeJavaScript` settles the page's own promise, so a Save that opens a
 * dialog is simply awaited here.
 */
function closeGuardPorts(window: BrowserWindow): CloseGuardPorts {
  const ask = async (state: UnsavedWorkState) => {
    const { response } = await dialog.showMessageBox(window, {
      type: "question",
      title: PRODUCT_NAME,
      buttons: [...CLOSE_BUTTONS],
      defaultId: CLOSE_DEFAULT_BUTTON,
      cancelId: CLOSE_CANCEL_BUTTON,
      noLink: true,
      ...closePrompt(state),
    });
    return closeAnswerFromButton(response);
  };
  return {
    readState: async () =>
      unsavedWorkState(
        await window.webContents.executeJavaScript(
          READ_UNSAVED_WORK_SCRIPT,
          true,
        ),
      ),
    ask,
    save: async (): Promise<SaveAttempt> =>
      saveAttempt(
        await window.webContents.executeJavaScript(REQUEST_SAVE_SCRIPT, true),
      ),
    reportFailure: async (message) => {
      await dialog.showMessageBox(window, {
        type: "warning",
        title: PRODUCT_NAME,
        ...saveFailureNotice(message),
      });
    },
  };
}

/**
 * Hold the close until the guard has an answer.
 *
 * `destroy()` is what finally shuts the window: it bypasses the renderer's own
 * `beforeunload`, which would otherwise cancel this close silently. Nothing
 * else runs on `close` after that, so the remembered size is written here.
 */
function guardWindowClose(window: BrowserWindow): void {
  let approved = false;
  window.on("close", (event) => {
    if (approved) return;
    event.preventDefault();
    void (async () => {
      if ((await decideClose(closeGuardPorts(window))) !== "close") return;
      approved = true;
      if (window.isDestroyed()) return;
      await saveWindowState(window);
      window.destroy();
    })();
  });
}

/**
 * The window keys that used to be a `View` menu.
 *
 * Every command in this application is in the editor's own menus, so there is
 * no menu bar left to hang accelerators on. These five are not editor commands
 * — they act on the window and its chrome — so they are matched on the way in
 * and never reach the page.
 */
function registerWindowShortcuts(window: BrowserWindow): void {
  window.webContents.on("before-input-event", (event, input) => {
    const command = windowCommand(input);
    if (command === null) return;
    event.preventDefault();
    if (command === "fullscreen") {
      window.setFullScreen(!window.isFullScreen());
      return;
    }
    if (command === "devtools") {
      window.webContents.toggleDevTools();
      return;
    }
    const level = steppedZoomLevel(window.webContents.getZoomLevel(), command);
    if (level !== null) window.webContents.setZoomLevel(level);
  });
}

async function createWindow(): Promise<BrowserWindow> {
  const state = await loadWindowState();
  const window = new BrowserWindow({
    title: PRODUCT_NAME,
    width: state.width,
    height: state.height,
    ...(state.x !== undefined && state.y !== undefined
      ? { x: state.x, y: state.y }
      : {}),
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: "#1e3d36",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      devTools: true,
    },
  });
  if (state.maximized) window.maximize();
  window.once("ready-to-show", () => window.show());
  registerWindowShortcuts(window);

  // Links to documentation open in the person's browser; the editor window
  // itself never navigates away from its own origin.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//u.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`${APP_ORIGIN}/`)) event.preventDefault();
  });
  guardWindowClose(window);
  // The caption is deliberately left to the editor, which sets `document.title`
  // to the file being edited. `title` above is only what the window is called
  // before the editor has loaded.

  await window.loadURL(EDITOR_ROUTE);
  return window;
}

/**
 * The Project a double-click (or a command line) asked for, until the editor
 * collects it over the file bridge.
 */
let requestedOpenPath: string | null = null;

/**
 * Record the file an invocation named, if it named one.
 *
 * Both the first launch and every later double-click arrive as an argument
 * list; the answer is the same either way, so both go through here.
 */
function noteRequestedOpen(
  argv: readonly string[],
  workingDirectory: string,
): boolean {
  const path = projectPathFromArgv(argv, {
    packaged: app.isPackaged,
    workingDirectory,
    isFile: (candidate) =>
      statSync(candidate, { throwIfNoEntry: false })?.isFile() === true,
  });
  if (path === null) return false;
  requestedOpenPath = path;
  return true;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setAppUserModelId(APP_USER_MODEL_ID);
  noteRequestedOpen(process.argv, process.cwd());

  app.on("second-instance", (_event, argv, workingDirectory) => {
    const [window] = BrowserWindow.getAllWindows();
    if (!window) return;
    if (noteRequestedOpen(argv, workingDirectory)) {
      // There is no preload bridge, so the renderer is only told that something
      // is waiting; it collects the path over `/api/file/pending` itself.
      void window.webContents.executeJavaScript(
        `window.dispatchEvent(new Event(${JSON.stringify(PROJECT_OPEN_REQUEST_EVENT)}))`,
        true,
      );
    }
    if (window.isMinimized()) window.restore();
    window.focus();
  });

  app.whenReady().then(async () => {
    // One menu, and it is the editor's. Electron installs a default menu bar
    // when none is set, and this application has no command that belongs in
    // one: File, Export, Netlist and Help are all in the window.
    Menu.setApplicationMenu(null);
    lockDownNetwork();
    routeDownloadsToSaveDialog();
    await mkdir(projectsDirectory(), { recursive: true });
    await loadAssociationChoice();
    // Before the window, so the editor's About reads the association as it is.
    await ensureFileAssociation();
    let mainWindow: BrowserWindow | null = null;
    protocol.handle(
      APP_SCHEME,
      await createAppProtocolHandler({
        editorRoot: editorRoot(),
        dialogs: projectFileDialogs(() => mainWindow),
        shell: shellCommandPorts(() => mainWindow),
        pendingOpen: {
          take: () => {
            const path = requestedOpenPath;
            requestedOpenPath = null;
            return path;
          },
        },
      }),
    );
    mainWindow = await createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void createWindow().then((window) => (mainWindow = window));
      }
    });
  });

  app.on("window-all-closed", () => app.quit());
}
