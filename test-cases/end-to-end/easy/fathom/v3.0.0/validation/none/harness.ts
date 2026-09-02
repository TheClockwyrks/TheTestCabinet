// Fathom — the shared validator harness. CASE-PROVIDED.
//
// Every check in this suite is an ordinary vitest test that drives the built site
// IN A REAL BROWSER. There is nothing to import: an engineless run seeds no `src/`
// at all, so the build wrote its own frame loop, its own canvas fit, its own
// keyboard, its own audio, and its own `window.__fathom` — and the only place all
// of that exists is a page that has loaded the bundle. So the project serves
// `dist/`, loads it in Chromium, and reaches the game the way anything reaches it:
// over the surface `specs/instrumentation.md` told the build to install.
//
// IT IS STILL A VITEST PROJECT, AND THAT IS DELIBERATE. The runner locates the
// build output before it chooses between the vitest and browser paths, so `dist/`
// is on disk by the time this project runs. Staying a vitest project is what lets
// the case name ONE script per review item and have it resolve under every engine
// — `validation/fog/unrevealed-black.test.ts` is the same path whichever runtime
// the run selected — and what keeps `format = 2` resolution passing.
//
// WHAT A CHECK READS. The game's own state (through `window.__fathom`'s
// `snapshot`), the ticks the harness itself drove, the operations the build issued
// against its 2D context, the pixels those operations left on the canvas, and the
// sounds the build emitted. Nothing here fabricates an outcome: the fixtures and
// scene helpers next door only ARRANGE the trench through the surface, and the
// real tick the build wrote is what runs from there.
//
// THE CLOCK IS THE SURFACE'S. Nothing outside an engineless build owns its loop,
// so `specs/instrumentation.md` puts the clock on the surface: `setAutoStep(false)`
// takes the game off real time and `advance(ticks)` runs whole ticks. Fathom fixes
// the size of a tick itself — `TICK_HZ` is `120` and `advance` counts in whole
// `TICK_DT`s — so unlike a case that leaves the step to its caller, this harness
// chooses no schedule: a check asks for a number of ticks and gets exactly that
// number. Every harness opens by taking the game off the clock. The one check that
// is ABOUT the loop running itself (`controls/advances-in-real-time`) hands it back
// with {@link Harness.runFor}.
//
// ADVANCE VERSUS SKIP. Both run real ticks and neither fabricates anything; they
// differ in what they leave behind for a reviewer. `advance` brackets each tick as
// one recorded frame, so a captured section plays back at the rate the game ran
// at. `skip` runs the ticks in one call and closes no frame, for the march to a
// state nobody needs to watch — losing three lives, waiting out a cooldown,
// settling a pose. A section that skipped its setup and advanced its subject
// yields a clip of the subject.
//
// EVERYTHING CROSSING INTO THE PAGE IS ASYNC. That is the whole of the difference
// between a suite here and its counterpart under an engine: `await h.snapshot()`
// rather than `h.snapshot()`, `await h.debug.setMaze(rows)` rather than
// `h.debug.setMaze(rows)`. The scenarios, the tolerances and the assertions are
// the same ones, because they are the case's rather than the runtime's.
//
// ONE SERVER, ONE BROWSER, ONE PAGE PER HARNESS. `globalSetup.ts` starts the
// server and the browser once for the whole project; this module connects to them
// from inside each suite's worker and opens a page per harness, so every check
// drives a build that has just started and no check can be affected by what the
// one before it pressed, opened or muted.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { expect, inject } from "vitest";
import type { Browser, BrowserContext, Page } from "playwright";
import { connectChromium } from "./chromium";
import {
  HANDLE,
  PAGE_DEADLINE_MS,
  POLL_MS,
  SURFACE_TIMEOUT_MS,
  surfaceAbsent,
  waitForSurface,
} from "./surface";
import { fail } from "./assert";
import {
  STAGE_H,
  STAGE_W,
  TICK_HZ,
  TICK_MS,
  UNBOUND_KEY,
  type Dir,
} from "./constants";
import { type FixtureBoard, type FixtureOps } from "./fixtures";
import { tileCenter, type GridFrame, type Tile } from "./maze";

declare module "vitest" {
  export interface ProvidedContext {
    /** Where the built site is served, from `globalSetup.ts`. */
    fathomUrl: string;
    /** The one Chromium every suite worker connects to. */
    fathomBrowserWs: string;
    /**
     * Whether this build installs no surface at all, settled once by
     * `globalSetup.ts` at the whole of `SURFACE_TIMEOUT_MS` and on pages of its
     * own, so no harness has to buy the same answer again.
     */
    fathomSurfaceAbsent: boolean;
  }
}

/* -------------------------------------------------------------------------- */
/* The contract the build owes                                                */
/* -------------------------------------------------------------------------- */

/**
 * The handle an engineless build installs its surface on.
 *
 * Re-exported from `surface.ts`, which `globalSetup.ts` reads too: the runner
 * settles the run's surface verdict before any worker exists, so the handle
 * cannot live in a module that only a worker can import.
 */
export { HANDLE };

/**
 * Every operation `specs/instrumentation.md` requires on the surface, including
 * the two clock operations that exist only under this engine.
 *
 * This is the case's list, not the build's: a build that installs a surface
 * missing one of these is held against the specification rather than against its
 * own idea of what it wrote. {@link Harness.surfaceFault} names what is missing
 * and every operation then fails by assertion rather than throwing.
 */
export const REQUIRED_OPS = [
  "setAutoStep",
  "advance",
  "reset",
  "snapshot",
  "setScreen",
  "setScore",
  "setLives",
  "setDepth",
  "setMaze",
  "setPlankton",
  "clearPlankton",
  "clearFog",
  "setForagerTile",
  "setForagerDir",
  "setBrightness",
  "setBrightHold",
  "clearPredators",
  "addPredator",
  "setPredatorTile",
  "setPredatorDir",
  "setPredatorState",
  "setPredatorReleased",
  "setPredatorMind",
  "setPredatorTravel",
  "spawnDrifter",
  "clearDrifters",
  "setDrifterMind",
  "setDrifterTravel",
  "setSonarCooldown",
  "setInkCooldown",
] as const;

/** The version the surface reports (`FATHOM_DEBUG_VERSION`). */
export const FATHOM_DEBUG_VERSION = 1;

/** The seven screens the game is a state machine over (`specs/state.md`). */
export type Screen =
  | "title"
  | "howto"
  | "countdown"
  | "playing"
  | "paused"
  | "cleared"
  | "gameover";

/** The three hunters. */
export type PredatorKind = "lanternjaw" | "gloamfin" | "flarefish";

/** Where a predator is and what it is doing (`specs/state.md`). */
export type PredatorState = "den" | "wander" | "chase" | "search";

/** The three states a predator may be POSED into: `"search"` is not one of them. */
export type PosablePredatorState = "den" | "wander" | "chase";

/** One predator, as a snapshot reports it. */
export interface PredatorSnapshot {
  kind: PredatorKind;
  x: number;
  y: number;
  tx: number;
  ty: number;
  dir: Dir;
  state: PredatorState;
  released: boolean;
  /** Whether its own mind is running (`specs/state.md`). */
  mind: boolean;
  /** Whether its body carries what its mind decides (`specs/state.md`). */
  travel: boolean;
  speed: number;
  alert: boolean;
  lit: boolean;
  /** The Lanternjaw and the Flarefish; `null` for the Gloamfin. */
  detectRange: number | null;
  /** The Gloamfin; `null` for the others. */
  hearingRange: number | null;
  hearingLock: boolean | null;
  /** The Flarefish; `null` for the others. */
  flareCharging: boolean | null;
  flaring: boolean | null;
  flareRadius: number | null;
}

/** One bonus drifter, as a snapshot reports it. */
export interface DrifterSnapshot {
  x: number;
  y: number;
  tx: number;
  ty: number;
  /**
   * True while its body is being drawn this instant, by the forager's light or
   * by a flare.
   *
   * Its amber mote is a separate drawing and is not what this answers for: the
   * mote is one of the maze's amber lights and shows under its own rule, while
   * `lit` says whether the jellyfish itself is drawn (specs/state.md).
   */
  lit: boolean;
  /** Whether its own mind is running (`specs/state.md`). */
  mind: boolean;
  /** Whether its body carries that wander through the maze (`specs/state.md`). */
  travel: boolean;
}

