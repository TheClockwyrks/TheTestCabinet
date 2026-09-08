// Spectra — the case's half of the validator harness. CASE-PROVIDED.
//
// Every check in this suite is an ordinary vitest test that drives the built site
// IN A REAL BROWSER. There is nothing to import: an engineless run seeds no
// `src/` at all, so the build wrote its own frame loop, its own canvas fit, its
// own keyboard, its own audio, its own sprite loading, and its own
// `window.__spectra` — and the only place any of that exists is a page that has
// loaded the bundle. So the project serves `dist/`, loads it in Chromium, and
// reaches the game the way anything reaches it: over the surface
// `specs/instrumentation.md` told the build to install.
//
// RECONCILING AFTER A POSE. A helper here that poses anything a reading derives
// from ends with `reconcile`, so a check that poses through these helpers never
// calls it itself. Spectra's derived readings are `isChallenge`, the four
// stage-scaled figures, `dischargeReady`, `inversionActive`, `ship.alive`, every
// `effectiveBand`, a Flux's `shimmer` and a burst's `particles` — so `startPosed`
// and the drone and bullet poses carry the call. A check that poses with
// `h.debug.set...` DIRECTLY, outside these helpers, calls `reconcile` once itself
// before its first read or sweep. It costs no simulation time, so it never moves
// a measurement that begins at a posed rest state, which is exactly what stepping
// a frame to refresh a reading would do.
//
// THE MACHINERY THAT DOES THAT IS NOT SPECTRA'S. Serving the build, connecting to
// the one browser, opening a page per harness, injecting the draw-command
// recorder and the audio probe, bracketing each driven frame around one
// `advance(dt, 1)`, reading pixels and draw calls back out, and writing the
// evidence a review point declares — every engineless case needs exactly that,
// and it lives once, in `@clockwyrks/case-harness`, staged beside this file as
// `./case-harness/`. What is left here is what is genuinely Spectra's: the shape
// of its snapshot, the operations its `specs/instrumentation.md` requires, the
// seeded sprite art a presentation point is measured against, and the scenario
// helpers that pose a formation, fire a shot and walk a stage.
//
// The seam is one call. `createCaseHarness` takes the case's TYPES as type
// arguments and the case's VALUES as one object, and hands back the machinery
// with Spectra's names and Spectra's types on it — so the three hundred suites
// next door go on importing `createHarness`, `captureReplay` and `watchCues` from
// `../harness` exactly as they did.
//
// WHAT A CHECK READS. The game's own state (through `window.__spectra`'s
// `snapshot`), the frames the harness itself drove, the operations the build
// issued against its 2D context, the bitmaps it handed those operations, the
// pixels they left on the canvas, and the sounds it emitted. Nothing here
// fabricates an outcome: the scenario helpers below only ARRANGE the field
// through the surface, and the real update the build wrote is what runs from
// there.
//
// THE HARNESS OWNS EVERY COMPOUND SEQUENCE. The debug surface is atomic by
// design — each operation sets one field, reads the state, or moves the clock
// (`guides/authoring/writing-debug-apis-and-validators.md`) — so "open a live
// wave at stage 3 with the field cleared" is a helper here, built out of those
// atomic operations, and never an operation on the surface. A check that needs
// only part of a sequence calls the operations it needs: nothing a check does not
// ask for happens.
//
// AND THE HELPERS FIX GEOMETRY, NEVER THRESHOLDS. A helper poses a field, drives
// a scenario, or reads a value out of a snapshot. Every tolerance a check
// asserts — a percentage, a colour distance, a number of units — is stated in
// that check, next to the figure `specs/` fixes for it, because a helper that
// carried the tolerance would hide what the check is really asserting. Look for
// a threshold in this file and you will not find one.
//
// THE CLOCK IS THE SURFACE'S. Nothing outside an engineless build owns its loop,
// so `specs/instrumentation.md` puts the clock on the surface: `setAutoStep(false)`
// takes the game off real time and `advance(seconds, frames)` runs whole frames
// of a chosen length. Every harness opens by taking the game off the clock, so a
// check asks for a number of frames and gets exactly that number — no polling, no
// waiting, and no measurement of the machine it ran on. Nothing in this project
// hands the loop back: what the build does with a second of real time is a fact
// about the host it ran on rather than about the build.
//
// EVERYTHING CROSSING INTO THE PAGE IS ASYNC. That is the whole of the difference
// between a suite here and its counterpart under an engine: `await h.snapshot()`
// rather than `h.snapshot()`. The scenarios, the tolerances, and the assertions
// are the same ones, because they are the case's rather than the runtime's.
//
// THERE IS NO SPRITE SHIM HERE, AND THAT IS NOT AN OVERSIGHT. Under an engine a
// validator runs the build's own module inside this node process, and the
// engine's asset loader reaches for `fetch` and `createImageBitmap`, so both
// globals have to be stood up over the workspace's `assets/` tree. Under THIS
// engine nothing of the sort happens: the build loads its own art in the page,
// where both globals are the browser's real ones, and the only thing this process
// reads off disk is the seeded art it compares AGAINST — through `@napi-rs/canvas`
// and `node:fs`, which need no shim.

import { createCanvas, loadImage } from "@napi-rs/canvas";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ParticleSystem } from "@clockwyrks/particle-runtime";
import {
  DEFAULT_REPLAY_BACKGROUND,
  RECORDER_GLOBAL,
  apply as applyMatrix,
  callsTo,
  clusterPoints,
  colorDistance,
  createCaseHarness,
  ConstantClock,
  JitterClock,
  SequenceClock,
  distance,
  drawnText,
  drawnTextLines,
  drawnTextRuns,
  meanOf,
  mouseGlide,
  rectCenter,
  setsOf,
  toDrawCall,
  touchGlide,
  touchPress,
  touchRelease,
  transformed,
  IDENTITY,
  luminance,
  textDraws,
  type Clock,
  type DrawCall,
  type Harness as BaseHarness,
  type HarnessOptions,
  type Matrix,
  type Pixel,
  type Point,
  type PoseOperation as PackagePoseOperation,
  type RecordedOp,
  type Recording,
  type Rgb,
  type SurfaceCall as PackageSurfaceCall,
  type SweepOptions as PackageSweepOptions,
  type SweepResult as PackageSweepResult,
  type TextDraw,
  type TimedCue,
  type UntilOptions,
  type UntilResult as PackageUntilResult,
  type Viewport,
} from "./case-harness/index";
import { assertTruthy, fail } from "./assert";
import {
  BURST_SYSTEM,
  ENEMY_BULLET_SPEED,
  FORM_CENTER_X,
  FORM_COLS,
  FORM_ROWS,
  OVERLAY_KEY,
  PLAYER_BULLET_SPEED,
  SHIP_Y,
  SPRITES,
  SPRITE_SIZE,
  STAGE_H,
  STAGE_W,
  START_LIVES,
  UNBOUND_KEY,
  slotX,
  slotY,
  type Band,
  type Mode,
  type SpriteName,
} from "./constants";

/* The readings this project takes straight off the package, under its names. */
export {
  ConstantClock,
  JitterClock,
  SequenceClock,
  applyMatrix,
  callsTo,
  colorDistance,
  distance,
  drawnText,
  luminance,
  rectCenter,
  setsOf,
  textDraws,
};
export type {
  Clock,
  DrawCall,
  HarnessOptions,
  Matrix,
  Pixel,
  Point,
  RecordedOp,
  Recording,
  Rgb,
  TextDraw,
  TimedCue,
  UntilOptions,
  Viewport,
};
/* -------------------------------------------------------------------------- */
/* The contract the build owes                                                */
/* -------------------------------------------------------------------------- */

/** The handle an engineless build installs its surface on. */
export const HANDLE = "__spectra";

/**
 * Every operation `specs/instrumentation.md` requires on the surface under this
 * engine and under BOTH variants, including the two clock operations that exist
 * only here.
 *
 * The list is the whole of it, in the order the specification states them, so
 * `instrumentation/surface-present` can assert completeness by naming this one
 * constant and a build missing anything is named for exactly what it is missing.
 * {@link OVERLOAD_OPS} carries the one operation a variant adds, and is
 * deliberately not here: a base build owes it nothing.
 */
export const REQUIRED_OPS = [
  // The core.
  "reset",
  "snapshot",
  "reconcile",
  "menuItemRect",
  // The clock (this engine alone).
  "setAutoStep",
  "advance",
  // The screen and the run.
  "setScreen",
  "setPhase",
  "setPhaseTimer",
  "setMenuIndex",
  "setScore",
  "setLives",
  "setStage",
  "setExtraLifeAwarded",
  "setChallengeHits",
  // The world gates and the dive clock.
  "setWaveEntry",
  "setDiveLaunching",
  "setStageClearing",
  "setShipContact",
  "setDiveClock",
  "setDiveGap",
  // The ship and its cannon.
  "setShipX",
  "setShipBand",
  "setFireLockout",
  "setFireCooldown",
  // Resonance and the inversion.
  "setResonance",
  "setInversion",
  // The drones.
  "addDrone",
  "setDronePosition",
  "setDroneBand",
  "setDronePhase",
  "setDroneSlot",
  "setDroneBandClock",
  "setDroneShell",
  "setDroneTravel",
  "setDroneOscillation",
  "setDroneFire",
  "removeDrone",
  "clearDrones",
  // The bullets.
  "addPlayerBullet",
  "addEnemyBullet",
  "setBulletVelocity",
  "removeBullet",
  "clearPlayerBullets",
  "clearEnemyBullets",
  // The bursts.
  "removeBurst",
  "clearBursts",
] as const;

/**
 * The operations one variant adds (`specs/mode.md` under the overload variant).
 *
 * Only the `overload/` suites name these, and only an overload run loads one. A
 * base build's surface carries neither, which is why the harness's own
 * completeness check ({@link readSurfaceFault}) asks for {@link REQUIRED_OPS}
 * alone: requiring a variant's operation of every build would fail every check on
 * a perfectly conformant base build.
 */
export const OVERLOAD_OPS = ["setDroneCharge"] as const;

/** The seven screens the game moves between (`specs/ui.md`). */
export type Screen =
  | "title"
  | "howto"
  | "stageIntro"
  | "inWave"
  | "paused"
  | "stageCleared"
  | "gameOver";

/** The two sub-phases of the `inWave` screen (`specs/progression.md`). */
export type Phase = "live" | "ready";

/** The three drones (`specs/drones.md`). */
export type DroneKind = "shard" | "flux" | "prism";

/** A drone's movement phase (`specs/swarm.md`). */
export type DronePhase = "entering" | "formation" | "diving" | "returning";

/** One drone, as a snapshot reports it. `x`/`y` is its CENTRE. */
export interface DroneView {
  id: number;
  kind: DroneKind;
  x: number;
  y: number;
  /** Its stored band. For a Prism this is the SHELL's; the core's is opposite. */
  band: Band;
  /** The band it currently reads and counts as (`specs/bands.md`). */
  effectiveBand: Band;
  phase: DronePhase;
  slotX: number;
  slotY: number;
  /** Seconds into the CURRENT band window; `0` on a Shard and a Prism. */
  bandClock: number;
  /** Derived: a Flux settled on neither band. `false` on the other two kinds. */
  shimmer: boolean;
  /** A Prism's outer shell stands; `true` on the other two kinds. */
  shellAlive: boolean;
  travel: boolean;
  oscillation: boolean;
  fire: boolean;
  /** THE OVERLOAD VARIANT ONLY: `0` to `OVERLOAD_AT`. Absent under the other. */
  charge?: number;
}

/** One bullet in flight, as a snapshot reports it. `x`/`y` is its CENTRE. */
export interface BulletView {
  id: number;
  x: number;
  y: number;
  /** Logical units per second. */
  vx: number;
  vy: number;
  band: Band;
  effectiveBand: Band;
  /** `true` for one of the player's, travelling up. */
  friendly: boolean;
}

/** One drone-burst playing, as a snapshot reports it. */
export interface BurstView {
  id: number;
  x: number;
  y: number;
  /** The footprint the seeded system's square field is played at. */
  size: number;
  elapsed: number;
  /** Live particles the burst's own simulation holds at the call. */
  particles: number;
}

