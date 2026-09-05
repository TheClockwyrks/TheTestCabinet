// Spectra — the shared validator harness. CASE-PROVIDED.
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
// IT IS STILL A VITEST PROJECT, AND THAT IS DELIBERATE. The runner locates the
// build output before it chooses between the vitest and browser paths, so `dist/`
// is on disk by the time this project runs. Staying a vitest project is what lets
// the case name ONE script per review item and have it resolve under all three
// engines — `validation/swarm/dive-speed.test.ts` is the same path whichever
// engine the run selected — and what keeps `format = 2` resolution passing.
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
// waiting, and no measurement of the machine it ran on. The one check that is
// ABOUT the loop running itself (`instrumentation/advances-in-real-time`) hands it
// back with {@link Harness.runFor}.
//
// EVERYTHING CROSSING INTO THE PAGE IS ASYNC. That is the whole of the difference
// between a suite here and its counterpart under an engine: `await h.snapshot()`
// rather than `h.snapshot()`, `await h.debug.setShipBand("magenta")` rather than
// `h.debug.setShipBand(...)`. The scenarios, the tolerances, and the assertions
// are the same ones, because they are the case's rather than the runtime's.
//
// THERE IS NO SPRITE SHIM HERE, AND THAT IS NOT AN OVERSIGHT. Under an engine a
// validator runs the build's own module inside this node process, and the
// engine's asset loader reaches for `fetch` and `createImageBitmap`, so both
// globals have to be stood up over the workspace's `assets/` tree. Under THIS
// engine nothing of the sort happens: the build loads its own art in the page,
// where both globals are the browser's real ones, and the only thing this process
// reads off disk is the seeded art it compares AGAINST — through `@napi-rs/canvas`
// and `node:fs`, which need no shim. Standing one up here would stand in for a
// call nothing in this project makes.
//
// ONE SERVER, ONE BROWSER, ONE PAGE PER HARNESS. `globalSetup.ts` starts the
// server and the browser once for the whole project; this module connects to
// them from inside each suite's worker and opens a page per harness, so every
// check drives a build that has just started and no check can be affected by
// what the one before it pressed, opened or muted.

import { createCanvas, loadImage } from "@napi-rs/canvas";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { expect, inject } from "vitest";
import type { ParticleSystem } from "@test-cabinet/particle-runtime";
import type { Browser, BrowserContext, CDPSession, Page } from "playwright";
import { connectChromium } from "./chromium";
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

declare module "vitest" {
  export interface ProvidedContext {
    /** Where the built site is served, from `globalSetup.ts`. */
    spectraUrl: string;
    /** The one Chromium every suite worker connects to. */
    spectraBrowserWs: string;
  }
}

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
  reset(options?: { seed?: number }): Promise<void>;
  snapshot(): Promise<SpectraSnapshot>;
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
 * harness's own recorded stepping rather than to a batch of poses.
 */
export type PoseOperation = Exclude<
  keyof SpectraDebugApi,
  "snapshot" | "advance"
>;

/**
 * One call into the build's surface: the operation's name, then its arguments.
 *
 * Typed against {@link SpectraDebugApi} operation by operation, so a batch is
 * checked exactly as the direct call it replaces would be.
 */
export type SurfaceCall = {
  [K in PoseOperation]: readonly [K, ...Parameters<SpectraDebugApi[K]>];
}[PoseOperation];

/* -------------------------------------------------------------------------- */
/* The step schedule                                                          */
/* -------------------------------------------------------------------------- */
//
// The suite chooses the size of a frame, because the specification deliberately
// fixes none: `specs/simulation.md` mandates no fixed timestep, every rate is per
// second and integrated against the elapsed time of the frame, and a frame
// divides into whole sub-steps of at most `SUBSTEP_MAX` itself. So a build must
// reach the same place however that time was divided, and the check that is ABOUT
// the division (`instrumentation/deterministic-core`) drives the same second as
// one frame, as sixty and as a hundred and twenty.
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

/** A source of frame deltas, in milliseconds. */
export interface Clock {
  /** The next frame's delta, in ms. */
  delta(): number;
  /**
   * Put `frames` deltas back, so the next one handed out is the one that was
   * handed out `frames` calls ago.
   *
   * A sweep asks for every delta it MIGHT run before it crosses into the page,
   * because the frames are run there, and hands back the ones it did not use.
   * Without this a sweep that stopped early would leave a stepping clock further
   * along than the frames it actually ran, and the next sweep would step
   * differently for it.
   */
  rewind(frames: number): void;
}

/** The frame the suite steps in, in milliseconds. */
export const TICK_HZ = 100;
export const TICK_MS = 1000 / TICK_HZ;

/** Every frame the same length. */
export class ConstantClock implements Clock {
  constructor(private readonly ms: number) {}
  delta(): number {
    return this.ms;
  }
  rewind(): void {
    // Every frame is the same length, so where the clock stands decides nothing.
  }
}

/** A repeating pattern of steps: what an uneven but predictable display gives. */
export class SequenceClock implements Clock {
  private index = 0;
  constructor(private readonly stepsMs: readonly number[]) {
    if (stepsMs.length === 0) {
      throw new RangeError("SequenceClock needs at least one step, got none");
    }
  }
  delta(): number {
    const step = this.stepsMs[this.index % this.stepsMs.length];
    this.index += 1;
    return step;
  }
  rewind(frames: number): void {
    this.index = Math.max(0, this.index - frames);
  }
}

/**
 * A hash of the seed and the frame index, avalanched so that neighbouring
 * indices — which is all a frame counter ever produces — do not yield
 * neighbouring outputs. The constants and the order are the engine's
 * (`packages/simple-2d/src/clocks.ts`), so a seed means the same thing here as
 * it does in the two engine-backed projects next door.
 */
function hash32(seed: number, index: number): number {
  let h =
    (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(index | 0, 0x85ebca6b)) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h, 0x21f0aaad) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 0x735a2d97) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return h >>> 0;
}

/**
 * A seeded draw from a range, indexed by frame: the clock that stands in for a
 * real machine under load. The seed is mandatory, because a claim that a build is
 * delta-time independent is worth making only when the failing case replays.
 */
export class JitterClock implements Clock {
  private index = 0;
  private readonly spanMs: number;
  constructor(
    private readonly minMs: number,
    maxMs: number,
    private readonly seed: number,
  ) {
    if (maxMs < minMs) {
      throw new RangeError(
        `JitterClock needs maxMs >= minMs, got minMs ${minMs} and maxMs ${maxMs}`,
      );
    }
    this.spanMs = maxMs - minMs;
  }
  delta(): number {
    const index = this.index;
    this.index += 1;
    return (
      this.minMs + (hash32(this.seed, index) / 0x1_0000_0000) * this.spanMs
    );
  }
  rewind(frames: number): void {
    this.index = Math.max(0, this.index - frames);
  }
}

/** Seconds of simulated time in `frames` frames of the default clock. */
export function seconds(frames: number): number {
  return frames / TICK_HZ;
}

/** Frames of the default clock covering `duration` seconds. */
export function framesFor(duration: number): number {
  return Math.round(duration * TICK_HZ);
}

/** A rate in units per second from a displacement measured over `frames` frames. */
export function speedOverFrames(delta: number, frames: number): number {
  return (Math.abs(delta) * TICK_HZ) / frames;
}

/* -------------------------------------------------------------------------- */
/* The harness                                                                */
/* -------------------------------------------------------------------------- */

/** One recorded operation on the 2D context, in the order the render made it. */
export type DrawCall =
  | {
      kind: "call";
      method: string;
      args: unknown[];
      /**
       * For `fillText` and `strokeText`, the run's measured width in the
       * context's own units and the alignment in force, both read off the
       * context at the call. Only that context can say how wide a run is: the
       * width follows from the font, the letter spacing and the direction, none
       * of which the call itself carries. {@link textDraws} turns the pair into
       * the run's span.
       */
      width?: number;
      textAlign?: string;
    }
  | { kind: "set"; property: string; value: unknown };

/** A sound the build emitted, and the frame of the drive it emitted it on. */
export interface TimedCue {
  /** The frame it sounded on, 1-based, as {@link Harness.frame} reports. */
  frame: number;
  /** The frame loop's simulated time at that frame, in milliseconds. */
  t: number;
}

/** How the stage is mapped onto the canvas: one uniform scale and a letterbox. */
export interface Viewport {
  width: number;
  height: number;
  scale: number;
  offsetX: number;
  offsetY: number;
}

/** A rectangle in logical stage units, addressed by its top-left corner. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface HarnessOptions {
  /** The clock each frame takes its delta from. Defaults to 100 Hz. */
  clock?: Clock;
  /** The window's CSS width. Defaults to the logical stage width. */
  cssWidth?: number;
  /** The window's CSS height. Defaults to the logical stage height. */
  cssHeight?: number;
  /** Device pixels per CSS pixel. Defaults to 1, so one device pixel is one unit. */
  dpr?: number;
}

/** How far a sweep may run, and how many frames separate two samples. */
export interface UntilOptions {
  maxFrames?: number;
  poll?: number;
}

/** {@link Harness.sweep}'s options: a sweep's own, plus what to pose before it. */
export interface SweepOptions extends UntilOptions {
  /** Surface calls run before the first reading, in the sweep's own crossing. */
  pose?: readonly SurfaceCall[];
}

/** What a sweep found, and the state its `pose` left before the first frame ran. */
export interface SweepResult extends UntilResult {
  posed: SpectraSnapshot;
}

/** What a sweep found: whether the predicate ever held, and where it stopped. */
export interface UntilResult {
  hit: boolean;
  /** Frames advanced before the sample that ended the sweep. */
  frames: number;
  snapshot: SpectraSnapshot;
}

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