/** One sonar wavefront in flight, the forager's own and the Gloamfin's alike. */
export interface PulseSnapshot {
  source: "forager" | "gloamfin";
  tint: "cyan" | "violet" | "orange";
  ox: number;
  oy: number;
  /** How far the leading edge has traveled, in corridor steps. */
  front: number;
  /** The furthest it will travel, in the same steps. */
  range: number;
}

/** One ink cloud still standing. */
export interface InkCloudSnapshot {
  x: number;
  y: number;
  radius: number;
  remaining: number;
}

/**
 * The state a snapshot reports, as `specs/state.md` documents it.
 *
 * `windowRadius` is the one field the VARIANT decides: the kindle variant carries
 * the outer vision circle and reports its radius `R`, and the base variant has no
 * such circle and no such field. It is declared optional so this one harness
 * serves both workspaces; a kindle check reads it through
 * {@link windowRadius}, which says what the build owes rather than throwing a
 * `TypeError` several ticks later.
 */
export interface FathomSnapshot extends FixtureBoard {
  version: number;
  screen: Screen;
  depth: number;
  score: number;
  lives: number;
  muted: boolean;
  autoStep: boolean;
  planktonRemaining: number;
  brightness: number;
  brightHold: number;
  visionRadius: number;
  /** The kindle variant alone: `R`, the outer vision circle's radius. */
  windowRadius?: number;
  sonar: { ready: boolean; cooldown: number; range: number };
  ink: { ready: boolean; cooldown: number };
  grid: {
    cols: number;
    rows: number;
    tile: number;
    originX: number;
    originY: number;
  };
  tiles: string[];
  plankton: string[];
  visibility: string[];
  forager: {
    x: number;
    y: number;
    tx: number;
    ty: number;
    dir: Dir;
    moving: boolean;
  };
  drifters: DrifterSnapshot[];
  predators: PredatorSnapshot[];
  pulses: PulseSnapshot[];
  inkClouds: InkCloudSnapshot[];
  simTime: number;
}

/**
 * The kindle variant's outer vision-circle radius, or a failure naming what the
 * variant's `specs/state.md` requires.
 *
 * A build reporting no `windowRadius` under kindle fails by assertion here rather
 * than by arithmetic on `undefined` several lines later, so the point names the
 * fault.
 */
export function windowRadius(snapshot: FathomSnapshot): number {
  if (typeof snapshot.windowRadius !== "number") {
    fail(
      "snapshot() to report the outer vision circle's radius as `windowRadius`; " +
        "see specs/state.md",
      snapshot.windowRadius,
    );
  }
  return snapshot.windowRadius;
}

/** The operations a check poses the game through. Every one crosses into the page. */
export interface FathomDebugApi extends FixtureOps {
  setAutoStep(enabled: boolean): Promise<void>;
  advance(ticks: number): Promise<void>;
  reset(options?: { seed?: number }): Promise<void>;
  snapshot(): Promise<FathomSnapshot>;
  setScreen(s: Screen): Promise<void>;
  setScore(points: number): Promise<void>;
  setLives(n: number): Promise<void>;
  setDepth(d: number): Promise<void>;
  setMaze(rows: readonly string[]): Promise<void>;
  setPlankton(tx: number, ty: number, present: boolean): Promise<void>;
  clearPlankton(): Promise<void>;
  clearFog(): Promise<void>;
  setForagerTile(tx: number, ty: number): Promise<void>;
  setForagerDir(dir: Dir): Promise<void>;
  setBrightness(g: number): Promise<void>;
  setBrightHold(seconds: number): Promise<void>;
  clearPredators(): Promise<void>;
  addPredator(kind: PredatorKind, tx: number, ty: number): Promise<void>;
  setPredatorTile(index: number, tx: number, ty: number): Promise<void>;
  setPredatorDir(index: number, dir: Dir): Promise<void>;
  setPredatorState(index: number, value: PosablePredatorState): Promise<void>;
  setPredatorReleased(index: number, released: boolean): Promise<void>;
  setPredatorMind(index: number, enabled: boolean): Promise<void>;
  setPredatorTravel(index: number, enabled: boolean): Promise<void>;
  spawnDrifter(tx: number, ty: number): Promise<void>;
  clearDrifters(): Promise<void>;
  setDrifterMind(index: number, enabled: boolean): Promise<void>;
  setDrifterTravel(index: number, enabled: boolean): Promise<void>;
  setSonarCooldown(seconds: number): Promise<void>;
  setInkCooldown(seconds: number): Promise<void>;
}

/* -------------------------------------------------------------------------- */
/* Counting ticks                                                             */
/* -------------------------------------------------------------------------- */

/** Whole ticks covering `seconds` of simulated time, rounded up. */
export function ticks(seconds: number): number {
  return Math.ceil(seconds * TICK_HZ);
}

/** The simulated seconds `count` ticks cover. */
export function seconds(count: number): number {
  return count / TICK_HZ;
}

/** A speed in logical units per second, from ground covered over `count` ticks. */
export function speedOverTicks(distance: number, count: number): number {
  return (Math.abs(distance) * TICK_HZ) / count;
}

/* -------------------------------------------------------------------------- */
/* The harness                                                                */
/* -------------------------------------------------------------------------- */

/** One recorded operation on the 2D context, in the order the render made it. */
export type DrawCall =
  | { kind: "call"; method: string; args: unknown[] }
  | { kind: "set"; property: string; value: unknown };

/**
 * A sound the build emitted, stamped with the driven step it landed in.
 *
 * The stamp is the tick that step ENDED on, so it is the tick the sound was made
 * on exactly when the step was one tick — which is how {@link Harness.scan} is
 * driven wherever a check reads a cue against a tick. A check that only counts
 * what sounded across a window (`controls/mute`) reads the count and not the
 * stamp.
 */
export interface TimedCue {
  /** The tick the step it sounded in ended on, 1-based, as {@link Harness.tick} counts. */
  tick: number;
  /** The simulated time at that tick, in milliseconds. */
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
}

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
  snapshot: FathomSnapshot;
}

/**
 * One reading of a batched run: the state one step of ticks left, and what it
 * sounded.
 *
 * What {@link Harness.scan} hands back, one entry per step it took.
 */
export interface Reading {
  /** The harness tick the step ended on, 1-based, as a recorded frame counts it. */
  tick: number;
  /** The simulated time those ticks covered, in milliseconds. */
  timeMs: number;
  /** How many sounds the build emitted over the step's ticks. */
  sounds: number;
  /** The state the step left. */
  snapshot: FathomSnapshot;
}

/** A device pixel, as `[r, g, b, a]`. */
export type Pixel = [number, number, number, number];

export interface Harness {
  /** The page the build is running in. For a check that needs Playwright itself. */
  readonly page: Page;
  /**
   * The surface the BUILD installed, as operations that cross into the page.
   *
   * Read off `window.__fathom` and never constructed here — see
   * {@link missingSurface}.
   */
  readonly debug: FathomDebugApi;
  /**
   * Why the build's surface cannot be driven, or `null` when it can.
   *
   * A fault here is the build's: the surface is missing, or it is missing an
   * operation `specs/instrumentation.md` requires. It says what was found
   * (`window.__fathom was still absent 60s after the page loaded`), and
   * {@link failSurface} pairs it with what the specification requires. Every
   * operation fails by assertion with that pair rather than throwing, so the fault
   * lands on the points whose checks reach the game through the surface.
   */
  readonly surfaceFault: string | null;
  /** Everything the page logged to `console.error`, or threw, oldest first. */
  readonly pageErrors: string[];

  /** The ticks this harness has driven, 1-based, as a recorded frame counts them. */
  tick(): number;
  /** The simulated time those ticks covered, in milliseconds. */
  timeMs(): number;

