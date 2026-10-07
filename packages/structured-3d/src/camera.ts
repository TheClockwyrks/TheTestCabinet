/**
 * The two maps between a game's coordinates and the pixels they land on: the
 * camera, which projects a volume of the world into the logical design field,
 * and the viewport, which letterboxes that field onto the canvas's backing
 * store.
 *
 * A game places its actors in *world* units of its own choosing. The camera
 * ({@link WorldCamera}) projects them into the *logical* design size handed to
 * `createEngine` — through a perspective frustum or an orthographic box, at the
 * field's own aspect — and the viewport ({@link fitViewport}) maps that field
 * onto the backing store in *device* pixels. The pipeline drives both: the world
 * pass renders through the camera into the letterboxed rectangle
 * ({@link applyRendererViewport}), and the screen pass draws through the
 * viewport alone ({@link applyViewport}), which is how a HUD holds its place
 * while the camera follows the play.
 *
 * | Space | Unit | Set by |
 * | --- | --- | --- |
 * | World | The game's own | The game, on every transform |
 * | Logical | The design size | The camera's projection, at aspect `width / height` |
 * | Device | Device pixels | The viewport |
 *
 * ## Why both halves live in one module
 *
 * They are one composition. A validator that fixes the design size and the
 * device pixel ratio knows the exact device pixel a world point was drawn into,
 * because `deviceX = offsetX + logicalX * scale` and `logicalX` came from
 * {@link WorldCamera.worldToLogical}; and it picks the other way, from a device
 * pixel back to a logical point and through {@link WorldCamera.logicalToRay}
 * into the collision world. Splitting the two maps across two modules would put
 * the rounding of one and the centring of the other in different places, and the
 * symptom of a disagreement — a marker half a pixel off the thing it marks, a
 * pick that misses at the edge of the picture — is a miserable thing to chase.
 *
 * ## Five conventions, stated once
 *
 * 1. **The world is right-handed, `+Y` up, and a camera looks along its local
 *    `-Z`** — three's convention throughout, so a pose written here means what it
 *    means in every three example a build's author has read. `fov` is degrees;
 *    every other angle in the engine is radians.
 * 2. **Logical `y` runs *down*.** Normalized device coordinates run `-1..1` with
 *    `+Y` up; the logical field runs `0..width` by `0..height` from the top-left,
 *    because that is where the screen layer's 2D context draws and where the
 *    pointer reports. The flip is written once, in {@link ndcToLogical} and
 *    {@link logicalToNdc}, and nowhere else.
 * 3. **The viewport's scale is uniform.** A single `min` of the two axis ratios
 *    keeps the aspect ratio and guarantees the *whole* logical field stays
 *    visible; the leftover on the long axis is split into two equal bars (the
 *    offsets), so the field is centred rather than pinned to a corner.
 * 4. **`scale` and the offsets are in *device* pixels, not CSS pixels** — the
 *    device pixel ratio is folded into `scale`. That is what lets
 *    {@link applyViewport} and {@link applyRendererViewport} place the picture
 *    from the viewport alone, with no second `dpr` argument to forget. A caller
 *    that needs the CSS-pixel figure divides: CSS px per logical unit is
 *    `scale / dpr`, and a CSS-space point maps to logical as
 *    `(cssX * dpr - offsetX) / scale`.
 * 5. **Every measurement arrives through a `SurfaceMetrics`.** Nothing here reads
 *    `clientWidth` or `devicePixelRatio` on its own account; {@link syncCanvas}
 *    is handed the numbers. {@link domSurface} is the one place that touches the
 *    DOM for them, and it is only the *default* the engine passes. That seam is
 *    what puts the engine — and a validator driving it — over a canvas with no
 *    document behind it, at the same fit on every machine.
 *
 * ## One projection object, three readers
 *
 * The `Camera` a world exposes is a record of plain fields a game writes: a
 * position, a rotation, a projection kind, a field of view or a vertical span.
 * Three things then have to agree about what that record means — the picture the
 * renderer draws, the logical point `worldToLogical` reports, and the line
 * `logicalToRay` picks along — and they agree here because all three read one
 * derivation, {@link cameraObject}, which pushes the record's current fields
 * onto a three camera and returns it. The pipeline renders through the very
 * object the projection math answered from, so "the picture and the projection
 * agree" is structural rather than a pair of formulas kept in step by hand.
 *
 * The objects are held in a `WeakMap` keyed by the camera rather than as fields
 * on {@link WorldCamera}, for two reasons: the pipeline types against the
 * `Camera` *interface* and must render whatever implementation a world carries,
 * and a camera is world state, so keying weakly lets a level transition's camera
 * take its three objects with it when it goes.
 *
 * ## Following, and the frame's ownership of it
 *
 * A camera with a view target adopts, each frame before the pipeline draws, the
 * world transform and field of view of the first enabled `CameraComponent` its
 * target holds, and its position is then clamped to `bounds`. That whole step is
 * {@link updateCamera}, and it lives here rather than in the pipeline because it
 * is the camera's rule: the pipeline calls it as step 10.1 of the frame and
 * reads the result. `bounds` is clamped whether the camera is following or not,
 * so a hand-driven camera is kept inside the same region a following one is.
 *
 * One deliberate difference from three is worth flagging for anyone comparing
 * {@link WorldCamera.logicalToRay} against `THREE.Raycaster`: through an
 * orthographic camera the ray here starts on the **near plane**, as the
 * specification states, where three's raycaster starts it in the plane of the
 * camera itself. The two describe the same line — only the point it is
 * parameterized from differs, by `near` world units along the view direction —
 * so an intersection computed from either lands in the same place.
 */

