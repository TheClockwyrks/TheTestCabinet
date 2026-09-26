// Meltdown under the engine, in process.
//
// Every check here builds a real engine over an `@napi-rs/canvas` canvas and a
// `SurfaceMetrics` of its own, so the game runs with no browser and no document
// behind it, and steps it with `engine.advance` against a `ConstantClock`. Keys
// and the pointer are driven by dispatching keyboard-shaped and pointer-shaped
// events at the surface's event target — the same listeners a player's input
// reaches — and what is read back is the debug surface `initialize` returned
// beside the state, the engine's cue events, and the pixels the render
// produced.

import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import {
  ConstantClock,
  createEngine,
  type Engine,
  type SurfaceMetrics,
} from "@clockwyrks/simple-2d";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BUILD_PHASE_TIME,
  COLS,
  CUES,
  DIFFICULTY_ITEMS,
  ENDING_ITEMS,
  HOWTO_ITEMS,
  LAYOUT,
  MODE_ITEMS,
  PAUSE_ITEMS,
  ROWS,
  STAGE_H,
  STAGE_W,
  TILE,
  TITLE_ITEMS,
  TOWER_DEFS,
  TRIP_TIME,
  tileCX,
  tileCY,
  type TowerType,
} from "./constants";
import { BACKGROUND, game, type MeltdownState } from "./game";
import type { MeltdownDebugApi } from "./debug";
import type { MeltdownSnapshot } from "./snapshot";
import type { DeepReadonly } from "ts-essentials";

const FRAME_MS = 1000 / 120;

class KeyEvent extends Event {
  readonly code: string;
  readonly repeat = false;

  constructor(type: "keydown" | "keyup", code: string) {
    super(type);
    this.code = code;
  }
}

class PointerEvt extends Event {
  readonly clientX: number;
  readonly clientY: number;
  readonly isPrimary = true;

  constructor(
    type: "pointerdown" | "pointermove" | "pointerup",
    x: number,
    y: number,
  ) {
    super(type);
    this.clientX = x;
    this.clientY = y;
  }
}

interface CuePlay {
  cue: string;
  gain: number;
}

interface Harness {
  readonly engine: Engine<MeltdownState, MeltdownDebugApi>;
  readonly debug: MeltdownDebugApi;
  readonly ctx: SKRSContext2D;
  readonly cues: CuePlay[];
  snap(): MeltdownSnapshot;
  pose(
    step: (
      debug: MeltdownDebugApi,
      state: DeepReadonly<MeltdownState>,
    ) => MeltdownState,
  ): void;
  tap(code: string): void;
  pointer(
    type: "pointerdown" | "pointermove" | "pointerup",
    x: number,
    y: number,
  ): void;
  pixel(x: number, y: number): [number, number, number];
  dispose(): void;
}

