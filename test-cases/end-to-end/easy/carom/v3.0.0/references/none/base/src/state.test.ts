// The state and its four transitions.
//
// specs/state.md declares every field and gives each one its title-screen value;
// specs/ui.md says what starting a match sets and what returning to the title
// keeps. Both are arithmetic over one record, so they are checked here directly,
// with no runtime and no clock around them.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_SEED,
  FIELD_CX,
  FIELD_CY,
  HOLD_TIME,
  OBSTACLE_CENTERS,
} from "./constants";
import {
  allObstacles,
  clearWorld,
  createBall,
  createInitialState,
  createPaddle,
  isObstacleIndex,
  resetState,
  returnToTitle,
  spawnObstacle,
  startMatch,
} from "./state";

/** A state in the middle of a match, with as much of it disturbed as possible. */
function played(): ReturnType<typeof createInitialState> {
  const state = createInitialState();
  state.screen = "playing";
  state.mode = "versus";
  state.menuIndex = 2;
  state.titleIndex = 1;
  state.resumeScreen = "countdown";
  state.score.p1 = 5;
  state.score.p2 = 3;
  state.winner = "left";
  state.receiver = "right";
  state.paddles.left.cy = 120;
  state.paddles.left.driven = true;
  state.paddles.left.drivenVy = 400;
  state.paddles.right.vy = -200;
  state.ai.tracking = false;
  state.ai.movement = false;
  state.simTime = 12.5;
  state.muted = true;
  state.seed = 99;
  state.rngState = 12345;
  clearWorld(state);
  return state;
}

describe("createInitialState", () => {
  it("opens on the title screen, with the world on the field", () => {
    const state = createInitialState();
    expect(state.screen).toBe("title");
    expect(state.mode).toBe("solo");
    expect(state.menuIndex).toBe(0);
    expect(state.titleIndex).toBe(0);
    expect(state.resumeScreen).toBe("playing");
    expect(state.score).toEqual({ p1: 0, p2: 0 });
    expect(state.winner).toBeNull();
    expect(state.receiver).toBe("left");
    expect(state.ai).toEqual({ tracking: true, movement: true });
    expect(state.simTime).toBe(0);
    expect(state.muted).toBe(false);
    expect(state.seed).toBe(DEFAULT_SEED);
    expect(state.rngState).toBe(DEFAULT_SEED);
    expect(state.paddles.left).toEqual(createPaddle());
    expect(state.paddles.right).toEqual(createPaddle());
    expect(state.ball).toEqual(createBall());
    expect(state.obstacles).toEqual(allObstacles());
  });
});

describe("createBall", () => {
  it("places it at its home point, held, with a full hold and no trail", () => {
    expect(createBall()).toEqual({
      x: FIELD_CX,
      y: FIELD_CY,
      vx: 0,
      vy: 0,
      spin: 0,
      held: true,
      holdTimer: HOLD_TIME,
      trail: [],
    });
  });

  it("hands out a trail of its own, not one shared with every other ball", () => {
    const ball = createBall();
    ball.trail.push({ x: 1, y: 2, t: 3 });
    expect(createBall().trail).toEqual([]);
  });
});

describe("the obstacles", () => {
  it("knows which indices this field has an obstacle for", () => {
    expect(isObstacleIndex(0)).toBe(true);
    expect(isObstacleIndex(OBSTACLE_CENTERS.length)).toBe(false);
    expect(isObstacleIndex(-1)).toBe(false);
    expect(isObstacleIndex(0.5)).toBe(false);
  });

  it("places each at its fixed center, in the order of OBSTACLE_CENTERS", () => {
    const state = createInitialState();
    clearWorld(state);
    spawnObstacle(state, 1);
    spawnObstacle(state, 0);
    expect(state.obstacles).toEqual(allObstacles());
  });

  it("returns one already on the field to its own arrangement", () => {
    const state = createInitialState();
    state.obstacles[0].cy = 10;
    spawnObstacle(state, 0);
    expect(state.obstacles).toEqual(allObstacles());
  });

  it("places nothing for an index this field has no obstacle for", () => {
    const state = createInitialState();
    clearWorld(state);
    spawnObstacle(state, 4);
    expect(state.obstacles).toEqual([]);
  });
});

describe("startMatch", () => {
  it("opens on the countdown, with the match's own fields cleared", () => {
    const state = played();
    startMatch(state, "solo");
    expect(state.screen).toBe("countdown");
    expect(state.mode).toBe("solo");
    expect(state.resumeScreen).toBe("playing");
    expect(state.menuIndex).toBe(0);
    expect(state.score).toEqual({ p1: 0, p2: 0 });
    expect(state.winner).toBeNull();
    expect(state.receiver).toBe("left");
    expect(state.ball).toEqual(createBall());
    expect(state.paddles.left.cy).toBe(FIELD_CY);
    expect(state.paddles.right.vy).toBe(0);
  });

  it("keeps the title's selection, and who is moving each paddle", () => {
    const state = played();
    startMatch(state, "versus");
    expect(state.titleIndex).toBe(1);
    expect(state.paddles.left.driven).toBe(true);
    expect(state.paddles.left.drivenVy).toBe(400);
    expect(state.ai).toEqual({ tracking: false, movement: false });
  });

  it("re-parks a ball already on the field rather than replacing it", () => {
    const state = createInitialState();
    const ball = state.ball;
    startMatch(state, "solo");
    expect(state.ball).toBe(ball);
    expect(state.ball).toEqual(createBall());
  });
});

describe("returnToTitle", () => {
  it("restores the title screen and puts the selection back where it left", () => {
    const state = played();
    returnToTitle(state);
    expect(state.screen).toBe("title");
    expect(state.mode).toBe("solo");
    expect(state.menuIndex).toBe(1); // the item that led away from the title
    expect(state.score).toEqual({ p1: 0, p2: 0 });
    expect(state.winner).toBeNull();
    expect(state.receiver).toBe("left");
    expect(state.paddles.left).toEqual(createPaddle());
    expect(state.ai).toEqual({ tracking: true, movement: true });
    expect(state.ball).toEqual(createBall());
    expect(state.obstacles).toEqual(allObstacles());
  });

  it("keeps the five fields specs/ui.md carries across", () => {
    const state = played();
    returnToTitle(state);
    expect(state.titleIndex).toBe(1);
    expect(state.simTime).toBe(12.5);
    expect(state.muted).toBe(true);
    expect(state.seed).toBe(99);
    expect(state.rngState).toBe(12345);
  });
});

describe("resetState", () => {
  it("goes further: both selections, the clock, and the generator", () => {
    const state = played();
    resetState(state);
    expect(state.menuIndex).toBe(0);
    expect(state.titleIndex).toBe(0);
    expect(state.simTime).toBe(0);
    expect(state.seed).toBe(DEFAULT_SEED);
    expect(state.rngState).toBe(DEFAULT_SEED);
    // Every declared field but the mute bit, which the next check is about.
    expect(state).toEqual({ ...createInitialState(), muted: true });
  });

  it("leaves the mute bit alone: it is the player's, not the screen's", () => {
    const state = played();
    resetState(state);
    expect(state.muted).toBe(true);
  });
});
