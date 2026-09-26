// Meltdown — the debugging and automation surface, `window.__meltdown`.
//
// `specs/instrumentation.md` specifies it and this file implements it. Every
// operation is one of three things and never more than one:
//
//   * a READ of the state — `snapshot`, which changes nothing;
//   * a POSE of one field — every `set*`, `addTower`, `removeUnit`, and the
//     three faculty gates, none of which runs a rule and none of which pays,
//     spends, or announces anything;
//   * a MOVE OF THE CLOCK — `setAutoStep` and `advance`, which exist because this
//     build stands on no engine and nothing outside it owns its clock.
//
// Three operations are neither poses nor reads: `place`, `upgradeTower` and
// `sellTower` are single things a PLAYER does, running through the game's own
// code, so each has every consequence the rules give it. They are here beside
// the atoms rather than instead of them: a validator that merely wants a tower
// gone calls `removeTower`, and one about what selling does calls `sellTower`.
//
// NO OPERATION HERE PLAYS A CUE, and none can: a cue is raised by the frame that
// resolves its event and played from the frame loop, and every operation below
// resolves outside a frame. Each act is therefore handed the silent cue sink.
//
// EVERY OPERATION ACTS, AND NONE OF THEM DECLINES QUIETLY. A pose reaches the
// value it names whatever the game's own rules would have allowed a player to
// reach, so nothing below clamps a posed value onto a legal neighbour. An act
// carries out its own transaction FROM WHEREVER THE GAME STANDS: the screen, the
// phase, the open panel, the selection and the pointer are how a PLAYER reaches
// the control and are not its conditions, so `sellTower` sells from the title
// screen and `place` commits with no panel open. What an act keeps is its own
// arithmetic — the price, the purse, the cap on a level, the placement check —
// because that is the transaction rather than a gate on reaching it, and it is
// what the review items read.
//
// AND WHERE THE GAME HAS NO DEFINED STATE TO REACH, THE CALL THROWS: an id no
// live tower or unit carries, a name outside its set, a level or rotation
// outside the fixed range, an emitter operation aimed at a mover that carries no
// heat, a preview operation with nothing armed. A caller sees the throw rather
// than reading back a floor it never posed (specs/instrumentation.md).
//
// The surface is inert during normal play: nothing below runs until something
// calls it.

import {
  DIFFICULTIES,
  MAX_LEVEL,
  MELTDOWN_DEBUG_VERSION,
  MODES,
  SURGE_TYPES,
  TOWER_TYPES,
  TRIP_HEAT,
  tileOfX,
  tileOfY,
} from "./constants";
import {
  NO_CUES,
  addTower,
  arm,
  clearTowers,
  removeTower,
  heldIsValid,
  movePreview,
  place,
  sell,
  setPreviewRotation,
  upgrade,
} from "./build";
import { menuRects } from "./menus";
import { modeFigures, type BuildZone } from "./modes";
import { panelControls, type PanelControls } from "./panel";
import { addUnit, clearSurge, drawVent, removeUnit } from "./sim";
import { resetState, type MeltdownState, type Tower } from "./state";
import {
  damageOf,
  heatMultOf,
  isEmitterTower,
  outputOf,
  radiatorFaces,
  redlineOf,
  refundOf,
  sizeOf,
  slowFactorOf,
  towerById,
  upgradeCostOfTower,
} from "./towers";
import {
  baseSpeedOf,
  exhaustOf,
  fliesOf,
  remainingOf,
  speedOf,
  unitById,
} from "./units";
import { wavePreview } from "./waves";
import type {
  DifficultyId,
  Exhaust,
  Level,
  ModeId,
  Phase,
  Rotation,
  Screen,
  Side,
  Speed,
  SurgeType,
  TowerType,
  Vent,
} from "./types";

/** The `window` property the installed surface is published on. */
export const MELTDOWN_HANDLE = "__meltdown";

