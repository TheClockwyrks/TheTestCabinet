import { describe, expect, it } from "vitest";

import { STAGE_H, STAGE_W } from "./constants";
import { deviceSize, domSurface, fitViewport } from "./viewport";

describe("fitViewport", () => {
  it("fills an element of exactly the stage's aspect ratio", () => {
    const view = fitViewport(STAGE_W, STAGE_H, 1280, 720, 1);
    expect(view.scale).toBe(1);
    expect(view.offsetX).toBe(0);
    expect(view.offsetY).toBe(0);
  });

  it("letterboxes an element taller than the stage, splitting the bars", () => {
    const view = fitViewport(STAGE_W, STAGE_H, 1280, 1000, 1);
    expect(view.scale).toBe(1);
    expect(view.offsetX).toBe(0);
    expect(view.offsetY).toBe((1000 - 720) / 2);
  });

  it("pillarboxes an element wider than the stage, splitting the bars", () => {
    const view = fitViewport(STAGE_W, STAGE_H, 1600, 720, 1);
    expect(view.scale).toBe(1);
    expect(view.offsetX).toBe((1600 - 1280) / 2);
    expect(view.offsetY).toBe(0);
  });

  it("keeps the whole stage visible at any size, never cropping it", () => {
    for (const [w, h] of [
      [400, 900],
      [1920, 1080],
      [640, 360],
      [2000, 500],
    ]) {
      const view = fitViewport(STAGE_W, STAGE_H, w, h, 1);
      expect(STAGE_W * view.scale).toBeLessThanOrEqual(w + 1e-9);
      expect(STAGE_H * view.scale).toBeLessThanOrEqual(h + 1e-9);
      expect(view.offsetX).toBeGreaterThanOrEqual(0);
      expect(view.offsetY).toBeGreaterThanOrEqual(0);
    }
  });

  it("folds the device pixel ratio into the scale", () => {
    const view = fitViewport(STAGE_W, STAGE_H, 640, 360, 2);
    expect(view.scale).toBe(1);
    expect(view.offsetX).toBe(0);
  });

  it("collapses to a scale of zero on an element the page has not laid out", () => {
    const view = fitViewport(STAGE_W, STAGE_H, 0, 0, 1);
    expect(view.scale).toBe(0);
  });

  it("treats a nonsense pixel ratio as one", () => {
    for (const dpr of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(fitViewport(STAGE_W, STAGE_H, 1280, 720, dpr).scale).toBe(1);
    }
  });
});

describe("deviceSize", () => {
  it("rounds a CSS dimension to whole device pixels", () => {
    expect(deviceSize(100, 2)).toBe(200);
    expect(deviceSize(100.4, 1)).toBe(100);
    expect(deviceSize(100, 1.5)).toBe(150);
  });

  it("reads a nonsense dimension as zero", () => {
    expect(deviceSize(Number.NaN, 1)).toBe(0);
    expect(deviceSize(-5, 1)).toBe(0);
  });
});

describe("domSurface", () => {
  it("reads the element's laid-out size and the window's pixel ratio", () => {
    const original = globalThis.window;
    globalThis.window = { devicePixelRatio: 3 } as unknown as Window &
      typeof globalThis;
    const events = new EventTarget();
    globalThis.document = events as unknown as Document;
    const surface = domSurface({
      clientWidth: 800,
      clientHeight: 450,
    } as HTMLCanvasElement);
    expect(surface.cssWidth()).toBe(800);
    expect(surface.cssHeight()).toBe(450);
    expect(surface.dpr()).toBe(3);
    expect(surface.events()).toBe(events);
    globalThis.window = original;
  });
});
