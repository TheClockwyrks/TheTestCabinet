// The screen transitions shared by the menus and the debug surface
// (specs/ui.md): what a match opens with, and what returning to the title keeps.

import { describe, expect, it } from "vitest";
import { FIELD_CX, FIELD_CY, HOLD_TIME } from "./constants";
import { createInitialState, respawn, startMatch, toTitle } from "./match";

describe("startMatch", () => {
  it("opens on the countdown with everything at its opening value", () => {
    const state = createInitialState();
    state.score.p1 = 5;
    state.winner = "left";
    state.paddles.left.cy = 100;
    state.ball.x = 20;
    state.trail.push({ x: 20, y: 20, t: 1 });

    startMatch(state, "versus");

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
  });
});

describe("toTitle", () => {
  it("restores every declared field except the clock, mute, seed and driver", () => {
    const state = createInitialState();
    startMatch(state, "versus");
    state.simTime = 12;
    state.muted = true;
    state.rngState = 99;
    state.driver.paddles = true;
    state.driver.vy.left = 5;

    toTitle(state);

    const expected = createInitialState();
    expected.simTime = 12;
    expected.muted = true;
    expected.rngState = 99;
    expected.driver.paddles = true;
    expected.driver.vy.left = 5;
    expect(state).toEqual(expected);
  });
});

describe("respawn", () => {
  it("parks the ball and opens a hold aimed at the receiver", () => {
    const state = createInitialState();
    startMatch(state, "solo");
    state.screen = "playing";
    state.ball.x = 5;
    state.ball.vx = -300;
    state.ball.spin = 40;
    state.holdTimer = 0;
    state.trail.push({ x: 5, y: 5, t: 1 });

    respawn(state, "right");

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
