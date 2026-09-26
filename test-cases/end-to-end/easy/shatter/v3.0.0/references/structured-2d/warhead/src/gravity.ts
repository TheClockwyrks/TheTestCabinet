// Shatter — the star's pull.
//
// `specs/gravity.md` fixes the law and the bodies it acts on: every bullet,
// every saucer bullet and every rock is pulled, and the ship, the saucer and the
// torpedo — powered craft with their own drive — never are. The pull uses the
// body's DIRECT vector to the star's centre rather than a wrapped one, so a body
// near a corner is pulled by its full distance across the field.

import { MU, SOFTEN, STAR_X, STAR_Y } from "./constants";
import type { Positioned } from "./motion";

/** An acceleration, in units per second squared. */
export interface Accel {
  ax: number;
  ay: number;
}

/**
 * The acceleration the star gives a pulled body at `(x, y)`.
 *
 * Inside `SOFTEN` the magnitude is capped at `MU / SOFTEN^2`, so a body
 * approaching the core is pulled no harder than one at that distance.
 */
export function gravityAt(x: number, y: number): Accel {
  const dx = STAR_X - x;
  const dy = STAR_Y - y;
  const d = Math.hypot(dx, dy);
  if (d === 0) return { ax: 0, ay: 0 };

  const effective = Math.max(d, SOFTEN);
  const magnitude = MU / (effective * effective);
  return { ax: (magnitude * dx) / d, ay: (magnitude * dy) / d };
}

/** Add one tick of the star's pull to a ballistic body's velocity. */
export function applyGravity(
  body: Positioned & { vx: number; vy: number },
  dt: number,
): void {
  const { ax, ay } = gravityAt(body.x, body.y);
  body.vx += ax * dt;
  body.vy += ay * dt;
}
