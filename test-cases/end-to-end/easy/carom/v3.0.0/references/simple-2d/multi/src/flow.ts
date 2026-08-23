// Carom — the poses a match moves between: the title screen, the opening of a
// match, and the parked balls (specs/ui.md, "Starting a match").
//
// The menus (`src/game.ts`) and the debug surface (`src/debug.ts`) both start
// matches and both return to the title, and they must leave the game in the one
// same pose each time, so the arithmetic lives here and each of them calls it.
// This module holds no state: every function writes the `CaromState` it is
// handed.

import { DEFAULT_SEED, FIELD_CY, HOLD_TIME } from "./constants";
import { createBalls, parkBall } from "./entities";
import type { CaromState, Mode } from "./game";

/** Put both paddles at the vertical center, stationary. */
function centerPaddles(state: CaromState): void {
  state.paddles.left.cy = FIELD_CY;
  state.paddles.left.vy = 0;
  state.paddles.right.cy = FIELD_CY;
  state.paddles.right.vy = 0;
}

/**
 * Put every ball back on its own home point with the same wait ahead of it.
 *
 * A `hold` of 0 is the title screen's pose: parked, and no part of a live match.
 */
function parkBalls(state: CaromState, hold: number): void {
  for (let i = 0; i < state.balls.length; i++)
    parkBall(state.balls[i], i, hold);
}

/**
 * The complete initial state: the title screen, with every field present.
 *
 * Exported so this build's own tests can construct a state without standing an
 * engine up around it. `toTitle` restores the same values, so quitting to the
 * menu and resetting from the debug surface reach the same title screen.
 */
export function createInitialState(): CaromState {
  return {
    screen: "title",
    mode: "solo",
    menuIndex: 0,
    resumeScreen: "playing",
    score: { p1: 0, p2: 0 },
    winner: null,
    paddles: {
      left: { cy: FIELD_CY, vy: 0 },
      right: { cy: FIELD_CY, vy: 0 },
    },
    balls: createBalls(),
    simTime: 0,
    muted: false,
    rngState: DEFAULT_SEED,
    driver: { paddles: false, ai: false, vy: { left: 0, right: 0 } },
  };
}

/**
 * Return to the title screen: every declared field takes its title value except
 * `simTime`, `muted`, `rngState`, and `driver`, which keep theirs (specs/ui.md).
 */
export function toTitle(state: CaromState): void {
  state.screen = "title";
  state.mode = "solo";
  state.menuIndex = 0;
  state.resumeScreen = "playing";
  state.score.p1 = 0;
  state.score.p2 = 0;
  state.winner = null;
  centerPaddles(state);
  parkBalls(state, 0);
}

/**
 * Start a match. All three balls take their home points with a full hold, so the
 * match opens on the countdown screen and they launch together (specs/balls.md).
 */
export function startMatch(state: CaromState, mode: Mode): void {
  state.mode = mode;
  state.screen = "countdown";
  state.resumeScreen = "playing";
  state.menuIndex = 0;
  state.score.p1 = 0;
  state.score.p2 = 0;
  state.winner = null;
  centerPaddles(state);
  parkBalls(state, HOLD_TIME);
}
