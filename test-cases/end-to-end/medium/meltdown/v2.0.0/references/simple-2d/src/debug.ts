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
//
// EVERY OPERATION ACTS, AND NONE OF THEM DECLINES QUIETLY. A pose reaches the
// value it names whatever the game's own rules would have allowed a player to
// reach, so nothing below clamps a posed value onto a legal neighbour or hands
// back the state it was given and calls that an answer. An act carries out its
// own transaction FROM WHEREVER THE GAME STANDS: the screen, the phase, the open
// panel, the selection and the pointer are how a PLAYER reaches the control and
// are not its conditions. What an act keeps is its own arithmetic — the price,
// the purse, the cap at `MAX_LEVEL`, the placement check — because that is the
// transaction rather than a gate on reaching it, and it is what the review items
// read.
//
// AND WHERE THE GAME HAS NO DEFINED STATE TO REACH, THE CALL THROWS: an id no
// live tower or unit carries, a name outside its set, a level or rotation
// outside the fixed range, an emitter operation aimed at a mover that carries no
// heat, a preview operation with nothing armed (specs/instrumentation.md).

import {
  DEFAULT_SEED,
  DIFFICULTIES,
  MAX_LEVEL,
  MELTDOWN_DEBUG_VERSION,
  MODES,
  SURGE_TYPES,
  TOWER_TYPES,
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
import { isEmitter } from "./geometry";
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

/** The debug and automation surface, in this engine's spelling. */
export interface MeltdownDebugApi {
  readonly version: number;

  /** `seed` seeds all of the game's randomness, defaulting to `DEFAULT_SEED`. */
  reset(state: DeepReadonly<MeltdownState>, seed?: number): MeltdownState;
  snapshot(state: DeepReadonly<MeltdownState>): MeltdownSnapshot;
  /**
   * Bring every value the snapshot reports into agreement with the floor as it
   * now stands, without advancing anything. Written in the shape of a pose: it
   * takes the current state, leaves it as it was, and returns the next one.
   */
  reconcile(state: DeepReadonly<MeltdownState>): MeltdownState;

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

/* -------------------------------------------------------------------------- */
/* The loud half of the contract                                              */
/* -------------------------------------------------------------------------- */
//
// An operation never returns the state it was handed unchanged. Where there is a
// defined state the call reaches, it reaches it; where there is not, it throws,
// and the helpers below are how it throws.

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

/** The tower an operation names. An id no tower carries fails loudly. */
function requireTower(
  op: string,
  state: DeepReadonly<MeltdownState>,
  id: number,
): void {
  if (!state.towers.some((tower) => tower.id === id)) {
    reject(op, `no tower carries id ${String(id)}`);
  }
}

/** The unit an operation names. An id no unit carries fails loudly. */
function requireUnit(
  op: string,
  state: DeepReadonly<MeltdownState>,
  id: number,
): void {
  if (!state.surge.some((unit) => unit.id === id)) {
    reject(op, `no unit carries id ${String(id)}`);
  }
}

/** The held preview an operation needs. Nothing armed fails loudly. */
function requireHeld(op: string, state: DeepReadonly<MeltdownState>): void {
  if (state.build === null) {
    reject(op, "nothing is armed, so there is no preview to act on");
  }
}

/** Build the surface `initialize` returns beside the state. */
export function createDebugApi(): MeltdownDebugApi {
  return {
    version: MELTDOWN_DEBUG_VERSION,

    reset: (state, seed) => resetState(held(state), seed ?? DEFAULT_SEED),
    snapshot: (state) => snapshotOf(held(state)),

    /**
     * Bring every reported reading into agreement with the floor as it stands.
     *
     * Every derived reading this build reports — a unit's `col`, `row`,
     * `remaining`, `speed` and `slowed`; a tower's `size`, `redline`,
     * `heatMult`, `damage`, `slowFactor`, `output`, `refund` and `upgradeCost`;
     * the mode's figures; `waveRemaining`, `nextWave`, both `paths` lengths,
     * `menu`, `controls` and `build.valid` — is worked out at the read in
     * `snapshotOf`, so nothing is held that a pose can leave behind and there is
     * nothing here to rewrite. The operation is required of every build,
     * including one that keeps those readings as stored copies, and this is what
     * it comes to in a build that does not: the state handed back equals the
     * state handed in.
     *
     * It advances nothing and fires nothing either way: no clock moves, no
     * system runs, no cue is raised, and a caller may make the call as often as
     * it likes.
     */
    reconcile: (state) => held(state),

    setScreen: (state, screen) => ({
      ...held(state),
      screen: requireOneOf("setScreen", "screen", screen, SCREENS),
    }),
    setPhase: (state, phase) => ({
      ...held(state),
      phase: requireOneOf("setPhase", "phase", phase, PHASES),
    }),
    setMenuIndex: (state, n) => ({
      ...held(state),
      menuIndex: requireNumber("setMenuIndex", "n", n),
    }),
    setMode: (state, mode) => ({
      ...held(state),
      mode: requireOneOf("setMode", "mode", mode, MODES),
    }),
    setDifficulty: (state, difficulty) => ({
      ...held(state),
      difficulty: requireOneOf(
        "setDifficulty",
        "difficulty",
        difficulty,
        DIFFICULTIES,
      ),
    }),
    setMoney: (state, amount) => ({
      ...held(state),
      money: requireNumber("setMoney", "amount", amount),
    }),
    setLives: (state, count) => ({
      ...held(state),
      lives: requireNumber("setLives", "count", count),
    }),
    setScore: (state, n) => ({
      ...held(state),
      score: requireNumber("setScore", "n", n),
    }),
    setWave: (state, n) => ({
      ...held(state),
      wave: requireNumber("setWave", "n", n),
    }),
    setBuildTimer: (state, seconds) => ({
      ...held(state),
      buildTimer: requireNumber("setBuildTimer", "seconds", seconds),
    }),
    setWavePending: (state, n) => ({
      ...held(state),
      wavePending: requireNumber("setWavePending", "n", n),
    }),
    // The toggle has two settings and the specs fix both, so it is a domain: a
    // third value names no speed and fails loudly.
    setSpeed: (state, speed) => ({
      ...held(state),
      speed: requireOneOf("setSpeed", "speed", speed, [1, 2]),
    }),

    setWaveSpawning: (state, enabled) => ({
      ...held(state),
      waveSpawning: enabled,
    }),

    addTower: (state, type, col, row, rotation = 0) => {
      requireOneOf("addTower", "type", type, TOWER_TYPES);
      requireNumber("addTower", "col", col);
      requireNumber("addTower", "row", row);
      requireWhole("addTower", "rotation", rotation, 0, 3);
      return addTowerAt(held(state), type, col, row, rotation);
    },
    removeTower: (state, id) => {
      requireTower("removeTower", state, id);
      return removeTowerById(held(state), id);
    },
    clearTowers: (state) => clearAllTowers(held(state)),
    /**
     * The emitter's heat, on the scale the specs fix.
     *
     * The Forge and the Sink carry no heat of their own and report `0` for it
     * forever (specs/heat.md), so a mover has no heat for this to reach: the
     * call names nothing and fails loudly rather than passing quietly.
     */
    setTowerHeat: (state, id, heat) => {
      requireTower("setTowerHeat", state, id);
      requireRange("setTowerHeat", "heat", heat, 0, TRIP_HEAT);
      return withTower(state, id, (tower) => {
        if (!isEmitter(tower.type)) {
          reject(
            "setTowerHeat",
            `tower ${String(id)} is a ${tower.type}, which carries no heat of its own`,
          );
        }
        return { ...tower, heat };
      });
    },
    setTowerTripped: (state, id, tripped) => {
      requireTower("setTowerTripped", state, id);
      return withTower(state, id, (tower) => ({ ...tower, tripped }));
    },
    setTowerTripTimer: (state, id, seconds) => {
      requireTower("setTowerTripTimer", state, id);
      requireNumber("setTowerTripTimer", "seconds", seconds);
      return withTower(state, id, (tower) => ({
        ...tower,
        tripTimer: seconds,
      }));
    },
    // `1` through `MAX_LEVEL` is a range the specs fix as a constant, so a level
    // outside it names no level of this game and fails loudly.
    setTowerLevel: (state, id, level) => {
      requireTower("setTowerLevel", state, id);
      const held_ = requireWhole("setTowerLevel", "level", level, 1, MAX_LEVEL);
      return withTower(state, id, (tower) => ({ ...tower, level: held_ }));
    },
    setTowerFresh: (state, id, fresh) => {
      requireTower("setTowerFresh", state, id);
      return withTower(state, id, (tower) => ({ ...tower, fresh }));
    },
    setTowerFiring: (state, id, enabled) => {
      requireTower("setTowerFiring", state, id);
      return withTower(state, id, (tower) => ({
        ...tower,
        firingEnabled: enabled,
      }));
    },
    setTowerThermal: (state, id, enabled) => {
      requireTower("setTowerThermal", state, id);
      return withTower(state, id, (tower) => ({
        ...tower,
        thermalEnabled: enabled,
      }));
    },

    setArmed: (state, type) => {
      if (type !== null) requireOneOf("setArmed", "type", type, TOWER_TYPES);
      return armType(held(state), type);
    },
    /**
     * Move the held preview to the tile the call names, exactly there.
     *
     * A footprint hanging off the grid is one the real placement check answers
     * `false` for, so `build.valid` reports that rather than the anchor being
     * nudged back on. With nothing armed there is no preview to move.
     */
    setPreview: (state, col, row) => {
      requireHeld("setPreview", state);
      requireNumber("setPreview", "col", col);
      requireNumber("setPreview", "row", row);
      return movePreview(held(state), col, row);
    },
    setPreviewRotation: (state, rotation) => {
      requireHeld("setPreviewRotation", state);
      requireWhole("setPreviewRotation", "rotation", rotation, 0, 3);
      return setHeldRotation(held(state), rotation);
    },
    /**
     * Commit the held preview, from wherever the game stands.
     *
     * The screen, the phase and the panel are how a player reaches the floor and
     * are not this call's conditions. The placement check is: an invalid
     * footprint builds nothing and spends nothing, which is the check's own
     * answer. With nothing armed there is no preview to commit.
     */
    place: (state) => {
      requireHeld("place", state);
      return placeHeld(held(state)).state;
    },
    setSelected: (state, id) => {
      if (id !== null) requireTower("setSelected", state, id);
      return { ...held(state), selected: id };
    },
    setHoverShop: (state, type) => {
      if (type !== null)
        requireOneOf("setHoverShop", "type", type, TOWER_TYPES);
      return { ...held(state), hoverShop: type };
    },
    /**
     * One level up, paid for, through the real upgrade code. The purse and the
     * cap at `MAX_LEVEL` stay: they are the transaction's own arithmetic and are
     * what the economy items read.
     */
    upgradeTower: (state, id) => {
      requireTower("upgradeTower", state, id);
      return upgradeAt(held(state), id).state;
    },
    sellTower: (state, id) => {
      requireTower("sellTower", state, id);
      return sellAt(held(state), id).state;
    },

    addUnit: (state, type, vent) => {
      requireOneOf("addUnit", "type", type, SURGE_TYPES);
      requireOneOf("addUnit", "vent", vent, VENTS);
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
      requireUnit("removeUnit", state, id);
      const base = held(state);
      return { ...base, surge: base.surge.filter((unit) => unit.id !== id) };
    },
    clearSurge: (state) => ({ ...held(state), surge: [] }),
    setUnitPosition: (state, id, x, y) => {
      requireUnit("setUnitPosition", state, id);
      requireNumber("setUnitPosition", "x", x);
      requireNumber("setUnitPosition", "y", y);
      return withUnit(state, id, (unit) => ({ ...unit, x, y }));
    },
    setUnitHp: (state, id, hp) => {
      requireUnit("setUnitHp", state, id);
      requireNumber("setUnitHp", "hp", hp);
      return withUnit(state, id, (unit) => ({ ...unit, hp }));
    },
    setUnitMaxHp: (state, id, maxHp) => {
      requireUnit("setUnitMaxHp", state, id);
      requireNumber("setUnitMaxHp", "maxHp", maxHp);
      return withUnit(state, id, (unit) => ({ ...unit, maxHp }));
    },
    setUnitSlow: (state, id, factor) => {
      requireUnit("setUnitSlow", state, id);
      requireNumber("setUnitSlow", "factor", factor);
      return withUnit(state, id, (unit) => ({ ...unit, slowFactor: factor }));
    },
    setUnitSlowTimer: (state, id, seconds) => {
      requireUnit("setUnitSlowTimer", state, id);
      requireNumber("setUnitSlowTimer", "seconds", seconds);
      return withUnit(state, id, (unit) => ({ ...unit, slowTimer: seconds }));
    },
    setUnitMotion: (state, id, enabled) => {
      requireUnit("setUnitMotion", state, id);
      return withUnit(state, id, (unit) => ({ ...unit, motion: enabled }));
    },

    pointerDown: (state, x, y) => resolveDown(held(state), x, y).state,
    pointerMove: (state, x, y) => resolveMove(held(state), x, y).state,
    pointerUp: (state) => resolveUp(held(state)).state,
  };
}
