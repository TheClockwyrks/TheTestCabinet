// Spectra — the stage's geometry and the starfield behind it.

import { describe, expect, it } from "vitest";
import {
  FIELD_BOTTOM,
  FIELD_TOP,
  SHIP_X_MAX,
  SHIP_X_MIN,
  STARFIELD_MIN,
  SWAY_AMP,
  SWAY_PERIOD,
  swayOffset,
} from "./constants";
import {
  LANE_CENTER,
  STARFIELD,
  clampShipX,
  inPlayField,
  slotPosition,
} from "./field";

describe("the ship's lane", () => {
  it("clamps to both bounds and never wraps", () => {
    expect(clampShipX(-500)).toBe(SHIP_X_MIN);
    expect(clampShipX(5000)).toBe(SHIP_X_MAX);
    expect(clampShipX(640)).toBe(640);
    expect(LANE_CENTER).toBe((SHIP_X_MIN + SHIP_X_MAX) / 2);
  });
});

describe("the play field", () => {
  it("reads a centre as inside only on both axes", () => {
    expect(inPlayField(640, 300)).toBe(true);
    expect(inPlayField(640, FIELD_TOP - 1)).toBe(false);
    expect(inPlayField(640, FIELD_BOTTOM + 1)).toBe(false);
    expect(inPlayField(-1, 300)).toBe(false);
    expect(inPlayField(1281, 300)).toBe(false);
  });
});

describe("the sway", () => {
  it("swings the full amplitude either side over one period", () => {
    let lowest = Number.POSITIVE_INFINITY;
    let highest = Number.NEGATIVE_INFINITY;
    for (let step = 0; step <= 500; step += 1) {
      const offset = swayOffset((step / 500) * SWAY_PERIOD);
      lowest = Math.min(lowest, offset);
      highest = Math.max(highest, offset);
    }
    expect(highest).toBeCloseTo(SWAY_AMP, 2);
    expect(lowest).toBeCloseTo(-SWAY_AMP, 2);
    expect(swayOffset(0)).toBeCloseTo(0, 9);
    expect(swayOffset(SWAY_PERIOD)).toBeCloseTo(0, 9);
  });

  it("carries every slot the same offset at the same instant", () => {
    const a = slotPosition(400, 140, 1.2);
    const b = slotPosition(900, 236, 1.2);
    expect(a.x - 400).toBeCloseTo(b.x - 900, 9);
    expect(a.y).toBe(140);
    expect(b.y).toBe(236);
  });
});

describe("the starfield", () => {
  it("holds more marks than the stated floor, all inside the play field", () => {
    expect(STARFIELD.length).toBeGreaterThanOrEqual(STARFIELD_MIN);
    for (const star of STARFIELD) {
      expect(star.y).toBeGreaterThanOrEqual(FIELD_TOP);
      expect(star.y).toBeLessThanOrEqual(FIELD_BOTTOM);
      expect(star.r).toBeGreaterThan(0);
      expect(star.alpha).toBeGreaterThan(0);
      expect(star.alpha).toBeLessThanOrEqual(1);
    }
  });
});
