// Floe — the debug surface as the CASE specifies it. CASE-PROVIDED.
//
// specs/instrumentation.md fixes the surface the game instance's `initialize`
// returns, and this module is that specification written down as types: the
// operations, their arguments, the snapshot shape, and the version. It is the
// ONLY description of the surface the validators read. The build implements the
// surface under whatever module it likes and declares its own type for it — the
// `D` of its `GameDefinition<D>`; nothing here imports it, and the harness
// reaches the object itself through `engine.debug` alone. So a build whose
// surface departs from the specification is held against the specification, not
// against its own idea of what it wrote.
//
// HOW THE SURFACE IS DRIVEN. Each operation acts on the running game at the
// moment of the call, through the same systems play uses: a POSE takes only the
// arguments its row names, returns nothing, and arranges the live strait
// (`addBear(c, r)`, `setLaneSpeed(row, 0)`), and a READING takes no arguments
// and returns plain data read off the game at the instant of the call
// (`snapshot()`). A caller therefore drives both directly —
// `engine.debug.setLives(1)`, `engine.debug.snapshot()` — with no wrapper in
// between. `version` is a plain number.
//
// The clock, the keyboard, the audio bus, and the overlay belong to the engine
// under this engine, so the surface carries no operation for any of them:
// `setAutoStep` and `advance` exist under the engineless build alone, and
// demanding either here would fail a perfectly conformant build. There is no
// `setMuted` under any engine — `muted` is the engine's own bit, reached through
// the `mute` action and reported by the snapshot, and under THIS engine it is a
// live read of `world.audio.muted()` at the call rather than a field of the
// state.

/** The surface's version, reported as `version`. */
export const FLOE_DEBUG_VERSION = 1;

/** The seed `reset()` restores when the caller names none. */
export const DEFAULT_SEED = 1;

/** The six screens the game moves between. */
export type Screen =
  "title" | "howto" | "playing" | "paused" | "victory" | "gameover";

/** The three sub-phases of the `playing` screen. */
export type Phase = "crossing" | "dying" | "clearing";

/** The four grid directions a body faces and hops or steps in. */
export type Facing = "up" | "down" | "left" | "right";

/** What the critter is standing on, as specs/strait.md fixes it. */
export type Footing = "solid" | "floe" | "water";

/** A lane's direction: `1` rightward, `-1` leftward. */
export type LaneDir = 1 | -1;

/** The three vehicles of the ice band. */
export type VehicleKind = "plow" | "dogsled" | "car";

/** The three floes of the water band. */
export type FloeKind = "pan" | "raft3" | "raft4";

/** Either band's item kind, for a helper that takes one of each. */
export type ItemKind = VehicleKind | FloeKind;

/** One tile address, `col` and `row` zero-indexed from the strait's top-left. */
export interface Tile {
  col: number;
  row: number;
}

/**
 * The critter. `x` and `y` are its CENTER in stage units, and `col`/`row` are
 * derived from that center through `colAt`/`rowAt`.
 */