export interface Harness {
  /** The page the build is running in. For a check that needs Playwright itself. */
  readonly page: Page;
  /**
   * The surface the BUILD installed, as operations that cross into the page.
   *
   * Read off `window.__spectra` and never constructed here — see
   * {@link unexposedSurface}.
   */
  readonly debug: SpectraDebugApi;
  /**
   * Why the build's surface cannot be driven, or `null` when it can.
   *
   * A fault here is the build's: the surface is missing, or it is missing an
   * operation the specification requires. It says what was found
   * (`window.__spectra was still absent 10s after the page loaded`), and
   * {@link failSurface} pairs it with what the specification requires. Every
   * operation fails BY ASSERTION with that pair rather than throwing, so a
   * missing surface lands as the verdict of every point that reaches for it —
   * and, crucially, a harness built in a `beforeEach` still comes back, so the
   * fault is reported by the check rather than buried in a hook.
   */
  readonly surfaceFault: string | null;
  /** Everything the page logged to `console.error`, or threw, oldest first. */
  readonly pageErrors: string[];

  /** The frames this harness has driven, 1-based, as a recorded frame counts them. */
  frame(): number;
  /** The simulated time those frames covered, in milliseconds. */
  timeMs(): number;

  /** A fresh read of the game's state through the build's `snapshot`. */
  snapshot(): Promise<SpectraSnapshot>;
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
   * nothing: a pose is an arrangement, and {@link advance} is what runs it.
   */
  pose(calls: readonly SurfaceCall[]): Promise<SpectraSnapshot>;
  /** Run `frames` frames back to back, each the length the clock says. */
  advance(frames: number): Promise<void>;
  /** Advance until `predicate` holds, sampling every `poll` frames. */
  until(
    predicate: (snapshot: SpectraSnapshot) => boolean,
    options?: UntilOptions,
  ): Promise<UntilResult>;
  /**
   * {@link until}, with the predicate decided INSIDE the page, so the whole sweep
   * is one crossing.
   *
   * Identical in what it drives and what it reports: the same frames, one
   * `advance(dt, 1)` each, the predicate read before the first frame and after
   * every `poll` of them, and the sweep stopping on the frame it first holds.
   * What changes is that the frames and the readings happen in the page instead
   * of a round trip apart, so a sweep of a hundred frames costs one crossing
   * rather than a hundred. A round trip's cost is a fact about how busy the host
   * is, and a check that spends a hundred of them has made its verdict one too.
   *
   * THE PREDICATE IS CARRIED INTO THE PAGE AS SOURCE, so it must stand on its
   * own: it sees its three parameters and nothing else. Anything it needs from
   * the suite is passed as `argument`, which crosses as JSON. A predicate that
   * reaches for a binding of the suite's fails in the page and the check reports
   * it, so a mistake here is loud rather than quiet.
   *
   * `options.pose` runs surface calls first, in the same crossing, exactly as
   * {@link pose} would; the state they left is read once and handed to the
   * predicate as its third parameter and back to the caller as
   * {@link SweepResult.posed}. That is what lets a shot be fired and followed to
   * its contact without a round trip in between, which is the shape most of this
   * project's scenarios are built out of.
   */
  sweep<Argument>(
    predicate: (
      snapshot: SpectraSnapshot,
      argument: Argument,
      posed: SpectraSnapshot,
    ) => boolean,
    argument: Argument,
    options?: SweepOptions,
  ): Promise<SweepResult>;
  /**
   * Run `frames` frames, reading `project` off the state before the first and
   * after every one of them, in ONE crossing.
   *
   * The sweep a check that MEASURES a path runs: it wants a reading per frame
   * rather than a stopping point, and taking those readings a round trip apart
   * makes what the check costs a fact about how busy the host is. The frames are
   * the same frames {@link advance} runs, one `advance(dt, 1)` each, so a
   * recording made across it keeps one frame per driven frame exactly as before.
   *
   * `project` and `stop` are carried into the page as source, so each must stand
   * on its own: they see the parameters they are handed and nothing else, and
   * anything from the suite reaches them as `argument`, which crosses as JSON.
   * Keeping a reading to the fields the check uses is what keeps the one
   * crossing small.
   *
   * The array holds `frames + 1` readings: the state as the sweep opened, then
   * one after each frame — or fewer, when `stop` ends it early. The reading
   * `stop` held on is kept, so a caller reads the pair a change sits between.
   */
  samples<Sample, Argument>(
    frames: number,
    options: {
      project: (snapshot: SpectraSnapshot, argument: Argument) => Sample;
      argument: Argument;
      stop?: (sample: Sample, taken: Sample[], argument: Argument) => boolean;
    },
  ): Promise<{ samples: Sample[]; snapshot: SpectraSnapshot; frames: number }>;
  /**
   * Run `rounds` rounds of "pose, drive ONE frame, read" inside the page, in ONE
   * crossing.
   *
   * The sweep a check that PROBES runs. {@link sweep} poses once and then drives,
   * and {@link samples} drives without posing at all; a trial is the shape left
   * over, where each frame has to be arranged from what the frame before it left
   * — a timer posted just under a bound and the one frame that settles whether
   * the build acted on it, a hundred times over. Taken a round trip apart that is
   * hundreds of crossings for a reading that is deterministic in the build's own
   * terms, which makes what the check costs a fact about how busy the host is and
   * therefore makes its verdict one too.
   *
   * `stage` and `read` are carried into the page as source, so each must stand on
   * its own: they see the parameters they are handed and nothing else, and
   * anything from the suite reaches them as `argument`, which crosses as JSON.
   * `stage` is handed the round's index and the PREVIOUS round's reading, and
   * returns the surface calls that arrange the round, exactly the batch
   * {@link pose} would run. `read` projects the state the round's frame left; a
   * reading is handed straight to the next round's `stage` inside the page, and
   * every one of them comes back to the suite at the end, so a reading must be
   * JSON — and keeping it to the fields the check uses is what keeps the one
   * crossing small.
   *
   * `operations` names every surface operation `stage` may issue. They are
   * checked against what the build carries before the crossing opens, exactly as
   * {@link sweep}'s `pose` is, so a build missing one fails by assertion naming
   * the operation rather than with a raw TypeError from inside the page. A call
   * to an operation not named here is not checked, so name them all.
   *
   * The frames are the frames {@link advance} runs, one `advance(dt, 1)` each,
   * opened and closed on the recorder and accounted to the cue sinks the same
   * way, so a recording or a cue watch running across trials reads exactly what
   * it would have read across the round trips this replaces.
   */
  trials<Reading, Argument>(
    rounds: number,
    options: {
      stage: (
        round: number,
        last: Reading | null,
        argument: Argument,
      ) => readonly SurfaceCall[];
      read: (snapshot: SpectraSnapshot, argument: Argument) => Reading;
      argument: Argument;
      operations: readonly string[];
    },
  ): Promise<{ readings: Reading[]; snapshot: SpectraSnapshot }>;
  /**
   * Run `duration` seconds of game time WITHOUT opening a recorded frame.
   *
   * The same real update the loop runs, `hz` frames per second of it, but off
   * camera: no frame boundary is closed, so a capture running across it keeps
   * nothing, and a section that has to sit through a stage's entrance costs a
   * replay nothing. Use it for the wait; use {@link advance} for the part a check
   * is about.
   */
  skip(duration: number, hz?: number): Promise<void>;
  /** {@link skip} until `predicate` holds, sampling every `pollSeconds`. */
  skipUntil(
    predicate: (snapshot: SpectraSnapshot) => boolean,
    options?: SkipOptions,
  ): Promise<SkipResult>;
  /**
   * Hand the game back to its own frame loop for `ms` of real time, then take it
   * back.
   *
   * NO POINT MAY BE SIZED AGAINST THIS. How many frames a browser delivers over a
   * stretch of the wall clock is a fact about the machine, not about the build, so
   * a reading taken across a fixed `ms` reaches further on a quiet host than on a
   * busy one. A point that genuinely needs the build's own clock uses
   * {@link runUntil}, which ends on the build's own reading passing a floor and
   * simply takes longer on a loaded host; a point that needs game time to pass
   * uses {@link advance} or {@link skip}. This is the raw primitive both of those
   * rest on, kept for a caller that wants the loop running and asserts nothing
   * about how far it got.
   */
  runFor(ms: number): Promise<void>;
  /**
   * Hand the game back to its own frame loop until `predicate` holds of what the
   * build reports, then take it back, and hand over the state that ended it.
   *
   * The wait a point about the build's own clock runs. Real time passes and
   * nothing steps the game, exactly as {@link runFor} leaves it, but what ends
   * the wait is the build's own reading rather than a stretch of the wall clock:
   * how many frames a browser delivers in a given second is a fact about the
   * machine, so a host running a hundred other jobs makes this wait longer
   * instead of making the build look stopped. `deadlineMs` bounds it, and a
   * build whose loop never runs reaches that bound with the predicate still
   * false.
   */
  runUntil(
    predicate: (snapshot: SpectraSnapshot) => boolean,
    options?: { deadlineMs?: number; pollMs?: number },
  ): Promise<SpectraSnapshot>;

  /** Press a key and leave it down, as a player holding it would. */
  hold(code: string): Promise<void>;
  /** Release a key held by {@link hold}. */
  release(code: string): Promise<void>;
  /**
   * Press a key, run the one frame that delivers it, and release it.
   *
   * A press that ran no frame would never reach the game, and a press released
   * before a frame ran would be invisible to a build that reads its keyboard by
   * comparing held state between frames — so the frame goes between the two.
   * `specs/controls.md` reads `up`, `down`, `b`, `discharge`, `confirm`, `back`,
   * `pause` and `mute` as press edges, which is exactly what this delivers.
   */
  tap(code: string): Promise<void>;
  /** Hold one or more keys down for `frames` frames, then release them all. */
  holdFor(codes: string | readonly string[], frames: number): Promise<void>;

  /** Run exactly one frame and hand back every operation its render issued. */
  frameCalls(): Promise<DrawCall[]>;
  /** Reflect the surface without invoking it: `typeof` for each name, and the version. */
  probe(
    names: readonly string[],
  ): Promise<{ version: unknown; ops: Record<string, string> }>;

