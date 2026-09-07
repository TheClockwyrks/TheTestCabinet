// Carom — the case's half of the validator harness. CASE-PROVIDED.
//
// Every check in this suite is an ordinary vitest test that drives the built site
// IN A REAL BROWSER. There is nothing to import: an engineless run seeds no
// `src/` at all, so the build wrote its own frame loop, its own canvas fit, its
// own keyboard, its own audio, and its own `window.__carom` — and the only place
// all of that exists is a page that has loaded the bundle. So the project serves
// `dist/`, loads it in Chromium, and reaches the game the way anything reaches
// it: over the surface the specification told the build to install.
//
// IT IS STILL A VITEST PROJECT, AND THAT IS DELIBERATE. The runner locates the
// build output before it chooses between the vitest and browser paths, so `dist/`
// is on disk by the time this project runs. Staying a vitest project is what lets
// the case name ONE script per review item and have it resolve under either
// engine — `validation/gameplay/serve-speed.test.ts` is the same path whichever
// runtime the run selected — and what keeps `format = 2` resolution passing.
//
// THE MACHINERY THAT DRIVES THE PAGE IS NOT CAROM'S. Serving the build,
// connecting to the one browser, opening a page per harness, injecting the
// draw-command recorder and the audio probe, bracketing each driven frame around
// one step of the build's surface, driving the real mouse and the real finger,
// reading pixels and draw calls back out, and writing the evidence a review point
// declares — every engineless case needs exactly that, and it lives once, in
// `@clockwyrks/case-harness`, staged beside this file as `./case-harness/`.
// What is left here is what is genuinely Carom's: the shape of its snapshot, the
// operations its `specs/instrumentation.md` requires, and the scenarios its
// checks are posed from.
//
// The seam is one call. `createCaseHarness` takes the case's TYPES as type
// arguments and the case's VALUES as one object, and hands back the machinery
// with Carom's names and Carom's types on it — so the suites next door, and the
// two variant harnesses one directory down, go on importing `createHarness`,
// `captureReplay` and `watchCues` from `../harness` exactly as they did, and none
// of them can tell the difference.
//
// WHAT A CHECK READS. The game's own state (through `window.__carom`'s
// `snapshot`), the frames the harness itself drove, the operations the build
// issued against its 2D context, the pixels those operations left on the canvas,
// and the sounds the build emitted. Nothing here fabricates an outcome: the
// scenario helpers below only ARRANGE the world through the surface, and the real
// update the build wrote is what runs from there.
//
// THE SURFACE IS ATOMIC, AND THE SEQUENCES LIVE HERE. Every operation
// `specs/instrumentation.md` specifies sets one field or one fixed pair, places
// or removes one entity, reads the state, or moves the clock; `reset` is the one
// lifecycle verb. Starting a match, reaching a particular screen and staging a
// rally are therefore SEQUENCES of those operations, and this file is where those
// sequences live so every validator shares one of each. Each is reachable in
// parts: `openCountdown` opens a match and takes neither paddle from the player,
// and a check that wants a driven paddle asks for one by name with
// {@link takePaddle}. That separation is the point — a check about the real input
// pipeline and a check about a posed contact need the same match and opposite
// paddles.
//
// A CHECK POSES THE WORLD IT IS ABOUT, AND NOTHING ELSE. The surface carries
// `clearWorld`, `spawnBall` and `spawnObstacle`, so a scenario empties the field
// and spawns back exactly the bodies its requirement concerns — see
// {@link isolateBall}. Nothing here parks a spare ball in a corner or holds an
// obstacle still to keep it out of the way: a body that is not part of the
// requirement is REMOVED, which is both what the field then contains and what the
// reviewer sees in the replay.
//
// THE CLOCK IS THE SURFACE'S. Nothing outside an engineless build owns its loop,
// so `specs/instrumentation.md` puts the clock on the surface: `setAutoStep(false)`
// takes the game off real time and `advance(seconds, frames)` runs whole frames
// of a chosen length. Every harness opens by taking the game off the clock, so a
// check asks for a number of frames and gets exactly that number — no polling, no
// waiting, and no measurement of the machine it ran on. No check in this project
// hands the loop back or lets real time pass: a frame lands here because a check
// asked for it, on any machine alike.
//
// EVERYTHING CROSSING INTO THE PAGE IS ASYNC. That is the whole of the difference
// between a suite here and its counterpart under an engine: `await h.snapshot()`
// rather than `h.snapshot()`, `await h.debug.setBallPosition(...)` rather than
// `h.debug.setBallPosition(...)`. The scenarios, the tolerances, and the
// assertions are the same ones, because they are the case's rather than the
// runtime's.

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createCaseHarness,
  mouseGlide,
  mousePress,
  mouseRelease,
  sampleColor,
  touchGlide,
  touchPress,
  touchRelease,
  type Harness as BaseHarness,
  type HarnessOptions,
  type Rgb,
  type UntilOptions,
  type UntilResult as BaseUntilResult,
} from "./case-harness/index";
import { assertTruthy } from "./assert";
import {
  BALL_R,
  FIELD_CX,
  FIELD_CY,
  FIELD_H,
  FIELD_W,
  OBSTACLES,
  P1_X0,
  P1_X1,
  P2_X0,
  P2_X1,
  PADDLE_MIN_CY,
  SPEED_CAP,
  SPEED_MULT,
  TRAIL_TIME,
  UNBOUND_KEY,
  WIN_SCORE,
  type Rect,
} from "./constants";

/* -------------------------------------------------------------------------- */
/* The contract the build owes                                                */
/* -------------------------------------------------------------------------- */

/** The handle an engineless build installs its surface on. */
export const HANDLE = "__carom";

/**
 * Every operation `specs/instrumentation.md` requires on the surface in EVERY
 * variant, including the two clock operations that exist only under this engine.
 *
 * Written out in full rather than spread over the shared harness's
 * `BASE_REQUIRED_OPS`: this list is what a build is told to install, in the order
 * the specification introduces them, and it is the order a missing-operation
 * fault names them back in.
 *
 * The variant-only operations are absent by design: `setReceiver` (`base` and
 * `gyre`), and `setObstacleClock` and `setObstacleClockRunning` (`gyre`). Each
 * variant's slice under `gyre/` and `multi/` requires the ones its own
 * specification names. The six ball operations ARE here, because every variant
 * carries all six — the variant decides only whether they take an index.
 */
export const REQUIRED_OPS = [
  "setAutoStep",
  "advance",
  "clearWorld",
  "spawnBall",
  "spawnObstacle",
  "reset",
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

/** The version the surface reports (`CAROM_DEBUG_VERSION`). */
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

/** One side of the field. */
export type Side = "left" | "right";

/** The two ways to play. */
export type Mode = "solo" | "versus";

/**
 * A hit region in logical units, as `menuItemRect` returns it.
 *
 * `x` and `y` are the top-left corner and `w` and `h` the size. Deliberately NOT
 * `constants.ts`'s {@link Rect}, which is the corner pair `{ x0, y0, x1, y1 }`
 * the playfield figures are written in; this is the shape
 * `specs/instrumentation.md` fixes for the reading, and the two are kept apart so
 * neither can be passed where the other belongs.
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
export interface BallView {
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
export interface ObstacleView {
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
export interface PaddleView {
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
 * The state a snapshot reports, as `specs/instrumentation.md` documents it.
 *
 * Every field an operation of this surface sets appears here, so every operation
 * is verified by setting a value and reading it back. Six figures are read
 * rather than posed: `version`, a ball's `speed`, a paddle's `vy`, `muted`,
 * `autoStep` (the clock's setting rather than a value the game holds), and
 * `simTime`.
 *
 * ONE SURFACE SERVES EVERY VARIANT, so every field only one or two of them name
 * is optional here, and the variant slices under `gyre/` and `multi/` require the
 * field their own specification names before a check reads it:
 *
 *   - THE BALLS. `base` and `gyre` play with one ball and report it as `ball`,
 *     which carries NO index because there is nothing to index; `multi` plays
 *     with three and reports them as `balls` in play order, each under its own
 *     `index`. A check shared by every variant reaches the ball it drives through
 *     {@link ball0} rather than either field.
 *   - `receiver` is `base` and `gyre`'s: `multi` declares no receiver, because
 *     its balls launch independently of one another.
 *   - `obstacleClock`, `obstacleClockRunning` and an obstacle's `theta` are
 *     `gyre`'s: the other two variants stand their obstacles still and upright.
 *
 * `autoStep` is this ENGINE's rather than a variant's: an engineless build owns
 * its own clock, so it is the only one whose surface has one to report.
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
  paddles: Record<Side, PaddleView>;
  /** The AI's two faculties, each gated on its own. */
  ai: { tracking: boolean; movement: boolean };
  /** `base` and `gyre`: the side the next serve travels toward. */
  receiver?: Side;
  /** `base` and `gyre`: the single ball, or `null` while no ball is present. */
  ball?: BallView | null;
  /** `multi`: every ball present, in play order. */
  balls?: BallView[];
  /** Every obstacle present, each entry under its own `index`. */
  obstacles: ObstacleView[];
  /** `gyre`: the obstacle clock, in seconds. */
  obstacleClock?: number;
  /** `gyre`: whether that clock advances with the frame. */
  obstacleClockRunning?: boolean;
  /** False while the clock is scripted rather than run from the wall clock. */
  autoStep: boolean;
  /** Accumulated simulation time, in seconds. */
  simTime: number;
}

/**
 * The ball every shared scenario drives: the only one under `base` and `gyre`,
 * and the first of the three under `multi`.
 *
 * The variants agree about what a ball IS and disagree only about how many there
 * are, so a check about the ball — its bounce, its spin, its speed off a paddle —
 * is the same check under all three, driven against ball zero. What makes that
 * sound under `multi` is {@link isolateBall}, which takes the other two OFF the
 * field before the scenario is posed, so the reading is of the driven ball alone
 * and the replay shows a field with one ball on it.
 *
 * A build reporting neither shape, or reporting no ball on a field a check
 * expected one on, fails by assertion here rather than throwing a `TypeError`
 * several frames later, so the point names the fault.
 */
export function ball0(snapshot: CaromSnapshot): BallView {
  const balls = snapshot.balls;
  const one =
    snapshot.ball ??
    (balls === undefined
      ? undefined
      : (balls.find((ball) => ball.index === 0) ?? balls[0]));
  assertTruthy(
    one,
    "snapshot() must report the ball as `ball` (base, gyre) or the balls as " +
      "`balls` (multi); see specs/instrumentation.md",
  );
  return one as BallView;
}

