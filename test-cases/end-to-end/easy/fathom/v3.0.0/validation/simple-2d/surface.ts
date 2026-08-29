// Fathom — the debug surface as the CASE specifies it. CASE-PROVIDED.
//
// specs/instrumentation.md fixes the surface a build's `initialize` returns beside
// its state, as `[state, debug]`, and this module is that specification written
// down as types: the operations, their arguments, the snapshot shape, and the
// version. It is the ONLY description of the surface the validators read. The
// build implements the surface under whatever module it likes and declares its
// own types for it; nothing here imports them, and the harness reaches the object
// itself through `engine.debug` alone. So a build whose surface departs from the
// specification is held against the specification, not against its own idea of
// what it wrote.
//
// HOW THE SURFACE IS DRIVEN. The engine holds the state by value and hands it
// out read-only, so the surface holds no state of its own and nothing on it
// mutates anything. Every operation is written in the shape of the game's
// `update`: a POSE takes the current state and returns the next one
// (`beginPlay(state)`, `setForagerTile(state, tx, ty)`), and a READING takes the
// current state and returns what it read (`snapshot(state)`). A caller drives a
// pose through `engine.apply((s) => debug.beginPlay(s))` — the engine stores what
// the pose returned, and the next frame's `update` receives it — and a reading
// through `debug.snapshot(engine.state)`. `version` is a plain number.
//
// The surface is generic over the build's state type, because this module
// imports nothing of the build: `harness.ts` binds it to the `FathomState` the
// build declared, and the `Driver` there is what gives the checks the imperative
// reading (`h.debug.beginPlay()`, `h.debug.snapshot()`) over the pure shape
// declared here.
//
// The two variants share one surface and differ in a single snapshot field,
// declared here as optional so one harness serves both workspaces: `kindle`
// carries the outer vision circle's radius as `windowRadius`, and `base` has no
// such circle. The slices under `kindle/` require the member their specification
// names before a check reads it.
//
// The spec's own vocabulary — the seven screens, the four cardinals, the three
// predator kinds, the tile alphabet — is restated here as literal types, because
// they are part of what a call and a reading may carry. The shared oracle
// (`maze.ts`, `scene.ts`, `fixtures.ts`) restates the same vocabulary for its own
// purposes; the two are structurally identical and either may be handed to the
// other.

import type { DeepReadonly } from "ts-essentials";

/**
 * The surface's version, reported as `version`.
 *
 * `src/constants.ts` states the same figure as `FATHOM_DEBUG_VERSION`, because
 * the build needs it and this module imports nothing of the build.
 */
export const FATHOM_DEBUG_VERSION = 1;

/** The seed `reset()` restores when the caller names none. */
export const DEFAULT_SEED = 1;

/** The screens the state machine moves between. */
export type Screen =
  | "title"
  | "howto"
  | "countdown"
  | "playing"
  | "paused"
  | "cleared"
  | "gameover";

/** The four cardinals a body faces and travels along. */
export type Dir = "up" | "down" | "left" | "right";

/** The three hunters. */
export type PredatorKind = "lanternjaw" | "gloamfin" | "flarefish";

/**
 * What a predator is doing. `"search"` is reached only through the Gloamfin's
 * own behavior; {@link PosedPredatorMode} is the subset `setPredatorState` poses.
 */
export type PredatorMode = "den" | "wander" | "chase" | "search";

/** The three states `setPredatorState` may pose. */
export type PosedPredatorMode = "den" | "wander" | "chase";

/** What cast a wavefront. */
export type PulseSource = "forager" | "gloamfin";

/** A wavefront's color. */
export type PulseTint = "cyan" | "violet" | "orange";

/** One predator, as a snapshot reports it. */
export interface PredatorSnapshot {
  kind: PredatorKind;
  /** Its center, in logical units. */
  x: number;
  y: number;
  /** The tile it is on. */
  tx: number;
  ty: number;
  dir: Dir;
  /** Where it is and what it is doing. */
  state: PredatorMode;
  /** Whether its turn in the staggered release schedule has come. */
  released: boolean;
  /** Its current speed, in logical units per second. */
  speed: number;
  /** True only while its detection alert is firing. */
  alert: boolean;
  /** True while its body is being drawn this instant. */
  lit: boolean;
  /** The Lanternjaw's and Flarefish's light detection range; `null` otherwise. */
  detectRange: number | null;
  /** The Gloamfin's close-range hearing reach; `null` otherwise. */
  hearingRange: number | null;
  /** The Gloamfin's continuous hearing lock; `null` otherwise. */
  hearingLock: boolean | null;
  /** The Flarefish's pre-bloom charge-up glow; `null` otherwise. */
  flareCharging: boolean | null;
  /** The Flarefish's burning bloom; `null` otherwise. */
  flaring: boolean | null;
  /** The bloom's current lit radius, `0` when it is not flaring; `null` otherwise. */
  flareRadius: number | null;
}

/** One bonus drifter, as a snapshot reports it. */
export interface DrifterSnapshot {
  x: number;
  y: number;
  tx: number;
  ty: number;
  /**
   * True while its body is being drawn this instant, by the forager's light or
   * by a flare.
   *
   * Its amber mote is a separate drawing and is not what this answers for: the
   * mote is one of the maze's amber lights and shows under its own rule, while
   * `lit` says whether the jellyfish itself is drawn (specs/state.md).
   */
  lit: boolean;
}

