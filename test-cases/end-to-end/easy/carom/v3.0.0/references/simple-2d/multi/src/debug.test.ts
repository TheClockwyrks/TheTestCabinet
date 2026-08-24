// The debug surface as pure transitions and readings over `CaromState`
// (specs/instrumentation.md). `src/engine.test.ts` drives it through a real
// engine; what is checked here is the shape of each operation by itself — what it
// sets, what it leaves alone, and that the state it is handed is never written.

import { describe, expect, it } from "vitest";
import {
  BALL_COUNT,
  BALL_HOMES,
  CAROM_DEBUG_VERSION,
  DEFAULT_SEED,
  FIELD_CY,
  HOLD_TIME,
} from "./constants";
import { createDebugApi } from "./debug";
import { createInitialState } from "./flow";
import type { CaromState } from "./game";

const debug = createDebugApi();

/** A state mid-rally, with the player still in control. */
function rally(): CaromState {
  const title = createInitialState();
  return {
    ...title,
    screen: "playing",
    mode: "solo",
    score: { p1: 3, p2: 5 },
    simTime: 12.5,
    muted: true,
    rngState: 99,
    paddles: { left: { cy: 200, vy: 50 }, right: { cy: 500, vy: -50 } },
    balls: title.balls.map((ball, i) => ({
      ...ball,
      x: 100 + i * 300,
      y: 300,
      vx: 400,
      vy: 40,
      spin: 20,
      held: i === 2,
      holdTimer: i === 2 ? 0.4 : 0,
      trail: [{ x: 90 + i * 300, y: 299, t: 12.4 }],
    })),
  };
}

describe("every operation", () => {
  it("returns a new state and leaves the one it was handed as it was", () => {
    const before = rally();
    const frozen = JSON.stringify(before);
    const results = [
      debug.reset(before),
      debug.startMatch(before, "versus"),
      debug.serve(before),
      debug.setScore(before, 1, 2),
      debug.setPaddle(before, "left", { cy: 1, vy: 2 }),
      debug.setBall(before, 0, { x: 1, y: 2, vx: 3, vy: 4, spin: 5 }),
      debug.setAiControl(before, true),
    ];
    debug.snapshot(before);
    expect(JSON.stringify(before)).toBe(frozen);
    for (const result of results) expect(result).not.toBe(before);
  });

  it("reports the surface version as a plain number", () => {
    expect(debug.version).toBe(CAROM_DEBUG_VERSION);
  });
});

describe("reset", () => {
  it("restores every declared field but muted, and reseeds", () => {
    const reset = debug.reset(rally(), { seed: 7 });
    expect(reset).toEqual({
      ...createInitialState(),
      muted: true,
      rngState: 7,
    });
  });

  it("seeds DEFAULT_SEED when no seed is named", () => {
    expect(debug.reset(rally()).rngState).toBe(DEFAULT_SEED);
  });

  it("hands the paddles back", () => {
    const taken = debug.setAiControl(
      debug.setPaddle(rally(), "right", { vy: 300 }),
      true,
    );
    expect(taken.driver).toEqual({
      paddles: true,
      ai: true,
      vy: { left: 0, right: 300 },
    });
    expect(debug.reset(taken).driver).toEqual({
      paddles: false,
      ai: false,
      vy: { left: 0, right: 0 },
    });
  });
});

describe("snapshot", () => {
  it("reads every field straight off the state, with speed derived", () => {
    const state = rally();
    expect(debug.snapshot(state)).toEqual({
      version: CAROM_DEBUG_VERSION,
      screen: "playing",
      mode: "solo",
      score: { p1: 3, p2: 5 },
      winner: null,
      muted: true,
      paddles: { left: { cy: 200, vy: 50 }, right: { cy: 500, vy: -50 } },
      balls: state.balls.map((ball) => ({
        x: ball.x,
        y: ball.y,
        vx: 400,
        vy: 40,
        speed: Math.hypot(400, 40),
        spin: 20,
        held: ball.held,
      })),
      simTime: 12.5,
    });
  });

  it("returns a fresh plain object, sharing nothing with the state", () => {
    const state = rally();
    const snap = debug.snapshot(state);
    expect(snap.score).not.toBe(state.score);
    expect(snap.paddles.left).not.toBe(state.paddles.left);
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
  });
});

