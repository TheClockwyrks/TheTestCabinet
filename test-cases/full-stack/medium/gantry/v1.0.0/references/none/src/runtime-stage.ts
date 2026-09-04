// The canvas fit: the fixed logical stage inside whatever the window gives us.
//
// `specs/overview.md` fixes a stage of `STAGE_W x STAGE_H` logical units and
// leaves fitting it to the runtime: one uniform scale that preserves the aspect
// ratio, the leftover space split evenly as letterbox bars, and a backing store
// at the device pixel ratio. The whole stage is on screen at every window size,
// on load, and at any pixel density.
//
// Everything here is pure arithmetic over sizes, so it runs in Node and is
// tested there. The two functions that touch a canvas do nothing but read its
// measured size and write its backing-store size.

import { STAGE_H, STAGE_W } from "./constants";

/** A rectangle as a `DOMRect` gives one, in CSS pixels. */
export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A rectangle in device pixels, measured from the top-left of the canvas. */
export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where the logical stage sits inside the canvas, and how big it is drawn. */
export interface StageFit {
  /** The canvas's CSS size, which is what the browser lays out. */
  cssWidth: number;
  cssHeight: number;
  /** The device pixel ratio the backing store is sized at. */
  dpr: number;
  /** CSS pixels per logical stage unit. The one uniform scale. */
  scale: number;
  /** The stage's top-left corner inside the canvas, in CSS pixels. */
  offsetX: number;
  offsetY: number;
  /** The backing store's size, in device pixels. */
  pixelWidth: number;
  pixelHeight: number;
  /**
   * The stage inside that backing store, in device pixels: what a renderer
   * draws the yard into, with the rest of the canvas left as letterbox.
   */
  viewport: PixelRect;
}

/** A measurement that is missing, zero, or nonsense stands in as one pixel. */
function sane(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Fit the stage into a canvas of the given CSS size at the given pixel ratio.
 *
 * The scale is the smaller of the two ratios, so the whole stage fits on both
 * axes, and the remainder is split evenly to centre it.
 */
export function stageFit(
  cssWidth: number,
  cssHeight: number,
  dpr = 1,
): StageFit {
  const width = sane(cssWidth, 1);
  const height = sane(cssHeight, 1);
  const ratio = sane(dpr, 1);
  const scale = Math.min(width / STAGE_W, height / STAGE_H);
  const offsetX = (width - STAGE_W * scale) / 2;
  const offsetY = (height - STAGE_H * scale) / 2;
  const pixelWidth = Math.max(1, Math.round(width * ratio));
  const pixelHeight = Math.max(1, Math.round(height * ratio));
  const viewX = Math.round(offsetX * ratio);
  const viewY = Math.round(offsetY * ratio);
  return {
    cssWidth: width,
    cssHeight: height,
    dpr: ratio,
    scale,
    offsetX,
    offsetY,
    pixelWidth,
    pixelHeight,
    viewport: {
      x: viewX,
      y: viewY,
      width: Math.max(1, pixelWidth - 2 * viewX),
      height: Math.max(1, pixelHeight - 2 * viewY),
    },
  };
}

/**
 * The logical stage position of a point on the canvas, given in the canvas's
 * own CSS pixels from its top-left corner.
 *
 * A point over a letterbox bar lands outside `0..STAGE_W` or `0..STAGE_H`, and
 * is left there rather than clamped: an orbit drag that leaves the stage keeps
 * turning the camera, and a click out there simply picks nothing.
 */
export function stagePoint(
  fit: StageFit,
  cssX: number,
  cssY: number,
): { x: number; y: number } {
  return {
    x: (cssX - fit.offsetX) / fit.scale,
    y: (cssY - fit.offsetY) / fit.scale,
  };
}

/** The logical stage position of a client point, against the canvas's rect. */
export function stagePointFromRect(
  rect: RectLike,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const fit = stageFit(rect.width, rect.height, 1);
  return stagePoint(fit, clientX - rect.left, clientY - rect.top);
}

/** Whether a logical stage position is on the stage rather than a bar. */
export function onStage(point: { x: number; y: number }): boolean {
  return (
    point.x >= 0 && point.x <= STAGE_W && point.y >= 0 && point.y <= STAGE_H
  );
}

/** What a canvas currently measures, as the browser has laid it out. */
export function measureStageFit(canvas: HTMLCanvasElement): StageFit {
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio;
  return stageFit(canvas.clientWidth, canvas.clientHeight, dpr);
}

/**
 * Give the canvas a backing store of the fit's device-pixel size.
 *
 * The page's stylesheet lays the canvas out over the window, so the CSS size is
 * the browser's; only the backing store is ours. Writing `width` or `height`
 * clears the canvas, so both are written only when they actually change.
 * Answers whether anything changed.
 */
export function sizeCanvas(canvas: HTMLCanvasElement, fit: StageFit): boolean {
  if (canvas.width === fit.pixelWidth && canvas.height === fit.pixelHeight) {
    return false;
  }
  canvas.width = fit.pixelWidth;
  canvas.height = fit.pixelHeight;
  return true;
}
