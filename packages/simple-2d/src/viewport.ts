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
 * Two conventions are worth stating up front, because everything else follows:
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
 */

/**
 * The map from a game's logical design size onto a canvas's backing store.
 *
 * `width`/`height` are readonly because they are the design size the game was
 * written against — they do not change when the window does. `scale` and the
 * offsets are not, so a resize handler may update a viewport in place rather than
 * forcing every holder of the object to re-read it.
 */
export interface Viewport {
  /** The logical design width; a game draws in `0..width`. */
  readonly width: number;
  /** The logical design height; a game draws in `0..height`. */
  readonly height: number;
  /** Device pixels per logical unit — the fit ratio with the device pixel ratio folded in. */
  scale: number;
  /** The left letterbox bar, in device pixels. */
  offsetX: number;
  /** The top letterbox bar, in device pixels. */
  offsetY: number;
}

/**
 * A device pixel ratio we are willing to multiply by.
 *
 * `window.devicePixelRatio` is well-behaved in a browser, but this function is also
 * reachable from a driver, a test, and a detached document, any of which can hand
 * us `0`, `NaN`, or nothing at all. Falling back to `1` keeps a bad ratio from
 * poisoning the transform, where it would silently blank the canvas.
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
 * `logicalW` × `logicalH` field into a `cssW` × `cssH` element.
 *
 * A degenerate input — a zero-size container (a hidden element, an element the
 * browser has not laid out yet), or a nonsense logical size — yields `scale: 0`
 * rather than an `Infinity` or `NaN` that would propagate into the canvas
 * transform and turn every subsequent draw into a silent no-op that is very hard
 * to trace back here. A zero scale draws nothing *this* frame and recovers on its
 * own as soon as the element has a size.
 */
export function fitViewport(
  logicalW: number,
  logicalH: number,
  cssW: number,
  cssH: number,
  dpr: number,
): Viewport {
  const ratio = normalizeDpr(dpr);
  const width = normalizeSize(logicalW);
  const height = normalizeSize(logicalH);
  const availW = normalizeSize(cssW);
  const availH = normalizeSize(cssH);

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
  vp: Viewport,
): void {
  ctx.setTransform(vp.scale, 0, 0, vp.scale, vp.offsetX, vp.offsetY);
}

/**
 * Bring a canvas's backing store in line with its laid-out size and the current
 * device pixel ratio, and return the viewport that fits `logicalW` × `logicalH`
 * into it.
 *
 * The backing store is written only when it actually differs: assigning
 * `canvas.width` clears the canvas and reallocates it even when the value is
 * unchanged, so an unconditional write once per frame would both flicker and churn
 * memory.
 *
 * A canvas whose element size is `0` — `display: none`, or not yet laid out — keeps
 * whatever backing store it already had. Resizing it to nothing would throw away
 * the last good frame for no benefit, and the next call recovers once the element
 * has a size.
 */
export function syncCanvas(
  canvas: HTMLCanvasElement,
  logicalW: number,
  logicalH: number,
): Viewport {
  // The ratio is read from the canvas's *own* document rather than the ambient
  // `window`, so a canvas living in an iframe (a run's preview pane, say) is sized
  // by the ratio of the display it is actually on.
  const dpr = normalizeDpr(canvas.ownerDocument.defaultView?.devicePixelRatio ?? 1);
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  const vp = fitViewport(logicalW, logicalH, cssW, cssH, dpr);

  if (cssW > 0 && cssH > 0) {
    // Pin the CSS size only when the page has not expressed one. Without a pin, the
    // element's size is derived from its `width`/`height` attributes, so writing the
    // backing store would feed back into layout and the two would chase each other
    // by a factor of `dpr` every call. When the page *has* styled the canvas (the
    // usual `width: 100%` responsive case), its rule is left alone — overwriting it
    // with a fixed pixel size would freeze the canvas at its first measured size.
    if (canvas.style.width === "") {
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
    }

    const backingW = Math.round(cssW * dpr);
    const backingH = Math.round(cssH * dpr);
    if (canvas.width !== backingW) canvas.width = backingW;
    if (canvas.height !== backingH) canvas.height = backingH;
  }

  return vp;
}
