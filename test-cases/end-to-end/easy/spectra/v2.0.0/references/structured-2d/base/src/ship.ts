// Spectra — the ship, its cannon and the flip (`specs/ship.md`, `specs/bands.md`).
//
// The ship travels left and right along one fixed lane, stops in the frame its
// direction is released, and never wraps. Its band is its cannon's band and its
// hull's shield at once, which is the whole of the case: the tuning that lets the
// player kill what is in front of them decides what can kill them.
//
// FIRING IS GATED THREE WAYS and by nothing else — the cadence, the cap on shots
// in flight, and the post-flip lockout — so a fire action that finds any of the
// three closed adds nothing at all.

import {
  FIRE_INTERVAL,
  FLIP_LOCKOUT,
  MAX_PLAYER_BULLETS,
  PLAYER_BULLET_H,
  PLAYER_BULLET_SPEED,
  SHIP_H,
  SHIP_X_MAX,
  SHIP_X_MIN,
  SHIP_Y,
} from "./constants";
import { opposite } from "./bands";
import { takeId } from "./entities";
import type { FrameEvents } from "./events";
import type { SpectraState } from "./game";

/** Where the ship rests when a run opens and after a life is lost. */
export const LANE_CENTER = (SHIP_X_MIN + SHIP_X_MAX) / 2;

/** `x`, held inside the lane's bounds. A ship driven into a bound rests there. */
export function clampLane(x: number): number {
  return Math.max(SHIP_X_MIN, Math.min(SHIP_X_MAX, x));
}

/** Where a shot leaves the hull: the ship's own centre `x`, at its nose. */
export function noseY(): number {
  return SHIP_Y - SHIP_H / 2 - PLAYER_BULLET_H / 2;
}

/** Whether the cannon may fire this instant. */
export function canFire(state: SpectraState): boolean {
  if (state.ship.cooldown > 0) return false;
  if (state.ship.lockout > 0) return false;
  const inFlight = state.bullets.filter((bullet) => bullet.friendly).length;
  return inFlight < MAX_PLAYER_BULLETS;
}

/** Fire one shot, carrying the ship's band at this instant. */
export function fire(state: SpectraState, events: FrameEvents): void {
  state.bullets.push({
    id: takeId(state),
    x: state.ship.x,
    y: noseY(),
    vx: 0,
    vy: -PLAYER_BULLET_SPEED,
    band: state.ship.band,
    friendly: true,
  });
  state.ship.cooldown = FIRE_INTERVAL;
  events.cues.add("fire");
}

/**
 * The flip: the other band, held in this very frame, and a fresh fire lockout.
 *
 * A flip made while a lockout is still standing restarts it, and a bullet
 * already in flight keeps the band it was fired with.
 */
export function flip(state: SpectraState, events: FrameEvents): void {
  state.ship.band = opposite(state.ship.band);
  state.ship.lockout = FLIP_LOCKOUT;
  events.cues.add("flip");
}
