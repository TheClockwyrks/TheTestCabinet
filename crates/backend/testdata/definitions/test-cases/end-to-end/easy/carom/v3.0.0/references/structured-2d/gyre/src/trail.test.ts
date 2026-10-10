// The trail is a slice of TIME, not a number of samples: that is what makes
// the comet stretch with speed and collapse while the ball is held.

import { describe, expect, it } from "vitest";
import { TRAIL_TIME } from "./constants";
import { pruneTrail, recordSample, ribbon, type TrailSample } from "./trail";

describe("recordSample", () => {
  it("appends the ball's position, oldest first", () => {
    const first = recordSample([], { x: 100, y: 200, t: 1 });
    const second = recordSample(first, {
      x: 110,
      y: 200,
      t: 1 + TRAIL_TIME / 2,
    });

    expect(second).toHaveLength(2);
    expect(second[0]).toEqual({ x: 100, y: 200, t: 1 });
    expect(second[1].x).toBe(110);
  });

  it("drops samples older than the trail window", () => {
    let trail: readonly TrailSample[] = [];
    let now = 0;
    for (let i = 0; i < 200; i++) {
      now = i * (1 / 60);
      trail = recordSample(trail, { x: i, y: 0, t: now });
    }
    expect(trail.length).toBeGreaterThan(1);
    for (const sample of trail) {
      expect(now - sample.t).toBeLessThanOrEqual(TRAIL_TIME);
    }
  });

  it("caps what it retains however fast the frames arrive", () => {
    let trail: readonly TrailSample[] = [];
    for (let i = 0; i < 1000; i++) {
      // 10 kHz: the whole run fits the window.
      trail = recordSample(trail, { x: 0, y: 0, t: i * 0.0001 });
    }
    expect(trail.length).toBeLessThanOrEqual(256);
  });

  it("leaves the trail it was given alone", () => {
    const before: readonly TrailSample[] = [{ x: 0, y: 0, t: 0 }];
    const after = recordSample(before, { x: 1, y: 0, t: 0.01 });
    expect(before).toHaveLength(1);
    expect(after).toHaveLength(2);
  });
});

describe("pruneTrail", () => {
  it("keeps only the window, and keeps it in order", () => {
    const trail: TrailSample[] = [
      { x: 0, y: 0, t: 0 },
      { x: 1, y: 0, t: 1 },
      { x: 2, y: 0, t: 1 + TRAIL_TIME },
    ];
    const pruned = pruneTrail(trail, 1 + TRAIL_TIME);
    expect(pruned.map((s) => s.x)).toEqual([1, 2]);
    expect(trail).toHaveLength(3); // and does not mutate
  });

  it("returns the trail it was given when nothing is outside the window", () => {
    const trail: TrailSample[] = [{ x: 0, y: 0, t: 0 }];
    expect(pruneTrail(trail, 0)).toBe(trail);
  });
});

describe("ribbon", () => {
  it("reverses the trail so the head is the ball's latest position", () => {
    const trail: TrailSample[] = [
      { x: 0, y: 0, t: 0 },
      { x: 1, y: 0, t: 1 },
    ];
    expect(ribbon(trail).map((s) => s.x)).toEqual([1, 0]);
    expect(trail.map((s) => s.x)).toEqual([0, 1]); // and does not mutate
  });
});
