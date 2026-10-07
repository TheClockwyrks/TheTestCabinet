// Shatter — the geometry of a torus: the wrap, the shortest separation across
// it, and the swept circle test collision rests on.
//
// `specs/field.md` fixes the wrap and the shortest wrapped separation, and
// `specs/collision.md` fixes that collision is swept or continuous — no body
// passes through another in a tick, however fast either was travelling. Both
// are stated here once and used everywhere, so nothing in the game measures a
// distance the wrong way round.

import { FIELD_H, FIELD_W } from "./constants";

/** A full turn, in radians. */
export const TAU = Math.PI * 2;

/** Brings an `x` back into `[0, FIELD_W)`. */
export function wrapX(x: number): number {
  return ((x % FIELD_W) + FIELD_W) % FIELD_W;
}

/** Brings a `y` back into `[0, FIELD_H)`. */
export function wrapY(y: number): number {
  return ((y % FIELD_H) + FIELD_H) % FIELD_H;
}

/** Brings a difference into `[-size / 2, +size / 2)`. */
function shortest(delta: number, size: number): number {
  const half = size / 2;
  return ((((delta + half) % size) + size) % size) - half;
}

/** The shortest wrapped `x` from `fromX` to `toX`. */
export function deltaX(fromX: number, toX: number): number {
  return shortest(toX - fromX, FIELD_W);
}

/** The shortest wrapped `y` from `fromY` to `toY`. */
export function deltaY(fromY: number, toY: number): number {
  return shortest(toY - fromY, FIELD_H);
}

/** The length of the shortest wrapped separation between two positions. */
export function wrappedDistance(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  return Math.hypot(deltaX(ax, bx), deltaY(ay, by));
}

/** An angle brought into `[-PI, PI)`. */
export function normalizeAngle(angle: number): number {
  return ((((angle + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
}

/**
 * The fraction of a step at which two circles first touch, or `null` when they
 * never do over that step.
 *
 * `relX`/`relY` is the separation from the first circle to the second at the
 * start of the step, `moveX`/`moveY` is the second's motion over the step less
 * the first's, and `radius` is the sum of the two radii. Circles already
 * overlapping at the start touch at `0`.
 */
export function sweptTime(
  relX: number,
  relY: number,
  moveX: number,
  moveY: number,
  radius: number,
): number | null {
  const c = relX * relX + relY * relY - radius * radius;
  if (c <= 0) return 0;

  const a = moveX * moveX + moveY * moveY;
  if (a === 0) return null;

  const b = 2 * (relX * moveX + relY * moveY);
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;

  const t = (-b - Math.sqrt(discriminant)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}