/** Every ball a snapshot reports, in play order. */
export function allBalls(snapshot: CaromSnapshot): BallView[] {
  if (snapshot.balls !== undefined) return snapshot.balls;
  // `ball` is absent under `multi` and null on a cleared field; both are "no
  // ball to read", and `clearWorld` is what makes the second case ordinary.
  return snapshot.ball === undefined || snapshot.ball === null
    ? []
    : [snapshot.ball];
}

/* -------------------------------------------------------------------------- */
/* The surface, as types                                                      */
/* -------------------------------------------------------------------------- */
//
// A BALL INDEX IS A `multi` CONCEPT AND APPEARS UNDER `multi` ALONE. `base` and
// `gyre` play with one ball, so no operation of theirs takes an index; `multi`
// plays with three, so each of its ball operations takes `index` FIRST. The two
// shapes are written out separately and {@link CaromDebugApi} is generic over
// which of them a variant installed, so a `base` check calls
// `setBallPosition(x, y)` and a `multi` check calls `setBallPosition(i, x, y)`,
// each of them checked rather than cast. They are never unioned: a union is a
// value a caller cannot call without first saying which half it holds, which is
// the fact this case must state rather than type away.

/**
 * The ball operations under `base` and `gyre`: ONE ball, and no index anywhere.
 *
 * Written out on their own so the no-index shape is stated once and cannot drift
 * into `multi`'s. A `base` or `gyre` check narrows `h.debug` to this shape.
 */
export interface SingleBallOps {
  /**
   * Places the ball at its home point, held, with `holdTimer` at `HOLD_TIME`,
   * zero velocity, zero spin, and an empty trail.
   */
  spawnBall(): Promise<void>;
  /** Places the ball. */
  setBallPosition(x: number, y: number): Promise<void>;
  /** Sets the ball's velocity, in units per second. */
  setBallVelocity(vx: number, vy: number): Promise<void>;
  /** Sets the ball's spin, in units per second squared. */
  setBallSpin(spin: number): Promise<void>;
  /** Sets whether the ball waits at its home point rather than flying. */
  setBallHeld(held: boolean): Promise<void>;
  /** Sets the seconds remaining of the ball's hold. `0` ends it. */
  setBallHoldTimer(seconds: number): Promise<void>;
  /** Sets the vertical sign the ball's serve takes, `1` or `-1`. */
  setBallServeSign(sign: 1 | -1): Promise<void>;
  /** Draws the ball's `serveSign` afresh, as parking it does. */
  drawBallServeSign(): Promise<void>;
}

/**
 * The ball operations under `multi`: `index` FIRST, selecting a ball in play
 * order from `0` to `BALL_COUNT - 1`.
 *
 * A `multi` check narrows `h.debug` to this shape, which is the requirement its
 * own specification states.
 */
export interface MultiBallOps {
  /**
   * Places ball `index` at its home point, held, with `holdTimer` at
   * `HOLD_TIME`, zero velocity, zero spin, and an empty trail.
   */
  spawnBall(index: number): Promise<void>;
  /** Places ball `index`. */
  setBallPosition(index: number, x: number, y: number): Promise<void>;
  /** Sets ball `index`'s velocity, in units per second. */
  setBallVelocity(index: number, vx: number, vy: number): Promise<void>;
  /** Sets ball `index`'s spin, in units per second squared. */
  setBallSpin(index: number, spin: number): Promise<void>;
  /** Sets whether ball `index` waits at its home point rather than flying. */
  setBallHeld(index: number, held: boolean): Promise<void>;
  /** Sets the seconds remaining of ball `index`'s hold. `0` ends it. */
  setBallHoldTimer(index: number, seconds: number): Promise<void>;
  /** Sets the angle, in radians, ball `index`'s next launch leaves along. */
  setBallLaunchAngle(index: number, angle: number): Promise<void>;
  /** Draws ball `index`'s `launchAngle` afresh, as parking it does. */
  drawBallLaunchAngle(index: number): Promise<void>;
}

/** Either form of the six ball operations: the constraint, never a value's type. */
export type BallOps = SingleBallOps | MultiBallOps;

/**
 * The operations a check poses the game through. Every one crosses into the page.
 *
 * Every one of them sets ONE field or one fixed pair of fields, places or removes
 * ONE entity, reads the state, or moves the clock. `reset` is the sole exception,
 * and it is a lifecycle verb rather than a pose: it restores every declared field
 * at once, which is how a check gets back to a known start.
 *
 * The six ball operations come from the type parameter `B`, because the variant
 * decides which form a build installed and this one type serves all three. A
 * caller names the shape its variant installed — {@link Harness} for `base` and
 * `gyre`, {@link MultiHarness} for `multi` — before it calls one. The three
 * genuinely variant-only operations are optional, exactly as `setObstacleClock`
 * has always been.
 */
export interface CaromDebugApi<B extends BallOps = SingleBallOps> {
  /* The clock: this engine alone, because an engineless build owns its loop. */

  /** Takes the game off real time, and gives it back. */
  setAutoStep(enabled: boolean): Promise<void>;
  /** Runs `frames` whole frames covering `seconds` of game time. */
  advance(seconds: number, frames?: number): Promise<void>;

  /* The world. */

  /** Removes every ball and every obstacle. The paddles stay. */
  clearWorld(): Promise<void>;
  /** `base`, `gyre`: `spawnBall()`. `multi`: `spawnBall(index)`. */
  spawnBall: B["spawnBall"];
  /** Places obstacle `index`, in the order of `OBSTACLE_CENTERS`. */
  spawnObstacle(index: number): Promise<void>;
  /** Returns the game to its title-screen state. Leaves `muted` and `autoStep`. */
  reset(): Promise<void>;

  /* Screens and menus. */

  setScreen(screen: Screen): Promise<void>;
  setMode(mode: Mode): Promise<void>;
  /** Sets the highlighted item on whichever menu the current screen shows. */
  setMenuIndex(index: number): Promise<void>;
  /** Sets the title menu's remembered selection. */
  setTitleIndex(index: number): Promise<void>;
  /** Sets the screen a pause resumes to. */
  setResumeScreen(screen: ResumeScreen): Promise<void>;

  /* Match state. */

  /** Sets both scores: a fixed pair, not a patch. */
  setScore(p1: number, p2: number): Promise<void>;
  /** Sets the winning side, or clears it with `null`. */
  setWinner(side: Side | null): Promise<void>;
  /** `base` and `gyre`: sets the side the next serve travels toward. */
  setReceiver?(side: Side): Promise<void>;

  /* Paddles. */

  /** Sets that paddle's center y. */
  setPaddleCy(side: Side, cy: number): Promise<void>;
  /** Sets that paddle's `drivenVy`, and leaves its `vy` as it is. */
  setPaddleVy(side: Side, vy: number): Promise<void>;
  /** Takes that paddle from the player, or hands it back. */
  setPaddleDriven(side: Side, driven: boolean): Promise<void>;

  /* Balls. See SingleBallOps and MultiBallOps for each form's arguments. */

  setBallPosition: B["setBallPosition"];
  setBallVelocity: B["setBallVelocity"];
  setBallSpin: B["setBallSpin"];
  setBallHeld: B["setBallHeld"];
  setBallHoldTimer: B["setBallHoldTimer"];
  /** `base`, `gyre`: the serve sign. `multi`: absent; see `setBallLaunchAngle`. */
  setBallServeSign: B extends SingleBallOps ? B["setBallServeSign"] : never;
  drawBallServeSign: B extends SingleBallOps ? B["drawBallServeSign"] : never;
  /** `multi`: the launch angle. `base`, `gyre`: absent; see `setBallServeSign`. */
  setBallLaunchAngle: B extends MultiBallOps ? B["setBallLaunchAngle"] : never;
  drawBallLaunchAngle: B extends MultiBallOps
    ? B["drawBallLaunchAngle"]
    : never;

  /* The AI opponent: one operation per faculty. */

  /** Whether the AI senses the ball and chooses a target. */
  setAiTracking(enabled: boolean): Promise<void>;
  /** Whether the AI's paddle travels toward that target. */
  setAiMovement(enabled: boolean): Promise<void>;

  /* Audio. */

  /** Sets the mute bit, the same bit the `mute` action toggles. */
  setMuted(muted: boolean): Promise<void>;

  /* Obstacles: gyre alone. */

  /** `gyre`: sets the obstacle clock to `t` seconds, and nothing else. */
  setObstacleClock?(t: number): Promise<void>;
  /** `gyre`: whether the obstacle clock advances with the frame. */
  setObstacleClockRunning?(running: boolean): Promise<void>;

  /* Readings. */

  /** The whole declared state. */
  snapshot(): Promise<CaromSnapshot>;
  /**
   * The hit region of item `index` on the menu the current screen shows, and
   * `null` on `countdown` and `playing`, which show no menu, or when `index`
   * names no item of that menu.
   */
  menuItemRect(index: number): Promise<MenuRect | null>;
}

/**
 * Everything the surface carries in the SAME shape under every variant: the
 * whole of {@link CaromDebugApi} but the six ball operations.
 *
 * This is what the scenario helpers below are written against, because a helper
 * shared by all three variants can only call what all three spell identically.
 * The ball operations are reached through {@link ballOps}, which answers the
 * variant's argument shape once and hands back a form a shared scenario can
 * call. Derived from `SingleBallOps`'s own key set rather than listed by hand, so
 * a ball operation added to the specification cannot be left behind here.
 */
export type CaromCoreApi = Omit<
  CaromDebugApi<SingleBallOps>,
  keyof SingleBallOps | keyof MultiBallOps
>;

/* -------------------------------------------------------------------------- */
/* The harness, bound to this case                                            */
/* -------------------------------------------------------------------------- */
//
// THE STEP SCHEDULE. The suite chooses the size of a frame, because the
// specification deliberately fixes none: every rate in this game is per second
// and is integrated against the elapsed time of the frame, so a build must reach
// the same place however that time was divided. The default is a steady 120 Hz,
// which makes every duration below a whole number of frames — the unit the
// tolerances in this suite were established in. The check that is ABOUT the step
// size (`gameplay/delta-time-independent`) drives the same scenario under the
// other two schedules the shared harness's clocks supply.

