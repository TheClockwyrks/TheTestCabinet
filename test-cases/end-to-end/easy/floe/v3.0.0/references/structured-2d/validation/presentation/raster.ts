// presentation — a rectangle of what the build actually PAINTED, read back in
// stage units. PRIVATE to `presentation/`.
//
// The shared harness reads pixels as a LIST OF POINTS — `h.pixel` is one
// `getImageData` per point — which is the right shape for the handful of samples
// a band reading takes and the wrong one for the three points here that read a
// REGION: `hud-lives` and `hud-bays`, which find a readout by what MOVED in the
// bar between two posed frames, and `submerged-bear-visible`, which reads a whole
// tile with the bear on it and again with the bear cleared. Each wants thousands
// of pixels of one rectangle at once, so this takes the rectangle in a single
// `getImageData` and holds it as one string of bytes.
//
// IT IS A SNAPSHOT, NOT A VIEW. The buffer is copied at the moment the raster is
// read, so a later frame cannot change what an earlier reading measured, and two
// frames can be held side by side — which is what all three of those points
// compare.
//
// The mapping from a stage coordinate to a device pixel is the harness's own
// `h.device`, so a raster reads the same under whatever fit and pixel density a
// check built its harness at.
//
// NOTHING HERE FIXES A BOUND A VERDICT TURNS ON, AND NOTHING HERE MEASURES
// APPEARANCE. Every point that uses this asks the same question of a rectangle —
// did any pixel of it change — and passes `0` for the distance below, so what
// comes back is presence rather than contrast.

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

/** How many device pixels the raster holds. */
export function pixelCount(raster: Raster): number {
  return raster.width * raster.height;
}

/** The colour of the device pixel at `index`. */
export function colorAt(raster: Raster, index: number): Rgb {
  const at = index * 3;
  return { r: raster.rgb[at], g: raster.rgb[at + 1], b: raster.rgb[at + 2] };
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
