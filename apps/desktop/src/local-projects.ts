import { randomUUID } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";

/**
 * Local Projects: the desktop store behind the editor's Project API.
 *
 * The hosted editor saves a formal Project to one private Cloud Project over
 * `/api/projects`. The desktop shell answers that same contract from a folder
 * on this computer, so the editor needs no desktop-specific save path and a
 * Project saved here is a plain file the person already owns.
 *
 * One Project is one directory, named by its id:
 *
 *   <root>/<id>/circuit.icproj.json   canonical Project text, portable as-is
 *   <root>/<id>/meta.json             name, revision, updatedAt, schemaVersion
 *   <root>/<id>/preview.svg           shelf thumbnail, rendered on save
 *
 * Every write lands through a temporary file and a rename, so an interrupted
 * save leaves the previous revision intact rather than a truncated circuit.
 */

export interface LocalProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
  revision: number;
  schemaVersion: number;
}

export interface LocalProjectRecord extends LocalProjectSummary {
  projectText: string;
}

const PROJECT_FILE = "circuit.icproj.json";
const META_FILE = "meta.json";
const PREVIEW_FILE = "preview.svg";

/** Ids appear in URLs and in directory names; keep them boring on purpose. */
const ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/u;

export function isValidProjectId(id: string): boolean {
  return ID_PATTERN.test(id) && id !== "." && id !== "..";
}

function newProjectId(): string {
  return randomUUID();
}

function metaOf(value: unknown, id: string): LocalProjectSummary | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.name !== "string" ||
    typeof record.updatedAt !== "string" ||
    typeof record.revision !== "number" ||
    typeof record.schemaVersion !== "number"
  ) {
    return null;
  }
  return {
    id,
    name: record.name,
    updatedAt: record.updatedAt,
    revision: record.revision,
    schemaVersion: record.schemaVersion,
  };
}

export class LocalProjectStore {
  constructor(private readonly root: string) {}

  private directoryOf(id: string): string {
    if (!isValidProjectId(id)) throw new Error(`Invalid Project id: ${id}`);
    const target = resolve(this.root, id);
    // Belt and braces alongside the id pattern: a directory read must never
    // escape the store, however the id arrived.
    if (target !== join(this.root, id)) {
      throw new Error(`Invalid Project id: ${id}`);
    }
    return target;
  }

  /** Write through a temporary name so a crash cannot truncate live work. */
  private async writeAtomic(
    directory: string,
    file: string,
    contents: string,
  ): Promise<void> {
    const temporary = join(directory, `.${file}.${process.pid}.tmp`);
    await writeFile(temporary, contents, "utf8");
    await rename(temporary, join(directory, file));
  }

  async list(): Promise<LocalProjectSummary[]> {
    await mkdir(this.root, { recursive: true });
    const entries = await readdir(this.root, { withFileTypes: true });
    const summaries: LocalProjectSummary[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !isValidProjectId(entry.name)) continue;
      const summary = await this.readMeta(entry.name);
      if (summary) summaries.push(summary);
    }
    // Newest first, matching the hosted shelf; the id breaks ties so two
    // Projects saved in the same second keep a stable order.
    return summaries.sort(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) ||
        right.id.localeCompare(left.id),
    );
  }

  private async readMeta(id: string): Promise<LocalProjectSummary | null> {
    try {
      const raw = await readFile(join(this.directoryOf(id), META_FILE), "utf8");
      return metaOf(JSON.parse(raw), id);
    } catch {
      return null;
    }
  }

  async open(id: string): Promise<LocalProjectRecord | null> {
    const summary = await this.readMeta(id);
    if (!summary) return null;
    try {
      const projectText = await readFile(
        join(this.directoryOf(id), PROJECT_FILE),
        "utf8",
      );
      return { ...summary, projectText };
    } catch {
      return null;
    }
  }

  async preview(id: string): Promise<string | null> {
    try {
      return await readFile(join(this.directoryOf(id), PREVIEW_FILE), "utf8");
    } catch {
      return null;
    }
  }

  async create(input: {
    name: string;
    projectText: string;
    schemaVersion: number;
    previewSvg: string;
  }): Promise<LocalProjectSummary> {
    const id = newProjectId();
    const directory = this.directoryOf(id);
    await mkdir(directory, { recursive: true });
    const summary: LocalProjectSummary = {
      id,
      name: input.name,
      updatedAt: new Date().toISOString(),
      revision: 1,
      schemaVersion: input.schemaVersion,
    };
    await this.writeAtomic(directory, PROJECT_FILE, input.projectText);
    await this.writeAtomic(directory, PREVIEW_FILE, input.previewSvg);
    await this.writeAtomic(
      directory,
      META_FILE,
      `${JSON.stringify(summary, null, 2)}\n`,
    );
    return summary;
  }

  /**
   * Update one Project in place. `expectedRevision` is the revision the editor
   * believes it holds; a mismatch means the stored Project moved on and the
   * caller's work must not overwrite it.
   */
  async update(
    id: string,
    expectedRevision: number,
    input: {
      name: string;
      projectText: string;
      schemaVersion: number;
      previewSvg: string;
    },
  ): Promise<
    | { status: "saved"; project: LocalProjectSummary }
    | { status: "conflict"; project: LocalProjectSummary }
    | { status: "not-found" }
  > {
    const current = await this.open(id);
    if (!current) return { status: "not-found" };
    // A retried save whose acknowledgement was lost is already complete.
    if (
      current.name === input.name &&
      current.schemaVersion === input.schemaVersion &&
      current.projectText === input.projectText
    ) {
      const { projectText: _unused, ...summary } = current;
      return { status: "saved", project: summary };
    }
    if (current.revision !== expectedRevision) {
      const { projectText: _unused, ...summary } = current;
      return { status: "conflict", project: summary };
    }
    const directory = this.directoryOf(id);
    const summary: LocalProjectSummary = {
      id,
      name: input.name,
      updatedAt: new Date().toISOString(),
      revision: current.revision + 1,
      schemaVersion: input.schemaVersion,
    };
    await this.writeAtomic(directory, PROJECT_FILE, input.projectText);
    await this.writeAtomic(directory, PREVIEW_FILE, input.previewSvg);
    await this.writeAtomic(
      directory,
      META_FILE,
      `${JSON.stringify(summary, null, 2)}\n`,
    );
    return { status: "saved", project: summary };
  }

  async delete(id: string): Promise<boolean> {
    const existing = await this.readMeta(id);
    if (!existing) return false;
    await rm(this.directoryOf(id), { recursive: true, force: true });
    return true;
  }
}
