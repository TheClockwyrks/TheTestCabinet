// The torus: wrapping a coordinate, and the shortest separation across a seam.

import { describe, expect, it } from "vitest";
import { FIELD_H, FIELD_W } from "./constants";
import { distance, foldX, foldY, separation, wrapX, wrapY } from "./field";

describe("the wrap", () => {
  it("brings a coordinate back into the field from either side", () => {
    expect(wrapX(-1)).toBeCloseTo(FIELD_W - 1, 9);
    expect(wrapX(FIELD_W + 5)).toBeCloseTo(5, 9);
    expect(wrapX(FIELD_W)).toBe(0);
    expect(wrapY(-0.5)).toBeCloseTo(FIELD_H - 0.5, 9);
    expect(wrapY(FIELD_H * 3 + 12)).toBeCloseTo(12, 9);
  });

  it("leaves a coordinate already in range alone", () => {
    expect(wrapX(640)).toBe(640);
    expect(wrapY(0)).toBe(0);
  });
});

describe("the shortest wrapped separation", () => {
  it("folds a difference into half the field on each axis", () => {
    expect(foldX(FIELD_W - 10)).toBeCloseTo(-10, 9);
    expect(foldX(10)).toBe(10);
    expect(foldY(FIELD_H - 4)).toBeCloseTo(-4, 9);
    expect(foldX(FIELD_W / 2)).toBeCloseTo(-FIELD_W / 2, 9);
  });

  it("measures two bodies across a seam as neighbours", () => {
    expect(distance(4, 10, FIELD_W - 6, 10)).toBeCloseTo(10, 9);
    expect(distance(20, 5, 20, FIELD_H - 5)).toBeCloseTo(10, 9);
    const [dx, dy] = separation(FIELD_W - 6, 10, 4, 10);
    expect(dx).toBeCloseTo(10, 9);
    expect(dy).toBe(0);
  });
});
