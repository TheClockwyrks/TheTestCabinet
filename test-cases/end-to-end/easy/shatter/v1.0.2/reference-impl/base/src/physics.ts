// Shatter — physics helpers: the torus wrap, the gravity well, and swept
// collision. The heavy per-body integration and collision *resolution* live in
// game.ts; this module holds the pure math those steps call.

import {
  FIELD_H,
  FIELD_W,
  MU,
  SOFTEN,
  STAR_X,
  STAR_Y,
} from "./constants";

export interface Body {
  x: number;
  y: number;
}

// Keep a coordinate within the field by wrapping it on the torus.
export function wrap(value: number, size: number): number {
  let v = value % size;
  if (v < 0) v += size;
  return v;
}

export function wrapBody(b: Body): void {
  b.x = wrap(b.x, FIELD_W);
  b.y = wrap(b.y, FIELD_H);
}

// The shortest vector from a to b across the wrap seams (a torus), so bodies
// touching across an edge are treated as adjacent. Returns the delta b - a.
export function shortestDelta(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): { dx: number; dy: number } {
  let dx = bx - ax;
  if (dx > FIELD_W / 2) dx -= FIELD_W;
  else if (dx < -FIELD_W / 2) dx += FIELD_W;
  let dy = by - ay;
  if (dy > FIELD_H / 2) dy -= FIELD_H;
  else if (dy < -FIELD_H / 2) dy += FIELD_H;
  return { dx, dy };
}

// The shortest wrapped distance between two bodies.
export function wrappedDist(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const { dx, dy } = shortestDelta(ax, ay, bx, by);
  return Math.hypot(dx, dy);
}

// The gravity acceleration the star exerts on a ballistically-flying body
// (every bullet and every rock — never the ship or the saucer). Uses the
// body's DIRECT vector to the star (not a wrapped one): the star is a single
// physical point, so a body near a corner is genuinely far from it. The
// softening radius keeps the pull finite near the core.
export function gravityAccel(
  x: number,
  y: number,
): { ax: number; ay: number } {
  const dx = STAR_X - x;
  const dy = STAR_Y - y;
  const d = Math.hypot(dx, dy);
  if (d === 0) return { ax: 0, ay: 0 };
  const dEff = Math.max(d, SOFTEN);
  const aMag = MU / (dEff * dEff);
  return { ax: (aMag * dx) / d, ay: (aMag * dy) / d };
}

// Swept circle-vs-circle overlap test across a single step, using the shortest
// wrapped separation and the two bodies' (constant-over-the-step) velocities.
// Returns true if two circles of combined radius R, separated by rel0 = b - a
// and closing at relative velocity relVel, come within R at any time in
// [0, dt]. This prevents a fast small body (a bullet, a slingshot rock) from
// tunnelling through a target between discrete samples.
export function sweptHit(
  rel0x: number,
  rel0y: number,
  relVx: number,
  relVy: number,
  R: number,
  dt: number,
): boolean {
  const c = rel0x * rel0x + rel0y * rel0y - R * R;
  if (c <= 0) return true; // already overlapping
  const a = relVx * relVx + relVy * relVy;
  if (a === 0) return false; // no relative motion and not overlapping
  const b = 2 * (rel0x * relVx + rel0y * relVy);
  if (b >= 0) return false; // separating, not closing
  const disc = b * b - 4 * a * c;
  if (disc < 0) return false;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= dt;
}
