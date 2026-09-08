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
// WHAT AN OPERATION IS. Every one of them sets ONE field or one fixed pair of
// fields, places or removes ONE entity, or reads the state. There is no operation
// that takes a partial object and merges it, and none that arranges several
// unrelated things at once. `reset` is the sole exception, and it is a lifecycle
// verb rather than a pose: it restores every declared field at once, which is how
// a check gets back to a known start.
//
// HOW THE SURFACE IS DRIVEN. The engine holds the state by value and hands it
// out read-only, so the surface holds no state of its own and nothing on it
// mutates anything. Every operation is written in the shape of the game's
// `update`: a POSE takes the current state and returns the next one
// (`setScreen(state, "playing")`, `setBallPosition(state, x, y)`), and a READING
// takes the current state and returns what it read (`snapshot(state)`,
// `menuItemRect(state, index)`). A caller drives a pose through
// `engine.apply((s) => debug.setScreen(s, "playing"))` — the engine stores what
// the pose returned, and the next frame's `update` receives it — and a reading
// through `debug.snapshot(engine.state)`. `version` is a plain number.
//
// The surface is generic over the build's state type, because this module
// imports nothing of the build: `harness.ts` binds it to the `CaromState` the
// build declared, and the `Driver` there is what gives the checks the
// imperative reading (`h.debug.setScreen("playing")`, `h.debug.snapshot()`) over
// the pure shape declared here.
//
// WHAT THE THREE VARIANTS DISAGREE ABOUT. One surface serves all three, so every
// member only one or two of them name is declared here as optional, and the
// variant slices under `gyre/` and `multi/` require the member their own
// specification names before a check reads it:
//
//   - A BALL INDEX IS A `multi` CONCEPT. `base` and `gyre` play with one ball, so
//     none of their ball operations takes an index and their snapshot reports it
//     as `ball`, with no `index` field on it. `multi` plays with three, so each of
//     its ball operations takes `index` FIRST and its snapshot reports them as
//     `balls`, each entry under its own `index`. The two shapes are written out
//     as {@link SingleBallOps} and {@link MultiBallOps}, and the shared surface
//     carries each ball operation as the union of the two — so a caller has to
//     say which variant it is driving before it can call one, which is exactly
//     the fact this case cannot type away.
//   - `receiver` and `setReceiver` are `base` and `gyre`'s: `multi` declares no
//     receiver, because its balls launch independently of one another.
//   - `setObstacleClock`, `setObstacleClockRunning`, `obstacleClock`,
//     `obstacleClockRunning` and an obstacle's `theta` are `gyre`'s: the other
//     two variants stand their obstacles still and upright.
//
// Obstacle indices, by contrast, exist in EVERY variant, because every variant
// has the two obstacles of `OBSTACLE_CENTERS`.

import type { DeepReadonly } from "ts-essentials";

/** The surface's version, reported as `version`. */
export const CAROM_DEBUG_VERSION = 1;

/** The screens the state machine moves between. */
export type Screen =
  | "title"
  | "howto"
  | "countdown"
  | "playing"
  | "paused"
  | "matchover";

/** The two screens a pause can resume to, which `resumeScreen` holds. */
export type ResumeScreen = "countdown" | "playing";

/** The two ways a match is played. */
export type Mode = "solo" | "versus";

/** One side of the field, and the paddle that defends it. */
export type Side = "left" | "right";

/**
 * A hit region in logical units, as `menuItemRect` returns it.
 *
 * `x` and `y` are the top-left corner and `w` and `h` the size. Deliberately NOT
 * `constants.ts`'s `Rect`, which is the corner pair `{ x0, y0, x1, y1 }` the
 * playfield figures are written in; this is the shape specs/instrumentation.md
 * fixes for the reading, and the two are kept apart so neither can be passed
 * where the other belongs.
 */
export interface MenuRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One sample of a ball's trail: where it was, and when. */
export interface TrailSample {
  x: number;
  y: number;
  /** The simulation time the sample was recorded at, in seconds. */
  t: number;
}

/** One ball, as a snapshot reports it. */
export interface BallSnapshot {
  /**
   * `multi` ONLY: this ball's index in play order. The single ball `base` and
   * `gyre` report carries no index, because there is nothing to index.
   */
  index?: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** The magnitude of the velocity: `hypot(vx, vy)`. */
  speed: number;
  spin: number;
  /** True while the ball waits at its home point rather than flying. */
  held: boolean;
  /** Seconds remaining of that wait. */
  holdTimer: number;
  /** `base` and `gyre`: the vertical sign the serve takes, `1` or `-1`. */
  serveSign?: 1 | -1;
  /** `multi`: the angle, in radians, the next launch leaves along. */
  launchAngle?: number;
  /** The ball's trail samples, oldest first. */
  trail: TrailSample[];
}

