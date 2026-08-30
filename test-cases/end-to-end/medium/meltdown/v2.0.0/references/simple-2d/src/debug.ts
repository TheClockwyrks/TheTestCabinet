// Meltdown — the debug and automation surface.
//
// specs/instrumentation.md fixes every operation here. Under this engine the
// state is a VALUE the engine holds, so nothing anywhere holds a writable one
// and the surface is written in the shape of `update`: a pose takes the current
// state, as `DeepReadonly<MeltdownState>`, and returns the next one; a reading
// takes the state the same way and returns what it read. A caller drives a pose
// with `engine.apply` and a reading against `engine.state`.
//
// Two things follow from that shape, and both are deliberate:
//
//   - NO OPERATION HERE PLAYS A CUE, and none can. A cue is raised by the frame
//     that resolves its event and is played from `update`, which is the only
//     place an `UpdateApi` exists. Every `audio.*` requirement is therefore
//     reached the way a player reaches it.
//   - THERE IS NO `setMuted`. Muting is the runtime's, reached through the
//     `mute` action or the panel's mute control, and the snapshot reports the
//     game's own copy of the bit.
//
// Each pose sets ONE field and runs no entry effect, so `setScreen` pays no
// interest and `setPhase` clears no wave. The three acts — `place`,
// `upgradeTower`, `sellTower` — run through the game's own code and carry every
// consequence specs/building.md gives them, which is what makes them acts
// rather than poses.

import {
  DEFAULT_SEED,
  MAX_LEVEL,
  MELTDOWN_DEBUG_VERSION,
  TRIP_HEAT,
  type DifficultyName,
  type ModeName,
  type SurgeType,
  type TowerType,
  type VentName,
} from "./constants";
import {
  addTowerAt,
  armType,
  clearAllTowers,
  movePreview,
  placeHeld,
  removeTowerById,
  sellAt,
  setHeldRotation,
  upgradeAt,
} from "./build";
import { resetState } from "./flow";
import { hpScaleOf } from "./modes";
import {
  pointerDown as resolveDown,
  pointerMove as resolveMove,
  pointerUp as resolveUp,
} from "./pointer";
import { routesOf } from "./routes";
import { snapshotOf, type MeltdownSnapshot } from "./snapshot";
import { newUnit } from "./surge";
import type { DeepReadonly } from "ts-essentials";
import type {
  MeltdownState,
  Phase,
  Screen,
  TowerState,
  UnitState,
} from "./game";

/** What `reset` accepts. */
export interface ResetOptions {
  /** The seed all of the game's randomness runs off. Defaults to `1`. */
  readonly seed?: number;
}

/** The debug and automation surface, in this engine's spelling. */
export interface MeltdownDebugApi {
  readonly version: number;

  reset(
    state: DeepReadonly<MeltdownState>,
    options?: ResetOptions,
  ): MeltdownState;
  snapshot(state: DeepReadonly<MeltdownState>): MeltdownSnapshot;

  setScreen(state: DeepReadonly<MeltdownState>, screen: Screen): MeltdownState;
  setPhase(state: DeepReadonly<MeltdownState>, phase: Phase): MeltdownState;
  setMenuIndex(state: DeepReadonly<MeltdownState>, n: number): MeltdownState;
  setMode(state: DeepReadonly<MeltdownState>, mode: ModeName): MeltdownState;
  setDifficulty(
    state: DeepReadonly<MeltdownState>,
    difficulty: DifficultyName,
  ): MeltdownState;
  setMoney(state: DeepReadonly<MeltdownState>, amount: number): MeltdownState;
  setLives(state: DeepReadonly<MeltdownState>, count: number): MeltdownState;
  setScore(state: DeepReadonly<MeltdownState>, n: number): MeltdownState;
  setWave(state: DeepReadonly<MeltdownState>, n: number): MeltdownState;
  setBuildTimer(
    state: DeepReadonly<MeltdownState>,
    seconds: number,
  ): MeltdownState;
  setWavePending(state: DeepReadonly<MeltdownState>, n: number): MeltdownState;
  setSpeed(state: DeepReadonly<MeltdownState>, speed: number): MeltdownState;

  setWaveSpawning(
    state: DeepReadonly<MeltdownState>,
    enabled: boolean,
  ): MeltdownState;

