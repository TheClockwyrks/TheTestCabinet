// Wireworm — the shared validator harness. CASE-PROVIDED.
//
// Every check in this suite is an ordinary vitest test that drives the built site
// IN A REAL BROWSER. There is nothing to import: an engineless run seeds no
// `src/` at all, so the build wrote its own frame loop, its own canvas fit, its
// own keyboard, its own audio, its own sprite loading, and its own
// `window.__wireworm` — and the only place any of that exists is a page that has
// loaded the bundle. So the project serves `dist/`, loads it in Chromium, and
// reaches the game the way anything reaches it: over the surface
// `specs/instrumentation.md` told the build to install.
//
// IT IS STILL A VITEST PROJECT, AND THAT IS DELIBERATE. The runner locates the
// build output before it chooses between the vitest and browser paths, so `dist/`
// is on disk by the time this project runs. Staying a vitest project is what lets
// the case name ONE script per review item and have it resolve under all three
// engines — `validation/worm/winds-horizontal.test.ts` is the same path whichever
// engine the run selected — and what keeps `format = 2` resolution passing.
//
// WHAT A CHECK READS. The game's own state (through `window.__wireworm`'s
// `snapshot`), the frames the harness itself drove, the operations the build
// issued against its 2D context, the bitmaps it handed those operations, the
// pixels they left on the canvas, and the sounds it emitted. Nothing here
// fabricates an outcome: the scenario helpers below only ARRANGE the board
// through the surface, and the real update the build wrote is what runs from
// there.
//
// THE HARNESS OWNS EVERY COMPOUND SEQUENCE. The debug surface is atomic by
// design — each operation sets one field, reads the state, or moves the clock
// (`guides/authoring/writing-debug-apis-and-validators.md`) — so "open a run at
// level 3 with the field cleared" is a helper here, built out of those atomic
// operations, and never an operation on the surface. A check that needs only
// part of a sequence calls the operations it needs: nothing a check does not ask
// for happens.
//
// AND THE HELPERS FIX GEOMETRY, NEVER THRESHOLDS. A helper poses a board, drives
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
// ABOUT the loop running itself (`progression/advances-in-real-time`) hands it
// back with {@link Harness.runFor}.
//
// EVERYTHING CROSSING INTO THE PAGE IS ASYNC. That is the whole of the difference
// between a suite here and its counterpart under an engine: `await h.snapshot()`
// rather than `h.snapshot()`, `await h.debug.setNode(...)` rather than
// `h.debug.setNode(...)`. The scenarios, the tolerances, and the assertions are
// the same ones, because they are the case's rather than the runtime's.
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
import type { Browser, BrowserContext, Page } from "playwright";
import { connectChromium } from "./chromium";
import { fail } from "./assert";
import {
  BAND_CX,
  BAND_CY,
  OVERLAY_KEY,
  SPRITE_SHEETS,
  STAGE_H,
  STAGE_W,
  UNBOUND_KEY,
  colAt,
  rowAt,
  tileCX,
  tileCY,
  wormStepInterval,
  type SheetName,
} from "./constants";

declare module "vitest" {
  export interface ProvidedContext {
    /** Where the built site is served, from `globalSetup.ts`. */
    wirewormUrl: string;
    /** The one Chromium every suite worker connects to. */
    wirewormBrowserWs: string;
  }
}

/* -------------------------------------------------------------------------- */
/* The contract the build owes                                                */
/* -------------------------------------------------------------------------- */

/** The handle an engineless build installs its surface on. */
export const HANDLE = "__wireworm";

/** The version the surface reports (`WIREWORM_DEBUG_VERSION`). */
export const WIREWORM_DEBUG_VERSION = 1;

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
  // The world gates.
  "setFoeSpawning",
  "setWormEntry",
  "setCursorContact",
  // The cursor and its bolts.
  "setCursor",
  "setCursorInvulnerable",
  "setFireCooldown",
  "addBolt",
  "removeBolt",
  "clearBolts",
  // The node field.
  "setNode",
  "clearNode",
  "clearNodes",
  // The worms.
  "addWorm",
  "appendSegment",
  "setWormHeading",
  "setWormDescent",
  "setWormDiving",
  "setWormStepping",
  "setWormBody",
  "removeWorm",
  "clearWorms",
  // The foes.
  "addFoe",
  "setFoeVelocity",
  "setFoeHit",
  "setFoeMind",
  "setFoeTravel",
  "removeFoe",
  "clearFoes",
] as const;

/** The six screens the game moves between (`specs/ui.md`). */
export type Screen =
  "title" | "howto" | "playing" | "paused" | "victory" | "gameover";

/** The three sub-phases of the `playing` screen (`specs/progression.md`). */
export type Phase = "banner" | "active" | "respawn";

/** The three support foes (`specs/foes.md`). */
export type FoeKind = "glitch" | "dropper" | "corruptor";

/** One tile of the board. */
export interface Tile {
  c: number;
  r: number;
}

/** One node, as a snapshot reports it. */
export interface NodeView {
  c: number;
  r: number;
  charge: number;
}

/** One worm, as a snapshot reports it. `segments[0]` is the head. */
export interface WormView {
  id: number;
  segments: Tile[];
  /** `+1` right, `-1` left. */
  dh: number;
  /** `+1` down, `-1` up. */
  dv: number;
  diving: boolean;
  stepping: boolean;
  body: boolean;
}

