/**
 * The two maps between a game's world and the pixels it lands on, and the
 * frustum camera that owns the first of them.
 *
 * A game places its actors in *world* units. The camera ({@link WorldCamera})
 * projects the world through a perspective frustum into the *logical* design
 * size handed to `createEngine`, and the viewport ({@link fitViewport}) maps
 * that logical field onto the canvas's backing store in *device* pixels. The
 * projection half is two pure functions — {@link projectPoint} and
 * {@link pointerRay} — because every mapping the engine performs is defined
 * as a composition of those two with the viewport's linear equations, and a
 * validator recomputes the same composition to name an exact pixel.
 *
 * Four conventions are worth stating up front, because everything else
 * follows:
 *
 * 1. **The frustum's aspect ratio is always the design aspect** —
 *    `width / height` from `EngineOptions`, never the canvas's. Aspect is not
 *    a `CameraState` field, so the picture is identical on every canvas and
 *    the viewport letterboxes it exactly as a 2D picture is letterboxed.
 * 2. **The y flip lives in the projection's NDC step and nowhere else.** The
 *    world is right-handed with +Y up; the logical field keeps the 2D
 *    convention with y down. `ndcY = 1 - 2 * logicalY / height` is the one
 *    place the two meet, which is what lets the pointer, the viewport, and
 *    the recording metadata carry the 2D rules unchanged.
 * 3. **The viewport's scale is uniform and in device pixels.** One `min` of
 *    the two axis ratios keeps the whole logical field visible; the device
 *    pixel ratio is folded into `scale`, and the leftover on the long axis is
 *    split into two equal centered bars.
 * 4. **Every measurement arrives through a `SurfaceMetrics`.** Nothing here
 *    reads `clientWidth` or `devicePixelRatio` on its own account;
 *    {@link syncCanvas} is handed the numbers, and {@link domSurface} is the
 *    one function in the package that touches the DOM for them. That seam is
 *    what puts the engine over a canvas with no document behind it.
 *
 * The camera half is deliberately dumb about the world it projects: following
 * a view target is expressed as {@link WorldCamera.adopt}, which takes the
 * plain position, rotation, and field of view the frame extracted from the
 * target's `CameraComponent`, so this module stays a leaf the frame drives
 * with numbers.
 *
 * Everything here mirrors the API pages under
 * `docs/engines/structured-3d/apis/` (the `camera` page, and the shared math
 * vocabulary Simple 3D's `viewport` page specifies) — those pages are the
 * specification, and a behavior that disagrees with its page is wrong.
 */

import type {
  Box3,
  CameraState,
  FitViewport,
  PointerRay,
  ProjectPoint,
  Quat,
  Ray,
  SyncCanvas,
  Transform,
  Vec2,
  Vec3,
  Viewport,
} from "./math";
import {
  defaultCameraState,
  rotateVec3,
  transformPoint,
  vec3Cross,
  vec3Normalize,
  vec3Sub,
} from "./math";

/* -------------------------------------------------------------------------- */
/* The measurement seam                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The seam every environmental measurement arrives through: the canvas's
 * laid-out CSS size, the device pixel ratio, the event target the engine
 * listens on, and the canvas's client-space origin for pointer mapping.
 *
 * Declared here beside {@link syncCanvas} and {@link domSurface}, the two
 * functions that define what the seam means, matching the shape the engine
 * page specifies. The engine's own options type takes this same interface.
 */
export interface SurfaceMetrics {
  /** The canvas's laid-out CSS width, in CSS pixels. */
  cssWidth(): number;
  /** The canvas's laid-out CSS height, in CSS pixels. */
  cssHeight(): number;
  /** The current device pixel ratio. */
  dpr(): number;
  /** The target the engine attaches its key and pointer listeners to. */
  events(): EventTarget;
  /**
   * The canvas's top-left corner in the client coordinate space pointer
   * events report in. Absent, the origin reads `(0, 0)`.
   */
  origin?(): { x: number; y: number };
}

/* -------------------------------------------------------------------------- */
/* The viewport                                                               */
/* -------------------------------------------------------------------------- */

/**
 * A device pixel ratio we are willing to multiply by.
 *
 * A ratio arrives from a supplied surface as often as from a window, and a
 * driver, a test, or a detached document can hand us `0`, `NaN`, or nothing
 * at all. Reading a ratio that is not finite and positive as `1` — the
 * documented rule — keeps a bad ratio from poisoning the fit, where it would
 * silently blank the canvas.
 */
function normalizeDpr(dpr: number): number {
  return Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
}

