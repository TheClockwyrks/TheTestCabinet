// Shatter — the torus the whole game is measured on.
//
// `specs/field.md` fixes three rules and every other file leans on them: the
// field wraps on both axes, the separation between two positions is the
// SHORTEST one across the seams, and `specs/collision.md` requires collision
// that is swept or continuous, so no body passes through another in a tick.
//
// A bullet of radius 3 travelling at up to MUZZLE_SPEED + SHIP_MAX covers ten
// units in one tick of TICK_DT, so a discrete per-tick overlap test would let
// it pass clean through a Small. `sweptTime` is therefore the one contact test
// the game has: it solves for the first instant in the tick at which two
// circles closing along straight lines come within the sum of their radii.

import { FIELD_H, FIELD_W } from "./constants";

/** A coordinate brought back into the field, on the x axis. */
export function wrapX(x: number): number {
  return ((x % FIELD_W) + FIELD_W) % FIELD_W;
}

/** A coordinate brought back into the field, on the y axis. */
export function wrapY(y: number): number {
  return ((y % FIELD_H) + FIELD_H) % FIELD_H;
}

/** One axis of the shortest wrapped separation, from `a` to `b`. */
function shortest(a: number, b: number, size: number): number {
  let d = (b - a) % size;
  const half = size / 2;
  if (d >= half) d -= size;
  else if (d < -half) d += size;
  return d;
}

/** The x component of the shortest wrapped separation from `ax` to `bx`. */
export function deltaX(ax: number, bx: number): number {
  return shortest(ax, bx, FIELD_W);
}

/** The y component of the shortest wrapped separation from `ay` to `by`. */
export function deltaY(ay: number, by: number): number {
  return shortest(ay, by, FIELD_H);
}

/** The distance between two positions, by the shortest wrapped separation. */
export function wrappedDistance(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  return Math.hypot(deltaX(ax, bx), deltaY(ay, by));
}

/**
 * The first instant in `[0, dt]` at which two circles of combined radius `r`
 * come into contact, or `null` for a tick in which they never do.
 *
 * Each body is given the position it held at the START of the tick and the
 * velocity it crossed the tick with, so the whole of the tick's travel is
 * tested rather than its two endpoints. Circles already overlapping at the
 * start of the tick contact at `0`.
 */
export function sweptTime(
  ax: number,
  ay: number,
  avx: number,
  avy: number,
  bx: number,
  by: number,
  bvx: number,
  bvy: number,
  r: number,
  dt: number,
): number | null {
  const rx = deltaX(ax, bx);
  const ry = deltaY(ay, by);
  const c = rx * rx + ry * ry - r * r;
  if (c <= 0) return 0;

  const vx = bvx - avx;
  const vy = bvy - avy;
  const a = vx * vx + vy * vy;
  if (a === 0) return null;

  const b = 2 * (rx * vx + ry * vy);
  // A non-negative b is a pair already moving apart, which never closes.
  if (b >= 0) return null;

  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;

  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= dt ? t : null;
}

/** Whether two circles come into contact anywhere in the tick. */
export function sweptHit(
  ax: number,
  ay: number,
  avx: number,
  avy: number,
  bx: number,
  by: number,
  bvx: number,
  bvy: number,
  r: number,
  dt: number,
): boolean {
  return sweptTime(ax, ay, avx, avy, bx, by, bvx, bvy, r, dt) !== null;
}