  /** A fresh read of the game's state through the build's `snapshot`. */
  snapshot(): Promise<FathomSnapshot>;
  /**
   * Run `count` real ticks, each closed as one recorded frame.
   *
   * What a captured section is made of. Use it for the part of a scenario a
   * reviewer should watch, and {@link skip} for the march that got there.
   */
  advance(count: number): Promise<void>;
  /**
   * Run `count` real ticks in one call, closing no recorded frame.
   *
   * The same simulation as {@link advance} — the ticks are the build's own and
   * nothing is fabricated — and the same cost to the game. What it saves is a
   * capture's budget: a march to a state spends none of the frames a reviewer
   * looks at.
   */
  skip(count: number): Promise<void>;
  /** Advance until `predicate` holds, sampling every `poll` ticks. */
  until(
    predicate: (snapshot: FathomSnapshot) => boolean,
    options?: UntilOptions,
  ): Promise<UntilResult>;
  /** The same sweep on {@link skip}: a march to a state, filmed by nothing. */
  skipUntil(
    predicate: (snapshot: FathomSnapshot) => boolean,
    options?: UntilOptions,
  ): Promise<UntilResult>;
  /**
   * Run `count` ticks in steps of `poll`, reading the state after each step, in
   * ONE crossing into the page.
   *
   * The batched form of a watch that runs to a fixed length: `until` and
   * `skipUntil` stop the moment a predicate holds and so have to come back out to
   * the suite between samples, while a watch that is going to run its whole
   * length whatever it sees does not. The ticks are the same ticks stepped the
   * same way — one `advance(poll)` per reading, exactly as a loop of
   * `advance(poll)` calls would — and what is saved is one crossing per reading,
   * which on a loaded host is the larger half of what such a watch costs.
   */
  scan(count: number, poll?: number): Promise<Reading[]>;

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
   * comparing held state at the top of each tick — so the tick goes between the
   * two. Exactly one tick passes either way, so nothing a caller counts moves.
   */
  tap(code: string): Promise<void>;

  /** Run exactly one tick and hand back every operation its render issued. */
  frameCalls(): Promise<DrawCall[]>;
  /** Reflect the surface without invoking it: `typeof` for each name, and the version. */
  probe(
    names: readonly string[],
  ): Promise<{ version: unknown; ops: Record<string, string> }>;

  /** How the stage is mapped onto this harness's canvas. */
  viewport(): Viewport;
  /** Where a logical point lands in the canvas's backing store. */
  device(x: number, y: number): { x: number; y: number };
  /** The device pixel under a logical point. */
  pixel(x: number, y: number): Promise<Pixel>;
  /** Many logical points at once, in one crossing into the page. */
  pixels(points: readonly { x: number; y: number }[]): Promise<Pixel[]>;
  /** A pixel addressed in the canvas's own backing store, past the fit. */
  devicePixel(x: number, y: number): Promise<Pixel>;
  /**
   * The channel-mean brightness of every device pixel along one line of the
   * backing store, addressed past the fit.
   *
   * One crossing into the page for the whole line, because a check that has to
   * find WHERE the build drew something reads thousands of pixels rather than a
   * handful, and a crossing each would cost more than the frame it is reading.
   */
  scanDevice(axis: "row" | "column", index: number): Promise<number[]>;
  /** The canvas's backing store size, as the build sized it. */
  surface(): Promise<{ width: number; height: number; dpr: number }>;

  /** Give the build a real, browser-trusted gesture, so its audio can open. */
  armAudio(): Promise<void>;

  /** Release anything held, and let the page go. */
  dispose(): Promise<void>;
}

/* ---- The page ------------------------------------------------------------- */

/** The init scripts injected before any of the build's own script runs. */
const INIT_SCRIPTS = ["recorder-init.js", "audio-init.js"] as const;

/** This module's directory: the validator project's root. */
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * The most recorded frames one driven run closes while a capture is keeping them.
 *
 * The same 300 a written recording holds ({@link MAX_REPLAY_FRAMES}), because a
 * run filmed at a finer grain than that is thinned back to it on the way to disk
 * anyway — `thinReplay` decimates, and the injected recorder decimates again at
 * twice this while the section is still running. So a run longer than this is
 * filmed at a stride, and what a reviewer is handed is the clip they were going
 * to be handed either way.
 *
 * WHY THAT IS WORTH DOING. `specs/instrumentation.md` has `advance` REDRAW, so
 * every call costs a whole frame of the build's own rendering — tens of
 * milliseconds on a host that is running other work — while the ticks themselves
 * cost microseconds. A section that steps ten thousand ticks one at a time pays
 * ten thousand renders to keep three hundred frames.
 */
const CAPTURE_FRAME_BUDGET = 300;

/**
 * How much game time one recorded frame covers, in ticks.
 *
 * Four, which at `TICK_HZ` (`120`) is thirty frames of clip per second of game —
 * the rate a picture is watched at, rather than the rate the simulation runs at.
 * A capture that closed a frame per TICK would be filming a hundred and twenty a
 * second, four fifths of which decimation throws away before the file is written
 * and every one of which cost the build a render and the recorder an encoding.
 *
 * The stride doubles each time a capture has closed {@link CAPTURE_FRAME_BUDGET}
 * frames, which is the same decimation `thinReplay` performs on the way to disk,
 * done before the cost rather than after it: a section that runs long is filmed
 * more coarsely rather than paying for frames that will not survive.
 */
const FILM_STRIDE_TICKS = 4;

let browserPromise: Promise<Browser> | null = null;

async function sharedBrowser(): Promise<Browser> {
  browserPromise ??= connectChromium(inject("fathomBrowserWs"));
  return browserPromise;
}

/**
 * One browser context per WINDOW SHAPE, shared by every harness of that shape in
 * this file, and one PAGE per harness inside it.
 *
 * The split is what the init scripts force and what correctness wants. The
 * recorder and the audio probe are installed on the CONTEXT, so every page it
 * opens is instrumented before a line of the build's script runs, and a context is
 * also where the viewport and the device pixel ratio are fixed — which is the one
 * thing `presentation/window-fit` varies. Everything else about a harness is the
 * page: a fresh one opens on a build that has just started, with no key held, no
 * audio context opened, and the mute preference back off, which is a stronger
 * guarantee than any reset the surface offers, since `reset()` deliberately leaves
 * muting alone.
 *
 * A page per harness rather than one reused between them, because a check may
 * legitimately hold two harnesses at once, and a harness whose page had been taken
 * over by a later one would read someone else's game while looking exactly like it
 * worked.
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
 * A proxy rather than a hand-written stub, and the failure lands at the MOMENT a
 * check first reaches for an operation rather than in a `beforeEach`. A harness
 * that threw while it was being built would bury the verdict under a setup error
 * and tell a reviewer nothing about which requirement went unmet; a check that
 * fails on its own first call reports the point it was deciding, paired with what
 * the build owes.
 *
 * Keys that belong to the MACHINERY rather than to a check are answered with
 * `undefined` instead: awaiting a value probes `then`, and vitest's own error
 * formatting probes symbols and `constructor`. Failing those would replace the
 * verdict with noise from the machinery that was trying to report it.
 */
function missingSurface(reason: string): FathomDebugApi {
  return new Proxy({} as FathomDebugApi, {
    get: (_target, property): unknown => {
      if (typeof property === "symbol") return undefined;
      if (property === "then" || property === "constructor") return undefined;
      return () => failSurface(reason);
    },
  });
}

/**
 * What `specs/instrumentation.md` requires of the surface: the `Expected:` line a
 * build with no usable surface lands on every check that reaches for it, beside
 * the {@link Harness.surfaceFault} that says what was found.
 */
export const SURFACE_REQUIREMENT =
  `a usable debugging and automation surface on window.${HANDLE} as soon as the ` +
  `game has initialized, carrying every operation specs/instrumentation.md ` +
  `requires`;

/**
 * Fail the running check on `fault`, the harness's account of what is wrong with
 * the build's surface, paired with what the specification requires.
 */
export function failSurface(fault: string): never {
  return fail(SURFACE_REQUIREMENT, fault);
}

/**
 * What is wrong with the surface this page installed, or `null` when nothing is:
 * the surface never appeared, or it appeared without an operation the
 * specification requires.
 */
