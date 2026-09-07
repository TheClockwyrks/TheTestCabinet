// Floe — the debug surface as the CASE specifies it. CASE-PROVIDED.
//
// specs/instrumentation.md fixes the surface a build's `initialize` returns beside
// its state, as `[state, debug]`, and this module is that specification written
// down as types: the operations, their arguments, the snapshot shape, and the
// version. It is the ONLY description of the surface the validators read. The
// build implements the surface under whatever module it likes and declares its own
// type for it — `FloeDebugApi`, exported from `src/game.ts` — and nothing here
// imports that type; the harness reaches the object itself through `engine.debug`
// alone. So a build whose surface departs from the specification is held against
// the specification, not against its own idea of what it wrote.
//
// HOW THE SURFACE IS DRIVEN. The engine holds the state by value and hands it out
// read-only, so the surface holds no state of its own and nothing on it mutates
// anything. Every operation is written in the shape of the game's `update`: a POSE
// takes the current state and returns the next one (`setLives(state, 1)`,
// `addBear(state, 20, 19)`), and a READING takes the current state and returns
// what it read (`snapshot(state)`). A caller drives a pose through
// `engine.apply((s) => debug.setLives(s, 1))` — the engine stores what the pose
// returned, and the next frame's `update` receives it — and a reading through
// `debug.snapshot(engine.state)`. `version` is a plain number.
//
// The surface is generic over the build's state type, because this module imports
// nothing of the build: `harness.ts` binds it to the `FloeState` the build
// declared, and the `Driver` there is what gives the checks the imperative reading
// (`h.debug.setLives(1)`, `h.debug.snapshot()`) over the pure shape declared here.
//
// THERE IS NO CLOCK OPERATION, NO KEY OPERATION, NO OVERLAY OPERATION AND NO
// `setMuted`. Under an engine all four belong to the engine beneath the game: a
// check steps exact frames with `engine.advance` over the harness's
// `ConstantClock`, drives a real key edge at the target the engine listens on,
// toggles the engine's own overlay, and reaches mute through the `mute` action
// specs/controls.md binds. `snapshot().muted` reports the result
// (specs/instrumentation.md). `setAutoStep` and `advance` exist on the `none`
// spelling of this surface alone, and are deliberately absent here.
//
// Floe has ONE variant, `base`, so every member below is required: nothing here is
// optional, and a build missing any of it fails the checks that reach the game
// through it.

import type { DeepReadonly } from "ts-essentials";

/** The surface's version, reported as `version` (`FLOE_DEBUG_VERSION`). */
export const FLOE_DEBUG_VERSION = 1;

/** The six screens the game moves between. */
export type Screen =
  | "title"
  | "howto"
  | "playing"
  | "paused"
  | "victory"
  | "gameover";

/** The three sub-phases of the `playing` screen. */
export type Phase = "crossing" | "dying" | "clearing";

/** The four directions a body faces, and the four a hop and a step take. */
export type Facing = "up" | "down" | "left" | "right";

/** What the critter is standing on (specs/strait.md). Derived, never posed. */
export type Footing = "solid" | "floe" | "water";

/** A lane's direction: `1` rightward, `-1` leftward. */
export type LaneDir = 1 | -1;

/** The three vehicles of the ice band (specs/ice.md). */
export type VehicleKind = "plow" | "dogsled" | "car";

/** The three floes of the water band (specs/water.md). */
export type FloeKind = "pan" | "raft3" | "raft4";

/** A tile of the strait, in the grid coordinates specs/strait.md defines. */
export interface Tile {
  col: number;
  row: number;
}

/** The critter. `x` and `y` are its CENTER, in stage units. */
export interface CritterSnapshot {
  /** `false` while the critter is out of play. */
  present: boolean;
  col: number;
  row: number;
  x: number;
  y: number;
  facing: Facing;
  footing: Footing;
  /** Seconds until it may hop again. */
  hopCooldown: number;
  /** The topmost row reached this crossing. */
  bestRow: number;
}

