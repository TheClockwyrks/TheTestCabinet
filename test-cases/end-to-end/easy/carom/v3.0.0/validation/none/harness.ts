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
// one step of the build's surface, reading pixels and draw calls back out, and
// writing the evidence a review point declares — every engineless case needs
// exactly that, and it lives once, in `@test-cabinet/case-harness`, staged beside
// this file as `./case-harness/`. What is left here is what is genuinely Carom's:
// the shape of its snapshot, the operations its `specs/instrumentation.md`
// requires, and the scenario helpers that park a paddle, arrange a bank shot and
// pose a colour scene.
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
// THE CLOCK IS THE SURFACE'S. Nothing outside an engineless build owns its loop,
// so `specs/instrumentation.md` puts the clock on the surface: `setAutoStep(false)`
// takes the game off real time and `advance(seconds, frames)` runs whole frames
// of a chosen length. Every harness opens by taking the game off the clock, so a
// check asks for a number of frames and gets exactly that number — no polling, no
// waiting, and no measurement of the machine it ran on. The one check that is
// ABOUT the loop running itself (`gameplay/advances-in-real-time`) hands it back
// with `runFor`.
//
// EVERYTHING CROSSING INTO THE PAGE IS ASYNC. That is the whole of the difference
// between a suite here and its counterpart under an engine: `await h.snapshot()`
// rather than `h.snapshot()`, `await h.debug.setBall(...)` rather than
// `h.debug.setBall(...)`. The scenarios, the tolerances, and the assertions are
// the same ones, because they are the case's rather than the runtime's.

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createCaseHarness,
  darkestOf,
  sampleColor,
  type Harness as BaseHarness,
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
  OBSTACLE_CENTERS,
  P1_X0,
  P1_X1,
  P2_X0,
  P2_X1,
  TRAIL_TIME,
  UNBOUND_KEY,
  type Rect,
} from "./constants";

/* -------------------------------------------------------------------------- */
/* The contract the build owes                                                */
/* -------------------------------------------------------------------------- */

/** The handle an engineless build installs its surface on. */
export const HANDLE = "__carom";

/**
 * Every operation `specs/instrumentation.md` requires on the surface under this
 * engine, including the two clock operations that exist only here.
 *
 * Written out in full rather than spread over the shared harness's
 * `BASE_REQUIRED_OPS`: this list is what a build is told to install, in the order
 * the specification introduces them, and it is the order a missing-operation
 * fault names them back in.
 */
export const REQUIRED_OPS = [
  "setAutoStep",
  "advance",
  "reset",
  "snapshot",
  "startMatch",
  "serve",
  "setScore",
  "setPaddle",
  "setBall",
  "setAiControl",
] as const;

/** The version the surface reports (`CAROM_DEBUG_VERSION`). */
export const CAROM_DEBUG_VERSION = 1;

/** One side of the field. */
export type Side = "left" | "right";

/** The two ways to play. */
export type Mode = "solo" | "versus";

/** One ball, as a snapshot reports it. */
export interface BallView {
  x: number;
  y: number;
  vx: number;
  vy: number;
  speed: number;
  spin: number;
  held: boolean;
}

/**
 * The state a snapshot reports, as `specs/instrumentation.md` documents it.
 *
 * The balls are the one part of the shape the variant decides. `base` and `gyre`
 * play with a single ball and report it as `ball`; `multi` plays with three,
 * independent of each other, and reports them as `balls` in play order. A check
 * shared by every variant reaches the ball it drives through {@link ball0}
 * rather than either field, so the same suite reads the same ball whichever
 * variant the build was written for.
 */
export interface CaromSnapshot {
  version: number;
  screen: "title" | "howto" | "countdown" | "playing" | "paused" | "matchover";
  mode: Mode;
  score: { p1: number; p2: number };
  winner: Side | null;
  muted: boolean;
  paddles: Record<Side, { cy: number; vy: number }>;
  /** The base and gyre variants: the single ball in play. */
  ball?: BallView;
  /** The multi variant: all three balls, in play order. */
  balls?: BallView[];
  simTime: number;
  /** The gyre variant alone; see `gyre/harness.ts`. */
  obstacles?: { cx: number; cy: number; theta: number }[];
}

