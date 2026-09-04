// The debugging and automation surface (specs/instrumentation.md).
//
// The contract this file checks is the one every scenario driven from code rests
// on, so it is checked operation by operation: every pose sets its own field and
// nothing else, every read reports what the state holds, and `reset` returns the
// declared fields to their title-screen values. The surface is built over a HOST
// of this file's own — the seam `DebugHost` exists for — so the clock is a
// counter rather than a browser, and `src/game.test.ts` checks the same surface
// installed over the real runtime.

import { describe, expect, it } from "vitest";
import {
  BOTTLENECK_ZONE,
  DIFFICULTY_ITEMS,
  DIFFICULTY_TABLE,
  ENDING_ITEMS,
  HOWTO_ITEMS,
  MELTDOWN_DEBUG_VERSION,
  MODE_ITEMS,
  PAUSE_ITEMS,
  START_LIVES,
  TILE,
  TITLE_ITEMS,
  TOWER_TYPES,
  heatMultiplier,
  tileCX,
  tileCY,
} from "./constants";
import { TOWER_DEFS, SURGE_DEFS, emitterStats, isEmitter } from "./defs";
import {
  MELTDOWN_HANDLE,
  createDebugApi,
  installDebugApi,
  type DebugHost,
  type MeltdownDebugApi,
} from "./debug";
import { applyPointerSample } from "./input";
import { panelControls } from "./panel";
import { createState, type MeltdownState } from "./state";
import { remainingOf } from "./units";

/** A surface over a fresh state, with a clock and a pointer of this file's own. */
function surface(): {
  api: MeltdownDebugApi;
  state: MeltdownState;
  advanced: Array<[number, number]>;
} {
  const state = createState();
  const advanced: Array<[number, number]> = [];
  let stepping = true;
  const host: DebugHost = {
    get state() {
      return state;
    },
    autoStep: () => stepping,
    setAutoStep: (enabled) => {
      stepping = enabled;
    },
    advance: (seconds, frames = 1) => {
      advanced.push([seconds, frames]);
    },
    // The one operation that must reach the game's own pointer path, so a posed
    // press and a player's press are the same event (specs/instrumentation.md).
    reportPointer: (type, x, y) => {
      applyPointerSample(
        state,
        { type, x, y },
        {
          cue: () => undefined,
          setMuted: () => undefined,
          muted: () => false,
        },
      );
    },
  };
  return { api: createDebugApi(host), state, advanced };
}

/** A surface with the run under way, which is what most poses assume. */
function playing(): ReturnType<typeof surface> {
  const made = surface();
  made.api.setScreen("playing");
  made.api.setPhase("building");
  made.api.setMoney(5000);
  return made;
}

describe("the surface itself", () => {
  it("reports its version, on the object and in the snapshot", () => {
    const { api } = surface();
    expect(api.version).toBe(MELTDOWN_DEBUG_VERSION);
    expect(api.version).toBe(1);
    expect(api.snapshot().version).toBe(1);
  });

  it("installs on the global handle and removes exactly what it installed", () => {
    const state = createState();
    const host: DebugHost = {
      get state() {
        return state;
      },
      autoStep: () => true,
      setAutoStep: () => undefined,
      advance: () => undefined,
      reportPointer: () => undefined,
    };
    const target = globalThis as unknown as Record<string, unknown>;
    expect(target[MELTDOWN_HANDLE]).toBeUndefined();
    const remove = installDebugApi(host);
    expect(
      (target[MELTDOWN_HANDLE] as MeltdownDebugApi).snapshot().screen,
    ).toBe("title");
    remove();
    expect(target[MELTDOWN_HANDLE]).toBeUndefined();
  });
});

