// Meltdown — the debug surface as the CASE specifies it. CASE-PROVIDED.
//
// specs/instrumentation.md fixes the surface the game instance's `initialize`
// returns, and this module is that specification written down as types: the
// operations, their arguments, the snapshot shape, and the version. It is the
// ONLY description of the surface the validators read. The build implements the
// surface under whatever module it likes and declares its own type for it — the
// `MeltdownDebugApi` it exports from `src/game.ts`, the `D` of its
// `GameDefinition<D>`; nothing here imports it, and the harness reaches the
// object itself through `engine.debug` alone. So a build whose surface departs
// from the specification is held against the specification, not against its own
// idea of what it wrote.
//
// HOW THE SURFACE IS DRIVEN. Each operation acts on the running game at the
// moment of the call, through the same systems play uses: a POSE takes only the
// arguments its heading names, returns nothing, and arranges the live world
// (`setTowerHeat(id, 60)`, `addUnit("mote", "left")`), and a READING takes no
// arguments and returns plain data read off the world at the instant of the call
// (`snapshot()`). A caller therefore drives both directly —
// `engine.debug.setTowerHeat(id, 60)`, `engine.debug.snapshot()` — with no
// wrapper in between. `version` is a plain number.
//
// The clock, the keyboard, the audio bus, and the overlay belong to the engine
// under this engine, so the surface carries no operation for any of them:
// `setAutoStep` and `advance` exist under the engineless build alone, and
// demanding either here would fail a perfectly conformant build. `autoStep` is
// absent from the snapshot for the same reason. There is no `setMuted` under any
// engine — `muted` is the game's own copy of the runtime's bit, reached through
// the `mute` binding or the panel's mute control and reported by the snapshot.
//
// The pointer IS on the surface, under every engine, because a scripted scenario
// presses the panel and the floor the way a player does.

/** The surface's version, reported as `version`. */
export const MELTDOWN_DEBUG_VERSION = 1;

/** The seed `reset()` restores when the caller names none. */
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

/** The five modes. */
export type ModeName =
  "containment" | "hundred" | "deeppockets" | "bottleneck" | "suddendeath";

/** The three difficulties. Containment alone offers a choice of them. */
export type DifficultyName = "easy" | "medium" | "hard";

/** The eight towers, in shop order. */
export type TowerType =
  "arc" | "stutter" | "rime" | "flak" | "bloom" | "lance" | "forge" | "sink";

/** The six surge types. */
export type SurgeType = "mote" | "sprint" | "hulk" | "swarm" | "drift" | "core";

/** The two vents a unit may enter at. */
export type VentName = "left" | "top";

/** The two exhausts, each a vent's fixed opposite. */
export type ExhaustName = "right" | "bottom";

/** A tower face, in WORLD orientation wherever the snapshot reports one. */
export type Face = "N" | "E" | "S" | "W";

/** One control's hit rectangle, in logical stage units. */
export interface ControlRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One shop entry's hit rectangle, and the type it arms. */
export interface ShopControl extends ControlRect {
  type: TowerType;
}

/**
 * Every control the build panel offers, as the panel laid them out.
 *
 * This is what makes the panel drivable without the specification fixing its
 * layout: the build knows where it drew each control and reports the rectangle,
 * and a scenario taps its centre.
 */
export interface SnapshotControls {
  /** One entry per tower type, in shop order. */
  shop: ShopControl[];
  /** `null` when no placement is armed. */
  rotate: ControlRect | null;
  cancel: ControlRect | null;
  /** `null` when no tower is selected. */
  upgrade: ControlRect | null;
  sell: ControlRect | null;
  send: ControlRect;
  speed: ControlRect;
  pause: ControlRect;
  mute: ControlRect;
}

/** One tower on the floor, as a snapshot reports it. */
export interface TowerSnapshot {
  id: number;
  type: TowerType;
  /** The footprint's top-left tile. */
  col: number;
  row: number;
  /** The footprint's side, in tiles. */
  size: number;
  /** The placement rotation, `0` to `3`, fixed once placed. */
  rotation: number;
  level: number;
  /** `0` to `100`; `0` for the Forge and the Sink. */
  heat: number;
  redline: number;
  /** The live `heatMultiplier(heat, redline)`; `0` for movers only. */
  heatMult: number;
  /** The live per-shot damage; `0` for movers only. */
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
  /** The id of the unit it is firing on, or `null`. */
  targeting: number | null;
  /** WORLD-oriented, so the rotation has already been applied. Empty for movers. */
  radiatorFaces: Face[];
  kills: number;
  damageDealt: number;
  /** Everything spent on this tower, its build cost plus every upgrade. */
  spent: number;
  /** What selling it pays right now. */
  refund: number;
  /** `0` at level 3. */
  upgradeCost: number;
  /** Whether it still refunds in full. */
  fresh: boolean;
  firingEnabled: boolean;
  thermalEnabled: boolean;
}