/**
 * The shared harness, with Carom's snapshot, Carom's surface and Carom's figures
 * bound into it.
 *
 * Bound at {@link CaromCoreApi} rather than at either variant's full surface, so
 * `captureReplay`, `captureStill` and `watchCues` take a harness of EITHER shape.
 * The two full shapes are handed out by {@link createHarness} and
 * {@link createMultiHarness}.
 *
 * `projectRoot` comes from THIS module and must never come from the package's:
 * the package is staged one directory deeper than this file, and a produced
 * replay or still is addressed by the running suite's path relative to the
 * project root. Taken from the package it would address every output one level
 * too deep — and silently, because a writer that raised on a failed write would
 * be blaming the build for the host's problem, so neither of them raises.
 */
const kit = createCaseHarness<CaromSnapshot, CaromCoreApi>({
  slug: "carom",
  handle: HANDLE,
  requiredOps: REQUIRED_OPS,
  // `advance(seconds, frames)`: a span of simulated time divided into whole
  // frames, so the suite's clock decides how long a frame is.
  step: { kind: "seconds-frames", op: "advance" },
  stage: { width: FIELD_W, height: FIELD_H },
  tickHz: 120,
  // A GENUINE browser gesture, so the build's audio can open: a build is free to
  // open its audio context from a real DOM event alone (both are conformant), so
  // a gesture delivered any other way would leave a perfectly good build silent.
  // `specs/ui.md` leaves this key bound to nothing, so arming changes no game
  // state.
  arm: { kind: "key", code: UNBOUND_KEY },
  // Carom's menus are driven by a finger as well as a mouse and the keyboard
  // (specs/ui.md), so the context reports a touchscreen: a contact arrives as
  // `pointerType: "touch"` and `navigator.maxTouchPoints` is non-zero, which is
  // the device a build offering touch controls has to believe it is on.
  hasTouch: true,
  // Every text call carries the width the page measured for it and the alignment
  // in force, which is what the merge behind the package's `drewText` works on:
  // the `ui/state-*` suites read a screen's copy off the LOGICAL runs a frame
  // spells, so a title or a menu entry a build letter-spaces a glyph per
  // `fillText` is found by the words it spells — the same reading this project's
  // two engine siblings take. Without it no two draws ever coalesce and the runs
  // are exactly the calls.
  measureText: true,
  // A build installs its surface while its entry module runs, so a page that has
  // fired `load` has either installed it already or is not going to, and the
  // wait returns the instant the global appears — a conformant build pays none of
  // this ceiling however high it is set. What the ceiling bounds is the cost of a
  // build that installs its surface later than `load` and then never gets there,
  // which every harness of that build pays once.
  //
  // FIFTEEN SECONDS RATHER THAN FIVE, because five was set against a healthy
  // machine and this is a deadline on the HOST. The project holds several pages
  // of one browser open at once on a box that is also running a model's build,
  // where a crossing into a page costs 90 ms against 6 ms idle; five seconds
  // there is close enough to a deferred install that a loaded host was still
  // finishing to read a conformant build as one that installs nothing, and every
  // point that harness decides is then failed for the load average. Fifteen is
  // still far below the cap on the whole suite run, so a build that genuinely
  // installs no surface turns into "every point this decides failed" rather than
  // "the validators did not run", which tells a reviewer far less.
  surfaceTimeoutMs: 15_000,
  projectRoot: dirname(fileURLToPath(import.meta.url)),
});

export const {
  captureReplay,
  captureStill,
  watchCues,
  fitViewport,
  failSurface,
  SURFACE_REQUIREMENT,
  seconds,
  speedOverTicks,
  TICK_HZ,
  TICK_MS,
} = kit;

/**
 * Everything a check reads off one page running this build, with the ball
 * operations in the shape `base` and `gyre` install: no index anywhere.
 *
 * A bound alias of the shared harness's interface, so every
 * `import { type Harness } from "../harness"` next door goes on naming a harness
 * whose `snapshot()` is a {@link CaromSnapshot} and whose `debug` is a
 * {@link CaromDebugApi}.
 */
export type Harness = BaseHarness<CaromSnapshot, CaromDebugApi<SingleBallOps>>;

/**
 * The same harness with the ball operations in the shape `multi` installs:
 * `index` first.
 *
 * The two views differ in their TYPES alone — one page, one surface object, one
 * proxy — so a `multi` check takes this one and writes `setBallPosition(i, x, y)`
 * with the compiler checking the call, instead of casting at each site or
 * narrowing a union it cannot narrow.
 */
export type MultiHarness = BaseHarness<
  CaromSnapshot,
  CaromDebugApi<MultiBallOps>
>;

/**
 * A harness of either shape: what every scenario helper below takes.
 *
 * Both {@link Harness} and {@link MultiHarness} are one of these, because both
 * of their surfaces carry the whole of {@link CaromCoreApi}. A shared check hands
 * whichever it holds to `startPlaying`, `arrangeGoal` or `captureReplay` without
 * saying which variant it is running under — which is what lets one script serve
 * all three.
 */
export type AnyHarness = BaseHarness<CaromSnapshot, CaromCoreApi>;

/**
 * Open a page on the build, take the game off its own clock, and read it with
 * `base` and `gyre`'s single-ball surface.
 *
 * WHY THE VIEW IS ASSERTED HERE. The page's surface object is the build's own,
 * and the harness reaches it through a proxy that forwards whatever it is asked
 * for — so which of the two ball shapes a caller sees is a statement about the
 * VARIANT rather than a claim about the object, and there is nothing at runtime
 * to check it against. This module and {@link ballOps} are the only two places
 * that make it, so no call site ever does.
 */
export function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  return kit.createHarness(options) as Promise<Harness>;
}

/** The same page and the same surface, read with `multi`'s indexed ball surface. */
export function createMultiHarness(
  options: HarnessOptions = {},
): Promise<MultiHarness> {
  return kit.createHarness(options) as Promise<MultiHarness>;
}

/** What a sweep found: whether the predicate ever held, and where it stopped. */
export type UntilResult = BaseUntilResult<CaromSnapshot>;

export type {
  Clock,
  DrawCall,
  HarnessOptions,
  Pixel,
  Point,
  RecordedFrame,
  RecordedOp,
  RecordedPathSegment,
  RecordedResource,
  RecordedState,
  Recording,
  Rgb,
  TextDraw,
  TimedCue,
  UntilOptions,
  Viewport,
} from "./case-harness/index";

export {
  ConstantClock,
  JitterClock,
  SequenceClock,
  callsTo,
  closeWorkerBrowser,
  colorDistance,
  drawnText,
  drawnTextLines,
  mouseGlide,
  mousePress,
  mouseRelease,
  retable,
  sampleColor,
  setsOf,
  textDraws,
  thinReplay,
  touchGlide,
  touchPress,
  touchRelease,
  touchTap,
} from "./case-harness/index";

/**
 * The ground a replay of this case is composited over.
 *
 * The shared harness's default, under the name this project gives it:
 * `index.html` paints the page black and the build draws over it, so a
 * recording replayed on anything else shows a picture the build never made.
 */
export { DEFAULT_REPLAY_BACKGROUND as REPLAY_BACKGROUND } from "./case-harness/index";

/** The angle from horizontal of a velocity, in degrees, ignoring direction. */
export function angleDeg(v: { vx: number; vy: number }): number {
  return (Math.atan2(Math.abs(v.vy), Math.abs(v.vx)) * 180) / Math.PI;
}

/* -------------------------------------------------------------------------- */
/* Reading the surface a build actually installed                             */
/* -------------------------------------------------------------------------- */

/** What each harness has already been asked about its surface. */
const probed = new WeakMap<object, Map<string, boolean>>();

/**
 * Whether the build installed the operation `name`.
 *
 * `typeof h.debug.setReceiver` cannot answer this: `debug` is a proxy that
 * answers every property with a function that would forward the call, so every
 * name reads as installed. `h.probe` reflects the object in the PAGE instead,
 * which is where the truth is.
 *
 * Asked once per harness per name. A surface cannot gain or lose an operation
 * while a scenario is being driven, and a sweep poses the world hundreds of
 * times over, so re-asking would be a crossing into the page to re-confirm what
 * the first one settled. A harness with no surface at all answers `false` for
 * everything, and the check fails on the shared harness's fuller fault instead.
 */
export async function hasOperation(
  h: AnyHarness,
  name: string,
): Promise<boolean> {
  if (h.surfaceFault !== null) return false;
  let known = probed.get(h);
  if (known === undefined) {
    known = new Map<string, boolean>();
    probed.set(h, known);
  }
  const answered = known.get(name);
  if (answered !== undefined) return answered;
  const { ops } = await h.probe([name]);
  const installed = ops[name] === "function";
  known.set(name, installed);
  return installed;
}

/* -------------------------------------------------------------------------- */
/* The balls, whichever shape the variant installed                           */
/* -------------------------------------------------------------------------- */

/**
 * The six ball operations, bound to ONE ball and to the argument shape the
 * running variant installed.
 *
 * Every member is one operation of the surface and nothing more — `setPosition`
 * is `setBallPosition`, `setHeld` is `setBallHeld` — so this adds no compound
 * verb of its own. What it answers is the one question a shared scenario cannot
 * answer for itself: whether this build's `setBallPosition` takes `(x, y)` or
 * `(index, x, y)`. A `multi` check that knows the answer already calls
 * `h.debug.setBallPosition(i, x, y)` directly on a {@link MultiHarness}.
 */
export interface BoundBallOps {
  /** The ball this handle drives. Zero under `base` and `gyre`, which have one. */
  readonly index: number;
  /** Places it at its home point, held, with a full hold and an empty trail. */
  spawn(): Promise<void>;
  /** Places it. */
  setPosition(x: number, y: number): Promise<void>;
  /** Aims it, in units per second. */
  setVelocity(vx: number, vy: number): Promise<void>;
  /** Sets its spin, in units per second squared. */
  setSpin(spin: number): Promise<void>;
  /** Holds it at its home point, or releases it into play. */
  setHeld(held: boolean): Promise<void>;
  /** Sets the seconds remaining of its hold. `0` ends it. */
  setHoldTimer(seconds: number): Promise<void>;
}

/** Which harnesses drive a build whose ball operations take an index. */
const indexedBalls = new WeakMap<object, boolean>();