/** The ship, as a snapshot reports it. */
export interface ShipView {
  /** The ship's CENTRE `x`; its `y` is always `SHIP_Y`. */
  x: number;
  band: Band;
  /** Derived: `false` exactly while the phase is `ready`. */
  alive: boolean;
  lockout: number;
  cooldown: number;
  /** The ship's contact test runs. */
  contact: boolean;
}

/** The live discharge wave, as a snapshot reports it. */
export interface DischargeView {
  active: boolean;
  /** The live wave's radius, in logical units. */
  radius: number;
}

/**
 * The state a snapshot reports, exactly as `specs/instrumentation.md` shapes it.
 *
 * Every field an operation can set is here, which is what makes every pose
 * verifiable by set-then-read. `muted` is the exception in the other direction:
 * no operation sets it, and it is the game's copy of the runtime's own mute bit,
 * reached the way a player reaches it through `KeyM`.
 */
export interface SpectraSnapshot {
  version: number;
  screen: Screen;
  phase: Phase;
  phaseTimer: number;
  menuIndex: number;
  /** The mode this build ships (`specs/mode.md`), which is the variant's. */
  mode: Mode;
  stage: number;
  isChallenge: boolean;
  score: number;
  lives: number;
  extraLifeAwarded: boolean;
  challengeHits: number;
  resonance: number;
  dischargeReady: boolean;
  inversion: number;
  inversionActive: boolean;
  muted: boolean;
  waveEntry: boolean;
  diveLaunching: boolean;
  stageClearing: boolean;
  diveClock: number;
  diveGap: number;
  droneSpeedScale: number;
  bulletSpeedScale: number;
  diveGapScale: number;
  fluxHold: number;
  ship: ShipView;
  discharge: DischargeView;
  drones: DroneView[];
  bullets: BulletView[];
  bursts: BurstView[];
  simTime: number;
}

/**
 * A menu item's hit region, in logical units, as `menuItemRect` reports it.
 *
 * `x` and `y` are the region's top-left corner and `w` and `h` its size
 * (`specs/instrumentation.md`). Where a build LAYS its menus out is the build's
 * own (`specs/ui.md`), so this is the only thing a pointer check knows about the
 * geometry it drives at.
 */
export interface MenuRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The operations a check poses the game through. Every one crosses into the page. */
export interface SpectraDebugApi {
  reset(): Promise<void>;
  snapshot(): Promise<SpectraSnapshot>;
  /**
   * Brings every value the snapshot reports into agreement with the game as it
   * stands, without advancing anything (`specs/instrumentation.md`).
   *
   * A build that works its derived readings out at the read has nothing to do
   * here; a build that keeps one as a stored copy rewrites it from its source.
   * It is what a driver calls after posing a game and before reading it back.
   */
  reconcile(): Promise<void>;
  menuItemRect(index: number): Promise<MenuRect | null>;

  setAutoStep(enabled: boolean): Promise<void>;
  advance(seconds: number, frames?: number): Promise<void>;

  setScreen(screen: Screen): Promise<void>;
  setPhase(phase: Phase): Promise<void>;
  setPhaseTimer(seconds: number): Promise<void>;
  setMenuIndex(index: number): Promise<void>;
  setScore(score: number): Promise<void>;
  setLives(lives: number): Promise<void>;
  setStage(stage: number): Promise<void>;
  setExtraLifeAwarded(awarded: boolean): Promise<void>;
  setChallengeHits(hits: number): Promise<void>;

  setWaveEntry(enabled: boolean): Promise<void>;
  setDiveLaunching(enabled: boolean): Promise<void>;
  setStageClearing(enabled: boolean): Promise<void>;
  setShipContact(enabled: boolean): Promise<void>;
  setDiveClock(seconds: number): Promise<void>;
  setDiveGap(seconds: number): Promise<void>;

  setShipX(x: number): Promise<void>;
  setShipBand(band: Band): Promise<void>;
  setFireLockout(seconds: number): Promise<void>;
  setFireCooldown(seconds: number): Promise<void>;

  setResonance(value: number): Promise<void>;
  setInversion(seconds: number): Promise<void>;

  addDrone(kind: DroneKind, x: number, y: number): Promise<void>;
  setDronePosition(id: number, x: number, y: number): Promise<void>;
  setDroneBand(id: number, band: Band): Promise<void>;
  setDronePhase(id: number, phase: DronePhase): Promise<void>;
  setDroneSlot(id: number, x: number, y: number): Promise<void>;
  setDroneBandClock(id: number, seconds: number): Promise<void>;
  setDroneShell(id: number, intact: boolean): Promise<void>;
  /** THE OVERLOAD VARIANT ONLY. A base build's surface does not carry it. */
  setDroneCharge(id: number, charge: number): Promise<void>;
  setDroneTravel(id: number, enabled: boolean): Promise<void>;
  setDroneOscillation(id: number, enabled: boolean): Promise<void>;
  setDroneFire(id: number, enabled: boolean): Promise<void>;
  removeDrone(id: number): Promise<void>;
  clearDrones(): Promise<void>;

  addPlayerBullet(x: number, y: number, band: Band): Promise<void>;
  addEnemyBullet(x: number, y: number, band: Band): Promise<void>;
  setBulletVelocity(id: number, vx: number, vy: number): Promise<void>;
  removeBullet(id: number): Promise<void>;
  clearPlayerBullets(): Promise<void>;
  clearEnemyBullets(): Promise<void>;

  removeBurst(id: number): Promise<void>;
  clearBursts(): Promise<void>;
}

/**
 * The surface operations a {@link Harness.pose} may carry, which is every one of
 * them that arranges the field.
 *
 * `snapshot` and `advance` are left out because they are not arrangements:
 * `snapshot` is what a pose hands back already, and a frame belongs to the
 * harness's own recorded stepping rather than to a batch of poses. The step
 * operation's name is the case's, so the package's default excludes only
 * `snapshot` and this names the second.
 */
export type PoseOperation = PackagePoseOperation<
  SpectraDebugApi,
  "snapshot" | "advance"
>;

/**
 * One call into the build's surface: the operation's name, then its arguments.
 *
 * Typed against {@link SpectraDebugApi} operation by operation, so a batch is
 * checked exactly as the direct call it replaces would be.
 */
export type SurfaceCall = PackageSurfaceCall<
  SpectraDebugApi,
  "snapshot" | "advance"
>;

/* -------------------------------------------------------------------------- */
/* The step schedule                                                          */
/* -------------------------------------------------------------------------- */
//
// The suite chooses the size of a frame, because the specification deliberately
// fixes none: `specs/simulation.md` mandates no fixed timestep, every rate is per
// second and integrated against the elapsed time of the frame, and a frame
// divides into whole sub-steps of at most `SUBSTEP_MAX` itself. So a build must
// resolve the same rules however that time was divided, and the check that is
// ABOUT the division (`instrumentation/elapsed-time-steps`) drives the same second
// as one frame, as sixty and as a hundred and twenty.
//
// The default is a steady 100 Hz, for one reason: every duration `specs/` fixes
// is then a whole number of frames. `FIRE_INTERVAL` 0.16 s is 16, `FLIP_LOCKOUT`
// 0.30 s is 30, `FLUX_SHIMMER` 0.4 s is 40, `DISCHARGE_TIME` 0.5 s is 50,
// `ENTER_GROUP_GAP` 0.6 s is 60, `BURST_DURATION` 0.7 s is 70, `READY_HOLD` 1.3 s
// is 130, `DIVE_GAP_MIN` 1.4 s is 140, `FLUX_HOLD_L1` 1.6 s is 160,
// `DIVE_FIRST_DELAY` and `STAGE_INTRO_HOLD` 2.0 s are 200, `DIVE_GAP_MAX` and
// `STAGE_CLEARED_HOLD` 2.6 s are 260, `INVERSION_TIME` and `SWAY_PERIOD` 5 s are
// 500 — and every step of the `fluxHold` ramp is a multiple of 0.05 s, which is
// 5. A check therefore asks for a duration and gets it exactly, with no rounding
// of its own to explain.

/** The frame the suite steps in, in milliseconds. */
export const TICK_HZ = 100;
export const TICK_MS = 1000 / TICK_HZ;

/**
 * How long the surface is waited for before the build is called non-conformant.
 *
 * Generous against a conformant build and cheap against one: the wait is a poll
 * that returns the instant the global appears. Spectra's surface is installed
 * once the four seeded sprites and the burst system have loaded and decoded
 * (`specs/assets.md`), so a build has a genuine asynchronous step to finish
 * before it can install — which is what this ceiling is sized for, and why it is
 * this case's own figure rather than the package's shorter default.
 *
 * IT IS SET WHERE A LOADED HOST CANNOT REACH IT. How long a page takes to load
 * and decode four sprites is a fact about the machine, not about the build: the
 * same reference install measures under a second and a half on a quiet host and
 * still lands well inside a couple of seconds on one running a hundred jobs. A
 * ceiling anywhere near those figures turns a busy machine into a conformance
 * failure, which is the one thing a check may never do, so this stands more than
 * an order of magnitude above the worst reading taken.
 */
const SURFACE_TIMEOUT_MS = 45_000;

/** This module's directory: the validator project's root. */
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * The workspace this project is staged into, which is where `assets/` sits.
 *
 * Derived from this file's own URL rather than from the working directory, so it
 * names the same place in both layouts this project lives in — the case's own
 * `validation/none/`, and the `validation/` the runner stages it to inside the
 * build's tree. It may never be derived inside the package, which is staged one
 * directory deeper than this file.
 */
export const WORKSPACE_ROOT = resolve(PROJECT_ROOT, "..");

/**
 * The package's engineless machinery, bound to Spectra.
 *
 * Five of the fields are where this case departs from the common shape, and each
 * is answered here from what Spectra is:
 *
 *  - `optionalOps` carries {@link OVERLOAD_OPS}. One validator project decides
 *    both variants, so `setDroneCharge` can be in neither list: in `requiredOps`
 *    it would report every conforming BASE build as missing an operation and
 *    leave the whole run undecided, and in neither it would fail an overload
 *    build's overload points with a raw `TypeError` from inside the page instead
 *    of with the pair a reviewer reads.
 *  - `preInitScripts` — not `extraInitScripts` — carries `raster-init.js`,
 *    because it takes the page's own `getContext` for the probe it measures a
 *    fill's opacity on and the package's `recorder-init.js` REPLACES that
 *    `getContext` with one handing back a recording proxy. Run the other way
 *    round the script is not broken loudly; it is broken quietly, and what it
 *    costs is a filtered build's `captureStill` going from 269 ms to 15.5 s.
 *  - `arm` is a press of the one key `specs/controls.md` binds to nothing, so a
 *    build that opens its audio from a real DOM event alone — which is
 *    conformant — is handed the gesture that opens it, and nothing in the game
 *    moves.
 *  - `measureText` is on because `screens/hud-*` reads where a run of text SITS,
 *    which needs the width the page measured at the call and the alignment then
 *    in force, not only which strings were drawn.
 *  - `surfaceTimeoutMs` is this case's own ceiling, above.
 */
const kit = createCaseHarness<SpectraSnapshot, SpectraDebugApi>({
  slug: "spectra",
  handle: HANDLE,
  requiredOps: REQUIRED_OPS,
  optionalOps: OVERLOAD_OPS,
  step: { kind: "seconds-frames", op: "advance" },
  stage: { width: STAGE_W, height: STAGE_H },
  arm: { kind: "key", code: UNBOUND_KEY },
  tickHz: TICK_HZ,
  projectRoot: PROJECT_ROOT,
  surfaceTimeoutMs: SURFACE_TIMEOUT_MS,
  measureText: true,
  preInitScripts: ["raster-init.js"],
});

/** Seconds of simulated time in `frames` frames of the default clock. */
export const seconds = kit.seconds;

/**
 * A rate in units per second from a displacement measured over `frames` frames.
 *
 * The package's `speedOverTicks` under this project's own word for a step. The
 * magnitude, so a ship held left and a ship held right report the same speed.
 */
