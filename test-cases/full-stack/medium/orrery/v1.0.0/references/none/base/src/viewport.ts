// Orrery — fitting the fixed `STAGE_W x STAGE_H` stage onto the canvas
// (specs/overview.md "Coordinate system and presentation").
//
// The page gives the canvas the whole window and sizes nothing; the fit is
// this build's: one uniform scale so the aspect ratio holds and the complete
// stage is on screen at every window size, the leftover split into two equal
// letterbox bars carrying the stage's own background, and the device pixel
// ratio folded in so the picture is sharp on a dense display.
//
// The game draws in logical units and never asks how big a unit is. This is
// the only module that knows, and the only one that reads a measurement off
// the DOM — through a {@link Surface}, so the runtime can be stood up over a
// canvas with no document behind it and checked without a browser.

import { STAGE_H, STAGE_W } from "./constants";

/**
 * The map from logical stage space onto the canvas's backing store, in device
 * pixels: a logical point `(x, y)` lands at
 * `(offsetX + x * scale, offsetY + y * scale)`.
 */
export interface Fit {
  /** Device pixels per logical unit. */
  readonly scale: number;
  /** The left letterbox bar, in device pixels. */
  readonly offsetX: number;
  /** The top letterbox bar, in device pixels. */
  readonly offsetY: number;
  /** The backing store's width, in device pixels. */
  readonly width: number;
  /** The backing store's height, in device pixels. */
  readonly height: number;
}

/**
 * Where the runtime reads the drawing surface's size, position, and pixel
 * density, and what it listens for key and pointer events on. Every
 * measurement the runtime would otherwise take from the DOM passes through
 * here.
 */
export interface Surface {
  /** The canvas element's laid-out width, in CSS pixels. */
  cssWidth(): number;
  /** The canvas element's laid-out height, in CSS pixels. */
  cssHeight(): number;
  /** Device pixels per CSS pixel. */
  dpr(): number;
  /** The canvas element's top-left corner in the pointer's client space. */
  origin(): { left: number; top: number };
}

/** A device pixel ratio worth multiplying by; anything else collapses to `1`. */
function normalizeDpr(dpr: number): number {
  return Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
}

/** A non-negative, finite dimension; anything else collapses to `0`. */
function normalizeSize(size: number): number {
  return Number.isFinite(size) && size > 0 ? size : 0;
}

/** The backing-store size, in whole device pixels, of a CSS dimension. */
export function deviceSize(cssSize: number, dpr: number): number {
  return Math.round(normalizeSize(cssSize) * normalizeDpr(dpr));
}

/**
 * The letterboxed, centered, device-pixel-ratio-aware fit of the stage into an
 * element of `cssWidth x cssHeight`.
 *
 * A degenerate input — a zero-sized element, which is what a canvas reports
 * before the page has laid out — yields `scale: 0`. That draws nothing for one
 * frame and recovers on the next, which is why the fit is re-derived every
 * frame rather than once at start-up.
 */
export function computeFit(
  cssWidth: number,
  cssHeight: number,
  dpr: number,
): Fit {
  const ratio = normalizeDpr(dpr);
  const availableW = normalizeSize(cssWidth);
  const availableH = normalizeSize(cssHeight);
  const uniform =
    availableW > 0 && availableH > 0
      ? Math.min(availableW / STAGE_W, availableH / STAGE_H)
      : 0;
  const scale = uniform * ratio;
  const width = deviceSize(availableW, ratio);
  const height = deviceSize(availableH, ratio);
  return {
    scale,
    offsetX: (width - STAGE_W * scale) / 2,
    offsetY: (height - STAGE_H * scale) / 2,
    width,
    height,
  };
}

/**
 * Size the canvas's backing store to the space the page gave the element and
 * report the fit. The store is only written when the size has changed, so a
 * steady frame costs nothing here and no frame is thrown away by a needless
 * resize.
 */
export function syncCanvas(
  canvas: { width: number; height: number },
  surface: Surface,
): Fit {
  const fit = computeFit(
    surface.cssWidth(),
    surface.cssHeight(),
    surface.dpr(),
  );
  const width = Math.max(1, fit.width);
  const height = Math.max(1, fit.height);
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  return fit;
}

/**
 * A client-space pointer position mapped into the stage's logical units, or
 * `null` while the fit is degenerate and there is no logical point to map to.
 *
 * This is the inverse of the fit, with the canvas's client position and the
 * pixel ratio folded in — exactly the map Orrery needs, because the game hit
 * tests a pointer position against a hex center with no conversion of its own
 * (specs/overview.md).
 */
export function clientToStage(
  fit: Fit,
  origin: { left: number; top: number },
  dpr: number,
  clientX: number,
  clientY: number,
): { x: number; y: number } | null {
  if (!(fit.scale > 0)) return null;
  const ratio = normalizeDpr(dpr);
  return {
    x: ((clientX - origin.left) * ratio - fit.offsetX) / fit.scale,
    y: ((clientY - origin.top) * ratio - fit.offsetY) / fit.scale,
  };
}

/**
 * The default surface: the canvas element's own laid-out size and position and
 * the window's pixel ratio. The only place this build takes a measurement off
 * the DOM.
 */
export function domSurface(canvas: HTMLCanvasElement): Surface {
  return {
    cssWidth: () => canvas.clientWidth,
    cssHeight: () => canvas.clientHeight,
    dpr: () => window.devicePixelRatio,
    origin: () => {
      const rect = canvas.getBoundingClientRect();
      return { left: rect.left, top: rect.top };
    },
  };
}
