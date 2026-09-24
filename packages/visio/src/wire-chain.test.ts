import { describe, expect, it } from "vitest";

import { planWireChain } from "./wire-chain.js";

describe("planWireChain", () => {
  it("keeps a hop interior to the run it interrupts", () => {
    // A hop never lands on a corner, so the run it interrupts always survives
    // as a piece either side of the arc.
    const links = planWireChain(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
      [
        {
          segmentIndex: 1,
          from: { x: 100, y: 40 },
          apex: { x: 104, y: 50 },
          to: { x: 100, y: 60 },
        },
      ],
    );
    expect(links).toEqual([
      { from: { x: 0, y: 0 }, to: { x: 100, y: 0 } },
      { from: { x: 100, y: 0 }, to: { x: 100, y: 40 } },
      {
        from: { x: 100, y: 40 },
        to: { x: 100, y: 60 },
        through: { x: 104, y: 50 },
      },
      { from: { x: 100, y: 60 }, to: { x: 100, y: 100 } },
    ]);
  });

  it("writes no link a Visio shape could not be glued along", () => {
    // A repeated centerline point is a corner that turns through nothing; a
    // zero-length one-dimensional shape has no direction to glue along, so the
    // chain drops it rather than writing a shape Visio cannot hold.
    expect(
      planWireChain([
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ]),
    ).toEqual([{ from: { x: 0, y: 0 }, to: { x: 10, y: 0 } }]);
  });

  it("still draws a Route that has collapsed to a point", () => {
    // Degenerate, but it is still a Route: dropping it would take its Net name
    // and its glue off the page with it.
    expect(
      planWireChain([
        { x: 5, y: 5 },
        { x: 5, y: 5 },
      ]),
    ).toEqual([{ from: { x: 5, y: 5 }, to: { x: 5, y: 5 } }]);
    expect(planWireChain([])).toEqual([]);
  });
});
