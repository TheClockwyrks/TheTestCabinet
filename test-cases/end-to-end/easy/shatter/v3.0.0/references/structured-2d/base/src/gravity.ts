// Shatter — the star's pull.
//
// `specs/gravity.md` fixes the law, the bodies it acts on, and the bodies it
// never touches. Two details are easy to get wrong and are both stated there:
// the magnitude is CAPPED inside SOFTEN, so a body falling onto the core is
// pulled no harder than one at ninety units; and the pull uses the body's
// DIRECT vector to the star rather than a wrapped one, so a body near a corner
// is pulled by its full distance across the field.

import { MU, SOFTEN, STAR_X, STAR_Y } from "./constants";

/** An acceleration, in logical units per second squared. */
export interface Accel {
  ax: number;
  ay: number;
}

/** No acceleration at all: what a powered craft gains from the well. */
export const NO_ACCEL: Accel = { ax: 0, ay: 0 };

/** The acceleration the well gives a pulled body standing at `(x, y)`. */
export function gravityAccel(x: number, y: number): Accel {
  const dx = STAR_X - x;
  const dy = STAR_Y - y;
  const d = Math.hypot(dx, dy);
  if (d === 0) return { ax: 0, ay: 0 };

  const dEff = Math.max(d, SOFTEN);
  const magnitude = MU / (dEff * dEff);
  return { ax: (dx / d) * magnitude, ay: (dy / d) * magnitude };
}
