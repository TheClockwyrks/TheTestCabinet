// Spectra — the resonance meter and the discharge (`specs/resonance.md`).
//
// The meter is filled by exactly two events, both of them elsewhere: the hull
// absorbing an enemy bullet of its own band, and one of the player's bullets
// destroying a drone by matching its band. This file owns the ceiling those two
// add against, and the wave the meter pays for.
//
// The WAVE is a circle centred on the ship whose radius grows from `0` to
// `DISCHARGE_MAX_R` over `DISCHARGE_TIME`, and it reaches a thing when that
// thing's centre lies inside the current radius. It is band-blind: what band the
// ship holds and what band a thing carries change nothing about what it takes.
// The radius is the whole of the wave's clock — how far it has run is the radius
// it has reached — so nothing else about it is carried.

import {
  DISCHARGE_MAX_R,
  DISCHARGE_TIME,
  RESONANCE_MAX,
  SHIP_Y,
} from "./constants";
import type { SpectraState } from "./game";

/** How fast the wave's radius grows. */
const GROWTH = DISCHARGE_MAX_R / DISCHARGE_TIME;

/** Add to the meter, which caps at `RESONANCE_MAX` and never passes it. */
export function fillResonance(state: SpectraState, amount: number): void {
  state.resonance = Math.min(RESONANCE_MAX, state.resonance + amount);
}

/** Whether a discharge is available: exactly at full, and not one point below. */
export function dischargeReady(resonance: number): boolean {
  return resonance >= RESONANCE_MAX;
}

/**
 * The discharge action.
 *
 * At full it spends the whole meter and starts the wave; below full it does
 * nothing at all — the meter is unchanged and no wave starts.
 */
export function releaseDischarge(state: SpectraState): boolean {
  if (!dischargeReady(state.resonance)) return false;
  state.resonance = 0;
  state.discharge.active = true;
  state.discharge.radius = 0;
  return true;
}

/** Grow a live wave, and stop it once it has covered its whole radius. */
export function stepDischarge(state: SpectraState, h: number): void {
  if (!state.discharge.active) return;
  state.discharge.radius += GROWTH * h;
  if (state.discharge.radius >= DISCHARGE_MAX_R) {
    state.discharge.active = false;
    state.discharge.radius = 0;
  }
}

/** Whether the live wave has reached the centre `(x, y)`. */
export function waveReaches(
  state: SpectraState,
  x: number,
  y: number,
): boolean {
  if (!state.discharge.active) return false;
  return Math.hypot(x - state.ship.x, y - SHIP_Y) <= state.discharge.radius;
}
