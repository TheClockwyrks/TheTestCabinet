import { describe, expect, it } from "vitest";
import { addFlyer, advanceFlyers, launchNext, updateCascade } from "./cascade";
import {
  BOUNCE_DAMP,
  CARD_W,
  CUES,
  DECK_SIZE,
  FLOOR_Y,
  FOUNDATION_X,
  GRAVITY,
  LAUNCH_INTERVAL,
  LAUNCH_VX_MAX,
  LAUNCH_VX_MIN,
  LAUNCH_VY,
  STAGE_W,
  TOP_ROW_Y,
} from "./constants";
import { put, testState } from "./harness.test-support";
import type { CascadeState } from "./state";
import type { Suit } from "./types";

const SUITS: Suit[] = ["spades", "hearts", "diamonds", "clubs"];

/** A won board with all fifty-two cards on the foundations, ready to launch. */
function wonBoard(): CascadeState {
  const state = testState(5);
  state.screen = "won";
  state.launchClock = LAUNCH_INTERVAL;
  for (let f = 0; f < 4; f += 1) {
    for (let rank = 1; rank <= 13; rank += 1) {
      put(state, "foundation", f, SUITS[f], rank, true);
    }
  }
  return state;
}

/** Run `frames` frames of `seconds / frames` each, as the runtime would. */
function run(state: CascadeState, seconds: number, frames: number): void {
  const step = seconds / frames;
  for (let i = 0; i < frames; i += 1) updateCascade(state, step);
}

describe("a card in flight", () => {
  it("accelerates downward at gravity", () => {
    const state = testState();
    const flyer = addFlyer(state, "spades", 5, 600, 100, 0, 0);
    run(state, 0.5, 30);
    expect(flyer.vy).toBeCloseTo(GRAVITY * 0.5, 4);
  });

  it("advances by its horizontal velocity", () => {
    const state = testState();
    const flyer = addFlyer(state, "spades", 5, 600, 100, 120, 0);
    run(state, 0.5, 30);
    expect(flyer.x).toBeCloseTo(600 + 120 * 0.5, 4);
  });

  it("advances by its post-gravity vertical velocity over one frame", () => {
    const state = testState();
    const flyer = addFlyer(state, "spades", 5, 600, 100, 0, -40);
    const dt = 1 / 120;
    advanceFlyers(state, dt);
    expect(flyer.vy).toBeCloseTo(-40 + GRAVITY * dt, 6);
    expect(flyer.y).toBeCloseTo(100 + flyer.vy * dt, 6);
  });

  it("bounces off the floor, damped, seated, and keeping its drift", () => {
    const state = testState();
    const flyer = addFlyer(state, "spades", 5, 400, FLOOR_Y - 1, 60, 400);
    advanceFlyers(state, 1 / 60);
    expect(flyer.y).toBe(FLOOR_Y);
    expect(flyer.vy).toBeLessThan(0);
    expect(flyer.vx).toBe(60);
  });

  it("keeps 0.80 of its vertical speed through a bounce", () => {
    const state = testState();
    const flyer = addFlyer(state, "spades", 5, 400, FLOOR_Y - 0.5, 0, 500);
    const dt = 1 / 240;
    const incoming = 500 + GRAVITY * dt;
    advanceFlyers(state, dt);
    expect(Math.abs(flyer.vy)).toBeCloseTo(incoming * BOUNCE_DAMP, 4);
  });

  it("peaks lower on each successive bounce", () => {
    const state = testState();
    const flyer = addFlyer(state, "spades", 5, 400, FLOOR_Y, 0, 700);
    const peaks: number[] = [];
    let rising = false;
    let peak = flyer.y;
    for (let i = 0; i < 2000 && peaks.length < 3; i += 1) {
      advanceFlyers(state, 1 / 240);
      if (flyer.vy < 0) {
        rising = true;
        peak = Math.min(peak, flyer.y);
      } else if (rising) {
        peaks.push(peak);
        rising = false;
        peak = flyer.y;
      }
    }
    expect(peaks).toHaveLength(3);
    expect(peaks[1]).toBeGreaterThan(peaks[0]);
    expect(peaks[2]).toBeGreaterThan(peaks[1]);
  });

  it("crosses a side edge rather than turning at it", () => {
    const state = testState();
    const flyer = addFlyer(state, "spades", 5, 40, 100, -300, 0);
    advanceFlyers(state, 1 / 60);
    expect(flyer.vx).toBe(-300);
    expect(flyer.x).toBeLessThan(40);
  });

  it("passes through another flyer", () => {
    const state = testState();
    const left = addFlyer(state, "spades", 5, 400, 300, 200, 0);
    const right = addFlyer(state, "hearts", 5, 500, 300, -200, 0);
    run(state, 1, 60);
    expect(left.vx).toBe(200);
    expect(right.vx).toBe(-200);
  });

  it("retires once its whole footprint has passed an edge, and not before", () => {
    const state = testState();
    addFlyer(state, "spades", 5, -CARD_W + 2, 300, -600, 0);
    expect(state.flyers).toHaveLength(1);
    advanceFlyers(state, 1 / 60);
    expect(state.flyers).toHaveLength(0);

    const right = testState();
    addFlyer(right, "spades", 5, STAGE_W - 2, 300, 10, 0);
    advanceFlyers(right, 1 / 60);
    expect(right.flyers).toHaveLength(1);
    advanceFlyers(right, 1);
    expect(right.flyers).toHaveLength(0);
  });
});