  /** How the stage is mapped onto this harness's canvas. */
  viewport(): Viewport;
  /** Where a logical point lands in the canvas's backing store. */
  device(x: number, y: number): { x: number; y: number };
  /** Where a logical point lands in CSS pixels, for a real mouse. */
  css(x: number, y: number): { x: number; y: number };
  /** The device pixel under a logical point, as `[r, g, b, a]`. */
  pixel(x: number, y: number): Promise<[number, number, number, number]>;
  /** Many logical points at once, in one crossing into the page. */
  pixels(
    points: readonly { x: number; y: number }[],
  ): Promise<[number, number, number, number][]>;
  /** A pixel addressed in the canvas's own backing store, past the fit. */
  devicePixel(x: number, y: number): Promise<[number, number, number, number]>;
  /** The canvas's backing store size, as the build sized it. */
  surface(): Promise<{ width: number; height: number; dpr: number }>;

  /** Give the build a real, browser-trusted gesture, so its audio can open. */
  armAudio(): Promise<void>;
  /** How many sounds the build has emitted since the page loaded, in total. */
  sounds(): Promise<number>;

  /** Release anything held, and let the page go. */
  dispose(): Promise<void>;
}

/* ---- The page ------------------------------------------------------------- */

/**
 * The init scripts injected before any of the build's own script runs.
 *
 * `raster-init.js` is first because it takes the page's own `getContext` for the
 * probe it measures a fill colour on, and `recorder-init.js` replaces that
 * `getContext` with one that hands back a recording proxy.
 */
const INIT_SCRIPTS = [
  "raster-init.js",
  "recorder-init.js",
  "audio-init.js",
] as const;

/** This module's directory: the validator project's root. */
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * The workspace this project is staged into, which is where `assets/` sits.
 *
 * Derived from this file's own URL rather than from the working directory, so it
 * names the same place in both layouts this project lives in — the case's own
 * `validation/none/`, and the `validation/` the runner stages it to inside the
 * build's tree.
 */
export const WORKSPACE_ROOT = resolve(PROJECT_ROOT, "..");

/**
 * How long the surface is waited for before the build is called non-conformant.
 *
 * Generous against a conformant build and cheap against one: the wait is a poll
 * that returns the instant the global appears. Spectra's surface is installed
 * once the four seeded sprites and the burst system have loaded and decoded
 * (`specs/assets.md`), so a build has a genuine asynchronous step to finish
 * before it can install — which is what this ceiling is sized for.
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

/**
 * How long the surface is waited for once this worker has already proved the
 * build installs none.
 *
 * The full ceiling above is what it costs to establish that a build has no
 * surface, and establishing it once is enough: a build that installed nothing in
 * three quarters of a minute on one page installs nothing on the next. Every
 * later page in the worker therefore looks with a short deadline rather than
 * paying the ceiling again, so a surfaceless build is still decided rather than
 * running the whole checklist out of time. A worker that has ever SEEN the
 * surface never uses this: from then on every page gets the full ceiling.
 */
const SURFACE_RECHECK_MS = 1_000;

/**
 * How long the recorder is waited for before a section runs without one.
 *
 * A build may take its 2D context on the frame it first draws rather than while
 * it initializes, so the recorder can be armed before there is a context to
 * record. Expiring here costs a replay rather than a verdict, so it is bounded
 * well below the surface's ceiling.
 */
const RECORDER_TIMEOUT_MS = 20_000;

/**
 * How long a wait on the build's own frame loop may run before it gives up.
 *
 * The bound on {@link Harness.runUntil}, and it is a bound rather than a
 * measurement: the wait ends the moment the build's own reading says what the
 * check is waiting for, so a quiet host leaves it in a fraction of a second and
 * a host running a hundred other jobs simply takes longer to get there. What
 * reaching this bound means is that the loop never ran, which is the failure the
 * point is looking for.
 */
const FREE_RUN_DEADLINE_MS = 30_000;

/** How often the build is asked what its own loop has done, while it holds the clock. */
const FREE_RUN_POLL_MS = 50;

let browserPromise: Promise<Browser> | null = null;

async function sharedBrowser(): Promise<Browser> {
  browserPromise ??= connectChromium(inject("spectraBrowserWs"));
  return browserPromise;
}

/**
 * One browser context per WINDOW SHAPE, shared by every harness of that shape in
 * this file, and one PAGE per harness inside it.
 *
 * The split is what the init scripts force and what correctness wants. The
 * recorder and the audio probe are installed on the CONTEXT, so every page it
 * opens is instrumented before a line of the build's script runs, and a context
 * is also where the viewport and the device pixel ratio are fixed — which is the
 * one thing `field/stage-fit` varies. Everything else about a harness is the
 * page: a fresh one opens on a build that has just started, with no key held, no
 * audio context opened, and the mute preference back off, which is a stronger
 * guarantee than any reset the surface offers, since `reset()` deliberately
 * leaves muting alone.
 *
 * A page per harness rather than a page reused between them, because a check may
 * legitimately hold two harnesses at once — `instrumentation/deterministic-core`
 * runs the same second under three step sizes — and a harness whose page had been
 * taken over by a later one would read someone else's game while looking exactly
 * like it worked.
 */
const contexts = new Map<string, BrowserContext>();

/** Every page this worker opened, so none is left behind in the shared browser. */
const openPages = new Set<Page>();

function shapeKey(cssWidth: number, cssHeight: number, dpr: number): string {
  return `${cssWidth}x${cssHeight}@${dpr}`;
}

/** The context for a window of this shape, opened and instrumented on demand. */
async function contextFor(
  cssWidth: number,
  cssHeight: number,
  dpr: number,
): Promise<BrowserContext> {
  const key = shapeKey(cssWidth, cssHeight, dpr);
  const existing = contexts.get(key);
  if (existing !== undefined) return existing;

  const browser = await sharedBrowser();
  const context = await browser.newContext({
    viewport: { width: cssWidth, height: cssHeight },
    deviceScaleFactor: dpr,
  });
  for (const name of INIT_SCRIPTS) {
    await context.addInitScript(readFileSync(join(PROJECT_ROOT, name), "utf8"));
  }
  contexts.set(key, context);
  return context;
}

/**
 * Shut everything this worker opened.
 *
 * Registered from `setup.ts` as an `afterAll`, so a suite file never has to think
 * about it and a worker cannot leave a page behind in the shared browser.
 */
export async function closeWorkerBrowser(): Promise<void> {
  for (const page of openPages) await page.close().catch(() => undefined);
  openPages.clear();
  for (const context of contexts.values()) {
    await context.close().catch(() => undefined);
  }
  contexts.clear();
  const browser = browserPromise;
  browserPromise = null;
  if (browser !== null) await (await browser).close().catch(() => undefined);
}

/* ---- The surface a build never installed ---------------------------------- */

/**
 * A stand-in for a surface that is missing or incomplete: every operation on it
 * fails the check that reached for it, with the fault named.
 *
 * A proxy rather than a hand-written stub, so that an operation a build was
 * supposed to add but this file never listed still fails as the consequence of
 * the missing install rather than as an undefined that throws a `TypeError`
 * several frames later, in a place that names nothing.
 *
 * Keys that belong to the MACHINERY rather than to a check are answered with
 * `undefined` instead: awaiting a value probes `then`, and vitest's own error
 * formatting probes symbols and `constructor`. Failing those would replace the
 * verdict below with noise from the machinery that was trying to report it.
 */
function unexposedSurface(reason: string): SpectraDebugApi {
  return new Proxy({} as SpectraDebugApi, {
    get: (_target, property): unknown => {
      if (typeof property === "symbol") return undefined;
      if (property === "then" || property === "constructor") return undefined;
      return () => failSurface(reason);
    },
  });
}

/**
 * What `specs/instrumentation.md` requires of the surface: the `Expected:` line
 * of the failure a build with no usable surface lands on every check that
 * reaches for it, beside the {@link Harness.surfaceFault} that says what was
 * found.
 */
export const SURFACE_REQUIREMENT =
  `a usable debug and automation surface on window.${HANDLE} as soon as the ` +
  `game has initialized, carrying every operation specs/instrumentation.md ` +
  `requires`;

/**
 * Fail the running check on `fault`, the harness's account of what is wrong
 * with the build's surface, paired with what the specification requires.
 */
export function failSurface(fault: string): never {
  return fail(SURFACE_REQUIREMENT, fault);
}

/**
 * What is wrong with the surface this page installed, or `null` when nothing
 * is: the surface never appeared, or it appeared without an operation the
 * specification requires of every build.
 */
async function readSurfaceFault(page: Page): Promise<string | null> {
  const worker = globalThis as unknown as {
    __spectraSurfaceSeen?: boolean;
    __spectraSurfaceMissing?: boolean;
  };
  const patient =
    worker.__spectraSurfaceSeen === true ||
    worker.__spectraSurfaceMissing !== true;
  const budget = patient ? SURFACE_TIMEOUT_MS : SURFACE_RECHECK_MS;
  try {
    await page.waitForFunction(
      (handle) =>
        typeof (window as never)[handle] === "object" &&
        (window as never)[handle] !== null,
      HANDLE,
      { timeout: budget },
    );
    worker.__spectraSurfaceSeen = true;
  } catch {
    worker.__spectraSurfaceMissing = true;
    return `window.${HANDLE} was still absent ${budget / 1000}s after the page loaded`;
  }
  const missing = await page.evaluate(
    ([handle, ops]) => {
      const target = (
        window as unknown as Record<string, Record<string, unknown>>
      )[handle];
      return ops.filter((op) => typeof target[op] !== "function");
    },
    [HANDLE, [...REQUIRED_OPS]] as const,
  );
  if (missing.length > 0) {
    return `window.${HANDLE} is installed but carries no ${missing
      .map((op) => `${op}()`)
      .join(", ")}`;
  }
  return null;
}

/* ---- Building one --------------------------------------------------------- */

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
 */