/**
 * The ball every shared scenario drives: the only one under `base` and `gyre`,
 * and the first of the three under `multi`.
 *
 * The variants agree about what a ball IS and disagree only about how many there
 * are, so a check about the ball — its bounce, its spin, its speed off a paddle —
 * is the same check under all three, driven against ball zero. What makes that
 * sound under `multi` is {@link parkSpares}, which puts the other two balls out
 * of the scenario before it is posed, so the reading is of the driven ball alone.
 *
 * A build reporting neither shape fails by assertion here rather than throwing a
 * `TypeError` several frames later, so the point names the fault.
 */
export function ball0(snapshot: CaromSnapshot): BallView {
  const one = snapshot.ball ?? snapshot.balls?.[0];
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
  return snapshot.ball === undefined ? [] : [snapshot.ball];
}

/** The operations a check poses the game through. Every one crosses into the page. */
export interface CaromDebugApi {
  setAutoStep(enabled: boolean): Promise<void>;
  advance(seconds: number, frames?: number): Promise<void>;
  reset(options?: { seed?: number }): Promise<void>;
  snapshot(): Promise<CaromSnapshot>;
  startMatch(mode: Mode): Promise<void>;
  serve(): Promise<void>;
  setScore(p1: number, p2: number): Promise<void>;
  setPaddle(side: Side, state: { cy?: number; vy?: number }): Promise<void>;
  setBall(
    index: number,
    state: { x?: number; y?: number; vx?: number; vy?: number; spin?: number },
  ): Promise<void>;
  setAiControl(enabled: boolean): Promise<void>;
}

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
 * `projectRoot` comes from THIS module and must never come from the package's:
 * the package is staged one directory deeper than this file, and a produced
 * replay or still is addressed by the running suite's path relative to the
 * project root. Taken from the package it would address every output one level
 * too deep — and silently, because a writer that raised on a failed write would
 * be blaming the build for the host's problem, so neither of them raises.
 */
const kit = createCaseHarness<CaromSnapshot, CaromDebugApi>({
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
  // `specs/controls.md` leaves this key bound to nothing, so arming changes no
  // game state.
  arm: { kind: "key", code: UNBOUND_KEY },
  // A build installs its surface while its entry module runs, so a page that has
  // fired `load` has either installed it already or is not going to. Five seconds
  // is generous against a conformant build and bounds the cost of one with no
  // surface at all, which pays it once per harness.
  surfaceTimeoutMs: 5_000,
  projectRoot: dirname(fileURLToPath(import.meta.url)),
});

export const {
  createHarness,
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
 * Everything a check reads off one page running this build.
 *
 * A bound alias of the shared harness's interface, so every
 * `import { type Harness } from "../harness"` next door goes on naming a harness
 * whose `snapshot()` is a {@link CaromSnapshot} and whose `debug` is a
 * {@link CaromDebugApi}.
 */
export type Harness = BaseHarness<CaromSnapshot, CaromDebugApi>;

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
  drewText,
  retable,
  sampleColor,
  setsOf,
  textDraws,
  thinReplay,
} from "./case-harness/index";

/**
 * The ground a replay of this case is composited over.
 *
 * The shared harness's default, under the name this project's own checks read it
 * by: `index.html` paints the page black and the build draws over it, so a
 * recording replayed on anything else shows a picture the build never made.
 */
export { DEFAULT_REPLAY_BACKGROUND as REPLAY_BACKGROUND } from "./case-harness/index";

/** The angle from horizontal of a velocity, in degrees, ignoring direction. */
export function angleDeg(v: { vx: number; vy: number }): number {
  return (Math.atan2(Math.abs(v.vy), Math.abs(v.vx)) * 180) / Math.PI;
}

/* -------------------------------------------------------------------------- */
/* Scenario helpers                                                           */
/* -------------------------------------------------------------------------- */
//
// Each of these poses a situation through `window.__carom` and then lets the real
// simulation run. The geometry and the tolerances they encode are the ones the
// case established, and they are the same in the engine-backed project next door.

/** Off-lane parking height for a paddle a scenario must keep out of the way. */
export const PARKED_CY = 150;

/** The lane down the middle of the field that clears both obstacles. */
export const CLEAR_LANE_Y = FIELD_CY;