/** One sonar wavefront in flight, as a snapshot reports it. */
export interface PulseSnapshot {
  source: PulseSource;
  tint: PulseTint;
  /** The tile it originated from. */
  ox: number;
  oy: number;
  /** How far the front has traveled from that tile, in corridor steps. */
  front: number;
  /** The furthest it will travel, in the same steps. */
  range: number;
}

/** One standing ink cloud, as a snapshot reports it. */
export interface InkCloudSnapshot {
  x: number;
  y: number;
  radius: number;
  /** The seconds of life it has left. */
  remaining: number;
}

/** The tile grid's frame, as a snapshot reports it. */
export interface GridSnapshot {
  cols: number;
  rows: number;
  tile: number;
  /** Column `0`'s left edge. */
  originX: number;
  /** Row `0`'s top edge. */
  originY: number;
}

/** The plain, JSON-serializable view `snapshot()` returns. */
export interface FathomSnapshot {
  version: number;
  screen: Screen;
  /** The current maze's depth, from `1`. */
  depth: number;
  score: number;
  lives: number;
  /** Whether the mute toggle is currently on. */
  muted: boolean;
  /** Whether the creatures' own minds are running. */
  creatureAI: boolean;
  /** Plankton left in the current maze. */
  planktonRemaining: number;
  /** `G`, in `[0, 1]`. */
  brightness: number;
  /** `V`, the line-of-sight light radius, in logical units. */
  visionRadius: number;
  /**
   * `R`, the outer vision circle's radius, in logical units: `kindle` alone.
   *
   * Optional here because `base` carries no such circle. A check that reads it
   * belongs under `kindle/`, and requires it before reading.
   */
  windowRadius?: number;
  sonar: { ready: boolean; cooldown: number; range: number };
  ink: { ready: boolean; cooldown: number };
  grid: GridSnapshot;
  /** The layout: `grid.rows` strings of `grid.cols` characters, `#.gd`. */
  tiles: string[];
  /** The per-tile visibility this instant, same layout, `url`. */
  visibility: string[];
  forager: {
    /** Its center, in logical units. */
    x: number;
    y: number;
    /** The tile it is on. */
    tx: number;
    ty: number;
    dir: Dir;
    /** True while it is traveling. */
    moving: boolean;
  };
  drifters: DrifterSnapshot[];
  /** The current roster, in release order. */
  predators: PredatorSnapshot[];
  pulses: PulseSnapshot[];
  inkClouds: InkCloudSnapshot[];
  /** Accumulated simulation time, in seconds. */
  simTime: number;
}

/**
 * The surface a build returns beside its state from `initialize`, over the
 * build's own state type `S`.
 *
 * Each pose is a transition — the current state in, the next state out — and
 * `snapshot` is a reading of the current state. None of them touches the state
 * it was handed: `DeepReadonly<S>` is the view the engine hands out, and the
 * compiler is what says a pose returns a new value rather than mutating.
 */
export interface FathomDebugApi<S = unknown> {
  version: number;
  reset(state: DeepReadonly<S>, options?: { seed?: number }): S;
  snapshot(state: DeepReadonly<S>): FathomSnapshot;
  startDive(state: DeepReadonly<S>): S;
  beginPlay(state: DeepReadonly<S>): S;
  setDepth(state: DeepReadonly<S>, d: number): S;
  /** `rows` is `GRID_ROWS` strings of `GRID_COLS` characters, in `#.gd`. */
  setMaze(state: DeepReadonly<S>, rows: readonly string[]): S;
  setForagerTile(state: DeepReadonly<S>, tx: number, ty: number): S;
  setForagerDir(state: DeepReadonly<S>, dir: Dir): S;
  /** Poses `G` in `[0, 1]` and arms the `BRIGHT_HOLD` hold in full. */
  setBrightness(state: DeepReadonly<S>, g: number): S;
  /** `index` selects a predator by its place in `snapshot().predators`. */
  setPredatorTile(
    state: DeepReadonly<S>,
    index: number,
    tx: number,
    ty: number,
  ): S;
  setPredatorDir(state: DeepReadonly<S>, index: number, dir: Dir): S;
  setPredatorState(
    state: DeepReadonly<S>,
    index: number,
    value: PosedPredatorMode,
  ): S;
  spawnDrifter(state: DeepReadonly<S>, tx: number, ty: number): S;
  setCreatureAI(state: DeepReadonly<S>, enabled: boolean): S;
  setPlankton(
    state: DeepReadonly<S>,
    tx: number,
    ty: number,
    present: boolean,
  ): S;
  clearPlankton(state: DeepReadonly<S>): S;
  setSonarCooldown(state: DeepReadonly<S>, seconds: number): S;
  setInkCooldown(state: DeepReadonly<S>, seconds: number): S;
}

/**
 * The operations that READ the state rather than replace it.
 *
 * A driver over the surface needs to know which members to call with the
 * current state and hand back, and which to run through `engine.apply`; the
 * surface's shape alone cannot say at runtime, so the specification names them.
 */
export const READINGS = ["snapshot"] as const;

/** Every operation the surface must carry in every variant. */
export const REQUIRED_OPS = [
  "reset",
  "snapshot",
  "startDive",
  "beginPlay",
  "setDepth",
  "setMaze",
  "setForagerTile",
  "setForagerDir",
  "setBrightness",
  "setPredatorTile",
  "setPredatorDir",
  "setPredatorState",
  "spawnDrifter",
  "setCreatureAI",
  "setPlankton",
  "clearPlankton",
  "setSonarCooldown",
  "setInkCooldown",
] as const;
