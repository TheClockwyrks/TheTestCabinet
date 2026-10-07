import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { Quat, Transform, Vec3 } from "./contract";
import {
  FORWARD,
  QUAT_IDENTITY,
  RIGHT,
  UP,
  VEC3_ONE,
  VEC3_ZERO,
  add,
  composeTransforms,
  cross,
  distance,
  dot,
  length,
  lerp,
  normalize,
  quat,
  quatFromAxisAngle,
  quatFromEuler,
  quatInverse,
  quatLookAt,
  quatMultiply,
  quatRotate,
  quatSlerp,
  quatToEuler,
  scale,
  sub,
  transformPoint,
  transformToMatrix,
  vec3,
} from "./math";

/*
 * The algebra is checked three ways, because each catches a different mistake:
 *
 * 1. **Against the documented value**, for everything the API page states outright
 *    — the constants, the composition order, the ranges, the degenerate answers.
 * 2. **Against three**, for every helper the module's header claims is three's own
 *    formula. A sign flipped in a quaternion product is invisible in isolation and
 *    obvious the moment the same rotation is asked of `THREE.Quaternion`; and the
 *    engine hands these values to three, so agreement is the property that matters
 *    rather than a private notion of correctness.
 * 3. **Against the algebraic identities**, which pin the behavior between the
 *    sampled points: a rotation composed with its inverse is the identity, a
 *    product applied to a vector is the two rotations applied in turn, a matrix
 *    applied to a point is `transformPoint` of the same transform.
 */

/** A tolerance for values that pass through a square root or a trig function. */
const PRECISE = 12;

/** Assert a vector component-wise. */
function expectVec3(actual: Vec3, expected: Vec3, digits = PRECISE): void {
  expect(actual.x).toBeCloseTo(expected.x, digits);
  expect(actual.y).toBeCloseTo(expected.y, digits);
  expect(actual.z).toBeCloseTo(expected.z, digits);
}

/** Assert a quaternion component-wise, as written. */
function expectQuat(actual: Quat, expected: Quat, digits = PRECISE): void {
  expect(actual.x).toBeCloseTo(expected.x, digits);
  expect(actual.y).toBeCloseTo(expected.y, digits);
  expect(actual.z).toBeCloseTo(expected.z, digits);
  expect(actual.w).toBeCloseTo(expected.w, digits);
}

/**
 * Assert two quaternions name the same *rotation*.
 *
 * `q` and `-q` turn every vector identically, so a helper is free to return
 * either, and `quatSlerp` in particular returns the negated form whenever it took
 * the short way round. Comparing the rotation rather than the components is what
 * keeps a test from pinning a sign the specification never fixed.
 */
function expectSameRotation(actual: Quat, expected: Quat, digits = 10): void {
  const aligned =
    dotQuat(actual, expected) < 0
      ? quat(-expected.x, -expected.y, -expected.z, -expected.w)
      : expected;
  expectQuat(actual, aligned, digits);
}

function dotQuat(a: Quat, b: Quat): number {
  return a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
}

/** The length of a quaternion, which every computed one should report as `1`. */
function quatLength(q: Quat): number {
  return Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
}

const toThree = (q: Quat): THREE.Quaternion =>
  new THREE.Quaternion(q.x, q.y, q.z, q.w);
const fromThree = (q: THREE.Quaternion): Quat => quat(q.x, q.y, q.z, q.w);
const toThreeVec = (v: Vec3): THREE.Vector3 => new THREE.Vector3(v.x, v.y, v.z);
const fromThreeVec = (v: THREE.Vector3): Vec3 => vec3(v.x, v.y, v.z);

/**
 * A spread of Euler triples covering the ordinary poses and both poles.
 *
 * The pole entries — pitch at exactly ±π/2 — are the cases the YXZ decomposition
 * is singular at, and they arrive in a real game the moment a camera looks
 * straight down.
 */
const EULER_SAMPLES: readonly (readonly [number, number, number])[] = [
  [0, 0, 0],
  [0, Math.PI / 2, 0],
  [0, -Math.PI / 2, 0],
  [0.3, 0.7, -1.2],
  [-1.1, 2.4, 0.9],
  [0.001, -0.002, 0.003],
  [Math.PI / 2, 0.3, 0.2],
  [-Math.PI / 2, -0.4, 1.1],
  [1.5, 3.0, -2.8],
];

/** Directions to look along, including the two parallel to the default `up`. */
const DIRECTION_SAMPLES: readonly Vec3[] = [
  vec3(0, 0, -1),
  vec3(0, 0, 1),
  vec3(1, 0, 0),
  vec3(-1, 0, 0),
  vec3(1, 2, 3),
  vec3(-4, 0.5, 2),
  vec3(0.2, -3, -0.1),
  vec3(0, 1, 0),
  vec3(0, -1, 0),
];

/** A transform with every part distinct, so an order mistake cannot cancel out. */
function sampleTransform(): Transform {
  return {
    position: vec3(3, -1, 4),
    rotation: quatFromEuler(0.4, -0.9, 1.3),
    scale: vec3(2, 0.5, 3),
  };
}

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