describe("reset", () => {
  it("restores every declared field to its title-screen value", () => {
    const { api, state } = playing();
    api.setPhase("wave");
    api.setMode("bottleneck");
    api.setDifficulty("hard");
    api.setLives(3);
    api.setScore(900);
    api.setWave(7);
    api.setBuildTimer(4);
    api.setWavePending(9);
    api.setSpeed(2);
    api.setMenuIndex(2);
    api.setWaveSpawning(false);
    const id = api.addTower("arc", 20, 20);
    api.addUnit("mote", "left");
    api.setSelected(id);
    api.setHoverShop("lance");
    api.setArmed("rime");
    state.simTime = 42;

    api.reset();
    const shot = api.snapshot();
    expect(shot.screen).toBe("title");
    expect(shot.phase).toBe("opening");
    expect(shot.menuIndex).toBe(0);
    expect(shot.mode).toBe("containment");
    expect(shot.difficulty).toBe("medium");
    expect(shot.money).toBe(DIFFICULTY_TABLE.medium.money);
    expect(shot.lives).toBe(START_LIVES);
    expect(shot.score).toBe(0);
    expect(shot.wave).toBe(1);
    expect(shot.buildTimer).toBe(0);
    expect(shot.wavePending).toBe(0);
    expect(shot.speed).toBe(1);
    expect(shot.selected).toBeNull();
    expect(shot.hoverShop).toBeNull();
    expect(shot.build).toBeNull();
    expect(shot.simTime).toBe(0);
    expect(shot.towers).toEqual([]);
    expect(shot.surge).toEqual([]);
    expect(shot.waveSpawning).toBe(true);
    expect(state.spawnClock).toBe(0);
  });

  it("seeds every draw, so the same seed replays the same vents", () => {
    const { api, state } = surface();
    api.reset(99);
    const first = state.rng.seed;
    api.reset(99);
    expect(state.rng.seed).toBe(first);
    api.reset();
    expect(state.rng.seed).toBe(1);
  });

  it("leaves the mute bit, the pointer and the clock exactly as they stand", () => {
    const { api, state } = surface();
    state.muted = true;
    state.pointer.x = 400;
    state.pointer.down = true;
    api.setAutoStep(false);
    api.reset();
    expect(state.muted).toBe(true);
    expect(state.pointer.x).toBe(400);
    expect(state.pointer.down).toBe(true);
    expect(api.snapshot().autoStep).toBe(false);
  });
});

describe("the clock", () => {
  it("takes the game off the wall clock and gives it back", () => {
    const { api } = surface();
    expect(api.snapshot().autoStep).toBe(true);
    api.setAutoStep(false);
    expect(api.snapshot().autoStep).toBe(false);
    api.setAutoStep(true);
    expect(api.snapshot().autoStep).toBe(true);
  });

  it("passes its seconds and frames straight to the loop, one frame by default", () => {
    const { api, advanced } = surface();
    api.advance(1);
    api.advance(2, 120);
    expect(advanced).toEqual([
      [1, 1],
      [2, 120],
    ]);
  });

  it("changes no game state of its own", () => {
    const { api } = surface();
    const before = api.snapshot();
    api.setAutoStep(false);
    const after = api.snapshot();
    expect({ ...after, autoStep: before.autoStep }).toEqual(before);
  });
});

