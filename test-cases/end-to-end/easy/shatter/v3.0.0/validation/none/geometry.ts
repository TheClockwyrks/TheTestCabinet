// Shatter — the spec-derived oracle. CASE-PROVIDED.
//
// The field is a torus with a star in the middle, and four rules follow from that
// which almost every check in this project needs and none of them should
// re-derive: how a position is brought back into the field, what the shortest
// separation between two positions is across the seams, what the well does to a
// body at a given place, and whether two circles moving over one tick came within
// touching distance at any point of it.
//
// EVERY LINE BELOW IS WRITTEN FROM `specs/`, AND NONE OF IT FROM A BUILD. The
// wrap and the shortest wrapped separation are `specs/field.md`; the pull law is
// `specs/gravity.md`; the swept circle test is the "collision is swept or
// continuous... no body passes through another in a tick" requirement of
// `specs/collision.md`. A build is free to reach the same answers any way it
// likes, and how it gets there is never asserted — what is asserted is the
// observable each spec fixes, against the figure this file computes.
//
// THIS IS AN ORACLE, NOT A TOLERANCE. Nothing here holds a threshold: a check
// states its own, next to the figure `specs/` fixes for it, because a bound
// hidden in a shared helper is a bound nobody reading the check can see. What
// this file supplies is the geometry those bounds are measured in.
//
// AND NOTHING HERE TOUCHES THE PAGE. Every function is pure arithmetic over
// numbers a snapshot already reported, so a check can compute what should have
// happened before, during or after it drives anything.

import { FIELD_H, FIELD_W, MU, SOFTEN, STAR_X, STAR_Y } from "./constants";

/** A position or a velocity, in the field's logical units. */
export interface Vec {
  x: number;
  y: number;
}

/* ---- The wrap (specs/field.md) -------------------------------------------- */

/** A coordinate brought into `[0, size)` however far outside it started. */
export function wrapTo(value: number, size: number): number {
  const wrapped = value % size;
  return wrapped < 0 ? wrapped + size : wrapped;
}

/** An `x` brought into `[0, FIELD_W)`. */
export function wrapX(x: number): number {
  return wrapTo(x, FIELD_W);
}

/** A `y` brought into `[0, FIELD_H)`. */
export function wrapY(y: number): number {
  return wrapTo(y, FIELD_H);
}

/** A position brought into the field on both axes. */
export function wrap(point: Vec): Vec {
  return { x: wrapX(point.x), y: wrapY(point.y) };
}

/* ---- The shortest wrapped separation (specs/field.md) --------------------- */

/**
 * One axis's difference `b - a`, brought into `[-size / 2, +size / 2)`.
 *
 * `specs/field.md` states the rule in exactly those words, and states that every
 * distance between two bodies in the specification is measured this way.
 */
export function shortestAxis(a: number, b: number, size: number): number {
  const half = size / 2;
  let delta = (b - a) % size;
  if (delta >= half) delta -= size;
  if (delta < -half) delta += size;
  return delta;
}

/** The shortest separation from `a` to `b` across the seams, as a vector. */
export function shortestDelta(a: Vec, b: Vec): Vec {
  return {
    x: shortestAxis(a.x, b.x, FIELD_W),
    y: shortestAxis(a.y, b.y, FIELD_H),
  };
}

/** The length of that separation: the distance `specs/field.md` defines. */
export function wrappedDistance(a: Vec, b: Vec): number {
  const delta = shortestDelta(a, b);
  return Math.hypot(delta.x, delta.y);
}

/**
 * The distance from a body's centre to the star's, measured DIRECTLY.
 *
 * The one distance in the specification that is not wrapped: `specs/gravity.md`
 * fixes the pull as using the body's direct vector to `(STAR_X, STAR_Y)` rather
 * than a wrapped one, so a body near a corner is pulled by its full distance
 * across the field. `gravity/direct-not-wrapped` is the item that grades it, and
 * this is the reading it is graded against.
 */
