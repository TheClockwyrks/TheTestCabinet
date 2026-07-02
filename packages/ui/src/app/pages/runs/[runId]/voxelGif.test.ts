import { describe, expect, it } from "vitest";
import { voxelGifTiming } from "./voxelGif";

// The offscreen render/encode path needs a real WebGL context, so it's exercised
// in the browser; here we lock down the frame-timing math, which decides how many
// poses are sampled and how long each is held.
describe("voxelGifTiming", () => {
  it("samples ~fps frames across a short loop, held at real time", () => {
    // 1000ms at the 24fps target → 24 frames, each ~41.7ms.
    const t = voxelGifTiming(1000);
    expect(t.frameCount).toBe(24);
    expect(t.stepMs).toBeCloseTo(1000 / 24);
    expect(t.delayMs).toBe(Math.round(1000 / 24));
  });

  it("caps the frame count for a long loop but keeps its true duration", () => {
    // 10s at 24fps would be 240 frames; capped to 96, but the total hold time
    // still spans the full 10s loop (coarser sampling, not faster playback).
    const t = voxelGifTiming(10_000);
    expect(t.frameCount).toBe(96);
    expect(t.frameCount * t.stepMs).toBeCloseTo(10_000);
    expect(t.delayMs).toBe(Math.round(10_000 / 96));
  });

  it("never produces fewer than two frames", () => {
    expect(voxelGifTiming(1).frameCount).toBe(2);
  });
});