export const speedOverFrames = kit.speedOverTicks;

/**
 * Frames of the default clock covering `duration` seconds.
 *
 * ROUNDED, NOT ROUNDED UP, which is why this stays the case's own and does not
 * bind the package's `ticksFor`. Every duration `specs/` fixes is a whole number
 * of frames at 100 Hz (see the schedule above), so the two agree on every figure
 * this project states — but they disagree on any that is not, and a check that
 * asked for `framesFor(d)` frames of a duration and got one more than the build
 * was given would read the frame AFTER the one it is about.
 */
export function framesFor(duration: number): number {
  return Math.round(duration * TICK_HZ);
}

/**
 * What `specs/instrumentation.md` requires of the surface: the `Expected:` line
 * of the failure a build with no usable surface lands on every check that
 * reaches for it, beside the {@link Harness.surfaceFault} that says what was
 * found.
 */
export const SURFACE_REQUIREMENT = kit.SURFACE_REQUIREMENT;

/**
 * Fail the running check on `fault`, the harness's account of what is wrong
 * with the build's surface, paired with what the specification requires.
 */
export const failSurface = kit.failSurface;

/**
 * How the stage maps onto a surface of this shape, as `specs/overview.md` fixes
 * it: one uniform scale, the whole stage inside, centred, with the leftover
 * split evenly into two letterbox bars.
 *
 * Computed rather than read from the build, deliberately. Under an engine the
 * fit is the engine's and a check can ask it what it derived; here the fit is
 * the build's own work, so asking it would be asking a build to grade itself.
 */
export const fitViewport = kit.fitViewport;

/* -------------------------------------------------------------------------- */
/* The harness                                                                */
/* -------------------------------------------------------------------------- */

/** What a sweep found: whether the predicate ever held, and where it stopped. */
export type UntilResult = PackageUntilResult<SpectraSnapshot>;

/** {@link Harness.sweep}'s options: a sweep's own, plus what to arrange first. */
export type SweepOptions = PackageSweepOptions<SurfaceCall>;

/** What a sweep found, and the state its `arrange` left before the first frame. */
export type SweepResult = PackageSweepResult<SpectraSnapshot>;

/** How far a coarse sweep may run, and how much game time separates two samples. */
export interface SkipOptions {
  maxSeconds?: number;
  pollSeconds?: number;
  /** Frames per second of game time inside each poll. Defaults to 60. */
  hz?: number;
}

/** What a coarse sweep found. */
export interface SkipResult {
  hit: boolean;
  /** Seconds of game time covered before the sample that ended the sweep. */
  elapsed: number;
  snapshot: SpectraSnapshot;
}

/** The package's harness, bound to this case's snapshot, surface and batch. */
type PackageHarness = BaseHarness<
  SpectraSnapshot,
  SpectraDebugApi,
  SurfaceCall
>;

/**
 * Everything a check reads off one page running one build.
 *
 * The package's harness under this case's own vocabulary. FOUR MEMBERS ARE
 * REPLACED rather than renamed, and each is a genuine disagreement rather than a
 * spelling — folding either half into the other would silently change what a
 * suite asked for:
 *
 *  - `pose` is the package's `arrange`: a batch of surface calls run in ONE
 *    crossing, answering the snapshot they left. The package spells it `arrange`
 *    because another case's `pose` answers what each call RETURNED; this project
 *    has always meant the first, and its suites say `pose`.
 *  - `skip` takes SECONDS of game time, where the package's takes a count of
 *    FRAMES. `skip(0.5)` here is half a second and there is half a frame.
 *  - `skipUntil` is the coarse sweep that goes with it — bounded in seconds,
 *    polled in seconds, and answering the seconds it covered — where the
 *    package's is the frame-denominated sweep over `skip`.
 *
 * `holdFor` takes one key or several, because a check about two controls held
 * together is a check about a build that reads its keyboard once per frame.
 */
export interface Harness extends Omit<
  PackageHarness,
  "holdFor" | "skip" | "skipUntil"
> {
  /**
   * Run several of the build's surface operations, in order, in ONE crossing,
   * and read the state they left.
   *
   * The same calls the build would receive one at a time, in the same order,
   * against the same game: the surface is synchronous inside the page, so a
   * batch and a run of separate calls leave the field in the same arrangement.
   * What changes is the cost. A crossing is a round trip to the browser, and
   * what a round trip costs is a fact about how busy the host is rather than
   * about the build — so a scenario that poses forty drones pays it once here
   * instead of three hundred times, and its verdict stops depending on the
   * machine it was read on.
   *
   * Nothing here advances the game, so no frame is opened and the recorder keeps
   * nothing: a pose is an arrangement, and {@link Harness.advance} runs it.
   */
  pose(calls: readonly SurfaceCall[]): Promise<SpectraSnapshot>;
  /**
   * Run `duration` seconds of game time WITHOUT opening a recorded frame.
   *
   * The same real update the loop runs, `hz` frames per second of it, but off
   * camera: no frame boundary is closed, so a capture running across it keeps
   * nothing, and a section that has to sit through a stage's entrance costs a
   * replay nothing. Use it for the wait; use `advance` for the part a check is
   * about.
   */
  skip(duration: number, hz?: number): Promise<void>;
  /** {@link skip} until `predicate` holds, sampling every `pollSeconds`. */
  skipUntil(
    predicate: (snapshot: SpectraSnapshot) => boolean,
    options?: SkipOptions,
  ): Promise<SkipResult>;
  /** Hold one or more keys down for `frames` frames, then release them all. */
  holdFor(codes: string | readonly string[], frames: number): Promise<void>;
}

/**
 * Load the built site in a browser, take the game off the wall clock, and hand
 * back everything a check reads.
 *
 * The default shape is the stage's own size at one device pixel per CSS pixel,
 * so a logical coordinate and a canvas pixel are the same thing and no check but
 * `field/stage-fit` has to think about the fit at all.
 *
 * IT NEVER THROWS FOR A BUILD'S FAULT. A missing or incomplete surface comes
 * back as {@link Harness.surfaceFault} over a surface whose every operation
 * fails by assertion, so a suite that builds its harness in a `beforeEach` gets
 * its real verdict from the check rather than a hook failure that names nothing.
 *
 * The five members below are laid over the package's harness IN PLACE, on the
 * object the kit built, because `watchCues` remembers a harness by its identity:
 * a copy would be handed cue sinks nothing ever fills.
 */
export async function createHarness(
  options: HarnessOptions = {},
): Promise<Harness> {
  const base = await kit.createHarness(options);
  // TAKEN BEFORE THE OVERRIDES GO ON, because they go on THIS object: `skip`
  // and `skipUntil` below are laid over the members they are built out of, and
  // reading one back through `base` afterwards would reach the override rather
  // than the package's own. The others are held the same way so no later edit
  // can introduce the same loop by adding one more override.
  const driven = {
    advance: base.advance.bind(base),
    arrange: base.arrange.bind(base),
    hold: base.hold.bind(base),
    release: base.release.bind(base),
    skipSeconds: base.skipSeconds.bind(base),
    snapshot: base.snapshot.bind(base),
  };
  return Object.assign(base, {
    pose: (calls: readonly SurfaceCall[]): Promise<SpectraSnapshot> =>
      driven.arrange(calls),

    skip: async (duration: number, hz = 60): Promise<void> => {
      // The build divides the span, so the whole of it is one call and no frame
      // boundary is closed inside it.
      await driven.skipSeconds(duration, Math.ceil(duration * hz));
    },

    skipUntil: async (
      predicate: (snapshot: SpectraSnapshot) => boolean,
      skipOptions: SkipOptions = {},
    ): Promise<SkipResult> => {
      const maxSeconds = skipOptions.maxSeconds ?? 60;
      const pollSeconds = Math.max(1e-3, skipOptions.pollSeconds ?? 0.5);
      const hz = skipOptions.hz ?? 60;

      let snapshot = await driven.snapshot();
      if (predicate(snapshot)) return { hit: true, elapsed: 0, snapshot };

      let elapsed = 0;
      while (elapsed < maxSeconds) {
        const step = Math.min(pollSeconds, maxSeconds - elapsed);
        await driven.skipSeconds(step, Math.ceil(step * hz));
        snapshot = await driven.snapshot();
        elapsed += step;
        if (predicate(snapshot)) return { hit: true, elapsed, snapshot };
      }
      return { hit: false, elapsed, snapshot };
    },

    holdFor: async (
      codes: string | readonly string[],
      frames: number,
    ): Promise<void> => {
      const keys = typeof codes === "string" ? [codes] : [...codes];
      for (const code of keys) await driven.hold(code);
      try {
        if (frames > 0) await driven.advance(frames);
      } finally {
        for (const code of keys) await driven.release(code);
      }
    },
  }) as unknown as Harness;
}

/**
 * Shut everything this worker opened.
 *
 * Registered from `setup.ts` as an `afterAll`, so a suite file never has to think
 * about it and a worker cannot leave a page behind in the shared browser.
 */
export { closeWorkerBrowser } from "./case-harness/index";

/* -------------------------------------------------------------------------- */
/* Evidence capture                                                           */
/* -------------------------------------------------------------------------- */
//
// A review item may declare a `replay` OUTPUT beside its verdict: the frames the
// build itself drew while a check drove it, kept as evidence a reviewer can
// scrub and compare against the reference implementation's. Both writers are the
// package's, bound here to this case's slug and to THIS directory — the project
// root may never be derived inside the package, which is staged one level deeper
// than this file, or every output would be addressed one directory too far down.
//
// Four properties are what make a replay usable, and each is deliberate:
//
// 1. IT RECORDS THE SECTION, NOT THE RUN. The recorder is armed around the
//    caller's scenario and disarmed the moment that scenario returns, so what is
//    kept is the part the check is ABOUT and never the setup that got there.
//    Spectra gives that its sharpest form: a discharge is half a second of wave,
//    and a section that sat through a whole stage's entrance before it would fill
//    the capture budget with the wait. So arm around the burst —
//    `captureReplay(h, "id", () => h.advance(framesFor(DISCHARGE_TIME)))` — and
//    put the wait outside it, or off camera entirely with {@link Harness.skip},
//    which closes no frame at all.
// 2. IT IS EVIDENCE, NEVER A VERDICT. The scenario's own value comes straight
//    back, and a scenario that THROWS still writes what it had recorded before
//    the failure travels on — a failing check is the one whose replay a reviewer
//    most wants.
// 3. IT WRITES ONLY WHAT THERE IS TO LOOK AT. A capture that closed no frames
//    leaves no file, so the run reports the output absent instead of offering the
//    reviewer a replay of nothing.
// 4. IT COSTS NOTHING WHEN NOBODY IS COLLECTING. Outside a run the media
//    directory is unset and the whole thing is a no-op that still runs the
//    scenario, so a check cannot pass in one place and fail in the other.

/**
 * The package's harness as the kit's own members are typed.
 *
 * The three writers below take it, and this project's {@link Harness} is not it:
 * the four members this case replaces are declared here as PROPERTIES rather
 * than as methods, which is what stops a `skipUntil` denominated in seconds from
 * standing in for one denominated in frames — exactly the substitution that
 * would otherwise happen silently. The cast at each of the three call sites is
 * the price, and it is paid where it can be read rather than by widening the
 * contract the suites are held to. Nothing in the three touches a replaced
 * member: they arm the recorder, screenshot the page, and attach a cue sink.
 */
type KitHarness = BaseHarness<SpectraSnapshot, SpectraDebugApi>;

/**
 * Record the frames `scenario` drives and keep them as the review item's
 * `outputId` output, handing back whatever the scenario returned.
 *
 * Wrap the drive, not the arrangement — the assertions stay exactly where they
 * were and read exactly what they did.
 */
export function captureReplay<T>(
  h: Harness,
  outputId: string,
  scenario: () => T | Promise<T>,
): Promise<T> {
  return kit.captureReplay(h as unknown as KitHarness, outputId, scenario);
}

