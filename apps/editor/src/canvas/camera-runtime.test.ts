import { describe, expect, it, vi } from "vitest";

import { createCameraRuntime, visibleCameraRect } from "./camera-runtime";

function fixture(panel = { width: 1000, height: 800 }) {
  const frames: FrameRequestCallback[] = [];
  const commits: Array<() => void> = [];
  const committed = vi.fn();
  const attributes = new Map<string, string>();
  const boundedAttributes = new Map<string, string>();
  const getBoundingClientRect = vi.fn(() => ({
    x: 10,
    y: 20,
    left: 10,
    top: 20,
    right: 10 + panel.width,
    bottom: 20 + panel.height,
    width: panel.width,
    height: panel.height,
    toJSON: () => ({}),
  })) as unknown as SVGSVGElement["getBoundingClientRect"];
  const surface = {
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    getBoundingClientRect,
    querySelectorAll: () => [
      {
        setAttribute: (name: string, value: string) =>
          boundedAttributes.set(name, value),
      },
    ],
  } as unknown as SVGSVGElement;
  const runtime = createCameraRuntime(
    { x: 0, y: 0, width: 1000, height: 800 },
    committed,
    {
      requestFrame: (callback) => (frames.push(callback), frames.length),
      cancelFrame: vi.fn(),
      scheduleCommit: (callback) => (commits.push(callback), commits.length),
      cancelCommit: vi.fn(),
    },
  );
  runtime.attach(surface);
  return {
    runtime,
    surface,
    frames,
    commits,
    committed,
    attributes,
    boundedAttributes,
    getBoundingClientRect,
  };
}

/** A runtime over a panel that can change shape underneath it. */
function resizableFixture(panel: { width: number; height: number }) {
  const bounded = new Map<string, string>();
  const surface = {
    setAttribute: () => {},
    getBoundingClientRect: () =>
      ({ width: panel.width, height: panel.height }) as DOMRect,
    querySelectorAll: () => [
      {
        setAttribute: (name: string, value: string) => bounded.set(name, value),
      },
    ],
  } as unknown as SVGSVGElement;
  const runtime = createCameraRuntime(
    { x: 0, y: 0, width: 1000, height: 800 },
    vi.fn(),
    {
      requestFrame: () => 1,
      cancelFrame: vi.fn(),
      scheduleCommit: () => 1,
      cancelCommit: vi.fn(),
    },
  );
  return {
    runtime,
    surface,
    bounded,
    resize: (next: { width: number; height: number }) => {
      panel = next;
    },
  };
}

