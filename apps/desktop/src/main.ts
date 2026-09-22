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
  type MenuItemConstructorOptions,
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
  type ProjectFileDialogs,
} from "./project-files.js";

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
 * folder, so it is kept honest: per-user keys only, the Help menu shows and
 * flips the real state, and turning it off is remembered instead of being
 * quietly restored at the next launch.
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

async function setFileAssociation(
  window: BrowserWindow,
  wanted: boolean,
): Promise<void> {
  const done = wanted ? await applyAssociation() : await withdrawAssociation();
  await rememberAssociationChoice(wanted);
  associationActive = done ? wanted : await queryAssociation();
  window.setMenu(buildMenu(window));
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
}

function buildMenu(window: BrowserWindow): Menu {
  const template: MenuItemConstructorOptions[] = [
    {
      label: "&File",
      submenu: [
        {
          label: "Open Projects Folder",
          click: () => void shell.openPath(projectsDirectory()),
        },
        { type: "separator" },
        { role: "quit", label: "E&xit" },
      ],
    },
    {
      label: "&View",
      submenu: [
        { role: "zoomIn" },
        { role: "zoomOut" },
        { role: "resetZoom" },
        { type: "separator" },
        { role: "togglefullscreen" },
        { type: "separator" },
        { role: "toggleDevTools" },
      ],
    },
    {
      label: "&Help",
      submenu: [
        {
          label: `Open ${PROJECT_FILE_EXTENSION} Files With This Copy`,
          type: "checkbox",
          checked: associationActive,
          enabled: process.platform === "win32" && app.isPackaged,
          click: (item) => void setFileAssociation(window, item.checked),
        },
        { type: "separator" },
        {
          label: `About ${PRODUCT_NAME}`,
          click: () =>
            void dialog.showMessageBox(window, {
              type: "info",
              title: `About ${PRODUCT_NAME}`,
              message: `${PRODUCT_NAME} ${app.getVersion()}`,
              detail: [
                "An offline desktop build of the open-source Analog Canvas",
                "schematic editor (GNU AGPL-3.0).",
                "",
                "Nothing leaves this computer: the editor runs from bundled",
                "files, Projects are saved wherever you choose, and every",
                "network request is refused before a connection is made.",
                "",
                installRoot === null
                  ? "This copy cannot write to its own folder, so it uses the\nper-user locations below."
                  : "Everything this copy writes stays in its own folder, so\nmoving the folder moves the whole installation.",
                "",
                `Projects: ${projectsDirectory()}`,
                `Settings and recovery: ${app.getPath("userData")}`,
                associationActive
                  ? `Double-click: ${PROJECT_FILE_EXTENSION} files open with this copy (a\nper-user registry entry, removable from this menu).`
                  : `Double-click: ${PROJECT_FILE_EXTENSION} files are not associated with\nthis copy; nothing of it is in the registry.`,
              ].join("\n"),
            }),
        },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
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
    autoHideMenuBar: true,
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
  window.setMenu(buildMenu(window));
  if (state.maximized) window.maximize();
  window.once("ready-to-show", () => window.show());

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
  window.on("page-title-updated", (event) => event.preventDefault());

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
    lockDownNetwork();
    routeDownloadsToSaveDialog();
    await mkdir(projectsDirectory(), { recursive: true });
    await loadAssociationChoice();
    // Before the window, so the Help menu shows the association as it really is.
    await ensureFileAssociation();
    let mainWindow: BrowserWindow | null = null;
    protocol.handle(
      APP_SCHEME,
      await createAppProtocolHandler({
        editorRoot: editorRoot(),
        dialogs: projectFileDialogs(() => mainWindow),
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
