// A tower's and a unit's live figures, all of them derived and none stored.

import { describe, expect, it } from "vitest";
import {
  FORGE_SETPOINT,
  MAX_LEVEL,
  REFUND_RATE,
  RIME_SLOW_CEIL,
  SINK_OUTPUT,
  SURGE_DEFS,
  TILE,
  TOWER_DEFS,
  TOWER_TYPES,
  UPGRADE_COST_MULT,
  UPGRADE_DAMAGE,
  UPGRADE_FIRE_RATE,
  UPGRADE_HEAT,
  UPGRADE_RANGE,
  emitterStats,
  upgradeCost,
} from "./constants";
import { worldFaces } from "./geometry";
import { createHarness, poseTower, startRun, type Harness } from "./harness";

function towerOf(harness: Harness, id: number) {
  const tower = harness.debug.snapshot().towers.find((t) => t.id === id);
  if (tower === undefined) throw new Error(`no tower ${id}`);
  return tower;
}

describe("the level scaling", () => {
  it("moves four figures per level and no others", () => {
    for (const type of TOWER_TYPES) {
      const def = TOWER_DEFS[type];
      if (def.kind !== "emitter") continue;
      const one = emitterStats(def, 1);
      const three = emitterStats(def, 3);
      expect(three.baseDamage).toBeCloseTo(
        one.baseDamage * UPGRADE_DAMAGE ** 2,
        8,
      );
      expect(three.range).toBeCloseTo(one.range + 2 * UPGRADE_RANGE, 8);
      expect(three.fireRate).toBeCloseTo(
        one.fireRate * UPGRADE_FIRE_RATE ** 2,
        8,
      );
      expect(three.heatPerShot).toBeCloseTo(
        one.heatPerShot * UPGRADE_HEAT ** 2,
        8,
      );
    }
  });

  it("leaves the size, the redline, the mass and the radiators alone", async () => {
    const harness = await createHarness();
    startRun(harness);
    for (const type of TOWER_TYPES) {
      harness.debug.clearTowers();
      const id = poseTower(harness, type, 10, 10, 1);
      const one = towerOf(harness, id);
      harness.debug.setTowerLevel(id, MAX_LEVEL);
      const three = towerOf(harness, id);
      expect(three.size).toBe(one.size);
      expect(three.redline).toBe(one.redline);
      expect(three.radiatorFaces).toEqual(one.radiatorFaces);
      expect(three.rotation).toBe(one.rotation);
    }
    harness.dispose();
  });

  it("costs the build cost to reach level II and 1.8 times it for level III", () => {
    for (const type of TOWER_TYPES) {
      const def = TOWER_DEFS[type];
      expect(upgradeCost(def, 1)).toBe(
        Math.round(def.cost * UPGRADE_COST_MULT[0]),
      );
      expect(upgradeCost(def, 2)).toBe(
        Math.round(def.cost * UPGRADE_COST_MULT[1]),
      );
      expect(upgradeCost(def, 3)).toBe(0);
    }
    expect(upgradeCost(TOWER_DEFS.arc, 1)).toBe(15);
    expect(upgradeCost(TOWER_DEFS.arc, 2)).toBe(27);
  });
});

describe("the movers", () => {
  it("moves a mover's own output alone with its level", async () => {
    const harness = await createHarness();
    startRun(harness);
    const forge = poseTower(harness, "forge", 10, 10, 0);
    const sink = poseTower(harness, "sink", 16, 10, 0);
    for (const level of [1, 2, 3]) {
      harness.debug.setTowerLevel(forge, level);
      harness.debug.setTowerLevel(sink, level);
      expect(towerOf(harness, forge).output).toBe(FORGE_SETPOINT[level - 1]);
      expect(towerOf(harness, sink).output).toBe(SINK_OUTPUT[level - 1]);
      expect(towerOf(harness, forge).heat).toBe(0);
      expect(towerOf(harness, sink).heat).toBe(0);
    }
    harness.dispose();
  });

  it("gives a mover no radiator faces at any rotation", async () => {
    const harness = await createHarness();
    startRun(harness);
    for (const rotation of [0, 1, 2, 3]) {
      harness.debug.clearTowers();
      const id = poseTower(harness, "forge", 10, 10, rotation);
      expect(towerOf(harness, id).radiatorFaces).toEqual([]);
    }
    harness.dispose();
  });
});

