// Wick — fitting the fixed 1280 x 720 logical stage onto the canvas
// (specs/overview.md "Units, ticks, the world, and the camera").
//
// The page gives the canvas the whole window; the fit is this build's: the
// uniform scale that preserves the aspect ratio, the letterboxed centering,
// and the device pixel ratio, so the complete stage is on screen at every
// window size and pixel density. Everything the game draws is in logical
// units; this file alone knows what a unit is worth in device pixels.

import { STAGE_H, STAGE_W } from "./constants";

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

/** Fit the stage into a surface `width x height` device pixels big. */
export function computeFit(width: number, height: number): Fit {
  const scale = Math.min(width / STAGE_W, height / STAGE_H);
  return {
    scale,
    offsetX: (width - STAGE_W * scale) / 2,
    offsetY: (height - STAGE_H * scale) / 2,
    width,
    height,
  };
}

/**
 * Size the canvas's backing store to the space the page gave the element, at
 * `dpr` device pixels per CSS pixel, and report the fit. The backing store is
 * left alone when its size has not changed.
 */
export function syncCanvas(canvas: HTMLCanvasElement, dpr: number): Fit {
  const cssWidth = canvas.clientWidth || STAGE_W;
  const cssHeight = canvas.clientHeight || STAGE_H;
  const width = Math.max(1, Math.round(cssWidth * dpr));
  const height = Math.max(1, Math.round(cssHeight * dpr));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  return computeFit(width, height);
}