/** One surge unit on the floor, as a snapshot reports it. */
export interface UnitSnapshot {
  id: number;
  type: SurgeType;
  /** The unit's CENTRE, in logical stage units. */
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

/** The held build preview, as a snapshot reports it. */
export interface BuildSnapshot {
  type: TowerType;
  /** The footprint's top-left tile. */
  col: number;
  row: number;
  rotation: number;
  /** Whether that footprint could be committed right now. */
  valid: boolean;
}

/** A mode's build zone, inclusive on both ends. */
export interface ZoneSnapshot {
  col0: number;
  row0: number;
  col1: number;
  row1: number;
}

/**
 * The plain, JSON-serializable view `snapshot()` returns.
 *
 * Every field an operation can set is present, so every operation is verifiable
 * by setting a value and reading it back. Several entries are built at the call
 * rather than read off a field: `waveCount`, `startMoney`, `startLives`,
 * `interest` and `buildZone` follow `mode` and `difficulty`; `waveRemaining`,
 * `nextWave`, `paths` and `controls` are derived from the live floor and panel;
 * and every derived tower and unit figure follows its entity's own state.
 *
 * `autoStep` is deliberately absent. The engine owns the clock here.
 */
export interface MeltdownSnapshot {
  version: number;
  screen: Screen;
  phase: Phase;
  /** The highlighted row of whatever menu the screen shows, from `0`. */
  menuIndex: number;
  mode: ModeName;
  difficulty: DifficultyName;
  money: number;
  lives: number;
  score: number;
  /** The wave this phase belongs to. */
  wave: number;
  /** DERIVED from mode and difficulty. */
  waveCount: number;
  /** DERIVED. */
  startMoney: number;
  /** DERIVED. */
  startLives: number;
  /** DERIVED: this mode pays interest. */
  interest: boolean;
  /** Seconds left in the current build phase; `0` in the opening phase. */
  buildTimer: number;
  /** Units of this wave still to release. */
  wavePending: number;
  /** DERIVED: `wavePending` plus the live units of the wave being fought. */
  waveRemaining: number;
  /** The coming wave, or `null` when there is none. */
  nextWave: { type: SurgeType; count: number } | null;
  speed: number;
  /** The game's copy of the runtime's mute bit, refreshed every update. */
  muted: boolean;
  /** The world gate. */
  waveSpawning: boolean;
  /** The pointer's own position and press state, in logical stage units. */
  pointer: { x: number; y: number; down: boolean };
  selected: number | null;
  hoverShop: TowerType | null;
  build: BuildSnapshot | null;
  /** `null` off Bottleneck. */
  buildZone: ZoneSnapshot | null;
  /** The two vent-to-exhaust routes. Never `null`: the floor cannot be sealed. */
  paths: {
    left: { length: number };
    top: { length: number };
  };
  controls: SnapshotControls;
  /** Every tower on the floor, in roster order. */
  towers: TowerSnapshot[];
  /** Every surge unit on the floor, in roster order. */
  surge: UnitSnapshot[];
  /** Accumulated simulation time, in seconds, on every screen. */
  simTime: number;
}

/**
 * The surface the game instance's `initialize` returns, which the engine hands
 * back from `engine.debug`.
 *
 * Each pose acts on the live game at the moment of the call and returns nothing;
 * `snapshot` is a reading of that same running game, built at the call. No frame
 * has to be advanced between a pose and the reading that checks it.
 *
 * Every `x` and `y` is an entity's CENTRE in the stage's logical units, so a
 * caller aiming at a tile passes that tile's centre,
 * `(18 + 19c + 9.5, 18 + 19r + 9.5)`.
 */
export interface MeltdownDebugApi {
  version: number;

  reset(options?: { seed?: number }): void;
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
 * Every operation the surface must carry under this engine, in the order
 * specs/instrumentation.md states them.
 *
 * `setAutoStep` and `advance` belong to the engineless build alone: the engine
 * owns the clock here, so they are deliberately absent and a build that omits
 * them is conformant. Naming the whole list in one constant is what lets
 * `instrumentation/surface-present` assert completeness and name a build for
 * exactly what it is missing.
 */
export const REQUIRED_OPS = [
  // The core.
  "reset",
  "snapshot",

  // The screen and the run.
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

  // The world gate.
  "setWaveSpawning",

  // The towers.
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

  // Building.
  "setArmed",
  "setPreview",
  "setPreviewRotation",
  "place",
  "setSelected",
  "setHoverShop",
  "upgradeTower",
  "sellTower",

  // The surge.
  "addUnit",
  "removeUnit",
  "clearSurge",
  "setUnitPosition",
  "setUnitHp",
  "setUnitMaxHp",
  "setUnitSlow",
  "setUnitSlowTimer",
  "setUnitMotion",

  // The pointer.
  "pointerDown",
  "pointerMove",
  "pointerUp",
] as const;
