/**
 * The two maps between a game's coordinates and the pixels it lands on.
 *
 * A game places its actors in *world* units. The camera ({@link WorldCamera})
 * projects a region of the world into the *logical* design size handed to
 * `createEngine`, and the viewport ({@link fitViewport}) maps that logical field
 * onto the canvas's backing store in *device* pixels. The rendering pipeline
 * composes the two into the transform each render component draws through, so a
 * component states every coordinate, size, and font size in world units and
 * letterboxing simply does not appear in its code.
 *
 * Three conventions are worth stating up front, because everything else follows:
 *
 * 1. **The viewport's scale is uniform.** A single `min` of the two axis ratios
 *    keeps the aspect ratio and guarantees the *whole* logical field stays
 *    visible; the leftover on the long axis is split into two equal bars (the
 *    offsets), so the field is centred rather than pinned to a corner.
 * 2. **`scale` and the offsets are in *device* pixels, not CSS pixels** — the
 *    device pixel ratio is folded into `scale`. That is what lets
 *    {@link applyViewport} set a correct transform from the viewport alone. A
 *    caller that needs the CSS-pixel figure divides: CSS px per logical unit is
 *    `scale / dpr`, and a CSS-space point maps to logical as
 *    `(cssX * dpr - offsetX) / scale`.
 * 3. **Every measurement arrives through a `SurfaceMetrics`.** Nothing in this
 *    module reads `clientWidth` or `devicePixelRatio` on its own account;
 *    {@link syncCanvas} is handed the numbers. {@link domSurface} is the one
 *    place that touches the DOM for them, and it is only the *default* the
 *    engine passes. That seam is what lets the engine — and a validator driving
 *    it — run over a canvas with no document behind it.
 *
 * The camera half is deliberately dumb about the world it projects: following a
 * view target is expressed as {@link WorldCamera.adopt}, which takes the plain
 * position, rotation, and zoom the frame extracted from the target's
 * `CameraComponent`, so this module stays a leaf the frame drives with numbers.
 */

import type { Actor } from "./actors";
import type {
  Camera,
  CameraSnapshot,
  Rect,
  SurfaceMetrics,
  Vec2,
  Viewport,
} from "./contract";

/* -------------------------------------------------------------------------- */
/* The viewport                                                               */
/* -------------------------------------------------------------------------- */

/**
 * A device pixel ratio we are willing to multiply by.
 *
 * A ratio arrives from a supplied surface as often as from a window, and a
 * driver, a test, or a detached document can hand us `0`, `NaN`, or nothing at
 * all. Falling back to `1` keeps a bad ratio from poisoning the transform,
 * where it would silently blank the canvas.
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
 * `logicalWidth` × `logicalHeight` field into a `cssWidth` × `cssHeight`
 * element.
 *
 * A degenerate input — a zero-size container (a hidden element, an element the
 * browser has not laid out yet), or a nonsense logical size — yields `scale: 0`
 * rather than an `Infinity` or `NaN` that would propagate into the canvas
 * transform and turn every subsequent draw into a silent no-op that is very
 * hard to trace back here. A zero scale draws nothing *this* frame and recovers
 * on its own as soon as the element has a size.
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
  // the two bars really do sum to the drawable area; centring against an
  // unrounded size would leave a sub-pixel seam at one edge.
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
 * Point a 2D context at a viewport, so drawing in logical coordinates lands in
 * the right device pixels.
 *
 * `setTransform` *replaces* the current transform, which is the whole reason it
 * is used here in place of a `translate` + `scale` pair: this runs at the top
 * of every frame, and a compounding transform would scale the picture away to
 * nothing within a second. It also means the caller does not have to balance
 * `save`/`restore` around the pipeline's drawing — whatever a frame left behind
 * is discarded next frame. The pipeline then composes the camera onto it.
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
 * This is the default the engine uses when a build supplies no surface of its
 * own, and it is deliberately the *only* function in the package that reads a
 * size out of the DOM. Everything downstream takes numbers.
 *
 * The ratio and the event target both come from the canvas's *own* document
 * rather than the ambient `window`: a game rendered inside an iframe (a run's
 * preview pane, say) is sized by the ratio of the display it is actually on,
 * and its key events are where its own document is, not where the outer page
 * is.
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
  };
}

/**
 * Whether the engine should write a pixel CSS size onto the element.
 *
 * The failure this exists to prevent is a feedback loop. An element the page
 * has not sized takes its CSS size *from* its `width`/`height` attributes —
 * which are exactly what the backing store writes — so sizing the backing store
 * to `css * dpr` feeds straight back into the next measurement and the canvas
 * grows by a factor of `dpr` every frame. Pinning the measured size breaks the
 * loop.
 *
 * The test is therefore "does the reported size still look like the
 * attributes", *not* "is the inline style empty". A canvas sized by a
 * stylesheet has an empty inline style, and treating that as unsized would
 * write a fixed pixel size over the page's rule and freeze the canvas at
 * whatever size it happened to be first measured at — the exact opposite of
 * what the pin is for.
 *
 * A page that sizes an element to precisely its attribute size, through a
 * stylesheet, is indistinguishable from an unsized one at this seam and gets a
 * pin equal to the size it asked for. That is the one ambiguity the rule
 * accepts, and it costs a canvas that was already the right size its
 * responsiveness, whereas reading the inline style costs *every*
 * stylesheet-sized canvas its responsiveness.
 */