async function createHarness(): Promise<Harness> {
  const canvas = createCanvas(STAGE_W, STAGE_H);
  const ctx = canvas.getContext("2d");
  const element = Object.assign(canvas, {
    style: {} as CSSStyleDeclaration,
    getContext: () => ctx,
  }) as unknown as HTMLCanvasElement;

  const events = new EventTarget();
  const surface: SurfaceMetrics = {
    cssWidth: () => STAGE_W,
    cssHeight: () => STAGE_H,
    dpr: () => 1,
    events: () => events,
  };

  // Exactly the options src/main.ts passes, plus the clock and the surface a
  // headless run needs.
  const engine = createEngine<MeltdownState, MeltdownDebugApi>({
    canvas: element,
    width: STAGE_W,
    height: STAGE_H,
    game,
    background: BACKGROUND,
    layout: LAYOUT,
    clock: new ConstantClock(FRAME_MS),
    surface,
  });

  const cues: CuePlay[] = [];
  engine.events.on("cue:played", ({ cue, gain }) => cues.push({ cue, gain }));

  await engine.initialize();

  return {
    engine,
    // Read off the engine rather than built here, so a build that failed to
    // return the surface beside its state fails here.
    debug: engine.debug,
    ctx,
    cues,
    snap: () => engine.debug.snapshot(engine.state),
    pose: (step) => {
      engine.apply((s) => step(engine.debug, s));
    },
    tap: (code) => {
      events.dispatchEvent(new KeyEvent("keydown", code));
      events.dispatchEvent(new KeyEvent("keyup", code));
    },
    pointer: (type, x, y) => {
      events.dispatchEvent(new PointerEvt(type, x, y));
    },
    pixel: (x, y) => {
      const { data } = ctx.getImageData(Math.round(x), Math.round(y), 1, 1);
      return [data[0], data[1], data[2]];
    },
    dispose: () => engine.destroy(),
  };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** An empty, quiet floor in a build phase, which is what a scenario poses on. */
function startRun(): void {
  h.pose((d, s) => d.reset(s));
  h.pose((d, s) => d.setScreen(s, "playing"));
  h.pose((d, s) => d.setPhase(s, "building"));
  h.pose((d, s) => d.setBuildTimer(s, BUILD_PHASE_TIME));
  h.pose((d, s) => d.setWaveSpawning(s, false));
  h.pose((d, s) => d.setMoney(s, 5000));
}

/** Pose one tower and return its id, which is the last of the roster. */
function poseTower(type: TowerType, col: number, row: number, rot = 0): number {
  h.pose((d, s) => d.addTower(s, type, col, row, rot));
  const towers = h.snap().towers;
  return towers[towers.length - 1].id;
}

/** Pose one stationary, effectively unkillable target on a tile. */
function poseTarget(col: number, row: number, hp = 1e6): number {
  h.pose((d, s) => d.addUnit(s, "mote", "left"));
  const units = h.snap().surge;
  const id = units[units.length - 1].id;
  h.pose((d, s) => d.setUnitPosition(s, id, tileCX(col), tileCY(row)));
  h.pose((d, s) => d.setUnitMotion(s, id, false));
  h.pose((d, s) => d.setUnitMaxHp(s, id, hp));
  h.pose((d, s) => d.setUnitHp(s, id, hp));
  return id;
}

function tower(id: number) {
  const found = h.snap().towers.find((t) => t.id === id);
  if (!found) throw new Error(`no tower ${id}`);
  return found;
}

function unit(id: number) {
  return h.snap().surge.find((u) => u.id === id) ?? null;
}

// ---- Boot ----------------------------------------------------------------

describe("initialization", () => {
  it("opens on the title screen with the surface in place", () => {
    const snap = h.snap();
    expect(snap.version).toBe(1);
    expect(snap.screen).toBe("title");
    expect(snap.phase).toBe("opening");
    expect(snap.mode).toBe("containment");
    expect(snap.difficulty).toBe("medium");
    expect(snap.money).toBe(250);
    expect(snap.lives).toBe(20);
    expect(snap.wave).toBe(1);
    expect(snap.waveSpawning).toBe(true);
    expect(snap.towers).toEqual([]);
    expect(snap.surge).toEqual([]);
  });

  it("reports the open floor's two routes", () => {
    const snap = h.snap();
    // 49 orthogonal steps across, and 35 down, with nothing in the way.
    expect(snap.paths.left.length).toBeCloseTo(49, 6);
    expect(snap.paths.top.length).toBeCloseTo(35, 6);
  });

  it("plays nothing before the first input reaches it", async () => {
    await h.engine.advance(30);
    expect(h.cues).toEqual([]);
  });
});

// ---- Poses read back -----------------------------------------------------

describe("the debug surface", () => {
  it("reads every posed field back", () => {
    startRun();
    h.pose((d, s) => d.setMenuIndex(s, 2));
    h.pose((d, s) => d.setMode(s, "bottleneck"));
    h.pose((d, s) => d.setDifficulty(s, "hard"));
    h.pose((d, s) => d.setMoney(s, 777));
    h.pose((d, s) => d.setLives(s, 9));
    h.pose((d, s) => d.setScore(s, 4321));
    h.pose((d, s) => d.setWave(s, 6));
    h.pose((d, s) => d.setBuildTimer(s, 3.25));
    h.pose((d, s) => d.setWavePending(s, 12));
    h.pose((d, s) => d.setSpeed(s, 2));
    h.pose((d, s) => d.setWaveSpawning(s, true));
    const snap = h.snap();
    expect(snap.menuIndex).toBe(2);
    expect(snap.mode).toBe("bottleneck");
    expect(snap.difficulty).toBe("hard");
    expect(snap.money).toBe(777);
    expect(snap.lives).toBe(9);
    expect(snap.score).toBe(4321);
    expect(snap.wave).toBe(6);
    expect(snap.buildTimer).toBeCloseTo(3.25, 6);
    expect(snap.wavePending).toBe(12);
    expect(snap.speed).toBe(2);
    expect(snap.waveSpawning).toBe(true);
    expect(snap.buildZone).toEqual({ col0: 13, row0: 8, col1: 36, row1: 27 });
  });

  it("poses a tower's own fields", () => {
    startRun();
    const id = poseTower("arc", 10, 10);
    h.pose((d, s) => d.setTowerHeat(s, id, 64));
    h.pose((d, s) => d.setTowerLevel(s, id, 3));
    h.pose((d, s) => d.setTowerFresh(s, id, false));
    h.pose((d, s) => d.setTowerTripped(s, id, true));
    h.pose((d, s) => d.setTowerTripTimer(s, id, 2.5));
    h.pose((d, s) => d.setTowerFiring(s, id, false));
    h.pose((d, s) => d.setTowerThermal(s, id, false));
    const t = tower(id);
    expect(t.heat).toBeCloseTo(64, 6);
    expect(t.level).toBe(3);
    expect(t.fresh).toBe(false);
    expect(t.tripped).toBe(true);
    expect(t.tripTimer).toBeCloseTo(2.5, 6);
    expect(t.firingEnabled).toBe(false);
    expect(t.thermalEnabled).toBe(false);
    expect(t.upgradeCost).toBe(0);
  });

  it("poses the pointer and reads it straight back", () => {
    startRun();
    h.pose((d, s) => d.pointerDown(s, 300, 200));
    expect(h.snap().pointer).toEqual({ x: 300, y: 200, down: true });
    h.pose((d, s) => d.pointerMove(s, 320, 210));
    expect(h.snap().pointer).toEqual({ x: 320, y: 210, down: true });
    h.pose((d, s) => d.pointerUp(s));
    expect(h.snap().pointer.down).toBe(false);
  });

  it("restores the title screen and leaves mute alone", () => {
    startRun();
    poseTower("lance", 20, 20);
    poseTarget(30, 18);
    h.tap("KeyM");
    // One frame so the mute action reaches the bus and the mirror comes back.
    void h.engine.advance(1);
    h.pose((d, s) => d.setScore(s, 99));
    h.pose((d, s) => d.reset(s));
    const snap = h.snap();
    expect(snap.screen).toBe("title");
    expect(snap.money).toBe(250);
    expect(snap.score).toBe(0);
    expect(snap.towers).toEqual([]);
    expect(snap.surge).toEqual([]);
    expect(snap.waveSpawning).toBe(true);
  });

  it("adds a tower without spending, and removes one without refunding", () => {
    startRun();
    h.pose((d, s) => d.setMoney(s, 0));
    const id = poseTower("lance", 20, 20);
    expect(h.snap().money).toBe(0);
    expect(tower(id).spent).toBe(TOWER_DEFS.lance.cost);
    h.pose((d, s) => d.removeTower(s, id));
    expect(h.snap().money).toBe(0);
    expect(h.snap().towers).toEqual([]);
  });

  it("fails loudly where the game has no defined state to reach", () => {
    startRun();
    const id = poseTower("arc", 10, 10);
    const forge = poseTower("forge", 16, 16);
    const before = h.snap();

    // An id no tower or unit carries names nothing.
    expect(() => h.pose((d, s) => d.setTowerHeat(s, 999, 50))).toThrow(
      RangeError,
    );
    expect(() => h.pose((d, s) => d.removeTower(s, 999))).toThrow(RangeError);
    expect(() => h.pose((d, s) => d.upgradeTower(s, 999))).toThrow(RangeError);
    expect(() => h.pose((d, s) => d.sellTower(s, 999))).toThrow(RangeError);
    expect(() => h.pose((d, s) => d.setUnitHp(s, 999, 1))).toThrow(RangeError);
    // A mover carries no heat of its own, so there is none to reach.
    expect(() => h.pose((d, s) => d.setTowerHeat(s, forge, 50))).toThrow(
      RangeError,
    );
    // Ranges the specs fix as constants are domains, not rules.
    expect(() => h.pose((d, s) => d.setTowerHeat(s, id, 500))).toThrow(
      RangeError,
    );
    expect(() => h.pose((d, s) => d.setTowerLevel(s, id, 4))).toThrow(
      RangeError,
    );
    // Nothing armed means there is no preview to move or commit.
    h.pose((d, s) => d.setArmed(s, null));
    expect(() => h.pose((d, s) => d.setPreview(s, 4, 4))).toThrow(RangeError);
    expect(() => h.pose((d, s) => d.place(s))).toThrow(RangeError);

    // Every one of those was loud rather than quiet: the floor never moved.
    expect(h.snap()).toEqual(before);
  });

  it("moves the preview to the anchor named, and never nudges it", () => {
    startRun();
    h.pose((d, s) => d.setArmed(s, "lance"));
    h.pose((d, s) => d.setPreview(s, 10, 12));
    expect(h.snap().build).toMatchObject({ col: 10, row: 12 });
    // A footprint hanging off the far edge lands where it was asked for and is
    // reported invalid; it is not slid back onto the grid.
    h.pose((d, s) => d.setPreview(s, COLS - 1, ROWS - 1));
    expect(h.snap().build).toMatchObject({
      col: COLS - 1,
      row: ROWS - 1,
      valid: false,
    });
  });

  it("reconcile re-derives a reading from a posed position", () => {
    startRun();
    const id = poseTarget(30, 18);
    h.pose((d, s) => d.setUnitPosition(s, id, tileCX(18), tileCY(9)));
    h.pose((d, s) => d.reconcile(s));
    const unit = h.snap().surge[0];
    expect({ col: unit.col, row: unit.row }).toEqual({ col: 18, row: 9 });
    expect(unit.remaining).toBeGreaterThan(0);
  });

  it("reconcile advances nothing, and twice is once", () => {
    startRun();
    const id = poseTower("arc", 10, 10);
    h.pose((d, s) => d.setTowerHeat(s, id, 40));
    h.pose((d, s) => d.setTowerTripTimer(s, id, 2));
    const target = poseTarget(30, 18);
    h.pose((d, s) => d.setUnitSlowTimer(s, target, 1.5));

    const before = h.snap();
    h.pose((d, s) => d.reconcile(s));
    const once = h.snap();
    h.pose((d, s) => d.reconcile(s));
    const twice = h.snap();

    expect(once.simTime).toBe(before.simTime);
    expect(once.buildTimer).toBe(before.buildTimer);
    expect(once.towers[0].tripTimer).toBe(before.towers[0].tripTimer);
    expect(once.surge[0].slowTimer).toBe(before.surge[0].slowTimer);
    expect(once).toEqual(before);
    expect(twice).toEqual(once);
  });
});

// ---- The heat model ------------------------------------------------------

describe("heat", () => {
  it("sheds a lone Arc's eight open edge-tiles at the stated rate", async () => {
    startRun();
    const id = poseTower("arc", 10, 10);
    h.pose((d, s) => d.setTowerFiring(s, id, false));
    h.pose((d, s) => d.setTowerHeat(s, id, 80));
    const dt = FRAME_MS / 1000;
    await h.engine.advance(1);
    // Four radiator edge-tiles (N and S of a 2x2) and four plain ones.
    const expected = 80 - (3.6 * 2 + 1.1 * 2 + 3.6 * 2 + 1.1 * 2) * 0.8 * dt;
    expect(tower(id).heat).toBeCloseTo(expected, 9);
  });

  it("raises heat by heatPerShot over the mass on one shot", async () => {
    startRun();
    const id = poseTower("arc", 10, 10);
    h.pose((d, s) => d.setTowerThermal(s, id, false));
    poseTarget(12, 11);
    // Half a second is exactly one Arc interval; thermal is held so only the
    // shot's own gain would move the heat, and it is held too.
    await h.engine.advance(60);
    expect(tower(id).heat).toBe(0);
    expect(tower(id).damageDealt).toBeGreaterThan(0);
  });

  it("trips on the crossing and returns cold", async () => {
    startRun();
    const id = poseTower("arc", 10, 10);
    h.pose((d, s) => d.setTowerHeat(s, id, 99));
    poseTarget(12, 11);
    await h.engine.advance(240);
    expect(tower(id).tripped).toBe(true);
    expect(tower(id).tripTimer).toBeGreaterThan(0);
    expect(h.cues.some((c) => c.cue === CUES.trip)).toBe(true);
    // Firing is held off so the cooldown is measured on its own, and the
    // tower's return is read before it starts climbing again.
    h.pose((d, s) => d.setTowerFiring(s, id, false));
    await h.engine.advance(Math.ceil((TRIP_TIME * 1000) / FRAME_MS) + 2);
    expect(tower(id).tripped).toBe(false);
    expect(tower(id).heat).toBe(0);
  });

  it("does not trip a tower posed at 100 that is cooling", async () => {
    startRun();
    const id = poseTower("arc", 10, 10);
    h.pose((d, s) => d.setTowerFiring(s, id, false));
    h.pose((d, s) => d.setTowerHeat(s, id, 100));
    await h.engine.advance(4);
    expect(tower(id).tripped).toBe(false);
    expect(tower(id).heat).toBeLessThan(100);
  });

  it("holds a tower's heat while its thermal faculty is held", async () => {
    startRun();
    const id = poseTower("arc", 10, 10);
    h.pose((d, s) => d.setTowerThermal(s, id, false));
    h.pose((d, s) => d.setTowerHeat(s, id, 60));
    poseTower("forge", 12, 10);
    await h.engine.advance(120);
    expect(tower(id).heat).toBeCloseTo(60, 9);
  });
});

// ---- Combat --------------------------------------------------------------

describe("combat", () => {
  it("lands its first shot one full interval in", async () => {
    startRun();
    const id = poseTower("arc", 10, 10);
    h.pose((d, s) => d.setTowerThermal(s, id, false));
    const target = poseTarget(12, 11);
    const before = unit(target)?.hp ?? 0;
    // An Arc fires twice a second, so 0.49s is short of the first interval.
    await h.engine.advance(58);
    expect(unit(target)?.hp).toBe(before);
    await h.engine.advance(4);
    expect(unit(target)?.hp).toBeLessThan(before);
  });

  it("removes base damage times the multiplier at the posed heat", async () => {
    startRun();
    const id = poseTower("arc", 10, 10);
    h.pose((d, s) => d.setTowerThermal(s, id, false));
    h.pose((d, s) => d.setTowerHeat(s, id, 40));
    const target = poseTarget(12, 11);
    const before = unit(target)?.hp ?? 0;
    await h.engine.advance(61);
    const multiplier = 0.35 + 3.15 * Math.pow(40 / 80, 2);
    expect((before - (unit(target)?.hp ?? 0)) / 1).toBeCloseTo(
      6 * multiplier,
      6,
    );
  });

  it("holds a Flak off every ground unit", async () => {
    startRun();
    const id = poseTower("flak", 10, 10);
    h.pose((d, s) => d.setTowerThermal(s, id, false));
    const target = poseTarget(12, 11);
    await h.engine.advance(600);
    expect(tower(id).firing).toBe(false);
    expect(tower(id).targeting).toBeNull();
    expect(unit(target)?.hp).toBe(1e6);
  });

  it("slows hardest when the Rime is cold and not at all at 100", async () => {
    startRun();
    const id = poseTower("rime", 10, 10);
    h.pose((d, s) => d.setTowerThermal(s, id, false));
    const target = poseTarget(12, 11);
    await h.engine.advance(60);
    expect(unit(target)?.slowFactor).toBeCloseTo(0.55, 9);
    expect(unit(target)?.speed).toBeCloseTo(60 * 0.45, 9);
    h.pose((d, s) => d.setTowerHeat(s, id, 100));
    h.pose((d, s) => d.setUnitSlow(s, target, 0));
    h.pose((d, s) => d.setUnitSlowTimer(s, target, 0));
    await h.engine.advance(60);
    expect(unit(target)?.slowFactor).toBe(0);
    expect(unit(target)?.speed).toBe(60);
  });

  it("deals ordinary damage from a Rime as well as its slow", async () => {
    startRun();
    const id = poseTower("rime", 10, 10);
    h.pose((d, s) => d.setTowerThermal(s, id, false));
    h.pose((d, s) => d.setTowerHeat(s, id, 50));
    const target = poseTarget(12, 11);
    const before = unit(target)?.hp ?? 0;
    // A Rime fires 2.4 times a second, so one interval is 0.41666s.
    await h.engine.advance(51);
    const multiplier = 0.35 + 3.15 * Math.pow(50 / 100, 2);
    expect(before - (unit(target)?.hp ?? 0)).toBeCloseTo(4 * multiplier, 6);
  });
});

// ---- Building ------------------------------------------------------------

describe("building", () => {
  it("places at the held rotation and stays armed", () => {
    startRun();
    h.pose((d, s) => d.setArmed(s, "arc"));
    h.pose((d, s) => d.setPreview(s, 10, 10));
    h.pose((d, s) => d.setPreviewRotation(s, 1));
    expect(h.snap().build).toEqual({
      type: "arc",
      col: 10,
      row: 10,
      rotation: 1,
      valid: true,
    });
    const before = h.snap().money;
    h.pose((d, s) => d.place(s));
    const snap = h.snap();
    expect(snap.money).toBe(before - TOWER_DEFS.arc.cost);
    expect(snap.towers).toHaveLength(1);
    expect(snap.towers[0].rotation).toBe(1);
    expect(snap.towers[0].radiatorFaces).toEqual(["E", "W"]);
    expect(snap.build?.type).toBe("arc");
  });

  it("refuses a footprint that would seal the floor", () => {
    startRun();
    // A wall of Arcs down column 10 leaves the left vent no route out.
    for (let row = 0; row < 36; row += 2) {
      if (row === 34) continue;
      h.pose((d, s) => d.addTower(s, "arc", 10, row, 0));
    }
    h.pose((d, s) => d.setArmed(s, "arc"));
    h.pose((d, s) => d.setPreview(s, 10, 34));
    expect(h.snap().build?.valid).toBe(false);
    h.pose((d, s) => d.place(s));
    expect(h.snap().towers).toHaveLength(17);
  });

  it("refunds in full while fresh and 70% afterwards", () => {
    startRun();
    h.pose((d, s) => d.setMoney(s, 1000));
    const id = poseTower("arc", 10, 10);
    expect(tower(id).refund).toBe(15);
    h.pose((d, s) => d.setTowerFresh(s, id, false));
    expect(tower(id).refund).toBe(Math.floor(0.7 * 15));
    const before = h.snap().money;
    h.pose((d, s) => d.sellTower(s, id));
    expect(h.snap().money).toBe(before + Math.floor(0.7 * 15));
    expect(h.snap().towers).toEqual([]);
  });

  it("upgrades through the level table and stops at three", () => {
    startRun();
    const id = poseTower("arc", 10, 10);
    expect(tower(id).upgradeCost).toBe(15);
    h.pose((d, s) => d.upgradeTower(s, id));
    expect(tower(id).level).toBe(2);
    expect(tower(id).upgradeCost).toBe(27);
    h.pose((d, s) => d.upgradeTower(s, id));
    expect(tower(id).level).toBe(3);
    expect(tower(id).upgradeCost).toBe(0);
    h.pose((d, s) => d.upgradeTower(s, id));
    expect(tower(id).level).toBe(3);
    expect(tower(id).spent).toBe(15 + 15 + 27);
  });
});

// ---- The run -------------------------------------------------------------

describe("the run", () => {
  it("counts the build timer down and auto-starts with the gate on", async () => {
    startRun();
    h.pose((d, s) => d.setWaveSpawning(s, true));
    h.pose((d, s) => d.setBuildTimer(s, 1));
    await h.engine.advance(60);
    expect(h.snap().buildTimer).toBeCloseTo(0.5, 6);
    expect(h.snap().phase).toBe("building");
    await h.engine.advance(61);
    expect(h.snap().phase).toBe("wave");
    expect(h.snap().wavePending).toBeGreaterThan(0);
  });

  it("holds the auto-start with the world gate off", async () => {
    startRun();
    h.pose((d, s) => d.setBuildTimer(s, 0.5));
    await h.engine.advance(240);
    expect(h.snap().phase).toBe("building");
    expect(h.snap().buildTimer).toBe(0);
    expect(h.snap().surge).toEqual([]);
  });

  it("releases one unit every 0.6 seconds, the first on the frame it begins", async () => {
    startRun();
    h.pose((d, s) => d.setWaveSpawning(s, true));
    h.pose((d, s) => d.setPhase(s, "building"));
    h.pose((d, s) => d.setBuildTimer(s, 0));
    await h.engine.advance(1);
    expect(h.snap().phase).toBe("wave");
    expect(h.snap().surge).toHaveLength(1);
    await h.engine.advance(70);
    expect(h.snap().surge).toHaveLength(1);
    await h.engine.advance(1);
    expect(h.snap().surge).toHaveLength(2);
  });

  it("clears the wave when the last unit goes, and pays for it", () => {
    startRun();
    h.pose((d, s) => d.setPhase(s, "wave"));
    h.pose((d, s) => d.setWavePending(s, 0));
    h.pose((d, s) => d.setMoney(s, 100));
    const id = poseTarget(30, 18, 1);
    h.pose((d, s) => d.removeUnit(s, id));
    expect(h.snap().surge).toEqual([]);
    // Removing a unit is not a death or a leak, so nothing clears.
    expect(h.snap().phase).toBe("wave");
  });

  it("advances the wave and pays the bonus when the last unit dies", async () => {
    startRun();
    h.pose((d, s) => d.setPhase(s, "wave"));
    h.pose((d, s) => d.setWavePending(s, 0));
    h.pose((d, s) => d.setMoney(s, 100));
    const gun = poseTower("lance", 10, 10);
    h.pose((d, s) => d.setTowerThermal(s, gun, false));
    poseTarget(13, 11, 1);
    await h.engine.advance(240);
    const snap = h.snap();
    expect(snap.phase).toBe("building");
    expect(snap.wave).toBe(2);
    // 100 + the Mote's bounty of 3, + 20 + 5 for the clear, then 8% interest.
    const afterClear = 100 + 3 + 25;
    expect(snap.money).toBe(afterClear + Math.floor(0.08 * afterClear));
    expect(snap.score).toBe(3 + 100);
    expect(h.cues.some((c) => c.cue === CUES.waveClear)).toBe(true);
  });

  it("costs a life when a unit reaches its exhaust", async () => {
    startRun();
    h.pose((d, s) => d.setLives(s, 5));
    h.pose((d, s) => d.addUnit(s, "mote", "left"));
    const id = h.snap().surge[0].id;
    h.pose((d, s) => d.setUnitPosition(s, id, tileCX(47), tileCY(17)));
    await h.engine.advance(240);
    expect(h.snap().surge).toEqual([]);
    expect(h.snap().lives).toBe(4);
    expect(h.cues.some((c) => c.cue === CUES.leak)).toBe(true);
  });
});

// ---- Keys and the pointer ------------------------------------------------

describe("controls", () => {
  it("moves a menu highlight and wraps at both ends", async () => {
    h.tap("ArrowDown");
    await h.engine.advance(1);
    expect(h.snap().menuIndex).toBe(1);
    h.tap("ArrowDown");
    await h.engine.advance(1);
    expect(h.snap().menuIndex).toBe(0);
    h.tap("ArrowUp");
    await h.engine.advance(1);
    expect(h.snap().menuIndex).toBe(1);
    expect(h.cues.filter((c) => c.cue === CUES.menu)).toHaveLength(3);
  });

  it("walks the menus into a run", async () => {
    h.tap("Enter");
    await h.engine.advance(1);
    expect(h.snap().screen).toBe("modeselect");
    h.tap("Enter");
    await h.engine.advance(1);
    expect(h.snap().screen).toBe("difficultyselect");
    h.tap("Enter");
    await h.engine.advance(1);
    const snap = h.snap();
    expect(snap.screen).toBe("playing");
    expect(snap.phase).toBe("opening");
    expect(snap.difficulty).toBe("easy");
    expect(snap.money).toBe(350);
    expect(snap.waveCount).toBe(15);
  });

  it("fires a one-shot action exactly once however long the key is held", async () => {
    startRun();
    h.pose((d, s) => d.setSpeed(s, 1));
    // A held key: one keydown, then a second of frames with no keyup.
    h.pointer("pointermove", 400, 300);
    const events = h.snap();
    void events;
    h.tap("KeyF");
    await h.engine.advance(120);
    expect(h.snap().speed).toBe(2);
  });

  it("arms from a shop rect and places with a press and release", async () => {
    startRun();
    const shop = h.snap().controls.shop.find((s) => s.type === "arc");
    if (!shop) throw new Error("no arc shop entry");
    h.pointer("pointerdown", shop.x + shop.w / 2, shop.y + shop.h / 2);
    h.pointer("pointerup", shop.x + shop.w / 2, shop.y + shop.h / 2);
    await h.engine.advance(1);
    expect(h.snap().build?.type).toBe("arc");

    const x = tileCX(10) + TILE / 2;
    const y = tileCY(10) + TILE / 2;
    const before = h.snap().money;
    h.pointer("pointerdown", x, y);
    h.pointer("pointerup", x, y);
    await h.engine.advance(1);
    const snap = h.snap();
    expect(snap.towers).toHaveLength(1);
    expect(snap.towers[0].col).toBe(10);
    expect(snap.towers[0].row).toBe(10);
    expect(snap.money).toBe(before - TOWER_DEFS.arc.cost);
    expect(h.cues.some((c) => c.cue === CUES.place)).toBe(true);
  });

  it("selects a tower with a tap and sells it with the panel control", async () => {
    startRun();
    const id = poseTower("arc", 10, 10);
    h.pose((d, s) => d.setTowerFresh(s, id, false));
    h.pointer("pointerdown", tileCX(10), tileCY(10));
    h.pointer("pointerup", tileCX(10), tileCY(10));
    await h.engine.advance(1);
    expect(h.snap().selected).toBe(id);

    const sell = h.snap().controls.sell;
    if (!sell) throw new Error("no sell control while a tower is selected");
    const before = h.snap().money;
    h.pointer("pointerdown", sell.x + sell.w / 2, sell.y + sell.h / 2);
    h.pointer("pointerup", sell.x + sell.w / 2, sell.y + sell.h / 2);
    await h.engine.advance(1);
    expect(h.snap().towers).toEqual([]);
    expect(h.snap().money).toBe(before + 10);
    expect(h.snap().selected).toBeNull();
    expect(h.cues.some((c) => c.cue === CUES.sell)).toBe(true);
  });

  it("mutes from the key and from the panel control", async () => {
    startRun();
    h.tap("KeyM");
    await h.engine.advance(1);
    expect(h.snap().muted).toBe(true);
    const mute = h.snap().controls.mute;
    h.pointer("pointerdown", mute.x + mute.w / 2, mute.y + mute.h / 2);
    h.pointer("pointerup", mute.x + mute.w / 2, mute.y + mute.h / 2);
    await h.engine.advance(1);
    expect(h.snap().muted).toBe(false);
  });

  it("silences every cue while muted", async () => {
    startRun();
    h.tap("KeyM");
    await h.engine.advance(1);
    h.cues.length = 0;
    const gun = poseTower("arc", 10, 10);
    h.pose((d, s) => d.setTowerThermal(s, gun, false));
    poseTarget(12, 11);
    await h.engine.advance(120);
    expect(h.cues.length).toBeGreaterThan(0);
    expect(h.cues.every((c) => c.gain === 0)).toBe(true);
  });
});

// ---- Pausing -------------------------------------------------------------

describe("pausing", () => {
  it("freezes the floor and resumes it", async () => {
    startRun();
    h.pose((d, s) => d.addUnit(s, "mote", "left"));
    const id = h.snap().surge[0].id;
    await h.engine.advance(60);
    const running = unit(id);
    expect(running).not.toBeNull();
    const travelled = (running?.x ?? 0) - tileCX(0);
    expect(travelled).toBeGreaterThan(20);

    h.tap("KeyP");
    await h.engine.advance(1);
    const paused = h.snap();
    expect(paused.screen).toBe("paused");
    await h.engine.advance(120);
    const stillPaused = h.snap();
    const drift = Math.abs(
      (stillPaused.surge[0]?.x ?? 0) - (paused.surge[0]?.x ?? 0),
    );
    expect(drift).toBeLessThan(0.001);
    expect(stillPaused.simTime - paused.simTime).toBeLessThan(0.001);

    h.tap("KeyP");
    await h.engine.advance(61);
    expect(h.snap().surge[0].x).toBeGreaterThan(stillPaused.surge[0].x + 20);
  });
});

// ---- What is drawn -------------------------------------------------------

describe("rendering", () => {
  it("draws the floor, its grid, the casing and both kinds of opening", async () => {
    startRun();
    await h.engine.advance(1);
    const floor = h.pixel(tileCX(5) + 4, tileCY(5) + 4);
    const casing = h.pixel(9, 100);
    const vent = h.pixel(9, tileCY(17));
    const exhaust = h.pixel(977, tileCY(17));
    expect(distance(casing, floor)).toBeGreaterThan(60);
    expect(distance(vent, exhaust)).toBeGreaterThan(60);
    expect(distance(vent, casing)).toBeGreaterThan(60);
    expect(distance(exhaust, casing)).toBeGreaterThan(60);
  });

  it("draws a tower apart from the floor at every heat, and tripped apart", async () => {
    startRun();
    const id = poseTower("arc", 10, 10);
    h.pose((d, s) => d.setTowerFiring(s, id, false));
    h.pose((d, s) => d.setTowerThermal(s, id, false));
    const floor = [22, 28, 35] as [number, number, number];
    const readings: [number, number, number][] = [];
    for (const heat of [0, 25, 50, 75, 99]) {
      h.pose((d, s) => d.setTowerHeat(s, id, heat));
      await h.engine.advance(1);
      const body = h.pixel(tileCX(10) + 2, tileCY(10) - 2);
      expect(distance(body, floor)).toBeGreaterThan(60);
      readings.push(body);
    }
    expect(distance(readings[0], readings[4])).toBeGreaterThan(60);

    h.pose((d, s) => d.setTowerHeat(s, id, 99));
    h.pose((d, s) => d.setTowerTripped(s, id, true));
    await h.engine.advance(1);
    const tripped = h.pixel(tileCX(10) + 2, tileCY(10) - 2);
    expect(distance(tripped, readings[4])).toBeGreaterThan(60);
  });

  it("draws every panel control inside the panel at a touchable size", () => {
    startRun();
    h.pose((d, s) => d.setArmed(s, "arc"));
    h.pose((d, s) => d.addTower(s, "arc", 20, 20, 0));
    const id = h.snap().towers[0].id;
    h.pose((d, s) => d.setSelected(s, id));
    const controls = h.snap().controls;
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
    for (const rect of rects) {
      expect(rect).not.toBeNull();
      if (!rect) continue;
      expect(rect.w).toBeGreaterThanOrEqual(32);
      expect(rect.h).toBeGreaterThanOrEqual(32);
      expect(rect.x).toBeGreaterThanOrEqual(986);
      expect(rect.x + rect.w).toBeLessThanOrEqual(STAGE_W);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.y + rect.h).toBeLessThanOrEqual(STAGE_H);
    }
  });

  it("draws the title screen's copy", async () => {
    await h.engine.advance(1);
    // The title text is drawn light on the dark background, so the band it
    // occupies is far from the background it sits on somewhere.
    let brightest = 0;
    for (let x = 480; x < 800; x += 2) {
      const [r, g, b] = h.pixel(x, 220);
      brightest = Math.max(brightest, r + g + b);
    }
    expect(brightest).toBeGreaterThan(300);
  });
});

