// Carom — building the state and moving it between screens (specs/ui.md).
//
// The title screen, the opening of a match, the re-park after a point, and the
// serve itself are each written once here and used by both the menus in
// `src/game.ts` and the debug surface in `src/debug.ts`, so choosing SOLO from
// the menu and posing the same screen from a scenario cannot drift apart, and
// quitting to the menu and `reset()` cannot leave the game looking at two
// different title screens. Each is a transition: the current state in, the next
// state out.

import { DEFAULT_SEED, SERVE_ANGLE, SERVE_SPEED } from "./constants";
import { allObstacles, centeredPaddle, homeBall, newPaddle } from "./entities";
import type { CaromState, Mode, Side } from "./game";
import { nextSign, seedState } from "./rng";

/**
 * The complete initial state: the title screen, with every field present.
 *
 * These are the values specs/state.md gives the title screen, and the values
 * both `toTitle` and the surface's `reset` restore.
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
    paddles: { left: newPaddle(), right: newPaddle() },
    ai: { tracking: true, movement: true },
    receiver: "left",
    ball: homeBall(),
    obstacles: allObstacles(),
    simTime: 0,
    muted: false,
    seed: DEFAULT_SEED,
    rngState: seedState(DEFAULT_SEED),
    presses: [],
  };
}

/**
 * Return to the title screen.
 *
 * Every declared field goes back to its title value except `titleIndex`,
 * `simTime`, `muted`, `seed` and `rngState`, which keep theirs, and `menuIndex`,
 * which becomes `titleIndex`: the entry that led away from the title is the one
 * selected on the way back (specs/ui.md).
 */
export function toTitle(state: CaromState): CaromState {
  return {
    ...createInitialState(),
    titleIndex: state.titleIndex,
    menuIndex: state.titleIndex,
    simTime: state.simTime,
    muted: state.muted,
    seed: state.seed,
    rngState: state.rngState,
  };
}

/**
 * Start a match in `mode`. The match opens on the pre-serve countdown with the
 * first serve aimed at player one, and `titleIndex`, `simTime`, the obstacles,
 * the AI's faculties and each paddle's driven flags are left as they are.
 */
export function startMatch(state: CaromState, mode: Mode): CaromState {
  return {
    ...state,
    mode,
    screen: "countdown",
    resumeScreen: "playing",
    menuIndex: 0,
    score: { p1: 0, p2: 0 },
    winner: null,
    receiver: "left",
    ball: homeBall(),
    paddles: {
      left: centeredPaddle(state.paddles.left),
      right: centeredPaddle(state.paddles.right),
    },
  };
}

/** Park the ball and begin the pre-serve hold, aimed at `receiver`. */
export function respawn(state: CaromState, receiver: Side): CaromState {
  return { ...state, receiver, ball: homeBall(), screen: "countdown" };
}

/**
 * Launch the ball toward the receiver at SERVE_SPEED.
 *
 * The serve leaves at exactly SERVE_ANGLE from horizontal (specs/balls.md); the
 * SIGN of its vertical component is the one draw this game makes from its seeded
 * generator, and the generator's next state is stored beside the ball it aimed.
 * The ball is not moved: it is served from wherever it was waiting.
 */
export function serveBall(state: CaromState): CaromState {
  const ball = state.ball;
  if (ball === null) return state;

  const dir = state.receiver === "left" ? -1 : 1;
  const [sign, rngState] = nextSign(state.rngState);
  return {
    ...state,
    ball: {
      ...ball,
      vx: dir * SERVE_SPEED * Math.cos(SERVE_ANGLE),
      vy: sign * SERVE_SPEED * Math.sin(SERVE_ANGLE),
      held: false,
      holdTimer: 0,
      trail: [],
    },
    rngState,
    screen: "playing",
  };
}
