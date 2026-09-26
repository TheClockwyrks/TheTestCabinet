import { describe, expect, it } from "vitest";
import { TILE, heatMultiplier } from "./constants";
import { addTower } from "./build";
import { createState } from "./state";
import {
  centreOf,
  createTower,
  damageOf,
  heatMultOf,
  isEmitterTower,
  outputOf,
  radiatorFaces,
  rangeUnits,
  redlineOf,
  refundOf,
  slowFactorOf,
  towerAtPoint,
  towerAtTile,
  towerById,
  upgradeCostOfTower,
  worldSide,
} from "./towers";

describe("rotation", () => {
  it("turns a local face one step per rotation, N to E to S to W", () => {
    expect(worldSide("N", 0)).toBe("N");
    expect(worldSide("N", 1)).toBe("E");
    expect(worldSide("N", 2)).toBe("S");
    expect(worldSide("N", 3)).toBe("W");
    expect(worldSide("W", 1)).toBe("N");
  });

  it("reports a tower's radiator faces in world orientation", () => {
    expect(radiatorFaces(createTower(1, "arc", 0, 0, 0))).toEqual(["N", "S"]);
    expect(radiatorFaces(createTower(1, "arc", 0, 0, 1))).toEqual(["E", "W"]);
    expect(radiatorFaces(createTower(1, "rime", 0, 0, 2))).toEqual([
      "S",
      "N",
      "W",
    ]);
  });

  it("gives a mover no radiator faces at any rotation", () => {
    for (const rotation of [0, 1, 2, 3] as const) {
      expect(radiatorFaces(createTower(1, "forge", 0, 0, rotation))).toEqual(
        [],
      );
      expect(radiatorFaces(createTower(1, "sink", 0, 0, rotation))).toEqual([]);
    }
  });
});

describe("a tower's derived reads", () => {
  it("measures range from the footprint's centre, at every size", () => {
    const lance = createTower(1, "lance", 10, 10, 0);
    expect(centreOf(lance)).toEqual({ x: 18 + 190 + 38, y: 18 + 190 + 38 });
    expect(rangeUnits(lance)).toBeCloseTo(12 * TILE, 10);
  });

  it("reads a live multiplier and a live per-shot damage off the heat", () => {
    const arc = createTower(1, "arc", 0, 0, 0);
    arc.heat = 40;
    expect(heatMultOf(arc)).toBeCloseTo(heatMultiplier(40, 80), 10);
    expect(damageOf(arc)).toBeCloseTo(6 * heatMultiplier(40, 80), 10);
  });

  it("reads the Rime like any other emitter, plus its slow", () => {
    const rime = createTower(1, "rime", 0, 0, 0);
    rime.heat = 0;
    expect(damageOf(rime)).toBeCloseTo(4 * 0.35, 10);
    expect(slowFactorOf(rime)).toBeCloseTo(0.55, 10);
    rime.heat = 50;
    expect(slowFactorOf(rime)).toBeCloseTo(0.275, 10);
    expect(damageOf(rime)).toBeCloseTo(4 * heatMultiplier(50, 100), 10);
    rime.heat = 100;
    expect(slowFactorOf(rime)).toBeCloseTo(0, 10);
    expect(damageOf(rime)).toBeCloseTo(4 * 3.5, 10);
  });

  it("reports nothing but its output for a mover", () => {
    const sink = createTower(1, "sink", 0, 0, 0);
    expect(isEmitterTower(sink)).toBe(false);
    expect(heatMultOf(sink)).toBe(0);
    expect(damageOf(sink)).toBe(0);
    expect(slowFactorOf(sink)).toBe(0);
    expect(redlineOf(sink)).toBe(0);
    expect(outputOf(sink)).toBe(16);
    sink.level = 3;
    expect(outputOf(sink)).toBe(36);
  });

  it("refunds in full while fresh and seventy percent afterward", () => {
    const bloom = createTower(1, "bloom", 0, 0, 0);
    expect(refundOf(bloom)).toBe(150);
    bloom.fresh = false;
    expect(refundOf(bloom)).toBe(105);
    bloom.spent = 155;
    expect(refundOf(bloom)).toBe(Math.floor(0.7 * 155));
  });

  it("stops charging for an upgrade at the ceiling", () => {
    const arc = createTower(1, "arc", 0, 0, 0);
    expect(upgradeCostOfTower(arc)).toBe(15);
    arc.level = 2;
    expect(upgradeCostOfTower(arc)).toBe(27);
    arc.level = 3;
    expect(upgradeCostOfTower(arc)).toBe(0);
  });
});

describe("finding a tower", () => {
  it("finds one by id, by tile, and by a point on its footprint", () => {
    const state = createState();
    const tower = addTower(state, "bloom", 6, 6, 0);
    expect(towerById(state.towers, tower.id)).toBe(tower);
    expect(towerById(state.towers, 999)).toBeNull();
    expect(towerAtTile(state.towers, state.floor, 7, 7)).toBe(tower);
    expect(towerAtTile(state.towers, state.floor, 9, 9)).toBeNull();
    const centre = centreOf(tower);
    expect(towerAtPoint(state.towers, state.floor, centre.x, centre.y)).toBe(
      tower,
    );
    expect(towerAtPoint(state.towers, state.floor, 5, 5)).toBeNull();
  });
});