/**
 * Keep the picture currently on the canvas as the review item's `outputId`
 * output.
 *
 * The companion to {@link captureReplay}, for a point whose evidence is one
 * PICTURE rather than a stretch of motion: which screen the game opened on, how
 * a build drew a shimmering Flux beside a holding one, where the letterbox bars
 * fell. What is written is whatever the last frame that RAN left behind, so call
 * it after the frame that poses the thing under test and before the assertions.
 */
export function captureStill(h: Harness, outputId: string): Promise<void> {
  return kit.captureStill(h as unknown as KitHarness, outputId);
}

/* -------------------------------------------------------------------------- */
/* Cues                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Record every sound the build emits from now on, stamped with the frame of the
 * drive it sounded on.
 *
 * WHAT IS OBSERVED, AND WHY IT IS THE FAIR READING. `specs/ui.md` requires one
 * cue per event, played on the frame its event happens, and says nothing at all
 * about how a build makes a sound — under this engine the whole audio layer is
 * the build's. So the package's audio probe watches the two doors a browser can
 * emit sound through (a Web Audio source being `start()`ed, whatever kind it is,
 * and an `<audio>` element being played) and counts what goes through them; the
 * harness brackets each driven frame around that count, so a sound is attributed
 * to the frame that produced it. A blip made of two oscillators counts as two,
 * which is why a check asserts that a frame sounded rather than how many times:
 * the number of sources is the build's business and the specification never
 * fixed it.
 *
 * WHAT IS LOST HERE THAT AN ENGINE GIVES. The cue's NAME. Under an engine the
 * game asks the bus for a cue by name and the bus announces it, so a build that
 * plays its menu blip on every shot is caught. There is no bus here to ask, so
 * these checks confirm that a sound was emitted and on which frame, and a
 * reviewer decides by ear whether the nine are told apart. That is a real
 * reduction, and the alternative — inferring the cue from the waveform the
 * reference happens to use — would grade builds against an implementation rather
 * than against the specification. NO CHECK IN THIS PROJECT MAY ASSERT A CUE NAME.
 *
 * A sound emitted inside {@link Harness.skip} is attributed to the frame the skip
 * ended on, since a skip closes no frames of its own: run the frames a cue check
 * reads with `advance`.
 */
export function watchCues(h: Harness): TimedCue[] {
  return kit.watchCues(h as unknown as KitHarness);
}
/* -------------------------------------------------------------------------- */
/* Reading one frame's render                                                 */
/* -------------------------------------------------------------------------- */
//
// `drawnText` and `textDraws` are the package's, under the same names, and answer
// the CALLS: one entry per `fillText`/`strokeText`, for the reader that counts
// draws or holds one draw clear of a region. `drawnTextLines` and `drawnTextRuns`
// are the package's too, and answer the LOGICAL RUNS a frame spells, merging
// draws that sit side by side on one baseline. Every reader of COPY — the
// package's `drewText`, which the screen suites import directly, `drewWord`
// below, and the screen suites' `numberRuns` and `runCarrying` — reads the
// runs, because a build that letter-spaces a heading draws it a glyph per call
// and the specification fixes the words, not their spacing.

/**
 * The frame's text as the LOGICAL RUNS it spells: the strings alone, and the
 * runs placed the way {@link textDraws} places one draw.
 *
 * Both are the shared harness's own (`case-harness/text.ts`), re-exported so a
 * suite reads them beside the rest of this harness. A check that reads copy AND
 * where it sits — `screens/reading`'s `numberRuns` and `runCarrying` — takes
 * `drawnTextRuns`, because {@link textDraws} would hand it a letter-spaced
 * figure a glyph at a time, and no glyph reads as the figure. {@link textDraws}
 * stays one entry per call, for the reader that needs each draw's own extent.
 */
export { drawnTextLines, drawnTextRuns };

/**
 * Whether the frame drew `word` as a STANDALONE token, ignoring case.
 *
 * The stricter sibling of the shared harness's `drewText`
 * (`case-harness/text.ts`), for the copy `specs/ui.md` requires as a word
 * rather than as a substring — the how-to screen's `SPACE`, `ARROWS` and `AD`.
 * A screen reading "press the spacebar" contains `space` and does not name the
 * key the specification named. Read off the same logical runs as `drewText`,
 * for the same reason: `SPACE` letter-spaced a glyph per call is still the
 * word.
 */
export function drewWord(calls: readonly DrawCall[], word: string): boolean {
  const pattern = new RegExp(
    `(^|[^A-Za-z0-9])${word.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z0-9]|$)`,
    "i",
  );
  return drawnTextLines(calls).some((line) => pattern.test(line));
}

/**
 * Walk a frame's operations, handing `visit` each one with the transform in
 * force at it.
 *
 * A build is free to draw under a transform — to translate to a drone's centre
 * and draw at the origin, or to rotate a diving drone into its heading — so the
 * position and the orientation a call names are only what they mean once the
 * transform at that call is applied. The arithmetic is the package's
 * `transformed`; what stays here is the WALK, because this project's readings
 * need two things the package's own walks do not offer: every call visited, and
 * a starting state with a save stack under it, which is how a recorded frame's
 * inherited context reaches {@link blitsOfFrame}.
 */
export function walkTransforms(
  calls: readonly DrawCall[],
  visit: (call: DrawCall, m: Matrix) => void,
  start: Matrix = IDENTITY,
  stack: readonly Matrix[] = [],
): void {
  const saved: Matrix[] = [...stack];
  let current: Matrix = start;
  for (const call of calls) {
    if (call.kind !== "call") {
      visit(call, current);
      continue;
    }
    const { method, args } = call;
    if (method === "save") {
      saved.push(current);
    } else if (method === "restore") {
      current = saved.pop() ?? IDENTITY;
    } else {
      current = transformed(current, method, args) ?? current;
    }
    visit(call, current);
  }
}
/** The geometry calls a frame made, by name. */
export const DRAW_METHODS: readonly string[] = [
  "arc",
  "ellipse",
  "rect",
  "roundRect",
  "fillRect",
  "strokeRect",
  "moveTo",
  "lineTo",
  "quadraticCurveTo",
  "bezierCurveTo",
  "fill",
  "stroke",
  "drawImage",
];

/** How many drawing operations the frame issued. */
export function drawOps(calls: readonly DrawCall[]): number {
  return calls.filter(
    (call) => call.kind === "call" && DRAW_METHODS.includes(call.method),
  ).length;
}

/**
 * Every logical point a frame's drawing calls named, mapped through the
 * transform in force at each.
 *
 * The leading pair of arguments is the position for every method listed, except
 * the curve calls, whose control points come first and whose endpoint is the
 * last pair.
 */
export function drawnPoints(
  calls: readonly DrawCall[],
): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  walkTransforms(calls, (call, m) => {
    if (call.kind !== "call") return;
    const { method, args } = call;
    const push = (x: unknown, y: unknown): void => {
      if (typeof x === "number" && typeof y === "number") {
        points.push(applyMatrix(m, x, y));
      }
    };
    if (
      method === "arc" ||
      method === "ellipse" ||
      method === "rect" ||
      method === "roundRect" ||
      method === "fillRect" ||
      method === "strokeRect" ||
      method === "moveTo" ||
      method === "lineTo"
    ) {
      push(args[0], args[1]);
    } else if (method === "drawImage") {
      // The source comes first, so the destination is the pair after it — or,
      // in the nine-argument form, the pair after the source sub-rect.
      if (args.length >= 9) push(args[5], args[6]);
      else push(args[1], args[2]);
    } else if (method === "quadraticCurveTo") {
      push(args[0], args[1]);
      push(args[2], args[3]);
    } else if (method === "bezierCurveTo") {
      push(args[0], args[1]);
      push(args[2], args[3]);
      push(args[4], args[5]);
    }
  });
  return points;
}
/* -------------------------------------------------------------------------- */
/* The seeded sprite art                                                      */
/* -------------------------------------------------------------------------- */
//
// `specs/assets.md` seeds four PNGs under `assets/` and requires that the ship
// and the three drones are each drawn FROM that art rather than from art of the
// build's own.
//
// WHAT IS COMPARED IS THE ALPHA SILHOUETTE, NOT THE PIXELS. The specification
// asks for one silhouette in two band-states, and leaves the build free to reach
// them either way: it may composite the band's colour over the seeded PNG at draw
// time, or bake a per-band copy once at load and blit that. Under the second
// route the bitmap handed to `drawImage` is the build's own canvas and its
// COLOURS are the build's, but its SHAPE is still the seeded one — so the shape
// is what a sprite point reads. `presentation/both-bands-one-silhouette` turns on
// exactly that, and comparing pixels would fail the perfectly conformant second
// route.
//
// THE AGREEMENT IS A NUMBER, NOT A VERDICT. {@link silhouetteAgreement} reports
// the fraction of positions where two masks agree; the fraction a check will
// accept is the check's own figure, stated there (`presentation/fighter-from-sprite`
// says 99%). Nothing here fixes one.
//
// WHAT THE BUILD DREW comes back through the injected recorder rather than
// through `frameCalls`: `frameCalls` names a bitmap by its type alone, because it
// has to read the same whether or not a capture is running, and the recorder
// captures the bitmap's own pixels, which is what a silhouette comparison needs.
// {@link blitsOfFrame} arms it around a single frame and disarms it again, so
// nothing else in a suite is affected.

/**
 * A drawable source's alpha silhouette, normalized to a `SPRITE_SIZE` square.
 *
 * `255` where the source is opaque enough to read as drawn, `0` where it is not.
 * Normalized to one size so a build that bakes at another resolution, or blits
 * out of an atlas, is compared on the SHAPE it draws rather than on the number of
 * pixels it stored it in; sampled without smoothing, so pixel art stays crisp
 * and an edge does not soften into a half-alpha ramp that a threshold then reads
 * differently on the two sides of the comparison.
 */
export type Silhouette = Uint8Array;

/** The alpha a pixel needs to count as part of the silhouette. */
const ALPHA_ON = 128;

/**
 * `source`'s alpha silhouette, optionally cropped to a sub-rect first.
 *
 * The crop is what makes the comparison hold for a build that composed an atlas
 * of its own and blits out of it with the nine-argument `drawImage`: what is
 * compared is then the sub-rect the draw named rather than the sheet behind it.
 */
function silhouetteOf(
  source: { width: number; height: number },
  crop?: { x: number; y: number; width: number; height: number },
): Silhouette {
  const canvas = createCanvas(SPRITE_SIZE, SPRITE_SIZE);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
  ctx.imageSmoothingEnabled = false;
  // The cast is the one this comparison needs: everything handed here is a
  // bitmap this canvas implementation can blit, and the two decoders it comes
  // from do not share a nominal type.
  if (crop === undefined) {
    ctx.drawImage(source as never, 0, 0, SPRITE_SIZE, SPRITE_SIZE);
  } else {
    ctx.drawImage(
      source as never,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      SPRITE_SIZE,
      SPRITE_SIZE,
    );
  }
  const { data } = ctx.getImageData(0, 0, SPRITE_SIZE, SPRITE_SIZE);
  const mask = new Uint8Array(SPRITE_SIZE * SPRITE_SIZE);
  for (let i = 0; i < mask.length; i += 1) {
    mask[i] = data[i * 4 + 3] >= ALPHA_ON ? 255 : 0;
  }
  return mask;
}

/**
 * The fraction of positions, from `0` to `1`, at which two silhouettes agree.
 *
 * The measurement `presentation/fighter-from-sprite` and its four siblings state
 * their own figure against. Two masks of different lengths agree nowhere.
 */
export function silhouetteAgreement(a: Silhouette, b: Silhouette): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let same = 0;
  for (let i = 0; i < a.length; i += 1) if (a[i] === b[i]) same += 1;
  return same / a.length;
}

/** How many positions of a silhouette are drawn at all. */
export function silhouetteArea(mask: Silhouette): number {
  let count = 0;
  for (const value of mask) if (value !== 0) count += 1;
  return count;
}

