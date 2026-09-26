// Spectra — the ship, its cannon, and the flip that arms both.
//
// `specs/ship.md` fixes the lane travel, the shot and the three gates that block
// one; `specs/bands.md` fixes the flip and the lockout it starts. They are in one
// file because the lockout is the seam between them: the flip is what starts it and
// the cannon is what it blocks, and keeping the two apart is how a build ends up
// with a flip that forgets to arm the lockout.
//
// The ship stops in the frame the direction is released, with no drift and no
// inertia, and holding both directions leaves it where it stands: there is no
// velocity anywhere below, only a position moved while a direction is held.

import {
  CUES,
  FIRE_INTERVAL,
  FLIP_LOCKOUT,
  MAX_PLAYER_BULLETS,
  PLAYER_BULLET_H,
  SHIP_H,
  SHIP_SPEED,
  SHIP_Y,
  opposite,
} from "./constants";
import { addPlayerBullet } from "./entities";
import { clampShipX } from "./field";
import type { CueSink } from "./audio";
import type { SpectraState } from "./types";

/** The `y` a shot leaves the hull at: the nose, above `SHIP_Y`. */
export const NOSE_Y = SHIP_Y - SHIP_H / 2 - PLAYER_BULLET_H / 2;

/** Move the ship along its lane for `h` seconds of held direction. */
export function moveShip(
  state: SpectraState,
  left: boolean,
  right: boolean,
  h: number,
): void {
  // Both at once cancel, which leaves the ship exactly where it stands.
  const direction = (right ? 1 : 0) - (left ? 1 : 0);
  if (direction === 0) return;
  state.ship.x = clampShipX(state.ship.x + direction * SHIP_SPEED * h);
}

/** How many of the player's bullets are in flight. */
export function playerBulletsInFlight(state: SpectraState): number {
  return state.bullets.reduce(
    (count, bullet) => count + (bullet.friendly ? 1 : 0),
    0,
  );
}

/** Whether all three of the cannon's gates are open. */
export function canFire(state: SpectraState): boolean {
  return (
    state.ship.cooldown <= 0 &&
    state.ship.lockout <= 0 &&
    playerBulletsInFlight(state) < MAX_PLAYER_BULLETS
  );
}

/**
 * Take a shot, if the cadence, the cap and the lockout all allow one.
 *
 * The bullet leaves the nose on the ship's own centre `x`, carrying the ship's band
 * at the instant it is fired, fixed for the bullet's whole life. Where a gate is
 * closed the action adds nothing at all.
 */
export function fire(state: SpectraState, cues: CueSink): boolean {
  if (!canFire(state)) return false;
  addPlayerBullet(state, state.ship.x, NOSE_Y, state.ship.band);
  state.ship.cooldown = FIRE_INTERVAL;
  cues.raise(CUES.fire);
  return true;
}

/**
 * Flip the ship's band.
 *
 * Instant: the ship holds the other band in this very frame. It starts the fire
 * lockout, and a flip made while one is still standing RESTARTS it. A bullet already
 * in flight keeps the band it was fired with, which is simply this function not
 * touching the roster.
 */
export function flip(state: SpectraState, cues: CueSink): void {
  state.ship.band = opposite(state.ship.band);
  state.ship.lockout = FLIP_LOCKOUT;
  cues.raise(CUES.flip);
}

/** Count the cannon's two clocks down by `h` seconds of game time. */
export function tickCannon(state: SpectraState, h: number): void {
  state.ship.cooldown = Math.max(0, state.ship.cooldown - h);
  state.ship.lockout = Math.max(0, state.ship.lockout - h);
}