describe("the screen and the run", () => {
  it("sets each field alone", () => {
    const { api } = surface();
    api.setScreen("playing");
    api.setPhase("wave");
    api.setMenuIndex(3);
    api.setMode("hundred");
    api.setDifficulty("easy");
    api.setMoney(777);
    api.setLives(4);
    api.setScore(1234);
    api.setWave(6);
    api.setBuildTimer(8.5);
    api.setWavePending(11);
    api.setSpeed(2);
    const shot = api.snapshot();
    expect(shot.screen).toBe("playing");
    expect(shot.phase).toBe("wave");
    expect(shot.menuIndex).toBe(3);
    expect(shot.mode).toBe("hundred");
    expect(shot.difficulty).toBe("easy");
    expect(shot.money).toBe(777);
    expect(shot.lives).toBe(4);
    expect(shot.score).toBe(1234);
    expect(shot.wave).toBe(6);
    expect(shot.buildTimer).toBe(8.5);
    expect(shot.wavePending).toBe(11);
    expect(shot.speed).toBe(2);
  });

  it("runs no entry effect on a screen or a phase", () => {
    const { api } = playing();
    const id = api.addTower("arc", 20, 20);
    api.setMenuIndex(2);
    api.setMoney(100);
    api.setScore(50);
    api.setPhase("wave");
    const shot = api.snapshot();
    // No menu reset, no interest, no bonus, no release, and freshness untouched.
    expect(shot.menuIndex).toBe(2);
    expect(shot.money).toBe(100);
    expect(shot.score).toBe(50);
    expect(shot.wavePending).toBe(11 - 11);
    expect(shot.surge).toEqual([]);
    expect(shot.towers[0].fresh).toBe(true);
    expect(shot.towers[0].id).toBe(id);
  });

  it("moves only the derived figures when the mode or difficulty changes", () => {
    const { api } = playing();
    api.setMoney(123);
    api.setLives(5);
    api.setWave(4);
    api.setMode("suddendeath");
    let shot = api.snapshot();
    expect(shot.money).toBe(123);
    expect(shot.lives).toBe(5);
    expect(shot.wave).toBe(4);
    expect(shot.startLives).toBe(1);
    expect(shot.startMoney).toBe(300);
    expect(shot.interest).toBe(true);
    expect(shot.buildZone).toBeNull();

    api.setMode("bottleneck");
    shot = api.snapshot();
    expect(shot.buildZone).toEqual(BOTTLENECK_ZONE);

    api.setMode("containment");
    api.setDifficulty("hard");
    shot = api.snapshot();
    expect(shot.waveCount).toBe(DIFFICULTY_TABLE.hard.waves);
    expect(shot.startMoney).toBe(DIFFICULTY_TABLE.hard.money);
  });

  it("triggers no game over from setLives and pays nothing from setScore", () => {
    const { api } = playing();
    api.setLives(0);
    api.setScore(100000);
    const shot = api.snapshot();
    expect(shot.screen).toBe("playing");
    expect(shot.lives).toBe(0);
  });

  it("follows the coming wave from setWave without releasing anything", () => {
    const { api } = playing();
    api.setWave(9);
    const shot = api.snapshot();
    expect(shot.nextWave).toEqual({ type: "mote", count: 34 });
    expect(shot.surge).toEqual([]);
    expect(shot.wavePending).toBe(0);
  });
});

describe("the world gate", () => {
  it("is on by default and is reported", () => {
    const { api } = surface();
    expect(api.snapshot().waveSpawning).toBe(true);
    api.setWaveSpawning(false);
    expect(api.snapshot().waveSpawning).toBe(false);
  });
});

