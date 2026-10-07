// Shatter — the ship the player flies (`specs/ship.md`).
//
// Four things happen to the ship every tick, in this order and no other: its
// facing turns, its thrust is applied along that facing, its drag is applied,
// and its speed is capped. Rotation is the one that is easy to get subtly
// wrong — it changes the FACING alone and never the velocity, which is what
// makes the ship an inertial craft rather than a car, and what lets a player
// kill speed by turning around and burning against the motion.
//
// The facing is carried in radians exactly as it is set: nothing here folds it
// into a range, so a turn held for half a second moves it by exactly
// `SHIP_TURN * 0.5` and the debug surface reads back exactly what it was posed.
//
// The well never touches the ship. `src/gravity.ts` is applied to the ballistic
// bodies alone, so the ship holds exactly the course the player steers.

import {
  FACE_UP,
  SAFE_X,
  SAFE_Y,
  SHIP_DRAG_HALFLIFE,
  SHIP_MAX,
  SHIP_R,
  SHIP_THRUST,
  SHIP_TURN,
  TICK_DT,
} from "./constants";
import type { FrameInput } from "./input";
import type { MutShip, Sim } from "./sim";

/** The drag factor one tick of coasting multiplies the velocity by. */
const DRAG_PER_TICK = Math.pow(0.5, TICK_DT / SHIP_DRAG_HALFLIFE);

/**
 * Turn the ship and take its thrust, returning the acceleration that thrust
 * amounts to. This is step 1 of the tick, the control forces.
 */
export function shipControl(
  sim: Sim,
  input: FrameInput,
): readonly [number, number] {
  const ship = sim.ship;
  ship.angle += input.turn * SHIP_TURN * TICK_DT;
  ship.thrusting = input.thrust;
  if (!ship.thrusting) return [0, 0];
  return [
    Math.cos(ship.angle) * SHIP_THRUST,
    Math.sin(ship.angle) * SHIP_THRUST,
  ];
}

/**
 * Step 3 for the ship: the tick's acceleration, then the drag, then the cap.
 *
 * The cap is applied every tick rather than only after a burn, so carried
 * momentum reaches `SHIP_MAX` and never passes it however it was gained.
 */
export function applyShipVelocity(
  sim: Sim,
  accel: readonly [number, number],
): void {
  const ship = sim.ship;
  ship.vx = (ship.vx + accel[0] * TICK_DT) * DRAG_PER_TICK;
  ship.vy = (ship.vy + accel[1] * TICK_DT) * DRAG_PER_TICK;

  const speed = Math.hypot(ship.vx, ship.vy);
  if (speed > SHIP_MAX) {
    ship.vx = (ship.vx / speed) * SHIP_MAX;
    ship.vy = (ship.vy / speed) * SHIP_MAX;
  }
}

/** Where the gun's muzzle sits: the nose, `SHIP_R` ahead of the centre. */
export function shipNose(ship: MutShip): readonly [number, number] {
  return [
    ship.x + Math.cos(ship.angle) * SHIP_R,
    ship.y + Math.sin(ship.angle) * SHIP_R,
  ];
}

/** Put the ship at the safe point, at rest, facing up: how every life begins. */
export function placeShipAtSafePoint(ship: MutShip): void {
  ship.x = SAFE_X;
  ship.y = SAFE_Y;
  ship.vx = 0;
  ship.vy = 0;
  ship.angle = FACE_UP;
  ship.thrusting = false;
  ship.fireCooldown = 0;
}
