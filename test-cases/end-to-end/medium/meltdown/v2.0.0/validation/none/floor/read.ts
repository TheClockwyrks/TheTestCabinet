// floor — reading the canvas as raw pixels, for the four checks in this group
// that measure a DISTANCE on the stage rather than a value in a snapshot.
//
// WHY RAW PIXELS AND NOT `sampleColor`. The harness's `sampleColor` averages a
// five-point cluster four units wide, which is exactly right for "what colour is
// this tower" and exactly wrong for every reading in this group: the casing band
// is eighteen units thick, a grid line is one unit wide, and a footprint's edge
// is the thing being located. A cluster four units across blurs all three. So the
// four geometric checks read single pixels and say, in their own terms, how far
// the boundary they found may sit from the one `specs/floor.md` fixes.
//
// WHY IT IS LOCAL TO THIS GROUP. Nothing here is a threshold and nothing here is
// a scenario: it is the batching and the two-reference classification the four
// checks share, and no other group measures a distance on the stage. A helper in
// `harness.ts` would be a helper eighteen groups could not use.

import { assertGreaterThan } from "../assert";
import { colorDistance, type Harness, type Rgb } from "../harness";

/** A logical stage point. */
export interface Point {
  x: number;
  y: number;
}

/**
 * The single device pixel under each logical point, in one crossing into the
 * page.
 *
 * The points are mapped through the fit `specs/overview.md` requires, so a build
 * that scaled, cropped or centred the stage differently is read where the
 * specification says the thing should be rather than where the build put it.
 */
export async function readPixels(
  h: Harness,
  points: readonly Point[],
): Promise<Rgb[]> {
  const read = await h.pixels(points);
  return read.map(([r, g, b]) => ({ r, g, b }));
}

/** {@link readPixels} for one point. */
export async function readPixel(h: Harness, point: Point): Promise<Rgb> {
  return (await readPixels(h, [point]))[0];
}

/**
 * Which of two reference colours a sample is nearer.
 *
 * The classification every geometric reading in this group rests on, and the
 * reason it is a COMPARISON rather than a threshold: `specs/overview.md` fixes no
 * palette, so what the casing and the floor look like is the build's, and the
 * only thing a check may lean on is that they are different. A sample nearer the
 * casing's own colour than the floor's is casing; a build free to glow, shade or
 * texture either one still classifies, because a glow moves a sample a little
 * and a region boundary moves it the whole way.
 */
export function nearer(sample: Rgb, a: Rgb, b: Rgb): "a" | "b" {
  return colorDistance(sample, a) <= colorDistance(sample, b) ? "a" : "b";
}

/**
 * Two reference colours far enough apart to classify by, or the check fails
 * saying so.
 *
 * A distance the two references must clear before {@link nearer} means anything:
 * with the two indistinguishable, every sample would land on whichever side
 * rounding fell, and the reading would be noise wearing a verdict's face. It is
 * deliberately a LOW bar — how far apart a player needs them is appearance,
 * which `specs/overview.md` hands to the build and the reviewer judges, and this
 * only needs them apart enough to tell which side of a boundary a pixel is on.
 */
export function requireDistinct(
  a: Rgb,
  b: Rgb,
  minimum: number,
  context: string,
): void {
  assertGreaterThan(colorDistance(a, b), minimum, context);
}

/** A colour, rendered for a failure message. */
export function showRgb(c: Rgb): string {
  return `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`;
}