// ---- Rates, composition, and the modes -----------------------------------

describe("rates", () => {
  it("fires each emitter at its own rate", async () => {
    startRun();
    const stutter = poseTower("stutter", 10, 10);
    h.pose((d, s) => d.setTowerThermal(s, stutter, false));
    poseTarget(12, 11);
    await h.engine.advance(120);
    const perShot = tower(stutter).damage;
    expect(tower(stutter).damageDealt / perShot).toBeCloseTo(7, 6);

    startRun();
    const lance = poseTower("lance", 10, 10);
    h.pose((d, s) => d.setTowerThermal(s, lance, false));
    poseTarget(15, 12);
    await h.engine.advance(600);
    expect(tower(lance).damageDealt / tower(lance).damage).toBeCloseTo(4, 6);
  });

  it("holds the accumulator while a tower has no target", async () => {
    startRun();
    const id = poseTower("arc", 10, 10);
    h.pose((d, s) => d.setTowerThermal(s, id, false));
    await h.engine.advance(1200);
    expect(tower(id).firing).toBe(false);
    const target = poseTarget(12, 11);
    await h.engine.advance(58);
    expect(unit(target)?.hp).toBe(1e6);
    await h.engine.advance(4);
    expect(unit(target)?.hp).toBeLessThan(1e6);
  });
});

