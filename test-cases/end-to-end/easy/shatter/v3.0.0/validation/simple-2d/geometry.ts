// Shatter — the field's geometry, as the CASE specifies it. CASE-PROVIDED.
//
// This module is the ORACLE a validator reads against: the rules
// `specs/field.md`, `specs/gravity.md` and `specs/collision.md` state about the
// torus the game is played on, written once as functions so no check has to
// restate them and no two checks can disagree about them.
//
// It is deliberately NOT a copy of anything the build wrote. Nothing here
// imports `src/` at all: `FIELD_W`, `FIELD_H`, `STAR_X`, `STAR_Y`, `MU` and
// `SOFTEN` come from `./constants`, this project's own transcription of
// `specs/field.md` and `specs/gravity.md`, so a build that implemented the wrap
// or the well its own way — or that wrote down a different figure for one — is
// measured against the specification rather than against itself.
//
// THE ONE ASYMMETRY WORTH READING BEFORE USING ANY OF IT. Distance between two
// BODIES is the shortest WRAPPED separation (`specs/field.md`), and every
// collision in the game is resolved on it. The star's PULL is the one deliberate
// exception: `specs/gravity.md` fixes it on the body's DIRECT vector to
// `(STAR_X, STAR_Y)`, so a body near a corner is pulled by its full distance
// across the field rather than toward a wrapped image of the star. {@link
// distance} is the first; {@link gravityAt} is the second. Reaching for the
// wrong one is the mistake this module exists to prevent.
//
// Everything here is a pure function of its arguments. Nothing reads the game,
// nothing holds state, and nothing fixes a threshold: a check states the bound
// it asserts, derived from the figure `specs/` fixes for it, and uses these to
// compute the value it compares against that bound.

import { FIELD_H, FIELD_W, MU, SOFTEN, STAR_X, STAR_Y } from "./constants";

/** A point on the field, in the logical units of the fixed 1280x720 space. */
export interface Point {
  x: number;
  y: number;
}

/** A velocity, in logical units per second. */
export interface Velocity {
  vx: number;
  vy: number;
}

/** The star's centre, which never moves (`specs/field.md`). */
export const STAR: Point = { x: STAR_X, y: STAR_Y };

/** A coordinate brought back into `[0, size)`. */
function wrapAxis(value: number, size: number): number {
  const r = value % size;
  return r < 0 ? r + size : r;
}

/** An `x` brought back into `[0, FIELD_W)`, the way the wrap keeps it. */
export function wrapX(x: number): number {
  return wrapAxis(x, FIELD_W);
}

/** A `y` brought back into `[0, FIELD_H)`, the way the wrap keeps it. */
export function wrapY(y: number): number {
  return wrapAxis(y, FIELD_H);
}

/** A point brought back onto the field on both axes. */
export function wrap(p: Point): Point {
  return { x: wrapX(p.x), y: wrapY(p.y) };
}

/** A difference brought into `[-size / 2, +size / 2)`. */
function foldAxis(delta: number, size: number): number {
  let r = delta % size;
  if (r >= size / 2) r -= size;
  if (r < -size / 2) r += size;
  return r;
}

/** An `x` difference as the shortest one across the seam. */
export function foldX(dx: number): number {
  return foldAxis(dx, FIELD_W);
}

/** A `y` difference as the shortest one across the seam. */
export function foldY(dy: number): number {
  return foldAxis(dy, FIELD_H);
}

/**
 * The shortest wrapped separation FROM `a` TO `b` (`specs/field.md`).
 *
 * This is the vector every rule that measures how far apart two bodies are
 * measures along, and the one every pair in `specs/collision.md` is resolved on.
 */
export function separation(a: Point, b: Point): Point {
  return { x: foldX(b.x - a.x), y: foldY(b.y - a.y) };
}

/** The length of the shortest wrapped separation between two positions. */
export function distance(a: Point, b: Point): number {
  const d = separation(a, b);
  return Math.hypot(d.x, d.y);
}

/**
 * Whether two circles TOUCH: their shortest wrapped separation is at most the
 * sum of their radii (`specs/collision.md`).
 */
export function touching(
  a: Point,
  aRadius: number,
  b: Point,
  bRadius: number,
): boolean {
  return distance(a, b) <= aRadius + bRadius;
}

/**
 * The acceleration the well gives a body at `p`, in units per second squared
 * (`specs/gravity.md`).
 *
 * `aMag = MU / max(d, SOFTEN)^2`, directed along the unit vector from the body
 * to the star. The distance is the DIRECT one, not the wrapped one: that is the
 * specification's own exception, and taking it wrapped would predict a body near
 * a corner falling toward the nearer seam.
 */
export function gravityAt(p: Point): { ax: number; ay: number } {
  const dx = STAR_X - p.x;
  const dy = STAR_Y - p.y;
  const d = Math.hypot(dx, dy);
  if (d === 0) return { ax: 0, ay: 0 };
  const effective = Math.max(d, SOFTEN);
  const magnitude = MU / (effective * effective);
  return { ax: (magnitude * dx) / d, ay: (magnitude * dy) / d };
}

/** The magnitude of the well's pull at `p`, without its direction. */
export function gravityMagnitude(p: Point): number {
  const g = gravityAt(p);
  return Math.hypot(g.ax, g.ay);
}

/** The DIRECT distance from `p` to the star, which is what the well uses. */
export function directDistanceToStar(p: Point): number {
  return Math.hypot(p.x - STAR_X, p.y - STAR_Y);
}

