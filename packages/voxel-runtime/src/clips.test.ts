import { describe, expect, it } from "vitest";
import type { AutoPlaySpec } from "./contract";
import { sampleClip } from "./clips";

const clip = (over: Partial<AutoPlaySpec> = {}): AutoPlaySpec => ({
  keyframes: [
    { tMs: 0, value: 0 },
    { tMs: 1000, value: 2 },
  ],
  periodMs: 1000,
  looping: true,
  ...over,
});

describe("sampleClip", () => {
  it("returns 0 for an empty clip and the sole value for a single keyframe", () => {
    expect(sampleClip({ keyframes: [], periodMs: 1000, looping: true }, 123)).toBe(0);
    expect(
      sampleClip({ keyframes: [{ tMs: 0, value: 7 }], periodMs: 1000, looping: true }, 123),
    ).toBe(7);
  });

  it("linearly interpolates between surrounding keyframes", () => {
    expect(sampleClip(clip(), 250)).toBeCloseTo(0.5, 6);
    expect(sampleClip(clip(), 500)).toBeCloseTo(1, 6);
    expect(sampleClip(clip(), 750)).toBeCloseTo(1.5, 6);
  });

  it("wraps looping time into the period", () => {
    expect(sampleClip(clip(), 1250)).toBeCloseTo(0.5, 6);
    expect(sampleClip(clip(), -750)).toBeCloseTo(0.5, 6);
  });

  it("holds the last value for a non-looping clip past its end", () => {
    expect(sampleClip(clip({ looping: false }), 5000)).toBe(2);
    expect(sampleClip(clip({ looping: false }), -100)).toBe(0);
  });

  it("interpolates back to the first keyframe over the loop tail", () => {
    // Last keyframe ends at 800ms but the period is 1000ms; at 900ms the value
    // is halfway back from 2 toward 0.
    const c = clip({
      keyframes: [
        { tMs: 0, value: 0 },
        { tMs: 800, value: 2 },
      ],
      periodMs: 1000,
    });
    expect(sampleClip(c, 900)).toBeCloseTo(1, 6);
  });
});
