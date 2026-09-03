// Carom — the poses a match moves between: the title screen, the opening of a
// match, and the complete initial state (specs/ui.md, specs/state.md).
//
// The menus (`src/game.ts`) and the debug surface (`src/debug.ts`) both start
// matches and both return to the title, and they must leave the game in the one
// same pose each time, so the arithmetic lives here and each of them calls it.
// This module holds no state: every function takes the current `CaromState` and
// returns the next, leaving the one it was handed as it was.

import { DEFAULT_SEED, FIELD_CY, HOLD_TIME } from "./constants";
import { centeredPaddle, createBalls, createObstacles } from "./entities";
import type { CaromState, Mode } from "./game";
import type { DeepReadonly } from "ts-essentials";

/** Both paddles at the vertical center, stationary, and under the player. */
function centeredPaddles(): CaromState["paddles"] {
  return { left: centeredPaddle(), right: centeredPaddle() };
}

/**
 * The complete initial state: the title screen, with every field present
 * (specs/state.md, "The state at the title screen").
 *
 * Exported so this build's own tests can construct a state without standing an
 * engine up around it. `toTitle` restores the same values apart from the five
 * fields that carry over, and `reset()` on the debug surface restores all of
 * them but the mute bit.
 */
export function createInitialState(): CaromState {
  return {
    screen: "title",
    mode: "solo",
    menuIndex: 0,
    titleIndex: 0,
    resumeScreen: "playing",
    score: { p1: 0, p2: 0 },
    winner: null,
    paddles: centeredPaddles(),
    ai: { tracking: true, movement: true },
    balls: createBalls(HOLD_TIME),
    obstacles: createObstacles(),
    simTime: 0,
    muted: false,
    seed: DEFAULT_SEED,
    rngState: DEFAULT_SEED,
    presses: [],
  };
}

/**
 * The title screen.
 *
 * Every declared field takes its title value except `titleIndex`, `simTime`,
 * `muted`, `seed`, and `rngState`, which keep theirs, and `menuIndex`, which
 * becomes `titleIndex`: the entry that led away from the title is the entry
 * highlighted on the way back to it (specs/ui.md).
 */
export function toTitle(state: DeepReadonly<CaromState>): CaromState {
  return {
    ...createInitialState(),
    menuIndex: state.titleIndex,
    titleIndex: state.titleIndex,
    simTime: state.simTime,
    muted: state.muted,
    seed: state.seed,
    rngState: state.rngState,
  };
}

/**
 * The opening of a match, as `SOLO`, `VERSUS`, `RESTART` and `PLAY AGAIN` all
 * pose it (specs/ui.md, "Starting a match").
 *
 * All three balls take their home points with a full hold, so the match opens on
 * the countdown screen and they launch together (specs/balls.md). `titleIndex`
 * keeps its value, and so do the AI's faculties, the mute bit, the clock, and the
 * generator.
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
    paddles: {
      left: { ...state.paddles.left, cy: FIELD_CY, vy: 0 },
      right: { ...state.paddles.right, cy: FIELD_CY, vy: 0 },
    },
    balls: createBalls(HOLD_TIME),
    presses: [],
  };
}