describe("the towers", () => {
  it("adds one at no cost, unchecked, appended, at its stated start", () => {
    const { api } = playing();
    api.setMoney(3);
    const id = api.addTower("lance", 5, 5, 2);
    const shot = api.snapshot();
    expect(shot.money).toBe(3);
    expect(shot.towers).toHaveLength(1);
    const tower = shot.towers[0];
    expect(tower.id).toBe(id);
    expect(tower).toMatchObject({
      type: "lance",
      col: 5,
      row: 5,
      size: 4,
      rotation: 2,
      level: 1,
      heat: 0,
      tripped: false,
      tripTimer: 0,
      kills: 0,
      damageDealt: 0,
      spent: TOWER_DEFS.lance.cost,
      fresh: true,
      firingEnabled: true,
      thermalEnabled: true,
    });
  });

  it("blocks the footprint's tiles and re-paths exactly as a placed tower does", () => {
    const { api } = playing();
    const before = api.snapshot().paths.left.length;
    // A baffle down most of column 20, leaving the bottom rows open, so the
    // route lengthens rather than disappearing.
    for (let row = 0; row < 28; row += 2) api.addTower("arc", 20, row);
    const after = api.snapshot().paths.left.length;
    expect(after).toBeGreaterThan(before);
    expect(Number.isFinite(after)).toBe(true);
  });

  it("runs no placement check, so a posed wall can seal the floor outright", () => {
    const { api } = playing();
    for (let row = 0; row < 36; row += 2) api.addTower("arc", 20, row);
    // `place` would have refused every one of those; `addTower` is the atom
    // and refuses nothing (specs/instrumentation.md).
    expect(api.snapshot().paths.left.length).toBe(Infinity);
  });

  it("removes and clears with no refund and no change to money or score", () => {
    const { api } = playing();
    api.setMoney(50);
    api.setScore(9);
    const first = api.addTower("arc", 10, 10);
    api.addTower("arc", 14, 10);
    api.removeTower(first);
    expect(api.snapshot().towers).toHaveLength(1);
    api.clearTowers();
    const shot = api.snapshot();
    expect(shot.towers).toEqual([]);
    expect(shot.money).toBe(50);
    expect(shot.score).toBe(9);
  });

  it("leaves the surge standing when the towers are cleared", () => {
    const { api } = playing();
    api.addTower("arc", 10, 10);
    api.addUnit("mote", "left");
    api.clearTowers();
    expect(api.snapshot().surge).toHaveLength(1);
  });

  it("poses the heat without tripping the tower", () => {
    const { api } = playing();
    const id = api.addTower("arc", 20, 20);
    api.setTowerHeat(id, 100);
    const tower = api.snapshot().towers[0];
    expect(tower.heat).toBe(100);
    expect(tower.tripped).toBe(false);
    expect(tower.tripTimer).toBe(0);
    expect(tower.heatMult).toBeCloseTo(heatMultiplier(100, 80), 12);
  });

  it("clamps a posed heat to the scale, and leaves a mover cold forever", () => {
    const { api } = playing();
    const arc = api.addTower("arc", 20, 20);
    api.setTowerHeat(arc, 500);
    expect(api.snapshot().towers[0].heat).toBe(100);
    api.setTowerHeat(arc, -20);
    expect(api.snapshot().towers[0].heat).toBe(0);
    const forge = api.addTower("forge", 24, 24);
    api.setTowerHeat(forge, 80);
    const posed = api.snapshot().towers[1];
    expect(posed.heat).toBe(0);
    expect(posed.heatMult).toBe(0);
    expect(posed.damage).toBe(0);
  });

  it("sets the trip flag and the cooldown independently of one another", () => {
    const { api } = playing();
    const id = api.addTower("arc", 20, 20);
    api.setTowerHeat(id, 40);
    api.setTowerTripped(id, true);
    let tower = api.snapshot().towers[0];
    expect(tower.tripped).toBe(true);
    expect(tower.heat).toBe(40);
    expect(tower.tripTimer).toBe(0);
    api.setTowerTripTimer(id, 2.5);
    tower = api.snapshot().towers[0];
    expect(tower.tripTimer).toBe(2.5);
    expect(tower.tripped).toBe(true);
    api.setTowerTripped(id, false);
    tower = api.snapshot().towers[0];
    expect(tower.tripped).toBe(false);
    expect(tower.tripTimer).toBe(2.5);
  });

  it("poses a level, spending nothing, and every derived figure follows", () => {
    const { api } = playing();
    api.setMoney(4);
    const id = api.addTower("arc", 20, 20);
    api.setTowerLevel(id, 3);
    const tower = api.snapshot().towers[0];
    const stats = emitterStats(TOWER_DEFS.arc as never, 3);
    expect(api.snapshot().money).toBe(4);
    expect(tower.level).toBe(3);
    expect(tower.spent).toBe(TOWER_DEFS.arc.cost);
    expect(tower.upgradeCost).toBe(0);
    expect(tower.damage).toBeCloseTo(
      stats.baseDamage * heatMultiplier(0, 80),
      12,
    );
  });

  it("poses freshness, which is what the refund is measured against", () => {
    const { api } = playing();
    const id = api.addTower("arc", 20, 20);
    expect(api.snapshot().towers[0].refund).toBe(TOWER_DEFS.arc.cost);
    api.setTowerFresh(id, false);
    expect(api.snapshot().towers[0].fresh).toBe(false);
    expect(api.snapshot().towers[0].refund).toBe(
      Math.floor(0.7 * TOWER_DEFS.arc.cost),
    );
  });

  it("gates each faculty and reports both", () => {
    const { api } = playing();
    const id = api.addTower("arc", 20, 20);
    api.setTowerFiring(id, false);
    api.setTowerThermal(id, false);
    let tower = api.snapshot().towers[0];
    expect(tower.firingEnabled).toBe(false);
    expect(tower.thermalEnabled).toBe(false);
    api.setTowerFiring(id, true);
    api.setTowerThermal(id, true);
    tower = api.snapshot().towers[0];
    expect(tower.firingEnabled).toBe(true);
    expect(tower.thermalEnabled).toBe(true);
  });

  it("ignores an id nothing answers to", () => {
    const { api } = playing();
    api.addTower("arc", 20, 20);
    const before = api.snapshot();
    api.setTowerHeat(999, 50);
    api.setTowerLevel(999, 3);
    api.setTowerTripped(999, true);
    api.setTowerTripTimer(999, 3);
    api.setTowerFresh(999, false);
    api.setTowerFiring(999, false);
    api.setTowerThermal(999, false);
    api.removeTower(999);
    api.upgradeTower(999);
    api.sellTower(999);
    expect(api.snapshot()).toEqual(before);
  });

  it("reports every world radiator face after the placement rotation", () => {
    const { api } = playing();
    api.addTower("stutter", 10, 10, 0);
    api.addTower("stutter", 14, 10, 1);
    const shot = api.snapshot();
    expect(shot.towers[0].radiatorFaces).toEqual(["N", "E"]);
    expect(shot.towers[1].radiatorFaces).toEqual(["E", "S"]);
  });
});

