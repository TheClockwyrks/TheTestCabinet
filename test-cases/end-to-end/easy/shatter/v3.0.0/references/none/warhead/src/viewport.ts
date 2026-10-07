// Shatter — fitting the fixed logical field onto the canvas.
//
// The game draws in a fixed 1280x720 space (`specs/overview.md`) and never looks
// at the window. This module is the whole of the map from that space onto the
// canvas's backing store: one uniform scale so the aspect ratio holds and the
// whole field stays visible out to all four edges, the leftover split into two
// equal letterbox bars, and the device pixel ratio folded into the scale so the
// picture is sharp on a dense display.
//
// The fit is a pure function of four numbers, so it is checked without a browser.
// Where those four numbers come from is a {@link Surface}, which is the one seam
// the DOM is read through — and which is what lets the runtime run over a canvas
// with no document behind it.

/**
 * The map from logical design space onto the canvas's backing store, in device
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
 * Where the runtime reads the drawing surface's size and pixel density, and what
 * it listens for keys on. Every measurement the runtime would otherwise take from
 * the DOM passes through here.
 */
export interface Surface {
  /** The canvas element's laid-out width, in CSS pixels. */
  cssWidth(): number;
  /** The canvas element's laid-out height, in CSS pixels. */
  cssHeight(): number;
  /** Device pixels per CSS pixel. */
  dpr(): number;
  /** The target key and pointer events are listened for on. */
  events(): EventTarget;
  /** The drawing surface's top-left corner, in CSS pixels of the page. */
  clientOrigin(): { x: number; y: number };
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
 * Where a point in the page's CSS pixels lands in the logical field.
 *
 * The inverse of the fit: a logical `(x, y)` is drawn at
 * `(offsetX + x * scale, offsetY + y * scale)` in the backing store, and a
 * pointer reports its position in CSS pixels from the page's own origin. So the
 * point is taken to the canvas's corner, scaled into device pixels, and run back
 * through the fit. A degenerate fit — a canvas the page has not laid out yet —
 * has no inverse, and answers the field's centre, which belongs to no menu
 * entry.
 */
export function fieldPoint(
  view: Viewport,
  origin: { x: number; y: number },
  dpr: number,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  if (view.scale <= 0) return { x: view.width / 2, y: view.height / 2 };
  const ratio = normalizeDpr(dpr);
  return {
    x: ((clientX - origin.x) * ratio - view.offsetX) / view.scale,
    y: ((clientY - origin.y) * ratio - view.offsetY) / view.scale,
  };
}

/** The backing-store size, in whole device pixels, of a CSS dimension. */
export function deviceSize(cssSize: number, dpr: number): number {
  return Math.round(normalizeSize(cssSize) * normalizeDpr(dpr));
}

/**
 * The letterboxed, centred, device-pixel-ratio-aware fit of a logical field into
 * an element of `cssWidth x cssHeight`.
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

/**
 * The default surface: the canvas element's own laid-out size, the window's pixel
 * ratio, and key events read from the document.
 *
 * The only place this build touches the DOM for a measurement.
 */
export function domSurface(canvas: HTMLCanvasElement): Surface {
  return {
    cssWidth: () => canvas.clientWidth,
    cssHeight: () => canvas.clientHeight,
    dpr: () => window.devicePixelRatio,
    events: () => document,
    clientOrigin: () => {
      const box = canvas.getBoundingClientRect();
      return { x: box.left, y: box.top };
    },
  };
}
