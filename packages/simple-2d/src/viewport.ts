/**
 * Fitting a fixed logical design size onto whatever canvas the page actually gave
 * us. This is engine-owned on purpose: every 2D game otherwise re-derives the same
 * letterbox arithmetic, usually forgets the device pixel ratio, and ships a build
 * that is either blurry on a retina display or clipped in a non-16:9 window.
 *
 * The model is: a game draws in *logical* coordinates — the `width` × `height` it
 * declared to `createEngine` — and never thinks about the canvas element again. The
 * viewport is the affine map from those coordinates onto the canvas's backing store.
 *
 * Three conventions are worth stating up front, because everything else follows:
 *
 * 1. **The scale is uniform.** A single `min` of the two axis ratios keeps the
 *    aspect ratio and guarantees the *whole* logical field stays visible; the
 *    leftover on the long axis is split into two equal bars (the offsets), so the
 *    field is centred rather than pinned to a corner. Fitting per-axis would fill
 *    the window but stretch the picture, and cropping would hide part of the play
 *    field — neither is acceptable for a game whose rules are stated in logical
 *    units.
 * 2. **`scale` and the offsets are in *device* pixels, not CSS pixels** — the device
 *    pixel ratio is folded into `scale`. That is what lets {@link applyViewport}
 *    set a correct transform from the viewport alone, with no second `dpr` argument
 *    to forget. A caller that needs the CSS-pixel figure (mapping a pointer event
 *    back into logical space, say) divides: CSS px per logical unit is
 *    `scale / dpr`, and a CSS-space point maps to logical as
 *    `(cssX * dpr - offsetX) / scale`.
 * 3. **Every measurement arrives through a {@link SurfaceMetrics}.** Nothing in this
 *    module reads `clientWidth` or `devicePixelRatio` on its own account;
 *    {@link syncCanvas} is handed the numbers. {@link domSurface} is the one place
 *    that touches the DOM for them, and it is only the *default* the engine passes.
 *    That seam is what lets the engine — and a validator driving it — run over a
 *    canvas with no document behind it, and get the same fit on every machine.
 */

import type { SurfaceMetrics, Viewport } from "./contract";

/**
 * A device pixel ratio we are willing to multiply by.
 *
 * A ratio arrives from a supplied surface as often as from a window, and a driver,
 * a test, or a detached document can hand us `0`, `NaN`, or nothing at all.
 * Falling back to `1` keeps a bad ratio from poisoning the transform, where it
 * would silently blank the canvas.
 */
function normalizeDpr(dpr: number): number {
  return Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
}

/** A non-negative, finite dimension; anything else collapses to `0`. */
function normalizeSize(size: number): number {
  return Number.isFinite(size) && size > 0 ? size : 0;
}

/**
 * Compute the letterboxed, centred, device-pixel-ratio-aware fit of a
 * `logicalWidth` × `logicalHeight` field into a `cssWidth` × `cssHeight` element.
 *
 * A degenerate input — a zero-size container (a hidden element, an element the
 * browser has not laid out yet), or a nonsense logical size — yields `scale: 0`
 * rather than an `Infinity` or `NaN` that would propagate into the canvas
 * transform and turn every subsequent draw into a silent no-op that is very hard
 * to trace back here. A zero scale draws nothing *this* frame and recovers on its
 * own as soon as the element has a size.
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
  const availW = normalizeSize(cssWidth);
  const availH = normalizeSize(cssHeight);

  const fit =
    width > 0 && height > 0 && availW > 0 && availH > 0
      ? Math.min(availW / width, availH / height)
      : 0;
  const scale = fit * ratio;

  // Round the device size the same way `syncCanvas` rounds the backing store, so
  // the two bars really do sum to the drawable area; centring against an unrounded
  // size would leave a sub-pixel seam at one edge.
  const deviceW = Math.round(availW * ratio);
  const deviceH = Math.round(availH * ratio);

  return {
    width,
    height,
    scale,
    offsetX: (deviceW - width * scale) / 2,
    offsetY: (deviceH - height * scale) / 2,
  };
}

/**
 * Point a 2D context at a viewport, so drawing in logical coordinates lands in the
 * right device pixels.
 *
 * `setTransform` *replaces* the current transform, which is the whole reason it is
 * used here in place of a `translate` + `scale` pair: this runs at the top of every
 * frame, and a compounding transform would scale the picture away to nothing within
 * a second. It also means the caller does not have to balance `save`/`restore`
 * around a game's rendering — whatever the game left behind is discarded next
 * frame.
 */
