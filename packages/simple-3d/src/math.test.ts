import { describe, expect, it } from "vitest";
import type { Quat, Transform, Vec3 } from "./math";
import {
  defaultCameraState,
  quatFromAxisAngle,
  quatMultiply,
  rotateVec3,
  transformPoint,
  vec3Add,
  vec3Cross,
  vec3Dot,
  vec3Length,
  vec3Normalize,
  vec3Scale,
  vec3Sub,
} from "./math";

/**
 * The eleven documented math functions, checked against hand-derived values.
 * This suite owns the vocabulary's behavior table — the zero-vector and
 * zero-axis rules, the `quatMultiply` order, the TRS composition — and its
 * purity claims; where a projection or a viewport uses these functions, the
 * engine-side suites assert the composition, not the arithmetic.
 */

/** The identity quaternion, for readable expectations. */
const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };

/** Asserts each component of `actual` within float tolerance of `expected`. */
function expectVec3Close(actual: Vec3, expected: Vec3): void {
  expect(actual.x).toBeCloseTo(expected.x, 12);
  expect(actual.y).toBeCloseTo(expected.y, 12);
  expect(actual.z).toBeCloseTo(expected.z, 12);
}

describe("vector arithmetic", () => {
  it("adds, subtracts, and scales componentwise", () => {
    expect(vec3Add({ x: 1, y: 2, z: 3 }, { x: 10, y: 20, z: 30 })).toEqual({
      x: 11,
      y: 22,
      z: 33,
    });
    expect(vec3Sub({ x: 1, y: 2, z: 3 }, { x: 10, y: 20, z: 30 })).toEqual({
      x: -9,
      y: -18,
      z: -27,
    });
    expect(vec3Scale({ x: 1, y: -2, z: 3 }, -2)).toEqual({
      x: -2,
      y: 4,
      z: -6,
    });
  });

  it("computes the dot product", () => {
    expect(vec3Dot({ x: 1, y: 2, z: 3 }, { x: 4, y: -5, z: 6 })).toBe(
      4 - 10 + 18,
    );
    expect(vec3Dot({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })).toBe(0);
  });

  it("computes a right-handed cross product, so x cross y is z", () => {
    expect(vec3Cross({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })).toEqual({
      x: 0,
      y: 0,
      z: 1,
    });
    expect(vec3Cross({ x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 })).toEqual({
      x: 0,
      y: 0,
      z: -1,
    });
    // Hand-derived: (1,2,3) x (4,5,6) = (2*6-3*5, 3*4-1*6, 1*5-2*4).
    expect(vec3Cross({ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 })).toEqual({
      x: -3,
      y: 6,
      z: -3,
    });
  });

  it("measures length as the Euclidean norm", () => {
    expect(vec3Length({ x: 3, y: 0, z: 4 })).toBe(5);
    expect(vec3Length({ x: 0, y: 0, z: 0 })).toBe(0);
  });

  it("normalizes to a unit vector", () => {
    expectVec3Close(vec3Normalize({ x: 3, y: 0, z: 4 }), {
      x: 0.6,
      y: 0,
      z: 0.8,
    });
    expect(vec3Length(vec3Normalize({ x: 1, y: 2, z: 3 }))).toBeCloseTo(1, 12);
  });

  it("normalizes a zero vector to (0, 0, 0) rather than NaN, per the documented rule", () => {
    expect(vec3Normalize({ x: 0, y: 0, z: 0 })).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe("quaternions", () => {
  it("builds the rotation of an angle about an axis", () => {
    const halfTurn = quatFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI);
    expect(halfTurn.x).toBeCloseTo(0, 12);
    expect(halfTurn.y).toBeCloseTo(1, 12);
    expect(halfTurn.z).toBeCloseTo(0, 12);
    expect(halfTurn.w).toBeCloseTo(0, 12);
  });

  it("normalizes the axis, so any non-zero vector along it builds the same rotation", () => {
    const fromUnit = quatFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 3);
    const fromLong = quatFromAxisAngle({ x: 0, y: 10, z: 0 }, Math.PI / 3);
    expect(fromLong.x).toBeCloseTo(fromUnit.x, 12);
    expect(fromLong.y).toBeCloseTo(fromUnit.y, 12);
    expect(fromLong.z).toBeCloseTo(fromUnit.z, 12);
    expect(fromLong.w).toBeCloseTo(fromUnit.w, 12);
  });

  it("yields identity for a zero axis, the rotation a rotation about nothing can only be", () => {
    expect(quatFromAxisAngle({ x: 0, y: 0, z: 0 }, 1.5)).toEqual(IDENTITY);
  });

  it("rotates a vector: a quarter turn about +Y carries +Z to +X", () => {
    const quarter = quatFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2);
    // Right-hand rule about +Y: (0,0,1) -> (1,0,0), and (1,0,0) -> (0,0,-1).
    expectVec3Close(rotateVec3(quarter, { x: 0, y: 0, z: 1 }), {
      x: 1,
      y: 0,
      z: 0,
    });
    expectVec3Close(rotateVec3(quarter, { x: 1, y: 0, z: 0 }), {
      x: 0,
      y: 0,
      z: -1,
    });
  });

  it("leaves a vector alone under the identity rotation", () => {
    expectVec3Close(rotateVec3(IDENTITY, { x: 1, y: 2, z: 3 }), {
      x: 1,
      y: 2,
      z: 3,
    });
  });

  it("applies b first in quatMultiply(a, b), the documented order", () => {
    const aboutY = quatFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2);
    const aboutX = quatFromAxisAngle({ x: 1, y: 0, z: 0 }, Math.PI / 2);
    // b (about X) first: (0,1,0) -> (0,0,1); then a (about Y): (0,0,1) -> (1,0,0).
    const composed = quatMultiply(aboutY, aboutX);
    expectVec3Close(rotateVec3(composed, { x: 0, y: 1, z: 0 }), {
      x: 1,
      y: 0,
      z: 0,
    });
    // The other order lands elsewhere, which is what makes the order observable:
    // a (about Y) fixes (0,1,0); then b (about X) carries it to (0,0,1).
    const reversed = quatMultiply(aboutX, aboutY);
    expectVec3Close(rotateVec3(reversed, { x: 0, y: 1, z: 0 }), {
      x: 0,
      y: 0,
      z: 1,
    });
  });

  it("keeps a composition of unit quaternions unit-length", () => {
    const a = quatFromAxisAngle({ x: 1, y: 2, z: 3 }, 0.7);
    const b = quatFromAxisAngle({ x: -2, y: 1, z: 0 }, 2.1);
    const q = quatMultiply(a, b);
    expect(
      Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w),
    ).toBeCloseTo(1, 12);
  });
});

