// Spectra — the resonance meter and the discharge it pays for
// (`specs/resonance.md`).
//
// The meter is filled by exactly two events, both of them elsewhere: the hull
// absorbing an enemy bullet of its own band, and one of the player's bullets
// destroying a drone by matching its band. What lives here is the ceiling those
// two respect, the release, and the wave the release starts.
//
// The wave carries no clock of its own. Its radius grows from nothing to
// `DISCHARGE_MAX_R` over `DISCHARGE_TIME`, so the radius IS the clock and the
// declared state stays exactly what `specs/state.md` names.

import {
  CUES,
  DISCHARGE_MAX_R,
  DISCHARGE_TIME,
  RESONANCE_MAX,
} from "./constants";
import { dischargeReady } from "./bands";
import type { FrameEvents, Sim } from "./sim";

/** How fast the wave's radius grows, in logical units per second. */
const DISCHARGE_RATE = DISCHARGE_MAX_R / DISCHARGE_TIME;

/** Add to the meter, which caps at `RESONANCE_MAX` and never decays. */
export function fillResonance(sim: Sim, points: number): void {
  sim.resonance = Math.min(RESONANCE_MAX, sim.resonance + points);
}

/**
 * Release a discharge, which needs a full meter.
 *
 * Below the ceiling the action does nothing: the meter is unchanged and no wave
 * starts.
 */
export function releaseDischarge(sim: Sim, ev: FrameEvents): void {
  if (!dischargeReady(sim.resonance)) return;
  sim.resonance = 0;
  sim.discharge = { active: true, radius: 0 };
  ev.cues.add(CUES.discharge);
}

/** Grow the live wave's radius by `h` seconds of travel. */
export function advanceDischarge(sim: Sim, h: number): void {
  if (!sim.discharge.active) return;
  sim.discharge.radius += DISCHARGE_RATE * h;
}

/** Whether the wave has run its whole span. */
export function dischargeSpent(sim: Sim): boolean {
  return sim.discharge.radius >= DISCHARGE_MAX_R;
}

/** Stop the wave and carry none until the next discharge. */
export function endDischarge(sim: Sim): void {
  sim.discharge = { active: false, radius: 0 };
}
