// floor — reading the canvas as raw pixels, for the checks in this group that
// measure a DISTANCE on the stage rather than a value in a snapshot.
//
// WHY RAW PIXELS AND NOT `sampleColor`. The harness's `sampleColor` averages a
// five-point cluster three units either side of its centre, which is exactly
// right for "what colour is this tower" and exactly wrong for every reading in
// this group: the casing band is eighteen units thick, a grid line is one unit
// wide, and a footprint's edge is the thing being located. A cluster six units
// across blurs all three. So the geometric checks read SINGLE pixels and say, in
// their own terms, how far the boundary they found may sit from the one
// `specs/floor.md` fixes.
//
// WHY IT IS LOCAL TO THIS GROUP. Nothing here is a threshold and nothing here is
// a scenario: it is the single-pixel read and the rendering it renders for a
// failure message, and no other group in this suite measures a distance on the
// stage. A helper in `harness.ts` would be a helper eighteen groups could not
// use.

import type { Harness, Rgb } from "../harness";
import type { Point } from "../geometry";

/**
 * The one device pixel under a logical stage point.
 *
 * The point is mapped through the engine's own fit, so a reading is taken where
 * `specs/floor.md` says the thing should be rather than wherever the canvas
 * happens to be that many pixels along.
 */
export function pixelAt(h: Harness, x: number, y: number): Rgb {
  const [r, g, b] = h.pixel(x, y);
  return { r, g, b };
}

/** {@link pixelAt} over a run of points, in order. */
export function pixelsAt(h: Harness, points: readonly Point[]): Rgb[] {
  return points.map((point) => pixelAt(h, point.x, point.y));
}

/** A colour, rendered for a failure message. */
export function showRgb(c: Rgb): string {
  return `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`;
}