describe("what a shot reaches", () => {
  it("splashes a Bloom's damage and stops at its radius", async () => {
    startRun();
    // The Bloom sits below the row its three targets stand on, so nothing it
    // fires at is inside its own footprint. The rightmost unit is furthest
    // along its route, so it is the one the Bloom targets and the one the
    // splash is centred on.
    const bloom = poseTower("bloom", 14, 14);
    h.pose((d, s) => d.setTowerThermal(s, bloom, false));
    const target = poseTarget(18, 11);
    const inside = poseTarget(16, 11);
    h.pose((d, s) =>
      d.setUnitPosition(s, inside, tileCX(18) - 2 * TILE, tileCY(11)),
    );
    const outside = poseTarget(16, 11);
    h.pose((d, s) =>
      d.setUnitPosition(s, outside, tileCX(18) - 2.4 * TILE - 1, tileCY(11)),
    );
    await h.engine.advance(120);
    expect(tower(bloom).targeting).toBe(target);
    expect(1e6 - (unit(target)?.hp ?? 0)).toBeGreaterThan(0);
    expect(unit(inside)?.hp).toBe(unit(target)?.hp);
    expect(unit(outside)?.hp).toBe(1e6);
  });

  it("targets the unit furthest along its route", async () => {
    startRun();
    const gun = poseTower("arc", 20, 16);
    h.pose((d, s) => d.setTowerThermal(s, gun, false));
    const behind = poseTarget(18, 17);
    const ahead = poseTarget(24, 17);
    await h.engine.advance(2);
    expect(tower(gun).targeting).toBe(ahead);
    await h.engine.advance(120);
    expect(unit(behind)?.hp).toBe(1e6);
    expect(unit(ahead)?.hp).toBeLessThan(1e6);
  });
});

