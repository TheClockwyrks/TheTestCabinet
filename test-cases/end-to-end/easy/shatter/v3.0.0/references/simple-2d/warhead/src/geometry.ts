// Shatter — the field's geometry: the wrap, the shortest separation across it,
// the well's pull, and the swept circle test.
//
// The field is a torus (`specs/field.md`), and three consequences of that live
// here because every other module needs them and none of them belongs to one
// body:
//
//   * `wrapX` / `wrapY` bring a coordinate back into the field.
//   * `deltaX` / `deltaY` give the SHORTEST separation across the seams, which
//     is what `specs/field.md` says every distance in this game is measured by.
//   * `sweptHit` decides whether two circles touched at any point of a tick
//     rather than only at its end. `specs/collision.md` requires collision that
//     is swept or continuous, and the figures make that load-bearing rather than
//     pedantic: a bullet of radius 3 travelling at the muzzle speed off a capped
//     ship covers 10 units in a tick, so a test that only looks at where bodies
//     ended passes straight through a Small rock.

import { FIELD_H, FIELD_W, MU, SOFTEN, STAR_X, STAR_Y } from "./constants";

/** A coordinate brought back into `[0, size)`. */
export function wrap(value: number, size: number): number {
  const r = value % size;
  return r < 0 ? r + size : r;
}

/** An `x` brought back into the field. */
export function wrapX(x: number): number {
  return wrap(x, FIELD_W);
}

/** A `y` brought back into the field. */
export function wrapY(y: number): number {
  return wrap(y, FIELD_H);
}

/** The shortest separation `b - a` along one axis, across the seam. */
export function shortest(a: number, b: number, size: number): number {
  const d = (b - a) % size;
  if (d >= size / 2) return d - size;
  if (d < -size / 2) return d + size;
  return d;
}

/** The shortest horizontal separation from `ax` to `bx`. */
export function deltaX(ax: number, bx: number): number {
  return shortest(ax, bx, FIELD_W);
}

/** The shortest vertical separation from `ay` to `by`. */
export function deltaY(ay: number, by: number): number {
  return shortest(ay, by, FIELD_H);
}

/** The shortest wrapped distance between two positions. */
export function wrappedDistance(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  return Math.hypot(deltaX(ax, bx), deltaY(ay, by));
}

/**
 * The acceleration the star gives a body at `(x, y)`, as `[ax, ay]`.
 *
 * `specs/gravity.md`: the magnitude is `MU / max(d, SOFTEN)^2` and the direction
 * is the unit vector from the body to the star's centre. The vector is the
 * DIRECT one, not a wrapped one, so a body near a corner is pulled by its full
 * distance across the field.
 */
export function gravityAt(x: number, y: number): readonly [number, number] {
  const dx = STAR_X - x;
  const dy = STAR_Y - y;
  const d = Math.hypot(dx, dy);
  if (d === 0) return [0, 0];
  const eff = Math.max(d, SOFTEN);
  const mag = MU / (eff * eff);
  return [(dx / d) * mag, (dy / d) * mag];
}

/**
 * The moment in `[0, 1]` at which two circles first touch, or `null`.
 *
 * `px, py` is the separation between the two centres at the start of the tick,
 * `wx, wy` the relative displacement over the whole tick, and `r` the sum of the
 * two radii. Circles already overlapping at the start report `0`.
 */
export function sweptTime(
  px: number,
  py: number,
  wx: number,
  wy: number,
  r: number,
): number | null {
  const c = px * px + py * py - r * r;
  if (c <= 0) return 0;

  const a = wx * wx + wy * wy;
  if (a === 0) return null;

  const b = 2 * (px * wx + py * wy);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;

  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}

/** Whether two circles touched at any point of a tick. */
export function sweptHit(
  px: number,
  py: number,
  wx: number,
  wy: number,
  r: number,
): boolean {
  return sweptTime(px, py, wx, wy, r) !== null;
}

/** The angle `a` brought into `(-PI, PI]`. */
export function normalizeAngle(a: number): number {
  let r = a % (Math.PI * 2);
  if (r > Math.PI) r -= Math.PI * 2;
  if (r <= -Math.PI) r += Math.PI * 2;
  return r;
}
