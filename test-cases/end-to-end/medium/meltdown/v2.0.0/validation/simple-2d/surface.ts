// Meltdown — the debug surface as the CASE specifies it. CASE-PROVIDED.
//
// specs/instrumentation.md fixes the surface a build's `initialize` returns beside
// its state, as `[state, debug]`, and this module is that specification written
// down as types: the operations, their arguments, the snapshot shape, and the
// version. It is the ONLY description of the surface the validators read. The
// build implements the surface under whatever module it likes and declares its own
// type for it — `MeltdownDebugApi`, exported from `src/game.ts` — and NOTHING HERE
// IMPORTS THAT TYPE, or anything else of the build's; the harness reaches the
// object itself through `engine.debug` alone. So a build whose surface departs
// from the specification is held against the specification, not against its own
// idea of what it wrote.
//
// HOW THE SURFACE IS DRIVEN. The engine holds the state by value and hands it out
// read-only, so the surface holds no state of its own and nothing on it mutates
// anything. Every operation is written in the shape of the game's `update`: a POSE
// takes the current state and returns the next one (`setTowerHeat(state, id, 60)`,
// `addUnit(state, "mote", "left")`), and a READING takes the current state and
// returns what it read (`snapshot(state)`). A caller drives a pose through
// `engine.apply((s) => debug.setTowerHeat(s, id, 60))` — the engine stores what
// the pose returned, and the next frame's `update` receives it — and a reading
// through `debug.snapshot(engine.state)`. `version` is a plain number.
//
// The surface is generic over the build's state type, because this module imports
// nothing of the build: `harness.ts` binds it to the `MeltdownState` the build
// declared, and the `Driver` there is what gives the checks the imperative reading
// (`h.debug.setTowerHeat(id, 60)`, `h.debug.snapshot()`) over the pure shape
// declared here.
//
// THERE IS NO CLOCK OPERATION AND NO `setMuted`. Under an engine the clock is the
// engine's — a check steps exact frames with `engine.advance` over the harness's
// `ConstantClock`, and hands the clock back to the build with `h.runFor` — so the
// `setAutoStep`/`advance` pair specs/instrumentation.md gives the `none` spelling
// is absent here. The mute bit is the engine's audio bus, which a pure
// `(state, ...) => state` transform could not reach; `mute` is driven through its
// real binding or the panel's mute control and `snapshot().muted` reports the
// result.
//
// Meltdown has ONE variant, `base`, so every member below is required: nothing
// here is optional, and a build missing any of it fails the checks that reach the
// game through it.

import type { DeepReadonly } from "ts-essentials";

/** The surface's version, reported as `version` (`MELTDOWN_DEBUG_VERSION`). */
export const MELTDOWN_DEBUG_VERSION = 1;

/** The seed `reset()` restores when the caller names none (`DEFAULT_SEED`). */
export const DEFAULT_SEED = 1;

/** The eight screens the game moves between. */
export type Screen =
  | "title"
  | "modeselect"
  | "difficultyselect"
  | "howto"
  | "playing"
  | "paused"
  | "victory"
  | "gameover";

/** The three sub-phases of the `playing` screen. */
export type Phase = "opening" | "building" | "wave";

/** The eight towers: six emitters, then the two movers. */
export type TowerType =
  | "arc"
  | "stutter"
  | "rime"
  | "flak"
  | "bloom"
  | "lance"
  | "forge"
  | "sink";

/** The six surge units. */
export type SurgeType = "mote" | "sprint" | "hulk" | "swarm" | "drift" | "core";

/** The five modes. */
export type ModeName =
  | "containment"
  | "hundred"
  | "deeppockets"
  | "bottleneck"
  | "suddendeath";

/** The three difficulties. */
export type DifficultyName = "easy" | "medium" | "hard";

/** The two vents a unit enters at. */
export type VentName = "left" | "top";

/** The exhaust each vent is fixed opposite to. */
export type ExhaustName = "right" | "bottom";

/** A face of a footprint, in world orientation once rotation has turned it. */
export type Face = "N" | "E" | "S" | "W";

