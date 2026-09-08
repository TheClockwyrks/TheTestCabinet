// The ten cues, each reached the way a player reaches it.

import { describe, expect, it } from "vitest";
import { CUES, TRIP_HEAT, tileCX, tileCY } from "./constants";
import { CUE_SPECS } from "./audio";
import {
  createHarness,
  poseTarget,
  poseTower,
  startRun,
  stepSeconds,
  type Harness,
} from "./harness";

function played(harness: Harness, cue: string): number {
  return harness.cues.filter((entry) => entry.cue === cue).length;
}

describe("the cue table", () => {
  it("defines all ten, each distinct from the other nine", () => {
    const names = Object.values(CUES);
    expect(names).toHaveLength(10);
    expect(new Set(names).size).toBe(10);
    const shapes = names.map((name) => JSON.stringify(CUE_SPECS[name]));
    expect(new Set(shapes).size).toBe(10);
  });
});

describe("a cue names one real frame", () => {
  it("sounds one fire however many shots landed in the frame", async () => {
    const harness = await createHarness();
    startRun(harness);
    const tower = poseTower(harness, "stutter", 20, 12, 0);
    harness.debug.setTowerThermal(tower, false);
    poseTarget(harness, "mote", tileCX(21), tileCY(13));
    harness.cues.length = 0;
    // One frame long enough to cover several fire intervals.
    await stepSeconds(harness, 2, 1);
    expect(harness.debug.snapshot().towers[0].damageDealt).toBeGreaterThan(0);
    expect(played(harness, CUES.fire)).toBe(1);
    harness.dispose();
  });

  it("sounds a trip on the frame the heat model carries one over", async () => {
    const harness = await createHarness();
    startRun(harness);
    const tower = poseTower(harness, "stutter", 20, 12, 0);
    harness.debug.setTowerHeat(tower, TRIP_HEAT - 1);
    poseTarget(harness, "mote", tileCX(21), tileCY(13));
    harness.cues.length = 0;
    await stepSeconds(harness, 1, 60);
    const read = harness.debug.snapshot().towers[0];
    expect(read.tripped).toBe(true);
    expect(read.firing).toBe(false);
    expect(played(harness, CUES.trip)).toBe(1);
    harness.dispose();
  });

  it("sounds a death on the frame a unit's hp reaches zero", async () => {
    const harness = await createHarness();
    startRun(harness);
    const tower = poseTower(harness, "lance", 20, 12, 0);
    harness.debug.setTowerThermal(tower, false);
    harness.debug.setTowerHeat(tower, 100);
    poseTarget(harness, "mote", tileCX(21), tileCY(13), 1);
    harness.cues.length = 0;
    await stepSeconds(harness, 2, 120);
    expect(harness.debug.snapshot().surge).toHaveLength(0);
    expect(played(harness, CUES.death)).toBe(1);
    harness.dispose();
  });

  it("sounds a leak on the frame a unit reaches its exhaust", async () => {
    const harness = await createHarness();
    startRun(harness);
    harness.debug.addUnit("mote", "left");
    const surge = harness.debug.snapshot().surge;
    harness.debug.setUnitPosition(surge[0].id, tileCX(48), tileCY(17));
    harness.cues.length = 0;
    await stepSeconds(harness, 1, 60);
    expect(harness.debug.snapshot().surge).toHaveLength(0);
    expect(played(harness, CUES.leak)).toBe(1);
    harness.dispose();
  });

  it("sounds a place on a committed placement and nothing on a refused one", async () => {
    const harness = await createHarness();
    startRun(harness);
    harness.debug.setArmed("arc");
    harness.cues.length = 0;
    await harness.press(tileCX(20), tileCY(12));
    expect(played(harness, CUES.place)).toBe(1);

    harness.debug.setMoney(0);
    harness.debug.setArmed("lance");
    harness.cues.length = 0;
    await harness.press(tileCX(30), tileCY(20));
    expect(played(harness, CUES.place)).toBe(0);
    harness.dispose();
  });

  it("sounds a sell on a sale", async () => {
    const harness = await createHarness();
    startRun(harness);
    const id = poseTower(harness, "arc", 20, 12, 0);
    harness.debug.setSelected(id);
    harness.debug.setScreen("playing");
    harness.cues.length = 0;
    harness.tap("KeyS");
    await harness.engine.advance(1);
    expect(played(harness, CUES.sell)).toBe(1);
    harness.dispose();
  });

  it("sounds a menu cue when a highlight moves, and none when it cannot", async () => {
    const harness = await createHarness();
    harness.debug.setScreen("modeselect");
    harness.debug.setMenuIndex(0);
    harness.cues.length = 0;
    harness.tap("ArrowDown");
    await harness.engine.advance(1);
    expect(played(harness, CUES.menu)).toBe(1);

    harness.debug.setScreen("playing");
    harness.cues.length = 0;
    harness.tap("ArrowDown");
    await harness.engine.advance(1);
    expect(played(harness, CUES.menu)).toBe(0);
    harness.dispose();
  });

  it("sounds no cue for an operation of the debug surface", async () => {
    const harness = await createHarness();
    startRun(harness);
    const id = poseTower(harness, "arc", 20, 12, 0);
    harness.cues.length = 0;
    harness.debug.setArmed("arc");
    harness.debug.setPreview(30, 20);
    harness.debug.place();
    harness.debug.setTowerTripped(id, true);
    harness.debug.sellTower(id);
    harness.debug.setScreen("victory");
    harness.debug.setMenuIndex(1);
    expect(harness.cues).toHaveLength(0);
    harness.dispose();
  });
});
