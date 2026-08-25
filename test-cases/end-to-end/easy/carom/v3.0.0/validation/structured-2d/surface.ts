// Carom — the debug surface as the CASE specifies it. CASE-PROVIDED.
//
// specs/instrumentation.md fixes the surface the game instance's `initialize`
// builds and returns, and this module is that specification written down as
// types: the operations, their arguments, the snapshot shape, and the version.
// It is the ONLY description of the surface the validators read. The build
// implements the surface under whatever module it likes and declares its own
// type for it — the `D` of its `GameInstance<D>`; nothing here imports it, and
// the harness reaches the object itself through `engine.debug` alone. So a
// build whose surface departs from the specification is held against the
// specification, not against its own idea of what it wrote.
//
// HOW THE SURFACE IS DRIVEN. Each operation is a method that acts on the
// running game at the moment of the call, through the same systems play uses:
// a POSE takes only the arguments its heading names, returns nothing, and
// arranges the live world (`serve()`, `setBall(0, { x })`), and a READING takes
// no arguments and returns plain data read off the world at the instant of the
// call (`snapshot()`). A caller therefore drives both directly —
// `engine.debug.serve()`, `engine.debug.snapshot()` — with no wrapper in
// between. `version` is a plain number.
//
// The three variants share one surface and differ in three members, all
// declared here as optional so one harness serves every workspace: the single
// ball (`snapshot().ball`, base and gyre) against the three balls
// (`snapshot().balls`, multi), and gyre's `setObstacleClock` with its
// `snapshot().obstacles`. The shared harness reads a ball through
// `ball0`/`allBalls`, which accept either shape, and the variant slices under
// `gyre/` and `multi/` require the member their specification names before a
// check reads it.

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
   * Vertical velocity in units per second. It is written to the paddle and
   * held by the driver for that side, so it PERSISTS across frames and the
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

/**
 * The plain, JSON-serializable view `snapshot()` returns.
 *
 * Two of its figures are live engine reads rather than kept copies
 * (specs/instrumentation.md): `muted` is the audio bus's own mute bit, and
 * `simTime` is the frame clock's accumulated simulated time, which runs
 * whatever the screen and carries across level transitions — so neither is
 * touched by `reset`.
 */
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
 * The surface the game instance's `initialize` returns, which the engine hands
 * back from `engine.debug`.
 *
 * Each pose acts on the live game and returns nothing — the instance holds the
 * engine, and `engine.world` follows transitions, so a pose reads the open
 * world at the moment of the call — and `snapshot` is a reading of that same
 * running game. A pose whose effect is a level transition (`startMatch`, a
 * `reset` away from the title) lands on the next advanced frame, because a
 * transition is honored at the end of a frame.
 */
export interface CaromDebugApi {
  version: number;
  reset(options?: { seed?: number }): void;
  snapshot(): CaromSnapshot;
  startMatch(mode: Mode): void;
  serve(): void;
  setScore(p1: number, p2: number): void;
  setPaddle(side: Side, patch?: PaddlePatch): void;
  setBall(index: number, patch?: BallPatch): void;
  setAiControl(enabled: boolean): void;
  /** Poses the obstacle clock at `t` seconds and holds it there: gyre. */
  setObstacleClock?(t: number): void;
}

/**
 * The operations that READ the running game rather than pose it.
 *
 * The surface's shape alone cannot say at runtime which members return a value
 * and which arrange the world, so the specification names them: a check that
 * sweeps the surface (instrumentation/debug-api) calls a reading for its value
 * and a pose for its effect.
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
