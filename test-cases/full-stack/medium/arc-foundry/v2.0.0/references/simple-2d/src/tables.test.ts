// The figures the specification fixes, checked against the tables it states them in.
//
// `src/constants.ts` states each figure once and `src/tables.ts` folds them into the
// blocks the simulation fires from, so what is checked here is that the fold reproduces
// the tables `specs/components.md`, `specs/combinations.md`, `specs/scrap-press.md`,
// `specs/enemies.md`, and `specs/economy.md` state.

import { describe, expect, it } from "vitest";

import {
  ARCNODE_SPLASH,
  BASE_STATS,
  COMBOS,
  COMBO_DAMAGE_MULT,
  COMBO_RANGE_BONUS,
  COMPONENT_TYPES,
  DIFFICULTIES,
  MAPS,
  MAX_QUALITY,
  PROJECTILE_HIT_R,
  PROJECTILE_SPEED,
  REFINEMENT_COSTS,
  REFINEMENT_MAX,
  REFINEMENT_ODDS,
  STAMPS_PER_LEVEL,
  TYPE_ROLL_ODDS,
  type ComponentType,
  type Difficulty,
} from "./constants";
import {
  COMBO_BY_ID,
  baseStats,
  comboStats,
  comboUpgradeCost,
  milestoneWaves,
  scaledHealth,
  waveClearBonus,
} from "./tables";

const QUALITIES = [1, 2, 3, 4, 5];

describe("the quality ladder", () => {
  // specs/components.md, "Damage by type and tier".
  const damage: Readonly<Record<string, number[]>> = {
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
      for (const q of QUALITIES) {
        expect(baseStats(type as ComponentType, q).dmg).toBe(row[q - 1]);
      }
    }
  });

  it("adds eight units of range per rung above Scrap", () => {
    for (const type of COMPONENT_TYPES) {
      const base = BASE_STATS[type].range;
      if (base === null) continue;
      for (const q of QUALITIES) {
        expect(baseStats(type, q).range).toBe(base + 8 * (q - 1));
      }
    }
  });

  it("holds a type's fire rate flat across the ladder", () => {
    for (const type of COMPONENT_TYPES) {
      for (const q of QUALITIES) {
        expect(baseStats(type, q).fireRate).toBe(
          BASE_STATS[type].fireRate ?? 0,
        );
      }
    }
  });

  it("gives the Regulator an aura and no range, damage, or cadence", () => {
    for (const q of QUALITIES) {
      const st = baseStats("regulator", q);
      expect(st.fires).toBe(false);
      expect(st.range).toBe(0);
      expect(st.dmg).toBe(0);
      expect(st.fireRate).toBe(0);
      expect(st.auraRadius).toBe(90 + 6 * (q - 1));
      expect(st.auraBonus).toBeCloseTo(0.1 + 0.03 * (q - 1), 10);
    }
  });

  it("steps the signature numbers per rung", () => {
    for (const q of QUALITIES) {
      expect(baseStats("arcnode", q).splash).toBe(42 + 5 * (q - 1));
      expect(baseStats("choke", q).slowAmt).toBeCloseTo(
        0.22 + 0.03 * (q - 1),
        10,
      );
      expect(baseStats("choke", q).slowDur).toBe(1.2);
      expect(baseStats("coil", q).chainLeaps).toBe([2, 2, 3, 3, 4][q - 1]);
      // The Rectifier's burn is flat at every rung.
      expect(baseStats("rectifier", q).burnFrac).toBe(0.5);
      expect(baseStats("rectifier", q).burnDur).toBe(2);
    }
    expect([...ARCNODE_SPLASH]).toEqual([42, 47, 52, 57, 62]);
  });

  it("carries no crit and no multishot on any base component", () => {
    for (const type of COMPONENT_TYPES) {
      for (const q of QUALITIES) {
        expect(baseStats(type, q).critChance).toBe(0);
        expect(baseStats(type, q).multishot).toBe(1);
      }
    }
  });
});