export function starDistance(point: Vec): number {
  return Math.hypot(STAR_X - point.x, STAR_Y - point.y);
}

/* ---- The well (specs/gravity.md) ------------------------------------------ */

/** The magnitude of the pull at distance `d`, softened inside `SOFTEN`. */
export function pullMagnitude(d: number): number {
  const effective = Math.max(d, SOFTEN);
  return MU / (effective * effective);
}

/**
 * The acceleration the well gives a pulled body at `point`, as a vector.
 *
 * Directed along the unit vector from the body TOWARD the star's centre, at the
 * softened magnitude above. A body exactly on the star's centre has no direction
 * to be pulled in, and gets none.
 */
export function gravityAt(point: Vec): Vec {
  const dx = STAR_X - point.x;
  const dy = STAR_Y - point.y;
  const d = Math.hypot(dx, dy);
  if (d === 0) return { x: 0, y: 0 };
  const magnitude = pullMagnitude(d);
  return { x: (dx / d) * magnitude, y: (dy / d) * magnitude };
}

/* ---- The swept circle test (specs/collision.md) --------------------------- */

/** What a swept test found: whether the pair touched, and how far into the tick. */
export interface SweptHit {
  hit: boolean;
  /** The fraction of `dt` at which they first came within `radius`, `0` to `1`. */
  t: number;
  /** The nearest their centres came over the tick. */
  closest: number;
}

/**
 * Whether two circles, separated by `rel` and closing at `relVel`, come within
 * `radius` at any point of a tick of `dt` seconds.
 *
 * `specs/collision.md` requires collision to be swept or continuous — "two bodies
 * whose paths over a tick bring them within the sum of their radii at any point of
 * that tick collide on it, however fast either was travelling" — so a check that
 * poses a fast approach computes the answer here and asserts the build reached it.
 * `rel` is the shortest wrapped separation between the two centres, which is what
 * makes the test hold across a seam.
 */
export function sweptHit(
  rel: Vec,
  relVel: Vec,
  radius: number,
  dt: number,
): SweptHit {
  const at = (t: number): number =>
    Math.hypot(rel.x + relVel.x * t, rel.y + relVel.y * t);

  // The separation is a quadratic in `t`; its minimum over the tick is at the
  // vertex when that lies inside the tick, and at an end otherwise.
  const vv = relVel.x * relVel.x + relVel.y * relVel.y;
  const rv = rel.x * relVel.x + rel.y * relVel.y;
  const vertex = vv === 0 ? 0 : -rv / vv;
  const nearest = Math.min(Math.max(vertex, 0), dt);
  const closest = Math.min(at(0), at(dt), at(nearest));
  if (closest > radius) return { hit: false, t: 1, closest };

  // The first crossing of `radius`, from the same quadratic:
  // |rel + relVel t|^2 = radius^2.
  if (vv === 0) return { hit: true, t: 0, closest };
  const c = rel.x * rel.x + rel.y * rel.y - radius * radius;
  const discriminant = rv * rv - vv * c;
  if (discriminant < 0) return { hit: true, t: 0, closest };
  const root = (-rv - Math.sqrt(discriminant)) / vv;
  const entry = Math.min(Math.max(root, 0), dt);
  return { hit: true, t: dt === 0 ? 0 : entry / dt, closest };
}

/**
 * The nearest a moving point came to a fixed one over a straight span between two
 * samples, measured across the seams.
 *
 * WHY THE LINE AND NOT THE SAMPLES. A sweep that samples every few ticks and reads
 * the distance AT each sample reports a body further out than it got, because the
 * closest point of its path lies between two of them — which is the wrong
 * direction for a check hunting a build that came too close. `saucer/avoids-the-core`
 * is the item that turns on this: it strides eight ticks at a time and measures
 * the star's distance to the segment between consecutive samples.
 */
