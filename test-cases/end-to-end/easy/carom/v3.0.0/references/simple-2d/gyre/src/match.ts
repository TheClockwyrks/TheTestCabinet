// Carom — the two poses every screen transition is built from: the title screen
// and the opening of a match (specs/ui.md).
//
// Both are reached from more than one place. The title is where `QUIT TO MENU`,
// `MENU`, `back` on the match-over screen, leaving the how-to screen, and the
// debug surface's `reset()` all land; a match is what `SOLO`, `VERSUS`,
// `RESTART`, `PLAY AGAIN`, and the debug surface's `startMatch()` all open. Each
// rule lives here once, so the menus and the debug surface cannot drift apart.

import { FIELD_CY, HOLD_TIME } from "./constants";
import { parkBall } from "./entities";
import type { CaromState, Mode } from "./game";
import { poseObstacles } from "./obstacles";

/** Put both paddles at the vertical center, stationary. */
function centerPaddles(state: CaromState): void {
  state.paddles.left.cy = FIELD_CY;
  state.paddles.left.vy = 0;
  state.paddles.right.cy = FIELD_CY;
  state.paddles.right.vy = 0;
}

/**
 * Return to the title screen.
 *
 * Every declared field takes its title value except `simTime`, `muted`,
 * `rngState`, and `driver`, which the specification keeps across the
 * transition: time and the mute bit are not properties of a screen, the
 * generator is reseeded by `reset()` alone, and the debug driver's hold is
 * released by `reset()` alone.
 */
export function toTitle(state: CaromState): void {
  state.screen = "title";
  state.mode = "solo";
  state.menuIndex = 0;
  state.resumeScreen = "playing";
  state.score.p1 = 0;
  state.score.p2 = 0;
  state.winner = null;
  state.receiver = "left";
  state.holdTimer = 0;
  centerPaddles(state);
  parkBall(state.ball);
  state.trail.length = 0;
  state.obstacleClock = 0;
  poseObstacles(state.obstacles, state.obstacleClock);
}

/**
 * Start a match in `mode`. It opens on the pre-serve countdown with the first
 * serve aimed at player one, both obstacles upright at their base centers, and
 * `simTime` carried on.
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
  parkBall(state.ball);
  state.trail.length = 0;
  // The clock starts over rather than carrying the previous match's phase into
  // this one (specs/playfield.md).
  state.obstacleClock = 0;
  poseObstacles(state.obstacles, state.obstacleClock);
}
