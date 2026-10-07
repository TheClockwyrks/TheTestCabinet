// Shatter — the ship: how it flies, where a life begins, and what it shoots.
//
// `specs/ship.md` fixes the order inside one tick — the facing turns, the thrust
// is applied, the drag is applied, and the speed is capped — and the star never
// pulls the ship, so it flies exactly where the player steers it.
//
// A weapon leaves the nose AFTER the ship has moved, so a round is at the nose
// on the tick it is fired and travels from there on the next one.

import {
  FACE_UP,
  FIRE_INTERVAL_TICKS,
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
import type { FrameCues } from "./audio";
import { addBulletTo, addTorpedoTo } from "./entities";
import type { ShatterState } from "./game";
import { wrapX, wrapY } from "./geometry";
import { recordMove, type MoveTable } from "./motion";
import { NOSE_OFFSET } from "./tuning";

/** The drag factor one tick of un-thrusting flight multiplies the velocity by. */
const DRAG_PER_TICK = Math.pow(0.5, TICK_DT / SHIP_DRAG_HALFLIFE);

/** Where a round leaves: ahead of the ship's centre, along its facing. */
export function nosePosition(state: ShatterState): { x: number; y: number } {
  const { x, y, angle } = state.ship;
  return {
    x: wrapX(x + Math.cos(angle) * NOSE_OFFSET),
    y: wrapY(y + Math.sin(angle) * NOSE_OFFSET),
  };
}

/** Step 1 of the tick: the facing the player is holding, and the burn. */
export function controlShip(state: ShatterState): void {
  const ship = state.ship;
  ship.angle += state.intent.turn * SHIP_TURN * TICK_DT;
  ship.thrusting = state.intent.thrust;
}

/** Steps 3 to 5: the velocity the burn, the drag and the cap leave, then the move. */
export function integrateShip(state: ShatterState, moves: MoveTable): void {
  const ship = state.ship;

  if (ship.thrusting) {
    ship.vx += Math.cos(ship.angle) * SHIP_THRUST * TICK_DT;
    ship.vy += Math.sin(ship.angle) * SHIP_THRUST * TICK_DT;
  }

  ship.vx *= DRAG_PER_TICK;
  ship.vy *= DRAG_PER_TICK;

  const speed = Math.hypot(ship.vx, ship.vy);
  if (speed > SHIP_MAX) {
    ship.vx = (ship.vx / speed) * SHIP_MAX;
    ship.vy = (ship.vy / speed) * SHIP_MAX;
  }

  const mx = ship.vx * TICK_DT;
  const my = ship.vy * TICK_DT;
  ship.x = wrapX(ship.x + mx);
  ship.y = wrapY(ship.y + my);
  recordMove(moves, ship, mx, my);
}

/**
 * The gun.
 *
 * One press takes one shot when the gate allows it, and a held key takes one
 * every `FIRE_INTERVAL_TICKS`. The cap is checked after the gate and spends
 * nothing: while four rounds are live, firing adds none and the gate stays open,
 * so the next shot leaves the moment one of them does.
 */
export function fireGun(state: ShatterState, cues: FrameCues): void {
  const ship = state.ship;
  if (!state.intent.fire) return;
  if (ship.fireCooldown > 0) return;
  if (state.bullets.length >= MAX_BULLETS) return;

  const nose = nosePosition(state);
  addBulletTo(
    state,
    nose.x,
    nose.y,
    ship.vx + Math.cos(ship.angle) * MUZZLE_SPEED,
    ship.vy + Math.sin(ship.angle) * MUZZLE_SPEED,
  );
  ship.fireCooldown = FIRE_INTERVAL_TICKS;
  cues.fire = true;
}

/**
 * The torpedo.
 *
 * The key is read as a press alone, and the press is spent whether or not it
 * launches anything: it does nothing while the charge is below `1`, and nothing
 * while one is already up. A launch spends the charge and carries none of the
 * ship's drift.
 */
export function launchTorpedo(state: ShatterState): void {
  if (!state.torpedoRequest) return;
  state.torpedoRequest = false;

  if (state.torpedoCharge < 1) return;
  if (state.torpedoes.length > 0) return;

  const nose = nosePosition(state);
  addTorpedoTo(state, nose.x, nose.y, state.ship.angle);
  state.torpedoCharge = 0;
}

/** Put the ship at the safe point, at rest, facing up. */
export function placeShipAtSafePoint(state: ShatterState): void {
  const ship = state.ship;
  ship.x = SAFE_X;
  ship.y = SAFE_Y;
  ship.vx = 0;
  ship.vy = 0;
  ship.angle = FACE_UP;
  ship.thrusting = false;
  ship.fireCooldown = 0;
}
