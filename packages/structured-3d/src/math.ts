/**
 * The 3D math vocabulary: the plain-data types a world is written in and the
 * eleven pure functions the docs specify over them.
 *
 * This module is a deliberate, byte-identical COPY carried by both 3D engine
 * packages — `packages/simple-3d/src/math.ts` and
 * `packages/structured-3d/src/math.ts` are the same file, not an import of one
 * another. Each engine package is vendored into run repositories and has to
 * stay self-contained, so neither can depend on the other, and a shared
 * package would tie their release cycles together; the docs instead specify
 * one vocabulary — "the same names and the same behavior" — and the two copies
 * are held identical by the recording-parity suites. Change one copy and you
 * must change the other byte for byte.
 *
 * Everything here mirrors the API pages under `docs/engines/simple-3d/apis/`
 * (the `viewport` page) and `docs/engines/structured-3d/apis/` (the `camera`
 * page) — those pages are the specification, and a function that disagrees
 * with its page is wrong.
 *
 * Conventions, stated once: the world is right-handed with +Y up and +X right,
 * a camera looks down its local −Z, front faces wind counter-clockwise, and
 * angles are radians everywhere. Every function is pure over plain data — no
 * classes, no methods, no mutation — and every function returns a fresh value,
 * so a caller can hand its own state to the math without the math writing back
 * into it.
 */

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

/** A point in the logical design field: a pointer position, a projected point. */
export interface Vec2 {
  x: number;
  y: number;
}

/** A point or direction in world units. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * An orientation. There is no Euler type; a readable rotation is built with
 * {@link quatFromAxisAngle}. Identity is `{ x: 0, y: 0, z: 0, w: 1 }`, and
 * quaternions are kept unit-length by the functions that produce them.
 */
export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

/**
 * A placement: scale, then rotation, then translation. Identity is position
 * `(0, 0, 0)`, identity rotation, scale `(1, 1, 1)`.
 */
export interface Transform {
  position: Vec3;
  rotation: Quat;
  scale: Vec3;
}

/** The axis-aligned box: a mesh's or a geometry's bounds are one. */
export interface Box3 {
  min: Vec3;
  max: Vec3;
}

/** A picking ray: `origin`, and a unit `direction` away from it. */
export interface Ray {
  origin: Vec3;
  direction: Vec3;
}

/**
 * The frustum camera as a plain value. Aspect is not a field: the frustum's
 * aspect ratio is always the design aspect, `width / height` from
 * `EngineOptions`, so the picture is identical on every canvas.
 */
export interface CameraState {
  /** The camera's position in world units. Default `(0, 0, 10)`. */
  position: Vec3;
  /** The camera's orientation. Identity looks down −Z with +Y up. */
  rotation: Quat;
  /** The vertical field of view, in radians. Default `Math.PI / 3`. */
  fovY: number;
  /** The near plane distance, in world units. Finite and positive; default `0.1`. */
  near: number;
  /** The far plane distance, in world units. Greater than `near`; default `1000`. */
  far: number;
}

/**
 * The default `CameraState`, as a fresh value the caller owns. A fresh
 * engine's renderer state carries exactly this camera, so the recorder and the
 * renderer both read their defaults from one producer rather than two lists
 * that could drift.
 */
