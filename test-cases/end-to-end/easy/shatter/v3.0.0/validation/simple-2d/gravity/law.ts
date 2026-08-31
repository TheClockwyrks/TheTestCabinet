// gravity — the small vector arithmetic this group's nine checks read the well
// with, and nothing else.
//
// LOCAL TO THIS GROUP ON PURPOSE. `validation/simple-2d/geometry.ts` is the
// project's oracle: it owns the law itself (`gravityAt`, `gravityMagnitude`,
// `directDistanceToStar`), the torus (`separation`, `distance`, `wrap`) and the
// angle vocabulary (`angleBetween`, `angleGap`). What is here is the handful of
// plain vector operations only the `gravity` checks reach for — placing a sample
// on a bearing around the star, and splitting a deviation into the part along a
// shot's heading and the part across it — so it lives beside them and leaves the
// shared file, which other groups are editing, alone.
//
// NOTHING HERE FIXES A THRESHOLD, and nothing here restates the law. The pull
// comes out of `geometry.ts`, which computes it from `specs/gravity.md`'s own
// `MU` and `SOFTEN`; every bound is stated in the check that asserts it.

import { TICK_DT } from "../../src/constants";
import { STAR, gravityMagnitude, type Point } from "../geometry";

export type { Point };

/** The sum of two vectors. */
export function add(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y };
}

/** The vector FROM `b` TO `a`, taken directly rather than across a seam. */
export function subtract(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}

/** A vector scaled by a scalar. */
export function scale(v: Point, k: number): Point {
  return { x: v.x * k, y: v.y * k };
}

/** The length of a vector. */
export function magnitude(v: Point): number {
  return Math.hypot(v.x, v.y);
}

/**
 * A body's velocity as a vector, so a reading and a pose are the same shape.
 *
 * `geometry.ts`'s `speedOf` and `headingOf` take the `{ vx, vy }` a snapshot
 * reports; the arithmetic below is over `{ x, y }`, and this is the one
 * conversion between them.
 */
export function velocityOf(entity: { vx: number; vy: number }): Point {
  return { x: entity.vx, y: entity.vy };
}

/**
 * The direction a vector points, in radians, measured clockwise from the
 * positive x axis — the convention `specs/overview.md` fixes for the field
 * (origin top-left, x right, y down).
 *
 * A vector of length zero answers `0`, which is a real bearing rather than a
 * refusal: a body the well never touched must reach a VERDICT on the direction
 * it was pulled in, and `0` is a bearing every sample this group poses is more
 * than its tolerance away from. See `pull-direction`.
 */
export function bearingOf(v: Point): number {
  return Math.atan2(v.y, v.x);
}

/**
 * The unit vector on `bearing` radians, in the same clockwise-from-+x convention.
 */
export function unitAt(bearing: number): Point {
  return { x: Math.cos(bearing), y: Math.sin(bearing) };
}

/** The field position exactly `distance` from the star's centre, on `bearing`. */
export function pointAt(distance: number, bearing: number): Point {
  return add(STAR, scale(unitAt(bearing), distance));
}

/**
 * How much of `v` lies ACROSS `along`, signed positive a quarter-turn clockwise
 * of it.
 *
 * Clockwise because the field's y axis runs down (`specs/overview.md`), so for a
 * shot travelling right this answers the downward component. A check that asks
 * "was it deflected toward the star" takes this of the deviation and of the
 * star's own offset, and requires the two to share a sign — so which way "toward"
 * is comes out of the pose rather than being written down and going stale.
 */
export function componentAcross(v: Point, along: Point): number {
  const length = magnitude(along);
  if (length === 0) return 0;
  const ux = along.x / length;
  const uy = along.y / length;
  return v.x * -uy + v.y * ux;
}

/**
 * The speed the well's own law gives a body AT REST at `p` over exactly one tick.
 *
 * `specs/simulation.md` orders a tick as control forces, then the gravity
 * acceleration, then velocity, then position, so a body posed at rest holds
 * `aMag * TICK_DT` of velocity after one tick and nothing besides. `aMag` is
 * `geometry.ts`'s reading of `specs/gravity.md` — `MU / max(d, SOFTEN)^2` on the
 * DIRECT distance — so nothing here interprets the law a second time.
 */
export function gainAtRest(p: Point): number {
  return gravityMagnitude(p) * TICK_DT;
}
