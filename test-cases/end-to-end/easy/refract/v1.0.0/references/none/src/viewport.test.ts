// The canvas fit and the pointer map: pure functions of a handful of numbers,
// checked without a browser. The fit is what keeps the whole 1280x720 stage on
// screen at every window size (specs/overview.md), and `clientToStage` is its
// inverse, which is what puts the pointer in the same logical units the game's
// hit tests run in (specs/controls.md).

import { describe, expect, it } from "vitest";
import { STAGE_H, STAGE_W } from "./constants";
import { clientToStage, deviceSize, fitViewport } from "./viewport";

const ORIGIN = { left: 0, top: 0 };

describe("fitViewport", () => {
  it("maps the stage one-to-one when the element matches it exactly", () => {
    const view = fitViewport(STAGE_W, STAGE_H, STAGE_W, STAGE_H, 1);
    expect(view).toEqual({
      width: STAGE_W,
      height: STAGE_H,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    });
  });

  it("letterboxes a taller element above and below, split equally", () => {
    const view = fitViewport(STAGE_W, STAGE_H, 1280, 900, 1);
    expect(view.scale).toBe(1);
    expect(view.offsetX).toBe(0);
    expect(view.offsetY).toBe((900 - 720) / 2);
  });

  it("letterboxes a wider element left and right, split equally", () => {
    const view = fitViewport(STAGE_W, STAGE_H, 1600, 720, 1);
    expect(view.scale).toBe(1);
    expect(view.offsetX).toBe((1600 - 1280) / 2);
    expect(view.offsetY).toBe(0);
  });

  it("scales uniformly, so the aspect ratio holds", () => {
    const view = fitViewport(STAGE_W, STAGE_H, 640, 480, 1);
    expect(view.scale).toBe(0.5);
    expect(view.offsetY).toBe((480 - 360) / 2);
  });

  it("folds the device pixel ratio into the scale and the bars", () => {
    const view = fitViewport(STAGE_W, STAGE_H, 1280, 900, 2);
    expect(view.scale).toBe(2);
    expect(view.offsetY).toBe((900 * 2 - 720 * 2) / 2);
    expect(deviceSize(1280, 2)).toBe(2560);
  });

  it("collapses a degenerate element to scale 0 rather than NaN", () => {
    for (const view of [
      fitViewport(STAGE_W, STAGE_H, 0, 0, 1),
      fitViewport(STAGE_W, STAGE_H, Number.NaN, 720, 1),
      fitViewport(STAGE_W, STAGE_H, 1280, 720, Number.NaN),
    ]) {
      expect(Number.isFinite(view.scale)).toBe(true);
      expect(Number.isFinite(view.offsetX)).toBe(true);
      expect(Number.isFinite(view.offsetY)).toBe(true);
    }
    expect(fitViewport(STAGE_W, STAGE_H, 0, 0, 1).scale).toBe(0);
  });
});

describe("clientToStage", () => {
  it("inverts the fit: a stage point drawn at a device pixel maps back", () => {
    const view = fitViewport(STAGE_W, STAGE_H, 640, 480, 1);
    // At scale 0.5 with a 60px top bar, the stage center draws at (320, 240).
    const at = clientToStage(view, ORIGIN, 1, 320, 240);
    expect(at).toEqual({ x: STAGE_W / 2, y: STAGE_H / 2 });
  });

  it("subtracts the canvas's own client position first", () => {
    const view = fitViewport(STAGE_W, STAGE_H, STAGE_W, STAGE_H, 1);
    const at = clientToStage(view, { left: 10, top: 20 }, 1, 110, 120);
    expect(at).toEqual({ x: 100, y: 100 });
  });

  it("accounts for the device pixel ratio the fit was made at", () => {
    const view = fitViewport(STAGE_W, STAGE_H, 1280, 720, 2);
    const at = clientToStage(view, ORIGIN, 2, 640, 360);
    expect(at).toEqual({ x: 640, y: 360 });
  });

  it("maps a point on the letterbox bar to a stage position off the stage", () => {
    const view = fitViewport(STAGE_W, STAGE_H, 1280, 900, 1);
    const at = clientToStage(view, ORIGIN, 1, 640, 10);
    expect(at?.y).toBeLessThan(0);
  });

  it("returns null while the fit is degenerate", () => {
    const view = fitViewport(STAGE_W, STAGE_H, 0, 0, 1);
    expect(clientToStage(view, ORIGIN, 1, 100, 100)).toBeNull();
  });
});
