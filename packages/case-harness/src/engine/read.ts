// What a check reads off an engine harness's canvas. 2D ONLY.
//
// THESE ARE THE SYNCHRONOUS TWINS OF `../color`. Under no engine a pixel is a
// round trip to a browser, so `../color`'s readings are `async` and take a
// `PointReader` that crosses into the page. Under an engine the canvas is in this
// process and `getImageData` answers now, so a reading is an ordinary call and a
// check reads `sampleColor(h, x, y)` without an `await` — which is what the
// engine harnesses have always done, in 135 suites per case that would otherwise
// all have to be rewritten to say `await` about a number that was already there.
//
// NOTHING IS DUPLICATED BY THAT SPLIT. Every reading that is PURE — the colour
// algebra, the luminances, the means, the point patterns, the medoid, the
// masks — lives in `../color` and is imported here. What this module adds is the
// three lines around them that take the pixels, and nothing else. The two halves
// therefore cannot drift on what a colour distance is or how a cluster is placed,
// which is the drift that mattered.
//
// TEXT IS READ THE SAME WAY IN BOTH HALVES, with one conversion. `../text`'s
// readings answer in CANVAS pixels, because that is where the calls were made.
// Under an engine a check states its expectations in the case's own LOGICAL
// units, so {@link inLogical} maps a reading back through the engine's own fit.
// At the harness's default shape — the stage's own size at a ratio of one — the
// fit is the identity and the conversion changes nothing, which is why it went
// unnoticed for as long as every check ran at that shape.

import { type Canvas, type SKRSContext2D } from "@napi-rs/canvas";
import { clusterPoints, meanOf, ringPoints, type Rgb } from "../color";
import type { Pixel, PixelRect } from "../pixels";
import type { Point } from "../point";
import type { TextDraw } from "../text";
import type { EngineViewport } from "./contract";

/** As much of an engine harness as a reading taken at POINTS needs. */
export interface EnginePointReader {
  /** The device pixel under a logical point, as `[r, g, b, a]`. */
  pixel(x: number, y: number): Pixel;
}

/** As much of an engine harness as a whole-frame reading needs. */
export interface EngineFrameReader {
  readonly canvas: Canvas;
  readonly ctx: SKRSContext2D;
}

/**
 * Where a logical point lands in the canvas's backing store, through the
 * engine's own fit.
 *
 * ROUNDED, because a backing store is addressed in whole pixels and a reading
 * that asked for a fractional one would be asking `getImageData` to choose. The
 * engines' own arithmetic is `offsetX + x * scale`, and this is that.
 */
export function deviceOf(view: EngineViewport, x: number, y: number): Point {
  return {
    x: Math.round(view.offsetX + x * view.scale),
    y: Math.round(view.offsetY + y * view.scale),
  };
}

/**
 * One device pixel, read off the context now.
 *
 * A POINT OFF THE BACKING STORE IS REPORTED AS ONE. `@napi-rs/canvas` answers a
 * `getImageData` whose rectangle is not wholly inside the surface with
 * `Read pixels from canvas failed` — a message that names neither the point asked
 * for nor the surface it was asked of, and that a suite reports as a bare `[fail]`
 * with no expected and no actual. A browser is no better a teacher the other way:
 * `CanvasRenderingContext2D` answers the same read with transparent black, so a
 * check that walked off the stage would quietly compare a row of zeroes. Neither
 * is a reading, so this refuses the read and says what was asked and of what,
 * which is the difference between "this check samples off the stage" and "the
 * canvas is broken".
 *
 * The bound is the BACKING STORE's, in device pixels: `deviceOf` has already
 * carried a logical point through the engine's fit, and a stage point outside the
 * letterbox is a point outside the surface however small the logical figure was.
 */
export function pixelAt(ctx: SKRSContext2D, at: Point): Pixel {
  const { width, height } = ctx.canvas;
  if (at.x < 0 || at.y < 0 || at.x >= width || at.y >= height) {
    throw new RangeError(
      `pixel (${String(at.x)}, ${String(at.y)}) lies outside the ` +
        `${String(width)} by ${String(height)} canvas: a reading has to name a ` +
        "point the build could have drawn on",
    );
  }
  const { data } = ctx.getImageData(at.x, at.y, 1, 1);
  return [
    data[0] as number,
    data[1] as number,
    data[2] as number,
    data[3] as number,
  ];
}

