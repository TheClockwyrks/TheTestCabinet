// Orrery — how the stage is mapped onto a canvas. CASE-PROVIDED, and the SAME
// FILE in all three engine projects.
//
// `specs/overview.md` fits the `STAGE_W x STAGE_H` (`1280 x 720`) stage uniformly
// into whatever size the page gives the canvas, centred, with the leftover split
// into two letterbox bars. Every pixel reading a check takes is addressed in the
// stage's logical units and mapped through this.
//
// IT IS COMPUTED HERE RATHER THAN READ OFF THE BUILD, deliberately. Under an
// engine the fit is the engine's and could be asked for; under no engine it is
// the build's own work, and asking a build for the fit it should have produced is
// asking it to grade itself. Every check but the ones that are ABOUT the fit runs
// at the stage's own size, where this is the identity and the question does not
// arise; those run at other shapes and read the pixels against what the
// specification says should be there.

import { STAGE_H, STAGE_W } from "./constants";
import type { StagePoint } from "./field";

/** How the stage is mapped onto a canvas: one uniform scale and a letterbox. */
export interface Viewport {
  /** The logical design width; the game draws in `0..width`. */
  width: number;
  /** The logical design height. */
  height: number;
  /** Device pixels per logical unit. */
  scale: number;
  /** The left letterbox bar, in device pixels. */
  offsetX: number;
  /** The top letterbox bar, in device pixels. */
  offsetY: number;
  /** CSS pixels per logical unit, which is what a real pointer is moved in. */
  cssScale: number;
  cssOffsetX: number;
  cssOffsetY: number;
}

/** How the stage maps onto a surface of this shape. */
export function fitViewport(
  cssWidth: number,
  cssHeight: number,
  dpr = 1,
): Viewport {
  const deviceWidth = Math.round(cssWidth * dpr);
  const deviceHeight = Math.round(cssHeight * dpr);
  const cssScale = Math.min(cssWidth / STAGE_W, cssHeight / STAGE_H);
  const scale = cssScale * dpr;
  return {
    width: STAGE_W,
    height: STAGE_H,
    scale,
    offsetX: (deviceWidth - STAGE_W * scale) / 2,
    offsetY: (deviceHeight - STAGE_H * scale) / 2,
    cssScale,
    cssOffsetX: (cssWidth - STAGE_W * cssScale) / 2,
    cssOffsetY: (cssHeight - STAGE_H * cssScale) / 2,
  };
}

/** Where a logical point lands in device pixels, which is what a pixel read uses. */
export function toDevice(view: Viewport, x: number, y: number): StagePoint {
  return {
    x: Math.round(view.offsetX + x * view.scale),
    y: Math.round(view.offsetY + y * view.scale),
  };
}

/** Where a logical point lands in CSS pixels, which is what a real mouse uses. */
export function toCss(view: Viewport, x: number, y: number): StagePoint {
  return {
    x: view.cssOffsetX + x * view.cssScale,
    y: view.cssOffsetY + y * view.cssScale,
  };
}