describe("the modes", () => {
  it("runs The Hundred as one onslaught of six-times units", async () => {
    h.pose((d, s) => d.reset(s));
    h.pose((d, s) => d.setMode(s, "hundred"));
    h.pose((d, s) => d.setScreen(s, "playing"));
    h.pose((d, s) => d.setPhase(s, "opening"));
    expect(h.snap().waveCount).toBe(1);
    expect(h.snap().startMoney).toBe(600);
    expect(h.snap().interest).toBe(false);
    h.tap("Space");
    await h.engine.advance(1);
    expect(h.snap().phase).toBe("wave");
    expect(h.snap().wavePending).toBe(99);
    await h.engine.advance(4 * 72);
    const types = h.snap().surge.map((u) => u.type);
    expect(types.slice(0, 5)).toEqual([
      "mote",
      "sprint",
      "swarm",
      "drift",
      "hulk",
    ]);
    expect(h.snap().surge[0].maxHp).toBe(40 * 6);
  });

  it("restricts building to Bottleneck's zone", () => {
    startRun();
    h.pose((d, s) => d.setMode(s, "bottleneck"));
    h.pose((d, s) => d.setArmed(s, "arc"));
    h.pose((d, s) => d.setPreview(s, 20, 20));
    expect(h.snap().build?.valid).toBe(true);
    h.pose((d, s) => d.setPreview(s, 36, 20));
    // A 2x2 at column 36 puts column 37 outside the zone.
    expect(h.snap().build?.valid).toBe(false);
    h.pose((d, s) => d.setPreview(s, 2, 2));
    expect(h.snap().build?.valid).toBe(false);
  });

  it("ends Sudden Death on a single leak", async () => {
    h.pose((d, s) => d.reset(s));
    h.pose((d, s) => d.setMode(s, "suddendeath"));
    h.pose((d, s) => d.setScreen(s, "playing"));
    h.pose((d, s) => d.setPhase(s, "wave"));
    h.pose((d, s) => d.setWaveSpawning(s, false));
    h.pose((d, s) => d.setLives(s, 1));
    h.pose((d, s) => d.addUnit(s, "mote", "left"));
    const id = h.snap().surge[0].id;
    h.pose((d, s) => d.setUnitPosition(s, id, tileCX(47), tileCY(17)));
    await h.engine.advance(240);
    expect(h.snap().lives).toBe(0);
    expect(h.snap().screen).toBe("gameover");
    expect(h.cues.some((c) => c.cue === CUES.gameOver)).toBe(true);
  });

  it("wins on clearing the final wave and pays for the lives left", async () => {
    startRun();
    h.pose((d, s) => d.setWave(s, 20));
    h.pose((d, s) => d.setPhase(s, "wave"));
    h.pose((d, s) => d.setWavePending(s, 0));
    h.pose((d, s) => d.setLives(s, 4));
    h.pose((d, s) => d.setScore(s, 0));
    const gun = poseTower("lance", 10, 10);
    h.pose((d, s) => d.setTowerThermal(s, gun, false));
    poseTarget(13, 11, 1);
    await h.engine.advance(240);
    const snap = h.snap();
    expect(snap.screen).toBe("victory");
    expect(snap.menuIndex).toBe(0);
    // The Mote's bounty, the wave-clear score, and 250 for each life left.
    expect(snap.score).toBe(3 + 100 * 20 + 250 * 4);
    expect(h.cues.some((c) => c.cue === CUES.victory)).toBe(true);
  });
});

