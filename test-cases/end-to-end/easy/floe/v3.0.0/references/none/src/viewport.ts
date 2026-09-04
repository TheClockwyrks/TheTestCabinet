// Floe — fitting the fixed stage onto the canvas.
//
// The game draws in a fixed `1280 x 720` stage (specs/overview.md) and never
// looks at the window. This module is the whole map from that stage onto the
// canvas's backing store: one uniform scale, so the aspect ratio holds and the
// entire stage — the HUD bar, the strait, and all four edges — stays visible; the
// leftover split into two equal letterbox bars; and the device pixel ratio folded
// into the scale so the pixel art stays crisp on a dense display.
//
// The fit is a pure function of four numbers, so it is checked without a browser.
// Where those four numbers come from is a {@link Surface}, the one seam the DOM
// is read through — which is also what lets the runtime run over a canvas with no
// document behind it.

/**
 * The map from the stage onto the canvas's backing store, in device pixels: a
 * stage point `(x, y)` lands at `(offsetX + x * scale, offsetY + y * scale)`.
 */
export interface Viewport {
  /** The stage's logical width. */
  readonly width: number;
  /** The stage's logical height. */
  readonly height: number;
  /** Device pixels per logical unit. */
  readonly scale: number;
  /** The left letterbox bar, in device pixels. */
  readonly offsetX: number;
  /** The top letterbox bar, in device pixels. */
  readonly offsetY: number;
}

/**
 * Where the runtime reads the drawing surface's size and pixel density, and what
 * it listens for keys on. Every measurement the runtime would otherwise take
 * straight from the DOM passes through here.
 */
export interface Surface {
  /** The canvas element's laid-out width, in CSS pixels. */
  cssWidth(): number;
  /** The canvas element's laid-out height, in CSS pixels. */
  cssHeight(): number;
  /** Device pixels per CSS pixel. */
  dpr(): number;
  /** The target key events are listened for on. */
  events(): EventTarget;
}

/** A pixel ratio worth multiplying by; anything else collapses to `1`. */
function usableDpr(dpr: number): number {
  return Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
}

/** A finite, positive dimension; anything else collapses to `0`. */
function usableSize(size: number): number {
  return Number.isFinite(size) && size > 0 ? size : 0;
}

/** The backing-store size, in whole device pixels, of a CSS dimension. */
export function deviceSize(cssSize: number, dpr: number): number {
  return Math.round(usableSize(cssSize) * usableDpr(dpr));
}

/**
 * The letterboxed, centered, pixel-ratio-aware fit of the stage into an element
 * of `cssWidth x cssHeight`.
 *
 * A degenerate input — a zero-sized element, which is what a canvas reports
 * before the page has laid out — yields `scale: 0`. That draws nothing for one
 * frame and recovers on the next, which is why the fit is re-derived every frame
 * rather than once at start-up.
 */
export function fitViewport(
  stageWidth: number,
  stageHeight: number,
  cssWidth: number,
  cssHeight: number,
  dpr: number,
): Viewport {
  const ratio = usableDpr(dpr);
  const width = usableSize(stageWidth);
  const height = usableSize(stageHeight);
  const availableW = usableSize(cssWidth);
  const availableH = usableSize(cssHeight);

  const uniform =
    width > 0 && height > 0 && availableW > 0 && availableH > 0
      ? Math.min(availableW / width, availableH / height)
      : 0;
  const scale = uniform * ratio;

  // Rounded exactly the way the backing store is sized, so the two bars really do
  // sum to the drawable area rather than leaving a sub-pixel seam at one edge.
  const deviceW = deviceSize(availableW, ratio);
  const deviceH = deviceSize(availableH, ratio);

  return {
    width,
    height,
    scale,
    offsetX: (deviceW - width * scale) / 2,
    offsetY: (deviceH - height * scale) / 2,
  };
}

/**
 * The default surface: the canvas element's own laid-out size, the window's pixel
 * ratio, and key events read from the document.
 *
 * The only place this build reads the DOM for a measurement.
 */
export function domSurface(canvas: HTMLCanvasElement): Surface {
  return {
    cssWidth: () => canvas.clientWidth,
    cssHeight: () => canvas.clientHeight,
    dpr: () => window.devicePixelRatio,
    events: () => document,
  };
}