/** One foe, as a snapshot reports it. `x`/`y` is its CENTER. */
export interface FoeView {
  id: number;
  kind: FoeKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hit: boolean;
  mind: boolean;
  travel: boolean;
}

/** One bolt in flight, as a snapshot reports it. `x`/`y` is its CENTER. */
export interface BoltView {
  id: number;
  x: number;
  y: number;
}

/** One conducted link of a live discharge: the two tiles it joined. */
export interface ArcView {
  from: Tile;
  to: Tile;
}

/**
 * The state a snapshot reports, exactly as `specs/instrumentation.md` shapes it.
 *
 * Every field an operation can set is here, which is what makes every pose
 * verifiable by set-then-read. `muted` is the exception in the other direction:
 * no operation sets it, and it is a live read of the runtime's own mute bit,
 * reached the way a player reaches it through `KeyM`.
 */
export interface WirewormSnapshot {
  version: number;
  screen: Screen;
  phase: Phase;
  phaseTimer: number;
  menuIndex: number;
  score: number;
  lives: number;
  level: number;
  reachedLevel: number;
  muted: boolean;
  foeSpawning: boolean;
  wormEntry: boolean;
  wormStepInterval: number;
  wormLength: number;
  cursor: { x: number; y: number; invulnerable: number; contact: boolean };
  fireCooldown: number;
  nodes: NodeView[];
  worms: WormView[];
  foes: FoeView[];
  bolts: BoltView[];
  arcs: ArcView[];
  simTime: number;
}

/** The operations a check poses the game through. Every one crosses into the page. */
export interface WirewormDebugApi {
  setAutoStep(enabled: boolean): Promise<void>;
  advance(seconds: number, frames?: number): Promise<void>;
  reset(options?: { seed?: number }): Promise<void>;
  snapshot(): Promise<WirewormSnapshot>;

  setScreen(screen: Screen): Promise<void>;
  setPhase(phase: Phase): Promise<void>;
  setPhaseTimer(seconds: number): Promise<void>;
  setMenuIndex(index: number): Promise<void>;
  setScore(score: number): Promise<void>;
  setLives(lives: number): Promise<void>;
  setLevel(level: number): Promise<void>;
  setReachedLevel(level: number): Promise<void>;

  setFoeSpawning(enabled: boolean): Promise<void>;
  setWormEntry(enabled: boolean): Promise<void>;
  setCursorContact(enabled: boolean): Promise<void>;

  setCursor(x: number, y: number): Promise<void>;
  setCursorInvulnerable(seconds: number): Promise<void>;
  setFireCooldown(seconds: number): Promise<void>;
  addBolt(x: number, y: number): Promise<void>;
  removeBolt(id: number): Promise<void>;
  clearBolts(): Promise<void>;

  setNode(c: number, r: number, charge: number): Promise<void>;
  clearNode(c: number, r: number): Promise<void>;
  clearNodes(): Promise<void>;

  addWorm(c: number, r: number): Promise<void>;
  appendSegment(id: number, c: number, r: number): Promise<void>;
  setWormHeading(id: number, dh: number): Promise<void>;
  setWormDescent(id: number, dv: number): Promise<void>;
  setWormDiving(id: number, diving: boolean): Promise<void>;
  setWormStepping(id: number, enabled: boolean): Promise<void>;
  setWormBody(id: number, enabled: boolean): Promise<void>;
  removeWorm(id: number): Promise<void>;
  clearWorms(): Promise<void>;

  addFoe(kind: FoeKind, x: number, y: number): Promise<void>;
  setFoeVelocity(id: number, vx: number, vy: number): Promise<void>;
  setFoeHit(id: number, hit: boolean): Promise<void>;
  setFoeMind(id: number, enabled: boolean): Promise<void>;
  setFoeTravel(id: number, enabled: boolean): Promise<void>;
  removeFoe(id: number): Promise<void>;
  clearFoes(): Promise<void>;
}

/* -------------------------------------------------------------------------- */
/* The step schedule                                                          */
/* -------------------------------------------------------------------------- */
//
// The suite chooses the size of a frame, because the specification deliberately
// fixes none: `specs/instrumentation.md` mandates no fixed timestep, every rate
// is per second and integrated against the elapsed time of the frame, and the
// one clocked quantity — the worm's tile step — accumulates that same elapsed
// time and carries its remainder. So a build must reach the same place however
// that time was divided, and the check that is ABOUT the division
// (`instrumentation/deterministic-core`) drives the same second as one frame and
// as sixty.
//
// The default is a steady 100 Hz, for one reason: every duration `specs/` fixes
// is then a whole number of frames. `WORM_STEP_L1` 0.14 s is 14, `FIRE_INTERVAL`
// 0.15 s is 15, `GLITCH_DART_INTERVAL` and `ARC_LIFE` 0.32 s are 32,
// `BANNER_TIME` 1.3 s is 130, `RESPAWN_TIME` 1.4 s is 140, `RESPAWN_INVULN` 2 s
// is 200, and `DROPPER_CHECK_INTERVAL` 2.5 s is 250. A check therefore asks for
// a duration and gets it exactly, with no rounding of its own to explain.

/** A source of frame deltas, in milliseconds. */
export interface Clock {
  /** The next frame's delta, in ms. */
  delta(): number;
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
}

