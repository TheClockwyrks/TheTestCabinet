// presentation — a rectangle of what the build actually PAINTED, read back in
// stage units. PRIVATE to `presentation/`.
//
// The shared harness reads pixels as a LIST OF POINTS — `h.pixel` is one
// `getImageData` per point — which is the right shape for the handful of samples
// a band check takes and the wrong one for the five points here that read a
// REGION: the three "reads apart" points, which weigh every pixel of a body's
// tile against the ground beside it; `hud-lives` and `hud-bays`, which find a
// readout by what MOVED in the bar between two posed frames; and `text-legible`,
// which weighs every glyph of a run against the background around it. Each wants
// thousands of pixels of one rectangle at once, so this takes the rectangle in a
// single `getImageData` and holds it as one string of bytes.
//
// IT IS A SNAPSHOT, NOT A VIEW. The buffer is copied at the moment the raster is
// read, so a later frame cannot change what an earlier reading measured, and two
// frames can be held side by side — which is what `hud-lives` and `hud-bays`
// compare.
//
// The mapping from a stage coordinate to a device pixel is the harness's own
// `h.device`, so a raster reads the same under whatever fit and pixel density a
// check built its harness at.
//
// NOTHING HERE FIXES A BOUND A VERDICT TURNS ON. What counts as two pixels
// differing, how much of a rectangle must differ, and how far a glyph must sit
// from the ground behind it are each the deciding point's own figure, stated in
// the point. The one number below, the bucket the commonest colour is counted in,
// is how a reading is TAKEN rather than what it is held to.

import { STAGE_H, STAGE_W } from "../constants";
import { assertTrue } from "../assert";
import { colorDistance, type Harness, type Rgb } from "../harness";

/** A rectangle of the rendered stage, as the bytes the build painted into it. */
export interface Raster {
  /** The rectangle actually read, in stage units. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Its size in device pixels. */
  width: number;
  height: number;
  /** Device pixels per stage unit, as the engine fitted the stage. */
  scale: number;
  /** Three bytes per pixel, row-major from the rectangle's top-left corner. */
  rgb: Uint8Array;
}

/**
 * Read the stage rectangle `(x, y, w, h)` off the canvas the build drew on.
 *
 * The rectangle is mapped onto the canvas exactly as {@link Harness.device} maps
 * a point, then clamped to the backing store, so what comes back is the part of
 * the rectangle that is actually on the canvas and says where that part is in
 * stage units.
 */
export function readRaster(
  h: Harness,
  x: number,
  y: number,
  w: number,
  height: number,
): Raster {
  const view = h.engine.viewport();
  assertTrue(
    h.canvas.width > 0 && h.canvas.height > 0,
    "the runtime drew into a canvas with area, so a frame's pixels can be read",
  );
  const topLeft = h.device(x, y);
  const bottomRight = h.device(x + w, y + height);
  const left = Math.max(0, Math.min(topLeft.x, h.canvas.width - 1));
  const top = Math.max(0, Math.min(topLeft.y, h.canvas.height - 1));
  const pixelW = Math.max(
    1,
    Math.min(bottomRight.x - topLeft.x, h.canvas.width - left),
  );
  const pixelH = Math.max(
    1,
    Math.min(bottomRight.y - topLeft.y, h.canvas.height - top),
  );

  const { data } = h.ctx.getImageData(left, top, pixelW, pixelH);
  const rgb = new Uint8Array(pixelW * pixelH * 3);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    rgb[j] = data[i];
    rgb[j + 1] = data[i + 1];
    rgb[j + 2] = data[i + 2];
  }
  return {
    x: (left - view.offsetX) / view.scale,
    y: (top - view.offsetY) / view.scale,
    w: pixelW / view.scale,
    h: pixelH / view.scale,
    width: pixelW,
    height: pixelH,
    scale: view.scale,
    rgb,
  };
}

