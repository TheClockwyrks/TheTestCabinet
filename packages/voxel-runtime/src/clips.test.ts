import { describe, expect, it } from "vitest";
import type { InterpSpec, KeyframeSpec } from "./contract";
import { sampleKeyframes } from "./clips";

const kf = (
  tMs: number,
  value: number,
  interp: InterpSpec = "linear",
  extra: Partial<KeyframeSpec> = {},
): KeyframeSpec => ({ tMs, value, interp, ...extra });

describe("sampleKeyframes (F-curve)", () => {
  it("returns 0 for an empty track and the sole value for a single keyframe", () => {
    expect(sampleKeyframes([], 1000, true, 123)).toBe(0);
    expect(sampleKeyframes([kf(0, 7)], 1000, true, 123)).toBe(7);
  });

  it("linearly interpolates a `linear` segment", () => {
    const frames = [kf(0, 0, "linear"), kf(1000, 2, "linear")];
    expect(sampleKeyframes(frames, 1000, false, 250)).toBeCloseTo(0.5, 6);
    expect(sampleKeyframes(frames, 1000, false, 500)).toBeCloseTo(1, 6);
    expect(sampleKeyframes(frames, 1000, false, 750)).toBeCloseTo(1.5, 6);
  });

  it("holds a `constant` segment until the next key (a step)", () => {
    const frames = [kf(0, 0, "constant"), kf(1000, 2, "linear")];
    expect(sampleKeyframes(frames, 1000, false, 1)).toBe(0);
    expect(sampleKeyframes(frames, 1000, false, 999)).toBe(0);
    expect(sampleKeyframes(frames, 1000, false, 1000)).toBe(2);
  });

  it("holds the endpoints for a non-looping track", () => {
    const frames = [kf(0, 0, "linear"), kf(1000, 2, "linear")];
    expect(sampleKeyframes(frames, 1000, false, -100)).toBe(0);
    expect(sampleKeyframes(frames, 1000, false, 5000)).toBe(2);
  });

  it("wraps looping time into the period and eases the loop tail back to the first key", () => {
    // Last key at 800ms, period 1000ms: the tail runs the wrap segment last→first
    // over [800, 1000] using the last key's `linear` interp; at 1250ms the wrapped
    // time is 250 (into the first segment).
    const frames = [kf(0, 0, "linear"), kf(800, 2, "linear")];
    expect(sampleKeyframes(frames, 1000, true, 250)).toBeCloseTo(0.625, 6); // 2·250/800
    expect(sampleKeyframes(frames, 1000, true, 1250)).toBeCloseTo(0.625, 6); // wraps to 250
    expect(sampleKeyframes(frames, 1000, true, 900)).toBeCloseTo(1, 6); // halfway back to first
  });

  it("ease-in accelerates: it stays below the linear midpoint at the segment midpoint and is monotonic", () => {
    const frames = [kf(0, 0, "ease-in"), kf(1000, 1, "linear")];
    const mid = sampleKeyframes(frames, 1000, false, 500);
    // ease-in starts slow, so at the time midpoint the value has not yet reached the
    // linear halfway point.
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(0.5);
    // Monotonic non-decreasing across the segment.
    let prev = -Infinity;
    for (let t = 0; t <= 1000; t += 50) {
      const v = sampleKeyframes(frames, 1000, false, t);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });

  it("ease-out decelerates: it is above the linear midpoint at the segment midpoint", () => {
    const frames = [kf(0, 0, "ease-out"), kf(1000, 1, "linear")];
    const mid = sampleKeyframes(frames, 1000, false, 500);
    expect(mid).toBeGreaterThan(0.5);
    expect(mid).toBeLessThan(1);
  });

  it("passes through explicit bezier handles and hits both endpoints", () => {
    // A symmetric ease via explicit handles: out-handle a third out at the start
    // value, in-handle a third back at the end value.
    const frames = [
      kf(0, 0, "bezier", { outHandle: [333, 0] }),
      kf(1000, 1, "linear", { inHandle: [-333, 0] }),
    ];
    expect(sampleKeyframes(frames, 1000, false, 0)).toBeCloseTo(0, 6);
    expect(sampleKeyframes(frames, 1000, false, 1000)).toBeCloseTo(1, 6);
    // Symmetric handles → symmetric curve → exactly 0.5 at the midpoint.
    expect(sampleKeyframes(frames, 1000, false, 500)).toBeCloseTo(0.5, 3);
  });
});
