import { afterEach, describe, expect, it, vi } from "vitest";
import { STAGE_H, STAGE_W } from "./constants";
import {
  clientToStage,
  deviceSize,
  domSurface,
  fitViewport,
  type Viewport,
} from "./viewport";

/** The fit of the real stage into a window of the given CSS size. */
function fit(cssW: number, cssH: number, dpr = 1): Viewport {
  return fitViewport(STAGE_W, STAGE_H, cssW, cssH, dpr);
}

describe("fitViewport", () => {
  it("fills a window of exactly the stage's aspect ratio", () => {
    const view = fit(1280, 720);
    expect(view.scale).toBe(1);
    expect(view.offsetX).toBe(0);
    expect(view.offsetY).toBe(0);
  });

  it("letterboxes a window that is too tall, splitting the bars evenly", () => {
    const view = fit(1280, 900);
    expect(view.scale).toBe(1);
    expect(view.offsetX).toBe(0);
    expect(view.offsetY).toBe((900 - 720) / 2);
  });

  it("letterboxes a window that is too wide, splitting the bars evenly", () => {
    const view = fit(1600, 720);
    expect(view.scale).toBe(1);
    expect(view.offsetX).toBe((1600 - 1280) / 2);
    expect(view.offsetY).toBe(0);
  });

  it("keeps the whole stage on screen at any size", () => {
    for (const [w, h] of [
      [320, 240],
      [1920, 1080],
      [800, 1400],
      [2560, 1080],
    ]) {
      const view = fit(w, h);
      expect(STAGE_W * view.scale).toBeLessThanOrEqual(w + 1e-9);
      expect(STAGE_H * view.scale).toBeLessThanOrEqual(h + 1e-9);
      expect(view.offsetX).toBeGreaterThanOrEqual(0);
      expect(view.offsetY).toBeGreaterThanOrEqual(0);
    }
  });

  it("folds the device pixel ratio into the scale", () => {
    expect(fit(1280, 720, 2).scale).toBe(2);
    expect(fit(640, 360, 2).scale).toBe(1);
  });

  it("collapses to a zero scale on a canvas the page has not laid out", () => {
    const view = fit(0, 0);
    expect(view.scale).toBe(0);
    expect(view.width).toBe(STAGE_W);
  });

  it("treats a nonsense pixel ratio as 1", () => {
    expect(fit(1280, 720, Number.NaN).scale).toBe(1);
    expect(fit(1280, 720, -3).scale).toBe(1);
  });

  it("leaves the two bars summing to the drawable area", () => {
    const view = fit(1000, 800, 1.5);
    const deviceH = deviceSize(800, 1.5);
    expect(view.offsetY * 2 + STAGE_H * view.scale).toBeCloseTo(deviceH, 9);
  });
});

describe("deviceSize", () => {
  it("rounds to whole device pixels", () => {
    expect(deviceSize(100, 1.5)).toBe(150);
    expect(deviceSize(101, 1.5)).toBe(152);
  });

  it("collapses a nonsense size to zero", () => {
    expect(deviceSize(Number.NaN, 2)).toBe(0);
    expect(deviceSize(-5, 2)).toBe(0);
  });
});

describe("clientToStage", () => {
  const origin = { left: 30, top: 12 };

  it("inverts the fit, so a stage point maps back to itself", () => {
    const view = fit(1600, 720, 2);
    for (const [x, y] of [
      [0, 0],
      [640, 360],
      [1280, 720],
      [388, 144],
    ]) {
      const clientX = origin.left + (view.offsetX + x * view.scale) / 2;
      const clientY = origin.top + (view.offsetY + y * view.scale) / 2;
      const back = clientToStage(view, origin, 2, clientX, clientY);
      expect(back?.x).toBeCloseTo(x, 9);
      expect(back?.y).toBeCloseTo(y, 9);
    }
  });

  it("has no logical point to map to while the fit is degenerate", () => {
    expect(clientToStage(fit(0, 0), origin, 1, 10, 10)).toBeNull();
  });
});

describe("domSurface", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the element's laid-out size, its origin, and the pixel ratio", () => {
    vi.stubGlobal("window", { devicePixelRatio: 2 });
    vi.stubGlobal("document", { tag: "document" });
    const canvas = {
      clientWidth: 800,
      clientHeight: 450,
      getBoundingClientRect: () => ({ left: 12, top: 34 }),
    } as unknown as HTMLCanvasElement;
    const surface = domSurface(canvas);
    expect(surface.cssWidth()).toBe(800);
    expect(surface.cssHeight()).toBe(450);
    expect(surface.dpr()).toBe(2);
    expect(surface.origin()).toEqual({ left: 12, top: 34 });
    expect(surface.events()).toEqual({ tag: "document" });
  });
});
