import { describe, expect, it } from "vitest";
import { STAGE_CX, STAGE_CY, STAGE_H, STAGE_W } from "./constants";
import {
  clientToStage,
  computeFit,
  cssBox,
  syncCanvas,
  wheelToStage,
  type CssBox,
} from "./viewport";

describe("the stage fit", () => {
  it("letterboxes a wide window top and bottom free", () => {
    const fit = computeFit(2560, 1440);
    expect(fit.scale).toBe(2);
    expect(fit.offsetX).toBe(0);
    expect(fit.offsetY).toBe(0);
    const wide = computeFit(2000, 720);
    expect(wide.scale).toBe(1);
    expect(wide.offsetX).toBe((2000 - STAGE_W) / 2);
    expect(wide.offsetY).toBe(0);
  });

  it("letterboxes a tall window left and right free", () => {
    const tall = computeFit(1280, 1000);
    expect(tall.scale).toBe(1);
    expect(tall.offsetX).toBe(0);
    expect(tall.offsetY).toBe((1000 - STAGE_H) / 2);
    const small = computeFit(640, 720);
    expect(small.scale).toBe(0.5);
    expect(small.offsetY).toBe((720 - 360) / 2);
  });

  it("sizes the backing store by the device pixel ratio", () => {
    const canvas = {
      clientWidth: 1000,
      clientHeight: 500,
      width: 0,
      height: 0,
    } as unknown as HTMLCanvasElement;
    const fit = syncCanvas(canvas, 2);
    expect(canvas.width).toBe(2000);
    expect(canvas.height).toBe(1000);
    expect(fit.scale).toBeCloseTo(1000 / 720);
    const bare = { width: 0, height: 0 } as unknown as HTMLCanvasElement;
    syncCanvas(bare, 1);
    expect(bare.width).toBe(STAGE_W);
    expect(bare.height).toBe(STAGE_H);
  });
});

describe("the pointer through the fit", () => {
  it("puts a client point where the picture is at any density", () => {
    // A 1280 x 720 canvas on a 2x screen: the stage fills it exactly.
    const fit = computeFit(2560, 1440);
    const box: CssBox = { left: 0, top: 0, width: 1280, height: 720 };
    expect(clientToStage(fit, box, 640, 360)).toEqual({
      x: STAGE_CX,
      y: STAGE_CY,
    });
    expect(clientToStage(fit, box, 0, 0)).toEqual({ x: 0, y: 0 });
  });

  it("takes the letterbox bars and the canvas's own offset out", () => {
    const fit = computeFit(2000, 720);
    const box: CssBox = { left: 40, top: 12, width: 2000, height: 720 };
    expect(fit.offsetX).toBe((2000 - STAGE_W) / 2);
    expect(clientToStage(fit, box, 40 + fit.offsetX, 12)).toEqual({
      x: 0,
      y: 0,
    });
    // A point on the left bar falls outside the stage, so it is in no box.
    expect(clientToStage(fit, box, 40, 12).x).toBeLessThan(0);
  });

  it("reads wheel travel in stage units", () => {
    const box: CssBox = { left: 0, top: 0, width: 1280, height: 720 };
    expect(wheelToStage(computeFit(2560, 1440), box, 100)).toBe(100);
    expect(wheelToStage(computeFit(1280, 720), box, 100)).toBe(100);
    const half: CssBox = { left: 0, top: 0, width: 640, height: 360 };
    expect(wheelToStage(computeFit(640, 360), half, 100)).toBe(200);
  });

  it("falls back to the stage's own box before the page lays the canvas out", () => {
    const laid = {
      getBoundingClientRect: () => ({
        left: 8,
        top: 4,
        width: 1000,
        height: 500,
      }),
    } as unknown as HTMLCanvasElement;
    expect(cssBox(laid)).toEqual({ left: 8, top: 4, width: 1000, height: 500 });
    const bare = {} as unknown as HTMLCanvasElement;
    expect(cssBox(bare)).toEqual({
      left: 0,
      top: 0,
      width: STAGE_W,
      height: STAGE_H,
    });
  });
});
