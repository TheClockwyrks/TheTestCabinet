/**
 * Fitting a fixed logical design size onto whatever canvas the page actually
 * gave us, and the frustum projection that connects the game's world to that
 * logical field. This is engine-owned on purpose: every game otherwise
 * re-derives the same letterbox arithmetic, usually forgets the device pixel
 * ratio, and ships a build that is either blurry on a retina display or
 * clipped in a non-16:9 window.
 *
 * The model is three spaces. A game simulates in *world* units — right-handed,
 * +Y up, camera looking down its local −Z — and the camera projects the world
 * into the *logical* design field, the `width` × `height` declared to
 * `createEngine`, which keeps the 2D convention of origin top-left and y down.
 * The viewport is the map from logical coordinates onto the canvas's backing
 * store in *device* pixels. Normalized device coordinates sit between world
 * and logical inside the projection, and the flip between the y-up world and
 * the y-down field lives there and nowhere else.
 *
 * Four conventions are worth stating up front, because everything else follows:
 *
 * 1. **The scale is uniform.** A single `min` of the two axis ratios keeps the
 *    aspect ratio and guarantees the *whole* logical field stays visible; the
 *    leftover on the long axis is split into two equal bars (the offsets), so
 *    the field is centred rather than pinned to a corner. Fitting per-axis
 *    would fill the window but stretch the picture, and cropping would hide
 *    part of the play field — neither is acceptable for a game whose rules are
 *    stated in world units.
 * 2. **`scale` and the offsets are in *device* pixels, not CSS pixels** — the
 *    device pixel ratio is folded into `scale`. There is no `applyViewport`
 *    and no transform to set: the renderer itself maps the logical field onto
 *    the letterboxed device rectangle — its device viewport and scissor are
 *    the fit — and clears the bars outside the picture, so the observable
 *    contract is the pair of equations `deviceX = offsetX + logicalX * scale`
 *    and its inverse. A caller that needs the CSS-pixel figure (mapping a
 *    pointer event, say) divides: a CSS-space point maps to logical as
 *    `(cssX * dpr - offsetX) / scale`.
 * 3. **The frustum's aspect is always the design aspect**, `width / height`
 *    of the logical field, never the canvas's. The picture is therefore
 *    identical on every canvas — letterboxed by the viewport exactly as a 2D
 *    picture is — and {@link projectPoint} followed by the viewport equations
 *    names the exact device pixel a world point drew into, which is what a
 *    validator pins its surface for. Neither projection function reads
 *    `scale` or the offsets at all.
 * 4. **Every measurement arrives through a {@link SurfaceMetrics}.** Nothing
 *    in this module reads `clientWidth` or `devicePixelRatio` on its own
 *    account; {@link syncCanvas} is handed the numbers. {@link domSurface} is
 *    the one place that touches the DOM for them, and it is only the *default*
 *    the engine passes. That seam is what lets the engine — and a validator
 *    driving it — run over a canvas with no document behind it, and get the
 *    same fit on every machine.
 */

import type { CameraState, Ray, Vec2, Vec3, Viewport } from "./math";
import { rotateVec3, vec3Normalize, vec3Sub } from "./math";

/* -------------------------------------------------------------------------- */
/* The measurement seam                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Where the engine reads the canvas's laid-out size, the device pixel ratio,
 * the event target its key and pointer listeners attach to, and the origin a
 * pointer position is measured from. Supplied, it replaces every measurement
 * the engine would otherwise take from the DOM, which is what lets the engine
 * run over a canvas with no document behind it.
 *
 * Specified on the engine API page (`apis/engine.md`). Declared here rather
 * than in `contract.ts` because the shared contract module carries the
 * recording format alone; the viewport is where the measurements are consumed,
 * and the engine module re-exports the type from here.
 */