describe("the release", () => {
  it("fields one type per Containment wave", async () => {
    startRun();
    h.pose((d, s) => d.setWave(s, 3));
    h.pose((d, s) => d.setWaveSpawning(s, true));
    h.pose((d, s) => d.setPhase(s, "building"));
    h.pose((d, s) => d.setBuildTimer(s, 0));
    await h.engine.advance(5 * 72);
    const types = new Set(h.snap().surge.map((u) => u.type));
    expect([...types]).toEqual(["sprint"]);
  });

  it("uses both vents across a wave with no vent posed", async () => {
    h.pose((d, s) => d.reset(s));
    h.pose((d, s) => d.setScreen(s, "playing"));
    h.pose((d, s) => d.setPhase(s, "wave"));
    h.pose((d, s) => d.setLives(s, 1_000));
    h.pose((d, s) => d.setWavePending(s, 40));
    // Gathered as they arrive, because an undefended floor leaks them again.
    const vents = new Map<number, string>();
    for (let interval = 0; interval < 40; interval += 1) {
      await h.engine.advance(72);
      for (const u of h.snap().surge) vents.set(u.id, u.vent);
    }
    expect(vents.size).toBe(40);
    expect(new Set(vents.values()).size).toBe(2);
  });

  it("enters every released unit at the posed vent while one is posed", async () => {
    for (const vent of ["left", "top"] as const) {
      h.pose((d, s) => d.reset(s));
      h.pose((d, s) => d.setScreen(s, "playing"));
      h.pose((d, s) => d.setPhase(s, "wave"));
      h.pose((d, s) => d.setSpawnVent(s, vent));
      h.pose((d, s) => d.setWavePending(s, 8));
      await h.engine.advance(8 * 72);
      const vents = h.snap().surge.map((u) => u.vent);
      expect(vents).toHaveLength(8);
      expect(new Set(vents)).toEqual(new Set([vent]));
    }
  });

  it("draws a vent on its own, both vents over a run, and poses nothing", () => {
    startRun();
    h.pose((d, s) => d.setSpawnVent(s, "top"));
    h.pose((d, s) => d.addUnit(s, "mote", "left"));
    const before = h.snap();
    const drawn = new Set<string>();
    for (let i = 0; i < 200; i += 1)
      drawn.add(h.engine.debug.drawVent(h.engine.state));
    expect([...drawn].sort()).toEqual(["left", "top"]);
    expect(h.snap()).toEqual(before);
  });
});