export async function createHarness(
  options: HarnessOptions = {},
): Promise<Harness> {
  const cssWidth = options.cssWidth ?? STAGE_W;
  const cssHeight = options.cssHeight ?? STAGE_H;
  const dpr = options.dpr ?? 1;
  const clock = options.clock ?? new ConstantClock(TICK_MS);
  const context = await contextFor(cssWidth, cssHeight, dpr);
  const page = await context.newPage();
  openPages.add(page);

  // Whatever this page throws or logs as an error while THIS harness drives it.
  // The page belongs to one harness, so the log cannot pick up what some other
  // check provoked.
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => {
    pageErrors.push(String(error.message || error));
  });
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });

  // The document, not every byte the page pulls in after it. What decides that a
  // build is ready is the surface appearing, which is waited for next and which a
  // build installs once its own assets have loaded; waiting for the load event
  // first only adds the browser's idea of the same wait to every check, and on a
  // busy host that idea is seconds long.
  await page.goto(inject("spectraUrl"), { waitUntil: "domcontentloaded" });

  const surfaceFault = await readSurfaceFault(page);
  const refuse = (): never => failSurface(surfaceFault ?? "");

  // Which of the operations this project knows about the build actually carries,
  // read once. `surfaceFault` already covers everything EVERY build owes, so what
  // this adds is the handful a VARIANT owes ({@link OVERLOAD_OPS}): an overload
  // build with no `setDroneCharge` then fails its overload points with the
  // expected/actual pair the reviewer reads, rather than with a raw TypeError
  // from inside the page.
  const present =
    surfaceFault !== null
      ? new Set<string>()
      : new Set(
          await page.evaluate(
            ([handle, names]) => {
              const target = (
                window as unknown as Record<string, Record<string, unknown>>
              )[handle];
              return names.filter((name) => typeof target[name] === "function");
            },
            [HANDLE, [...REQUIRED_OPS, ...OVERLOAD_OPS]] as const,
          ),
        );
  const known = new Set<string>([...REQUIRED_OPS, ...OVERLOAD_OPS]);

  const call = async (operation: string, args: unknown[]): Promise<unknown> => {
    if (surfaceFault !== null) refuse();
    if (known.has(operation) && !present.has(operation)) {
      failSurface(`window.${HANDLE} carries no ${operation}()`);
    }
    return page.evaluate(
      ([handle, name, rest]) => {
        const target = (
          window as unknown as Record<
            string,
            Record<string, (...a: unknown[]) => unknown>
          >
        )[handle];
        return target[name](...rest);
      },
      [HANDLE, operation, args] as const,
    );
  };

  const debug =
    surfaceFault !== null
      ? unexposedSurface(surfaceFault)
      : (new Proxy({} as SpectraDebugApi, {
          get: (_target, property): unknown => {
            if (typeof property === "symbol") return undefined;
            if (property === "then" || property === "constructor")
              return undefined;
            const name = String(property);
            return (...args: unknown[]) => call(name, args);
          },
        }) as SpectraDebugApi);

  if (surfaceFault === null) {
    // Off the wall clock and back to the title before a check touches anything:
    // from here the game changes only when this harness says so.
    await call("setAutoStep", [false]);
    await call("reset", []);
    // And a recorder over the surface before a check can arm one. A build is
    // free to ask for its 2D context on the frame it first draws rather than
    // while it initializes, so the surface can be installed and answering
    // before any context exists to record — and a `captureReplay` armed in that
    // window arms nothing and writes no evidence for a section that drew.
    await page
      .waitForFunction(
        () =>
          (
            window as unknown as { __spectraRec: { ready(): boolean } }
          ).__spectraRec.ready(),
        undefined,
        { timeout: RECORDER_TIMEOUT_MS },
      )
      .catch(() => undefined);
  }

  const view = fitViewport(cssWidth, cssHeight, dpr);
  const cueSinks: TimedCue[][] = [];
  let frameCount = 0;
  let timeMs = 0;

  /**
   * Run `frames` frames and read the state they left, in one crossing.
   *
   * Each frame is opened and closed around a single `advance(dt, 1)`, all inside
   * one synchronous evaluation, so nothing the page's own animation frame renders
   * can land inside a recorded frame — and so a frame the recorder keeps is
   * exactly one frame the game ran.
   */
  const drive = async (frames: number): Promise<SpectraSnapshot> => {
    if (surfaceFault !== null) refuse();
    const deltas: number[] = [];
    for (let i = 0; i < frames; i += 1) deltas.push(clock.delta());
    const result = (await page.evaluate(
      ([handle, dts]) => {
        const api = (
          window as unknown as Record<
            string,
            Record<string, (...a: unknown[]) => unknown>
          >
        )[handle];
        const rec = (
          window as unknown as {
            __spectraRec: Record<string, (...a: unknown[]) => unknown>;
          }
        ).__spectraRec;
        const audio = (
          window as unknown as { __spectraAudio: { started(): number } }
        ).__spectraAudio;
        const sounds: number[] = [];
        for (const dt of dts) {
          const before = audio.started();
          rec.begin();
          api.advance(dt / 1000, 1);
          rec.end(dt);
          sounds.push(audio.started() - before);
        }
        return { snapshot: api.snapshot(), sounds };
      },
      [HANDLE, deltas] as const,
    )) as { snapshot: SpectraSnapshot; sounds: number[] };

    for (const [index, delta] of deltas.entries()) {
      frameCount += 1;
      timeMs += delta;
      for (let n = 0; n < result.sounds[index]; n += 1) {
        for (const sink of cueSinks)
          sink.push({ frame: frameCount, t: timeMs });
      }
    }
    return result.snapshot;
  };

  /**
   * Run `duration` seconds of game time in `frames` frames, off camera.
   *
   * The same real update, and the same one crossing, but with no frame boundary
   * opened or closed: a capture running across a skip keeps nothing of it. Every
   * sound the skip produced is attributed to the frame it ended on, which is the
   * whole of what a skip can honestly say about when a sound happened.
   */
  const coast = async (
    duration: number,
    frames: number,
  ): Promise<SpectraSnapshot> => {
    if (surfaceFault !== null) refuse();
    const whole = Math.max(1, Math.round(frames));
    const result = (await page.evaluate(
      ([handle, sec, count]) => {
        const api = (
          window as unknown as Record<
            string,
            Record<string, (...a: unknown[]) => unknown>
          >
        )[handle];
        const audio = (
          window as unknown as { __spectraAudio: { started(): number } }
        ).__spectraAudio;
        const before = audio.started();
        api.advance(sec, count);
        return {
          snapshot: api.snapshot(),
          sounds: audio.started() - before,
        };
      },
      [HANDLE, duration, whole] as const,
    )) as { snapshot: SpectraSnapshot; sounds: number };

    frameCount += whole;
    timeMs += duration * 1000;
    for (let n = 0; n < result.sounds; n += 1) {
      for (const sink of cueSinks) sink.push({ frame: frameCount, t: timeMs });
    }
    return result.snapshot;
  };

  const readPixels = async (
    devicePoints: readonly { x: number; y: number }[],
  ): Promise<[number, number, number, number][]> =>
    page.evaluate(
      (points) => {
        const canvases = Array.from(document.querySelectorAll("canvas"));
        if (canvases.length === 0)
          throw new Error("spectra: the page has no <canvas>");
        let canvas = canvases[0];
        for (const other of canvases) {
          if (other.width * other.height > canvas.width * canvas.height)
            canvas = other;
        }
        const ctx = canvas.getContext("2d");
        if (ctx === null)
          throw new Error("spectra: the canvas has no 2D context");
        return points.map((point) => {
          const x = Math.min(
            Math.max(point.x, 0),
            Math.max(canvas.width - 1, 0),
          );
          const y = Math.min(
            Math.max(point.y, 0),
            Math.max(canvas.height - 1, 0),
          );
          const { data } = ctx.getImageData(x, y, 1, 1);
          return [data[0], data[1], data[2], data[3]] as [
            number,
            number,
            number,
            number,
          ];
        });
      },
      devicePoints as { x: number; y: number }[],
    );

  /**
   * Hand the game to its own frame loop, or take it back.
   *
   * The two waits below are the only places the game runs on anything but this
   * harness's stepping, and both leave it exactly this way: the recorder follows
   * the page's own animation frame while the loop holds the clock, and returns
   * to the harness's frames when it is taken back.
   */
  const freeRun = async (on: boolean): Promise<void> => {
    if (on) {
      // The one thing here that depends on real elapsed time, so the one thing a
      // browser's own idea of which page matters can distort. The launch already
      // turns the throttling off; bringing the page forward as well means this
      // does not rest on a flag alone.
      await page.bringToFront().catch(() => undefined);
    }
    await page.evaluate(
      ([handle, running]) => {
        const rec = (
          window as unknown as { __spectraRec: { setMode(m: string): void } }
        ).__spectraRec;
        const api = (
          window as unknown as Record<
            string,
            { setAutoStep(on: boolean): void }
          >
        )[handle];
        if (running) {
          rec.setMode("raf");
          api.setAutoStep(true);
        } else {
          api.setAutoStep(false);
          rec.setMode("manual");
        }
      },
      [HANDLE, on] as const,
    );
  };

  const harness: Harness = {
    page,
    debug,
    surfaceFault,
    pageErrors,

    frame: () => frameCount,
    timeMs: () => timeMs,

    snapshot: () => debug.snapshot(),

    async pose(calls) {
      if (surfaceFault !== null) refuse();
      for (const [operation] of calls) {
        if (known.has(operation) && !present.has(operation)) {
          failSurface(`window.${HANDLE} carries no ${operation}()`);
        }
      }
      return (await page.evaluate(
        ([handle, batch]) => {
          const api = (
            window as unknown as Record<
              string,
              Record<string, (...a: unknown[]) => unknown>
            >
          )[handle];
          for (const entry of batch) {
            const [name, ...args] = entry;
            api[name as string](...args);
          }
          return api.snapshot();
        },
        [HANDLE, calls as readonly (readonly unknown[])[]] as const,
      )) as SpectraSnapshot;
    },

    advance: async (frames) => {
      await drive(frames);
    },

    async samples(frames, sampleOptions) {
      if (surfaceFault !== null) refuse();
      const whole = Math.max(0, frames);
      const deltas: number[] = [];
      for (let i = 0; i < whole; i += 1) deltas.push(clock.delta());

      const script = `((project, stop, handle, dts, argument) => {
  const api = window[handle];
  const rec = window.__spectraRec;
  const audio = window.__spectraAudio;
  const sounds = [];
  const taken = [project(api.snapshot(), argument)];
  let frames = 0;
  const held = (sample) => stop !== null && stop(sample, taken, argument) === true;
  if (!held(taken[0])) {
    for (const dt of dts) {
      const before = audio.started();
      rec.begin();
      api.advance(dt / 1000, 1);
      rec.end(dt);
      sounds.push(audio.started() - before);
      frames += 1;
      const sample = project(api.snapshot(), argument);
      taken.push(sample);
      if (held(sample)) break;
    }
  }
  return { samples: taken, frames: frames, snapshot: api.snapshot(), sounds: sounds };
})(${String(sampleOptions.project)}, ${
        sampleOptions.stop === undefined ? "null" : String(sampleOptions.stop)
      }, ${JSON.stringify(HANDLE)}, ${JSON.stringify(deltas)}, ${JSON.stringify(
        sampleOptions.argument,
      )})`;

      const result = (await page.evaluate(script)) as {
        samples: unknown[];
        frames: number;
        snapshot: SpectraSnapshot;
        sounds: number[];
      };

      clock.rewind(deltas.length - result.frames);
      for (const [index, delta] of deltas.slice(0, result.frames).entries()) {
        frameCount += 1;
        timeMs += delta;
        for (let n = 0; n < result.sounds[index]; n += 1) {
          for (const sink of cueSinks)
            sink.push({ frame: frameCount, t: timeMs });
        }
      }
      return {
        samples: result.samples as never[],
        frames: result.frames,
        snapshot: result.snapshot,
      };
    },

    async trials(rounds, trialOptions) {
      if (surfaceFault !== null) refuse();
      for (const operation of trialOptions.operations) {
        if (known.has(operation) && !present.has(operation)) {
          failSurface(`window.${HANDLE} carries no ${operation}()`);
        }
      }
      const whole = Math.max(0, rounds);
      const deltas: number[] = [];
      for (let i = 0; i < whole; i += 1) deltas.push(clock.delta());

      const script = `((stage, read, handle, dts, argument) => {
  const api = window[handle];
  const rec = window.__spectraRec;
  const audio = window.__spectraAudio;
  const sounds = [];
  const readings = [];
  let last = null;
  for (let round = 0; round < dts.length; round += 1) {
    for (const entry of stage(round, last, argument)) api[entry[0]](...entry.slice(1));
    const dt = dts[round];
    const before = audio.started();
    rec.begin();
    api.advance(dt / 1000, 1);
    rec.end(dt);
    sounds.push(audio.started() - before);
    last = read(api.snapshot(), argument);
    readings.push(last);
  }
  return { readings: readings, snapshot: api.snapshot(), sounds: sounds };
})(${String(trialOptions.stage)}, ${String(
        trialOptions.read,
      )}, ${JSON.stringify(HANDLE)}, ${JSON.stringify(deltas)}, ${JSON.stringify(
        trialOptions.argument,
      )})`;

      const result = (await page.evaluate(script)) as {
        readings: unknown[];
        snapshot: SpectraSnapshot;
        sounds: number[];
      };

      for (const [index, delta] of deltas.entries()) {
        frameCount += 1;
        timeMs += delta;
        for (let n = 0; n < result.sounds[index]; n += 1) {
          for (const sink of cueSinks)
            sink.push({ frame: frameCount, t: timeMs });
        }
      }
      return {
        readings: result.readings as never[],
        snapshot: result.snapshot,
      };
    },

    async sweep(predicate, argument, sweepOptions = {}) {
      if (surfaceFault !== null) refuse();
      const calls = sweepOptions.pose ?? [];
      for (const [operation] of calls) {
        if (known.has(operation) && !present.has(operation)) {
          failSurface(`window.${HANDLE} carries no ${operation}()`);
        }
      }
      const maxFrames = Math.max(0, sweepOptions.maxFrames ?? 600);
      const poll = Math.max(1, sweepOptions.poll ?? 1);
      const deltas: number[] = [];
      for (let i = 0; i < maxFrames; i += 1) deltas.push(clock.delta());

      const script = `((predicate, handle, batch, dts, poll, argument) => {
  const api = window[handle];
  const rec = window.__spectraRec;
  const audio = window.__spectraAudio;
  const sounds = [];
  for (const entry of batch) api[entry[0]](...entry.slice(1));
  const posed = api.snapshot();
  let snapshot = posed;
  if (predicate(snapshot, argument, posed)) {
    return { hit: true, frames: 0, snapshot: snapshot, posed: posed, sounds: sounds };
  }
  let frames = 0;
  while (frames < dts.length) {
    const step = Math.min(poll, dts.length - frames);
    for (let i = 0; i < step; i += 1) {
      const dt = dts[frames + i];
      const before = audio.started();
      rec.begin();
      api.advance(dt / 1000, 1);
      rec.end(dt);
      sounds.push(audio.started() - before);
    }
    frames += step;
    snapshot = api.snapshot();
    if (predicate(snapshot, argument, posed)) {
      return { hit: true, frames: frames, snapshot: snapshot, posed: posed, sounds: sounds };
    }
  }
  return { hit: false, frames: frames, snapshot: snapshot, posed: posed, sounds: sounds };
})(${String(predicate)}, ${JSON.stringify(HANDLE)}, ${JSON.stringify(
        calls,
      )}, ${JSON.stringify(deltas)}, ${JSON.stringify(poll)}, ${JSON.stringify(
        argument,
      )})`;

      const result = (await page.evaluate(script)) as {
        hit: boolean;
        frames: number;
        snapshot: SpectraSnapshot;
        posed: SpectraSnapshot;
        sounds: number[];
      };

      // Only the frames that ran are the harness's, and the deltas the sweep
      // asked for and did not use go back to the clock.
      clock.rewind(deltas.length - result.frames);
      for (const [index, delta] of deltas.slice(0, result.frames).entries()) {
        frameCount += 1;
        timeMs += delta;
        for (let n = 0; n < result.sounds[index]; n += 1) {
          for (const sink of cueSinks)
            sink.push({ frame: frameCount, t: timeMs });
        }
      }
      return {
        hit: result.hit,
        frames: result.frames,
        snapshot: result.snapshot,
        posed: result.posed,
      };
    },

    async until(predicate, untilOptions = {}) {
      const maxFrames = untilOptions.maxFrames ?? 600;
      const poll = Math.max(1, untilOptions.poll ?? 1);

      let snapshot = await this.snapshot();
      if (predicate(snapshot)) return { hit: true, frames: 0, snapshot };

      let frames = 0;
      while (frames < maxFrames) {
        const step = Math.min(poll, maxFrames - frames);
        snapshot = await drive(step);
        frames += step;
        if (predicate(snapshot)) return { hit: true, frames, snapshot };
      }
      return { hit: false, frames, snapshot };
    },

    async skip(duration, hz = 60) {
      await coast(duration, Math.ceil(duration * hz));
    },

    async skipUntil(predicate, skipOptions = {}) {
      const maxSeconds = skipOptions.maxSeconds ?? 60;
      const pollSeconds = Math.max(1e-3, skipOptions.pollSeconds ?? 0.5);
      const hz = skipOptions.hz ?? 60;

      let snapshot = await this.snapshot();
      if (predicate(snapshot)) return { hit: true, elapsed: 0, snapshot };

      let elapsed = 0;
      while (elapsed < maxSeconds) {
        const step = Math.min(pollSeconds, maxSeconds - elapsed);
        snapshot = await coast(step, Math.ceil(step * hz));
        elapsed += step;
        if (predicate(snapshot)) return { hit: true, elapsed, snapshot };
      }
      return { hit: false, elapsed, snapshot };
    },

    async runUntil(predicate, runOptions = {}) {
      if (surfaceFault !== null) refuse();
      const deadline =
        Date.now() + (runOptions.deadlineMs ?? FREE_RUN_DEADLINE_MS);
      const pollMs = Math.max(1, runOptions.pollMs ?? FREE_RUN_POLL_MS);
      await freeRun(true);
      try {
        let snapshot = await debug.snapshot();
        while (!predicate(snapshot) && Date.now() < deadline) {
          await page.waitForTimeout(pollMs);
          snapshot = await debug.snapshot();
        }
        return snapshot;
      } finally {
        await freeRun(false);
      }
    },

    async runFor(ms) {
      if (surfaceFault !== null) refuse();
      await freeRun(true);
      await page.waitForTimeout(ms);
      await freeRun(false);
    },

    hold: (code) => page.keyboard.down(code),
    release: (code) => page.keyboard.up(code),
    async tap(code) {
      // Down, ONE frame, up. The frame between the two is what makes this a press
      // a build can actually see: an engineless build wrote its own keyboard
      // layer, and the two conformant ways to read a press — latching the edge in
      // the event handler, or comparing held state at the top of each frame —
      // agree only if the key is genuinely held while a frame runs. A down and an
      // up delivered back to back would be invisible to the second, which is a
      // build a real player has no trouble with. Exactly one frame passes either
      // way, so nothing a caller counts moves.
      await page.keyboard.down(code);
      await drive(1);
      await page.keyboard.up(code);
    },
    async holdFor(codes, frames) {
      const keys = typeof codes === "string" ? [codes] : [...codes];
      for (const code of keys) await page.keyboard.down(code);
      try {
        if (frames > 0) await drive(frames);
      } finally {
        for (const code of keys) await page.keyboard.up(code);
      }
    },

    async frameCalls() {
      await drive(1);
      const ops = (await page.evaluate(() =>
        (
          window as unknown as { __spectraRec: { last(): unknown[] } }
        ).__spectraRec.last(),
      )) as RecordedOp[];
      return ops.map(toDrawCall);
    },

    probe: (names) =>
      page.evaluate(
        ([handle, wanted]) => {
          const target =
            (window as unknown as Record<string, Record<string, unknown>>)[
              handle
            ] ?? {};
          const ops: Record<string, string> = {};
          for (const name of wanted) ops[name] = typeof target[name];
          return { version: target.version, ops };
        },
        [HANDLE, [...names]] as const,
      ),

    viewport: () => ({ ...view }),
    device: (x, y) => toDevice(view, x, y),
    css: (x, y) => {
      const at = toDevice(view, x, y);
      return { x: at.x / dpr, y: at.y / dpr };
    },
    pixel: async (x, y) => (await readPixels([toDevice(view, x, y)]))[0],
    pixels: (points) => readPixels(points.map((p) => toDevice(view, p.x, p.y))),
    devicePixel: async (x, y) => (await readPixels([{ x, y }]))[0],

    surface: () =>
      page.evaluate(() => {
        const canvases = Array.from(document.querySelectorAll("canvas"));
        if (canvases.length === 0) {
          throw new Error(
            "spectra: the page has no <canvas>, so the build drew nowhere — " +
              "index.html supplies one and the build is asked not to edit it " +
              "(specs/overview.md)",
          );
        }
        let canvas = canvases[0];
        for (const other of canvases) {
          if (other.width * other.height > canvas.width * canvas.height)
            canvas = other;
        }
        return {
          width: canvas.width,
          height: canvas.height,
          dpr: window.devicePixelRatio,
        };
      }),

    async armAudio() {
      // A GENUINE browser gesture, not a posed one: a build is free to open its
      // audio context from a real DOM event alone (both are conformant), so a key
      // delivered any other way would leave a perfectly good build silent. The key
      // is bound to nothing (specs/controls.md), so arming changes no game state.
      await page.keyboard.press(UNBOUND_KEY);
    },

    sounds: () =>
      page.evaluate(() =>
        (
          window as unknown as { __spectraAudio: { started(): number } }
        ).__spectraAudio.started(),
      ),

    async dispose() {
      // The context stays: it holds the init scripts and the window shape, and the
      // next harness of this shape wants both. The page goes, so nothing this
      // check pressed, opened or muted can reach the next one.
      openPages.delete(page);
      await page.close().catch(() => undefined);
    },
  };

  harnessCues.set(harness, cueSinks);
  return harness;
}