export function defaultCameraState(): CameraState {
  return {
    position: { x: 0, y: 0, z: 10 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    fovY: Math.PI / 3,
    near: 0.1,
    far: 1000,
  };
}

/**
 * The fit from the logical design field onto the canvas's backing store.
 * `scale` and both offsets are device pixels; the CSS-pixel figure is `scale`
 * divided by the device pixel ratio.
 */
export interface Viewport {
  /** The logical design width. The picture is projected into `0..width`. */
  readonly width: number;
  /** The logical design height. The picture is projected into `0..height`. */
  readonly height: number;
  /** Device pixels per logical unit, with the device pixel ratio folded in. */
  scale: number;
  /** The left letterbox bar, in device pixels. */
  offsetX: number;
  /** The top letterbox bar, in device pixels. */
  offsetY: number;
}

/* -------------------------------------------------------------------------- */
/* Projection and viewport function types                                     */
/* -------------------------------------------------------------------------- */

// The four functions below are part of the same documented vocabulary but are
// implemented beside each engine's viewport/camera module, where the fit and
// the frustum live. Their signatures are the contract, so they are declared
// here once and the implementations conform to them.

/**
 * Maps a world point through the camera's view and perspective projection into
 * logical coordinates. A point at or behind the camera plane returns `null`;
 * a point outside the frustum maps outside `0..width` × `0..height` and is
 * returned as-is.
 */
export type ProjectPoint = (
  camera: CameraState,
  viewport: Viewport,
  point: Vec3,
) => Vec2 | null;

/**
 * The picking convention: `origin` is the camera's position, `direction` the
 * unit vector through the given logical point on the near plane. A point
 * inside a letterbox bar still yields a ray.
 */
export type PointerRay = (
  camera: CameraState,
  viewport: Viewport,
  point: Vec2,
) => Ray;

/**
 * Computes the letterboxed fit of the logical field into a CSS-pixel container
 * at a device pixel ratio: a uniform scale, and two centered bars.
 */
export type FitViewport = (
  logicalWidth: number,
  logicalHeight: number,
  cssWidth: number,
  cssHeight: number,
  dpr: number,
) => Viewport;

/**
 * Brings a canvas's backing store in line with the size and ratio the surface
 * reports, and returns the fit. Generic over the surface because
 * `SurfaceMetrics` belongs to each engine's own contract; the shape it needs
 * here is the measurements alone.
 */
export type SyncCanvas<Surface> = (
  canvas: HTMLCanvasElement,
  logicalWidth: number,
  logicalHeight: number,
  surface: Surface,
) => Viewport;

/* -------------------------------------------------------------------------- */
/* Vector functions                                                           */
/* -------------------------------------------------------------------------- */

/** `a + b`, componentwise. */
export function vec3Add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

/** `a - b`, componentwise. */
export function vec3Sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

/** `v` scaled by `s`. */
export function vec3Scale(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

/** The dot product. */
export function vec3Dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/** The cross product, right-handed: `vec3Cross(x, y)` is `z`. */
export function vec3Cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

/** The Euclidean length. */
export function vec3Length(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

/**
 * The unit vector. A zero vector returns `(0, 0, 0)` rather than NaN — the
 * documented rule, so normalizing a rest-state velocity is safe without a
 * guard at every call site.
 */
export function vec3Normalize(v: Vec3): Vec3 {
  const length = vec3Length(v);
  if (length === 0) return { x: 0, y: 0, z: 0 };
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

/* -------------------------------------------------------------------------- */
/* Quaternion functions                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The rotation of `angleRad` about `axis`. The axis is normalized here, so a
 * caller may pass any non-zero vector along the axis it means; a zero axis
 * yields identity, the rotation that a rotation about nothing can only be.
 */
export function quatFromAxisAngle(axis: Vec3, angleRad: number): Quat {
  const unit = vec3Normalize(axis);
  if (unit.x === 0 && unit.y === 0 && unit.z === 0) {
    return { x: 0, y: 0, z: 0, w: 1 };
  }
  const half = angleRad / 2;
  const s = Math.sin(half);
  return { x: unit.x * s, y: unit.y * s, z: unit.z * s, w: Math.cos(half) };
}

/**
 * The Hamilton product. `quatMultiply(a, b)` applies `b` first, then `a` —
 * the same reading as matrix composition, and the order the docs pin.
 */
export function quatMultiply(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

/**
 * `v` rotated by `q`, via the expanded sandwich product `q v q⁻¹` — two cross
 * products rather than two quaternion multiplies, the standard reduction for a
 * unit quaternion.
 */
export function rotateVec3(q: Quat, v: Vec3): Vec3 {
  // t = 2 * (q.xyz × v); result = v + q.w * t + (q.xyz × t)
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

/** `p` under `t`: scale, then rotation, then translation — the TRS order. */
export function transformPoint(t: Transform, p: Vec3): Vec3 {
  const scaled = { x: p.x * t.scale.x, y: p.y * t.scale.y, z: p.z * t.scale.z };
  const rotated = rotateVec3(t.rotation, scaled);
  return vec3Add(rotated, t.position);
}
