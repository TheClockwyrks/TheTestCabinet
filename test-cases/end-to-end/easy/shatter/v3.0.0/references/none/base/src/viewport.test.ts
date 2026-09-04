import { describe, expect, it } from "vitest";

import { FIELD_H, FIELD_W } from "./constants";
import { deviceSize, fitViewport } from "./viewport";

describe("fitting the field onto the canvas", () => {
  it("shows the whole field, letterboxed, in a taller window", () => {
    const view = fitViewport(FIELD_W, FIELD_H, 1280, 900, 1);
    expect(view.scale).toBeCloseTo(1, 10);
    expect(view.offsetX).toBeCloseTo(0, 10);
    expect(view.offsetY).toBeCloseTo((900 - 720) / 2, 10);
    expect(view.offsetY * 2 + FIELD_H * view.scale).toBeCloseTo(900, 6);
  });

  it("shows the whole field, pillarboxed, in a wider window", () => {
    const view = fitViewport(FIELD_W, FIELD_H, 1600, 720, 1);
    expect(view.scale).toBeCloseTo(1, 10);
    expect(view.offsetX).toBeCloseTo((1600 - 1280) / 2, 10);
    expect(view.offsetY).toBeCloseTo(0, 10);
  });

  it("holds the aspect ratio at every size", () => {
    for (const [w, h] of [
      [640, 480],
      [1920, 1080],
      [800, 1400],
      [2560, 1080],
    ]) {
      const view = fitViewport(FIELD_W, FIELD_H, w, h, 1);
      expect(FIELD_W * view.scale).toBeLessThanOrEqual(w + 1e-9);
      expect(FIELD_H * view.scale).toBeLessThanOrEqual(h + 1e-9);
      expect(view.offsetX).toBeGreaterThanOrEqual(-1e-9);
      expect(view.offsetY).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  it("folds the device pixel ratio into the scale", () => {
    const one = fitViewport(FIELD_W, FIELD_H, 1280, 720, 1);
    const two = fitViewport(FIELD_W, FIELD_H, 1280, 720, 2);
    expect(two.scale).toBeCloseTo(one.scale * 2, 10);
  });

  it("collapses a degenerate element rather than dividing by nothing", () => {
    const view = fitViewport(FIELD_W, FIELD_H, 0, 0, 1);
    expect(view.scale).toBe(0);
    expect(Number.isFinite(view.offsetX)).toBe(true);
  });

  it("treats an impossible pixel ratio as one", () => {
    expect(deviceSize(100, Number.NaN)).toBe(100);
    expect(deviceSize(100, -3)).toBe(100);
  });

  it("rounds the backing store to whole device pixels", () => {
    expect(deviceSize(100.4, 1.5)).toBe(151);
  });
});