// ---- The clock -----------------------------------------------------------

describe("the clock", () => {
  it("reaches the same state however a second is divided into frames", async () => {
    const walk = async (frames: number, stepMs: number): Promise<number[]> => {
      h.pose((d, s) => d.reset(s));
      h.pose((d, s) => d.setScreen(s, "playing"));
      h.pose((d, s) => d.setPhase(s, "wave"));
      h.pose((d, s) => d.setWaveSpawning(s, false));
      h.pose((d, s) => d.addUnit(s, "mote", "left"));
      const id = h.snap().surge[0].id;
      h.pose((d, s) => d.setUnitPosition(s, id, tileCX(10), tileCY(17)));
      h.engine.setClock(new ConstantClock(stepMs));
      await h.engine.advance(frames);
      const snap = h.snap();
      return [snap.surge[0].x, snap.simTime];
    };
    const coarse = await walk(1, 1000);
    const fine = await walk(120, 1000 / 120);
    expect(coarse[0]).toBeCloseTo(fine[0], 6);
    expect(coarse[1]).toBeCloseTo(1, 6);
    expect(fine[1]).toBeCloseTo(1, 6);
  });

  it("advances twice the game time at speed 2", async () => {
    startRun();
    h.pose((d, s) => d.setSpeed(s, 2));
    h.pose((d, s) => d.addUnit(s, "mote", "left"));
    const id = h.snap().surge[0].id;
    h.pose((d, s) => d.setUnitPosition(s, id, tileCX(10), tileCY(17)));
    const before = h.snap();
    await h.engine.advance(120);
    const after = h.snap();
    expect(after.simTime - before.simTime).toBeCloseTo(2, 6);
    expect(after.surge[0].x - before.surge[0].x).toBeCloseTo(120, 4);
  });
});

