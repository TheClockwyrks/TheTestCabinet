// The screen transitions shared by the menus and the debug surface
// (specs/ui.md): what a match opens with, and what returning to the title keeps.

import { describe, expect, it } from "vitest";
import { FIELD_CX, FIELD_CY, HOLD_TIME } from "./constants";
import type { CaromState } from "./game";
import { createInitialState, respawn, startMatch, toTitle } from "./match";

describe("startMatch", () => {
  it("opens on the countdown with everything at its opening value", () => {
    const before: CaromState = {
      ...createInitialState(),
      score: { p1: 5, p2: 0 },
      winner: "left",
      paddles: {
        left: { cy: 100, vy: 0 },
        right: { cy: FIELD_CY, vy: 0 },
      },
      ball: { ...createInitialState().ball, x: 20 },
      trail: [{ x: 20, y: 20, t: 1 }],
    };

    const state = startMatch(before, "versus");

    expect(state.mode).toBe("versus");
    expect(state.screen).toBe("countdown");
    expect(state.resumeScreen).toBe("playing");
    expect(state.menuIndex).toBe(0);
    expect(state.score).toEqual({ p1: 0, p2: 0 });
    expect(state.winner).toBeNull();
    expect(state.receiver).toBe("left");
    expect(state.holdTimer).toBe(HOLD_TIME);
    expect(state.paddles.left).toEqual({ cy: FIELD_CY, vy: 0 });
    expect(state.paddles.right).toEqual({ cy: FIELD_CY, vy: 0 });
    expect(state.ball).toEqual({
      x: FIELD_CX,
      y: FIELD_CY,
      vx: 0,
      vy: 0,
      spin: 0,
    });
    expect(state.trail).toHaveLength(0);
    // The state it was given is untouched.
    expect(before.score).toEqual({ p1: 5, p2: 0 });
    expect(before.trail).toHaveLength(1);
  });
});

describe("toTitle", () => {
  it("restores every declared field except the clock, mute, seed and driver", () => {
    const state: CaromState = {
      ...startMatch(createInitialState(), "versus"),
      simTime: 12,
      muted: true,
      rngState: 99,
      driver: { paddles: true, ai: false, vy: { left: 5, right: 0 } },
    };

    expect(toTitle(state)).toEqual({
      ...createInitialState(),
      simTime: 12,
      muted: true,
      rngState: 99,
      driver: { paddles: true, ai: false, vy: { left: 5, right: 0 } },
    });
  });
});

describe("respawn", () => {
  it("parks the ball and opens a hold aimed at the receiver", () => {
    const live: CaromState = {
      ...startMatch(createInitialState(), "solo"),
      screen: "playing",
      ball: { x: 5, y: FIELD_CY, vx: -300, vy: 0, spin: 40 },
      holdTimer: 0,
      trail: [{ x: 5, y: 5, t: 1 }],
    };

    const state = respawn(live, "right");

    expect(state.receiver).toBe("right");
    expect(state.screen).toBe("countdown");
    expect(state.holdTimer).toBe(HOLD_TIME);
    expect(state.ball).toEqual({
      x: FIELD_CX,
      y: FIELD_CY,
      vx: 0,
      vy: 0,
      spin: 0,
    });
    expect(state.trail).toHaveLength(0);
  });
});
