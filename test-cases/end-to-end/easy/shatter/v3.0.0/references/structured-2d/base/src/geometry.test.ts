import { describe, expect, it } from "vitest";
import { FIELD_H, FIELD_W } from "./constants";
import {
  deltaX,
  deltaY,
  sweptHit,
  sweptTime,
  wrapX,
  wrapY,
  wrappedDistance,
} from "./geometry";

describe("the wrap", () => {
  it("brings a coordinate back into the field on both axes", () => {
    expect(wrapX(FIELD_W + 40)).toBeCloseTo(40, 9);
    expect(wrapX(-40)).toBeCloseTo(FIELD_W - 40, 9);
    expect(wrapY(FIELD_H + 12)).toBeCloseTo(12, 9);
    expect(wrapY(-12)).toBeCloseTo(FIELD_H - 12, 9);
  });

  it("leaves a coordinate already in range alone", () => {
    expect(wrapX(640)).toBe(640);
    expect(wrapY(360)).toBe(360);
  });
});

describe("the shortest wrapped separation", () => {
  it("crosses the seam rather than the field", () => {
    expect(deltaX(20, FIELD_W - 20)).toBeCloseTo(-40, 9);
    expect(deltaY(10, FIELD_H - 10)).toBeCloseTo(-20, 9);
  });

  it("stays inside half the field on each axis", () => {
    for (let x = 0; x < FIELD_W; x += 37) {
      expect(Math.abs(deltaX(0, x))).toBeLessThanOrEqual(FIELD_W / 2);
    }
    for (let y = 0; y < FIELD_H; y += 23) {
      expect(Math.abs(deltaY(0, y))).toBeLessThanOrEqual(FIELD_H / 2);
    }
  });

  it("measures a corner pair across the seams", () => {
    expect(wrappedDistance(10, 10, FIELD_W - 10, FIELD_H - 10)).toBeCloseTo(
      Math.hypot(20, 20),
      9,
    );
  });
});

describe("the swept contact test", () => {
  it("catches a pair that closes and parts inside one tick", () => {
    // Ten units of travel in the tick against a combined radius of three: an
    // overlap test at either end of the tick reports nothing.
    const dt = 1 / 120;
    expect(sweptHit(0, 0, 1200, 0, 10, 0, 0, 0, 3, dt)).toBe(true);
    expect(sweptHit(0, 0, 0, 0, 10, 0, 0, 0, 3, dt)).toBe(false);
  });

  it("misses a pass wider than the combined radius", () => {
    const dt = 1 / 120;
    expect(sweptHit(0, 0, 1200, 0, 6, 4, 0, 0, 3, dt)).toBe(false);
    expect(sweptHit(0, 0, 1200, 0, 6, 2, 0, 0, 3, dt)).toBe(true);
  });

  it("reports contact at zero for a pair already overlapping", () => {
    expect(sweptTime(0, 0, 0, 0, 1, 0, 0, 0, 5, 1 / 120)).toBe(0);
  });

  it("never fires on a pair moving apart", () => {
    expect(sweptTime(0, 0, -600, 0, 20, 0, 600, 0, 4, 1 / 120)).toBeNull();
  });

  it("works across a seam", () => {
    const dt = 1 / 120;
    expect(sweptHit(4, 100, -600, 0, FIELD_W - 4, 100, 0, 0, 12, dt)).toBe(true);
  });
});
