import {
  createEmptyProject,
  createRoutePath,
  CURRENT_PROJECT_SCHEMA_VERSION,
} from "@icm/model";
import { describe, expect, it } from "vitest";
import { parseProject, serializeProject } from "./index.js";

function projectWithWireAndInstance() {
  const project = createEmptyProject("stroke-scale", "Stroke scale");
  const document = project.documents[0]!;
  document.nets.push({ id: "net-a", terminals: [] });
  document.junctions.push(
    { id: "J1", netId: "net-a", position: { x: 0, y: 50 } },
    { id: "J2", netId: "net-a", position: { x: 100, y: 50 } },
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
  );
  document.instances.push({
    id: "R1",
    symbolId: "resistor",
    reference: "R1",
    placement: {
      position: { x: 200, y: 50 },
      rotation: 0,
      mirror: "none",
    },
    styleOverride: { foreground: "#123456" },
  });
  return project;
}

describe("schema 59 per-object stroke scale", () => {
  it("upgrades schema 58 without thickening anything", () => {
    const previous = {
      ...projectWithWireAndInstance(),
      schemaVersion: 58,
    };
    expect(parseProject(JSON.stringify(previous))).toEqual({
      ...previous,
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    });
  });

  it.each([0.25, 1, 2.5, 4])("round-trips a Route scale of %s", (scale) => {
    const project = projectWithWireAndInstance();
    project.documents[0]!.routes[0]!.styleOverride!.strokeScale = scale;
    const text = serializeProject(project);
    expect(parseProject(text)).toEqual(project);
    expect(serializeProject(parseProject(text))).toBe(text);
  });

  it("carries an Instance scale with no other styling", () => {
    const project = projectWithWireAndInstance();
    project.documents[0]!.instances[0]!.styleOverride = { strokeScale: 1.75 };
    const text = serializeProject(project);
    expect(parseProject(text)).toEqual(project);
  });

  it.each([
    [
      "a Route",
      (raw: any, value: unknown) => {
        raw.documents[0].routes[0].styleOverride.strokeScale = value;
      },
    ],
    [
      "an Instance",
      (raw: any, value: unknown) => {
        raw.documents[0].instances[0].styleOverride.strokeScale = value;
      },
    ],
  ] as const)("rejects an out-of-range scale on %s", (_label, assign) => {
    for (const value of [0, 0.2, 4.1, "2", null]) {
      const raw = JSON.parse(JSON.stringify(projectWithWireAndInstance()));
      assign(raw, value);
      expect(() => parseProject(JSON.stringify(raw))).toThrow();
    }
  });
});