/** A non-negative, finite dimension; anything else collapses to `0`. */
function normalizeSize(size: number): number {
  return Number.isFinite(size) && size > 0 ? size : 0;
}

/**
 * Compute the letterboxed, centered, device-pixel-ratio-aware fit of a
 * `logicalWidth` × `logicalHeight` field into a `cssWidth` × `cssHeight`
 * element.
 *
 * A degenerate input — a zero-size container (a hidden element, an element
 * the browser has not laid out yet), or a logical size that is not finite and
 * positive — yields `scale: 0` rather than an `Infinity` or `NaN` that would
 * propagate into every projection that follows and turn each draw into a
 * silent no-op that is very hard to trace back here. A zero scale draws
 * nothing *this* frame and recovers on its own as soon as the element has a
 * size.
 */
export const fitViewport: FitViewport = (
  logicalWidth,
  logicalHeight,
  cssWidth,
  cssHeight,
  dpr,
): Viewport => {
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
  // so the two bars really do sum to the drawable area; centering against an
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
};

/**
 * The measurements a canvas that really is in a document reports about
 * itself.
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
 * The test is therefore "does the reported size still match the size the
 * attributes imply", *not* "is the inline style empty". A canvas sized by a
 * stylesheet has an empty inline style, and treating that as unsized would
 * write a fixed pixel size over the page's rule and freeze the canvas at
 * whatever size it happened to be first measured at — the exact opposite of
 * what the pin is for.
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
 * reports, and return the viewport that fits `logicalWidth` ×
 * `logicalHeight` into it.
 *
 * The backing store is written only when it actually differs: assigning
 * `canvas.width` clears the canvas and reallocates it even when the value is
 * unchanged, so an unconditional write once per frame would both flicker and
 * churn memory.
 *
 * A surface reporting `0` on either axis — `display: none`, or an element
 * not yet laid out — leaves the canvas the backing store it already had.
 * Resizing it to nothing would throw away the last good frame for no
 * benefit, and the next call recovers once the element has a size.
 */
export const syncCanvas: SyncCanvas<SurfaceMetrics> = (
  canvas,
  logicalWidth,
  logicalHeight,
  surface,
): Viewport => {
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
};

/* -------------------------------------------------------------------------- */
/* Projection and picking                                                     */
/* -------------------------------------------------------------------------- */

/**
 * `v` rotated by the conjugate of `q`: the world-to-view rotation. Private —
 * the documented math vocabulary is fixed by the shared `math.ts`, and the
 * view transform is the only place the package needs an inverse rotation.
 */
function rotateByConjugate(q: Quat, v: Vec3): Vec3 {
  // The same expanded sandwich product as `rotateVec3`, with the vector part
  // negated in place rather than through an allocated conjugate, since this
  // sits on the hottest path in the module.
  const qx = -q.x;
  const qy = -q.y;
  const qz = -q.z;
  const tx = 2 * (qy * v.z - qz * v.y);
  const ty = 2 * (qz * v.x - qx * v.z);
  const tz = 2 * (qx * v.y - qy * v.x);
  return {
    x: v.x + q.w * tx + (qy * tz - qz * ty),
    y: v.y + q.w * ty + (qz * tx - qx * tz),
    z: v.z + q.w * tz + (qx * ty - qy * tx),
  };
}

/**
 * Map a world point through the camera's view and perspective projection
 * into logical coordinates.
 *
 * A point at or behind the camera plane returns `null`: there is no logical
 * position such a point could honestly claim, and the projection arithmetic
 * would hand back a confidently wrong one. A visible point maps into
 * `0..width` × `0..height`; a point outside the frustum maps outside that
 * range and is returned as-is, so a caller can tell "off screen to the left"
 * from "behind me".
 *
 * The frustum's aspect ratio is the viewport's `width / height` — the design
 * aspect, since the viewport carries the logical design size — and the NDC
 * step holds the y flip between the y-up world and the y-down logical field:
 * `ndcX = 2 * logicalX / width - 1`, `ndcY = 1 - 2 * logicalY / height`,
 * inverted here to land world points in logical coordinates. The viewport's
 * scale and offsets play no part: they belong to the second map, the two
 * device equations a caller composes on afterwards.
 */
export const projectPoint: ProjectPoint = (
  camera,
  viewport,
  point,
): Vec2 | null => {
  const view = rotateByConjugate(
    camera.rotation,
    vec3Sub(point, camera.position),
  );
  // The camera looks down its local −Z, so "in front" is a strictly negative
  // view z; zero is *at* the camera plane and equally unprojectable.
  if (view.z >= 0) return null;

  const tanHalfFovY = Math.tan(camera.fovY / 2);
  const aspect = viewport.width / viewport.height;
  const ndcX = view.x / (-view.z * tanHalfFovY * aspect);
  const ndcY = view.y / (-view.z * tanHalfFovY);

  return {
    x: ((ndcX + 1) / 2) * viewport.width,
    y: ((1 - ndcY) / 2) * viewport.height,
  };
};

