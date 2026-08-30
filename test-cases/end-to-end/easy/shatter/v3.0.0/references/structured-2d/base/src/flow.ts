// Shatter — the run: opening a game, paying for a kill, losing a ship, and
// putting the whole state back to its title values.
//
// Two rules here are worth naming because a pose next to each of them means the
// opposite thing. The extra ship is granted by the SCORING PATH, once per
// multiple of `EXTRA_LIFE_STEP` the score is carried across, so a single award
// that crosses two multiples grants two ships — while the debug surface's
// `setScore` grants none, because it is a precondition rather than a kill. And
// `resetState` restores every DECLARED field to its title value while leaving
// `muted` exactly as it stands, because muting is the runtime's rather than the
// game's.

import type { FrameCues } from "./audio";
import {
  EXTRA_LIFE_STEP,
  SAUCER_FIRST_DELAY,
  START_LIVES,
  INVULN_TIME,
} from "./constants";
import type { ShatterState } from "./game";
import { seedRandom } from "./rng";
import { placeShipAtSafePoint } from "./ship";
import { spawnWave } from "./waves";

/** How long an awarded ship is announced on the field, in seconds. */
export const EXTRA_LIFE_NOTICE_TIME = 1.2;

/** Empty every roster and take the saucer off the field. */
function clearField(state: ShatterState): void {
  state.rocks = [];
  state.bullets = [];
  state.enemyBullets = [];
  state.saucer = null;
}

/** Nothing the player is asking for. */
function clearIntent(state: ShatterState): void {
  state.input.left = false;
  state.input.right = false;
  state.input.thrust = false;
  state.input.fire = false;
}

/**
 * Every declared field back to its title-screen value, and the generator
 * pointed at `seed`. `muted` is left exactly as it stands.
 */
export function resetState(state: ShatterState, seed: number): void {
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
  state.ship.fireCooldown = 0;

  state.waveSpawning = true;
  state.saucerSpawning = true;
  state.saucerClock = 0;
  state.saucerDue = SAUCER_FIRST_DELAY;

  state.tickClock = 0;
  state.nextId = 1;
  state.simTime = 0;
  seedRandom(state, seed);

  clearIntent(state);
  state.extraLifeNotice = 0;
}

/**
 * A new game: three ships, no score, wave 1, and a field cleared of everything
 * the previous game left. The saucer cadence starts over from the beginning of
 * a game.
 *
 * The wave's rocks are put up at once, which is the opening
 * `specs/progression.md` allows beside running the `WAVE 1` banner first. They
 * are the wave loop's, so `waveSpawning` gates them as it gates every other
 * wave.
 */
export function startGame(state: ShatterState): void {
  state.score = 0;
  state.lives = START_LIVES;
  state.wave = 1;
  state.waveBanner = 0;

  clearField(state);
  placeShipAtSafePoint(state);
  state.ship.invuln = 0;
  state.ship.fireCooldown = 0;

  state.saucerClock = 0;
  state.saucerDue = SAUCER_FIRST_DELAY;

  clearIntent(state);
  state.extraLifeNotice = 0;

  state.screen = "playing";
  state.menuIndex = 0;

  if (state.waveSpawning) spawnWave(state);
}

/** Back to the title, with the highlight at the first entry. */
export function toTitle(state: ShatterState): void {
  state.screen = "title";
  state.menuIndex = 0;
  clearIntent(state);
}

/**
 * Pay a kill, and grant one extra ship for each multiple of `EXTRA_LIFE_STEP`
 * the payment carries the score across.
 */
export function addScore(
  state: ShatterState,
  amount: number,
  cues: FrameCues,
): void {
  const before = Math.floor(state.score / EXTRA_LIFE_STEP);
  state.score += amount;
  const after = Math.floor(state.score / EXTRA_LIFE_STEP);
  if (after <= before) return;

  state.lives += after - before;
  state.extraLifeNotice = EXTRA_LIFE_NOTICE_TIME;
  cues.extraLife = true;
}

/**
 * A ship lost. The next one appears at the safe point inside its respawn
 * grace; the last one leaves the counter at zero and the game over.
 */
export function loseLife(state: ShatterState, cues: FrameCues): void {
  cues.death = true;
  state.lives -= 1;

  if (state.lives > 0) {
    placeShipAtSafePoint(state);
    state.ship.invuln = INVULN_TIME;
    state.ship.fireCooldown = 0;
    return;
  }

  state.lives = 0;
  state.screen = "gameover";
  state.menuIndex = 0;
  clearIntent(state);
}
