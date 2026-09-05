// Orrery — what a check reads off a frame's PIXELS. CASE-PROVIDED, and the SAME
// FILE in all three engine projects.
//
// The companion to `drawing.ts`: that one reads the operations a frame ISSUED,
// this one reads what they LEFT on the canvas. A check about placement reads the
// operations, because a pixel cannot say which source painted it; a check about
// whether something was drawn where the specification says something is drawn
// reads the pixels, and presence is the whole of what they decide. A palette, the
// contrast between two shapes, and the extent of a mark are the reviewer's.
//
// EVERY READING IS TAKEN THROUGH THE HARNESS, so a point is addressed in the
// stage's logical units and the harness's own fit is what turns it into a device
// pixel. The readers below take the narrowest slice of a harness that does the
// job, so they work against all three projects' harnesses without any of them
// having to be imported here.

import type { Point } from "./drawing";

/** A device pixel, as `[r, g, b, a]`. */
export type Pixel = [number, number, number, number];

/**
 * A rectangle of pixels, read back as RGBA rows: four bytes per pixel, row-major,
 * so the pixel at `(x, y)` starts at `(y * width + x) * 4`.
 */
export interface PixelRect {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** A colour, without its alpha. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** As much of a harness as a point reading needs. */
export interface PointReader {
  pixels(points: readonly Point[]): Promise<Pixel[]>;
}

/** As much of a harness as a rectangle reading needs. */
export interface RectReader {
  pixelRect(
    x: number,
    y: number,
    width: number,
    height: number,
  ): Promise<PixelRect>;
}

/** A pixel's colour, dropping its alpha. */
export function rgbOf(pixel: Pixel): Rgb {
  return { r: pixel[0], g: pixel[1], b: pixel[2] };
}

/** The Euclidean distance between two colours, in RGB. */
export function colorDistance(a: Rgb, b: Rgb): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

/** Rec. 709 weighted luminance, `0.2126r + 0.7152g + 0.0722b`. */
export function luminance(c: Rgb): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/** The unweighted channel mean, `(r + g + b) / 3`. */
export function meanChannel(c: Rgb): number {
  return (c.r + c.g + c.b) / 3;
}

/** The mean colour over a run of sampled points. */
export function meanOf(pixels: readonly Pixel[]): Rgb {
  if (pixels.length === 0) return { r: 0, g: 0, b: 0 };
  let r = 0;
  let g = 0;
  let b = 0;
  for (const pixel of pixels) {
    r += pixel[0];
    g += pixel[1];
    b += pixel[2];
  }
  return { r: r / pixels.length, g: g / pixels.length, b: b / pixels.length };
}

/**
 * A cross of five points centred on `(x, y)`, `radius` out on each axis.
 *
 * What a colour sample is taken over rather than one pixel: a single pixel can
 * land on an anti-aliased edge, and a produced sprite is drawn with soft edges by
 * design. Five points a few units apart cannot all be on the same edge.
 */
export function clusterPoints(x: number, y: number, radius = 4): Point[] {
  return [
    { x, y },
    { x: x - radius, y },
    { x: x + radius, y },
    { x, y: y - radius },
    { x, y: y + radius },
  ];
}

/** The mean colour of the five-point cluster at a logical point. */
export async function sampleColor(
  h: PointReader,
  x: number,
  y: number,
  radius = 4,
): Promise<Rgb> {
  return meanOf(await h.pixels(clusterPoints(x, y, radius)));
}

/** `count` points evenly spaced around a circle of `radius` about a point. */
export function ringPoints(
  x: number,
  y: number,
  radius: number,
  count = 12,
): Point[] {
  return Array.from({ length: count }, (_unused, i) => {
    const angle = (i / count) * Math.PI * 2;
    return { x: x + radius * Math.cos(angle), y: y + radius * Math.sin(angle) };
  });
}

/** The mean colour of a ring of points about a logical point. */
export async function sampleRing(
  h: PointReader,
  x: number,
  y: number,
  radius: number,
  count = 12,
): Promise<Rgb> {
  return meanOf(await h.pixels(ringPoints(x, y, radius, count)));
}

/**
 * Points filling the disc of `radius` about `(x, y)`, on a lattice of `step`.
 *
 * What a check reads a MOTE over: `specs/field.md` fixes `MOTE_R` (`22`) as the
 * radius every mote's drawn form fits inside, so the disc of that radius about a
 * mote's position is exactly the region the specification talks about.
 */
export function discPoints(
  x: number,
  y: number,
  radius: number,
  step = 4,
): Point[] {
  const points: Point[] = [];
  for (let dy = -radius; dy <= radius; dy += step) {
    for (let dx = -radius; dx <= radius; dx += step) {
      if (dx * dx + dy * dy <= radius * radius) {
        points.push({ x: x + dx, y: y + dy });
      }
    }
  }
  return points;
}

/** The mean colour over the disc of `radius` about a logical point. */
export async function sampleDisc(
  h: PointReader,
  x: number,
  y: number,
  radius: number,
  step = 4,
): Promise<Rgb> {
  return meanOf(await h.pixels(discPoints(x, y, radius, step)));
}

/**
 * The DARKEST of several sampled patches.
 *
 * How the bare sky is read. `specs/assets.md` puts every sprite on "the dark sky"
 * and requires that none of them "relies on a background behind it", so anything
 * drawn reads lighter than the ground it sits on: the darkest of several patches
 * is the one nothing covered. Reading one fixed patch would fail a build that
 * happened to seat a readout there, which is a placement the specification leaves
 * to the build.
 */
export async function darkestOf(
  h: PointReader,
  points: readonly Point[],
  radius = 4,
): Promise<Rgb> {
  let darkest: Rgb = { r: 255, g: 255, b: 255 };
  for (const point of points) {
    const sampled = await sampleColor(h, point.x, point.y, radius);
    if (luminance(sampled) < luminance(darkest)) darkest = sampled;
  }
  return darkest;
}

/** The pixel at `(x, y)` of a rectangle, as `[r, g, b, a]`. */
export function pixelAt(rect: PixelRect, x: number, y: number): Pixel {
  const at = (y * rect.width + x) * 4;
  return [
    rect.data[at] ?? 0,
    rect.data[at + 1] ?? 0,
    rect.data[at + 2] ?? 0,
    rect.data[at + 3] ?? 0,
  ];
}

/** How many pixels of a rectangle are not transparent. */
export function paintedPixels(rect: PixelRect): number {
  let painted = 0;
  for (let i = 3; i < rect.data.length; i += 4) {
    if ((rect.data[i] as number) > 0) painted += 1;
  }
  return painted;
}

/** The share of a rectangle's pixels that carry paint. */
export function paintShare(rect: PixelRect): number {
  const total = rect.width * rect.height;
  return total === 0 ? 0 : paintedPixels(rect) / total;
}

/** How far one channel may drift before two pixels count as different. */
export const CHANNEL_EPSILON = 8;

/**
 * How many pixels of two equally shaped rectangles differ.
 *
 * A pixel differs when its alpha moved, or when it carries paint in both and a
 * colour channel moved. Two fully clear pixels are the same pixel whatever colour
 * bytes sit under them, because a straight-alpha canvas leaves those bytes
 * undefined and a player sees nothing either way. Rectangles of different sizes
 * differ everywhere, since no pixel of one is the pixel of the other.
 */
export function pixelsDiffering(
  a: PixelRect,
  b: PixelRect,
  epsilon = CHANNEL_EPSILON,
): number {
  if (a.width !== b.width || a.height !== b.height) return a.width * a.height;
  let differing = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const alphaA = a.data[i + 3] as number;
    const alphaB = b.data[i + 3] as number;
    if (Math.abs(alphaA - alphaB) > epsilon) {
      differing += 1;
      continue;
    }
    if (alphaA === 0 && alphaB === 0) continue;
    for (let channel = 0; channel < 3; channel += 1) {
      if (
        Math.abs(
          (a.data[i + channel] as number) - (b.data[i + channel] as number),
        ) > epsilon
      ) {
        differing += 1;
        break;
      }
    }
  }
  return differing;
}