import * as THREE from "three";
import type { Actor } from "./actors";
import { CameraComponent } from "./components";
import type {
  Box3,
  CameraSnapshot,
  Projected,
  Quat,
  Ray,
  SurfaceMetrics,
  Vec2,
  Vec3,
  Viewport,
} from "./contract";
import { quatLookAt, UP } from "./math";

/* -------------------------------------------------------------------------- */
/* The viewport                                                               */
/* -------------------------------------------------------------------------- */

/**
 * A device pixel ratio we are willing to multiply by.
 *
 * A ratio arrives from a supplied surface as often as from a window, and a
 * driver, a test, or a detached document can hand us `0`, `NaN`, or nothing at
 * all. Falling back to `1` keeps a bad ratio from poisoning the transform, where
 * it would silently blank the canvas.
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
 * rather than an `Infinity` or a `NaN` that would propagate into the screen
 * layer's transform, into the renderer's rectangle, and into every draw that
 * follows, and turn the frame into a silent no-op that is very hard to trace
 * back here. A zero scale draws nothing *this* frame and recovers on its own as
 * soon as the element has a size.
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
  // unrounded size would leave a sub-pixel seam at one edge — and on the 3D side
  // that seam is a column of pixels the scissor excludes but the screen layer's
  // transform still maps into, which reads as a hairline of background through
  // the HUD.
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
 * is used here in place of a `translate` + `scale` pair: this runs at the top of
 * every screen pass, and a compounding transform would scale the HUD away to
 * nothing within a second. It also means the pipeline does not have to balance
 * `save`/`restore` around a `DrawComponent`'s drawing — whatever a component
 * left behind is discarded next frame.
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

/* -------------------------------------------------------------------------- */
/* The renderer's rectangle                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The letterboxed rectangle in device pixels: where on the backing store the
 * picture goes.
 *
 * The same four numbers the screen layer's transform maps `0..width` by
 * `0..height` onto, expressed as a rectangle instead of a transform, because
 * that is the shape a `WebGLRenderer` wants.
 */
export interface ViewportRect {
  /** The left edge, in device pixels — the left letterbox bar. */
  readonly x: number;
  /** The top (equivalently bottom) edge, in device pixels — the letterbox bar. */
  readonly y: number;
  /** The picture's width in device pixels: `viewport.width * viewport.scale`. */
  readonly width: number;
  /** The picture's height in device pixels: `viewport.height * viewport.scale`. */
  readonly height: number;
}