describe("startMatch", () => {
  it("poses the opening of a match and takes the paddles", () => {
    const opened = debug.startMatch(rally(), "versus");
    expect(opened.screen).toBe("countdown");
    expect(opened.mode).toBe("versus");
    expect(opened.score).toEqual({ p1: 0, p2: 0 });
    expect(opened.winner).toBeNull();
    expect(opened.paddles).toEqual({
      left: { cy: FIELD_CY, vy: 0 },
      right: { cy: FIELD_CY, vy: 0 },
    });
    opened.balls.forEach((ball, i) => {
      expect(ball).toEqual({
        x: BALL_HOMES[i].x,
        y: BALL_HOMES[i].y,
        vx: 0,
        vy: 0,
        spin: 0,
        held: true,
        holdTimer: HOLD_TIME,
        trail: [],
      });
    });
    expect(opened.driver.paddles).toBe(true);
    // The clock is the runtime's: left as it was.
    expect(opened.simTime).toBe(12.5);
  });
});

describe("serve", () => {
  it("ends every waiting ball's hold and leaves a flying ball alone", () => {
    const served = debug.serve(rally());
    expect(served.balls.map((b) => b.holdTimer)).toEqual([0, 0, 0]);
    expect(served.balls.map((b) => b.held)).toEqual([false, false, true]);
    expect(served.balls[0].vx).toBe(400);
    expect(served.driver.paddles).toBe(true);
  });

  it("does nothing off the live screens, the driver included", () => {
    const title = createInitialState();
    expect(debug.serve(title)).toBe(title);
    const paused: CaromState = { ...rally(), screen: "paused" };
    expect(debug.serve(paused)).toBe(paused);
  });
});

describe("setScore", () => {
  it("sets both scores and takes the paddles", () => {
    const set = debug.setScore(rally(), 10, 9);
    expect(set.score).toEqual({ p1: 10, p2: 9 });
    expect(set.winner).toBeNull();
    expect(set.driver.paddles).toBe(true);
  });
});

describe("setPaddle", () => {
  it("writes cy to the paddle and vy to both the paddle and the driver", () => {
    const set = debug.setPaddle(rally(), "right", { cy: 123, vy: -45 });
    expect(set.paddles.right).toEqual({ cy: 123, vy: -45 });
    expect(set.paddles.left).toEqual({ cy: 200, vy: 50 });
    expect(set.driver).toEqual({
      paddles: true,
      ai: false,
      vy: { left: 0, right: -45 },
    });
  });

  it("leaves whatever the patch omits as it is", () => {
    const set = debug.setPaddle(rally(), "left", { cy: 99 });
    expect(set.paddles.left).toEqual({ cy: 99, vy: 50 });
    expect(set.driver.vy).toEqual({ left: 0, right: 0 });
    const bare = debug.setPaddle(rally(), "left");
    expect(bare.paddles.left).toEqual({ cy: 200, vy: 50 });
    expect(bare.driver.paddles).toBe(true);
  });
});

describe("setBall", () => {
  it("poses the one ball and takes it into live play", () => {
    const set = debug.setBall(rally(), 2, { x: 5, vy: 6, spin: 7 });
    expect(set.balls[2]).toEqual({
      ...rally().balls[2],
      x: 5,
      vy: 6,
      spin: 7,
      held: false,
      holdTimer: 0,
    });
    expect(set.balls[0]).toBe(set.balls[0]);
    expect(set.balls[0]).toEqual(rally().balls[0]);
    expect(set.driver.paddles).toBe(true);
  });

  it("refuses an index this variant does not have, before posing anything", () => {
    const state = rally();
    for (const index of [-1, BALL_COUNT, 1.5, NaN]) {
      expect(() => debug.setBall(state, index, { x: 0 })).toThrow(RangeError);
    }
    expect(state.driver.paddles).toBe(false);
  });
});

describe("setAiControl", () => {
  it("sets driver.ai and takes the paddles", () => {
    const on = debug.setAiControl(rally(), true);
    expect(on.driver).toEqual({
      paddles: true,
      ai: true,
      vy: { left: 0, right: 0 },
    });
    expect(debug.setAiControl(on, false).driver.ai).toBe(false);
  });
});
