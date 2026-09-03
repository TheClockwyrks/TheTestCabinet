// The trail is a slice of TIME, not a number of samples: that is what makes the
// comet stretch with speed and collapse while the ball is held. It belongs to the
// BALL (specs/state.md), so a field with no ball has no trail to keep.

import { describe, expect, it } from "vitest";
import { TRAIL_TIME } from "./constants";
import { parkedBall } from "./entities";
import { pruneTrail, recordTrail, ribbon } from "./trail";
import type { BallState, TrailSample } from "./game";

/** A ball at (x, y), motionless, with whatever trail it has been given. */
function at(
  x: number,
  y: number,
  trail: readonly TrailSample[] = [],
): BallState {
  return { ...parkedBall(), x, y, trail };
}

describe("recordTrail", () => {
  it("appends the ball's position, oldest first, into a new ball", () => {
    const first = at(100, 200);
    const once = recordTrail(first, 1);
    const twice = recordTrail({ ...once, x: 110 }, 1 + TRAIL_TIME / 2);

    expect(twice.trail).toHaveLength(2);
    expect(twice.trail[0]).toEqual({ x: 100, y: 200, t: 1 });
    expect(twice.trail[1].x).toBe(110);
    // The ball it was handed is as it was.
    expect(first.trail).toEqual([]);
    expect(once.trail).toHaveLength(1);
  });

  it("leaves every other field of the ball alone", () => {
    const ball = at(100, 200);
    const next = recordTrail(ball, 0.5);
    expect({ ...next, trail: [] }).toEqual({ ...ball, trail: [] });
  });

  it("drops samples older than the trail window", () => {
    let ball = at(0, 360);
    for (let i = 0; i < 200; i++) {
      ball = recordTrail({ ...ball, x: i }, i * (1 / 60));
    }
    const now = 199 * (1 / 60);
    expect(ball.trail.length).toBeGreaterThan(1);
    for (const sample of ball.trail) {
      expect(now - sample.t).toBeLessThanOrEqual(TRAIL_TIME);
    }
  });

  it("caps what it retains however fast the frames arrive", () => {
    let ball = at(0, 360);
    for (let i = 0; i < 1000; i++) {
      // 10 kHz: the whole run fits the window.
      ball = recordTrail(ball, i * 0.0001);
    }
    expect(ball.trail.length).toBeLessThanOrEqual(256);
  });
});

describe("pruneTrail", () => {
  it("keeps only the window, in order, and leaves the trail it was given", () => {
    const trail: readonly TrailSample[] = [
      { x: 0, y: 0, t: 0 },
      { x: 1, y: 0, t: 1 },
      { x: 2, y: 0, t: 1 + TRAIL_TIME },
    ];
    const pruned = pruneTrail(trail, 1 + TRAIL_TIME);
    expect(pruned.map((s) => s.x)).toEqual([1, 2]);
    expect(trail.map((s) => s.x)).toEqual([0, 1, 2]);
  });

  it("returns the same trail when nothing is outside the window", () => {
    const trail: readonly TrailSample[] = [{ x: 0, y: 0, t: 0 }];
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
