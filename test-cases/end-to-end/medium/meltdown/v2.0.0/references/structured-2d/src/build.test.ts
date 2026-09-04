// Arming, previewing, placing, upgrading, and selling.

import { describe, expect, it } from "vitest";
import { COLS, ROWS, TOWER_DEFS, tileCX, tileCY } from "./constants";
import { footprintValid, previewTileFor, wouldSeal } from "./build";
import { meltdownState } from "./game";
import {
  createHarness,
  poseTower,
  startRun,
  stepSeconds,
  type Harness,
} from "./harness";

function towerAt(harness: Harness, id: number) {
  const read = harness.debug.snapshot().towers.find((t) => t.id === id);
  if (read === undefined) throw new Error(`no tower ${id}`);
  return read;
}

describe("arming and the preview", () => {
  it("holds a preview, and a second type replaces it at rotation 0", async () => {
    const harness = await createHarness();
    startRun(harness);
    harness.debug.setArmed("arc");
    harness.debug.setPreviewRotation(3);
    expect(harness.debug.snapshot().build?.rotation).toBe(3);
    harness.debug.setArmed("flak");
    const build = harness.debug.snapshot().build;
    expect(build?.type).toBe("flak");
    expect(build?.rotation).toBe(0);
    harness.debug.setArmed(null);
    expect(harness.debug.snapshot().build).toBeNull();
    harness.dispose();
  });

  it("follows the pointer and stays wholly on the grid", async () => {
    const harness = await createHarness();
    startRun(harness);
    harness.debug.setArmed("lance");
    harness.debug.pointerMove(tileCX(20), tileCY(15));
    const at = previewTileFor("lance", tileCX(20), tileCY(15));
    expect(harness.debug.snapshot().build).toMatchObject({
      col: at.col,
      row: at.row,
    });

    // The preview follows the pointer over the FLOOR, and the clamp keeps the
    // whole footprint on the grid at the far corner.
    harness.debug.pointerMove(tileCX(COLS - 1), tileCY(ROWS - 1));
    const clamped = harness.debug.snapshot().build;
    expect(clamped?.col).toBe(COLS - 4);
    expect(clamped?.row).toBe(ROWS - 4);
    harness.dispose();
  });

  it("reads invalid when the footprint runs off the grid", async () => {
    const harness = await createHarness();
    startRun(harness);
    const state = meltdownState(harness.engine.world);
    expect(footprintValid(state, "lance", COLS - 4, 10)).toBe(true);
    expect(footprintValid(state, "lance", COLS - 3, 10)).toBe(false);
    harness.dispose();
  });

  it("reads invalid when the type is unaffordable", async () => {
    const harness = await createHarness();
    startRun(harness);
    harness.debug.setArmed("arc");
    harness.debug.setPreview(10, 10);
    expect(harness.debug.snapshot().build?.valid).toBe(true);
    harness.debug.setMoney(TOWER_DEFS.arc.cost - 1);
    expect(harness.debug.snapshot().build?.valid).toBe(false);
    harness.dispose();
  });

  it("reads invalid over a tower, and over a tile a unit stands on", async () => {
    const harness = await createHarness();
    startRun(harness);
    poseTower(harness, "arc", 10, 10, 0);
    harness.debug.setArmed("arc");
    harness.debug.setPreview(10, 10);
    expect(harness.debug.snapshot().build?.valid).toBe(false);

    harness.debug.setPreview(20, 20);
    expect(harness.debug.snapshot().build?.valid).toBe(true);
    harness.debug.addUnit("mote", "left");
    const unit = harness.debug.snapshot().surge[0];
    harness.debug.setUnitPosition(unit.id, tileCX(20), tileCY(20));
    expect(harness.debug.snapshot().build?.valid).toBe(false);
    harness.dispose();
  });

  it("refuses a placement that would seal the floor", async () => {
    const harness = await createHarness();
    startRun(harness);
    const state = meltdownState(harness.engine.world);
    const wall: { col: number; row: number }[] = [];
    for (let row = 0; row < ROWS; row += 1) wall.push({ col: 25, row });
    expect(wouldSeal(state, wall)).toBe(true);
    expect(wouldSeal(state, [{ col: 25, row: 10 }])).toBe(false);
    harness.dispose();
  });
});