function pageExpressedNoSize(
  canvas: HTMLCanvasElement,
  cssWidth: number,
  cssHeight: number,
): boolean {
  return cssWidth === canvas.width && cssHeight === canvas.height;
}

/**
 * Bring a canvas's backing store in line with the size and ratio `surface`
 * reports, and return the viewport that fits `logicalWidth` × `logicalHeight`
 * into it.
 *
 * The backing store is written only when it actually differs: assigning
 * `canvas.width` clears the canvas and reallocates it even when the value is
 * unchanged, so an unconditional write once per frame would both flicker and
 * churn memory.
 *
 * A surface reporting `0` on either axis — `display: none`, or an element not
 * yet laid out — leaves the canvas the backing store it already had. Resizing
 * it to nothing would throw away the last good frame for no benefit, and the
 * next call recovers once the element has a size.
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

    // A canvas driven headlessly behind a supplied surface may expose no `style`
    // at all. It has no layout to feed back into either, so there is nothing to
    // pin: it simply keeps the size the surface reports.
    if (pin && canvas.style !== undefined) {
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
    }
  }

  return viewport;
}

/* -------------------------------------------------------------------------- */
/* The camera                                                                 */
/* -------------------------------------------------------------------------- */

/** `true` for a design dimension the projection arithmetic can center on. */
function isDesignSize(size: number): boolean {
  return Number.isFinite(size) && size > 0;
}

/**
 * The world's camera: the live object behind the `Camera` interface a world
 * exposes.
 *
 * The projection is the pair of maps the API page states, generalized to a
 * non-zero rotation:
 *
 * ```
 * logical = center + R(-rotation) · (world - position) · zoom
 * ```
 *
 * where `center` is half the logical design size and `R` is the canvas's
 * clockwise-positive rotation. The sign is chosen so that `rotation` turns the
 * *projected region* about the camera's position — rotating the camera
 * clockwise makes the world appear to turn counter-clockwise on screen, the
 * way a rotating viewfinder behaves — and so that the two maps collapse to the
 * documented `width / 2 + (worldX - camera.x) * camera.zoom` pair at
 * `rotation = 0`. {@link logicalToWorld} is the exact inverse, so a pointer
 * position read in logical coordinates round-trips to the world point under it.
 *
 * The camera is part of the world and is rebuilt with it, so construction *is*
 * the documented reset: `x = width / 2`, `y = height / 2`, `zoom = 1`,
 * `rotation = 0`, `bounds = null`, `target = null` — world and logical
 * coordinates coincide until the game moves it.
 *
 * Following is split across the seam this module sits behind. The frame finds
 * the target's first enabled `CameraComponent` and hands the plain figures to
 * {@link adopt}; the camera itself never walks an actor's components, which is
 * what keeps this module free of the framework and lets its math be tested with
 * numbers alone.
 */
export class WorldCamera implements Camera {
  /** The world x the center of the logical field shows. */
  x: number;
  /** The world y the center of the logical field shows. */
  y: number;
  /** Logical units per world unit. A zoom of `2` halves the visible extent. */
  zoom = 1;
  /** Radians, turning the projected region about the camera's position. */
  rotation = 0;
  /** A rectangle in world units the visible region is kept inside, or `null`. */
  bounds: Rect | null = null;

  /** The logical design width the projection centers on. */
  private readonly width: number;
  /** The logical design height the projection centers on. */
  private readonly height: number;
  /** The actor the camera follows, or `null`. */
  private followTarget: Actor | null = null;

