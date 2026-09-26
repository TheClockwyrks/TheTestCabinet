import { describe, expect, it } from "vitest";
import { STAGE_H, STAGE_W } from "./constants";
import { computeFit, toLogical } from "./viewport";

describe("computeFit", () => {
  it("fills a surface of the stage's own aspect ratio exactly", () => {
    const fit = computeFit(STAGE_W, STAGE_H);
    expect(fit.scale).toBe(1);
    expect(fit.offsetX).toBe(0);
    expect(fit.offsetY).toBe(0);
  });

  it("letterboxes evenly on the axis with room to spare", () => {
    const wide = computeFit(1920, 720);
    expect(wide.scale).toBe(1);
    expect(wide.offsetX).toBe(320);
    expect(wide.offsetY).toBe(0);

    const tall = computeFit(1280, 1080);
    expect(tall.scale).toBe(1);
    expect(tall.offsetX).toBe(0);
    expect(tall.offsetY).toBe(180);
  });

  it("keeps the whole stage inside the surface at any size", () => {
    for (const [width, height] of [
      [640, 480],
      [3000, 1000],
      [900, 2000],
      [2560, 1440],
    ]) {
      const fit = computeFit(width, height);
      expect(fit.scale * STAGE_W).toBeLessThanOrEqual(width + 1e-9);
      expect(fit.scale * STAGE_H).toBeLessThanOrEqual(height + 1e-9);
      expect(fit.offsetX).toBeGreaterThanOrEqual(0);
      expect(fit.offsetY).toBeGreaterThanOrEqual(0);
    }
  });

  it("preserves the aspect ratio, scaling both axes by one figure", () => {
    const fit = computeFit(2560, 1440);
    expect(fit.scale).toBeCloseTo(2, 10);
  });
});

describe("toLogical", () => {
  it("inverts the fit, so the stage's own corners map back to themselves", () => {
    const fit = computeFit(1920, 720);
    expect(toLogical(fit, 320, 0, 1)).toEqual({ x: 0, y: 0 });
    expect(toLogical(fit, 320 + STAGE_W, STAGE_H, 1)).toEqual({
      x: STAGE_W,
      y: STAGE_H,
    });
  });

  it("takes the device pixel ratio out of a client position", () => {
    // A 1280x720 window at a ratio of 2: the surface is twice the stage.
    const fit = computeFit(2560, 1440);
    expect(toLogical(fit, 640, 360, 2)).toEqual({ x: 640, y: 360 });
  });

  it("puts a point inside a letterbox bar outside the stage", () => {
    const fit = computeFit(1920, 720);
    expect(toLogical(fit, 10, 360, 1).x).toBeLessThan(0);
  });
});
