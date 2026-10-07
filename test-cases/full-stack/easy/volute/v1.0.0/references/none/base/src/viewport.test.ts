import { describe, expect, it } from "vitest";
import { FIELD_H, FIELD_W } from "./constants";
import { deviceSize, fitViewport, toLogical } from "./viewport";

describe("the canvas fit", () => {
  it("keeps the aspect ratio and centers the letterbox bars", () => {
    const viewport = fitViewport(FIELD_W, FIELD_H, 1280, 800, 1);
    // 1280/960 = 1.333, 800/540 = 1.481 — width is the binding dimension.
    expect(viewport.scale).toBeCloseTo(1280 / 960, 10);
    expect(viewport.offsetX).toBeCloseTo(0, 10);
    expect(viewport.offsetY).toBeCloseTo((800 - 540 * (1280 / 960)) / 2, 6);
  });

  it("folds the device pixel ratio into the scale", () => {
    const one = fitViewport(FIELD_W, FIELD_H, 960, 540, 1);
    const two = fitViewport(FIELD_W, FIELD_H, 960, 540, 2);
    expect(one.scale).toBe(1);
    expect(two.scale).toBe(2);
    expect(two.offsetX).toBe(0);
    expect(two.offsetY).toBe(0);
  });

  it("collapses to a scale of zero before the page has laid out", () => {
    expect(fitViewport(FIELD_W, FIELD_H, 0, 0, 1).scale).toBe(0);
    expect(
      fitViewport(FIELD_W, FIELD_H, 800, 600, Number.NaN).scale,
    ).toBeGreaterThan(0);
  });

  it("rounds the backing store to whole device pixels", () => {
    expect(deviceSize(100.4, 2)).toBe(201);
    expect(deviceSize(-5, 2)).toBe(0);
  });

  it("maps a pointer back into logical units", () => {
    const viewport = fitViewport(FIELD_W, FIELD_H, 1920, 1080, 1);
    expect(toLogical(viewport, 1, 960, 540)).toEqual({ x: 480, y: 270 });
    expect(toLogical(viewport, 1, 0, 0)).toEqual({ x: 0, y: 0 });
  });

  it("maps no pointer while the fit is degenerate", () => {
    const viewport = fitViewport(FIELD_W, FIELD_H, 0, 0, 1);
    expect(toLogical(viewport, 1, 10, 10)).toBeNull();
  });
});
