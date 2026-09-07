// Meltdown — the debugging and automation surface.
//
// `specs/instrumentation.md` specifies it and this module implements it.
// `createDebugApi` builds it, the game instance's `initialize` returns it, and
// the engine holds that same object and hands it back from `engine.debug` — the
// one way a caller reaches it. Nothing is installed on the page.
//
// Every operation acts on the LIVE game at the moment it is called, reaching
// the open world through the accessor the instance supplies, and takes only the
// parameters its own heading names. A POSE arranges the running game through
// the same systems play uses and returns nothing; a READING returns plain data
// built at the call and changes nothing.
//
// Two rules govern the shape. Each operation sets ONE field, reads the state,
// or moves the clock, and `snapshot` reports every field an operation can set,
// so every operation is verifiable by setting a value and reading it back. And
// NO OPERATION PLAYS A CUE: a cue is raised by the frame that resolves the
// event it answers, and a pose resolves outside the frame loop, so it names no
// frame for a cue to belong to. The pointer operations therefore feed exactly
// the resolution a player's press feeds and discard the cues it raised.

import type { World } from "@clockwyrks/structured-2d";
import { syncActors } from "./actors";
import {
  addTowerAt,
  armType,
  clearAllTowers,
  movePreview,
  placeHeld,
  previewValid,
  removeTowerById,
  sellTowerById,
  setPreviewRotation,
  upgradeTowerById,
} from "./build";
import {
  MAX_LEVEL,
  MELTDOWN_DEBUG_VERSION,
  SURGE_DEFS,
  TRIP_HEAT,
  type DifficultyName,
  type ExhaustName,
  type Face,
  type ModeName,
  type SurgeType,
  type TowerType,
  type VentName,
} from "./constants";
import { menuRows, resetState } from "./flow";
import { menuRowRect, panelControls } from "./layout";
import {
  damageOf,
  emitterDef,
  heatMultOf,
  outputOf,
  redlineOf,
  refundOf,
  slowFactorOf,
  speedOf,
  upgradeCostOf,
  worldRadiatorsOf,
} from "./stats";
import { sizeOf, tileAt } from "./geometry";
import {
  drawVent,
  dropUnit,
  exhaustOf,
  spawnUnit,
  unitRemaining,
} from "./surge";
import {
  pointerDown,
  pointerMove,
  pointerUp,
  type InputResult,
} from "./pointer";
import { figuresOf, nextWaveInfo } from "./waves";
import {
  meltdownState,
  type MeltdownState,
  type Phase,
  type Screen,
  type TowerState,
  type UnitState,
} from "./game";

// ---- The snapshot shape (specs/instrumentation.md) ------------------------

/** A control's hit rectangle, in logical stage units. */
export interface ControlRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A shop entry's hit rectangle, and the type it arms. */
export interface ShopControl extends ControlRect {
  type: TowerType;
}

/** Every control the build panel offers. */
export interface SnapshotControls {
  shop: ShopControl[];
  rotate: ControlRect | null;
  cancel: ControlRect | null;
  upgrade: ControlRect | null;
  sell: ControlRect | null;
  send: ControlRect;
  speed: ControlRect;
  pause: ControlRect;
  mute: ControlRect;
}

/** One tower, as the snapshot reports it. */
export interface SnapshotTower {
  id: number;
  type: TowerType;
  col: number;
  row: number;
  size: number;
  rotation: number;
  level: number;
  heat: number;
  redline: number;
  heatMult: number;
  damage: number;
  slowFactor: number;
  output: number;
  tripped: boolean;
  tripTimer: number;
  firing: boolean;
  targeting: number | null;
  radiatorFaces: Face[];
  kills: number;
  damageDealt: number;
  spent: number;
  refund: number;
  upgradeCost: number;
  fresh: boolean;
  firingEnabled: boolean;
  thermalEnabled: boolean;
}

/** One surge unit, as the snapshot reports it. */
export interface SnapshotUnit {
  id: number;
  type: SurgeType;
  x: number;
  y: number;
  col: number;
  row: number;
  hp: number;
  maxHp: number;
  speed: number;
  baseSpeed: number;
  slowed: boolean;
  slowFactor: number;
  slowTimer: number;
  flying: boolean;
  vent: VentName;
  exhaust: ExhaustName;
  remaining: number;
  motion: boolean;
}

