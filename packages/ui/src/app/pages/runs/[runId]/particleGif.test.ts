import { describe, expect, it } from "vitest";
import type { ParticleSystem } from "@test-cabinet/particle-runtime";
import { particleGifPlan } from "./particleGif";

// A minimal emitter carrying just the lifetime the plan reads; the rest is filled
// with inert defaults so the object satisfies the contract.
function emitter(lifetimeMs: number, lifetimeSpread = 0): ParticleSystem["emitters"][number] {
  return {
    name: "e",
    shape: "point",
    position: [0, 0, 0],
    extent: { radius: 0, size: [0, 0, 0] },
    emission: { mode: "rate", rate: 10 },
    lifetimeMs,
    lifetimeSpread,
    speed: 1,
    direction: [0, 1, 0],
  };
}

function system(overrides: Partial<ParticleSystem>): ParticleSystem {
  return {
    dimensions: 3,
    field: { width: 10, height: 10, depth: 10 },
    durationMs: 1000,
    fps: 30,
    loop: true,
    emitters: [emitter(500)],
    ...overrides,
  };
}

// The offscreen render/encode path needs a real WebGL context, so it's exercised in
// the browser; here we lock down the capture-window and frame-timing math, which
// decides how long is sampled and how many frames are held.
describe("particleGifPlan", () => {
  it("captures one period of a loop, primed by a full prewarm", () => {
    const t = particleGifPlan(system({ loop: true, durationMs: 1000 }));
    expect(t.captureMs).toBe(1000);
    // A loop is primed through one full period so the clip opens on steady state.
    expect(t.prewarmMs).toBe(1000);
    // 1000ms at the 24fps target → 24 frames, each ~41.7ms.
    expect(t.frameCount).toBe(24);
    expect(t.stepMs).toBeCloseTo(1000 / 24);
    expect(t.delayMs).toBe(Math.round(1000 / 24));
  });

  it("extends a one-shot past its duration by the longest particle lifetime", () => {
    // No prewarm (capture the ignition); the window runs until the last-born
    // particles have died: duration + (lifetime + spread).
    const t = particleGifPlan(
      system({
        loop: false,
        durationMs: 1000,
        emitters: [emitter(500, 100), emitter(300)],
      }),
    );
    expect(t.prewarmMs).toBe(0);
    expect(t.captureMs).toBe(1000 + 600);
  });

  it("caps the frame count for a long effect but keeps its true duration", () => {
    // A 10s loop would be 240 frames at 24fps; capped to 96, but the total hold time
    // still spans the full window (coarser sampling, not faster playback).
    const t = particleGifPlan(system({ loop: true, durationMs: 10_000 }));
    expect(t.frameCount).toBe(96);
    expect(t.frameCount * t.stepMs).toBeCloseTo(10_000);
    expect(t.delayMs).toBe(Math.round(10_000 / 96));
  });

  it("never produces fewer than two frames", () => {
    expect(particleGifPlan(system({ durationMs: 1 })).frameCount).toBe(2);
  });
});
