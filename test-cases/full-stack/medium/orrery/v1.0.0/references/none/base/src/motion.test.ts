import { describe, expect, it } from "vitest";

import { HEX_PITCH } from "./constants";
import { hexCenter } from "./hex";
import {
  landHex,
  movePoint,
  REST,
  rotationMotion,
  sameMotion,
  spokeVector,
  stageVector,
  STEP_DEGREES,
  translationMotion,
} from "./motion";

/** The east neighbor offset, which every translation example below uses. */
const EAST = { q: 1, r: 0 };

describe("the three rigid motions (specs/simulation.md)", () => {
  it("names one sixty degree step", () => {
    expect(STEP_DEGREES).toBe(60);
  });

  it("steps a spoke outward and inward by the same vector", () => {
    expect(spokeVector(0, true)).toEqual({ q: 1, r: 0 });
    expect(spokeVector(0, false)).toEqual({ q: -1, r: 0 });
    expect(spokeVector(2, true)).toEqual({ q: -1, r: 1 });
    // A spoke index is taken modulo six, as specs/field.md counts directions.
    expect(spokeVector(6, true)).toEqual(spokeVector(0, true));
  });

  it("measures a hex vector's stage displacement", () => {
    expect(stageVector(EAST)).toEqual({ x: HEX_PITCH, y: 0 });
    const southeast = stageVector({ q: 0, r: 1 });
    expect(southeast.x).toBeCloseTo(HEX_PITCH / 2, 9);
    expect(southeast.y).toBeCloseTo((HEX_PITCH * Math.sqrt(3)) / 2, 9);
  });
});

describe("moving a point across a cycle (specs/simulation.md)", () => {
  it("holds a resting point where it stands", () => {
    const from = hexCenter({ q: 2, r: -1 });
    expect(movePoint(from, REST, 0.5)).toEqual(from);
  });

  it("runs a translation linearly in t", () => {
    const from = hexCenter({ q: 0, r: 0 });
    const half = movePoint(from, translationMotion(EAST), 0.5);
    expect(half.x).toBeCloseTo(from.x + HEX_PITCH / 2, 9);
    expect(half.y).toBeCloseTo(from.y, 9);
  });

  it("lands a translation exactly on the neighbor's center at t = 1", () => {
    const whole = movePoint(
      hexCenter({ q: 0, r: 0 }),
      translationMotion(EAST),
      1,
    );
    expect(whole.x).toBeCloseTo(hexCenter(EAST).x, 9);
    expect(whole.y).toBeCloseTo(hexCenter(EAST).y, 9);
  });

  it("sweeps a rotation sixty degrees onto the hex the formulas name", () => {
    // Clockwise about `(0, 0)` sends `(1, 0)` to `(0, 1)`, and a clockwise turn
    // is a positive angle because the stage's `y` grows downward.
    const swept = movePoint(
      hexCenter(EAST),
      rotationMotion({ q: 0, r: 0 }, 1),
      1,
    );
    expect(swept.x).toBeCloseTo(hexCenter({ q: 0, r: 1 }).x, 9);
    expect(swept.y).toBeCloseTo(hexCenter({ q: 0, r: 1 }).y, 9);
  });

  it("sweeps counterclockwise the other way", () => {
    const swept = movePoint(
      hexCenter(EAST),
      rotationMotion({ q: 0, r: 0 }, -1),
      1,
    );
    expect(swept.x).toBeCloseTo(hexCenter({ q: 1, r: -1 }).x, 9);
    expect(swept.y).toBeCloseTo(hexCenter({ q: 1, r: -1 }).y, 9);
  });

  it("keeps a rotation's radius across the sweep", () => {
    const center = hexCenter({ q: 0, r: 0 });
    const motion = rotationMotion({ q: 0, r: 0 }, 1);
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const at = movePoint(hexCenter({ q: 2, r: 0 }), motion, t);
      expect(Math.hypot(at.x - center.x, at.y - center.y)).toBeCloseTo(
        2 * HEX_PITCH,
        9,
      );
    }
  });
});

describe("where a motion lands a mote (specs/simulation.md)", () => {
  it("leaves a resting mote on its hex", () => {
    expect(landHex({ q: 1, r: 2 }, REST)).toEqual({ q: 1, r: 2 });
  });

  it("adds a translation's vector", () => {
    expect(landHex({ q: 1, r: 2 }, translationMotion(EAST))).toEqual({
      q: 2,
      r: 2,
    });
  });

  it("turns a rotation about its center by the axial formulas", () => {
    expect(landHex({ q: 1, r: 0 }, rotationMotion({ q: 0, r: 0 }, 1))).toEqual({
      q: 0,
      r: 1,
    });
    expect(landHex({ q: 0, r: 1 }, rotationMotion({ q: 1, r: 1 }, 1))).toEqual({
      q: 1,
      r: 0,
    });
  });
});

describe("when two imposed motions agree (specs/simulation.md)", () => {
  it("agrees when both are no motion", () => {
    expect(sameMotion(REST, REST)).toBe(true);
  });

  it("agrees on the same translation vector and not on another", () => {
    expect(
      sameMotion(translationMotion(EAST), translationMotion({ q: 1, r: 0 })),
    ).toBe(true);
    expect(
      sameMotion(translationMotion(EAST), translationMotion({ q: 0, r: 1 })),
    ).toBe(false);
  });

  it("agrees on one center in one direction and not on another", () => {
    const about = { q: 2, r: -1 };
    expect(sameMotion(rotationMotion(about, 1), rotationMotion(about, 1))).toBe(
      true,
    );
    expect(
      sameMotion(rotationMotion(about, 1), rotationMotion(about, -1)),
    ).toBe(false);
    expect(
      sameMotion(rotationMotion(about, 1), rotationMotion({ q: 0, r: 0 }, 1)),
    ).toBe(false);
  });

  it("never agrees across two kinds of motion", () => {
    expect(sameMotion(REST, translationMotion(EAST))).toBe(false);
    expect(
      sameMotion(translationMotion(EAST), rotationMotion({ q: 0, r: 0 }, 1)),
    ).toBe(false);
  });
});
