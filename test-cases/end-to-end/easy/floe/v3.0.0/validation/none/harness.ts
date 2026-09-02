// Floe — the shared validator harness. CASE-PROVIDED.
//
// Every check in this suite is an ordinary vitest test that drives the built site
// IN A REAL BROWSER. There is nothing to import: an engineless run seeds no
// `src/` at all, so the build wrote its own frame loop, its own canvas fit, its
// own keyboard, its own audio, its own sprite loading, its own debug overlay and
// its own `window.__floe` — and the only place any of that exists is a page that
// has loaded the bundle. So the project serves the produced site, loads it in
// Chromium, and reaches the game the way anything reaches it: over the surface
// `specs/instrumentation.md` told the build to install.
//
// IT IS STILL A VITEST PROJECT, AND THAT IS DELIBERATE. The runner locates the
// build output before it chooses between the vitest and browser paths, so the
// produced site is on disk by the time this project runs. Staying a vitest
// project is what lets the case name ONE script per review item and have it
// resolve under all three engines — `validation/water/floe-carries.test.ts` is
// the same path whichever engine the run selected — and what keeps `format = 2`
// resolution passing.
//
// WHAT A CHECK READS. The game's own state (through `window.__floe`'s
// `snapshot`), the frames the harness drove, the operations the build issued
// against its 2D context, the bitmaps it handed those operations, the pixels they
// left on the canvas, and the sounds it emitted. Nothing here fabricates an
// outcome: the scenario helpers below only ARRANGE the strait through the
// surface, and the real update the build wrote is what runs from there.
//
// THE HARNESS OWNS EVERY COMPOUND SEQUENCE. The debug surface is atomic by
// design — each operation poses one field, reads the state, or moves the clock
// (`guides/authoring/writing-debug-apis-and-validators.md`) — so "open a crossing
// at level 3 with the strait cleared" is a helper here, built out of those atomic
// operations, and never an operation on the surface. A check that needs only part
// of a sequence calls the operations it needs: nothing a check does not ask for
// happens.
//
// AND THE HELPERS FIX GEOMETRY, NEVER THRESHOLDS. A helper poses a strait, drives
// a scenario, or reads a value out of a snapshot. Every tolerance a check
// asserts — a fraction of a tile, a colour distance, a number of units — is
// stated in that check, next to the figure `specs/` fixes for it, because a
// helper that carried the tolerance would hide what the check is really
// asserting. Look for a threshold in this file and you will not find one.
//
// THE CLOCK IS THE SURFACE'S. Nothing outside an engineless build owns its loop,
// so `specs/instrumentation.md` puts the clock on the surface: `setAutoStep(false)`
// takes the game off real time and `advance(ticks)` runs whole `TICK_DT` ticks.
// Every harness opens by taking the game off the clock, so a check asks for a
// number of ticks and gets exactly that number — no polling, no waiting, and no
// measurement of the machine it ran on. The one check that is ABOUT the loop
// running itself (`instrumentation/advances-in-real-time`) hands it back with
// {@link Harness.runFor}.
//
// EVERYTHING CROSSING INTO THE PAGE IS ASYNC. That is the whole of the difference
// between a suite here and its counterpart under an engine: `await h.snapshot()`
// rather than `h.snapshot()`, `await h.debug.setCritterTile(...)` rather than
// `h.debug.setCritterTile(...)`. The scenarios, the tolerances, and the
// assertions are the same ones, because they are the case's rather than the
// runtime's.
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
import type { Browser, BrowserContext, ConsoleMessage, Page } from "playwright";
import { connectChromium } from "./chromium";
import { fail } from "./assert";
import {
  COLS,
  HANDLE,
  HOP_COOLDOWN,
  HOP_KEY,
  ICE_ROWS,
  ITEM_LEN,
  OVERLAY_KEY,
  PLOW_W,
  ROWS,
  ROW_NEAR,
  SPRITE_SHEETS,
  SPRITE_TILE,
  STAGE_H,
  STAGE_W,
  START_COL,
  START_LIVES,
  TICK_DT,
  TICK_HZ,
  TILE,
  UNBOUND_KEY,
  WATER_ROWS,
  colAt,
  crossingTimer,
  rowAt,
  tileCX,
  tileCY,
  tileLeft,
  tileTop,
  type Facing,
  type FloeKind,
  type Footing,
  type LaneDir,
  type Phase,
  type Screen,
  type SheetName,
  type VehicleKind,
} from "./constants";

declare module "vitest" {
  export interface ProvidedContext {
    /** Where the built site is served, from `globalSetup.ts`. */
    floeUrl: string;
    /** The one Chromium every suite worker connects to. */
    floeBrowserWs: string;
    /**
     * Whether the build installed its debug surface, probed once by
     * `globalSetup.ts`. What {@link browserBudget} reads.
     */
    floeSurfacePresent: boolean;
  }
}

/* -------------------------------------------------------------------------- */
/* The contract the build owes                                                */
/* -------------------------------------------------------------------------- */

/** The version the surface reports (`FLOE_DEBUG_VERSION`). */
export const FLOE_DEBUG_VERSION = 1;

/**
 * Every operation `specs/instrumentation.md` requires on the surface under this
 * engine, including the two clock operations that exist only here.
 *
 * The list is the whole of it, in the order the specification states them, so
 * `instrumentation/surface-present` can assert completeness by naming this one
 * constant and a build missing anything is named for exactly what it is missing.
 */
export const REQUIRED_OPS = [
  // The clock (this engine alone).
  "setAutoStep",
  "advance",
  // The core.
  "reset",
  "snapshot",
  // The screen and the run.
  "setScreen",
  "setPhase",
  "setPhaseTimer",
  "setMenuIndex",
  "setScore",
  "setLives",
  "setLevel",
  "setReachedLevel",
  "setTimer",
  // The world gates.
  "setBearEmergence",
  "setCatchTest",
  "setFishCadence",
  "setTimerRunning",
  // The critter.
  "addCritter",
  "removeCritter",
  "setCritterTile",
  "setCritterX",
  "setCritterFacing",
  "setHopCooldown",
  "setBestRow",
  // The bears.
  "addBear",
  "removeBear",
  "clearBears",
  "setBearTile",
  "setBearPosition",
  "setBearStep",
  "setBearTarget",
  "setBearSense",
  "setBearRouting",
  "setBearTravel",
  // The lanes.
  "addVehicle",
  "removeVehicle",
  "clearVehicles",
  "setVehicleX",
  "addFloe",
  "removeFloe",
  "clearFloes",
  "setFloeX",
  "setLaneSpeed",
  "setLaneDirection",
  // The bays and the bonus catch.
  "setBay",
  "clearBays",
  "setFishBay",
  "clearFish",
] as const;

/** One tile of the strait. */
export interface Tile {
  col: number;
  row: number;
}

/** The critter, as a snapshot reports it. `x`/`y` is its CENTER. */
export interface CritterView {
  present: boolean;
  col: number;
  row: number;
  x: number;
  y: number;
  facing: Facing;
  footing: Footing;
  hopCooldown: number;
  bestRow: number;
}

/** One bear, as a snapshot reports it. `x`/`y` is its CENTER. */
export interface BearView {
  id: number;
  /** The tile it last settled on. */
  col: number;
  row: number;
  /** The tile it is travelling into; equal to `col`/`row` while settled. */
  stepCol: number;
  stepRow: number;
  x: number;
  y: number;
  facing: Facing;
  swimming: boolean;
  target: { col: number; row: number };
  sense: boolean;
  routing: boolean;
  travel: boolean;
}

/** One lane's motion, as a snapshot reports it. */
export interface LaneView {
  row: number;
  dir: LaneDir;
  speed: number;
}

/** One vehicle or one floe, as a snapshot reports it. `x` is its LEFT EDGE. */
export interface ItemView {
  id: number;
  row: number;
  kind: VehicleKind | FloeKind;
  x: number;
  /** Its length, in tiles. It spans `[x, x + TILE * len)` on its row. */
  len: number;
}

/**
 * The state a snapshot reports, exactly as `specs/instrumentation.md` shapes it.
 *
 * Every field an operation can pose is here, which is what makes every pose
 * verifiable by set-then-read. `muted` is the exception in the other direction:
 * no operation sets it, and it is the runtime's own mute bit, reached the way a
 * player reaches it through `KeyM`.
 */
export interface FloeSnapshot {
  version: number;
  screen: Screen;
  phase: Phase;
  phaseTimer: number;
  menuIndex: number;
  level: number;
  reachedLevel: number;
  lives: number;
  score: number;
  timer: number;
  timerMax: number;
  muted: boolean;
  bearEmergence: boolean;
  catchTest: boolean;
  fishCadence: boolean;
  timerRunning: boolean;
  bays: boolean[];
  fishBay: number | null;
  critter: CritterView;
  bears: BearView[];
  iceLanes: LaneView[];
  waterLanes: LaneView[];
  vehicles: ItemView[];
  floes: ItemView[];
  simTime: number;
}

/** The operations a check poses the game through. Every one crosses into the page. */
export interface FloeDebugApi {
  // The clock.
  setAutoStep(enabled: boolean): Promise<void>;
  advance(ticks: number): Promise<void>;

  // The core.
  reset(options?: { seed?: number }): Promise<void>;
  snapshot(): Promise<FloeSnapshot>;

  // The screen and the run.
  setScreen(screen: Screen): Promise<void>;
  setPhase(phase: Phase): Promise<void>;
  setPhaseTimer(seconds: number): Promise<void>;
  setMenuIndex(index: number): Promise<void>;
  setScore(score: number): Promise<void>;
  setLives(lives: number): Promise<void>;
  setLevel(level: number): Promise<void>;
  setReachedLevel(level: number): Promise<void>;
  setTimer(seconds: number): Promise<void>;

  // The world gates.
  setBearEmergence(enabled: boolean): Promise<void>;
  setCatchTest(enabled: boolean): Promise<void>;
  setFishCadence(enabled: boolean): Promise<void>;
  setTimerRunning(enabled: boolean): Promise<void>;

  // The critter.
  addCritter(col: number, row: number): Promise<void>;
  removeCritter(): Promise<void>;
  setCritterTile(col: number, row: number): Promise<void>;
  setCritterX(x: number): Promise<void>;
  setCritterFacing(facing: Facing): Promise<void>;
  setHopCooldown(seconds: number): Promise<void>;
  setBestRow(row: number): Promise<void>;

  // The bears.
  addBear(col: number, row: number): Promise<void>;
  removeBear(id: number): Promise<void>;
  clearBears(): Promise<void>;
  setBearTile(id: number, col: number, row: number): Promise<void>;
  setBearPosition(id: number, x: number, y: number): Promise<void>;
  setBearStep(id: number, direction: Facing): Promise<void>;
  setBearTarget(id: number, col: number, row: number): Promise<void>;
  setBearSense(id: number, enabled: boolean): Promise<void>;
  setBearRouting(id: number, enabled: boolean): Promise<void>;
  setBearTravel(id: number, enabled: boolean): Promise<void>;