/** One tower, as the snapshot reports it. */
export interface SnapshotTower {
  id: number;
  type: TowerType;
  col: number;
  row: number;
  size: number;
  rotation: Rotation;
  level: Level;
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
  radiatorFaces: Side[];
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
  vent: Vent;
  exhaust: Exhaust;
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

/** Everything `snapshot` reports (specs/instrumentation.md). */
export interface MeltdownSnapshot {
  version: number;
  screen: Screen;
  phase: Phase;
  menuIndex: number;
  mode: ModeId;
  difficulty: DifficultyId;
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
  speed: Speed;
  muted: boolean;
  waveSpawning: boolean;
  spawnVent: Vent | null;
  autoStep: boolean;
  pointer: { x: number; y: number; down: boolean };
  selected: number | null;
  hoverShop: TowerType | null;
  build: {
    type: TowerType;
    col: number;
    row: number;
    rotation: Rotation;
    valid: boolean;
  } | null;
  buildZone: BuildZone | null;
  paths: { left: { length: number }; top: { length: number } };
  menu: SnapshotMenuRow[];
  controls: PanelControls;
  towers: SnapshotTower[];
  surge: SnapshotUnit[];
  simTime: number;
}

/**
 * What the installed surface reaches on the runtime: the live state, the clock,
 * and the pointer's own door. Structural on purpose — `src/runtime.ts` satisfies
 * it without knowing this file exists, and a test can hand the surface a host of
 * its own.
 */
export interface DebugHost {
  readonly state: MeltdownState;
  /** Whether the loop advances the simulation from the wall clock. */
  autoStep(): boolean;
  /** Take the game off the wall clock, or give it back. */
  setAutoStep(enabled: boolean): void;
  /** Run `frames` whole frames covering `seconds` of game time. */
  advance(seconds: number, frames?: number): void;
  /** Report a pointer event, silently, down the runtime's own pointer path. */
  reportPointer(
    type: "down" | "move" | "up",
    x: number,
    y: number,
    silent?: boolean,
  ): void;
}

/** The object `window.__meltdown` carries. */
export interface MeltdownDebugApi {
  version: number;

  reset(): void;
  snapshot(): MeltdownSnapshot;
  /** Bring every reported reading into agreement with the floor as it stands. */
  reconcile(): void;

  setAutoStep(enabled: boolean): void;
  advance(seconds: number, frames?: number): void;

  setScreen(screen: Screen): void;
  setPhase(phase: Phase): void;
  setMenuIndex(n: number): void;
  setMode(mode: ModeId): void;
  setDifficulty(difficulty: DifficultyId): void;
  setMoney(amount: number): void;
  setLives(count: number): void;
  setScore(n: number): void;
  setWave(n: number): void;
  setBuildTimer(seconds: number): void;
  setWavePending(n: number): void;
  setSpeed(speed: Speed): void;

  setWaveSpawning(enabled: boolean): void;
  setSpawnVent(vent: Vent | null): void;
  drawVent(): Vent;

  addTower(
    type: TowerType,
    col: number,
    row: number,
    rotation?: Rotation,
  ): number;
  removeTower(id: number): void;
  clearTowers(): void;
  setTowerHeat(id: number, heat: number): void;
  setTowerTripped(id: number, tripped: boolean): void;
  setTowerTripTimer(id: number, seconds: number): void;
  setTowerLevel(id: number, level: Level): void;
  setTowerFresh(id: number, fresh: boolean): void;
  setTowerFiring(id: number, enabled: boolean): void;
  setTowerThermal(id: number, enabled: boolean): void;

  setArmed(type: TowerType | null): void;
  setPreview(col: number, row: number): void;
  setPreviewRotation(rotation: Rotation): void;
  place(): void;
  setSelected(id: number | null): void;
  setHoverShop(type: TowerType | null): void;
  upgradeTower(id: number): void;
  sellTower(id: number): void;

