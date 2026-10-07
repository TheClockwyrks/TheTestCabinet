import { describe, expect, it } from "vitest";
import { FIELD_H, FIELD_W } from "./constants";
import {
  deltaX,
  deltaY,
  normalizeAngle,
  sweptTime,
  wrapX,
  wrapY,
  wrappedDistance,
} from "./geometry";

describe("the wrap", () => {
  it("brings a coordinate back into the field", () => {
    expect(wrapX(FIELD_W + 5)).toBeCloseTo(5, 9);
    expect(wrapX(-5)).toBeCloseTo(FIELD_W - 5, 9);
    expect(wrapY(FIELD_H + 12)).toBeCloseTo(12, 9);
    expect(wrapY(-12)).toBeCloseTo(FIELD_H - 12, 9);
  });

  it("leaves a coordinate already in the field alone", () => {
    expect(wrapX(640)).toBe(640);
    expect(wrapY(360)).toBe(360);
  });
});

describe("the shortest wrapped separation", () => {
  it("crosses the seam rather than the field", () => {
    expect(deltaX(10, FIELD_W - 10)).toBeCloseTo(-20, 9);
    expect(deltaY(5, FIELD_H - 5)).toBeCloseTo(-10, 9);
  });

  it("is the plain difference away from a seam", () => {
    expect(deltaX(100, 260)).toBeCloseTo(160, 9);
    expect(deltaY(100, 40)).toBeCloseTo(-60, 9);
  });

  it("measures a distance across a corner", () => {
    expect(wrappedDistance(4, 3, FIELD_W - 4, FIELD_H - 3)).toBeCloseTo(10, 9);
  });
});

describe("angles", () => {
  it("come back inside a half turn either way", () => {
    expect(normalizeAngle(Math.PI * 3)).toBeCloseTo(-Math.PI, 9);
    expect(normalizeAngle(-Math.PI * 1.5)).toBeCloseTo(Math.PI / 2, 9);
  });
});

describe("the swept circle test", () => {
  it("reports an overlap already in place at the start of the step", () => {
    expect(sweptTime(3, 0, 0, 0, 10)).toBe(0);
  });

  it("catches a crossing a discrete test would miss", () => {
    // Twenty units apart, closing forty over the step, against a combined
    // radius of five: the pair is clear at both ends and touches in between.
    const at = sweptTime(20, 0, -40, 0, 5);
    expect(at).not.toBeNull();
    expect(at as number).toBeGreaterThan(0);
    expect(at as number).toBeLessThan(1);
  });

  it("misses a pass wider than the combined radius", () => {
    expect(sweptTime(20, 9, -40, 0, 5)).toBeNull();
  });

  it("reports nothing for a pair that never closes", () => {
    expect(sweptTime(40, 0, 10, 0, 5)).toBeNull();
    expect(sweptTime(40, 0, 0, 0, 5)).toBeNull();
  });
});
