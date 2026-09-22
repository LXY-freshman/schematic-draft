import {
  createEmptyProject,
  createRoutePath,
  CURRENT_PROJECT_SCHEMA_VERSION,
} from "@icm/model";
import { describe, expect, it } from "vitest";
import { parseProject, serializeProject } from "./index.js";

function projectWithCrossingRoutes() {
  const project = createEmptyProject("line-jump", "Line jump");
  const document = project.documents[0]!;
  document.nets.push(
    { id: "net-a", terminals: [] },
    { id: "net-b", terminals: [] },
  );
  document.junctions.push(
    { id: "J1", netId: "net-a", position: { x: 0, y: 50 } },
    { id: "J2", netId: "net-a", position: { x: 100, y: 50 } },
    { id: "J3", netId: "net-b", position: { x: 50, y: 0 } },
    { id: "J4", netId: "net-b", position: { x: 50, y: 100 } },
  );
  document.routes.push(
    createRoutePath({
      id: "horizontal",
      netId: "net-a",
      start: { kind: "junction", junctionId: "J1" },
      end: { kind: "junction", junctionId: "J2" },
      bends: [],
      modes: ["manual"],
      styleOverride: { color: "#123456" },
    }),
    createRoutePath({
      id: "vertical",
      netId: "net-b",
      start: { kind: "junction", junctionId: "J3" },
      end: { kind: "junction", junctionId: "J4" },
      bends: [],
      modes: ["manual"],
    }),
  );
  return project;
}

describe("schema 58 per-Route line jumps", () => {
  it("upgrades schema 57 without marking any Route for jumps", () => {
    const previous = {
      ...projectWithCrossingRoutes(),
      schemaVersion: 57,
    };
    expect(parseProject(JSON.stringify(previous))).toEqual({
      ...previous,
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    });
  });

  it.each([true, false])("round-trips lineJump %s", (lineJump) => {
    const project = projectWithCrossingRoutes();
    project.documents[0]!.routes[0]!.styleOverride!.lineJump = lineJump;
    const text = serializeProject(project);
    expect(parseProject(text)).toEqual(project);
    expect(serializeProject(parseProject(text))).toBe(text);
  });

  it("carries a jump flag on a Route with no other styling", () => {
    const project = projectWithCrossingRoutes();
    project.documents[0]!.routes[1]!.styleOverride = { lineJump: true };
    const text = serializeProject(project);
    expect(parseProject(text)).toEqual(project);
  });

  it("rejects a non-boolean flag at the project boundary", () => {
    const project = projectWithCrossingRoutes();
    const raw = JSON.parse(JSON.stringify(project));
    raw.documents[0].routes[0].styleOverride.lineJump = "yes";
    expect(() => parseProject(JSON.stringify(raw))).toThrow();
  });
});
