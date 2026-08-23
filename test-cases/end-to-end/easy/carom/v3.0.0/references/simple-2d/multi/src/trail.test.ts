// The trail is a slice of TIME, not a number of samples: that is what makes the
// comet stretch with speed and collapse while the ball is held.

import { describe, expect, it } from "vitest";
import { TRAIL_TIME } from "./constants";
import { createBalls } from "./entities";
import { pruneTrail, recordTrail, ribbon } from "./trail";
import type { TrailSample } from "./game";

describe("recordTrail", () => {
  it("appends the ball's position, oldest first", () => {
    const ball = createBalls()[0];
    ball.x = 100;
    ball.y = 200;
    recordTrail(ball, 1);
    ball.x = 110;
    recordTrail(ball, 1 + TRAIL_TIME / 2);

    expect(ball.trail).toHaveLength(2);
    expect(ball.trail[0]).toEqual({ x: 100, y: 200, t: 1 });
    expect(ball.trail[1].x).toBe(110);
  });

  it("drops samples older than the trail window", () => {
    const ball = createBalls()[0];
    let now = 0;
    for (let i = 0; i < 200; i++) {
      now = i * (1 / 60);
      ball.x = i;
      recordTrail(ball, now);
    }
    expect(ball.trail.length).toBeGreaterThan(1);
    for (const sample of ball.trail) {
      expect(now - sample.t).toBeLessThanOrEqual(TRAIL_TIME);
    }
  });

  it("keeps every sample inside the window however fast the frames arrive", () => {
    const ball = createBalls()[0];
    for (let i = 0; i < 1000; i++) {
      recordTrail(ball, i * 0.0001); // 10 kHz: the whole run fits the window
    }
    expect(ball.trail).toHaveLength(1000);
  });

  it("keeps each ball's trail to itself", () => {
    const [one, two] = createBalls();
    recordTrail(one, 0);
    expect(one.trail).toHaveLength(1);
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
    pruneTrail(trail, 1 + TRAIL_TIME);
    expect(trail.map((s) => s.x)).toEqual([1, 2]);
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
