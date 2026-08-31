// Kessler — fitting the fixed 1000 x 1000 logical stage onto the canvas
// (`specs/overview.md`).
//
// The page gives the canvas the whole window; the fit is this build's: the
// uniform scale that preserves the aspect ratio, the letterboxed centering,
// and the device pixel ratio, so the complete stage is on screen at every
// window size and pixel density. Everything the game draws is in logical
// units; this file is the only one that knows what a unit is worth in device
// pixels.

import { STAGE_SIZE } from "./constants";

/** How the logical stage sits inside the surface it is drawn on. */
export interface Fit {
  /** Device pixels per logical unit. */
  scale: number;
  /** The device-pixel offset of the stage's top-left corner. */
  offsetX: number;
  offsetY: number;
  /** The surface's size, in device pixels. */
  width: number;
  height: number;
}

/** Fit the square stage into a surface `width x height` device pixels big. */
export function computeFit(width: number, height: number): Fit {
  const scale = Math.min(width / STAGE_SIZE, height / STAGE_SIZE);
  return {
    scale,
    offsetX: (width - STAGE_SIZE * scale) / 2,
    offsetY: (height - STAGE_SIZE * scale) / 2,
    width,
    height,
  };
}

/**
 * Size the canvas's backing store to the space the page gave the element, at
 * `dpr` device pixels per CSS pixel, and report the fit. Setting the backing
 * store is skipped when the size has not changed, so a steady frame costs
 * nothing here.
 */
export function syncCanvas(canvas: HTMLCanvasElement, dpr: number): Fit {
  const cssWidth = canvas.clientWidth || STAGE_SIZE;
  const cssHeight = canvas.clientHeight || STAGE_SIZE;
  const width = Math.max(1, Math.round(cssWidth * dpr));
  const height = Math.max(1, Math.round(cssHeight * dpr));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  return computeFit(width, height);
}
