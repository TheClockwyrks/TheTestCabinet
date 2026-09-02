/**
 * The spatial algebra the whole engine is written in: the constants a game
 * names, and the vector, quaternion, and transform helpers it moves with.
 *
 * The types themselves ({@link Vec3}, {@link Quat}, {@link Mat4},
 * {@link Transform}) live in `contract.ts`, because a transform is spoken by
 * every side of the package. What lives here is the *behavior* — the values and
 * the pure functions — and the reason it is a separate module is that it is a
 * leaf: nothing below the framework, the pipeline, the collision world, or the
 * camera can be written without it, and it imports none of them back.
 *
 * ## Records and pure functions, not objects with methods
 *
 * A `Vec3` is `{ x, y, z }` and nothing else, and every helper below returns a
 * fresh record and mutates neither argument. That is a deliberate departure from
 * the way three asks a program to be written, where `a.add(b)` writes into `a`
 * and a hot loop is kept allocation-free by reusing scratch objects.
 *
 * The engine hands actors' transforms out to the game and takes them back every
 * frame, and it hands snapshots — `worldTransform()`, a collider's `bounds()`, a
 * manifold's `normal` — to code it did not write. Under three's convention every
 * one of those crossings has to answer "does the callee own this, and did that
 * helper just write through my actor's position?", and the answer is invisible at
 * the call site. Under this one there is nothing to answer: a value handed out is
 * the caller's, a value passed in is unchanged on return, and a game's step is
 * `position = add(position, scale(velocity, dt))`, which reads as the arithmetic
 * it is. The allocation is a handful of three-field objects per actor per frame,
 * which is far below the cost of the draw it feeds.
 *
 * A game that wants three's classes imports three and constructs them; the engine
 * re-exports nothing from it, and converts at its own boundaries.
 *
 * ## The conventions, once
 *
 * The world is right-handed with `+Y` up. A camera and a light look along their
 * local `-Z` and `+X` is to their right, so an actor at the identity rotation
 * faces {@link FORWARD}. Angles here are radians throughout — the camera's `fov`
 * is the engine's one exception, and it is documented where it lives. A rotation
 * is a unit quaternion and a matrix is column-major, as three stores both.
 *
 * Rotation is a quaternion rather than a triple of angles because a rotation on a
 * transform is composed, interpolated, and compared, and Euler angles are
 * ambiguous under all three. Angles remain the convenient way to *write* one, so
 * {@link quatFromEuler} and {@link quatToEuler} are the door between them, in
 * three's `"YXZ"` order: yaw about Y, then pitch about X, then roll about Z, in
 * the body's own axes. That order is the one a ground-plane game wants, because
 * yaw is the outermost rotation and `quatFromEuler(0, yaw, 0)` is a turn about
 * the world's up axis whatever pitch and roll the body holds.
 *
 * ## Numerically, three's formulas
 *
 * Every value here eventually reaches three: a transform becomes an
 * `Object3D`'s matrix, a look-at rotation becomes a camera's pose, a slerp
 * becomes the frame the pipeline draws. So each helper is written as the same
 * expression three writes, element for element and branch for branch —
 * {@link quatFromEuler} is `Quaternion.setFromEuler` in `"YXZ"`,
 * {@link quatSlerp} is `Quaternion.slerp` including its short-arc flip and its
 * linear fallback for a vanishing half-angle, {@link transformToMatrix} is
 * `Matrix4.compose`, and {@link quatLookAt} is `Matrix4.lookAt` composed with
 * `Quaternion.setFromRotationMatrix` — up to the degenerate direction, where
 * three nudges its axis by an epsilon and this module substitutes an exact one.
 * A build is free to compute a pose either
 * way and get the same picture, and a validator comparing an engine value with a
 * three value is not comparing two different roundings.
 *
 * ## Degenerate input has an answer
 *
 * A `NaN` that reaches a transform is close to untraceable: it propagates through
 * the composition into the matrix, into the camera, into the culling test, and
 * the symptom is a scene that renders nothing, several subsystems away from the
 * divide that produced it. So the three places a division can vanish each name a
 * result instead: a vector with no length — or no finite length — normalizes to
 * the zero vector (the doc says so),
 * a zero rotation axis and a zero look-at direction each yield the identity
 * rotation, and a look-at whose direction is parallel to its `up` picks another
 * `up` rather than dividing by a zero cross product. None of them is an error,
 * because each arises from arithmetic a game does legitimately — the direction to
 * a target it is standing on, the axis of a turn it is not making this frame.
 */

