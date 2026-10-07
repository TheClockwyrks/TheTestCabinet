// Shatter — the wrapping field (`specs/field.md`).
//
// The field is a torus: it spans the full 1280x720 and has no outer walls, and
// a position is kept in range by wrapping each coordinate. Every distance
// between two bodies in this build goes through `separation` below, which is
// the SHORTEST wrapped one — the difference brought into `[-size/2, +size/2)`
// on each axis — so two bodies touching across a seam collide, and a rule that
// measures how far apart two things are measures it the way `specs/field.md`
// says.
//
// The star's pull is the one deliberate exception, and it lives in
// `src/gravity.ts`: `specs/gravity.md` fixes it on the body's DIRECT vector to
// the star rather than a wrapped one.

import { FIELD_H, FIELD_W } from "./constants";

/** A coordinate brought back into `[0, size)`. */
function wrapAxis(value: number, size: number): number {
  const r = value % size;
  return r < 0 ? r + size : r;
}

/** An `x` brought back into `[0, FIELD_W)`. */
export function wrapX(x: number): number {
  return wrapAxis(x, FIELD_W);
}

/** A `y` brought back into `[0, FIELD_H)`. */
export function wrapY(y: number): number {
  return wrapAxis(y, FIELD_H);
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

/** The shortest wrapped separation from `(ax, ay)` to `(bx, by)`. */
export function separation(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): readonly [number, number] {
  return [foldX(bx - ax), foldY(by - ay)];
}

/** The length of the shortest wrapped separation between two positions. */
export function distance(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const [dx, dy] = separation(ax, ay, bx, by);
  return Math.hypot(dx, dy);
}

/**
 * The eight seam offsets a body may also be drawn at, plus the identity.
 *
 * A body whose circle crosses a seam is drawn on both sides at once, so
 * `src/render.ts` draws it once per offset that brings any part of it back onto
 * the field.
 */
export const SEAM_OFFSETS: readonly (readonly [number, number])[] = [
  [0, 0],
  [FIELD_W, 0],
  [-FIELD_W, 0],
  [0, FIELD_H],
  [0, -FIELD_H],
  [FIELD_W, FIELD_H],
  [FIELD_W, -FIELD_H],
  [-FIELD_W, FIELD_H],
  [-FIELD_W, -FIELD_H],
];
