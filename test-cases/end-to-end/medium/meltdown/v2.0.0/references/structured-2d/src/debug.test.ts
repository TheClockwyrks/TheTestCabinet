// The debug surface: every operation verifiable by setting a value and reading
// it back, and every pose leaving the rest of the state exactly as it was.

import { describe, expect, it } from "vitest";
import {
  DIFFICULTY_TABLE,
  MELTDOWN_DEBUG_VERSION,
  MAX_LEVEL,
  SURGE_DEFS,
  TOWER_DEFS,
  TOWER_TYPES,
  tileCX,
  tileCY,
} from "./constants";
import { createHarness, poseTower, startRun, type Harness } from "./harness";

function towerOf(harness: Harness, id: number) {
  const tower = harness.debug.snapshot().towers.find((t) => t.id === id);
  if (tower === undefined) throw new Error(`no tower ${id}`);
  return tower;
}

function unitOf(harness: Harness, id: number) {
  const unit = harness.debug.snapshot().surge.find((u) => u.id === id);
  if (unit === undefined) throw new Error(`no unit ${id}`);
  return unit;
}

function addUnit(
  harness: Harness,
  type: Parameters<Harness["debug"]["addUnit"]>[0] = "mote",
): number {
  harness.debug.addUnit(type, "left");
  const surge = harness.debug.snapshot().surge;
  return surge[surge.length - 1].id;
}

describe("the surface itself", () => {
  it("reports its version, and reads back off the engine", async () => {
    const harness = await createHarness();
    expect(harness.debug.version).toBe(MELTDOWN_DEBUG_VERSION);
    expect(harness.debug.snapshot().version).toBe(MELTDOWN_DEBUG_VERSION);
    expect(harness.engine.debug).toBe(harness.debug);
    harness.dispose();
  });

  it("changes nothing when it is only read", async () => {
    const harness = await createHarness();
    startRun(harness);
    poseTower(harness, "arc", 10, 10, 0);
    addUnit(harness);
    const first = JSON.stringify(harness.debug.snapshot());
    const second = JSON.stringify(harness.debug.snapshot());
    expect(second).toBe(first);
    harness.dispose();
  });
});

describe("reset", () => {
  it("restores every declared field to its title-screen value", async () => {
    const harness = await createHarness();
    startRun(harness, "bottleneck");
    poseTower(harness, "lance", 20, 12, 1);
    addUnit(harness, "core");
    harness.debug.setMoney(4321);
    harness.debug.setLives(3);
    harness.debug.setScore(9000);
    harness.debug.setWave(11);
    harness.debug.setBuildTimer(4);
    harness.debug.setWavePending(7);
    harness.debug.setSpeed(2);
    harness.debug.setArmed("arc");
    harness.debug.setHoverShop("flak");
    harness.debug.setMenuIndex(2);

    harness.debug.reset();
    const snapshot = harness.debug.snapshot();
    expect(snapshot).toMatchObject({
      screen: "title",
      phase: "opening",
      menuIndex: 0,
      mode: "containment",
      difficulty: "medium",
      money: DIFFICULTY_TABLE.medium.money,
      lives: 20,
      score: 0,
      wave: 1,
      buildTimer: 0,
      wavePending: 0,
      speed: 1,
      selected: null,
      hoverShop: null,
      build: null,
      waveSpawning: true,
      simTime: 0,
    });
    expect(snapshot.towers).toHaveLength(0);
    expect(snapshot.surge).toHaveLength(0);
    harness.dispose();
  });

  it("leaves the runtime's own bits alone", async () => {
    const harness = await createHarness();
    startRun(harness);
    // Mute, the way a player reaches it: the panel's own control.
    const mute = harness.debug.snapshot().controls.mute;
    harness.debug.pointerDown(mute.x + mute.w / 2, mute.y + mute.h / 2);
    harness.debug.pointerUp();
    await harness.engine.advance(1);
    expect(harness.debug.snapshot().muted).toBe(true);

    harness.debug.pointerMove(400, 300);
    harness.debug.reset();
    const snapshot = harness.debug.snapshot();
    expect(snapshot.muted).toBe(true);
    expect(snapshot.pointer).toEqual({ x: 400, y: 300, down: false });
    harness.dispose();
  });

  it("seeds the generator, so the same seed replays the same vents", async () => {
    const vents = async (seed: number): Promise<string[]> => {
      const harness = await createHarness();
      harness.debug.reset(seed);
      harness.debug.setScreen("playing");
      harness.debug.setPhase("wave");
      harness.debug.setWavePending(6);
      harness.debug.setWaveSpawning(true);
      await harness.engine.advance(400);
      const drawn = harness.debug.snapshot().surge.map((u) => u.vent);
      harness.dispose();
      return drawn;
    };
    const first = await vents(7);
    expect(first.length).toBeGreaterThan(3);
    expect(await vents(7)).toEqual(first);
  });
});

