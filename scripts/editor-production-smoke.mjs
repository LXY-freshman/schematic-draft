// Production smoke: serve the already-built editor through Vite's real
// preview server and inspect it in Chromium. --check is intentionally
// read-only; normal mode refreshes the committed report.
//
// The desktop shell has one surface, so every path must mount the editor. The
// things worth proving here are that it mounts without console errors, that
// deferred runtimes stay deferred, and that nothing caches Project data.
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const workspace = process.cwd();
const editorRoot = resolve(workspace, "apps/editor");
const editorDist = resolve(editorRoot, "dist");
const reportPath = resolve(
  workspace,
  "fixtures/editor-production-smoke/report.json",
);
const check = process.argv.includes("--check");

async function builtJavaScriptContains(needle) {
  const entries = await readdir(editorDist, { recursive: true });
  const scripts = entries.filter((entry) => entry.endsWith(".js"));
  const contents = await Promise.all(
    scripts.map((entry) => readFile(resolve(editorDist, entry), "utf8")),
  );
  return contents.some((content) => content.includes(needle));
}

async function loadedJavaScriptContains(page, needle) {
  const paths = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .map((entry) => new URL(entry.name).pathname)
      .filter((pathname) => pathname.endsWith(".js")),
  );
  const uniquePaths = [...new Set(paths)];
  const contents = await Promise.all(
    uniquePaths.map(async (pathname) => {
      const relativePath = pathname.replace(/^\/+/, "");
      return readFile(resolve(editorDist, relativePath), "utf8");
    }),
  );
  return contents.some((content) => content.includes(needle));
}

async function loadedJavaScriptPathContains(page, needle) {
  return page.evaluate(
    (expected) =>
      performance
        .getEntriesByType("resource")
        .some(
          (entry) =>
            new URL(entry.name).pathname.endsWith(".js") &&
            new URL(entry.name).pathname.includes(expected),
        ),
    needle,
  );
}

async function loadedStylesheetContains(page, needle) {
  const paths = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .map((entry) => new URL(entry.name).pathname)
      .filter((pathname) => pathname.endsWith(".css")),
  );
  const uniquePaths = [...new Set(paths)];
  const contents = await Promise.all(
    uniquePaths.map(async (pathname) => {
      const relativePath = pathname.replace(/^\/+/, "");
      return readFile(resolve(editorDist, relativePath), "utf8");
    }),
  );
  return contents.some((content) => content.includes(needle));
}

async function main() {
  const expected = check
    ? JSON.parse(await readFile(reportPath, "utf8"))
    : null;
  const { preview } = await import("vite");
  let server;
  let browser;
  const consoleErrors = [];
  let mounted = false;
  let rootMountsEditor = false;
  let projectDataIsolation = "unchecked";
  let serviceWorkerRegistered = true;
  let editorCodeLoaded = false;
  let editorStylesLoaded = false;
  let editorPdfRuntimeLoaded = true;
  try {
    server = await preview({
      root: editorRoot,
      logLevel: "silent",
      preview: { host: "127.0.0.1", port: 4174, strictPort: true },
    });
    const url = server.resolvedUrls?.local[0] ?? "http://127.0.0.1:4174/";
    browser = await chromium.launch(
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
        : { channel: process.env.CI ? undefined : "chrome" },
    );
    const page = await browser.newPage();
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    // One surface: the root and a deep path both open the editor.
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-testid="schematic-canvas"]', {
      timeout: 10_000,
    });
    rootMountsEditor = true;
    await page.goto(new URL("editor", url).href, {
      waitUntil: "networkidle",
    });
    await page.waitForSelector('[data-testid="schematic-canvas"]', {
      timeout: 10_000,
    });
    editorCodeLoaded = await loadedJavaScriptContains(page, "schematic-canvas");
    editorStylesLoaded = await loadedStylesheetContains(
      page,
      ".schematic-canvas",
    );
    editorPdfRuntimeLoaded = await loadedJavaScriptPathContains(
      page,
      "browser-pdf-",
    );
    if (
      await loadedJavaScriptContains(
        page,
        "Unrecognized extension value in extension set",
      )
    ) {
      throw new Error(
        "CodeMirror state runtime loaded before a code editor was requested",
      );
    }
    // The shell bundles its own files, so a production build installs no
    // service worker: no stale-cache class of bug, and no cache to inspect
    // for leaked circuits.
    serviceWorkerRegistered = await page.evaluate(
      async () => (await navigator.serviceWorker.getRegistrations()).length > 0,
    );
    mounted = true;
    // Browser recovery is Project data and must never leak into Cache Storage.
    projectDataIsolation = await page.evaluate(async () => {
      if (typeof caches === "undefined") return "caches-unavailable";
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) {
          const response = await cache.match(request);
          if (!response) continue;
          // Build JS legitimately contains bundled examples and schema names.
          // Those are application code, not a user's recovery/project payload.
          const path = new URL(request.url).pathname;
          const type = response.headers.get("content-type") ?? "";
          if (
            path.startsWith("/assets/") &&
            /javascript|css|font|image/.test(type)
          )
            continue;
          if (path.startsWith("/api/"))
            return `api-data-in-cache:${request.url}`;
          const text = await response.text();
          if (
            text.includes('"topDocumentId"') ||
            text.includes('"schemaVersion"')
          ) {
            return `project-data-in-cache:${name}:${request.url}`;
          }
        }
      }
      return "clean";
    });
  } finally {
    await browser?.close();
    await server?.close();
  }

  const nodeCryptoExternalized = await builtJavaScriptContains(
    "node:crypto has been externalized",
  );
  const report = {
    mounted,
    consoleErrors,
    nodeCryptoExternalized,
    projectDataIsolation,
    rootMountsEditor,
    serviceWorkerRegistered,
    editorCodeLoaded,
    editorStylesLoaded,
    editorPdfRuntimeLoaded,
  };

  if (check) {
    if (JSON.stringify(expected) !== JSON.stringify(report)) {
      throw new Error(
        `Production smoke report is stale:\nexpected ${JSON.stringify(expected)}\nreceived ${JSON.stringify(report)}`,
      );
    }
  } else {
    await mkdir(resolve(workspace, "fixtures/editor-production-smoke"), {
      recursive: true,
    });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  if (!report.mounted) throw new Error("Production editor did not mount");
  if (!report.rootMountsEditor) {
    throw new Error("The root path did not mount the editor");
  }
  if (report.serviceWorkerRegistered) {
    throw new Error("The production build installed a service worker");
  }
  if (!report.editorCodeLoaded) {
    throw new Error("Editor route did not load its editor bundle");
  }
  if (!report.editorStylesLoaded) {
    throw new Error("Editor route did not load its editor stylesheet");
  }
  if (report.editorPdfRuntimeLoaded) {
    throw new Error("PDF runtime loaded before a PDF export was requested");
  }
  if (report.consoleErrors.length > 0) {
    throw new Error(
      `Production smoke console errors:\n${report.consoleErrors.join("\n")}`,
    );
  }
  if (report.nodeCryptoExternalized) {
    throw new Error("node:crypto was externalized in the production build");
  }
  if (report.projectDataIsolation !== "clean") {
    throw new Error(
      `Project data found in browser caches: ${report.projectDataIsolation}`,
    );
  }
  console.log("Editor production preview smoke passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
