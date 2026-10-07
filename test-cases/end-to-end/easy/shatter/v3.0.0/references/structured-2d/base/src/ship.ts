// Shatter — the ship: how it answers the player, and how it meets the core.
//
// `specs/ship.md` fixes the order the ship's own forces compose in — the facing
// turns, thrust is applied along it, the drag is applied, and the speed is
// capped — and `specs/simulation.md` places that whole group first in the tick,
// before the well acts on anything. The functions below are that group, split
// so the tick can put the well's acceleration between the thrust and the
// integration.
//
// The slide along the core (`specs/collision.md`) lives here too. It is the one
// non-lethal contact in the game: the ship is pushed back out to the surface,
// the component of its velocity heading into the core is removed, the component
// along the surface is kept, and the facing is left alone, so the player keeps
// full control throughout. It runs whether or not the ship's lethal contact
// gate is on, because the two are separate rules.

import {
  CORE_R,
  FACE_UP,
  SAFE_X,
  SAFE_Y,
  SHIP_DRAG_HALFLIFE,
  SHIP_MAX,
  SHIP_R,
  SHIP_THRUST,
  SHIP_TURN,
  STAR_X,
  STAR_Y,
  TICK_DT,
} from "./constants";
import { deltaX, deltaY, wrapX, wrapY } from "./geometry";
import type { Accel } from "./gravity";
import type { ShatterState, ShipState } from "./game";

/** How much of its speed an un-thrusting ship keeps over one tick. */
const DRAG_PER_TICK = Math.pow(0.5, TICK_DT / SHIP_DRAG_HALFLIFE);

/**
 * The ship's control forces for this tick: the facing turns at the stated rate
 * while a turn key is held, and thrust is taken along the facing it ends at.
 *
 * Rotation changes the facing alone and never the velocity.
 */
export function shipControlForces(state: ShatterState): Accel {
  const ship = state.ship;
  const intent = state.input;

  const turn = (intent.right ? 1 : 0) - (intent.left ? 1 : 0);
  if (turn !== 0) ship.angle += turn * SHIP_TURN * TICK_DT;

  ship.thrusting = intent.thrust;
  if (!ship.thrusting) return { ax: 0, ay: 0 };

  return {
    ax: Math.cos(ship.angle) * SHIP_THRUST,
    ay: Math.sin(ship.angle) * SHIP_THRUST,
  };
}

/**
 * The drag and the speed cap, applied to the velocity the accelerations of this
 * tick have already been added to (`specs/simulation.md`, step 3).
 */
export function settleShipVelocity(ship: ShipState): void {
  ship.vx *= DRAG_PER_TICK;
  ship.vy *= DRAG_PER_TICK;

  const speed = Math.hypot(ship.vx, ship.vy);
  if (speed > SHIP_MAX) {
    const scale = SHIP_MAX / speed;
    ship.vx *= scale;
    ship.vy *= scale;
  }
}

/**
 * The slide: the ship grazes around the core's surface rather than through it.
 *
 * The push-out is radial, to exactly `CORE_R + SHIP_R` from the star's centre,
 * and only the inward component of the velocity is removed, so a ship that
 * arrives across the surface keeps the speed it arrived with along it.
 */
export function slideAlongCore(ship: ShipState): void {
  const dx = deltaX(STAR_X, ship.x);
  const dy = deltaY(STAR_Y, ship.y);
  const d = Math.hypot(dx, dy);
  const surface = CORE_R + SHIP_R;
  if (d >= surface) return;

  // A ship exactly on the star's centre is pushed out along its own facing, so
  // the degenerate case still leaves it on the surface.
  const nx = d === 0 ? Math.cos(ship.angle) : dx / d;
  const ny = d === 0 ? Math.sin(ship.angle) : dy / d;

  ship.x = wrapX(STAR_X + nx * surface);
  ship.y = wrapY(STAR_Y + ny * surface);

  const inward = ship.vx * nx + ship.vy * ny;
  if (inward < 0) {
    ship.vx -= inward * nx;
    ship.vy -= inward * ny;
  }
}

/** A life beginning: at rest at the safe point, facing straight up. */
export function placeShipAtSafePoint(state: ShatterState): void {
  const ship = state.ship;
  ship.x = SAFE_X;
  ship.y = SAFE_Y;
  ship.vx = 0;
  ship.vy = 0;
  ship.angle = FACE_UP;
  ship.thrusting = false;
}
