import type { CircuitProject } from "@icm/model";
import { parseProject, serializeProject } from "@icm/project-protocol";
import { renderDocumentSvg } from "@icm/render-svg";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";

import { isValidProjectId, type LocalProjectStore } from "./local-projects.js";

/**
 * The editor's Project API, answered from the local store.
 *
 * Status codes and payload shapes mirror the hosted Worker so the editor's
 * `cloud-projects.ts` client needs no desktop branch: 201/200 with
 * `{ project }`, 404 `not-found`, 409 `revision-conflict`, 413 `too-large`,
 * 428 when a PUT carries no expected revision.
 */

/** Matches the hosted limit so an exported Project round-trips either way. */
const MAX_PROJECT_BYTES = 4 * 1024 * 1024;
const MAX_NAME_LENGTH = 200;

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

function renderPreview(project: CircuitProject): string {
  const topDocument = project.documents.find(
    (document) => document.id === project.topDocumentId,
  );
  if (!topDocument) return "";
  try {
    return renderDocumentSvg(
      topDocument,
      createProjectSymbolResolver(project, builtInSymbols),
    );
  } catch {
    // The renderer cannot draw this Project; the shelf shows its placeholder.
    return "";
  }
}

function fieldText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : null;
}

export async function handleProjectApi(
  request: Request,
  pathname: string,
  store: LocalProjectStore,
): Promise<Response | null> {
  if (pathname === "/api/projects") {
    if (request.method === "GET") {
      return json({ projects: await store.list() });
    }
    if (request.method === "POST") return save(request, store, null);
    return json({ error: "method-not-allowed" }, 405);
  }
  if (!pathname.startsWith("/api/projects/")) return null;

  const segments = pathname.slice("/api/projects/".length).split("/");
  const id = decodeURIComponent(segments[0] ?? "");
  if (!isValidProjectId(id)) return json({ error: "not-found" }, 404);

  if (segments.length === 2 && segments[1] === "preview.svg") {
    if (request.method !== "GET") {
      return json({ error: "method-not-allowed" }, 405);
    }
    const svg = await store.preview(id);
    if (svg === null) return json({ error: "not-found" }, 404);
    return new Response(svg, {
      headers: {
        "content-type": "image/svg+xml; charset=utf-8",
        // The revision is in the query string, so a changed drawing gets a
        // new URL and an unchanged tile can stay cached.
        "cache-control": "private, max-age=31536000, immutable",
      },
    });
  }
  if (segments.length !== 1) return json({ error: "not-found" }, 404);

  if (request.method === "GET") {
    const project = await store.open(id);
    return project ? json({ project }) : json({ error: "not-found" }, 404);
  }
  if (request.method === "DELETE") {
    await store.delete(id);
    return json({ projects: await store.list() });
  }
  if (request.method === "PUT") return save(request, store, id);
  return json({ error: "method-not-allowed" }, 405);
}

async function save(
  request: Request,
  store: LocalProjectStore,
  id: string | null,
): Promise<Response> {
  const body = (await request.json().catch(() => null)) as {
    name?: unknown;
    projectText?: unknown;
  } | null;
  const name = fieldText(body?.name, MAX_NAME_LENGTH);
  if (!body || !name || typeof body.projectText !== "string") {
    return json({ error: "invalid-fields" }, 400);
  }
  if (Buffer.byteLength(body.projectText, "utf8") > MAX_PROJECT_BYTES) {
    return json({ error: "too-large" }, 413);
  }
  let project: CircuitProject;
  try {
    project = parseProject(body.projectText);
  } catch {
    return json({ error: "invalid-project" }, 400);
  }
  const input = {
    name,
    projectText: serializeProject(project),
    schemaVersion: project.schemaVersion,
    previewSvg: renderPreview(project),
  };
  if (id === null) {
    return json({ project: await store.create(input) }, 201);
  }
  const expected = /^revision-(\d+)$/u.exec(
    request.headers.get("if-match") ?? "",
  );
  if (!expected) return json({ error: "expected-revision-required" }, 428);
  const outcome = await store.update(id, Number(expected[1]), input);
  if (outcome.status === "not-found") return json({ error: "not-found" }, 404);
  if (outcome.status === "conflict") {
    return json({ error: "revision-conflict", project: outcome.project }, 409);
  }
  return json({ project: outcome.project });
}
