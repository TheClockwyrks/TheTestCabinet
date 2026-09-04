// Wick — fitting the fixed 1280 x 720 logical stage onto the canvas
// (specs/overview.md "Units, ticks, the world, and the camera").
//
// The page gives the canvas the whole window; the fit is this build's: the
// uniform scale that preserves the aspect ratio, the letterboxed centering,
// and the device pixel ratio, so the complete stage is on screen at every
// window size and pixel density. Everything the game draws is in logical
// units; this file alone knows what a unit is worth in device pixels.
//
// The pointer is read through that same fit, so a click lands where the
// picture is: an event's client position and its wheel travel come back here
// to be turned into stage units before the game sees either.

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

/** A point on the logical stage, in units. */
export interface StagePoint {
  x: number;
  y: number;
}

/** As much of the canvas's box on the page as a client position needs. */
export interface CssBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The canvas's box on the page, or the stage's own before it is laid out. */
export function cssBox(canvas: HTMLCanvasElement): CssBox {
  if (typeof canvas.getBoundingClientRect === "function") {
    const { left, top, width, height } = canvas.getBoundingClientRect();
    if (width > 0 && height > 0) return { left, top, width, height };
  }
  return {
    left: 0,
    top: 0,
    width: canvas.clientWidth || STAGE_W,
    height: canvas.clientHeight || STAGE_H,
  };
}

/** Device pixels per CSS pixel along each axis, under `fit` on `box`. */
function density(fit: Fit, box: CssBox): StagePoint {
  return {
    x: box.width > 0 ? fit.width / box.width : 1,
    y: box.height > 0 ? fit.height / box.height : 1,
  };
}

/**
 * Where an event's client position falls on the stage. A point on a letterbox
 * bar lands outside `0` to `STAGE_W` or `0` to `STAGE_H`, which is what puts
 * it inside no menu rectangle.
 */
export function clientToStage(
  fit: Fit,
  box: CssBox,
  clientX: number,
  clientY: number,
): StagePoint {
  const per = density(fit, box);
  return {
    x: ((clientX - box.left) * per.x - fit.offsetX) / fit.scale,
    y: ((clientY - box.top) * per.y - fit.offsetY) / fit.scale,
  };
}

/** Vertical wheel travel, in CSS pixels, as stage units. */
export function wheelToStage(fit: Fit, box: CssBox, delta: number): number {
  return (delta * density(fit, box).y) / fit.scale;
}