/** One seeded sprite, as a sprite point reads it. */
export interface SeededSprite {
  name: SpriteName;
  /** The file it was read from, under `assets/`. */
  file: string;
  width: number;
  height: number;
  silhouette: Silhouette;
}

let seededSpritesPromise: Promise<
  Readonly<Record<SpriteName, SeededSprite>>
> | null = null;

/**
 * The four sprites `specs/assets.md` seeds, read off the workspace's own
 * `assets/` tree.
 *
 * Decoded once per suite worker and shared, because every sprite point in the
 * project wants the same four and decoding them is the one slow thing this
 * module does.
 */
export function seededSprites(): Promise<
  Readonly<Record<SpriteName, SeededSprite>>
> {
  seededSpritesPromise ??= (async () => {
    const sprites: Partial<Record<SpriteName, SeededSprite>> = {};
    for (const [name, file] of Object.entries(SPRITES) as [
      SpriteName,
      string,
    ][]) {
      const image = await loadImage(join(WORKSPACE_ROOT, "assets", file));
      sprites[name] = {
        name,
        file,
        width: image.width,
        height: image.height,
        silhouette: silhouetteOf(image),
      };
    }
    return sprites as Record<SpriteName, SeededSprite>;
  })();
  return seededSpritesPromise;
}

let seededBurstPromise: ParticleSystem | null = null;

/**
 * The seeded particle system a destroyed drone pops with, read off the
 * workspace's own `assets/` tree and parsed once per suite worker.
 *
 * WHAT A BURST CHECK DOES WITH IT. `specs/assets.md` says the build PLAYS this
 * system rather than hand-coding an effect of its own, and the snapshot reports
 * each live burst's own particle count — so a check that wants to know whether
 * what is playing really is the seeded system runs the package's own pure
 * simulator over this system for the same span and compares the two counts:
 *
 * ```ts
 * const sim = new ParticleSimulator(seededBurstSystem(), { seed: 1 });
 * sim.step(100);                       // milliseconds
 * sim.liveCount;                       // what the burst's own count is read against
 * ```
 *
 * The tolerance between the two is the check's own figure, stated there. Use the
 * pure `ParticleSimulator` rather than the package's canvas player: the player
 * issues a radial gradient per particle per frame, and there is nothing to draw
 * on in this process anyway.
 */
export function seededBurstSystem(): ParticleSystem {
  seededBurstPromise ??= JSON.parse(
    readFileSync(join(WORKSPACE_ROOT, "assets", BURST_SYSTEM), "utf8"),
  ) as ParticleSystem;
  return seededBurstPromise;
}

/**
 * One bitmap the recording captured, as a sprite point reads it.
 *
 * The shared replay format carries its image table as `unknown[]`, because what
 * a recorder interns is the recorder's own business; these three fields are what
 * a silhouette comparison needs, and `src` is absent on a bitmap the capture
 * budget degraded.
 */
interface RecordedImage {
  width: number;
  height: number;
  src?: string;
}

/** One `drawImage` a frame issued, as a sprite point reads it. */
export interface Blit {
  /** Where the destination box is centred, in logical stage units. */
  x: number;
  y: number;
  /** The destination box's size, in logical stage units, always positive. */
  width: number;
  height: number;
  /** Whether the box is mirrored on each axis. */
  flipX: boolean;
  flipY: boolean;
  /** The source bitmap's own size, before any destination scaling. */
  source: { width: number; height: number };
  /**
   * The transform in force at the call, as `[a, b, c, d, e, f]`.
   *
   * An axis-aligned draw carries zero in `b` and `c` whatever scale it was drawn
   * at, and a rotation puts the sine of its angle there.
   */
  transform: Matrix;
  /**
   * Whether the recorder captured the source's pixels at all.
   *
   * A bitmap the recorder's capture budget degraded carries none, and its
   * silhouette is then empty and its agreements zero — it matches nothing rather
   * than matching everything.
   */
  captured: boolean;
  /** The source's own alpha silhouette, for comparing two draws with each other. */
  silhouette: Silhouette;
  /** How closely that silhouette agrees with each seeded sprite's, `0` to `1`. */
  agreement: Readonly<Record<SpriteName, number>>;
}

/** Every sprite's agreement reported as zero: what an uncaptured source scores. */
function noAgreement(): Record<SpriteName, number> {
  const scores = {} as Record<SpriteName, number>;
  for (const name of Object.keys(SPRITES) as SpriteName[]) scores[name] = 0;
  return scores;
}

/**
 * Run one frame and hand back every `drawImage` it issued, each measured against
 * the seeded art.
 *
 * The recorder is armed for exactly this one frame and disarmed again, so a
 * capture a check is separately running is not disturbed — but do not call this
 * INSIDE a {@link captureReplay}, which owns the recorder for its section.
 */
export async function blitsOfFrame(h: Harness): Promise<Blit[]> {
  const seeded = await seededSprites();

  await h.page.evaluate(
    ([rec, design]) =>
      (window as unknown as Record<string, { arm(d: unknown): boolean }>)[
        rec
      ]!.arm(design),
    [
      RECORDER_GLOBAL,
      {
        width: STAGE_W,
        height: STAGE_H,
        background: DEFAULT_REPLAY_BACKGROUND,
      },
    ] as const,
  );
  await h.advance(1);
  const recording = (await h.page.evaluate(
    (rec) =>
      (window as unknown as Record<string, { disarm(): unknown }>)[
        rec
      ]!.disarm(),
    RECORDER_GLOBAL,
  )) as Recording | null;

  const blits: Blit[] = [];
  if (recording === null || recording.frames.length === 0) return blits;
  const frame = recording.frames[recording.frames.length - 1];

  const start = matrixOf(recording.states[frame.state]?.transform);
  const stack = frame.stack.map((index) =>
    matrixOf(recording.states[index]?.transform),
  );
  const calls = frame.ops.map((index) => toDrawCall(recording.ops[index]));

  // The silhouette of a source is derived once per bitmap and crop, however many
  // draws name it: a formation of forty-five drones is forty-five draws of the
  // same handful of bitmaps.
  const masks = new Map<string, Silhouette>();
  const pending: {
    imageIndex: number;
    crop?: { x: number; y: number; width: number; height: number };
    blit: Omit<Blit, "captured" | "silhouette" | "agreement">;
  }[] = [];

  walkTransforms(
    calls,
    (call, m) => {
      if (call.kind !== "call" || call.method !== "drawImage") return;
      const args = call.args;
      const source = args[0] as { $img?: number } | undefined;
      if (source === undefined || typeof source.$img !== "number") return;
      const image = recording.images[source.$img] as RecordedImage | undefined;
      if (image === undefined) return;

      let dx: number;
      let dy: number;
      let dw: number;
      let dh: number;
      if (args.length >= 9) {
        dx = Number(args[5]);
        dy = Number(args[6]);
        dw = Number(args[7]);
        dh = Number(args[8]);
      } else if (args.length >= 5) {
        dx = Number(args[1]);
        dy = Number(args[2]);
        dw = Number(args[3]);
        dh = Number(args[4]);
      } else {
        dx = Number(args[1]);
        dy = Number(args[2]);
        dw = image.width;
        dh = image.height;
      }
      if (![dx, dy, dw, dh].every((n) => Number.isFinite(n))) return;

      const p0 = applyMatrix(m, dx, dy);
      const p1 = applyMatrix(m, dx + dw, dy + dh);
      const subRect =
        args.length >= 9
          ? {
              x: Number(args[1]),
              y: Number(args[2]),
              width: Number(args[3]),
              height: Number(args[4]),
            }
          : undefined;
      pending.push({
        imageIndex: source.$img,
        crop:
          subRect !== undefined &&
          [subRect.x, subRect.y, subRect.width, subRect.height].every((n) =>
            Number.isFinite(n),
          )
            ? subRect
            : undefined,
        blit: {
          x: (p0.x + p1.x) / 2,
          y: (p0.y + p1.y) / 2,
          width: Math.abs(p1.x - p0.x),
          height: Math.abs(p1.y - p0.y),
          flipX: p1.x < p0.x,
          flipY: p1.y < p0.y,
          source: { width: image.width, height: image.height },
          transform: m,
        },
      });
    },
    start,
    stack,
  );

  for (const entry of pending) {
    const image = recording.images[entry.imageIndex] as RecordedImage;
    if (image.src === undefined) {
      blits.push({
        ...entry.blit,
        captured: false,
        silhouette: new Uint8Array(0),
        agreement: noAgreement(),
      });
      continue;
    }
    const key = `${entry.imageIndex}|${
      entry.crop === undefined
        ? "*"
        : `${entry.crop.x},${entry.crop.y},${entry.crop.width},${entry.crop.height}`
    }`;
    let mask = masks.get(key);
    if (mask === undefined) {
      mask = silhouetteOf(await loadImage(image.src), entry.crop);
      masks.set(key, mask);
    }
    const agreement = {} as Record<SpriteName, number>;
    for (const sprite of Object.values(seeded)) {
      agreement[sprite.name] = silhouetteAgreement(sprite.silhouette, mask);
    }
    blits.push({ ...entry.blit, captured: true, silhouette: mask, agreement });
  }
  return blits;
}

/** A recorded transform, as a matrix. */
function matrixOf(transform: number[] | null | undefined): Matrix {
  if (transform === null || transform === undefined || transform.length !== 6) {
    return [1, 0, 0, 1, 0, 0];
  }
  return [
    transform[0],
    transform[1],
    transform[2],
    transform[3],
    transform[4],
    transform[5],
  ];
}

/**
 * Every blit whose destination centre is within `within` logical units of `at`.
 *
 * `within` is the caller's, because how close a sprite has to sit to the entity
 * it draws is the check's requirement rather than this helper's —
 * `specs/assets.md` says each entity is drawn centred on its position, and the
 * check states how much of a footprint it will allow. What comes back carries the
 * silhouette agreements, so a check reads the one it is about against its own
 * figure.
 */
export function blitsNear(
  blits: readonly Blit[],
  at: { x: number; y: number },
  within: number,
): Blit[] {
  return blits.filter(
    (blit) => Math.hypot(blit.x - at.x, blit.y - at.y) <= within,
  );
}

/* -------------------------------------------------------------------------- */
/* Colour and the pixels a frame left                                         */
/* -------------------------------------------------------------------------- */
//
// `specs/overview.md` fixes NO PALETTE — the colours, the type and the glow are
// the build's — and what a player must read at a glance is the reviewer's
// presentation rating rather than any script's. So NOTHING BELOW IS READ AS
// APPEARANCE. A colour reading answers one question: whether the build painted
// something in a place the specification says something is drawn, decided as a
// CHANGE at that place against what the same place held with the thing gone.
// Two things the build drew are never held apart from each other, and no reading
// here compares against a hex value, a palette, a luminance or a contrast.

// `Rgb`, `colorDistance` and `luminance` are the package's, re-exported at the
// top of this file: the sampled colour, the euclidean distance between two, and
// the Rec. 709 weighting a starfield is read as dimmer along are the same three
// readings there under the same three names.

/**
 * A rectangle in logical stage units, addressed by its top-left corner.
 *
 * THIS CASE'S OWN, and deliberately not the package's `Rect`, which spells its
 * size `w`/`h`. Every region this project reads is stated `width`/`height`, in
 * the suites as well as here, and the two are structurally incompatible rather
 * than merely differently spelled — so folding them would be a rewrite of every
 * call site to gain nothing. {@link MenuRect}, which IS `w`/`h`, is the package's
 * shape and takes the package's `rectCenter`.
 */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The rendered colour at a logical point, averaged over a small cluster.
 *
 * The package's five-point cluster, at THIS project's own default reach. The
 * package's own `sampleColor` samples four units out and this one six, and a
 * default is not a spelling: every reading in this project was taken at six, and
 * a drone sampled at four reads a different mixture of body and glow.
 *
 * `spread` is the cluster's reach in logical units, and it is the caller's:
 * averaging is what keeps one stray anti-aliased or glow pixel from swinging a
 * reading, and how far a sample may stray from the point and still be ON the
 * thing being sampled is a fact about that thing's own footprint. A drone
 * `SHARD_SIZE` across takes the default comfortably; a `PLAYER_BULLET_W` bullet
 * is four units wide and takes `1`.
 */