/** Seconds of simulated time in `frames` frames of the default clock. */
export function seconds(frames: number): number {
  return frames / TICK_HZ;
}

/** Frames of the default clock covering `duration` seconds. */
export function framesFor(duration: number): number {
  return Math.round(duration * TICK_HZ);
}

/**
 * Frames of the default clock that carry a worm at `level` through exactly
 * `steps` tile steps, and no further.
 *
 * The worm steps when its accumulator REACHES the level's interval
 * (`specs/worm.md`), so the number of steps a stretch of game time contains is
 * `floor(elapsed / interval)` — a quantity that is ambiguous by one at an exact
 * multiple of the interval, where a build's own accumulation of a hundred
 * floating-point deltas may land a whisker either side. This lands the drive
 * half an interval past the last step it wants, which is the furthest point from
 * both boundaries, so `steps` is what any conforming accumulator produces.
 *
 * This is geometry, not a tolerance: it says where in the step cycle the drive
 * stops, not how far a build may miss by. A check measuring the CADENCE itself
 * (`worm/step-cadence`) states its own tolerance on its own reading.
 */
export function framesForSteps(steps: number, level = 1): number {
  return Math.round((steps + 0.5) * wormStepInterval(level) * TICK_HZ);
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
  | { kind: "call"; method: string; args: unknown[] }
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

/** What a sweep found: whether the predicate ever held, and where it stopped. */
export interface UntilResult {
  hit: boolean;
  /** Frames advanced before the sample that ended the sweep. */
  frames: number;
  snapshot: WirewormSnapshot;
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
  snapshot: WirewormSnapshot;
}

export interface Harness {
  /** The page the build is running in. For a check that needs Playwright itself. */
  readonly page: Page;
  /**
   * The surface the BUILD installed, as operations that cross into the page.
   *
   * Read off `window.__wireworm` and never constructed here — see
   * {@link unexposedSurface}.
   */
  readonly debug: WirewormDebugApi;
  /**
   * Why the build's surface cannot be driven, or `null` when it can.
   *
   * A fault here is the build's: the surface is missing, or it is missing an
   * operation the specification requires. It says what was found
   * (`window.__wireworm was still absent 5s after the page loaded`), and
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
  snapshot(): Promise<WirewormSnapshot>;
  /** Run `frames` frames back to back, each the length the clock says. */
  advance(frames: number): Promise<void>;
  /** Advance until `predicate` holds, sampling every `poll` frames. */
  until(
    predicate: (snapshot: WirewormSnapshot) => boolean,
    options?: UntilOptions,
  ): Promise<UntilResult>;
  /**
   * Run `duration` seconds of game time WITHOUT opening a recorded frame.
   *
   * The same real update the loop runs, `hz` frames per second of it, but off
   * camera: no frame boundary is closed, so a capture running across it keeps
   * nothing, and a section that has to sit through half a minute of spawner
   * pacing costs a replay nothing. Use it for the wait; use {@link advance} for
   * the part a check is about.
   */
  skip(duration: number, hz?: number): Promise<void>;
  /** {@link skip} until `predicate` holds, sampling every `pollSeconds`. */
  skipUntil(
    predicate: (snapshot: WirewormSnapshot) => boolean,
    options?: SkipOptions,
  ): Promise<SkipResult>;
  /** Hand the game back to its own frame loop for `ms` of real time, then take it back. */
  runFor(ms: number): Promise<void>;

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
   * `specs/controls.md` reads `confirm`, `back`, `pause` and `mute` as press
   * edges, which is exactly what this delivers.
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

/** The init scripts injected before any of the build's own script runs. */
const INIT_SCRIPTS = ["recorder-init.js", "audio-init.js"] as const;

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
 * that returns the instant the global appears. Wireworm's surface is installed
 * after the seeded sprite art has decoded (`specs/assets.md`), so a build has a
 * genuine asynchronous step to finish before it can install — which is what this
 * ceiling is sized for. What it really bounds is the cost of a build with no
 * surface at all, which pays it once per harness.
 */
const SURFACE_TIMEOUT_MS = 10_000;

let browserPromise: Promise<Browser> | null = null;

async function sharedBrowser(): Promise<Browser> {
  browserPromise ??= connectChromium(inject("wirewormBrowserWs"));
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
 * one thing `board/stage-fit` varies. Everything else about a harness is the
 * page: a fresh one opens on a build that has just started, with no key held, no
 * audio context opened, and the mute preference back off, which is a stronger
 * guarantee than any reset the surface offers, since `reset()` deliberately
 * leaves muting alone.
 *
 * A page per harness rather than a page reused between them, because a check may
 * legitimately hold two harnesses at once — `instrumentation/deterministic-core`
 * runs the same second under two step sizes — and a harness whose page had been
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
function unexposedSurface(reason: string): WirewormDebugApi {
  return new Proxy({} as WirewormDebugApi, {
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
  try {
    await page.waitForFunction(
      (handle) =>
        typeof (window as never)[handle] === "object" &&
        (window as never)[handle] !== null,
      HANDLE,
      { timeout: SURFACE_TIMEOUT_MS },
    );
  } catch {
    return `window.${HANDLE} was still absent ${SURFACE_TIMEOUT_MS / 1000}s after the page loaded`;
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
 * `board/stage-fit` has to think about the fit at all.
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

  await page.goto(inject("wirewormUrl"), { waitUntil: "load" });

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
      : (new Proxy({} as WirewormDebugApi, {
          get: (_target, property): unknown => {
            if (typeof property === "symbol") return undefined;
            if (property === "then" || property === "constructor")
              return undefined;
            const name = String(property);
            return (...args: unknown[]) => call(name, args);
          },
        }) as WirewormDebugApi);

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
            window as unknown as { __wirewormRec: { ready(): boolean } }
          ).__wirewormRec.ready(),
        undefined,
        { timeout: SURFACE_TIMEOUT_MS },
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
  const drive = async (frames: number): Promise<WirewormSnapshot> => {
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
            __wirewormRec: Record<string, (...a: unknown[]) => unknown>;
          }
        ).__wirewormRec;
        const audio = (
          window as unknown as { __wirewormAudio: { started(): number } }
        ).__wirewormAudio;
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
    )) as { snapshot: WirewormSnapshot; sounds: number[] };

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
  ): Promise<WirewormSnapshot> => {
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
          window as unknown as { __wirewormAudio: { started(): number } }
        ).__wirewormAudio;
        const before = audio.started();
        api.advance(sec, count);
        return {
          snapshot: api.snapshot(),
          sounds: audio.started() - before,
        };
      },
      [HANDLE, duration, whole] as const,
    )) as { snapshot: WirewormSnapshot; sounds: number };

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
          throw new Error("wireworm: the page has no <canvas>");
        let canvas = canvases[0];
        for (const other of canvases) {
          if (other.width * other.height > canvas.width * canvas.height)
            canvas = other;
        }
        const ctx = canvas.getContext("2d");
        if (ctx === null)
          throw new Error("wireworm: the canvas has no 2D context");
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

  const harness: Harness = {
    page,
    debug,
    surfaceFault,
    pageErrors,

    frame: () => frameCount,
    timeMs: () => timeMs,

    snapshot: () => debug.snapshot(),

    advance: async (frames) => {
      await drive(frames);
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
            window as unknown as { __wirewormRec: { setMode(m: string): void } }
          ).__wirewormRec.setMode("raf");
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
            window as unknown as { __wirewormRec: { setMode(m: string): void } }
          ).__wirewormRec.setMode("manual");
        },
        [HANDLE] as const,
      );
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
          window as unknown as { __wirewormRec: { last(): unknown[] } }
        ).__wirewormRec.last(),
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
            "wireworm: the page has no <canvas>, so the build drew nowhere — " +
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
          window as unknown as { __wirewormAudio: { started(): number } }
        ).__wirewormAudio.started(),
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
 * Every check but `board/stage-fit` runs at the stage's own size, where this is
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
  | { op: "call"; method: string; args: unknown[] }
  | { op: "set"; property: string; value: unknown };

