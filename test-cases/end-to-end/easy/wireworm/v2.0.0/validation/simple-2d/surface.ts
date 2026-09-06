// Wireworm — the debug surface as the CASE specifies it. CASE-PROVIDED.
//
// specs/instrumentation.md fixes the surface a build's `initialize` returns beside
// its state, as `[state, debug]`, and this module is that specification written
// down as types: the operations, their arguments, the snapshot shape, and the
// version. It is the ONLY description of the surface the validators read. The
// build implements the surface under whatever module it likes and declares its own
// type for it — `WirewormDebugApi`, exported from `src/game.ts` — and nothing here
// imports that type; the harness reaches the object itself through `engine.debug`
// alone. So a build whose surface departs from the specification is held against
// the specification, not against its own idea of what it wrote.
//
// HOW THE SURFACE IS DRIVEN. The engine holds the state by value and hands it out
// read-only, so the surface holds no state of its own and nothing on it mutates
// anything. Every operation is written in the shape of the game's `update`: a POSE
// takes the current state and returns the next one (`setNode(state, c, r, 3)`,
// `addWorm(state, 4, 0)`), and a READING takes the current state and returns what
// it read (`snapshot(state)`). A caller drives a pose through
// `engine.apply((s) => debug.setNode(s, 4, 4, 3))` — the engine stores what the
// pose returned, and the next frame's `update` receives it — and a reading through
// `debug.snapshot(engine.state)`. `version` is a plain number.
//
// The surface is generic over the build's state type, because this module imports
// nothing of the build: `harness.ts` binds it to the `WirewormState` the build
// declared, and the `Driver` there is what gives the checks the imperative reading
// (`h.debug.setNode(4, 4, 3)`, `h.debug.snapshot()`) over the pure shape declared
// here.
//
// THERE IS NO CLOCK OPERATION AND NO `setMuted`. Under an engine the clock is the
// engine's — a check steps exact frames with `engine.advance` over the harness's
// `ConstantClock` — and the mute bit is the engine's audio bus, which a pure
// `(state, ...) => state` transform could not reach. `mute` is driven through its
// real binding and `snapshot().muted` reports the result
// (specs/instrumentation.md).
//
// Wireworm has ONE variant, `base`, so every member below is required: nothing
// here is optional, and a build missing any of it fails the checks that reach the
// game through it.

import type { DeepReadonly } from "ts-essentials";

/** The surface's version, reported as `version` (`WIREWORM_DEBUG_VERSION`). */
export const WIREWORM_DEBUG_VERSION = 1;

/** The seed `reset()` restores when the caller names none (`DEFAULT_SEED`). */
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

/** One tile of the board, in the grid coordinates specs/board.md defines. */
export interface TileSnapshot {
  c: number;
  r: number;
}

/** One node on the board, and the charge it holds. */
export interface NodeSnapshot {
  c: number;
  r: number;
  /** `0` inert, up to `CHARGE_MAX` (`3`) critical. */
  charge: number;
}

/** One worm on the board. `segments[0]` is the head. */
export interface WormSnapshot {
  id: number;
  segments: TileSnapshot[];
  /** The horizontal heading: `+1` right, `-1` left. */
  dh: number;
  /** The vertical heading: `+1` down, `-1` up. */
  dv: number;
  diving: boolean;
  /** The step faculty: the block test, the charge, the turn, and the advance. */
  stepping: boolean;
  /** The body faculty: whether the trailing segments follow the head. */
  body: boolean;
}

/** One foe on the board. `x` and `y` are its CENTER. */
export interface FoeSnapshot {
  id: number;
  kind: FoeKind;
  x: number;
  y: number;
  /** Its ACTUAL current velocity, in logical units per second. */
  vx: number;
  vy: number;
  /** A dropper that has taken its first bolt. */
  hit: boolean;
  /** The behaviour faculty: the dart, the eating, the laying, the slam. */
  mind: boolean;
  /** The locomotion faculty. */
  travel: boolean;
}

/** One bolt in flight. `x` and `y` are its CENTER. */
export interface BoltSnapshot {
  id: number;
  x: number;
  y: number;
}

/**
 * One link a live discharge is arcing along.
 *
 * The two TILES the link joined, never any drawn geometry: the polyline is
 * appearance and is reviewed rather than validated (specs/discharge.md).
 */
export interface ArcSnapshot {
  from: TileSnapshot;
  to: TileSnapshot;
}

/** The cursor. `x` and `y` are its CENTER. */
export interface CursorSnapshot {
  x: number;
  y: number;
  /** Seconds of spawn-in invulnerability left, `0` for none. */
  invulnerable: number;
  /** The cursor's contact test is running. */
  contact: boolean;
}