describe("building", () => {
  it("arms a type at rotation zero and disarms on null", () => {
    const { api } = playing();
    api.setArmed("bloom");
    let shot = api.snapshot();
    expect(shot.build).not.toBeNull();
    expect(shot.build?.type).toBe("bloom");
    expect(shot.build?.rotation).toBe(0);
    api.setArmed(null);
    shot = api.snapshot();
    expect(shot.build).toBeNull();
    expect(shot.controls.rotate).toBeNull();
    expect(shot.controls.cancel).toBeNull();
  });

  it("moves the preview, clamped so the footprint stays on the grid", () => {
    const { api } = playing();
    api.setArmed("lance");
    api.setPreview(10, 12);
    expect(api.snapshot().build).toMatchObject({ col: 10, row: 12 });
    api.setPreview(999, 999);
    expect(api.snapshot().build).toMatchObject({ col: 46, row: 32 });
    api.setPreview(-5, -5);
    expect(api.snapshot().build).toMatchObject({ col: 0, row: 0 });
  });

  it("follows the real placement check in build.valid", () => {
    const { api } = playing();
    api.setArmed("arc");
    api.setPreview(20, 20);
    expect(api.snapshot().build?.valid).toBe(true);
    api.addTower("arc", 20, 20);
    expect(api.snapshot().build?.valid).toBe(false);
    api.setPreview(30, 20);
    expect(api.snapshot().build?.valid).toBe(true);
    api.setMoney(0);
    expect(api.snapshot().build?.valid).toBe(false);
  });

  it("sets the held rotation outright", () => {
    const { api } = playing();
    api.setArmed("arc");
    api.setPreviewRotation(3);
    expect(api.snapshot().build?.rotation).toBe(3);
  });

  it("commits a valid preview through the real placement code", () => {
    const { api } = playing();
    api.setMoney(100);
    api.setArmed("arc");
    api.setPreview(20, 20);
    api.setPreviewRotation(1);
    api.place();
    const shot = api.snapshot();
    expect(shot.money).toBe(100 - TOWER_DEFS.arc.cost);
    expect(shot.towers).toHaveLength(1);
    expect(shot.towers[0]).toMatchObject({ col: 20, row: 20, rotation: 1 });
    expect(shot.build).not.toBeNull();
  });

  it("builds nothing and spends nothing on an invalid footprint", () => {
    const { api } = playing();
    api.setMoney(100);
    api.addTower("arc", 20, 20);
    api.setArmed("arc");
    api.setPreview(20, 20);
    api.place();
    const shot = api.snapshot();
    expect(shot.towers).toHaveLength(1);
    expect(shot.money).toBe(100);
  });

  it("selects and deselects a placed tower, and offers its two actions", () => {
    const { api } = playing();
    const id = api.addTower("arc", 20, 20);
    expect(api.snapshot().controls.upgrade).toBeNull();
    api.setSelected(id);
    let shot = api.snapshot();
    expect(shot.selected).toBe(id);
    expect(shot.controls.upgrade).not.toBeNull();
    expect(shot.controls.sell).not.toBeNull();
    api.setSelected(null);
    shot = api.snapshot();
    expect(shot.selected).toBeNull();
    expect(shot.controls.sell).toBeNull();
  });

  it("sets and clears the hovered shop entry", () => {
    const { api } = playing();
    api.setHoverShop("sink");
    expect(api.snapshot().hoverShop).toBe("sink");
    api.setHoverShop(null);
    expect(api.snapshot().hoverShop).toBeNull();
  });

  it("upgrades through the real code, paying and tallying the cost", () => {
    const { api } = playing();
    api.setMoney(15);
    const id = api.addTower("arc", 20, 20);
    api.upgradeTower(id);
    let tower = api.snapshot().towers[0];
    expect(tower.level).toBe(2);
    expect(tower.spent).toBe(15 + 15);
    expect(api.snapshot().money).toBe(0);
    api.upgradeTower(id);
    tower = api.snapshot().towers[0];
    expect(tower.level).toBe(2);
  });

  it("sells through the real code, paying the refund and re-paving the floor", () => {
    const { api } = playing();
    api.setMoney(0);
    const id = api.addTower("arc", 20, 20);
    api.setSelected(id);
    const open = api.snapshot().paths.left.length;
    api.sellTower(id);
    const shot = api.snapshot();
    expect(shot.money).toBe(TOWER_DEFS.arc.cost);
    expect(shot.towers).toEqual([]);
    expect(shot.selected).toBeNull();
    expect(shot.paths.left.length).toBeLessThanOrEqual(open);
  });
});

