// Wireworm — the debug surface as the CASE specifies it. CASE-PROVIDED.
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
// arguments its heading names, returns nothing, and arranges the live world
// (`setNode(c, r, charge)`, `addWorm(c, r)`), and a READING takes no arguments
// and returns plain data read off the world at the instant of the call
// (`snapshot()`). A caller therefore drives both directly —
// `engine.debug.setNode(4, 4, 3)`, `engine.debug.snapshot()` — with no wrapper
// in between. `version` is a plain number.
//
// The clock, the keyboard, the audio bus, and the overlay belong to the engine
// under this engine, so the surface carries no operation for any of them:
// `setAutoStep` and `advance` exist under the engineless build alone, and
// demanding either here would fail a perfectly conformant build. There is no
// `setMuted` under any engine — `muted` is the runtime's own bit, reached
// through the `mute` binding and reported by the snapshot.

/** The surface's version, reported as `version`. */
export const WIREWORM_DEBUG_VERSION = 1;

/** The seed `reset()` restores when the caller names none. */
export const DEFAULT_SEED = 1;

/** The six screens the game moves between. */
export type Screen =
  | "title"
  | "howto"
  | "playing"
  | "paused"
  | "victory"
  | "gameover";

/** The three sub-phases of the `playing` screen. */
export type Phase = "banner" | "active" | "respawn";

/** The three support foes. */
export type FoeKind = "glitch" | "dropper" | "corruptor";

/**
 * A menu item's hit region, in the stage's logical units, as `menuItemRect`
 * reports it: `x` and `y` the region's top-left corner, `w` and `h` its size
 * (specs/instrumentation.md).
 */
export interface MenuRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One tile address, `c` and `r` zero-indexed from the board's top-left. */
export interface Tile {
  c: number;
  r: number;
}

/** One node on the board, and the charge it holds. */
export interface NodeSnapshot {
  c: number;
  r: number;
  /** A whole number from `0` (inert) to `CHARGE_MAX` (`3`, critical). */
  charge: number;
}

/**
 * One worm on the board. `segments[0]` is the head, and the rest trail from it
 * to the tail. `stepping` and `body` are the two faculties the surface gates.
 */
export interface WormSnapshot {
  id: number;
  segments: Tile[];
  /** `+1` heading right, `-1` heading left. */
  dh: number;
  /** `+1` descending, `-1` rising. */
  dv: number;
  diving: boolean;
  stepping: boolean;
  body: boolean;
}

/**
 * One foe on the board. `x` and `y` are its CENTER in logical stage units, and
 * `vx`/`vy` are what that center is changing by right now, including any dart.
 */
export interface FoeSnapshot {
  id: number;
  kind: FoeKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** A dropper that has taken its first bolt. */
  hit: boolean;
  mind: boolean;
  travel: boolean;
}

/** One bolt in flight, its CENTER in logical stage units. */
export interface BoltSnapshot {
  id: number;
  x: number;
  y: number;
}

/** One link a live discharge is arcing along, named by the tiles it joins. */
export interface ArcSnapshot {
  from: Tile;
  to: Tile;
}

/** The cursor: its CENTER, its invulnerability, and its contact gate. */
export interface CursorSnapshot {
  x: number;
  y: number;
  /** Seconds of spawn-in invulnerability left, `0` for none. */
  invulnerable: number;
  contact: boolean;
}

/**
 * The plain, JSON-serializable view `snapshot()` returns.
 *
 * Every field an operation can set is present, so every operation is verifiable
 * by setting a value and reading it back. Three entries are built at the call
 * rather than read off a field: `wormStepInterval` and `wormLength` are derived
 * from `level` by the formulas in specs/worm.md, and `arcs` is the live arcs
 * with each one's remaining life left out.
 */