/**
 * The rectangle the scene is drawn into, from the fit the screen layer also
 * uses.
 *
 * `(offsetX, offsetY, width * scale, height * scale)`, and the reason no
 * vertical flip appears here — a GL viewport is measured from the *bottom* left,
 * a canvas transform from the top left — is that {@link fitViewport} centres.
 * The bar above the picture and the bar below it are the same number by
 * construction, so `offsetY` names the same edge read from either end and the
 * rectangle is the same in both conventions. That equality is load-bearing
 * rather than incidental: a fit that ever pinned the field to a corner would
 * need the flip written out.
 *
 * A degenerate fit yields a rectangle of zero area, which draws nothing for the
 * frame it applies to rather than drawing something wrong.
 */
export function viewportRect(viewport: Viewport): ViewportRect {
  return {
    x: viewport.offsetX,
    y: viewport.offsetY,
    width: viewport.width * viewport.scale,
    height: viewport.height * viewport.scale,
  };
}

/**
 * Confine the renderer to the letterboxed rectangle, with the scissor test on.
 *
 * The viewport alone would place the picture but not stop the scene's own clears
 * and any full-screen pass from painting over the bars; the scissor is what
 * keeps the bars carrying the color the whole canvas was cleared to before this
 * was called. The two are always set together for that reason, and the ordering
 * the pipeline relies on is: clear the whole canvas, *then* call this, then
 * render.
 *
 * The rectangle is handed over in device pixels, which assumes the renderer's
 * own pixel ratio is the default `1` — this module has already folded the ratio
 * into the fit, and letting a `WebGLRenderer` multiply by it a second time would
 * place the picture at `dpr²`.
 */
export function applyRendererViewport(
  renderer: THREE.WebGLRenderer,
  viewport: Viewport,
): void {
  const rect = viewportRect(viewport);
  renderer.setViewport(rect.x, rect.y, rect.width, rect.height);
  renderer.setScissor(rect.x, rect.y, rect.width, rect.height);
  renderer.setScissorTest(true);
}

/* -------------------------------------------------------------------------- */
/* Measuring, and sizing the canvases                                         */
/* -------------------------------------------------------------------------- */

/**
 * The measurements a canvas that really is in a document reports about itself.
 *
 * This is the default the engine uses when a build supplies no surface of its
 * own, and it is deliberately the *only* function in the package that reads a
 * size out of the DOM. Everything downstream takes numbers.
 *
 * The ratio and the event target both come from the canvas's *own* document
 * rather than the ambient `window`: a game rendered inside an iframe (a run's
 * preview pane, say) is sized by the ratio of the display it is actually on, and
 * its key events are where its own document is, not where the outer page is.
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
 *   is why touch appears to work for a moment and then stop — and an orbiting
 *   camera driven by a drag is exactly the gesture a browser wants to steal.
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
 * not sized takes its CSS size *from* its `width`/`height` attributes — which
 * are exactly what the backing store writes — so sizing the backing store to
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
 * churn memory. On the stage canvas that reallocation is a GL drawing-buffer
 * resize, which is more expensive still.
 *
 * A surface reporting `0` on either axis — `display: none`, or an element not
 * yet laid out — leaves the canvas the backing store it already had. Resizing it
 * to nothing would throw away the last good frame for no benefit, and the next
 * call recovers once the element has a size.
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

/**
 * Give the screen canvas the backing store the stage canvas was just synced to.
 *
 * The screen layer is composited over the 3D picture at the end of the frame, so
 * the two backing stores must agree exactly: one device pixel of HUD over one
 * device pixel of scene. Deriving the screen canvas's size from the surface a
 * second time would agree *almost* always and disagree on the frame a
 * measurement changed between the two reads, or wherever `round` fell
 * differently, and the symptom — a HUD half a pixel soft, or a one-pixel band of
 * stale image at an edge — is a miserable thing to chase. Copying the number the
 * stage canvas actually ended up with removes the possibility.
 *
 * The screen canvas is never in the layout — the engine creates it with
 * `document.createElement` and never inserts it, unless a build supplied one —
 * so there is no CSS size to pin here and no feedback loop to break. It is also
 * why a stage canvas left at its previous size by a zero-size surface leaves
 * this one alone too: it is copying, not measuring.
 */
export function syncScreenCanvas(
  screen: HTMLCanvasElement,
  stage: HTMLCanvasElement,
): void {
  // Same conditional write as `syncCanvas`, and for the sharper reason:
  // assigning the width clears the canvas, so an unconditional write here would
  // erase the HUD a `DrawComponent` had just drawn.
  if (screen.width !== stage.width) screen.width = stage.width;
  if (screen.height !== stage.height) screen.height = stage.height;
}