describe("rotation", () => {
  it("turns local faces N -> E -> S -> W, one step per rotation", () => {
    expect(worldFaces(["N"], 0)).toEqual(["N"]);
    expect(worldFaces(["N"], 1)).toEqual(["E"]);
    expect(worldFaces(["N"], 2)).toEqual(["S"]);
    expect(worldFaces(["N"], 3)).toEqual(["W"]);
    expect(worldFaces(["N", "S"], 1)).toEqual(["E", "W"]);
  });

  it("reports a tower's radiator faces in world orientation", async () => {
    const harness = await createHarness();
    startRun(harness);
    // The Arc's local radiators are N and S.
    const id = poseTower(harness, "arc", 10, 10, 1);
    expect(towerOf(harness, id).radiatorFaces).toEqual(["E", "W"]);
    harness.dispose();
  });
});

describe("the refund", () => {
  it("pays everything spent while fresh, and seventy percent after", async () => {
    const harness = await createHarness();
    startRun(harness);
    const id = poseTower(harness, "arc", 10, 10, 0);
    harness.debug.setMoney(1000);
    harness.debug.upgradeTower(id);
    const spent = TOWER_DEFS.arc.cost + upgradeCost(TOWER_DEFS.arc, 1);
    expect(towerOf(harness, id).spent).toBe(spent);
    expect(towerOf(harness, id).refund).toBe(spent);
    harness.debug.setTowerFresh(id, false);
    expect(towerOf(harness, id).refund).toBe(Math.floor(REFUND_RATE * spent));
    harness.dispose();
  });
});

describe("a Rime's slow read", () => {
  it("falls to nothing as it heats, at every level", async () => {
    const harness = await createHarness();
    startRun(harness);
    const id = poseTower(harness, "rime", 10, 10, 0);
    for (const level of [1, 2, 3]) {
      harness.debug.setTowerLevel(id, level);
      harness.debug.setTowerHeat(id, 0);
      expect(towerOf(harness, id).slowFactor).toBeCloseTo(
        RIME_SLOW_CEIL[level - 1],
        8,
      );
      harness.debug.setTowerHeat(id, 50);
      expect(towerOf(harness, id).slowFactor).toBeCloseTo(
        RIME_SLOW_CEIL[level - 1] * 0.5,
        8,
      );
      harness.debug.setTowerHeat(id, 100);
      expect(towerOf(harness, id).slowFactor).toBe(0);
    }
    harness.dispose();
  });

  it("reports the ordinary damage of an emitter beside it", async () => {
    const harness = await createHarness();
    startRun(harness);
    const id = poseTower(harness, "rime", 10, 10, 0);
    harness.debug.setTowerHeat(id, 100);
    const read = towerOf(harness, id);
    expect(read.redline).toBe(100);
    expect(read.heatMult).toBeCloseTo(3.5, 8);
    expect(read.damage).toBeCloseTo(4 * 3.5, 8);
    expect(read.output).toBe(0);
    harness.dispose();
  });

  it("reports no slow on any other tower", async () => {
    const harness = await createHarness();
    startRun(harness);
    for (const type of TOWER_TYPES) {
      if (type === "rime") continue;
      harness.debug.clearTowers();
      const id = poseTower(harness, type, 10, 10, 0);
      expect(towerOf(harness, id).slowFactor).toBe(0);
    }
    harness.dispose();
  });
});

describe("a unit's figures", () => {
  it("reports its base speed, its live speed, and its slow together", async () => {
    const harness = await createHarness();
    startRun(harness);
    harness.debug.addUnit("sprint", "left");
    const id = harness.debug.snapshot().surge[0].id;
    harness.debug.setUnitSlow(id, 0.25);
    const read = harness.debug.snapshot().surge[0];
    expect(read.baseSpeed).toBe(SURGE_DEFS.sprint.speed);
    expect(read.speed).toBeCloseTo(SURGE_DEFS.sprint.speed * 0.75, 8);
    expect(read.slowed).toBe(true);
    harness.dispose();
  });

  it("measures a flyer's remaining as the straight line to its exhaust", async () => {
    const harness = await createHarness();
    startRun(harness);
    harness.debug.addUnit("drift", "top");
    const id = harness.debug.snapshot().surge[0].id;
    const before = harness.debug.snapshot().surge[0].remaining;
    harness.debug.setUnitPosition(id, 500, 690);
    const after = harness.debug.snapshot().surge[0].remaining;
    expect(after).toBeLessThan(before);
    expect(after * TILE).toBeLessThan(400);
    harness.dispose();
  });
});
