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
import { LocalProjectStore } from "./local-projects.js";

const PRODUCT_NAME = "Schematic Draft";
const APP_USER_MODEL_ID = "com.schematicdraft.desktop";
const EDITOR_ROUTE = `${APP_ORIGIN}/editor`;

/**
 * Where a person's circuits live. Documents rather than AppData: these are
 * their files, meant to be found, copied and backed up like any other work.
 */
function projectsDirectory(): string {
  return join(app.getPath("documents"), PRODUCT_NAME, "Projects");
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
      defaultPath: join(app.getPath("documents"), item.getFilename()),
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
                "files, Projects are saved under Documents, and every network",
                "request is refused before a connection is made.",
                "",
                `Projects: ${projectsDirectory()}`,
              ].join("\n"),
            }),
        },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
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
  window.on("close", () => void saveWindowState(window));
  window.on("page-title-updated", (event) => event.preventDefault());

  await window.loadURL(EDITOR_ROUTE);
  return window;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setAppUserModelId(APP_USER_MODEL_ID);
  app.on("second-instance", () => {
    const [window] = BrowserWindow.getAllWindows();
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });

  app.whenReady().then(async () => {
    lockDownNetwork();
    routeDownloadsToSaveDialog();
    const store = new LocalProjectStore(projectsDirectory());
    await mkdir(projectsDirectory(), { recursive: true });
    protocol.handle(
      APP_SCHEME,
      await createAppProtocolHandler({ editorRoot: editorRoot(), store }),
    );
    await createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow();
    });
  });

  app.on("window-all-closed", () => app.quit());
}
