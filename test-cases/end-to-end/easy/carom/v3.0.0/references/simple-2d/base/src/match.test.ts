// The screen transitions shared by the menus and the debug surface
// (specs/ui.md): what a match opens with, what returning to the title keeps, and
// how a serve leaves the center.

import { describe, expect, it } from "vitest";
import {
  FIELD_CX,
  FIELD_CY,
  HOLD_TIME,
  SERVE_ANGLE,
  SERVE_SPEED,
} from "./constants";
import { allObstacles, ballSpeed, homeBall } from "./entities";
import type { CaromState } from "./game";
import {
  createInitialState,
  respawn,
  serveBall,
  startMatch,
  toTitle,
} from "./match";

/** A parked ball, whichever sign its serve was drawn. */
function parkedBall(): unknown {
  return { ...homeBall(), serveSign: expect.any(Number) };
}

describe("createInitialState", () => {
  it("is the title screen specs/state.md tabulates", () => {
    const state = createInitialState();
    expect(state.screen).toBe("title");
    expect(state.mode).toBe("solo");
    expect(state.menuIndex).toBe(0);
    expect(state.titleIndex).toBe(0);
    expect(state.resumeScreen).toBe("playing");
    expect(state.score).toEqual({ p1: 0, p2: 0 });
    expect(state.winner).toBeNull();
    expect(state.receiver).toBe("left");
    expect(state.paddles.left).toEqual({
      cy: FIELD_CY,
      vy: 0,
      driven: false,
      drivenVy: 0,
    });
    expect(state.paddles.right).toEqual(state.paddles.left);
    expect(state.ai).toEqual({ tracking: true, movement: true });
    expect(state.ball).toEqual(parkedBall());
    expect(state.obstacles).toEqual(allObstacles());
    expect(state.simTime).toBe(0);
  });
});

describe("startMatch", () => {
  it("opens on the countdown with everything at its opening value", () => {
    const before: CaromState = {
      ...createInitialState(),
      titleIndex: 2,
      menuIndex: 2,
      score: { p1: 5, p2: 0 },
      winner: "left",
      receiver: "right",
      paddles: {
        left: { cy: 100, vy: 300, driven: false, drivenVy: 0 },
        right: { cy: FIELD_CY, vy: 0, driven: true, drivenVy: 90 },
      },
      ball: { ...homeBall(), x: 20, held: false, holdTimer: 0 },
    };

    const state = startMatch(before, "versus");

    expect(state.mode).toBe("versus");
    expect(state.screen).toBe("countdown");
    expect(state.resumeScreen).toBe("playing");
    expect(state.menuIndex).toBe(0);
    expect(state.score).toEqual({ p1: 0, p2: 0 });
    expect(state.winner).toBeNull();
    expect(state.receiver).toBe("left");
    expect(state.ball).toEqual(parkedBall());
    expect(state.ball?.holdTimer).toBe(HOLD_TIME);
    expect(state.paddles.left.cy).toBe(FIELD_CY);
    expect(state.paddles.left.vy).toBe(0);
    expect(state.paddles.right.cy).toBe(FIELD_CY);
    expect(state.paddles.right.vy).toBe(0);
    // The remembered title selection and each side's driven flags are not a
    // match's business, so a match opening leaves both as it found them.
    expect(state.titleIndex).toBe(2);
    expect(state.paddles.right.driven).toBe(true);
    expect(state.paddles.right.drivenVy).toBe(90);
    // The state it was given is untouched.
    expect(before.score).toEqual({ p1: 5, p2: 0 });
    expect(before.ball?.x).toBe(20);
  });
});

describe("toTitle", () => {
  it("restores every declared field but the three that keep their values", () => {
    const state: CaromState = {
      ...startMatch(createInitialState(), "versus"),
      titleIndex: 1,
      menuIndex: 0,
      simTime: 12,
      muted: true,
      ai: { tracking: false, movement: false },
      obstacles: [],
      ball: null,
      paddles: {
        left: { cy: 100, vy: 5, driven: true, drivenVy: 40 },
        right: { cy: 600, vy: -5, driven: true, drivenVy: -40 },
      },
    };

    expect(toTitle(state)).toEqual({
      ...createInitialState(),
      titleIndex: 1,
      // The entry that led away from the title is the one selected on the way
      // back (specs/ui.md).
      menuIndex: 1,
      simTime: 12,
      muted: true,
      ball: expect.objectContaining({ held: true, holdTimer: HOLD_TIME }),
    });
  });
});

describe("respawn", () => {
  it("parks the ball and opens a hold aimed at the receiver", () => {
    const live: CaromState = {
      ...startMatch(createInitialState(), "solo"),
      screen: "playing",
      ball: {
        x: 5,
        y: FIELD_CY,
        vx: -300,
        vy: 0,
        spin: 40,
        held: false,
        holdTimer: 0,
        serveSign: 1,
        trail: [{ x: 5, y: 5, t: 1 }],
      },
    };

    const state = respawn(live, "right");

    expect(state.receiver).toBe("right");
    expect(state.screen).toBe("countdown");
    expect(state.ball).toEqual(parkedBall());
  });
});

describe("serveBall", () => {
  it("launches toward the receiver at SERVE_SPEED and SERVE_ANGLE", () => {
    const held = startMatch(createInitialState(), "versus");
    const served = serveBall(held);
    const ball = served.ball;

    expect(served.screen).toBe("playing");
    expect(ball?.held).toBe(false);
    expect(ball?.holdTimer).toBe(0);
    expect(ball?.trail).toEqual([]);
    expect(ball?.x).toBe(FIELD_CX);
    expect(ball?.vx).toBeLessThan(0); // the first serve travels toward "left"
    expect(ballSpeed(ball ?? { vx: 0, vy: 0 })).toBeCloseTo(SERVE_SPEED, 9);
    expect(
      Math.abs(Math.atan2(ball?.vy ?? 0, Math.abs(ball?.vx ?? 0))),
    ).toBeCloseTo(SERVE_ANGLE, 9);
    // The serve takes the sign the ball holds and leaves it as it is.
    expect(Math.sign(ball?.vy ?? 0)).toBe(held.ball?.serveSign);
    expect(ball?.serveSign).toBe(held.ball?.serveSign);
  });

  it("aims the other way for the other receiver", () => {
    const held = {
      ...startMatch(createInitialState(), "versus"),
      receiver: "right" as const,
    };
    expect(serveBall(held).ball?.vx).toBeGreaterThan(0);
  });

  it("has nothing to serve once the ball has been cleared", () => {
    const empty: CaromState = { ...createInitialState(), ball: null };
    expect(serveBall(empty)).toBe(empty);
  });
});