export async function sampleColor(
  h: Harness,
  x: number,
  y: number,
  spread = 6,
): Promise<Rgb> {
  return meanOf(await h.pixels(clusterPoints(x, y, spread)));
}

/** The mean of a set of colours. */
export function average(colors: readonly Rgb[]): Rgb {
  if (colors.length === 0) return { r: 0, g: 0, b: 0 };
  let r = 0;
  let g = 0;
  let b = 0;
  for (const color of colors) {
    r += color.r;
    g += color.g;
    b += color.b;
  }
  return { r: r / colors.length, g: g / colors.length, b: b / colors.length };
}

/** The square of `size` logical units centred on a point: an entity's footprint. */
export function footprint(x: number, y: number, size: number): Rect {
  return { x: x - size / 2, y: y - size / 2, width: size, height: size };
}

/**
 * The most samples one {@link readRegion} may take.
 *
 * A guard on the caller rather than on the build: every sample crosses into the
 * page in one batch, and a full-field read at a one-unit step is nearly a million
 * of them. A region that needs more than this wants a coarser step.
 */
const MAX_REGION_SAMPLES = 40_000;

/**
 * Every pixel of a logical rectangle, on a lattice `step` units apart, read in
 * one crossing.
 *
 * The reading a region comparison is built out of: pose one state, read the
 * region; pose the other, read it again; and {@link regionDistance} says how far
 * apart the two pictures are. `step` is the caller's, because how finely a region
 * has to be sampled follows from what is drawn in it.
 */
export async function readRegion(
  h: Harness,
  rect: Rect,
  step = 2,
): Promise<Rgb[]> {
  const stride = Math.max(1, step);
  const columns = Math.max(1, Math.ceil(rect.width / stride));
  const rows = Math.max(1, Math.ceil(rect.height / stride));
  if (columns * rows > MAX_REGION_SAMPLES) {
    throw new RangeError(
      `spectra: readRegion of ${rect.width}x${rect.height} at step ${stride} ` +
        `wants ${columns * rows} samples, over the ${MAX_REGION_SAMPLES} bound; ` +
        `read it at a coarser step`,
    );
  }
  const points: { x: number; y: number }[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      points.push({
        x: rect.x + column * stride,
        y: rect.y + row * stride,
      });
    }
  }
  const read = await h.pixels(points);
  return read.map(([r, g, b]) => ({ r, g, b }));
}

/**
 * The mean RGB distance between two readings of the same region, sample for
 * sample.
 *
 * Two readings of different lengths are not comparable, and say so rather than
 * quietly comparing the prefix.
 */