/** Where {@link watchCues} attaches, per harness. */
const harnessCues = new WeakMap<Harness, TimedCue[][]>();

/* ---- The fit -------------------------------------------------------------- */

/**
 * How the stage maps onto a surface of this shape, as `specs/overview.md` fixes
 * it: one uniform scale, the whole stage inside, centred, with the leftover
 * split evenly into two letterbox bars.
 *
 * Computed rather than read from the build, deliberately. Under an engine the
 * fit is the engine's and a check can ask it what it derived; here the fit is
 * the build's own work, so asking it would be asking a build to grade itself.
 * Every check but `field/stage-fit` runs at the stage's own size, where this is
 * the identity and the question does not arise; that one check runs at other
 * shapes and reads the pixels against what the specification says should be
 * there.
 */
export function fitViewport(
  cssWidth: number,
  cssHeight: number,
  dpr: number,
): Viewport {
  const deviceWidth = Math.round(cssWidth * dpr);
  const deviceHeight = Math.round(cssHeight * dpr);
  const scale = Math.min(cssWidth / STAGE_W, cssHeight / STAGE_H) * dpr;
  return {
    width: STAGE_W,
    height: STAGE_H,
    scale,
    offsetX: (deviceWidth - STAGE_W * scale) / 2,
    offsetY: (deviceHeight - STAGE_H * scale) / 2,
  };
}

