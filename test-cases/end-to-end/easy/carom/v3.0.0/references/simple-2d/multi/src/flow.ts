// Carom — the poses a match moves between: the title screen, the opening of a
// match, and the parked balls (specs/ui.md, "Starting a match").
//
// The menus (`src/game.ts`) and the debug surface (`src/debug.ts`) both start
// matches and both return to the title, and they must leave the game in the one
// same pose each time, so the arithmetic lives here and each of them calls it.
// This module holds no state: every function takes the current `CaromState` and
// returns the next, leaving the one it was handed as it was.

import { DEFAULT_SEED, FIELD_CY, HOLD_TIME } from "./constants";
import { createBalls, parkBall } from "./entities";
import type { BallState, CaromState, Mode, PaddleState } from "./game";
import type { DeepReadonly } from "ts-essentials";

/** Both paddles at the vertical center, stationary. */
function centeredPaddles(): { left: PaddleState; right: PaddleState } {
  return {
    left: { cy: FIELD_CY, vy: 0 },
    right: { cy: FIELD_CY, vy: 0 },
  };
}

/**
 * Every ball back on its own home point with the same wait ahead of it.
 *
 * A `hold` of 0 is the title screen's pose: parked, and no part of a live match.
 */
function parkedBalls(balls: readonly BallState[], hold: number): BallState[] {
  return balls.map((_ball, index) => parkBall(index, hold));
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
    paddles: centeredPaddles(),
    balls: createBalls(),
    simTime: 0,
    muted: false,
    rngState: DEFAULT_SEED,
    driver: { paddles: false, ai: false, vy: { left: 0, right: 0 } },
  };
}

/**
 * The title screen: every declared field takes its title value except
 * `simTime`, `muted`, `rngState`, and `driver`, which keep theirs (specs/ui.md).
 */
export function toTitle(state: DeepReadonly<CaromState>): CaromState {
  return {
    ...state,
    screen: "title",
    mode: "solo",
    menuIndex: 0,
    resumeScreen: "playing",
    score: { p1: 0, p2: 0 },
    winner: null,
    paddles: centeredPaddles(),
    balls: parkedBalls(state.balls, 0),
  };
}

/**
 * The opening of a match. All three balls take their home points with a full
 * hold, so the match opens on the countdown screen and they launch together
 * (specs/balls.md).
 */
export function startMatch(
  state: DeepReadonly<CaromState>,
  mode: Mode,
): CaromState {
  return {
    ...state,
    mode,
    screen: "countdown",
    resumeScreen: "playing",
    menuIndex: 0,
    score: { p1: 0, p2: 0 },
    winner: null,
    paddles: centeredPaddles(),
    balls: parkedBalls(state.balls, HOLD_TIME),
  };
}