/* -------------------------------------------------------------------------- */
/* Logical and normalized device coordinates                                  */
/* -------------------------------------------------------------------------- */

/**
 * A normalized device coordinate pair onto the logical design field.
 *
 * NDC runs `-1..1` with `+Y` up and the logical field runs `0..width` by
 * `0..height` with `y` down, so this is a flip as well as a scale. The result is
 * deliberately *not* clamped: a point outside the frustum still reports where it
 * would have landed, which is what lets a game clamp an off-screen marker to the
 * field's edge in the direction of the thing it marks.
 */
function ndcToLogical(
  ndcX: number,
  ndcY: number,
  width: number,
  height: number,
): Vec2 {
  return {
    x: width / 2 + (ndcX * width) / 2,
    y: height / 2 - (ndcY * height) / 2,
  };
}

/**
 * A logical design point onto normalized device coordinates — the inverse of
 * {@link ndcToLogical}, and the first half of casting a ray.
 *
 * A point inside a letterbox bar maps outside `0..width` or `0..height` and so
 * to an NDC pair outside `-1..1`. That is not an error: the ray through it is a
 * perfectly well-defined line outside the picture, and whether to clamp the
 * point onto the field or treat it as a miss is the game's decision, not the
 * engine's.
 */
function logicalToNdc(
  x: number,
  y: number,
  width: number,
  height: number,
): Vec2 {
  return { x: (x / width) * 2 - 1, y: 1 - (y / height) * 2 };
}

/* -------------------------------------------------------------------------- */
/* The camera                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The pose and projection figures a world's camera starts at.
 *
 * `orthoHeight` is absent because it is derived rather than fixed: it starts at
 * the *logical design height*, which is what puts one world unit on the `z = 0`
 * plane to one logical unit and the field's centre at the world origin. A game
 * with a fixed top-down or isometric picture therefore places its actors around
 * the origin in numbers that read like the design field.
 *
 * Frozen because {@link WorldCamera} reads it on every construction and a level
 * transition builds a new camera from it. A test or a build that mutated it
 * would change the defaults for every world opened afterwards in the same
 * process — a bug that surfaces as one suite's camera depending on whether
 * another suite ran first.
 */
export const CAMERA_DEFAULTS = Object.freeze({
  /** Ten units back along `+Z`, so a mesh at the origin is already in view. */
  position: Object.freeze({ x: 0, y: 0, z: 10 }) as Readonly<Vec3>,
  /** The identity: looking along `-Z` with `+Y` up. */
  rotation: Object.freeze({ x: 0, y: 0, z: 0, w: 1 }) as Readonly<Quat>,
  /** The projection the world pass renders through until the game changes it. */
  projection: "perspective" as CameraSnapshot["projection"],
  /** The vertical field of view in degrees, read under `perspective`. */
  fov: 60,
  /** The near clipping plane, in world units from the camera. */
  near: 0.1,
  /** The far clipping plane, in world units from the camera. */
  far: 1000,
});

/**
 * The world's camera: where the picture is taken from, and the two conversions
 * between the world and the logical field.
 *
 * The camera is reached as `world.camera` and is part of the world, so a level
 * transition builds a new one at {@link CAMERA_DEFAULTS} and the framing of the
 * outgoing level goes with the world that set it. A level that wants a
 * particular framing states it as the level opens.
 *
 * Every field is a plain mutable property the game writes — `camera.position.y
 * += dt` is a legitimate move — and every method answers *through the camera as
 * it stands at the call*, so a snapshot, a projection, and a ray taken in the
 * same tick describe one camera.
 */
