// Fitting the fixed stage onto the canvas.
//
// The fit is a pure function of four numbers, so every property the
// specification asks of it — the whole stage visible, one uniform scale, the
// leftover split into two equal bars, the pixel ratio folded in — is checked
// here without a browser.

import { describe, expect, it } from "vitest";
import { STAGE_H, STAGE_W } from "./constants";
import { deviceSize, fitViewport } from "./viewport";

/** The fit of Floe's own stage into an element of this size and density. */
function fit(cssWidth: number, cssHeight: number, dpr = 1) {
  return fitViewport(STAGE_W, STAGE_H, cssWidth, cssHeight, dpr);
}

describe("the backing-store size", () => {
  it("is the laid-out size in whole device pixels", () => {
    expect(deviceSize(500, 1)).toBe(500);
    expect(deviceSize(500, 2)).toBe(1000);
    expect(deviceSize(500.4, 1)).toBe(500);
    expect(deviceSize(333, 1.5)).toBe(500);
  });

  it("collapses a size or a ratio it cannot use", () => {
    expect(deviceSize(Number.NaN, 1)).toBe(0);
    expect(deviceSize(-10, 1)).toBe(0);
    expect(deviceSize(100, 0)).toBe(100);
    expect(deviceSize(100, Number.POSITIVE_INFINITY)).toBe(100);
  });
});

describe("the fit", () => {
  it("keeps the whole stage on screen at its own aspect ratio", () => {
    for (const [w, h] of [
      [1280, 720],
      [1920, 1080],
      [640, 480],
      [1000, 700],
      [400, 1000],
    ] as const) {
      const view = fit(w, h);
      expect(STAGE_W * view.scale).toBeLessThanOrEqual(w + 1e-9);
      expect(STAGE_H * view.scale).toBeLessThanOrEqual(h + 1e-9);
      // One of the two dimensions is filled exactly, so nothing is left over on
      // both axes at once.
      const spare = Math.min(
        w - STAGE_W * view.scale,
        h - STAGE_H * view.scale,
      );
      expect(spare).toBeLessThan(1e-6);
    }
  });

  it("scales uniformly, so a square on the stage stays square", () => {
    const view = fit(1000, 700);
    expect(view.scale).toBeCloseTo(1000 / STAGE_W, 12);
  });

  it("centres the leftover in two equal bars", () => {
    const wide = fit(1600, 720);
    expect(wide.offsetY).toBeCloseTo(0, 9);
    expect(wide.offsetX).toBeCloseTo((1600 - STAGE_W * wide.scale) / 2, 9);
    expect(wide.offsetX).toBeGreaterThan(0);

    const tall = fit(1280, 1000);
    expect(tall.offsetX).toBeCloseTo(0, 9);
    expect(tall.offsetY).toBeCloseTo((1000 - STAGE_H * tall.scale) / 2, 9);
    expect(tall.offsetY).toBeGreaterThan(0);
  });

  it("folds the pixel ratio into the scale, leaving the fit the same shape", () => {
    const one = fit(640, 480, 1);
    const two = fit(640, 480, 2);
    expect(two.scale).toBeCloseTo(one.scale * 2, 12);
    expect(two.offsetX).toBeCloseTo(one.offsetX * 2, 9);
    expect(two.offsetY).toBeCloseTo(one.offsetY * 2, 9);
  });

  it("reports the stage it was asked to fit", () => {
    const view = fit(800, 600);
    expect([view.width, view.height]).toEqual([STAGE_W, STAGE_H]);
  });

  it("draws nothing rather than dividing by nothing on a zero-sized element", () => {
    const view = fit(0, 0);
    expect(view.scale).toBe(0);
    expect(Number.isFinite(view.offsetX)).toBe(true);
    expect(Number.isFinite(view.offsetY)).toBe(true);
  });

  it("treats an unusable ratio as one", () => {
    expect(fit(640, 480, Number.NaN).scale).toBeCloseTo(
      fit(640, 480, 1).scale,
      12,
    );
    expect(fit(640, 480, -2).scale).toBeCloseTo(fit(640, 480, 1).scale, 12);
  });
});
