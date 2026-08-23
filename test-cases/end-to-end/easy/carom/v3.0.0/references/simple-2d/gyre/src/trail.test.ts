// The trail is a slice of TIME, not a number of samples: that is what makes the
// comet stretch with speed and collapse while the ball is held.

import { describe, expect, it } from "vitest";
import { TRAIL_TIME } from "./constants";
import { createInitialState, type CaromState } from "./game";
import { pruneTrail, recordTrail, ribbon } from "./trail";
import type { TrailSample } from "./game";

/** The initial state with the ball at (x, y) and the clock at `simTime`. */
function at(x: number, y: number, simTime: number): CaromState {
  const state = createInitialState();
  return { ...state, ball: { ...state.ball, x, y }, simTime };
}

describe("recordTrail", () => {
  it("appends the ball's position, oldest first, into a new state", () => {
    const first = at(100, 200, 1);
    const once = recordTrail(first);
    const twice = recordTrail({
      ...once,
      ball: { ...once.ball, x: 110 },
      simTime: 1 + TRAIL_TIME / 2,
    });

    expect(twice.trail).toHaveLength(2);
    expect(twice.trail[0]).toEqual({ x: 100, y: 200, t: 1 });
    expect(twice.trail[1].x).toBe(110);
    // The states it was handed are as they were.
    expect(first.trail).toEqual([]);
    expect(once.trail).toHaveLength(1);
  });

  it("drops samples older than the trail window", () => {
    let state = createInitialState();
    for (let i = 0; i < 200; i++) {
      state = recordTrail({
        ...state,
        simTime: i * (1 / 60),
        ball: { ...state.ball, x: i },
      });
    }
    expect(state.trail.length).toBeGreaterThan(1);
    for (const sample of state.trail) {
      expect(state.simTime - sample.t).toBeLessThanOrEqual(TRAIL_TIME);
    }
  });

  it("caps what it retains however fast the frames arrive", () => {
    let state = createInitialState();
    for (let i = 0; i < 1000; i++) {
      // 10 kHz: the whole run fits the window.
      state = recordTrail({ ...state, simTime: i * 0.0001 });
    }
    expect(state.trail.length).toBeLessThanOrEqual(256);
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
