// Spectra — the ship and its cannon (specs/ship.md, specs/bands.md).
//
// The player's whole reach into the game is here, and every one of these is
// called from the player controller's tick, which is where `specs/state.md` puts
// the resolution of a frame's input into the state. Controllers tick before any
// actor and before the game mode, so the ship this frame's keys moved is the ship
// the frame's simulation and the frame's picture both see.
//
// The three gates on firing are read rather than assumed: the cadence, the cap on
// bullets in flight, and the post-flip lockout. All three are declared state, so a
// caller can pose any of them and see the cannon answer.

import {
  FIRE_INTERVAL,
  FLIP_LOCKOUT,
  MAX_PLAYER_BULLETS,
  PLAYER_BULLET_H,
  RESONANCE_MAX,
  SHIP_H,
  SHIP_SPEED,
  SHIP_X_MAX,
  SHIP_X_MIN,
  SHIP_Y,
} from "./constants";
import { opposite } from "./bands";
import { addPlayerBulletTo } from "./bullets";
import type { FrameCues } from "./audio";
import type { SpectraState } from "./game";

/** Where the nose of the hull sits, which a shot leaves from. */
export const MUZZLE_Y = SHIP_Y - SHIP_H / 2 - PLAYER_BULLET_H / 2;

/** Place the ship's centre at `x`, with the lane's own clamp applied. */
export function placeShip(state: SpectraState, x: number): void {
  state.ship.x = Math.max(SHIP_X_MIN, Math.min(SHIP_X_MAX, x));
}

/** The centre of the ship's lane, which a respawn returns it to. */
export const LANE_CENTER = (SHIP_X_MIN + SHIP_X_MAX) / 2;

/**
 * Move the ship along its lane for `dt` seconds.
 *
 * `direction` is the signed axis the controller read, so holding both directions
 * at once cancels out and leaves the ship where it stands, and releasing the key
 * stops it in that frame with no drift and no inertia.
 */
export function moveShip(
  state: SpectraState,
  direction: number,
  dt: number,
): void {
  if (direction === 0) return;
  placeShip(state, state.ship.x + Math.sign(direction) * SHIP_SPEED * dt);
}

/** Whether the cannon may fire right now. */
export function canFire(state: SpectraState): boolean {
  if (state.ship.cooldown > 0) return false;
  if (state.ship.lockout > 0) return false;
  const mine = state.bullets.filter((bullet) => bullet.friendly).length;
  return mine < MAX_PLAYER_BULLETS;
}

/**
 * Fire a shot if all three gates allow one. The bullet carries the ship's band
 * at the instant it is fired, fixed for its whole life.
 */
export function fireShot(state: SpectraState, cues: FrameCues): void {
  if (!canFire(state)) return;
  addPlayerBulletTo(state, state.ship.x, MUZZLE_Y, state.ship.band);
  state.ship.cooldown = FIRE_INTERVAL;
  cues.fire = true;
}

/**
 * Flip the ship's band. The change is instant, and it starts the fire lockout —
 * restarting one that is still standing.
 */
export function flipShip(state: SpectraState, cues: FrameCues): void {
  state.ship.band = opposite(state.ship.band);
  state.ship.lockout = FLIP_LOCKOUT;
  cues.flip = true;
}

/**
 * Release a discharge, if the meter is full.
 *
 * A discharge is available exactly at `RESONANCE_MAX` and not one point below:
 * below it the action spends nothing and starts no wave (`specs/resonance.md`).
 */
export function releaseDischarge(state: SpectraState, cues: FrameCues): void {
  if (state.resonance < RESONANCE_MAX) return;
  state.resonance = 0;
  state.discharge.active = true;
  state.discharge.radius = 0;
  cues.discharge = true;
}

/** Count the ship's two timers down against the frame's own slice of time. */
export function advanceShipTimers(state: SpectraState, h: number): void {
  state.ship.lockout = Math.max(0, state.ship.lockout - h);
  state.ship.cooldown = Math.max(0, state.ship.cooldown - h);
}
