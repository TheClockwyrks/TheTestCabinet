// Carom — building the state and moving it between screens (specs/ui.md).
//
// The title screen, the opening of a match, and the re-park after a point are
// each written once here and used by both the menus in `src/game.ts` and the
// debug surface in `src/debug.ts`, so choosing SOLO from the menu and calling
// `startMatch(state, "solo")` from a scenario cannot drift apart, and quitting to
// the menu and `reset()` cannot leave the game looking at two different title
// screens. Each is a transition: the current state in, the next state out.

import { DEFAULT_SEED, FIELD_CY, HOLD_TIME } from "./constants";
import { parkedBall } from "./entities";
import type { CaromState, Mode, Side } from "./game";

/**
 * The complete initial state: the title screen, with every field present.
 *
 * These are the values `toTitle` restores, which is why both are here.
 */
export function createInitialState(): CaromState {
  return {
    screen: "title",
    mode: "solo",
    menuIndex: 0,
    resumeScreen: "playing",
    score: { p1: 0, p2: 0 },
    winner: null,
    receiver: "left",
    holdTimer: 0,
    paddles: {
      left: { cy: FIELD_CY, vy: 0 },
      right: { cy: FIELD_CY, vy: 0 },
    },
    ball: parkedBall(),
    trail: [],
    simTime: 0,
    muted: false,
    rngState: DEFAULT_SEED,
    driver: { paddles: false, ai: false, vy: { left: 0, right: 0 } },
  };
}

/** Both paddles at the vertical center, stationary. */
function centeredPaddles(): CaromState["paddles"] {
  return {
    left: { cy: FIELD_CY, vy: 0 },
    right: { cy: FIELD_CY, vy: 0 },
  };
}

/** The state with the ball parked at the center and the trail it left cleared. */
export function parkBallAndTrail(state: CaromState): CaromState {
  return { ...state, ball: parkedBall(), trail: [] };
}

/**
 * Return to the title screen.
 *
 * Every declared field goes back to its title value except `simTime`, `muted`,
 * `rngState`, and `driver`, which keep theirs: the clock and the mute bit are
 * not properties of a screen, and the driver's hold is released by `reset()`
 * alone.
 */
export function toTitle(state: CaromState): CaromState {
  return {
    ...createInitialState(),
    simTime: state.simTime,
    muted: state.muted,
    rngState: state.rngState,
    driver: state.driver,
  };
}

/**
 * Start a match in `mode`. The match opens on the pre-serve countdown with the
 * first serve aimed at player one, and `simTime` is left as it is.
 */
export function startMatch(state: CaromState, mode: Mode): CaromState {
  return parkBallAndTrail({
    ...state,
    mode,
    screen: "countdown",
    resumeScreen: "playing",
    menuIndex: 0,
    score: { p1: 0, p2: 0 },
    winner: null,
    receiver: "left",
    holdTimer: HOLD_TIME,
    paddles: centeredPaddles(),
  });
}

/** Park the ball and begin the pre-serve hold, aimed at `receiver`. */
export function respawn(state: CaromState, receiver: Side): CaromState {
  return {
    ...parkBallAndTrail(state),
    receiver,
    holdTimer: HOLD_TIME,
    screen: "countdown",
  };
}