/**
 * How far in front of a paddle contact the ball is posed, in frames of approach.
 *
 * The contact itself is the same one a zero-lead pose makes immediately; the
 * run-up buys the scenario a real approach, and — because a posed `vy` persists —
 * it is also what lets a SWINGING paddle be moving at the moment it strikes,
 * having travelled the same distance the ball did.
 */
export const LEAD_TICKS = 60; // 0.5 s at 120 Hz

/** Park both paddles out of the mid-field lane so a shot down it is unobstructed. */
export async function clearPaddles(h: Harness): Promise<void> {
  await h.debug.setPaddle("left", { cy: PARKED_CY, vy: 0 });
  await h.debug.setPaddle("right", { cy: PARKED_CY, vy: 0 });
}

/**
 * Where a scenario parks the balls it is not about, in logical units.
 *
 * `multi` puts three balls on the field and every shared check is about one of
 * them, so the other two are moved off the scenario before it is posed. These are
 * the two corners of the LEFT goal channel: inside the field, so a parked ball
 * scores nothing; behind the left paddle and clear of its x range at every
 * height, so it is never struck; and hard against two walls, which is the one
 * part of the field a driven ball does not cross. The shared scenarios aim down
 * the mid-field lane at `FIELD_CY`, at a paddle face, or at an obstacle, and the
 * one thing any of them sends past a goal edge leaves by the RIGHT one.
 *
 * A scenario that does drive a ball out of the left goal passes its own pair to
 * {@link parkSpares} instead; see `multi/harness.ts`.
 */
export const SPARE_PARKS: readonly { x: number; y: number }[] = [
  { x: BALL_R + 2, y: BALL_R + 2 },
  { x: BALL_R + 2, y: FIELD_H - BALL_R - 2 },
];

/**
 * Take every ball but the first out of the scenario, and report how many there
 * were.
 *
 * Under `base` and `gyre` there is one ball and this does nothing. Under `multi`
 * it poses balls one and two at {@link SPARE_PARKS}, motionless and spinless,
 * which `specs/instrumentation.md` says of `setBall` is what takes a ball into
 * live play and out of its hold — so they neither launch nor move again, and the
 * check that follows reads a field with one moving ball on it, exactly as it does
 * under the other two variants.
 */
export async function parkSpares(
  h: Harness,
  parks: readonly { x: number; y: number }[] = SPARE_PARKS,
): Promise<number> {
  const balls = allBalls(await h.snapshot());
  for (let index = 1; index < balls.length; index += 1) {
    const park = parks[(index - 1) % parks.length];
    await h.debug.setBall(index, { ...park, vx: 0, vy: 0, spin: 0 });
  }
  return balls.length;
}

/**
 * Hold the obstacles upright at their base centers, where the build has an
 * obstacle clock to hold.
 *
 * Under `gyre` the obstacles sway and rotate with the obstacle clock, so no
 * mid-field lane stays clear and no face stays axis-aligned. `setObstacleClock`
 * poses the clock and holds it there while the driver has the paddles
 * (specs/instrumentation.md), and clock `0` is the upright pose at the base
 * centers (specs/playfield.md): the field every shared scenario is written
 * against. The operation exists only under `gyre`, so this probes for it and is
 * a no-op under the other two variants, whose obstacles never move.
 *
 * The gyre-specific checks pose the clock themselves and never call this.
 */
export async function pinObstaclesUpright(h: Harness): Promise<void> {
  if (h.surfaceFault !== null) return;
  const { ops } = await h.probe(["setObstacleClock"]);
  if (ops.setObstacleClock !== "function") return;
  await (
    h.debug as unknown as { setObstacleClock(seconds: number): Promise<void> }
  ).setObstacleClock(0);
}

/**
 * Open a driven match, put every ball but the first out of the way, hold the
 * obstacles upright, and run it up to live play.
 *
 * `serve()` only expires the pre-serve hold; the LAUNCH is the build's own, on
 * the frame after. So this sweeps until the game reports live play, which is the
 * state every posed scenario below assumes — posing a ball while the game is
 * still counting down would have the build's serve overwrite the pose.
 *
 * The spares are parked between the match opening and the hold expiring, so under
 * `multi` the one ball that launches is the one the scenario is about.
 */
export async function startPlaying(
  h: Harness,
  mode: Mode = "versus",
): Promise<UntilResult> {
  await h.debug.reset();
  await h.debug.startMatch(mode);
  await parkSpares(h);
  await pinObstaclesUpright(h);
  await h.debug.serve();
  return h.until((s) => s.screen === "playing", { maxFrames: 60, poll: 1 });
}

