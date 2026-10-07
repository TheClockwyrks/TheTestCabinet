// The angular conventions of specs/field.md: the rotation formula, wrap-aware
// offsets in [-180, 180), inclusive membership, and the polar mapping.

import { describe, expect, it } from "vitest";
import {
  angularOffsetDeg,
  normalizeDeg,
  pointAt,
  polarOf,
  radialAt,
  rotateDeg,
  signedAngleDeg,
  tangentialOf,
  withinArcDeg,
} from "./polar";

describe("normalizeDeg", () => {
  it("wraps into [0, 360)", () => {
    expect(normalizeDeg(0)).toBe(0);
    expect(normalizeDeg(360)).toBe(0);
    expect(normalizeDeg(365)).toBe(5);
    expect(normalizeDeg(-90)).toBe(270);
    expect(normalizeDeg(-720)).toBe(0);
  });
});

describe("angularOffsetDeg", () => {
  it("is the plain difference for nearby angles", () => {
    expect(angularOffsetDeg(30, 10)).toBe(20);
    expect(angularOffsetDeg(10, 30)).toBe(-20);
  });

  it("is wrap-aware across zero", () => {
    expect(angularOffsetDeg(350, 10)).toBe(-20);
    expect(angularOffsetDeg(10, 350)).toBe(20);
  });

  it("lands in [-180, 180)", () => {
    expect(angularOffsetDeg(180, 0)).toBe(-180);
    expect(angularOffsetDeg(0, 180)).toBe(-180);
    expect(angularOffsetDeg(179, 0)).toBe(179);
  });
});

describe("rotateDeg", () => {
  it("matches the spec's rotation formula, positive toward +theta", () => {
    const rotated = rotateDeg({ x: 1, y: 0 }, 90);
    expect(rotated.x).toBeCloseTo(0, 12);
    expect(rotated.y).toBeCloseTo(1, 12);
  });

  it("rotates by the exact matrix (x cos a - y sin a, x sin a + y cos a)", () => {
    const a = 37;
    const v = { x: 3, y: -2 };
    const c = Math.cos((a * Math.PI) / 180);
    const s = Math.sin((a * Math.PI) / 180);
    const rotated = rotateDeg(v, a);
    expect(rotated.x).toBeCloseTo(v.x * c - v.y * s, 12);
    expect(rotated.y).toBeCloseTo(v.x * s + v.y * c, 12);
  });
});

describe("signedAngleDeg", () => {
  it("is positive when the rotation toward the target is +theta", () => {
    expect(signedAngleDeg({ x: 1, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(90, 12);
    expect(signedAngleDeg({ x: 1, y: 0 }, { x: 0, y: -1 })).toBeCloseTo(
      -90,
      12,
    );
    expect(signedAngleDeg({ x: 1, y: 0 }, { x: 1, y: 0 })).toBe(0);
  });
});

describe("tangentialOf", () => {
  it("is the radial rotated by +90 degrees", () => {
    const n = radialAt(30);
    const t = tangentialOf(n);
    const expected = rotateDeg(n, 90);
    expect(t.x).toBeCloseTo(expected.x, 12);
    expect(t.y).toBeCloseTo(expected.y, 12);
  });
});

describe("withinArcDeg", () => {
  it("includes both boundaries", () => {
    expect(withinArcDeg(66, 90, 24)).toBe(true);
    expect(withinArcDeg(114, 90, 24)).toBe(true);
    expect(withinArcDeg(65.9, 90, 24)).toBe(false);
    expect(withinArcDeg(114.1, 90, 24)).toBe(false);
  });

  it("is wrap-aware around zero", () => {
    expect(withinArcDeg(350, 5, 24)).toBe(true);
    expect(withinArcDeg(340, 5, 24)).toBe(false);
  });
});

describe("the polar mapping", () => {
  it("maps (r, theta) onto the stage around (500, 500)", () => {
    expect(pointAt(100, 0)).toEqual({ x: 600, y: 500 });
    const down = pointAt(100, 90);
    expect(down.x).toBeCloseTo(500, 9);
    expect(down.y).toBeCloseTo(600, 9);
  });

  it("round-trips through polarOf", () => {
    const at = pointAt(302, 123.4);
    const back = polarOf(at.x, at.y);
    expect(back.r).toBeCloseTo(302, 9);
    expect(back.angleDeg).toBeCloseTo(123.4, 9);
  });

  it("normalizes the angle it reports into [0, 360)", () => {
    const back = polarOf(500, 400);
    expect(back.angleDeg).toBe(270);
  });
});
