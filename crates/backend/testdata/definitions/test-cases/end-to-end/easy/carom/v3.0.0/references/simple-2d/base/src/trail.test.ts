// The trail is a slice of TIME, not a number of samples: that is what makes the
// comet stretch with speed and collapse while the ball is held. It belongs to the
// ball, so it is emptied when a ball is spawned and written by the game alone
// (specs/state.md).

import { describe, expect, it } from "vitest";
import { TRAIL_TIME } from "./constants";
import { homeBall } from "./entities";
import { pruneTrail, recordTrail, ribbon } from "./trail";
import type { BallState, TrailSample } from "./game";

/** The ball moved, as a frame would leave it just before recording. */
function at(ball: BallState, patch: { x?: number; y?: number }): BallState {
  return { ...ball, x: patch.x ?? ball.x, y: patch.y ?? ball.y };
}

describe("recordTrail", () => {
  it("appends the ball's position, oldest first", () => {
    const first = recordTrail(at(homeBall(), { x: 100, y: 200 }), 1);
    const second = recordTrail(at(first, { x: 110 }), 1 + TRAIL_TIME / 2);

    expect(second.trail).toHaveLength(2);
    expect(second.trail[0]).toEqual({ x: 100, y: 200, t: 1 });
    expect(second.trail[1].x).toBe(110);
  });

  it("drops samples older than the trail window", () => {
    let ball = homeBall();
    let now = 0;
    for (let i = 0; i < 200; i++) {
      now = i * (1 / 60);
      ball = recordTrail(at(ball, { x: i }), now);
    }
    expect(ball.trail.length).toBeGreaterThan(1);
    for (const sample of ball.trail) {
      expect(now - sample.t).toBeLessThanOrEqual(TRAIL_TIME);
    }
  });

  it("caps what it retains however fast the frames arrive", () => {
    let ball = homeBall();
    for (let i = 0; i < 1000; i++) {
      // 10 kHz: the whole run fits the window.
      ball = recordTrail(ball, i * 0.0001);
    }
    expect(ball.trail.length).toBeLessThanOrEqual(256);
  });

  it("leaves the ball and the trail it was given alone", () => {
    const before = at(homeBall(), { x: 100 });
    const after = recordTrail(before, 1);
    expect(before.trail).toHaveLength(0);
    expect(after.trail).toHaveLength(1);
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
