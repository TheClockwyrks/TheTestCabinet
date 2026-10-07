// Shatter — the gun.
//
// `specs/weapons.md` fixes it: rounds leave the ship's nose along its facing,
// carrying the ship's own drift on top of the muzzle speed, the gun is gated in
// whole ticks, and at most four rounds are in flight at once. What a round does
// once it is up is in `src/shots.ts` and `src/collision.ts`.
//
// Firing happens at the END of a tick, after the field has moved and its
// collisions have been resolved. That is what makes a round appear at the nose:
// the tick that creates it does not also fly it, so the first thing anything sees
// of a shot is the shot leaving the ship.

import {
  CUES,
  FIRE_INTERVAL_TICKS,
  MAX_BULLETS,
  MUZZLE_SPEED,
} from "./constants";
import { makeBullet, shipNose } from "./entities";
import type { UpdateApi } from "./runtime";
import type { ShatterState } from "./types";
import { raise } from "./world";

/** Run the gun's gate down by one tick. It is counted in ticks, not seconds. */
export function tickFireGate(state: ShatterState): void {
  state.ship.fireCooldown = Math.max(0, state.ship.fireCooldown - 1);
}

/**
 * Take a shot if the gate allows one and the field has room.
 *
 * One press takes one shot and a held key takes one every
 * `FIRE_INTERVAL_TICKS`; both arrive here, so the cap and the gate are applied
 * once, in one place.
 */
export function fireGun(state: ShatterState): void {
  const ship = state.ship;
  if (ship.fireCooldown > 0 || state.bullets.length >= MAX_BULLETS) return;
  const nose = shipNose(ship);
  state.bullets.push(
    makeBullet(
      state,
      nose.x,
      nose.y,
      ship.vx + Math.cos(ship.angle) * MUZZLE_SPEED,
      ship.vy + Math.sin(ship.angle) * MUZZLE_SPEED,
    ),
  );
  ship.fireCooldown = FIRE_INTERVAL_TICKS;
  raise(state, CUES.fire);
}

/**
 * Read this tick's weapon input and act on it.
 *
 * The gun answers to a press AND to a hold, so a tap takes one shot and holding
 * takes a shot every gate (`specs/controls.md`).
 */
export function handleWeaponInput(state: ShatterState, api: UpdateApi): void {
  const pressed = api.input.pressed("fire");
  const held = api.input.value("fire") > 0;
  if (pressed || held) fireGun(state);
}
