// Carom — the two poses every screen transition is built from: the title screen
// and the opening of a match (specs/ui.md).
//
// Both are reached from more than one place. The title is where `QUIT TO MENU`,
// `MENU`, `back` on the match-over screen, leaving the how-to screen, and the
// debug surface's `reset()` all land; a match is what `SOLO`, `VERSUS`,
// `RESTART`, `PLAY AGAIN`, and the debug surface's `startMatch()` all open. Each
// rule lives here once, so the menus and the debug surface cannot drift apart.
//
// Each is a transition: the current state in, the next state out.

import { FIELD_CY, HOLD_TIME } from "./constants";
import { parkedBall } from "./entities";
import type { CaromState, Mode, PaddleState } from "./game";
import { poseObstacles } from "./obstacles";
import type { DeepReadonly } from "ts-essentials";

/** Both paddles at the vertical center, stationary. */
function centeredPaddles(): { left: PaddleState; right: PaddleState } {
  return {
    left: { cy: FIELD_CY, vy: 0 },
    right: { cy: FIELD_CY, vy: 0 },
  };
}

/**
 * The title screen.
 *
 * Every declared field takes its title value except `simTime`, `muted`,
 * `rngState`, and `driver`, which the specification keeps across the
 * transition: time and the mute bit are not properties of a screen, the
 * generator is reseeded by `reset()` alone, and the debug driver's hold is
 * released by `reset()` alone.
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
    receiver: "left",
    holdTimer: 0,
    paddles: centeredPaddles(),
    ball: parkedBall(),
    trail: [],
    obstacleClock: 0,
    obstacles: poseObstacles(0),
  };
}

/**
 * A match in `mode`, just opened. It opens on the pre-serve countdown with the
 * first serve aimed at player one, both obstacles upright at their base centers,
 * and `simTime` carried on.
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
    receiver: "left",
    holdTimer: HOLD_TIME,
    paddles: centeredPaddles(),
    ball: parkedBall(),
    trail: [],
    // The clock starts over rather than carrying the previous match's phase into
    // this one (specs/playfield.md).
    obstacleClock: 0,
    obstacles: poseObstacles(0),
  };
}
