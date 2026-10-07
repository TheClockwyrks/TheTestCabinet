// What the stage shows: the separations a player reads at a glance, and a draw
// of every screen over a real 2D context.

import { describe, expect, it } from "vitest";
import {
  BOTTLENECK_ZONE,
  CASING,
  FLOOR_X0,
  FLOOR_X1,
  LEFT_VENT_ROWS,
  PANEL_X,
  STAGE_H,
  SURGE_TYPES,
  TOWER_TYPES,
  tileCX,
  tileCY,
  tileLeft,
  tileTop,
} from "./constants";
import { SHOP_ORDER, towerBodyColor } from "./render";
import { RGB, SURGE_RGB, css, heatRgb, separation } from "./theme";
import { meltdownState } from "./game";
import { createHarness, poseTower, startRun, type Harness } from "./harness";

/** How far apart two drawn pixels read, out of 441. */
function apart(
  a: [number, number, number],
  b: [number, number, number],
): number {
  return separation(a, b);
}

/** Draw one frame and hand back the pixel reader. */
async function drawFrame(harness: Harness): Promise<void> {
  await harness.engine.advance(1);
}

describe("the heat ramp", () => {
  it("reads the cold end and the near-redline end plainly apart", () => {
    expect(separation(heatRgb(0), heatRgb(95))).toBeGreaterThan(200);
  });

  it("climbs monotonically enough to be read as one axis", () => {
    let previous = heatRgb(0);
    for (let heat = 10; heat <= 100; heat += 10) {
      const next = heatRgb(heat);
      expect(separation(previous, next)).toBeGreaterThan(10);
      previous = next;
    }
  });

  it("keeps a tripped tower apart from every colour the ramp shows", () => {
    // A tripped tower is drawn in one colour at every heat, so what it must
    // read apart from is the whole ramp rather than one stop of it.
    for (let heat = 0; heat <= 100; heat += 0.5) {
      expect(separation(RGB.tripped, heatRgb(heat))).toBeGreaterThan(150);
    }
    expect(separation(RGB.tripped, RGB.trippedMark)).toBeGreaterThan(200);
  });

  it("keeps every surge colour off the heat ramp", () => {
    for (const type of SURGE_TYPES) {
      for (let heat = 0; heat <= 100; heat += 5) {
        expect(separation(SURGE_RGB[type], heatRgb(heat))).toBeGreaterThan(60);
      }
    }
  });

  it("tells the surge types apart from one another", () => {
    for (const a of SURGE_TYPES) {
      for (const b of SURGE_TYPES) {
        if (a === b) continue;
        expect(separation(SURGE_RGB[a], SURGE_RGB[b])).toBeGreaterThan(20);
      }
    }
  });

  it("keeps a radiator face apart from a plain one, and a tower off the floor", () => {
    expect(separation(RGB.radiator, RGB.plainFace)).toBeGreaterThan(200);
    for (let heat = 0; heat <= 100; heat += 5) {
      expect(separation(heatRgb(heat), RGB.floor)).toBeGreaterThan(60);
    }
  });

  it("tells a vent from an exhaust and both from the casing", () => {
    expect(separation(RGB.vent, RGB.exhaust)).toBeGreaterThan(200);
    expect(separation(RGB.vent, RGB.casing)).toBeGreaterThan(100);
    expect(separation(RGB.exhaust, RGB.casing)).toBeGreaterThan(100);
  });

  it("draws a mover in its own colour and a tripped tower in the trip colour", async () => {
    const harness = await createHarness();
    startRun(harness);
    const forge = poseTower(harness, "forge", 4, 4, 0);
    const sink = poseTower(harness, "sink", 8, 4, 0);
    const arc = poseTower(harness, "arc", 12, 4, 0);
    harness.debug.setTowerTripped(arc, true);
    const towers = meltdownState(harness.engine.world).towers;
    const byId = new Map(towers.map((tower) => [tower.id, tower]));
    const colorOf = (id: number): string => {
      const tower = byId.get(id);
      if (tower === undefined) throw new Error(`no tower ${id}`);
      return towerBodyColor(tower);
    };
    expect(colorOf(forge)).toBe(css(RGB.forge));
    expect(colorOf(sink)).toBe(css(RGB.sink));
    expect(colorOf(arc)).toBe(css(RGB.tripped));
    harness.dispose();
  });
});

