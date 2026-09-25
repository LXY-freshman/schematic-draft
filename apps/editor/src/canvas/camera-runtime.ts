import type { GridRect } from "@icm/model";

import { normalizeCameraRect, type CameraRectInput } from "./fit-view";

export type CameraUpdate =
  GridRect | CameraRectInput | ((current: GridRect) => CameraRectInput);

interface CameraBoundedElement {
  setAttribute(name: string, value: string): void;
}

interface CameraSurface {
  setAttribute(name: string, value: string): void;
  getBoundingClientRect(): DOMRect;
  querySelectorAll(selectors: string): NodeListOf<Element>;
}

export interface CameraRuntimeOptions {
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (handle: number) => void;
  scheduleCommit?: (callback: () => void, delayMs: number) => number;
  cancelCommit?: (handle: number) => void;
  settleDelayMs?: number;
}

export interface CameraRuntime {
  current(): GridRect;
  set(next: CameraUpdate, grid: number): void;
  schedule(next: CameraUpdate, grid: number): void;
  flush(): void;
  attach(surface: SVGSVGElement): void;
  detach(surface: SVGSVGElement): void;
  refreshSurface(): void;
  measureSurface(surface: SVGSVGElement, refresh?: boolean): DOMRect;
  invalidateSurfaceBounds(): void;
  dispose(): void;
}

function cameraString(camera: GridRect): string {
  return `${camera.x} ${camera.y} ${camera.width} ${camera.height}`;
}

/**
 * The part of the drawing the panel actually shows.
 *
 * The canvas `<svg>` fits the camera inside the panel without distorting it —
 * `xMidYMid meet`, stated on the element — so whenever the panel is a
 * different shape from the camera, the drawing runs past the camera on the
 * panel's long axis: the camera is what must be visible, not all that is. A
 * layer drawn to the camera rect then stops short of the panel edge, and that
 * is a blank band the grid does not reach and the pointer cannot draw in. The
 * grid and the input planes are sized to this instead.
 *
 * Without a measured panel there is nothing better to say than the camera,
 * which is what every renderer that never lays anything out reports.
 */
export function visibleCameraRect(
  camera: GridRect,
  panel: { width: number; height: number } | null,
): GridRect {
  if (!panel || panel.width <= 0 || panel.height <= 0) return camera;
  if (camera.width <= 0 || camera.height <= 0) return camera;
  const scale = Math.min(
    panel.width / camera.width,
    panel.height / camera.height,
  );
  if (!Number.isFinite(scale) || scale <= 0) return camera;
  const width = panel.width / scale;
  const height = panel.height / scale;
  return {
    x: camera.x - (width - camera.width) / 2,
    y: camera.y - (height - camera.height) / 2,
    width,
    height,
  };
}

/**
 * Owns the live camera between React commits. High-frequency input overwrites
 * or accumulates one current value, then one animation frame updates the SVG,
 * grid, and input planes. React receives one settled snapshot instead of one
 * root update per hardware event.
 */
export function createCameraRuntime(
  initial: GridRect,
  commit: (camera: GridRect) => void,
  options: CameraRuntimeOptions = {},
): CameraRuntime {
  const requestFrame =
    options.requestFrame ??
    ((callback) => window.requestAnimationFrame(callback));
  const cancelFrame =
    options.cancelFrame ?? ((handle) => window.cancelAnimationFrame(handle));
  const scheduleCommit =
    options.scheduleCommit ??
    ((callback, delayMs) => window.setTimeout(callback, delayMs));
  const cancelCommit =
    options.cancelCommit ?? ((handle) => window.clearTimeout(handle));
  const settleDelayMs = options.settleDelayMs ?? 120;

  let live = initial;
  let surface: CameraSurface | null = null;
  let boundedElements: CameraBoundedElement[] = [];
  let bounds: DOMRect | null = null;
  let frameHandle: number | null = null;
  let commitHandle: number | null = null;
  let dirty = false;

  const apply = (): void => {
    if (!surface) return;
    surface.setAttribute("viewBox", cameraString(live));
    if (boundedElements.length === 0) return;
    // Measured here rather than at every hardware event: the cache survives
    // until something that could have changed the panel says otherwise, so a
    // pan reads it and a resize pays for one layout.
    if (!bounds) {
      const measured = surface.getBoundingClientRect();
      // A surface measured before the browser has laid it out has no size,
      // which is not a panel shape. Leaving it uncached costs one more
      // measurement and keeps the gesture code, which reads the same cache,
      // from mapping the pointer through a rectangle of nothing.
      if (measured.width > 0 && measured.height > 0) bounds = measured;
    }
    const shown = visibleCameraRect(live, bounds);
    for (const element of boundedElements) {
      element.setAttribute("x", String(shown.x));
      element.setAttribute("y", String(shown.y));
      element.setAttribute("width", String(shown.width));
      element.setAttribute("height", String(shown.height));
    }
  };

  const cancelScheduledCommit = (): void => {
    if (commitHandle === null) return;
    cancelCommit(commitHandle);
    commitHandle = null;
  };

  const cancelScheduledFrame = (): void => {
    if (frameHandle === null) return;
    cancelFrame(frameHandle);
    frameHandle = null;
  };

  const flush = (): void => {
    cancelScheduledFrame();
    cancelScheduledCommit();
    if (!dirty) return;
    apply();
    dirty = false;
    commit(live);
  };

  const scheduleFrame = (): void => {
    if (frameHandle !== null) return;
    frameHandle = requestFrame(() => {
      frameHandle = null;
      apply();
    });
  };

  const scheduleSettledCommit = (): void => {
    cancelScheduledCommit();
    commitHandle = scheduleCommit(() => {
      commitHandle = null;
      flush();
    }, settleDelayMs);
  };

  const resolve = (next: CameraUpdate, grid: number): GridRect =>
    normalizeCameraRect(typeof next === "function" ? next(live) : next, grid);

  return {
    current: () => live,
    set(next, grid) {
      cancelScheduledFrame();
      cancelScheduledCommit();
      live = resolve(next, grid);
      dirty = false;
      apply();
      commit(live);
    },
    schedule(next, grid) {
      live = resolve(next, grid);
      dirty = true;
      scheduleFrame();
      scheduleSettledCommit();
    },
    flush,
    attach(nextSurface) {
      surface = nextSurface;
      boundedElements = [
        ...nextSurface.querySelectorAll("[data-camera-bounds]"),
      ];
      bounds = null;
      apply();
    },
    detach(oldSurface) {
      if (surface !== oldSurface) return;
      surface = null;
      boundedElements = [];
      bounds = null;
    },
    refreshSurface() {
      if (!surface) return;
      boundedElements = [...surface.querySelectorAll("[data-camera-bounds]")];
      apply();
    },
    measureSurface(nextSurface, refresh = false) {
      if (surface !== nextSurface) {
        surface = nextSurface;
        boundedElements = [
          ...nextSurface.querySelectorAll("[data-camera-bounds]"),
        ];
        bounds = null;
      }
      if (refresh || !bounds) bounds = nextSurface.getBoundingClientRect();
      return bounds;
    },
    invalidateSurfaceBounds() {
      bounds = null;
    },
    dispose() {
      cancelScheduledFrame();
      cancelScheduledCommit();
      surface = null;
      boundedElements = [];
      bounds = null;
      dirty = false;
    },
  };
}