export function applyViewport(
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
): void {
  ctx.setTransform(
    viewport.scale,
    0,
    0,
    viewport.scale,
    viewport.offsetX,
    viewport.offsetY,
  );
}

/**
 * The measurements a canvas that really is in a document reports about itself.
 *
 * This is the default the engine uses when a build supplies no surface of its own,
 * and it is deliberately the *only* function in the package that reads a size out
 * of the DOM. Everything downstream takes numbers.
 *
 * The ratio and the event target both come from the canvas's *own* document rather
 * than the ambient `window`: a game rendered inside an iframe (a run's preview
 * pane, say) is sized by the ratio of the display it is actually on, and its key
 * events are where its own document is, not where the outer page is.
 */
export function domSurface(canvas: HTMLCanvasElement): SurfaceMetrics {
  return {
    cssWidth: (): number => canvas.clientWidth,
    cssHeight: (): number => canvas.clientHeight,
    dpr: (): number => canvas.ownerDocument.defaultView?.devicePixelRatio ?? 1,
    events: (): EventTarget => canvas.ownerDocument,
    // Measured at each event rather than held: the canvas moves with layout, and
    // a pointer position is mapped against where the element is now.
    origin: (): { x: number; y: number } => {
      const rect = canvas.getBoundingClientRect();
      return { x: rect.left, y: rect.top };
    },
    claimGestures: (): (() => void) => claimGestures(canvas),
    capturePointer: (pointerId: number): void => {
      // A capture on a pointer the element never saw throws, and a pointer that
      // ended between the event and this call is exactly that case.
      try {
        canvas.setPointerCapture(pointerId);
      } catch {
        // The pointer is already gone; there is nothing to route.
      }
    },
    releasePointerCapture: (pointerId: number): void => {
      try {
        canvas.releasePointerCapture(pointerId);
      } catch {
        // Already released, by the browser or by the pointer ending.
      }
    },
  };
}

/**
 * Takes the browser's own pointer gestures on the canvas, and returns the
 * function that gives them back.
 *
 * Four claims, and each one is a way a browser otherwise takes an input the game
 * was meant to receive:
 *
 * - `touch-action: none` stops a touch drag being taken for a pan or a
 *   pinch-zoom. Without it the browser claims the gesture part way through and
 *   the game receives a `pointercancel` instead of the rest of the drag, which
 *   is why touch appears to work for a moment and then stop.
 * - `user-select: none` and a transparent tap highlight stop a drag selecting
 *   the page around the canvas and stop a tap flashing a highlight rectangle.
 * - The `contextmenu` listener keeps the secondary button in the game rather
 *   than opening a menu over it.
 * - The non-passive `wheel` listener keeps the page from scrolling under the
 *   canvas. It is registered on the element rather than the document, so the
 *   page still scrolls everywhere else.
 *
 * Every claim is undone by the returned function, and the styles are restored to
 * whatever the page had set rather than cleared, so an engine torn down and
 * rebuilt over the same canvas leaves the page as it found it.
 */