/** One row of the current screen's menu, as its hit rectangle. */
export interface SnapshotMenuRow {
  index: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The whole of the game, read at the call. */
export interface MeltdownSnapshot {
  version: number;
  screen: Screen;
  phase: Phase;
  menuIndex: number;
  mode: ModeName;
  difficulty: DifficultyName;
  money: number;
  lives: number;
  score: number;
  wave: number;
  waveCount: number;
  startMoney: number;
  startLives: number;
  interest: boolean;
  buildTimer: number;
  wavePending: number;
  waveRemaining: number;
  nextWave: { type: SurgeType; count: number } | null;
  speed: number;
  muted: boolean;
  waveSpawning: boolean;
  spawnVent: VentName | null;
  pointer: { x: number; y: number; down: boolean };
  selected: number | null;
  hoverShop: TowerType | null;
  build: {
    type: TowerType;
    col: number;
    row: number;
    rotation: number;
    valid: boolean;
  } | null;
  buildZone: {
    col0: number;
    row0: number;
    col1: number;
    row1: number;
  } | null;
  paths: {
    left: { length: number };
    top: { length: number };
  };
  menu: SnapshotMenuRow[];
  controls: SnapshotControls;
  towers: SnapshotTower[];
  surge: SnapshotUnit[];
  simTime: number;
}

// ---- The surface ---------------------------------------------------------

/**
 * The surface. Every pose acts on the live world at the call and returns
 * nothing; the one reading, `snapshot`, returns what it read.
 */
export interface MeltdownDebugApi {
  version: number;

  reset(): void;
  snapshot(): MeltdownSnapshot;

  setScreen(screen: Screen): void;
  setPhase(phase: Phase): void;
  setMenuIndex(n: number): void;
  setMode(mode: ModeName): void;
  setDifficulty(difficulty: DifficultyName): void;
  setMoney(amount: number): void;
  setLives(count: number): void;
  setScore(n: number): void;
  setWave(n: number): void;
  setBuildTimer(seconds: number): void;
  setWavePending(n: number): void;
  setSpeed(speed: number): void;

  setWaveSpawning(enabled: boolean): void;
  setSpawnVent(vent: VentName | null): void;
  /** One vent draw as the release makes it; a reading, so it poses nothing. */
  drawVent(): VentName;

  addTower(type: TowerType, col: number, row: number, rotation: number): void;
  removeTower(id: number): void;
  clearTowers(): void;
  setTowerHeat(id: number, heat: number): void;
  setTowerTripped(id: number, tripped: boolean): void;
  setTowerTripTimer(id: number, seconds: number): void;
  setTowerLevel(id: number, level: number): void;
  setTowerFresh(id: number, fresh: boolean): void;
  setTowerFiring(id: number, enabled: boolean): void;
  setTowerThermal(id: number, enabled: boolean): void;

  setArmed(type: TowerType | null): void;
  setPreview(col: number, row: number): void;
  setPreviewRotation(rotation: number): void;
  place(): void;
  setSelected(id: number | null): void;
  setHoverShop(type: TowerType | null): void;
  upgradeTower(id: number): void;
  sellTower(id: number): void;

  addUnit(type: SurgeType, vent: VentName): void;
  removeUnit(id: number): void;
  clearSurge(): void;
  setUnitPosition(id: number, x: number, y: number): void;
  setUnitHp(id: number, hp: number): void;
  setUnitMaxHp(id: number, maxHp: number): void;
  setUnitSlow(id: number, factor: number): void;
  setUnitSlowTimer(id: number, seconds: number): void;
  setUnitMotion(id: number, enabled: boolean): void;