export function regionDistance(a: readonly Rgb[], b: readonly Rgb[]): number {
  if (a.length !== b.length) {
    fail(
      `two readings of the same region (${a.length} samples)`,
      `${b.length} samples`,
    );
  }
  if (a.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += colorDistance(a[i], b[i]);
  return sum / a.length;
}

/**
 * How many samples of a reading sit further than `minDistance` from `base`.
 *
 * `minDistance` is the caller's: what counts as "painted rather than empty
 * field" is the check's own figure.
 */
export function countDiffering(
  reading: readonly Rgb[],
  base: Rgb,
  minDistance: number,
): number {
  return reading.filter((sample) => colorDistance(sample, base) > minDistance)
    .length;
}

/** The brightest sample of a reading, by luminance. */
export function brightest(reading: readonly Rgb[]): Rgb {
  return reading.reduce((best, sample) =>
    luminance(sample) > luminance(best) ? sample : best,
  );
}

/** The darkest sample of a reading, by luminance. */
export function darkest(reading: readonly Rgb[]): Rgb {
  return reading.reduce((best, sample) =>
    luminance(sample) < luminance(best) ? sample : best,
  );
}

/**
 * Points a field posed by {@link startPosed} leaves empty: inside the play field,
 * clear of both HUD strips, clear of the formation grid at its full sway, clear
 * of the ship's lane, and spread across the field so no one banner, readout or
 * overlay a build chose to place can cover them all.
 */
export const EMPTY_FIELD_POINTS: readonly { x: number; y: number }[] = [
  { x: 80, y: 200 },
  { x: 1200, y: 200 },
  { x: 80, y: 450 },
  { x: 1200, y: 450 },
  { x: 640, y: 480 },
];

/**
 * The empty field's colour: the darkest of {@link EMPTY_FIELD_POINTS}, sampled
 * off the canvas as it stands.
 *
 * The darkest of several rather than one fixed patch, because `specs/field.md`
 * puts a starfield behind the field and leaves a build free to place a banner, a
 * hint or a watermark anywhere it likes — and a patch a star or a banner sits on
 * reads lighter than one nothing is drawn on.
 */
export async function sampleField(h: Harness): Promise<Rgb> {
  const samples: Rgb[] = [];
  for (const point of EMPTY_FIELD_POINTS) {
    samples.push(await sampleColor(h, point.x, point.y));
  }
  return darkest(samples);
}

/* -------------------------------------------------------------------------- */
/* Reading a snapshot                                                         */
/* -------------------------------------------------------------------------- */
//
// Plain readings over the shape `specs/instrumentation.md` fixes. They compute
// nothing a check could not compute itself; they exist so that twenty suites
// spell the same lookup the same way, and so that a lookup that finds nothing
// fails with the entity it wanted named rather than as a `TypeError` two lines
// later.

/** The drone with that id, or `undefined`. */
export function droneById(
  snapshot: SpectraSnapshot,
  id: number,
): DroneView | undefined {
  return snapshot.drones.find((drone) => drone.id === id);
}

/** The drone with that id, failing the check with the scenario it needed. */
export function requireDrone(
  snapshot: SpectraSnapshot,
  id: number,
  doing = "the scenario",
): DroneView {
  const drone = droneById(snapshot, id);
  if (drone === undefined) {
    fail(
      `drone ${id} still on the field (${doing})`,
      `drones ${JSON.stringify(snapshot.drones.map((d) => d.id))}`,
    );
  }
  return drone;
}

/** The bullet with that id, of either kind, or `undefined`. */
export function bulletById(
  snapshot: SpectraSnapshot,
  id: number,
): BulletView | undefined {
  return snapshot.bullets.find((bullet) => bullet.id === id);
}

/** The bullet with that id, failing the check with the scenario it needed. */
export function requireBullet(
  snapshot: SpectraSnapshot,
  id: number,
  doing = "the scenario",
): BulletView {
  const bullet = bulletById(snapshot, id);
  if (bullet === undefined) {
    fail(
      `bullet ${id} still in flight (${doing})`,
      `bullets ${JSON.stringify(snapshot.bullets.map((b) => b.id))}`,
    );
  }
  return bullet;
}

/** The burst with that id, or `undefined`. */
export function burstById(
  snapshot: SpectraSnapshot,
  id: number,
): BurstView | undefined {
  return snapshot.bursts.find((burst) => burst.id === id);
}

/**
 * The last entry of a roster: the entity an `add` operation just appended.
 *
 * `specs/instrumentation.md` makes appending the rule precisely so an id is
 * findable without an assignment scheme, and these three are that rule.
 */
export function lastDrone(snapshot: SpectraSnapshot): DroneView | undefined {
  return snapshot.drones[snapshot.drones.length - 1];
}

export function lastBullet(snapshot: SpectraSnapshot): BulletView | undefined {
  return snapshot.bullets[snapshot.bullets.length - 1];
}

export function lastBurst(snapshot: SpectraSnapshot): BurstView | undefined {
  return snapshot.bursts[snapshot.bursts.length - 1];
}

/** Every drone of one kind, in roster order. */
export function dronesOfKind(
  snapshot: SpectraSnapshot,
  kind: DroneKind,
): DroneView[] {
  return snapshot.drones.filter((drone) => drone.kind === kind);
}

/** Every drone in one movement phase, in roster order. */
export function dronesInPhase(
  snapshot: SpectraSnapshot,
  phase: DronePhase,
): DroneView[] {
  return snapshot.drones.filter((drone) => drone.phase === phase);
}

/** The player's bullets: the ones travelling up. */
export function playerBullets(snapshot: SpectraSnapshot): BulletView[] {
  return snapshot.bullets.filter((bullet) => bullet.friendly);
}

/** The drones' bullets: the ones falling. */
export function enemyBullets(snapshot: SpectraSnapshot): BulletView[] {
  return snapshot.bullets.filter((bullet) => !bullet.friendly);
}

/* -------------------------------------------------------------------------- */
/* Scenario helpers                                                           */
/* -------------------------------------------------------------------------- */
//
// EVERY COMPOUND SEQUENCE IN THIS PROJECT LIVES HERE. The debug surface is
// atomic — `specs/instrumentation.md` gives it one operation per field — so there
// is no `startGame`, no `startStage` and no `spawnDrone({...})` to reach for on
// the surface, and there must not be: a patch operation would impose the case's
// own layout on the build. What a check wants instead is a helper, built out of
// those atomic operations, that poses the field and then lets the build's own
// update run from there.
//
// A CHECK TAKES ONLY THE PART IT ASKS FOR. Nothing below does anything a caller
// did not ask for: `startPosed` empties four rosters, shuts three gates and poses
// a live wave, and a check that wants a drone asks for one. A check that needs
// half a sequence calls the operations it needs.
//
// AND NONE OF THEM ASSERTS A VERDICT. A helper fails only when the game is not
// even in the situation the caller's scenario needs, and then with what it needed
// named.

/**
 * Pose an empty, quiet, live wave at `stage`, ready for a scenario.
 *
 * The sequence, and why each part of it is here:
 *
 *   - THE FOUR ROSTERS ARE EMPTIED. `clearDrones`, `clearPlayerBullets`,
 *     `clearEnemyBullets`, `clearBursts`. A scenario then poses the entities its
 *     requirement concerns and stands nothing else beside them, which is what the
 *     isolation rule asks for.
 *   - THE FOUR WORLD GATES ARE SHUT. Without `setWaveEntry(false)` the stage's
 *     own wave releases a group every `ENTER_GROUP_GAP` (0.6 s), so any scenario
 *     running longer than half a second is joined by drones it never asked for;
 *     without `setDiveLaunching(false)` an assembled formation launches its first
 *     dive `DIVE_FIRST_DELAY` (2.0 s) in and a posed drone can be pulled into one
 *     mid-scenario; without `setShipContact(false)` a drone posed near the bottom
 *     or an enemy bullet anywhere costs a life, which enters the `ready` phase and
 *     stops the wave; and without `setStageClearing(false)` the live stage's own
 *     clear test ends the stage the moment a scenario destroys the last drone it
 *     posed, which takes the screen off `inWave`, stops the field resolving
 *     contacts, and pays a bonus into the score a scoring check was about to read.
 *     Each gate is the WAVE's or the STAGE's own faculty rather than any entity's,
 *     which is why shutting it is not "parking an entity in a harmless corner".
 *     THE ITEMS THAT TURN A GATE BACK ON ARE THE ITEMS WHOSE REQUIREMENT THE GATE
 *     IS; any other check that finds itself wanting one has been mis-posed.
 *   - THE SCREEN IS LIVE. `inWave`/`live` with the phase timer at rest, so the
 *     field really is running rather than sitting behind an intro or a pause.
 *   - THE RUN IS AT ITS OPENING FIGURES. Score `0`, `START_LIVES` lives, the
 *     extra-life latch down, the meter empty and no inversion, so a check reads a
 *     change against a known number.
 *   - THE SHIP IS PARKED AT THE CENTRE OF ITS LANE, on cyan, with no lockout and
 *     no cooldown. It is the one entity no scenario can remove.
 *   - THE WAVE'S DIVE CLOCK IS AT ZERO, so a scenario that later opens the dive
 *     gate measures from a moment it chose.
 *
 * It poses no drone, no bullet and no burst: a check adds exactly what its
 * requirement concerns.
 *
 * A CHECK THAT DESTROYS A DRONE THEREFORE RUNS ON. With `stageClearing` shut, the
 * wave stays live however the field empties, so a scenario that poses one drone
 * and destroys it reads what the kill did rather than what the stage end did. The
 * items whose requirement IS the clear rule — `stages/clears-on-last-drone`,
 * `stages/empty-wave-does-not-clear` and `instrumentation/stage-clearing-gate` —
 * are the ones that leave the gate on.
 */
export async function startPosed(
  h: Harness,
  options: { stage?: number } = {},
): Promise<void> {
  await h.pose([
    ["clearDrones"],
    ["clearPlayerBullets"],
    ["clearEnemyBullets"],
    ["clearBursts"],
    ["setWaveEntry", false],
    ["setDiveLaunching", false],
    ["setStageClearing", false],
    ["setShipContact", false],
    ["setScreen", "inWave"],
    ["setPhase", "live"],
    ["setPhaseTimer", 0],
    ["setStage", options.stage ?? 1],
    ["setShipX", FORM_CENTER_X],
    ["setShipBand", "cyan"],
    ["setFireLockout", 0],
    ["setFireCooldown", 0],
    ["setResonance", 0],
    ["setInversion", 0],
    ["setLives", START_LIVES],
    ["setScore", 0],
    ["setExtraLifeAwarded", false],
    ["setChallengeHits", 0],
    ["setDiveClock", 0],
    // LAST IN THE BATCH, so the readings agree with the game this posed before
    // anything reads it, and the crossing count does not grow by one for it.
    // The stage, the resonance, the inversion, the phase and the ship's band are
    // all posed above, and the derived figures follow every one of them.
    ["reconcile"],
  ]);
}

/**
 * Pose a live run PAUSED, with `index` highlighted on the pause menu.
 *
 * The ground the pause menu's pointer and touch points stand on, and the pose
 * `screens/pause-quit` already uses: {@link startPosed} opens a live, empty, quiet
 * wave, and the screen and the highlight are then PLACED rather than walked to.
 * `specs/instrumentation.md` provides `setScreen` and `setMenuIndex` for exactly
 * that, so no menu key is pressed on the way in and the menu keys cannot fail the
 * points that stand here — a build whose `pause` binding or whose menu arrows are
 * broken still has its pointer and its touch graded on this screen, and
 * `controls/pause-escape`, `controls/pause-p` and the `controls` menu-arrow
 * points still decide the keys.
 *
 * One frame is run after the pose, so the screen the gesture then arrives on is
 * the paused screen the build's own code drew.
 */
export async function posePausedMenu(h: Harness, index: number): Promise<void> {
  await startPosed(h);
  await h.debug.setScreen("paused");
  await h.debug.setMenuIndex(index);
  await h.advance(1);
}

/** The lost run the gesture is made from (specs/progression.md). */
const POSED_STAGE = 6;
const POSED_SCORE = 7250;
const POSED_LIVES = 0;

/**
 * Pose a lost run on the game-over screen, with `index` highlighted on its menu.
 *
 * The ground the game-over menu's pointer and touch points stand on, and the pose
 * `screens/game-over-menu-returns` already uses: the run is PLACED lost — the
 * stage it reached, the score it ended on, no lives left — and the screen and the
 * highlight are placed with it. `specs/instrumentation.md` provides `setScreen`
 * and `setMenuIndex` for exactly that, so no life is spent and no menu key is
 * pressed on the way in, and neither the death path nor the menu keys can fail the
 * points that stand here — `progression/game-over-at-zero` still decides the route
 * in, and the `controls` menu-arrow points still decide the keys.
 *
 * There is no live wave to open first, unlike {@link posePausedMenu}: the run is
 * over, so the screen is placed on the field the harness starts with. One frame is
 * run after the pose, so the screen the gesture then arrives on is the game-over
 * screen the build's own code drew.
 */
export async function poseGameOverMenu(
  h: Harness,
  index: number,
): Promise<void> {
  await h.debug.setScreen("gameOver");
  await h.debug.setStage(POSED_STAGE);
  await h.debug.setScore(POSED_SCORE);
  await h.debug.setLives(POSED_LIVES);
  await h.debug.setMenuIndex(index);
  await h.advance(1);
}

/**
 * Open the wave the GAME builds for stage `n`, by running its stage intro out.
 *
 * The route for the handful of items whose requirement IS the wave the game
 * builds — how it is composed, how its groups arrive, what clearing it pays.
 * Everything else poses the field it needs with {@link startPosed} and
 * {@link poseFormation} instead.
 *
 * Nothing here is fabricated: the stage is set, the intro screen is posed with no
 * hold left, and one frame is run, so the build's own code is what builds the
 * wave and opens it. Call it on a harness that has just been created or just been
 * `reset`, where the three world gates stand as the specification leaves them —
 * ON — since a wave whose entry gate is shut releases nothing.
 */
export async function startStage(h: Harness, n: number): Promise<void> {
  await h.debug.setStage(n);
  await h.debug.setScreen("stageIntro");
  await h.debug.setPhaseTimer(0);
  await h.advance(1);
}

/**
 * Stand the wave the game built where its entrance ends: every drone at its own
 * slot, in phase `formation`, with the entry gate shut behind it.
 *
 * For the items whose requirement is the ASSEMBLED block the build laid out — its
 * composition, its symmetry, the bands it holds — and not the entrance that
 * assembles it. Every drone reports the slot it is bound for from the moment the
 * wave is built (specs/swarm.md, specs/instrumentation.md), and a drone in phase
 * `formation` sits at that slot plus the sway, so posing each drone there is the
 * state its entrance would leave it in, reached without flying the twelve seconds
 * `swarm/assembles` grades. Nothing about the roster is touched: which drones the
 * wave holds, their kinds, their stored bands and their slots are all still the
 * build's. The entry gate is shut so the wave's own release schedule cannot send a
 * drone back out on its way in.
 *
 * Call it after {@link startStage}. It poses, in one crossing, and returns; it
 * runs no frame.
 */
export async function settleWave(h: Harness): Promise<void> {
  const built = await h.snapshot();
  await h.pose([
    ["setWaveEntry", false],
    ...built.drones.flatMap((drone): SurfaceCall[] => [
      ["setDronePhase", drone.id, "formation"],
      ["setDronePosition", drone.id, drone.slotX, drone.slotY],
    ]),
  ]);
}

/**
 * Open a run the way a player does: from a reset title, confirm the highlighted
 * first item, the mode entry.
 *
 * The route for a check about what a NEW RUN is — its lives, its stage, its
 * score, the wave the game lays out — none of which any pose can produce, because
 * `setStage` spawns nothing and `setScore` grants nothing. Nothing here is posed:
 * `reset` is the surface's own, and the rest is a real key through Chromium's
 * input pipeline.
 */
export async function startRunFromTitle(h: Harness): Promise<void> {
  await h.debug.reset();
  await h.debug.setMenuIndex(0);
  await h.tap("Enter");
  await h.advance(1);
}

/** How a drone is posed. Every faculty defaults OFF: a posed drone is a prop. */
export interface DroneSpec {
  /** Its stored band. Defaults to the cyan `addDrone` gives it. */
  band?: Band;
  /** Its movement phase. Defaults to the `formation` `addDrone` gives it. */
  phase?: DronePhase;
  /** The centre of its resting slot. Defaults to where it was placed. */
  slotX?: number;
  slotY?: number;
  /** How far a Flux is into its current band window, in seconds. */
  bandClock?: number;
  /** Whether a Prism's outer shell stands. */
  shell?: boolean;
  /** THE OVERLOAD VARIANT ONLY: the mismatched shots it carries. */
  charge?: number;
  /** Its locomotion. */
  travel?: boolean;
  /** A Flux's band clock. */
  oscillation?: boolean;
  /** Its firing during a dive. */
  fire?: boolean;
}

/**
 * Put one drone of `kind` on the field with its centre at `(x, y)`, and hand back
 * its id.
 *
 * Built one field at a time out of `addDrone` and the setters, because the
 * surface takes no layout: the case never imposes a shape on the build.
 *
 * ALL THREE FACULTIES DEFAULT OFF, which is the opposite of what `addDrone`
 * gives, and it is the important part of this helper. Most drones a check poses
 * are props — a target for a shot, a body for a contact test, one drone of a
 * discharge's reach — and a prop that travels, oscillates or fires wanders into the
 * scenario that posed it. A check asks for the one faculty its requirement is:
 *
 *   - a Flux's rhythm poses `oscillation: true` and leaves travel off, so the
 *     band clock is the only thing moving and the drone is where it was put a
 *     full cycle later;
 *   - how a drone TRAVELS poses `travel: true` and leaves oscillation off, so the
 *     band it is read at is the band it was posed with;
 *   - a dive's fire poses `travel` and `fire`; a dive's PATH poses `fire: false`,
 *     so no bullet it spawns can reach the ship and end the scenario.
 */
export async function poseDrone(
  h: Harness,
  kind: DroneKind,
  x: number,
  y: number,
  spec: DroneSpec = {},
): Promise<number> {
  const added = lastDrone(await h.pose([["addDrone", kind, x, y]]));
  if (added === undefined) {
    fail(
      "addDrone to append a drone to the roster (specs/instrumentation.md)",
      "the drone roster was still empty after addDrone",
    );
  }
  await h.pose(arrangeDrone(added, spec));
  return added.id;
}

/**
 * The surface calls that turn the drone `addDrone` just appended into the one
 * `spec` asks for, in the order they must run in.
 *
 * Split out so {@link poseFormation} can lay a whole formation out in one
 * crossing rather than one per drone: the calls are the same, in the same order
 * per drone, and every one of them names the drone it acts on.
 */
function arrangeDrone(added: DroneView, spec: DroneSpec): SurfaceCall[] {
  const id = added.id;
  const calls: SurfaceCall[] = [];

  if (spec.band !== undefined) calls.push(["setDroneBand", id, spec.band]);
  if (spec.slotX !== undefined || spec.slotY !== undefined) {
    calls.push([
      "setDroneSlot",
      id,
      spec.slotX ?? added.slotX,
      spec.slotY ?? added.slotY,
    ]);
  }
  if (spec.bandClock !== undefined) {
    calls.push(["setDroneBandClock", id, spec.bandClock]);
  }
  if (spec.shell !== undefined) calls.push(["setDroneShell", id, spec.shell]);
  if (spec.charge !== undefined)
    calls.push(["setDroneCharge", id, spec.charge]);
  // The phase last of the arrangements, so a build whose phase entry lays out a
  // path reads the slot and the band this pose gave the drone rather than the
  // ones `addDrone` did.
  if (spec.phase !== undefined) calls.push(["setDronePhase", id, spec.phase]);

  calls.push(["setDroneTravel", id, spec.travel ?? false]);
  calls.push(["setDroneOscillation", id, spec.oscillation ?? false]);
  calls.push(["setDroneFire", id, spec.fire ?? false]);
  // The band, the shell and the band clock posed above are what a drone's
  // `effectiveBand` and its `shimmer` follow, so the readings are brought into
  // agreement before the caller reads any of them back. It is the LAST entry of
  // the batch, so a formation of forty still costs the crossings it did.
  calls.push(["reconcile"]);
  return calls;
}

/** One entry of a posed formation: a kind, a slot of the grid, and its spec. */
export interface FormationEntry extends DroneSpec {
  kind: DroneKind;
  /** The grid column, `0` to `FORM_COLS - 1`. */
  col: number;
  /** The grid row, `0` to `FORM_ROWS - 1`. */
  row: number;
}

/**
 * Pose a formation: one drone per entry, each at its slot's centre, in phase
 * `formation` with its slot set to that centre.
 *
 * The sway is the wave's own and is not posed here — a drone in a slot rides
 * whatever offset the build's sway clock is at — so a check reading a position
 * reads the slot plus that offset, which is what `field/formation-holds-slot`
 * grades.
 *
 * Every faculty still defaults off, as in {@link poseDrone}: a formation posed for
 * a dive check turns travel on for the drone it is about.
 *
 * TWO CROSSINGS, WHATEVER THE FORMATION HOLDS. The roster is appended to for
 * every entry in one crossing, and every drone is then arranged in a second, in
 * the same per-drone order {@link poseDrone} uses. Nothing runs between the two:
 * no frame is opened, so the field a check reads is the one it laid out, and a
 * formation of forty costs what a formation of one does. Adding a drone poses one
 * field of the game (`specs/instrumentation.md`), so the drones already on the
 * roster decide nothing about the drone appended after them.
 */
export async function poseFormation(
  h: Harness,
  entries: readonly FormationEntry[],
): Promise<number[]> {
  const specs = entries.map((entry) => {
    const x = slotX(entry.col);
    const y = slotY(entry.row);
    return {
      kind: entry.kind,
      x,
      y,
      spec: {
        ...entry,
        slotX: entry.slotX ?? x,
        slotY: entry.slotY ?? y,
        phase: entry.phase ?? "formation",
      } satisfies DroneSpec,
    };
  });

  const appended = await h.pose(
    specs.map(
      (entry) => ["addDrone", entry.kind, entry.x, entry.y] as SurfaceCall,
    ),
  );
  const added = appended.drones.slice(-specs.length);
  if (added.length !== specs.length) {
    fail(
      `addDrone to append one drone per entry to the roster, so a formation of ` +
        `${String(specs.length)} stands (specs/instrumentation.md)`,
      `the roster held ${String(appended.drones.length)} drones after ` +
        `${String(specs.length)} addDrone calls`,
    );
  }

  await h.pose(
    added.flatMap((drone, index) => arrangeDrone(drone, specs[index].spec)),
  );
  return added.map((drone) => drone.id);
}

/**
 * Every slot of the grid, filled with one kind: the "complete formation" the four
 * dive-timing items pose before they open the dive gate.
 *
 * Geometry alone — `FORM_COLS` by `FORM_ROWS` of `slotX`/`slotY` — so a check
 * that wants a different composition writes its own entries.
 */
export function fullFormation(
  kind: DroneKind = "shard",
  spec: DroneSpec = {},
): FormationEntry[] {
  const entries: FormationEntry[] = [];
  for (let row = 0; row < FORM_ROWS; row += 1) {
    for (let col = 0; col < FORM_COLS; col += 1) {
      entries.push({ ...spec, kind, col, row });
    }
  }
  return entries;
}

/** How a shot is placed and how far it is allowed to travel. */
export interface Shot {
  /**
   * How far BELOW the target the bullet's centre starts, in logical units.
   *
   * The caller's, because it is the check's own scenario: a shot has to start
   * clear of everything but the thing it is aimed at, and how much clearance that
   * needs follows from what else the check posed.
   */
  below: number;
  /**
   * Frames the sweep may run before it gives up.
   *
   * Defaults to the frames a bullet needs to climb `below` at
   * `PLAYER_BULLET_SPEED` plus the target's own approach, which is geometry
   * rather than a tolerance. A check whose target is moving toward or away from
   * the shot states its own.
   */
  maxFrames?: number;
  /**
   * Surface calls run in the shot's own crossing, immediately before the bullet
   * is added.
   *
   * For the arrangement a shot is aimed at rather than for the shot: bringing
   * the target to the spot it is fired at, say. Nothing runs between them and no
   * frame divides them, so the field the bullet enters is the one they left.
   */
  pose?: readonly SurfaceCall[];
}

/**
 * Put one of the player's bullets in flight `shot.below` units under `(x, y)` and
 * run the game until that bullet has resolved.
 *
 * The sequence a band, drone or scoring check runs over and over: a bullet
 * starting below the target, climbing into it, and the build's own contact and
 * band rules deciding the rest. Nothing about the outcome is posed — what the
 * shot does is exactly what the game does with it.
 *
 * The sweep ends when the bullet leaves the roster, which is what a hit and a
 * miss off the top of the field both do; `hit` says whether it resolved inside
 * the frames allowed. What comes back also carries the bullet's id, so a check
 * that wants to see the bullet SURVIVE (or be consumed) can look it up.
 */
export async function fireAt(
  h: Harness,
  x: number,
  y: number,
  band: Band,
  shot: Shot,
): Promise<SweepResult & { id: number }> {
  return sweepShot(
    h,
    [...(shot.pose ?? []), ["addPlayerBullet", x, y + shot.below, band]],
    {
      maxFrames:
        shot.maxFrames ?? framesFor(shot.below / PLAYER_BULLET_SPEED) + 2,
    },
  );
}

/**
 * Put a bullet on the field and follow it to its contact, in ONE crossing.
 *
 * The shape almost every scenario in this project is built out of, and the one
 * that decides how much of a check's cost is the host's: the bullet is added, the
 * roster it landed in is read, and the frames it takes to climb into its target
 * are run and watched, all inside the page. The bullet it followed is the one the
 * add appended, read in the page from the roster the pose left, so nothing has to
 * come back for its id first.
 */
async function sweepShot(
  h: Harness,
  pose: readonly SurfaceCall[],
  shot: { maxFrames?: number },
): Promise<SweepResult & { id: number }> {
  const swept = await h.sweep(
    (snapshot, _argument, arranged) => {
      const added = arranged.bullets[arranged.bullets.length - 1];
      if (added === undefined) return true;
      return !snapshot.bullets.some((one) => one.id === added.id);
    },
    null,
    { arrange: pose, maxFrames: shot.maxFrames ?? framesFor(1) },
  );
  const added = lastBullet(swept.arranged);
  if (added === undefined) {
    fail(
      "the add to append a bullet to the roster (specs/instrumentation.md)",
      "the bullet roster was still empty after it",
    );
  }
  return { ...swept, id: added.id };
}

/**
 * {@link fireAt} the drone with that id, reading its centre off the snapshot
 * first.
 *
 * The shot's band is the caller's, because whether it matches is the whole
 * question a band check asks.
 */
export async function shootDrone(
  h: Harness,
  id: number,
  band: Band,
  shot: Shot,
): Promise<SweepResult & { id: number }> {
  const drone = requireDrone(await h.snapshot(), id, "the shot's target");
  return fireAt(h, drone.x, drone.y, band, shot);
}

/**
 * Put one enemy bullet `above` units over the ship and run the game until it has
 * resolved.
 *
 * The sequence the shield, the life and the resonance checks run: a bullet
 * falling into the ship, with the build's own contact rules deciding whether it
 * is absorbed, whether it costs a life, and what it fills. The caller turns
 * `setShipContact(true)` back on first — it is one of the three gates
 * {@link startPosed} shuts, and these are the items whose requirement it is.
 */
export async function fireAtShip(
  h: Harness,
  band: Band,
  shot: { above: number; maxFrames?: number },
): Promise<SweepResult & { id: number }> {
  const before = await h.snapshot();
  // The stage's own enemy-bullet speed, which is what the surface gives a bullet
  // it adds, so the frames the sweep allows cover the distance it really falls.
  const speed = ENEMY_BULLET_SPEED * before.bulletSpeedScale;
  return sweepShot(
    h,
    [["addEnemyBullet", before.ship.x, SHIP_Y - shot.above, band]],
    { maxFrames: shot.maxFrames ?? framesFor(shot.above / speed) + 2 },
  );
}

/**
 * Run the game until the bullet with that id is no longer in the roster.
 *
 * The sweep every band, drone, scoring and screen check runs, several times
 * over, so it is decided in the page: a shot climbing into its target is tens of
 * frames, and a check that paid a round trip for each of them would be reporting
 * how busy the host was as much as what the build did.
 */
export async function driveBullet(
  h: Harness,
  id: number,
  options: UntilOptions = {},
): Promise<UntilResult> {
  return h.sweep(
    (snapshot, bullet) => !snapshot.bullets.some((one) => one.id === bullet),
    id,
    {
      maxFrames: options.maxFrames ?? framesFor(1),
      poll: options.poll ?? 1,
    },
  );
}

/** Show or hide the read-only debug overlay, through its fixed Backquote binding. */
export async function toggleOverlay(h: Harness): Promise<void> {
  await h.tap(OVERLAY_KEY);
}

/* -------------------------------------------------------------------------- */
/* Menus, driven by a real mouse and a real finger                            */
/* -------------------------------------------------------------------------- */
//
// The menus take a pointer and a touch contact as well as the keyboard
// (`specs/ui.md`), and where a build LAYS the items out is the build's own — so a
// check asks the build where it put an item, through `menuItemRect`, and then
// drives Chromium's real mouse or a real touch contact at that region. Nothing
// here poses a pointer through the surface: a pose would tell the build where the
// pointer is without making its own input layer see a press, a travel and a
// release the way a hand does, and what these checks are about is precisely that
// the build reads them.
//
// EACH PART OF A GESTURE RUNS EXACTLY ONE DRIVEN FRAME, so a caller counting
// frames can add them up, and a build that reads its input once per frame sees
// every edge.

/**
 * Where the build put item `index` of the menu the current screen shows.
 *
 * Fails by assertion when the build reports no region for an item its own menu
 * shows, so the point names that fault rather than dividing by a `null` several
 * lines later. A check that is ABOUT the reading returning `null` — on a screen
 * with no menu, or past the end of one — calls `h.debug.menuItemRect` directly.
 */
export async function menuRect(h: Harness, index: number): Promise<MenuRect> {
  const rect = await h.debug.menuItemRect(index);
  assertTruthy(
    rect,
    `menuItemRect(${index}) must report the hit region of item ${index} on the ` +
      "menu the current screen shows (specs/instrumentation.md)",
  );
  return rect as MenuRect;
}

/** Move the real mouse onto item `index`, and run the frame that reads it. */
export async function pointerOntoItem(
  h: Harness,
  index: number,
): Promise<void> {
  const at = rectCenter(await menuRect(h, index));
  await mouseGlide(h, at.x, at.y);
}

/** Press and release the real mouse inside item `index`'s region. */
export async function clickItem(h: Harness, index: number): Promise<void> {
  const at = rectCenter(await menuRect(h, index));
  const css = h.css(at.x, at.y);
  await h.page.mouse.move(css.x, css.y);
  await h.advance(1);
  await h.page.mouse.down();
  await h.advance(1);
  await h.page.mouse.up();
  await h.advance(1);
}

/**
 * Press on one item, travel to another, and release there.
 *
 * The two edges fall in different regions, so this confirms nothing — the
 * affordance that lets a player slide off a control to cancel, which
 * `specs/ui.md` states and a check reads back as a `menuIndex` that moved and a
 * screen that did not.
 */
export async function dragBetweenItems(
  h: Harness,
  from: number,
  to: number,
): Promise<void> {
  const start = rectCenter(await menuRect(h, from));
  const end = rectCenter(await menuRect(h, to));
  const a = h.css(start.x, start.y);
  const b = h.css(end.x, end.y);
  await h.page.mouse.move(a.x, a.y);
  await h.advance(1);
  await h.page.mouse.down();
  await h.advance(1);
  await h.page.mouse.move(b.x, b.y);
  await h.advance(1);
  await h.page.mouse.up();
  await h.advance(1);
}

/** Land a real touch contact inside item `index`'s region and leave it down. */
export async function landOnItem(h: Harness, index: number): Promise<void> {
  const at = rectCenter(await menuRect(h, index));
  await touchPress(h, at.x, at.y);
}

/** Lift the contact `landOnItem` left down. */
export async function liftContact(h: Harness): Promise<void> {
  await touchRelease(h);
}

/**
 * Land a real touch contact inside item `index`'s region and lift it there.
 *
 * The landing selects the item as well as confirming it, because a finger does
 * not hover (`specs/ui.md`) — which is the difference between this and
 * {@link clickItem}, and the reason both exist.
 */
export async function tapItem(h: Harness, index: number): Promise<void> {
  await landOnItem(h, index);
  await liftContact(h);
}

/** Land a contact on one item, travel to another, and lift there: confirms nothing. */
export async function touchBetweenItems(
  h: Harness,
  from: number,
  to: number,
): Promise<void> {
  await landOnItem(h, from);
  const end = rectCenter(await menuRect(h, to));
  await touchGlide(h, end.x, end.y);
  await liftContact(h);
}
