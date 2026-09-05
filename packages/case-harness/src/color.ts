// What a check reads off the canvas as COLOUR.
//
// None of the four cases fixes a palette — each says, in its own words, that the
// build chooses its own — so nothing here compares a reading against a hex value.
// What an appearance point may assert is PRESENCE and DISTINGUISHABILITY: that
// the thing was drawn, and that it stands apart from what surrounds it. Every
// reading below therefore answers either a colour or a distance between two, on
// the 0-441 scale (`sqrt(3) * 255`) the cases state their tolerances out of.
//
// TWO PAIRS OF NAMES ARE DELIBERATE. `luminance` and `meanChannel` are two
// different ways of reducing a colour to one number, and `meanColor` and `meanOf`
// average two different things. In every pair the cases genuinely disagree: they
// were four separate files, one name each, and folding either pair into a single
// function would silently rescale one case's thresholds. Both halves ship, under
// names that say which is which, and a case binds the one it has always meant.

import type { Harness } from "./harness";
import type { Pixel, PixelRect } from "./pixels";
import type { Point } from "./point";

/**
 * A colour read off the canvas, each channel 0-255.
 *
 * Three channels: the alpha a canvas reports for a drawn pixel is always opaque,
 * so a reading is a point in RGB and every bound a check states on one is a
 * distance in that space.
 */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** One sampled device pixel, as a colour. */
export function rgbOf(pixel: Pixel): Rgb {
  return { r: pixel[0], g: pixel[1], b: pixel[2] };
}

/**
 * How far apart two colours are, as a euclidean distance in RGB.
 *
 * `0` for the same colour and about `441` (`sqrt(3) * 255`) for the furthest
 * apart two can be, which is the scale every case's tolerances are stated on.
 */
export function colorDistance(a: Rgb, b: Rgb): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

/**
 * A colour's luminance, Rec. 709 weighted, on the same 0-255 scale as its
 * channels.
 *
 * WHAT "BRIGHTER" MEANS FOR A READING THAT COMPARES TWO COLOURS OF DIFFERENT
 * HUE. Green reads far brighter to an eye than blue at the same channel value,
 * and a check that asks whether something drawn to be READ sits on top of a dark
 * ground is asking the eye's question. This is the weighting {@link darkestOf}
 * and {@link luminanceMask} rank by.
 *
 * NOT INTERCHANGEABLE WITH {@link meanChannel}. The two differ by up to a third
 * of the scale on a saturated colour, so a threshold stated against one is not a
 * threshold against the other — see this module's header.
 */
export function luminance(c: Rgb): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/**
 * A colour's mean channel value, out of 255.
 *
 * The unweighted reading: what a check means when it asks how much light a pixel
 * carries WITHOUT preferring one channel, which is the honest question to ask of
 * a build whose palette is its own. A case that ranks its readings this way binds
 * this rather than {@link luminance}, and the two are kept apart because a
 * threshold written against one does not hold against the other.
 */
export function meanChannel(c: Rgb): number {
  return (c.r + c.g + c.b) / 3;
}

/**
 * The mean colour over a run of sampled pixels.
 *
 * The reduction for a reading taken as POINTS — a cluster, a ring, a scattered
 * handful — where {@link meanColor} is the reduction for one taken as a
 * rectangle. They are two functions rather than two overloads because they
 * average different things: this one weights every pixel handed to it equally,
 * and that one walks a raster and can skip part of it.
 *
 * `{ r: 0, g: 0, b: 0 }` for an empty run, so a caller that sampled nothing gets
 * a colour rather than three `NaN`s.
 */
export function meanOf(pixels: readonly Pixel[]): Rgb {
  if (pixels.length === 0) return { r: 0, g: 0, b: 0 };
  let r = 0;
  let g = 0;
  let b = 0;
  for (const [pr, pg, pb] of pixels) {
    r += pr;
    g += pg;
    b += pb;
  }
  return { r: r / pixels.length, g: g / pixels.length, b: b / pixels.length };
}