/** A hit rectangle the build panel reports, in logical stage units. */
export interface RectSnapshot {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One shop entry's hit rectangle, and the type pressing it arms. */
export interface ShopRectSnapshot extends RectSnapshot {
  type: TowerType;
}

/**
 * Every control the build panel offers, as the rectangle the build drew it on.
 *
 * The block that makes the panel drivable without the specification fixing its
 * layout: the build knows where it put each control and reports it, and a check
 * presses the centre of what it reported (specs/hud.md, specs/instrumentation.md).
 */
export interface ControlsSnapshot {
  /** One per shop entry, in shop order. */
  shop: ShopRectSnapshot[];
  /** `null` when no placement is armed. */
  rotate: RectSnapshot | null;
  cancel: RectSnapshot | null;
  /** `null` when no tower is selected. */
  upgrade: RectSnapshot | null;
  sell: RectSnapshot | null;
  send: RectSnapshot;
  speed: RectSnapshot;
  pause: RectSnapshot;
  mute: RectSnapshot;
}

/**
 * One row of the current screen's menu, as the build drew it.
 *
 * `index` is the row number `menuIndex` counts. `specs/screens.md` leaves the
 * layout of a menu to the build and requires every row to be a pointer target,
 * so the build reports what it drew and a scenario presses that rectangle.
 */
export interface MenuRowSnapshot extends RectSnapshot {
  index: number;
}

/** The held placement preview. */
export interface BuildSnapshot {
  type: TowerType;
  /** The footprint's top-left tile. */
  col: number;
  row: number;
  rotation: number;
  /** Whether the real placement check would accept this footprint. */
  valid: boolean;
}

/** One tower on the floor. `col` and `row` are its footprint's top-left tile. */
export interface TowerSnapshot {
  id: number;
  type: TowerType;
  col: number;
  row: number;
  /** The footprint side, in tiles. */
  size: number;
  rotation: number;
  level: number;
  /** `0` to `TRIP_HEAT` (`100`); `0` for the Forge and the Sink. */
  heat: number;
  redline: number;
  /** The live `heatMultiplier(heat, redline)`; `0` for movers. */
  heatMult: number;
  /** Per-shot damage at this heat and level; `0` for movers. */
  damage: number;
  /** A Rime's live slow fraction; `0` on every other tower. */
  slowFactor: number;
  /** A Forge's setpoint or a Sink's per-edge cooling; `0` for emitters. */
  output: number;
  tripped: boolean;
  /** Seconds left on the trip cooldown, else `0`. */
  tripTimer: number;
  /** Has a target and is online this frame; always false while tripped. */
  firing: boolean;
  /** The id of the unit it is firing on. */
  targeting: number | null;
  /** World-oriented radiator faces; empty for movers. */
  radiatorFaces: Face[];
  kills: number;
  damageDealt: number;
  /** Total money spent on this tower: its build cost plus every upgrade. */
  spent: number;
  /** What selling it pays right now. */
  refund: number;
  /** `0` at level 3. */
  upgradeCost: number;
  /** Still refunds in full. */
  fresh: boolean;
  firingEnabled: boolean;
  thermalEnabled: boolean;
}

/** One surge unit on the floor. `x` and `y` are its CENTRE. */
export interface UnitSnapshot {
  id: number;
  type: SurgeType;
  x: number;
  y: number;
  /** The tile its centre falls in. */
  col: number;
  row: number;
  hp: number;
  maxHp: number;
  /** Current speed, reflecting any live slow. */
  speed: number;
  /** Its unslowed speed. */
  baseSpeed: number;
  slowed: boolean;
  /** The fraction of speed the live slow removes. */
  slowFactor: number;
  /** Seconds the live slow has left. */
  slowTimer: number;
  flying: boolean;
  vent: VentName;
  exhaust: ExhaustName;
  /** Route length still to travel, in tiles. */
  remaining: number;
  motion: boolean;
}

/** The plain, JSON-serializable view `snapshot()` returns. */
export interface MeltdownSnapshot {
  version: number;
  screen: Screen;
  phase: Phase;
  /** The highlighted row of the current screen's menu, from `0`. */
  menuIndex: number;
  mode: ModeName;
  difficulty: DifficultyName;
  money: number;
  lives: number;
  score: number;
  /** The wave this phase belongs to. */
  wave: number;
  /** Derived from `mode` and `difficulty`. */
  waveCount: number;
  startMoney: number;
  startLives: number;
  /** Derived: this mode pays interest. */
  interest: boolean;
  /** Seconds left in the current build phase; `0` in the opening phase. */
  buildTimer: number;
  /** Units of this wave still to release. */
  wavePending: number;
  /** Derived: `wavePending` plus the live wave units. */
  waveRemaining: number;
  /** The coming wave, or `null` where there is none. */
  nextWave: { type: SurgeType; count: number } | null;
  speed: number;
  /** The game's copy of the runtime's mute bit. No operation sets it. */
  muted: boolean;
  /** The world gate: the run's own release of surge. */
  waveSpawning: boolean;
  /** The pointer's OWN position, in logical stage units, and whether pressed. */
  pointer: { x: number; y: number; down: boolean };
  selected: number | null;
  hoverShop: TowerType | null;
  build: BuildSnapshot | null;
  /** Inclusive on both ends; `null` off Bottleneck. */
  buildZone: { col0: number; row0: number; col1: number; row1: number } | null;
  /** The two vent-to-exhaust routes, in tiles. Never `null`. */
  paths: { left: { length: number }; top: { length: number } };
  /**
   * Every row of the menu the current screen shows, in row order from `0`, and
   * empty while the screen is `playing`. Refreshed at the call.
   */
  menu: MenuRowSnapshot[];
  /** Where the build panel put each control, refreshed at the call. */
  controls: ControlsSnapshot;
  /** Every tower on the floor, in roster order. */
  towers: TowerSnapshot[];
  /** Every surge unit on the floor, in roster order. */
  surge: UnitSnapshot[];
  /** Accumulated simulation time, in seconds. */
  simTime: number;
}

/**
 * The surface a build returns beside its state from `initialize`, over the
 * build's own state type `S`.
 *
 * Each pose is a transition — the current state in, the next state out — and
 * `snapshot` is a reading of the current state. None of them touches the state it
 * was handed: `DeepReadonly<S>` is the view the engine hands out, and the compiler
 * is what says a pose returns a new value rather than mutating.
 *
 * THE ATOM AND THE ACT. Most operations here are ATOMS: each sets one field, adds
 * or removes one entity, or reads the state, and takes scalars. Three are ACTS —
 * `place`, `upgradeTower`, `sellTower` — single indivisible things a player does,
 * which run through the game's own code and carry every consequence
 * specs/building.md gives them. A check that merely wants a tower gone calls
 * `removeTower`; a check about what selling does calls `sellTower`. Neither stands
 * in for the other.
 *
 * There is no operation that takes a layout and none that arranges several things
 * at once: `startRun`, `poseIdleTower` and the rest are helpers in `harness.ts`
 * built out of these, not operations a build implements.
 */
export interface MeltdownDebugApi<S = unknown> {
  version: number;