describe("the run's fields, each posed alone", () => {
  it("sets the screen with no entry effect", async () => {
    const harness = await createHarness();
    startRun(harness);
    harness.debug.setMenuIndex(2);
    harness.debug.setScore(12);
    harness.debug.setMoney(33);
    harness.debug.setLives(4);
    harness.cues.length = 0;
    harness.debug.setScreen("victory");
    const snapshot = harness.debug.snapshot();
    expect(snapshot.screen).toBe("victory");
    expect(snapshot.menuIndex).toBe(2);
    expect(snapshot.score).toBe(12);
    expect(snapshot.money).toBe(33);
    expect(harness.cues).toHaveLength(0);
    harness.dispose();
  });

  it("sets the phase with no entry effect", async () => {
    const harness = await createHarness();
    startRun(harness);
    const id = poseTower(harness, "arc", 10, 10, 0);
    harness.debug.setMoney(100);
    harness.debug.setScore(0);
    harness.cues.length = 0;
    harness.debug.setPhase("wave");
    const snapshot = harness.debug.snapshot();
    expect(snapshot.phase).toBe("wave");
    expect(snapshot.money).toBe(100);
    expect(snapshot.score).toBe(0);
    expect(snapshot.wavePending).toBe(0);
    expect(snapshot.surge).toHaveLength(0);
    // No wave was released and nothing about the tower changed.
    expect(towerOf(harness, id).fresh).toBe(true);
    expect(harness.cues).toHaveLength(0);
    harness.dispose();
  });

  it("sets each scalar the snapshot reports", async () => {
    const harness = await createHarness();
    startRun(harness);
    harness.debug.setMenuIndex(3);
    expect(harness.debug.snapshot().menuIndex).toBe(3);
    harness.debug.setMoney(1234);
    expect(harness.debug.snapshot().money).toBe(1234);
    harness.debug.setLives(6);
    expect(harness.debug.snapshot().lives).toBe(6);
    harness.debug.setScore(555);
    expect(harness.debug.snapshot().score).toBe(555);
    harness.debug.setWave(9);
    expect(harness.debug.snapshot().wave).toBe(9);
    harness.debug.setBuildTimer(4.5);
    expect(harness.debug.snapshot().buildTimer).toBe(4.5);
    harness.debug.setWavePending(12);
    expect(harness.debug.snapshot().wavePending).toBe(12);
    harness.debug.setSpeed(2);
    expect(harness.debug.snapshot().speed).toBe(2);
    harness.debug.setSpeed(1);
    expect(harness.debug.snapshot().speed).toBe(1);
    harness.debug.setWaveSpawning(false);
    expect(harness.debug.snapshot().waveSpawning).toBe(false);
    harness.dispose();
  });

  it("triggers no game over from setLives, and no bonus from setScore", async () => {
    const harness = await createHarness();
    startRun(harness);
    harness.debug.setLives(0);
    expect(harness.debug.snapshot().screen).toBe("playing");
    harness.debug.setScore(1_000_000);
    expect(harness.debug.snapshot().money).toBe(
      harness.debug.snapshot().startMoney,
    );
    harness.dispose();
  });

  it("rebuilds, releases and clears nothing from setWave", async () => {
    const harness = await createHarness();
    startRun(harness);
    poseTower(harness, "arc", 10, 10, 0);
    harness.debug.setMoney(42);
    harness.debug.setWave(14);
    const snapshot = harness.debug.snapshot();
    expect(snapshot.wave).toBe(14);
    expect(snapshot.money).toBe(42);
    expect(snapshot.towers).toHaveLength(1);
    expect(snapshot.surge).toHaveLength(0);
    // The hp scaling follows the number: a unit added now is scaled for wave 14.
    harness.debug.addUnit("mote", "left");
    expect(harness.debug.snapshot().surge[0].maxHp).toBeCloseTo(
      SURGE_DEFS.mote.hp * (1 + 0.62 * 13),
      6,
    );
    harness.dispose();
  });
});