/**
 * The mean colour of a {@link PixelRect}, over the pixels `keep` accepts.
 *
 * `keep` is given the pixel's position WITHIN the rectangle, so a caller that
 * wants a disc out of a square read states the disc in the rectangle's own
 * coordinates rather than in the stage's.
 */
export function meanColor(
  rect: PixelRect,
  keep: (x: number, y: number) => boolean = () => true,
): Rgb {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = 0; y < rect.height; y += 1) {
    for (let x = 0; x < rect.width; x += 1) {
      if (!keep(x, y)) continue;
      const at = (y * rect.width + x) * 4;
      r += rect.data[at]!;
      g += rect.data[at + 1]!;
      b += rect.data[at + 2]!;
      n += 1;
    }
  }
  if (n === 0) return { r: 0, g: 0, b: 0 };
  return { r: r / n, g: g / n, b: b / n };
}

/** As much of a harness as a reading taken at POINTS needs. */
export type PointReader = Pick<Harness<unknown, object>, "pixels">;

/** As much of a harness as a reading taken over a RECTANGLE needs. */
export type RectReader = Pick<Harness<unknown, object>, "pixelRect">;

/**
 * The five points a colour sample is averaged over: the centre, and four
 * neighbours `radius` logical units out on the axes.
 *
 * A CLUSTER RATHER THAN ONE PIXEL, because every edge a build draws is
 * anti-aliased and a build is free to draw a glow: one stray sample on a rim
 * reads as a mixture of the thing and whatever is behind it, and the mean over a
 * small cluster does not. The radius is the caller's, because what "comfortably
 * inside the body" means is the case's own geometry — the smallest thing sampled.
 */
export function clusterPoints(x: number, y: number, radius = 4): Point[] {
  return [
    { x, y },
    { x: x + radius, y },
    { x: x - radius, y },
    { x, y: y + radius },
    { x, y: y - radius },
  ];
}

/**
 * The rendered colour at a logical point, averaged over a {@link clusterPoints}
 * cluster.
 *
 * One crossing into the page for the whole cluster.
 */
export async function sampleColor(
  h: PointReader,
  x: number,
  y: number,
  radius = 4,
): Promise<Rgb> {
  return meanOf(await h.pixels(clusterPoints(x, y, radius)));
}

/** How many points a ring is averaged over. */
const RING_POINTS = 6;

/** The points of one ring about a centre, or the centre itself at radius `0`. */
export function ringPoints(
  x: number,
  y: number,
  radius: number,
  count = RING_POINTS,
): Point[] {
  if (radius === 0) return [{ x, y }];
  return Array.from({ length: count }, (_unused, i) => {
    const angle = (i / count) * Math.PI * 2;
    return { x: x + radius * Math.cos(angle), y: y + radius * Math.sin(angle) };
  });
}

/**
 * The mean colour over a ring of `radius` units about a logical point.
 *
 * What reads a light whose core blows out toward white: the hue is in the halo
 * around such a thing rather than at its centre.
 */
export async function sampleRing(
  h: PointReader,
  x: number,
  y: number,
  radius: number,
): Promise<Rgb> {
  return meanOf(await h.pixels(ringPoints(x, y, radius)));
}

/**
 * The mean colour of the `size` x `size` patch centred on a logical point.
 *
 * The rectangle-shaped sibling of {@link sampleColor}: it reads every pixel of
 * the patch rather than five of them, which is what a check about a small sprite
 * wants and what a check about a large flat body does not need to pay for.
 */
export async function samplePatch(
  h: RectReader,
  x: number,
  y: number,
  size = 9,
): Promise<Rgb> {
  const half = (size - 1) / 2;
  return meanColor(await h.pixelRect(x - half, y - half, size, size));
}

/**
 * The mean colour of the disc of `radius` centred on a logical point.
 *
 * What a check about a ROUND body reads. The square patch a rectangle read gives
 * back has its corners outside such a body — on whatever the body sits on — so
 * they are dropped, and what is averaged is the body.
 *
 * The radius is required: how big the body is, is the case's.
 */