/** One bear on the strait. `x` and `y` are its CENTER, in stage units. */
export interface BearSnapshot {
  id: number;
  /** The tile it last settled on. */
  col: number;
  row: number;
  /** The tile it is travelling into; equal to `col`/`row` when it is settled. */
  stepCol: number;
  stepRow: number;
  x: number;
  y: number;
  facing: Facing;
  /** Derived: the tile it is travelling into is water no floe covers. */
  swimming: boolean;
  /** The tile it is hunting. */
  target: Tile;
  /** Its reading of the critter's tile is running. */
  sense: boolean;
  /** Its choice of the next step is running. */
  routing: boolean;
  /** Its locomotion is running. */
  travel: boolean;
}

/** One lane's motion, which is a per-row property rather than a per-item one. */
export interface LaneSnapshot {
  row: number;
  dir: LaneDir;
  /** Tiles per second. `0` holds the lane where it stands. */
  speed: number;
}

/** One vehicle on the ice band. `x` is its LEFT EDGE, in stage units. */
export interface VehicleSnapshot {
  id: number;
  row: number;
  kind: VehicleKind;
  x: number;
  /** Its length in tiles: it covers `[x, x + 32 * len)`. */
  len: number;
}

/**
 * One floe on the water band, named `FloeItemSnapshot` rather than
 * `FloeSnapshot` because the whole document below is what a check calls a Floe
 * snapshot. `x` is its LEFT EDGE.
 */
export interface FloeItemSnapshot {
  id: number;
  row: number;
  kind: FloeKind;
  x: number;
  len: number;
}

/** The plain, JSON-serializable view `snapshot()` returns. */
export interface FloeSnapshot {
  version: number;
  screen: Screen;
  phase: Phase;
  /** Seconds left in the current hold, `0` outside one. */
  phaseTimer: number;
  /** The highlighted item of the current screen's menu, from `0`. */
  menuIndex: number;
  /** `1` to `TOTAL_LEVELS` (`8`). */
  level: number;
  /** The level the game-over screen reports. */
  reachedLevel: number;
  /** Counting the critter currently crossing. */
  lives: number;
  score: number;
  /** Seconds left on the crossing timer. */
  timer: number;
  /** `crossingTimer(level)`, derived. */
  timerMax: number;
  /** The runtime's mute bit, as the game read it. No operation sets it. */
  muted: boolean;
  /** The run's own emergence of bears is running. */
  bearEmergence: boolean;
  /** A bear reaching the critter costs a life. */
  catchTest: boolean;
  /** The bonus catch's own cadence is running. */
  fishCadence: boolean;
  /** The crossing timer is draining. */
  timerRunning: boolean;
  /** The five bays, `true` where filled, left to right. */
  bays: boolean[];
  /** The bay holding the bonus catch, or `null`. */
  fishBay: number | null;
  critter: CritterSnapshot;
  /** Every bear on the strait, in roster order. */
  bears: BearSnapshot[];
  /** The eight ice lanes, rows 11..18 ascending. */
  iceLanes: LaneSnapshot[];
  /** The eight water lanes, rows 2..9 ascending. */
  waterLanes: LaneSnapshot[];
  /** Every vehicle on the ice band, in roster order. */
  vehicles: VehicleSnapshot[];
  /** Every floe on the water band, in roster order. */
  floes: FloeItemSnapshot[];
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
 * Every operation sets ONE field, reads the state, or adds or removes ONE entity,
 * and takes scalars. There is no operation that takes a layout and none that
 * arranges several things at once: `startCrossing`, `poseLane`, `poseBear` and
 * `crossTo` are helpers in `harness.ts` built out of these, not operations a
 * build implements.
 *
 * `setLevel` is the one pose with a derived consequence, and the consequence is
 * the specification's own: a level IS its lane speeds and gaps, so setting it
 * lays the two rosters out.
 */
/**
 * One menu item's hit region, in logical units: `x`/`y` are its top-left corner
 * and `w`/`h` its size (specs/instrumentation.md).
 *
 * NOT part of the snapshot, and deliberately so: the regions are geometry the
 * build laid out rather than run state, and `menuItemRect` is the separate read
 * that reports them.
 */
export interface MenuRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FloeDebugApi<S = unknown> {
  version: number;

