// presentation/raster — a rectangle of what the build actually painted, read in
// one crossing into the page. PRIVATE to `presentation/`.
//
// The shared harness reads pixels as a LIST OF POINTS, one `getImageData` per
// point, which is the right shape for the handful of samples a band reading takes
// and the wrong one for the three points here that read a REGION: `hud-lives` and
// `hud-bays`, which find a readout by what MOVED when the value behind it was
// posed, and `submerged-bear-visible`, which reads a whole tile with the bear on
// it and again with the bear cleared. All three want thousands of pixels of one
// rectangle at once, so this takes the rectangle in a single `getImageData` and
// brings it back as one string of bytes.
//
// WHY IT IS LOCAL. Reading a region is the presentation group's own business —
// nothing outside it reads one — and the shared harness is edited by every group
// at once. It is also deliberately thin: it maps the stage's units onto the
// canvas the same way {@link Harness.device} does, and does nothing else.
//
// NOTHING HERE FIXES A BOUND A VERDICT TURNS ON, AND NOTHING HERE MEASURES
// APPEARANCE. Every point that uses this asks the same question of a rectangle —
// did any pixel of it change — and passes `0` for the distance below, so what
// comes back is presence rather than contrast.

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