/** Start a match from the title the way a player does: menu keys only. */
export async function startWithKeys(h: Harness, mode: Mode): Promise<void> {
  await h.debug.reset();
  // SOLO is the first entry; VERSUS is one down.
  if (mode === "versus") await h.tap("ArrowDown");
  await h.tap("Enter");
}

/**
 * Open a match on its pre-serve countdown through the debug surface alone:
 * `reset` to a clean title, `startMatch` onto the countdown, nothing else. This
 * is how a countdown scenario reaches its ground without driving the menus — a
 * build with a broken menu and a working countdown must fail the navigation
 * checks and pass the countdown ones. Because `startMatch` is a posing
 * operation, the opened match's paddles belong to the debug driver: a scenario
 * about the real input pipeline enters with {@link startWithKeys} instead, and
 * one that needs the hold already expired opens with {@link startPlaying}.
 */
export async function openCountdown(h: Harness, mode: Mode): Promise<void> {
  await h.debug.reset();
  await h.debug.startMatch(mode);
}

/* ---- Goals --------------------------------------------------------------- */

/**
 * Aim the ball at one goal edge, down the lane that clears both obstacles.
 * `edge` is the edge the ball exits: "right" scores for player one, "left" for
 * player two.
 */
export async function arrangeGoal(h: Harness, edge: Side): Promise<void> {
  await clearPaddles(h);
  await h.debug.setBall(0, {
    x: FIELD_CX,
    y: CLEAR_LANE_Y,
    vx: edge === "right" ? 600 : -600,
    vy: 0,
    spin: 0,
  });
}

/**
 * Run the real physics until the point resolves — a scored point returns to the
 * countdown, a match point to the match-over screen — and report that instant.
 */