export function segmentDistance(from: Vec, to: Vec, point: Vec): number {
  // Everything in the local frame of `from`, so a span across a seam is a short
  // vector rather than a jump across the field.
  const target = shortestDelta(from, point);
  const span = shortestDelta(from, to);
  const length2 = span.x * span.x + span.y * span.y;
  if (length2 === 0) return Math.hypot(target.x, target.y);
  const along = Math.min(
    Math.max((target.x * span.x + target.y * span.y) / length2, 0),
    1,
  );
  return Math.hypot(target.x - span.x * along, target.y - span.y * along);
}

/**
 * The nearest `point` came to any part of the path through `samples`, in order.
 *
 * The whole of what `saucer/avoids-the-core` reads off one crossing: the closest
 * approach over the span between every consecutive pair, never over the samples
 * alone. A path of fewer than two samples reports the distance to the one it has,
 * and an empty one reports infinity, which no bound clears.
 */
export function closestApproach(samples: readonly Vec[], point: Vec): number {
  if (samples.length === 0) return Number.POSITIVE_INFINITY;
  if (samples.length === 1) return wrappedDistance(samples[0], point);
  let closest = Number.POSITIVE_INFINITY;
  for (let i = 1; i < samples.length; i += 1) {
    closest = Math.min(
      closest,
      segmentDistance(samples[i - 1], samples[i], point),
    );
  }
  return closest;
}

/* ---- Angles (specs/overview.md) ------------------------------------------- */

/** The bearing of a vector, in radians, clockwise from the positive `x` axis. */
export function bearingOf(v: Vec): number {
  return Math.atan2(v.y, v.x);
}

/** The bearing from `a` to `b` across the shortest wrapped separation. */
export function bearingTo(a: Vec, b: Vec): number {
  return bearingOf(shortestDelta(a, b));
}

/** An angle brought into `(-PI, +PI]`. */
export function normalizeAngle(radians: number): number {
  const wrapped = Math.atan2(Math.sin(radians), Math.cos(radians));
  return wrapped;
}

/** The signed turn from `from` to `to`, in radians, the short way round. */
export function angleDelta(from: number, to: number): number {
  return normalizeAngle(to - from);
}

/** The unsigned angle between two bearings, in radians, never more than PI. */
export function angleBetween(a: number, b: number): number {
  return Math.abs(angleDelta(a, b));
}

/** The unit vector along a bearing. */
export function unitAt(radians: number): Vec {
  return { x: Math.cos(radians), y: Math.sin(radians) };
}

/** A vector's length. */
export function magnitude(v: Vec): number {
  return Math.hypot(v.x, v.y);
}

/** `v` scaled to unit length, or the zero vector when it has no length. */
export function normalize(v: Vec): Vec {
  const length = magnitude(v);
  return length === 0 ? { x: 0, y: 0 } : { x: v.x / length, y: v.y / length };
}

/** `a + b`. */
export function add(a: Vec, b: Vec): Vec {
  return { x: a.x + b.x, y: a.y + b.y };
}

/** `a - b`, componentwise and without wrapping; use {@link shortestDelta} for positions. */
export function subtract(a: Vec, b: Vec): Vec {
  return { x: a.x - b.x, y: a.y - b.y };
}

/** `v` scaled by `k`. */
export function scale(v: Vec, k: number): Vec {
  return { x: v.x * k, y: v.y * k };
}

/** `v` turned a quarter turn clockwise: the perpendicular a split kick lies along. */
export function perpendicular(v: Vec): Vec {
  return { x: -v.y, y: v.x };
}

/** The component of `v` along the unit vector `axis`. */
export function componentAlong(v: Vec, axis: Vec): number {
  const unit = normalize(axis);
  return v.x * unit.x + v.y * unit.y;
}

/** The component of `v` across the unit vector `axis`, signed clockwise. */
export function componentAcross(v: Vec, axis: Vec): number {
  return componentAlong(v, perpendicular(axis));
}
