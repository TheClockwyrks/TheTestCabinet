// Carom — the debug surface as the CASE specifies it. CASE-PROVIDED.
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
// (`serve(state)`, `setBall(state, 0, { x })`), and a READING takes the current
// state and returns what it read (`snapshot(state)`). A caller drives a pose
// through `engine.apply((s) => debug.serve(s))` — the engine stores what the
// pose returned, and the next frame's `update` receives it — and a reading
// through `debug.snapshot(engine.state)`. `version` is a plain number.
//
// The surface is generic over the build's state type, because this module
// imports nothing of the build: `harness.ts` binds it to the `CaromState` the
// build declared, and the `Driver` there is what gives the checks the
// imperative reading (`h.debug.serve()`, `h.debug.snapshot()`) over the pure
// shape declared here.
//
// The three variants share one surface and differ in three members, all declared
// here as optional so one harness serves every workspace: the single ball
// (`snapshot().ball`, base and gyre) against the three balls (`snapshot().balls`,
// multi), and gyre's `setObstacleClock` with its `snapshot().obstacles`. The
// shared harness reads a ball through `ball0`/`allBalls`, which accept either
// shape, and the variant slices under `gyre/` and `multi/` require the member
// their specification names before a check reads it.

import type { DeepReadonly } from "ts-essentials";

/** The surface's version, reported as `version`. */
export const CAROM_DEBUG_VERSION = 1;

/** The seed `reset()` restores when the caller names none. */
export const DEFAULT_SEED = 1;

/** The screens the state machine moves between. */
export type Screen =
  "title" | "howto" | "countdown" | "playing" | "paused" | "matchover";

/** The two ways a match is played. */
export type Mode = "solo" | "versus";

/** One side of the field, and the paddle that defends it. */
export type Side = "left" | "right";

/** The fields `setPaddle` may set. Anything omitted is left as it is. */
export interface PaddlePatch {
  /** Center y, in logical units. */
  cy?: number;
  /**
   * Vertical velocity in units per second. It PERSISTS across frames, so the
   * paddle is still moving when it strikes the ball, which is what drives the
   * spin mechanic.
   */
  vy?: number;
}

/** The fields `setBall` may set. Anything omitted is left as it is. */
export interface BallPatch {
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  spin?: number;
}

/** One ball, as a snapshot reports it. */
export interface BallSnapshot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** The magnitude of the velocity: `hypot(vx, vy)`. */
  speed: number;
  spin: number;
  /** True while the ball waits out its pre-serve hold. */
  held: boolean;
}

/** One obstacle's live pose, as gyre's `snapshot().obstacles` reports it. */
export interface ObstacleSnapshot {
  /** Live center x, in logical units. */
  cx: number;
  /** Live center y, in logical units. */
  cy: number;
  /** Live rotation about the center, in RADIANS. 0 is upright. */
  theta: number;
}

/** The plain, JSON-serializable view `snapshot()` returns. */
export interface CaromSnapshot {
  version: number;
  screen: Screen;
  mode: Mode;
  score: { p1: number; p2: number };
  /** The winning side once the match is over. */
  winner: Side | null;
  /** Whether the mute toggle is currently on. */
  muted: boolean;
  paddles: {
    left: { cy: number; vy: number };
    right: { cy: number; vy: number };
  };
  /** The single ball in play: base and gyre. */
  ball?: BallSnapshot;
  /** All three balls, in play order: multi. */
  balls?: BallSnapshot[];
  /** Both obstacles' live poses, in the order of `OBSTACLE_CENTERS`: gyre. */
  obstacles?: ObstacleSnapshot[];
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
export interface CaromDebugApi<S = unknown> {
  version: number;
  reset(state: DeepReadonly<S>, options?: { seed?: number }): S;
  snapshot(state: DeepReadonly<S>): CaromSnapshot;
  startMatch(state: DeepReadonly<S>, mode: Mode): S;
  serve(state: DeepReadonly<S>): S;
  setScore(state: DeepReadonly<S>, p1: number, p2: number): S;
  setPaddle(state: DeepReadonly<S>, side: Side, patch?: PaddlePatch): S;
  setBall(state: DeepReadonly<S>, index: number, patch?: BallPatch): S;
  setAiControl(state: DeepReadonly<S>, enabled: boolean): S;
  /** Poses the obstacle clock at `t` seconds and holds it there: gyre. */
  setObstacleClock?(state: DeepReadonly<S>, t: number): S;
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
  "startMatch",
  "serve",
  "setScore",
  "setPaddle",
  "setBall",
  "setAiControl",
] as const;