/**
 * The picking convention: `origin` is the camera's position and `direction`
 * the unit vector through the given logical point on the near plane.
 *
 * The inverse of {@link projectPoint}'s NDC step, so for a point in front of
 * the camera `pointerRay(c, v, projectPoint(c, v, p))` passes through `p`. A
 * point inside a letterbox bar is outside `0..width`/`0..height` and still
 * yields a ray, since the math extends past the field's edge; treating it as
 * a miss is the game's choice. Both returned vectors are fresh values the
 * caller owns.
 */
export const pointerRay: PointerRay = (camera, viewport, point): Ray => {
  const tanHalfFovY = Math.tan(camera.fovY / 2);
  const aspect = viewport.width / viewport.height;
  const ndcX = (2 * point.x) / viewport.width - 1;
  const ndcY = 1 - (2 * point.y) / viewport.height;

  // The direction through the logical point in view space, then rotated into
  // the world. Any positive view depth gives the same ray through the
  // camera's position, so −1 stands in for the near plane.
  const viewDirection: Vec3 = {
    x: ndcX * tanHalfFovY * aspect,
    y: ndcY * tanHalfFovY,
    z: -1,
  };
  const rotated = rotateVec3(camera.rotation, viewDirection);

  return {
    origin: {
      x: camera.position.x,
      y: camera.position.y,
      z: camera.position.z,
    },
    direction: vec3Normalize(rotated),
  };
};

/* -------------------------------------------------------------------------- */
/* The camera                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * How nearly parallel an aim and the world's +Y must be, as the squared
 * length of their cross product, before `lookAt` swaps its up preference to
 * +Z. Two unit vectors' cross length is the sine of the angle between them,
 * so this admits aims within about a thousandth of a radian of vertical —
 * close enough that a +Y-derived basis would be numerical noise.
 */
const LOOK_AT_PARALLEL_EPSILON = 1e-12;

/**
 * The rotation whose basis vectors — the camera's world-space right, up, and
 * back (+Z) axes — are the given orthonormal triple. Shepperd's method: the
 * branch on the largest diagonal element keeps the square root away from
 * zero, so the quaternion is stable whichever way the camera faces.
 */
function quatFromBasis(x: Vec3, y: Vec3, z: Vec3): Quat {
  const trace = x.x + y.y + z.z;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    return {
      x: (y.z - z.y) / s,
      y: (z.x - x.z) / s,
      z: (x.y - y.x) / s,
      w: s / 4,
    };
  }
  if (x.x > y.y && x.x > z.z) {
    const s = Math.sqrt(1 + x.x - y.y - z.z) * 2;
    return {
      x: s / 4,
      y: (y.x + x.y) / s,
      z: (z.x + x.z) / s,
      w: (y.z - z.y) / s,
    };
  }
  if (y.y > z.z) {
    const s = Math.sqrt(1 + y.y - x.x - z.z) * 2;
    return {
      x: (y.x + x.y) / s,
      y: s / 4,
      z: (z.y + y.z) / s,
      w: (z.x - x.z) / s,
    };
  }
  const s = Math.sqrt(1 + z.z - x.x - y.y) * 2;
  return {
    x: (z.x + x.z) / s,
    y: (z.y + y.z) / s,
    z: s / 4,
    w: (x.y - y.x) / s,
  };
}

/**
 * The camera surface a world exposes as `world.camera`.
 *
 * Generic over the actor type because the camera is deliberately ignorant of
 * the gameplay framework: it holds the target and hands the framing decision
 * back to the frame, which extracts the plain figures from the target's
 * `CameraComponent` and calls {@link WorldCamera.adopt}. The world
 * instantiates it as `Camera<Actor>`.
 */
