import { describe, expect, it } from "vitest";
import { PASSIVES, type PassiveId } from "./constants";
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

  it("read one passive each, at every level up to its max", () => {
    const at = (
      id: PassiveId,
      level: number,
    ): { id: PassiveId; level: number }[] =>
      level === 0 ? [] : [{ id, level }];
    const each = <T>(id: PassiveId, read: (level: number) => T): T[] =>
      Array.from({ length: PASSIVES[id].maxLevel + 1 }, (_, level) =>
        read(level),
      );
    expect(each("wick", (l) => damageMul(at("wick", l)))).toEqual(
      [1, 1.1, 1.2, 1.3, 1.4, 1.5].map((v) => expect.closeTo(v, 9)),
    );
    expect(each("oil", (l) => cooldownMul(at("oil", l)))).toEqual(
      [1, 0.92, 0.84, 0.76, 0.68, 0.6].map((v) => expect.closeTo(v, 9)),
    );
    expect(each("glass", (l) => areaMul(at("glass", l)))).toEqual(
      [1, 1.1, 1.2, 1.3, 1.4, 1.5].map((v) => expect.closeTo(v, 9)),
    );
    expect(each("brass", (l) => armor(at("brass", l)))).toEqual([0, 1, 2, 3]);
    expect(each("mirror", (l) => amountBonus(at("mirror", l)))).toEqual([
      0, 1, 2,
    ]);
    expect(each("bellows", (l) => moveSpeed(at("bellows", l)))).toEqual(
      [180, 198, 216, 234, 252, 270].map((v) => expect.closeTo(v, 9)),
    );
    expect(each("tallow", (l) => maxHp(at("tallow", l)))).toEqual([
      100, 115, 130, 145, 160, 175,
    ]);
    expect(each("tinder", (l) => recovery(at("tinder", l)))).toEqual([
      0, 0.5, 1, 1.5, 2, 2.5,
    ]);
    expect(each("soot", (l) => xpMul(at("soot", l)))).toEqual(
      [1, 1.1, 1.2, 1.3, 1.4, 1.5].map((v) => expect.closeTo(v, 9)),
    );
    expect(each("lure", (l) => pickupRadius(at("lure", l)))).toEqual([
      48, 60, 72, 84, 96, 108,
    ]);
  });

  it("follows the experience curve", () => {
    expect(xpToNext(1)).toBe(5);
    expect(xpToNext(2)).toBe(15);
    expect(xpToNext(10)).toBe(95);
    expect(xpToNext(50)).toBe(495);
  });
});
