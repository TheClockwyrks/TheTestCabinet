// The trail is a slice of TIME, not a number of samples: that is what makes the
// comet stretch with speed and collapse while the ball is held.

import { describe, expect, it } from "vitest";
import { TRAIL_TIME } from "./constants";
import { createBall } from "./state";
import { pruneTrail, recordTrail, ribbon } from "./trail";
import type { TrailSample } from "./state";

describe("recordTrail", () => {
  it("appends the ball's position, oldest first", () => {
    const ball = createBall();
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
    const ball = createBall();
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

  it("caps what it retains however fast the frames arrive", () => {
    const ball = createBall();
    // 10 kHz: the whole run fits inside the window.
    for (let i = 0; i < 1000; i++) recordTrail(ball, i * 0.0001);
    expect(ball.trail.length).toBeLessThanOrEqual(256);
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
