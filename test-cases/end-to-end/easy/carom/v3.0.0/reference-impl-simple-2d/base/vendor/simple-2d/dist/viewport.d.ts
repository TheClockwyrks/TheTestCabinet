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
export declare function fitViewport(logicalW: number, logicalH: number, cssW: number, cssH: number, dpr: number): Viewport;
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
export declare function applyViewport(ctx: CanvasRenderingContext2D, vp: Viewport): void;
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
export declare function syncCanvas(canvas: HTMLCanvasElement, logicalW: number, logicalH: number): Viewport;
