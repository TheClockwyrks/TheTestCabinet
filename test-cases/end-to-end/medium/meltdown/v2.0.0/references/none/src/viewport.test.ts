// The fit of the fixed logical stage onto the canvas.
//
// The whole map is a pure function of four numbers (specs/overview.md), so it is
// checked here with no canvas and no browser: the uniform scale that keeps the
// aspect ratio, the letterbox split, the device pixel ratio folded in, and the
// inverse the pointer arrives through.

import { describe, expect, it } from "vitest";
import { STAGE_H, STAGE_W } from "./constants";
import {
  clientToStage,
  deviceSize,
  fitViewport,
  type Surface,
} from "./viewport";

/** The fit of the real stage into a window of `w x h` CSS pixels at `dpr`. */
function fit(w: number, h: number, dpr = 1) {
  return fitViewport(STAGE_W, STAGE_H, w, h, dpr);
}

describe("the scale", () => {
  it("is uniform, so the whole stage is on screen at its own aspect ratio", () => {
    const view = fit(1280, 720);
    expect(view.scale).toBe(1);
    expect(view.offsetX).toBe(0);
    expect(view.offsetY).toBe(0);
  });

  it("takes the tighter of the two dimensions in a wide window", () => {
    const view = fit(1920, 720);
    expect(view.scale).toBe(1);
    // The stage is 1280 wide inside 1920, so 640 is split into two bars.
    expect(view.offsetX).toBe(320);
    expect(view.offsetY).toBe(0);
  });

  it("takes the tighter of the two dimensions in a tall window", () => {
    const view = fit(1280, 1440);
    expect(view.scale).toBe(1);
    expect(view.offsetX).toBe(0);
    expect(view.offsetY).toBe(360);
  });

  it("scales down to fit a window smaller than the stage", () => {
    const view = fit(640, 360);
    expect(view.scale).toBe(0.5);
    expect(view.offsetX).toBe(0);
    expect(view.offsetY).toBe(0);
  });

  it("folds the device pixel ratio into the scale", () => {
    const view = fit(1280, 720, 2);
    expect(view.scale).toBe(2);
    expect(deviceSize(1280, 2)).toBe(2560);
  });

  it("splits the leftover into two equal bars in device pixels", () => {
    const view = fit(1600, 720, 2);
    // 1600 CSS px is 3200 device px; the stage covers 2560 of them.
    expect(view.scale).toBe(2);
    expect(view.offsetX).toBe(320);
    expect(view.offsetX * 2 + STAGE_W * view.scale).toBe(deviceSize(1600, 2));
  });

  it("collapses a degenerate element to a scale of zero rather than a NaN", () => {
    expect(fit(0, 0).scale).toBe(0);
    expect(fit(Number.NaN, 720).scale).toBe(0);
    expect(fit(1280, -5).scale).toBe(0);
  });

  it("treats a nonsense pixel ratio as one", () => {
    expect(fit(1280, 720, 0).scale).toBe(1);
    expect(fit(1280, 720, Number.NaN).scale).toBe(1);
    expect(deviceSize(100, -1)).toBe(100);
  });

  it("reports the logical stage it was asked to fit", () => {
    const view = fit(800, 600);
    expect(view.width).toBe(STAGE_W);
    expect(view.height).toBe(STAGE_H);
  });
});

describe("the inverse", () => {
  const origin = { left: 40, top: 12 };

  it("maps a click at the stage's own origin back to (0, 0)", () => {
    const view = fit(1280, 720);
    expect(clientToStage(view, origin, 1, 40, 12)).toEqual({ x: 0, y: 0 });
  });

  it("undoes the scale, the bars and the pixel ratio together", () => {
    const view = fit(1600, 720, 2);
    const client = {
      x: origin.left + (view.offsetX + 100 * view.scale) / 2,
      y: origin.top + (view.offsetY + 200 * view.scale) / 2,
    };
    const at = clientToStage(view, origin, 2, client.x, client.y);
    expect(at?.x).toBeCloseTo(100, 9);
    expect(at?.y).toBeCloseTo(200, 9);
  });

  it("round-trips every corner of the stage", () => {
    const view = fit(933, 741, 1.5);
    for (const [x, y] of [
      [0, 0],
      [STAGE_W, 0],
      [0, STAGE_H],
      [STAGE_W, STAGE_H],
    ]) {
      const clientX = origin.left + (view.offsetX + x * view.scale) / 1.5;
      const clientY = origin.top + (view.offsetY + y * view.scale) / 1.5;
      const back = clientToStage(view, origin, 1.5, clientX, clientY);
      expect(back?.x).toBeCloseTo(x, 6);
      expect(back?.y).toBeCloseTo(y, 6);
    }
  });

  it("has no logical point to offer while the fit is degenerate", () => {
    expect(clientToStage(fit(0, 0), origin, 1, 10, 10)).toBeNull();
  });
});

describe("the surface seam", () => {
  it("is the only shape the runtime reads a measurement through", () => {
    const events = new EventTarget();
    const surface: Surface = {
      cssWidth: () => 640,
      cssHeight: () => 480,
      dpr: () => 2,
      origin: () => ({ left: 1, top: 2 }),
      events: () => events,
    };
    expect(surface.cssWidth()).toBe(640);
    expect(surface.origin()).toEqual({ left: 1, top: 2 });
    expect(surface.events()).toBe(events);
  });
});