  /**
   * @param width The logical design width, as handed to `createEngine`.
   * @param height The logical design height, as handed to `createEngine`.
   * @throws RangeError if either is not finite and positive. `createEngine`
   * refuses the same sizes first, so this only fires on a caller constructing a
   * camera directly — where the same silent-blank-canvas failure would
   * otherwise be even harder to trace.
   */
  constructor(width: number, height: number) {
    if (!isDesignSize(width) || !isDesignSize(height)) {
      throw new RangeError(
        `WorldCamera needs a finite, positive logical design size, got ${width}x${height}`,
      );
    }
    this.width = width;
    this.height = height;
    this.x = width / 2;
    this.y = height / 2;
  }

  /** The actor the camera follows, or `null`. */
  get target(): Actor | null {
    return this.followTarget;
  }

  /**
   * Sets `target`. `null` clears it and returns the projection to the game,
   * which then writes `x`, `y`, `zoom`, and `rotation` itself.
   */
  follow(actor: Actor | null): void {
    this.followTarget = actor;
  }

  /** The projection as a plain value the caller owns. */
  snapshot(): CameraSnapshot {
    return { x: this.x, y: this.y, zoom: this.zoom, rotation: this.rotation };
  }

  /**
   * A world point in logical coordinates, through position, zoom, and
   * rotation. The result is a fresh object; the argument is not written to.
   */
  worldToLogical(point: Vec2): Vec2 {
    const dx = point.x - this.x;
    const dy = point.y - this.y;
    const cos = Math.cos(this.rotation);
    const sin = Math.sin(this.rotation);
    // R(-rotation), with the canvas's clockwise-positive convention.
    return {
      x: this.width / 2 + (dx * cos + dy * sin) * this.zoom,
      y: this.height / 2 + (-dx * sin + dy * cos) * this.zoom,
    };
  }

  /** The exact inverse of {@link worldToLogical}. */
  logicalToWorld(point: Vec2): Vec2 {
    const lx = (point.x - this.width / 2) / this.zoom;
    const ly = (point.y - this.height / 2) / this.zoom;
    const cos = Math.cos(this.rotation);
    const sin = Math.sin(this.rotation);
    // R(+rotation), undoing the projection's R(-rotation).
    return {
      x: this.x + (lx * cos - ly * sin),
      y: this.y + (lx * sin + ly * cos),
    };
  }

  /**
   * Take a view target's figures: the position and rotation of the target's
   * `CameraComponent` world transform, and that component's zoom.
   *
   * Called by the frame each time the camera has a target, before the pipeline
   * draws; the frame then clamps the result with {@link clampToBounds}. Plain
   * numbers rather than the component itself, so the camera stays ignorant of
   * the framework.
   */
  adopt(at: { x: number; y: number; rotation: number }, zoom: number): void {
    this.x = at.x;
    this.y = at.y;
    this.rotation = at.rotation;
    this.zoom = zoom;
  }

  /**
   * Keep the visible region inside `bounds`, when there is one.
   *
   * The visible extent is the logical field divided by the zoom —
   * `width / zoom` by `height / zoom`, the `rotation = 0` figure the API page
   * states. Each axis is clamped on its own, and an axis whose visible extent
   * meets or exceeds the bounds on that axis centers on it, so an over-zoomed-
   * out camera shows the bounds in the middle of the frame rather than pinned
   * to a corner.
   *
   * A degenerate zoom (zero, negative, or non-finite) leaves the position
   * untouched: the extent it implies is not a number the clamp can compare,
   * and the pipeline draws nothing sensible under such a zoom anyway.
   */
  clampToBounds(): void {
    const bounds = this.bounds;
    if (bounds === null) return;
    if (!Number.isFinite(this.zoom) || this.zoom <= 0) return;

    this.x = clampAxis(this.x, bounds.x, bounds.width, this.width / this.zoom);
    this.y = clampAxis(
      this.y,
      bounds.y,
      bounds.height,
      this.height / this.zoom,
    );
  }
}

/**
 * One axis of the bounds clamp: keep a window of `extent` centred on `center`
 * inside `[start, start + size]`, centering when it cannot fit.
 */
function clampAxis(
  center: number,
  start: number,
  size: number,
  extent: number,
): number {
  if (extent >= size) return start + size / 2;
  const min = start + extent / 2;
  const max = start + size - extent / 2;
  return Math.min(Math.max(center, min), max);
}
