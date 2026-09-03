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
// WHAT AN OPERATION IS. Every one of them sets ONE field or one fixed pair of
// fields, places or removes ONE entity, or reads the state. There is no
// operation that takes a partial object and merges it, and none that arranges
// several unrelated things at once. `reset` is the sole exception, and it is a
// lifecycle verb rather than a pose: it restores every declared field at once,
// which is how a check gets back to a known start.
//
// HOW THE SURFACE IS DRIVEN. Each operation is a method that acts on the
// running game at the moment of the call, through the same systems play uses:
// a POSE takes only the arguments its heading names, returns nothing, and
// arranges the live world (`setScreen("playing")`, `setBallPosition(x, y)`),
// and a READING takes only its own arguments and returns plain data read off
// the world at the instant of the call (`snapshot()`, `menuItemRect(index)`). A
// caller therefore drives both directly — `engine.debug.setScreen("playing")`,
// `engine.debug.snapshot()` — with no wrapper in between. `version` is a plain
// number.
//
// A pose that changes the screen may ride a level transition the engine honors
// as the frame ends, so a caller advances one frame after such a pose before it
// poses, presses a key, or reads further.
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

/** The surface's version, reported as `version`. */
export const CAROM_DEBUG_VERSION = 1;

/** The seed a title-screen state carries, which `reset` restores. */
export const DEFAULT_SEED = 1;

/** The screens the state machine moves between. */
export type Screen =
  "title" | "howto" | "countdown" | "playing" | "paused" | "matchover";

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
 * `simTime`. The last two are live engine reads rather than kept copies, so
 * neither is touched by `reset`.
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
  /** The seed the generator was last seeded from. */
  seed: number;
  /** That generator's current state, as a single number. */
  rngState: number;
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
 * into `multi`'s. A `base` or `gyre` check narrows `engine.debug` to this shape.
 */
export type BallOps = SingleBallOps | MultiBallOps;

export interface SingleBallOps {
  /**
   * Places the ball at its home point, held, with `holdTimer` at `HOLD_TIME`,
   * zero velocity, zero spin, and an empty trail.
   */
  spawnBall(): void;
  /** Places the ball. */
  setBallPosition(x: number, y: number): void;
  /** Sets the ball's velocity, in units per second. */
  setBallVelocity(vx: number, vy: number): void;
  /** Sets the ball's spin, in units per second squared. */
  setBallSpin(spin: number): void;
  /** Sets whether the ball waits at its home point rather than flying. */
  setBallHeld(held: boolean): void;
  /** Sets the seconds remaining of the ball's hold. `0` ends it. */
  setBallHoldTimer(seconds: number): void;
}

/**
 * The ball operations under `multi`: `index` FIRST, selecting a ball in play
 * order from `0` to `BALL_COUNT - 1`.
 *
 * A `multi` check narrows `engine.debug` to this shape, which is the requirement
 * its own specification states.
 */
export interface MultiBallOps {
  /**
   * Places ball `index` at its home point, held, with `holdTimer` at
   * `HOLD_TIME`, zero velocity, zero spin, and an empty trail.
   */
  spawnBall(index: number): void;
  /** Places ball `index`. */
  setBallPosition(index: number, x: number, y: number): void;
  /** Sets ball `index`'s velocity, in units per second. */
  setBallVelocity(index: number, vx: number, vy: number): void;
  /** Sets ball `index`'s spin, in units per second squared. */
  setBallSpin(index: number, spin: number): void;
  /** Sets whether ball `index` waits at its home point rather than flying. */
  setBallHeld(index: number, held: boolean): void;
  /** Sets the seconds remaining of ball `index`'s hold. `0` ends it. */
  setBallHoldTimer(index: number, seconds: number): void;
}

/**
 * The surface the game instance's `initialize` returns, which the engine hands
 * back from `engine.debug`.
 *
 * Each pose acts on the live game and returns nothing — the instance holds the
 * engine, and `engine.world` follows transitions, so a pose reads the open
 * world at the moment of the call — and the two readings read that same running
 * game.
 *
 * The six ball operations come from the type parameter `B`, because the variant
 * decides which form a build
 * installed and this one type serves all three. A caller narrows to the shape its
 * variant names before it calls one.
 */
export interface CaromDebugApi<B extends BallOps = SingleBallOps> {
  version: number;

  /* The world. */

  /** Removes every ball and every obstacle. The paddles stay. */
  clearWorld(): void;
  /** `base`, `gyre`: `spawnBall()`. `multi`: `spawnBall(index)`. */
  spawnBall: B["spawnBall"];
  /** Places obstacle `index`, in the order of `OBSTACLE_CENTERS`. */
  spawnObstacle(index: number): void;
  /** Returns the game to its title-screen state. Leaves `muted` alone. */
  reset(): void;
  /** Seeds the game's random generator, setting `seed` and `rngState`. */
  setSeed(seed: number): void;

  /* Screens and menus. */

  setScreen(screen: Screen): void;
  setMode(mode: Mode): void;
  /** Sets the highlighted item on whichever menu the current screen shows. */
  setMenuIndex(index: number): void;
  /** Sets the title menu's remembered selection. */
  setTitleIndex(index: number): void;
  /** Sets the screen a pause resumes to. */
  setResumeScreen(screen: ResumeScreen): void;

  /* Match state. */

  /** Sets both scores: a fixed pair, not a patch. */
  setScore(p1: number, p2: number): void;
  /** Sets the winning side, or clears it with `null`. */
  setWinner(side: Side | null): void;
  /** `base` and `gyre`: sets the side the next serve travels toward. */
  setReceiver?(side: Side): void;

  /* Paddles. */

  /** Sets that paddle's center y. */
  setPaddleCy(side: Side, cy: number): void;
  /** Sets that paddle's `drivenVy`, and leaves its `vy` as it is. */
  setPaddleVy(side: Side, vy: number): void;
  /** Takes that paddle from the player, or hands it back. */
  setPaddleDriven(side: Side, driven: boolean): void;

  /* Balls. See SingleBallOps and MultiBallOps for each form's arguments. */

  setBallPosition: B["setBallPosition"];
  setBallVelocity: B["setBallVelocity"];
  setBallSpin: B["setBallSpin"];
  setBallHeld: B["setBallHeld"];
  setBallHoldTimer: B["setBallHoldTimer"];

  /* The AI opponent: one operation per faculty. */

  /** Whether the AI senses the ball and chooses a target. */
  setAiTracking(enabled: boolean): void;
  /** Whether the AI's paddle travels toward that target. */
  setAiMovement(enabled: boolean): void;

  /* Obstacles: gyre alone. */

  /** `gyre`: sets the obstacle clock to `t` seconds, and nothing else. */
  setObstacleClock?(t: number): void;
  /** `gyre`: whether the obstacle clock advances with the frame. */
  setObstacleClockRunning?(running: boolean): void;

  /* Readings. */

  /** The whole declared state. */
  snapshot(): CaromSnapshot;
  /**
   * The hit region of item `index` on the menu the current screen shows, and
   * `null` on `countdown` and `playing`, which show no menu, or when `index`
   * names no item of that menu.
   */
  menuItemRect(index: number): MenuRect | null;
}

/**
 * The operations that READ the running game rather than pose it.
 *
 * The surface's shape alone cannot say at runtime which members return a value
 * and which arrange the world, so the specification names them: a check that
 * sweeps the surface (instrumentation/debug-api) calls a reading for its value
 * and a pose for its effect.
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
  "setSeed",
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
  "snapshot",
  "menuItemRect",
] as const;
