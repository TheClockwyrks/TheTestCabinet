// Wireworm — the canvas fit (specs/overview.md).
//
// The whole stage is on screen at every window size and at any pixel density,
// scaled uniformly and centered, and the fit is a pure function of four numbers
// so it is checked without a browser.

import { describe, expect, test } from "vitest";
import { STAGE_H, STAGE_W } from "./constants";
import { deviceSize, fitViewport } from "./viewport";

/** Where a logical point lands on the backing store. */
function project(
  fit: ReturnType<typeof fitViewport>,
  x: number,
  y: number,
): [number, number] {
  return [fit.offsetX + x * fit.scale, fit.offsetY + y * fit.scale];
}

describe("the fit", () => {
  test("the whole stage is inside the canvas at every size tried", () => {
    const sizes: [number, number, number][] = [
      [1280, 720, 1],
      [800, 600, 1],
      [1920, 900, 2],
      [640, 1000, 1.5],
      [3000, 1200, 3],
    ];
    for (const [w, h, dpr] of sizes) {
      const fit = fitViewport(STAGE_W, STAGE_H, w, h, dpr);
      const deviceW = deviceSize(w, dpr);
      const deviceH = deviceSize(h, dpr);
      const [x0, y0] = project(fit, 0, 0);
      const [x1, y1] = project(fit, STAGE_W, STAGE_H);
      expect(x0).toBeGreaterThanOrEqual(-0.5);
      expect(y0).toBeGreaterThanOrEqual(-0.5);
      expect(x1).toBeLessThanOrEqual(deviceW + 0.5);
      expect(y1).toBeLessThanOrEqual(deviceH + 0.5);
      // Centered: the two bars on each axis are equal.
      expect(x0).toBeCloseTo(deviceW - x1, 6);
      expect(y0).toBeCloseTo(deviceH - y1, 6);
    }
  });

  test("the scale is uniform, so the aspect ratio holds", () => {
    const fit = fitViewport(STAGE_W, STAGE_H, 1000, 400, 1);
    const [x0, y0] = project(fit, 0, 0);
    const [x1, y1] = project(fit, STAGE_W, STAGE_H);
    expect((x1 - x0) / (y1 - y0)).toBeCloseTo(STAGE_W / STAGE_H, 6);
  });

  test("a taller window letterboxes top and bottom, a wider one left and right", () => {
    const tall = fitViewport(STAGE_W, STAGE_H, 1280, 1000, 1);
    expect(tall.offsetX).toBeCloseTo(0, 6);
    expect(tall.offsetY).toBeGreaterThan(0);

    const wide = fitViewport(STAGE_W, STAGE_H, 2000, 720, 1);
    expect(wide.offsetY).toBeCloseTo(0, 6);
    expect(wide.offsetX).toBeGreaterThan(0);
  });

  test("the pixel ratio multiplies the scale and nothing else", () => {
    const one = fitViewport(STAGE_W, STAGE_H, 900, 600, 1);
    const two = fitViewport(STAGE_W, STAGE_H, 900, 600, 2);
    expect(two.scale).toBeCloseTo(one.scale * 2, 6);
  });

  test("a degenerate element draws nothing rather than throwing", () => {
    const fit = fitViewport(STAGE_W, STAGE_H, 0, 0, 1);
    expect(fit.scale).toBe(0);
    expect(deviceSize(Number.NaN, Number.NaN)).toBe(0);
    expect(deviceSize(100, 0)).toBe(100);
  });
});