export interface SurfaceMetrics {
  /** The canvas's laid-out width, in CSS pixels. Read every frame. */
  cssWidth(): number;
  /** The canvas's laid-out height, in CSS pixels. Read every frame. */
  cssHeight(): number;
  /** The device pixel ratio the backing store is sized by. Read every frame. */
  dpr(): number;
  /** The target the engine's key and pointer listeners attach to. */
  events(): EventTarget;
  /**
   * The canvas's top-left corner in the client coordinate space pointer events
   * report their positions in — what the engine subtracts before mapping a
   * pointer position onto the field. Absent, the origin reads `(0, 0)`.
   */
  origin?(): { x: number; y: number };
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
 * and its key events land where its own document is, not where the outer page
 * is.
 */
export function domSurface(canvas: HTMLCanvasElement): SurfaceMetrics {
  return {
    cssWidth: (): number => canvas.clientWidth,
    cssHeight: (): number => canvas.clientHeight,
    dpr: (): number => canvas.ownerDocument.defaultView?.devicePixelRatio ?? 1,
    events: (): EventTarget => canvas.ownerDocument,
    // Measured at each event rather than held: the canvas moves with layout,
    // and a pointer position is mapped against where the element is now.
    origin: (): { x: number; y: number } => {
      const rect = canvas.getBoundingClientRect();
      return { x: rect.left, y: rect.top };
    },
  };
}

/* -------------------------------------------------------------------------- */
/* The fit                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A device pixel ratio we are willing to multiply by.
 *
 * A ratio arrives from a supplied surface as often as from a window, and a
 * driver, a test, or a detached document can hand us `0`, `NaN`, or nothing at
 * all. Falling back to `1` keeps a bad ratio from poisoning the fit, where it
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
 * `logicalWidth` × `logicalHeight` field into a `cssWidth` × `cssHeight`
 * element.
 *
 * A degenerate input — a zero-size container (a hidden element, an element the
 * browser has not laid out yet), or a nonsense logical size — yields `scale: 0`
 * rather than an `Infinity` or `NaN` that would propagate into every mapping
 * computed from the fit and turn each subsequent draw into a silent no-op that
 * is very hard to trace back here. A zero scale draws nothing *this* frame and
 * recovers on its own as soon as the element has a size.
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

  // Round the device size the same way `syncCanvas` rounds the backing store,
  // so the two bars really do sum to the drawable area; centring against an
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
 * Whether the engine should write a pixel CSS size onto the element.
 *
 * The failure this exists to prevent is a feedback loop. An element the page
 * has not sized takes its CSS size *from* its `width`/`height` attributes —
 * which are exactly what the backing store writes — so sizing the backing
 * store to `css * dpr` feeds straight back into the next measurement and the
 * canvas grows by a factor of `dpr` every frame. Pinning the measured size
 * breaks the loop.
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
    // Decided *before* the backing store is written, because writing it is
    // what makes the attributes stop matching the measurement.
    const pin = pageExpressedNoSize(canvas, cssW, cssH);

    const backingW = Math.round(cssW * dpr);
    const backingH = Math.round(cssH * dpr);
    if (canvas.width !== backingW) canvas.width = backingW;
    if (canvas.height !== backingH) canvas.height = backingH;

    // A canvas driven headlessly behind a supplied surface may expose no
    // `style` at all. It has no layout to feed back into either, so there is
    // nothing to pin: it simply keeps the size the surface reports.
    if (pin && canvas.style !== undefined) {
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
    }
  }

  return viewport;
}

/* -------------------------------------------------------------------------- */
/* Projection and picking                                                     */
/* -------------------------------------------------------------------------- */

/**
 * `v` rotated by the inverse of `q` — world into the camera's view space. For
 * the unit quaternions the math vocabulary produces, the conjugate *is* the
 * inverse, which spares a division that could only add noise.
 */
function rotateByInverse(
  q: { x: number; y: number; z: number; w: number },
  v: Vec3,
): Vec3 {
  return rotateVec3({ x: -q.x, y: -q.y, z: -q.z, w: q.w }, v);
}

/**
 * The half-extents of the view frustum at unit distance: `tan(fovY / 2)`
 * vertically, and that times the design aspect horizontally. Aspect is
 * deliberately the viewport's *logical* `width / height` — the design aspect,
 * never the canvas's — so the same camera produces the same picture on every
 * canvas and the fit alone decides where the pixels land.
 */
function frustumExtents(
  camera: CameraState,
  viewport: Viewport,
): { tanX: number; tanY: number } {
  const tanY = Math.tan(camera.fovY / 2);
  return { tanX: tanY * (viewport.width / viewport.height), tanY };
}

/**
 * Map a world point through the camera's view and perspective projection into
 * logical coordinates.
 *
 * A point at or behind the camera plane — the plane through the camera's
 * position, facing where it looks — returns `null`: there is no direction of
 * divide that could place it honestly on the picture. A visible point maps
 * into `0..width` × `0..height`; a point outside the frustum maps outside that
 * range and is returned as-is, so a caller can tell "off screen to the left"
 * from "behind me".
 *
 * The y flip between the y-up world and the y-down logical field happens here,
 * in the NDC step `ndcY = 1 - 2 * logicalY / height`, and nowhere else. The
 * viewport's scale and offsets play no part: this function ends at logical
 * coordinates, and the device pixel a point drew into is then the viewport
 * equation `offsetX + logicalX * scale`.
 */
export function projectPoint(
  camera: CameraState,
  viewport: Viewport,
  point: Vec3,
): Vec2 | null {
  const view = rotateByInverse(
    camera.rotation,
    vec3Sub(point, camera.position),
  );
  // The camera looks down its local −Z, so "in front" is a negative view z.
  if (view.z >= 0) return null;

  const { tanX, tanY } = frustumExtents(camera, viewport);
  const ndcX = view.x / (-view.z * tanX);
  const ndcY = view.y / (-view.z * tanY);

  return {
    x: ((ndcX + 1) / 2) * viewport.width,
    y: ((1 - ndcY) / 2) * viewport.height,
  };
}

/**
 * The picking convention: the world-space ray through a logical point.
 *
 * `origin` is the camera's position — a fresh copy the caller owns — and
 * `direction` is the unit vector through the given logical point on the near
 * plane. The near distance itself cancels out of the direction, so the ray is
 * the same whatever `near` the camera carries.
 *
 * A point inside a letterbox bar is outside `0..width`/`0..height` and still
 * yields a ray, since the math extends past the field's edge; treating it as a
 * miss is the game's choice. For a point in front of the camera,
 * `pointerRay(c, v, projectPoint(c, v, p))` passes through `p`.
 */
export function pointerRay(
  camera: CameraState,
  viewport: Viewport,
  point: Vec2,
): Ray {
  const ndcX = (2 * point.x) / viewport.width - 1;
  const ndcY = 1 - (2 * point.y) / viewport.height;
  const { tanX, tanY } = frustumExtents(camera, viewport);

  // The point on the unit-distance frustum slice, in view space, then rotated
  // out into the world by the camera's own orientation.
  const world = rotateVec3(camera.rotation, {
    x: ndcX * tanX,
    y: ndcY * tanY,
    z: -1,
  });

  return {
    origin: {
      x: camera.position.x,
      y: camera.position.y,
      z: camera.position.z,
    },
    direction: vec3Normalize(world),
  };
}
