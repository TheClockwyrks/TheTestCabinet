import { describe, expect, it } from "vitest";
import { STAGE_H, STAGE_W } from "./constants";
import { clientToStage, deviceSize, fitViewport } from "./viewport";

describe("the fit", () => {
  it("fills a window of the stage's own shape, with no bars", () => {
    const view = fitViewport(STAGE_W, STAGE_H, STAGE_W, STAGE_H, 1);
    expect(view.scale).toBe(1);
    expect(view.offsetX).toBe(0);
    expect(view.offsetY).toBe(0);
  });

  it("letterboxes a tall window and pillarboxes a wide one, centred", () => {
    const tall = fitViewport(STAGE_W, STAGE_H, 1280, 1000, 1);
    expect(tall.scale).toBe(1);
    expect(tall.offsetX).toBe(0);
    expect(tall.offsetY).toBe((1000 - 720) / 2);

    const wide = fitViewport(STAGE_W, STAGE_H, 1600, 720, 1);
    expect(wide.scale).toBe(1);
    expect(wide.offsetY).toBe(0);
    expect(wide.offsetX).toBe((1600 - 1280) / 2);
  });

  it("keeps the whole stage inside whatever the window's shape", () => {
    for (const [w, h] of [
      [640, 480],
      [1920, 1080],
      [900, 1600],
      [2560, 900],
    ]) {
      for (const dpr of [1, 2]) {
        const view = fitViewport(STAGE_W, STAGE_H, w, h, dpr);
        expect(view.offsetX).toBeGreaterThanOrEqual(-0.51);
        expect(view.offsetY).toBeGreaterThanOrEqual(-0.51);
        expect(view.offsetX * 2 + STAGE_W * view.scale).toBeCloseTo(
          deviceSize(w, dpr),
          6,
        );
        expect(view.offsetY * 2 + STAGE_H * view.scale).toBeCloseTo(
          deviceSize(h, dpr),
          6,
        );
      }
    }
  });

  it("folds the pixel ratio into the scale", () => {
    const view = fitViewport(STAGE_W, STAGE_H, STAGE_W, STAGE_H, 2);
    expect(view.scale).toBe(2);
  });

  it("collapses a degenerate window to a zero scale", () => {
    expect(fitViewport(STAGE_W, STAGE_H, 0, 0, 1).scale).toBe(0);
    expect(fitViewport(STAGE_W, STAGE_H, 100, 100, Number.NaN).scale).toBe(
      100 / STAGE_W,
    );
  });
});

describe("the map back into stage units", () => {
  it("inverts the fit, so a corner maps to a corner", () => {
    const view = fitViewport(STAGE_W, STAGE_H, 640, 720, 1);
    const origin = { left: 0, top: 0 };
    expect(clientToStage(view, origin, 1, view.offsetX, view.offsetY)).toEqual({
      x: 0,
      y: 0,
    });
    const far = clientToStage(
      view,
      origin,
      1,
      640 - view.offsetX,
      (640 / 1280) * 720 + view.offsetY,
    );
    expect(far?.x).toBeCloseTo(STAGE_W, 6);
  });

  it("accounts for the canvas's own position on the page", () => {
    const view = fitViewport(STAGE_W, STAGE_H, STAGE_W, STAGE_H, 1);
    const at = clientToStage(view, { left: 40, top: 20 }, 1, 140, 120);
    expect(at).toEqual({ x: 100, y: 100 });
  });

  it("has no answer while the fit is degenerate", () => {
    const view = fitViewport(STAGE_W, STAGE_H, 0, 0, 1);
    expect(clientToStage(view, { left: 0, top: 0 }, 1, 5, 5)).toBeNull();
  });
});
