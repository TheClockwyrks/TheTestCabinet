// The canvas fit: a pure function of four numbers, checked without a browser.

import { describe, expect, it } from "vitest";
import { STAGE_H, STAGE_W } from "./constants";
import { deviceSize, domSurface, fitViewport, toLogical } from "./viewport";

describe("fitViewport", () => {
  it("fills an element of the stage's own ratio, with no bars", () => {
    const view = fitViewport(STAGE_W, STAGE_H, 1280, 720, 1);
    expect(view.scale).toBe(1);
    expect(view.offsetX).toBe(0);
    expect(view.offsetY).toBe(0);
  });

  it("letterboxes a taller element, centering the stage", () => {
    const view = fitViewport(STAGE_W, STAGE_H, 1280, 900, 1);
    expect(view.scale).toBe(1);
    expect(view.offsetX).toBe(0);
    expect(view.offsetY).toBe(90);
  });

  it("pillarboxes a wider element, centering the stage", () => {
    const view = fitViewport(STAGE_W, STAGE_H, 1600, 720, 1);
    expect(view.scale).toBe(1);
    expect(view.offsetX).toBe(160);
    expect(view.offsetY).toBe(0);
  });

  it("keeps the whole stage visible at any size", () => {
    for (const [w, h] of [
      [320, 240],
      [800, 600],
      [2560, 1080],
      [1024, 3000],
    ]) {
      const view = fitViewport(STAGE_W, STAGE_H, w, h, 1);
      expect(STAGE_W * view.scale).toBeLessThanOrEqual(w + 1e-9);
      expect(STAGE_H * view.scale).toBeLessThanOrEqual(h + 1e-9);
    }
  });

  it("folds the device pixel ratio into the scale", () => {
    const view = fitViewport(STAGE_W, STAGE_H, 1280, 720, 2);
    expect(view.scale).toBe(2);
    expect(deviceSize(1280, 2)).toBe(2560);
  });

  it("collapses a zero-sized element rather than dividing by nothing", () => {
    const view = fitViewport(STAGE_W, STAGE_H, 0, 0, 1);
    expect(view.scale).toBe(0);
    expect(Number.isFinite(view.offsetX)).toBe(true);
  });

  it("treats a nonsense pixel ratio as one", () => {
    expect(fitViewport(STAGE_W, STAGE_H, 1280, 720, Number.NaN).scale).toBe(1);
    expect(fitViewport(STAGE_W, STAGE_H, 1280, 720, -3).scale).toBe(1);
  });
});

describe("toLogical", () => {
  it("inverts the fit exactly", () => {
    const view = fitViewport(STAGE_W, STAGE_H, 1600, 900, 2);
    for (const [x, y] of [
      [0, 0],
      [640, 360],
      [1280, 720],
    ]) {
      const cssX = (view.offsetX + x * view.scale) / 2;
      const cssY = (view.offsetY + y * view.scale) / 2;
      const point = toLogical(view, 2, cssX, cssY);
      expect(point?.x).toBeCloseTo(x, 9);
      expect(point?.y).toBeCloseTo(y, 9);
    }
  });

  it("has no inverse for a degenerate fit", () => {
    expect(
      toLogical(fitViewport(STAGE_W, STAGE_H, 0, 0, 1), 1, 10, 10),
    ).toBeNull();
  });

  it("puts a point on a letterbox bar outside the stage", () => {
    const view = fitViewport(STAGE_W, STAGE_H, 1280, 900, 1);
    const point = toLogical(view, 1, 10, 10);
    expect(point?.y).toBeLessThan(0);
  });
});

describe("domSurface", () => {
  it("reads the element's own size, position and the window's pixel ratio", () => {
    const canvas = {
      clientWidth: 800,
      clientHeight: 600,
      getBoundingClientRect: () => ({ left: 12, top: 34 }),
    } as unknown as HTMLCanvasElement;
    const missing: string[] = [];
    for (const [name, value] of [
      ["window", { devicePixelRatio: 3 }],
      ["document", {}],
    ] as const) {
      if (name in globalThis) continue;
      missing.push(name);
      Object.defineProperty(globalThis, name, { value, configurable: true });
    }
    const surface = domSurface(canvas);
    expect(surface.cssWidth()).toBe(800);
    expect(surface.cssHeight()).toBe(600);
    expect(surface.origin()).toEqual({ x: 12, y: 34 });
    expect(surface.dpr()).toBe(3);
    expect(surface.events()).toBeDefined();
    for (const name of missing) Reflect.deleteProperty(globalThis, name);
  });
});
