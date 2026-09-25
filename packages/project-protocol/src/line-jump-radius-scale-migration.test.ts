import { createEmptyProject, CURRENT_PROJECT_SCHEMA_VERSION } from "@icm/model";
import { describe, expect, it } from "vitest";
import { parseProject, serializeProject } from "./index.js";

function projectWithJumpScale(scale?: number) {
  const project = createEmptyProject("line-jump", "Line jump");
  const document = project.documents[0]!;
  if (scale !== undefined) {
    document.presentation.styleOverrides = { lineJumpRadiusScale: scale };
  }
  return project;
}

describe("schema 60 line-jump radius scale", () => {
  it("upgrades schema 59 without resizing any hop", () => {
    const previous = { ...projectWithJumpScale(), schemaVersion: 59 };
    expect(parseProject(JSON.stringify(previous))).toEqual({
      ...previous,
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    });
  });

  it.each([0.5, 1, 1.5, 2])("round-trips a factor of %s", (scale) => {
    const project = projectWithJumpScale(scale);
    const text = serializeProject(project);
    expect(parseProject(text)).toEqual(project);
    expect(serializeProject(parseProject(text))).toBe(text);
  });

  it("carries the factor alongside the other document knobs", () => {
    const project = projectWithJumpScale();
    project.documents[0]!.presentation.styleOverrides = {
      junctionRadiusScale: 1.25,
      lineJumpRadiusScale: 1.75,
    };
    expect(parseProject(serializeProject(project))).toEqual(project);
  });

  it("rejects a factor outside the shared style-scale range", () => {
    for (const value of [0, 0.25, 2.5, "2", null]) {
      const raw = JSON.parse(JSON.stringify(projectWithJumpScale(1)));
      raw.documents[0].presentation.styleOverrides.lineJumpRadiusScale = value;
      expect(() => parseProject(JSON.stringify(raw))).toThrow();
    }
  });
});