/** The share of two rectangles' pixels that differ. */
export function differingShare(
  a: PixelRect,
  b: PixelRect,
  epsilon = CHANNEL_EPSILON,
): number {
  const total = a.width * a.height;
  return total === 0 ? 0 : pixelsDiffering(a, b, epsilon) / total;
}

/** Whether two rectangles are the same picture, pixel for pixel. */
export function samePicture(
  a: PixelRect,
  b: PixelRect,
  epsilon = CHANNEL_EPSILON,
): boolean {
  return pixelsDiffering(a, b, epsilon) === 0;
}

/** A grid of points filling a rectangle, on a lattice of `step`. */
export function gridPoints(
  region: { x: number; y: number; w: number; h: number },
  step: number,
): Point[] {
  const points: Point[] = [];
  for (let y = region.y; y < region.y + region.h; y += step) {
    for (let x = region.x; x < region.x + region.w; x += step) {
      points.push({ x, y });
    }
  }
  return points;
}

/** How much of a rectangle's pixels differ from a reference colour by more than `tolerance`. */
export function shareAwayFrom(
  rect: PixelRect,
  from: Rgb,
  tolerance: number,
): number {
  const total = rect.width * rect.height;
  if (total === 0) return 0;
  let away = 0;
  for (let i = 0; i < rect.data.length; i += 4) {
    const here: Rgb = {
      r: rect.data[i] as number,
      g: rect.data[i + 1] as number,
      b: rect.data[i + 2] as number,
    };
    if (colorDistance(here, from) > tolerance) away += 1;
  }
  return away / total;
}

/** The mean colour over a whole rectangle. */
export function meanRect(rect: PixelRect): Rgb {
  const total = rect.width * rect.height;
  if (total === 0) return { r: 0, g: 0, b: 0 };
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < rect.data.length; i += 4) {
    r += rect.data[i] as number;
    g += rect.data[i + 1] as number;
    b += rect.data[i + 2] as number;
  }
  return { r: r / total, g: g / total, b: b / total };
}