import type { Mat4, Quat, Transform, Vec3 } from "./contract";

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

/*
 * Each constant is one frozen record shared by every reader, and each is typed
 * as the *mutable* record it is a value of, so it can seed a `Transform` field
 * or a `Partial<Transform>` without a cast. The freeze is what makes sharing
 * safe: a module is strict-mode code, so a game that writes `UP.y = 2` throws at
 * the assignment rather than silently retuning gravity for every other reader in
 * the process. A field that is written later takes a fresh `vec3(0, 0, 0)` in
 * the constant's place, which is why `vec3` exists.
 */

/** The origin, and the zero displacement. */
export const VEC3_ZERO: Vec3 = Object.freeze({ x: 0, y: 0, z: 0 });

/** Unit scale on every axis: the scale half of the identity transform. */
export const VEC3_ONE: Vec3 = Object.freeze({ x: 1, y: 1, z: 1 });

/** The world's up axis, `+Y`. */
export const UP: Vec3 = Object.freeze({ x: 0, y: 1, z: 0 });

/**
 * The direction an unrotated actor, camera, or light faces, `-Z`.
 *
 * A heading is this vector turned by the actor's rotation, which is the one
 * sentence that ties the framework, the camera, and three's own convention
 * together.
 */
export const FORWARD: Vec3 = Object.freeze({ x: 0, y: 0, z: -1 });

/** The direction to an unrotated actor's right, `+X`. */
export const RIGHT: Vec3 = Object.freeze({ x: 1, y: 0, z: 0 });

/** The rotation that turns nothing. */
export const QUAT_IDENTITY: Quat = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });

/* -------------------------------------------------------------------------- */
/* Vector helpers                                                             */
/* -------------------------------------------------------------------------- */

/** A fresh vector. */
export function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

/** `a + b`, per component. */
export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

/** `a - b`, per component. */
export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