describe("the painted layer", () => {
  it("takes one stamp per card per frame while the gate is on", () => {
    const state = testState();
    addFlyer(state, "spades", 5, 400, 200, 0, 0);
    addFlyer(state, "hearts", 5, 500, 200, 0, 0);
    advanceFlyers(state, 1 / 60);
    expect(state.trailStamps).toBe(2);
  });

  it("takes none while the gate is off, and the card still moves", () => {
    const state = testState();
    state.trailPainting = false;
    const flyer = addFlyer(state, "spades", 5, 400, 200, 100, 0);
    run(state, 1, 60);
    expect(state.trailStamps).toBe(0);
    expect(flyer.x).toBeCloseTo(500, 4);
  });
});

describe("the launch clock", () => {
  it("launches the first card on the cascade's first frame", () => {
    const state = wonBoard();
    updateCascade(state, 1 / 240);
    expect(state.launched).toBe(1);
    const flyer = state.flyers[0];
    expect(flyer.x).toBe(FOUNDATION_X[0]);
    expect(flyer.y).toBe(TOP_ROW_Y);
    expect(flyer.vy).toBe(LAUNCH_VY);
    expect(state.cues.peek()).toContain(CUES.launch);
  });

  it("carries its remainder, so the cadence does not drift", () => {
    const state = wonBoard();
    run(state, 3, 720);
    expect(state.launched).toBe(Math.floor(3 / LAUNCH_INTERVAL) + 1);
  });

  it("cycles the four foundations, taking each one's top card", () => {
    const state = wonBoard();
    const launched: { suit: string; rank: number }[] = [];
    for (let i = 0; i < 8; i += 1) {
      const before = state.flyers.length;
      while (state.flyers.length === before) updateCascade(state, 1 / 240);
      const flyer = state.flyers[state.flyers.length - 1];
      launched.push({ suit: flyer.suit, rank: flyer.rank });
    }
    expect(launched.slice(0, 4).map((c) => c.suit)).toEqual(SUITS);
    expect(launched.slice(4, 8).map((c) => c.suit)).toEqual(SUITS);
    // Each foundation walks its King down to its Ace.
    expect(launched[0].rank).toBe(13);
    expect(launched[4].rank).toBe(12);
  });

  it("draws every horizontal speed inside its range, on both sides", () => {
    // Each launch is inspected as it happens, because a flyer that has already
    // crossed an edge is gone by the time the cascade has run out.
    const fresh = wonBoard();
    fresh.trailPainting = false;
    const signs = new Set<number>();
    for (let i = 0; i < DECK_SIZE; i += 1) {
      const before = fresh.flyers.length;
      while (fresh.flyers.length === before) updateCascade(fresh, 1 / 240);
      const flyer = fresh.flyers[fresh.flyers.length - 1];
      expect(Math.abs(flyer.vx)).toBeGreaterThanOrEqual(LAUNCH_VX_MIN);
      expect(Math.abs(flyer.vx)).toBeLessThanOrEqual(LAUNCH_VX_MAX);
      signs.add(Math.sign(flyer.vx));
    }
    expect(signs).toEqual(new Set([-1, 1]));
  });

  it("stands still while the launching gate is off, and the flight goes on", () => {
    const state = wonBoard();
    state.launching = false;
    const flyer = addFlyer(state, "spades", 5, 400, 100, 100, 0);
    const clock = state.launchClock;
    run(state, 1, 60);
    expect(state.launched).toBe(0);
    expect(state.launchClock).toBe(clock);
    expect(flyer.x).toBeCloseTo(500, 4);
  });

  it("launches nothing once the foundations are empty, and keeps its clock", () => {
    const state = testState();
    state.screen = "won";
    state.launchClock = LAUNCH_INTERVAL;
    run(state, 1, 60);
    expect(state.launched).toBe(0);
    expect(state.launchClock).toBeCloseTo(LAUNCH_INTERVAL + 1, 6);
    expect(launchNext(state)).toBe(false);
  });
});

describe("the end of the cascade", () => {
  it("finishes once every card has launched and none is in flight", () => {
    const state = wonBoard();
    state.trailPainting = false;
    run(state, 30, 3600);
    expect(state.launched).toBe(DECK_SIZE);
    expect(state.flyers).toHaveLength(0);
    expect(state.cascadeDone).toBe(true);
  });

  it("is not flagged by posed flyers retiring on a cleared table", () => {
    const state = testState();
    state.screen = "won";
    state.launching = false;
    addFlyer(state, "spades", 5, 1200, 100, 900, 0);
    run(state, 1, 60);
    expect(state.flyers).toHaveLength(0);
    expect(state.cascadeDone).toBe(false);
  });

  it("replays identically from one seed", () => {
    const one = wonBoard();
    const two = wonBoard();
    one.trailPainting = false;
    two.trailPainting = false;
    run(one, 4, 960);
    run(two, 4, 960);
    expect(one.flyers.map((f) => [f.x, f.y, f.vx, f.vy])).toEqual(
      two.flyers.map((f) => [f.x, f.y, f.vx, f.vy]),
    );
  });
});
