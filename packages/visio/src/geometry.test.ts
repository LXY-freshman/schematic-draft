import {
  transformPoint,
  type Mirror,
  type Rotation,
  type SymbolLocalRect,
} from "@icm/model";
import { describe, expect, it } from "vitest";

import {
  boundsOfPoints,
  pageFrameForBounds,
  placedSymbolBoxCorners,
  visioOrientation,
  visioShapePlacement,
} from "./geometry.js";
import { DOCUMENT_UNITS_PER_INCH, PAGE_MARGIN_INCHES } from "./units.js";

const box: SymbolLocalRect = { x: -10, y: -24, width: 20, height: 48 };
// Every rotation the model allows, not only the quarter turns: a symbol may be
// placed at 45°, and the export has to survive it.
const rotations: readonly Rotation[] = [0, 45, 90, 135, 180, 225, 270, 315];
const mirrors: readonly Mirror[] = ["none", "horizontal", "vertical", "both"];

describe("boundsOfPoints", () => {
  it("has no bounds for nothing", () => {
    expect(boundsOfPoints([])).toBeNull();
  });

  it("covers every point given", () => {
    expect(
      boundsOfPoints([
        { x: 10, y: -4 },
        { x: -6, y: 30 },
        { x: 2, y: 2 },
      ]),
    ).toEqual({ minX: -6, minY: -4, maxX: 10, maxY: 30 });
  });
});

describe("pageFrameForBounds", () => {
  const bounds = { minX: -40, minY: -80, maxX: 40, maxY: 80 };
  const frame = pageFrameForBounds(bounds);

  it("sizes the page to the drawing plus a margin on each side", () => {
    expect(frame.widthInches).toBeCloseTo(1 + 2 * PAGE_MARGIN_INCHES, 12);
    expect(frame.heightInches).toBeCloseTo(2 + 2 * PAGE_MARGIN_INCHES, 12);
  });

  it("puts the top-left of the drawing at the top-left of the page", () => {
    expect(frame.point({ x: -40, y: -80 })).toEqual({
      x: PAGE_MARGIN_INCHES,
      y: frame.heightInches - PAGE_MARGIN_INCHES,
    });
  });

  it("turns the schematic's downward y into Visio's upward y", () => {
    const upper = frame.point({ x: 0, y: -80 });
    const lower = frame.point({ x: 0, y: 80 });
    expect(upper.y).toBeGreaterThan(lower.y);
    expect(upper.y - lower.y).toBeCloseTo(160 / DOCUMENT_UNITS_PER_INCH, 12);
  });
});

describe("placedSymbolBoxCorners", () => {
  it("carries all four corners through the instance transform", () => {
    const corners = placedSymbolBoxCorners(
      box,
      { x: 100, y: 100 },
      { rotation: 0, mirror: "none" },
    );
    expect(corners).toHaveLength(4);
    expect(boundsOfPoints(corners)).toEqual({
      minX: 90,
      minY: 76,
      maxX: 110,
      maxY: 124,
    });
  });

  it("turns the box on its side when the instance is turned", () => {
    expect(
      boundsOfPoints(
        placedSymbolBoxCorners(
          box,
          { x: 0, y: 0 },
          { rotation: 90, mirror: "none" },
        ),
      ),
    ).toEqual({ minX: -24, minY: -10, maxX: 24, maxY: 10 });
  });
});

describe("visioOrientation", () => {
  it("reverses a plain rotation, because Visio turns the other way", () => {
    expect(visioOrientation({ rotation: 90, mirror: "none" })).toEqual({
      degrees: -90,
      flipX: 0,
      flipY: 0,
    });
  });

  it("keeps the sign when one axis is mirrored", () => {
    // The mirror reverses the turn and the y-flip reverses it back.
    expect(visioOrientation({ rotation: 45, mirror: "horizontal" })).toEqual({
      degrees: 45,
      flipX: 1,
      flipY: 0,
    });
    expect(visioOrientation({ rotation: 45, mirror: "vertical" })).toEqual({
      degrees: 45,
      flipX: 0,
      flipY: 1,
    });
  });

  it("treats a double mirror as the half turn it is", () => {
    const both = visioOrientation({ rotation: 90, mirror: "both" });
    expect(both).toEqual({ degrees: 90, flipX: 0, flipY: 0 });
  });
});

/**
 * Where Visio puts a point of a shape's artwork.
 *
 * This is Visio's own composition, written out: a local point is measured from
 * the shape's bottom-left corner, flipped about the local pin, rotated
 * counterclockwise about it, and carried to wherever the pin sits on the page.
 * It is deliberately not the code under test — the point of the test is that
 * two independent compositions land on the same page coordinate.
 */
function visioPlacedPoint(
  placement: ReturnType<typeof visioShapePlacement>,
  local: { x: number; y: number },
): { x: number; y: number } {
  const widthInches = box.width / DOCUMENT_UNITS_PER_INCH;
  const heightInches = box.height / DOCUMENT_UNITS_PER_INCH;
  const x =
    ((local.x - box.x) / DOCUMENT_UNITS_PER_INCH - widthInches / 2) *
    (placement.flipX ? -1 : 1);
  const y =
    ((box.y + box.height - local.y) / DOCUMENT_UNITS_PER_INCH -
      heightInches / 2) *
    (placement.flipY ? -1 : 1);
  const cos = Math.cos(placement.angleRadians);
  const sin = Math.sin(placement.angleRadians);
  return {
    x: placement.pin.x + x * cos - y * sin,
    y: placement.pin.y + x * sin + y * cos,
  };
}

describe("visioShapePlacement", () => {
  const frame = pageFrameForBounds({
    minX: -200,
    minY: -200,
    maxX: 200,
    maxY: 200,
  });
  const position = { x: 30, y: -50 };
  // A pin, an asymmetric interior point, and a corner: enough to catch a
  // mirror standing in for a rotation, which symmetric samples would not.
  const samples = [
    { x: 0, y: -20 },
    { x: -4, y: 12 },
    { x: 10, y: -24 },
  ];

  for (const mirror of mirrors) {
    for (const rotation of rotations) {
      it(`puts every point of a ${mirror}-mirrored ${rotation}° instance where the schematic does`, () => {
        const orientation = { rotation, mirror };
        const placement = visioShapePlacement(
          box,
          position,
          orientation,
          frame,
        );
        for (const sample of samples) {
          const expected = frame.point(
            transformPoint(sample, position, orientation),
          );
          const actual = visioPlacedPoint(placement, sample);
          expect(actual.x).toBeCloseTo(expected.x, 9);
          expect(actual.y).toBeCloseTo(expected.y, 9);
        }
      });
    }
  }

  it("writes the angle in radians, which is the unit Visio stores", () => {
    const placement = visioShapePlacement(
      box,
      position,
      { rotation: 270, mirror: "none" },
      frame,
    );
    // -270° normalized; a negative angle would be legal Visio but would not
    // match what the application writes back after a round trip.
    expect(placement.angleRadians).toBeCloseTo(Math.PI / 2, 12);
  });
});
