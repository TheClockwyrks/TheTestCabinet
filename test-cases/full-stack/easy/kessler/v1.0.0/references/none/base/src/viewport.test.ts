// The letterbox fit: uniform scale, centered bars, DPR-aware backing store.

import { describe, expect, it } from "vitest";
import { computeFit, syncCanvas } from "./viewport";

describe("computeFit", () => {
  it("fills the short side of a wide surface and centers the bars", () => {
    const fit = computeFit(2000, 1000);
    expect(fit.scale).toBe(1);
    expect(fit.offsetX).toBe(500);
    expect(fit.offsetY).toBe(0);
  });

  it("fills the short side of a tall surface", () => {
    const fit = computeFit(500, 800);
    expect(fit.scale).toBe(0.5);
    expect(fit.offsetX).toBe(0);
    expect(fit.offsetY).toBe(150);
  });

  it("scales uniformly, preserving the square aspect", () => {
    const fit = computeFit(1234, 777);
    expect(fit.scale).toBe(777 / 1000);
  });
});

describe("syncCanvas", () => {
  interface FakeCanvas {
    clientWidth: number;
    clientHeight: number;
    width: number;
    height: number;
  }

  it("sizes the backing store to the element at the DPR", () => {
    const canvas: FakeCanvas = {
      clientWidth: 800,
      clientHeight: 600,
      width: 0,
      height: 0,
    };
    const fit = syncCanvas(canvas as unknown as HTMLCanvasElement, 2);
    expect(canvas.width).toBe(1600);
    expect(canvas.height).toBe(1200);
    expect(fit.scale).toBe(1.2);
  });

  it("falls back to the stage size for an unlaid-out element", () => {
    const canvas: FakeCanvas = {
      clientWidth: 0,
      clientHeight: 0,
      width: 0,
      height: 0,
    };
    const fit = syncCanvas(canvas as unknown as HTMLCanvasElement, 1);
    expect(canvas.width).toBe(1000);
    expect(fit.scale).toBe(1);
  });
});