  // The lanes.
  addVehicle(row: number, kind: VehicleKind, x: number): Promise<void>;
  removeVehicle(id: number): Promise<void>;
  clearVehicles(): Promise<void>;
  setVehicleX(id: number, x: number): Promise<void>;
  addFloe(row: number, kind: FloeKind, x: number): Promise<void>;
  removeFloe(id: number): Promise<void>;
  clearFloes(): Promise<void>;
  setFloeX(id: number, x: number): Promise<void>;
  setLaneSpeed(row: number, speed: number): Promise<void>;
  setLaneDirection(row: number, dir: LaneDir): Promise<void>;

  // The bays and the bonus catch.
  setBay(index: number, filled: boolean): Promise<void>;
  clearBays(): Promise<void>;
  setFishBay(index: number): Promise<void>;
  clearFish(): Promise<void>;
}

/* -------------------------------------------------------------------------- */
/* The clock                                                                  */
/* -------------------------------------------------------------------------- */
//
// Floe's timestep is FIXED, and that is the whole difference from the cases whose
// engineless surface takes an elapsed time. `specs/overview.md` fixes
// `TICK_HZ` (120) ticks a second and `specs/instrumentation.md` gives the surface
// `advance(ticks)`, so a suite asks for whole ticks and nothing is rounded on the
// way in: every duration the specification states is a count of ticks, exactly.
//
// What a suite still chooses is HOW an interval is divided into calls, and that
// is what the clocks below supply. `instrumentation/deterministic-core` is the
// item about the division: the same second of game time, driven as one call and
// as a hundred and twenty, must reach the same state, and a jittered division
// must reach it too.

/** How many seconds `ticks` whole ticks cover. */
export function seconds(ticks: number): number {
  return ticks * TICK_DT;
}

/**
 * The whole ticks covering `duration` seconds.
 *
 * Rounded rather than floored: every duration `specs/` fixes is stated in
 * seconds and the tick is `1/120` s, so a figure like `HOP_COOLDOWN` (`0.12` s)
 * is `14.4` ticks and a check that wants "the cooldown, elapsed" wants the first
 * whole tick at or past it. A check that needs the tick BEFORE a boundary says
 * so itself, with its own arithmetic.
 */
export function ticksFor(duration: number): number {
  return Math.round(duration * TICK_HZ);
}

/** The whole ticks that reach at least `duration` seconds. */
export function ticksPast(duration: number): number {
  return Math.ceil(duration * TICK_HZ - 1e-9);
}

/** A rate in units per second, from a displacement measured over `ticks` ticks. */
export function speedOverTicks(delta: number, ticks: number): number {
  return (Math.abs(delta) * TICK_HZ) / ticks;
}

/** A source of call sizes, in whole ticks: how an interval is divided up. */
export interface Clock {
  /** The next call's size, in whole ticks. Always at least one. */
  ticks(): number;
}

/** Every call the same number of ticks. */
export class ConstantClock implements Clock {
  constructor(private readonly size: number) {
    if (!Number.isInteger(size) || size < 1) {
      throw new RangeError(
        `ConstantClock needs a whole size >= 1, got ${size}`,
      );
    }
  }
  ticks(): number {
    return this.size;
  }
}

/** A repeating pattern of call sizes: an uneven but predictable division. */
export class SequenceClock implements Clock {
  private index = 0;
  constructor(private readonly sizes: readonly number[]) {
    if (sizes.length === 0) {
      throw new RangeError("SequenceClock needs at least one size, got none");
    }
  }
  ticks(): number {
    const size = this.sizes[this.index % this.sizes.length];
    this.index += 1;
    return Math.max(1, Math.round(size));
  }
}

/**
 * A hash of the seed and the call index, avalanched so that neighbouring
 * indices — which is all a call counter ever produces — do not yield
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
 * A seeded draw from a range of call sizes: the division that stands in for a
 * real machine under load. The seed is mandatory, because a claim that a build
 * reaches the same state however the interval was divided is worth making only
 * when the failing division replays.
 */
export class JitterClock implements Clock {
  private index = 0;
  private readonly span: number;
  constructor(
    private readonly min: number,
    max: number,
    private readonly seed: number,
  ) {
    if (min < 1) throw new RangeError(`JitterClock needs min >= 1, got ${min}`);
    if (max < min) {
      throw new RangeError(
        `JitterClock needs max >= min, got min ${min} and max ${max}`,
      );
    }
    this.span = max - min + 1;
  }
  ticks(): number {
    const index = this.index;
    this.index += 1;
    return (
      this.min +
      Math.floor((hash32(this.seed, index) / 0x1_0000_0000) * this.span)
    );
  }
}