  // ---- The core ----------------------------------------------------------

  /** Restore every declared field to its title-screen value. `muted` is left. */
  reset(state: DeepReadonly<S>): S;
  /** A pure read of the state. It changes nothing. */
  snapshot(state: DeepReadonly<S>): FloeSnapshot;
  /**
   * A pure read of the hit region of item `index` on the menu the state's screen
   * shows, or `null` where that screen shows no menu and where `index` names no
   * entry of the one it does.
   */
  menuItemRect(state: DeepReadonly<S>, index: number): MenuRect | null;

  // ---- The screen and the run --------------------------------------------

  setScreen(state: DeepReadonly<S>, screen: Screen): S;
  setPhase(state: DeepReadonly<S>, phase: Phase): S;
  setPhaseTimer(state: DeepReadonly<S>, seconds: number): S;
  setMenuIndex(state: DeepReadonly<S>, n: number): S;
  /** Sets the score. It grants no bonus life: this is a precondition. */
  setScore(state: DeepReadonly<S>, n: number): S;
  /** Sets the lives. It ends no run: the next death does. */
  setLives(state: DeepReadonly<S>, n: number): S;
  /** Sets the level, `1..8`, AND lays the sixteen lanes out for it. */
  setLevel(state: DeepReadonly<S>, n: number): S;
  setReachedLevel(state: DeepReadonly<S>, n: number): S;
  /** Sets the crossing timer. It kills nothing: the next tick does. */
  setTimer(state: DeepReadonly<S>, seconds: number): S;

  // ---- The world gates ---------------------------------------------------

  /** Gates the run's own emergence of bears, and nothing else. */
  setBearEmergence(state: DeepReadonly<S>, enabled: boolean): S;
  /** Gates whether a bear reaching the critter costs a life, and nothing else. */
  setCatchTest(state: DeepReadonly<S>, enabled: boolean): S;
  /** Gates the bonus catch's own cadence, and nothing else. */
  setFishCadence(state: DeepReadonly<S>, enabled: boolean): S;
  /** Gates the crossing timer's drain, and nothing else. */
  setTimerRunning(state: DeepReadonly<S>, enabled: boolean): S;

  // ---- The critter -------------------------------------------------------

  /** Puts a critter on `(col, row)`, present, facing up, cooldown 0, bestRow row. */
  addCritter(state: DeepReadonly<S>, col: number, row: number): S;
  removeCritter(state: DeepReadonly<S>): S;
  /** Moves the critter to a tile. Facing, cooldown and `bestRow` are untouched. */
  setCritterTile(state: DeepReadonly<S>, col: number, row: number): S;
  /** The mid-drift pose: the CENTER `x` alone, the row as it stands. */
  setCritterX(state: DeepReadonly<S>, x: number): S;
  setCritterFacing(state: DeepReadonly<S>, dir: Facing): S;
  setHopCooldown(state: DeepReadonly<S>, seconds: number): S;
  setBestRow(state: DeepReadonly<S>, r: number): S;

  // ---- The bears ---------------------------------------------------------

  /** Adds one settled bear on `(col, row)`, faculties on, appended, fresh id. */
  addBear(state: DeepReadonly<S>, col: number, row: number): S;
  removeBear(state: DeepReadonly<S>, id: number): S;
  clearBears(state: DeepReadonly<S>): S;
  /** Settles the bear on a tile: no longer between two. */
  setBearTile(state: DeepReadonly<S>, id: number, col: number, row: number): S;
  /** The mid-glide pose: the CENTER, the two tiles it occupies left as they are. */
  setBearPosition(state: DeepReadonly<S>, id: number, x: number, y: number): S;
  /** Commits the bear to one tile of travel. It consults no route. */
  setBearStep(state: DeepReadonly<S>, id: number, direction: Facing): S;
  setBearTarget(
    state: DeepReadonly<S>,
    id: number,
    col: number,
    row: number,
  ): S;
  setBearSense(state: DeepReadonly<S>, id: number, enabled: boolean): S;
  setBearRouting(state: DeepReadonly<S>, id: number, enabled: boolean): S;
  setBearTravel(state: DeepReadonly<S>, id: number, enabled: boolean): S;