  addTower(
    state: DeepReadonly<MeltdownState>,
    type: TowerType,
    col: number,
    row: number,
    rotation?: number,
  ): MeltdownState;
  removeTower(state: DeepReadonly<MeltdownState>, id: number): MeltdownState;
  clearTowers(state: DeepReadonly<MeltdownState>): MeltdownState;
  setTowerHeat(
    state: DeepReadonly<MeltdownState>,
    id: number,
    heat: number,
  ): MeltdownState;
  setTowerTripped(
    state: DeepReadonly<MeltdownState>,
    id: number,
    tripped: boolean,
  ): MeltdownState;
  setTowerTripTimer(
    state: DeepReadonly<MeltdownState>,
    id: number,
    seconds: number,
  ): MeltdownState;
  setTowerLevel(
    state: DeepReadonly<MeltdownState>,
    id: number,
    level: number,
  ): MeltdownState;
  setTowerFresh(
    state: DeepReadonly<MeltdownState>,
    id: number,
    fresh: boolean,
  ): MeltdownState;
  setTowerFiring(
    state: DeepReadonly<MeltdownState>,
    id: number,
    enabled: boolean,
  ): MeltdownState;
  setTowerThermal(
    state: DeepReadonly<MeltdownState>,
    id: number,
    enabled: boolean,
  ): MeltdownState;

  setArmed(
    state: DeepReadonly<MeltdownState>,
    type: TowerType | null,
  ): MeltdownState;
  setPreview(
    state: DeepReadonly<MeltdownState>,
    col: number,
    row: number,
  ): MeltdownState;
  setPreviewRotation(
    state: DeepReadonly<MeltdownState>,
    rotation: number,
  ): MeltdownState;
  place(state: DeepReadonly<MeltdownState>): MeltdownState;
  setSelected(
    state: DeepReadonly<MeltdownState>,
    id: number | null,
  ): MeltdownState;
  setHoverShop(
    state: DeepReadonly<MeltdownState>,
    type: TowerType | null,
  ): MeltdownState;
  upgradeTower(state: DeepReadonly<MeltdownState>, id: number): MeltdownState;
  sellTower(state: DeepReadonly<MeltdownState>, id: number): MeltdownState;

  addUnit(
    state: DeepReadonly<MeltdownState>,
    type: SurgeType,
    vent: VentName,
  ): MeltdownState;
  removeUnit(state: DeepReadonly<MeltdownState>, id: number): MeltdownState;
  clearSurge(state: DeepReadonly<MeltdownState>): MeltdownState;
  setUnitPosition(
    state: DeepReadonly<MeltdownState>,
    id: number,
    x: number,
    y: number,
  ): MeltdownState;
  setUnitHp(
    state: DeepReadonly<MeltdownState>,
    id: number,
    hp: number,
  ): MeltdownState;
  setUnitMaxHp(
    state: DeepReadonly<MeltdownState>,
    id: number,
    maxHp: number,
  ): MeltdownState;
  setUnitSlow(
    state: DeepReadonly<MeltdownState>,
    id: number,
    factor: number,
  ): MeltdownState;
  setUnitSlowTimer(
    state: DeepReadonly<MeltdownState>,
    id: number,
    seconds: number,
  ): MeltdownState;
  setUnitMotion(
    state: DeepReadonly<MeltdownState>,
    id: number,
    enabled: boolean,
  ): MeltdownState;

  pointerDown(
    state: DeepReadonly<MeltdownState>,
    x: number,
    y: number,
  ): MeltdownState;
  pointerMove(
    state: DeepReadonly<MeltdownState>,
    x: number,
    y: number,
  ): MeltdownState;
  pointerUp(state: DeepReadonly<MeltdownState>): MeltdownState;
}

/**
 * Every field of `MeltdownState` is `readonly` and every array on it is a
 * `readonly` array, so the read-only view the engine hands out and the declared
 * type are the same shape and a pose spreads one into the other with no cast.
 */
function held(state: DeepReadonly<MeltdownState>): MeltdownState {
  return state as MeltdownState;
}

function withTower(
  state: DeepReadonly<MeltdownState>,
  id: number,
  patch: (tower: TowerState) => TowerState,
): MeltdownState {
  const base = held(state);
  return {
    ...base,
    towers: base.towers.map((tower) =>
      tower.id === id ? patch(tower) : tower,
    ),
  };
}

function withUnit(
  state: DeepReadonly<MeltdownState>,
  id: number,
  patch: (unit: UnitState) => UnitState,
): MeltdownState {
  const base = held(state);
  return {
    ...base,
    surge: base.surge.map((unit) => (unit.id === id ? patch(unit) : unit)),
  };
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}

