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
// EVERY OPERATION ACTS, AND NONE OF THEM DECLINES QUIETLY. A pose reaches the
// value it names whatever the game's own rules would have allowed a player to
// reach, so nothing below clamps a posed value onto a legal neighbour or returns
// having changed nothing. An act carries out its own transaction FROM WHEREVER
// THE GAME STANDS: the screen, the phase, the open panel, the selection and the
// pointer are how a PLAYER reaches the control and are not its conditions. What
// an act keeps is its own arithmetic — the price, the purse, the cap at
// `MAX_LEVEL`, the placement check — because that is the transaction rather than
// a gate on reaching it. And where the game has no defined state to reach, the
// call THROWS: an id no live tower or unit carries, a name outside its set, a
// level or rotation outside the fixed range, an emitter operation aimed at a
// mover that carries no heat, a preview operation with nothing armed.
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
  DIFFICULTIES,
  MAX_LEVEL,
  MELTDOWN_DEBUG_VERSION,
  MODES,
  SURGE_DEFS,
  SURGE_TYPES,
  TOWER_TYPES,
  TRIP_HEAT,
  type DifficultyName,
  type ExhaustName,
  type Face,
  type ModeName,
  type SurgeType,
  type TowerType,
  type VentName,
} from "./constants";
import { menuRows, resetWith } from "./flow";
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
import { dropUnit, exhaustOf, spawnUnit, unitRemaining } from "./surge";
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

  reset(seed?: number): void;
  snapshot(): MeltdownSnapshot;
  /** Bring every reported reading into agreement with the floor as it stands. */
  reconcile(): void;

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

// ---- The loud half of the contract ---------------------------------------
//
// An operation never returns having changed nothing. Where there is a defined
// state the call reaches, it reaches it; where there is not, it throws, and the
// helpers below are how it throws.

/** The screens `setScreen` names. */
const SCREENS: readonly Screen[] = [
  "title",
  "modeselect",
  "difficultyselect",
  "howto",
  "playing",
  "paused",
  "victory",
  "gameover",
];

/** The sub-phases `setPhase` names. */
const PHASES: readonly Phase[] = ["opening", "building", "wave"];

/** The vents `addUnit` names. */
const VENTS: readonly VentName[] = ["left", "top"];

/** The failure a call the game has no defined state for gets. */
function reject(op: string, detail: string): never {
  throw new RangeError(`${op}: ${detail}`);
}

/** A finite number, else a loud failure. */
function requireNumber(op: string, name: string, value: number): number {
  if (!Number.isFinite(value)) {
    reject(op, `${name} must be a finite number, got ${String(value)}`);
  }
  return value;
}

/** A number inside a range the specs fix as a constant, else a failure. */
function requireRange(
  op: string,
  name: string,
  value: number,
  lo: number,
  hi: number,
): number {
  if (!Number.isFinite(value) || value < lo || value > hi) {
    reject(op, `${name} must be from ${lo} to ${hi}, got ${String(value)}`);
  }
  return value;
}

/** A whole number inside a range the specs fix as a constant, else a failure. */
function requireWhole(
  op: string,
  name: string,
  value: number,
  lo: number,
  hi: number,
): number {
  if (!Number.isInteger(value) || value < lo || value > hi) {
    reject(
      op,
      `${name} must be a whole number from ${lo} to ${hi}, got ${String(value)}`,
    );
  }
  return value;
}

/** One of a fixed set of names, else a loud failure. */
function requireOneOf<T extends string | number>(
  op: string,
  name: string,
  value: T,
  allowed: readonly T[],
): T {
  if (!allowed.includes(value)) {
    reject(
      op,
      `${name} must be one of ${allowed.join(", ")}, got ${String(value)}`,
    );
  }
  return value;
}

/**
 * Build the surface over an accessor for the open world. It holds nothing:
 * every operation reads the world — and the state and the actor set it carries
 * — at the moment it is called, so the surface follows the live game for the
 * life of the engine.
 */