export interface Camera {
  /** The camera's world position. Defaults to `{ x: 0, y: 0, z: 10 }`. */
  position: Vec3;
  /**
   * The camera's world rotation. The camera looks along its local `-Z` with
   * local `+Y` up, so the identity looks toward the origin from the default
   * position.
   */
  rotation: Quat;
  /** The projection the world pass renders through. Defaults to `perspective`. */
  projection: "perspective" | "orthographic";
  /** The vertical field of view in degrees, read under `perspective`. */
  fov: number;
  /** The near clipping plane, in world units from the camera. */
  near: number;
  /** The far clipping plane, in world units from the camera. */
  far: number;
  /**
   * The world units the view spans vertically, read under `orthographic`.
   * Defaults to the logical design height.
   */
  orthoHeight: number;
  /** A box in world units the camera's position is kept inside, or `null`. */
  bounds: Box3 | null;
  /** The actor the camera follows, or `null`. */
  readonly target: Actor | null;
  /** Sets `target`. `null` clears it and returns the pose to the game. */
  follow(actor: Actor | null): void;
  /**
   * Writes `rotation` so the camera looks from `position` toward `point`, with
   * local `+Y` as near `up` as the view allows. `up` defaults to the world's up
   * axis.
   */
  lookAt(point: Vec3, up?: Vec3): void;
  /** The projection as a plain value the caller owns. */
  snapshot(): CameraSnapshot;
  /** A world point on the logical field, through the camera as it stands. */
  worldToLogical(point: Vec3): Projected;
  /** A world-space ray through a logical point, from the camera as it stands. */
  logicalToRay(point: Vec2): Ray;
}

/* -------------------------------------------------------------------------- */
/* The three camera behind the record                                         */
/* -------------------------------------------------------------------------- */

/** The pair of three cameras held for one {@link Camera}, one per projection. */
interface CameraObjects {
  perspective: THREE.PerspectiveCamera;
  orthographic: THREE.OrthographicCamera;
}

/**
 * The three objects each camera's projection is derived through.
 *
 * Weak, so a level transition's camera takes its objects with it, and keyed by
 * the `Camera` rather than held on {@link WorldCamera} so that the pipeline —
 * which types against the interface — gets the same derivation for whatever
 * implementation a world carries.
 */
const cameraObjects = new WeakMap<Camera, CameraObjects>();

/**
 * Scratch, never handed out.
 *
 * `worldToLogical` runs once per labelled world point and `logicalToRay` once
 * per pointer sample, so allocating three vectors and a frustum per call would
 * put the engine's own garbage on the frame budget of the very games most likely
 * to be tight on it. None of these calls is reentrant — each finishes before it
 * returns a fresh plain record — so one set of scratch serves every camera.
 */
const scratchPoint = new THREE.Vector3();
const scratchTarget = new THREE.Vector3();
const scratchDirection = new THREE.Vector3();
const scratchViewProjection = new THREE.Matrix4();
const scratchFrustum = new THREE.Frustum();

/** The projection's aspect: the logical field's own, or `1` if it is nonsense. */
function projectionAspect(width: number, height: number): number {
  const w = normalizeSize(width);
  const h = normalizeSize(height);
  return w > 0 && h > 0 ? w / h : 1;
}

/**
 * The three camera the pipeline renders through, brought up to date with
 * `camera`'s current fields.
 *
 * Internal: the pipeline calls it once per frame, after {@link updateCamera},
 * and hands the result to `renderer.render`. {@link WorldCamera} calls it from
 * `snapshot`, `worldToLogical`, and `logicalToRay`, which is what makes the
 * picture and the projection arithmetic one thing rather than two formulas kept
 * in step by hand.
 *
 * The returned object is the camera's own and is rewritten on the next call, so
 * a caller reads what it needs and does not hold it across a frame. `zoom` is
 * held at `1` — the engine's cameras express their framing through `fov` and
 * `orthoHeight`, and a snapshot reports the `1` this sets.
 *
 * Both classes are constructed on the first call rather than the one the
 * projection currently names, because `projection` is a mutable field: a game
 * that switches it mid-run switches which object is returned, and building both
 * up front keeps the switch free of an allocation on the frame it happens.
 */
