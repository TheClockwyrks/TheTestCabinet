// Spectra — the fit of the fixed stage onto the canvas.

import { describe, expect, it } from "vitest";
import { STAGE_H, STAGE_W } from "./constants";
import { deviceSize, fitViewport } from "./viewport";

describe("fitViewport", () => {
  it("fits the whole stage and centres the leftover as two equal bars", () => {
    const fit = fitViewport(STAGE_W, STAGE_H, 1600, 1000, 1);
    // Width is the tighter axis at 1600x1000, so the scale comes from it.
    expect(fit.scale).toBeCloseTo(1600 / STAGE_W, 6);
    expect(fit.offsetX).toBeCloseTo(0, 6);
    expect(fit.offsetY).toBeCloseTo((1000 - STAGE_H * fit.scale) / 2, 6);
    // The whole stage is inside the surface, with the leftover split in two.
    expect(fit.offsetY).toBeGreaterThanOrEqual(0);
    expect(fit.offsetY * 2 + STAGE_H * fit.scale).toBeCloseTo(1000, 6);
  });

  it("folds the device pixel ratio into the scale", () => {
    const one = fitViewport(STAGE_W, STAGE_H, 1280, 720, 1);
    const two = fitViewport(STAGE_W, STAGE_H, 1280, 720, 2);
    expect(two.scale).toBeCloseTo(one.scale * 2, 6);
    expect(two.offsetX).toBeCloseTo(0, 6);
    expect(two.offsetY).toBeCloseTo(0, 6);
  });

  it("holds the aspect ratio on a very wide and a very tall surface", () => {
    for (const [w, h] of [
      [3000, 500],
      [500, 3000],
    ] as const) {
      const fit = fitViewport(STAGE_W, STAGE_H, w, h, 1);
      expect(STAGE_W * fit.scale).toBeLessThanOrEqual(w + 1e-9);
      expect(STAGE_H * fit.scale).toBeLessThanOrEqual(h + 1e-9);
      expect(fit.offsetX).toBeGreaterThanOrEqual(-1e-9);
      expect(fit.offsetY).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  it("collapses a degenerate surface to a zero scale rather than throwing", () => {
    expect(fitViewport(STAGE_W, STAGE_H, 0, 0, 1).scale).toBe(0);
    expect(
      fitViewport(STAGE_W, STAGE_H, 800, 600, Number.NaN).scale,
    ).toBeGreaterThan(0);
    expect(fitViewport(0, 0, 800, 600, 1).scale).toBe(0);
  });

  it("rounds a backing-store dimension to whole device pixels", () => {
    expect(deviceSize(100.4, 2)).toBe(201);
    expect(deviceSize(-5, 1)).toBe(0);
    expect(deviceSize(100, 0)).toBe(100);
  });
});