describe("camera runtime", () => {
  it("coalesces hardware events into one animation frame and one settled commit", () => {
    const {
      runtime,
      frames,
      commits,
      committed,
      attributes,
      boundedAttributes,
    } = fixture();

    runtime.schedule((current) => ({ ...current, x: current.x + 10 }), 10);
    runtime.schedule((current) => ({ ...current, x: current.x + 15 }), 10);

    expect(frames).toHaveLength(1);
    expect(committed).not.toHaveBeenCalled();
    frames[0]!(0);
    expect(attributes.get("viewBox")).toBe("25 0 1000 800");
    expect(boundedAttributes.get("x")).toBe("25");
    commits.at(-1)!();
    expect(committed).toHaveBeenCalledTimes(1);
    expect(committed).toHaveBeenLastCalledWith({
      x: 25,
      y: 0,
      width: 1000,
      height: 800,
    });
  });

  it("flushes the latest pointer position before the gesture ends", () => {
    const { runtime, committed, attributes } = fixture();
    runtime.schedule({ x: 31, y: 42, width: 900, height: 700 }, 10);
    runtime.flush();
    expect(attributes.get("viewBox")).toBe("31 42 900 700");
    expect(committed).toHaveBeenCalledOnce();
  });

  it("caches layout bounds until an observed layout change invalidates them", () => {
    const { runtime, surface, getBoundingClientRect } = fixture();
    runtime.measureSurface(surface);
    runtime.measureSurface(surface);
    expect(getBoundingClientRect).toHaveBeenCalledTimes(1);
    runtime.invalidateSurfaceBounds();
    runtime.measureSurface(surface);
    expect(getBoundingClientRect).toHaveBeenCalledTimes(2);
  });

  it("sizes the camera-bound layers to the panel, not to the camera", () => {
    // A panel twice as wide as the camera: `xMidYMid meet` fits the camera's
    // height and shows 2000 units of width, 500 of them either side of what
    // the camera asked for. Sized to the camera, the grid would stop 500 units
    // short at each edge — which is the blank band either side of the dots.
    const { runtime, boundedAttributes, attributes } = fixture({
      width: 2000,
      height: 800,
    });
    runtime.set({ x: 0, y: 0, width: 1000, height: 800 }, 10);
    expect(attributes.get("viewBox")).toBe("0 0 1000 800");
    expect({
      x: boundedAttributes.get("x"),
      y: boundedAttributes.get("y"),
      width: boundedAttributes.get("width"),
      height: boundedAttributes.get("height"),
    }).toEqual({ x: "-500", y: "0", width: "2000", height: "800" });
  });

  it("lays the layers out again once a resize has been reported", () => {
    // The panel is only re-measured when something says it may have moved, so
    // a runtime that is never told keeps drawing to the shape it last saw.
    const { runtime, surface, bounded, resize } = resizableFixture({
      width: 1000,
      height: 800,
    });
    runtime.attach(surface);
    expect(bounded.get("width")).toBe("1000");

    resize({ width: 2000, height: 800 });
    runtime.refreshSurface();
    expect(bounded.get("width")).toBe("1000");
    runtime.invalidateSurfaceBounds();
    runtime.refreshSurface();
    expect(bounded.get("width")).toBe("2000");
    expect(bounded.get("x")).toBe("-500");
  });

  it("does not remember a panel measured before it was laid out", () => {
    // Attaching can happen before the browser has given the surface a size,
    // and a size of nothing is not a shape worth caching: the layers fall back
    // to the camera and the next pass asks again, with no resize to prompt it.
    const { runtime, surface, bounded, resize } = resizableFixture({
      width: 0,
      height: 0,
    });
    runtime.attach(surface);
    expect(bounded.get("width")).toBe("1000");
    resize({ width: 2000, height: 800 });
    runtime.refreshSurface();
    expect(bounded.get("width")).toBe("2000");
  });
});

describe("visibleCameraRect", () => {
  const camera = { x: 100, y: 50, width: 400, height: 200 };

  it("is the camera when the panel is the same shape", () => {
    expect(visibleCameraRect(camera, { width: 800, height: 400 })).toEqual(
      camera,
    );
  });

  it("grows sideways on a panel that is wider than the camera", () => {
    // Twice as wide for the same height: the extra 400 units are split evenly,
    // because the camera is centred.
    expect(visibleCameraRect(camera, { width: 1600, height: 400 })).toEqual({
      x: -100,
      y: 50,
      width: 800,
      height: 200,
    });
  });

  it("grows downwards on a panel that is taller than the camera", () => {
    // Fitted on width, so the camera's 200 units of height become 400 and the
    // extra 200 are split above and below.
    expect(visibleCameraRect(camera, { width: 800, height: 800 })).toEqual({
      x: 100,
      y: -50,
      width: 400,
      height: 400,
    });
  });

  it("falls back to the camera when nothing has been laid out", () => {
    // jsdom, an unmounted surface, a panel collapsed to nothing: there is no
    // shape to letterbox against, so the camera is the honest answer.
    expect(visibleCameraRect(camera, null)).toEqual(camera);
    expect(visibleCameraRect(camera, { width: 0, height: 0 })).toEqual(camera);
    expect(
      visibleCameraRect({ ...camera, width: 0 }, { width: 800, height: 400 }),
    ).toEqual({ ...camera, width: 0 });
  });
});
