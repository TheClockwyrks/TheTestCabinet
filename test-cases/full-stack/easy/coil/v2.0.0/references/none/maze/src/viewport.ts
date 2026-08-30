// Coil — fitting the fixed logical stage onto the canvas (specs/overview.md).
//
// The page gives the canvas the whole window, so the fit is the build's: a uniform
// scale that preserves the stage's aspect ratio, even letterboxing on the axis with
// room to spare, and a backing store at the window's device pixel ratio. The whole
// `STAGE_W x STAGE_H` stage is therefore on screen at every window size and at any
// pixel density, on the first frame before any input.
//
// Everything the game draws is in logical units. This file is the only place that
// knows what one logical unit is worth in device pixels.

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

/** Fit the stage into a surface `width x height` device pixels in size. */
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
 * Size the canvas's backing store to the space the page gave it, and report the
 * fit. The element's own size is the page's; this only ever sets the backing store,
 * so a resize costs nothing when the size has not changed.
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
