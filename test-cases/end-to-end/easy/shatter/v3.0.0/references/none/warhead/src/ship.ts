// Shatter — the ship's tick: what the player's hands do to it, and what the field
// does back.
//
// `specs/ship.md` fixes the four steps and their order — the facing turns, thrust
// is applied along it, the drag is applied, and the speed is capped — and
// `specs/gravity.md` fixes that the well never touches it, so the ship goes
// exactly where it is steered. `specs/collision.md` fixes the one thing the field
// does to it without costing anything: the slide along the star's core.

import {
  SHIP_DRAG_HALFLIFE,
  SHIP_MAX,
  SHIP_R,
  SHIP_THRUST,
  SHIP_TURN,
  TICK_DT,
} from "./constants";
import { slideOffCore, travel } from "./motion";
import type { UpdateApi } from "./runtime";
import type { ShatterState } from "./types";

/** The acceleration the player's hands ask for this tick, in units per second squared. */
export interface ControlForce {
  ax: number;
  ay: number;
}

/**
 * Step 1 of the tick for the ship: the facing turns, and the thrust the facing
 * would take is worked out.
 *
 * The rotation is applied here because `specs/ship.md` puts it first and says it
 * changes the facing ALONE; the thrust is only measured here and is added to the
 * velocity in {@link integrateShip}, which is where the specification's step 3
 * puts every acceleration.
 */
export function shipControl(state: ShatterState, api: UpdateApi): ControlForce {
  const ship = state.ship;
  const turn = api.input.value("right") - api.input.value("left");
  ship.angle += turn * SHIP_TURN * TICK_DT;

  ship.thrusting = api.input.value("thrust") > 0;
  if (!ship.thrusting) return { ax: 0, ay: 0 };
  return {
    ax: Math.cos(ship.angle) * SHIP_THRUST,
    ay: Math.sin(ship.angle) * SHIP_THRUST,
  };
}

/**
 * Steps 3 to 6 of the tick for the ship: the thrust reaches the velocity, the
 * drag bleeds it, the cap holds it, the ship travels and wraps, and the core
 * pushes it off if it reached one.
 */
export function integrateShip(state: ShatterState, force: ControlForce): void {
  const ship = state.ship;
  ship.vx += force.ax * TICK_DT;
  ship.vy += force.ay * TICK_DT;

  // Half the speed every SHIP_DRAG_HALFLIFE seconds of game time, which is the
  // rule `specs/ship.md` states rather than a per-tick factor of its own.
  const drag = Math.pow(0.5, TICK_DT / SHIP_DRAG_HALFLIFE);
  ship.vx *= drag;
  ship.vy *= drag;

  const speed = Math.hypot(ship.vx, ship.vy);
  if (speed > SHIP_MAX) {
    const scale = SHIP_MAX / speed;
    ship.vx *= scale;
    ship.vy *= scale;
  }

  travel(ship, TICK_DT);
  // Non-lethal and ungated: `specs/instrumentation.md` says in as many words that
  // the ship's contact gate leaves the slide alone.
  slideOffCore(ship, SHIP_R);
}

/** Run the respawn grace down, one tick's worth. */
export function tickInvulnerability(state: ShatterState): void {
  state.ship.invuln = Math.max(0, state.ship.invuln - TICK_DT);
}
