// Shatter — the ship (`specs/ship.md`, `specs/weapons.md`).
//
// The ship is the one body the well never touches, so everything that changes
// its velocity is here: the constant turn, the thrust along its facing, the drag
// that halves an un-thrusting speed every SHIP_DRAG_HALFLIFE, and the cap the
// two of them are then clamped to. `specs/simulation.md` fixes the order — the
// facing turns and the thrust is taken in the control step, the velocity gains
// it in the velocity step, and the drag and the cap are applied there, after.
//
// The gun lives here too, because a shot is the ship's own state (the gate and
// the muzzle) far more than it is the bullet's. Firing happens at the END of a
// tick, after everything has moved, so a round leaves from where the ship
// actually IS and has not travelled before it is first seen — which is what
// `specs/weapons.md` means by a bullet leaving the nose.

import {
  BULLET_LIFE,
  CUES,
  FACE_UP,
  FIRE_INTERVAL_TICKS,
  INVULN_TIME,
  MAX_BULLETS,
  MUZZLE_SPEED,
  SAFE_X,
  SAFE_Y,
  SHIP_DRAG_HALFLIFE,
  SHIP_MAX,
  SHIP_THRUST,
  SHIP_TURN,
  TICK_DT,
} from "./constants";
import { takeId, type FrameEvents, type MutShip, type Sim } from "./sim";
import { MUZZLE_OFFSET } from "./tuning";
import type { FrameInput } from "./input";

/** Where a round or a torpedo leaves from: ahead of the centre, on the facing. */
export function muzzleOf(ship: MutShip): readonly [number, number] {
  return [
    ship.x + Math.cos(ship.angle) * MUZZLE_OFFSET,
    ship.y + Math.sin(ship.angle) * MUZZLE_OFFSET,
  ];
}

/**
 * The control step: turn the facing, and report the thrust acceleration.
 *
 * Rotation changes the facing ALONE, never the velocity. The acceleration is
 * returned rather than applied, because `specs/simulation.md` puts every
 * acceleration into the velocity in one later step.
 */
export function controlShip(
  sim: Sim,
  input: FrameInput,
): readonly [number, number] {
  const ship = sim.ship;
  ship.angle += input.turn * SHIP_TURN * TICK_DT;

  ship.thrusting = input.thrust;
  if (!input.thrust) return [0, 0];

  return [
    Math.cos(ship.angle) * SHIP_THRUST,
    Math.sin(ship.angle) * SHIP_THRUST,
  ];
}

/** The velocity step for the ship: the accelerations, then the drag, then the cap. */
export function integrateShip(sim: Sim, ax: number, ay: number): void {
  const ship = sim.ship;
  ship.vx += ax * TICK_DT;
  ship.vy += ay * TICK_DT;

  const decay = Math.pow(0.5, TICK_DT / SHIP_DRAG_HALFLIFE);
  ship.vx *= decay;
  ship.vy *= decay;

  const speed = Math.hypot(ship.vx, ship.vy);
  if (speed > SHIP_MAX) {
    ship.vx = (ship.vx / speed) * SHIP_MAX;
    ship.vy = (ship.vy / speed) * SHIP_MAX;
  }
}

/**
 * Take a shot, if the gate and the on-screen cap both allow one.
 *
 * The gate is in whole ticks and is counted down elsewhere, so this is only ever
 * asked on a tick the ship may fire on.
 */
export function fireGun(
  sim: Sim,
  input: FrameInput,
  events: FrameEvents,
): void {
  if (!input.fire) return;
  if (sim.ship.fireCooldown > 0) return;
  if (sim.bullets.length >= MAX_BULLETS) return;

  const [x, y] = muzzleOf(sim.ship);
  sim.bullets.push({
    id: takeId(sim),
    x,
    y,
    vx: sim.ship.vx + Math.cos(sim.ship.angle) * MUZZLE_SPEED,
    vy: sim.ship.vy + Math.sin(sim.ship.angle) * MUZZLE_SPEED,
    life: BULLET_LIFE,
  });
  sim.ship.fireCooldown = FIRE_INTERVAL_TICKS;
  events.cues.add(CUES.fire);
}

/**
 * Put the next ship up: at rest at the safe point, facing up, inside its grace.
 *
 * `specs/weapons.md` also makes a respawn refill the torpedo charge and cancel
 * any recharge in progress, which is the one line of this that is not about
 * where the ship is.
 */
export function respawnShip(sim: Sim): void {
  const ship = sim.ship;
  ship.x = SAFE_X;
  ship.y = SAFE_Y;
  ship.vx = 0;
  ship.vy = 0;
  ship.angle = FACE_UP;
  ship.thrusting = false;
  ship.invuln = INVULN_TIME;
  ship.fireCooldown = 0;
  sim.torpedoCharge = 1;
}
