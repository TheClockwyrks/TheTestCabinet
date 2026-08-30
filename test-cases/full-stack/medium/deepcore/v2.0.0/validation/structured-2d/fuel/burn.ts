// fuel — the thrust burn's curve, as the specification states it.
//
// Not a suite: a transcription three of them share. `specs/character.md` gives
// the burn while thrust is held as
// `THRUST_BURN_MAX + (THRUST_BURN_MIN - THRUST_BURN_MAX) * min(1, up / CRUISE_SPEED)`,
// where `up` is the miner's upward speed, and then multiplies the result by the
// world size's `THRUST_BURN_SIZE_MULT`. Stated once here rather than re-derived
// in each check, so the target cannot drift file by file.

import {
  CRUISE_SPEED,
  THRUST_BURN_MAX,
  THRUST_BURN_MIN,
} from "../../src/constants";

/** The thrust burn, in fuel per second, at an upward speed of `up`. */
export function thrustBurnAt(up: number): number {
  return (
    THRUST_BURN_MAX +
    (THRUST_BURN_MIN - THRUST_BURN_MAX) * Math.min(1, up / CRUISE_SPEED)
  );
}