export interface Camera<TActor = unknown> {
  /** The camera's position in world units. Default `(0, 0, 10)`. */
  position: Vec3;
  /** The camera's orientation. Identity looks down −Z with +Y up. */
  rotation: Quat;
  /** The vertical field of view, in radians. Default `Math.PI / 3`. */
  fovY: number;
  /** The near plane distance, in world units. Default `0.1`. */
  near: number;
  /** The far plane distance, in world units. Default `1000`. */
  far: number;
  /** The actor the camera follows, or `null`. */
  readonly target: TActor | null;
  /** Sets `target`. `null` clears it and returns the framing to the game. */
  follow(actor: TActor | null): void;
  /**
   * Sets `rotation` to aim −Z from `position` at `point`, holding +Y as
   * close to the world's +Y as the aim allows.
   */
  lookAt(point: Vec3): void;
  /** The projection as a `CameraState` the caller owns. */
  snapshot(): CameraState;
  /** The world point in logical coordinates, or `null` at or behind the camera plane. */
  project(point: Vec3): Vec2 | null;
  /** The picking ray through a logical point. */
  ray(point: Vec2): Ray;
}

/**
 * The world's camera: the live object behind the {@link Camera} interface.
 *
 * Construction *is* the documented reset — the fields start at
 * `defaultCameraState()`'s values, so a level transition that rebuilds the
 * world rebuilds the camera at its defaults and an incoming level begins from
 * them. The viewport arrives as a provider closure rather than a value
 * because `project` and `ray` are specified as compositions with
 * `engine.viewport()`, the fit *of the frame the call happens in*, and a
 * held viewport would silently go stale on the first resize.
 *
 * There is no zoom and no bounds: framing is `position`, `rotation`, and
 * `fovY`, so "closer" is moving the camera or narrowing `fovY`, and a
 * frustum has no 2D clamp rectangle. A game that confines its framing writes
 * the confinement into the code that moves the camera.
 */
export class WorldCamera<TActor = unknown> implements Camera<TActor> {
  /** The camera's position in world units. */
  position: Vec3;
  /** The camera's orientation. */
  rotation: Quat;
  /** The vertical field of view, in radians. */
  fovY: number;
  /** The near plane distance, in world units. */
  near: number;
  /** The far plane distance, in world units. */
  far: number;

  /** The current fit, read fresh on every projection. */
  private readonly viewport: () => Viewport;
  /** The actor the camera follows, or `null`. */
  private followTarget: TActor | null = null;

  /**
   * @param viewport The current fit, as the engine reports it — the same
   * snapshot-per-call `engine.viewport()` the API page composes `project`
   * and `ray` from.
   */
  constructor(viewport: () => Viewport) {
    const defaults = defaultCameraState();
    this.position = defaults.position;
    this.rotation = defaults.rotation;
    this.fovY = defaults.fovY;
    this.near = defaults.near;
    this.far = defaults.far;
    this.viewport = viewport;
  }

  /** The actor the camera follows, or `null`. */
  get target(): TActor | null {
    return this.followTarget;
  }

  /**
   * Sets `target`. `null` clears it, and the game writes `position`,
   * `rotation`, and `fovY` itself.
   */
  follow(actor: TActor | null): void {
    this.followTarget = actor;
  }

  /**
   * Aim −Z from `position` at `point`, holding +Y as close to the world's
   * +Y as the aim allows.
   *
   * `point` equal to `position` leaves `rotation` unchanged — there is no
   * direction to aim, and any answer would be arbitrary. An aim parallel to
   * the world's y axis holds +Z as up instead, since +Y offers no
   * perpendicular to build the basis from.
   */
  lookAt(point: Vec3): void {
    const aim = vec3Sub(point, this.position);
    const forward = vec3Normalize(aim);
    if (forward.x === 0 && forward.y === 0 && forward.z === 0) return;

    // The camera's world-space +Z axis points *away* from the aim.
    const back: Vec3 = { x: -forward.x, y: -forward.y, z: -forward.z };
    let up: Vec3 = { x: 0, y: 1, z: 0 };
    const right = vec3Cross(up, back);
    const rightLengthSq =
      right.x * right.x + right.y * right.y + right.z * right.z;
    if (rightLengthSq < LOOK_AT_PARALLEL_EPSILON) {
      up = { x: 0, y: 0, z: 1 };
    }

    const x = vec3Normalize(vec3Cross(up, back));
    // Already unit length: the cross of two orthonormal vectors. Recomputing
    // rather than reusing `up` is the Gram–Schmidt step that tilts the
    // camera's up toward the preference as far as the aim allows.
    const y = vec3Cross(back, x);
    this.rotation = quatFromBasis(x, y, back);
  }

  /**
   * Take a view target's figures: the world position and rotation of the
   * target's first enabled `CameraComponent`, and that component's `fovY`.
   * `near` and `far` stay as set.
   *
   * Called by the frame each time the camera has a target, before the
   * pipeline draws. Plain figures rather than the component itself, so the
   * camera stays ignorant of the framework, and fresh copies rather than the
   * caller's objects, so a component's later mutation does not reach through.
   */
  adopt(position: Vec3, rotation: Quat, fovY: number): void {
    this.position = { x: position.x, y: position.y, z: position.z };
    this.rotation = {
      x: rotation.x,
      y: rotation.y,
      z: rotation.z,
      w: rotation.w,
    };
    this.fovY = fovY;
  }

