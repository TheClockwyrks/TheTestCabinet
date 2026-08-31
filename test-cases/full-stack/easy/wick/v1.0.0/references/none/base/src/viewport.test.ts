import { describe, expect, it } from "vitest";
import { STAGE_H, STAGE_W } from "./constants";
import { computeFit, syncCanvas } from "./viewport";

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