/** The plain, JSON-serializable view `snapshot()` returns. */
export interface WirewormSnapshot {
  version: number;
  screen: Screen;
  phase: Phase;
  /** Seconds left in the current phase. */
  phaseTimer: number;
  /** The highlighted item of the current screen's menu, from `0`. */
  menuIndex: number;
  score: number;
  lives: number;
  /** `1` to `TOTAL_LEVELS` (`12`). */
  level: number;
  /** The level the end screens report. */
  reachedLevel: number;
  /** The runtime's mute bit, as the game read it. No operation sets it. */
  muted: boolean;
  /** The level's own foe spawning is running. */
  foeSpawning: boolean;
  /** The level's and the respawn's worm entry is running. */
  wormEntry: boolean;
  /** Seconds per tile step at this level, derived from `level`. */
  wormStepInterval: number;
  /** Segments this level's worm enters with, derived from `level`. */
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
  /** The links a live discharge is arcing along, one per conducted link. */
  arcs: ArcSnapshot[];
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
 * arranges several things at once: `startPlaying` and `poseWorm` are helpers in
 * `harness.ts` built out of these, not operations a build implements.
 */
export interface WirewormDebugApi<S = unknown> {
  version: number;

  // ---- The core ----------------------------------------------------------

  /** Restore every declared field to its title-screen value. */
  reset(state: DeepReadonly<S>, options?: { seed?: number }): S;
  /** A pure read of the state. It changes nothing. */
  snapshot(state: DeepReadonly<S>): WirewormSnapshot;

  // ---- The screen and the run --------------------------------------------

  setScreen(state: DeepReadonly<S>, screen: Screen): S;
  setPhase(state: DeepReadonly<S>, phase: Phase): S;
  setPhaseTimer(state: DeepReadonly<S>, seconds: number): S;
  setMenuIndex(state: DeepReadonly<S>, n: number): S;
  /** Sets the score. It grants no bonus life: this is a precondition. */
  setScore(state: DeepReadonly<S>, n: number): S;
  setLives(state: DeepReadonly<S>, n: number): S;
  /** Sets the level, `1..12`. It spawns nothing and clears nothing. */
  setLevel(state: DeepReadonly<S>, n: number): S;
  setReachedLevel(state: DeepReadonly<S>, n: number): S;
  /**
   * A pure read of the hit region of item `index` on the menu the current
   * screen shows, in logical stage units. `null` on `playing` and `howto`, which
   * show no menu, and when `index` names no item of the current menu.
   */
  menuItemRect(state: DeepReadonly<S>, index: number): MenuRect | null;

  // ---- The world gates ---------------------------------------------------

  /** Gates the level's own spawning of foes, and nothing else. */
  setFoeSpawning(state: DeepReadonly<S>, enabled: boolean): S;
  /** Gates the level's and the respawn's entry of a worm, and nothing else. */
  setWormEntry(state: DeepReadonly<S>, enabled: boolean): S;
  /** Gates the cursor's contact test, and nothing else. */
  setCursorContact(state: DeepReadonly<S>, enabled: boolean): S;

  // ---- The cursor and its bolts ------------------------------------------

  /** Places the cursor's CENTER. The band's clamp applies. */
  setCursor(state: DeepReadonly<S>, x: number, y: number): S;
  setCursorInvulnerable(state: DeepReadonly<S>, seconds: number): S;
  setFireCooldown(state: DeepReadonly<S>, seconds: number): S;
  /** Adds one bolt in flight at a CENTER, travelling up, with a fresh id. */
  addBolt(state: DeepReadonly<S>, x: number, y: number): S;
  removeBolt(state: DeepReadonly<S>, id: number): S;
  clearBolts(state: DeepReadonly<S>): S;

  // ---- The node field ----------------------------------------------------

  /** Sets the node at `(c, r)` to `charge`, creating it if the tile was empty. */
  setNode(state: DeepReadonly<S>, c: number, r: number, charge: number): S;
  clearNode(state: DeepReadonly<S>, c: number, r: number): S;
  clearNodes(state: DeepReadonly<S>): S;

  // ---- The worms ---------------------------------------------------------

  /** Adds a one-segment worm heading right and descending, with a fresh id. */
  addWorm(state: DeepReadonly<S>, c: number, r: number): S;
  /** Appends one segment to the TAIL end of worm `id`. */
  appendSegment(state: DeepReadonly<S>, id: number, c: number, r: number): S;
  setWormHeading(state: DeepReadonly<S>, id: number, dh: number): S;
  setWormDescent(state: DeepReadonly<S>, id: number, dv: number): S;
  setWormDiving(state: DeepReadonly<S>, id: number, diving: boolean): S;
  setWormStepping(state: DeepReadonly<S>, id: number, enabled: boolean): S;
  setWormBody(state: DeepReadonly<S>, id: number, enabled: boolean): S;
  removeWorm(state: DeepReadonly<S>, id: number): S;
  clearWorms(state: DeepReadonly<S>): S;

  // ---- The foes ----------------------------------------------------------

  /** Adds one foe of `kind` at a CENTER, at its resting velocity, fresh id. */
  addFoe(state: DeepReadonly<S>, kind: FoeKind, x: number, y: number): S;
  setFoeVelocity(state: DeepReadonly<S>, id: number, vx: number, vy: number): S;
  setFoeHit(state: DeepReadonly<S>, id: number, hit: boolean): S;
  setFoeMind(state: DeepReadonly<S>, id: number, enabled: boolean): S;
  setFoeTravel(state: DeepReadonly<S>, id: number, enabled: boolean): S;
  removeFoe(state: DeepReadonly<S>, id: number): S;
  clearFoes(state: DeepReadonly<S>): S;
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
