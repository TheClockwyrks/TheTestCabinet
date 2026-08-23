// Carom — building the state and moving it between screens (specs/ui.md).
//
// The title screen, the opening of a match, and the re-park after a point are
// each written once here and used by both the menus in `src/game.ts` and the
// debug surface in `src/debug.ts`, so choosing SOLO from the menu and calling
// `startMatch("solo")` from a scenario cannot drift apart, and quitting to the
// menu and `reset()` cannot leave the game looking at two different title
// screens.

import { DEFAULT_SEED, FIELD_CX, FIELD_CY, HOLD_TIME } from "./constants";
import { parkBall } from "./entities";
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
    ball: { x: FIELD_CX, y: FIELD_CY, vx: 0, vy: 0, spin: 0 },
    trail: [],
    simTime: 0,
    muted: false,
    rngState: DEFAULT_SEED,
    driver: { paddles: false, ai: false, vy: { left: 0, right: 0 } },
  };
}

/** Put both paddles at the vertical center, stationary. */
function centerPaddles(state: CaromState): void {
  state.paddles.left.cy = FIELD_CY;
  state.paddles.left.vy = 0;
  state.paddles.right.cy = FIELD_CY;
  state.paddles.right.vy = 0;
}

/** Park the ball at the center and clear the trail it left. */
function parkBallAndTrail(state: CaromState): void {
  parkBall(state.ball);
  state.trail.length = 0;
}

/**
 * Return to the title screen.
 *
 * Every declared field goes back to its title value except `simTime`, `muted`,
 * `rngState`, and `driver`, which keep theirs: the clock and the mute bit are
 * not properties of a screen, and the driver's hold is released by `reset()`
 * alone.
 */
export function toTitle(state: CaromState): void {
  const title = createInitialState();
  state.screen = title.screen;
  state.mode = title.mode;
  state.menuIndex = title.menuIndex;
  state.resumeScreen = title.resumeScreen;
  state.score.p1 = title.score.p1;
  state.score.p2 = title.score.p2;
  state.winner = title.winner;
  state.receiver = title.receiver;
  state.holdTimer = title.holdTimer;
  centerPaddles(state);
  parkBallAndTrail(state);
}

/**
 * Start a match in `mode`. The match opens on the pre-serve countdown with the
 * first serve aimed at player one, and `simTime` is left as it is.
 */
export function startMatch(state: CaromState, mode: Mode): void {
  state.mode = mode;
  state.screen = "countdown";
  state.resumeScreen = "playing";
  state.menuIndex = 0;
  state.score.p1 = 0;
  state.score.p2 = 0;
  state.winner = null;
  state.receiver = "left";
  state.holdTimer = HOLD_TIME;
  centerPaddles(state);
  parkBallAndTrail(state);
}

/** Park the ball and begin the pre-serve hold, aimed at `receiver`. */
export function respawn(state: CaromState, receiver: Side): void {
  state.receiver = receiver;
  parkBallAndTrail(state);
  state.holdTimer = HOLD_TIME;
  state.screen = "countdown";
}
