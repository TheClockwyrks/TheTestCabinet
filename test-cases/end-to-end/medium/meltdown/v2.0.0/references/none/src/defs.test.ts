import { describe, expect, it } from "vitest";
import { TOWER_TYPES, SURGE_TYPES } from "./constants";
import {
  SURGE_DEFS,
  TOWER_DEFS,
  emitterStats,
  isEmitter,
  moverOutput,
  upgradeCost,
  type EmitterDef,
} from "./defs";

const emitter = (
  type: "arc" | "stutter" | "rime" | "flak" | "bloom" | "lance",
): EmitterDef => TOWER_DEFS[type] as EmitterDef;

describe("the roster", () => {
  it("lists eight towers, six of which fire", () => {
    expect(TOWER_TYPES).toHaveLength(8);
    const firing = TOWER_TYPES.filter((type) => isEmitter(TOWER_DEFS[type]));
    expect(firing).toHaveLength(6);
    expect(TOWER_DEFS.forge.kind).toBe("forge");
    expect(TOWER_DEFS.sink.kind).toBe("sink");
  });

  it("carries the stat table the specification states", () => {
    expect(emitter("arc")).toMatchObject({
      size: 2,
      cost: 15,
      range: 6.0,
      fireRate: 2.0,
      baseDamage: 6,
      heatPerShot: 10.3,
      redline: 80,
      mass: 1.0,
    });
    expect(emitter("stutter")).toMatchObject({
      cost: 40,
      fireRate: 7.0,
      redline: 60,
      mass: 0.5,
    });
    expect(emitter("rime")).toMatchObject({
      cost: 45,
      baseDamage: 4,
      redline: 100,
      mass: 1.1,
    });
    expect(emitter("flak")).toMatchObject({ cost: 60, airOnly: true });
    expect(emitter("bloom")).toMatchObject({ size: 3, cost: 150, splash: 2.4 });
    expect(emitter("lance")).toMatchObject({
      size: 4,
      cost: 150,
      range: 12,
      baseDamage: 43,
      redline: 92,
    });
  });

  it("gives the Rime an ordinary damage figure, not an exemption", () => {
    expect(emitter("rime").baseDamage).toBe(4);
    expect(emitter("rime").slowCeil).toEqual([0.55, 0.68, 0.8]);
  });

  it("gives both movers the same 2x2 footprint and cost", () => {
    for (const type of ["forge", "sink"] as const) {
      expect(TOWER_DEFS[type].size).toBe(2);
      expect(TOWER_DEFS[type].cost).toBe(20);
    }
    expect(moverOutput(TOWER_DEFS.forge as never, 1)).toBe(72);
    expect(moverOutput(TOWER_DEFS.forge as never, 3)).toBe(96);
    expect(moverOutput(TOWER_DEFS.sink as never, 1)).toBe(16);
    expect(moverOutput(TOWER_DEFS.sink as never, 3)).toBe(36);
  });
});

describe("levels", () => {
  it("leaves level I exactly as the table gives it", () => {
    const stats = emitterStats(emitter("arc"), 1);
    expect(stats).toMatchObject({
      range: 6,
      fireRate: 2,
      baseDamage: 6,
      heatPerShot: 10.3,
      redline: 80,
    });
  });

  it("applies every per-level multiplier once per level", () => {
    const stats = emitterStats(emitter("arc"), 3);
    expect(stats.baseDamage).toBeCloseTo(6 * 1.6 * 1.6, 10);
    expect(stats.range).toBeCloseTo(8, 10);
    expect(stats.fireRate).toBeCloseTo(2 * 1.15 * 1.15, 10);
    expect(stats.heatPerShot).toBeCloseTo(10.3 * 1.3 * 1.3, 10);
  });

  it("leaves the redline and the mass alone", () => {
    for (const level of [1, 2, 3]) {
      expect(emitterStats(emitter("lance"), level).redline).toBe(92);
    }
  });

  it("prices II at the build cost and III at 1.8 times it", () => {
    expect(upgradeCost(TOWER_DEFS.arc, 1)).toBe(15);
    expect(upgradeCost(TOWER_DEFS.arc, 2)).toBe(27);
    expect(upgradeCost(TOWER_DEFS.arc, 3)).toBe(0);
  });
});

describe("the surge", () => {
  it("lists six types with the stats the specification states", () => {
    expect(SURGE_TYPES).toHaveLength(6);
    expect(SURGE_DEFS.mote).toMatchObject({
      hp: 40,
      speed: 60,
      bounty: 3,
      leak: 1,
    });
    expect(SURGE_DEFS.sprint).toMatchObject({ hp: 24, speed: 120 });
    expect(SURGE_DEFS.hulk).toMatchObject({ hp: 220, speed: 38, leak: 2 });
    expect(SURGE_DEFS.swarm).toMatchObject({ hp: 12, speed: 70, bounty: 2 });
    expect(SURGE_DEFS.drift).toMatchObject({ hp: 60, speed: 80, flies: true });
    expect(SURGE_DEFS.core).toMatchObject({
      hp: 1600,
      speed: 30,
      slowable: false,
      bounty: 90,
      leak: 5,
    });
  });

  it("makes the Drift the one flyer and the Core the one immune type", () => {
    expect(SURGE_TYPES.filter((type) => SURGE_DEFS[type].flies)).toEqual([
      "drift",
    ]);
    expect(SURGE_TYPES.filter((type) => !SURGE_DEFS[type].slowable)).toEqual([
      "core",
    ]);
  });
});