export function cameraObject(
  camera: Camera,
  width: number,
  height: number,
): THREE.PerspectiveCamera | THREE.OrthographicCamera {
  let objects = cameraObjects.get(camera);
  if (objects === undefined) {
    objects = {
      perspective: new THREE.PerspectiveCamera(),
      orthographic: new THREE.OrthographicCamera(),
    };
    cameraObjects.set(camera, objects);
  }

  const aspect = projectionAspect(width, height);
  const object: THREE.PerspectiveCamera | THREE.OrthographicCamera =
    camera.projection === "orthographic"
      ? objects.orthographic
      : objects.perspective;

  if (object instanceof THREE.OrthographicCamera) {
    // The box spans `orthoHeight` world units vertically and as much
    // horizontally as the field's aspect asks for, so the picture keeps the
    // design shape and the letterbox bars absorb the difference.
    const top = camera.orthoHeight / 2;
    const right = top * aspect;
    object.top = top;
    object.bottom = -top;
    object.right = right;
    object.left = -right;
  } else {
    object.fov = camera.fov;
    object.aspect = aspect;
  }
  object.near = camera.near;
  object.far = camera.far;
  object.zoom = 1;

  object.position.set(camera.position.x, camera.position.y, camera.position.z);
  object.quaternion.set(
    camera.rotation.x,
    camera.rotation.y,
    camera.rotation.z,
    camera.rotation.w,
  );
  object.scale.set(1, 1, 1);
  // `Camera.updateMatrixWorld` recomposes the world matrix from the pose above
  // and inverts it into `matrixWorldInverse`, which is the view matrix every
  // projection below runs through; `updateProjectionMatrix` folds in the figures
  // just written and refreshes `projectionMatrixInverse`, which unprojects a ray.
  object.updateMatrixWorld(true);
  object.updateProjectionMatrix();
  return object;
}

/**
 * The live camera behind the `Camera` a world exposes.
 *
 * The projection is three's own — {@link cameraObject} pushes these fields onto
 * a `THREE.PerspectiveCamera` or `THREE.OrthographicCamera` and every answer
 * comes from that object's matrices — so the mapping this class describes is
 * exactly the mapping the renderer draws, down to the rounding.
 *
 * Following is split across the seam this class sits behind: {@link
 * updateCamera} finds the target's first enabled `CameraComponent` and writes
 * the figures here, so the camera itself never walks an actor's components.
 */
export class WorldCamera implements Camera {
  /** The camera's world position, in world units. */
  position: Vec3;
  /** The camera's world rotation, a unit quaternion. */
  rotation: Quat;
  /** The projection the world pass renders through. */
  projection: "perspective" | "orthographic";
  /** The vertical field of view in degrees, read under `perspective`. */
  fov: number;
  /** The near clipping plane, in world units from the camera. */
  near: number;
  /** The far clipping plane, in world units from the camera. */
  far: number;
  /** The world units the view spans vertically, read under `orthographic`. */
  orthoHeight: number;
  /** A box in world units the camera's position is kept inside, or `null`. */
  bounds: Box3 | null = null;

  /** The logical design width the projection's aspect and field come from. */
  private readonly width: number;
  /** The logical design height, which is also the default `orthoHeight`. */
  private readonly height: number;
  /** The actor the camera follows, or `null`. */
  private followTarget: Actor | null = null;

  /**
   * @param width The logical design width, as handed to `createEngine`.
   * @param height The logical design height, as handed to `createEngine`.
   * @throws RangeError if either is not finite and positive. `createEngine`
   * refuses the same sizes first, so this only fires on a caller constructing a
   * camera directly — where the same silent-blank-canvas failure would otherwise
   * be even harder to trace.
   */
  constructor(width: number, height: number) {
    if (normalizeSize(width) === 0 || normalizeSize(height) === 0) {
      throw new RangeError(
        `WorldCamera needs a finite, positive logical design size, got ${width}x${height}`,
      );
    }
    this.width = width;
    this.height = height;
    // Fresh records rather than the frozen defaults themselves: `position` and
    // `rotation` are fields a game writes through, and handing out the frozen
    // constant would make `camera.position.y += 1` throw in strict mode and
    // silently do nothing outside it.
    this.position = { ...CAMERA_DEFAULTS.position };
    this.rotation = { ...CAMERA_DEFAULTS.rotation };
    this.projection = CAMERA_DEFAULTS.projection;
    this.fov = CAMERA_DEFAULTS.fov;
    this.near = CAMERA_DEFAULTS.near;
    this.far = CAMERA_DEFAULTS.far;
    this.orthoHeight = height;
  }