export interface CritterSnapshot {
  /** `false` while the critter is out of play, through the death pause. */
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

/**
 * One bear. `col`/`row` is the tile it last settled on and `stepCol`/`stepRow`
 * the tile it is travelling into; a settled bear reports the two equal, and a
 * bear between tiles occupies both. `x` and `y` are its CENTER.
 */
export interface BearSnapshot {
  id: number;
  col: number;
  row: number;
  stepCol: number;
  stepRow: number;
  x: number;
  y: number;
  facing: Facing;
  /** It is over open water: derived from the tile it is travelling into. */
  swimming: boolean;
  /** The tile it is hunting. */
  target: Tile;
  sense: boolean;
  routing: boolean;
  travel: boolean;
}

/** One lane's motion, by the strait row it occupies. */
export interface LaneSnapshot {
  row: number;
  dir: LaneDir;
  /** Tiles per second, at or above `0`. */
  speed: number;
}

/** One vehicle. `x` is its LEFT EDGE and it covers `[x, x + TILE * len)`. */
export interface VehicleSnapshot {
  id: number;
  row: number;
  kind: VehicleKind;
  x: number;
  /** Its length in tiles. */
  len: number;
}

/** One floe. `x` is its LEFT EDGE, read by the same covering rule. */
export interface FloeItemSnapshot {
  id: number;
  row: number;
  kind: FloeKind;
  x: number;
  len: number;
}

/**
 * The plain, JSON-serializable view `snapshot()` returns.
 *
 * Every field an operation can set is present, so every operation is verifiable
 * by setting a value and reading it back. Five entries are built at the call
 * rather than read off a field: `timerMax` from the level, the critter's `col`
 * and `row` from its center, its `footing` from its row and the floes on it, a
 * bear's `swimming` from the tile it is travelling into, and `muted` from the
 * engine's own bus.
 */
export interface FloeSnapshot {
  version: number;
  screen: Screen;
  phase: Phase;
  /** Seconds left in the current hold, `0` outside one. */
  phaseTimer: number;
  /** The highlighted item of the current menu, from `0`. */
  menuIndex: number;
  /** `1..TOTAL_LEVELS`. */
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
  /** The engine's own mute bit, read at the call. */
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
  /** Accumulated simulation time, in seconds, on every screen. */
  simTime: number;
}

/**
 * The surface the game instance's `initialize` returns, which the engine hands
 * back from `engine.debug`.
 *
 * Each pose acts on the live game at the moment of the call and returns
 * nothing; `snapshot` is a reading of that same running game, built at the call.
 * No frame has to be advanced between a pose and the reading that checks it.
 *
 * A body's `x` and `y` is its CENTER in stage units, so a caller aiming at a
 * tile passes that tile's center, `(32c + 16, 80 + 32r + 16)`. A lane item's `x`
 * is its LEFT EDGE, so a caller placing one on a column passes `32c`.
 */
export interface FloeDebugApi {
  version: number;

  // The core.
  reset(options?: { seed?: number }): void;
  snapshot(): FloeSnapshot;

  // The screen and the run.
  setScreen(screen: Screen): void;
  setPhase(phase: Phase): void;
  setPhaseTimer(seconds: number): void;
  setMenuIndex(index: number): void;
  setScore(score: number): void;
  setLives(lives: number): void;
  setLevel(level: number): void;
  setReachedLevel(level: number): void;
  setTimer(seconds: number): void;

  // The world gates.
  setBearEmergence(enabled: boolean): void;
  setCatchTest(enabled: boolean): void;
  setFishCadence(enabled: boolean): void;
  setTimerRunning(enabled: boolean): void;

  // The critter.
  addCritter(col: number, row: number): void;
  removeCritter(): void;
  setCritterTile(col: number, row: number): void;
  setCritterX(x: number): void;
  setCritterFacing(facing: Facing): void;
  setHopCooldown(seconds: number): void;
  setBestRow(row: number): void;

  // The bears.
  addBear(col: number, row: number): void;
  removeBear(id: number): void;
  clearBears(): void;
  setBearTile(id: number, col: number, row: number): void;
  setBearPosition(id: number, x: number, y: number): void;
  setBearStep(id: number, direction: Facing): void;
  setBearTarget(id: number, col: number, row: number): void;
  setBearSense(id: number, enabled: boolean): void;
  setBearRouting(id: number, enabled: boolean): void;
  setBearTravel(id: number, enabled: boolean): void;

  // The lanes.
  addVehicle(row: number, kind: VehicleKind, x: number): void;
  removeVehicle(id: number): void;
  clearVehicles(): void;
  setVehicleX(id: number, x: number): void;
  addFloe(row: number, kind: FloeKind, x: number): void;
  removeFloe(id: number): void;
  clearFloes(): void;
  setFloeX(id: number, x: number): void;
  setLaneSpeed(row: number, speed: number): void;
  setLaneDirection(row: number, dir: LaneDir): void;

  // The bays and the bonus catch.
  setBay(index: number, filled: boolean): void;
  clearBays(): void;
  setFishBay(index: number): void;
  clearFish(): void;
}

/**
 * The operations that READ the running game rather than pose it.
 *
 * The surface's shape alone cannot say at runtime which members return a value
 * and which arrange the world, so the specification names them: a check that
 * sweeps the surface (instrumentation/surface-present) calls a reading for its
 * value and a pose for its effect.
 */
export const READINGS = ["snapshot"] as const;

/**
 * Every operation the surface must carry under this engine. `setAutoStep` and
 * `advance` belong to the engineless build alone (specs/instrumentation.md):
 * the engine owns the clock here, so they are deliberately absent, and so is
 * any operation for the keyboard, the overlay, or mute.
 */
export const REQUIRED_OPS = [
  "reset",
  "snapshot",

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

  "setBay",
  "clearBays",
  "setFishBay",
  "clearFish",
] as const;