describe("the surge", () => {
  it("adds a unit at its vent, appended, at full scaled hp", () => {
    const { api } = playing();
    api.setWave(3);
    const id = api.addUnit("hulk", "top");
    const shot = api.snapshot();
    expect(shot.surge).toHaveLength(1);
    const unit = shot.surge[0];
    expect(unit.id).toBe(id);
    expect(unit.type).toBe("hulk");
    expect(unit.vent).toBe("top");
    expect(unit.exhaust).toBe("bottom");
    expect(unit.hp).toBe(unit.maxHp);
    expect(unit.maxHp).toBeCloseTo(SURGE_DEFS.hulk.hp * (1 + 0.62 * 2), 6);
    expect(unit.motion).toBe(true);
    expect(unit.flying).toBe(false);
    expect(unit.baseSpeed).toBe(SURGE_DEFS.hulk.speed);
  });

  it("counts an added unit toward waveRemaining only in the wave phase", () => {
    const { api } = playing();
    api.setWavePending(4);
    api.addUnit("mote", "left");
    expect(api.snapshot().waveRemaining).toBe(4);
    api.setPhase("wave");
    expect(api.snapshot().waveRemaining).toBe(5);
  });

  it("removes and clears with no life, bounty, score or money moved", () => {
    const { api } = playing();
    api.setMoney(10);
    api.setLives(7);
    api.setScore(3);
    const first = api.addUnit("core", "left");
    api.addUnit("mote", "top");
    api.removeUnit(first);
    expect(api.snapshot().surge).toHaveLength(1);
    api.clearSurge();
    const shot = api.snapshot();
    expect(shot.surge).toEqual([]);
    expect(shot.money).toBe(10);
    expect(shot.lives).toBe(7);
    expect(shot.score).toBe(3);
  });

  it("leaves the towers untouched when the surge is cleared", () => {
    const { api } = playing();
    const id = api.addTower("arc", 20, 20);
    api.setTowerHeat(id, 55);
    api.setTowerLevel(id, 2);
    api.addUnit("mote", "left");
    api.clearSurge();
    const tower = api.snapshot().towers[0];
    expect(tower.heat).toBe(55);
    expect(tower.level).toBe(2);
  });

  it("places a unit's centre and re-paths from the tile it lands in", () => {
    const { api } = playing();
    const id = api.addUnit("mote", "left");
    api.setUnitPosition(id, tileCX(30), tileCY(5));
    const unit = api.snapshot().surge[0];
    expect(unit.x).toBe(tileCX(30));
    expect(unit.y).toBe(tileCY(5));
    expect(unit.col).toBe(30);
    expect(unit.row).toBe(5);
    expect(unit.vent).toBe("left");
    expect(unit.exhaust).toBe("right");
    expect(unit.remaining).toBeGreaterThan(0);
  });

  it("poses hp without killing the unit, and the bar it is drawn against", () => {
    const { api } = playing();
    const id = api.addUnit("mote", "left");
    api.setUnitHp(id, 0);
    expect(api.snapshot().surge).toHaveLength(1);
    expect(api.snapshot().surge[0].hp).toBe(0);
    api.setUnitMaxHp(id, 999);
    expect(api.snapshot().surge[0].maxHp).toBe(999);
  });

  it("poses the slow so the speed follows immediately", () => {
    const { api } = playing();
    const id = api.addUnit("mote", "left");
    api.setUnitSlow(id, 0.25);
    let unit = api.snapshot().surge[0];
    expect(unit.slowed).toBe(true);
    expect(unit.slowFactor).toBe(0.25);
    expect(unit.speed).toBeCloseTo(SURGE_DEFS.mote.speed * 0.75, 9);
    api.setUnitSlowTimer(id, 0.8);
    expect(api.snapshot().surge[0].slowTimer).toBe(0.8);
    api.setUnitSlow(id, 0);
    unit = api.snapshot().surge[0];
    expect(unit.slowed).toBe(false);
    expect(unit.speed).toBe(SURGE_DEFS.mote.speed);
  });

  it("gates locomotion and nothing else", () => {
    const { api, state } = playing();
    const id = api.addUnit("mote", "left");
    api.setUnitMotion(id, false);
    expect(api.snapshot().surge[0].motion).toBe(false);
    const before = api.snapshot().surge[0].remaining;
    api.addTower("lance", 1, 14);
    expect(api.snapshot().surge[0].remaining).toBeGreaterThan(before);
    expect(remainingOf(state.surge[0], state.floor)).toBeGreaterThan(before);
  });

  it("ignores an id nothing answers to", () => {
    const { api } = playing();
    api.addUnit("mote", "left");
    const before = api.snapshot();
    api.setUnitPosition(999, 1, 1);
    api.setUnitHp(999, 1);
    api.setUnitMaxHp(999, 1);
    api.setUnitSlow(999, 1);
    api.setUnitSlowTimer(999, 1);
    api.setUnitMotion(999, false);
    api.removeUnit(999);
    expect(api.snapshot()).toEqual(before);
  });
});