/** One obstacle, as a snapshot reports it. */
export interface ObstacleSnapshot {
  /** Its index in the order of `OBSTACLE_CENTERS`. */
  index: number;
  /** Live center x, in logical units. */
  cx: number;
  /** Live center y, in logical units. */
  cy: number;
  /**
   * `gyre` ONLY: live rotation about the center, in RADIANS, with 0 upright.
   * `base` and `multi` stand their obstacles upright and report none.
   */
  theta?: number;
}

/** One paddle, as a snapshot reports it. */
export interface PaddleSnapshot {
  /** Center y, in logical units. */
  cy: number;
  /** The velocity the last frame integrated, in units per second. */
  vy: number;
  /** The velocity `setPaddleVy` last set for that side, held across frames. */
  drivenVy: number;
  /** Whether the surface is moving that paddle rather than the player or the AI. */
  driven: boolean;
}

/**
 * The plain, JSON-serializable view `snapshot()` returns.
 *
 * Every field an operation of this surface sets appears here, so every operation
 * is verified by setting a value and reading it back. Five figures are read
 * rather than posed: `version`, a ball's `speed`, a paddle's `vy`, `muted`, and
 * `simTime`.
 */
export interface CaromSnapshot {
  version: number;
  screen: Screen;
  mode: Mode;
  /** The highlighted item on whichever menu the current screen shows. */
  menuIndex: number;
  /** The title menu's remembered selection. */
  titleIndex: number;
  /** The screen a pause resumes to. */
  resumeScreen: ResumeScreen;
  score: { p1: number; p2: number };
  /** The winning side once the match is over. */
  winner: Side | null;
  /** Whether the mute toggle is currently on. */
  muted: boolean;
  paddles: {
    left: PaddleSnapshot;
    right: PaddleSnapshot;
  };
  /** The AI's two faculties, each gated on its own. */
  ai: { tracking: boolean; movement: boolean };
  /** `base` and `gyre`: the side the next serve travels toward. */
  receiver?: Side;
  /** `base` and `gyre`: the single ball, or `null` while no ball is present. */
  ball?: BallSnapshot | null;
  /** `multi`: every ball present, in play order. */
  balls?: BallSnapshot[];
  /** Every obstacle present, each entry under its own `index`. */
  obstacles: ObstacleSnapshot[];
  /** `gyre`: the obstacle clock, in seconds. */
  obstacleClock?: number;
  /** `gyre`: whether that clock advances with the frame. */
  obstacleClockRunning?: boolean;
  /** Accumulated simulation time, in seconds. */
  simTime: number;
}

/**
 * The ball operations under `base` and `gyre`: ONE ball, and no index anywhere.
 *
 * Written out on their own so the no-index shape is stated once and cannot drift
 * into `multi`'s. A `base` or `gyre` check narrows `h.debug` to this shape.
 */
export type BallOps<S = unknown> = SingleBallOps<S> | MultiBallOps<S>;

export interface SingleBallOps<S = unknown> {
  /**
   * Places the ball at its home point, held, with `holdTimer` at `HOLD_TIME`,
   * zero velocity, zero spin, and an empty trail.
   */
  spawnBall(state: DeepReadonly<S>): S;
  /** Places the ball. */
  setBallPosition(state: DeepReadonly<S>, x: number, y: number): S;
  /** Sets the ball's velocity, in units per second. */
  setBallVelocity(state: DeepReadonly<S>, vx: number, vy: number): S;
  /** Sets the ball's spin, in units per second squared. */
  setBallSpin(state: DeepReadonly<S>, spin: number): S;
  /** Sets whether the ball waits at its home point rather than flying. */
  setBallHeld(state: DeepReadonly<S>, held: boolean): S;
  /** Sets the seconds remaining of the ball's hold. `0` ends it. */
  setBallHoldTimer(state: DeepReadonly<S>, seconds: number): S;
  /** Sets the vertical sign the ball's serve takes, `1` or `-1`. */
  setBallServeSign(state: DeepReadonly<S>, sign: 1 | -1): S;
  /** Draws the ball's `serveSign` afresh, as parking it does. */
  drawBallServeSign(state: DeepReadonly<S>): S;
}

