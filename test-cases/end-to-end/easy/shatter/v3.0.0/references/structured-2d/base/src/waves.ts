// Shatter — the wave loop.
//
// The rule that shapes everything else here is that a wave clears on a
// TRANSITION rather than on a predicate (`specs/progression.md`): it clears on
// the tick in which the last rock on the field is destroyed, so a field that
// holds no rocks and has had none destroyed on that tick is a wave being
// played, not a wave cleared. That is why `runWaveLoop` is handed the count of
// rocks destroyed this tick rather than reading the roster alone.
//
// `waveSpawning` gates the whole faculty: noticing the clear, raising the
// banner, advancing the wave number, and spawning the wave the banner
// announces. A banner already running still runs down, because it is a timer
// rather than a decision.

import {
  FIELD_H,
  FIELD_W,
  STAR_X,
  STAR_Y,
  TICK_DT,
  WAVE_BANNER_TIME,
  WAVE_BASE_ROCKS,
  WAVE_MIN_SHIP_DIST,
  WAVE_MIN_STAR_DIST,
  WAVE_SPEED_CAP,
  WAVE_SPEED_STEP,
} from "./constants";
import { addRockTo } from "./entities";
import { wrappedDistance } from "./geometry";
import type { ShatterState } from "./game";
import { baseDriftSpeed } from "./rocks";
import { random, randomRange } from "./rng";

/** How many random placements are tried before the search falls back. */
const PLACEMENT_TRIES = 200;

/** The coarse grid the fallback walks, when every random try was too close. */
const FALLBACK_COLUMNS = 32;
const FALLBACK_ROWS = 18;

/** How much faster than the plain range wave `n`'s rocks drift. */
export function waveSpeedScale(wave: number): number {
  return 1 + Math.min(WAVE_SPEED_CAP, WAVE_SPEED_STEP * (wave - 1));
}

/** How many Large rocks wave `n` puts up. */
export function waveRockCount(wave: number): number {
  return WAVE_BASE_ROCKS + wave;
}

/** Whether a spawn point is clear of both the ship and the star. */
function isClear(state: ShatterState, x: number, y: number): boolean {
  return (
    wrappedDistance(x, y, state.ship.x, state.ship.y) >= WAVE_MIN_SHIP_DIST &&
    wrappedDistance(x, y, STAR_X, STAR_Y) >= WAVE_MIN_STAR_DIST
  );
}

/**
 * A point at least `WAVE_MIN_SHIP_DIST` from the ship and
 * `WAVE_MIN_STAR_DIST` from the star, both by the shortest wrapped separation.
 *
 * Random tries clear both bounds on roughly two thirds of the field, so the
 * grid walk beneath them is a guarantee rather than a path play takes: it makes
 * the two distances hold unconditionally instead of overwhelmingly.
 */
function pickSpawnPoint(state: ShatterState): { x: number; y: number } {
  for (let attempt = 0; attempt < PLACEMENT_TRIES; attempt += 1) {
    const x = randomRange(state, 0, FIELD_W);
    const y = randomRange(state, 0, FIELD_H);
    if (isClear(state, x, y)) return { x, y };
  }

  for (let row = 0; row < FALLBACK_ROWS; row += 1) {
    for (let column = 0; column < FALLBACK_COLUMNS; column += 1) {
      const x = ((column + 0.5) * FIELD_W) / FALLBACK_COLUMNS;
      const y = ((row + 0.5) * FIELD_H) / FALLBACK_ROWS;
      if (isClear(state, x, y)) return { x, y };
    }
  }

  return { x: 0, y: 0 };
}

/**
 * Put wave `state.wave` on the field: its Large rocks, each clear of the ship
 * and the star, each drifting in a random direction at its size's base speed
 * scaled by the wave's own multiplier.
 */
export function spawnWave(state: ShatterState): void {
  const count = waveRockCount(state.wave);
  const scale = waveSpeedScale(state.wave);

  for (let index = 0; index < count; index += 1) {
    const at = pickSpawnPoint(state);
    const rock = addRockTo(state, "large", at.x, at.y);
    const heading = random(state) * Math.PI * 2;
    const speed = baseDriftSpeed(state, "large") * scale;
    rock.vx = Math.cos(heading) * speed;
    rock.vy = Math.sin(heading) * speed;
  }
}

/**
 * The wave loop for one tick, given how many rocks this tick destroyed.
 *
 * A running banner counts down and spawns the wave it announces as it reaches
 * zero. With no banner running, the wave turns over on the tick that destroyed
 * the last rock — and on no other tick, so an emptied field is not a cleared
 * wave.
 */
export function runWaveLoop(state: ShatterState, destroyed: number): void {
  if (state.waveBanner > 0) {
    state.waveBanner -= TICK_DT;
    if (state.waveBanner <= 1e-9) {
      state.waveBanner = 0;
      if (state.waveSpawning) spawnWave(state);
    }
    return;
  }

  if (!state.waveSpawning) return;
  if (destroyed === 0 || state.rocks.length > 0) return;

  state.wave += 1;
  state.waveBanner = WAVE_BANNER_TIME;
}