/**
 * Whether this build's ball operations take an index, read off its snapshot.
 *
 * `multi` reports its balls as the array `balls` and the other two report the
 * single `ball`, and that difference is the same one the operations carry
 * (specs/instrumentation.md), so the snapshot is what says which form to call.
 * True on a CLEARED field as well as a full one: `multi`'s empty field reports
 * `balls: []`, which is still an array, and `base`'s reports `ball: null`.
 *
 * Read once per harness, for {@link hasOperation}'s reason. A build reporting
 * neither shape is driven with the single-ball form and fails by assertion in
 * {@link ball0}, which names the fault properly.
 */
async function ballsAreIndexed(h: AnyHarness): Promise<boolean> {
  const known = indexedBalls.get(h);
  if (known !== undefined) return known;
  const indexed = Array.isArray((await h.snapshot()).balls);
  indexedBalls.set(h, indexed);
  return indexed;
}

/**
 * Bind the six ball operations to ball `index` on this build.
 *
 * The cast is the same statement {@link createHarness} makes, for the same
 * reason: one proxy forwards whatever it is asked for, and which of the two
 * declared shapes is being called is a fact about the variant. Made here so a
 * shared scenario never makes it.
 */
export async function ballOps(h: AnyHarness, index = 0): Promise<BoundBallOps> {
  if (await ballsAreIndexed(h)) {
    const ops = h.debug as unknown as MultiBallOps;
    return {
      index,
      spawn: () => ops.spawnBall(index),
      setPosition: (x, y) => ops.setBallPosition(index, x, y),
      setVelocity: (vx, vy) => ops.setBallVelocity(index, vx, vy),
      setSpin: (spin) => ops.setBallSpin(index, spin),
      setHeld: (held) => ops.setBallHeld(index, held),
      setHoldTimer: (secs) => ops.setBallHoldTimer(index, secs),
    };
  }
  const ops = h.debug as unknown as SingleBallOps;
  return {
    index,
    spawn: () => ops.spawnBall(),
    setPosition: (x, y) => ops.setBallPosition(x, y),
    setVelocity: (vx, vy) => ops.setBallVelocity(vx, vy),
    setSpin: (spin) => ops.setBallSpin(spin),
    setHeld: (held) => ops.setBallHeld(held),
    setHoldTimer: (secs) => ops.setBallHoldTimer(secs),
  };
}

/** Where a scenario puts a ball, and how fast. Anything omitted is zero. */
export interface BallPose {
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  spin?: number;
}

/**
 * Put a ball into flight at a posed place and aim: five atomic operations, in
 * the order that leaves nothing for the next frame to undo.
 *
 * The hold is ended FIRST. A held ball sits parked at its home point with zero
 * velocity (specs/balls.md), so a position posed while it is still held is a
 * position the game is entitled to overwrite on the frame after.
 */
export async function placeBall(
  h: AnyHarness,
  pose: BallPose,
  index = 0,
): Promise<void> {
  const ball = await ballOps(h, index);
  await ball.setHeld(false);
  await ball.setHoldTimer(0);
  await ball.setPosition(pose.x, pose.y);
  await ball.setVelocity(pose.vx ?? 0, pose.vy ?? 0);
  await ball.setSpin(pose.spin ?? 0);
}

/* -------------------------------------------------------------------------- */
/* Isolation: the field holds what the requirement is about                   */
/* -------------------------------------------------------------------------- */
//
// The case's world holds two obstacles in every variant, one ball under `base`
// and `gyre` and three under `multi`. Almost no requirement is about all of
// that at once: a wall bounce is about a ball and two walls, a bank shot is
// about a ball and ONE obstacle, and a scored point is about a ball and a goal
// edge. So a scenario empties the field and spawns back exactly the bodies its
// requirement names, and what the check reads — and what the reviewer watches —
// is that field and no other.
//
// This is why the surface carries `clearWorld` and the two spawns. The
// alternative, which this file used to practise, is to leave a body on the field
// and arrange for it not to matter: a spare ball parked in a goal channel, an
// obstacle held still by a frozen clock. Both leave the reading resting on an
// argument about geometry rather than on an empty field, and both put a body in
// the replay that the review point never mentions.

/** Empty the field: no balls, no obstacles. The paddles stay, as furniture does. */
export function clearField(h: AnyHarness): Promise<void> {
  return h.debug.clearWorld();
}

/** Place the named obstacles, in the order of `OBSTACLE_CENTERS`. */
export async function spawnObstacles(
  h: AnyHarness,
  indices: readonly number[],
): Promise<void> {
  for (const index of indices) await h.debug.spawnObstacle(index);
}

/**
 * Empty the field and spawn back one ball, plus whatever obstacles the scenario
 * is about, and hand back that ball's operations.
 *
 * The ball comes back the way `spawnBall` places it: at its home point, held,
 * with a full hold timer and an empty trail — which is a staged serve. A
 * scenario that wants it flying poses it with {@link placeBall}, and one that
 * wants the hold itself measured leaves it exactly as this left it.
 *
 * `obstacles` is empty by default, because most of this file's scenarios are
 * about a ball and the field's edges. A bank shot names the one obstacle it
 * strikes.
 */
export async function isolateBall(
  h: AnyHarness,
  index = 0,
  obstacles: readonly number[] = [],
): Promise<BoundBallOps> {
  const ball = await ballOps(h, index);
  await clearField(h);
  if (obstacles.length > 0) await pinObstaclesUpright(h);
  await spawnObstacles(h, obstacles);
  await ball.spawn();
  return ball;
}

/**
 * Stop the obstacle clock and put it at zero, where `gyre`'s obstacles stand
 * upright at their base centres.
 *
 * Clock zero is the pose at which gyre's oriented collision rule reduces to the
 * upright case (specs/playfield.md), so a shared check about an obstacle face
 * means the same thing in every variant. The freeze is its own faculty —
 * `setObstacleClockRunning(false)` — rather than a side effect of holding a
 * paddle, so a check stops the clock without taking anything else away.
 *
 * Both operations are `gyre`'s alone, so this is a no-op under the other two
 * variants, whose obstacles never move. It poses the SUBJECT of the check rather
 * than quieting a bystander: an obstacle a check is not about is removed by
 * {@link clearField}, not held still.
 */
export async function pinObstaclesUpright(h: AnyHarness): Promise<void> {
  // Probed rather than optional-chained. `h.debug` is a proxy whose every
  // property answers with a function that crosses into the page, so `?.` never
  // short-circuits here and an absent operation would throw in the page instead
  // of being skipped. {@link hasOperation} asks the build what it installed.
  if (!(await hasOperation(h, "setObstacleClockRunning"))) return;
  await h.debug.setObstacleClockRunning?.(false);
  await h.debug.setObstacleClock?.(0);
}

/**
 * Empty the field and spawn back the named obstacles alone, with no ball at all.
 *
 * The clock is stopped at zero first, so what comes back stands at a pose the
 * check knows rather than wherever gyre's sway had reached.
 */
export async function isolateObstacles(
  h: AnyHarness,
  indices: readonly number[],
): Promise<void> {
  await clearField(h);
  await pinObstaclesUpright(h);
  await spawnObstacles(h, indices);
}

/* -------------------------------------------------------------------------- */
/* The paddles                                                                */
/* -------------------------------------------------------------------------- */
//
// A PADDLE CANNOT BE REMOVED, because a paddle is field furniture the game
// always has (specs/state.md). So a scenario that must keep one out of the way
// moves it out of the way, and a scenario that needs one to swing takes it from
// the player by name. Nothing here takes a paddle a scenario did not ask for:
// that is the whole reason `setPaddleDriven` is its own operation, and it is
// what lets a check about the real input pipeline open a match and still have
// the paddles.

/** Off-lane parking height for a paddle a scenario must keep out of the way. */
export const PARKED_CY = 150;

/**
 * How far in front of a paddle contact the ball is posed, in frames of approach.
 *
 * The contact itself is the same one a zero-lead pose makes immediately; the
 * run-up buys the scenario a real approach, and — because a driven paddle's
 * `drivenVy` persists — it is also what lets a SWINGING paddle be moving at the
 * moment it strikes, having travelled the same distance the ball did.
 */
export const LEAD_TICKS = 60; // 0.5 s at 120 Hz

/**
 * Take one paddle from the player and give it a velocity to hold.
 *
 * Two operations: `setPaddleDriven` decides who moves it, `setPaddleVy` decides
 * how fast, and neither touches the other side. A `vy` of `0` is a paddle held
 * exactly where it is against both the input actions and the AI.
 */
export async function takePaddle(
  h: AnyHarness,
  side: Side,
  vy = 0,
): Promise<void> {
  await h.debug.setPaddleVy(side, vy);
  await h.debug.setPaddleDriven(side, true);
}

/** Hand one paddle back to the player, and clear the velocity it was driven at. */
export async function releasePaddle(h: AnyHarness, side: Side): Promise<void> {
  await h.debug.setPaddleDriven(side, false);
  await h.debug.setPaddleVy(side, 0);
}

/** Take both paddles, each holding `vy`. */
export async function takePaddles(h: AnyHarness, vy = 0): Promise<void> {
  await takePaddle(h, "left", vy);
  await takePaddle(h, "right", vy);
}

/**
 * Hand both paddles back to the player and the AI.
 *
 * Kept unreached so the three engine projects present one vocabulary: the
 * engine harnesses export the same pair, and a scenario ported between them
 * reads the same either way.
 */
export async function releasePaddles(h: AnyHarness): Promise<void> {
  await releasePaddle(h, "left");
  await releasePaddle(h, "right");
}

/**
 * Move both paddles out of the mid-field lane, so a shot down it is unobstructed.
 *
 * Position only: neither paddle is taken from whoever holds it. In a Versus match
 * nothing then moves them, and in Solo the AI goes on moving the right one, which
 * is what a check about the AI wants and what a check about a bank shot does not
 * mind, since the ball never reaches that far.
 */
export async function clearPaddles(
  h: AnyHarness,
  cy = PARKED_CY,
): Promise<void> {
  await h.debug.setPaddleCy("left", cy);
  await h.debug.setPaddleCy("right", cy);
}

/** Stand both paddles on the field's center line, where a rally is played from. */
export async function centerPaddles(h: AnyHarness): Promise<void> {
  await h.debug.setPaddleCy("left", FIELD_CY);
  await h.debug.setPaddleCy("right", FIELD_CY);
}

/* -------------------------------------------------------------------------- */
/* The AI opponent                                                            */
/* -------------------------------------------------------------------------- */