export function createDebugApi(world: () => World): MeltdownDebugApi {
  const read = (): MeltdownState => meltdownState(world());
  const tower = (op: string, id: number): TowerState => {
    const entry = read().towers.find((candidate) => candidate.id === id);
    if (entry === undefined) reject(op, `no tower carries id ${String(id)}`);
    return entry;
  };
  const unit = (op: string, id: number): UnitState => {
    const entry = read().surge.find((candidate) => candidate.id === id);
    if (entry === undefined) reject(op, `no unit carries id ${String(id)}`);
    return entry;
  };
  /** The held preview an operation needs. Nothing armed fails loudly. */
  const requireHeld = (op: string): void => {
    if (read().build === null) {
      reject(op, "nothing is armed, so there is no preview to act on");
    }
  };
  /** Bring the actor set level with a roster a pose just changed. */
  const sync = (): void => {
    syncActors(world());
  };

  return {
    version: MELTDOWN_DEBUG_VERSION,

    reset(seed) {
      resetWith(read(), seed);
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

    /**
     * Bring every reported reading into agreement with the floor as it stands.
     *
     * Every derived reading this build reports — a unit's `col`, `row`,
     * `remaining`, `speed` and `slowed`; a tower's `size`, `redline`,
     * `heatMult`, `damage`, `slowFactor`, `output`, `refund` and `upgradeCost`;
     * the mode's figures; `waveRemaining`, `nextWave`, both `paths` lengths,
     * `menu`, `controls` and `build.valid` — is worked out at the read in
     * `snapshot`, so nothing is held that a pose can leave behind and there is
     * nothing here to rewrite. The operation is required of every build,
     * including one that keeps those readings as stored copies, and this is what
     * it comes to in a build that does not.
     *
     * It advances nothing and fires nothing either way: no clock moves, no
     * system runs, no cue is raised, and a caller may make the call as often as
     * it likes. It does not even sync the actor set, because a pose that changed
     * a roster already did.
     */
    reconcile() {},

    // ---- The screen and the run, each setting its field alone -------------

    setScreen(screen) {
      read().screen = requireOneOf("setScreen", "screen", screen, SCREENS);
    },
    setPhase(phase) {
      read().phase = requireOneOf("setPhase", "phase", phase, PHASES);
    },
    setMenuIndex(n) {
      read().menuIndex = requireNumber("setMenuIndex", "n", n);
    },
    setMode(mode) {
      read().mode = requireOneOf("setMode", "mode", mode, MODES);
    },
    setDifficulty(difficulty) {
      read().difficulty = requireOneOf(
        "setDifficulty",
        "difficulty",
        difficulty,
        DIFFICULTIES,
      );
    },
    setMoney(amount) {
      read().money = requireNumber("setMoney", "amount", amount);
    },
    setLives(count) {
      read().lives = requireNumber("setLives", "count", count);
    },
    setScore(n) {
      read().score = requireNumber("setScore", "n", n);
    },
    setWave(n) {
      read().wave = requireNumber("setWave", "n", n);
    },
    setBuildTimer(seconds) {
      read().buildTimer = requireNumber("setBuildTimer", "seconds", seconds);
    },
    setWavePending(n) {
      read().wavePending = requireNumber("setWavePending", "n", n);
    },
    // The toggle has two settings and the specs fix both, so it is a domain: a
    // third value names no speed and fails loudly.
    setSpeed(speed) {
      read().speed = requireOneOf("setSpeed", "speed", speed, [1, 2]);
    },

    setWaveSpawning(enabled) {
      read().waveSpawning = enabled;
    },

    // ---- The towers -------------------------------------------------------

    addTower(type, col, row, rotation) {
      requireOneOf("addTower", "type", type, TOWER_TYPES);
      requireNumber("addTower", "col", col);
      requireNumber("addTower", "row", row);
      if (rotation !== undefined) {
        requireWhole("addTower", "rotation", rotation, 0, 3);
      }
      addTowerAt(read(), type, col, row, rotation);
      sync();
    },
    removeTower(id) {
      tower("removeTower", id);
      removeTowerById(read(), id);
      sync();
    },
    clearTowers() {
      clearAllTowers(read());
      sync();
    },
    /**
     * The emitter's heat, on the scale the specs fix.
     *
     * The Forge and the Sink carry no heat of their own (specs/heat.md), so a
     * mover has no heat for this to reach: the call names nothing and fails
     * loudly rather than passing quietly.
     */
    setTowerHeat(id, heat) {
      const entry = tower("setTowerHeat", id);
      if (emitterDef(entry.type) === null) {
        reject(
          "setTowerHeat",
          `tower ${String(id)} is a ${entry.type}, which carries no heat of its own`,
        );
      }
      entry.heat = requireRange("setTowerHeat", "heat", heat, 0, TRIP_HEAT);
    },
    setTowerTripped(id, tripped) {
      tower("setTowerTripped", id).tripped = tripped;
    },
    setTowerTripTimer(id, seconds) {
      tower("setTowerTripTimer", id).tripTimer = requireNumber(
        "setTowerTripTimer",
        "seconds",
        seconds,
      );
    },
    // `1` through `MAX_LEVEL` is a range the specs fix as a constant, so a level
    // outside it names no level of this game and fails loudly.
    setTowerLevel(id, level) {
      tower("setTowerLevel", id).level = requireWhole(
        "setTowerLevel",
        "level",
        level,
        1,
        MAX_LEVEL,
      );
    },
    setTowerFresh(id, fresh) {
      tower("setTowerFresh", id).fresh = fresh;
    },
    setTowerFiring(id, enabled) {
      tower("setTowerFiring", id).firingEnabled = enabled;
    },
    setTowerThermal(id, enabled) {
      tower("setTowerThermal", id).thermalEnabled = enabled;
    },

    // ---- Building ---------------------------------------------------------

    setArmed(type) {
      if (type !== null) requireOneOf("setArmed", "type", type, TOWER_TYPES);
      armType(read(), type);
    },
    /**
     * Move the held preview to the tile the call names, exactly there.
     *
     * A footprint hanging off the grid is one the real placement check answers
     * `false` for, so `build.valid` reports that rather than the anchor being
     * nudged back on. With nothing armed there is no preview to move.
     */
    setPreview(col, row) {
      requireHeld("setPreview");
      requireNumber("setPreview", "col", col);
      requireNumber("setPreview", "row", row);
      movePreview(read(), col, row);
    },
    setPreviewRotation(rotation) {
      requireHeld("setPreviewRotation");
      requireWhole("setPreviewRotation", "rotation", rotation, 0, 3);
      setPreviewRotation(read(), rotation);
    },
    /**
     * Commit the held preview, from wherever the game stands.
     *
     * The screen, the phase and the panel are how a player reaches the floor and
     * are not this call's conditions. The placement check is: an invalid
     * footprint builds nothing and spends nothing, which is the check's own
     * answer. With nothing armed there is no preview to commit.
     */
    place() {
      requireHeld("place");
      placeHeld(read());
      sync();
    },
    setSelected(id) {
      if (id !== null) tower("setSelected", id);
      read().selected = id;
    },
    setHoverShop(type) {
      if (type !== null)
        requireOneOf("setHoverShop", "type", type, TOWER_TYPES);
      read().hoverShop = type;
    },
    /**
     * One level up, paid for, through the real upgrade code. The purse and the
     * cap at `MAX_LEVEL` stay: they are the transaction's own arithmetic and are
     * what the economy items read.
     */
    upgradeTower(id) {
      tower("upgradeTower", id);
      upgradeTowerById(read(), id);
    },
    sellTower(id) {
      tower("sellTower", id);
      sellTowerById(read(), id);
      sync();
    },

    // ---- The surge --------------------------------------------------------

    addUnit(type, vent) {
      requireOneOf("addUnit", "type", type, SURGE_TYPES);
      requireOneOf("addUnit", "vent", vent, VENTS);
      spawnUnit(read(), type, vent);
      sync();
    },
    removeUnit(id) {
      unit("removeUnit", id);
      dropUnit(read(), id);
      sync();
    },
    clearSurge() {
      read().surge = [];
      sync();
    },
    setUnitPosition(id, x, y) {
      const entry = unit("setUnitPosition", id);
      entry.x = requireNumber("setUnitPosition", "x", x);
      entry.y = requireNumber("setUnitPosition", "y", y);
    },
    setUnitHp(id, hp) {
      unit("setUnitHp", id).hp = requireNumber("setUnitHp", "hp", hp);
    },
    setUnitMaxHp(id, maxHp) {
      unit("setUnitMaxHp", id).maxHp = requireNumber(
        "setUnitMaxHp",
        "maxHp",
        maxHp,
      );
    },
    setUnitSlow(id, factor) {
      unit("setUnitSlow", id).slowFactor = requireNumber(
        "setUnitSlow",
        "factor",
        factor,
      );
    },
    setUnitSlowTimer(id, seconds) {
      unit("setUnitSlowTimer", id).slowTimer = requireNumber(
        "setUnitSlowTimer",
        "seconds",
        seconds,
      );
    },
    setUnitMotion(id, enabled) {
      unit("setUnitMotion", id).motion = enabled;
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