describe("the pointer", () => {
  it("feeds the game's own pointer path, so a posed press arms a shop entry", () => {
    const { api } = playing();
    const entry = panelControls(createState()).shop[0];
    const x = entry.x + entry.w / 2;
    const y = entry.y + entry.h / 2;
    api.pointerMove(x, y);
    expect(api.snapshot().hoverShop).toBe(TOWER_TYPES[0]);
    api.pointerDown(x, y);
    expect(api.snapshot().pointer).toEqual({ x, y, down: true });
    api.pointerUp();
    const shot = api.snapshot();
    expect(shot.pointer.down).toBe(false);
    expect(shot.build?.type).toBe(TOWER_TYPES[0]);
  });

  it("releases at the last reported position", () => {
    const { api } = playing();
    api.pointerDown(200, 200);
    api.pointerMove(300, 240);
    api.pointerUp();
    expect(api.snapshot().pointer).toEqual({ x: 300, y: 240, down: false });
  });
});

describe("the reported menu", () => {
  it("reports one rectangle per row, in row order, on every menu screen", () => {
    const { api } = surface();
    for (const [screen, items] of [
      ["title", TITLE_ITEMS],
      ["modeselect", MODE_ITEMS],
      ["difficultyselect", DIFFICULTY_ITEMS],
      ["howto", HOWTO_ITEMS],
      ["paused", PAUSE_ITEMS],
      ["victory", ENDING_ITEMS],
      ["gameover", ENDING_ITEMS],
    ] as const) {
      api.setScreen(screen);
      const rows = api.snapshot().menu;
      expect(rows).toHaveLength(items.length);
      expect(rows.map((row) => row.index)).toEqual(
        items.map((_item, index) => index),
      );
    }
  });

  it("reports none at all while the screen is playing", () => {
    const { api } = playing();
    expect(api.snapshot().menu).toEqual([]);
  });
});