  /**
   * The projection as a `CameraState` the caller owns: fresh objects all the
   * way down, so a held snapshot keeps the values of the moment it was read
   * and writing into it moves nothing.
   */
  snapshot(): CameraState {
    return {
      position: { x: this.position.x, y: this.position.y, z: this.position.z },
      rotation: {
        x: this.rotation.x,
        y: this.rotation.y,
        z: this.rotation.z,
        w: this.rotation.w,
      },
      fovY: this.fovY,
      near: this.near,
      far: this.far,
    };
  }

  /** `projectPoint(snapshot(), viewport(), point)` — the documented composition. */
  project(point: Vec3): Vec2 | null {
    return projectPoint(this.snapshot(), this.viewport(), point);
  }

  /** `pointerRay(snapshot(), viewport(), point)` — the documented composition. */
  ray(point: Vec2): Ray {
    return pointerRay(this.snapshot(), this.viewport(), point);
  }
}

/* -------------------------------------------------------------------------- */
/* Box3 helpers                                                               */
/* -------------------------------------------------------------------------- */

// `Box3` is the package's one axis-aligned box — a collider's `bounds()` and
// a `MeshHandle`'s `bounds` are one — and the helpers below are the package's
// internal vocabulary for producing them. They are exported for the modules
// that compute bounds (collision, assets) and for tests, but they are not part
// of the documented package surface, so the entry point does not re-export
// them.

/**
 * The eight corners of a box, ordered with x varying fastest, then y, then z:
 * `(min.x, min.y, min.z)` first, `(max.x, max.y, max.z)` last. A stable order
 * so a caller mapping corners to expectations can index them.
 */
export function box3Corners(
  box: Box3,
): [Vec3, Vec3, Vec3, Vec3, Vec3, Vec3, Vec3, Vec3] {
  const { min, max } = box;
  return [
    { x: min.x, y: min.y, z: min.z },
    { x: max.x, y: min.y, z: min.z },
    { x: min.x, y: max.y, z: min.z },
    { x: max.x, y: max.y, z: min.z },
    { x: min.x, y: min.y, z: max.z },
    { x: max.x, y: min.y, z: max.z },
    { x: min.x, y: max.y, z: max.z },
    { x: max.x, y: max.y, z: max.z },
  ];
}

/**
 * The tightest axis-aligned box around `points`.
 *
 * Refuses an empty list rather than inventing a box: there is no honest
 * answer, and an "empty box" sentinel (infinities, or a zero box at the
 * origin) presents later as geometry at a place nothing ever was — the most
 * expensive kind of failure to trace.
 */
export function box3FromPoints(points: readonly Vec3[]): Box3 {
  const first = points[0];
  if (first === undefined) {
    throw new RangeError(
      "box3FromPoints needs at least one point, got an empty list",
    );
  }
  const min = { x: first.x, y: first.y, z: first.z };
  const max = { x: first.x, y: first.y, z: first.z };
  for (const p of points) {
    if (p.x < min.x) min.x = p.x;
    if (p.y < min.y) min.y = p.y;
    if (p.z < min.z) min.z = p.z;
    if (p.x > max.x) max.x = p.x;
    if (p.y > max.y) max.y = p.y;
    if (p.z > max.z) max.z = p.z;
  }
  return { min, max };
}

/** The tightest box containing both `a` and `b`, as a fresh value. */
export function box3Union(a: Box3, b: Box3): Box3 {
  return {
    min: {
      x: Math.min(a.min.x, b.min.x),
      y: Math.min(a.min.y, b.min.y),
      z: Math.min(a.min.z, b.min.z),
    },
    max: {
      x: Math.max(a.max.x, b.max.x),
      y: Math.max(a.max.y, b.max.y),
      z: Math.max(a.max.z, b.max.z),
    },
  };
}

/**
 * The axis-aligned box around `box` carried through `t` — the AABB of the
 * eight transformed corners. Under a rotation this is wider than the shape
 * it bounds, which is what an axis-aligned bound of an oriented thing has to
 * be; it is exact for the corners themselves.
 */
export function transformBox3(t: Transform, box: Box3): Box3 {
  return box3FromPoints(
    box3Corners(box).map((corner) => transformPoint(t, corner)),
  );
}
