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