describe("the tower atoms", () => {
  it("adds a tower at the tile and rotation named, costing nothing", async () => {
    const harness = await createHarness();
    startRun(harness);
    harness.debug.setMoney(0);
    harness.debug.addTower("bloom", 12, 14, 2);
    const snapshot = harness.debug.snapshot();
    expect(snapshot.money).toBe(0);
    expect(snapshot.towers).toHaveLength(1);
    expect(snapshot.towers[0]).toMatchObject({
      type: "bloom",
      col: 12,
      row: 14,
      rotation: 2,
      size: 3,
      level: 1,
      heat: 0,
      tripped: false,
      tripTimer: 0,
      kills: 0,
      damageDealt: 0,
      spent: TOWER_DEFS.bloom.cost,
      fresh: true,
      firingEnabled: true,
      thermalEnabled: true,
    });
    harness.dispose();
  });

  it("appends, so the last entry is the one just added", async () => {
    const harness = await createHarness();
    startRun(harness);
    const first = poseTower(harness, "arc", 4, 4, 0);
    const second = poseTower(harness, "flak", 8, 4, 0);
    const towers = harness.debug.snapshot().towers;
    expect(towers[0].id).toBe(first);
    expect(towers[towers.length - 1].id).toBe(second);
    expect(second).not.toBe(first);
    harness.dispose();
  });

  it("removes one tower without paying a refund", async () => {
    const harness = await createHarness();
    startRun(harness);
    const id = poseTower(harness, "arc", 10, 10, 0);
    const openLeft = harness.debug.snapshot().paths.left.length;
    harness.debug.setMoney(50);
    harness.debug.setScore(7);
    harness.debug.removeTower(id);
    const snapshot = harness.debug.snapshot();
    expect(snapshot.towers).toHaveLength(0);
    expect(snapshot.money).toBe(50);
    expect(snapshot.score).toBe(7);
    expect(snapshot.paths.left.length).toBe(openLeft);
    harness.dispose();
  });

  it("clears every tower and leaves the surge standing", async () => {
    const harness = await createHarness();
    startRun(harness);
    poseTower(harness, "arc", 10, 10, 0);
    poseTower(harness, "arc", 14, 10, 0);
    const unit = addUnit(harness);
    harness.debug.setMoney(11);
    harness.debug.clearTowers();
    const snapshot = harness.debug.snapshot();
    expect(snapshot.towers).toHaveLength(0);
    expect(snapshot.surge.map((u) => u.id)).toEqual([unit]);
    expect(snapshot.money).toBe(11);
    harness.dispose();
  });

  it("poses each tower field the snapshot reports", async () => {
    const harness = await createHarness();
    startRun(harness);
    const id = poseTower(harness, "arc", 10, 10, 0);
    harness.debug.setTowerHeat(id, 64);
    expect(towerOf(harness, id).heat).toBe(64);
    harness.debug.setTowerTripped(id, true);
    expect(towerOf(harness, id)).toMatchObject({ tripped: true, heat: 64 });
    harness.debug.setTowerTripTimer(id, 2.5);
    expect(towerOf(harness, id)).toMatchObject({
      tripTimer: 2.5,
      tripped: true,
    });
    harness.debug.setTowerTripped(id, false);
    expect(towerOf(harness, id)).toMatchObject({
      tripped: false,
      tripTimer: 2.5,
    });
    harness.debug.setTowerLevel(id, MAX_LEVEL);
    expect(towerOf(harness, id).level).toBe(MAX_LEVEL);
    harness.debug.setTowerFresh(id, false);
    expect(towerOf(harness, id).fresh).toBe(false);
    harness.debug.setTowerFiring(id, false);
    expect(towerOf(harness, id).firingEnabled).toBe(false);
    harness.debug.setTowerThermal(id, false);
    expect(towerOf(harness, id).thermalEnabled).toBe(false);
    harness.dispose();
  });

  it("clamps a posed heat into the scale and spends nothing on a level", async () => {
    const harness = await createHarness();
    startRun(harness);
    const id = poseTower(harness, "arc", 10, 10, 0);
    harness.debug.setMoney(5);
    harness.debug.setTowerHeat(id, 500);
    expect(towerOf(harness, id).heat).toBe(100);
    harness.debug.setTowerHeat(id, -20);
    expect(towerOf(harness, id).heat).toBe(0);
    harness.debug.setTowerLevel(id, 3);
    const snapshot = harness.debug.snapshot();
    expect(snapshot.money).toBe(5);
    expect(snapshot.towers[0].spent).toBe(TOWER_DEFS.arc.cost);
    harness.dispose();
  });

  it("does not trip a tower posed at the top of the scale", async () => {
    const harness = await createHarness();
    startRun(harness);
    const id = poseTower(harness, "arc", 10, 10, 0);
    harness.debug.setTowerHeat(id, 100);
    expect(towerOf(harness, id).tripped).toBe(false);
    harness.dispose();
  });

  it("reports every derived tower figure the snapshot names", async () => {
    const harness = await createHarness();
    startRun(harness);
    for (const type of TOWER_TYPES) {
      harness.debug.clearTowers();
      const id = poseTower(harness, type, 10, 10, 0);
      const tower = towerOf(harness, id);
      const def = TOWER_DEFS[type];
      expect(tower.size).toBe(def.size);
      if (def.kind === "emitter") {
        expect(tower.redline).toBe(def.redline);
        expect(tower.heatMult).toBeCloseTo(0.35, 8);
        expect(tower.output).toBe(0);
        expect(tower.damage).toBeCloseTo(def.baseDamage * 0.35, 8);
        expect(tower.radiatorFaces.length).toBe(def.radiators.length);
      } else {
        expect(tower.redline).toBe(0);
        expect(tower.heatMult).toBe(0);
        expect(tower.damage).toBe(0);
        expect(tower.output).toBeGreaterThan(0);
        expect(tower.radiatorFaces).toEqual([]);
      }
      expect(tower.refund).toBe(def.cost);
      expect(tower.upgradeCost).toBe(def.cost);
    }
    harness.dispose();
  });
});

