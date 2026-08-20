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
export declare function fitViewport(logicalWidth: number, logicalHeight: number, cssWidth: number, cssHeight: number, dpr: number): Viewport;
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
export declare function applyViewport(ctx: CanvasRenderingContext2D, viewport: Viewport): void;
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
export declare function domSurface(canvas: HTMLCanvasElement): SurfaceMetrics;
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
export declare function syncCanvas(canvas: HTMLCanvasElement, logicalWidth: number, logicalHeight: number, surface: SurfaceMetrics): Viewport;
//# sourceMappingURL=viewport.d.ts.map