  // ---- The core ----------------------------------------------------------

  /** Restore every declared field to its title-screen value. */
  reset(state: DeepReadonly<S>, seed?: number): S;
  /** A pure read of the state. It changes nothing. */
  snapshot(state: DeepReadonly<S>): MeltdownSnapshot;

  // ---- The screen and the run --------------------------------------------

  setScreen(state: DeepReadonly<S>, screen: Screen): S;
  setPhase(state: DeepReadonly<S>, phase: Phase): S;
  setMenuIndex(state: DeepReadonly<S>, n: number): S;
  /** Sets the mode. Every derived figure follows; the live run does not. */
  setMode(state: DeepReadonly<S>, mode: ModeName): S;
  setDifficulty(state: DeepReadonly<S>, difficulty: DifficultyName): S;
  setMoney(state: DeepReadonly<S>, amount: number): S;
  /** Sets the lives. It triggers no game over: this is a precondition. */
  setLives(state: DeepReadonly<S>, count: number): S;
  /** Sets the score. It pays no bonus and grants nothing. */
  setScore(state: DeepReadonly<S>, n: number): S;
  /** Sets the wave. It rebuilds, releases and clears nothing. */
  setWave(state: DeepReadonly<S>, n: number): S;
  setBuildTimer(state: DeepReadonly<S>, seconds: number): S;
  setWavePending(state: DeepReadonly<S>, n: number): S;
  setSpeed(state: DeepReadonly<S>, speed: number): S;

  // ---- The world gate ----------------------------------------------------

  /**
   * Gates the run's OWN release of surge: the build timer's automatic start of
   * the next wave, and the spawner's release of the units `wavePending` counts.
   * Nothing else.
   */
  setWaveSpawning(state: DeepReadonly<S>, enabled: boolean): S;

  // ---- The towers --------------------------------------------------------

  /**
   * Adds one tower of `type`, footprint top-left at `(col, row)`, at `rotation`.
   * It costs nothing, spends nothing, and runs no placement check.
   */
  addTower(
    state: DeepReadonly<S>,
    type: TowerType,
    col: number,
    row: number,
    rotation: number,
  ): S;
  /** Removes that tower. It pays no refund. */
  removeTower(state: DeepReadonly<S>, id: number): S;
  /** Removes every tower. It pays no refund and leaves the surge standing. */
  clearTowers(state: DeepReadonly<S>): S;
  /** Sets the emitter's heat, `0` to `100`. It does not trip the tower. */
  setTowerHeat(state: DeepReadonly<S>, id: number, heat: number): S;
  /** Sets the tripped flag alone: neither the heat nor `tripTimer` follows. */
  setTowerTripped(state: DeepReadonly<S>, id: number, tripped: boolean): S;
  /** Sets the seconds left on the cooldown alone. */
  setTowerTripTimer(state: DeepReadonly<S>, id: number, seconds: number): S;
  /** Sets the level, `1` to `3`. It spends nothing; every stat follows. */
  setTowerLevel(state: DeepReadonly<S>, id: number, level: number): S;
  setTowerFresh(state: DeepReadonly<S>, id: number, fresh: boolean): S;
  /** The firing gate: targeting, the shot, its damage, its slow, its heat. */
  setTowerFiring(state: DeepReadonly<S>, id: number, enabled: boolean): S;
  /** The thermal gate: air, conduction, mover flow, and the trip. */
  setTowerThermal(state: DeepReadonly<S>, id: number, enabled: boolean): S;

