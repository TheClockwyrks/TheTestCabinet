// presentation/raster — a rectangle of what the build actually painted, read in
// one crossing into the page. PRIVATE to `presentation/`.
//
// The shared harness reads pixels as a LIST OF POINTS, one `getImageData` per
// point, which is the right shape for the handful of samples a band check or
// `./body.ts` takes and the wrong one for the two points here that read a
// REGION: `hud-bays`, which finds each bay's mark by what MOVED when that bay
// was posed filled, and `text-legible`, which weighs every glyph of a run
// against the background around it. Both want thousands of pixels of one
// rectangle at once, so this takes the rectangle in a single `getImageData` and
// brings it back as one string of bytes.
//
// WHY IT IS LOCAL. Reading a region is the presentation group's own business —
// nothing outside it reads one — and the shared harness is edited by every group
// at once. It is also deliberately thin: it maps the stage's units onto the
// canvas the same way {@link Harness.device} does, and does nothing else.
//
// NOTHING HERE FIXES A BOUND A VERDICT TURNS ON. What counts as two pixels
// differing, how much of a rectangle must differ, and how far a glyph must sit
// from the background behind it are each the deciding point's own figure, stated
// in the point. The one number below, the bucket the commonest colour is counted
// in, is how a reading is TAKEN rather than what it is held to.

import { colorDistance, type Harness, type Rgb } from "../harness";

/** A rectangle of the rendered stage, as the bytes the build painted into it. */
export interface Raster {
  /** The rectangle actually read, in logical stage units. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Its size in device pixels. */
  width: number;
  height: number;
  /** Device pixels per logical unit, as the harness fitted the stage. */
  scale: number;
  /** Three bytes per pixel, row-major from the rectangle's top-left corner. */
  rgb: Uint8Array;
}

/** What the page hands back: the rectangle it could read, and its bytes. */
interface EncodedRaster {
  x: number;
  y: number;
  width: number;
  height: number;
  data: string;
}

/**
 * Read the logical rectangle `(x, y, w, h)` off the canvas the build drew on.
 *
 * The rectangle is mapped onto the canvas exactly as {@link Harness.device}
 * maps a point, then clamped to the backing store, so what comes back is the
 * part of the rectangle that is actually on the canvas and says where that part
 * is in stage units.
 */
export async function readRaster(
  h: Harness,
  x: number,
  y: number,
  w: number,
  hgt: number,
): Promise<Raster> {
  const view = h.viewport();
  // One pixel through the harness first: on a build that draws only from its own
  // frame loop, that read is what waits for the loop to present, so the
  // rectangle below is the frame this check posed rather than the one before it.
  await h.pixel(x, y);
  const topLeft = h.device(x, y);
  const bottomRight = h.device(x + w, y + hgt);
  const encoded = (await h.page.evaluate(
    (rect) => {
      const canvases = Array.from(document.querySelectorAll("canvas"));
      if (canvases.length === 0) {
        throw new Error("floe: the page has no <canvas> to read");
      }
      let canvas = canvases[0];
      for (const other of canvases) {
        if (other.width * other.height > canvas.width * canvas.height) {
          canvas = other;
        }
      }
      const ctx = canvas.getContext("2d");
      if (ctx === null) throw new Error("floe: the canvas has no 2D context");
      const left = Math.max(0, Math.min(rect.x, canvas.width - 1));
      const top = Math.max(0, Math.min(rect.y, canvas.height - 1));
      const width = Math.max(1, Math.min(rect.width, canvas.width - left));
      const height = Math.max(1, Math.min(rect.height, canvas.height - top));
      const { data } = ctx.getImageData(left, top, width, height);
      const rgb = new Uint8Array(width * height * 3);
      for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
        rgb[j] = data[i];
        rgb[j + 1] = data[i + 1];
        rgb[j + 2] = data[i + 2];
      }
      // Base64 rather than an array of numbers: a bay mark's rectangle is a
      // quarter of a million channels and one string crosses in one piece.
      const CHUNK = 0x8000;
      let binary = "";
      for (let i = 0; i < rgb.length; i += CHUNK) {
        binary += String.fromCharCode(...rgb.subarray(i, i + CHUNK));
      }
      return { x: left, y: top, width, height, data: btoa(binary) };
    },
    {
      x: topLeft.x,
      y: topLeft.y,
      width: Math.max(1, bottomRight.x - topLeft.x),
      height: Math.max(1, bottomRight.y - topLeft.y),
    },
  )) as EncodedRaster;

  const binary = atob(encoded.data);
  const rgb = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) rgb[i] = binary.charCodeAt(i);
  return {
    x: (encoded.x - view.offsetX) / view.scale,
    y: (encoded.y - view.offsetY) / view.scale,
    w: encoded.width / view.scale,
    h: encoded.height / view.scale,
    width: encoded.width,
    height: encoded.height,
    scale: view.scale,
    rgb,
  };
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

/** Where the device pixel at `index` sits, in logical stage units. */
export function pointAt(
  raster: Raster,
  index: number,
): { x: number; y: number } {
  return {
    x: raster.x + (index % raster.width) / raster.scale,
    y: raster.y + Math.floor(index / raster.width) / raster.scale,
  };
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

/** Every colour of the raster whose logical point `keep` accepts. */
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