describe("the constants", () => {
  it("hold the documented values", () => {
    expect(VEC3_ZERO).toEqual({ x: 0, y: 0, z: 0 });
    expect(VEC3_ONE).toEqual({ x: 1, y: 1, z: 1 });
    expect(UP).toEqual({ x: 0, y: 1, z: 0 });
    expect(FORWARD).toEqual({ x: 0, y: 0, z: -1 });
    expect(RIGHT).toEqual({ x: 1, y: 0, z: 0 });
    expect(QUAT_IDENTITY).toEqual({ x: 0, y: 0, z: 0, w: 1 });
  });

  it("are frozen, so one reader cannot retune them for every other", () => {
    for (const constant of [VEC3_ZERO, VEC3_ONE, UP, FORWARD, RIGHT]) {
      expect(Object.isFrozen(constant)).toBe(true);
    }
    expect(Object.isFrozen(QUAT_IDENTITY)).toBe(true);
  });

  it("throw on a write, rather than accepting it silently", () => {
    expect(() => {
      (UP as { y: number }).y = 2;
    }).toThrow(TypeError);
    expect(UP.y).toBe(1);
  });

  it("describe a right-handed world with -Z forward", () => {
    // The basis is right-handed: X × Y is the axis pointing back out of the
    // screen, which is the negation of the direction an actor faces.
    expectVec3(cross(RIGHT, UP), vec3(0, 0, 1));
    expectVec3(cross(UP, RIGHT), FORWARD);
    expect(dot(FORWARD, UP)).toBe(0);
    expect(dot(FORWARD, RIGHT)).toBe(0);
  });

  it("are unit length where they name a direction", () => {
    expect(length(UP)).toBe(1);
    expect(length(FORWARD)).toBe(1);
    expect(length(RIGHT)).toBe(1);
    expect(quatLength(QUAT_IDENTITY)).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Vector helpers                                                             */
/* -------------------------------------------------------------------------- */

describe("vec3", () => {
  it("returns a fresh, mutable record of its three arguments", () => {
    const v = vec3(1, 2, 3);
    expect(v).toEqual({ x: 1, y: 2, z: 3 });
    v.x = 9;
    expect(v.x).toBe(9);
  });

  it("is a distinct record on every call, so a field written later is private", () => {
    expect(vec3(0, 0, 0)).not.toBe(vec3(0, 0, 0));
    expect(vec3(0, 0, 0)).not.toBe(VEC3_ZERO);
  });
});

describe("add, sub and scale", () => {
  it("work per component", () => {
    expectVec3(add(vec3(1, 2, 3), vec3(10, 20, 30)), vec3(11, 22, 33));
    expectVec3(sub(vec3(1, 2, 3), vec3(10, 20, 30)), vec3(-9, -18, -27));
    expectVec3(scale(vec3(1, -2, 3), 2.5), vec3(2.5, -5, 7.5));
  });

  it("leave both arguments untouched", () => {
    const a = vec3(1, 2, 3);
    const b = vec3(4, 5, 6);
    add(a, b);
    sub(a, b);
    scale(a, 7);
    expect(a).toEqual({ x: 1, y: 2, z: 3 });
    expect(b).toEqual({ x: 4, y: 5, z: 6 });
  });

  it("return a record neither argument shares", () => {
    const a = vec3(1, 2, 3);
    const sum = add(a, VEC3_ZERO);
    expect(sum).not.toBe(a);
    expect(sum).toEqual(a);
  });

  it("negate through a scale of -1 and cancel under addition", () => {
    const v = vec3(3, -4, 5);
    expectVec3(add(v, scale(v, -1)), VEC3_ZERO);
    expectVec3(sub(v, v), VEC3_ZERO);
  });

  it("scales by zero to the origin and by one to a copy", () => {
    expectVec3(scale(vec3(3, -4, 5), 0), VEC3_ZERO);
    expectVec3(scale(vec3(3, -4, 5), 1), vec3(3, -4, 5));
  });

  it("steps a position by a velocity, as a game's tick does", () => {
    const position = vec3(0, 0, 0);
    const velocity = vec3(6, 0, -3);
    const stepped = add(position, scale(velocity, 0.5));
    expectVec3(stepped, vec3(3, 0, -1.5));
    expect(position).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe("dot and cross", () => {
  it("compute the dot product", () => {
    expect(dot(vec3(1, 2, 3), vec3(4, -5, 6))).toBe(4 - 10 + 18);
    expect(dot(UP, UP)).toBe(1);
  });

  it("reports zero for perpendicular vectors and the square of the length for one with itself", () => {
    expect(dot(RIGHT, UP)).toBe(0);
    expect(dot(vec3(3, 4, 12), vec3(3, 4, 12))).toBe(169);
  });

  it("computes the right-handed cross product", () => {
    expectVec3(cross(vec3(1, 0, 0), vec3(0, 1, 0)), vec3(0, 0, 1));
    expectVec3(cross(vec3(0, 1, 0), vec3(0, 0, 1)), vec3(1, 0, 0));
    expectVec3(cross(vec3(0, 0, 1), vec3(1, 0, 0)), vec3(0, 1, 0));
  });

  it("anticommutes, and vanishes on a parallel pair", () => {
    const a = vec3(1, 2, 3);
    const b = vec3(-4, 5, 6);
    expectVec3(cross(a, b), scale(cross(b, a), -1));
    expectVec3(cross(a, a), VEC3_ZERO);
    expectVec3(cross(a, scale(a, 3)), VEC3_ZERO);
  });

  it("produces a vector perpendicular to both arguments", () => {
    const a = vec3(1, 2, 3);
    const b = vec3(-4, 5, 6);
    const c = cross(a, b);
    expect(dot(c, a)).toBeCloseTo(0, PRECISE);
    expect(dot(c, b)).toBeCloseTo(0, PRECISE);
  });

  it("agrees with three", () => {
    const a = vec3(1.5, -2.25, 0.75);
    const b = vec3(-0.5, 4, 3.25);
    const expected = new THREE.Vector3()
      .copy(toThreeVec(a))
      .cross(toThreeVec(b));
    expectVec3(cross(a, b), fromThreeVec(expected));
    expect(dot(a, b)).toBeCloseTo(toThreeVec(a).dot(toThreeVec(b)), PRECISE);
  });

  it("leaves both arguments untouched", () => {
    const a = vec3(1, 2, 3);
    const b = vec3(4, 5, 6);
    cross(a, b);
    dot(a, b);
    expect(a).toEqual({ x: 1, y: 2, z: 3 });
    expect(b).toEqual({ x: 4, y: 5, z: 6 });
  });
});

describe("length, normalize and distance", () => {
  it("measures the Euclidean length", () => {
    expect(length(vec3(3, 4, 0))).toBe(5);
    expect(length(vec3(0, 0, 0))).toBe(0);
    expect(length(vec3(1, 1, 1))).toBeCloseTo(Math.sqrt(3), PRECISE);
  });

  it("normalizes to unit length along the same direction", () => {
    const v = vec3(0, 0, -4);
    const n = normalize(v);
    expectVec3(n, FORWARD);
    expect(length(n)).toBeCloseTo(1, PRECISE);
    expect(length(normalize(vec3(1, 2, 3)))).toBeCloseTo(1, PRECISE);
  });

  it("leaves an already-unit vector where it is", () => {
    expectVec3(normalize(UP), UP);
    expectVec3(normalize(FORWARD), FORWARD);
  });

  it("normalizes the zero vector to the zero vector, not to NaN", () => {
    const n = normalize(vec3(0, 0, 0));
    expect(n).toEqual({ x: 0, y: 0, z: 0 });
    expect(Number.isNaN(n.x)).toBe(false);
  });

  it("returns a fresh zero rather than the shared constant", () => {
    const n = normalize(vec3(0, 0, 0));
    expect(n).not.toBe(VEC3_ZERO);
    expect(Object.isFrozen(n)).toBe(false);
  });

  it("collapses a non-finite vector to zero rather than propagating it", () => {
    expect(normalize(vec3(Number.NaN, 0, 0))).toEqual({ x: 0, y: 0, z: 0 });
    expect(normalize(vec3(Number.POSITIVE_INFINITY, 1, 0))).toEqual({
      x: 0,
      y: 0,
      z: 0,
    });
  });

  it("measures distance as the length of the difference", () => {
    const a = vec3(1, 2, 3);
    const b = vec3(4, 6, 3);
    expect(distance(a, b)).toBe(5);
    expect(distance(a, b)).toBe(length(sub(b, a)));
  });

  it("makes distance symmetric and zero on a point with itself", () => {
    const a = vec3(-2, 7, 0.5);
    const b = vec3(3, -1, 2);
    expect(distance(a, b)).toBeCloseTo(distance(b, a), PRECISE);
    expect(distance(a, a)).toBe(0);
  });

  it("agrees with three on length and normalization", () => {
    const v = vec3(-3.5, 2, 7.25);
    expect(length(v)).toBeCloseTo(toThreeVec(v).length(), PRECISE);
    expectVec3(normalize(v), fromThreeVec(toThreeVec(v).normalize()));
  });

  it("leaves its argument untouched", () => {
    const v = vec3(3, 4, 0);
    normalize(v);
    length(v);
    expect(v).toEqual({ x: 3, y: 4, z: 0 });
  });
});

describe("lerp", () => {
  it("returns the endpoints at 0 and 1", () => {
    const a = vec3(1, 2, 3);
    const b = vec3(-4, 0, 8);
    expectVec3(lerp(a, b, 0), a);
    expectVec3(lerp(a, b, 1), b);
  });

  it("interpolates per component", () => {
    expectVec3(lerp(vec3(0, 0, 0), vec3(10, -20, 4), 0.25), vec3(2.5, -5, 1));
  });

  it("is unclamped in both directions", () => {
    const a = vec3(0, 0, 0);
    const b = vec3(2, 4, 6);
    expectVec3(lerp(a, b, 2), vec3(4, 8, 12));
    expectVec3(lerp(a, b, -1), vec3(-2, -4, -6));
  });

  it("returns a fresh record at either endpoint", () => {
    const a = vec3(1, 2, 3);
    const b = vec3(4, 5, 6);
    expect(lerp(a, b, 0)).not.toBe(a);
    expect(lerp(a, b, 1)).not.toBe(b);
  });

  it("leaves both endpoints untouched", () => {
    const a = vec3(1, 2, 3);
    const b = vec3(4, 5, 6);
    lerp(a, b, 0.5);
    expect(a).toEqual({ x: 1, y: 2, z: 3 });
    expect(b).toEqual({ x: 4, y: 5, z: 6 });
  });
});

/* -------------------------------------------------------------------------- */
/* Quaternion helpers                                                         */
/* -------------------------------------------------------------------------- */

describe("quat", () => {
  it("returns its four components as written", () => {
    expect(quat(1, 2, 3, 4)).toEqual({ x: 1, y: 2, z: 3, w: 4 });
  });

  it("is a fresh, mutable record", () => {
    const q = quat(0, 0, 0, 1);
    expect(q).not.toBe(QUAT_IDENTITY);
    q.w = 0.5;
    expect(q.w).toBe(0.5);
  });
});

describe("quatFromEuler", () => {
  it("returns the identity for a zero triple", () => {
    expectQuat(quatFromEuler(0, 0, 0), QUAT_IDENTITY);
  });

  it("is the documented product of the three axis rotations, in YXZ order", () => {
    for (const [x, y, z] of EULER_SAMPLES) {
      const qy = quatFromAxisAngle(UP, y);
      const qx = quatFromAxisAngle(RIGHT, x);
      const qz = quatFromAxisAngle(vec3(0, 0, 1), z);
      const composed = quatMultiply(quatMultiply(qy, qx), qz);
      expectSameRotation(quatFromEuler(x, y, z), composed);
    }
  });

  it("is three's Euler order YXZ", () => {
    for (const [x, y, z] of EULER_SAMPLES) {
      const expected = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(x, y, z, "YXZ"),
      );
      expectQuat(quatFromEuler(x, y, z), fromThree(expected));
    }
  });

  it("returns a unit quaternion for every triple", () => {
    for (const [x, y, z] of EULER_SAMPLES) {
      expect(quatLength(quatFromEuler(x, y, z))).toBeCloseTo(1, PRECISE);
    }
  });

  it("turns a yaw alone about the world's up axis", () => {
    const q = quatFromEuler(0, Math.PI / 2, 0);
    expectVec3(quatRotate(q, FORWARD), vec3(-1, 0, 0));
    expectVec3(quatRotate(q, UP), UP);
  });

  it("keeps yaw outermost, so a pitched body still yaws about world up", () => {
    const pitched = quatFromEuler(0.6, 0, 0);
    const yawed = quatFromEuler(0.6, Math.PI / 2, 0);
    // Yaw applied on the left of the pitch is the same rotation the triple names.
    expectSameRotation(
      yawed,
      quatMultiply(quatFromAxisAngle(UP, Math.PI / 2), pitched),
    );
  });
});

describe("quatToEuler", () => {
  it("returns the zero triple for the identity", () => {
    expectVec3(quatToEuler(QUAT_IDENTITY), VEC3_ZERO);
  });

  it("round-trips through quatFromEuler as the same rotation", () => {
    for (const [x, y, z] of EULER_SAMPLES) {
      const q = quatFromEuler(x, y, z);
      const e = quatToEuler(q);
      // Seven digits rather than the usual twelve because the samples include
      // both poles, where the arcsine that recovers pitch has an unbounded
      // derivative and a rotation is only recoverable to about eight digits.
      expectSameRotation(quatFromEuler(e.x, e.y, e.z), q, 7);
    }
  });

  it("recovers an ordinary triple exactly", () => {
    const e = quatToEuler(quatFromEuler(0.3, 0.7, -1.2));
    expectVec3(e, vec3(0.3, 0.7, -1.2));
  });

  it("keeps pitch inside -π/2..π/2", () => {
    for (const [x, y, z] of EULER_SAMPLES) {
      const pitch = quatToEuler(quatFromEuler(x, y, z)).x;
      expect(pitch).toBeGreaterThanOrEqual(-Math.PI / 2 - 1e-12);
      expect(pitch).toBeLessThanOrEqual(Math.PI / 2 + 1e-12);
    }
    // A pitch past the quarter turn is renamed rather than reported out of range.
    const beyond = quatToEuler(quatFromEuler(2.5, 0, 0));
    expect(Math.abs(beyond.x)).toBeLessThanOrEqual(Math.PI / 2 + 1e-12);
    expectSameRotation(
      quatFromEuler(beyond.x, beyond.y, beyond.z),
      quatFromEuler(2.5, 0, 0),
    );
  });

  it("reports roll as zero at the poles and folds the turn into yaw", () => {
    for (const pitch of [Math.PI / 2, -Math.PI / 2]) {
      const q = quatFromEuler(pitch, 0.3, 0.2);
      const e = quatToEuler(q);
      expect(e.x).toBeCloseTo(pitch, 6);
      expect(e.z).toBe(0);
      expectSameRotation(quatFromEuler(e.x, e.y, e.z), q, 6);
    }
  });

  it("still yields a usable heading looking straight down", () => {
    // A camera pitched fully down, yawed a quarter turn: the yaw survives the
    // singular decomposition even though roll and yaw share an axis there.
    const q = quatFromEuler(-Math.PI / 2, Math.PI / 2, 0);
    const e = quatToEuler(q);
    expect(Number.isNaN(e.y)).toBe(false);
    expectSameRotation(quatFromEuler(e.x, e.y, e.z), q, 6);
  });

  it("agrees with three's Euler extraction in YXZ", () => {
    for (const [x, y, z] of EULER_SAMPLES) {
      const q = quatFromEuler(x, y, z);
      const expected = new THREE.Euler().setFromQuaternion(toThree(q), "YXZ");
      const e = quatToEuler(q);
      expect(e.x).toBeCloseTo(expected.x, PRECISE);
      expect(e.y).toBeCloseTo(expected.y, PRECISE);
      expect(e.z).toBeCloseTo(expected.z, PRECISE);
    }
  });

  it("reads a heading back out of a yaw", () => {
    for (const yaw of [0, 0.5, -1.25, 3]) {
      expect(quatToEuler(quatFromEuler(0, yaw, 0)).y).toBeCloseTo(yaw, PRECISE);
    }
  });

  it("leaves its argument untouched", () => {
    const q = quatFromEuler(0.3, 0.7, -1.2);
    const before = { ...q };
    quatToEuler(q);
    expect(q).toEqual(before);
  });
});

describe("quatFromAxisAngle", () => {
  it("returns the identity for a zero angle", () => {
    expectQuat(quatFromAxisAngle(UP, 0), QUAT_IDENTITY);
  });

  it("turns counterclockwise looking down the axis toward the origin", () => {
    // Right-handed about +Y: +X goes to -Z.
    expectVec3(quatRotate(quatFromAxisAngle(UP, Math.PI / 2), RIGHT), FORWARD);
  });

  it("leaves its own axis fixed", () => {
    const axis = normalize(vec3(1, 2, -2));
    const q = quatFromAxisAngle(axis, 1.1);
    expectVec3(quatRotate(q, axis), axis);
  });

  it("is the same rotation as the matching yaw", () => {
    expectSameRotation(quatFromAxisAngle(UP, 0.8), quatFromEuler(0, 0.8, 0));
  });

  it("normalizes a non-unit axis, so the result stays unit length", () => {
    const scaled = quatFromAxisAngle(vec3(0, 7, 0), 0.8);
    expectQuat(scaled, quatFromAxisAngle(UP, 0.8));
    expect(quatLength(scaled)).toBeCloseTo(1, PRECISE);
  });

  it("yields the identity for a zero axis, which names no rotation", () => {
    expectQuat(quatFromAxisAngle(VEC3_ZERO, 1.3), QUAT_IDENTITY);
    expectQuat(quatFromAxisAngle(vec3(0, 0, 0), 0), QUAT_IDENTITY);
  });

  it("agrees with three for a unit axis", () => {
    const axis = normalize(vec3(-1, 3, 2));
    for (const angle of [0.3, -1.7, Math.PI, 2 * Math.PI]) {
      const expected = new THREE.Quaternion().setFromAxisAngle(
        toThreeVec(axis),
        angle,
      );
      expectQuat(quatFromAxisAngle(axis, angle), fromThree(expected));
    }
  });

  it("leaves its axis untouched", () => {
    const axis = vec3(0, 7, 0);
    quatFromAxisAngle(axis, 0.8);
    expect(axis).toEqual({ x: 0, y: 7, z: 0 });
  });
});

describe("quatMultiply", () => {
  it("is the identity on either side", () => {
    const q = quatFromEuler(0.3, -0.9, 1.2);
    expectQuat(quatMultiply(QUAT_IDENTITY, q), q);
    expectQuat(quatMultiply(q, QUAT_IDENTITY), q);
  });

  it("applies b first and a second", () => {
    const a = quatFromEuler(0.4, 0, 0);
    const b = quatFromEuler(0, 1.1, 0);
    const v = vec3(1, 2, -3);
    expectVec3(
      quatRotate(quatMultiply(a, b), v),
      quatRotate(a, quatRotate(b, v)),
    );
  });

  it("does not commute, which is the whole point of the left/right rule", () => {
    const a = quatFromEuler(0.4, 0, 0);
    const b = quatFromEuler(0, 1.1, 0);
    const ab = quatMultiply(a, b);
    const ba = quatMultiply(b, a);
    expect(Math.abs(dotQuat(ab, ba))).toBeLessThan(0.999);
  });

  it("adds a world-axis turn on the left and a body-axis turn on the right", () => {
    // A ship pitched nose-up, then yawed. On the left the yaw is about world up,
    // so the nose stays up; on the right it is about the ship's own up, which
    // after the pitch is not the world's.
    const pitched = quatFromAxisAngle(RIGHT, Math.PI / 4);
    const yaw = quatFromAxisAngle(UP, Math.PI / 2);
    const worldYaw = quatRotate(quatMultiply(yaw, pitched), FORWARD);
    const bodyYaw = quatRotate(quatMultiply(pitched, yaw), FORWARD);
    expect(worldYaw.y).toBeCloseTo(Math.sin(Math.PI / 4), PRECISE);
    expect(bodyYaw.y).toBeCloseTo(0, PRECISE);
  });

  it("stays unit length under a long chain", () => {
    let q = QUAT_IDENTITY;
    for (let i = 0; i < 200; i += 1) {
      q = quatMultiply(quatFromAxisAngle(normalize(vec3(1, i % 3, 2)), 0.1), q);
    }
    expect(quatLength(q)).toBeCloseTo(1, 10);
  });

  it("agrees with three's Quaternion.multiply", () => {
    const a = quatFromEuler(0.4, -0.9, 1.3);
    const b = quatFromEuler(-1.1, 0.2, 0.6);
    const expected = toThree(a).multiply(toThree(b));
    expectQuat(quatMultiply(a, b), fromThree(expected));
  });

  it("leaves both arguments untouched", () => {
    const a = quatFromEuler(0.4, -0.9, 1.3);
    const b = quatFromEuler(-1.1, 0.2, 0.6);
    const beforeA = { ...a };
    const beforeB = { ...b };
    quatMultiply(a, b);
    expect(a).toEqual(beforeA);
    expect(b).toEqual(beforeB);
  });
});

describe("quatInverse", () => {
  it("is the conjugate of a unit quaternion", () => {
    const q = quatFromEuler(0.4, -0.9, 1.3);
    expectQuat(quatInverse(q), quat(-q.x, -q.y, -q.z, q.w));
  });

  it("composes with its quaternion to the identity, either way round", () => {
    const q = quatFromEuler(0.4, -0.9, 1.3);
    expectSameRotation(quatMultiply(q, quatInverse(q)), QUAT_IDENTITY);
    expectSameRotation(quatMultiply(quatInverse(q), q), QUAT_IDENTITY);
  });

  it("undoes the rotation it inverts", () => {
    const q = quatFromEuler(1.2, 0.3, -0.8);
    const v = vec3(2, -1, 5);
    expectVec3(quatRotate(quatInverse(q), quatRotate(q, v)), v);
  });

  it("inverts the identity to the identity", () => {
    expectQuat(quatInverse(QUAT_IDENTITY), QUAT_IDENTITY);
  });

  it("returns a unit quaternion even for a drifted one", () => {
    const drifted = quat(0.2, 0.4, 0.4, 0.8);
    const inverse = quatInverse(drifted);
    expect(quatLength(inverse)).toBeCloseTo(1, PRECISE);
    // And it is a true inverse: the round trip returns the vector.
    const v = vec3(1, 2, 3);
    const forward = quatRotate(normalizeForTest(drifted), v);
    expectVec3(quatRotate(inverse, forward), v);
  });

  it("yields the identity for a zero quaternion", () => {
    expectQuat(quatInverse(quat(0, 0, 0, 0)), QUAT_IDENTITY);
  });

  it("leaves its argument untouched", () => {
    const q = quatFromEuler(0.4, -0.9, 1.3);
    const before = { ...q };
    quatInverse(q);
    expect(q).toEqual(before);
  });
});

/** A unit-length copy, for the one test that starts from a drifted quaternion. */
function normalizeForTest(q: Quat): Quat {
  const len = quatLength(q);
  return quat(q.x / len, q.y / len, q.z / len, q.w / len);
}

describe("quatRotate", () => {
  it("leaves a vector alone under the identity", () => {
    const v = vec3(1, -2, 3);
    expectVec3(quatRotate(QUAT_IDENTITY, v), v);
  });

  it("preserves length and angles", () => {
    const q = quatFromEuler(0.7, -1.4, 0.2);
    const a = vec3(1, 2, 3);
    const b = vec3(-4, 0.5, 2);
    expect(length(quatRotate(q, a))).toBeCloseTo(length(a), PRECISE);
    expect(dot(quatRotate(q, a), quatRotate(q, b))).toBeCloseTo(
      dot(a, b),
      PRECISE,
    );
  });

  it("turns the forward axis into the actor's heading", () => {
    const heading = quatRotate(quatFromEuler(0, Math.PI, 0), FORWARD);
    expectVec3(heading, vec3(0, 0, 1));
  });

  it("agrees with three's applyQuaternion", () => {
    const q = quatFromEuler(0.7, -1.4, 0.2);
    const v = vec3(1.5, -2.5, 4);
    const expected = toThreeVec(v).applyQuaternion(toThree(q));
    expectVec3(quatRotate(q, v), fromThreeVec(expected));
  });

  it("agrees with the matrix the same rotation composes", () => {
    const q = quatFromEuler(0.7, -1.4, 0.2);
    const v = vec3(1.5, -2.5, 4);
    const matrix = transformToMatrix({
      position: VEC3_ZERO,
      rotation: q,
      scale: VEC3_ONE,
    });
    const expected = toThreeVec(v).applyMatrix4(
      new THREE.Matrix4().fromArray([...matrix]),
    );
    expectVec3(quatRotate(q, v), fromThreeVec(expected));
  });

  it("leaves both arguments untouched", () => {
    const q = quatFromEuler(0.7, -1.4, 0.2);
    const v = vec3(1, 2, 3);
    const beforeQ = { ...q };
    quatRotate(q, v);
    expect(q).toEqual(beforeQ);
    expect(v).toEqual({ x: 1, y: 2, z: 3 });
  });
});

describe("quatSlerp", () => {
  const a = quatFromEuler(0, 0, 0);
  const b = quatFromEuler(0, Math.PI / 2, 0);

  it("returns the endpoints at 0 and 1", () => {
    expectQuat(quatSlerp(a, b, 0), a);
    expectQuat(quatSlerp(a, b, 1), b);
  });

  it("returns fresh records at the endpoints", () => {
    expect(quatSlerp(a, b, 0)).not.toBe(a);
    expect(quatSlerp(a, b, 1)).not.toBe(b);
  });

  it("halves the angle at the midpoint", () => {
    expectSameRotation(quatSlerp(a, b, 0.5), quatFromEuler(0, Math.PI / 4, 0));
  });

  it("turns at a constant angular rate", () => {
    const angles = [0, 0.25, 0.5, 0.75, 1].map((t) =>
      angleBetween(a, quatSlerp(a, b, t)),
    );
    for (let i = 1; i < angles.length; i += 1) {
      expect(angles[i] ?? 0).toBeCloseTo((Math.PI / 2) * (i / 4), 10);
    }
  });

  it("takes the shorter arc when the components describe the longer one", () => {
    // A turn of 2π − 0.5 about up is a turn of −0.5 the short way; the midpoint
    // is therefore a quarter of a radian backwards, not most of a turn forwards.
    const long = quatFromAxisAngle(UP, 2 * Math.PI - 0.5);
    expect(dotQuat(QUAT_IDENTITY, long)).toBeLessThan(0);
    expectSameRotation(
      quatSlerp(QUAT_IDENTITY, long, 0.5),
      quatFromAxisAngle(UP, -0.25),
    );
  });

  it("returns the endpoint rotation at 1 even when the arc was flipped", () => {
    const long = quatFromAxisAngle(UP, 2 * Math.PI - 0.5);
    expectSameRotation(quatSlerp(QUAT_IDENTITY, long, 1), long);
  });

  it("stays unit length everywhere along the arc", () => {
    for (const t of [-0.5, 0, 0.1, 0.5, 0.9, 1, 1.5]) {
      expect(quatLength(quatSlerp(a, b, t))).toBeCloseTo(1, 10);
    }
  });

  it("holds still between two identical rotations", () => {
    const q = quatFromEuler(0.4, -0.9, 1.3);
    expectSameRotation(quatSlerp(q, q, 0.5), q);
    expect(quatLength(quatSlerp(q, q, 0.37))).toBeCloseTo(1, PRECISE);
  });

  it("falls back to a normalized blend for a vanishing half-angle", () => {
    const near = quatFromAxisAngle(UP, 1e-12);
    const mid = quatSlerp(QUAT_IDENTITY, near, 0.5);
    expect(quatLength(mid)).toBeCloseTo(1, PRECISE);
    expectSameRotation(mid, quatFromAxisAngle(UP, 5e-13), 10);
  });

  it("agrees with three's slerpQuaternions", () => {
    const from = quatFromEuler(0.4, -0.9, 1.3);
    const to = quatFromEuler(-1.1, 0.2, 0.6);
    for (const t of [0.1, 0.25, 0.5, 0.8]) {
      const expected = new THREE.Quaternion().slerpQuaternions(
        toThree(from),
        toThree(to),
        t,
      );
      expectQuat(quatSlerp(from, to, t), fromThree(expected));
    }
  });

  it("leaves both endpoints untouched", () => {
    const from = quatFromEuler(0.4, -0.9, 1.3);
    const to = quatFromEuler(-1.1, 0.2, 0.6);
    const beforeFrom = { ...from };
    const beforeTo = { ...to };
    quatSlerp(from, to, 0.5);
    expect(from).toEqual(beforeFrom);
    expect(to).toEqual(beforeTo);
  });
});

/** The angle of the rotation carrying `a` onto `b`, in radians. */
function angleBetween(a: Quat, b: Quat): number {
  const d = Math.min(1, Math.abs(dotQuat(a, b)));
  return 2 * Math.acos(d);
}

describe("quatLookAt", () => {
  it("returns the identity for the forward axis under the default up", () => {
    expectQuat(quatLookAt(FORWARD), QUAT_IDENTITY);
  });

  it("takes FORWARD onto the requested direction", () => {
    for (const direction of DIRECTION_SAMPLES) {
      const q = quatLookAt(direction);
      expectVec3(quatRotate(q, FORWARD), normalize(direction), 10);
    }
  });

  it("normalizes the direction, so its length does not matter", () => {
    const near = quatLookAt(vec3(1, 2, 3));
    const far = quatLookAt(vec3(100, 200, 300));
    expectQuat(near, far);
  });

  it("returns a unit quaternion for every direction, poles included", () => {
    for (const direction of DIRECTION_SAMPLES) {
      expect(quatLength(quatLookAt(direction))).toBeCloseTo(1, 10);
    }
  });

  it("rolls so its local up lies as near the reference up as it can", () => {
    for (const direction of [vec3(1, 2, 3), vec3(-4, 0.5, 2), RIGHT]) {
      const localUp = quatRotate(quatLookAt(direction), UP);
      // Perpendicular to the view, on the same side as up, and in the plane the
      // view direction and up span — which together fix the roll.
      expect(dot(localUp, normalize(direction))).toBeCloseTo(0, 10);
      expect(dot(localUp, UP)).toBeGreaterThan(0);
      expect(dot(localUp, cross(normalize(direction), UP))).toBeCloseTo(0, 10);
    }
  });

  it("honors a supplied up, which is what rolls a camera", () => {
    const rolled = quatLookAt(FORWARD, vec3(1, 0, 0));
    const localUp = quatRotate(rolled, UP);
    expectVec3(localUp, RIGHT, 10);
    expectVec3(quatRotate(rolled, FORWARD), FORWARD, 10);
  });

  it("still aims when the direction is parallel to up", () => {
    for (const direction of [UP, vec3(0, -1, 0)]) {
      const q = quatLookAt(direction);
      expect(quatLength(q)).toBeCloseTo(1, 10);
      expectVec3(quatRotate(q, FORWARD), normalize(direction), 10);
      expect(Number.isNaN(q.w)).toBe(false);
    }
  });

  it("is stable for a straight-down look, so an overhead camera does not jitter", () => {
    expectQuat(quatLookAt(vec3(0, -1, 0)), quatLookAt(vec3(0, -3, 0)));
  });

  it("falls back to the world up when the supplied up is degenerate", () => {
    const q = quatLookAt(vec3(1, 0, 0), VEC3_ZERO);
    expectQuat(q, quatLookAt(vec3(1, 0, 0)));
  });

  it("yields the identity for a zero direction", () => {
    expectQuat(quatLookAt(VEC3_ZERO), QUAT_IDENTITY);
    expectQuat(quatLookAt(vec3(0, 0, 0), vec3(1, 0, 0)), QUAT_IDENTITY);
  });

  it("agrees with three's lookAt away from the degenerate direction", () => {
    for (const direction of DIRECTION_SAMPLES.slice(0, 7)) {
      const matrix = new THREE.Matrix4().lookAt(
        new THREE.Vector3(0, 0, 0),
        toThreeVec(direction),
        toThreeVec(UP),
      );
      const expected = new THREE.Quaternion().setFromRotationMatrix(matrix);
      expectQuat(quatLookAt(direction), fromThree(expected), 10);
    }
  });

  it("leaves both arguments untouched", () => {
    const direction = vec3(1, 2, 3);
    const up = vec3(0, 1, 0);
    quatLookAt(direction, up);
    expect(direction).toEqual({ x: 1, y: 2, z: 3 });
    expect(up).toEqual({ x: 0, y: 1, z: 0 });
  });
});

/* -------------------------------------------------------------------------- */
/* Transform helpers                                                          */
/* -------------------------------------------------------------------------- */

describe("transformPoint", () => {
  it("leaves a point where it is under the identity transform", () => {
    const identity: Transform = {
      position: VEC3_ZERO,
      rotation: QUAT_IDENTITY,
      scale: VEC3_ONE,
    };
    expectVec3(transformPoint(identity, vec3(1, -2, 3)), vec3(1, -2, 3));
  });

  it("scales, then rotates, then translates", () => {
    // A quarter turn about up, so the scaled x lands on -z and the order shows.
    const t: Transform = {
      position: vec3(10, 0, 0),
      rotation: quatFromAxisAngle(UP, Math.PI / 2),
      scale: vec3(2, 1, 1),
    };
    expectVec3(transformPoint(t, vec3(1, 0, 0)), vec3(10, 0, -2));
  });

  it("scales along the transform's own axes, not the world's", () => {
    // Were the scale applied after the rotation, the stretched axis would be the
    // world's x and the result would be (0, 0, -1) scaled on the wrong axis.
    const t: Transform = {
      position: VEC3_ZERO,
      rotation: quatFromAxisAngle(UP, Math.PI / 2),
      scale: vec3(3, 1, 1),
    };
    expectVec3(transformPoint(t, vec3(0, 0, 1)), vec3(1, 0, 0));
    expectVec3(transformPoint(t, vec3(1, 0, 0)), vec3(0, 0, -3));
  });

  it("moves the origin to the transform's position", () => {
    const t = sampleTransform();
    expectVec3(transformPoint(t, VEC3_ZERO), t.position);
  });

  it("agrees with three's composed matrix", () => {
    const t = sampleTransform();
    const p = vec3(1.5, -2, 0.25);
    const matrix = new THREE.Matrix4().compose(
      toThreeVec(t.position),
      toThree(t.rotation),
      toThreeVec(t.scale),
    );
    const expected = toThreeVec(p).applyMatrix4(matrix);
    expectVec3(transformPoint(t, p), fromThreeVec(expected));
  });

  it("leaves the transform and the point untouched", () => {
    const t = sampleTransform();
    const before = JSON.stringify(t);
    const p = vec3(1, 2, 3);
    transformPoint(t, p);
    expect(JSON.stringify(t)).toBe(before);
    expect(p).toEqual({ x: 1, y: 2, z: 3 });
  });
});

describe("composeTransforms", () => {
  const identity: Transform = {
    position: VEC3_ZERO,
    rotation: QUAT_IDENTITY,
    scale: VEC3_ONE,
  };

  it("computes each part as documented", () => {
    const parent = sampleTransform();
    const child: Transform = {
      position: vec3(0, 1, -2),
      rotation: quatFromEuler(0, 0.5, 0),
      scale: vec3(1, 2, 0.5),
    };
    const composed = composeTransforms(parent, child);
    expectVec3(composed.position, transformPoint(parent, child.position));
    expectQuat(
      composed.rotation,
      quatMultiply(parent.rotation, child.rotation),
    );
    expectVec3(composed.scale, vec3(2, 1, 1.5));
  });

  it("returns the parent under an identity child", () => {
    const parent = sampleTransform();
    const composed = composeTransforms(parent, identity);
    expectVec3(composed.position, parent.position);
    expectQuat(composed.rotation, parent.rotation);
    expectVec3(composed.scale, parent.scale);
  });

  it("returns the child under an identity parent", () => {
    const child = sampleTransform();
    const composed = composeTransforms(identity, child);
    expectVec3(composed.position, child.position);
    expectQuat(composed.rotation, child.rotation);
    expectVec3(composed.scale, child.scale);
  });

  it("returns fresh records throughout, including the nested vectors", () => {
    const parent = sampleTransform();
    const child = sampleTransform();
    const composed = composeTransforms(parent, child);
    expect(composed.position).not.toBe(parent.position);
    expect(composed.position).not.toBe(child.position);
    expect(composed.rotation).not.toBe(parent.rotation);
    expect(composed.scale).not.toBe(parent.scale);
    composed.position.x = 99;
    expect(parent.position.x).toBe(3);
    expect(child.position.x).toBe(3);
  });

  it("is exact under a uniform parent scale", () => {
    const parent: Transform = {
      position: vec3(1, 2, 3),
      rotation: quatFromEuler(0.3, 0.7, -0.2),
      scale: vec3(2, 2, 2),
    };
    const child: Transform = {
      position: vec3(0, 0.5, -1),
      rotation: quatFromEuler(-0.4, 0.1, 0.9),
      scale: vec3(0.5, 0.5, 0.5),
    };
    const composed = composeTransforms(parent, child);
    const p = vec3(0.25, -1, 2);
    // Placing a point through the composition is placing it through the two in
    // turn, which is what makes a component's world transform trustworthy.
    expectVec3(
      transformPoint(composed, p),
      transformPoint(parent, transformPoint(child, p)),
    );
  });

  it("matches three's matrix product under a uniform parent scale", () => {
    const parent: Transform = {
      position: vec3(1, 2, 3),
      rotation: quatFromEuler(0.3, 0.7, -0.2),
      scale: vec3(2, 2, 2),
    };
    const child: Transform = {
      position: vec3(0, 0.5, -1),
      rotation: quatFromEuler(-0.4, 0.1, 0.9),
      scale: vec3(0.5, 1.5, 0.5),
    };
    const expected = new THREE.Matrix4()
      .compose(
        toThreeVec(parent.position),
        toThree(parent.rotation),
        toThreeVec(parent.scale),
      )
      .multiply(
        new THREE.Matrix4().compose(
          toThreeVec(child.position),
          toThree(child.rotation),
          toThreeVec(child.scale),
        ),
      );
    const matrix = new THREE.Matrix4().fromArray([
      ...transformToMatrix(composeTransforms(parent, child)),
    ]);
    for (let i = 0; i < 16; i += 1) {
      expect(matrix.elements[i] ?? 0).toBeCloseTo(
        expected.elements[i] ?? 0,
        10,
      );
    }
  });

  it("carries a non-uniform parent scale along the child's own axes", () => {
    const parent: Transform = {
      position: VEC3_ZERO,
      rotation: QUAT_IDENTITY,
      scale: vec3(3, 1, 1),
    };
    const child: Transform = {
      position: VEC3_ZERO,
      rotation: quatFromAxisAngle(UP, Math.PI / 2),
      scale: vec3(1, 1, 1),
    };
    // The per-component product keeps the record a record: the stretch stays on
    // the child's x rather than becoming the shear a matrix product would need.
    expectVec3(composeTransforms(parent, child).scale, vec3(3, 1, 1));
  });

  it("places a turret on a tank, as a component's world transform does", () => {
    const actor: Transform = {
      position: vec3(5, 0, 0),
      rotation: quatFromAxisAngle(UP, Math.PI / 2),
      scale: VEC3_ONE,
    };
    const offset: Transform = {
      position: vec3(0, 1, 0),
      rotation: QUAT_IDENTITY,
      scale: VEC3_ONE,
    };
    const world = composeTransforms(actor, offset);
    // The turret rides above the hull, and the hull's yaw does not move it off.
    expectVec3(world.position, vec3(5, 1, 0), 10);
    expectVec3(quatRotate(world.rotation, FORWARD), vec3(-1, 0, 0), 10);
  });

  it("leaves both transforms untouched", () => {
    const parent = sampleTransform();
    const child = sampleTransform();
    const beforeParent = JSON.stringify(parent);
    const beforeChild = JSON.stringify(child);
    composeTransforms(parent, child);
    expect(JSON.stringify(parent)).toBe(beforeParent);
    expect(JSON.stringify(child)).toBe(beforeChild);
  });
});

describe("transformToMatrix", () => {
  it("returns sixteen numbers with the homogeneous row and column three sets", () => {
    const m = transformToMatrix(sampleTransform());
    expect(m).toHaveLength(16);
    expect(m[3]).toBe(0);
    expect(m[7]).toBe(0);
    expect(m[11]).toBe(0);
    expect(m[15]).toBe(1);
  });

  it("is the identity matrix for the identity transform", () => {
    const m = transformToMatrix({
      position: VEC3_ZERO,
      rotation: QUAT_IDENTITY,
      scale: VEC3_ONE,
    });
    expect([...m]).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  });

  it("is column-major, so the translation is entries 12 to 14", () => {
    const t = sampleTransform();
    const m = transformToMatrix(t);
    expect(m[12]).toBe(t.position.x);
    expect(m[13]).toBe(t.position.y);
    expect(m[14]).toBe(t.position.z);
  });

  it("scales the basis columns by the matching scale factor", () => {
    const m = transformToMatrix({
      position: VEC3_ZERO,
      rotation: QUAT_IDENTITY,
      scale: vec3(2, 3, 4),
    });
    expect(m[0]).toBe(2);
    expect(m[5]).toBe(3);
    expect(m[10]).toBe(4);
  });

  it("is exactly three's Matrix4.compose", () => {
    for (const t of [
      sampleTransform(),
      {
        position: vec3(-2, 0.5, 7),
        rotation: quatFromEuler(-1.2, 0.4, 2.1),
        scale: vec3(1, 1, 1),
      },
    ]) {
      const expected = new THREE.Matrix4().compose(
        toThreeVec(t.position),
        toThree(t.rotation),
        toThreeVec(t.scale),
      );
      const m = transformToMatrix(t);
      for (let i = 0; i < 16; i += 1) {
        expect(m[i] ?? 0).toBeCloseTo(expected.elements[i] ?? 0, PRECISE);
      }
    }
  });

  it("reads back through three's fromArray", () => {
    const t = sampleTransform();
    const matrix = new THREE.Matrix4().fromArray([...transformToMatrix(t)]);
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const decomposed = new THREE.Vector3();
    matrix.decompose(position, rotation, decomposed);
    expectVec3(fromThreeVec(position), t.position, 10);
    expectSameRotation(fromThree(rotation), t.rotation);
    expectVec3(fromThreeVec(decomposed), t.scale, 10);
  });

  it("places a point exactly as transformPoint does", () => {
    const t = sampleTransform();
    const matrix = new THREE.Matrix4().fromArray([...transformToMatrix(t)]);
    for (const p of [VEC3_ZERO, vec3(1, 0, 0), vec3(-2.5, 3, 0.75)]) {
      const expected = toThreeVec(p).applyMatrix4(matrix);
      expectVec3(transformPoint(t, p), fromThreeVec(expected), 10);
    }
  });

  it("leaves its transform untouched", () => {
    const t = sampleTransform();
    const before = JSON.stringify(t);
    transformToMatrix(t);
    expect(JSON.stringify(t)).toBe(before);
  });
});

/* -------------------------------------------------------------------------- */
/* The module's standing promises                                             */
/* -------------------------------------------------------------------------- */

describe("purity", () => {
  it("accepts the frozen constants everywhere, which no mutating helper could", () => {
    // Every one of these would throw in strict mode if the helper wrote through
    // an argument, so this is the whole no-mutation claim in one assertion.
    expect(() => {
      add(VEC3_ZERO, UP);
      sub(UP, RIGHT);
      scale(FORWARD, 2);
      cross(UP, RIGHT);
      dot(UP, FORWARD);
      length(UP);
      normalize(UP);
      distance(VEC3_ZERO, UP);
      lerp(VEC3_ZERO, UP, 0.5);
      quatFromAxisAngle(UP, 1);
      quatMultiply(QUAT_IDENTITY, QUAT_IDENTITY);
      quatInverse(QUAT_IDENTITY);
      quatRotate(QUAT_IDENTITY, FORWARD);
      quatSlerp(QUAT_IDENTITY, QUAT_IDENTITY, 0.5);
      quatToEuler(QUAT_IDENTITY);
      quatLookAt(FORWARD, UP);
      const frozen: Transform = {
        position: VEC3_ZERO,
        rotation: QUAT_IDENTITY,
        scale: VEC3_ONE,
      };
      transformPoint(frozen, VEC3_ZERO);
      transformToMatrix(frozen);
      composeTransforms(frozen, frozen);
    }).not.toThrow();
  });

  it("hands back records the caller may write into", () => {
    const composed = composeTransforms(
      { position: VEC3_ZERO, rotation: QUAT_IDENTITY, scale: VEC3_ONE },
      { position: VEC3_ZERO, rotation: QUAT_IDENTITY, scale: VEC3_ONE },
    );
    composed.position.x = 4;
    composed.scale.y = 2;
    composed.rotation.w = 1;
    expect(composed.position.x).toBe(4);
    expect(VEC3_ZERO.x).toBe(0);
    expect(VEC3_ONE.y).toBe(1);
  });

  it("returns a unit quaternion from every helper that computes a rotation", () => {
    const rotations: Quat[] = [
      quatFromEuler(0.4, -0.9, 1.3),
      quatFromAxisAngle(vec3(1, 2, 3), 2.2),
      quatMultiply(quatFromEuler(0.4, 0, 0), quatFromEuler(0, 1.1, 0)),
      quatInverse(quatFromEuler(0.4, -0.9, 1.3)),
      quatSlerp(QUAT_IDENTITY, quatFromEuler(0.4, -0.9, 1.3), 0.3),
      quatLookAt(vec3(1, 2, 3)),
      quatLookAt(UP),
    ];
    for (const q of rotations) {
      expect(quatLength(q)).toBeCloseTo(1, 10);
    }
  });
});