/** Give the AI back both faculties: it senses the ball, and it chases it. */
export async function enableAi(h: AnyHarness): Promise<void> {
  await h.debug.setAiTracking(true);
  await h.debug.setAiMovement(true);
}

/**
 * Take both faculties away: the AI neither senses the ball nor moves.
 *
 * The two are separate operations because a check on what the AI SENSES while
 * its body is held still cannot be expressed by one switch — that check turns
 * movement off and leaves tracking on, through the surface directly.
 *
 * Kept unreached for the reason {@link releasePaddles} gives: it is the pair of
 * {@link enableAi}, and the two read as one operation.
 */
export async function disableAi(h: AnyHarness): Promise<void> {
  await h.debug.setAiTracking(false);
  await h.debug.setAiMovement(false);
}

/* -------------------------------------------------------------------------- */
/* Reaching a screen, and opening a match                                     */
/* -------------------------------------------------------------------------- */
//
// EACH OF THESE IS A SEQUENCE OF ATOMIC OPERATIONS, AND EACH IS REACHABLE IN
// PARTS. `openCountdown` opens a match and stops; `startPlaying` is that plus the
// hold ended; `stageServe` is that plus a receiver and a field cleared to one
// ball. None of them touches a paddle's driven flag, so a check that wants a
// match with the paddles still under the player — which is every check about the
// controls — simply opens one and starts pressing keys.

/** Return the game to its title screen: `reset`, and nothing else. */
export function openTitle(h: AnyHarness): Promise<void> {
  return h.debug.reset();
}

/** Reach the how-to screen from a clean title, without walking the menu to it. */
export async function openHowTo(h: AnyHarness): Promise<void> {
  await h.debug.reset();
  await h.debug.setMenuIndex(0);
  await h.debug.setScreen("howto");
}

/**
 * Open a match on its pre-serve countdown through the debug surface alone.
 *
 * `reset` puts every declared field at its title value — both scores `0`,
 * `winner` `null`, `receiver` `left`, `menuIndex` `0`, `resumeScreen` `playing`,
 * both paddles centered and released, the world respawned and the ball held at
 * its home with a full timer — which is, field for field, what `specs/ui.md`
 * says starting a match sets. So a match opens in two more operations: the mode,
 * and the screen.
 *
 * This is how a countdown scenario reaches its ground without driving the menus,
 * so a build with a broken menu and a working countdown fails the navigation
 * checks and passes the countdown ones. The paddles are left with the player: a
 * scenario that wants one driven takes it with {@link takePaddle}, and one that
 * wants the whole menu path enters with {@link startWithKeys} instead.
 */
export async function openCountdown(h: AnyHarness, mode: Mode): Promise<void> {
  await h.debug.reset();
  await h.debug.setMode(mode);
  await h.debug.setScreen("countdown");
}

/**
 * End every present ball's hold, and report how many there were.
 *
 * Setting a hold timer to `0` does not itself serve the ball: the build serves it
 * on the next frame whose subtraction leaves the timer at or below zero, through
 * its own rule (specs/balls.md). So this arranges the serve and the build
 * performs it, which is the whole reason `serve()` is not an operation.
 */
export async function endHolds(h: AnyHarness): Promise<number> {
  const balls = allBalls(await h.snapshot());
  for (const [n, ball] of balls.entries()) {
    const ops = await ballOps(h, ball.index ?? n);
    await ops.setHoldTimer(0);
  }
  return balls.length;
}

/**
 * Open a match and run it up to live play.
 *
 * The state every posed scenario below assumes: posing a ball while the game is
 * still counting down would have the build's own serve overwrite the pose. The
 * LAUNCH is the build's, on the frame after the hold ends, and the screen turns
 * over on that same frame — so this sweeps until the game reports live play
 * rather than assuming a frame count.
 *
 * The paddles are the player's throughout, exactly as {@link openCountdown}
 * leaves them.
 */
export async function startPlaying(
  h: AnyHarness,
  mode: Mode = "versus",
): Promise<UntilResult> {
  await openCountdown(h, mode);
  await endHolds(h);
  return h.until((s) => s.screen === "playing", { maxFrames: 60, poll: 1 });
}

/** Start a match from the title the way a player does: menu keys only. */
export async function startWithKeys(h: AnyHarness, mode: Mode): Promise<void> {
  await h.debug.reset();
  // SOLO is the first entry; VERSUS is one down.
  if (mode === "versus") await h.tap("ArrowDown");
  await h.tap("Enter");
}

/**
 * Aim the next serve at one side.
 *
 * `base` and `gyre` carry a receiver; `multi` does not, because its balls launch
 * independently of one another and no one of them is "the serve". So this is a
 * no-op where the variant declares none, and a shared scenario can ask for a
 * receiver without knowing which variant it is running under.
 *
 * Reached through {@link stageServe} rather than by a check of its own, and kept
 * for the reason {@link releasePaddles} gives.
 */
export async function aimServe(h: AnyHarness, side: Side): Promise<void> {
  if (!(await hasOperation(h, "setReceiver"))) return;
  const setReceiver = h.debug.setReceiver;
  if (setReceiver !== undefined) await setReceiver(side);
}

/** What a staged serve is aimed at, and what is left on the field to take it. */
export interface ServeOptions {
  /** The mode the match is opened in. Versus by default: no AI in the way. */
  mode?: Mode;
  /** `base` and `gyre`: the side the serve travels toward. */
  receiver?: Side;
  /**
   * Empty the field and leave this ball alone on it, held at its home with a
   * full timer. Omitted, the whole standard world is staged, which is what a
   * check about three simultaneous launches wants.
   */
  only?: number;
}

/**
 * Stage a serve — `multi` calls the same thing a launch — and leave it staged.
 *
 * The game is left on the countdown with the ball or balls held at their home
 * points and their timers full, which is the ground a check about the hold's
 * LENGTH, the serve's direction, or the serve's speed measures from: the first
 * frames advanced from here count the hold down, and the build's own rule
 * launches the ball.
 *
 * Kept unreached for the reason {@link releasePaddles} gives: both engine
 * harnesses export a `stageServe`, and this is its engineless form.
 */
export async function stageServe(
  h: AnyHarness,
  options: ServeOptions = {},
): Promise<void> {
  await openCountdown(h, options.mode ?? "versus");
  if (options.receiver !== undefined) await aimServe(h, options.receiver);
  if (options.only !== undefined) await isolateBall(h, options.only);
}

/** Which screen a pause was opened from, and how the match was opened. */
export interface PauseOptions {
  /** The mode the match is opened in. Versus by default. */
  mode?: Mode;
  /** The screen the pause resumes to. Live play by default. */
  from?: ResumeScreen;
}

/**
 * Reach the pause menu over a live match, through the surface alone.
 *
 * `resumeScreen` is set to the screen the pause came from and `menuIndex` to
 * `0`, which is what `specs/ui.md` says a `pause` edge sets — so a check about
 * what the pause menu SHOWS and a check about what resuming DOES both start from
 * the same place, without either of them depending on the key that opens it.
 * The check that is about that key presses it.
 *
 * Kept beside {@link openIsolatedPauseMenu} for a check that wants the standard
 * match world frozen behind the menu. Every navigation, pointer and touch check
 * on the pause menu takes the isolated form, for the reason that one gives.
 */
export async function openPauseMenu(
  h: AnyHarness,
  options: PauseOptions = {},
): Promise<void> {
  const from = options.from ?? "playing";
  const mode = options.mode ?? "versus";
  if (from === "playing") await startPlaying(h, mode);
  else await openCountdown(h, mode);
  await h.debug.setResumeScreen(from);
  await h.debug.setMenuIndex(0);
  await h.debug.setScreen("paused");
}

/**
 * The pause menu over a field holding nothing but the paddles.
 *
 * {@link openPauseMenu} leaves the standard match world frozen behind the menu,
 * which is only quiet while the build's own pause really stops it. A check on
 * what the pause menu's KEYS do wants nothing else on the field: a ball left
 * live behind a build whose pause does not stop the world can bank a shot into a
 * goal and take the screen away from the reading, which would report the pause's
 * defect against a menu point. So this empties the field before the menu is
 * posed, which is the ground the `simple-2d` and `structured-2d` projects give
 * the same points.
 *
 * The paddles are left with the player: a menu is not driven through a paddle,
 * and a driven one would be scenery these checks do not need.
 */
export async function openIsolatedPauseMenu(
  h: AnyHarness,
  options: PauseOptions = {},
): Promise<void> {
  const from = options.from ?? "playing";
  const mode = options.mode ?? "versus";
  if (from === "playing") await startPlaying(h, mode);
  else await openCountdown(h, mode);
  await clearField(h);
  await h.debug.setResumeScreen(from);
  await h.debug.setMenuIndex(0);
  await h.debug.setScreen("paused");
}

/** Who won, at what score, and in which mode. */
export interface MatchOverOptions {
  /** The winning side. */
  winner: Side;
  /** The final score. A clean `WIN_SCORE`-to-nothing win by default. */
  score?: { p1: number; p2: number };
  /** The mode the match was played in. Versus by default. */
  mode?: Mode;
}

/**
 * Reach the match-over screen, with a winner and a final score on it.
 *
 * Four poses over an opened match: the score, the winner, the menu's selection
 * and the screen. Driving a real match to `WIN_SCORE` would be twenty-two
 * scored points of physics for a check about what one screen displays, and it
 * would fail this point whenever the scoring itself was broken — which is the
 * scoring checks' business, and theirs alone.
 */
export async function openMatchOver(
  h: AnyHarness,
  options: MatchOverOptions,
): Promise<void> {
  await openCountdown(h, options.mode ?? "versus");
  const score =
    options.score ??
    (options.winner === "left"
      ? { p1: WIN_SCORE, p2: 0 }
      : { p1: 0, p2: WIN_SCORE });
  await h.debug.setScore(score.p1, score.p2);
  await h.debug.setWinner(options.winner);
  await h.debug.setMenuIndex(0);
  await h.debug.setScreen("matchover");
}

/* -------------------------------------------------------------------------- */
/* Menus, driven by a real mouse and a real finger                            */
/* -------------------------------------------------------------------------- */
//
// The menus take a pointer and a touch contact as well as the keyboard
// (specs/ui.md), and where a build LAYS the items out is the build's own — so a
// check asks the build where it put an item, through `menuItemRect`, and then
// drives Chromium's real mouse or a real touch contact at that region. Nothing
// here poses a pointer through the surface: a pose would tell the build where
// the pointer is without making its own input layer see a press, a travel and a
// release the way a hand does, and what these checks are about is precisely that
// the build reads them.
//
// Each part of a gesture runs exactly ONE driven frame, so a caller counting
// frames can add them up. That comes from the shared drivers, and this file
// spells no gesture of its own.

