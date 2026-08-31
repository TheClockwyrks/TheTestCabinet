import { describe, expect, it } from "vitest";
import {
  amountBonus,
  areaMul,
  armor,
  cooldownMul,
  damageMul,
  maxHp,
  moveSpeed,
  pickupRadius,
  recovery,
  xpMul,
  xpToNext,
} from "./stats";

describe("derived stats", () => {
  it("start at their base with nothing held", () => {
    expect(damageMul([])).toBe(1);
    expect(cooldownMul([])).toBe(1);
    expect(areaMul([])).toBe(1);
    expect(armor([])).toBe(0);
    expect(amountBonus([])).toBe(0);
    expect(moveSpeed([])).toBe(180);
    expect(maxHp([])).toBe(100);
    expect(recovery([])).toBe(0);
    expect(xpMul([])).toBe(1);
    expect(pickupRadius([])).toBe(48);
  });

  it("stack linearly per level held", () => {
    const passives = [
      { id: "wick" as const, level: 3 },
      { id: "oil" as const, level: 5 },
      { id: "glass" as const, level: 2 },
      { id: "brass" as const, level: 3 },
      { id: "mirror" as const, level: 2 },
      { id: "bellows" as const, level: 4 },
    ];
    expect(damageMul(passives)).toBeCloseTo(1.3);
    expect(cooldownMul(passives)).toBeCloseTo(0.6);
    expect(areaMul(passives)).toBeCloseTo(1.2);
    expect(armor(passives)).toBe(3);
    expect(amountBonus(passives)).toBe(2);
    expect(moveSpeed(passives)).toBeCloseTo(252);
    const rest = [
      { id: "tallow" as const, level: 2 },
      { id: "tinder" as const, level: 3 },
      { id: "soot" as const, level: 1 },
      { id: "lure" as const, level: 2 },
    ];
    expect(maxHp(rest)).toBe(130);
    expect(recovery(rest)).toBe(1.5);
    expect(xpMul(rest)).toBeCloseTo(1.1);
    expect(pickupRadius(rest)).toBe(72);
  });

  it("follows the experience curve", () => {
    expect(xpToNext(1)).toBe(5);
    expect(xpToNext(2)).toBe(15);
    expect(xpToNext(10)).toBe(95);
    expect(xpToNext(50)).toBe(495);
  });
});
