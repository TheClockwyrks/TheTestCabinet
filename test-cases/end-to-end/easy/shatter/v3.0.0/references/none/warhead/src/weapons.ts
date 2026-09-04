// Shatter — what the ship shoots: the gun and the guided torpedo.
//
// `specs/weapons.md` fixes both. They share a muzzle — each leaves the ship's
// nose along its facing — and nothing else:
//
//   * The GUN is gated in whole ticks, capped at four rounds in flight, and its
//     rounds carry the ship's drift and are then pulled by the well.
//   * The TORPEDO is a single guided munition on a ten-second recharge. It is
//     self-propelled, so it carries none of the ship's drift and the well never
//     touches it, and it holds its speed whether or not it is turning.
//
// Firing happens at the END of a tick, after the field has moved and its
// collisions have been resolved. That is what makes a round appear at the nose:
// the tick that creates it does not also fly it, so the first thing anything sees
// of a shot is the shot leaving the ship.

import {
  CUES,
  MAX_BULLETS,
  MUZZLE_SPEED,
  FIRE_INTERVAL_TICKS,
  TICK_DT,
  TORPEDO_CONE,
  TORPEDO_RECHARGE,
  TORPEDO_SPEED,
  TORPEDO_TURN,
} from "./constants";
import { makeBullet, makeTorpedo, shipNose } from "./entities";
import { angleDelta, shortestDelta, turnToward } from "./geometry";
import { travel } from "./motion";
import type { UpdateApi } from "./runtime";
import type { ShatterState, Torpedo } from "./types";
import { raise } from "./world";

/** Run the gun's gate down by one tick. It is counted in ticks, not seconds. */
export function tickFireGate(state: ShatterState): void {
  state.ship.fireCooldown = Math.max(0, state.ship.fireCooldown - 1);
}

/**
 * Refill the torpedo charge, linearly, over `TORPEDO_RECHARGE` seconds.
 *
 * Run before the launch that might spend it, so the tick that launches ends with
 * the charge at exactly `0` rather than at one tick's worth of refill.
 */
export function tickTorpedoCharge(state: ShatterState): void {
  if (state.torpedoCharge >= 1) return;
  state.torpedoCharge = Math.min(
    1,
    state.torpedoCharge + TICK_DT / TORPEDO_RECHARGE,
  );
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
 * Launch the torpedo, if one is charged and none is already up.
 *
 * The key does nothing while the charge is below `1`, and nothing at all while a
 * torpedo is in flight whatever the charge reads. A launch spends the charge to
 * `0`, from which it refills.
 */
export function launchTorpedo(state: ShatterState): void {
  if (state.torpedoCharge < 1 || state.torpedoes.length > 0) return;
  const ship = state.ship;
  const nose = shipNose(ship);
  state.torpedoes.push(makeTorpedo(state, nose.x, nose.y, ship.angle));
  state.torpedoCharge = 0;
}

/**
 * The torpedo's guidance, which is the whole of what its `homing` gates.
 *
 * Every tick it looks for the nearest rock or saucer whose bearing lies inside
 * `TORPEDO_CONE` of its current heading — a forward cone, so a body behind it is
 * never acquired — and turns onto it at up to `TORPEDO_TURN`. With no candidate
 * it flies straight on. It re-evaluates every tick, so it acquires, loses and
 * re-acquires over a flight.
 */
export function torpedoControl(state: ShatterState): void {
  for (const torpedo of state.torpedoes) {
    if (!torpedo.homing) continue;
    const target = acquire(state, torpedo);
    if (target === null) continue;
    const toTarget = shortestDelta(torpedo.x, torpedo.y, target.x, target.y);
    torpedo.heading = turnToward(
      torpedo.heading,
      Math.atan2(toTarget.y, toTarget.x),
      TORPEDO_TURN * TICK_DT,
    );
  }
}

/** The nearest body inside the forward cone, by shortest wrapped distance. */
function acquire(
  state: ShatterState,
  torpedo: Torpedo,
): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestDistance = Infinity;
  const consider = (x: number, y: number): void => {
    const delta = shortestDelta(torpedo.x, torpedo.y, x, y);
    const distance = Math.hypot(delta.x, delta.y);
    if (distance === 0 || distance >= bestDistance) return;
    const bearing = Math.atan2(delta.y, delta.x);
    if (Math.abs(angleDelta(bearing, torpedo.heading)) > TORPEDO_CONE) return;
    bestDistance = distance;
    best = { x, y };
  };
  for (const rock of state.rocks) consider(rock.x, rock.y);
  if (state.saucer !== null) consider(state.saucer.x, state.saucer.y);
  return best;
}

/**
 * One tick for every torpedo: its velocity follows its heading at its own
 * constant speed, it travels and wraps, and it ages out at `TORPEDO_LIFE`.
 *
 * The well is never consulted, which is what makes it fly true through the
 * gravity the star exerts.
 */
export function integrateTorpedoes(state: ShatterState): void {
  const alive: Torpedo[] = [];
  for (const torpedo of state.torpedoes) {
    torpedo.vx = Math.cos(torpedo.heading) * TORPEDO_SPEED;
    torpedo.vy = Math.sin(torpedo.heading) * TORPEDO_SPEED;
    travel(torpedo, TICK_DT);
    torpedo.life -= TICK_DT;
    if (torpedo.life > 0) alive.push(torpedo);
  }
  state.torpedoes = alive;
}

/**
 * Read this tick's weapon input and act on it.
 *
 * The gun answers to a press AND to a hold, so a tap takes one shot and holding
 * takes a shot every gate; the torpedo answers to a press ALONE, so holding the
 * key launches once (`specs/controls.md`).
 */
export function handleWeaponInput(state: ShatterState, api: UpdateApi): void {
  const firePressed = api.input.pressed("fire");
  const fireHeld = api.input.value("fire") > 0;
  if (firePressed || fireHeld) fireGun(state);
  if (api.input.pressed("torpedo")) launchTorpedo(state);
}
