// Shatter — the field's geometry: the torus, the well, and the swept overlap
// test.
//
// Four rules from the specification, each as one pure function, so the systems
// that use them read as the rule they implement:
//
//   * The wrap (`specs/field.md`): a coordinate is kept in range modulo the
//     field size, and a body carries its velocity across.
//   * The shortest wrapped separation (`specs/field.md`): every distance between
//     two bodies in this game is measured across the seams, so bodies touching
//     across an edge are adjacent.
//   * The pull (`specs/gravity.md`): inverse-square toward the star's centre,
//     softened inside `SOFTEN`, and along the DIRECT vector rather than a wrapped
//     one, because the star is one physical point rather than a tiled one.
//   * Swept overlap (`specs/collision.md`): two circles whose paths over a tick
//     bring them within the sum of their radii collide on that tick, however fast
//     either was travelling. A bullet crosses ten units in a tick against a
//     three-unit radius, so a test that only looks at the tick's endpoints lets
//     one through a Small without touching it.
//
// Nothing here reads the game's state, so each is checked on its own.

import { FIELD_H, FIELD_W, MU, SOFTEN, STAR_X, STAR_Y, TAU } from "./constants";

/** A plain pair, returned by the helpers here. */
export interface Vec2 {
  x: number;
  y: number;
}

/** A coordinate brought back into `[0, size)`. */
export function wrap(value: number, size: number): number {
  const v = value % size;
  return v < 0 ? v + size : v;
}

/** A field position brought back inside the field. */
export function wrapPoint(point: { x: number; y: number }): void {
  point.x = wrap(point.x, FIELD_W);
  point.y = wrap(point.y, FIELD_H);
}

/** One axis of the shortest separation: the difference across the nearer seam. */
export function shortestAxis(delta: number, size: number): number {
  const half = size / 2;
  if (delta >= half) return delta - size;
  if (delta < -half) return delta + size;
  return delta;
}

/**
 * The shortest vector from `a` to `b` across the seams: `b - a`, each axis
 * brought into `[-size / 2, +size / 2)`.
 */
export function shortestDelta(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): Vec2 {
  return {
    x: shortestAxis(bx - ax, FIELD_W),
    y: shortestAxis(by - ay, FIELD_H),
  };
}

/** The length of the shortest wrapped separation between two positions. */
export function wrappedDistance(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const d = shortestDelta(ax, ay, bx, by);
  return Math.hypot(d.x, d.y);
}

/**
 * The acceleration the star exerts on a body at `(x, y)`.
 *
 * Along the DIRECT vector to `(STAR_X, STAR_Y)`, so a body near a corner is
 * pulled by its full distance across the field rather than toward a wrapped image
 * of the star. Inside `SOFTEN` the magnitude holds at `MU / SOFTEN^2`.
 */
export function gravity(x: number, y: number): Vec2 {
  const dx = STAR_X - x;
  const dy = STAR_Y - y;
  const d = Math.hypot(dx, dy);
  if (d === 0) return { x: 0, y: 0 };
  const effective = Math.max(d, SOFTEN);
  const magnitude = MU / (effective * effective);
  return { x: (magnitude * dx) / d, y: (magnitude * dy) / d };
}

/**
 * Whether two circles of combined radius `radius`, separated by `(relX, relY)`
 * and closing at `(relVx, relVy)`, come within `radius` at some point of a tick
 * lasting `dt` seconds.
 *
 * Solved rather than sampled: the separation's square is a quadratic in time, so
 * the first root inside the tick is the moment of contact and there is no step
 * size to tunnel through.
 */
export function sweptOverlap(
  relX: number,
  relY: number,
  relVx: number,
  relVy: number,
  radius: number,
  dt: number,
): boolean {
  const c = relX * relX + relY * relY - radius * radius;
  // Already touching when the tick began.
  if (c <= 0) return true;
  const a = relVx * relVx + relVy * relVy;
  // Not touching, and not moving relative to one another.
  if (a === 0) return false;
  const b = 2 * (relX * relVx + relY * relVy);
  // Separating rather than closing.
  if (b >= 0) return false;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return false;
  const t = (-b - Math.sqrt(discriminant)) / (2 * a);
  return t >= 0 && t <= dt;
}

/** The shortest signed difference `a - b`, in `(-pi, +pi]`. */
export function angleDelta(a: number, b: number): number {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d <= -Math.PI) d += TAU;
  return d;
}

/** `current` rotated toward `target` by at most `step` radians, the shorter way. */
export function turnToward(
  current: number,
  target: number,
  step: number,
): number {
  const diff = angleDelta(target, current);
  if (Math.abs(diff) <= step) return target;
  return current + Math.sign(diff) * step;
}

/**
 * The wrapped copies of a body that have any part inside the field.
 *
 * A body within `radius` of a seam shows at the opposite edge as well as where it
 * stands (`specs/field.md`), so the renderer draws it once per offset this
 * returns. The centre offset is always first, so the body itself is drawn first
 * whatever else is returned.
 */
export function wrapOffsets(
  x: number,
  y: number,
  radius: number,
): readonly Vec2[] {
  const offsets: Vec2[] = [{ x: 0, y: 0 }];
  const xs: number[] = [];
  const ys: number[] = [];
  if (x - radius < 0) xs.push(FIELD_W);
  if (x + radius > FIELD_W) xs.push(-FIELD_W);
  if (y - radius < 0) ys.push(FIELD_H);
  if (y + radius > FIELD_H) ys.push(-FIELD_H);
  for (const dx of xs) offsets.push({ x: dx, y: 0 });
  for (const dy of ys) offsets.push({ x: 0, y: dy });
  for (const dx of xs) for (const dy of ys) offsets.push({ x: dx, y: dy });
  return offsets;
}