function claimGestures(canvas: HTMLCanvasElement): () => void {
  const style = canvas.style as CSSStyleDeclaration & {
    webkitUserSelect?: string;
    webkitTapHighlightColor?: string;
  };
  const previous = {
    touchAction: style.touchAction,
    userSelect: style.userSelect,
    webkitUserSelect: style.webkitUserSelect,
    webkitTapHighlightColor: style.webkitTapHighlightColor,
  };
  style.touchAction = "none";
  style.userSelect = "none";
  style.webkitUserSelect = "none";
  style.webkitTapHighlightColor = "transparent";

  const swallow = (event: Event): void => {
    event.preventDefault();
  };
  canvas.addEventListener("contextmenu", swallow);
  canvas.addEventListener("wheel", swallow, { passive: false });

  return (): void => {
    style.touchAction = previous.touchAction;
    style.userSelect = previous.userSelect;
    style.webkitUserSelect = previous.webkitUserSelect ?? "";
    style.webkitTapHighlightColor = previous.webkitTapHighlightColor ?? "";
    canvas.removeEventListener("contextmenu", swallow);
    canvas.removeEventListener("wheel", swallow);
  };
}

/**
 * Whether the engine should write a pixel CSS size onto the element.
 *
 * The failure this exists to prevent is a feedback loop. An element the page has
 * not sized takes its CSS size *from* its `width`/`height` attributes — which are
 * exactly what the backing store writes — so sizing the backing store to
 * `css * dpr` feeds straight back into the next measurement and the canvas grows
 * by a factor of `dpr` every frame. Pinning the measured size breaks the loop.
 *
 * The test is therefore "does the reported size still look like the attributes",
 * *not* "is the inline style empty". A canvas sized by a stylesheet has an empty
 * inline style, and treating that as unsized would write a fixed pixel size over
 * the page's rule and freeze the canvas at whatever size it happened to be first
 * measured at — the exact opposite of what the pin is for.
 *
 * A page that sizes an element to precisely its attribute size, through a
 * stylesheet, is indistinguishable from an unsized one at this seam and gets a pin
 * equal to the size it asked for. That is the one ambiguity the rule accepts, and
 * it costs a canvas that was already the right size its responsiveness, whereas
 * reading the inline style costs *every* stylesheet-sized canvas its
 * responsiveness.
 */
function pageExpressedNoSize(
  canvas: HTMLCanvasElement,
  cssWidth: number,
  cssHeight: number,
): boolean {
  return cssWidth === canvas.width && cssHeight === canvas.height;
}

/**
 * Bring a canvas's backing store in line with the size and ratio `surface` reports,
 * and return the viewport that fits `logicalWidth` × `logicalHeight` into it.
 *
 * The backing store is written only when it actually differs: assigning
 * `canvas.width` clears the canvas and reallocates it even when the value is
 * unchanged, so an unconditional write once per frame would both flicker and churn
 * memory.
 *
 * A surface reporting `0` on either axis — `display: none`, or an element not yet
 * laid out — leaves the canvas the backing store it already had. Resizing it to
 * nothing would throw away the last good frame for no benefit, and the next call
 * recovers once the element has a size.
 */
export function syncCanvas(
  canvas: HTMLCanvasElement,
  logicalWidth: number,
  logicalHeight: number,
  surface: SurfaceMetrics,
): Viewport {
  const dpr = normalizeDpr(surface.dpr());
  const cssW = normalizeSize(surface.cssWidth());
  const cssH = normalizeSize(surface.cssHeight());
  const viewport = fitViewport(logicalWidth, logicalHeight, cssW, cssH, dpr);

  if (cssW > 0 && cssH > 0) {
    // Decided *before* the backing store is written, because writing it is what
    // makes the attributes stop matching the measurement.
    const pin = pageExpressedNoSize(canvas, cssW, cssH);

    const backingW = Math.round(cssW * dpr);
    const backingH = Math.round(cssH * dpr);
    if (canvas.width !== backingW) canvas.width = backingW;
    if (canvas.height !== backingH) canvas.height = backingH;

    // A canvas driven headlessly behind a supplied surface may expose no `style` at
    // all. It has no layout to feed back into either, so there is nothing to pin:
    // it simply keeps the size the surface reports.
    if (pin && canvas.style !== undefined) {
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
    }
  }

  return viewport;
}