/**
 * The ball operations under `multi`: `index` FIRST, selecting a ball in play
 * order from `0` to `BALL_COUNT - 1`.
 *
 * A `multi` check narrows `h.debug` to this shape, which is the requirement its
 * own specification states.
 */
export interface MultiBallOps<S = unknown> {
  /**
   * Places ball `index` at its home point, held, with `holdTimer` at
   * `HOLD_TIME`, zero velocity, zero spin, and an empty trail.
   */
  spawnBall(state: DeepReadonly<S>, index: number): S;
  /** Places ball `index`. */
  setBallPosition(
    state: DeepReadonly<S>,
    index: number,
    x: number,
    y: number,
  ): S;
  /** Sets ball `index`'s velocity, in units per second. */
  setBallVelocity(
    state: DeepReadonly<S>,
    index: number,
    vx: number,
    vy: number,
  ): S;
  /** Sets ball `index`'s spin, in units per second squared. */
  setBallSpin(state: DeepReadonly<S>, index: number, spin: number): S;
  /** Sets whether ball `index` waits at its home point rather than flying. */
  setBallHeld(state: DeepReadonly<S>, index: number, held: boolean): S;
  /** Sets the seconds remaining of ball `index`'s hold. `0` ends it. */
  setBallHoldTimer(state: DeepReadonly<S>, index: number, seconds: number): S;
  /** Sets the angle, in radians, ball `index`'s next launch leaves along. */
  setBallLaunchAngle(state: DeepReadonly<S>, index: number, angle: number): S;
  /** Draws ball `index`'s `launchAngle` afresh, as parking it does. */
  drawBallLaunchAngle(state: DeepReadonly<S>, index: number): S;
}

/**
 * The surface a build returns beside its state from `initialize`, over the
 * build's own state type `S`.
 *
 * Each pose is a transition — the current state in, the next state out — and the
 * two readings read the current state. None of them touches the state it was
 * handed: `DeepReadonly<S>` is the view the engine hands out, and the compiler is
 * what says a pose returns a new value rather than mutating.
 *
 * The six ball operations come from the type parameter `B`, because the variant
 * decides which form a build
 * installed and this one type serves all three. A caller narrows to the shape its
 * variant names before it calls one.
 */
export interface CaromDebugApi<
  S = unknown,
  B extends BallOps<S> = SingleBallOps<S>,
