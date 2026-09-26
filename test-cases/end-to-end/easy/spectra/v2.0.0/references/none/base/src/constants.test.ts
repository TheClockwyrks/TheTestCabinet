import { describe, expect, it } from "vitest";

import {
  CHALLENGE_EVERY,
  CHALLENGE_GROUPS,
  CHALLENGE_PER_GROUP,
  CHALLENGE_TOTAL,
  FIELD_BOTTOM,
  FIELD_TOP,
  FLUX_HOLD_L1,
  FLUX_SHIMMER,
  FORM_COLS,
  FORM_ROWS,
  FORM_ROW0_Y,
  HUD_BOTTOM_TOP,
  HUD_TOP_H,
  SHIP_X_MAX,
  SHIP_X_MIN,
  SLOT_DX,
  SLOT_DY,
  STAGE_H,
  STAGE_W,
  SUBSTEP_MAX,
  SWAY_AMP,
  SWAY_PERIOD,
  bulletSpeedScale,
  diveGapScale,
  droneSpeedScale,
  fluxCycle,
  fluxHold,
  fluxWindow,
  isChallengeStage,
  opposite,
  slotX,
  slotY,
  swayOffset,
} from "./constants";

describe("the stage's geometry", () => {
  it("divides the stage into three full-width regions", () => {
    expect([STAGE_W, STAGE_H]).toEqual([1280, 720]);
    expect(HUD_TOP_H).toBe(FIELD_TOP);
    expect(FIELD_BOTTOM).toBe(HUD_BOTTOM_TOP);
    expect(FIELD_BOTTOM - FIELD_TOP).toBe(592);
    expect(STAGE_H - HUD_BOTTOM_TOP).toBe(HUD_TOP_H);
  });

  it("places the slot grid where the specification says", () => {
    expect(slotX(0)).toBe(384);
    expect(slotX(4)).toBe(640);
    expect(slotX(FORM_COLS - 1)).toBe(896);
    expect(slotY(0)).toBe(FORM_ROW0_Y);
    expect(slotY(FORM_ROWS - 1)).toBe(332);
    expect(slotX(1) - slotX(0)).toBe(SLOT_DX);
    expect(slotY(1) - slotY(0)).toBe(SLOT_DY);
  });

  it("mirrors the grid about the centre column", () => {
    for (let col = 0; col < FORM_COLS; col += 1) {
      expect(slotX(col) + slotX(FORM_COLS - 1 - col)).toBe(2 * 640);
    }
  });

  it("keeps the whole hull on the stage along the lane", () => {
    expect(SHIP_X_MIN).toBe(40);
    expect(SHIP_X_MAX).toBe(1240);
    expect((SHIP_X_MIN + SHIP_X_MAX) / 2).toBe(640);
  });

  it("sways the whole block by one offset with the stated amplitude", () => {
    expect(swayOffset(0)).toBeCloseTo(0, 10);
    expect(swayOffset(SWAY_PERIOD / 4)).toBeCloseTo(SWAY_AMP, 10);
    expect(swayOffset(SWAY_PERIOD * 0.75)).toBeCloseTo(-SWAY_AMP, 10);
    expect(swayOffset(SWAY_PERIOD)).toBeCloseTo(0, 10);
    // The period really is the period.
    for (const t of [0.3, 1.7, 3.9]) {
      expect(swayOffset(t + SWAY_PERIOD)).toBeCloseTo(swayOffset(t), 10);
    }
    // And it never leaves the amplitude.
    for (let t = 0; t < 10; t += 0.05) {
      expect(Math.abs(swayOffset(t))).toBeLessThanOrEqual(SWAY_AMP + 1e-9);
    }
  });
});

describe("the frame's sub-step rule", () => {
  it("divides a second into a hundred and twenty sub-steps of 1/120", () => {
    expect(SUBSTEP_MAX).toBe(1 / 120);
    for (const frames of [1, 2, 3, 4, 5, 6, 10, 12, 20, 60, 120]) {
      const dt = 1 / frames;
      const steps = Math.max(1, Math.ceil(dt / SUBSTEP_MAX));
      const h = dt / steps;
      expect(h).toBeLessThanOrEqual(SUBSTEP_MAX);
      expect(steps * frames).toBe(120);
      expect(h).toBe(1 / 120);
    }
  });
});

describe("the bands", () => {
  it("has exactly two, each the other's opposite", () => {
    expect(opposite("cyan")).toBe("magenta");
    expect(opposite("magenta")).toBe("cyan");
    expect(opposite(opposite("cyan"))).toBe("cyan");
  });
});

describe("the stage's scaling", () => {
  it("scales the drone speed and caps it", () => {
    expect(droneSpeedScale(1)).toBeCloseTo(1, 10);
    expect(droneSpeedScale(2)).toBeCloseTo(1.06, 10);
    expect(droneSpeedScale(5)).toBeCloseTo(1.24, 10);
    expect(droneSpeedScale(10)).toBeCloseTo(1.5, 10);
    expect(droneSpeedScale(40)).toBe(1.5);
  });

  it("scales the enemy bullet speed and caps it", () => {
    expect(bulletSpeedScale(1)).toBeCloseTo(1, 10);
    expect(bulletSpeedScale(6)).toBeCloseTo(1.2, 10);
    expect(bulletSpeedScale(11)).toBeCloseTo(1.4, 10);
    expect(bulletSpeedScale(60)).toBe(1.4);
  });

  it("shrinks the dive gap and floors it", () => {
    expect(diveGapScale(1)).toBeCloseTo(1, 10);
    expect(diveGapScale(4)).toBeCloseTo(0.85, 10);
    expect(diveGapScale(10)).toBeCloseTo(0.55, 10);
    expect(diveGapScale(80)).toBe(0.55);
  });

  it("shortens a Flux's hold and floors it", () => {
    expect(fluxHold(1)).toBe(FLUX_HOLD_L1);
    expect(fluxHold(5)).toBeCloseTo(1.4, 10);
    expect(fluxHold(13)).toBeCloseTo(1.0, 10);
    expect(fluxHold(99)).toBe(1);
  });

  it("derives the band window and the full cycle from the hold", () => {
    for (const stage of [1, 2, 7, 13, 40]) {
      expect(fluxWindow(stage)).toBeCloseTo(fluxHold(stage) + FLUX_SHIMMER, 10);
      expect(fluxCycle(stage)).toBeCloseTo(2 * fluxWindow(stage), 10);
    }
    expect(fluxWindow(1)).toBeCloseTo(2, 10);
    expect(fluxCycle(1)).toBeCloseTo(4, 10);
    expect(fluxCycle(13)).toBeCloseTo(2.8, 10);
  });

  it("makes every third stage a challenge stage", () => {
    expect(CHALLENGE_EVERY).toBe(3);
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map(isChallengeStage)).toEqual([
      false,
      false,
      true,
      false,
      false,
      true,
      false,
      false,
      true,
    ]);
    expect(CHALLENGE_TOTAL).toBe(CHALLENGE_GROUPS * CHALLENGE_PER_GROUP);
    expect(CHALLENGE_TOTAL).toBe(40);
  });
});
