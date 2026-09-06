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
// The surface is inert during normal play: nothing below runs until something
// calls it.

import { MELTDOWN_DEBUG_VERSION, tileOfX, tileOfY } from "./constants";
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

/** `min(max(v, lo), hi)`. */
function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
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
  /** The tower an operation names, or nothing at all. */
  function tower(id: number): Tower | null {
    return towerById(host.state.towers, id);
  }

  return {
    version: MELTDOWN_DEBUG_VERSION,

    reset() {
      resetState(host.state);
    },

    snapshot() {
      return readSnapshot(host.state, host.autoStep());
    },

    setAutoStep(enabled) {
      host.setAutoStep(Boolean(enabled));
    },

    advance(seconds, frames = 1) {
      host.advance(seconds, frames);
    },

    setScreen(screen) {
      host.state.screen = screen;
    },

    setPhase(phase) {
      host.state.phase = phase;
    },

    setMenuIndex(n) {
      host.state.menuIndex = n;
    },

    setMode(mode) {
      host.state.mode = mode;
    },

    setDifficulty(difficulty) {
      host.state.difficulty = difficulty;
    },

    setMoney(amount) {
      host.state.money = amount;
    },

    setLives(count) {
      host.state.lives = count;
    },

    setScore(n) {
      host.state.score = n;
    },

    setWave(n) {
      host.state.wave = n;
    },

    setBuildTimer(seconds) {
      host.state.buildTimer = seconds;
    },

    setWavePending(n) {
      host.state.wavePending = n;
    },

    setSpeed(speed) {
      host.state.speed = speed === 2 ? 2 : 1;
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
      return addTower(host.state, type, col, row, rotation).id;
    },

    removeTower(id) {
      removeTower(host.state, id);
    },

    clearTowers() {
      clearTowers(host.state);
    },

    setTowerHeat(id, heat) {
      const held = tower(id);
      // The Forge and the Sink carry no heat of their own and report `0` for it
      // forever (specs/towers.md), so this operation is the emitter's alone.
      if (held !== null && isEmitterTower(held)) {
        held.heat = clamp(heat, 0, 100);
      }
    },

    setTowerTripped(id, tripped) {
      const held = tower(id);
      if (held !== null) held.tripped = Boolean(tripped);
    },

    setTowerTripTimer(id, seconds) {
      const held = tower(id);
      if (held !== null) held.tripTimer = seconds;
    },

    setTowerLevel(id, level) {
      const held = tower(id);
      if (held !== null) held.level = clamp(level, 1, 3) as Level;
    },

    setTowerFresh(id, fresh) {
      const held = tower(id);
      if (held !== null) held.fresh = Boolean(fresh);
    },

    setTowerFiring(id, enabled) {
      const held = tower(id);
      if (held !== null) held.firingEnabled = Boolean(enabled);
    },

    setTowerThermal(id, enabled) {
      const held = tower(id);
      if (held !== null) held.thermalEnabled = Boolean(enabled);
    },

    setArmed(type) {
      arm(host.state, type);
    },

    setPreview(col, row) {
      movePreview(host.state, col, row);
    },

    setPreviewRotation(rotation) {
      setPreviewRotation(host.state, rotation);
    },

    place() {
      place(host.state, NO_CUES);
    },

    setSelected(id) {
      host.state.selected = id;
    },

    setHoverShop(type) {
      host.state.hoverShop = type;
    },

    upgradeTower(id) {
      upgrade(host.state, id);
    },

    sellTower(id) {
      sell(host.state, id, NO_CUES);
    },

    addUnit(type, vent) {
      return addUnit(host.state, type, vent).id;
    },

    removeUnit(id) {
      removeUnit(host.state, id);
    },

    clearSurge() {
      clearSurge(host.state);
    },

    setUnitPosition(id, x, y) {
      const unit = unitById(host.state.surge, id);
      if (unit === null) return;
      unit.x = x;
      unit.y = y;
    },

    setUnitHp(id, hp) {
      const unit = unitById(host.state.surge, id);
      if (unit !== null) unit.hp = hp;
    },

    setUnitMaxHp(id, maxHp) {
      const unit = unitById(host.state.surge, id);
      if (unit !== null) unit.maxHp = maxHp;
    },

    setUnitSlow(id, factor) {
      const unit = unitById(host.state.surge, id);
      if (unit !== null) unit.slowFactor = factor;
    },

    setUnitSlowTimer(id, seconds) {
      const unit = unitById(host.state.surge, id);
      if (unit !== null) unit.slowTimer = seconds;
    },

    setUnitMotion(id, enabled) {
      const unit = unitById(host.state.surge, id);
      if (unit !== null) unit.motion = Boolean(enabled);
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