/** The whole stage, for a reading that samples points all over it. */
export function stageRaster(h: Harness): Raster {
  return readRaster(h, 0, 0, STAGE_W, STAGE_H);
}

/** How many device pixels the raster holds. */
export function pixelCount(raster: Raster): number {
  return raster.width * raster.height;
}

/** The colour of the device pixel at `index`. */
export function colorAt(raster: Raster, index: number): Rgb {
  const at = index * 3;
  return { r: raster.rgb[at], g: raster.rgb[at + 1], b: raster.rgb[at + 2] };
}

/** Where the device pixel at `index` sits, in stage units. */
export function pointAt(
  raster: Raster,
  index: number,
): { x: number; y: number } {
  return {
    x: raster.x + (index % raster.width) / raster.scale,
    y: raster.y + Math.floor(index / raster.width) / raster.scale,
  };
}

/** The colour at a stage point, clamped to the raster's own bounds. */
export function colorAtPoint(raster: Raster, x: number, y: number): Rgb {
  const cx = Math.min(
    Math.max(Math.round((x - raster.x) * raster.scale), 0),
    raster.width - 1,
  );
  const cy = Math.min(
    Math.max(Math.round((y - raster.y) * raster.scale), 0),
    raster.height - 1,
  );
  return colorAt(raster, cy * raster.width + cx);
}

/**
 * Every index at which two rasters of the same rectangle differ by more than
 * `minDistance`, as an RGB distance.
 *
 * The two must have been read over the same rectangle; a caller that reads one
 * rectangle twice gets that for free.
 */
export function differingPixels(
  a: Raster,
  b: Raster,
  minDistance: number,
): number[] {
  const count = Math.min(pixelCount(a), pixelCount(b));
  const indexes: number[] = [];
  for (let i = 0; i < count; i += 1) {
    if (colorDistance(colorAt(a, i), colorAt(b, i)) > minDistance) {
      indexes.push(i);
    }
  }
  return indexes;
}

/** How many device pixels cover one square unit of the stage. */
export function unitArea(raster: Raster): number {
  return raster.scale * raster.scale;
}

/** Every colour of the raster whose stage point `keep` accepts. */
export function colorsWhere(
  raster: Raster,
  keep: (at: { x: number; y: number }) => boolean,
): Rgb[] {
  const colors: Rgb[] = [];
  for (let i = 0; i < pixelCount(raster); i += 1) {
    if (keep(pointAt(raster, i))) colors.push(colorAt(raster, i));
  }
  return colors;
}

/**
 * How coarsely a colour is bucketed when the commonest one is looked for.
 *
 * Sixteen levels a channel. Coarse enough that a gradient, a dither or a
 * texture's noise still falls in one bucket, fine enough that two colours a
 * player tells apart never do.
 */
const BUCKET = 16;

/**
 * The commonest colour of a sample, as the average of the pixels that share its
 * bucket.
 *
 * What "the background behind it" means for a run of text: the colour most of
 * the area around the run is, taken as the mode rather than the mean so that a
 * neighbouring glyph, a border or a shadow in the sample cannot drag the reading
 * toward the ink it is supposed to be measured against.
 */
export function modalColor(colors: readonly Rgb[]): Rgb {
  if (colors.length === 0) return { r: 0, g: 0, b: 0 };
  const buckets = new Map<
    number,
    { r: number; g: number; b: number; n: number }
  >();
  for (const color of colors) {
    const key =
      (Math.floor(color.r / BUCKET) << 16) |
      (Math.floor(color.g / BUCKET) << 8) |
      Math.floor(color.b / BUCKET);
    const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0 };
    bucket.r += color.r;
    bucket.g += color.g;
    bucket.b += color.b;
    bucket.n += 1;
    buckets.set(key, bucket);
  }
  let best = { r: 0, g: 0, b: 0, n: 0 };
  for (const bucket of buckets.values()) if (bucket.n > best.n) best = bucket;
  return { r: best.r / best.n, g: best.g / best.n, b: best.b / best.n };
}