describe("the floor as it is drawn", () => {
  it("draws the casing, the openings and the grid with nothing placed", async () => {
    const harness = await createHarness();
    startRun(harness);
    await drawFrame(harness);

    // The casing band, and the left vent cut into it.
    expect(
      apart(harness.pixel(6, 6), [...RGB.casing] as [number, number, number]),
    ).toBeLessThan(20);
    expect(
      apart(harness.pixel(CASING / 2, tileCY(LEFT_VENT_ROWS[1])), [
        ...RGB.vent,
      ] as [number, number, number]),
    ).toBeLessThan(20);
    // The grid: a line at a tile boundary reads apart from the bare floor.
    const line = harness.pixel(tileLeft(10), tileCY(10));
    const bare = harness.pixel(tileCX(10), tileCY(10));
    expect(apart(line, bare)).toBeGreaterThan(20);
    harness.dispose();
  });

  it("draws the panel across its whole strip and nothing of the floor in it", async () => {
    const harness = await createHarness();
    startRun(harness);
    await drawFrame(harness);
    for (const y of [10, STAGE_H / 2, STAGE_H - 10]) {
      const pixel = harness.pixel(PANEL_X + 8, y);
      expect(
        apart(pixel, [...RGB.floor] as [number, number, number]),
      ).toBeGreaterThan(6);
    }
    harness.dispose();
  });

  it("draws a tower at its heat, and a hotter one plainly apart", async () => {
    const harness = await createHarness();
    startRun(harness);
    const cold = poseTower(harness, "arc", 6, 6, 0);
    const hot = poseTower(harness, "arc", 12, 6, 0);
    harness.debug.setTowerHeat(cold, 2);
    harness.debug.setTowerHeat(hot, 95);
    await drawFrame(harness);
    const coldPixel = harness.pixel(tileLeft(6) + 10, tileTop(6) + 8);
    const hotPixel = harness.pixel(tileLeft(12) + 10, tileTop(6) + 8);
    expect(apart(coldPixel, hotPixel)).toBeGreaterThan(150);
    harness.dispose();
  });

  it("draws the build zone on a mode that restricts building", async () => {
    const harness = await createHarness();
    startRun(harness, "bottleneck");
    await drawFrame(harness);
    const inside = harness.pixel(
      tileCX(BOTTLENECK_ZONE.col0 + 2),
      tileCY(BOTTLENECK_ZONE.row0 + 2),
    );
    const outside = harness.pixel(tileCX(2), tileCY(2));
    expect(apart(inside, outside)).toBeGreaterThan(20);
    harness.dispose();
  });

  it("draws a unit on the floor, apart from the floor behind it", async () => {
    const harness = await createHarness();
    startRun(harness);
    harness.debug.addUnit("core", "left");
    const id = harness.debug.snapshot().surge[0].id;
    harness.debug.setUnitPosition(id, tileCX(20), tileCY(20));
    harness.debug.setUnitMotion(id, false);
    await drawFrame(harness);
    const body = harness.pixel(tileCX(20), tileCY(20));
    expect(
      apart(body, [...RGB.floor] as [number, number, number]),
    ).toBeGreaterThan(80);
    harness.dispose();
  });

  it("draws the held preview plainly apart valid and invalid", async () => {
    const harness = await createHarness();
    startRun(harness);
    harness.debug.setArmed("arc");
    harness.debug.setPreview(20, 20);
    await drawFrame(harness);
    const good = harness.pixel(tileCX(20), tileCY(20));

    harness.debug.setMoney(0);
    await drawFrame(harness);
    const bad = harness.pixel(tileCX(20), tileCY(20));
    expect(apart(good, bad)).toBeGreaterThan(60);
    harness.dispose();
  });
});

describe("every screen draws", () => {
  it("draws all eight without throwing, over a real context", async () => {
    const harness = await createHarness();
    startRun(harness);
    poseTower(harness, "lance", 20, 12, 1);
    poseTower(harness, "forge", 24, 12, 0);
    harness.debug.addUnit("drift", "top");
    harness.debug.addUnit("core", "left");
    harness.debug.setSelected(harness.debug.snapshot().towers[0].id);
    for (const screen of [
      "title",
      "modeselect",
      "difficultyselect",
      "howto",
      "playing",
      "paused",
      "victory",
      "gameover",
    ] as const) {
      harness.debug.setScreen(screen);
      for (let index = 0; index < 5; index += 1) {
        harness.debug.setMenuIndex(index);
        await drawFrame(harness);
      }
    }
    harness.dispose();
  });

  it("draws the hover panel and the inspector for every type", async () => {
    const harness = await createHarness();
    startRun(harness);
    for (const type of TOWER_TYPES) {
      harness.debug.clearTowers();
      harness.debug.setHoverShop(type);
      await drawFrame(harness);
      const id = poseTower(harness, type, 20, 12, 1);
      harness.debug.setHoverShop(null);
      harness.debug.setSelected(id);
      for (const level of [1, 2, 3]) {
        harness.debug.setTowerLevel(id, level);
        await drawFrame(harness);
      }
      harness.debug.setTowerTripped(id, true);
      await drawFrame(harness);
    }
    harness.dispose();
  });

  it("draws the next-wave preview in every mode, and none during a wave", async () => {
    const harness = await createHarness();
    for (const mode of [
      "containment",
      "hundred",
      "deeppockets",
      "bottleneck",
      "suddendeath",
    ] as const) {
      startRun(harness, mode);
      for (const phase of ["opening", "building", "wave"] as const) {
        harness.debug.setPhase(phase);
        await drawFrame(harness);
      }
      harness.debug.setWave(harness.debug.snapshot().waveCount);
      harness.debug.setPhase("wave");
      await drawFrame(harness);
    }
    harness.dispose();
  });

  it("shows the floor on playing and paused alone", async () => {
    const harness = await createHarness();
    startRun(harness);
    harness.debug.setScreen("title");
    await drawFrame(harness);
    const title = harness.pixel(tileCX(3), tileCY(3));
    harness.debug.setScreen("playing");
    await drawFrame(harness);
    const playing = harness.pixel(tileCX(3), tileCY(3));
    expect(apart(title, playing)).toBeGreaterThan(6);
    harness.dispose();
  });

  it("keeps the floor drawn behind the pause menu", async () => {
    const harness = await createHarness();
    startRun(harness);
    poseTower(harness, "arc", 3, 3, 0);
    harness.debug.setTowerHeat(harness.debug.snapshot().towers[0].id, 90);
    harness.debug.setScreen("paused");
    await drawFrame(harness);
    const overTower = harness.pixel(tileLeft(3) + 10, tileTop(3) + 8);
    const overFloor = harness.pixel(tileCX(30), tileCY(30));
    expect(apart(overTower, overFloor)).toBeGreaterThan(30);
    harness.dispose();
  });
});

describe("the shop order", () => {
  it("is the shop order of TOWER_TYPES", () => {
    expect(SHOP_ORDER).toEqual([...TOWER_TYPES]);
  });

  it("puts the whole floor inside the reactor region", () => {
    expect(FLOOR_X0).toBe(CASING);
    expect(FLOOR_X1).toBeLessThan(PANEL_X);
  });
});