describe("the surge atoms", () => {
  it("adds a unit and appends it, with its exhaust fixed by its vent", async () => {
    const harness = await createHarness();
    startRun(harness);
    harness.debug.addUnit("drift", "top");
    const unit = harness.debug.snapshot().surge[0];
    expect(unit).toMatchObject({
      type: "drift",
      vent: "top",
      exhaust: "bottom",
      flying: true,
      motion: true,
      slowFactor: 0,
      slowTimer: 0,
      slowed: false,
    });
    expect(unit.hp).toBe(unit.maxHp);
    expect(unit.baseSpeed).toBe(SURGE_DEFS.drift.speed);
    harness.dispose();
  });

  it("removes a unit at no cost, and clears them all at no cost", async () => {
    const harness = await createHarness();
    startRun(harness);
    const first = addUnit(harness);
    addUnit(harness, "hulk");
    harness.debug.setLives(10);
    harness.debug.setMoney(20);
    harness.debug.setScore(3);
    harness.debug.removeUnit(first);
    let snapshot = harness.debug.snapshot();
    expect(snapshot.surge).toHaveLength(1);
    expect(snapshot).toMatchObject({ lives: 10, money: 20, score: 3 });
    harness.debug.clearSurge();
    snapshot = harness.debug.snapshot();
    expect(snapshot.surge).toHaveLength(0);
    expect(snapshot).toMatchObject({ lives: 10, money: 20, score: 3 });
    harness.dispose();
  });

  it("poses each unit field the snapshot reports", async () => {
    const harness = await createHarness();
    startRun(harness);
    const id = addUnit(harness);
    harness.debug.setUnitPosition(id, tileCX(30), tileCY(20));
    expect(unitOf(harness, id)).toMatchObject({
      x: tileCX(30),
      y: tileCY(20),
      col: 30,
      row: 20,
    });
    harness.debug.setUnitMaxHp(id, 500);
    expect(unitOf(harness, id).maxHp).toBe(500);
    harness.debug.setUnitHp(id, 12);
    expect(unitOf(harness, id).hp).toBe(12);
    harness.debug.setUnitSlow(id, 0.4);
    expect(unitOf(harness, id)).toMatchObject({
      slowFactor: 0.4,
      slowed: true,
    });
    expect(unitOf(harness, id).speed).toBeCloseTo(
      SURGE_DEFS.mote.speed * 0.6,
      8,
    );
    harness.debug.setUnitSlowTimer(id, 0.9);
    expect(unitOf(harness, id).slowTimer).toBe(0.9);
    harness.debug.setUnitMotion(id, false);
    expect(unitOf(harness, id).motion).toBe(false);
    harness.dispose();
  });

  it("does not kill a unit posed to zero hp", async () => {
    const harness = await createHarness();
    startRun(harness);
    const id = addUnit(harness);
    harness.debug.setUnitHp(id, 0);
    expect(unitOf(harness, id).hp).toBe(0);
    expect(harness.debug.snapshot().surge).toHaveLength(1);
    harness.dispose();
  });

  it("counts a posed unit toward waveRemaining while a wave is running", async () => {
    const harness = await createHarness();
    startRun(harness);
    harness.debug.setWavePending(4);
    harness.debug.setPhase("building");
    expect(harness.debug.snapshot().waveRemaining).toBe(4);
    harness.debug.setPhase("wave");
    addUnit(harness);
    addUnit(harness);
    expect(harness.debug.snapshot().waveRemaining).toBe(6);
    harness.dispose();
  });
});

