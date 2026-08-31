// The one geometric primitive the shared readings are stated in.
//
// Every case declares this same pair under its own name — Volute's
// `constants.ts` calls it `Point`, the other three write the object type inline —
// so it lives here and a case re-exports it rather than declaring a second,
// structurally identical one.

/** A point in the case's logical coordinates, unless a reading says otherwise. */
export interface Point {
  x: number;
  y: number;
}

/** The straight-line distance between two points. */
export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * An axis-aligned rectangle, in the same logical coordinates as a {@link Point}.
 *
 * Structural on purpose: a case's own snapshot type for a thing that occupies a
 * box — a pointer target, an obstacle — already carries these four fields beside
 * whatever else it reports, so it IS one of these and needs no conversion.
 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The middle of a rectangle, which is where a check aims at the thing in it. */
export function rectCenter(rect: Rect): Point {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/** Whether two rectangles share any area. */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  );
}
