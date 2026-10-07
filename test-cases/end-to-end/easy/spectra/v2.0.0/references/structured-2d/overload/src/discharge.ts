// Spectra — the screen-clearing discharge (specs/resonance.md).
//
// A discharge wave is a circle centred on the ship, live for `DISCHARGE_TIME`
// from the action, its radius growing from `0` to `DISCHARGE_MAX_R` over that
// span. It reaches a thing when that thing's centre lies inside the current
// radius, which is the one exception to the circle-against-circle contact model
// `specs/simulation.md` states.
//
// The wave is band-blind: what band the ship holds and what band a thing carries
// change nothing about what it takes. It destroys every entering, diving and
// returning drone — a Prism whole, shell and core together — clears every enemy
// bullet, and spares the formation and the player's own bullets.

import { DISCHARGE_MAX_R, DISCHARGE_TIME, SHIP_Y } from "./constants";
import { destroyWhole, type Removal } from "./destroy";
import type { SpectraState } from "./game";

/** How fast the wave's radius grows, in logical units per second. */
const GROWTH = DISCHARGE_MAX_R / DISCHARGE_TIME;

/** Grow the live wave by `h` seconds, and end it when its span has run. */
export function advanceDischarge(state: SpectraState, h: number): void {
  if (!state.discharge.active) return;
  state.discharge.radius += GROWTH * h;
  if (state.discharge.radius < DISCHARGE_MAX_R) return;
  state.discharge.active = false;
  state.discharge.radius = 0;
}

/** Whether the live wave has reached a point. */
export function dischargeReaches(
  state: SpectraState,
  x: number,
  y: number,
): boolean {
  if (!state.discharge.active) return false;
  const gap = Math.hypot(x - state.ship.x, y - SHIP_Y);
  return gap <= state.discharge.radius;
}

/** Step four of a sub-step: what the live wave has reached, it takes. */
export function resolveDischarge(state: SpectraState, removal: Removal): void {
  if (!state.discharge.active) return;

  for (const drone of state.drones) {
    if (drone.phase === "formation") continue;
    if (!dischargeReaches(state, drone.x, drone.y)) continue;
    destroyWhole(state, drone, removal);
  }

  for (const bullet of state.bullets) {
    if (bullet.friendly) continue;
    if (!dischargeReaches(state, bullet.x, bullet.y)) continue;
    removal.bullets.add(bullet.id);
  }
}
