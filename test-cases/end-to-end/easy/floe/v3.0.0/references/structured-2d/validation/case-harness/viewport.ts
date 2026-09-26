// How a case's stage is mapped onto the canvas.

import type { Stage } from "./config";
import type { Point } from "./point";

/**
 * How the stage is mapped onto the canvas: one uniform scale and a letterbox.
 *
 * The CSS trio is the superset Volute needs and the other three cases do not
 * read: `scale`/`offsetX`/`offsetY` are DEVICE pixels, which is what a pixel
 * reading is addressed in, while `cssScale`/`cssOffsetX`/`cssOffsetY` are CSS
 * pixels, which is what the pointer is moved in. On a device-pixel-ratio of 1 —
 * the shape almost every check runs at — the two agree, which is exactly why
 * carrying only one of them is a trap.
 */
export interface Viewport {
  width: number;
  height: number;
  /** Device pixels per logical unit. */
  scale: number;
  /** The letterbox bars, in device pixels. */
  offsetX: number;
  offsetY: number;
  /** CSS pixels per logical unit, which is what the pointer is moved in. */
  cssScale: number;
  cssOffsetX: number;
  cssOffsetY: number;
}

/**
 * How the stage maps onto a surface of this shape, as a case's `specs/overview.md`
 * fixes it: one uniform scale, the whole stage inside, centred, with the leftover
 * split evenly into two bars.
 *
 * Computed rather than read from the build, deliberately. Under an engine the fit
 * is the engine's and a check can ask it what it derived; under no engine the fit
 * is the build's own work, so asking it would be asking a build to grade itself.
 * Every check but the one that is ABOUT the fit runs at the stage's own size,
 * where this is the identity and the question does not arise; that one check runs
 * at other shapes and reads the pixels against what the specification says should
 * be there.
 */
export function fitViewport(
  cssWidth: number,
  cssHeight: number,
  dpr: number,
  stage: Stage,
): Viewport {
  const deviceWidth = Math.round(cssWidth * dpr);
  const deviceHeight = Math.round(cssHeight * dpr);
  const cssScale = Math.min(cssWidth / stage.width, cssHeight / stage.height);
  const scale = cssScale * dpr;
  return {
    width: stage.width,
    height: stage.height,
    scale,
    offsetX: (deviceWidth - stage.width * scale) / 2,
    offsetY: (deviceHeight - stage.height * scale) / 2,
    cssScale,
    cssOffsetX: (cssWidth - stage.width * cssScale) / 2,
    cssOffsetY: (cssHeight - stage.height * cssScale) / 2,
  };
}

/**
 * Where a logical point lands in device pixels, which is what a pixel reading is
 * addressed in.
 *
 * Exported because the harness lives in its own module now; it was private to the
 * one file that held both halves before the extraction.
 */
export function toDevice(view: Viewport, x: number, y: number): Point {
  return {
    x: Math.round(view.offsetX + x * view.scale),
    y: Math.round(view.offsetY + y * view.scale),
  };
}