  pointerDown(x: number, y: number): void;
  pointerMove(x: number, y: number): void;
  pointerUp(): void;
}

/** A control rectangle, copied so the caller owns what it holds. */
function rect(source: ControlRect): ControlRect {
  return { x: source.x, y: source.y, w: source.w, h: source.h };
}

/**
 * Every row of the current screen's menu, as its hit rectangle, in row order
 * (specs/instrumentation.md). Empty while the screen is `playing`.
 */
function readMenu(screen: Screen): SnapshotMenuRow[] {
  const rows: SnapshotMenuRow[] = [];
  for (let index = 0; index < menuRows(screen); index += 1) {
    const row = menuRowRect(screen, index);
    if (row !== null) rows.push({ index, ...rect(row) });
  }
  return rows;
}

/** One tower, read into plain data. */
function readTower(tower: TowerState): SnapshotTower {
  return {
    id: tower.id,
    type: tower.type,
    col: tower.col,
    row: tower.row,
    size: sizeOf(tower.type),
    rotation: tower.rotation,
    level: tower.level,
    heat: tower.heat,
    redline: redlineOf(tower),
    heatMult: heatMultOf(tower),
    damage: damageOf(tower),
    slowFactor: slowFactorOf(tower),
    output: outputOf(tower),
    tripped: tower.tripped,
    tripTimer: tower.tripTimer,
    firing: tower.firing,
    targeting: tower.targeting,
    radiatorFaces: worldRadiatorsOf(tower),
    kills: tower.kills,
    damageDealt: tower.damageDealt,
    spent: tower.spent,
    refund: refundOf(tower),
    upgradeCost: upgradeCostOf(tower),
    fresh: tower.fresh,
    firingEnabled: tower.firingEnabled,
    thermalEnabled: tower.thermalEnabled,
  };
}

/** One surge unit, read into plain data. */
function readUnit(state: MeltdownState, unit: UnitState): SnapshotUnit {
  const tile = tileAt(unit.x, unit.y);
  const def = SURGE_DEFS[unit.type];
  return {
    id: unit.id,
    type: unit.type,
    x: unit.x,
    y: unit.y,
    col: tile.col,
    row: tile.row,
    hp: unit.hp,
    maxHp: unit.maxHp,
    speed: speedOf(unit),
    baseSpeed: def.speed,
    slowed: unit.slowFactor > 0,
    slowFactor: unit.slowFactor,
    slowTimer: unit.slowTimer,
    flying: def.flies,
    vent: unit.vent,
    exhaust: exhaustOf(unit),
    remaining: unitRemaining(state, unit),
    motion: unit.motion,
  };
}

/**
 * Settle what a pointer call resolved to. The cues it raised are DISCARDED,
 * because an operation of this surface resolves outside the frame loop and so
 * names no frame for a cue to belong to; the mute toggle is not a cue and is
 * applied, exactly as a player's tap on the same control applies it.
 */
function applyPointer(live: World, result: InputResult): void {
  if (result.mute) live.audio.setMuted(!live.audio.muted());
  syncActors(live);
}

/**
 * Build the surface over an accessor for the open world. It holds nothing:
 * every operation reads the world — and the state and the actor set it carries
 * — at the moment it is called, so the surface follows the live game for the
 * life of the engine.
 */
export function createDebugApi(world: () => World): MeltdownDebugApi {
  const read = (): MeltdownState => meltdownState(world());
  const tower = (id: number): TowerState | undefined =>
    read().towers.find((entry) => entry.id === id);
  const unit = (id: number): UnitState | undefined =>
    read().surge.find((entry) => entry.id === id);
  /** Bring the actor set level with a roster a pose just changed. */
  const sync = (): void => {
    syncActors(world());
  };

  return {
    version: MELTDOWN_DEBUG_VERSION,

    reset() {
      resetState(read());
      sync();
    },

    snapshot(): MeltdownSnapshot {
      const state = read();
      const figures = figuresOf(state);
      const controls = panelControls(state);
      const build = state.build;
      return {
        version: MELTDOWN_DEBUG_VERSION,
        screen: state.screen,
        phase: state.phase,
        menuIndex: state.menuIndex,
        mode: state.mode,
        difficulty: state.difficulty,
        money: state.money,
        lives: state.lives,
        score: state.score,
        wave: state.wave,
        waveCount: figures.waveCount,
        startMoney: figures.startMoney,
        startLives: figures.startLives,
        interest: figures.interest,
        buildTimer: state.buildTimer,
        wavePending: state.wavePending,
        waveRemaining:
          state.wavePending + (state.phase === "wave" ? state.surge.length : 0),
        nextWave: nextWaveInfo(state),
        speed: state.speed,
        muted: state.muted,
        waveSpawning: state.waveSpawning,
        spawnVent: state.spawnVent,
        pointer: {
          x: state.pointer.x,
          y: state.pointer.y,
          down: state.pointer.down,
        },
        selected: state.selected,
        hoverShop: state.hoverShop,
        build:
          build === null
            ? null
            : {
                type: build.type,
                col: build.col,
                row: build.row,
                rotation: build.rotation,
                valid: previewValid(state),
              },
        buildZone:
          figures.buildZone === null
            ? null
            : {
                col0: figures.buildZone.col0,
                row0: figures.buildZone.row0,
                col1: figures.buildZone.col1,
                row1: figures.buildZone.row1,
              },
        paths: {
          left: { length: state.routes.lengths.left },
          top: { length: state.routes.lengths.top },
        },
        menu: readMenu(state.screen),
        controls: {
          shop: controls.shop.map((entry) => ({
            type: entry.type,
            ...rect(entry),
          })),
          rotate: controls.rotate === null ? null : rect(controls.rotate),
          cancel: controls.cancel === null ? null : rect(controls.cancel),
          upgrade: controls.upgrade === null ? null : rect(controls.upgrade),
          sell: controls.sell === null ? null : rect(controls.sell),
          send: rect(controls.send),
          speed: rect(controls.speed),
          pause: rect(controls.pause),
          mute: rect(controls.mute),
        },
        towers: state.towers.map(readTower),
        surge: state.surge.map((entry) => readUnit(state, entry)),
        simTime: state.simTime,
      };
    },

    // ---- The screen and the run, each setting its field alone -------------

    setScreen(screen) {
      read().screen = screen;
    },
    setPhase(phase) {
      read().phase = phase;
    },
    setMenuIndex(n) {
      read().menuIndex = Math.max(0, Math.trunc(n));
    },
    setMode(mode) {
      read().mode = mode;
    },
    setDifficulty(difficulty) {
      read().difficulty = difficulty;
    },
    setMoney(amount) {
      read().money = amount;
    },
    setLives(count) {
      read().lives = count;
    },
    setScore(n) {
      read().score = n;
    },
    setWave(n) {
      read().wave = n;
    },
    setBuildTimer(seconds) {
      read().buildTimer = seconds;
    },
    setWavePending(n) {
      read().wavePending = n;
    },
    setSpeed(speed) {
      read().speed = speed === 2 ? 2 : 1;
    },

    setWaveSpawning(enabled) {
      read().waveSpawning = enabled;
    },
    setSpawnVent(vent) {
      read().spawnVent = vent === "left" || vent === "top" ? vent : null;
    },
    drawVent() {
      return drawVent();
    },

    // ---- The towers -------------------------------------------------------

    addTower(type, col, row, rotation) {
      addTowerAt(read(), type, col, row, rotation);
      sync();
    },
    removeTower(id) {
      removeTowerById(read(), id);
      sync();
    },
    clearTowers() {
      clearAllTowers(read());
      sync();
    },
    setTowerHeat(id, heat) {
      const entry = tower(id);
      // The Forge and the Sink carry no heat of their own (specs/heat.md).
      if (entry === undefined || emitterDef(entry.type) === null) return;
      entry.heat = Math.max(0, Math.min(TRIP_HEAT, heat));
    },
    setTowerTripped(id, tripped) {
      const entry = tower(id);
      if (entry === undefined) return;
      entry.tripped = tripped;
    },
    setTowerTripTimer(id, seconds) {
      const entry = tower(id);
      if (entry === undefined) return;
      entry.tripTimer = Math.max(0, seconds);
    },
    setTowerLevel(id, level) {
      const entry = tower(id);
      if (entry === undefined) return;
      entry.level = Math.max(1, Math.min(MAX_LEVEL, Math.trunc(level)));
    },
    setTowerFresh(id, fresh) {
      const entry = tower(id);
      if (entry === undefined) return;
      entry.fresh = fresh;
    },
    setTowerFiring(id, enabled) {
      const entry = tower(id);
      if (entry === undefined) return;
      entry.firingEnabled = enabled;
    },
    setTowerThermal(id, enabled) {
      const entry = tower(id);
      if (entry === undefined) return;
      entry.thermalEnabled = enabled;
    },

    // ---- Building ---------------------------------------------------------

    setArmed(type) {
      armType(read(), type);
    },
    setPreview(col, row) {
      movePreview(read(), col, row);
    },
    setPreviewRotation(rotation) {
      setPreviewRotation(read(), rotation);
    },
    place() {
      placeHeld(read());
      sync();
    },
    setSelected(id) {
      read().selected = id;
    },
    setHoverShop(type) {
      read().hoverShop = type;
    },
    upgradeTower(id) {
      upgradeTowerById(read(), id);
    },
    sellTower(id) {
      sellTowerById(read(), id);
      sync();
    },

    // ---- The surge --------------------------------------------------------

    addUnit(type, vent) {
      spawnUnit(read(), type, vent);
      sync();
    },
    removeUnit(id) {
      dropUnit(read(), id);
      sync();
    },
    clearSurge() {
      read().surge = [];
      sync();
    },
    setUnitPosition(id, x, y) {
      const entry = unit(id);
      if (entry === undefined) return;
      entry.x = x;
      entry.y = y;
    },
    setUnitHp(id, hp) {
      const entry = unit(id);
      if (entry === undefined) return;
      entry.hp = Math.max(0, hp);
    },
    setUnitMaxHp(id, maxHp) {
      const entry = unit(id);
      if (entry === undefined) return;
      entry.maxHp = Math.max(0, maxHp);
    },
    setUnitSlow(id, factor) {
      const entry = unit(id);
      if (entry === undefined) return;
      entry.slowFactor = Math.max(0, Math.min(1, factor));
    },
    setUnitSlowTimer(id, seconds) {
      const entry = unit(id);
      if (entry === undefined) return;
      entry.slowTimer = Math.max(0, seconds);
    },
    setUnitMotion(id, enabled) {
      const entry = unit(id);
      if (entry === undefined) return;
      entry.motion = enabled;
    },

    // ---- The pointer, through the same path a player's press takes --------

    pointerDown(x, y) {
      applyPointer(world(), pointerDown(read(), x, y));
    },
    pointerMove(x, y) {
      applyPointer(world(), pointerMove(read(), x, y));
    },
    pointerUp() {
      applyPointer(world(), pointerUp(read()));
    },
  };
}