describe("transformPoint", () => {
  it("composes scale, then rotation, then translation, in that order", () => {
    const t: Transform = {
      position: { x: 1, y: 2, z: 3 },
      rotation: quatFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2),
      scale: { x: 2, y: 2, z: 2 },
    };
    // (0,0,1) scales to (0,0,2), rotates to (2,0,0), translates to (3,2,3).
    // Were translation applied before rotation, the position would rotate too
    // and the point would land elsewhere.
    expectVec3Close(transformPoint(t, { x: 0, y: 0, z: 1 }), {
      x: 3,
      y: 2,
      z: 3,
    });
  });

  it("scales per axis before rotating", () => {
    const t: Transform = {
      position: { x: 0, y: 0, z: 0 },
      rotation: quatFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2),
      scale: { x: 3, y: 1, z: 5 },
    };
    // (1,0,1) scales to (3,0,5); the quarter turn about +Y carries it to (5,0,-3).
    expectVec3Close(transformPoint(t, { x: 1, y: 0, z: 1 }), {
      x: 5,
      y: 0,
      z: -3,
    });
  });

  it("is the identity under the identity transform", () => {
    const identity: Transform = {
      position: { x: 0, y: 0, z: 0 },
      rotation: IDENTITY,
      scale: { x: 1, y: 1, z: 1 },
    };
    expectVec3Close(transformPoint(identity, { x: -4, y: 5, z: 6 }), {
      x: -4,
      y: 5,
      z: 6,
    });
  });
});

describe("purity", () => {
  it("returns fresh values and leaves its arguments untouched", () => {
    const v: Vec3 = { x: 1, y: 2, z: 3 };
    const w: Vec3 = { x: 4, y: 5, z: 6 };
    const sum = vec3Add(v, w);
    expect(sum).not.toBe(v);
    expect(sum).not.toBe(w);
    expect(v).toEqual({ x: 1, y: 2, z: 3 });
    expect(w).toEqual({ x: 4, y: 5, z: 6 });

    const t: Transform = {
      position: { x: 1, y: 1, z: 1 },
      rotation: quatFromAxisAngle({ x: 0, y: 0, z: 1 }, 0.5),
      scale: { x: 2, y: 2, z: 2 },
    };
    const before = JSON.stringify(t);
    transformPoint(t, v);
    expect(JSON.stringify(t)).toBe(before);
  });
});

describe("defaultCameraState", () => {
  it("carries the documented defaults", () => {
    expect(defaultCameraState()).toEqual({
      position: { x: 0, y: 0, z: 10 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      fovY: Math.PI / 3,
      near: 0.1,
      far: 1000,
    });
  });

  it("hands each caller a fresh value, so one caller's edits are not another's defaults", () => {
    const first = defaultCameraState();
    const second = defaultCameraState();
    expect(first).not.toBe(second);
    expect(first.position).not.toBe(second.position);
  });
});
