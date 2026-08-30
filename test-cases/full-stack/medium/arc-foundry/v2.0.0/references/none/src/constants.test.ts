// The figures the specification fixes, checked against the tables it states them in.

import { describe, expect, it } from "vitest";

import {
  ARC_SPLASH_BY_TIER,
  BUILDS_PER_LEVEL,
  COMBOS,
  COMBO_LEVEL_DMG_MULT,
  COMBO_LEVEL_RANGE_ADD,
  COMBO_ORDER,
  COMPONENT_ORDER,
  COMPONENTS,
  DIFFICULTY,
  MAPS,
  MAX_REFINEMENT,
  PROJECTILE_SPEED,
  PROJECTILE_HIT_R,
  QUALITY_ODDS_BY_R,
  REFINE_COST,
  STAMP_TYPE_WEIGHT,
  comboStats,
  comboUpgradeCost,
  deriveStats,
  scaledHp,
  waveClearBonus,
} from "./constants";
import type { ComponentType, Tier } from "./types";

const TIERS: Tier[] = [1, 2, 3, 4, 5];

describe("the quality ladder", () => {
  // specs/components.md, "Damage by type and tier".
  const damage: Record<string, number[]> = {
    capacitor: [6, 18, 54, 240, 660],
    coil: [5, 15, 45, 200, 550],
    emitter: [2, 6, 18, 80, 220],
    arcnode: [5, 15, 45, 200, 550],
    discharge: [18, 54, 162, 720, 1980],
    choke: [3, 9, 27, 120, 330],
    rectifier: [2, 6, 18, 80, 220],
  };
  it("scales damage by the quality multiplier", () => {
    for (const [type, row] of Object.entries(damage)) {
      for (const tier of TIERS) {
        expect(deriveStats(type as ComponentType, tier).dmg).toBe(
          row[tier - 1],
        );
      }
    }
  });

  // specs/components.md, "Range by type and tier": baseRange + 8 per tier above Scrap.
  it("adds eight units of range per tier", () => {
    for (const type of COMPONENT_ORDER) {
      if (type === "regulator") continue;
      const base = COMPONENTS[type].range;
      for (const tier of TIERS) {
        expect(deriveStats(type, tier).range).toBe(base + 8 * (tier - 1));
      }
    }
  });

  it("holds a type's fire rate flat across the ladder", () => {
    for (const type of COMPONENT_ORDER) {
      for (const tier of TIERS) {
        expect(deriveStats(type, tier).fireRate).toBe(
          COMPONENTS[type].fireRate,
        );
      }
    }
  });

  it("gives the Regulator an aura and no range, damage, or cadence", () => {
    for (const tier of TIERS) {
      const st = deriveStats("regulator", tier);
      expect(st.fires).toBe(false);
      expect(st.range).toBe(0);
      expect(st.dmg).toBe(0);
      expect(st.fireRate).toBe(0);
      expect(st.auraRadius).toBe(90 + 6 * (tier - 1));
      expect(st.auraBonus).toBeCloseTo(0.1 + 0.03 * (tier - 1), 10);
    }
  });

  it("steps the signature numbers per tier", () => {
    for (const tier of TIERS) {
      // specs/components.md: the Arc-Node's splash, the Choke's slow, the Coil's leaps.
      expect(deriveStats("arcnode", tier).splash).toBe(42 + 5 * (tier - 1));
      expect(deriveStats("choke", tier).slowAmt).toBeCloseTo(
        0.22 + 0.03 * (tier - 1),
        10,
      );
      expect(deriveStats("choke", tier).slowDur).toBe(1.2);
      expect(deriveStats("coil", tier).chainLeaps).toBe(
        [2, 2, 3, 3, 4][tier - 1],
      );
      // The Rectifier's burn fraction and duration are flat at every tier.
      expect(deriveStats("rectifier", tier).burnFrac).toBe(0.5);
      expect(deriveStats("rectifier", tier).burnDur).toBe(2);
    }
  });

  it("carries no crit and no multishot on any base component", () => {
    for (const type of COMPONENT_ORDER) {
      for (const tier of TIERS) {
        expect(deriveStats(type, tier).critChance).toBe(0);
        expect(deriveStats(type, tier).multishot).toBe(1);
      }
    }
  });
});