  /** The actor the camera follows, or `null`. */
  get target(): Actor | null {
    return this.followTarget;
  }

  /**
   * Sets `target`. `null` clears it and returns the pose to the game, which then
   * writes `position`, `rotation`, and `fov` itself.
   */
  follow(actor: Actor | null): void {
    this.followTarget = actor;
  }

  /**
   * Writes `rotation` so the camera looks from `position` toward `point`.
   *
   * The direction is `point - position` and `up` decides the one remaining
   * degree of freedom, the roll about it. A `point` at the camera's own position
   * leaves the identity rotation rather than dividing by a zero length, and an
   * `up` parallel to the view — looking straight down, the overhead case — picks
   * a stable perpendicular rather than a zero cross product.
   */
  lookAt(point: Vec3, up: Vec3 = UP): void {
    this.rotation = quatLookAt(
      {
        x: point.x - this.position.x,
        y: point.y - this.position.y,
        z: point.z - this.position.z,
      },
      up,
    );
  }

  /**
   * The camera's pose and projection as a plain value the caller owns.
   *
   * Both projections are described by one record, with the fields the projection
   * in force does not use reporting `0`, so a reader switches on `projection`
   * rather than on which fields happen to be present. `zoom` is `1`: the
   * engine's camera frames through `fov` and `orthoHeight`, and three's zoom
   * factor is left where {@link cameraObject} sets it.
   */
  snapshot(): CameraSnapshot {
    const orthographic = this.projection === "orthographic";
    const top = orthographic ? this.orthoHeight / 2 : 0;
    const right = orthographic
      ? top * projectionAspect(this.width, this.height)
      : 0;
    return {
      projection: this.projection,
      position: { ...this.position },
      rotation: { ...this.rotation },
      fov: orthographic ? 0 : this.fov,
      near: this.near,
      far: this.far,
      zoom: 1,
      // Negated only when there is an extent to negate: under `perspective` the
      // four extents report a plain `0`, and `-0` is a different value to a
      // reader comparing a held snapshot with a fresh one.
      left: orthographic ? -right : 0,
      right,
      top,
      bottom: orthographic ? -top : 0,
    };
  }

  /**
   * Where a world point lands on the logical field, with its depth and whether
   * it is inside the frustum.
   *
   * `visible` is read from the frustum rather than from the divided coordinates,
   * because a naive `-1..1` test answers *wrongly* for a point behind the
   * camera: dividing by a negative `w` folds such a point back into the box, and
   * a caller reading the pair alone would draw a marker for something the player
   * cannot see. The pair itself is left unclamped, so an off-screen point still
   * reports the direction it lies in.
   */
  worldToLogical(point: Vec3): Projected {
    const object = cameraObject(this, this.width, this.height);
    scratchViewProjection.multiplyMatrices(
      object.projectionMatrix,
      object.matrixWorldInverse,
    );
    scratchFrustum.setFromProjectionMatrix(scratchViewProjection);

    scratchPoint.set(point.x, point.y, point.z);
    // Read before the transform overwrites the point in place.
    const visible = scratchFrustum.containsPoint(scratchPoint);

    // World to view to clip, with `Vector3.applyMatrix4` performing the
    // perspective divide — the same two steps `THREE.Vector3.project` takes.
    scratchPoint
      .applyMatrix4(object.matrixWorldInverse)
      .applyMatrix4(object.projectionMatrix);
    const logical = ndcToLogical(
      scratchPoint.x,
      scratchPoint.y,
      this.width,
      this.height,
    );
    return { x: logical.x, y: logical.y, depth: scratchPoint.z, visible };
  }