export interface WirewormSnapshot {
  version: number;
  screen: Screen;
  phase: Phase;
  /** Seconds left in the current phase. */
  phaseTimer: number;
  /** The highlighted menu item, from 0. */
  menuIndex: number;
  score: number;
  lives: number;
  /** `1..TOTAL_LEVELS`. */
  level: number;
  /** The level the end screens report. */
  reachedLevel: number;
  /** The runtime's own mute bit, refreshed at the call. */
  muted: boolean;
  /** The level's own foe spawning is running. */
  foeSpawning: boolean;
  /** The level's and the respawn's worm entry is running. */
  wormEntry: boolean;
  /** Seconds per tile step at this level. */
  wormStepInterval: number;
  /** Segments this level's worm enters with. */
  wormLength: number;
  cursor: CursorSnapshot;
  /** Seconds until the cursor may fire again. */
  fireCooldown: number;
  /** Every node on the board, ascending by row then column. */
  nodes: NodeSnapshot[];
  /** Every worm on the board, in roster order. */
  worms: WormSnapshot[];
  /** Every foe on the board, in roster order. */
  foes: FoeSnapshot[];
  /** Every bolt in flight, in roster order. */
  bolts: BoltSnapshot[];
  /** Empty except during the `ARC_LIFE` window after a detonation. */
  arcs: ArcSnapshot[];
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
 * Every `x` and `y` is an entity's CENTER in the stage's logical units, so a
 * caller aiming at a tile passes that tile's center, `(32c + 16, 80 + 32r + 16)`.
 */
export interface WirewormDebugApi {
  version: number;

  reset(options?: { seed?: number }): void;
  snapshot(): WirewormSnapshot;

  setScreen(screen: Screen): void;
  setPhase(phase: Phase): void;
  setPhaseTimer(seconds: number): void;
  setMenuIndex(index: number): void;
  setScore(score: number): void;
  setLives(lives: number): void;
  setLevel(level: number): void;
  setReachedLevel(level: number): void;
  /**
   * A pure read of the hit region of item `index` on the menu the current
   * screen shows, in logical stage units. `null` on `playing` and `howto`, which
   * show no menu, and when `index` names no item of the current menu.
   */
  menuItemRect(index: number): MenuRect | null;

  setFoeSpawning(enabled: boolean): void;
  setWormEntry(enabled: boolean): void;
  setCursorContact(enabled: boolean): void;

  setCursor(x: number, y: number): void;
  setCursorInvulnerable(seconds: number): void;
  setFireCooldown(seconds: number): void;
  addBolt(x: number, y: number): void;
  removeBolt(id: number): void;
  clearBolts(): void;

  setNode(c: number, r: number, charge: number): void;
  clearNode(c: number, r: number): void;
  clearNodes(): void;

  addWorm(c: number, r: number): void;
  appendSegment(id: number, c: number, r: number): void;
  setWormHeading(id: number, dh: number): void;
  setWormDescent(id: number, dv: number): void;
  setWormDiving(id: number, diving: boolean): void;
  setWormStepping(id: number, enabled: boolean): void;
  setWormBody(id: number, enabled: boolean): void;
  removeWorm(id: number): void;
  clearWorms(): void;

  addFoe(kind: FoeKind, x: number, y: number): void;
  setFoeVelocity(id: number, vx: number, vy: number): void;
  setFoeHit(id: number, hit: boolean): void;
  setFoeMind(id: number, enabled: boolean): void;
  setFoeTravel(id: number, enabled: boolean): void;
  removeFoe(id: number): void;
  clearFoes(): void;
}

/**
 * The operations that READ the running game rather than pose it.
 *
 * The surface's shape alone cannot say at runtime which members return a value
 * and which arrange the world, so the specification names them: a check that
 * sweeps the surface (instrumentation/surface-present) calls a reading for its
 * value and a pose for its effect.
 */
export const READINGS = ["snapshot", "menuItemRect"] as const;

/**
 * Every operation the surface must carry under this engine. `setAutoStep` and
 * `advance` belong to the engineless build alone (specs/instrumentation.md):
 * the engine owns the clock here, so they are deliberately absent.
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
  "menuItemRect",

  "setFoeSpawning",
  "setWormEntry",
  "setCursorContact",

  "setCursor",
  "setCursorInvulnerable",
  "setFireCooldown",
  "addBolt",
  "removeBolt",
  "clearBolts",

  "setNode",
  "clearNode",
  "clearNodes",

  "addWorm",
  "appendSegment",
  "setWormHeading",
  "setWormDescent",
  "setWormDiving",
  "setWormStepping",
  "setWormBody",
  "removeWorm",
  "clearWorms",

  "addFoe",
  "setFoeVelocity",
  "setFoeHit",
  "setFoeMind",
  "setFoeTravel",
  "removeFoe",
  "clearFoes",
] as const;
