import { describe, expect, it } from "vitest";

import { STAGE_H, STAGE_W } from "./constants";
import { deviceSize, domSurface, fitViewport } from "./viewport";

/** The fit of the real stage into an element of the given CSS size. */
function fit(w: number, h: number, dpr = 1): ReturnType<typeof fitViewport> {
  return fitViewport(STAGE_W, STAGE_H, w, h, dpr);
}

describe("fitting the stage onto the canvas", () => {
  it("scales uniformly, so the whole stage is on screen at 16:9", () => {
    const viewport = fit(1280, 720);
    expect(viewport.scale).toBe(1);
    expect(viewport.offsetX).toBe(0);
    expect(viewport.offsetY).toBe(0);
  });

  it("letterboxes a window wider than the stage, splitting the bars evenly", () => {
    const viewport = fit(1600, 720);
    expect(viewport.scale).toBe(1);
    expect(viewport.offsetX).toBe(160);
    expect(viewport.offsetY).toBe(0);
    // The two bars sum to the leftover, so nothing is cut off at either edge.
    expect(viewport.offsetX * 2 + STAGE_W * viewport.scale).toBe(1600);
  });

  it("letterboxes a window taller than the stage", () => {
    const viewport = fit(1280, 900);
    expect(viewport.scale).toBe(1);
    expect(viewport.offsetY).toBe(90);
    expect(viewport.offsetY * 2 + STAGE_H * viewport.scale).toBe(900);
  });

  it("shrinks the stage to a small window without cropping it", () => {
    const viewport = fit(640, 480);
    expect(viewport.scale).toBeCloseTo(0.5, 10);
    expect(STAGE_W * viewport.scale).toBeLessThanOrEqual(640);
    expect(STAGE_H * viewport.scale).toBeLessThanOrEqual(480);
  });

  it("folds the device pixel ratio into the scale", () => {
    expect(fit(1280, 720, 2).scale).toBe(2);
    expect(fit(1280, 720, 3).scale).toBe(3);
    // The stage still fills the same fraction of the element.
    const dense = fit(1600, 720, 2);
    expect(dense.offsetX * 2 + STAGE_W * dense.scale).toBe(3200);
  });

  it("collapses a degenerate element to a scale of zero and recovers", () => {
    expect(fit(0, 0).scale).toBe(0);
    expect(fit(Number.NaN, 720).scale).toBe(0);
    expect(fit(1280, 720, Number.NaN).scale).toBe(1);
    expect(fit(1280, 720, -2).scale).toBe(1);
  });

  it("sizes the backing store in whole device pixels", () => {
    expect(deviceSize(100, 2)).toBe(200);
    expect(deviceSize(100.4, 1)).toBe(100);
    expect(deviceSize(100, 1.5)).toBe(150);
    expect(deviceSize(-5, 1)).toBe(0);
  });

  it("reads size, density and the event target off the element it is given", () => {
    const events = { addEventListener: () => undefined } as unknown as Document;
    const canvas = {
      clientWidth: 800,
      clientHeight: 600,
    } as unknown as HTMLCanvasElement;
    const globals = globalThis as unknown as Record<string, unknown>;
    const previousWindow = globals.window;
    const previousDocument = globals.document;
    globals.window = { devicePixelRatio: 2 };
    globals.document = events;
    try {
      const surface = domSurface(canvas);
      expect(surface.cssWidth()).toBe(800);
      expect(surface.cssHeight()).toBe(600);
      expect(surface.dpr()).toBe(2);
      expect(surface.events()).toBe(events);
    } finally {
      globals.window = previousWindow;
      globals.document = previousDocument;
    }
  });
});
