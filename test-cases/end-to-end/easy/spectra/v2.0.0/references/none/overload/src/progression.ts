// Spectra — the lives a run carries, the beat after one is lost, and the end.
//
// `specs/progression.md` fixes what a life costs, what the hold after it looks
// like, and what happens when the last one goes. Two properties of that hold are
// what the rest of the build leans on:
//
//   * THE WAVE CARRIES ON WHERE IT WAS. Nothing about the field is touched: every
//     drone keeps its phase, its position and its band, and any dive in progress
//     runs on. So a life loss is a change to the RUN, never to the field.
//   * NOTHING COSTS A FURTHER LIFE DURING THE HOLD. That is expressed by the ship
//     not being alive while the phase is `ready`, which is the same fact
//     `snapshot().ship.alive` reports, so the rule and the readout cannot drift
//     apart.

import { READY_HOLD, START_LIVES } from "./constants";
import { CUES } from "./constants";
import { LANE_CENTER } from "./field";
import type { CueSink } from "./audio";
import type { SpectraState } from "./types";

/** Whether the ship is alive: false exactly while the phase is `ready`. */
export function shipAlive(state: SpectraState): boolean {
  return state.phase !== "ready";
}

/**
 * Whether the ship's contact test can cost anything right now.
 *
 * The gate the debug surface poses, and the ready hold, both close it.
 */
export function contactLive(state: SpectraState): boolean {
  return state.ship.contact && shipAlive(state);
}

/**
 * Take one life.
 *
 * With a life to spare the live wave enters its `ready` phase for `READY_HOLD`;
 * with none left the run ends and the game-over screen opens. One event costs
 * exactly one life, whatever else is on the field at that instant, which is why
 * every caller funnels through here.
 */
export function loseLife(state: SpectraState, cues: CueSink): void {
  state.lives -= 1;
  cues.raise(CUES.hit);
  if (state.lives <= 0) {
    state.lives = 0;
    state.screen = "gameOver";
    state.phase = "live";
    state.phaseTimer = 0;
    state.menuIndex = 0;
    return;
  }
  state.phase = "ready";
  state.phaseTimer = READY_HOLD;
}

/**
 * End the ready hold.
 *
 * The wave returns to the `live` phase and the ship reappears at the centre of its
 * lane, holding the band it held.
 */
export function endReadyHold(state: SpectraState): void {
  state.phase = "live";
  state.phaseTimer = 0;
  state.ship.x = LANE_CENTER;
  state.ship.lockout = 0;
  state.ship.cooldown = 0;
}

/** The lives a fresh run starts with. */
export function freshLives(): number {
  return START_LIVES;
}