function toDevice(
  view: Viewport,
  x: number,
  y: number,
): { x: number; y: number } {
  return {
    x: Math.round(view.offsetX + x * view.scale),
    y: Math.round(view.offsetY + y * view.scale),
  };
}

/* ---- Draw calls ----------------------------------------------------------- */

/** One operation as the injected recorder writes it. */
export type RecordedOp =
  | {
      op: "call";
      method: string;
      args: unknown[];
      width?: number;
      textAlign?: string;
    }
  | { op: "set"; property: string; value: unknown };

function toDrawCall(op: RecordedOp): DrawCall {
  return op.op === "call"
    ? {
        kind: "call",
        method: op.method,
        args: op.args,
        width: op.width,
        textAlign: op.textAlign,
      }
    : { kind: "set", property: op.property, value: op.value };
}

/** Every argument list `method` was called with, in order. */
export function callsTo(
  calls: readonly DrawCall[],
  method: string,
): unknown[][] {
  return calls.flatMap((call) =>
    call.kind === "call" && call.method === method ? [call.args] : [],
  );
}

/** Every value `property` was set to, in order. */
export function setsOf(
  calls: readonly DrawCall[],
  property: string,
): unknown[] {
  return calls.flatMap((call) =>
    call.kind === "set" && call.property === property ? [call.value] : [],
  );
}

/* -------------------------------------------------------------------------- */
/* Evidence capture                                                           */
/* -------------------------------------------------------------------------- */
//
// A review item may declare a `replay` OUTPUT beside its verdict: the frames the
// build itself drew while a check drove it, kept as evidence a reviewer can
// scrub and compare against the reference implementation's. `captureReplay` is
// how a check produces one.
//
// Four properties are what make it usable, and each is deliberate:
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
//    most wants. A recording that cannot be written is reported as an output that
//    never turned up, which is a fact about the host rather than about the build.
// 3. IT WRITES ONLY WHAT THERE IS TO LOOK AT. A capture that closed no frames
//    leaves no file, so the run reports the output absent instead of offering the
//    reviewer a replay of nothing.
// 4. IT COSTS NOTHING WHEN NOBODY IS COLLECTING. Outside a run the media
//    directory is unset and the whole thing is a no-op that still runs the
//    scenario, so a check cannot pass in one place and fail in the other.

/** The environment variable the runner names the media directory in. */
const MEDIA_DIR_ENV = "TCAB_VALIDATION_MEDIA_DIR";

/**
 * The directory the runner stages this project to inside the build's tree.
 *
 * A recording is addressed by the STAGED path of the suite that produced it —
 * `validation/swarm/dive-speed.test.ts` — because that is the path the review
 * item's declared script resolves to, and so the only name the case's manifest
 * and the runner both already agree on. Stating the prefix here is what keeps
 * that address the same when this suite is run in place against a reference
 * implementation, where the project root is `validation/none/` instead.
 */
const STAGED_PROJECT_DIR = "validation";

/**
 * The most frames a written recording holds.
 *
 * The injected recorder already holds the page's side to twice this, decimating
 * as it fills, so what arrives here is at most a few hundred frames however long
 * the section ran. This is the same cap the engine-backed harnesses write under,
 * so a replay recorded under any of the three engines is the same size of thing.
 */
const MAX_REPLAY_FRAMES = 300;

/**
 * The ground the console's player paints behind a recorded frame.
 *
 * The specification fixes no field colour: the build paints its own background
 * each frame, and the recorded frames carry that paint. What the player needs is
 * a colour for the canvas under them, and the page the build is served on is
 * painted `#000` by the case's own `index.html`, so that is what a replay says.
 */
export const REPLAY_BACKGROUND = "#000";

/** One frame of a recording, as the console's player reads it. */
export interface RecordedFrame {
  count: number;
  timeMs: number;
  deltaMs: number;
  surface: { width: number; height: number };
  /** Index into the recording's `states` of the state this frame inherited. */
  state: number;
  /**
   * Indices into the recording's `states` of the states saved under this frame,
   * outermost first.
   */
  stack: number[];
  /** Indices into the recording's `ops`, in the order the frame issued them. */
  ops: number[];
  /**
   * Whether part of what this frame inherited was too large for the format to
   * carry, and was cut down to the bound. Present only on a frame that was.
   */
  truncated?: boolean;
}

/** The context state a frame is drawn from, before its own operations. */
export interface RecordedState {
  properties: Record<string, unknown>;
  /** The transform in force, as the canvas's `[a, b, c, d, e, f]`. */
  transform: number[] | null;
  lineDash: number[] | null;
  /** The clip region in force, as the segments that built it, in order. */
  clip: RecordedPathSegment[];
  /** The current path, as the operations issued since the last `beginPath`. */
  path: RecordedPathSegment[];
}

/**
 * One run of path operations, and the transform they were issued under.
 *
 * A path is given in user space, so both the clip and the current path are split
 * into one segment per transform and a player replays each under its own.
 */
export interface RecordedPathSegment {
  transform: number[] | null;
  ops: RecordedOp[];
}

/** A value the context produced, as the recipe that rebuilds it. */
export interface RecordedResource {
  make: { method: string; args: unknown[] };
  then: RecordedOp[];
}

/** One bitmap the recording captured, as the player reads it. */
export interface RecordedImage {
  width: number;
  height: number;
  /** A data URL of the bitmap's pixels, absent when the budget degraded it. */
  src?: string;
}

/**
 * A recording, as the console's player reads it.
 *
 * A frame names its state and its operations by index, and the values those
 * operations draw with — the gradients, the captured images — live in tables the
 * whole recording shares. So every reference a frame makes resolves at whichever
 * frame a reviewer lands on, and each distinct thing is written once.
 */
export interface Recording {
  format: number;
  width: number;
  height: number;
  background: string | null;
  images: RecordedImage[];
  resources: RecordedResource[];
  ops: RecordedOp[];
  states: RecordedState[];
  frames: RecordedFrame[];
}

/**
 * Where the running suite's `outputId` output belongs, or `null` when nothing is
 * collecting media.
 *
 * The suite is the one vitest is currently running rather than one the caller
 * names, because the two must not be able to disagree: a check that named its own
 * path would be free to write its evidence under some other point's address.
 */
function mediaDestination(outputId: string, extension: string): string | null {
  const mediaDir = process.env[MEDIA_DIR_ENV];
  if (mediaDir === undefined || mediaDir === "") return null;
  const testPath = expect.getState().testPath;
  if (testPath === undefined) return null;
  const suite = relative(PROJECT_ROOT, testPath).split(sep).join("/");
  return join(mediaDir, STAGED_PROJECT_DIR, suite, `${outputId}.${extension}`);
}

/**
 * A value's JSON with object keys in a fixed order, as the key a table
 * deduplicates on.
 */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")}}`;
}

/** Add `entry` to a table if it is new, and answer where it lives. */
function intern<T>(table: T[], at: Map<string, number>, entry: T): number {
  const key = canonical(entry);
  const found = at.get(key);
  if (found !== undefined) return found;
  const index = table.length;
  table.push(entry);
  at.set(key, index);
  return index;
}