> {
  version: number;

  /* The world. */

  /** Removes every ball and every obstacle. The paddles stay. */
  clearWorld(state: DeepReadonly<S>): S;
  /** `base`, `gyre`: `spawnBall(state)`. `multi`: `spawnBall(state, index)`. */
  spawnBall: B["spawnBall"];
  /** Places obstacle `index`, in the order of `OBSTACLE_CENTERS`. */
  spawnObstacle(state: DeepReadonly<S>, index: number): S;
  /** Returns the game to its title-screen state. Leaves `muted` alone. */
  reset(state: DeepReadonly<S>): S;
  /**
   * Returns the next state with every reading brought into agreement with the
   * world as it stands, advancing nothing.
   *
   * A specification says what a build REPORTS, not how it HOLDS it, so a value
   * this case calls derived — a ball's `speed`, an obstacle's pose under the
   * obstacle clock — may be worked out at the read in one build and kept as a
   * stored copy in another. Both are conformant, and they part company the
   * moment a pose writes what the derived value depends on. This is the call
   * that closes the gap, and it costs no simulation time, so a measurement taken
   * from a posed rest state starts exactly where it was posed. A build that
   * derives every reading at the read returns a state equal to the one it was
   * handed.
   */
  reconcile(state: DeepReadonly<S>): S;

  /* Screens and menus. */

  setScreen(state: DeepReadonly<S>, screen: Screen): S;
  setMode(state: DeepReadonly<S>, mode: Mode): S;
  /** Sets the highlighted item on whichever menu the current screen shows. */
  setMenuIndex(state: DeepReadonly<S>, index: number): S;
  /** Sets the title menu's remembered selection. */
  setTitleIndex(state: DeepReadonly<S>, index: number): S;
  /** Sets the screen a pause resumes to. */
  setResumeScreen(state: DeepReadonly<S>, screen: ResumeScreen): S;

  /* Match state. */

  /** Sets both scores: a fixed pair, not a patch. */
  setScore(state: DeepReadonly<S>, p1: number, p2: number): S;
  /** Sets the winning side, or clears it with `null`. */
  setWinner(state: DeepReadonly<S>, side: Side | null): S;
  /** `base` and `gyre`: sets the side the next serve travels toward. */
  setReceiver?(state: DeepReadonly<S>, side: Side): S;

  /* Paddles. */

  /** Sets that paddle's center y. */
  setPaddleCy(state: DeepReadonly<S>, side: Side, cy: number): S;
  /** Sets that paddle's `drivenVy`, and leaves its `vy` as it is. */
  setPaddleVy(state: DeepReadonly<S>, side: Side, vy: number): S;
  /** Takes that paddle from the player, or hands it back. */
  setPaddleDriven(state: DeepReadonly<S>, side: Side, driven: boolean): S;

  /* Balls. See SingleBallOps and MultiBallOps for each form's arguments. */

  setBallPosition: B["setBallPosition"];
  setBallVelocity: B["setBallVelocity"];
  setBallSpin: B["setBallSpin"];
  setBallHeld: B["setBallHeld"];
  setBallHoldTimer: B["setBallHoldTimer"];
  /** `base`, `gyre`: the serve sign. `multi`: absent; see `setBallLaunchAngle`. */
  setBallServeSign: B extends SingleBallOps<S> ? B["setBallServeSign"] : never;
  drawBallServeSign: B extends SingleBallOps<S>
    ? B["drawBallServeSign"]
    : never;
  /** `multi`: the launch angle. `base`, `gyre`: absent; see `setBallServeSign`. */
  setBallLaunchAngle: B extends MultiBallOps<S>
    ? B["setBallLaunchAngle"]
    : never;
  drawBallLaunchAngle: B extends MultiBallOps<S>
    ? B["drawBallLaunchAngle"]
    : never;

  /* The AI opponent: one operation per faculty. */

  /** Whether the AI senses the ball and chooses a target. */
  setAiTracking(state: DeepReadonly<S>, enabled: boolean): S;
  /** Whether the AI's paddle travels toward that target. */
  setAiMovement(state: DeepReadonly<S>, enabled: boolean): S;

  /* Audio. */

  /** Sets the mute bit, the same bit the `mute` action toggles. */
  setMuted(state: DeepReadonly<S>, muted: boolean): S;

  /* Obstacles: gyre alone. */

  /** `gyre`: sets the obstacle clock to `t` seconds, and nothing else. */
  setObstacleClock?(state: DeepReadonly<S>, t: number): S;
  /** `gyre`: whether the obstacle clock advances with the frame. */
  setObstacleClockRunning?(state: DeepReadonly<S>, running: boolean): S;

  /* Readings. */

  /** The whole declared state. */
  snapshot(state: DeepReadonly<S>): CaromSnapshot;
  /**
   * The hit region of item `index` on the menu the current screen shows, and
   * `null` on `countdown` and `playing`, which show no menu, or when `index`
   * names no item of that menu.
   */
  menuItemRect(state: DeepReadonly<S>, index: number): MenuRect | null;
}

/**
 * The operations that READ the state rather than replace it.
 *
 * A driver over the surface needs to know which members to call with the
 * current state and hand back, and which to run through `engine.apply`; the
 * surface's shape alone cannot say at runtime, so the specification names them.
 * `menuItemRect` is a reading that takes an argument of its own, so a driver
 * that strips the state parameter must keep the arguments that follow it.
 */
export const READINGS = ["snapshot", "menuItemRect"] as const;

/**
 * Every operation the surface must carry in EVERY variant, in the order
 * specs/instrumentation.md introduces them.
 *
 * The variant-only operations are absent by design, exactly as
 * `setObstacleClock` has always been: `setReceiver` (`base`, `gyre`),
 * `setObstacleClock` and `setObstacleClockRunning` (`gyre`). Each variant's
 * slice under `gyre/` and `multi/` requires the ones its own specification
 * names. The six ball operations ARE here, because every variant carries all six
 * — the variant decides only whether they take an index.
 */
export const REQUIRED_OPS = [
  "clearWorld",
  "spawnBall",
  "spawnObstacle",
  "reset",
  "reconcile",
  "setScreen",
  "setMode",
  "setMenuIndex",
  "setTitleIndex",
  "setResumeScreen",
  "setScore",
  "setWinner",
  "setPaddleCy",
  "setPaddleVy",
  "setPaddleDriven",
  "setBallPosition",
  "setBallVelocity",
  "setBallSpin",
  "setBallHeld",
  "setBallHoldTimer",
  "setAiTracking",
  "setAiMovement",
  "setMuted",
  "snapshot",
  "menuItemRect",
] as const;
