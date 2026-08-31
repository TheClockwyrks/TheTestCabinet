// presentation/sprites — the spots this category poses its sprites on, and the
// reading that attributes a blit to the object standing there.
//
// specs/assets.md draws every produced sprite "at native size, centered on its
// object", so the blit painted FOR an object is the one whose center landed on
// the object's center, and a whole-canvas image never attributes to anything:
// its center is the stage's, not the object's.
//
// The spots themselves are chosen for emptiness: radius 200 sits outside the
// deflector's pod-catch radius (196) and inside every ring contact (282), so a
// ball or pod posed there touches nothing while a frame is read, and a
// stationary ball posed on one stays on it.

import { blitsNear, polarToXy, type Blit, type Harness } from "../harness";

/** An empty annulus: outside the deflector's reads, inside every ring's. */
export const CLEAR_RADIUS = 200;

/** Where the category's free-standing ball is posed: (500, 300). */
export const FREE_BALL_THETA = 270;

/**
 * How far, in logical units, a sprite's blit center may sit from the object it
 * is drawn on: rounding through the fit is under a unit, and the nearest other
 * thing a blit could belong to is many times farther.
 */
export const SPRITE_ATTRIBUTION_UNITS = 6;

/** The id of the last blit centered on the logical point, or null for none. */
export function spriteNear(
  h: Harness,
  blits: readonly Blit[],
  x: number,
  y: number,
  within: number,
): string | null {
  const found = blitsNear(h, blits, x, y, within);
  return found.length === 0 ? null : found[found.length - 1].id;
}

/** The id of the last blit centered on the polar spot, or null for none. */
export function spriteAtPolar(
  h: Harness,
  blits: readonly Blit[],
  r: number,
  thetaDeg: number,
): string | null {
  const at = polarToXy(r, thetaDeg);
  return spriteNear(h, blits, at.x, at.y, SPRITE_ATTRIBUTION_UNITS);
}