/** `total` ticks divided into calls of the sizes `clock` supplies. */
export function divide(total: number, clock: Clock): number[] {
  const calls: number[] = [];
  let left = Math.max(0, Math.trunc(total));
  while (left > 0) {
    const size = Math.min(left, Math.max(1, Math.trunc(clock.ticks())));
    calls.push(size);
    left -= size;
  }
  return calls;
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

/** A sound the build emitted, and where in the drive it emitted it. */
export interface TimedCue {
  /** The recorded frame it sounded on, 1-based, as {@link Harness.frame} counts. */
  frame: number;
  /** The simulation tick the drive had reached, 1-based. */
  tick: number;
  /** The game time those ticks covered, in milliseconds. */
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

export interface HarnessOptions {
  /** The window's CSS width. Defaults to the logical stage width. */
  cssWidth?: number;
  /** The window's CSS height. Defaults to the logical stage height. */
  cssHeight?: number;
  /** Device pixels per CSS pixel. Defaults to 1, so one device pixel is one unit. */
  dpr?: number;
  /**
   * Where a recorded frame's boundary is put, overriding what the page said.
   *
   * `"advance"` brackets the frame around `advance(ticks)`, which is right for a
   * build that draws there; `"raf"` brackets it around one of the build's own
   * animation frames, which is right for a build that draws only from its loop.
   * Left unset — which is how every check should leave it — the harness decides
   * once, by watching what the build's `advance` actually draws.
   */
  frames?: FrameMode;
}

/** Where a recorded frame's boundary is put. */
export type FrameMode = "advance" | "raf";

/** How far a sweep may run, and how many ticks separate two samples. */
export interface UntilOptions {
  maxTicks?: number;
  poll?: number;
}

/** What a sweep found: whether the predicate ever held, and where it stopped. */
export interface UntilResult {
  hit: boolean;
  /** Ticks advanced before the sample that ended the sweep. */
  ticks: number;
  snapshot: FloeSnapshot;
}

/** How far a coarse sweep may run, and how much game time separates two samples. */
export interface SkipOptions {
  maxSeconds?: number;
  pollSeconds?: number;
}

/** What a coarse sweep found. */
export interface SkipResult {
  hit: boolean;
  /** Seconds of game time covered before the sample that ended the sweep. */
  elapsed: number;
  snapshot: FloeSnapshot;
}

export interface Harness {
  /** The page the build is running in. For a check that needs Playwright itself. */
  readonly page: Page;
  /**
   * The surface the BUILD installed, as operations that cross into the page.
   *
   * Read off `window.__floe` and never constructed here — see
   * {@link unexposedSurface}.
   */
  readonly debug: FloeDebugApi;
  /**
   * Why the build's surface cannot be driven, or `null` when it can.
   *
   * A fault here is the build's: the surface is missing, or it is missing an
   * operation the specification requires. It says what was found
   * (`window.__floe was still absent 120s after the page loaded`), and
   * {@link failSurface} pairs it with what the specification requires. Every
   * operation fails BY ASSERTION with that pair rather than throwing, so a
   * missing surface lands as the verdict of every point that reaches for it —
   * and, crucially, a harness built in a `beforeEach` still comes back, so the
   * fault is reported by the check rather than buried in a hook.
   */
  readonly surfaceFault: string | null;
  /** Everything the page logged to `console.error`, or threw, oldest first. */
  readonly pageErrors: string[];
  /** Where this harness puts a recorded frame's boundary. See {@link FrameMode}. */
  readonly frameMode: FrameMode;

  /** The recorded frames this harness has closed, 1-based. */
  frame(): number;
  /** The simulation ticks this harness has driven. */
  tick(): number;
  /** The game time those ticks covered, in milliseconds. */
  timeMs(): number;

  /** A fresh read of the game's state through the build's `snapshot`. */
  snapshot(): Promise<FloeSnapshot>;
  /**
   * Run several operations of the build's own surface, in order, in ONE crossing
   * into the page.
   *
   * A POSE IS ARRANGEMENT, NEVER A MEASUREMENT. Each entry is exactly the call
   * `h.debug.<op>(...)` would have made — the build's own operation, the caller's
   * own arguments, in the order written — and the build's rules run from whatever
   * they leave behind, on the next tick, exactly as before. What crossing them
   * together removes is a round trip to the browser per FIELD, and what a round
   * trip costs is a property of how busy the machine is rather than of the build:
   * `startCrossing` alone arranges eighteen of them, and every suite in this
   * project opens with it.
   *
   * Use it for a run of poses with no reading between them. Where a pose's
   * argument comes from a reading — an id the roster has to report first — the
   * reading goes between two calls of this, not inside one.
   */
  poseAll(poses: readonly Pose[]): Promise<void>;
  /**
   * Run `ticks` whole simulation ticks.
   *
   * One call into the page by default. `clock` divides the interval into several
   * calls instead, which is what `instrumentation/deterministic-core` varies.
   * While a {@link captureReplay} is running the interval is divided into
   * recorded frames whatever the clock says, so a capture keeps motion rather
   * than one still.
   */
  advance(ticks: number, clock?: Clock): Promise<void>;
  /**
   * Run `ticks` ticks and close exactly one RECORDED frame around them, whether
   * or not a capture is armed.
   *
   * What {@link frameCalls} and {@link blitsOfFrame} are built on. A check drives
   * with {@link advance}; this is for reading one frame's render.
   */
  step(ticks?: number): Promise<void>;
  /**
   * Run `ticks` ticks ONE AT A TIME and hand back the state each of them left,
   * oldest first — in a single crossing into the page.
   *
   * WHY THIS EXISTS. A tick driven from Node costs a round trip to the browser
   * and back, and reading the state after it costs another; a check that watches
   * four seconds of a bear's glide tick by tick pays nine hundred and sixty of
   * them, and what a round trip costs is not a property of the build but of how
   * busy the machine is. The ticks here are exactly the ticks the loop below
   * would have run — one `advance(1)` each, one `snapshot()` after each, in the
   * same order — and the only thing that changes is that they are asked for
   * together. A check reads the returned series exactly as it read the snapshots
   * it collected one at a time.
   *
   * While a {@link captureReplay} is running each tick closes a recorded frame,
   * which is what driving them one at a time did before.
   */
  sample(ticks: number): Promise<FloeSnapshot[]>;
  /**
   * {@link sample}, with one operation of the build's own surface run before a
   * tick — `pose(state)` decides which, from the state as it stands.
   *
   * For the checks that have to act BETWEEN ticks: re-committing a bear's step on
   * the tick it settles, say. The decision stays here, in the case's own rules,
   * so this cannot batch a whole run into one crossing — but it does collapse the
   * pose, the tick and the reading into ONE, where they were three.
   */
  sampleWith(
    ticks: number,
    pose: (snapshot: FloeSnapshot) => Pose | null,
  ): Promise<FloeSnapshot[]>;
  /** Advance until `predicate` holds, sampling every `poll` ticks. */
  until(
    predicate: (snapshot: FloeSnapshot) => boolean,
    options?: UntilOptions,
  ): Promise<UntilResult>;
  /**
   * Run `duration` seconds of game time WITHOUT closing a recorded frame.
   *
   * The same real ticks the loop runs, but off camera: no frame boundary is
   * closed, so a capture running across it keeps nothing, and a section that has
   * to sit through eight seconds of the bonus catch's cadence costs a replay
   * nothing. Use it for the wait; use {@link advance} for the part a check is
   * about.
   */
  skip(duration: number): Promise<void>;
  /** {@link skip} until `predicate` holds, sampling every `pollSeconds`. */
  skipUntil(
    predicate: (snapshot: FloeSnapshot) => boolean,
    options?: SkipOptions,
  ): Promise<SkipResult>;
  /** Hand the game back to its own frame loop for `ms` of real time, then take it back. */
  runFor(ms: number): Promise<void>;

  /** Press a key and leave it down, as a player holding it would. */
  hold(code: string): Promise<void>;
  /** Release a key held by {@link hold}. */
  release(code: string): Promise<void>;
  /**
   * Press a key, run the one tick that delivers it, and release it.
   *
   * A press that ran no tick would never reach the game, and a press released
   * before a tick ran would be invisible to a build that reads its keyboard by
   * comparing held state between ticks — so the tick goes between the two.
   * `specs/controls.md` reads confirm, back, pause and mute as press edges,
   * which is exactly what this delivers.
   */
  tap(code: string): Promise<void>;
  /** Hold one or more keys down for `ticks` ticks, then release them all. */
  holdFor(codes: string | readonly string[], ticks: number): Promise<void>;

  /** Run one recorded frame and hand back every operation its render issued. */
  frameCalls(ticks?: number): Promise<DrawCall[]>;
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

/** The init scripts injected before any of the build's own script runs. */
const INIT_SCRIPTS = ["recorder-init.js", "audio-init.js"] as const;

/** This module's directory: the validator project's root. */
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * The workspace this project is staged into, which is where `assets/` sits.
 *
 * Derived from this file's own URL rather than from the working directory, so it
 * names the same place wherever the project was staged. The runner stages the
 * selected engine's directory to `validation/` inside the build's tree, which is
 * also how this project is run against a reference implementation.
 */
export const WORKSPACE_ROOT = resolve(PROJECT_ROOT, "..");

/**
 * How long this project waits on the BROWSER for one step — a page load, the
 * surface appearing, a screenshot — when the build has already been shown to
 * install a surface.
 *
 * NONE OF THESE DEADLINES MEASURES THE BUILD. Every one of them is a wall clock
 * on a host this project shares with whatever else is running on it, and every
 * one of them is spent waiting for Chromium rather than for the game: the page
 * load, the poll that returns the instant `window.__floe` appears, the screenshot
 * that keeps a check's evidence. A conforming build resolves each of them in a
 * second or two, so what a ceiling here really decides is whether a BUSY MACHINE
 * can turn a conforming build into a failing one — and this one is sized so it
 * cannot. Measured on a twenty-core host under a load average of four hundred and
 * sixty, the slowest page load this project saw was twenty-four seconds and the
 * slowest surface wait three; two minutes is five times the worse of them.
 *
 * It costs a conforming build nothing, because a wait that returns immediately
 * returns immediately whatever its ceiling is.
 */
const PATIENT_MS = 120_000;

/**
 * The same deadline once the build is known to install NO surface.
 *
 * `globalSetup.ts` asks that question once, patiently. When the answer is no,
 * there is nothing left for a per-suite wait to discover and a patient one would
 * cost every suite in the project a two-minute ceiling — turning a build that
 * scores nothing into a run that never finishes and so decides nothing at all.
 * Ten seconds is what such a build cost before this distinction existed.
 */
const IMPATIENT_MS = 10_000;

/**
 * How long to wait on the browser for one step, given what the probe found.
 *
 * Read through `inject` at the call rather than captured once, so a suite pays
 * for it only where a wait is actually armed.
 */
function browserBudget(): number {
  return inject("floeSurfacePresent") ? PATIENT_MS : IMPATIENT_MS;
}

let browserPromise: Promise<Browser> | null = null;

async function sharedBrowser(): Promise<Browser> {
  browserPromise ??= connectChromium(inject("floeBrowserWs"));
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
 * one thing `strait/stage-fit` varies. Everything else about a harness is the
 * page: a fresh one opens on a build that has just started, with no key held, no
 * audio context opened, and the mute preference back off, which is a stronger
 * guarantee than any reset the surface offers, since `reset()` deliberately
 * leaves muting alone.
 *
 * A page per harness rather than a page reused between them, because a check may
 * legitimately hold two harnesses at once — `instrumentation/deterministic-core`
 * runs the same second under two divisions — and a harness whose page had been
 * taken over by a later one would read someone else's game while looking exactly
 * like it worked.
 */
const contexts = new Map<string, BrowserContext>();

/**
 * Whether a console error is Chromium's own unsolicited `/favicon.ico` request
 * coming back 404, rather than anything the build did.
 *
 * `specs/` asks a build for a canvas and nothing else in the page, so a missing
 * site icon says nothing about it; the request is the browser's, is fired at a
 * moment of its own choosing after load, and the static server answers what it
 * answers for anything absent. Left in, it would turn `pageErrors` into a
 * reading of whether a check ran long enough for that request to land.
 */
function isUnsolicitedFavicon(message: ConsoleMessage): boolean {
  return (
    message.location().url.endsWith("/favicon.ico") &&
    message.text().includes("Failed to load resource")
  );
}

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
 * several ticks later, in a place that names nothing.
 *
 * Keys that belong to the MACHINERY rather than to a check are answered with
 * `undefined` instead: awaiting a value probes `then`, and vitest's own error
 * formatting probes symbols and `constructor`. Failing those would replace the
 * verdict below with noise from the machinery that was trying to report it.
 */
function unexposedSurface(reason: string): FloeDebugApi {
  return new Proxy({} as FloeDebugApi, {
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
 * specification requires.
 */
async function readSurfaceFault(page: Page): Promise<string | null> {
  const budget = browserBudget();
  try {
    await page.waitForFunction(
      (handle) =>
        typeof (window as never)[handle] === "object" &&
        (window as never)[handle] !== null,
      HANDLE,
      { timeout: budget },
    );
  } catch {
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

/** One operation of the build's own surface, run in the page before a call. */
export interface Pose {
  op: string;
  args: readonly unknown[];
}

/** What a drive is asked to do beyond running its ticks. */
interface DriveOptions {
  /** A pose to run before the call at the same index, or `null` for none. */
  poses?: readonly (Pose | null)[];
  /** Keep the state each call left, rather than only the state at the end. */
  collect?: boolean;
}

/** What a drive hands back: the state it ended on, and the series if asked for. */
interface DriveResult {
  snapshot: FloeSnapshot;
  series: FloeSnapshot[];
}

/**
 * The most recorded frames one {@link Harness.advance} closes while a capture is
 * armed, and the fewest ticks each of them covers.
 *
 * Both are about the SHAPE of the evidence rather than about any verdict. Four
 * ticks a frame is thirty recorded frames per second of game time, which is what
 * a replay of a moving strait wants; the ceiling keeps a section that advances a
 * minute of game time from closing seven thousand frames, and widens the frames
 * instead.
 *
 * FOUR RATHER THAN TWO BECAUSE OF {@link MAX_REPLAY_FRAMES}. What is written out
 * is at most three hundred frames whatever was recorded, so a ten-second section
 * recorded at sixty frames a second drew six hundred pictures to keep three
 * hundred, and every one of those pictures is the build's own render run inside
 * the page. At thirty a section of that length records exactly what the replay
 * keeps, and a reviewer watches the same thing.
 */
const RECORD_MIN_TICKS = 4;
const RECORD_MAX_FRAMES = 240;

/**
 * The most real time one drive spends waiting on the BUILD'S OWN animation
 * frame, in milliseconds, altogether across every frame it records.
 *
 * WHY THERE IS A CEILING ON THIS AT ALL. A build that draws only from its loop
 * (`"raf"`) is recorded by bracketing one of its own animation frames, which is
 * the only place its picture exists — so this one wait cannot be replaced with a
 * step. A browser presents in a frame's time and a drive spends milliseconds of
 * this; but an animation frame is the one thing in this harness the HOST can
 * withhold, and a drive that records {@link RECORD_MAX_FRAMES} frames would wait
 * on it that many times. Without a ceiling, a host that stops presenting turns a
 * build whose loop is fine into a check that ran out of time — a verdict about
 * the machine wearing the build's name, which is the whole thing this project
 * refuses to do.
 *
 * Spending it costs the EVIDENCE and nothing else: the frames still run, the
 * ticks are still the ticks the check asked for, and every reading a check takes
 * is a snapshot of the game's own state rather than a picture. What a spent
 * budget loses is pictures in a replay, which no item is graded on.
 *
 * Two seconds is a hundred and twenty frames' worth at sixty a second — far more
 * than any drive needs on a host that is presenting at all.
 */
const RECORD_PAINT_BUDGET_MS = 2_000;

/**
 * The most real time ONE such wait is given, in milliseconds.
 *
 * The budget above is the whole drive's; this bounds a single frame so a drive
 * that is going to lose its pictures loses them early rather than spending the
 * whole budget on the first one.
 */
const RECORD_PAINT_MAX_MS = 500;

/**
 * Load the built site in a browser, take the game off the wall clock, and hand
 * back everything a check reads.
 *
 * The default shape is the stage's own size at one device pixel per CSS pixel,
 * so a logical coordinate and a canvas pixel are the same thing and no check but
 * `strait/stage-fit` has to think about the fit at all.
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
    if (message.type() !== "error") return;
    // The one console error that is the BROWSER's rather than the build's.
    // Chromium asks every page it opens for `/favicon.ico` without being told
    // to, at a moment of its own choosing, and the static server answers 404
    // because nothing in `specs/` asks a build for a site icon. It surfaces
    // whenever a check runs long enough for the request to land, which would
    // make "the page logged nothing" a check on how long a scenario took.
    if (isUnsolicitedFavicon(message)) return;
    pageErrors.push(message.text());
  });

  // With an explicit budget rather than Playwright's default thirty seconds: a
  // page load is the browser's work on a shared host, and a build whose page
  // never loads is what `globalSetup.ts` has already decided (see
  // {@link browserBudget}).
  await page.goto(inject("floeUrl"), {
    waitUntil: "load",
    timeout: browserBudget(),
  });

  const surfaceFault = await readSurfaceFault(page);
  const refuse = (): never => failSurface(surfaceFault ?? "");

  const call = async (operation: string, args: unknown[]): Promise<unknown> => {
    if (surfaceFault !== null) refuse();
    return page.evaluate(
      ([handle, name, rest]) =>
        (
          window as unknown as Record<
            string,
            Record<string, (...a: unknown[]) => unknown>
          >
        )[handle][name](...rest),
      [HANDLE, operation, args] as const,
    );
  };

  const debug =
    surfaceFault !== null
      ? unexposedSurface(surfaceFault)
      : (new Proxy({} as FloeDebugApi, {
          get: (_target, property): unknown => {
            if (typeof property === "symbol") return undefined;
            if (property === "then" || property === "constructor")
              return undefined;
            const name = String(property);
            return (...args: unknown[]) => call(name, args);
          },
        }) as FloeDebugApi);

  let frameMode: FrameMode = options.frames ?? "advance";

  if (surfaceFault === null) {
    // Off the wall clock before a check touches anything: from here the game
    // changes only when this harness says so.
    await call("setAutoStep", [false]);
    // And a recorder over the surface before a check can arm one. A build is
    // free to ask for its 2D context on the frame it first draws rather than
    // while it initializes, so the surface can be installed and answering
    // before any context exists to record — and a `captureReplay` armed in that
    // window arms nothing and writes no evidence for a section that drew.
    await page
      .waitForFunction(
        () =>
          (
            window as unknown as { __floeRec: { ready(): boolean } }
          ).__floeRec.ready(),
        undefined,
        { timeout: browserBudget() },
      )
      .catch(() => undefined);
    if (options.frames === undefined) {
      frameMode = (await drawsOnAdvance(page)) ? "advance" : "raf";
    }
    // Back to the title, undoing the tick the probe above spent.
    await call("reset", []);
  }

  const view = fitViewport(cssWidth, cssHeight, dpr);
  const cueSinks: TimedCue[][] = [];
  let frameCount = 0;
  let tickCount = 0;
  let capturing = false;

  /**
   * Run each of `calls` ticks, in one crossing, closing a recorded frame around
   * each when `record` is set.
   *
   * The whole loop lives inside ONE page evaluation, so nothing the page's own
   * animation frame renders can land inside a recorded frame in `"advance"`
   * mode — and so a frame the recorder keeps is exactly one call the harness
   * drove. In `"raf"` mode the advance happens OUTSIDE the frame and the frame
   * brackets one of the build's own animation frames, which is where a build
   * that draws only from its loop draws.
   */
  const drive = async (
    calls: readonly number[],
    record: boolean,
    options: DriveOptions = {},
  ): Promise<DriveResult> => {
    if (surfaceFault !== null) refuse();
    if (calls.length === 0) {
      const only = await debug.snapshot();
      return { snapshot: only, series: [] };
    }
    const mode = record ? frameMode : "none";
    const poses = options.poses ?? [];
    const collect = options.collect ?? false;
    const result = (await page.evaluate(
      async ([
        handle,
        sizes,
        how,
        dt,
        before,
        series,
        budgetMs,
        maxPaintMs,
      ]) => {
        const api = (
          window as unknown as Record<
            string,
            Record<string, (...a: unknown[]) => unknown>
          >
        )[handle];
        const rec = (
          window as unknown as {
            __floeRec: Record<string, (...a: unknown[]) => unknown>;
          }
        ).__floeRec;
        const audio = (
          window as unknown as { __floeAudio: { started(): number } }
        ).__floeAudio;
        // The build's own animation frame, waited on for at most what the
        // budget has left — see `RECORD_PAINT_BUDGET_MS`. A frame that arrives
        // costs its own time and no more; one the host never presents costs the
        // wait its ceiling and then costs nothing, so a drive cannot be held up
        // by a renderer that has stopped.
        let paintLeft = budgetMs;
        const paint = (): Promise<void> =>
          new Promise((done) => {
            if (paintLeft <= 0) {
              done();
              return;
            }
            const opened = performance.now();
            let closed = false;
            const close = (): void => {
              if (closed) return;
              closed = true;
              paintLeft -= performance.now() - opened;
              done();
            };
            const timer = setTimeout(close, Math.min(paintLeft, maxPaintMs));
            requestAnimationFrame(() => {
              clearTimeout(timer);
              close();
            });
          });
        const sounds: number[] = [];
        const shots: unknown[] = [];
        for (const [index, ticks] of sizes.entries()) {
          // The pose for this call, run through the build's OWN surface, exactly
          // as a crossing of its own would have run it.
          const pose = before[index];
          if (pose !== null) api[pose.op](...pose.args);
          const started = audio.started();
          if (how === "advance") {
            rec.begin();
            api.advance(ticks);
            rec.end(ticks * dt);
          } else if (how === "raf") {
            api.advance(ticks);
            rec.begin();
            // The build re-arms its own animation frame from inside its loop, so
            // the callback queued here runs after the one that presents.
            await paint();
            rec.end(ticks * dt);
          } else {
            api.advance(ticks);
          }
          sounds.push(audio.started() - started);
          if (series) shots.push(api.snapshot());
        }
        return { snapshot: api.snapshot(), sounds, series: shots };
      },
      [
        HANDLE,
        [...calls],
        mode,
        TICK_DT * 1000,
        calls.map((_, index) => poses[index] ?? null),
        collect,
        RECORD_PAINT_BUDGET_MS,
        RECORD_PAINT_MAX_MS,
      ] as const,
    )) as {
      snapshot: FloeSnapshot;
      sounds: number[];
      series: FloeSnapshot[];
    };

    for (const [index, ticks] of calls.entries()) {
      tickCount += ticks;
      if (record) frameCount += 1;
      for (let n = 0; n < result.sounds[index]; n += 1) {
        for (const sink of cueSinks) {
          sink.push({
            frame: frameCount,
            tick: tickCount,
            t: tickCount * TICK_DT * 1000,
          });
        }
      }
    }
    return { snapshot: result.snapshot, series: result.series };
  };

  /** How a plain {@link Harness.advance} is divided while a capture is armed. */
  const recordedCalls = (ticks: number): number[] => {
    const size = Math.max(
      RECORD_MIN_TICKS,
      Math.ceil(ticks / RECORD_MAX_FRAMES),
    );
    return divide(ticks, new ConstantClock(size));
  };

  /**
   * Advance and read the state those ticks left, in as few crossings as the
   * mode allows: recorded frames while a capture is armed, one call otherwise.
   */
  const advanceAndRead = async (
    ticks: number,
    clock?: Clock,
  ): Promise<FloeSnapshot> => {
    if (capturing) return (await drive(recordedCalls(ticks), true)).snapshot;
    return (
      await drive(clock === undefined ? [ticks] : divide(ticks, clock), false)
    ).snapshot;
  };

  const readPixels = async (
    devicePoints: readonly { x: number; y: number }[],
  ): Promise<[number, number, number, number][]> =>
    page.evaluate(
      (points) => {
        const canvases = Array.from(document.querySelectorAll("canvas"));
        if (canvases.length === 0)
          throw new Error("floe: the page has no <canvas>");
        let canvas = canvases[0];
        for (const other of canvases) {
          if (other.width * other.height > canvas.width * canvas.height)
            canvas = other;
        }
        const ctx = canvas.getContext("2d");
        if (ctx === null) throw new Error("floe: the canvas has no 2D context");
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
   * Wait for the build's own loop to present, when this build draws nowhere
   * else.
   *
   * A build that draws inside `advance` has already painted what the last drive
   * produced; a build that draws only from its loop has not, and reading its
   * canvas before it does would sample the frame before the one the check posed.
   */
  const settle = async (): Promise<void> => {
    if (frameMode === "advance") return;
    await page.evaluate(
      // Bounded for the reason `RECORD_PAINT_BUDGET_MS` gives: a host that has
      // stopped presenting must cost this a wait, not the check its verdict.
      (maxPaintMs) =>
        new Promise<void>((done) => {
          const timer = setTimeout(done, maxPaintMs);
          requestAnimationFrame(() => {
            clearTimeout(timer);
            done();
          });
        }),
      RECORD_PAINT_MAX_MS,
    );
  };

  const harness: Harness = {
    page,
    debug,
    surfaceFault,
    pageErrors,
    get frameMode() {
      return frameMode;
    },

    frame: () => frameCount,
    tick: () => tickCount,
    timeMs: () => tickCount * TICK_DT * 1000,

    snapshot: () => debug.snapshot(),

    async poseAll(poses) {
      if (surfaceFault !== null) refuse();
      if (poses.length === 0) return;
      await page.evaluate(
        ([handle, ops]) => {
          const api = (
            window as unknown as Record<
              string,
              Record<string, (...a: unknown[]) => unknown>
            >
          )[handle];
          for (const { op, args } of ops) api[op](...args);
        },
        [
          HANDLE,
          poses.map((pose) => ({ op: pose.op, args: [...pose.args] })),
        ] as const,
      );
    },

    async advance(ticks, clock) {
      const whole = Math.max(0, Math.trunc(ticks));
      if (whole === 0) return;
      await advanceAndRead(whole, clock);
    },

    async step(ticks = 1) {
      await drive([Math.max(1, Math.trunc(ticks))], true);
    },

    async sample(ticks) {
      const whole = Math.max(0, Math.trunc(ticks));
      if (whole === 0) return [];
      const { series } = await drive(
        new Array<number>(whole).fill(1),
        capturing,
        { collect: true },
      );
      return series;
    },

    async sampleWith(ticks, pose) {
      const whole = Math.max(0, Math.trunc(ticks));
      const series: FloeSnapshot[] = [];
      let state = await this.snapshot();
      for (let tick = 0; tick < whole; tick += 1) {
        const posed = pose(state);
        const driven = await drive([1], capturing, {
          poses: [posed],
          collect: true,
        });
        state = driven.series[0];
        series.push(state);
      }
      return series;
    },

    async until(predicate, untilOptions = {}) {
      const maxTicks = untilOptions.maxTicks ?? ticksFor(2);
      const poll = Math.max(1, untilOptions.poll ?? 1);

      let snapshot = await this.snapshot();
      if (predicate(snapshot)) return { hit: true, ticks: 0, snapshot };

      let ticks = 0;
      while (ticks < maxTicks) {
        const step = Math.min(poll, maxTicks - ticks);
        snapshot = await advanceAndRead(step);
        ticks += step;
        if (predicate(snapshot)) return { hit: true, ticks, snapshot };
      }
      return { hit: false, ticks, snapshot };
    },

    async skip(duration) {
      const whole = Math.max(0, ticksFor(duration));
      if (whole === 0) return;
      await drive([whole], false);
    },

    async skipUntil(predicate, skipOptions = {}) {
      const maxSeconds = skipOptions.maxSeconds ?? 60;
      const pollSeconds = Math.max(
        TICK_DT,
        skipOptions.pollSeconds ?? seconds(ticksFor(0.25)),
      );

      let snapshot = await this.snapshot();
      if (predicate(snapshot)) return { hit: true, elapsed: 0, snapshot };

      let elapsed = 0;
      while (elapsed < maxSeconds) {
        const step = Math.min(pollSeconds, maxSeconds - elapsed);
        snapshot = (await drive([Math.max(1, ticksFor(step))], false)).snapshot;
        elapsed += step;
        if (predicate(snapshot)) return { hit: true, elapsed, snapshot };
      }
      return { hit: false, elapsed, snapshot };
    },

    async runFor(ms) {
      if (surfaceFault !== null) refuse();
      // The one thing here that depends on real elapsed time, so the one thing a
      // browser's own idea of which page matters can distort. The launch already
      // turns the throttling off; bringing the page forward as well means this
      // does not rest on a flag alone.
      await page.bringToFront().catch(() => undefined);
      await page.evaluate(
        ([handle]) => {
          (
            window as unknown as { __floeRec: { setMode(m: string): void } }
          ).__floeRec.setMode("raf");
          (
            window as unknown as Record<
              string,
              { setAutoStep(on: boolean): void }
            >
          )[handle].setAutoStep(true);
        },
        [HANDLE] as const,
      );
      await page.waitForTimeout(ms);
      await page.evaluate(
        ([handle]) => {
          (
            window as unknown as Record<
              string,
              { setAutoStep(on: boolean): void }
            >
          )[handle].setAutoStep(false);
          (
            window as unknown as { __floeRec: { setMode(m: string): void } }
          ).__floeRec.setMode("manual");
        },
        [HANDLE] as const,
      );
    },

    hold: (code) => page.keyboard.down(code),
    release: (code) => page.keyboard.up(code),
    async tap(code) {
      // Down, ONE tick, up. The tick between the two is what makes this a press
      // a build can actually see: an engineless build wrote its own keyboard
      // layer, and the two conformant ways to read a press — latching the edge in
      // the event handler, or comparing held state at the top of each tick —
      // agree only if the key is genuinely held while a tick runs. A down and an
      // up delivered back to back would be invisible to the second, which is a
      // build a real player has no trouble with. Exactly one tick passes either
      // way, so nothing a caller counts moves.
      await page.keyboard.down(code);
      await this.advance(1);
      await page.keyboard.up(code);
    },
    async holdFor(codes, ticks) {
      const keys = typeof codes === "string" ? [codes] : [...codes];
      for (const code of keys) await page.keyboard.down(code);
      try {
        if (ticks > 0) await this.advance(ticks);
      } finally {
        for (const code of keys) await page.keyboard.up(code);
      }
    },

    async frameCalls(ticks = 1) {
      await this.step(ticks);
      const ops = (await page.evaluate(() =>
        (
          window as unknown as { __floeRec: { last(): unknown[] } }
        ).__floeRec.last(),
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
    async pixel(x, y) {
      await settle();
      return (await readPixels([toDevice(view, x, y)]))[0];
    },
    async pixels(points) {
      await settle();
      return readPixels(points.map((p) => toDevice(view, p.x, p.y)));
    },
    async devicePixel(x, y) {
      await settle();
      return (await readPixels([{ x, y }]))[0];
    },

    surface: () =>
      page.evaluate(() => {
        const canvases = Array.from(document.querySelectorAll("canvas"));
        if (canvases.length === 0) {
          throw new Error(
            "floe: the page has no <canvas>, so the build drew nowhere — " +
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
          window as unknown as { __floeAudio: { started(): number } }
        ).__floeAudio.started(),
      ),

    async dispose() {
      // The context stays: it holds the init scripts and the window shape, and the
      // next harness of this shape wants both. The page goes, so nothing this
      // check pressed, opened or muted can reach the next one.
      openPages.delete(page);
      await page.close().catch(() => undefined);
    },
  };

  harnessInternals.set(harness, {
    cues: cueSinks,
    setCapturing: (on: boolean) => {
      capturing = on;
    },
  });
  return harness;
}

/** What {@link watchCues} and {@link captureReplay} reach on a harness. */
interface Internals {
  cues: TimedCue[][];
  setCapturing(on: boolean): void;
}

const harnessInternals = new WeakMap<Harness, Internals>();

/**
 * Whether this build draws inside `advance(ticks)`.
 *
 * `specs/instrumentation.md` specifies `advance` as a move of the SIMULATION —
 * "runs `ticks` whole simulation ticks immediately and in order" — and leaves
 * drawing to the loop, which it says keeps presenting whatever the clock is
 * doing. Both readings produce a playable, conformant build, and this project
 * has to read the render of either: one where the frame boundary belongs around
 * `advance`, and one where it belongs around the build's own animation frame.
 *
 * So the question is asked once, of the page, rather than assumed: one tick is
 * run inside a bracketed frame and the answer is whether the build issued any
 * operation against its 2D context while it ran. The tick it spends is given
 * back by the `reset()` that follows.
 */
async function drawsOnAdvance(page: Page): Promise<boolean> {
  return page
    .evaluate(
      ([handle]) => {
        const api = (
          window as unknown as Record<
            string,
            Record<string, (...a: unknown[]) => unknown>
          >
        )[handle];
        const rec = (
          window as unknown as {
            __floeRec: Record<string, (...a: unknown[]) => unknown>;
          }
        ).__floeRec;
        rec.begin();
        api.advance(1);
        rec.end(0);
        return (rec.last() as unknown[]).length > 0;
      },
      [HANDLE] as const,
    )
    .catch(() => false);
}

/* ---- The fit -------------------------------------------------------------- */

/**
 * How the stage maps onto a surface of this shape, as `specs/overview.md` fixes
 * it: one uniform scale, the whole stage inside, centred, with the leftover
 * split evenly into two letterbox bars.
 *
 * Computed rather than read from the build, deliberately. Under an engine the
 * fit is the engine's and a check can ask it what it derived; here the fit is
 * the build's own work, so asking it would be asking a build to grade itself.
 * Every check but `strait/stage-fit` runs at the stage's own size, where this is
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
//    Floe gives that its sharpest form: the bonus catch arrives on an eight
//    second cadence and a bear emerges after a delay, and a section that sat
//    through either would fill the capture budget with the wait. So arm around
//    the part that moves — `captureReplay(h, "carry", () =>
//    h.advance(ticksFor(2)))` — and put the wait outside it, or off camera
//    entirely with {@link Harness.skip}, which closes no frame at all.
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
 * `validation/water/floe-carries.test.ts` — because that is the path the
 * review item's declared script resolves to, and so the only name the case's
 * manifest and the runner both already agree on. Stating the prefix here is what
 * keeps that address the same however the project was staged, and it is why this
 * suite is run against a reference implementation from a staged copy rather than
 * in place.
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
 * The specification fixes no palette (`specs/overview.md`): the build paints its
 * own strait each frame, and the recorded frames carry that paint. What the
 * player needs is a colour for the canvas under them, and the page the build is
 * served on is painted `#000` by the case's own `index.html`, so that is what a
 * replay says.
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
    console.warn(`floe: could not write ${destination}: ${String(error)}`);
  }
}

/**
 * Record the frames `scenario` drives and keep them as the review item's
 * `outputId` output, handing back whatever the scenario returned.
 *
 * Wrap the drive, not the arrangement:
 *
 * ```ts
 * const carried = await captureReplay(h, "carry", () =>
 *   h.advance(ticksFor(2)),
 * );
 * ```
 *
 * While it is running, {@link Harness.advance} divides its interval into recorded
 * frames rather than driving it in one call, so a capture keeps the motion the
 * check drove. {@link Harness.skip} still closes no frame, so the wait before a
 * section stays out of the evidence.
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

  const internals = harnessInternals.get(h);
  await h.page.evaluate(
    (design) =>
      (
        window as unknown as { __floeRec: { arm(d: unknown): boolean } }
      ).__floeRec.arm(design),
    { width: STAGE_W, height: STAGE_H, background: REPLAY_BACKGROUND },
  );
  internals?.setCapturing(true);
  try {
    return await scenario();
  } finally {
    // In a `finally`, so a scenario that failed still leaves its evidence behind.
    internals?.setCapturing(false);
    const recording = (await h.page.evaluate(() =>
      (
        window as unknown as { __floeRec: { disarm(): unknown } }
      ).__floeRec.disarm(),
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
 * a build drew its five bands, where the letterbox bars fell.
 *
 * What is written is whatever the last frame that RAN left behind, so drive at
 * least one frame — {@link Harness.step}, or an {@link Harness.advance} — after
 * posing the thing under test and before the assertions, so a check that fails
 * still leaves the picture that shows why. Nothing here can
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
    await h.page.screenshot({
      path: destination,
      type: "png",
      timeout: browserBudget(),
    });
  } catch (error) {
    console.warn(`floe: could not write ${destination}: ${String(error)}`);
  }
}

/* -------------------------------------------------------------------------- */
/* Cues                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Record every sound the build emits from now on, stamped with the tick of the
 * drive it sounded on.
 *
 * WHAT IS OBSERVED, AND WHY IT IS THE FAIR READING. `specs/ui.md` requires one
 * cue per event, played on the tick its event happens, and says nothing at all
 * about how a build makes a sound beyond asking it to synthesize with the Web
 * Audio API — under this engine the whole audio layer is the build's. So
 * `audio-init.js` watches the two doors a browser can emit sound through (a Web
 * Audio source being `start()`ed, whatever kind it is, and an `<audio>` element
 * being played) and counts what goes through them; the harness brackets each
 * driven call around that count, so a sound is attributed to the ticks that
 * produced it. A hop blip made of a tone and a noise burst counts as two, which
 * is why a check asserts that a call sounded rather than how many times: the
 * number of sources is the build's business and the specification never fixed it.
 *
 * SO DRIVE ONE TICK AT A TIME WHERE THE TICK MATTERS. `advance(1)` attributes a
 * sound to exactly the tick that emitted it; `advance(120)` says only that
 * something sounded within that second. A check that grades "on the tick its
 * event happens" drives the tick, and a check that grades "a cue at all" does
 * not have to.
 *
 * WHAT IS LOST HERE THAT AN ENGINE GIVES. The cue's NAME. Under an engine the
 * game asks the bus for `CUES.hop` by name and the bus announces it, so a build
 * that plays its menu blip on every hop is caught. There is no bus here to ask,
 * so these checks confirm that a sound was emitted and when, and a reviewer
 * decides by ear whether the ten are told apart. That is a real reduction, and
 * the alternative — inferring the cue from the waveform the reference happens to
 * use — would grade builds against an implementation rather than against the
 * specification. NO CHECK IN THIS PROJECT MAY ASSERT A CUE NAME.
 *
 * A sound emitted inside {@link Harness.skip} is attributed to the tick the skip
 * ended on, since a skip is one call: run the ticks a cue check reads with
 * {@link Harness.advance}.
 */
export function watchCues(h: Harness): TimedCue[] {
  const played: TimedCue[] = [];
  harnessInternals.get(h)?.cues.push(played);
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
 * The stricter sibling of {@link drewText}, for copy a check needs as a word
 * rather than as a substring — a HUD readout's digits, or a key the how-to
 * screen must name. A screen reading "press the spacebar" contains `space` and
 * does not name the key the specification named.
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
 * A build is free to draw under a transform — to translate to a tile and draw at
 * the origin, or to flip a leftward vehicle with a negative x scale — so the
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
 * so what comes back is directly comparable with the figures `specs/strait.md`
 * fixes — which is how `strait/hud-above-strait` reads where a readout landed.
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
// `specs/assets.md` seeds seven folders under `assets/` and requires that the
// critter, the bear, the three vehicles and the two floes are each drawn FROM
// their folder rather than from art of the build's own. What that requires is
// identity — the bitmap handed to a draw IS a seeded frame — so the reading is
// the bitmap, not the pixels it left on the stage: a build is free to tint,
// scale or glow what it blits, and a stage sample would grade the tint rather
// than the art.
//
// A REGION RATHER THAN A FRAME, because two of the things drawn are sub-rects.
// `specs/assets.md` makes the three-tile raft the LEFT `96 x 32` of
// `assets/raft/0.png` and the four-tile raft the whole of `assets/raft/1.png`,
// so the seeded side carries both the whole frames and those two named regions,
// and a draw that cropped its source is compared against the region it cropped
// to. {@link SeededFrame.region} is what a check names when the distinction
// matters (`presentation/sprite-raft3` against `presentation/sprite-raft4`) and
// what it ignores when it does not.
//
// WHERE THE FRAMES COME FROM, AND WHY THERE IS NO `fetch` SHIM HERE. Under an
// engine, a validator runs the build's own module in this node process and the
// engine's loader reaches for `fetch` and `createImageBitmap`, so those two
// globals have to be stood up over the workspace's `assets/` tree. Under THIS
// engine nothing of the sort happens: the build loads its own art in the page,
// where both globals are the browser's real ones, and the only thing this
// process loads is the seeded PNGs it compares against — off disk, through
// `@napi-rs/canvas`, which the case seeds for exactly this. Shimming a global
// here would stand in for a call nothing makes.
//
// WHAT THE BUILD DREW comes back through the injected recorder rather than
// through `frameCalls`: `frameCalls` names a bitmap by its type alone, because
// it has to read the same whether or not a capture is running, and the recorder
// captures the bitmap's own pixels, which is what an identity comparison needs.
// {@link blitsOfFrame} arms it around a single frame and disarms it again, so
// nothing else in a suite is affected.

/** One seeded frame, or a named region of one, as the comparison reads it. */
export interface SeededFrame {
  /** The folder it came from. */
  sheet: SheetName;
  /** The frame index within that folder. */
  index: number;
  /**
   * Which part of the frame this is: `"full"` for the whole of it, or the name
   * `specs/assets.md` gives the sub-rect — `"raft3"` for the left `96 x 32` of
   * `assets/raft/0.png`, `"raft4"` for the whole of `assets/raft/1.png`.
   */
  region: string;
  width: number;
  height: number;
  /** Premultiplied RGBA channels, row-major. */
  pixels: Float64Array;
}

/** One region of one seeded frame the comparison holds. */
interface SeededRegion {
  sheet: SheetName;
  index: number;
  region: string;
  crop?: { x: number; y: number; width: number; height: number };
}

/**
 * Every region the comparison holds: each folder's frames whole, plus the two
 * the two long floes are cut from.
 *
 * The whole of `assets/raft/0.png` is kept as well as its left `96 x 32`, so a
 * build that drew the whole frame where the three-tile art belongs is reported
 * as having drawn `raft` frame `0` region `full` — a legible failure rather than
 * a draw that matched nothing.
 */
function seededRegions(): SeededRegion[] {
  const regions: SeededRegion[] = [];
  for (const [sheet, spec] of Object.entries(SPRITE_SHEETS)) {
    for (let index = 0; index < spec.frames; index += 1) {
      regions.push({ sheet: sheet as SheetName, index, region: "full" });
    }
  }
  regions.push({
    sheet: "raft",
    index: 0,
    region: "raft3",
    crop: { x: 0, y: 0, width: PLOW_W, height: SPRITE_TILE },
  });
  regions.push({ sheet: "raft", index: 1, region: "raft4" });
  return regions;
}

/**
 * How far a drawn source's pixels may sit from a seeded frame's, as a mean
 * absolute difference over premultiplied RGBA channels, out of `255`.
 *
 * NOT A LIKENESS TOLERANCE, and so not a threshold a check states: the
 * requirement is identity, and this is room for the one lossy step in reading a
 * bitmap back out of a canvas. A partially transparent pixel is premultiplied on
 * the way in and un-premultiplied on the way out, so it can shift by a unit;
 * comparing on premultiplied channels removes even that, and a DIFFERENT frame
 * of the same sheet measures several units here. A check asserts "drawn from a
 * frame of assets/crosser/", with no number of its own.
 */
const MATCH_MAX = 1;

/**
 * A drawable source's premultiplied RGBA channels, optionally cropped to a
 * sub-rect.
 *
 * Premultiplied, because that is what survives a round trip through a canvas
 * intact: drawing a bitmap in multiplies each channel by the pixel's alpha and
 * reading it back divides again, so a partially transparent pixel is quantized
 * twice. Comparing the products compares what both sides actually hold.
 *
 * The crop is what makes the comparison hold for a build that composed an atlas
 * of its own and blits out of it with the nine-argument `drawImage`: what is
 * compared is then the sub-rect the draw named rather than the sheet behind it.
 */
function channelsOf(
  source: { width: number; height: number },
  crop?: { x: number; y: number; width: number; height: number },
): Float64Array {
  const width = Math.max(1, Math.round(crop?.width ?? source.width));
  const height = Math.max(1, Math.round(crop?.height ?? source.height));
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, width, height);
  // The cast is the one this comparison needs: everything handed here is a
  // bitmap this canvas implementation can blit, and the two decoders it comes
  // from do not share a nominal type.
  if (crop === undefined) {
    ctx.drawImage(source as never, 0, 0);
  } else {
    ctx.drawImage(
      source as never,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      width,
      height,
    );
  }
  const { data } = ctx.getImageData(0, 0, width, height);
  const out = new Float64Array(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    out[i] = (data[i] * alpha) / 255;
    out[i + 1] = (data[i + 1] * alpha) / 255;
    out[i + 2] = (data[i + 2] * alpha) / 255;
    out[i + 3] = alpha;
  }
  return out;
}

/** The mean absolute difference between two channel buffers, out of 255. */
function difference(a: Float64Array, b: Float64Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

let seededFramesPromise: Promise<readonly SeededFrame[]> | null = null;

/**
 * Every seeded region `specs/assets.md` lists, read off the workspace's own
 * `assets/` tree.
 *
 * Decoded once per suite worker and shared, because every sprite point in the
 * project wants the same thirty-two frames and decoding them is the one slow
 * thing this module does.
 */
export function seededFrames(): Promise<readonly SeededFrame[]> {
  seededFramesPromise ??= (async () => {
    const decoded = new Map<string, Awaited<ReturnType<typeof loadImage>>>();
    const frames: SeededFrame[] = [];
    for (const entry of seededRegions()) {
      const spec = SPRITE_SHEETS[entry.sheet];
      const key = `${spec.folder}/${entry.index}`;
      let image = decoded.get(key);
      if (image === undefined) {
        image = await loadImage(
          join(WORKSPACE_ROOT, "assets", spec.folder, `${entry.index}.png`),
        );
        decoded.set(key, image);
      }
      frames.push({
        sheet: entry.sheet,
        index: entry.index,
        region: entry.region,
        width: entry.crop?.width ?? image.width,
        height: entry.crop?.height ?? image.height,
        pixels: channelsOf(image, entry.crop),
      });
    }
    return frames;
  })();
  return seededFramesPromise;
}

/** Every seeded frame a drawn source is pixel-for-pixel identical to. */
function seededMatches(
  frames: readonly SeededFrame[],
  drawn: Float64Array,
): SeededFrame[] {
  return frames.filter(
    (frame) =>
      frame.pixels.length === drawn.length &&
      difference(frame.pixels, drawn) <= MATCH_MAX,
  );
}

/** One `drawImage` a frame issued, as a sprite point reads it. */
export interface Blit {
  /** Where the destination box is centred, in logical stage units. */
  x: number;
  y: number;
  /** The destination box's size, in logical stage units, always positive. */
  width: number;
  height: number;
  /**
   * Whether the box is mirrored on each axis — a negative scale in the transform
   * in force, a negative destination width, or both.
   *
   * `specs/assets.md` requires exactly this of a vehicle in a lane whose `dir`
   * is `-1`: each vehicle's art faces right and is drawn mirrored horizontally,
   * so every vehicle faces the way its lane runs. Under a rotation these read
   * the sign of the mapped box's corners, which is the mirror only for the
   * upright draws the specification asks for.
   */
  flipX: boolean;
  flipY: boolean;
  /** The source bitmap's own size, before any destination scaling. */
  source: { width: number; height: number };
  /**
   * The transform in force at the call, as `[a, b, c, d, e, f]`.
   *
   * {@link flipX} and {@link flipY} read the mapped box's corners, which a
   * reflection reverses and a turn between the quarters does not. The angle is
   * in the matrix itself: an axis-aligned draw carries zero in `b` and `c`
   * whatever scale it was drawn at, and a rotation puts the sine of its angle
   * there.
   */
  transform: Matrix;
  /** The seeded frames this draw's source is identical to; empty when it is none. */
  matches: SeededFrame[];
}

/**
 * Run one frame and hand back every `drawImage` it issued, each matched against
 * the seeded art.
 *
 * The recorder is armed for exactly this one frame and disarmed again, so a
 * capture a check is separately running is not disturbed — but do not call this
 * INSIDE a {@link captureReplay}, which owns the recorder for its section.
 */
export async function blitsOfFrame(h: Harness): Promise<Blit[]> {
  const seeded = await seededFrames();

  await h.page.evaluate(
    (design) =>
      (
        window as unknown as { __floeRec: { arm(d: unknown): boolean } }
      ).__floeRec.arm(design),
    { width: STAGE_W, height: STAGE_H, background: REPLAY_BACKGROUND },
  );
  await h.step(1);
  const recording = (await h.page.evaluate(() =>
    (
      window as unknown as { __floeRec: { disarm(): unknown } }
    ).__floeRec.disarm(),
  )) as Recording | null;

  const blits: Blit[] = [];
  if (recording === null || recording.frames.length === 0) return blits;
  const frame = recording.frames[recording.frames.length - 1];

  const start = matrixOf(recording.states[frame.state]?.transform);
  const stack = frame.stack.map((index) =>
    matrixOf(recording.states[index]?.transform),
  );
  const calls = frame.ops.map((index) => toDrawCall(recording.ops[index]));

  // The pixels of a source are decoded once per bitmap, however many draws name
  // it: a board of forty nodes is forty draws of the same five frames.
  const channels = new Map<string, Float64Array>();
  const pending: {
    imageIndex: number;
    crop?: { x: number; y: number; width: number; height: number };
    blit: Omit<Blit, "matches">;
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
    // A bitmap the recorder's budget degraded carries no pixels; it matches
    // nothing rather than matching everything.
    if (image.src === undefined) {
      blits.push({ ...entry.blit, matches: [] });
      continue;
    }
    const key = `${entry.imageIndex}|${
      entry.crop === undefined
        ? "*"
        : `${entry.crop.x},${entry.crop.y},${entry.crop.width},${entry.crop.height}`
    }`;
    let drawn = channels.get(key);
    if (drawn === undefined) {
      drawn = channelsOf(await loadImage(image.src), entry.crop);
      channels.set(key, drawn);
    }
    blits.push({ ...entry.blit, matches: seededMatches(seeded, drawn) });
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
 * Every blit whose source is a frame of `sheet` and whose destination centre is
 * within `within` logical units of `at`.
 *
 * `within` is the caller's, because how close a sprite has to sit to the body it
 * draws is the check's requirement rather than this helper's —
 * `specs/assets.md` says a 32 x 32 frame is drawn centred on its subject's own
 * centre, and the check states how much of a tile it will allow.
 */
export function drawnFrom(
  blits: readonly Blit[],
  sheet: SheetName,
  at: { x: number; y: number },
  within: number,
): Blit[] {
  return blits.filter(
    (blit) =>
      Math.hypot(blit.x - at.x, blit.y - at.y) <= within &&
      blit.matches.some((frame) => frame.sheet === sheet),
  );
}

/** The frame indices of `sheet` that `blits` drew, in the order they were drawn. */
export function frameIndexes(
  blits: readonly Blit[],
  sheet: SheetName,
): number[] {
  return blits.flatMap((blit) =>
    blit.matches
      .filter((frame) => frame.sheet === sheet)
      .map((frame) => frame.index),
  );
}

/**
 * Every blit whose source is exactly the named REGION of `sheet` and whose
 * destination centre is within `within` logical units of `at`.
 *
 * The narrower sibling of {@link drawnFrom}, for the two draws
 * `specs/assets.md` cuts out of one frame: `"raft3"` is the left `96 x 32` of
 * `assets/raft/0.png` and `"raft4"` the whole of `assets/raft/1.png`.
 */
export function drawnRegion(
  blits: readonly Blit[],
  sheet: SheetName,
  region: string,
  at: { x: number; y: number },
  within: number,
): Blit[] {
  return blits.filter(
    (blit) =>
      Math.hypot(blit.x - at.x, blit.y - at.y) <= within &&
      blit.matches.some(
        (frame) => frame.sheet === sheet && frame.region === region,
      ),
  );
}

/** Every blit drawn from any frame of `sheet`, in the order they were drawn. */
export function blitsOf(blits: readonly Blit[], sheet: SheetName): Blit[] {
  return blits.filter((blit) =>
    blit.matches.some((frame) => frame.sheet === sheet),
  );
}

/**
 * Where a lane item's art is drawn: the centre of the box spanning its tiles.
 *
 * `specs/assets.md` draws a lane item's frame from its own `x` with its top on
 * its row's top edge, `TILE` units wide per tile it spans, so the box's centre
 * is half its span to the right of its left edge. What {@link drawnFrom} is
 * given for a vehicle or a floe.
 */
export function itemArtCentre(item: { x: number; row: number; len: number }): {
  x: number;
  y: number;
} {
  return {
    x: item.x + (TILE * item.len) / 2,
    y: tileTop(item.row) + TILE / 2,
  };
}

/* -------------------------------------------------------------------------- */
/* Colour                                                                     */
/* -------------------------------------------------------------------------- */
//
// `specs/overview.md` fixes NO PALETTE — the colours, the type and the look are
// the build's — and states instead what a player must read at a glance: the five
// bands told apart, deep water apart from a floe on the same row, an open bay
// apart from the shore beside it, the critter apart from every band it can stand
// on, a bear apart from every band it can travel on, and the three vehicles
// apart from one another. So every colour check is a comparison between two
// things the build drew, never against a hex value, and the DISTANCE it demands
// is the check's own figure, stated in the check. Nothing here fixes one.

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

/** A colour's luminance: the reading a ramp brightens along. */
export function luminance(c: Rgb): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/**
 * The five offsets a colour sample is averaged over, in logical units.
 *
 * The centre plus four neighbours six units out, all well inside a 32-unit tile
 * and inside the body of a 32-unit sprite, so one stray anti-aliased or glow
 * pixel cannot swing the reading.
 */
const SAMPLE_OFFSETS: readonly (readonly [number, number])[] = [
  [0, 0],
  [6, 0],
  [-6, 0],
  [0, 6],
  [0, -6],
];

/** The rendered colour at a logical point, averaged over that small cluster. */
export async function sampleColor(
  h: Harness,
  x: number,
  y: number,
): Promise<Rgb> {
  const read = await h.pixels(
    SAMPLE_OFFSETS.map(([dx, dy]) => ({ x: x + dx, y: y + dy })),
  );
  let r = 0;
  let g = 0;
  let b = 0;
  for (const [pr, pg, pb] of read) {
    r += pr;
    g += pg;
    b += pb;
  }
  return { r: r / read.length, g: g / read.length, b: b / read.length };
}

/** {@link sampleColor} at a tile's centre. */
export function sampleTile(h: Harness, col: number, row: number): Promise<Rgb> {
  return sampleColor(h, tileCX(col), tileCY(row));
}

/**
 * The colour of a row, read across five columns spread along it and averaged.
 *
 * What a band check reads. A single tile is a poor reading of a band a build is
 * free to texture, drift or shade, and the specification requires the BAND to be
 * told apart rather than any one tile of it; the columns are spread so no one
 * readout, banner or item a scenario put on the row dominates the average.
 */
export const BAND_COLUMNS: readonly number[] = [4, 12, 20, 28, 36];

/** {@link sampleColor} averaged across {@link BAND_COLUMNS} of one row. */
export async function sampleRow(h: Harness, row: number): Promise<Rgb> {
  let r = 0;
  let g = 0;
  let b = 0;
  for (const col of BAND_COLUMNS) {
    const sample = await sampleTile(h, col, row);
    r += sample.r;
    g += sample.g;
    b += sample.b;
  }
  const count = BAND_COLUMNS.length;
  return { r: r / count, g: g / count, b: b / count };
}

/* -------------------------------------------------------------------------- */
/* Reading a snapshot                                                         */
/* -------------------------------------------------------------------------- */
//
// Plain readings over the shape `specs/instrumentation.md` fixes. They compute
// nothing a check could not compute itself; they exist so that thirteen groups
// of suites spell the same lookup the same way, and so that a lookup that finds
// nothing fails with the entity it wanted named rather than as a `TypeError` two
// lines later.

/** The bear with that id, or `undefined`. */
export function bearById(
  snapshot: FloeSnapshot,
  id: number,
): BearView | undefined {
  return snapshot.bears.find((bear) => bear.id === id);
}

/** The bear with that id, failing the check with the scenario it needed. */
export function requireBear(
  snapshot: FloeSnapshot,
  id: number,
  doing = "the scenario",
): BearView {
  const bear = bearById(snapshot, id);
  if (bear === undefined) {
    fail(
      `bear ${id} still on the strait (${doing})`,
      `bears ${JSON.stringify(snapshot.bears.map((b) => b.id))}`,
    );
  }
  return bear;
}

/** The vehicle with that id, or `undefined`. */
export function vehicleById(
  snapshot: FloeSnapshot,
  id: number,
): ItemView | undefined {
  return snapshot.vehicles.find((item) => item.id === id);
}

/** The floe with that id, or `undefined`. */
export function floeById(
  snapshot: FloeSnapshot,
  id: number,
): ItemView | undefined {
  return snapshot.floes.find((item) => item.id === id);
}

/** The lane item with that id, from either roster, or `undefined`. */
export function itemById(
  snapshot: FloeSnapshot,
  id: number,
): ItemView | undefined {
  return vehicleById(snapshot, id) ?? floeById(snapshot, id);
}

/** The lane item with that id, failing the check with the scenario it needed. */
export function requireItem(
  snapshot: FloeSnapshot,
  id: number,
  doing = "the scenario",
): ItemView {
  const item = itemById(snapshot, id);
  if (item === undefined) {
    fail(
      `lane item ${id} still on the strait (${doing})`,
      `vehicles ${JSON.stringify(
        snapshot.vehicles.map((v) => v.id),
      )}, floes ${JSON.stringify(snapshot.floes.map((f) => f.id))}`,
    );
  }
  return item;
}

/**
 * The last entry of a roster: the entity an `add` operation just appended.
 *
 * `specs/instrumentation.md` makes appending the rule precisely so an id is
 * findable without an assignment scheme, and these three are that rule.
 */
export function lastBear(snapshot: FloeSnapshot): BearView | undefined {
  return snapshot.bears[snapshot.bears.length - 1];
}

export function lastVehicle(snapshot: FloeSnapshot): ItemView | undefined {
  return snapshot.vehicles[snapshot.vehicles.length - 1];
}

export function lastFloe(snapshot: FloeSnapshot): ItemView | undefined {
  return snapshot.floes[snapshot.floes.length - 1];
}

/** The lane on a strait row, from whichever band carries it, or `undefined`. */
export function laneAt(
  snapshot: FloeSnapshot,
  row: number,
): LaneView | undefined {
  return (
    snapshot.iceLanes.find((lane) => lane.row === row) ??
    snapshot.waterLanes.find((lane) => lane.row === row)
  );
}

/** Every lane item on a strait row, from whichever band carries it. */
export function itemsOnRow(snapshot: FloeSnapshot, row: number): ItemView[] {
  return [...snapshot.vehicles, ...snapshot.floes].filter(
    (item) => item.row === row,
  );
}

/**
 * Whether a lane item covers a point on its row (`specs/ice.md`).
 *
 * One rule, read by both bands: an item's reported `x` is its LEFT EDGE and it
 * occupies `[x, x + TILE * len)`.
 */
export function covers(item: ItemView, x: number): boolean {
  return x >= item.x && x < item.x + TILE * item.len;
}

/** Whether a lane item covers a tile of its row: that tile's centre is covered. */
export function coversTile(item: ItemView, col: number): boolean {
  return covers(item, tileCX(col));
}

/** The tile a stage centre falls in (`specs/strait.md`). */
export function tileOf(x: number, y: number): Tile {
  return { col: colAt(x), row: rowAt(y) };
}

/** Whether two tiles are the same tile. */
export function sameTile(a: Tile, b: Tile): boolean {
  return a.col === b.col && a.row === b.row;
}

/** The tile a bear last settled on. */
export function bearTile(bear: BearView): Tile {
  return { col: bear.col, row: bear.row };
}

/** The tile a bear is travelling into; its own tile while it is settled. */
export function bearStepTile(bear: BearView): Tile {
  return { col: bear.stepCol, row: bear.stepRow };
}

/** Whether a bear is settled on a tile rather than between two. */
export function bearSettled(bear: BearView): boolean {
  return bear.col === bear.stepCol && bear.row === bear.stepRow;
}

/** The critter's tile, as the snapshot reports it. */
export function critterTile(snapshot: FloeSnapshot): Tile {
  return { col: snapshot.critter.col, row: snapshot.critter.row };
}

/* -------------------------------------------------------------------------- */
/* Scenario helpers                                                           */
/* -------------------------------------------------------------------------- */
//
// EVERY COMPOUND SEQUENCE IN THIS PROJECT LIVES HERE. The debug surface is
// atomic — `specs/instrumentation.md` gives it one operation per field — so
// there is no `startCrossing`, no `spawnBear(col, row, options)` and no
// `setLane({...})` to reach for on the surface, and there must not be: a patch
// operation would impose the case's own layout on the build. What a check wants
// instead is a helper, built out of those atomic operations, that poses the
// strait and then lets the build's own update run from there.
//
// A CHECK TAKES ONLY THE PART IT ASKS FOR. Nothing below does anything a caller
// did not ask for: `startCrossing` empties four rosters, shuts four gates and
// poses a screen, and a check that wants a bear asks for one. A check that needs
// half a sequence calls the operations it needs.
//
// AND NONE OF THEM ASSERTS A VERDICT. A helper fails only when the game is not
// even in the situation the caller's scenario needs, and then with what it
// needed named.

/**
 * Pose an empty, quiet, live crossing at `level`, ready for a scenario.
 *
 * The sequence, and why each part of it is in this order:
 *
 *   - `reset()`, then `setLevel(level)`. THE ORDER IS LOAD-BEARING: `setLevel`
 *     re-lays the sixteen lanes by design (`specs/instrumentation.md`), so a
 *     `setLevel` after the clears would put sixteen lanes of traffic straight
 *     back onto the strait the clears had just emptied. The level is therefore
 *     an argument here rather than a call a check makes afterwards, so the
 *     ordering cannot be got wrong item by item. An item that DOES change level
 *     after posing re-clears both rosters itself, unless the level's own layout
 *     is the thing it reads.
 *   - THE FOUR ROSTERS ARE EMPTIED. `clearVehicles`, `clearFloes`, `clearBears`,
 *     `clearBays`, and `clearFish` with them. An empty strait is safe because of
 *     the level-clear rule (`specs/bays.md`): a level clears on the HOP that
 *     fills its last open bay, so a strait whose bays were posed rather than
 *     hopped into is being played rather than cleared.
 *     `bays/posed-full-does-not-clear` is the item that grades that, and it is
 *     what makes every scenario below poseable.
 *   - THE FOUR WORLD GATES ARE SHUT. Without `setBearEmergence(false)` a bear
 *     emerges behind a critter three rows up and joins a scenario that never
 *     asked for one; without `setCatchTest(false)` a posed bear standing on the
 *     critter costs a life mid-scenario; without `setFishCadence(false)` a bonus
 *     catch arrives on its own eight-second cadence into a bay a check is
 *     reading; without `setTimerRunning(false)` the crossing timer drains under
 *     a scenario that runs for thirty seconds and takes a life at the end of it.
 *     Each gate is the RUN's own faculty rather than any entity's, which is why
 *     shutting it is not "parking an entity in a harmless corner". THE ITEMS
 *     THAT TURN A GATE BACK ON ARE THE ITEMS WHOSE REQUIREMENT THE GATE IS; any
 *     other check that finds itself wanting one has been mis-posed.
 *   - THE SCREEN IS LIVE. `playing`/`crossing` with the phase timer at rest, so
 *     the strait really is running rather than sitting behind a hold.
 *   - THE RUN IS FRESH. `START_LIVES` lives, no score, and the timer at
 *     `crossingTimer(level)`, which `setLevel` does not touch.
 *   - THE CRITTER IS ON THE NEAR SHORE at `START_COL`, facing `up`, with no hop
 *     cooldown and `bestRow` at `ROW_NEAR`, which is where a fresh crossing puts
 *     it (`specs/progression.md`) and the one body no scenario can remove.
 *
 * It poses no bear, no vehicle, no floe and no bonus catch: a check adds exactly
 * what its requirement concerns.
 */
export async function startCrossing(h: Harness, level = 1): Promise<void> {
  // Eighteen operations of the build's own surface, in this order, in one
  // crossing: nothing here reads the game between them. See
  // {@link Harness.poseAll}.
  await h.poseAll([
    { op: "reset", args: [] },
    { op: "setLevel", args: [level] },
    { op: "clearVehicles", args: [] },
    { op: "clearFloes", args: [] },
    { op: "clearBears", args: [] },
    { op: "clearBays", args: [] },
    { op: "clearFish", args: [] },
    { op: "setBearEmergence", args: [false] },
    { op: "setCatchTest", args: [false] },
    { op: "setFishCadence", args: [false] },
    { op: "setTimerRunning", args: [false] },
    { op: "setScreen", args: ["playing"] },
    { op: "setPhase", args: ["crossing"] },
    { op: "setPhaseTimer", args: [0] },
    { op: "setLives", args: [START_LIVES] },
    { op: "setScore", args: [0] },
    { op: "setTimer", args: [crossingTimer(level)] },
    { op: "addCritter", args: [START_COL, ROW_NEAR] },
  ]);
}

/**
 * Open a run the way a player does: from a reset title, confirm the highlighted
 * first item, `CROSS`.
 *
 * The route for a check about what a NEW RUN is — its lives, its level, its
 * score, its five open bays, its laid-out strait — none of which any pose can
 * produce, because `setLevel` starts no run and `setScore` grants nothing.
 * Nothing here is posed: `reset` is the surface's own, and the rest is a real
 * key through Chromium's input pipeline.
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

/**
 * Lay a run of lane items along one row, held still, and hand back their ids in
 * the order they were given.
 *
 * The lane is stopped FIRST (`setLaneSpeed(row, 0)`), so the items land where
 * the caller put them and stay there until the check starts the lane itself. A
 * check about motion sets the speed it means to measure; a check about covering,
 * footing or refusal wants the row exactly as it posed it.
 *
 * Each column is a LEFT EDGE at `tileLeft(col)`, which is what the surface
 * takes, and the roster follows from the row's band: rows `ICE_TOP`–`ICE_BOTTOM`
 * carry vehicles and rows `WATER_TOP`–`WATER_BOTTOM` carry floes. A row that
 * carries no lane at all — the shores and the median — is the caller's mistake
 * and is named as one.
 */
export async function poseLane(
  h: Harness,
  row: number,
  kind: VehicleKind | FloeKind,
  cols: readonly number[],
): Promise<number[]> {
  const ice = ICE_ROWS.includes(row);
  const water = WATER_ROWS.includes(row);
  if (!ice && !water) {
    fail(
      `a lane row: ${ICE_ROWS[0]}-${ICE_ROWS[ICE_ROWS.length - 1]} carry ` +
        `vehicles and ${WATER_ROWS[0]}-${WATER_ROWS[WATER_ROWS.length - 1]} ` +
        `carry floes (specs/strait.md)`,
      `row ${row}`,
    );
  }
  if (ice && !(kind in ITEM_LEN && ["plow", "dogsled", "car"].includes(kind))) {
    fail(`a vehicle kind on ice row ${row} (specs/ice.md)`, kind);
  }
  if (water && !["pan", "raft3", "raft4"].includes(kind)) {
    fail(`a floe kind on water row ${row} (specs/water.md)`, kind);
  }

  // The roster is read BEFORE the lane is touched, which is the same count:
  // `setLaneSpeed` moves nothing on and nothing off. That leaves the stop and the
  // adds a single run of poses with no reading between them.
  const posed = await h.snapshot();
  const before = ice ? posed.vehicles.length : posed.floes.length;
  await h.poseAll([
    { op: "setLaneSpeed", args: [row, 0] },
    ...cols.map((col) =>
      ice
        ? { op: "addVehicle", args: [row, kind as VehicleKind, tileLeft(col)] }
        : { op: "addFloe", args: [row, kind as FloeKind, tileLeft(col)] },
    ),
  ]);

  const laid = await h.snapshot();
  const roster = ice ? laid.vehicles : laid.floes;
  if (roster.length !== before + cols.length) {
    fail(
      `${ice ? "addVehicle" : "addFloe"} to append each item to its roster ` +
        `(specs/instrumentation.md)`,
      `the roster went from ${before} to ${roster.length} over ${cols.length} calls`,
    );
  }
  return roster.slice(before).map((item) => item.id);
}

/** Which of a bear's three faculties a scenario holds off, and what it hunts. */
export interface BearPose {
  /** Its reading of the critter's tile. Off, it keeps hunting the posed target. */
  sense?: boolean;
  /** Its choice of the next step. Off, it takes no new step on settling. */
  routing?: boolean;
  /** Its locomotion. Off, its centre and its two tiles hold. */
  travel?: boolean;
  /** The tile it hunts, for a scenario that poses one rather than the critter's. */
  target?: Tile;
}

/**
 * Settle one bear on a tile with the faculties a scenario asks for, and hand
 * back its id.
 *
 * `addBear` gives a bear all three faculties on, hunting its own tile
 * (`specs/instrumentation.md`), so the pose below only turns OFF what the
 * scenario named. That is the whole of the isolation these checks need: a check
 * on ROUTING poses `travel: false` and reads the step the bear chose without it
 * moving; a check on TRAVEL poses `routing: false` and a step of its own, so the
 * bear carries out exactly that step and no route can redirect it; a check on
 * SENSE poses `sense: false` and a target of its own, so the bear hunts a tile
 * the critter is not on.
 */
export async function poseBear(
  h: Harness,
  col: number,
  row: number,
  pose: BearPose = {},
): Promise<number> {
  await h.debug.addBear(col, row);
  const added = lastBear(await h.snapshot());
  if (added === undefined) {
    fail(
      "addBear to append a bear to the roster (specs/instrumentation.md)",
      "the bear roster was still empty after addBear",
    );
  }
  const id = added.id;
  // The id had to be read off the roster first, so the faculties this scenario
  // turns off go over in one crossing after it rather than one apiece.
  await h.poseAll([
    ...(pose.target === undefined
      ? []
      : [
          {
            op: "setBearTarget",
            args: [id, pose.target.col, pose.target.row],
          },
        ]),
    ...(pose.sense === undefined
      ? []
      : [{ op: "setBearSense", args: [id, pose.sense] }]),
    ...(pose.routing === undefined
      ? []
      : [{ op: "setBearRouting", args: [id, pose.routing] }]),
    ...(pose.travel === undefined
      ? []
      : [{ op: "setBearTravel", args: [id, pose.travel] }]),
  ]);
  return id;
}

/**
 * Take one hop the way a player does: hold the direction's key, run the tick
 * that delivers it, release, and run the cooldown out.
 *
 * A REAL PRESS rather than a pose, because a hop is what `specs/hopping.md` is
 * about: the tile it lands on, the facing it takes, the cooldown it sets, the
 * row it scores and the refusals that leave everything as it was are all
 * consequences of the game's own hop, and posing the critter onto a tile would
 * produce none of them.
 *
 * The cooldown is run out afterwards so a caller can hop again immediately.
 * `HOP_COOLDOWN` is `0.12` s, which is not a whole number of ticks, so what runs
 * is the first whole tick at or past it — `ticksPast` — and the critter is
 * therefore free to hop on the very next tick. A check that grades the CADENCE
 * itself drives the ticks by hand and does not use this.
 */
export async function hop(h: Harness, direction: Facing): Promise<void> {
  await h.hold(HOP_KEY[direction]);
  await h.advance(1);
  await h.release(HOP_KEY[direction]);
  await h.advance(ticksPast(HOP_COOLDOWN));
}

/**
 * Hop the critter to a tile by REAL HOPS: along its row first, then up or down
 * its column.
 *
 * For the items that must reach a tile the way a player reaches it — the ones
 * about `bestRow`, the row award, the bear's emergence conditions, or a bay
 * being entered — and for nothing else. A scenario that simply needs the critter
 * somewhere poses it with `addCritter` or `setCritterTile`, which costs no game
 * time at all.
 *
 * It stops early rather than looping forever when a hop is refused, so a check
 * that walked the critter into a wall gets a snapshot showing where it stuck
 * rather than a timeout. Columns first, so a route to the far shore does not
 * arrive under the solid cap before it has lined up with a bay.
 */
export async function crossTo(
  h: Harness,
  col: number,
  row: number,
): Promise<void> {
  const step = async (direction: Facing): Promise<boolean> => {
    const before = critterTile(await h.snapshot());
    await hop(h, direction);
    const after = critterTile(await h.snapshot());
    return !sameTile(before, after);
  };
  for (let guard = 0; guard < COLS + ROWS; guard += 1) {
    const at = critterTile(await h.snapshot());
    if (at.col === col && at.row === row) return;
    const moved =
      at.col !== col
        ? await step(at.col < col ? "right" : "left")
        : await step(at.row > row ? "up" : "down");
    if (!moved) return;
  }
}

/** Show or hide the read-only debug overlay, through its fixed Backquote binding. */
export async function toggleOverlay(h: Harness): Promise<void> {
  await h.tap(OVERLAY_KEY);
}
