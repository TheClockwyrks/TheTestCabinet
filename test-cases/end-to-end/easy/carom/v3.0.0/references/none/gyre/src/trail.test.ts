// The trail is a slice of TIME, not a number of samples: that is what makes the
// comet stretch with speed and collapse while the ball is held.

import { describe, expect, it } from "vitest";
import { TRAIL_TIME } from "./constants";
import { createInitialState } from "./game";
import { pruneTrail, recordTrail, ribbon } from "./trail";
import type { TrailSample } from "./game";

describe("recordTrail", () => {
  it("appends the ball's position, oldest first", () => {
    const state = createInitialState();
    state.ball.x = 100;
    state.ball.y = 200;
    state.simTime = 1;
    recordTrail(state);
    state.ball.x = 110;
    state.simTime = 1 + TRAIL_TIME / 2;
    recordTrail(state);

    expect(state.trail).toHaveLength(2);
    expect(state.trail[0]).toEqual({ x: 100, y: 200, t: 1 });
    expect(state.trail[1].x).toBe(110);
  });

  it("drops samples older than the trail window", () => {
    const state = createInitialState();
    for (let i = 0; i < 200; i++) {
      state.simTime = i * (1 / 60);
      state.ball.x = i;
      recordTrail(state);
    }
    expect(state.trail.length).toBeGreaterThan(1);
    for (const sample of state.trail) {
      expect(state.simTime - sample.t).toBeLessThanOrEqual(TRAIL_TIME);
    }
  });

  it("caps what it retains however fast the frames arrive", () => {
    const state = createInitialState();
    for (let i = 0; i < 1000; i++) {
      state.simTime = i * 0.0001; // 10 kHz: the whole run fits the window
      recordTrail(state);
    }
    expect(state.trail.length).toBeLessThanOrEqual(256);
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
