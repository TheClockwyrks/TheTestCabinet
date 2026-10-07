// The canvas fit: one uniform scale, letterboxed and centred, at the device
// pixel ratio, with the whole stage on screen at every size
// (`specs/overview.md`).

import { describe, expect, it } from "vitest";
import { STAGE_H, STAGE_W } from "./constants";
import {
  measureStageFit,
  onStage,
  sizeCanvas,
  stageFit,
  stagePoint,
  stagePointFromRect,
  type StageFit,
} from "./runtime-stage";

/** The stage's four corners, in logical units. */
const CORNERS = [
  { x: 0, y: 0 },
  { x: STAGE_W, y: 0 },
  { x: 0, y: STAGE_H },
  { x: STAGE_W, y: STAGE_H },
];

/** Where a fit puts a logical point, in the canvas's CSS pixels. */
function toCss(fit: StageFit, point: { x: number; y: number }) {
  return {
    x: fit.offsetX + point.x * fit.scale,
    y: fit.offsetY + point.y * fit.scale,
  };
}

describe("stageFit", () => {
  it("fills a canvas of exactly the stage's aspect ratio", () => {
    const fit = stageFit(1280, 720);
    expect(fit.scale).toBe(1);
    expect(fit.offsetX).toBe(0);
    expect(fit.offsetY).toBe(0);
  });

  it("letterboxes a canvas wider than the stage, centring it", () => {
    const fit = stageFit(1600, 720);
    expect(fit.scale).toBe(1);
    expect(fit.offsetX).toBe(160);
    expect(fit.offsetY).toBe(0);
  });

  it("letterboxes a canvas taller than the stage, centring it", () => {
    const fit = stageFit(1280, 1000);
    expect(fit.scale).toBe(1);
    expect(fit.offsetX).toBe(0);
    expect(fit.offsetY).toBe(140);
  });

  it("scales up as readily as down, preserving the aspect ratio", () => {
    const up = stageFit(2560, 1440);
    expect(up.scale).toBe(2);
    expect(up.offsetX).toBe(0);
    expect(up.offsetY).toBe(0);

    const down = stageFit(640, 360);
    expect(down.scale).toBe(0.5);
  });

  it("keeps the whole stage on screen at a spread of window sizes", () => {
    const sizes = [
      [320, 240],
      [640, 480],
      [1024, 768],
      [1280, 720],
      [1366, 768],
      [1920, 1080],
      [2560, 1080],
      [900, 1600],
      [3840, 2160],
      [1, 1],
    ];
    for (const [w, h] of sizes) {
      const fit = stageFit(w ?? 1, h ?? 1);
      for (const corner of CORNERS) {
        const css = toCss(fit, corner);
        expect(css.x).toBeGreaterThanOrEqual(-1e-9);
        expect(css.y).toBeGreaterThanOrEqual(-1e-9);
        expect(css.x).toBeLessThanOrEqual((w ?? 1) + 1e-9);
        expect(css.y).toBeLessThanOrEqual((h ?? 1) + 1e-9);
      }
      // One axis is filled exactly: the fit is the largest that still fits.
      const filledX = Math.abs(fit.offsetX) < 1e-9;
      const filledY = Math.abs(fit.offsetY) < 1e-9;
      expect(filledX || filledY).toBe(true);
    }
  });

  it("sizes the backing store at the device pixel ratio", () => {
    const fit = stageFit(1600, 720, 2);
    expect(fit.pixelWidth).toBe(3200);
    expect(fit.pixelHeight).toBe(1440);
    expect(fit.dpr).toBe(2);
  });

  it("rounds a fractional pixel ratio to whole device pixels", () => {
    const fit = stageFit(1000, 700, 1.25);
    expect(fit.pixelWidth).toBe(1250);
    expect(fit.pixelHeight).toBe(875);
    expect(Number.isInteger(fit.viewport.x)).toBe(true);
    expect(Number.isInteger(fit.viewport.width)).toBe(true);
  });

  it("reports the stage's rectangle inside the backing store", () => {
    const fit = stageFit(1600, 720, 2);
    expect(fit.viewport).toEqual({ x: 320, y: 0, width: 2560, height: 1440 });
  });

  it("leaves a viewport that is centred inside the backing store", () => {
    for (const [w, h, dpr] of [
      [1600, 720, 1],
      [900, 1600, 2],
      [1366, 768, 1.5],
    ]) {
      const fit = stageFit(w ?? 1, h ?? 1, dpr ?? 1);
      expect(fit.viewport.x * 2 + fit.viewport.width).toBe(fit.pixelWidth);
      expect(fit.viewport.y * 2 + fit.viewport.height).toBe(fit.pixelHeight);
    }
  });

  it("stands in one pixel for a measurement that is missing or absurd", () => {
    for (const size of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
      const fit = stageFit(size, size, size);
      expect(Number.isFinite(fit.scale)).toBe(true);
      expect(fit.scale).toBeGreaterThan(0);
      expect(fit.pixelWidth).toBeGreaterThanOrEqual(1);
      expect(fit.pixelHeight).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("stagePoint", () => {
  it("is the inverse of where the fit draws a logical point", () => {
    const fit = stageFit(1600, 900, 2);
    for (const corner of [...CORNERS, { x: 640, y: 360 }]) {
      const css = toCss(fit, corner);
      const back = stagePoint(fit, css.x, css.y);
      expect(back.x).toBeCloseTo(corner.x, 9);
      expect(back.y).toBeCloseTo(corner.y, 9);
    }
  });

  it("maps the canvas's centre to the stage's centre", () => {
    const fit = stageFit(1600, 720);
    const point = stagePoint(fit, 800, 360);
    expect(point.x).toBeCloseTo(STAGE_W / 2, 9);
    expect(point.y).toBeCloseTo(STAGE_H / 2, 9);
  });

  it("reports a point over a letterbox bar outside the stage, unclamped", () => {
    const fit = stageFit(1600, 720);
    const point = stagePoint(fit, 40, 360);
    expect(point.x).toBeLessThan(0);
    expect(onStage(point)).toBe(false);
    expect(onStage(stagePoint(fit, 800, 360))).toBe(true);
  });
});

describe("stagePointFromRect", () => {
  it("takes the canvas's position on the page off the client point", () => {
    const rect = { left: 100, top: 50, width: 1280, height: 720 };
    const point = stagePointFromRect(rect, 100 + 640, 50 + 360);
    expect(point.x).toBeCloseTo(640, 9);
    expect(point.y).toBeCloseTo(360, 9);
  });

  it("uses the same fit as the canvas, so a scaled canvas still maps", () => {
    const rect = { left: 0, top: 0, width: 2560, height: 1440 };
    const point = stagePointFromRect(rect, 1280, 720);
    expect(point.x).toBeCloseTo(640, 9);
    expect(point.y).toBeCloseTo(360, 9);
  });
});

describe("sizeCanvas", () => {
  const fakeCanvas = () =>
    ({
      width: 300,
      height: 150,
      clientWidth: 0,
      clientHeight: 0,
    }) as unknown as HTMLCanvasElement;

  it("gives the canvas the fit's device-pixel size", () => {
    const canvas = fakeCanvas();
    expect(sizeCanvas(canvas, stageFit(1600, 720, 2))).toBe(true);
    expect(canvas.width).toBe(3200);
    expect(canvas.height).toBe(1440);
  });

  it("writes nothing when the size is already right", () => {
    const canvas = fakeCanvas();
    const fit = stageFit(1280, 720, 1);
    expect(sizeCanvas(canvas, fit)).toBe(true);
    expect(sizeCanvas(canvas, fit)).toBe(false);
  });
});

describe("measureStageFit", () => {
  it("reads the canvas's laid-out size", () => {
    const canvas = {
      clientWidth: 1600,
      clientHeight: 720,
      width: 0,
      height: 0,
    } as unknown as HTMLCanvasElement;
    const fit = measureStageFit(canvas);
    expect(fit.cssWidth).toBe(1600);
    expect(fit.cssHeight).toBe(720);
    expect(fit.scale).toBe(1);
  });
});