/** Build the surface `initialize` returns beside the state. */
export function createDebugApi(): MeltdownDebugApi {
  return {
    version: MELTDOWN_DEBUG_VERSION,

    reset: (state, options) =>
      resetState(held(state), options?.seed ?? DEFAULT_SEED),
    snapshot: (state) => snapshotOf(held(state)),

    setScreen: (state, screen) => ({ ...held(state), screen }),
    setPhase: (state, phase) => ({ ...held(state), phase }),
    setMenuIndex: (state, n) => ({ ...held(state), menuIndex: n }),
    setMode: (state, mode) => ({ ...held(state), mode }),
    setDifficulty: (state, difficulty) => ({ ...held(state), difficulty }),
    setMoney: (state, amount) => ({ ...held(state), money: amount }),
    setLives: (state, count) => ({ ...held(state), lives: count }),
    setScore: (state, n) => ({ ...held(state), score: n }),
    setWave: (state, n) => ({ ...held(state), wave: n }),
    setBuildTimer: (state, seconds) => ({
      ...held(state),
      buildTimer: seconds,
    }),
    setWavePending: (state, n) => ({ ...held(state), wavePending: n }),
    setSpeed: (state, speed) => ({ ...held(state), speed }),

    setWaveSpawning: (state, enabled) => ({
      ...held(state),
      waveSpawning: enabled,
    }),

    addTower: (state, type, col, row, rotation = 0) =>
      addTowerAt(held(state), type, col, row, rotation),
    removeTower: (state, id) => removeTowerById(held(state), id),
    clearTowers: (state) => clearAllTowers(held(state)),
    setTowerHeat: (state, id, heat) =>
      withTower(state, id, (tower) => ({
        ...tower,
        heat: clamp(heat, 0, TRIP_HEAT),
      })),
    setTowerTripped: (state, id, tripped) =>
      withTower(state, id, (tower) => ({ ...tower, tripped })),
    setTowerTripTimer: (state, id, seconds) =>
      withTower(state, id, (tower) => ({ ...tower, tripTimer: seconds })),
    setTowerLevel: (state, id, level) =>
      withTower(state, id, (tower) => ({
        ...tower,
        level: clamp(Math.round(level), 1, MAX_LEVEL),
      })),
    setTowerFresh: (state, id, fresh) =>
      withTower(state, id, (tower) => ({ ...tower, fresh })),
    setTowerFiring: (state, id, enabled) =>
      withTower(state, id, (tower) => ({ ...tower, firingEnabled: enabled })),
    setTowerThermal: (state, id, enabled) =>
      withTower(state, id, (tower) => ({ ...tower, thermalEnabled: enabled })),

    setArmed: (state, type) => armType(held(state), type),
    setPreview: (state, col, row) => movePreview(held(state), col, row),
    setPreviewRotation: (state, rotation) =>
      setHeldRotation(held(state), rotation),
    place: (state) => placeHeld(held(state)).state,
    setSelected: (state, id) => ({ ...held(state), selected: id }),
    setHoverShop: (state, type) => ({ ...held(state), hoverShop: type }),
    upgradeTower: (state, id) => upgradeAt(held(state), id).state,
    sellTower: (state, id) => sellAt(held(state), id).state,

    addUnit: (state, type, vent) => {
      const base = held(state);
      const unit = newUnit(
        base.nextId,
        type,
        vent,
        hpScaleOf(base.mode, base.wave),
        routesOf(base.towers),
      );
      return {
        ...base,
        surge: [...base.surge, unit],
        nextId: base.nextId + 1,
      };
    },
    removeUnit: (state, id) => {
      const base = held(state);
      return { ...base, surge: base.surge.filter((unit) => unit.id !== id) };
    },
    clearSurge: (state) => ({ ...held(state), surge: [] }),
    setUnitPosition: (state, id, x, y) =>
      withUnit(state, id, (unit) => ({ ...unit, x, y })),
    setUnitHp: (state, id, hp) =>
      withUnit(state, id, (unit) => ({ ...unit, hp })),
    setUnitMaxHp: (state, id, maxHp) =>
      withUnit(state, id, (unit) => ({ ...unit, maxHp })),
    setUnitSlow: (state, id, factor) =>
      withUnit(state, id, (unit) => ({ ...unit, slowFactor: factor })),
    setUnitSlowTimer: (state, id, seconds) =>
      withUnit(state, id, (unit) => ({ ...unit, slowTimer: seconds })),
    setUnitMotion: (state, id, enabled) =>
      withUnit(state, id, (unit) => ({ ...unit, motion: enabled })),

    pointerDown: (state, x, y) => resolveDown(held(state), x, y).state,
    pointerMove: (state, x, y) => resolveMove(held(state), x, y).state,
    pointerUp: (state) => resolveUp(held(state)).state,
  };
}