/** Every one of `points`, sampled in the order given. */
export function pixelsAt(
  h: EnginePointReader,
  points: readonly Point[],
): Pixel[] {
  return points.map((point) => h.pixel(point.x, point.y));
}

/**
 * The rendered colour at a logical point, averaged over a five-point cluster
 * `radius` logical units out on the axes.
 *
 * A CLUSTER RATHER THAN ONE PIXEL, because every edge a build draws is
 * anti-aliased and a build is free to draw a glow: one stray sample on a rim
 * reads as a mixture of the thing and whatever is behind it, and the mean over a
 * small cluster does not. The default radius is the one every engine harness that
 * declared this reading used.
 */
export function sampleColor(
  h: EnginePointReader,
  x: number,
  y: number,
  radius = 4,
): Rgb {
  return meanOf(pixelsAt(h, clusterPoints(x, y, radius)));
}

/**
 * The mean colour over a ring of `radius` units about a logical point.
 *
 * What reads a light whose core blows out toward white: the hue is in the halo
 * around such a thing rather than at its centre.
 */
export function sampleRing(
  h: EnginePointReader,
  x: number,
  y: number,
  radius: number,
): Rgb {
  return meanOf(pixelsAt(h, ringPoints(x, y, radius)));
}

/** Each of `points` sampled as {@link sampleColor} samples one, in order. */
export function samplePoints(
  h: EnginePointReader,
  points: readonly Point[],
  radius = 4,
): Rgb[] {
  return points.map((point) => sampleColor(h, point.x, point.y, radius));
}

/**
 * The canvas's whole backing store, copied.
 *
 * COPIED, and that is the point: a check holds one of these across a frame and
 * compares it against the next, and the buffer `getImageData` answers is not
 * guaranteed to outlive the next read. Two of them say whether anything the build
 * drew changed at all.
 */
export function canvasPixels(h: EngineFrameReader): Uint8ClampedArray {
  const { width, height } = h.canvas;
  return Uint8ClampedArray.from(h.ctx.getImageData(0, 0, width, height).data);
}

/** The canvas's whole backing store as a {@link PixelRect}, for `../color`. */
export function canvasRect(h: EngineFrameReader): PixelRect {
  const { width, height } = h.canvas;
  return {
    width,
    height,
    data: Uint8ClampedArray.from(h.ctx.getImageData(0, 0, width, height).data),
  };
}

/**
 * How many BYTES differ between two {@link canvasPixels} captures.
 *
 * Bytes rather than pixels, and no tolerance: this is the reading that answers
 * "did the build draw anything different at all", where any difference counts and
 * the size of it does not. `../color`'s `pixelsDiffering` is the other reading —
 * how many PIXELS moved by more than a tolerance — and a threshold stated over
 * one is meaningless over the other, so both ship.
 *
 * Two captures of different lengths differ by the whole of the difference, so a
 * check that compares frames at two shapes is told they are not the same picture
 * rather than being handed a count over the overlap.
 */
export function pixelsChanged(
  before: Uint8ClampedArray,
  after: Uint8ClampedArray,
): number {
  let changed = 0;
  const length = Math.min(before.length, after.length);
  for (let i = 0; i < length; i += 1) {
    if (before[i] !== after[i]) changed += 1;
  }
  return changed + Math.abs(before.length - after.length);
}

/**
 * A text reading taken in canvas pixels, restated in the case's logical units.
 *
 * The inverse of the engine's own fit: `(canvas - offset) / scale` on both axes,
 * with the horizontal extent taken through the same scale as the anchor. A
 * reading of one draw and a reading of a merged run convert identically, because
 * a run carries the same four numbers a draw does.
 */
export function inLogical(view: EngineViewport, draw: TextDraw): TextDraw {
  return {
    ...draw,
    x: (draw.x - view.offsetX) / view.scale,
    y: (draw.y - view.offsetY) / view.scale,
    left: (draw.left - view.offsetX) / view.scale,
    right: (draw.right - view.offsetX) / view.scale,
  };
}

/** {@link inLogical} over a whole reading. */
export function allInLogical(
  view: EngineViewport,
  draws: readonly TextDraw[],
): TextDraw[] {
  return draws.map((draw) => inLogical(view, draw));
}