export async function sampleDisc(
  h: RectReader,
  x: number,
  y: number,
  radius: number,
): Promise<Rgb> {
  const size = 2 * radius + 1;
  const rect = await h.pixelRect(x - radius, y - radius, size, size);
  const cx = (rect.width - 1) / 2;
  const cy = (rect.height - 1) / 2;
  const limit = Math.min(cx, cy);
  return meanColor(rect, (px, py) => Math.hypot(px - cx, py - cy) <= limit);
}

/**
 * The darkest of several sampled patches: what the BARE GROUND reads as.
 *
 * A case's ground is dark and everything placed on it is drawn to be read against
 * it, but where a build seats its headings and its readouts is the build's, so no
 * single patch is guaranteed bare. The darkest of several is: anything drawn to
 * be read is lighter than the ground it sits on, so a patch something covers
 * reads lighter than one nothing does.
 *
 * Ranked by {@link luminance}, and sampled one point at a time, in the order
 * given.
 */
export async function darkestOf(
  h: PointReader,
  points: readonly Point[],
  radius = 4,
): Promise<Rgb> {
  const samples: Rgb[] = [];
  for (const point of points) {
    samples.push(await sampleColor(h, point.x, point.y, radius));
  }
  return samples.reduce((darkest, sample) =>
    luminance(sample) < luminance(darkest) ? sample : darkest,
  );
}

/** One sample of a neighbourhood: a colour, and the logical point it was read at. */
export interface NearSample {
  color: Rgb;
  x: number;
  y: number;
}

/**
 * Every point of a `2 * reach` square about `(x, y)`, on a fixed grid of `step`.
 *
 * What a search for a small drawn thing walks. Read one point at a time rather
 * than averaged, because a small light averaged over its whole neighbourhood
 * washes out to the ground around it.
 */
export function gridPoints(
  x: number,
  y: number,
  reach: number,
  step: number,
): Point[] {
  const points: Point[] = [];
  for (let dy = -reach; dy <= reach; dy += step) {
    for (let dx = -reach; dx <= reach; dx += step) {
      points.push({ x: x + dx, y: y + dy });
    }
  }
  return points;
}

/** Each of `points`, read as its own sample, in one crossing into the page. */
export async function samplePoints(
  h: PointReader,
  points: readonly Point[],
): Promise<NearSample[]> {
  const read = await h.pixels(points);
  return points.map((point, index) => ({
    color: rgbOf(read[index]!),
    x: point.x,
    y: point.y,
  }));
}

/**
 * The brightest sample of a neighbourhood, or `null` when `keep` accepts none.
 *
 * `score` IS THE CALLER'S, and it has no default that is safe to guess at: a case
 * that ranks by {@link luminance} and one that ranks by {@link meanChannel} pick
 * different pixels out of the same neighbourhood. The first of two equal
 * brightest is kept, so a search over a symmetric neighbourhood answers the same
 * point every time.
 */
export function brightestIn(
  samples: readonly NearSample[],
  score: (color: Rgb) => number,
  keep: (color: Rgb) => boolean = () => true,
): NearSample | null {
  let best: NearSample | null = null;
  for (const sample of samples) {
    if (!keep(sample.color)) continue;
    if (best === null || score(sample.color) > score(best.color)) best = sample;
  }
  return best;
}

/**
 * The sample nearest a reference colour, and the FIRST of two equally near.
 *
 * What reads the bare ground on a case that fixes no palette: whatever a build
 * draws over a candidate patch — a readout, a texture louder than quiet — moves
 * that patch away from the colour the frame was cleared to, so the patch nearest
 * the clear is the barest of the candidates. It says nothing about whether the
 * ground is light or dark, which is what {@link darkestOf} assumes and some cases
 * may not.
 *
 * A SIBLING OF {@link medoidOf}, NOT A REPLACEMENT FOR IT. Both answer "the
 * barest of these patches" and they answer it differently — this one against a
 * colour known from outside the picture, the medoid against the other samples
 * alone — so a threshold stated over one does not transfer to the other. Both
 * ship; see the README's collision table.
 */
export function nearestTo(samples: readonly Rgb[], reference: Rgb): Rgb {
  return samples.reduce((nearest, sample) =>
    colorDistance(sample, reference) < colorDistance(nearest, reference)
      ? sample
      : nearest,
  );
}