/** The magnitude of a velocity. */
export function speedOf(v: Velocity): number {
  return Math.hypot(v.vx, v.vy);
}

/** The direction a velocity travels in, in radians, or `null` when at rest. */
export function headingOf(v: Velocity): number | null {
  if (v.vx === 0 && v.vy === 0) return null;
  return Math.atan2(v.vy, v.vx);
}

/** An angle brought into `(-PI, +PI]`. */
export function normalizeAngle(radians: number): number {
  const turn = Math.PI * 2;
  let r = radians % turn;
  if (r > Math.PI) r -= turn;
  if (r <= -Math.PI) r += turn;
  return r;
}

/** The signed smallest turn from `from` to `to`, in radians. */
export function angleBetween(from: number, to: number): number {
  return normalizeAngle(to - from);
}

/** The unsigned smallest angle between two directions, in radians. */
export function angleGap(a: number, b: number): number {
  return Math.abs(angleBetween(a, b));
}

/** Radians as degrees, for a check whose figure the specification states in them. */
export function degrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

/** Degrees as radians. */
export function radians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * The unit vector pointing from the star OUT to `p`, along the shortest wrapped
 * separation, or `(1, 0)` for a body standing on the star itself.
 *
 * This is the side of a body a round is placed on when it must not be absorbed
 * by the core on the way in; see `aimedRound` in `harness.ts`.
 */
export function outwardFromStar(p: Point): Point {
  const away = separation(STAR, p);
  const length = Math.hypot(away.x, away.y);
  if (length === 0) return { x: 1, y: 0 };
  return { x: away.x / length, y: away.y / length };
}

/**
 * The shortest distance from `p` to the straight LINE SEGMENT `a`-`b`, taken
 * across the seams.
 *
 * WHY A SEGMENT AND NOT THE SAMPLES. A sweep that reads a moving body every few
 * ticks and takes the smallest sampled distance reports the body FURTHER OUT
 * than it ever got, because the closest point of the pass falls between two
 * samples. That is the wrong direction for any check hunting a build that came
 * too close, so a check that asks how near something came measures to the line
 * the body travelled along between its samples. This is fold-in fix B, and
 * `saucer/avoids-the-core` rests on it.
 *
 * Everything is expressed relative to `a` through {@link separation}, so a body
 * that crossed a seam between the two samples is measured along the tick of real
 * motion it made rather than along a line back across the whole field.
 */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const ab = separation(a, b);
  const ap = separation(a, p);
  const lengthSquared = ab.x * ab.x + ab.y * ab.y;
  if (lengthSquared === 0) return Math.hypot(ap.x, ap.y);
  const t = Math.max(
    0,
    Math.min(1, (ap.x * ab.x + ap.y * ab.y) / lengthSquared),
  );
  return Math.hypot(ap.x - t * ab.x, ap.y - t * ab.y);
}

/**
 * The closest `p` ever came to the polyline through `path`, measured to the
 * segments between its points rather than to the points themselves.
 *
 * Answers the distance and the index of the segment it was reached on, so a
 * check can report — or re-pose — the moment its verdict rests on. A path of one
 * point answers the distance to that point.
 */
export function closestApproachTo(
  p: Point,
  path: readonly Point[],
): { distance: number; segment: number } {
  if (path.length === 0) return { distance: Infinity, segment: -1 };
  if (path.length === 1) {
    return { distance: distance(p, path[0]), segment: 0 };
  }
  let best = Infinity;
  let segment = 0;
  for (let i = 0; i + 1 < path.length; i += 1) {
    const d = distanceToSegment(p, path[i], path[i + 1]);
    if (d < best) {
      best = d;
      segment = i;
    }
  }
  return { distance: best, segment };
}

/**
 * When two circles closing on each other first come within `radius` of one
 * another, over a step of `dt` seconds, or `null` if they never do.
 *
 * The swept test `specs/collision.md` mandates, written as the oracle a check
 * reads against: `from` is the separation between the two centres at the start of
 * the step, `closing` is their relative velocity, and `radius` is the sum of
 * their radii. A pair already overlapping answers `0`.
 *
 * `bullets/no-tunnelling-at-speed` and `seam-collision` are decided by whether
 * the build's own collision agrees with this over one tick; nothing here poses
 * anything, so a check states the pair it is about and compares.
 */
export function sweptContact(
  from: Point,
  closing: Velocity,
  radius: number,
  dt: number,
): number | null {
  const a = closing.vx * closing.vx + closing.vy * closing.vy;
  const b = 2 * (from.x * closing.vx + from.y * closing.vy);
  const c = from.x * from.x + from.y * from.y - radius * radius;
  if (c <= 0) return 0;
  if (a === 0) return null;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const root = Math.sqrt(discriminant);
  const first = (-b - root) / (2 * a);
  const second = (-b + root) / (2 * a);
  if (first >= 0 && first <= dt) return first;
  if (second >= 0 && second <= dt) return second;
  return null;
}

/**
 * The nine positions a body at `p` may also be DRAWN at, so a body straddling a
 * seam shows on both sides (`specs/field.md`).
 *
 * The identity first, then the eight `(+/-FIELD_W, +/-FIELD_H)` offsets. A check
 * about the drawn seam looks for the body's own pixels near the point this
 * answers for the offset it is about.
 */
export function seamImages(p: Point): Point[] {
  const images: Point[] = [];
  for (const dy of [0, FIELD_H, -FIELD_H]) {
    for (const dx of [0, FIELD_W, -FIELD_W]) {
      images.push({ x: p.x + dx, y: p.y + dy });
    }
  }
  return images;
}
