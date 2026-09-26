// The trail is a slice of TIME, not a number of samples: that is what makes the
// comet stretch with speed and collapse while the ball is held. Every function
// returns a new trail (or a new ball carrying one) and leaves its argument alone.

import { describe, expect, it } from "vitest";
import { TRAIL_TIME } from "./constants";
import { createBalls } from "./entities";
import { pruneTrail, recordTrail, ribbon } from "./trail";
import type { BallState, TrailSample } from "./game";

describe("recordTrail", () => {
  it("appends the ball's position, oldest first", () => {
    const first = recordTrail({ ...createBalls(0)[0], x: 100, y: 200 }, 1);
    const second = recordTrail({ ...first, x: 110 }, 1 + TRAIL_TIME / 2);

    expect(second.trail).toHaveLength(2);
    expect(second.trail[0]).toEqual({ x: 100, y: 200, t: 1 });
    expect(second.trail[1].x).toBe(110);
  });

  it("returns a new ball and leaves the one it was handed alone", () => {
    const before = createBalls(0)[0];
    const after = recordTrail(before, 1);
    expect(before.trail).toHaveLength(0);
    expect(after.trail).toHaveLength(1);
    expect(after).not.toBe(before);
  });

  it("drops samples older than the trail window", () => {
    let ball: BallState = createBalls(0)[0];
    let now = 0;
    for (let i = 0; i < 200; i++) {
      now = i * (1 / 60);
      ball = recordTrail({ ...ball, x: i }, now);
    }
    expect(ball.trail.length).toBeGreaterThan(1);
    for (const sample of ball.trail) {
      expect(now - sample.t).toBeLessThanOrEqual(TRAIL_TIME);
    }
  });

  it("keeps every sample inside the window however fast the frames arrive", () => {
    let ball: BallState = createBalls(0)[0];
    for (let i = 0; i < 1000; i++) {
      ball = recordTrail(ball, i * 0.0001); // 10 kHz: the whole run fits the window
    }
    expect(ball.trail).toHaveLength(1000);
  });

  it("keeps each ball's trail to itself", () => {
    const [one, two] = createBalls(0);
    const recorded = recordTrail(one, 0);
    expect(recorded.trail).toHaveLength(1);
    expect(two.trail).toHaveLength(0);
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
    expect(trail.map((s) => s.x)).toEqual([0, 1, 2]); // and does not mutate
  });

  it("returns the trail it was handed when nothing is outside the window", () => {
    const trail: TrailSample[] = [{ x: 0, y: 0, t: 0 }];
    expect(pruneTrail(trail, TRAIL_TIME / 2)).toBe(trail);
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