/**
 * `frames` re-expressed against tables holding only what those frames name.
 *
 * DROPPING A FRAME DROPS THE LAST REFERENCE TO WHATEVER ONLY THAT FRAME DREW
 * WITH. Tables carried over whole would put operations, gradients and images in
 * the file that no frame asks for — dead weight in a document whose whole point
 * is to say each thing once, and the bulk of it in a game that draws
 * procedurally and so repeats almost nothing between frames.
 *
 * Every entry here is reached from a kept frame, and every reference inside one
 * is rewritten as it is reached, transitively. What is deduplicated is the
 * rewritten entry, so an operation two hundred frames issue identically is
 * written once and named two hundred times.
 *
 * Exported for the suite beside this file, which drives it over a recording a
 * browser cannot deliver: Playwright's serializer drops an own field named
 * `__proto__` on the way out of the page, so handing one to this directly is the
 * only way to check that the rewrite carries it.
 */
export function retable(
  recording: Recording,
  frames: RecordedFrame[],
): Recording {
  const images: RecordedImage[] = [];
  const imageAt = new Map<number, number>();
  const resources: RecordedResource[] = [];
  const resourceAt = new Map<number, number>();
  const ops: RecordedOp[] = [];
  const opAt = new Map<string, number>();
  const states: RecordedState[] = [];
  const stateAt = new Map<string, number>();

  const takeImage = (source: number): number => {
    const found = imageAt.get(source);
    if (found !== undefined) return found;
    const index = images.length;
    images.push(recording.images[source]);
    imageAt.set(source, index);
    return index;
  };

  const takeResource = (source: number): number => {
    const found = resourceAt.get(source);
    if (found !== undefined) return found;
    const recipe = recording.resources[source];
    // A recipe's own arguments can only name values made before it, so rewriting
    // it terminates and cannot re-enter this resource.
    const rebuilt: RecordedResource = {
      make: { method: recipe.make.method, args: recipe.make.args.map(value) },
      then: recipe.then.map(operation),
    };
    const index = resources.length;
    resources.push(rebuilt);
    resourceAt.set(source, index);
    return index;
  };

  const value = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(value);
    if (entry === null || typeof entry !== "object") return entry;
    const record = entry as Record<string, unknown>;
    if (typeof record.$img === "number")
      return { $img: takeImage(record.$img) };
    if (typeof record.$res === "number")
      return { $res: takeResource(record.$res) };
    const rewritten: Record<string, unknown> = {};
    for (const [key, held] of Object.entries(record)) {
      // Defined rather than assigned: a build's own object may carry a field named
      // `__proto__`, and assigning that name reaches the prototype setter instead
      // of writing a field the document carries.
      Object.defineProperty(rewritten, key, {
        value: value(held),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return rewritten;
  };

  const operation = (op: RecordedOp): RecordedOp =>
    op.op === "call"
      ? { op: "call", method: op.method, args: op.args.map(value) }
      : { op: "set", property: op.property, value: value(op.value) };

  const segments = (list: RecordedPathSegment[]): RecordedPathSegment[] =>
    list.map((segment) => ({
      transform: segment.transform,
      ops: segment.ops.map(operation),
    }));

  const stateOf = (state: RecordedState): RecordedState => {
    const properties: Record<string, unknown> = {};
    for (const [name, held] of Object.entries(state.properties)) {
      Object.defineProperty(properties, name, {
        value: value(held),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return {
      properties,
      transform: state.transform,
      lineDash: state.lineDash,
      clip: segments(state.clip),
      path: segments(state.path),
    };
  };

  const takeState = (source: number): number =>
    intern(states, stateAt, stateOf(recording.states[source]));

  return {
    ...recording,
    images,
    resources,
    ops,
    states,
    frames: frames.map((frame) => ({
      ...frame,
      state: takeState(frame.state),
      stack: frame.stack.map(takeState),
      ops: frame.ops.map((op) =>
        intern(ops, opAt, operation(recording.ops[op])),
      ),
    })),
  };
}

/**
 * A recording of at most {@link MAX_REPLAY_FRAMES} frames, covering the whole of
 * what was captured, with each kept frame's `deltaMs` restated as the time since
 * the frame kept before it.
 *
 * The restatement is what makes a decimated recording play at the speed the game
 * really ran at: the deltas still sum to the section's elapsed time. The frame
 * `count` is left as it was recorded, so a reader can see that frames were
 * skipped rather than being told a smooth lie. The last frame is always kept
 * whatever the stride lands on — it is the frame the check's sweep stopped at,
 * and the one a reviewer looks at first.
 *
 * Keeping it costs a frame rather than the cap. The stride rounds up, so a
 * section whose length is an exact multiple of the cap strides over exactly that
 * many frames and stops one stride short of the end: the last frame still has to
 * come in, and the cap is a ceiling rather than a target. It takes the place of
 * the final strided frame — the frame nearest it, so the swap opens the smallest
 * gap available anywhere in the section — and is measured from where that frame
 * was measured from, which is what keeps the kept deltas summing to the elapsed
 * time.
 *
 * Exported for the suite beside this file, which reaches it over frame counts a
 * driven section cannot hand it.
 */
export function thinReplay(recording: Recording): Recording {
  const { frames } = recording;
  if (frames.length === 0) return recording;

  const stride = Math.max(1, Math.ceil(frames.length / MAX_REPLAY_FRAMES));
  const kept: RecordedFrame[] = [];
  let previousMs = frames[0].timeMs - frames[0].deltaMs;
  const keep = (frame: RecordedFrame): void => {
    kept.push({ ...frame, deltaMs: frame.timeMs - previousMs });
    previousMs = frame.timeMs;
  };

  for (let i = 0; i < frames.length; i += stride) keep(frames[i]);
  const last = frames[frames.length - 1];
  if (kept[kept.length - 1].count !== last.count) {
    if (kept.length >= MAX_REPLAY_FRAMES) {
      // The stride spent the whole budget on the way to a frame short of the end.
      // Drop the frame it stopped on, and put the moment back to the one before
      // it: a kept frame's restated delta is measured from exactly that moment, so
      // subtracting it recovers it, and the last frame's own delta then spans the
      // gap the two of them leave.
      const displaced = kept[kept.length - 1];
      kept.length -= 1;
      previousMs = displaced.timeMs - displaced.deltaMs;
    }
    keep(last);
  }

  return retable(recording, kept);
}

/**
 * Write a recording out, reporting rather than raising anything that goes wrong.
 *
 * A capture that closed no frames writes nothing: a file holding an empty frame
 * list would be collected as an output that turned up, and the run would tell the
 * reviewer there is a replay to watch and then open the player on nothing.
 *
 * What lands on disk is gzip rather than raw JSON. A recording is text made
 * almost entirely of numbers and repeated field names, which gzip takes down to a
 * fraction of its size, and every host that serves one declares the encoding so
 * the browser inflates it before the player sees it.
 *
 * Never throws. A file that cannot be written says something about the machine
 * the validators ran on, and failing the point over it would blame the build for
 * the host's problem.
 */
function writeReplay(destination: string, recording: Recording | null): void {
  if (recording === null || recording.frames.length === 0) return;
  try {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, gzipSync(JSON.stringify(thinReplay(recording))));
  } catch (error) {
    console.warn(`spectra: could not write ${destination}: ${String(error)}`);
  }
}

/**
 * Record the frames `scenario` drives and keep them as the review item's
 * `outputId` output, handing back whatever the scenario returned.
 *
 * Wrap the drive, not the arrangement:
 *
 * ```ts
 * const swept = await captureReplay(h, "discharge", () =>
 *   h.advance(framesFor(DISCHARGE_TIME)),
 * );
 * ```
 *
 * The assertions stay exactly where they were and read exactly what they did.
 */
export async function captureReplay<T>(
  h: Harness,
  outputId: string,
  scenario: () => T | Promise<T>,
): Promise<T> {
  const destination = mediaDestination(outputId, "json.gz");
  if (destination === null) return scenario();

  await h.page.evaluate(
    (design) =>
      (
        window as unknown as { __spectraRec: { arm(d: unknown): boolean } }
      ).__spectraRec.arm(design),
    { width: STAGE_W, height: STAGE_H, background: REPLAY_BACKGROUND },
  );
  try {
    return await scenario();
  } finally {
    // In a `finally`, so a scenario that failed still leaves its evidence behind.
    const recording = (await h.page.evaluate(() =>
      (
        window as unknown as { __spectraRec: { disarm(): unknown } }
      ).__spectraRec.disarm(),
    )) as Recording | null;
    writeReplay(destination, recording);
  }
}

/**
 * Keep the picture currently on the canvas as the review item's `outputId`
 * output.
 *
 * The companion to {@link captureReplay}, for a point whose evidence is one
 * PICTURE rather than a stretch of motion: which screen the game opened on, how
 * a build drew a shimmering Flux beside a holding one, where the letterbox bars
 * fell.
 *
 * What is written is whatever the last frame that RAN left behind, so call it
 * after the frame that poses the thing under test and before the assertions, so
 * a check that fails still leaves the picture that shows why. Nothing here can
 * change a verdict: outside a run this is a no-op, and a still that cannot be
 * written is reported as an output that never turned up.
 */
export async function captureStill(
  h: Harness,
  outputId: string,
): Promise<void> {
  const destination = mediaDestination(outputId, "png");
  if (destination === null) return;
  try {
    mkdirSync(dirname(destination), { recursive: true });
    await h.page.screenshot({ path: destination, type: "png" });
  } catch (error) {
    console.warn(`spectra: could not write ${destination}: ${String(error)}`);
  }
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
 * the build's. So `audio-init.js` watches the two doors a browser can emit sound
 * through (a Web Audio source being `start()`ed, whatever kind it is, and an
 * `<audio>` element being played) and counts what goes through them; the harness
 * brackets each driven frame around that count, so a sound is attributed to the
 * frame that produced it. A blip made of two oscillators counts as two, which is
 * why a check asserts that a frame sounded rather than how many times: the number
 * of sources is the build's business and the specification never fixed it.
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
 * reads with {@link Harness.advance}.
 */
export function watchCues(h: Harness): TimedCue[] {
  const played: TimedCue[] = [];
  harnessCues.get(h)?.push(played);
  return played;
}

/* -------------------------------------------------------------------------- */
/* Reading one frame's render                                                 */
/* -------------------------------------------------------------------------- */

/** Every string the frame drew, through `fillText` or `strokeText`. */
export function drawnText(calls: readonly DrawCall[]): string[] {
  return [
    ...callsTo(calls, "fillText"),
    ...callsTo(calls, "strokeText"),
  ].flatMap((args) => (typeof args[0] === "string" ? [args[0]] : []));
}

/**
 * Whether the frame drew `text` as part of some run of text, ignoring case.
 *
 * Substring rather than equality on purpose: the copy a check asserts is the
 * case's own, but how a build presents it is the build's, and a menu entry is
 * commonly drawn with a selection marker or padding around it. Requiring the
 * exact run would fail a screen that shows precisely the right words.
 */
export function drewText(calls: readonly DrawCall[], text: string): boolean {
  const wanted = text.trim().toLowerCase();
  return drawnText(calls).some((drawn) => drawn.toLowerCase().includes(wanted));
}

/**
 * Whether the frame drew `word` as a STANDALONE token, ignoring case.
 *
 * The stricter sibling of {@link drewText}, for the copy `specs/ui.md` requires
 * as a word rather than as a substring — the how-to screen's `SPACE`, `ARROWS`
 * and `AD`. A screen reading "press the spacebar" contains `space` and does not
 * name the key the specification named.
 */
export function drewWord(calls: readonly DrawCall[], word: string): boolean {
  const pattern = new RegExp(
    `(^|[^A-Za-z0-9])${word.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z0-9]|$)`,
    "i",
  );
  return drawnText(calls).some((drawn) => pattern.test(drawn));
}

/** One run of text a frame drew, and where it drew it in logical stage units. */
export interface TextDraw {
  text: string;
  /** The anchor the run was drawn at, mapped through the transform in force. */
  x: number;
  y: number;
  /**
   * The horizontal extent of the run's glyphs, in logical stage units.
   *
   * The width the context measured at the call, scaled by the transform in force
   * and laid out about the anchor as the alignment then in force places it. A
   * run whose width the recorder could not read spans its anchor alone, so
   * `left` and `right` are both `x`.
   */
  left: number;
  right: number;
}

/** A 2D affine transform, in the canvas's `[a, b, c, d, e, f]` order. */
export type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function numbers(args: unknown[], count: number): number[] | null {
  const taken = args.slice(0, count);
  return taken.length === count && taken.every((v) => typeof v === "number")
    ? (taken as number[])
    : null;
}

/** Where a user-space point lands once `m` is applied. */
export function applyMatrix(
  m: Matrix,
  x: number,
  y: number,
): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

/**
 * Walk a frame's operations, handing `visit` each one with the transform in
 * force at it.
 *
 * A build is free to draw under a transform — to translate to a drone's centre
 * and draw at the origin, or to rotate a diving drone into its heading — so the
 * position and the orientation a call names are only what they mean once the
 * transform at that call is applied. This carries `save`/`restore`, `translate`,
 * `scale`, `rotate`, `transform`, `setTransform` and `resetTransform`, starting
 * from `start` (the state the frame inherited) over `stack` (the states saved
 * under it, outermost first).
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
    } else if (method === "translate") {
      const v = numbers(args, 2);
      if (v) current = multiply(current, [1, 0, 0, 1, v[0], v[1]]);
    } else if (method === "scale") {
      const v = numbers(args, 2);
      if (v) current = multiply(current, [v[0], 0, 0, v[1], 0, 0]);
    } else if (method === "rotate") {
      const v = numbers(args, 1);
      if (v) {
        const c = Math.cos(v[0]);
        const sn = Math.sin(v[0]);
        current = multiply(current, [c, sn, -sn, c, 0, 0]);
      }
    } else if (method === "transform") {
      const v = numbers(args, 6);
      if (v) current = multiply(current, v as Matrix);
    } else if (method === "setTransform") {
      const v = numbers(args, 6);
      if (v) current = v as Matrix;
      else if (args.length === 0) current = IDENTITY;
      else if (typeof args[0] === "object" && args[0] !== null) {
        const m = args[0] as Record<string, unknown>;
        const parts = [m.a, m.b, m.c, m.d, m.e, m.f];
        if (parts.every((p) => typeof p === "number"))
          current = parts as Matrix;
      }
    } else if (method === "resetTransform") {
      current = IDENTITY;
    }
    visit(call, current);
  }
}

/**
 * Every run of text the frame drew, with its anchor in logical stage units.
 *
 * At the harness's default shape the canvas is the stage at one pixel per unit,
 * so what comes back is directly comparable with the figures `specs/field.md`
 * fixes — which is how `screens/hud-score` reads which strip a readout landed in.
 */
export function textDraws(calls: readonly DrawCall[]): TextDraw[] {
  const draws: TextDraw[] = [];
  walkTransforms(calls, (call, m) => {
    if (call.kind !== "call") return;
    if (call.method !== "fillText" && call.method !== "strokeText") return;
    const [text] = call.args;
    const at = numbers(call.args.slice(1), 2);
    if (typeof text !== "string" || at === null) return;
    const anchor = applyMatrix(m, at[0], at[1]);
    // The run's width under the same horizontal scale the anchor took, laid out
    // about the anchor the way the alignment in force places it.
    const width =
      typeof call.width === "number" && Number.isFinite(call.width)
        ? call.width * Math.hypot(m[0], m[1])
        : 0;
    const before =
      call.textAlign === "center"
        ? width / 2
        : call.textAlign === "right" || call.textAlign === "end"
          ? width
          : 0;
    draws.push({
      text,
      ...anchor,
      left: anchor.x - before,
      right: anchor.x - before + width,
    });
  });
  return draws;
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
    (design) =>
      (
        window as unknown as { __spectraRec: { arm(d: unknown): boolean } }
      ).__spectraRec.arm(design),
    { width: STAGE_W, height: STAGE_H, background: REPLAY_BACKGROUND },
  );
  await h.advance(1);
  const recording = (await h.page.evaluate(() =>
    (
      window as unknown as { __spectraRec: { disarm(): unknown } }
    ).__spectraRec.disarm(),
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
      const image = recording.images[source.$img];
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
    const image = recording.images[entry.imageIndex];
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

/** A sampled colour, each channel 0–255. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Euclidean distance between two colours, 0 to about 441. */
export function colorDistance(a: Rgb, b: Rgb): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

/** A colour's luminance: the reading a starfield is dimmer along. */
export function luminance(c: Rgb): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/** The five offsets a colour sample is averaged over, scaled by the spread. */
const SAMPLE_OFFSETS: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * The rendered colour at a logical point, averaged over a small cluster.
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
  const read = await h.pixels(
    SAMPLE_OFFSETS.map(([dx, dy]) => ({
      x: x + dx * spread,
      y: y + dy * spread,
    })),
  );
  return average(read.map(([r, g, b]) => ({ r, g, b })));
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

/** The distance between two centres, in logical units. */
export function distance(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
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
 * Open a run the way a player does: from a reset title, confirm the highlighted
 * first item, the mode entry.
 *
 * The route for a check about what a NEW RUN is — its lives, its stage, its
 * score, the wave the game lays out — none of which any pose can produce, because
 * `setStage` spawns nothing and `setScore` grants nothing. Nothing here is posed:
 * `reset` is the surface's own, and the rest is a real key through Chromium's
 * input pipeline.
 */
export async function startRunFromTitle(
  h: Harness,
  options: { seed?: number } = {},
): Promise<void> {
  await h.debug.reset(options.seed === undefined ? undefined : options);
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
    (snapshot, _argument, posed) => {
      const added = posed.bullets[posed.bullets.length - 1];
      if (added === undefined) return true;
      return !snapshot.bullets.some((one) => one.id === added.id);
    },
    null,
    { pose, maxFrames: shot.maxFrames ?? framesFor(1) },
  );
  const added = lastBullet(swept.posed);
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

/** The id every driven contact carries. One finger is all these checks need. */
const CONTACT_ID = 1;

/** The CDP session driving this page's touch contacts, opened on first use. */
const touchSessions = new WeakMap<Page, Promise<CDPSession>>();

/** The held session for `page`, opening it on the first contact it drives. */
function touchSession(page: Page): Promise<CDPSession> {
  const open = touchSessions.get(page);
  if (open !== undefined) return open;
  const opening = page.context().newCDPSession(page);
  touchSessions.set(page, opening);
  return opening;
}

/**
 * Dispatch one raw touch event through CDP.
 *
 * Playwright's own `page.touchscreen` carries `tap` alone, which is a press and a
 * lift with no frame between them, so a check that needs the contact HELD across
 * a frame cannot express itself through it. The Chrome DevTools Protocol is the
 * level that can, and it is what `page.touchscreen.tap` is itself built on.
 */
async function dispatchTouch(
  h: Harness,
  type: "touchStart" | "touchMove" | "touchEnd",
  point: { x: number; y: number } | null,
): Promise<void> {
  const session = await touchSession(h.page);
  await session.send("Input.dispatchTouchEvent", {
    type,
    touchPoints:
      point === null ? [] : [{ x: point.x, y: point.y, id: CONTACT_ID }],
  });
}

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

/** The middle of a hit region: where a gesture aimed at that item lands. */
export function rectCenter(rect: MenuRect): { x: number; y: number } {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/** Move the real mouse onto item `index`, and run the frame that reads it. */
export async function pointerOntoItem(
  h: Harness,
  index: number,
): Promise<void> {
  const at = rectCenter(await menuRect(h, index));
  const css = h.css(at.x, at.y);
  await h.page.mouse.move(css.x, css.y);
  await h.advance(1);
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
  await dispatchTouch(h, "touchStart", h.css(at.x, at.y));
  await h.advance(1);
}

/** Lift the contact `landOnItem` left down. */
export async function liftContact(h: Harness): Promise<void> {
  await dispatchTouch(h, "touchEnd", null);
  await h.advance(1);
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
  await dispatchTouch(h, "touchMove", h.css(end.x, end.y));
  await h.advance(1);
  await liftContact(h);
}
