import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { CURRENT_PROJECT_SCHEMA_VERSION } from "@icm/model";
import {
  parseProject,
  serializeProject,
  tryParseProjectWithMetadata,
} from "./index.js";

/**
 * The frozen Project samples handed to upstream Analog Canvas (issue #1003).
 *
 * These assertions are deliberately about *properties* of the committed bytes,
 * never about equality with a re-run of `scripts/generate-upstream-handoff.mjs`.
 * The samples were drawn and corrected in the real desktop shell, so the bytes
 * are authored artefacts, not generator output; a drift gate over them would
 * force a regeneration at the next schema bump and destroy the thing upstream
 * asked for. What has to stay true is that each file still parses, still
 * reports the schema version its name claims, and still carries exactly the
 * fork fields the manifest says it carries — `11-origin-indistinguishable`
 * means nothing unless "no fork field anywhere" is checked rather than
 * asserted in prose.
 */

interface HandoffSample {
  readonly file: string;
  readonly schemaVersion: number;
  readonly circuit: string;
  readonly covers: string;
  readonly extensionFieldPaths: readonly string[];
  readonly knownDivergence: readonly string[];
  readonly preview?: string;
}

interface HandoffManifest {
  readonly bundle: string;
  readonly currentSchemaVersion: number;
  readonly upstreamIssue: string;
  readonly divergenceCodes: Readonly<Record<string, string>>;
  readonly samples: readonly HandoffSample[];
}

const repositoryRoot = process.cwd();
const directory = "fixtures/upstream-handoff";

const manifest = JSON.parse(
  readFileSync(resolve(repositoryRoot, directory, "manifest.json"), "utf8"),
) as HandoffManifest;

/**
 * Every persisted field the fork added after the common ancestor, as a JSON
 * path with `[]` standing for "any index". Drafting objects also carry a
 * `styleOverride.strokeScale`, but that one predates the fork, so it is not
 * listed and not scanned for.
 */
const EXTENSION_FIELD_PATHS = [
  "documents[].routes[].styleOverride.lineJump",
  "documents[].routes[].styleOverride.strokeScale",
  "documents[].instances[].styleOverride.strokeScale",
  "documents[].presentation.styleOverrides.lineJumpRadiusScale",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function array(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

/** The subset of {@link EXTENSION_FIELD_PATHS} actually present in raw bytes. */
function presentExtensionFieldPaths(raw: unknown): string[] {
  const present = new Set<string>();
  if (!isRecord(raw)) return [];
  for (const document of array(raw.documents)) {
    if (!isRecord(document)) continue;
    for (const route of array(document.routes)) {
      if (!isRecord(route) || !isRecord(route.styleOverride)) continue;
      if (route.styleOverride.lineJump !== undefined)
        present.add("documents[].routes[].styleOverride.lineJump");
      if (route.styleOverride.strokeScale !== undefined)
        present.add("documents[].routes[].styleOverride.strokeScale");
    }
    for (const instance of array(document.instances)) {
      if (!isRecord(instance) || !isRecord(instance.styleOverride)) continue;
      if (instance.styleOverride.strokeScale !== undefined)
        present.add("documents[].instances[].styleOverride.strokeScale");
    }
    const presentation = isRecord(document.presentation)
      ? document.presentation
      : undefined;
    const overrides = isRecord(presentation?.styleOverrides)
      ? presentation.styleOverrides
      : undefined;
    if (overrides?.lineJumpRadiusScale !== undefined)
      present.add(
        "documents[].presentation.styleOverrides.lineJumpRadiusScale",
      );
  }
  return [...present].sort();
}

function trackedSamplePaths(): string[] {
  return execFileSync("git", ["ls-files", "--", directory], {
    cwd: repositoryRoot,
    encoding: "utf8",
  })
    .split("\n")
    .filter((path) => path.endsWith(".schdraft"))
    .map((path) => path.slice(`${directory}/`.length))
    .sort();
}

function read(file: string): string {
  return readFileSync(resolve(repositoryRoot, directory, file), "utf8");
}

describe("upstream handoff samples", () => {
  it("lists every committed sample exactly once", () => {
    expect(manifest.samples.map((sample) => sample.file).sort()).toEqual(
      trackedSamplePaths(),
    );
    expect(manifest.currentSchemaVersion).toBe(CURRENT_PROJECT_SCHEMA_VERSION);
  });

  it("loads each sample at the schema version its entry claims", () => {
    for (const sample of manifest.samples) {
      const original = read(sample.file);
      expect(JSON.parse(original).schemaVersion, sample.file).toBe(
        sample.schemaVersion,
      );

      const result = tryParseProjectWithMetadata(original);
      expect(result.ok, sample.file).toBe(true);
      if (!result.ok) continue;
      expect(result.sourceSchemaVersion, sample.file).toBe(
        sample.schemaVersion,
      );
      expect(result.project.schemaVersion, sample.file).toBe(
        CURRENT_PROJECT_SCHEMA_VERSION,
      );

      // Everything except the stamped version number is what the shell saves,
      // which is what makes stamping exact: re-serializing the migrated Project
      // reproduces the file byte for byte once the number is put back.
      const saved = serializeProject(result.project);
      expect(parseProject(saved), sample.file).toEqual(result.project);
      expect(
        saved.replace(
          `"schemaVersion": ${CURRENT_PROJECT_SCHEMA_VERSION}`,
          `"schemaVersion": ${sample.schemaVersion}`,
        ),
        sample.file,
      ).toBe(original);
    }
  });

  it("carries exactly the fork fields its entry declares", () => {
    for (const sample of manifest.samples) {
      for (const path of sample.extensionFieldPaths) {
        expect(EXTENSION_FIELD_PATHS, sample.file).toContain(path);
      }
      expect(
        presentExtensionFieldPaths(JSON.parse(read(sample.file))),
        sample.file,
      ).toEqual([...sample.extensionFieldPaths].sort());
    }
  });

  it("ships a preview for exactly the entries that declare one", () => {
    for (const sample of manifest.samples) {
      const slug = sample.file.replace(/\.v\d+\.schdraft$/u, "");
      const svg = resolve(repositoryRoot, directory, `${slug}.svg`);
      if (sample.preview === undefined) {
        expect(existsSync(svg), sample.file).toBe(false);
        continue;
      }
      expect(sample.preview, sample.file).toBe(`${slug}.svg`);
      expect(existsSync(svg), sample.file).toBe(true);
    }
  });

  it("states a divergence consistent with the version it was stamped at", () => {
    for (const sample of manifest.samples) {
      for (const code of sample.knownDivergence) {
        expect(Object.keys(manifest.divergenceCodes), sample.file).toContain(
          code,
        );
      }
      // 58 is the one number both projects use, so a 58 sample is read by
      // upstream as its own 58 with no diagnostic. 59 and 60 are above
      // upstream's current version and are refused outright, which is loud
      // and therefore safe. 57 predates the divergence entirely.
      const collision = sample.knownDivergence.includes(
        "schema-version-collision",
      );
      const ahead = sample.knownDivergence.includes(
        "version-ahead-of-upstream",
      );
      expect([collision, ahead], sample.file).toEqual(
        sample.schemaVersion === 57
          ? [false, false]
          : sample.schemaVersion === 58
            ? [true, false]
            : [false, true],
      );
    }
  });
});
