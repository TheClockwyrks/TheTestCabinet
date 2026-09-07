// Shatter — the run: opening a game, the score it is paid, the ships it costs,
// and the title-screen state `reset` restores.
//
// Everything here writes the state through the paths play runs on, so the debug
// surface's `reset` and the title menu's `PLAY` reach exactly the same code the
// game does.

import type { FrameCues } from "./audio";
import {
  EXTRA_LIFE_STEP,
  SAUCER_FIRST_DELAY,
  START_LIVES,
  INVULN_TIME,
} from "./constants";
import type { ShatterState } from "./game";
import { spawnWave } from "./rocks";
import { placeShipAtSafePoint } from "./ship";
import { EXTRA_FLASH_TIME } from "./tuning";

/** Empty every roster and take the saucer off the field. */
function clearField(state: ShatterState): void {
  state.bullets = [];
  state.rocks = [];
  state.enemyBullets = [];
  state.torpedoes = [];
  state.saucer = null;
}

/** Forget whatever the player was holding when the screen changed. */
function clearIntent(state: ShatterState): void {
  state.intent.turn = 0;
  state.intent.thrust = false;
  state.intent.fire = false;
  state.torpedoRequest = false;
  state.pointerPresses = [];
}

/**
 * Restore every declared field to its title-screen value, every posed draw
 * cleared. `muted` is left exactly as it stands: muting is the runtime's.
 */
export function resetState(state: ShatterState): void {
  state.screen = "title";
  state.menuIndex = 0;

  state.score = 0;
  state.lives = START_LIVES;
  state.wave = 0;
  state.waveBanner = 0;

  clearField(state);
  placeShipAtSafePoint(state);
  state.ship.invuln = 0;
  state.ship.collision = true;
  state.torpedoCharge = 1;

  state.waveSpawning = true;
  state.saucerSpawning = true;
  state.saucerClock = 0;
  state.saucerDue = SAUCER_FIRST_DELAY;

  state.nextSaucerEdge = null;
  state.nextSaucerRow = null;
  state.nextSaucerAim = null;
  state.nextRockSpeed = null;
  state.nextRecycleEdge = null;

  state.tickClock = 0;
  state.nextId = 1;
  state.simTime = 0;

  clearIntent(state);
  state.extraFlash = 0;
}

/**
 * Open a new game: three ships, a score of `0`, wave `1`, and a field cleared of
 * everything the previous game left. The saucer cadence starts over from the
 * beginning of a game, and the first wave's rocks go up at once.
 *
 * The instrumentation gates are not touched. Each holds a faculty a caller
 * posed, and starting a game is a move the game makes rather than a pose being
 * lifted; `reset` is what restores them.
 */
export function startRun(state: ShatterState): void {
  state.screen = "playing";
  state.menuIndex = 0;

  state.score = 0;
  state.lives = START_LIVES;
  state.wave = 1;
  state.waveBanner = 0;

  clearField(state);
  placeShipAtSafePoint(state);
  state.ship.invuln = 0;
  state.torpedoCharge = 1;

  state.saucerClock = 0;
  state.saucerDue = SAUCER_FIRST_DELAY;

  clearIntent(state);
  state.extraFlash = 0;

  spawnWave(state);
}

/** Back to the title, with the highlight at the first entry. */
export function toTitle(state: ShatterState): void {
  state.screen = "title";
  state.menuIndex = 0;
  clearIntent(state);
}

/** Back to the game in progress, exactly as it stood. */
export function resumeRun(state: ShatterState): void {
  state.screen = "playing";
  state.menuIndex = 0;
}

/**
 * Pay the score for one destruction, and grant the ships it earns.
 *
 * One extra ship is granted for each multiple of `EXTRA_LIFE_STEP` the award
 * carries the score across, so a single award crossing two multiples grants two.
 */
export function addScore(
  state: ShatterState,
  points: number,
  cues: FrameCues,
): void {
  const before = state.score;
  state.score = before + points;

  const awarded =
    Math.floor(state.score / EXTRA_LIFE_STEP) -
    Math.floor(before / EXTRA_LIFE_STEP);
  if (awarded <= 0) return;

  state.lives += awarded;
  state.extraFlash = EXTRA_FLASH_TIME;
  cues.extraLife = true;
}

/**
 * The ship is destroyed: one life is spent, and the next one appears at the safe
 * point with its respawn grace running. When the last ship is lost the counter
 * reaches `0`, no new ship appears, and the game is over.
 */
export function loseLife(state: ShatterState, cues: FrameCues): void {
  cues.death = true;
  state.lives = Math.max(0, state.lives - 1);
  state.ship.thrusting = false;

  if (state.lives <= 0) {
    state.screen = "gameover";
    state.menuIndex = 0;
    clearIntent(state);
    return;
  }

  placeShipAtSafePoint(state);
  state.ship.invuln = INVULN_TIME;
  state.torpedoCharge = 1;
}
