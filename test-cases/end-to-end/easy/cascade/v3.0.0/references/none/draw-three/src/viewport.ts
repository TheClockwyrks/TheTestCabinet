// Cascade — fitting the fixed logical stage onto the canvas.
//
// The game draws in a fixed 1280x720 space (specs/overview.md) and never looks at
// the window. This module is the whole of the map from that space onto the
// canvas's backing store: one uniform scale so the aspect ratio holds and the
// entire stage stays visible, the leftover split into two equal letterbox bars,
// and the device pixel ratio folded into the scale so the picture is sharp on a
// dense display.
//
// The fit is a pure function of four numbers, so it is checked without a browser.
// Where those four numbers come from is a {@link Surface}, which is the one seam
// the DOM is read through, and which is what lets the runtime run over a canvas
// with no document behind it.

/**
 * The map from logical stage space onto the canvas's backing store, in device
 * pixels: a logical point `(x, y)` lands at
 * `(offsetX + x * scale, offsetY + y * scale)`.
 */
export interface Viewport {
  /** The logical design width; the game draws in `0..width`. */
  readonly width: number;
  /** The logical design height; the game draws in `0..height`. */
  readonly height: number;
  /** Device pixels per logical unit. */
  readonly scale: number;
  /** The left letterbox bar, in device pixels. */
  readonly offsetX: number;
  /** The top letterbox bar, in device pixels. */
  readonly offsetY: number;
}

/**
 * Where the runtime reads the drawing surface's size, its position and its pixel
 * density, and what it listens for input on. Every measurement the runtime would
 * otherwise take from the DOM passes through here.
 */
export interface Surface {
  /** The canvas element's laid-out width, in CSS pixels. */
  cssWidth(): number;
  /** The canvas element's laid-out height, in CSS pixels. */
  cssHeight(): number;
  /** The canvas element's top-left in client space, in CSS pixels. */
  origin(): { x: number; y: number };
  /** Device pixels per CSS pixel. */
  dpr(): number;
  /** The target pointer and key events are listened for on. */
  events(): EventTarget;
}

/** A device pixel ratio worth multiplying by; anything else collapses to `1`. */
function normalizeDpr(dpr: number): number {
  return Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
}

/** A non-negative, finite dimension; anything else collapses to `0`. */
function normalizeSize(size: number): number {
  return Number.isFinite(size) && size > 0 ? size : 0;
}

/**
 * The letterboxed, centered, device-pixel-ratio-aware fit of the logical stage
 * into an element of `cssWidth x cssHeight`.
 *
 * A degenerate input — a zero-sized element, which is what a canvas reports
 * before the page has laid out — yields `scale: 0`. That draws nothing for one
 * frame and recovers on the next, which is why the fit is re-derived every frame
 * rather than once at start-up.
 */
export function fitViewport(
  logicalWidth: number,
  logicalHeight: number,
  cssWidth: number,
  cssHeight: number,
  dpr: number,
): Viewport {
  const ratio = normalizeDpr(dpr);
  const width = normalizeSize(logicalWidth);
  const height = normalizeSize(logicalHeight);
  const availableW = normalizeSize(cssWidth);
  const availableH = normalizeSize(cssHeight);

  const fit =
    width > 0 && height > 0 && availableW > 0 && availableH > 0
      ? Math.min(availableW / width, availableH / height)
      : 0;
  const scale = fit * ratio;

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

/** The backing-store size, in whole device pixels, of a CSS dimension. */
export function deviceSize(cssSize: number, dpr: number): number {
  return Math.round(normalizeSize(cssSize) * normalizeDpr(dpr));
}

/**
 * A point in the canvas element's own CSS space, as a point on the logical
 * stage.
 *
 * The inverse of the fit above, and the only conversion the pointer needs: the
 * game hit-tests in logical units against the anchors specs/table.md fixes
 * (specs/overview.md), so nothing above this line ever sees a device pixel. A
 * degenerate fit, whose scale is zero, has no inverse and yields `null`.
 */
export function toLogical(
  view: Viewport,
  dpr: number,
  cssX: number,
  cssY: number,
): { x: number; y: number } | null {
  if (!(view.scale > 0)) return null;
  const ratio = normalizeDpr(dpr);
  return {
    x: (cssX * ratio - view.offsetX) / view.scale,
    y: (cssY * ratio - view.offsetY) / view.scale,
  };
}

/**
 * The default surface: the canvas element's own laid-out size and position, the
 * window's pixel ratio, and events read from the document.
 *
 * The only place this build touches the DOM for a measurement. Pointer and key
 * events are listened for on the document rather than on the canvas, so a drag
 * that leaves the canvas still delivers its release.
 */
export function domSurface(canvas: HTMLCanvasElement): Surface {
  return {
    cssWidth: () => canvas.clientWidth,
    cssHeight: () => canvas.clientHeight,
    origin: () => {
      const rect = canvas.getBoundingClientRect();
      return { x: rect.left, y: rect.top };
    },
    dpr: () => window.devicePixelRatio,
    events: () => document,
  };
}