/**
 * The MEDOID of a run of samples: the one closest to all the others in total.
 *
 * The other reading of "the barest of these patches", for a case that has no
 * reference colour to compare against — the ground is whatever most of the
 * candidates agree it is, so one patch a build happens to decorate cannot stand
 * in for it. Nothing here assumes the ground is dark, or light, or any
 * particular colour at all.
 *
 * The first of two equally central samples is kept, so a symmetric set answers
 * the same colour every time.
 */
export function medoidOf(samples: readonly Rgb[]): Rgb {
  let best = samples[0] as Rgb;
  let bestTotal = Number.POSITIVE_INFINITY;
  for (const candidate of samples) {
    const total = samples.reduce(
      (sum, other) => sum + colorDistance(candidate, other),
      0,
    );
    if (total < bestTotal) {
      best = candidate;
      bestTotal = total;
    }
  }
  return best;
}

/**
 * A binary luminance mask of a {@link PixelRect}, thresholded at its own median.
 *
 * What tells two sprites apart WITH COLOUR REMOVED: the mask is the shape a
 * sprite draws rather than the hue it draws it in, so two things that differ only
 * by hue produce the same mask and two that carry different marks do not. A fully
 * transparent pixel is dark, because nothing is drawn there.
 */
export function luminanceMask(rect: PixelRect): boolean[] {
  const values: number[] = [];
  for (let i = 0; i < rect.width * rect.height; i += 1) {
    const at = i * 4;
    const alpha = rect.data[at + 3]! / 255;
    values.push(
      alpha *
        luminance({
          r: rect.data[at]!,
          g: rect.data[at + 1]!,
          b: rect.data[at + 2]!,
        }),
    );
  }
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  return values.map((value) => value > median);
}

/** The fraction of positions two masks of the same size disagree on, 0 to 1. */
export function maskDifference(
  a: readonly boolean[],
  b: readonly boolean[],
): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let differing = 0;
  for (let i = 0; i < n; i += 1) if (a[i] !== b[i]) differing += 1;
  return differing / n;
}

/** How many pixels of two equally shaped rectangles differ by more than `tolerance`. */
export function pixelsDiffering(
  a: PixelRect,
  b: PixelRect,
  tolerance = 8,
): number {
  const n = Math.min(a.data.length, b.data.length) / 4;
  let differing = 0;
  for (let i = 0; i < n; i += 1) {
    const at = i * 4;
    if (
      Math.abs(a.data[at]! - b.data[at]!) > tolerance ||
      Math.abs(a.data[at + 1]! - b.data[at + 1]!) > tolerance ||
      Math.abs(a.data[at + 2]! - b.data[at + 2]!) > tolerance ||
      Math.abs(a.data[at + 3]! - b.data[at + 3]!) > tolerance
    ) {
      differing += 1;
    }
  }
  return differing;
}

/**
 * Every logical point of two frames that differ, as `pixelRect` addressed them.
 *
 * The companion to {@link pixelsDiffering} for a check that has to say WHERE two
 * frames parted, rather than only how much of them did.
 */
export function differingPoints(
  a: PixelRect,
  b: PixelRect,
  origin: Point = { x: 0, y: 0 },
  tolerance = 8,
): Point[] {
  const points: Point[] = [];
  for (let y = 0; y < Math.min(a.height, b.height); y += 1) {
    for (let x = 0; x < Math.min(a.width, b.width); x += 1) {
      const at = (y * a.width + x) * 4;
      const bt = (y * b.width + x) * 4;
      if (
        Math.abs(a.data[at]! - b.data[bt]!) > tolerance ||
        Math.abs(a.data[at + 1]! - b.data[bt + 1]!) > tolerance ||
        Math.abs(a.data[at + 2]! - b.data[bt + 2]!) > tolerance ||
        Math.abs(a.data[at + 3]! - b.data[bt + 3]!) > tolerance
      ) {
        points.push({ x: origin.x + x, y: origin.y + y });
      }
    }
  }
  return points;
}