describe("the pointer operations", () => {
  it("reports the pointer's own position and whether it is pressed", async () => {
    const harness = await createHarness();
    startRun(harness);
    harness.debug.pointerMove(300, 200);
    expect(harness.debug.snapshot().pointer).toEqual({
      x: 300,
      y: 200,
      down: false,
    });
    harness.debug.pointerDown(310, 210);
    expect(harness.debug.snapshot().pointer).toEqual({
      x: 310,
      y: 210,
      down: true,
    });
    harness.debug.pointerUp();
    expect(harness.debug.snapshot().pointer).toEqual({
      x: 310,
      y: 210,
      down: false,
    });
    harness.dispose();
  });

  it("mirrors the runtime's pointer input again on the next update", async () => {
    const harness = await createHarness();
    startRun(harness);
    harness.pointer("pointermove", 640, 360);
    await harness.engine.advance(1);
    expect(harness.debug.snapshot().pointer).toEqual({
      x: 640,
      y: 360,
      down: false,
    });
    harness.pointer("pointerdown", 700, 400);
    await harness.engine.advance(1);
    expect(harness.debug.snapshot().pointer).toEqual({
      x: 700,
      y: 400,
      down: true,
    });
    harness.dispose();
  });

  it("plays no cue, where the same press by a player does", async () => {
    const harness = await createHarness();
    startRun(harness);
    harness.debug.setArmed("arc");
    harness.debug.setPreview(20, 12);
    harness.cues.length = 0;
    harness.debug.pointerDown(tileCX(20), tileCY(12));
    harness.debug.pointerUp();
    expect(harness.debug.snapshot().towers).toHaveLength(1);
    expect(harness.cues).toHaveLength(0);
    harness.dispose();
  });
});

describe("the world gate", () => {
  it("holds the release of surge and nothing else", async () => {
    const harness = await createHarness();
    startRun(harness);
    harness.debug.setPhase("wave");
    harness.debug.setWavePending(8);
    harness.debug.setWaveSpawning(false);
    const id = poseTower(harness, "arc", 10, 10, 0);
    harness.debug.setTowerHeat(id, 90);
    const walker = addUnit(harness);
    const before = unitOf(harness, walker).x;
    await harness.engine.advance(240);
    const snapshot = harness.debug.snapshot();
    // Nothing arrived, but the tower cooled and the unit already on the floor
    // walked on.
    expect(snapshot.surge.map((u) => u.id)).toEqual([walker]);
    expect(snapshot.wavePending).toBe(8);
    expect(snapshot.towers[0].heat).toBeLessThan(90);
    expect(snapshot.surge[0].x).toBeGreaterThan(before);
    harness.dispose();
  });
});