// ---- Isolation -----------------------------------------------------------

describe("the faculty gates", () => {
  it("holds a unit still while its route still follows the floor", async () => {
    startRun();
    h.pose((d, s) => d.addUnit(s, "mote", "left"));
    const id = h.snap().surge[0].id;
    h.pose((d, s) => d.setUnitPosition(s, id, tileCX(10), tileCY(17)));
    h.pose((d, s) => d.setUnitMotion(s, id, false));
    await h.engine.advance(120);
    expect(h.snap().surge[0].x).toBeCloseTo(tileCX(10), 9);
    const before = h.snap().surge[0].remaining;
    // A wall across the corridor lengthens the route from where it stands.
    for (let row = 8; row < 28; row += 2) {
      h.pose((d, s) => d.addTower(s, "arc", 20, row, 0));
    }
    const after = h.snap().surge[0];
    expect(after.remaining).toBeGreaterThan(before);
    expect(after.x).toBeCloseTo(tileCX(10), 9);
  });

  it("holds a tower's guns while its thermal model runs", async () => {
    startRun();
    const id = poseTower("arc", 10, 10);
    h.pose((d, s) => d.setTowerFiring(s, id, false));
    h.pose((d, s) => d.setTowerHeat(s, id, 60));
    const target = poseTarget(12, 11);
    await h.engine.advance(120);
    expect(tower(id).firing).toBe(false);
    expect(tower(id).targeting).toBeNull();
    expect(tower(id).damageDealt).toBe(0);
    expect(unit(target)?.hp).toBe(1e6);
    expect(tower(id).heat).toBeLessThan(60);
  });

  it("holds the run's own release of surge", async () => {
    startRun();
    h.pose((d, s) => d.setPhase(s, "wave"));
    h.pose((d, s) => d.setWavePending(s, 30));
    // Thirty seconds is fifty release intervals: if the run were still
    // releasing, the pending count could not survive the window intact.
    await h.engine.advance(30 * 60);
    expect(h.snap().surge).toEqual([]);
    expect(h.snap().wavePending).toBe(30);
  });
});

// ---- Freshness and the precedence rule -----------------------------------

describe("freshness", () => {
  it("ends with the build phase it was placed in", async () => {
    startRun();
    h.pose((d, s) => d.setWaveSpawning(s, true));
    h.pose((d, s) => d.setBuildTimer(s, 0.5));
    h.pose((d, s) => d.setArmed(s, "arc"));
    h.pose((d, s) => d.setPreview(s, 10, 10));
    h.pose((d, s) => d.place(s));
    const id = h.snap().towers[0].id;
    expect(tower(id).fresh).toBe(true);
    await h.engine.advance(120);
    expect(h.snap().phase).toBe("wave");
    expect(tower(id).fresh).toBe(false);
    // An upgrade does not restore it.
    h.pose((d, s) => d.upgradeTower(s, id));
    expect(tower(id).fresh).toBe(false);
    expect(tower(id).refund).toBe(Math.floor(0.7 * 30));
  });
});

describe("the reported menu", () => {
  it("reports one rectangle per row, in row order, on every menu screen", () => {
    for (const [screen, items] of [
      ["title", TITLE_ITEMS],
      ["modeselect", MODE_ITEMS],
      ["difficultyselect", DIFFICULTY_ITEMS],
      ["howto", HOWTO_ITEMS],
      ["paused", PAUSE_ITEMS],
      ["victory", ENDING_ITEMS],
      ["gameover", ENDING_ITEMS],
    ] as const) {
      h.pose((d, s) => d.setScreen(s, screen));
      const rows = h.snap().menu;
      expect(rows).toHaveLength(items.length);
      expect(rows.map((row) => row.index)).toEqual(
        items.map((_item, index) => index),
      );
    }
  });

  it("reports none at all while the screen is playing", () => {
    startRun();
    expect(h.snap().menu).toEqual([]);
  });
});

describe("the pointer on a menu", () => {
  it("highlights the row it reaches and cues, without taking it", async () => {
    const row = h.snap().menu[1];
    h.pointer("pointermove", row.x + row.w / 2, row.y + row.h / 2);
    await h.engine.advance(1);
    expect(h.snap().menuIndex).toBe(1);
    expect(h.snap().screen).toBe("title");
    expect(h.cues.filter((c) => c.cue === CUES.menu)).toHaveLength(1);
  });

  it("leaves the highlight where it last landed when it moves off", async () => {
    const row = h.snap().menu[1];
    h.pointer("pointermove", row.x + row.w / 2, row.y + row.h / 2);
    await h.engine.advance(1);
    h.pointer("pointermove", 4, 4);
    await h.engine.advance(1);
    expect(h.snap().menuIndex).toBe(1);
    expect(h.cues.filter((c) => c.cue === CUES.menu)).toHaveLength(1);
  });
});

describe("the BACK rows", () => {
  it("take each list to the screen behind it, starting nothing", async () => {
    for (const [screen, items, behind] of [
      ["modeselect", MODE_ITEMS, "title"],
      ["difficultyselect", DIFFICULTY_ITEMS, "modeselect"],
      ["howto", HOWTO_ITEMS, "title"],
    ] as const) {
      h.pose((d, s) => d.reset(s));
      h.pose((d, s) => d.setScreen(s, screen));
      h.pose((d, s) => d.setMenuIndex(s, items.indexOf("BACK")));
      h.tap("Enter");
      await h.engine.advance(1);
      const snap = h.snap();
      expect(snap.screen).toBe(behind);
      expect(snap.towers).toEqual([]);
    }
  });

  it("returns from the how-to screen with HOW TO PLAY highlighted", async () => {
    h.pose((d, s) => d.setScreen(s, "howto"));
    h.tap("Escape");
    await h.engine.advance(1);
    const snap = h.snap();
    expect(snap.screen).toBe("title");
    expect(snap.menuIndex).toBe(TITLE_ITEMS.indexOf("HOW TO PLAY"));
  });
});

describe("back", () => {
  it("cancels, then deselects, then pauses", async () => {
    startRun();
    const id = poseTower("arc", 10, 10);
    h.pose((d, s) => d.setSelected(s, id));
    h.pose((d, s) => d.setArmed(s, "arc"));
    h.tap("Escape");
    await h.engine.advance(1);
    expect(h.snap().build).toBeNull();
    expect(h.snap().selected).toBe(id);
    expect(h.snap().screen).toBe("playing");
    h.tap("Escape");
    await h.engine.advance(1);
    expect(h.snap().selected).toBeNull();
    expect(h.snap().screen).toBe("playing");
    h.tap("Escape");
    await h.engine.advance(1);
    expect(h.snap().screen).toBe("paused");
  });
});

function distance(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
