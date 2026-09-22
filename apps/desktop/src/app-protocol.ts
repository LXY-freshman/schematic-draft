import { createHash, randomBytes } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";

import {
  handleProjectFileApi,
  type PendingProjectOpen,
  type ProjectFileDialogs,
} from "./project-files.js";

/**
 * The editor's origin inside the desktop shell.
 *
 * The shell serves the editor bundle over a private `app://` scheme rather
 * than a loopback HTTP port. The origin is therefore stable across launches
 * (recovery copies and preferences stay put), no socket is ever opened, and
 * no other process on the computer can reach the Project API.
 */
export const APP_SCHEME = "app";
export const APP_HOST = "schematic-draft";
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

const TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export interface AppProtocolOptions {
  editorRoot: string;
  dialogs: ProjectFileDialogs;
  /** A file the launch was asked to open, for the editor to collect. */
  pendingOpen?: PendingProjectOpen;
}

function inside(root: string, requested: string): string {
  const target = resolve(root, requested);
  const relation = relative(root, target);
  if (relation.startsWith("..") || isAbsolute(relation)) {
    throw new Error("Requested path escapes the editor root");
  }
  return target;
}

/**
 * The editor's document carries two inline scripts (theme bootstrap and
 * route preload). Hash them once so the policy can stay `script-src 'self'`
 * plus exactly those two, with no `'unsafe-inline'` anywhere.
 */
function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  for (const match of html.matchAll(
    /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/giu,
  )) {
    const body = match[1] ?? "";
    if (body.trim().length === 0) continue;
    hashes.push(
      `'sha256-${createHash("sha256").update(body).digest("base64")}'`,
    );
  }
  return hashes;
}

/**
 * The name of the meta element that hands the document's style nonce to the
 * editor. Kept in step with `apps/editor/src/style-nonce.ts`.
 */
export const CSP_NONCE_META_NAME = "csp-nonce";

const NONCE_ANCHOR = "<head>";

function withStyleNonce(html: string, nonce: string): string {
  return html.replace(
    NONCE_ANCHOR,
    `${NONCE_ANCHOR}<meta name="${CSP_NONCE_META_NAME}" content="${nonce}" />`,
  );
}

export async function createAppProtocolHandler(
  options: AppProtocolOptions,
): Promise<(request: Request) => Promise<Response>> {
  const root = resolve(options.editorRoot);
  if (!(await stat(root)).isDirectory()) {
    throw new Error(`Editor root is not a directory: ${root}`);
  }
  const indexHtml = await readFile(inside(root, "index.html"), "utf8");
  const scriptSources = ["'self'", ...inlineScriptHashes(indexHtml)].join(" ");
  if (!indexHtml.includes(NONCE_ANCHOR)) {
    // Refuse to launch rather than serve a document that cannot carry the
    // nonce: the editor would come up with its code panels and schematic font
    // silently unstyled, which is not a failure it can report.
    throw new Error("The editor document has no <head> to carry a style nonce");
  }

  /**
   * Two inline stylesheets are part of the editor rather than accidents of it:
   * CodeMirror mounts its theme as a `<style>` element the first time a code
   * view opens, and the canvas carries the round-period `@font-face` whose
   * metrics the renderer has already measured against. A flat
   * `style-src 'self'` drops both — the code panels lose their layout and the
   * period falls back to a different advance — so the document response mints
   * a nonce and admits exactly what carries it. `'unsafe-inline'` would admit
   * anything the SVG scene could smuggle past escaping, which is the one
   * markup path this editor writes by hand.
   */
  const contentSecurityPolicy = (styleNonce: string | null): string =>
    [
      "default-src 'self'",
      "img-src 'self' blob: data:",
      styleNonce
        ? `style-src 'self' 'nonce-${styleNonce}'`
        : "style-src 'self'",
      "font-src 'self' data:",
      `script-src ${scriptSources}`,
      "worker-src 'self' blob:",
      "connect-src 'self'",
      "frame-src 'none'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
    ].join("; ");

  const secureHeaders = {
    "content-security-policy": contentSecurityPolicy(null),
    "cross-origin-opener-policy": "same-origin",
    "x-content-type-options": "nosniff",
  };

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (url.host !== APP_HOST) {
      return new Response("Not Found", { status: 404 });
    }
    const pathname = decodeURIComponent(url.pathname);

    if (pathname.startsWith("/api/")) {
      const response = await handleProjectFileApi(request, pathname, {
        dialogs: options.dialogs,
        ...(options.pendingOpen === undefined
          ? {}
          : { pendingOpen: options.pendingOpen }),
      });
      if (response) {
        for (const [name, value] of Object.entries(secureHeaders)) {
          response.headers.set(name, value);
        }
        return response;
      }
      // The file bridge is the only API this shell answers; anything else a
      // future editor build asked for gets a 404 rather than hanging.
      return new Response(JSON.stringify({ error: "not-found" }), {
        status: 404,
        headers: { "content-type": "application/json", ...secureHeaders },
      });
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405 });
    }
    try {
      const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
      let target = inside(root, relativePath);
      try {
        if (!(await stat(target)).isFile()) throw new Error("not a file");
      } catch {
        // Extensionless paths are editor routes; the document answers them.
        if (extname(relativePath)) throw new Error("Asset not found");
        target = inside(root, "index.html");
      }
      const bytes = await readFile(target);
      const immutable = !target.endsWith("index.html");
      if (!immutable) {
        // A fresh nonce per document load: it is a licence for this page's
        // own stylesheets, not a value worth caching or reusing.
        const styleNonce = randomBytes(16).toString("base64");
        const html = withStyleNonce(bytes.toString("utf8"), styleNonce);
        return new Response(request.method === "HEAD" ? null : html, {
          status: 200,
          headers: {
            "content-type": TYPES[".html"] ?? "text/html; charset=utf-8",
            "cache-control": "no-cache",
            ...secureHeaders,
            "content-security-policy": contentSecurityPolicy(styleNonce),
          },
        });
      }
      return new Response(request.method === "HEAD" ? null : bytes, {
        status: 200,
        headers: {
          "content-type": TYPES[extname(target)] ?? "application/octet-stream",
          "cache-control": "public, max-age=31536000, immutable",
          ...secureHeaders,
        },
      });
    } catch {
      return new Response("Not Found", { status: 404, headers: secureHeaders });
    }
  };
}
