import { describe, expect, it } from "vitest";

import { STAGE_H, STAGE_W } from "./constants";
import {
  clientToStage,
  computeFit,
  deviceSize,
  syncCanvas,
  type Surface,
} from "./viewport";

function surfaceOf(
  width: number,
  height: number,
  dpr: number,
  left = 0,
  top = 0,
): Surface {
  return {
    cssWidth: () => width,
    cssHeight: () => height,
    dpr: () => dpr,
    origin: () => ({ left, top }),
  };
}

describe("fitting the stage onto the canvas (specs/overview.md)", () => {
  it("fills a window of the stage's own aspect ratio with no bars", () => {
    const fit = computeFit(STAGE_W, STAGE_H, 1);
    expect(fit.scale).toBe(1);
    expect(fit.offsetX).toBe(0);
    expect(fit.offsetY).toBe(0);
  });

  it("letterboxes a taller window, centering the stage", () => {
    const fit = computeFit(1280, 900, 1);
    expect(fit.scale).toBe(1);
    expect(fit.offsetX).toBe(0);
    expect(fit.offsetY).toBe(90);
  });

  it("pillarboxes a wider window, centering the stage", () => {
    const fit = computeFit(1600, 720, 1);
    expect(fit.scale).toBe(1);
    expect(fit.offsetX).toBe(160);
    expect(fit.offsetY).toBe(0);
  });

  it("folds the device pixel ratio into the scale", () => {
    const fit = computeFit(640, 360, 2);
    expect(fit.scale).toBe(1);
    expect(fit.width).toBe(1280);
    expect(fit.height).toBe(720);
  });

  it("keeps the whole stage on screen at every window size", () => {
    for (const [w, h] of [
      [320, 200],
      [1920, 1080],
      [800, 1200],
      [2560, 900],
    ]) {
      const fit = computeFit(w, h, 1);
      expect(STAGE_W * fit.scale).toBeLessThanOrEqual(fit.width + 1e-9);
      expect(STAGE_H * fit.scale).toBeLessThanOrEqual(fit.height + 1e-9);
      expect(fit.offsetX).toBeGreaterThanOrEqual(-1e-9);
      expect(fit.offsetY).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  it("collapses a zero-sized element to a scale of zero", () => {
    expect(computeFit(0, 0, 1).scale).toBe(0);
    expect(computeFit(Number.NaN, 720, 1).scale).toBe(0);
    expect(deviceSize(100, Number.NaN)).toBe(100);
  });

  it("sizes the backing store only when the size changed", () => {
    const canvas = { width: 0, height: 0 };
    syncCanvas(canvas, surfaceOf(1280, 720, 2));
    expect(canvas).toEqual({ width: 2560, height: 1440 });
    canvas.width = 2560;
    syncCanvas(canvas, surfaceOf(1280, 720, 2));
    expect(canvas.width).toBe(2560);
  });
});

describe("mapping a client position into stage units", () => {
  it("inverts the fit, so a hit test needs no conversion", () => {
    const fit = computeFit(1600, 720, 2);
    const at = clientToStage(fit, { left: 0, top: 0 }, 2, 160 + 640, 360);
    expect(at?.x).toBeCloseTo(640, 6);
    expect(at?.y).toBeCloseTo(360, 6);
  });

  it("accounts for the canvas's own client position", () => {
    const fit = computeFit(1280, 720, 1);
    const at = clientToStage(fit, { left: 40, top: 12 }, 1, 40, 12);
    expect(at).toEqual({ x: 0, y: 0 });
  });

  it("maps nothing while the fit is degenerate", () => {
    expect(
      clientToStage(computeFit(0, 0, 1), { left: 0, top: 0 }, 1, 5, 5),
    ).toBeNull();
  });
});