  addUnit(type: SurgeType, vent: Vent): number;
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

/* -------------------------------------------------------------------------- */
/* The loud half of the contract                                              */
/* -------------------------------------------------------------------------- */
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
const VENTS: readonly Vent[] = ["left", "top"];

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

/** One tower, read for the snapshot. */
function readTower(tower: Tower): SnapshotTower {
  return {
    id: tower.id,
    type: tower.type,
    col: tower.col,
    row: tower.row,
    size: sizeOf(tower),
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
    radiatorFaces: radiatorFaces(tower),
    kills: tower.kills,
    damageDealt: tower.damageDealt,
    spent: tower.spent,
    refund: refundOf(tower),
    upgradeCost: upgradeCostOfTower(tower),
    fresh: tower.fresh,
    firingEnabled: tower.firingEnabled,
    thermalEnabled: tower.thermalEnabled,
  };
}

/** The whole state, read (specs/instrumentation.md). */
export function readSnapshot(
  state: MeltdownState,
  autoStep: boolean,
): MeltdownSnapshot {
  const figures = modeFigures(state.mode, state.difficulty);
  const coming =
    state.phase === "wave"
      ? wavePreview(state.mode, state.wave + 1, figures.waveCount)
      : wavePreview(state.mode, state.wave, figures.waveCount);
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
      state.phase === "wave"
        ? state.wavePending + state.surge.length
        : state.wavePending,
    nextWave: coming === null ? null : { ...coming },
    speed: state.speed,
    muted: state.muted,
    waveSpawning: state.waveSpawning,
    spawnVent: state.spawnVent,
    autoStep,
    pointer: { ...state.pointer },
    selected: state.selected,
    hoverShop: state.hoverShop,
    build:
      state.build === null
        ? null
        : { ...state.build, valid: heldIsValid(state) },
    buildZone: figures.buildZone,
    paths: {
      left: { length: state.floor.routeLength("left") },
      top: { length: state.floor.routeLength("top") },
    },
    menu: menuRects(state.screen).map((rect, index) => ({ index, ...rect })),
    controls: panelControls(state),
    towers: state.towers.map(readTower),
    surge: state.surge.map((unit) => ({
      id: unit.id,
      type: unit.type,
      x: unit.x,
      y: unit.y,
      col: tileOfX(unit.x),
      row: tileOfY(unit.y),
      hp: unit.hp,
      maxHp: unit.maxHp,
      speed: speedOf(unit),
      baseSpeed: baseSpeedOf(unit),
      slowed: unit.slowFactor > 0,
      slowFactor: unit.slowFactor,
      slowTimer: unit.slowTimer,
      flying: fliesOf(unit),
      vent: unit.vent,
      exhaust: exhaustOf(unit),
      remaining: remainingOf(unit, state.floor),
      motion: unit.motion,
    })),
    simTime: state.simTime,
  };
}

/** Build the surface over one host. */
export function createDebugApi(host: DebugHost): MeltdownDebugApi {
  /** The tower an operation names. An id no tower carries fails loudly. */
  function tower(op: string, id: number): Tower {
    const held = towerById(host.state.towers, id);
    if (held === null) reject(op, `no tower carries id ${String(id)}`);
    return held;
  }

  /** The held preview an operation needs. Nothing armed fails loudly. */
  function requireHeld(op: string): void {
    if (host.state.build === null) {
      reject(op, "nothing is armed, so there is no preview to act on");
    }
  }

  /** The unit an operation names. An id no unit carries fails loudly. */
  function unit(op: string, id: number) {
    const found = unitById(host.state.surge, id);
    if (found === null) reject(op, `no unit carries id ${String(id)}`);
    return found;
  }

  return {
    version: MELTDOWN_DEBUG_VERSION,

    reset() {
      resetState(host.state);
    },

    snapshot() {
      return readSnapshot(host.state, host.autoStep());
    },

    /**
     * Bring every reported reading into agreement with the floor as it stands.
     *
     * Every derived reading this build reports — a unit's `col`, `row`,
     * `remaining`, `speed` and `slowed`; a tower's `size`, `redline`,
     * `heatMult`, `damage`, `slowFactor`, `output`, `refund` and `upgradeCost`;
     * the mode's figures; `waveRemaining`, `nextWave`, both `paths` lengths,
     * `menu`, `controls` and `build.valid` — is worked out at the read in
     * `readSnapshot`, so nothing is held that a pose can leave behind and there
     * is nothing here to rewrite. The operation is required of every build,
     * including one that keeps those readings as stored copies, and this is what
     * it comes to in a build that does not.
     *
     * It advances nothing and fires nothing either way: no clock moves, no
     * system runs, no cue is raised, and a caller may make the call as often as
     * it likes.
     */
    reconcile() {},

    setAutoStep(enabled) {
      host.setAutoStep(Boolean(enabled));
    },

    advance(seconds, frames = 1) {
      host.advance(seconds, frames);
    },

    setScreen(screen) {
      host.state.screen = requireOneOf("setScreen", "screen", screen, SCREENS);
    },

    setPhase(phase) {
      host.state.phase = requireOneOf("setPhase", "phase", phase, PHASES);
    },

    setMenuIndex(n) {
      host.state.menuIndex = requireNumber("setMenuIndex", "n", n);
    },

    setMode(mode) {
      host.state.mode = requireOneOf("setMode", "mode", mode, MODES);
    },

    setDifficulty(difficulty) {
      host.state.difficulty = requireOneOf(
        "setDifficulty",
        "difficulty",
        difficulty,
        DIFFICULTIES,
      );
    },

    setMoney(amount) {
      host.state.money = requireNumber("setMoney", "amount", amount);
    },

    setLives(count) {
      host.state.lives = requireNumber("setLives", "count", count);
    },

    setScore(n) {
      host.state.score = requireNumber("setScore", "n", n);
    },

    setWave(n) {
      host.state.wave = requireNumber("setWave", "n", n);
    },

    setBuildTimer(seconds) {
      host.state.buildTimer = requireNumber(
        "setBuildTimer",
        "seconds",
        seconds,
      );
    },

    setWavePending(n) {
      host.state.wavePending = requireNumber("setWavePending", "n", n);
    },

    // The toggle has two settings and the specs fix both, so it is a domain: a
    // third value names no speed and fails loudly rather than being read as `1`.
    setSpeed(speed) {
      host.state.speed = requireOneOf("setSpeed", "speed", speed, [1, 2]);
    },

    setWaveSpawning(enabled) {
      host.state.waveSpawning = Boolean(enabled);
    },

    setSpawnVent(vent) {
      host.state.spawnVent = vent === "left" || vent === "top" ? vent : null;
    },

    drawVent() {
      return drawVent();
    },

    addTower(type, col, row, rotation = 0) {
      requireOneOf("addTower", "type", type, TOWER_TYPES);
      requireNumber("addTower", "col", col);
      requireNumber("addTower", "row", row);
      requireWhole("addTower", "rotation", rotation, 0, 3);
      return addTower(host.state, type, col, row, rotation).id;
    },

    removeTower(id) {
      tower("removeTower", id);
      removeTower(host.state, id);
    },

    clearTowers() {
      clearTowers(host.state);
    },

    /**
     * The emitter's heat, on the scale the specs fix.
     *
     * The Forge and the Sink carry no heat of their own and report `0` for it
     * forever (specs/towers.md), so a mover has no heat for this to reach: the
     * call names nothing and fails loudly rather than passing quietly. The scale
     * is a constant, so a heat off it fails too rather than being squeezed on.
     */
    setTowerHeat(id, heat) {
      const held = tower("setTowerHeat", id);
      if (!isEmitterTower(held)) {
        reject(
          "setTowerHeat",
          `tower ${String(id)} is a ${held.type}, which carries no heat of its own`,
        );
      }
      held.heat = requireRange("setTowerHeat", "heat", heat, 0, TRIP_HEAT);
    },

    setTowerTripped(id, tripped) {
      tower("setTowerTripped", id).tripped = Boolean(tripped);
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
      ) as Level;
    },

    setTowerFresh(id, fresh) {
      tower("setTowerFresh", id).fresh = Boolean(fresh);
    },

    setTowerFiring(id, enabled) {
      tower("setTowerFiring", id).firingEnabled = Boolean(enabled);
    },

    setTowerThermal(id, enabled) {
      tower("setTowerThermal", id).thermalEnabled = Boolean(enabled);
    },

    setArmed(type) {
      if (type !== null) requireOneOf("setArmed", "type", type, TOWER_TYPES);
      arm(host.state, type);
    },

    /**
     * Move the held preview to the tile the call names, exactly there.
     *
     * A footprint hanging off the grid is one the real placement check answers
     * `false` for, so `build.valid` reports that rather than the anchor being
     * nudged back on: the caller reads the footprint it asked for. With nothing
     * armed there is no preview to move, so the call names nothing and fails.
     */
    setPreview(col, row) {
      requireHeld("setPreview");
      requireNumber("setPreview", "col", col);
      requireNumber("setPreview", "row", row);
      movePreview(host.state, col, row);
    },

    setPreviewRotation(rotation) {
      requireHeld("setPreviewRotation");
      requireWhole("setPreviewRotation", "rotation", rotation, 0, 3);
      setPreviewRotation(host.state, rotation);
    },

    /**
     * Commit the held preview, from wherever the game stands.
     *
     * The screen, the phase and the panel are how a player reaches the floor and
     * are not this call's conditions. The placement check is: an invalid
     * footprint builds nothing and spends nothing, which is the check's own
     * answer and what `building/place-refused-when-invalid` reads. With nothing
     * armed there is no preview to commit and the call fails loudly.
     */
    place() {
      requireHeld("place");
      place(host.state, NO_CUES);
    },

    setSelected(id) {
      if (id !== null) tower("setSelected", id);
      host.state.selected = id;
    },

    setHoverShop(type) {
      if (type !== null)
        requireOneOf("setHoverShop", "type", type, TOWER_TYPES);
      host.state.hoverShop = type;
    },

    /**
     * One level up, paid for, through the real upgrade code.
     *
     * The purse and the cap at `MAX_LEVEL` stay: they are the transaction's own
     * arithmetic and are what `building/upgrade-refused-when-unaffordable` and
     * `building/upgrade-stops-at-three` read. Neither the panel nor the
     * selection is asked about.
     */
    upgradeTower(id) {
      tower("upgradeTower", id);
      upgrade(host.state, id);
    },

    sellTower(id) {
      tower("sellTower", id);
      sell(host.state, id, NO_CUES);
    },

    addUnit(type, vent) {
      requireOneOf("addUnit", "type", type, SURGE_TYPES);
      requireOneOf("addUnit", "vent", vent, VENTS);
      return addUnit(host.state, type, vent).id;
    },

    removeUnit(id) {
      unit("removeUnit", id);
      removeUnit(host.state, id);
    },

    clearSurge() {
      clearSurge(host.state);
    },

    setUnitPosition(id, x, y) {
      const found = unit("setUnitPosition", id);
      found.x = requireNumber("setUnitPosition", "x", x);
      found.y = requireNumber("setUnitPosition", "y", y);
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
      unit("setUnitMotion", id).motion = Boolean(enabled);
    },

    pointerDown(x, y) {
      host.reportPointer("down", x, y, true);
    },

    pointerMove(x, y) {
      host.reportPointer("move", x, y, true);
    },

    pointerUp() {
      const { x, y } = host.state.pointer;
      host.reportPointer("up", x, y, true);
    },
  };
}

/**
 * Install the surface on `window.__meltdown` and return the function that
 * removes it again, while the installed object is still the one this call
 * published. `window` is the global object, so the same install serves the
 * browser and an in-process test alike.
 */
export function installDebugApi(host: DebugHost): () => void {
  const installed = createDebugApi(host);
  const target = globalThis as unknown as Record<string, unknown>;
  target[MELTDOWN_HANDLE] = installed;
  return () => {
    if (target[MELTDOWN_HANDLE] === installed) {
      delete target[MELTDOWN_HANDLE];
    }
  };
}
