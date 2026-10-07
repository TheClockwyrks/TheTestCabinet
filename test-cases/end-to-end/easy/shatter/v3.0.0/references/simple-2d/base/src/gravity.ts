// Shatter — the star's well (`specs/gravity.md`).
//
// One law, applied to every BALLISTIC body every tick: the ship's bullets, the
// saucer's bullets, and every rock. The ship and the saucer are powered craft
// with their own drive, and the well never adds anything to either, whatever
// their distance from the star — which is what keeps the star from ever
// wresting the ship out of the player's hands.
//
// Two details of the law are load-bearing and easy to get wrong:
//
//   * The magnitude is SOFTENED. Inside `SOFTEN` the distance used is `SOFTEN`
//     itself, so a body falling onto the core is pulled no harder than one at
//     `d = 90` and the acceleration never runs away.
//   * The pull uses the body's DIRECT vector to the star, not the shortest
//     wrapped one. A body near a corner is therefore pulled by its full
//     distance across the field rather than toward a wrapped image of the star.

import { MU, SOFTEN, STAR_X, STAR_Y } from "./constants";

/** The acceleration the well gives a body at `(x, y)`, in units per second squared. */
export function gravityAt(x: number, y: number): readonly [number, number] {
  const dx = STAR_X - x;
  const dy = STAR_Y - y;
  const d = Math.hypot(dx, dy);
  if (d === 0) return [0, 0];
  const dEff = Math.max(d, SOFTEN);
  const aMag = MU / (dEff * dEff);
  return [(aMag * dx) / d, (aMag * dy) / d];
}
