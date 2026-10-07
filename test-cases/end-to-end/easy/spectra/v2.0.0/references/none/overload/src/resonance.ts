// Spectra — the resonance meter and the discharge it pays for.
//
// `specs/resonance.md` fixes two events that fill the meter and exactly one that
// lowers it, so this file is small on purpose: there is no decay, no drain and no
// bonus, and nothing else in the build writes `state.resonance` except through
// {@link fillMeter} and {@link releaseDischarge}.
//
// THE WAVE IS AN OUTCOME, NOT A POSE. The discharge surface carries no operation
// that discharges (`specs/instrumentation.md`): a caller poses the meter and drives
// the real action, and `discharge.active` and `discharge.radius` are reported and
// never set. What the wave TAKES is resolved with the rest of the contacts, in
// `src/combat.ts`.

import { DISCHARGE_MAX_R, DISCHARGE_TIME, RESONANCE_MAX } from "./constants";
import type { SpectraState } from "./types";

/** Whether a discharge is available: exactly at a full meter, not one below. */
export function dischargeReady(state: SpectraState): boolean {
  return state.resonance >= RESONANCE_MAX;
}

/** Add to the meter, capped at `RESONANCE_MAX`. */
export function fillMeter(state: SpectraState, amount: number): void {
  state.resonance = Math.min(RESONANCE_MAX, state.resonance + amount);
}

/**
 * Spend a full meter and start the wave.
 *
 * Returns whether anything happened: below `RESONANCE_MAX` the action does nothing,
 * the meter is unchanged and no wave starts.
 */
export function releaseDischarge(state: SpectraState): boolean {
  if (!dischargeReady(state)) return false;
  state.resonance = 0;
  state.discharge.active = true;
  state.discharge.elapsed = 0;
  state.discharge.radius = 0;
  return true;
}

/**
 * Advance a live wave by `h` seconds.
 *
 * Its radius grows from `0` to `DISCHARGE_MAX_R` over `DISCHARGE_TIME`, and when
 * its time runs out it stops and the game carries no wave until the next discharge.
 */
export function stepDischarge(state: SpectraState, h: number): void {
  const wave = state.discharge;
  if (!wave.active) return;
  wave.elapsed += h;
  if (wave.elapsed >= DISCHARGE_TIME) {
    wave.active = false;
    wave.elapsed = 0;
    wave.radius = 0;
    return;
  }
  wave.radius = DISCHARGE_MAX_R * (wave.elapsed / DISCHARGE_TIME);
}