  // ---- Building ----------------------------------------------------------

  /** Arms placement for a type, as choosing its shop entry does. */
  setArmed(state: DeepReadonly<S>, type: TowerType | null): S;
  /** Moves the held preview, clamped to keep the footprint on the grid. */
  setPreview(state: DeepReadonly<S>, col: number, row: number): S;
  setPreviewRotation(state: DeepReadonly<S>, rotation: number): S;
  /** ACT: commits the held preview if `build.valid`, as a press does. */
  place(state: DeepReadonly<S>): S;
  setSelected(state: DeepReadonly<S>, id: number | null): S;
  setHoverShop(state: DeepReadonly<S>, type: TowerType | null): S;
  /** ACT: upgrades one level through the real upgrade code. */
  upgradeTower(state: DeepReadonly<S>, id: number): S;
  /** ACT: sells through the real sell code — refund, removal, re-path. */
  sellTower(state: DeepReadonly<S>, id: number): S;

  // ---- The surge ---------------------------------------------------------

  /** Adds one unit of `type` at `vent`, into the game's own systems. */
  addUnit(state: DeepReadonly<S>, type: SurgeType, vent: VentName): S;
  /** Removes that unit. It costs no life and pays no bounty. */
  removeUnit(state: DeepReadonly<S>, id: number): S;
  /** Removes every unit, leaving the towers exactly as they stand. */
  clearSurge(state: DeepReadonly<S>): S;
  /** Places the unit's CENTRE; its route is recomputed from that tile. */
  setUnitPosition(state: DeepReadonly<S>, id: number, x: number, y: number): S;
  /** Sets the current hp. It does not kill the unit. */
  setUnitHp(state: DeepReadonly<S>, id: number, hp: number): S;
  setUnitMaxHp(state: DeepReadonly<S>, id: number, maxHp: number): S;
  /** Sets the fraction of speed the live slow removes, `0` for none. */
  setUnitSlow(state: DeepReadonly<S>, id: number, factor: number): S;
  setUnitSlowTimer(state: DeepReadonly<S>, id: number, seconds: number): S;
  /** The locomotion gate. Off, pathing still runs and `remaining` follows. */
  setUnitMotion(state: DeepReadonly<S>, id: number, enabled: boolean): S;

  // ---- The pointer -------------------------------------------------------

  /** Reports a press at that logical stage position. */
  pointerDown(state: DeepReadonly<S>, x: number, y: number): S;
  pointerMove(state: DeepReadonly<S>, x: number, y: number): S;
  /** Reports a release at the last reported position. */
  pointerUp(state: DeepReadonly<S>): S;
}

/**
 * The operations that READ the state rather than replace it.
 *
 * A driver over the surface needs to know which members to call with the current
 * state and hand back, and which to run through `engine.apply`; the surface's
 * shape alone cannot say at runtime, so the specification names them.
 */
export const READINGS = ["snapshot"] as const;

/**
 * Every operation the surface must carry, in the order
 * specs/instrumentation.md lists them.
 *
 * `instrumentation/surface-present` reads this table: a build missing any one of
 * these is missing a deliverable the case requires, and the point names it.
 */
export const REQUIRED_OPS = [
  "reset",
  "snapshot",

  "setScreen",
  "setPhase",
  "setMenuIndex",
  "setMode",
  "setDifficulty",
  "setMoney",
  "setLives",
  "setScore",
  "setWave",
  "setBuildTimer",
  "setWavePending",
  "setSpeed",

  "setWaveSpawning",

  "addTower",
  "removeTower",
  "clearTowers",
  "setTowerHeat",
  "setTowerTripped",
  "setTowerTripTimer",
  "setTowerLevel",
  "setTowerFresh",
  "setTowerFiring",
  "setTowerThermal",

  "setArmed",
  "setPreview",
  "setPreviewRotation",
  "place",
  "setSelected",
  "setHoverShop",
  "upgradeTower",
  "sellTower",

  "addUnit",
  "removeUnit",
  "clearSurge",
  "setUnitPosition",
  "setUnitHp",
  "setUnitMaxHp",
  "setUnitSlow",
  "setUnitSlowTimer",
  "setUnitMotion",

  "pointerDown",
  "pointerMove",
  "pointerUp",
] as const;