  // ---- The lanes ---------------------------------------------------------

  /** Adds one vehicle, its LEFT EDGE at `x`, appended, fresh id. */
  addVehicle(
    state: DeepReadonly<S>,
    row: number,
    kind: VehicleKind,
    x: number,
  ): S;
  removeVehicle(state: DeepReadonly<S>, id: number): S;
  clearVehicles(state: DeepReadonly<S>): S;
  setVehicleX(state: DeepReadonly<S>, id: number, x: number): S;
  /** Adds one floe, its LEFT EDGE at `x`, appended, fresh id. */
  addFloe(state: DeepReadonly<S>, row: number, kind: FloeKind, x: number): S;
  removeFloe(state: DeepReadonly<S>, id: number): S;
  clearFloes(state: DeepReadonly<S>): S;
  setFloeX(state: DeepReadonly<S>, id: number, x: number): S;
  /** Sets a lane's speed in tiles per second. It repopulates nothing. */
  setLaneSpeed(state: DeepReadonly<S>, row: number, speed: number): S;
  /** Sets a lane's direction. It repopulates nothing. */
  setLaneDirection(state: DeepReadonly<S>, row: number, dir: number): S;
  /**
   * Relays a lane at phase `x`: the lane's own kind at the level's spacing, one
   * left edge at `x`, fresh ids. Its speed and direction are untouched.
   */
  setLanePhase(state: DeepReadonly<S>, row: number, x: number): S;

  // ---- The bays and the bonus catch --------------------------------------

  /** Sets whether bay `index` (`0..4`) is filled. It scores nothing. */
  setBay(state: DeepReadonly<S>, index: number, filled: boolean): S;
  /** Opens all five bays. It scores nothing and clears nothing. */
  clearBays(state: DeepReadonly<S>): S;
  /** Puts the bonus catch in bay `index`; its linger clock starts at the call. */
  setFishBay(state: DeepReadonly<S>, index: number): S;
  /** Takes the bonus catch off, leaving the bays as they are. */
  clearFish(state: DeepReadonly<S>): S;
}

/**
 * The operations that READ the state rather than replace it.
 *
 * A driver over the surface needs to know which members to call with the current
 * state and hand back, and which to run through `engine.apply`; the surface's
 * shape alone cannot say at runtime, so the specification names them.
 */
export const READINGS = ["snapshot", "menuItemRect"] as const;

/**
 * Every operation the surface must carry, in the order
 * specs/instrumentation.md lists them.
 *
 * `instrumentation/surface-present` reads this table: a build missing any one of
 * these is missing a deliverable the case requires, and the point names it.
 *
 * `setAutoStep` and `advance` are NOT here. They are the `none` spelling's clock
 * operations; under an engine the clock is the engine's and the surface carries
 * none (specs/instrumentation.md).
 */
export const REQUIRED_OPS = [
  "reset",
  "snapshot",
  "menuItemRect",

  "setScreen",
  "setPhase",
  "setPhaseTimer",
  "setMenuIndex",
  "setScore",
  "setLives",
  "setLevel",
  "setReachedLevel",
  "setTimer",

  "setBearEmergence",
  "setCatchTest",
  "setFishCadence",
  "setTimerRunning",

  "addCritter",
  "removeCritter",
  "setCritterTile",
  "setCritterX",
  "setCritterFacing",
  "setHopCooldown",
  "setBestRow",

  "addBear",
  "removeBear",
  "clearBears",
  "setBearTile",
  "setBearPosition",
  "setBearStep",
  "setBearTarget",
  "setBearSense",
  "setBearRouting",
  "setBearTravel",

  "addVehicle",
  "removeVehicle",
  "clearVehicles",
  "setVehicleX",
  "addFloe",
  "removeFloe",
  "clearFloes",
  "setFloeX",
  "setLaneSpeed",
  "setLaneDirection",
  "setLanePhase",

  "setBay",
  "clearBays",
  "setFishBay",
  "clearFish",
] as const;