  /**
   * The world-space line a pointer at a logical point picks along.
   *
   * Under `perspective` every such line passes through the eye, so `origin` is
   * the camera's position and the direction is toward the logical point
   * unprojected at any depth — the middle of the depth range is taken, being
   * numerically comfortable and far from both clip planes. Under `orthographic`
   * the lines are parallel, so the logical point picks the origin, on the near
   * plane, and the camera's own facing picks the direction.
   *
   * The result is a fresh `Ray` with a unit direction, which is exactly what the
   * collision world's raycasts take.
   */
  logicalToRay(point: Vec2): Ray {
    const object = cameraObject(this, this.width, this.height);
    const ndc = logicalToNdc(point.x, point.y, this.width, this.height);

    if (object instanceof THREE.OrthographicCamera) {
      // NDC `z = -1` is the near plane, which is where the specification places
      // the origin.
      scratchTarget
        .set(ndc.x, ndc.y, -1)
        .applyMatrix4(object.projectionMatrixInverse)
        .applyMatrix4(object.matrixWorld);
      // `transformDirection` applies the rotation alone and normalizes, so the
      // direction is unit length whatever the world matrix carries besides.
      scratchDirection.set(0, 0, -1).transformDirection(object.matrixWorld);
      return {
        origin: toVec3(scratchTarget),
        direction: toVec3(scratchDirection),
      };
    }

    scratchTarget
      .set(ndc.x, ndc.y, 0.5)
      .applyMatrix4(object.projectionMatrixInverse)
      .applyMatrix4(object.matrixWorld);
    scratchDirection.copy(scratchTarget).sub(object.position).normalize();
    return {
      origin: { ...this.position },
      direction: toVec3(scratchDirection),
    };
  }

  /**
   * Keep `position` inside `bounds`, when there is one.
   *
   * Each axis is clamped on its own, and the projection is left as it stands, so
   * the clamp moves the camera and changes nothing about what it sees from where
   * it ends up. Called by {@link updateCamera} every frame, after a followed
   * target has been adopted.
   */
  clampToBounds(): void {
    clampCameraToBounds(this);
  }
}

/** A three vector as the plain {@link Vec3} the contract speaks in. */
function toVec3(v: THREE.Vector3): Vec3 {
  return { x: v.x, y: v.y, z: v.z };
}

/**
 * Keep a camera's position inside its bounds, one axis at a time.
 *
 * A **fresh** record is written rather than the three fields being assigned in
 * place, because `camera.position` may be a record the game shares with
 * something else — `camera.position = actor.transform.position` is a perfectly
 * ordinary way to pin the camera to an actor, and clamping through it would move
 * the actor. The camera owns what it writes; the game owns what it wrote.
 *
 * The clamp is `min(max(v, min), max)` per axis, so a box whose `min` exceeds
 * its `max` on an axis pins that axis to `max` rather than reporting an error:
 * an inverted box is a game's arithmetic mistake, and a camera that stops moving
 * is a far easier symptom to trace than a `NaN` in the view matrix.
 */
function clampCameraToBounds(camera: Camera): void {
  const bounds = camera.bounds;
  if (bounds === null) return;
  camera.position = {
    x: clampAxis(camera.position.x, bounds.min.x, bounds.max.x),
    y: clampAxis(camera.position.y, bounds.min.y, bounds.max.y),
    z: clampAxis(camera.position.z, bounds.min.z, bounds.max.z),
  };
}

/** One axis of the bounds clamp. */
function clampAxis(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Step 10.1 of the frame: a camera with a view target adopts that target's pose
 * and field of view, and the result is clamped to `bounds`.
 *
 * Internal: the pipeline calls it once per frame, before it syncs the scene and
 * renders, so the picture is taken from the camera the settled world implies.
 *
 * The figures come from the first *enabled* `CameraComponent` the target holds —
 * that component's **world** transform, so the component's `offset` is where on
 * the actor the eye sits — and its `fov`. A target that carries no such
 * component, or one that has been destroyed, leaves the pose where the game
 * wrote it, so a camera does not lurch to the origin when its subject dies. The
 * clamp runs whether the camera is following or not, so a hand-driven camera is
 * kept inside the same region a following one is.
 *
 * `fov` is written whichever projection is in force, matching the documented
 * adoption; under `orthographic` it is simply not read.
 */
export function updateCamera(camera: Camera): void {
  const target = camera.target;
  if (target !== null && target.alive) {
    const lens = target
      .componentsOf(CameraComponent)
      .find((component) => component.enabled);
    if (lens !== undefined) {
      const at = lens.worldTransform();
      // `worldTransform` returns fresh records, so the camera takes ownership of
      // these rather than aliasing the actor's own transform.
      camera.position = at.position;
      camera.rotation = at.rotation;
      camera.fov = lens.fov;
    }
  }
  clampCameraToBounds(camera);
}