/** `v` with every component multiplied by `s`. */
export function scale(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

/** The dot product: `|a| |b| cos θ`, and so zero exactly when the two are perpendicular. */
export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/**
 * The cross product `a × b`, right-handed.
 *
 * Right-handed means `cross(RIGHT, UP)` is `+Z`, the axis pointing *back* out of
 * the screen, and so `cross(UP, RIGHT)` is {@link FORWARD}. That handedness is
 * the world's, not a choice this helper makes, and it is what makes a surface
 * normal built from two edges point out of the face rather than into it.
 */
export function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

/** The Euclidean length. */
export function length(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

/**
 * `v` at unit length.
 *
 * The zero vector normalizes to the zero vector rather than to a triple of
 * `NaN`, because "the direction to the thing I am standing on" is a question a
 * game asks by accident every so often, and a zero answer is one a caller can
 * test with {@link length} while a `NaN` one silently poisons the transform it
 * lands in. A vector that is already `NaN` or infinite takes the same exit: its
 * length is not a positive finite number, and dividing by it would turn one bad
 * component into three.
 */
export function normalize(v: Vec3): Vec3 {
  const len = length(v);
  if (!(len > 0) || !Number.isFinite(len)) return { x: 0, y: 0, z: 0 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

/** `length(sub(b, a))`: the distance between two points. */
export function distance(a: Vec3, b: Vec3): number {
  return length(sub(b, a));
}

/**
 * `a + (b - a) * t`, per component.
 *
 * `t` is unclamped, so `t` outside `0..1` extrapolates along the line through the
 * two points. That is deliberate: clamping here would quietly turn an overshoot
 * — a spring that passed its rest point, a camera lead ahead of its target —
 * into a stall at the endpoint, and a caller that wants the clamp writes it.
 */
export function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

/* -------------------------------------------------------------------------- */
/* Quaternion helpers                                                         */
/* -------------------------------------------------------------------------- */

/** Keep a value inside a closed interval; used where rounding can push a cosine past ±1. */
function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * A fresh quaternion from its components, exactly as given.
 *
 * The literal constructor, and the one helper here that does *not* renormalize:
 * it is the counterpart of {@link vec3}, and a caller writing four components by
 * hand — reading them back out of a saved pose, say — means the four it wrote.
 * Every helper that *computes* a rotation returns unit length.
 */
export function quat(x: number, y: number, z: number, w: number): Quat {
  return { x, y, z, w };
}

/**
 * The rotation of `x` radians about X, `y` about Y, and `z` about Z, composed in
 * the `"YXZ"` order: yaw first, then pitch, then roll, in the body's own axes.
 *
 * Equivalently, and this is the definition the docs give:
 *
 * ```ts
 * quatMultiply(
 *   quatMultiply(quatFromAxisAngle(UP, y), quatFromAxisAngle(RIGHT, x)),
 *   quatFromAxisAngle(vec3(0, 0, 1), z),
 * );
 * ```
 *
 * Written out in closed form here rather than as those three products because it
 * is on the path of every actor that steers by a heading, and because it is then
 * literally three's `Quaternion.setFromEuler` for `new THREE.Euler(x, y, z,
 * "YXZ")` — the two are the same rotation to the last bit, which is what lets a
 * build mix the engine's helpers with three's classes.
 */
export function quatFromEuler(x: number, y: number, z: number): Quat {
  const c1 = Math.cos(x / 2);
  const s1 = Math.sin(x / 2);
  const c2 = Math.cos(y / 2);
  const s2 = Math.sin(y / 2);
  const c3 = Math.cos(z / 2);
  const s3 = Math.sin(z / 2);
  return {
    x: s1 * c2 * c3 + c1 * s2 * s3,
    y: c1 * s2 * c3 - s1 * c2 * s3,
    z: c1 * c2 * s3 - s1 * s2 * c3,
    w: c1 * c2 * c3 + s1 * s2 * s3,
  };
}

/**
 * The Euler angles `{ x: pitch, y: yaw, z: roll }` that {@link quatFromEuler}
 * turns back into `q`, with pitch in `-π/2..π/2`.
 *
 * The extraction goes through the rotation matrix, as three's
 * `Euler.setFromRotationMatrix` does, because the middle angle of the `"YXZ"`
 * order is the one a single matrix element gives directly. Pitch is that
 * element's arcsine, and its range is the price of the decomposition being a
 * function at all: three angles name one rotation, but one rotation is named by
 * infinitely many triples, and restricting the middle angle picks exactly one.
 *
 * At the poles — pitch at ±π/2, the pose looking straight up or straight down —
 * yaw and roll turn about the same world axis and only their sum is recoverable.
 * The whole of it is then reported as yaw, with roll `0`, which is three's
 * choice too. A game reading a heading back with `quatToEuler(q).y` therefore
 * still gets a usable heading when it is pointed at the sky, and recomposing the
 * reported triple reproduces the rotation it came from either way.
 */
export function quatToEuler(q: Quat): Vec3 {
  const { x, y, z, w } = q;
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;

  // The rotation matrix of `q`, named by row and column as three names it.
  const m11 = 1 - (yy + zz);
  const m13 = xz + wy;
  const m21 = xy + wz;
  const m22 = 1 - (xx + zz);
  const m23 = yz - wx;
  const m31 = xz - wy;
  const m33 = 1 - (xx + yy);

  const pitch = Math.asin(clamp(-m23, -1, 1));
  if (Math.abs(m23) < 0.9999999) {
    return { x: pitch, y: Math.atan2(m13, m33), z: Math.atan2(m21, m22) };
  }
  return { x: pitch, y: Math.atan2(-m31, m11), z: 0 };
}

/**
 * The rotation of `angle` radians about `axis`, counterclockwise when looking
 * down the axis toward the origin.
 *
 * The axis is normalized first. The doc states it as a unit vector, and a caller
 * usually has one — {@link UP}, a normalized heading — but the caller that does
 * not is typically handing over a difference of two positions, and normalizing
 * here is what keeps the documented invariant that a returned quaternion is unit
 * length. A zero axis names no rotation, so it yields the identity.
 */
export function quatFromAxisAngle(axis: Vec3, angle: number): Quat {
  const len = length(axis);
  if (!(len > 0)) return { x: 0, y: 0, z: 0, w: 1 };
  const half = angle / 2;
  const s = Math.sin(half) / len;
  return { x: axis.x * s, y: axis.y * s, z: axis.z * s, w: Math.cos(half) };
}

/**
 * The Hamilton product `a · b`, matching three's `Quaternion.multiply`.
 *
 * Rotating by the product applies `b` first and `a` second:
 * `quatRotate(quatMultiply(a, b), v)` is `quatRotate(a, quatRotate(b, v))`. So a
 * rotation added in *world* axes goes on the left of the rotation an actor
 * already holds, and one added in the actor's *own* axes goes on the right — the
 * difference between a ship that yaws about the world's up axis however it is
 * pitched, and one that rolls about its own nose.
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
 * The rotation undoing `q`; for a unit quaternion, its conjugate.
 *
 * The conjugate is taken of `q` normalized, so the result is unit length and is
 * a true inverse — `quatMultiply(q, quatInverse(q))` is the identity — even when
 * a caller's quaternion has drifted off the unit sphere after a long chain of
 * products. A zero quaternion names no rotation and inverts to the identity.
 */
export function quatInverse(q: Quat): Quat {
  const len = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
  if (!(len > 0)) return { x: 0, y: 0, z: 0, w: 1 };
  return { x: -q.x / len, y: -q.y / len, z: -q.z / len, w: q.w / len };
}

/**
 * `v` turned by `q`.
 *
 * The direction an actor faces is `quatRotate(actor.transform.rotation,
 * FORWARD)`, and the offset of a component from its actor is its local position
 * turned the same way. Evaluated as `v + 2w(u × v) + 2(u × (u × v))` with `u`
 * the vector part, which is the sandwich product `q v q⁻¹` with the halves
 * folded together: same result as three's `Vector3.applyQuaternion`, and no
 * quaternion allocated to hold the conjugate.
 */
export function quatRotate(q: Quat, v: Vec3): Vec3 {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

/**
 * The spherical interpolation from `a` at `t = 0` to `b` at `t = 1`, along the
 * shorter arc.
 *
 * Spherical rather than component-wise because the point of interpolating a
 * rotation is a constant angular rate: a camera swinging onto a new target
 * should turn evenly, and a normalized component-wise blend rushes the middle of
 * the arc. Two things fall out of the sphere's geometry and are worth naming:
 *
 * - **`q` and `-q` are the same rotation**, so an arc between two quaternions has
 *   two lengths. A negative dot product means the numbers as given describe the
 *   long way round, and the sign of `b` is flipped to take the short one — which
 *   is why the value returned at `t = 1` may be `-b` component-wise while being
 *   `b` as a rotation.
 * - **A vanishing half-angle** would divide by a sine of zero, so a pair closer
 *   together than the floating-point grid can resolve falls back to a linear
 *   blend, renormalized. Over an arc that small the two agree to well under a
 *   pixel of the picture.
 *
 * `t` is not clamped, matching {@link lerp}; the arithmetic simply carries on
 * past either end of the arc.
 */
export function quatSlerp(a: Quat, b: Quat, t: number): Quat {
  if (t === 0) return { x: a.x, y: a.y, z: a.z, w: a.w };
  if (t === 1) return { x: b.x, y: b.y, z: b.z, w: b.w };

  let cosHalfTheta = a.w * b.w + a.x * b.x + a.y * b.y + a.z * b.z;
  let bx = b.x;
  let by = b.y;
  let bz = b.z;
  let bw = b.w;
  if (cosHalfTheta < 0) {
    cosHalfTheta = -cosHalfTheta;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }

  if (cosHalfTheta >= 1) return { x: a.x, y: a.y, z: a.z, w: a.w };

  const sqrSinHalfTheta = 1 - cosHalfTheta * cosHalfTheta;
  if (sqrSinHalfTheta <= Number.EPSILON) {
    const s = 1 - t;
    return normalizeQuat({
      x: s * a.x + t * bx,
      y: s * a.y + t * by,
      z: s * a.z + t * bz,
      w: s * a.w + t * bw,
    });
  }

  const sinHalfTheta = Math.sqrt(sqrSinHalfTheta);
  const halfTheta = Math.atan2(sinHalfTheta, cosHalfTheta);
  const ratioA = Math.sin((1 - t) * halfTheta) / sinHalfTheta;
  const ratioB = Math.sin(t * halfTheta) / sinHalfTheta;
  return {
    x: a.x * ratioA + bx * ratioB,
    y: a.y * ratioA + by * ratioB,
    z: a.z * ratioA + bz * ratioB,
    w: a.w * ratioA + bw * ratioB,
  };
}

/**
 * The rotation taking {@link FORWARD} onto `normalize(forward)`, rolled so its
 * local `+Y` lies as near `up` as the direction allows.
 *
 * The rotation a game reaches for when it knows where something should point and
 * not how it should be turned: aim a turret down the vector to its target, face
 * a projectile along its velocity, swing a camera onto a subject. `up` decides
 * the one remaining degree of freedom, the roll about the new forward axis, and
 * defaults to the world's {@link UP} so an object stays level.
 *
 * Two directions have no roll to choose, and both are ordinary: `forward` of
 * zero — the target is exactly here — yields the identity, and a `forward`
 * parallel to `up` — looking straight down, the common case for an overhead
 * camera — has every roll equally near `up`, so an arbitrary but stable one is
 * picked by substituting a second reference axis rather than dividing by a zero
 * cross product. The result is always a unit quaternion that maps `FORWARD` onto
 * the requested direction; only the roll is unspecified there.
 */
export function quatLookAt(forward: Vec3, up: Vec3 = UP): Quat {
  const dir = normalize(forward);
  if (dir.x === 0 && dir.y === 0 && dir.z === 0) {
    return { x: 0, y: 0, z: 0, w: 1 };
  }

  // The basis three builds in `Matrix4.lookAt`: `z` is the axis pointing *back*
  // along the view, because an object looks down its own `-Z`.
  const zAxis = { x: -dir.x, y: -dir.y, z: -dir.z };
  let reference = normalize(up);
  if (reference.x === 0 && reference.y === 0 && reference.z === 0) {
    reference = UP;
  }

  let xAxis = normalize(cross(reference, zAxis));
  if (xAxis.x === 0 && xAxis.y === 0 && xAxis.z === 0) {
    // `up` is parallel to the view axis. Any perpendicular will do; pick one that
    // cannot be parallel in turn, so the substitution never needs a third try.
    const fallback = Math.abs(zAxis.y) > 0.9999 ? vec3(0, 0, 1) : UP;
    xAxis = normalize(cross(fallback, zAxis));
  }
  const yAxis = cross(zAxis, xAxis);

  return quatFromBasis(xAxis, yAxis, zAxis);
}

/** A quaternion at unit length; the zero quaternion normalizes to the identity. */
function normalizeQuat(q: Quat): Quat {
  const len = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
  if (!(len > 0)) return { x: 0, y: 0, z: 0, w: 1 };
  return { x: q.x / len, y: q.y / len, z: q.z / len, w: q.w / len };
}

/**
 * The rotation whose matrix has these three unit, mutually perpendicular vectors
 * as its columns — three's `Quaternion.setFromRotationMatrix`.
 *
 * The four branches are not four cases of the geometry but four ways of reading
 * the same quaternion off the matrix: each recovers one component from a square
 * root and the other three by division, and the branch taken is the one whose
 * divisor is largest, which is what keeps the extraction accurate near the poses
 * where a naive trace formula loses its precision.
 */
function quatFromBasis(xAxis: Vec3, yAxis: Vec3, zAxis: Vec3): Quat {
  const m11 = xAxis.x;
  const m21 = xAxis.y;
  const m31 = xAxis.z;
  const m12 = yAxis.x;
  const m22 = yAxis.y;
  const m32 = yAxis.z;
  const m13 = zAxis.x;
  const m23 = zAxis.y;
  const m33 = zAxis.z;

  const trace = m11 + m22 + m33;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    return {
      x: (m32 - m23) * s,
      y: (m13 - m31) * s,
      z: (m21 - m12) * s,
      w: 0.25 / s,
    };
  }
  if (m11 > m22 && m11 > m33) {
    const s = 2 * Math.sqrt(1 + m11 - m22 - m33);
    return {
      x: 0.25 * s,
      y: (m12 + m21) / s,
      z: (m13 + m31) / s,
      w: (m32 - m23) / s,
    };
  }
  if (m22 > m33) {
    const s = 2 * Math.sqrt(1 + m22 - m11 - m33);
    return {
      x: (m12 + m21) / s,
      y: 0.25 * s,
      z: (m23 + m32) / s,
      w: (m13 - m31) / s,
    };
  }
  const s = 2 * Math.sqrt(1 + m33 - m11 - m22);
  return {
    x: (m13 + m31) / s,
    y: (m23 + m32) / s,
    z: 0.25 * s,
    w: (m21 - m12) / s,
  };
}

/* -------------------------------------------------------------------------- */
/* Transform helpers                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The transform of `child` placed inside `parent`.
 *
 * This is the composition a component's `worldTransform()` performs, with the
 * actor's transform as `parent` and the component's `offset` as `child`:
 * `position` is `transformPoint(parent, child.position)`, `rotation` is
 * `quatMultiply(parent.rotation, child.rotation)`, and `scale` is the
 * per-component product of the two scales.
 *
 * Carrying scale per component rather than as a matrix is what keeps a transform
 * a transform: it makes the composition exact under a uniform parent scale, and
 * under a non-uniform one it treats the parent's scale as acting along the
 * child's own axes. A general matrix composition of a non-uniform scale with a
 * rotation is a shear, which a position/rotation/scale record cannot hold, so
 * something has to give; taking the axis-wise product keeps the result a record
 * a game can read fields off and keeps a rotated child unsheared, at the cost of
 * a stretch measured in the child's frame rather than the parent's. Uniform
 * scales — the overwhelming majority of what a game writes — are unaffected.
 *
 * Every record in the result is fresh, including the three nested vectors, so a
 * caller may write into what it gets back.
 */
export function composeTransforms(
  parent: Transform,
  child: Transform,
): Transform {
  return {
    position: transformPoint(parent, child.position),
    rotation: quatMultiply(parent.rotation, child.rotation),
    scale: {
      x: parent.scale.x * child.scale.x,
      y: parent.scale.y * child.scale.y,
      z: parent.scale.z * child.scale.z,
    },
  };
}

/**
 * `p` scaled by `t.scale` per component, then rotated by `t.rotation`, then
 * translated by `t.position`.
 *
 * Scale, then rotate, then translate is the order three's `Matrix4.compose`
 * builds a matrix in, and it is the only order that means what a game expects:
 * scaling after the rotation would stretch along the world's axes rather than
 * the object's, and translating before either would scale and spin the offset
 * itself.
 */
export function transformPoint(t: Transform, p: Vec3): Vec3 {
  const scaled = {
    x: p.x * t.scale.x,
    y: p.y * t.scale.y,
    z: p.z * t.scale.z,
  };
  const rotated = quatRotate(t.rotation, scaled);
  return {
    x: rotated.x + t.position.x,
    y: rotated.y + t.position.y,
    z: rotated.z + t.position.z,
  };
}

/**
 * The column-major matrix three's `Matrix4.compose(position, quaternion, scale)`
 * builds from the same three parts, as sixteen numbers.
 *
 * Sixteen numbers rather than a `THREE.Matrix4` so that `worldMatrix()` is a
 * value with no library object behind it: a validator can read entries `12..14`
 * for the world position without importing three, and a build that wants the
 * class writes `new THREE.Matrix4().fromArray(m)`. Applying the matrix to a
 * point gives {@link transformPoint} of the same transform.
 */
export function transformToMatrix(t: Transform): Mat4 {
  const { x, y, z, w } = t.rotation;
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;
  const sx = t.scale.x;
  const sy = t.scale.y;
  const sz = t.scale.z;

  return [
    (1 - (yy + zz)) * sx,
    (xy + wz) * sx,
    (xz - wy) * sx,
    0,
    (xy - wz) * sy,
    (1 - (xx + zz)) * sy,
    (yz + wx) * sy,
    0,
    (xz + wy) * sz,
    (yz - wx) * sz,
    (1 - (xx + yy)) * sz,
    0,
    t.position.x,
    t.position.y,
    t.position.z,
    1,
  ];
}
