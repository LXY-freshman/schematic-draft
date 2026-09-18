import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createEmptyProject } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";
import { describe, expect, it } from "vitest";

import { APP_ORIGIN, createAppProtocolHandler } from "./app-protocol.js";
import { LocalProjectStore } from "./local-projects.js";

const INDEX_HTML = [
  "<!doctype html><title>Schematic Draft</title>",
  "<script>console.log('theme')</script>",
  '<script type="module" src="/assets/index.js"></script>',
].join("\n");

async function shell() {
  const editorRoot = await mkdtemp(join(tmpdir(), "sd-editor-"));
  await writeFile(join(editorRoot, "index.html"), INDEX_HTML);
  await writeFile(join(editorRoot, "app.js"), "export {};");
  const projectsRoot = await mkdtemp(join(tmpdir(), "sd-projects-"));
  const store = new LocalProjectStore(projectsRoot);
  const handle = await createAppProtocolHandler({ editorRoot, store });
  const request = (path: string, init?: RequestInit) =>
    handle(new Request(`${APP_ORIGIN}${path}`, init));
  return { handle, request, projectsRoot };
}

const projectText = (name: string) =>
  serializeProject(createEmptyProject("smoke", name));

const saveBody = (name: string) =>
  JSON.stringify({ name, projectText: projectText(name) });

describe("desktop app protocol", () => {
  it("serves the editor with a hash-based CSP and a SPA fallback", async () => {
    const { handle, request } = await shell();

    const index = await request("/");
    expect(index.status).toBe(200);
    expect(await index.text()).toContain("Schematic Draft");
    const csp = index.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toMatch(/script-src 'self' 'sha256-[A-Za-z0-9+/=]+'/u);
    expect(csp).not.toContain("unsafe-inline");
    expect(index.headers.get("cache-control")).toBe("no-cache");

    const route = await request("/editor");
    expect(route.status).toBe(200);
    expect(await route.text()).toContain("Schematic Draft");

    const asset = await request("/app.js");
    expect(asset.headers.get("content-type")).toContain("text/javascript");
    expect(asset.headers.get("cache-control")).toContain("immutable");

    expect((await request("/assets/missing.js")).status).toBe(404);
    expect((await request("/..%2F..%2Fetc/passwd")).status).toBe(404);
    expect((await request("/app.js", { method: "POST" })).status).toBe(405);
    expect((await request("/api/auth/me")).status).toBe(404);
    expect((await handle(new Request("app://elsewhere/"))).status).toBe(404);
  });

  it("round-trips a Project through the local store", async () => {
    const { request, projectsRoot } = await shell();
    const jsonRequest = (path: string, init: RequestInit) =>
      request(path, {
        ...init,
        headers: { "content-type": "application/json", ...init.headers },
      });

    expect(await (await request("/api/projects")).json()).toEqual({
      projects: [],
    });

    const created = await jsonRequest("/api/projects", {
      method: "POST",
      body: saveBody("Low-pass filter"),
    });
    expect(created.status).toBe(201);
    const { project } = (await created.json()) as {
      project: { id: string; revision: number; name: string };
    };
    expect(project.revision).toBe(1);
    expect(project.name).toBe("Low-pass filter");

    const onDisk = join(projectsRoot, project.id);
    expect((await stat(join(onDisk, "circuit.icproj.json"))).isFile()).toBe(
      true,
    );
    expect(
      JSON.parse(await readFile(join(onDisk, "meta.json"), "utf8")),
    ).toEqual(
      expect.objectContaining({ name: "Low-pass filter", revision: 1 }),
    );

    const listed = (await (await request("/api/projects")).json()) as {
      projects: { id: string }[];
    };
    expect(listed.projects.map((item) => item.id)).toEqual([project.id]);

    const opened = await request(`/api/projects/${project.id}`);
    expect(opened.status).toBe(200);
    const openedBody = (await opened.json()) as {
      project: { projectText: string };
    };
    expect(openedBody.project.projectText).toBe(projectText("Low-pass filter"));

    const preview = await request(`/api/projects/${project.id}/preview.svg`);
    expect(preview.status).toBe(200);
    expect(preview.headers.get("content-type")).toContain("image/svg+xml");
    expect(await preview.text()).toContain("<svg");

    expect(
      (
        await jsonRequest(`/api/projects/${project.id}`, {
          method: "PUT",
          body: saveBody("Renamed"),
        })
      ).status,
    ).toBe(428);

    const updated = await jsonRequest(`/api/projects/${project.id}`, {
      method: "PUT",
      headers: { "if-match": "revision-1" },
      body: saveBody("Renamed"),
    });
    expect(updated.status).toBe(200);
    expect(
      ((await updated.json()) as { project: { revision: number } }).project
        .revision,
    ).toBe(2);

    const stale = await jsonRequest(`/api/projects/${project.id}`, {
      method: "PUT",
      headers: { "if-match": "revision-1" },
      body: saveBody("Stale"),
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual(
      expect.objectContaining({ error: "revision-conflict" }),
    );

    const deleted = await request(`/api/projects/${project.id}`, {
      method: "DELETE",
    });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ projects: [] });
    expect((await request(`/api/projects/${project.id}`)).status).toBe(404);
  });

  it("refuses malformed, oversized and mis-addressed saves", async () => {
    const { request } = await shell();
    const post = (body: string) =>
      request("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });

    expect((await post("not json")).status).toBe(400);
    expect((await post(JSON.stringify({ name: "x" }))).status).toBe(400);
    expect(
      (await post(JSON.stringify({ name: "x", projectText: "{}" }))).status,
    ).toBe(400);
    expect(
      (
        await post(
          JSON.stringify({
            name: "x",
            projectText: "x".repeat(4 * 1024 * 1024 + 1),
          }),
        )
      ).status,
    ).toBe(413);
    // Percent-encoded dots survive URL normalisation, so the id guard — not
    // the parser — is what keeps a save inside the Projects folder.
    expect((await request("/api/projects/%2E%2E%2F%2E%2E%2Fetc")).status).toBe(
      404,
    );
    expect((await request("/api/projects/nope")).status).toBe(404);
    expect((await request("/api/projects", { method: "PATCH" })).status).toBe(
      405,
    );
  });
});