describe("placing", () => {
  it("deducts the cost, blocks the tiles, and re-paths", async () => {
    const harness = await createHarness();
    startRun(harness);
    const before = harness.debug.snapshot();
    harness.debug.setArmed("lance");
    // A 4x4 across the left corridor covers all four of its rows, so the route
    // through it has to go around.
    harness.debug.setPreview(25, 16);
    harness.debug.place();
    const after = harness.debug.snapshot();
    expect(after.money).toBe(before.money - TOWER_DEFS.lance.cost);
    expect(after.towers).toHaveLength(1);
    expect(after.towers[0]).toMatchObject({ col: 25, row: 16, level: 1 });
    expect(after.towers[0].heat).toBe(0);
    expect(after.towers[0].spent).toBe(TOWER_DEFS.lance.cost);
    expect(after.towers[0].fresh).toBe(true);
    expect(after.paths.left.length).toBeGreaterThan(before.paths.left.length);
    harness.dispose();
  });

  it("builds and spends nothing on an invalid footprint", async () => {
    const harness = await createHarness();
    startRun(harness);
    poseTower(harness, "arc", 10, 10, 0);
    const before = harness.debug.snapshot();
    harness.debug.setArmed("arc");
    harness.debug.setPreview(10, 10);
    harness.debug.place();
    const after = harness.debug.snapshot();
    expect(after.money).toBe(before.money);
    expect(after.towers).toHaveLength(1);
    harness.dispose();
  });

  it("stays armed until the next copy is unaffordable", async () => {
    const harness = await createHarness();
    startRun(harness);
    harness.debug.setMoney(TOWER_DEFS.arc.cost * 2);
    harness.debug.setArmed("arc");
    harness.debug.setPreview(10, 10);
    harness.debug.place();
    expect(harness.debug.snapshot().build?.type).toBe("arc");
    harness.debug.setPreview(14, 10);
    harness.debug.place();
    expect(harness.debug.snapshot().build).toBeNull();
    harness.dispose();
  });

  it("lands at the held rotation, which nothing changes afterwards", async () => {
    const harness = await createHarness();
    startRun(harness);
    harness.debug.setArmed("arc");
    harness.debug.setPreview(10, 10);
    harness.debug.setPreviewRotation(1);
    harness.debug.place();
    const tower = harness.debug.snapshot().towers[0];
    expect(tower.rotation).toBe(1);
    // The Arc's local radiators are N and S; one step turns them to E and W.
    expect(tower.radiatorFaces).toEqual(["E", "W"]);
    harness.dispose();
  });
});

describe("upgrading", () => {
  it("raises the level, spends the cost, and scales the stats", async () => {
    const harness = await createHarness();
    startRun(harness);
    const id = poseTower(harness, "arc", 10, 10, 0);
    const before = harness.debug.snapshot();
    const cost = towerAt(harness, id).upgradeCost;
    expect(cost).toBe(15);
    harness.debug.upgradeTower(id);
    const after = towerAt(harness, id);
    expect(after.level).toBe(2);
    expect(after.spent).toBe(TOWER_DEFS.arc.cost + cost);
    expect(harness.debug.snapshot().money).toBe(before.money - cost);
    expect(after.damage).toBeCloseTo(6 * 1.6 * 0.35, 8);
    harness.dispose();
  });

  it("changes nothing when it is unaffordable, and stops at level three", async () => {
    const harness = await createHarness();
    startRun(harness);
    const id = poseTower(harness, "arc", 10, 10, 0);
    harness.debug.setMoney(1);
    harness.debug.upgradeTower(id);
    expect(towerAt(harness, id).level).toBe(1);

    harness.debug.setMoney(1000);
    harness.debug.upgradeTower(id);
    harness.debug.upgradeTower(id);
    expect(towerAt(harness, id).level).toBe(3);
    expect(towerAt(harness, id).upgradeCost).toBe(0);
    const money = harness.debug.snapshot().money;
    harness.debug.upgradeTower(id);
    expect(towerAt(harness, id).level).toBe(3);
    expect(harness.debug.snapshot().money).toBe(money);
    harness.dispose();
  });
});

describe("selling", () => {
  it("pays in full while fresh and seventy percent after", async () => {
    const harness = await createHarness();
    startRun(harness);
    const fresh = poseTower(harness, "arc", 10, 10, 0);
    expect(towerAt(harness, fresh).refund).toBe(15);
    harness.debug.setTowerFresh(fresh, false);
    expect(towerAt(harness, fresh).refund).toBe(Math.floor(0.7 * 15));

    harness.debug.setMoney(1000);
    harness.debug.upgradeTower(fresh);
    expect(towerAt(harness, fresh).spent).toBe(30);
    expect(towerAt(harness, fresh).refund).toBe(21);

    const before = harness.debug.snapshot().money;
    harness.debug.setSelected(fresh);
    harness.debug.sellTower(fresh);
    const after = harness.debug.snapshot();
    expect(after.money).toBe(before + 21);
    expect(after.towers).toHaveLength(0);
    expect(after.selected).toBeNull();
    harness.dispose();
  });

  it("reopens the footprint and re-paths", async () => {
    const harness = await createHarness();
    startRun(harness);
    const open = harness.debug.snapshot().paths.left.length;
    const id = poseTower(harness, "lance", 25, 16, 0);
    expect(harness.debug.snapshot().paths.left.length).toBeGreaterThan(open);
    harness.debug.sellTower(id);
    expect(harness.debug.snapshot().paths.left.length).toBeCloseTo(open, 10);
    harness.dispose();
  });
});

describe("freshness", () => {
  it("ends on the frame the phase becomes a wave, and never returns", async () => {
    const harness = await createHarness();
    startRun(harness);
    const id = poseTower(harness, "arc", 10, 10, 0);
    expect(towerAt(harness, id).fresh).toBe(true);

    // The send is the real transition into the wave phase.
    harness.tap("Space");
    await stepSeconds(harness, 1 / 120, 1);
    expect(harness.debug.snapshot().phase).toBe("wave");
    expect(towerAt(harness, id).fresh).toBe(false);

    harness.debug.setMoney(1000);
    harness.debug.upgradeTower(id);
    expect(towerAt(harness, id).fresh).toBe(false);
    harness.dispose();
  });

  it("is not given to a tower placed while a wave is running", async () => {
    const harness = await createHarness();
    startRun(harness);
    harness.tap("Space");
    await stepSeconds(harness, 1 / 120, 1);
    harness.debug.setArmed("arc");
    harness.debug.setPreview(10, 10);
    harness.debug.place();
    expect(harness.debug.snapshot().towers[0].fresh).toBe(false);
    harness.dispose();
  });
});