export function driveGoal(
  h: Harness,
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
 * Pose a contact on `side`: that paddle at `cy` moving at `vy`, the other parked,
 * and a ball aimed straight at the struck paddle's front face at `ballY`.
 *
 * With a lead, the paddle starts the run-up's worth of travel UPSTREAM so it
 * arrives at `cy` as the ball does — which is what lets a swinging paddle really
 * be moving at contact rather than pinned against a bound.
 */
export async function arrangePaddleHit(
  h: Harness,
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
  await h.debug.setPaddle(side, { cy: cy - vy * lead, vy });
  await h.debug.setPaddle(other, { cy: PARKED_CY, vy: 0 });

  const near = nearBallX(side);
  const runUp = approachSpeed * lead;
  const x = startX ?? (side === "left" ? near + runUp : near - runUp);
  await h.debug.setBall(0, {
    x,
    y: ballY,
    vx: side === "left" ? -approachSpeed : approachSpeed,
    vy: 0,
    spin: 0,
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
  h: Harness,
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

/** Two still, centred paddles and a ball launched level down the middle. */
export async function arrangeRally(h: Harness): Promise<void> {
  await startPlaying(h);
  await h.debug.setPaddle("left", { cy: FIELD_CY, vy: 0 });
  await h.debug.setPaddle("right", { cy: FIELD_CY, vy: 0 });
  await h.debug.setBall(0, {
    x: FIELD_CX,
    y: FIELD_CY,
    vx: -500,
    vy: 0,
    spin: 0,
  });
}

/**
 * Play a real rally and report the ball's speed after each successive paddle
 * hit. Speed is constant between hits, so each leg sweeps coarsely until the
 * horizontal direction reverses. Stops early if play ever leaves the field.
 */
export async function driveRallySpeeds(
  h: Harness,
  hits = 24,
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
      { maxFrames: 600, poll: 6 },
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
 * (`specs/instrumentation.md`). Nothing here calls a control operation either, so
 * the game stays under normal player control and the paddles respond exactly as
 * they do for a player.
 */
export async function holdMove(
  h: Harness,
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
 * A live Solo match with the human paddle parked, ball 0 posed by `ball`, the AI
 * paddle started at `paddleCy`, and the AI handed control of it. Running time
 * forward from here pits the real opponent against the posed shot.
 */
export async function arrangeAiScenario(
  h: Harness,
  scenario: {
    paddleCy: number;
    ball: { x: number; y: number; vx: number; vy?: number };
  },
): Promise<void> {
  await startPlaying(h, "solo");
  await h.debug.setPaddle("left", { cy: PARKED_CY, vy: 0 });
  await h.debug.setPaddle("right", { cy: scenario.paddleCy, vy: 0 });
  await h.debug.setBall(0, { vy: 0, spin: 0, ...scenario.ball });
  await h.debug.setAiControl(true);
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
  h: Harness,
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
  h: Harness,
  options: { paddleCy?: number; ballY?: number } = {},
): Promise<void> {
  await startPlaying(h, "solo");
  await h.debug.setPaddle("left", { cy: PARKED_CY, vy: 0 });
  await h.debug.setPaddle("right", { cy: options.paddleCy ?? 120, vy: 0 });
  await h.debug.setBall(0, {
    x: FIELD_CX,
    y: options.ballY ?? 650,
    vx: 200,
    vy: 0,
    spin: 0,
  });
  await h.debug.setAiControl(true);
}

/** How fast the AI paddle travels while it is chasing, in px/s. */
export async function driveAiChaseSpeed(
  h: Harness,
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
export async function arrangeAiMovingHit(h: Harness): Promise<void> {
  await startPlaying(h, "solo");
  await h.debug.setPaddle("left", { cy: PARKED_CY, vy: 0 });
  await h.debug.setPaddle("right", { cy: 180, vy: 0 }); // above the lane
  await h.debug.setBall(0, { x: 1072, y: FIELD_CY, vx: 500, vy: 0, spin: 0 });
  await h.debug.setAiControl(true);
}

/* ---- Obstacle bank shots -------------------------------------------------- */

/**
 * Line the ball up 180 px short of `faceX`, level with the obstacle at `y`,
 * travelling straight at that face. `from` is the side it approaches from.
 */
export async function arrangeObstacleBounce(
  h: Harness,
  shot: { faceX: number; y: number; from: Side; speed?: number },
): Promise<void> {
  const speed = shot.speed ?? 600;
  await clearPaddles(h);
  await h.debug.setBall(0, {
    x: shot.from === "left" ? shot.faceX - 180 : shot.faceX + 180,
    y: shot.y,
    vx: shot.from === "left" ? speed : -speed,
    vy: 0,
    spin: 0,
  });
}

/** Run the real collision until the ball reflects off the struck face. */
export function driveObstacleBounce(
  h: Harness,
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
 * (specs/playfield.md): its center `BALL_R` off that face.
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
 * Line the ball up `FACE_RUN_UP` units off `face` of `rect`, at the midpoint of
 * that face, travelling straight into it at `FACE_SHOT_SPEED`.
 */
export async function arrangeFaceShot(
  h: Harness,
  rect: Rect,
  face: Face,
): Promise<void> {
  await clearPaddles(h);
  const cx = (rect.x0 + rect.x1) / 2;
  const cy = (rect.y0 + rect.y1) / 2;
  const off = restingOff(rect, face);
  const ball =
    face === "left"
      ? { x: off - FACE_RUN_UP, y: cy, vx: FACE_SHOT_SPEED, vy: 0 }
      : face === "right"
        ? { x: off + FACE_RUN_UP, y: cy, vx: -FACE_SHOT_SPEED, vy: 0 }
        : face === "top"
          ? { x: cx, y: off - FACE_RUN_UP, vx: 0, vy: FACE_SHOT_SPEED }
          : { x: cx, y: off + FACE_RUN_UP, vx: 0, vy: -FACE_SHOT_SPEED };
  await h.debug.setBall(0, { ...ball, spin: 0 });
}

/**
 * Run the real collision until the velocity component normal to `face` has
 * reversed, sampling every frame so the read is the frame of the reflection.
 */
export function driveFaceBounce(
  h: Harness,
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
 * A live match with the ball posed in mid-flight, clear of the obstacles so a
 * short flight is a straight line. Spin is zeroed so the path is predictable.
 */
export async function arrangeLiveBall(
  h: Harness,
  ball: { x: number; y: number; vx: number; vy?: number },
  mode: Mode = "versus",
): Promise<void> {
  await startPlaying(h, mode);
  await clearPaddles(h);
  await h.debug.setBall(0, { spin: 0, vy: 0, ...ball });
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
 * The RGB distance two sampled colours must exceed to count as "clearly
 * apart" (specs/overview.md): 50 of the 441 the RGB cube spans. The
 * specification fixes no palette, so distinguishability is the whole of what a
 * visibility check reads.
 */
export const DISTINCT_MIN = 50;

/**
 * The on-field points the colour checks sample, in logical px, valid on the
 * scene `arrangeColorScene` poses.
 *
 * Each sits well inside the shape it names — a paddle is 16 wide and an obstacle
 * 20, so a point on the centre line is 8 px from the nearest edge and the 4 px
 * cluster below stays inside the solid body. That margin is the point: a curved
 * or rounded edge is anti-aliased and blends toward whatever is behind it, so a
 * sample on the rim would read as a mixture rather than as the fill.
 */
export const COLOR_POINTS = {
  leftPaddle: { x: (P1_X0 + P1_X1) / 2, y: FIELD_CY },
  rightPaddle: { x: (P2_X0 + P2_X1) / 2, y: FIELD_CY },
  obstacle: OBSTACLE_CENTERS[0],
  /** A clean mid-field spot, clear of the paddles, both obstacles, and the net. */
  ball: { x: 300, y: FIELD_CY },
} as const;

/**
 * Candidate patches of empty field, in logical units, clear of every element
 * this specification places: the paddles, both obstacles at every gyre pose,
 * the net, the parked ball, and the top of the field where the scores sit.
 *
 * The field is dark and every body on it is bright (specs/overview.md), but the
 * mode label's copy and placement are the build's, so no single patch is
 * guaranteed bare. The darkest of several is: a label is drawn to be read, so
 * it is lighter than the field it sits on, and a patch it covers reads lighter
 * than one it does not.
 */
export const FIELD_POINTS: readonly { x: number; y: number }[] = [
  { x: 500, y: 650 },
  { x: 200, y: 600 },
  { x: 1000, y: 300 },
  { x: 1100, y: 620 },
];

/**
 * The bare field's colour: the darkest of the {@link FIELD_POINTS} patches,
 * sampled off the canvas as it stands.
 *
 * The shared reading's default sample radius is what this case wants: 4 logical
 * units out, which stays inside the solid body of every shape sampled, so one
 * stray anti-aliased or glow pixel cannot swing it.
 */
export function sampleField(h: Harness): Promise<Rgb> {
  return darkestOf(h, FIELD_POINTS);
}

/** Every point in `COLOR_POINTS` and the bare field, sampled as they stand. */
export async function sampleScene(
  h: Harness,
): Promise<Record<keyof typeof COLOR_POINTS | "background", Rgb>> {
  return {
    leftPaddle: await sampleColor(
      h,
      COLOR_POINTS.leftPaddle.x,
      COLOR_POINTS.leftPaddle.y,
    ),
    rightPaddle: await sampleColor(
      h,
      COLOR_POINTS.rightPaddle.x,
      COLOR_POINTS.rightPaddle.y,
    ),
    obstacle: await sampleColor(
      h,
      COLOR_POINTS.obstacle.x,
      COLOR_POINTS.obstacle.y,
    ),
    ball: await sampleColor(h, COLOR_POINTS.ball.x, COLOR_POINTS.ball.y),
    background: await sampleField(h),
  };
}

/**
 * Pose a clean, static colour scene and paint it: a live match with both paddles
 * centred and the ball parked at the mid-field sample point, so each sample
 * point renders an unobstructed, solid body.
 *
 * The settle is longer than the trail's own life on purpose. Posing the ball
 * teleports it, and the samples it left along the way would otherwise still be
 * drawn as a streak across the field; a still ball for `TRAIL_TIME` retires
 * every one of them, so what is sampled is the ball rather than its wake.
 */
export async function arrangeColorScene(h: Harness): Promise<void> {
  await startPlaying(h, "versus");
  await h.debug.setPaddle("left", { cy: FIELD_CY, vy: 0 });
  await h.debug.setPaddle("right", { cy: FIELD_CY, vy: 0 });
  await h.debug.setBall(0, {
    x: COLOR_POINTS.ball.x,
    y: COLOR_POINTS.ball.y,
    vx: 0,
    vy: 0,
    spin: 0,
  });
  await h.advance(Math.ceil(TRAIL_TIME * TICK_HZ) + 4);
}