describe("the snapshot shape", () => {
  it("carries exactly the fields the specification lists", () => {
    const { api } = surface();
    expect(Object.keys(api.snapshot()).sort()).toEqual(
      [
        "autoStep",
        "build",
        "buildTimer",
        "buildZone",
        "controls",
        "difficulty",
        "hoverShop",
        "interest",
        "lives",
        "menu",
        "menuIndex",
        "mode",
        "money",
        "muted",
        "nextWave",
        "paths",
        "phase",
        "pointer",
        "score",
        "screen",
        "selected",
        "simTime",
        "speed",
        "startLives",
        "startMoney",
        "surge",
        "towers",
        "version",
        "wave",
        "waveCount",
        "wavePending",
        "waveRemaining",
        "waveSpawning",
      ].sort(),
    );
  });

  it("reports both routes, each lengthened by what the floor now carries", () => {
    const { api } = playing();
    const open = api.snapshot().paths;
    expect(open.left.length).toBeCloseTo(49, 6);
    expect(open.top.length).toBeCloseTo(35, 6);
    // Two baffles, each leaving a way past, so both routes lengthen and
    // neither disappears: a wall down cols 20-21 from the top edge to row 25,
    // which the left stream must drop below, and a wall across cols 22-29 at
    // rows 24-25, which the top stream must swing right of.
    for (let row = 0; row < 26; row += 2) api.addTower("arc", 20, row);
    for (const col of [22, 24, 26, 28]) api.addTower("arc", col, 24);
    const mazed = api.snapshot().paths;
    expect(mazed.left.length).toBeGreaterThan(open.left.length);
    expect(mazed.top.length).toBeGreaterThan(open.top.length);
    expect(Number.isFinite(mazed.left.length)).toBe(true);
    expect(Number.isFinite(mazed.top.length)).toBe(true);
  });

  it("reports the coming wave, and nothing past the last one", () => {
    const { api } = playing();
    api.setPhase("building");
    api.setWave(1);
    expect(api.snapshot().nextWave).toEqual({ type: "mote", count: 12 });
    api.setPhase("wave");
    expect(api.snapshot().nextWave).toEqual({ type: "mote", count: 15 });
    api.setWave(20);
    expect(api.snapshot().nextWave).toBeNull();
    api.setMode("hundred");
    api.setWave(1);
    api.setPhase("building");
    expect(api.snapshot().nextWave).toEqual({ type: "mote", count: 100 });
  });

  it("reports every panel control as a rectangle inside the panel's strip", () => {
    const { api } = playing();
    api.setArmed("arc");
    const id = api.addTower("arc", 20, 20);
    api.setSelected(id);
    const controls = api.snapshot().controls;
    const rects = [
      ...controls.shop,
      controls.rotate,
      controls.cancel,
      controls.upgrade,
      controls.sell,
      controls.send,
      controls.speed,
      controls.pause,
      controls.mute,
    ];
    expect(controls.shop).toHaveLength(8);
    for (const rect of rects) {
      expect(rect).not.toBeNull();
      if (rect === null) continue;
      expect(rect.x).toBeGreaterThanOrEqual(986);
      expect(rect.x + rect.w).toBeLessThanOrEqual(1280);
      expect(rect.w).toBeGreaterThanOrEqual(32);
      expect(rect.h).toBeGreaterThanOrEqual(32);
    }
  });

  it("reports the movers' output and no emitter's", () => {
    const { api } = playing();
    for (const type of TOWER_TYPES) api.addTower(type, 0, 0);
    for (const tower of api.snapshot().towers) {
      const def = TOWER_DEFS[tower.type];
      if (isEmitter(def)) {
        expect(tower.output).toBe(0);
        expect(tower.heatMult).toBeGreaterThan(0);
        expect(tower.damage).toBeGreaterThan(0);
      } else {
        expect(tower.output).toBe(def.output[0]);
        expect(tower.heatMult).toBe(0);
        expect(tower.damage).toBe(0);
        expect(tower.radiatorFaces).toEqual([]);
      }
    }
  });

  it("reports a Rime's live slow and nothing on any other tower", () => {
    const { api } = playing();
    const rime = api.addTower("rime", 10, 10);
    const arc = api.addTower("arc", 14, 10);
    api.setTowerHeat(rime, 50);
    api.setTowerHeat(arc, 50);
    const shot = api.snapshot();
    expect(shot.towers[0].slowFactor).toBeCloseTo(0.275, 9);
    expect(shot.towers[1].slowFactor).toBe(0);
  });

  it("measures a flyer's remaining as the straight line over the tile", () => {
    const { api } = playing();
    const id = api.addUnit("drift", "left");
    api.setUnitPosition(id, 958.5 - 10 * TILE, 360);
    const unit = api.snapshot().surge[0];
    expect(unit.flying).toBe(true);
    expect(unit.remaining).toBeCloseTo(10, 6);
  });

  it("reports the game's own copy of the mute bit, never reading it at the call", () => {
    const { api, state } = surface();
    expect(api.snapshot().muted).toBe(false);
    state.muted = true;
    expect(api.snapshot().muted).toBe(true);
  });
});