describe("the press", () => {
  it("rolls the eight types uniformly", () => {
    expect(TYPE_ROLL_ODDS).toBe(0.125);
    expect(COMPONENT_TYPES.length * TYPE_ROLL_ODDS).toBeCloseTo(1, 10);
  });

  it("grants five stamps a level", () => {
    expect(STAMPS_PER_LEVEL).toBe(5);
  });

  it("holds one five-rung distribution per refinement level", () => {
    expect(REFINEMENT_ODDS).toHaveLength(REFINEMENT_MAX + 1);
    for (const row of REFINEMENT_ODDS) {
      expect(row).toHaveLength(MAX_QUALITY);
      expect(row.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    }
    expect([...REFINEMENT_ODDS[0]!]).toEqual([1, 0, 0, 0, 0]);
    expect([...REFINEMENT_ODDS[8]!]).toEqual([0, 0.3, 0.3, 0.3, 0.1]);
  });

  it("charges the stated cost for each refinement rung", () => {
    expect([...REFINEMENT_COSTS]).toEqual([
      20, 50, 80, 110, 140, 170, 200, 230,
    ]);
  });
});

describe("the combination towers", () => {
  it("holds twelve, each with its recipe", () => {
    expect(COMBOS).toHaveLength(12);
    for (const combo of COMBOS) {
      expect(combo.recipe.length).toBeGreaterThanOrEqual(3);
    }
    // The Singularity's recipe calls for two Arc-Nodes at different rungs.
    const arcnodes = COMBO_BY_ID.singularity.recipe.filter(
      (i) => i.type === "arcnode",
    );
    expect(arcnodes.map((i) => i.tier).sort()).toEqual([2, 5]);
  });

  it("lands at half its reference damage and reaches past it at level three", () => {
    expect([...COMBO_DAMAGE_MULT]).toEqual([0.5, 0.63, 0.78, 1.02]);
    expect([...COMBO_RANGE_BONUS]).toEqual([0, 4, 8, 12]);
    for (const ref of COMBOS) {
      for (let level = 0; level <= 3; level++) {
        const st = comboStats(ref.id, level);
        expect(st.dmg).toBeCloseTo(ref.damage * COMBO_DAMAGE_MULT[level]!, 9);
        expect(st.range).toBe(ref.range + COMBO_RANGE_BONUS[level]!);
        // Fire rate and every ability parameter are flat across level.
        expect(st.fireRate).toBe(ref.fireRate);
        expect(st.splash).toBe(ref.abilities.splash?.radius ?? 0);
        expect(st.critChance).toBe(ref.abilities.crit?.chance ?? 0);
        expect(st.multishot).toBe(ref.abilities.multishot?.targets ?? 1);
      }
    }
  });

  it("prices an upgrade as a fraction of the reference damage, halves up", () => {
    for (const ref of COMBOS) {
      expect(comboUpgradeCost(ref.id, 0)).toBe(Math.round(ref.damage * 0.8));
      expect(comboUpgradeCost(ref.id, 1)).toBe(Math.round(ref.damage * 1.5));
      expect(comboUpgradeCost(ref.id, 2)).toBe(Math.round(ref.damage * 2.8));
      expect(comboUpgradeCost(ref.id, 3)).toBeNull();
    }
  });
});

describe("the per-wave health scaling", () => {
  const formula = (base: number, w: number, d: Difficulty): number =>
    Math.round(
      base *
        d.baseMult *
        (1 + d.k * (w - 1) + d.c * (Math.pow(d.r, w - 1) - 1)),
    );

  it("is a whole number at every wave of every difficulty", () => {
    for (const d of DIFFICULTIES) {
      for (let w = 1; w <= d.waves; w++) {
        const hp = scaledHealth(44, w, d);
        expect(Number.isInteger(hp)).toBe(true);
        expect(hp).toBe(formula(44, w, d));
      }
    }
  });

  it("puts the surcharge at exactly zero on wave one", () => {
    for (const d of DIFFICULTIES) {
      expect(scaledHealth(1000, 1, d)).toBe(Math.round(1000 * d.baseMult));
    }
  });

  it("matches the figures the specification states for Medium", () => {
    const medium = DIFFICULTIES.find((d) => d.id === "medium")!;
    // A Mote's 44 * 0.22 = 9.68 is 10 health; a Filament's 74 * 0.22 = 16.28 is 16.
    expect(scaledHealth(44, 1, medium)).toBe(10);
    expect(scaledHealth(74, 1, medium)).toBe(16);
  });

  it("rounds an exact half up", () => {
    const half: Difficulty = {
      ...DIFFICULTIES[0]!,
      baseMult: 0.5,
      k: 0,
      c: 0,
    };
    expect(scaledHealth(5, 1, half)).toBe(3);
  });

  it("only ever rises with the wave", () => {
    for (const d of DIFFICULTIES) {
      let last = 0;
      for (let w = 1; w <= d.waves; w++) {
        const hp = scaledHealth(180, w, d);
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
      for (const wp of map.waypoints) {
        expect(wp.col).toBeGreaterThanOrEqual(4);
        expect(wp.col).toBeLessThanOrEqual(45);
        expect(wp.row).toBeGreaterThanOrEqual(4);
        expect(wp.row).toBeLessThanOrEqual(28);
      }
    }
  });

  it("puts a Dynamo on the half-way wave and the last", () => {
    for (const d of DIFFICULTIES) {
      expect(milestoneWaves(d)).toEqual([Math.round(d.waves / 2), d.waves]);
    }
  });

  it("gives every shot one travel speed and one hit radius", () => {
    expect(PROJECTILE_SPEED).toBe(520);
    expect(PROJECTILE_HIT_R).toBe(6);
  });
});