function toDrawCall(op: RecordedOp): DrawCall {
  return op.op === "call"
    ? { kind: "call", method: op.method, args: op.args }
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
//    Wireworm gives that its sharpest form: a discharge is a burst of arc
//    geometry, and a section that sat through half a minute of spawner pacing
//    before it would fill the capture budget with the wait. So arm around the
//    burst — `captureReplay(h, "id", () => h.advance(framesFor(ARC_LIFE)))` —
//    and put the wait outside it, or off camera entirely with
//    {@link Harness.skip}, which closes no frame at all.
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
 * `validation/worm/winds-horizontal.test.ts` — because that is the path the
 * review item's declared script resolves to, and so the only name the case's
 * manifest and the runner both already agree on. Stating the prefix here is what
 * keeps that address the same when this suite is run in place against a
 * reference implementation, where the project root is `validation/none/` instead.
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
 * The specification fixes no board colour: the build paints its own background
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
    console.warn(`wireworm: could not write ${destination}: ${String(error)}`);
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
 *   h.advance(framesFor(ARC_LIFE)),
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
        window as unknown as { __wirewormRec: { arm(d: unknown): boolean } }
      ).__wirewormRec.arm(design),
    { width: STAGE_W, height: STAGE_H, background: REPLAY_BACKGROUND },
  );
  try {
    return await scenario();
  } finally {
    // In a `finally`, so a scenario that failed still leaves its evidence behind.
    const recording = (await h.page.evaluate(() =>
      (
        window as unknown as { __wirewormRec: { disarm(): unknown } }
      ).__wirewormRec.disarm(),
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
 * a build drew its four charge states, where the letterbox bars fell.
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
    console.warn(`wireworm: could not write ${destination}: ${String(error)}`);
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
 * game asks the bus for `CUES.fire` by name and the bus announces it, so a build
 * that plays its menu blip on every shot is caught. There is no bus here to ask,
 * so these checks confirm that a sound was emitted and on which frame, and a
 * reviewer decides by ear whether the ten are told apart. That is a real
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
 * and `WASD`. A screen reading "press the spacebar" contains `space` and does
 * not name the key the specification named.
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
 * the origin, or to flip a leftward worm with a negative x scale — so the
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
 * so what comes back is directly comparable with the figures `specs/board.md`
 * fixes — which is how `board/hud-above-board` reads where a readout landed.
 */
export function textDraws(calls: readonly DrawCall[]): TextDraw[] {
  const draws: TextDraw[] = [];
  walkTransforms(calls, (call, m) => {
    if (call.kind !== "call") return;
    if (call.method !== "fillText" && call.method !== "strokeText") return;
    const [text] = call.args;
    const at = numbers(call.args.slice(1), 2);
    if (typeof text !== "string" || at === null) return;
    draws.push({ text, ...applyMatrix(m, at[0], at[1]) });
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
// `specs/assets.md` seeds six folders under `assets/` and requires that the node,
// the worm, the cursor and the three foes are each drawn FROM that folder rather
// than from art of the build's own. What that requires is identity — the bitmap
// handed to a draw IS a seeded frame — so the reading is the bitmap, not the
// pixels it left on the stage: a build is free to tint, scale or glow what it
// blits, and a stage sample would grade the tint rather than the art.
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

/** One seeded frame, as the comparison reads it. */
export interface SeededFrame {
  sheet: SheetName;
  index: number;
  width: number;
  height: number;
  /** Premultiplied RGBA channels, row-major. */
  pixels: Float64Array;
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
 * frame of assets/node/", with no number of its own.
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
 * Every seeded frame of every folder `specs/assets.md` lists, read off the
 * workspace's own `assets/` tree.
 *
 * Decoded once per suite worker and shared, because every sprite point in the
 * project wants the same twenty-one frames and decoding them is the one slow
 * thing this module does.
 */
export function seededFrames(): Promise<readonly SeededFrame[]> {
  seededFramesPromise ??= (async () => {
    const frames: SeededFrame[] = [];
    for (const [sheet, spec] of Object.entries(SPRITE_SHEETS)) {
      for (let index = 0; index < spec.frames; index += 1) {
        const image = await loadImage(
          join(WORKSPACE_ROOT, "assets", spec.folder, `${index}.png`),
        );
        frames.push({
          sheet: sheet as SheetName,
          index,
          width: image.width,
          height: image.height,
          pixels: channelsOf(image),
        });
      }
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
   * `specs/assets.md` requires exactly this of a leftward worm and a leftward
   * corruptor: the art faces right and is drawn mirrored horizontally. Under a
   * rotation these read the sign of the mapped box's corners, which is the
   * mirror only for the upright draws the specification asks for.
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
        window as unknown as { __wirewormRec: { arm(d: unknown): boolean } }
      ).__wirewormRec.arm(design),
    { width: STAGE_W, height: STAGE_H, background: REPLAY_BACKGROUND },
  );
  await h.advance(1);
  const recording = (await h.page.evaluate(() =>
    (
      window as unknown as { __wirewormRec: { disarm(): unknown } }
    ).__wirewormRec.disarm(),
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
 * `within` is the caller's, because how close a sprite has to sit to the entity
 * it draws is the check's requirement rather than this helper's — `specs/board.md`
 * says a node is drawn centred on its tile, and the check states how much of a
 * tile it will allow.
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

/* -------------------------------------------------------------------------- */
/* Colour                                                                     */
/* -------------------------------------------------------------------------- */
//
// `specs/overview.md` fixes NO PALETTE — the colours, the type and the glow are
// the build's — and states instead what a player must read at a glance: the four
// charge states told apart and reading as a ramp, the worm apart from the board
// and from a node, the cursor apart from its band, the three foes apart from one
// another. So every colour check is a comparison between two things the build
// drew, never against a hex value, and the DISTANCE it demands is the check's own
// figure, stated in the check. Nothing here fixes one.

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
export function sampleTile(h: Harness, c: number, r: number): Promise<Rgb> {
  return sampleColor(h, tileCX(c), tileCY(r));
}

/**
 * Tiles a board posed by {@link startPlaying} leaves bare: on the board, clear
 * of the HUD, clear of the player band, and spread across it so no one readout,
 * banner or overlay a build chose to place can cover them all.
 */
export const BARE_TILES: readonly Tile[] = [
  { c: 2, r: 2 },
  { c: 36, r: 3 },
  { c: 5, r: 14 },
  { c: 30, r: 11 },
  { c: 18, r: 16 },
];

/**
 * The bare board's colour: the darkest of {@link BARE_TILES}, sampled off the
 * canvas as it stands.
 *
 * The darkest of several rather than one fixed patch, because `specs/overview.md`
 * makes the board dark and everything on it brighter, but leaves a build free to
 * put a banner, a hint or a watermark anywhere it likes — and a patch something
 * is drawn over reads lighter than one nothing is.
 */
export async function sampleBoard(h: Harness): Promise<Rgb> {
  const samples: Rgb[] = [];
  for (const tile of BARE_TILES) {
    samples.push(await sampleTile(h, tile.c, tile.r));
  }
  return samples.reduce((darkest, sample) =>
    luminance(sample) < luminance(darkest) ? sample : darkest,
  );
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

/** The worm with that id, or `undefined`. */
export function wormById(
  snapshot: WirewormSnapshot,
  id: number,
): WormView | undefined {
  return snapshot.worms.find((worm) => worm.id === id);
}

/** The worm with that id, failing the check with the scenario it needed. */
export function requireWorm(
  snapshot: WirewormSnapshot,
  id: number,
  doing = "the scenario",
): WormView {
  const worm = wormById(snapshot, id);
  if (worm === undefined) {
    fail(
      `worm ${id} still on the board (${doing})`,
      `worms ${JSON.stringify(snapshot.worms.map((w) => w.id))}`,
    );
  }
  return worm;
}

/** The foe with that id, or `undefined`. */
export function foeById(
  snapshot: WirewormSnapshot,
  id: number,
): FoeView | undefined {
  return snapshot.foes.find((foe) => foe.id === id);
}

/** The foe with that id, failing the check with the scenario it needed. */
export function requireFoe(
  snapshot: WirewormSnapshot,
  id: number,
  doing = "the scenario",
): FoeView {
  const foe = foeById(snapshot, id);
  if (foe === undefined) {
    fail(
      `foe ${id} still on the board (${doing})`,
      `foes ${JSON.stringify(snapshot.foes.map((f) => f.id))}`,
    );
  }
  return foe;
}

/** The bolt with that id, or `undefined`. */
export function boltById(
  snapshot: WirewormSnapshot,
  id: number,
): BoltView | undefined {
  return snapshot.bolts.find((bolt) => bolt.id === id);
}

/** Every foe of one kind, in roster order. */
export function foesOfKind(
  snapshot: WirewormSnapshot,
  kind: FoeKind,
): FoeView[] {
  return snapshot.foes.filter((foe) => foe.kind === kind);
}

/**
 * The last entry of a roster: the entity an `add` operation just appended.
 *
 * `specs/instrumentation.md` makes appending the rule precisely so an id is
 * findable without an assignment scheme, and these three are that rule.
 */
export function lastWorm(snapshot: WirewormSnapshot): WormView | undefined {
  return snapshot.worms[snapshot.worms.length - 1];
}

export function lastFoe(snapshot: WirewormSnapshot): FoeView | undefined {
  return snapshot.foes[snapshot.foes.length - 1];
}

export function lastBolt(snapshot: WirewormSnapshot): BoltView | undefined {
  return snapshot.bolts[snapshot.bolts.length - 1];
}

/** A worm's head: the first segment, which leads. */
export function headOf(worm: WormView): Tile {
  return worm.segments[0];
}

/** A worm's tail: the last segment. */
export function tailOf(worm: WormView): Tile {
  return worm.segments[worm.segments.length - 1];
}

/** The node on a tile, or `undefined` when the tile is empty. */
export function nodeAt(
  snapshot: WirewormSnapshot,
  c: number,
  r: number,
): NodeView | undefined {
  return snapshot.nodes.find((node) => node.c === c && node.r === r);
}

/** The charge of the node on a tile, or `null` when the tile is empty. */
export function chargeAt(
  snapshot: WirewormSnapshot,
  c: number,
  r: number,
): number | null {
  return nodeAt(snapshot, c, r)?.charge ?? null;
}

/** How many nodes stand on rows `from` to `to`, both ends in. */
export function nodesInRows(
  snapshot: WirewormSnapshot,
  from: number,
  to: number,
): NodeView[] {
  return snapshot.nodes.filter((node) => node.r >= from && node.r <= to);
}

/** Every tile any worm has a segment on. */
export function segmentTiles(snapshot: WirewormSnapshot): Tile[] {
  return snapshot.worms.flatMap((worm) => worm.segments);
}

/** The tile a centre falls in (`specs/board.md`). */
export function tileOf(x: number, y: number): Tile {
  return { c: colAt(x), r: rowAt(y) };
}

/** Whether two tiles are the same tile. */
export function sameTile(a: Tile, b: Tile): boolean {
  return a.c === b.c && a.r === b.r;
}

/** The Chebyshev distance between two tiles, the way a discharge measures it. */
export function chebyshev(a: Tile, b: Tile): number {
  return Math.max(Math.abs(a.c - b.c), Math.abs(a.r - b.r));
}

/* -------------------------------------------------------------------------- */
/* Scenario helpers                                                           */
/* -------------------------------------------------------------------------- */
//
// EVERY COMPOUND SEQUENCE IN THIS PROJECT LIVES HERE. The debug surface is
// atomic — `specs/instrumentation.md` gives it one operation per field — so
// there is no `startRun`, no `spawnFoe(kind, options)` and no `setWorm({...})`
// to reach for, and there must not be: a patch operation would impose the case's
// own layout on the build. What a check wants instead is a helper, built out of
// those atomic operations, that poses the board and then lets the build's own
// update run from there.
//
// A CHECK TAKES ONLY THE PART IT ASKS FOR. Nothing below does anything a caller
// did not ask for: `startPlaying` clears four rosters, shuts three gates and
// poses a screen, and a check that wants a worm asks for one. A check that needs
// half a sequence calls the operations it needs.
//
// AND NONE OF THEM ASSERTS A VERDICT. A helper fails only when the game is not
// even in the situation the caller's scenario needs, and then with what it
// needed named.

/**
 * Pose an empty, quiet, live board at `level`, ready for a scenario.
 *
 * The sequence, and why each part of it is here:
 *
 *   - THE FOUR ROSTERS ARE EMPTIED. `clearNodes`, `clearWorms`, `clearFoes`,
 *     `clearBolts`. An empty board is safe because of the level-clear rule
 *     (`specs/progression.md`): a level clears on the step in which the last of
 *     its segments is REMOVED, so a board that never held one is being played
 *     rather than cleared. `progression/empty-board-does-not-clear` is the item
 *     that grades that, and it is what makes every scenario below poseable.
 *   - THE THREE WORLD GATES ARE SHUT. Without `setFoeSpawning(false)` a dropper
 *     arrives on the first `DROPPER_CHECK_INTERVAL` of an empty level-3 board
 *     and glitches arrive every seven to twelve seconds from level 2; without
 *     `setWormEntry(false)` the level's own worm materialises inside a scenario
 *     that never asked for one; without `setCursorContact(false)` a worm on the
 *     floor row or a descending foe costs a life mid-scenario and empties both
 *     rosters. Each gate is the level's own faculty rather than any entity's,
 *     which is why shutting it is not "parking an entity in a harmless corner".
 *     THE ITEMS THAT TURN A GATE BACK ON ARE THE ITEMS WHOSE REQUIREMENT THE
 *     GATE IS; any other check that finds itself wanting one has been mis-posed.
 *   - THE SCREEN IS LIVE. `playing`/`active` with the phase timer at rest, so
 *     the board really is stepping rather than sitting behind a banner.
 *   - THE CURSOR IS PARKED AT THE BAND'S CENTRE, with no invulnerability and no
 *     cooldown, which is where a run and a respawn put it (`specs/progression.md`)
 *     and the one entity no scenario can remove.
 *
 * It poses no worm, no foe, no node and no bolt: a check adds exactly what its
 * requirement concerns.
 */
export async function startPlaying(
  h: Harness,
  options: { level?: number } = {},
): Promise<void> {
  const { debug } = h;
  await debug.clearNodes();
  await debug.clearWorms();
  await debug.clearFoes();
  await debug.clearBolts();
  await debug.setFoeSpawning(false);
  await debug.setWormEntry(false);
  await debug.setCursorContact(false);
  await debug.setScreen("playing");
  await debug.setPhase("active");
  await debug.setPhaseTimer(0);
  await debug.setLevel(options.level ?? 1);
  await debug.setCursor(BAND_CX, BAND_CY);
  await debug.setCursorInvulnerable(0);
  await debug.setFireCooldown(0);
}

/**
 * Open a run the way a player does: from a reset title, confirm the highlighted
 * first item, `DESCEND`.
 *
 * The route for a check about what a NEW RUN is — its lives, its level, its
 * score, its starting scatter — none of which any pose can produce, because
 * `setLevel` spawns nothing and `setScore` grants nothing. Nothing here is
 * posed: `reset` is the surface's own, and the rest is a real key through
 * Chromium's input pipeline.
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

/** How a worm is laid on the board. */
export interface WormSpec {
  /** The head's tile. */
  c: number;
  r: number;
  /**
   * How many segments the worm carries, the head included. The trailing ones are
   * laid along the same row BEHIND the head, against `dh`, so a worm of length
   * `n` heading right occupies `(c, r)` back to `(c - n + 1, r)`. Pass
   * {@link WormSpec.segments} instead for any other shape.
   */
  length?: number;
  /** An explicit chain, head first, each tile orthogonally adjacent to the last. */
  segments?: readonly Tile[];
  /** `+1` right, `-1` left. Defaults to `+1`, which `addWorm` gives. */
  dh?: number;
  /** `+1` down, `-1` up. Defaults to `+1`. */
  dv?: number;
  diving?: boolean;
  /** The step faculty. Off, the worm holds its tiles and the board runs on. */
  stepping?: boolean;
  /** The body's follow. Off, the head steps and the trailing segments hold. */
  body?: boolean;
}

/**
 * Lay one worm on the board, a segment at a time, and hand back its id.
 *
 * Built from `addWorm` and `appendSegment` because the surface takes no nested
 * layout: a worm is a head and then one tile at a time, so the case never
 * imposes a shape on the build.
 *
 * The two faculties are what let a check pose the isolation its requirement
 * needs. A check on where the HEAD goes poses `body: false`, so one tile moves
 * and the reading is unambiguous. A worm posed purely as an OBSTACLE — a
 * blocker for another worm's step, or a target for a bolt — poses
 * `stepping: false`, so it cannot wander into the scenario.
 */
export async function poseWorm(h: Harness, spec: WormSpec): Promise<number> {
  const dh = spec.dh ?? 1;
  const chain: Tile[] =
    spec.segments !== undefined
      ? [...spec.segments]
      : Array.from({ length: Math.max(1, spec.length ?? 1) }, (_, i) => ({
          c: spec.c - dh * i,
          r: spec.r,
        }));

  await h.debug.addWorm(chain[0].c, chain[0].r);
  const added = lastWorm(await h.snapshot());
  if (added === undefined) {
    fail(
      "addWorm to append a worm to the roster (specs/instrumentation.md)",
      "the worm roster was still empty after addWorm",
    );
  }
  const id = added.id;

  for (const segment of chain.slice(1)) {
    await h.debug.appendSegment(id, segment.c, segment.r);
  }
  await h.debug.setWormHeading(id, dh);
  await h.debug.setWormDescent(id, spec.dv ?? 1);
  if (spec.diving !== undefined) await h.debug.setWormDiving(id, spec.diving);
  if (spec.stepping !== undefined) {
    await h.debug.setWormStepping(id, spec.stepping);
  }
  if (spec.body !== undefined) await h.debug.setWormBody(id, spec.body);
  return id;
}

/** How a foe is put on the board. */
export interface FoeSpec {
  /** Its velocity, in logical units per second. Defaults to the kind's own. */
  vx?: number;
  vy?: number;
  /** The dropper's taken-its-first-bolt flag. */
  hit?: boolean;
  /** Its own behaviour: darting and eating, laying, slamming. */
  mind?: boolean;
  /** Its locomotion. Off, the foe holds its position and its behaviour runs on. */
  travel?: boolean;
}

/**
 * Put one foe on the tile `(c, r)` — its centre on that tile's centre — and hand
 * back its id.
 *
 * The two faculties pair the way `specs/foes.md` makes them pair: a check on
 * what a glitch EATS poses `travel: false` and reads a tile with no motion at
 * all, since a foe acts on the tile its centre occupies; a check on how it
 * TRAVELS poses both on and reads distances. Neither can be disturbed by the
 * other faculty.
 */
export async function poseFoe(
  h: Harness,
  kind: FoeKind,
  c: number,
  r: number,
  spec: FoeSpec = {},
): Promise<number> {
  await h.debug.addFoe(kind, tileCX(c), tileCY(r));
  const added = lastFoe(await h.snapshot());
  if (added === undefined) {
    fail(
      "addFoe to append a foe to the roster (specs/instrumentation.md)",
      "the foe roster was still empty after addFoe",
    );
  }
  const id = added.id;
  if (spec.vx !== undefined || spec.vy !== undefined) {
    await h.debug.setFoeVelocity(id, spec.vx ?? added.vx, spec.vy ?? added.vy);
  }
  if (spec.hit !== undefined) await h.debug.setFoeHit(id, spec.hit);
  if (spec.mind !== undefined) await h.debug.setFoeMind(id, spec.mind);
  if (spec.travel !== undefined) await h.debug.setFoeTravel(id, spec.travel);
  return id;
}

/**
 * Set a run of tiles at once, `[column, row, charge]` each.
 *
 * `setNode` is the atomic operation and this is the loop over it, so a check
 * that poses a cluster reads as the cluster rather than as fifteen calls.
 */
export async function poseNodes(
  h: Harness,
  entries: readonly (readonly [number, number, number])[],
): Promise<void> {
  for (const [c, r, charge] of entries) {
    await h.debug.setNode(c, r, charge);
  }
}

/** Set every tile of a rectangle of tiles, both corners in, to one charge. */
export async function poseNodeBlock(
  h: Harness,
  from: Tile,
  to: Tile,
  charge: number,
): Promise<void> {
  for (let r = Math.min(from.r, to.r); r <= Math.max(from.r, to.r); r += 1) {
    for (let c = Math.min(from.c, to.c); c <= Math.max(from.c, to.c); c += 1) {
      await h.debug.setNode(c, r, charge);
    }
  }
}

/**
 * Put one bolt in flight with its centre on the centre of tile `(c, r)`, and
 * hand back its id.
 *
 * It then climbs at `BOLT_SPEED` and resolves through the game's own shot rules,
 * so the tile it is placed on is a tile the caller means it to start INSIDE:
 * pose it a row below the thing the check is shooting at, on a tile that holds
 * nothing, and let it travel.
 */
export async function poseBolt(
  h: Harness,
  c: number,
  r: number,
): Promise<number> {
  await h.debug.addBolt(tileCX(c), tileCY(r));
  const added = lastBolt(await h.snapshot());
  if (added === undefined) {
    fail(
      "addBolt to append a bolt to the roster (specs/instrumentation.md)",
      "the bolt roster was still empty after addBolt",
    );
  }
  return added.id;
}

/**
 * Run the real simulation until the bolt with that id is no longer in flight —
 * it struck something, or it left the top of the board — and report where the
 * game stood at that moment.
 *
 * Sampled every frame by default, because for most of these the frame the bolt
 * resolved on is what is read: the segment that vanished, the node the charge
 * came off, the score the hit paid.
 */
export async function driveBolt(
  h: Harness,
  id: number,
  options: UntilOptions = {},
): Promise<UntilResult> {
  return h.until((snapshot) => boltById(snapshot, id) === undefined, {
    maxFrames: options.maxFrames ?? framesFor(1),
    poll: options.poll ?? 1,
  });
}

/**
 * Pose a bolt one row below `(c, r)` and run it until it resolves.
 *
 * The sequence a shot check runs over and over: a bolt starting on the tile
 * beneath the target, climbing the one tile into it, and the build's own shot
 * rules deciding the rest. The starting tile has to be one the bolt should not
 * resolve against, which on a board posed by {@link startPlaying} is any tile
 * the check has not put something on.
 */
export async function shootTile(
  h: Harness,
  c: number,
  r: number,
  options: UntilOptions = {},
): Promise<UntilResult> {
  const id = await poseBolt(h, c, r + 1);
  return driveBolt(h, id, options);
}

/**
 * Advance the harness's clock far enough for a worm at `level` to take exactly
 * `steps` tile steps.
 *
 * See {@link framesForSteps} for why it stops half an interval past the last
 * step rather than on it.
 */
export async function driveSteps(
  h: Harness,
  steps: number,
  level = 1,
): Promise<void> {
  await h.advance(framesForSteps(steps, level));
}

/** Show or hide the read-only debug overlay, through its fixed Backquote binding. */
export async function toggleOverlay(h: Harness): Promise<void> {
  await h.tap(OVERLAY_KEY);
}