async function readSurfaceFault(page: Page): Promise<string | null> {
  // The run already looked, twice, on pages of their own and for the whole of
  // the ceiling, and this build installs no surface (`globalSetup.ts`). Waiting
  // again here would buy the same answer a hundred and twenty-five times over,
  // which is past the cap on the whole validator run — and a run that blows that
  // cap reports every point as `ran=false` instead of as the failure it is.
  if (inject("fathomSurfaceAbsent")) return surfaceAbsent();
  if (!(await waitForSurface(page))) return surfaceAbsent();
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
 * The default shape is the stage's own size at one device pixel per CSS pixel, so
 * a logical coordinate and a canvas pixel are the same thing and no check but
 * `presentation/window-fit` has to think about the fit at all.
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
    if (message.type() === "error") pageErrors.push(message.text());
  });

  // Off Playwright's own thirty-second defaults before anything is asked of the
  // page: those are deadlines on the host, and this project sets its own.
  page.setDefaultTimeout(PAGE_DEADLINE_MS);
  page.setDefaultNavigationTimeout(PAGE_DEADLINE_MS);

  await page.goto(inject("fathomUrl"), { waitUntil: "load" });

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
      ? missingSurface(surfaceFault)
      : (new Proxy({} as FathomDebugApi, {
          get: (_target, property): unknown => {
            if (typeof property === "symbol") return undefined;
            if (property === "then" || property === "constructor")
              return undefined;
            const name = String(property);
            return (...args: unknown[]) => call(name, args);
          },
        }) as FathomDebugApi);

  if (surfaceFault === null) {
    // Off the wall clock and back to the title before a check touches anything:
    // from here the game changes only when this harness says so.
    await call("setAutoStep", [false]);
    await call("reset", []);
    // And a recorder over the surface before a check can arm one. A build is free
    // to ask for its 2D context on the frame it first draws rather than while it
    // initializes, so the surface can be installed and answering before any
    // context exists to record — and a `captureReplay` armed in that window arms
    // nothing and writes no evidence for a section that drew.
    await page
      .waitForFunction(
        () =>
          (
            window as unknown as { __fathomRec: { ready(): boolean } }
          ).__fathomRec.ready(),
        undefined,
        // On a timer rather than on the page's animation frames, for the reason
        // `surface.ts` gives: a starved page is starved of frames, and a look
        // scheduled on them reads the host rather than the build.
        { timeout: SURFACE_TIMEOUT_MS, polling: POLL_MS },
      )
      .catch(() => undefined);
  }

  const view = fitViewport(cssWidth, cssHeight, dpr);
  const cueSinks: TimedCue[][] = [];
  // Whether a `captureReplay` is keeping this harness's frames right now, which
  // decides how finely the ticks under it are STEPPED — whether a frame is closed
  // at all is the page's own answer, taken from the recorder. Held as a box rather
  // than a plain flag because {@link strideFor} closes over it before the harness
  // it belongs to exists, and `captureReplay` flips it from outside.
  const filming = { on: false, closed: 0 };
  let tickCount = 0;
  let timeMs = 0;

  /**
   * How finely `count` ticks are stepped: how many of them one `advance` call —
   * and so one recorded frame, and one of the build's own renders — covers.
   *
   * `specs/instrumentation.md` has `advance(n)` run `n` whole ticks "immediately
   * and in order" and then REDRAW, so the state a batch reaches and the state the
   * same ticks reach one at a time are the same state — which is exactly what
   * `instrumentation/manual-clock` is the point for — while the redraw costs a
   * whole frame of the build's own rendering per call. On a host that is running
   * other work a render is tens of milliseconds and a tick is microseconds, so a
   * run stepped one tick at a time is paying for pictures nothing looks at.
   *
   * The ticks are therefore stepped as finely as something is actually WATCHING
   * them, and no finer. A check that reads the state between ticks says so, by
   * asking for its own grain through {@link Harness.scan} or a sweep's `poll`;
   * this decides only what a plain `advance` does with the ticks nothing has
   * asked to see between:
   *
   *   * While a capture is running they are stepped at {@link filmStride}, which
   *     is the rate the clip is watched at rather than the rate the game runs at.
   *   * Otherwise the whole run is one `advance` — the same ticks in the same
   *     order, closing the single frame {@link Harness.frameCalls} reads back.
   *
   * Nothing a check asserts moves with this. The simulation is identical, the
   * state read at the end is the state those ticks left, and the clip a reviewer
   * is handed is the one decimation was going to leave anyway.
   */
  const strideFor = (count: number): number => {
    if (!filming.on) return Math.max(1, count);
    return Math.max(1, Math.min(count, filmStride()));
  };

  /**
   * How much game time one recorded frame should cover right now, in ticks.
   *
   * {@link FILM_STRIDE_TICKS}, doubled once for every {@link CAPTURE_FRAME_BUDGET}
   * frames the running capture has already closed, so a long section is filmed
   * more coarsely instead of paying for frames decimation will drop.
   */
  const filmStride = (): number =>
    FILM_STRIDE_TICKS * 2 ** Math.floor(filming.closed / CAPTURE_FRAME_BUDGET);

  /**
   * How many steps of `stride` ticks one recorded frame spans.
   *
   * A SECOND COST, AND A LARGER ONE THAN THE RENDER. Closing a frame is not free
   * even when nothing keeps it: the injected recorder pools every operation the
   * frame issued so `frameCalls` can read the last one back, and one frame of this
   * game is a whole maze of them. So a frame is closed only while the recorder is
   * ARMED — which the page itself is asked, because a check may arm it directly —
   * and then only every {@link filmStride} ticks, whatever grain the ticks
   * underneath are stepped at. A cue watch is the case that needs both at once: it
   * steps one tick at a time because that is what attributes a sound to a tick, and
   * it films at a stride because a clip does not need a frame apiece.
   */
  const filmEvery = (stride: number): number =>
    Math.max(1, Math.round(filmStride() / Math.max(1, stride)));

  /**
   * Step `count` ticks in runs of `stride`, and hand back one reading per step.
   *
   * The one place ticks are driven. Everything happens inside a single
   * synchronous evaluation in the page, so nothing the page's own animation frame
   * renders can land inside a recorded frame, and the sounds counted around a
   * step are the ones that step produced.
   *
   * `film` is how many steps one recorded frame spans (see {@link filmEvery});
   * whether a frame is closed at all is the page's answer, since only the page
   * knows whether the recorder is armed. `force` overrides that for the one
   * caller that wants its frame either way.
   *
   * `every` decides how much comes back: a watch that reads the state after each
   * step asks for every reading, and a drive that only wants where it ended asks
   * for the last. A snapshot is cheap to take and not cheap to carry back out —
   * a board is three grids of tiles — so a run of thousands of steps that nothing
   * samples does not pay to serialize thousands of them.
   */
  const run = async (
    count: number,
    stride: number,
    every: boolean,
    film: number,
    force = false,
  ): Promise<Reading[]> => {
    if (surfaceFault !== null) refuse();
    const result = (await page.evaluate(
      ([handle, howMany, step, tickMs, keepAll, filmEach, always]) => {
        const api = (
          window as unknown as Record<
            string,
            Record<string, (...a: unknown[]) => unknown>
          >
        )[handle];
        const rec = (
          window as unknown as {
            __fathomRec: Record<string, (...a: unknown[]) => unknown>;
          }
        ).__fathomRec;
        // Asked of the page rather than tracked out here, because a check is free
        // to arm the recorder itself — `presentation/provided-art` reads one
        // frame's draws that way — and a run that closed no frame under such an
        // arm would hand it an empty recording.
        const keeping = always || rec.armed() === true;
        const audio = (
          window as unknown as { __fathomAudio: { started(): number } }
        ).__fathomAudio;
        const ticks: number[] = [];
        const sounds: number[] = [];
        const snapshots: unknown[] = [];
        let done = 0;
        // Every `filmEach`th step is bracketed as one recorded frame; the steps
        // between it and the last one run unbracketed, and the ticks they covered
        // are carried into the next frame's delta so the clip still plays at the
        // rate the game ran at. Bracketing a run of steps together instead would
        // cost the same as filming every one of them — a frame pools every
        // operation issued while it is OPEN, so a frame held open across four
        // renders pools four renders' worth.
        let sinceFilmed = 0;
        let carriedTicks = 0;
        let framed = 0;
        do {
          const ran = Math.min(step, howMany - done);
          const before = audio.started();
          const keepFrame = keeping && sinceFilmed === 0;
          if (keepFrame) rec.begin();
          api.advance(ran);
          done += ran;
          carriedTicks += ran;
          if (keepFrame) {
            rec.end(tickMs * carriedTicks);
            carriedTicks = 0;
            framed += 1;
          }
          sinceFilmed = (sinceFilmed + 1) % filmEach;
          ticks.push(ran);
          sounds.push(audio.started() - before);
          if (keepAll || done >= howMany) snapshots.push(api.snapshot());
        } while (done < howMany);
        return { ticks, sounds, snapshots, framed };
      },
      [
        HANDLE,
        count,
        Math.max(1, stride),
        TICK_MS,
        every,
        Math.max(1, film),
        force,
      ] as const,
    )) as {
      ticks: number[];
      sounds: number[];
      snapshots: FathomSnapshot[];
      framed: number;
    };
    filming.closed += result.framed;

    const readings: Reading[] = [];
    result.ticks.forEach((ran, index) => {
      tickCount += ran;
      timeMs += ran * TICK_MS;
      for (let n = 0; n < result.sounds[index]; n += 1) {
        for (const sink of cueSinks) sink.push({ tick: tickCount, t: timeMs });
      }
      const snapshot = every
        ? result.snapshots[index]
        : index === result.ticks.length - 1
          ? result.snapshots[0]
          : undefined;
      if (snapshot !== undefined) {
        readings.push({
          tick: tickCount,
          timeMs,
          sounds: result.sounds[index],
          snapshot,
        });
      }
    });
    return readings;
  };

  /**
   * Run `count` ticks as recorded frames, and read the state they left, in one
   * crossing.
   *
   * Each step is opened and closed around a single `advance`, all inside one
   * synchronous evaluation, so nothing the page's own animation frame renders can
   * land inside a recorded frame — and so a frame the recorder keeps is exactly
   * the ticks the game ran under it. How many ticks that is, is
   * {@link strideFor}'s.
   */
  const drive = async (count: number): Promise<FathomSnapshot> => {
    const stride = strideFor(count);
    const readings = await run(count, stride, false, filmEvery(stride));
    return readings[readings.length - 1].snapshot;
  };

  /**
   * Run `count` ticks in batched `advance` calls, closing no recorded frame, and
   * read the state they left.
   *
   * The same real ticks the game runs under {@link drive}; what is skipped is the
   * recording, not the simulation. `specs/instrumentation.md` has `advance(n)` run
   * `n` whole ticks "immediately and in order", so a batch and a run of singles
   * reach the same state.
   */
  const march = async (count: number): Promise<FathomSnapshot> => {
    if (surfaceFault !== null) refuse();
    const snapshot = (await page.evaluate(
      ([handle, howMany]) => {
        const api = (
          window as unknown as Record<
            string,
            Record<string, (...a: unknown[]) => unknown>
          >
        )[handle];
        api.advance(howMany);
        return api.snapshot();
      },
      [HANDLE, count] as const,
    )) as FathomSnapshot;
    tickCount += count;
    timeMs += count * TICK_MS;
    return snapshot;
  };

  const scanDevice = async (
    axis: "row" | "column",
    index: number,
  ): Promise<number[]> => {
    await page.evaluate(
      () => new Promise<void>((done) => requestAnimationFrame(() => done())),
    );
    return page.evaluate(
      ([which, at]) => {
        const canvases = Array.from(document.querySelectorAll("canvas"));
        if (canvases.length === 0) {
          throw new Error("fathom: the page has no <canvas>");
        }
        let canvas = canvases[0];
        for (const other of canvases) {
          if (other.width * other.height > canvas.width * canvas.height) {
            canvas = other;
          }
        }
        const ctx2d = canvas.getContext("2d");
        if (ctx2d === null) {
          throw new Error("fathom: the canvas has no 2D context");
        }
        const row = which === "row";
        const line = Math.min(
          Math.max(at, 0),
          Math.max((row ? canvas.height : canvas.width) - 1, 0),
        );
        const { data } = row
          ? ctx2d.getImageData(0, line, canvas.width, 1)
          : ctx2d.getImageData(line, 0, 1, canvas.height);
        const out: number[] = [];
        for (let i = 0; i < data.length; i += 4) {
          out.push((data[i] + data[i + 1] + data[i + 2]) / 3);
        }
        return out;
      },
      [axis, index] as const,
    );
  };

  const readPixels = async (
    devicePoints: readonly { x: number; y: number }[],
  ): Promise<Pixel[]> => {
    // One animation frame first. `specs/instrumentation.md` has `advance` redraw
    // the canvas, so on a conforming build the picture is already the one the last
    // tick left — but a build that presents on its own frame instead has drawn the
    // same state a moment later, and waiting costs a sample nothing but a frame.
    // The recorder is in manual mode here, so the frame it waits for closes
    // nothing and no recording sees it.
    await page.evaluate(
      () => new Promise<void>((done) => requestAnimationFrame(() => done())),
    );
    return page.evaluate(
      (points) => {
        const canvases = Array.from(document.querySelectorAll("canvas"));
        if (canvases.length === 0) {
          throw new Error("fathom: the page has no <canvas>");
        }
        let canvas = canvases[0];
        for (const other of canvases) {
          if (other.width * other.height > canvas.width * canvas.height) {
            canvas = other;
          }
        }
        const ctx2d = canvas.getContext("2d");
        if (ctx2d === null) {
          throw new Error("fathom: the canvas has no 2D context");
        }
        return points.map((point) => {
          const x = Math.min(
            Math.max(point.x, 0),
            Math.max(canvas.width - 1, 0),
          );
          const y = Math.min(
            Math.max(point.y, 0),
            Math.max(canvas.height - 1, 0),
          );
          const { data } = ctx2d.getImageData(x, y, 1, 1);
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
  };

  const harness: Harness = {
    page,
    debug,
    surfaceFault,
    pageErrors,

    tick: () => tickCount,
    timeMs: () => timeMs,

    snapshot: () => debug.snapshot(),

    advance: async (count) => {
      if (count > 0) await drive(count);
    },

    skip: async (count) => {
      if (count > 0) await march(count);
    },

    until: (predicate, untilOptions = {}) =>
      sweep(() => debug.snapshot(), drive, predicate, untilOptions),

    skipUntil: (predicate, untilOptions = {}) =>
      sweep(() => debug.snapshot(), march, predicate, untilOptions),

    scan: async (count, poll = 1) => {
      if (count <= 0) return [];
      const stride = Math.max(1, poll);
      return run(count, stride, true, filmEvery(stride));
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
            window as unknown as { __fathomRec: { setMode(m: string): void } }
          ).__fathomRec.setMode("raf");
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
            window as unknown as { __fathomRec: { setMode(m: string): void } }
          ).__fathomRec.setMode("manual");
        },
        [HANDLE] as const,
      );
    },

    hold: (code) => page.keyboard.down(code),
    release: (code) => page.keyboard.up(code),
    async tap(code) {
      // Down, ONE tick, up. The tick between the two is what makes this a press a
      // build can actually see: an engineless build wrote its own keyboard layer,
      // and the two conformant ways to read a press — latching the edge in the
      // event handler, or comparing held state at the top of each tick — agree
      // only if the key is genuinely held while a tick runs.
      await page.keyboard.down(code);
      await drive(1);
      await page.keyboard.up(code);
    },

    async frameCalls() {
      // The one reader of a closed frame outside a capture, so this one is always
      // framed: `filmEvery` closes none when nothing is filming, and the ops this
      // reads back are exactly the ops the frame it asks for issued.
      await run(1, 1, false, 1, true);
      const ops = (await page.evaluate(() =>
        (
          window as unknown as { __fathomRec: { last(): unknown[] } }
        ).__fathomRec.last(),
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
    pixel: async (x, y) => (await readPixels([toDevice(view, x, y)]))[0],
    pixels: (points) => readPixels(points.map((p) => toDevice(view, p.x, p.y))),
    devicePixel: async (x, y) => (await readPixels([{ x, y }]))[0],
    scanDevice: (axis, index) => scanDevice(axis, index),

    surface: () =>
      page.evaluate(() => {
        const canvases = Array.from(document.querySelectorAll("canvas"));
        if (canvases.length === 0) {
          throw new Error(
            "fathom: the page has no <canvas>, so the build drew nowhere — " +
              "index.html supplies one and the build is asked not to edit it " +
              "(specs/overview.md)",
          );
        }
        let canvas = canvases[0];
        for (const other of canvases) {
          if (other.width * other.height > canvas.width * canvas.height) {
            canvas = other;
          }
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
      // is bound to nothing, so arming changes no game state.
      await page.keyboard.press(UNBOUND_KEY);
    },

    async dispose() {
      // The context stays: it holds the init scripts and the window shape, and the
      // next harness of this shape wants both. The page goes, so nothing this
      // check pressed, opened or muted can reach the next one.
      openPages.delete(page);
      await page.close().catch(() => undefined);
    },
  };

  harnessCues.set(harness, cueSinks);
  harnessFilming.set(harness, filming);
  return harness;
}

/**
 * Advance a harness until `predicate` holds, over whichever of the two drives the
 * caller chose.
 *
 * GUARD AGAINST A VACUOUS PASS. The first read is taken BEFORE anything is driven,
 * so a sweep reports a hit at zero ticks when the predicate already held. That is
 * the honest answer, and it is also the trap: a check that sweeps for "the game
 * left live play" without first establishing that it was IN live play passes on a
 * game that was never playing. Capture the state the scenario needs before the
 * sweep, not from the sweep.
 */
async function sweep(
  read: () => Promise<FathomSnapshot>,
  run: (count: number) => Promise<FathomSnapshot>,
  predicate: (snapshot: FathomSnapshot) => boolean,
  options: UntilOptions,
): Promise<UntilResult> {
  const maxTicks = options.maxTicks ?? 600;
  const poll = Math.max(1, options.poll ?? 1);

  let snapshot = await read();
  if (predicate(snapshot)) return { hit: true, ticks: 0, snapshot };

  let count = 0;
  while (count < maxTicks) {
    const stride = Math.min(poll, maxTicks - count);
    snapshot = await run(stride);
    count += stride;
    if (predicate(snapshot)) return { hit: true, ticks: count, snapshot };
  }
  return { hit: false, ticks: count, snapshot };
}

/** Where {@link watchCues} attaches, per harness. */
const harnessCues = new WeakMap<Harness, TimedCue[][]>();

/**
 * Whether a {@link captureReplay} is keeping each harness's frames right now.
 *
 * What tells a driven run that its frames are being WATCHED, and so how finely it
 * has to close them — see the harness's own `strideFor`. A capture that is not
 * running leaves a run free to cover its ticks in one `advance` and one of the
 * build's renders instead of one apiece.
 */
const harnessFilming = new WeakMap<Harness, { on: boolean; closed: number }>();

/* ---- Reaching live play --------------------------------------------------- */

/**
 * Reset on a seed and enter live play, through the debug surface alone.
 *
 * `reset` restores every field to its title-screen value and `setScreen` puts
 * the game straight into live play (`specs/instrumentation.md`), so this reaches
 * the board a dive is played on without pressing a menu key: a build with a
 * broken title menu and correct movement must fail the menu points and pass the
 * movement ones. A check that is ABOUT the menus drives them itself and never
 * calls this.
 *
 * The board it leaves is the game's OWN: the maze a reset laid out, a plankton
 * on every corridor tile, and the depth's roster in the den. A check poses the
 * world it is about on top of that, and {@link poseMaze} is what strips this one
 * away.
 *
 * An omitted `seed` takes `DEFAULT_SEED` (`1`), which
 * `specs/instrumentation.md` fixes, so a scenario that turns on the board a
 * build laid out replays exactly either way.
 */
export async function startPlaying(
  h: Harness,
  seed?: number,
): Promise<FathomSnapshot> {
  await h.debug.reset(seed === undefined ? undefined : { seed });
  await h.debug.setScreen("playing");
  return h.snapshot();
}

/* ---- The fit -------------------------------------------------------------- */

/**
 * How the stage maps onto a surface of this shape, as `specs/overview.md` fixes
 * it: one uniform scale, the whole stage inside, centred, with the leftover split
 * evenly into two bars carrying the stage's background color.
 *
 * Computed rather than read from the build, deliberately. Under an engine the fit
 * is the engine's and a check can ask it what it derived; here the fit is the
 * build's own work, so asking it would be asking a build to grade itself. Every
 * check but `presentation/window-fit` runs at the stage's own size, where this is
 * the identity and the question does not arise.
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

/* ---- Reading colors ------------------------------------------------------- */

/**
 * A sampled color, each channel `0`-`255`.
 *
 * The alpha a canvas reports here is always opaque, so a reading is three
 * channels and every bound a check states on one is a distance in that space.
 */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** One sampled device pixel, as a color. */
export function rgbOf(pixel: Pixel): Rgb {
  return { r: pixel[0], g: pixel[1], b: pixel[2] };
}

/** The mean color over a run of sampled pixels. */
export function meanColor(pixels: readonly Pixel[]): Rgb {
  const sum = pixels.reduce(
    (acc, [r, g, b]) => ({ r: acc.r + r, g: acc.g + g, b: acc.b + b }),
    { r: 0, g: 0, b: 0 },
  );
  return {
    r: sum.r / pixels.length,
    g: sum.g / pixels.length,
    b: sum.b / pixels.length,
  };
}

/**
 * How far apart two colors are, as a euclidean distance in RGB.
 *
 * The checks that bound this state their tolerances out of `441`
 * (`sqrt(3) * 255`), which is the largest distance this can return.
 */
export function colorDistance(a: Rgb, b: Rgb): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

/** A color's mean channel value, out of `255`. */
export function luminance(color: Rgb): number {
  return (color.r + color.g + color.b) / 3;
}

/**
 * The offsets a tile is sampled at, in logical units from its center.
 *
 * Four units out, which stays well inside one `TILE` (`32`), so the whole
 * cluster is on the tile it is sampling. A cluster rather than one pixel is what
 * keeps a stray anti-aliased pixel or a hair of dithering from swinging a
 * reading, and it is the same five points the engine-backed harnesses read, so a
 * point can state one threshold and mean the same thing by it under all three.
 */
const TILE_CLUSTER: readonly (readonly [number, number])[] = [
  [0, 0],
  [4, 0],
  [-4, 0],
  [0, 4],
  [0, -4],
];

/**
 * The mean color at each tile's center, in the order given.
 *
 * Every sample crosses into the page, so the whole set is taken in ONE crossing
 * rather than one per tile.
 */
export async function sampleTiles(
  h: Pick<Harness, "pixels">,
  grid: GridFrame,
  tiles: readonly Tile[],
): Promise<Rgb[]> {
  const points = tiles.flatMap((tile) => {
    const center = tileCenter(grid, tile);
    return TILE_CLUSTER.map(([dx, dy]) => ({
      x: center.x + dx,
      y: center.y + dy,
    }));
  });
  const read = await h.pixels(points);
  return tiles.map((_unused, index) =>
    meanColor(
      read.slice(
        index * TILE_CLUSTER.length,
        (index + 1) * TILE_CLUSTER.length,
      ),
    ),
  );
}

/** The mean color at one tile's center, on the board a snapshot reports. */
export async function tileColor(
  h: Pick<Harness, "pixels">,
  snapshot: FixtureBoard,
  tile: Tile,
): Promise<Rgb> {
  const [color] = await sampleTiles(h, snapshot.grid, [tile]);
  return color;
}

/* ---- Reading a mote ------------------------------------------------------- */

/** One sample of a mote's profile: the mean color of a ring about its center. */
export interface MoteSample {
  radius: number;
  color: Rgb;
}

/**
 * The radii, in logical units out from a mote's center, a profile is read at.
 *
 * WHY A PROFILE AND NOT ONE RING. `specs/sensing.md` fixes the mote's color and
 * that it is a single glowing point, and nothing else: not its radius, not how
 * bright its core is, not how fast the glow falls off. A build that draws the
 * light tighter paints an unmistakable amber mote that one fixed ring reads as
 * dark fog, and a build that draws it wider blows that ring out to white. Both
 * are the mote the specification asks for, so "is it warm" is asked of the
 * profile rather than of one arbitrary ring.
 */
export const MOTE_RADII: readonly number[] = [0, 2, 4, 6, 8, 10];

/** How far from a reported position a mote's drawn light may sit, in units. */
export const MOTE_SEARCH = 12;

/** How many points a ring is averaged over. */
const RING_POINTS = 6;

/** The points of one ring about a center, or the center itself at radius `0`. */
export function ringPoints(
  x: number,
  y: number,
  radius: number,
): { x: number; y: number }[] {
  if (radius === 0) return [{ x, y }];
  return Array.from({ length: RING_POINTS }, (_unused, i) => {
    const angle = (i / RING_POINTS) * Math.PI * 2;
    return { x: x + radius * Math.cos(angle), y: y + radius * Math.sin(angle) };
  });
}

/**
 * The mean color over a ring of `radius` units about a logical point.
 *
 * An amber mote's core blows out toward white by design, so the amber hue reads
 * in the halo around it rather than at the center.
 */
export async function sampleRing(
  h: Pick<Harness, "pixels">,
  x: number,
  y: number,
  radius: number,
): Promise<Rgb> {
  return meanColor(await h.pixels(ringPoints(x, y, radius)));
}

/**
 * The color is RED-LEANING: the reading `specs/overview.md` gives the two amber
 * lights, "red-leaning and clearly warmer than the water, the rock, and the
 * forager's own light".
 *
 * The one predicate for the whole suite. Every reading of an amber light — the
 * bulb, the drifter, the pair a sonar pulse must leave alone, the light the
 * Kindle circle clips away — asks this and nothing else, so two checks cannot
 * disagree about what amber is. Deliberately a HUE test and nothing more: the
 * palette is the build's, and no figure anywhere fixes how bright an amber mote
 * is or how fast its glow falls off, so a threshold on brightness would fail a
 * build that draws a dimmer light and satisfies every stated requirement.
 */
export function isWarm(color: Rgb): boolean {
  return color.r > color.b;
}

/**
 * The brightest not-cool point within {@link MOTE_SEARCH} of `(x, y)`: a mote's
 * drawn center, wherever on the body the build chose to put it.
 *
 * A mote is drawn on a creature, and where on that creature the light sits is the
 * build's art: one draws the glow on the entity's center, another puts it at the
 * top of the sprite as a bulb on a bell would be. `specs/sensing.md` fixes the
 * light's color and that it is always drawn; it does not fix it to the unit the
 * snapshot reports the creature at. Cool pixels are rejected, so the trench and
 * the forager's own glow cannot be mistaken for one; an amber core that blows out
 * toward white is not, which is why the test is `r >= b` rather than
 * {@link isWarm}.
 *
 * Falls back to `(x, y)` when the neighborhood holds nothing that is not cool, so
 * a build that draws no mote is read exactly where it should have drawn one.
 */
export async function findMote(
  h: Pick<Harness, "pixels">,
  x: number,
  y: number,
): Promise<{ x: number; y: number }> {
  const points: { x: number; y: number }[] = [];
  for (let dy = -MOTE_SEARCH; dy <= MOTE_SEARCH; dy += MOTE_FIND_STEP) {
    for (let dx = -MOTE_SEARCH; dx <= MOTE_SEARCH; dx += MOTE_FIND_STEP) {
      points.push({ x: x + dx, y: y + dy });
    }
  }
  const read = await h.pixels(points);
  let center = { x, y };
  let brightest = -1;
  for (const [index, pixel] of read.entries()) {
    const color = rgbOf(pixel);
    if (color.r < color.b) continue;
    const score = luminance(color);
    if (score > brightest) {
      brightest = score;
      center = points[index];
    }
  }
  return center;
}

/** How coarsely {@link findMote} walks a mote's neighborhood, in logical units. */
const MOTE_FIND_STEP = 6;

/** A mote's color profile, innermost first, read about its own drawn center. */
export async function sampleMoteProfile(
  h: Pick<Harness, "pixels">,
  x: number,
  y: number,
): Promise<MoteSample[]> {
  return moteProfileAbout(h, await findMote(h, x, y));
}

/** A mote's color profile read about a center already measured. */
export async function moteProfileAbout(
  h: Pick<Harness, "pixels">,
  center: { x: number; y: number },
): Promise<MoteSample[]> {
  const rings = MOTE_RADII.map((radius) =>
    ringPoints(center.x, center.y, radius),
  );
  const read = await h.pixels(rings.flat());
  let taken = 0;
  return MOTE_RADII.map((radius, index) => {
    const color = meanColor(read.slice(taken, taken + rings[index].length));
    taken += rings[index].length;
    return { radius, color };
  });
}

/**
 * How far apart two motes are drawn: the LARGEST color distance between their
 * samples at the same radius.
 *
 * Comparing like radius with like keeps the reading honest. Two motes drawn
 * identically match at every radius, and one drawn differently — a wider halo, a
 * colder core, a body drawn beneath — separates somewhere in the profile even
 * where it happens to agree on one ring.
 */
export function profileDistance(
  a: readonly MoteSample[],
  b: readonly MoteSample[],
): number {
  let worst = 0;
  for (let i = 0; i < a.length && i < b.length; i += 1) {
    worst = Math.max(worst, colorDistance(a[i].color, b[i].color));
  }
  return worst;
}

/**
 * The brightest WARM sample of a profile, or `null` when none of it reads warm.
 *
 * Brightest, because an amber core is the brightest thing in a dark trench and a
 * check that settled for the dim outer halo would measure the glow's falloff
 * rather than the light. Warm, because that core blows out toward white on a
 * build that draws it hot, and taking the brightest sample without regard to hue
 * would read that blow-out as neutral and call an unmistakable amber mote cold.
 */
export function warmInProfile(
  profile: readonly MoteSample[],
): MoteSample | null {
  let best: MoteSample | null = null;
  for (const sample of profile) {
    if (!isWarm(sample.color)) continue;
    if (best === null || luminance(sample.color) > luminance(best.color)) {
      best = sample;
    }
  }
  return best;
}

/**
 * How finely {@link nearSamples} walks a mote's neighborhood, in logical units.
 *
 * Three units across the {@link MOTE_SEARCH} reach is 81 samples, fine enough to
 * land inside the halo of a mote a build draws only a few units across, and
 * coarse enough that a check reading two creatures pays for it once.
 */
export const MOTE_STEP = 3;

/** One sample of the neighborhood a creature's mote would be drawn in. */
export interface NearSample {
  color: Rgb;
  x: number;
  y: number;
}

/**
 * Every pixel within {@link MOTE_SEARCH} of `(x, y)`, on a fixed grid.
 *
 * Read one point at a time rather than averaged, because a mote is small: a
 * cluster average over the whole neighborhood would wash an unmistakable light
 * out to the fog around it.
 */
async function nearSamples(
  h: Pick<Harness, "pixels">,
  x: number,
  y: number,
): Promise<NearSample[]> {
  const points: { x: number; y: number }[] = [];
  for (let dy = -MOTE_SEARCH; dy <= MOTE_SEARCH; dy += MOTE_STEP) {
    for (let dx = -MOTE_SEARCH; dx <= MOTE_SEARCH; dx += MOTE_STEP) {
      points.push({ x: x + dx, y: y + dy });
    }
  }
  const read = await h.pixels(points);
  return points.map((point, index) => ({
    color: rgbOf(read[index]),
    x: point.x,
    y: point.y,
  }));
}

/** The brightest pixel within {@link MOTE_SEARCH} of `(x, y)`, whatever its hue. */
export async function brightestNear(
  h: Pick<Harness, "pixels">,
  x: number,
  y: number,
): Promise<NearSample> {
  const samples = await nearSamples(h, x, y);
  return samples.reduce((best, sample) =>
    luminance(sample.color) > luminance(best.color) ? sample : best,
  );
}

/**
 * The brightest RED-LEANING pixel within {@link MOTE_SEARCH} of `(x, y)`, or
 * `null` where the neighborhood holds none: a creature's amber light, wherever on
 * its body the build chose to draw it.
 *
 * The hue test is {@link isWarm} and nothing more. HOW FAR above the fog it must
 * read is stated by the check, against a fog sample the check took itself.
 */
export async function brightestWarmNear(
  h: Pick<Harness, "pixels">,
  x: number,
  y: number,
): Promise<NearSample | null> {
  let best: NearSample | null = null;
  for (const sample of await nearSamples(h, x, y)) {
    if (!isWarm(sample.color)) continue;
    if (best === null || luminance(sample.color) > luminance(best.color)) {
      best = sample;
    }
  }
  return best;
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
// build itself drew while a check drove it, kept as evidence a reviewer can scrub
// and compare against the reference implementation's. `captureReplay` is how a
// check produces one.
//
// Four properties are what make it usable, and each is deliberate:
//
// 1. IT RECORDS THE SECTION, NOT THE RUN. The recorder is armed around the
//    caller's scenario and disarmed the moment that scenario returns, so what is
//    kept is the part the check is ABOUT and never the setup that got there. On
//    top of that, `skip` closes no frame at all, so a march inside a captured
//    section costs the clip nothing either.
// 2. IT IS EVIDENCE, NEVER A VERDICT. The scenario's own value comes straight
//    back, and a scenario that THROWS still writes what it had recorded before the
//    failure travels on — a failing check is the one whose replay a reviewer most
//    wants. A recording that cannot be written is reported as an output that never
//    turned up, which is a fact about the host rather than about the build.
// 3. IT WRITES ONLY WHAT THERE IS TO LOOK AT. A capture that closed no frames
//    leaves no file, so the run reports the output absent instead of offering the
//    reviewer a replay of nothing.
// 4. IT COSTS NOTHING WHEN NOBODY IS COLLECTING. Outside a run the media directory
//    is unset and the whole thing is a no-op that still runs the scenario, so a
//    check cannot pass in one place and fail in the other.

/** The environment variable the runner names the media directory in. */
const MEDIA_DIR_ENV = "TCAB_VALIDATION_MEDIA_DIR";

/**
 * The directory the runner stages this project to inside the build's tree.
 *
 * A recording is addressed by the STAGED path of the suite that produced it —
 * `validation/fog/unrevealed-black.test.ts` — because that is the path the review
 * item's declared script resolves to, and so the only name the case's manifest and
 * the runner both already agree on. Stating the prefix here is what keeps that
 * address the same when this suite is run in place against a reference
 * implementation, where the project root is `validation/none/` instead.
 */
const STAGED_PROJECT_DIR = "validation";

/**
 * The most frames a written recording holds.
 *
 * The injected recorder already holds the page's side to twice this, decimating as
 * it fills, so what arrives here is at most a few hundred frames however long the
 * section ran. This is the same cap the engine-backed harness writes under, so a
 * replay recorded under either engine is the same size of thing.
 */
const MAX_REPLAY_FRAMES = 300;

/**
 * The ground the console's player paints behind a recorded frame.
 *
 * The specification fixes no stage color by name: the build paints its own
 * background each tick, and the recorded frames carry that paint. What the player
 * needs is a color for the canvas under them, and `specs/overview.md` puts the
 * letterbox bars in the stage's background color over a game whose whole subject
 * is the dark, so black is what a replay says.
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
  transform: number[] | null;
  lineDash: number[] | null;
  /** The clip region in force, as the segments that built it, in order. */
  clip: RecordedPathSegment[];
  /** The current path, as the operations issued since the last `beginPath`. */
  path: RecordedPathSegment[];
}

/** One run of path operations, and the transform they were issued under. */
export interface RecordedPathSegment {
  transform: number[] | null;
  ops: RecordedOp[];
}

/** A value the context produced, as the recipe that rebuilds it. */
export interface RecordedResource {
  make: { method: string; args: unknown[] };
  then: RecordedOp[];
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
  images: unknown[];
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
 * the file that no frame asks for — dead weight in a document whose whole point is
 * to say each thing once, and the bulk of it in a game that draws a fog of war
 * procedurally and so repeats almost nothing between frames.
 *
 * Every entry here is reached from a kept frame, and every reference inside one is
 * rewritten as it is reached, transitively. What is deduplicated is the rewritten
 * entry, so an operation two hundred frames issue identically is written once and
 * named two hundred times, and every index a frame carries addresses the table it
 * was interned into.
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
  const images: unknown[] = [];
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
    if (typeof record.$res === "number") {
      return { $res: takeResource(record.$res) };
    }
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
 * `count` is left as it was recorded, so a reader can see that frames were skipped
 * rather than being told a smooth lie. The last frame is always kept whatever the
 * stride lands on — it is the frame the check's sweep stopped at, and the one a
 * reviewer looks at first.
 *
 * Keeping it costs a frame rather than the cap. The stride rounds up, so a section
 * whose length is an exact multiple of the cap strides over exactly that many
 * frames and stops one stride short of the end: the last frame still has to come
 * in, and the cap is a ceiling rather than a target. It takes the place of the
 * final strided frame — the frame nearest it, so the swap opens the smallest gap
 * available anywhere in the section — and is measured from where that frame was
 * measured from, which is what keeps the kept deltas summing to the elapsed time.
 *
 * What survives is then re-expressed against tables of its own, so the file
 * carries what the kept frames draw with and nothing the dropped ones did.
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
 * What lands on disk is gzip rather than raw JSON. A recording is text made almost
 * entirely of numbers and repeated field names, which gzip takes down to a
 * fraction of its size, and every host that serves one declares the encoding so
 * the browser inflates it before the player sees it.
 *
 * Never throws. A file that cannot be written says something about the machine the
 * validators ran on, and failing the point over it would blame the build for the
 * host's problem.
 */
function writeReplay(destination: string, recording: Recording | null): void {
  if (recording === null || recording.frames.length === 0) return;
  try {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, gzipSync(JSON.stringify(thinReplay(recording))));
  } catch (error) {
    console.warn(`fathom: could not write ${destination}: ${String(error)}`);
  }
}

/**
 * Record the frames `scenario` drives and keep them as the review item's
 * `outputId` output, handing back whatever the scenario returned.
 *
 * Wrap the drive, not the arrangement:
 *
 * ```ts
 * const run = await captureReplay(h, "move", () => driveHeldKey(h, "ArrowUp"));
 * assertEqual(run.after.dir, "up");
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
        window as unknown as { __fathomRec: { arm(d: unknown): boolean } }
      ).__fathomRec.arm(design),
    { width: STAGE_W, height: STAGE_H, background: REPLAY_BACKGROUND },
  );
  const filming = harnessFilming.get(h);
  if (filming !== undefined) {
    filming.on = true;
    filming.closed = 0;
  }
  try {
    return await scenario();
  } finally {
    if (filming !== undefined) filming.on = false;
    // In a `finally`, so a scenario that failed still leaves its evidence behind.
    const recording = (await h.page.evaluate(() =>
      (
        window as unknown as { __fathomRec: { disarm(): unknown } }
      ).__fathomRec.disarm(),
    )) as Recording | null;
    writeReplay(destination, recording);
  }
}

/**
 * Keep the picture currently on the canvas as the review item's `outputId` output.
 *
 * The companion to {@link captureReplay}, for a point whose evidence is one
 * PICTURE rather than a stretch of motion: what the unrevealed fog looks like,
 * where the den chamber sits, which screen the game opened on.
 *
 * What is written is whatever the last tick that RAN left behind, so call it after
 * the tick that poses the thing under test and before the assertions, so a check
 * that fails still leaves the picture that shows why. Nothing here can change a
 * verdict: outside a run this is a no-op, and a still that cannot be written is
 * reported as an output that never turned up.
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
    console.warn(`fathom: could not write ${destination}: ${String(error)}`);
  }
}

/* -------------------------------------------------------------------------- */
/* Cues                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Record every sound the build emits from now on, stamped with the tick of the
 * drive it sounded on.
 *
 * WHAT IS OBSERVED, AND WHY IT IS THE FAIR READING. `specs/progression.md`
 * requires one cue per event, played on the tick its event happens, and says
 * nothing at all about how a build makes a sound — under this engine the whole
 * audio layer is the build's. So `audio-init.js` watches the two doors a browser
 * can emit sound through (a Web Audio source being `start()`ed, whatever kind it
 * is, and an `<audio>` element being played) and counts what goes through them;
 * the harness brackets each driven tick around that count, so a sound is
 * attributed to the tick that produced it. A blip made of two oscillators counts
 * as two, which is why a check asserts that a tick sounded rather than how many
 * times: the number of sources is the build's business and the specification never
 * fixed it.
 *
 * WHAT IS LOST HERE THAT AN ENGINE GIVES. The cue's NAME. Under an engine the game
 * asks the bus for a cue by name and the bus announces it, so a build that plays
 * its descend blip on every bite is caught. There is no bus here to ask, so these
 * checks confirm that a sound was emitted and on which tick, and a reviewer decides
 * by ear whether the seven are told apart. That is a real reduction, and the
 * alternative — inferring the cue from the waveform the reference happens to use —
 * would grade builds against an implementation rather than against the
 * specification.
 *
 * ONLY {@link Harness.advance} ATTRIBUTES A SOUND TO A TICK. `skip` runs its ticks
 * in one call and cannot say which of them sounded, so a cue check advances over
 * the moment it is about.
 */
export function watchCues(h: Harness): TimedCue[] {
  const played: TimedCue[] = [];
  harnessCues.get(h)?.push(played);
  return played;
}