/**
 * Where the build put item `index` of the menu the current screen shows.
 *
 * Fails by assertion when the build reports no region for an item its own menu
 * shows, so the point names that fault rather than dividing by a `null` several
 * lines later. A check that is ABOUT the reading returning `null` — on
 * `countdown`, on `playing`, or past the end of a menu — calls
 * `h.debug.menuItemRect` directly.
 */
export async function menuRect(
  h: AnyHarness,
  index: number,
): Promise<MenuRect> {
  const rect = await h.debug.menuItemRect(index);
  assertTruthy(
    rect,
    `menuItemRect(${index}) must report the hit region of item ${index} on the ` +
      "menu the current screen shows (specs/instrumentation.md)",
  );
  return rect as MenuRect;
}

/** The middle of a hit region: where a gesture aimed at that item lands. */
export function rectCenter(rect: MenuRect): { x: number; y: number } {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/** Move the real mouse to a logical point, and run the frame that reads it. */
export function pointerTo(h: AnyHarness, x: number, y: number): Promise<void> {
  return mouseGlide(h, x, y);
}

/** Move the real mouse onto item `index`, and run the frame that reads it. */
export async function pointerOntoItem(
  h: AnyHarness,
  index: number,
): Promise<void> {
  const at = rectCenter(await menuRect(h, index));
  await mouseGlide(h, at.x, at.y);
}

/**
 * Move the real mouse onto item `index` and run NO frame.
 *
 * The one gesture part that drives no frame of its own, for the one check that
 * needs a pointer move and a key edge to land in the SAME input read:
 * specs/ui.md reads the pointer once per frame, in the same read as the keyboard
 * actions, and applies it after that frame's keyboard edges. Every other part of
 * a gesture runs its own frame, so a caller counting frames adds this move to
 * the frame it drives itself.
 */
export async function aimPointerAtItem(
  h: AnyHarness,
  index: number,
): Promise<void> {
  const at = rectCenter(await menuRect(h, index));
  const css = h.css(at.x, at.y);
  await h.page.mouse.move(css.x, css.y);
}

/**
 * Press and release the real mouse at one logical point: two driven frames.
 *
 * A point outside every item's region is a gesture that confirms nothing, which
 * is the ordinary case `specs/ui.md` states and a check reads back.
 */
export async function clickAt(
  h: AnyHarness,
  x: number,
  y: number,
): Promise<void> {
  await mousePress(h, x, y);
  await mouseRelease(h);
}

/** Press and release the real mouse inside item `index`'s region. */
export async function clickItem(h: AnyHarness, index: number): Promise<void> {
  const at = rectCenter(await menuRect(h, index));
  await clickAt(h, at.x, at.y);
}

/**
 * Press on one item, travel to another, and release there: three driven frames.
 *
 * The two edges fall in different regions, so this confirms nothing — the
 * affordance that lets a player slide off a control to cancel, which
 * `specs/ui.md` states and a check reads back as a `menuIndex` that moved and a
 * screen that did not.
 */
export async function dragBetweenItems(
  h: AnyHarness,
  from: number,
  to: number,
): Promise<void> {
  const start = rectCenter(await menuRect(h, from));
  const end = rectCenter(await menuRect(h, to));
  await mousePress(h, start.x, start.y);
  await mouseGlide(h, end.x, end.y);
  await mouseRelease(h);
}

/** Land a real touch contact at a logical point and lift it: two driven frames. */
export async function tapAt(
  h: AnyHarness,
  x: number,
  y: number,
): Promise<void> {
  await touchPress(h, x, y);
  await touchRelease(h);
}

/**
 * Land a real touch contact inside item `index`'s region and lift it there.
 *
 * The landing selects the item as well as confirming it, because a finger does
 * not hover (specs/ui.md) — which is the difference between this and
 * {@link clickItem}, and the reason both exist.
 */
export async function tapItem(h: AnyHarness, index: number): Promise<void> {
  const at = rectCenter(await menuRect(h, index));
  await tapAt(h, at.x, at.y);
}

/** Land a contact on one item, travel to another, and lift there: confirms nothing. */
export async function touchBetweenItems(
  h: AnyHarness,
  from: number,
  to: number,
): Promise<void> {
  const start = rectCenter(await menuRect(h, from));
  const end = rectCenter(await menuRect(h, to));
  await touchPress(h, start.x, start.y);
  await touchGlide(h, end.x, end.y);
  await touchRelease(h);
}

/* -------------------------------------------------------------------------- */
/* Scenario helpers                                                           */
/* -------------------------------------------------------------------------- */
//
// Each of these poses a situation through `window.__carom` and then lets the real
// simulation run. The geometry and the tolerances they encode are the ones the
// case established, and they are the same in the engine-backed project next door.

/* ---- Goals --------------------------------------------------------------- */

/**
 * Aim the ball at one goal edge down an empty field. `edge` is the edge the ball
 * exits: "right" scores for player one, "left" for player two.
 *
 * A scored point is about a ball and a goal edge, so the obstacles come off the
 * field and the paddles move out of the way. Nothing is left for the shot to
 * meet on the way, under every variant and at every obstacle pose.
 */
export async function arrangeGoal(h: AnyHarness, edge: Side): Promise<void> {
  await isolateBall(h);
  await clearPaddles(h);
  await placeBall(h, {
    x: FIELD_CX,
    y: FIELD_CY,
    vx: edge === "right" ? 600 : -600,
  });
}

/**
 * Run the real physics until the point resolves — a scored point returns to the
 * countdown, a match point to the match-over screen — and report that instant.
 */
export function driveGoal(
  h: AnyHarness,
  options: UntilOptions = {},
): Promise<UntilResult> {
  return h.until((s) => s.screen !== "playing", {
    maxFrames: options.maxFrames ?? 360,
    poll: options.poll ?? 6,
  });
}

/* ---- Paddle contact ------------------------------------------------------ */

/** Where a ball is posed to sit just off a paddle's front face. */
export function nearBallX(side: Side): number {
  return side === "left" ? P1_X1 + BALL_R + 10 : P2_X0 - BALL_R - 10;
}

export interface PaddleHitOptions {
  /** Where the struck paddle is when the ball arrives. */
  cy?: number;
  /** The velocity it holds through the run-up and the contact, in px/s. */
  vy?: number;
  /** The height the ball arrives at. */
  ballY?: number;
  /** How fast the ball approaches, in px/s. */
  approachSpeed?: number;
  /** An explicit start x, for a contact whose paddle must not be led upstream. */
  startX?: number;
  /** Frames of approach posed in front of the contact. */
  leadTicks?: number;
}

/**
 * Pose a contact on `side`: that paddle at `cy` moving at `vy`, the other held
 * out of the way, a ball aimed straight at the struck paddle's front face at
 * `ballY`, and nothing else on the field.
 *
 * BOTH PADDLES ARE TAKEN FROM THE PLAYER here, and that is what this scenario
 * is for: the paddles are the instrument of the contact being measured, and a
 * paddle the AI could still move would make the reading the AI's. A check about
 * a paddle the PLAYER moves opens its match with {@link openCountdown} or
 * {@link startPlaying}, which take nothing, and presses keys.
 *
 * With a lead, the paddle starts the run-up's worth of travel UPSTREAM so it
 * arrives at `cy` as the ball does — which is what lets a swinging paddle really
 * be moving at contact rather than pinned against a bound.
 */
export async function arrangePaddleHit(
  h: AnyHarness,
  side: Side,
  options: PaddleHitOptions = {},
): Promise<void> {
  const {
    cy = FIELD_CY,
    vy = 0,
    ballY = FIELD_CY,
    approachSpeed = 400,
    startX,
    leadTicks = 0,
  } = options;

  const other: Side = side === "left" ? "right" : "left";
  const lead = seconds(leadTicks);

  await isolateBall(h);
  await takePaddle(h, side, vy);
  await h.debug.setPaddleCy(side, cy - vy * lead);
  await takePaddle(h, other, 0);
  await h.debug.setPaddleCy(other, PARKED_CY);

  const near = nearBallX(side);
  const runUp = approachSpeed * lead;
  const x = startX ?? (side === "left" ? near + runUp : near - runUp);
  await placeBall(h, {
    x,
    y: ballY,
    vx: side === "left" ? -approachSpeed : approachSpeed,
  });
}

export interface PaddleHitResult {
  hit: boolean;
  ball: BallView;
  /** The struck paddle, at the instant of the rebound. */
  paddle: { cy: number; vy: number };
  snapshot: CaromSnapshot;
}

/**
 * Run the real simulation until the ball comes off `side`'s front face, and
 * report the ball the instant it rebounds — before spin decays or curves the
 * flight. Sampled every frame, because the instant is what is read.
 */
export async function drivePaddleHit(
  h: AnyHarness,
  side: Side,
  options: { maxFrames?: number; leadTicks?: number } = {},
): Promise<PaddleHitResult> {
  const maxFrames = (options.maxFrames ?? 72) + (options.leadTicks ?? 0);
  const rebounded =
    side === "left"
      ? (s: CaromSnapshot): boolean => ball0(s).vx > 0
      : (s: CaromSnapshot): boolean => ball0(s).vx < 0;
  const swept = await h.until(rebounded, { maxFrames, poll: 1 });
  return {
    hit: swept.hit,
    ball: ball0(swept.snapshot),
    paddle: swept.snapshot.paddles[side],
    snapshot: swept.snapshot,
  };
}

/* ---- Rally speed --------------------------------------------------------- */

/**
 * The speed the rally is launched at, in units per second.
 *
 * Below `SERVE_SPEED` so the climb to `SPEED_CAP` takes a hit or two more than a
 * served ball would, and a round number so the number of hits a check must drive
 * to reach the ceiling follows from it and `SPEED_MULT` alone.
 */
export const RALLY_LAUNCH_SPEED = 500;

/**
 * The paddle hits it takes `SPEED_MULT` to carry {@link RALLY_LAUNCH_SPEED} to
 * `SPEED_CAP`.
 *
 * The two rally checks state their lengths in terms of it rather than picking a
 * number: one hit short of it is the last one the multiplier decides on its own,
 * and one past it is the first spent sitting on the ceiling.
 */
export const RALLY_HITS_TO_CAP = Math.ceil(
  Math.log(SPEED_CAP / RALLY_LAUNCH_SPEED) / Math.log(SPEED_MULT),
);

/**
 * Frames between samples while a rally leg is swept.
 *
 * A leg is the ball crossing between the two paddle faces, and the shortest one
 * it can be is that distance covered at `SPEED_CAP`; sampling eight times inside
 * even that leg catches every reversal. A per-frame sweep would cost eight times
 * as much to read frames between which nothing this collects can change: a ball's
 * speed only ever changes at a paddle hit, and walls and obstacles preserve it
 * exactly, so a sample taken a few frames after a hit reports the same figure the
 * frame of the hit would. Under this engineless harness every one of those frames
 * is also a crossing into the page, so the saving is paid straight back into the
 * per-check allowance the whole rally has to fit inside.
 */
const RALLY_POLL_FRAMES = Math.max(
  1,
  Math.floor((((P2_X0 - P1_X1) / SPEED_CAP) * TICK_HZ) / 8),
);

/**
 * A live match, an empty field but for one ball, both paddles standing on the
 * center line, and the ball launched level down the middle.
 *
 * The paddles are left with the player, and in a Versus match with no key held
 * they stand exactly where they were put — so the rally is played by two still
 * paddles and the only thing that changes the ball's speed is the paddle-hit
 * rule under measurement.
 */
export async function arrangeRally(h: AnyHarness): Promise<void> {
  await startPlaying(h);
  await isolateBall(h);
  await centerPaddles(h);
  await placeBall(h, { x: FIELD_CX, y: FIELD_CY, vx: -RALLY_LAUNCH_SPEED });
}

/**
 * Play a real rally of `hits` paddle hits and report the ball's speed after each
 * one. Speed is constant between hits, so each leg sweeps coarsely until the
 * horizontal direction reverses. Stops early if play ever leaves the field.
 *
 * `hits` has no default: a rally is the most expensive scenario in this suite,
 * every leg of it is real physics rendered frame by frame, and how many legs a
 * check needs follows from what that check decides. Each caller states its own.
 */
export async function driveRallySpeeds(
  h: AnyHarness,
  hits: number,
): Promise<number[]> {
  const speeds: number[] = [];
  let previousSign = -1; // the ball is launched toward the left paddle

  for (let hit = 0; hit < hits; hit += 1) {
    const sign = Math.sign(ball0(await h.snapshot()).vx);
    if (sign !== 0) previousSign = sign;
    const want = -previousSign;

    let leftPlay = false;
    const leg = await h.until(
      (s) => {
        if (s.screen !== "playing") {
          leftPlay = true;
          return true;
        }
        const ball = ball0(s);
        return Math.sign(ball.vx) === want && ball.vx !== 0;
      },
      { maxFrames: 600, poll: RALLY_POLL_FRAMES },
    );
    if (leftPlay || !leg.hit) break;
    speeds.push(ball0(leg.snapshot).speed);
    previousSign = want;
  }
  return speeds;
}

/* ---- Held movement ------------------------------------------------------- */

export interface MoveResult {
  start: number;
  end: number;
  /** The moved paddle's Δcy: negative is upward. */
  delta: number;
  /** Each paddle's Δcy, so a check can also confirm the other stayed still. */
  otherDelta: { left: number; right: number };
}

/**
 * Hold a REAL key for `ticks` frames and report how far each paddle moved.
 *
 * The key is pressed through Chromium's own input pipeline, not through the
 * surface — under this engine the surface carries no keyboard operation at all,
 * because the keyboard is part of the runtime layer the build wrote
 * (`specs/instrumentation.md`). Nothing here takes a paddle either, so the game
 * stays under normal player control and the paddles respond exactly as they do
 * for a player.
 */
export async function holdMove(
  h: AnyHarness,
  side: Side,
  code: string,
  options: { ticks?: number; leadTicks?: number } = {},
): Promise<MoveResult> {
  const ticks = options.ticks ?? 36; // 0.3 s
  const lead = options.leadTicks ?? 0;
  await h.hold(code);
  // With a lead, the key is already down for `lead` frames before the measured
  // window opens, so the window reads a paddle in steady travel rather than the
  // frame the press was first seen on.
  if (lead > 0) await h.advance(lead);
  const before = (await h.snapshot()).paddles;
  await h.advance(ticks);
  const after = (await h.snapshot()).paddles;
  await h.release(code);

  const moved = (which: Side): number => after[which].cy - before[which].cy;
  return {
    start: before[side].cy,
    end: after[side].cy,
    delta: moved(side),
    otherDelta: { left: moved("left"), right: moved("right") },
  };
}

/* ---- The Solo AI --------------------------------------------------------- */

/**
 * A live Solo match on an empty field, the human paddle parked, ball 0 posed by
 * `ball`, the AI paddle started at `paddleCy`, and the AI holding both its
 * faculties. Running time forward from here pits the real opponent against the
 * posed shot.
 *
 * NEITHER PADDLE IS TAKEN. The AI moves its paddle only while that paddle is the
 * AI's, so a scenario about the AI must leave it alone; the human paddle is
 * merely put out of the way, and in Solo with no key held nothing moves it.
 */
export async function arrangeAiScenario(
  h: AnyHarness,
  scenario: {
    paddleCy: number;
    ball: { x: number; y: number; vx: number; vy?: number };
  },
): Promise<void> {
  await startPlaying(h, "solo");
  await isolateBall(h);
  await enableAi(h);
  await h.debug.setPaddleCy("left", PARKED_CY);
  await h.debug.setPaddleCy("right", scenario.paddleCy);
  await placeBall(h, scenario.ball);
}

export type AiOutcome = "blocked" | "scored" | "timeout";

/**
 * Run the posed Solo shot to its resolution.
 *
 * "blocked" — the AI reached the ball and sent it back. "scored" — the shot got
 * past it and player one's score went up. The ball must be SEEN travelling toward
 * the AI before a leftward velocity can count as a block, so the posed approach
 * itself never reads as one.
 */
export async function driveAiScenario(
  h: AnyHarness,
  options: UntilOptions = {},
): Promise<{ result: AiOutcome; snapshot: CaromSnapshot }> {
  const start = (await h.snapshot()).score.p1;
  let sawIncoming = false;
  let result: AiOutcome = "timeout";

  const swept = await h.until(
    (s) => {
      const ball = ball0(s);
      if (ball.vx > 0) sawIncoming = true;
      if (s.score.p1 > start) {
        result = "scored";
        return true;
      }
      if (sawIncoming && ball.vx < 0 && ball.x < FIELD_W) {
        result = "blocked";
        return true;
      }
      return false;
    },
    { maxFrames: options.maxFrames ?? 480, poll: options.poll ?? 2 },
  );
  return { result, snapshot: swept.snapshot };
}

/**
 * A live Solo match with the AI paddle far from a ball moving toward it, so the
 * real opponent chases at its own speed for as long as a check watches.
 */
export async function arrangeAiChase(
  h: AnyHarness,
  options: { paddleCy?: number; ballY?: number } = {},
): Promise<void> {
  await arrangeAiScenario(h, {
    paddleCy: options.paddleCy ?? 120,
    ball: { x: FIELD_CX, y: options.ballY ?? 650, vx: 200 },
  });
}

/** How fast the AI paddle travels while it is chasing, in px/s. */
export async function driveAiChaseSpeed(
  h: AnyHarness,
  options: { ticks?: number } = {},
): Promise<{ speed: number; delta: number }> {
  const ticks = options.ticks ?? 12;
  const before = (await h.snapshot()).paddles.right.cy;
  await h.advance(ticks);
  const after = (await h.snapshot()).paddles.right.cy;
  return {
    speed: speedOverTicks(after - before, ticks),
    delta: after - before,
  };
}

/**
 * A live Solo match with a ball aimed to arrive at the AI's front face while the
 * AI is still sweeping down through the lane, so it strikes while moving.
 */
export async function arrangeAiMovingHit(h: AnyHarness): Promise<void> {
  await arrangeAiScenario(h, {
    paddleCy: 180, // above the lane
    ball: { x: 1072, y: FIELD_CY, vx: 500 },
  });
}

/* ---- Obstacle bank shots -------------------------------------------------- */

/** A shot aimed straight at one face of one obstacle, from one side of it. */
export interface ObstacleShot {
  /** The obstacle struck, in the order of `OBSTACLE_CENTERS`. */
  obstacle: number;
  /** The x of the face it is aimed at. */
  faceX: number;
  /** The height it travels at. */
  y: number;
  /** The side it approaches from. */
  from: Side;
  /** How fast, in units per second. */
  speed?: number;
}

/**
 * Line the ball up 180 px short of `faceX`, level with the obstacle at `y`,
 * travelling straight at that face, on a field holding that obstacle alone.
 *
 * The OTHER obstacle comes off the field rather than being reasoned around: a
 * bank shot is about the one body it strikes, and under `gyre` the other one
 * sways across the field anyway, so there is no geometry that would keep it
 * clear at every clock value.
 */
export async function arrangeObstacleBounce(
  h: AnyHarness,
  shot: ObstacleShot,
): Promise<void> {
  const speed = shot.speed ?? 600;
  await isolateBall(h, 0, [shot.obstacle]);
  await clearPaddles(h);
  await placeBall(h, {
    x: shot.from === "left" ? shot.faceX - 180 : shot.faceX + 180,
    y: shot.y,
    vx: shot.from === "left" ? speed : -speed,
  });
}

/** Run the real collision until the ball reflects off the struck face. */
export function driveObstacleBounce(
  h: AnyHarness,
  from: Side,
  options: UntilOptions = {},
): Promise<UntilResult> {
  const reversed =
    from === "left"
      ? (s: CaromSnapshot): boolean => ball0(s).vx < 0
      : (s: CaromSnapshot): boolean => ball0(s).vx > 0;
  return h.until(reversed, {
    maxFrames: options.maxFrames ?? 240,
    poll: options.poll ?? 1,
  });
}

/* ---- Per-face bank shots -------------------------------------------------- */

/** One face of an axis-aligned obstacle. */
export type Face = "left" | "right" | "top" | "bottom";

/**
 * How far short of the struck face a per-face shot starts, in logical units.
 *
 * Long enough for a real approach and short enough that every shot starts on
 * the field: obstacle A's top face is 150 units below the top wall, so a shot at
 * it starts `BALL_R` plus a little clear of that wall.
 */
export const FACE_RUN_UP = 120;

/**
 * The approach speed of a per-face shot, in units per second.
 *
 * Chosen so a frame of the suite's clock is ONE sub-step: `speed * dt` is under
 * `MAX_SUBSTEP`, so `n = 1` (specs/balls.md) and the frame the reflection
 * resolves on ends with the ball exactly where the rule placed it — `BALL_R` off
 * the face — with nothing moving it on before the read.
 */
export const FACE_SHOT_SPEED = 400;

/**
 * Where a ball reflecting off `face` of `rect` is placed by the rule
 * (specs/balls.md): its center `BALL_R` off that face.
 */
export function restingOff(rect: Rect, face: Face): number {
  switch (face) {
    case "left":
      return rect.x0 - BALL_R;
    case "right":
      return rect.x1 + BALL_R;
    case "top":
      return rect.y0 - BALL_R;
    case "bottom":
      return rect.y1 + BALL_R;
  }
}

/**
 * Line the ball up `FACE_RUN_UP` units off `face` of obstacle `obstacle`, at the
 * midpoint of that face, travelling straight into it at `FACE_SHOT_SPEED`, on a
 * field holding that obstacle alone.
 *
 * Named by INDEX rather than by rectangle, because the scenario has to spawn the
 * obstacle it is about — and `OBSTACLES[obstacle]` is the same rectangle a check
 * then measures the reflection against.
 */
export async function arrangeFaceShot(
  h: AnyHarness,
  obstacle: number,
  face: Face,
): Promise<void> {
  const rect = OBSTACLES[obstacle];
  await isolateBall(h, 0, [obstacle]);
  await clearPaddles(h);
  const cx = (rect.x0 + rect.x1) / 2;
  const cy = (rect.y0 + rect.y1) / 2;
  const off = restingOff(rect, face);
  const pose: BallPose =
    face === "left"
      ? { x: off - FACE_RUN_UP, y: cy, vx: FACE_SHOT_SPEED }
      : face === "right"
        ? { x: off + FACE_RUN_UP, y: cy, vx: -FACE_SHOT_SPEED }
        : face === "top"
          ? { x: cx, y: off - FACE_RUN_UP, vy: FACE_SHOT_SPEED }
          : { x: cx, y: off + FACE_RUN_UP, vy: -FACE_SHOT_SPEED };
  await placeBall(h, pose);
}

/**
 * Run the real collision until the velocity component normal to `face` has
 * reversed, sampling every frame so the read is the frame of the reflection.
 */
export function driveFaceBounce(
  h: AnyHarness,
  face: Face,
  options: UntilOptions = {},
): Promise<UntilResult> {
  const reversed = (s: CaromSnapshot): boolean => {
    const ball = ball0(s);
    switch (face) {
      case "left":
        return ball.vx < 0;
      case "right":
        return ball.vx > 0;
      case "top":
        return ball.vy < 0;
      case "bottom":
        return ball.vy > 0;
    }
  };
  return h.until(reversed, {
    maxFrames: options.maxFrames ?? 240,
    poll: options.poll ?? 1,
  });
}

/* ---- A ball in open flight ------------------------------------------------ */

/**
 * A live match with the ball posed in mid-flight on an empty field, so a short
 * flight is a straight line and a bounce is a bounce off the wall alone.
 *
 * Spin is zero unless the pose names one, which is what a spin check sets.
 */
export async function arrangeLiveBall(
  h: AnyHarness,
  ball: BallPose,
  mode: Mode = "versus",
): Promise<void> {
  await startPlaying(h, mode);
  await isolateBall(h);
  await clearPaddles(h);
  await placeBall(h, ball);
}

/* ========================================================================== */
/* Rendering, input and colour                                                */
/* ========================================================================== */

/* ---- Controls tolerances -------------------------------------------------- */

/**
 * A clearly non-trivial paddle displacement, in logical px.
 *
 * The controls checks are about which paddle a key moves and which way, not how
 * fast — the speed is the `paddle-movement` category's point, and stating it in
 * both places would fail one build twice for one fault. At the specified 720 px/s
 * the 36-frame hold travels 216 px, so this bound is crossed several times over by
 * any build in the right ballpark and never by one that did not move.
 */
export const MOVE_MIN = 40;

/** How far a paddle a key must NOT touch may drift, in logical px. */
export const STILL_MAX = 6;

/* ---- Colour --------------------------------------------------------------- */

/**
 * How far two readings of the SAME unchanged ground may sit apart, in RGB
 * distance, and still be the same ground: rasterization rounding and nothing
 * else.
 *
 * The specification fixes no palette (specs/overview.md), so what a colour check
 * reads is PRESENCE: the same point sampled with a body standing on it and again
 * with the field bare under it. This floor is what separates "the build drew
 * something here" from two reads of one pixel, and nothing beyond presence — no
 * palette, no contrast, no separation between two bodies — is asserted anywhere.
 */
export const READ_NOISE = 8;

/** The obstacle the colour scene keeps on the field: the first one. */
export const COLOR_OBSTACLE = 0;

/**
 * Where {@link arrangeColorScene} parks the ball: a clean mid-field spot, clear
 * of the paddles, of the obstacle it keeps, and of the net.
 */
export const COLOR_BALL_AT = { x: 300, y: FIELD_CY } as const;

/**
 * Where {@link arrangeBareScene} sends the ball instead: down near the bottom of
 * the field, clear of every point {@link colorPoints} reads.
 */
export const BARE_BALL_AT = { x: FIELD_CX, y: 650 } as const;

/** The bodies the colour checks sample. */
export type ColorBody = "leftPaddle" | "rightPaddle" | "obstacle" | "ball";

/** Where each body stood, and the colour the canvas held there. */
export interface SceneSample {
  /** The points the reading was taken at, for a second reading at the same ones. */
  at: Record<ColorBody, { x: number; y: number }>;
  /** What the canvas held at each of those points. */
  color: Record<ColorBody, Rgb>;
}

/**
 * Where each body the colour checks sample actually IS, read off the snapshot.
 *
 * Read rather than assumed, which is what lets one scene serve every variant: a
 * `gyre` obstacle sways and turns, so its center is wherever the build's own
 * formulas put it this frame, and the alternative — holding the obstacle clock
 * still so the constant stays true — would be posing a body to suit the reading
 * rather than reading the body. A rectangle's center is inside it at every
 * rotation, and each paddle's center is 8 px from its nearest edge, so every
 * sample here sits well inside a solid body: the margin is the point, because a
 * curved or rounded edge is anti-aliased and blends toward whatever is behind it.
 */
export async function colorPoints(
  h: AnyHarness,
): Promise<Record<ColorBody, { x: number; y: number }>> {
  const snapshot = await h.snapshot();
  const obstacle = snapshot.obstacles[0];
  assertTruthy(
    obstacle,
    "snapshot().obstacles must report the obstacle spawnObstacle placed " +
      "(specs/instrumentation.md)",
  );
  const ball = ball0(snapshot);
  return {
    leftPaddle: { x: (P1_X0 + P1_X1) / 2, y: snapshot.paddles.left.cy },
    rightPaddle: { x: (P2_X0 + P2_X1) / 2, y: snapshot.paddles.right.cy },
    obstacle: { x: obstacle.cx, y: obstacle.cy },
    ball: { x: ball.x, y: ball.y },
  };
}

/**
 * Read the canvas at four named points, as it stands.
 *
 * The shared reading's default sample radius is what this case wants: 4 logical
 * units out, which stays inside the solid body of every shape sampled, so one
 * stray anti-aliased or glow pixel cannot swing it.
 */
export async function sampleAt(
  h: AnyHarness,
  at: Record<ColorBody, { x: number; y: number }>,
): Promise<Record<ColorBody, Rgb>> {
  return {
    leftPaddle: await sampleColor(h, at.leftPaddle.x, at.leftPaddle.y),
    rightPaddle: await sampleColor(h, at.rightPaddle.x, at.rightPaddle.y),
    obstacle: await sampleColor(h, at.obstacle.x, at.obstacle.y),
    ball: await sampleColor(h, at.ball.x, at.ball.y),
  };
}

/** Where every body of {@link colorPoints} stands, and what the canvas holds there. */
export async function sampleScene(h: AnyHarness): Promise<SceneSample> {
  const at = await colorPoints(h);
  return { at, color: await sampleAt(h, at) };
}

/**
 * Pose a clean, static colour scene and paint it: a live match holding one ball
 * and one obstacle, both paddles centred, and the ball parked in the clear at
 * {@link COLOR_BALL_AT}, so each body renders unobstructed and solid.
 *
 * The settle is longer than the trail's own life on purpose. Posing the ball
 * teleports it, and the samples it left along the way would otherwise still be
 * drawn as a streak across the field; a still ball for `TRAIL_TIME` retires
 * every one of them, so what is sampled is the ball rather than its wake.
 */
export async function arrangeColorScene(h: AnyHarness): Promise<void> {
  await startPlaying(h, "versus");
  await isolateBall(h, 0, [COLOR_OBSTACLE]);
  await centerPaddles(h);
  await placeBall(h, COLOR_BALL_AT);
  await h.advance(Math.ceil(TRAIL_TIME * TICK_HZ) + 4);
}

/**
 * Re-pose the same live match with the field bare under every point
 * {@link colorPoints} named, so those points can be read a second time with
 * nothing standing on them.
 *
 * The obstacle comes off the field outright and the ball goes to
 * {@link BARE_BALL_AT}, with the same settle {@link arrangeColorScene} takes so
 * its wake is retired again. One ball is left on the field rather than none,
 * because an empty field is a state the match rules are free to serve into. Both
 * paddles go to `PADDLE_MIN_CY`, the top of the travel specs/playfield.md gives
 * them: a paddle centred there spans the field's top 110 units, which clears the
 * mid-field row {@link arrangeColorScene} sampled it on outright. Neither paddle
 * is taken from the player, and in a Versus match with no key held nothing moves
 * them back.
 *
 * Called on a match {@link arrangeColorScene} already opened.
 */
export async function arrangeBareScene(h: AnyHarness): Promise<void> {
  await isolateBall(h, 0, []);
  await clearPaddles(h, PADDLE_MIN_CY);
  await placeBall(h, BARE_BALL_AT);
  await h.advance(Math.ceil(TRAIL_TIME * TICK_HZ) + 4);
}