describe("the press", () => {
  it("rolls the eight types uniformly", () => {
    for (const type of COMPONENT_ORDER)
      expect(STAMP_TYPE_WEIGHT[type]).toBe(0.125);
    const total = COMPONENT_ORDER.reduce((n, t) => n + STAMP_TYPE_WEIGHT[t], 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it("grants five stamps a level", () => {
    expect(BUILDS_PER_LEVEL).toBe(5);
  });

  // specs/scrap-press.md, "Refinement": nine rungs, each distribution summing to one.
  it("holds one five-tier distribution per refinement level", () => {
    expect(QUALITY_ODDS_BY_R).toHaveLength(MAX_REFINEMENT + 1);
    for (const row of QUALITY_ODDS_BY_R) {
      expect(row).toHaveLength(5);
      expect(row.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    }
    expect(QUALITY_ODDS_BY_R[0]).toEqual([1, 0, 0, 0, 0]);
    expect(QUALITY_ODDS_BY_R[8]).toEqual([0, 0.3, 0.3, 0.3, 0.1]);
  });

  it("charges the stated cost for each refinement rung", () => {
    expect(REFINE_COST.slice(1)).toEqual([20, 50, 80, 110, 140, 170, 200, 230]);
  });
});

describe("the combination towers", () => {
  it("holds twelve, each with its recipe", () => {
    expect(COMBO_ORDER).toHaveLength(12);
    for (const id of COMBO_ORDER) {
      expect(COMBOS[id].recipe.length).toBeGreaterThanOrEqual(3);
    }
    // The Singularity's recipe calls for two Arc-Nodes at different tiers.
    const arcnodes = COMBOS.singularity.recipe.filter(
      (i) => i.type === "arcnode",
    );
    expect(arcnodes.map((i) => i.tier).sort()).toEqual([2, 5]);
  });

  it("lands at half its reference damage and reaches past it at level three", () => {
    expect(COMBO_LEVEL_DMG_MULT).toEqual([0.5, 0.63, 0.78, 1.02]);
    expect(COMBO_LEVEL_RANGE_ADD).toEqual([0, 4, 8, 12]);
    for (const id of COMBO_ORDER) {
      const ref = COMBOS[id];
      for (let level = 0; level <= 3; level++) {
        const st = comboStats(id, level);
        expect(st.dmg).toBe(Math.round(ref.dmg * COMBO_LEVEL_DMG_MULT[level]!));
        expect(st.range).toBe(ref.range + COMBO_LEVEL_RANGE_ADD[level]!);
        // Fire rate and every ability parameter are flat across level.
        expect(st.fireRate).toBe(ref.fireRate);
        expect(st.splash).toBe(ref.splash);
        expect(st.critChance).toBe(ref.critChance);
        expect(st.multishot).toBe(ref.multishot);
      }
    }
  });

  it("prices an upgrade as a fraction of the reference damage, halves up", () => {
    for (const id of COMBO_ORDER) {
      const ref = COMBOS[id].dmg;
      expect(comboUpgradeCost(id, 0)).toBe(Math.round(ref * 0.8));
      expect(comboUpgradeCost(id, 1)).toBe(Math.round(ref * 1.5));
      expect(comboUpgradeCost(id, 2)).toBe(Math.round(ref * 2.8));
      expect(comboUpgradeCost(id, 3)).toBeNull();
    }
  });
});

describe("the per-wave health scaling", () => {
  // specs/enemies.md: HP(w) = round(baseHP * baseMult * [(1 + k(w-1)) + c(r^(w-1) - 1)]).
  const formula = (
    baseHp: number,
    w: number,
    d: (typeof DIFFICULTY)["medium"],
  ): number =>
    Math.round(
      baseHp *
        d.baseMult *
        (1 +
          d.k * (w - 1) +
          d.surchargeC * (Math.pow(d.surchargeR, w - 1) - 1)),
    );

  it("is a whole number at every wave of every difficulty", () => {
    for (const d of Object.values(DIFFICULTY)) {
      for (let w = 1; w <= d.waves; w++) {
        const hp = scaledHp(44, w, d);
        expect(Number.isInteger(hp)).toBe(true);
        expect(hp).toBe(formula(44, w, d));
      }
    }
  });

  it("puts the surcharge at exactly zero on wave one", () => {
    for (const d of Object.values(DIFFICULTY)) {
      expect(scaledHp(1000, 1, d)).toBe(Math.round(1000 * d.baseMult));
    }
  });

  it("matches the figures the specification states for Medium", () => {
    // A Mote's 44 * 0.22 = 9.68 is 10 health; a Filament's 74 * 0.22 = 16.28 is 16.
    expect(scaledHp(44, 1, DIFFICULTY.medium)).toBe(10);
    expect(scaledHp(74, 1, DIFFICULTY.medium)).toBe(16);
  });

  it("rounds an exact half up", () => {
    // A base of 50 at a baseMult of 0.2 and wave 1 lands on 10 exactly; 2.5 must reach 3.
    const half = { ...DIFFICULTY.easy, baseMult: 0.5, k: 0, surchargeC: 0 };
    expect(scaledHp(5, 1, half)).toBe(3);
  });

  it("only ever rises with the wave", () => {
    for (const d of Object.values(DIFFICULTY)) {
      let last = 0;
      for (let w = 1; w <= d.waves; w++) {
        const hp = scaledHp(180, w, d);
        expect(hp).toBeGreaterThanOrEqual(last);
        last = hp;
      }
    }
  });
});

describe("the economy and the maps", () => {
  it("pays ten Charge for clearing wave one and two more per wave", () => {
    expect(waveClearBonus(1)).toBe(10);
    expect(waveClearBonus(2)).toBe(12);
    expect(waveClearBonus(10)).toBe(28);
  });

  it("holds three maps, each with six waypoints inset from every edge", () => {
    expect(MAPS).toHaveLength(3);
    for (const map of MAPS) {
      expect(map.waypoints).toHaveLength(6);
      for (const w of map.waypoints) {
        expect(w.col).toBeGreaterThanOrEqual(4);
        expect(w.col).toBeLessThanOrEqual(45);
        expect(w.row).toBeGreaterThanOrEqual(4);
        expect(w.row).toBeLessThanOrEqual(28);
      }
    }
  });

  it("puts a Dynamo on the half-way wave and the last", () => {
    for (const d of Object.values(DIFFICULTY)) {
      expect(d.milestones).toEqual([Math.round(d.waves / 2), d.waves]);
    }
  });

  it("gives every shot one travel speed and one hit radius", () => {
    expect(PROJECTILE_SPEED).toBe(520);
    expect(PROJECTILE_HIT_R).toBe(6);
  });

  it("holds the Arc-Node's splash radius by tier", () => {
    expect(ARC_SPLASH_BY_TIER).toEqual([42, 47, 52, 57, 62]);
  });
});
