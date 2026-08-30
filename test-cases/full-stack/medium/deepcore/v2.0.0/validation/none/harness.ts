// Deepcore — the shared validator harness. CASE-PROVIDED.
//
// Every check in this project is an ordinary vitest test that drives the built
// site IN A REAL BROWSER. There is nothing to import: an engineless run seeds no
// `src/` at all, so the build wrote its own frame loop, its own canvas fit, its
// own keyboard, its own audio, its own asset loading, and its own
// `window.__deepcore` — and the only place all of that exists is a page that has
// loaded the bundle and the assets it produced. So the project serves `dist/`,
// loads it in Chromium, and reaches the game the way anything reaches it: over
// the surface `specs/instrumentation.md` told the build to install.
//
// IT IS STILL A VITEST PROJECT, AND THAT IS DELIBERATE. The runner locates the
// build output before it chooses between the vitest and browser paths, so `dist/`
// is on disk by the time this project runs. Staying a vitest project is what lets
// the case name ONE script per review item and have it resolve under every engine
// — `validation/drilling/down-cut-sinks.test.ts` is the same path whichever
// runtime the run selected — and what keeps `format = 2` resolution passing.
//
// WHAT A CHECK READS. The game's own state (through `window.__deepcore`'s
// `snapshot` and `tileAt`), the frames the harness itself drove, the operations
// the build issued against its 2D context, the pixels those operations left on
// the canvas, and the sounds the build emitted. Nothing here fabricates an
// outcome: the scenario helpers below only ARRANGE the world through the surface,
// and the real update the build wrote is what runs from there.
//
// THE CLOCK IS THE SURFACE'S. Nothing outside an engineless build owns its loop,
// so `specs/instrumentation.md` puts the clock on the surface: `setAutoStep(false)`
// takes the game off real time and `advance(seconds, frames)` runs whole frames of
// a chosen length. Every harness opens by taking the game off the clock, so a
// check asks for a number of frames and gets exactly that number — no polling, no
// waiting, and no measurement of the machine it ran on. A check that is ABOUT the
// loop running itself hands it back with `runFor`.
//
// EVERYTHING CROSSING INTO THE PAGE IS ASYNC. That is the whole of the difference
// between a suite here and its counterpart under an engine: `await h.snapshot()`
// rather than `h.snapshot()`, `await h.debug.setFuel(40)` rather than
// `h.debug.setFuel(40)`. The scenarios, the tolerances, and the assertions are
// the same ones, because they are the case's rather than the runtime's.
//
// ONE SERVER, ONE BROWSER, ONE PAGE PER HARNESS. `globalSetup.ts` starts the
// server and the browser once for the whole project; this module connects to them
// from inside each suite's worker and opens a page per harness, so every check
// drives a build that has just started and no check can be affected by what the
// one before it pressed, opened, bought or muted.
//
// AND EVERY COMPOUND SEQUENCE LIVES HERE. The surface is atomic by design: one
// field, one reading, one clock move. Opening a scene, holding a faculty, laying a
// seam, standing the miner on a cell, sinking a shaft, reaching a building — none
// of those is an operation, and each of them is several. They are built once here,
// out of the atomic operations, and shared by every validator; a check that needs
// only part of a sequence calls the operations it needs.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { expect, inject } from "vitest";
import type { Browser, BrowserContext, Page } from "playwright";
import { connectChromium } from "./chromium";
import { fail } from "./assert";
import {
  BAND_ORDER,
  CAVE_MOUTH_COL,
  CORE_COL,
  DEFAULT_SEED,
  HUD_H,
  MINER_H,
  MINER_W,
  ORES,
  PLAYABLE_COL_MAX,
  PLAYABLE_COL_MIN,
  SPAWN_COL,
  STAGE_H,
  STAGE_W,
  SURFACE_Y,
  TILE,
  UNBOUND_KEY,
  bandIndexAt,
  coreRowFor,
  depthFraction,
  rowAtFraction,
} from "./constants";
import type {
  Band,
  Facing,
  ItemId,
  Material,
  Mode,
  Ore,
  Screen,
  TileKind,
  UpgradeTrack,
  WorldSize,
} from "./constants";
import { REQUIRED_OPS } from "./surface";
import type {
  BuildingBox,
  CellRef,
  DeepcoreDebugApi,
  DeepcoreSnapshot,
  MinerView,
  TileRead,
} from "./surface";

export * from "./surface";

declare module "vitest" {
  export interface ProvidedContext {
    /** Where the built site is served, from `globalSetup.ts`. */
    deepcoreUrl: string;
    /** The one Chromium every suite worker connects to. */
    deepcoreBrowserWs: string;
  }
}

/* -------------------------------------------------------------------------- */
/* The contract the build owes                                                */
/* -------------------------------------------------------------------------- */

/** The handle an engineless build installs its surface on. */
export const HANDLE = "__deepcore";

/**
 * What `specs/instrumentation.md` requires of the surface: the `Expected:` line
 * of the failure a build with no usable surface lands on every check that reaches
 * for it, beside the {@link Harness.surfaceFault} that says what was found.
 */
export const SURFACE_REQUIREMENT =
  `a usable debug and automation surface on window.${HANDLE} as soon as the ` +
  `game has initialized, carrying every operation specs/instrumentation.md ` +
  `requires`;

/**
 * Fail the running check on `fault`, the harness's account of what is wrong with
 * the build's surface, paired with what the specification requires.
 */
export function failSurface(fault: string): never {
  return fail(SURFACE_REQUIREMENT, fault);
}

/* -------------------------------------------------------------------------- */
/* The step schedule                                                          */
/* -------------------------------------------------------------------------- */
//
// The suite chooses the size of a frame, because the specification deliberately
// fixes none: every rate in this game is per second and is integrated against the
// elapsed time of the frame, so a build must reach the same place however that
// time was divided. The default is a steady 120 Hz, which makes every duration
// this specification states a whole number of frames — the drill's 0.125 s hit is
// 15 of them, the hurt state's 0.4 s is 48, the notice's 1.5 s delay is 180 — and
// that is the unit the tolerances in this project were established in. The check
// that is ABOUT the step size drives the same scenario under the other schedules
// here.

/** A source of frame deltas, in milliseconds. */
export interface Clock {
  /** The next frame's delta, in ms. */
  delta(): number;
}

/** The frame the suite steps in, in milliseconds. */
export const TICK_HZ = 120;
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
 * neighbouring outputs.
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

/** Seconds of simulated time in `ticks` frames of the default clock. */
export function seconds(ticks: number): number {
  return ticks / TICK_HZ;
}

/** Frames of the default clock covering `s` seconds, rounded to the nearest. */
export function ticks(s: number): number {
  return Math.max(1, Math.round(s * TICK_HZ));
}

/** A speed in units per second from a displacement measured over `n` frames. */
export function speedOverTicks(delta: number, n: number): number {
  return (Math.abs(delta) * TICK_HZ) / n;
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
  /** The clock each frame takes its delta from. Defaults to 120 Hz. */
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
  snapshot: DeepcoreSnapshot;
}

export interface Harness {
  /** The page the build is running in. For a check that needs Playwright itself. */
  readonly page: Page;
  /**
   * The surface the BUILD installed, as operations that cross into the page.
   *
   * Read off `window.__deepcore` and never constructed here — see
   * {@link unexposedSurface}.
   */
  readonly debug: DeepcoreDebugApi;
  /**
   * Why the build's surface cannot be driven, or `null` when it can.
   *
   * A fault here is the build's: the surface is missing, or it is missing an
   * operation the specification requires. It says what was found
   * (`window.__deepcore was still absent 5s after the page loaded`), and
   * {@link failSurface} pairs it with what the specification requires. Every
   * operation fails by assertion with that pair rather than throwing, so the
   * fault lands on the points whose checks reach the game through the surface.
   */
  readonly surfaceFault: string | null;
  /** Everything the page logged to `console.error`, or threw, oldest first. */
  readonly pageErrors: string[];

  /** The frames this harness has driven, 1-based, as a recorded frame counts them. */
  frame(): number;
  /** The simulated time those frames covered, in milliseconds. */
  timeMs(): number;

  /** A fresh read of the game's state through the build's `snapshot`. */
  snapshot(): Promise<DeepcoreSnapshot>;
  /** One cell's state, through the build's `tileAt`. */
  tileAt(col: number, row: number): Promise<TileRead>;

  /** Run `frames` frames back to back, each the length the clock says. */
  advance(frames: number): Promise<void>;
  /**
   * Run `s` seconds of game time in `frames` whole frames of `s / frames` each.
   *
   * `frames` defaults to the harness clock's own count, so `advanceSeconds(2)` is
   * `advance(240)`. A check about a LONG span names a smaller count instead: the
   * Core Sample's ninety seconds, the notice's eight-second fade, a fuel drain
   * measured over a minute. Every rate in this game is integrated against the
   * frame's delta, so a coarser division reaches the same outcome — and `advance`
   * RENDERS every frame it runs, so asking for ninety frames rather than ten
   * thousand is most of what decides how long such a check takes.
   */
  advanceSeconds(s: number, frames?: number): Promise<void>;
  /** Advance until `predicate` holds, sampling every `poll` frames. */
  until(
    predicate: (snapshot: DeepcoreSnapshot) => boolean,
    options?: UntilOptions,
  ): Promise<UntilResult>;
  /** Hand the game back to its own frame loop for `ms` of real time, then take it back. */
  runFor(ms: number): Promise<void>;

  /**
   * Put a key down through the surface and leave it down, as a player holding it
   * would. Released by {@link release}, by {@link releaseAll}, or by a `reset`.
   */
  hold(code: string): Promise<void>;
  /** Let a key held by {@link hold} up. */
  release(code: string): Promise<void>;
  /** Let up every key this harness put down, in the order it put them down. */
  releaseAll(): Promise<void>;
  /**
   * Put a key down, run the one frame that delivers it, and let it up.
   *
   * A press that ran no frame would never reach the game, and a press released
   * before a frame ran would be invisible to a build that reads its keyboard by
   * comparing held state between frames — so the frame goes between the two.
   */
  tap(code: string): Promise<void>;

  /**
   * Press a key through CHROMIUM'S OWN keyboard rather than through the surface.
   *
   * The surface's `keyDown` is the specified driver and is what every scenario
   * below uses: `specs/instrumentation.md` requires an injected key to flow
   * through the same handling the real keyboard feeds, so driving through it
   * exercises the build's own bindings. What it cannot prove is the sentence
   * BEFORE that one — that the runtime the build wrote reads a real
   * `KeyboardEvent.code` off the page at all. That is what these three are for,
   * and a check about the keyboard layer itself uses them.
   */
  browserHold(code: string): Promise<void>;
  browserRelease(code: string): Promise<void>;
  browserTap(code: string): Promise<void>;

  /** Run exactly one frame and hand back every operation its render issued. */
  frameCalls(): Promise<DrawCall[]>;
  /** Reflect the surface without invoking it: `typeof` for each name, and the version. */
  probe(
    names: readonly string[],
  ): Promise<{ version: unknown; ops: Record<string, string> }>;

  /** How the stage is mapped onto this harness's canvas. */
  viewport(): Viewport;
  /** Where a logical stage point lands in the canvas's backing store. */
  device(x: number, y: number): { x: number; y: number };
  /** The device pixel under a logical stage point, as `[r, g, b, a]`. */
  pixel(x: number, y: number): Promise<[number, number, number, number]>;
  /** Many logical stage points at once, in one crossing into the page. */
  pixels(
    points: readonly { x: number; y: number }[],
  ): Promise<[number, number, number, number][]>;
  /** A pixel addressed in the canvas's own backing store, past the fit. */
  devicePixel(x: number, y: number): Promise<[number, number, number, number]>;
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
 * How long the surface is waited for before the build is called non-conformant.
 *
 * Generous against a conformant build and cheap against one: the wait is a poll
 * that returns the instant the global appears, and a build installs it while its
 * entry module runs, so a page that has fired `load` has either installed it
 * already or is not going to. A full-stack build LOADS the assets it produced
 * before the game is built, though, which is why this is a wait at all rather
 * than a read — a sprite sheet coming off a loopback server is still a decode.
 * What the ceiling really bounds is the cost of a build with no surface at all,
 * which pays it once per harness.
 */
const SURFACE_TIMEOUT_MS = 10_000;

let browserPromise: Promise<Browser> | null = null;

async function sharedBrowser(): Promise<Browser> {
  browserPromise ??= connectChromium(inject("deepcoreBrowserWs"));
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
 * one thing the window-fit check varies. Everything else about a harness is the
 * page: a fresh one opens on a build that has just started, with no key held, no
 * audio context opened, and the mute preference back off, which is a stronger
 * guarantee than any reset the surface offers, since `reset()` deliberately
 * leaves muting and the save slot alone.
 *
 * A page per harness rather than a page reused between them, because a check may
 * legitimately hold two harnesses at once — a delta-time check runs the same
 * probe under two step sizes — and a harness whose page had been taken over by a
 * later one would read someone else's game while looking exactly like it worked.
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
 * A proxy rather than a hand-written stub, because a stub would have to restate
 * the surface's fifty-odd operations and would report anything it had missed as
 * merely absent rather than as the consequence of the build's missing install.
 *
 * Keys that belong to the MACHINERY rather than to a check are answered with
 * `undefined` instead: awaiting a value probes `then`, and vitest's own error
 * formatting probes symbols and `constructor`. Failing those would replace the
 * verdict below with noise from the machinery that was trying to report it.
 */
function unexposedSurface(reason: string): DeepcoreDebugApi {
  return new Proxy({} as DeepcoreDebugApi, {
    get: (_target, property): unknown => {
      if (typeof property === "symbol") return undefined;
      if (property === "then" || property === "constructor") return undefined;
      return () => failSurface(reason);
    },
  });
}

/**
 * What is wrong with the surface this page installed, or `null` when nothing is:
 * the surface never appeared, or it appeared without an operation the
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
 * The default shape is the stage's own size at one device pixel per CSS pixel, so
 * a logical coordinate and a canvas pixel are the same thing and no check but the
 * window-fit one has to think about the fit at all.
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

  await page.goto(inject("deepcoreUrl"), { waitUntil: "load" });

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

  // Every key this harness put down and has not let up, in the order it did.
  const held: string[] = [];

  const debug =
    surfaceFault !== null
      ? unexposedSurface(surfaceFault)
      : (new Proxy({} as DeepcoreDebugApi, {
          get: (_target, property): unknown => {
            if (typeof property === "symbol") return undefined;
            if (property === "then" || property === "constructor")
              return undefined;
            const name = String(property);
            return (...args: unknown[]) => {
              // `reset` releases every key, so the harness's record of what is
              // down has to agree with the game's.
              if (name === "reset") held.length = 0;
              return call(name, args);
            };
          },
        }) as DeepcoreDebugApi);

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
            window as unknown as { __deepcoreRec: { ready(): boolean } }
          ).__deepcoreRec.ready(),
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
   * Run one frame per entry of `deltas` and read the state they left, in one
   * crossing.
   *
   * Each frame is opened and closed around a single `advance(dt, 1)`, all inside
   * one synchronous evaluation, so nothing the page's own animation frame
   * renders can land inside a recorded frame — and so a frame the recorder keeps
   * is exactly one frame the game ran.
   */
  const drive = async (
    deltasMs: readonly number[],
  ): Promise<DeepcoreSnapshot> => {
    if (surfaceFault !== null) refuse();
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
            __deepcoreRec: Record<string, (...a: unknown[]) => unknown>;
          }
        ).__deepcoreRec;
        const audio = (
          window as unknown as { __deepcoreAudio: { started(): number } }
        ).__deepcoreAudio;
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
      [HANDLE, [...deltasMs]] as const,
    )) as { snapshot: DeepcoreSnapshot; sounds: number[] };

    for (const [index, delta] of deltasMs.entries()) {
      frameCount += 1;
      timeMs += delta;
      for (let n = 0; n < result.sounds[index]; n += 1) {
        for (const sink of cueSinks)
          sink.push({ frame: frameCount, t: timeMs });
      }
    }
    return result.snapshot;
  };

  /** `n` frames of the harness's own clock. */
  const driveTicks = async (n: number): Promise<DeepcoreSnapshot> => {
    const deltas: number[] = [];
    for (let i = 0; i < n; i += 1) deltas.push(clock.delta());
    return drive(deltas);
  };

  /**
   * Let the page's OWN loop run twice.
   *
   * A key delivered through Chromium arrives as a DOM event, and an engineless
   * build is free to act on it in its own frame rather than in the handler — the
   * specification requires the runtime to report whether an action went down THIS
   * FRAME, which is a frame the build's loop opens. `advance` is not that loop, so
   * a browser key followed straight by a read would be read before the page had
   * had a chance to see it. Two animation frames, because the first is the one
   * that may already have been scheduled before the key landed.
   *
   * Nothing here advances the simulation: the game is off its clock, so the
   * build's loop draws and drains its input and steps nothing.
   */
  const settlePage = (): Promise<void> =>
    page.evaluate(
      () =>
        new Promise<void>((done) => {
          requestAnimationFrame(() => requestAnimationFrame(() => done()));
        }),
    );

  const readPixels = async (
    devicePoints: readonly { x: number; y: number }[],
  ): Promise<[number, number, number, number][]> =>
    page.evaluate(
      (points) => {
        const canvases = Array.from(document.querySelectorAll("canvas"));
        if (canvases.length === 0)
          throw new Error("deepcore: the page has no <canvas>");
        let canvas = canvases[0];
        for (const other of canvases) {
          if (other.width * other.height > canvas.width * canvas.height)
            canvas = other;
        }
        const ctx = canvas.getContext("2d");
        if (ctx === null)
          throw new Error("deepcore: the canvas has no 2D context");
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
    tileAt: (col, row) => debug.tileAt(col, row),

    advance: async (frames) => {
      await driveTicks(frames);
    },

    advanceSeconds: async (s, frames = ticks(s)) => {
      if (frames < 1 || !Number.isInteger(frames)) {
        throw new RangeError(
          `advanceSeconds needs a whole number of frames of at least 1, got ${frames}`,
        );
      }
      await drive(new Array<number>(frames).fill((s * 1000) / frames));
    },

    async until(predicate, untilOptions = {}) {
      const maxFrames = untilOptions.maxFrames ?? 600;
      const poll = Math.max(1, untilOptions.poll ?? 1);

      let snapshot = await this.snapshot();
      if (predicate(snapshot)) return { hit: true, frames: 0, snapshot };

      let frames = 0;
      while (frames < maxFrames) {
        const step = Math.min(poll, maxFrames - frames);
        snapshot = await driveTicks(step);
        frames += step;
        if (predicate(snapshot)) return { hit: true, frames, snapshot };
      }
      return { hit: false, frames, snapshot };
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
            window as unknown as { __deepcoreRec: { setMode(m: string): void } }
          ).__deepcoreRec.setMode("raf");
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
            window as unknown as { __deepcoreRec: { setMode(m: string): void } }
          ).__deepcoreRec.setMode("manual");
        },
        [HANDLE] as const,
      );
    },

    async hold(code) {
      if (!held.includes(code)) held.push(code);
      await debug.keyDown(code);
    },
    async release(code) {
      const at = held.indexOf(code);
      if (at >= 0) held.splice(at, 1);
      await debug.keyUp(code);
    },
    async releaseAll() {
      for (const code of [...held]) await this.release(code);
    },
    async tap(code) {
      // Down, ONE frame, up. The frame between the two is what makes this a press
      // a build can actually see: an engineless build wrote its own keyboard
      // layer, and the two conformant ways to read a press — latching the edge in
      // the event handler, or comparing held state at the top of each frame —
      // agree only if the key is genuinely held while a frame runs. A down and an
      // up delivered back to back would be invisible to the second, which is a
      // build a real player has no trouble with. Exactly one frame passes either
      // way, so nothing a caller counts moves.
      await this.hold(code);
      await driveTicks(1);
      await this.release(code);
    },

    async browserHold(code) {
      await page.keyboard.down(code);
      await settlePage();
    },
    browserRelease: (code) => page.keyboard.up(code),
    async browserTap(code) {
      await this.browserHold(code);
      await driveTicks(1);
      await page.keyboard.up(code);
    },

    async frameCalls() {
      await driveTicks(1);
      const ops = (await page.evaluate(() =>
        (
          window as unknown as { __deepcoreRec: { last(): unknown[] } }
        ).__deepcoreRec.last(),
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

    surface: () =>
      page.evaluate(() => {
        const canvases = Array.from(document.querySelectorAll("canvas"));
        if (canvases.length === 0) {
          throw new Error(
            "deepcore: the page has no <canvas>, so the build drew nowhere — " +
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
      // delivered any other way would leave a perfectly good build silent. The
      // key is bound to nothing, so arming changes no game state.
      await page.keyboard.press(UNBOUND_KEY);
    },

    async dispose() {
      // The context stays: it holds the init scripts and the window shape, and
      // the next harness of this shape wants both. The page goes, so nothing this
      // check pressed, opened, bought or muted can reach the next one.
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
 * it: one uniform scale, the whole stage inside, centred, with the leftover split
 * evenly into two bars carrying the stage's background colour.
 *
 * Computed rather than read from the build, deliberately. Under an engine the fit
 * is the engine's and a check can ask it what it derived; here the fit is the
 * build's own work, so asking it would be asking a build to grade itself. Every
 * check but the window-fit one runs at the stage's own size, where this is the
 * identity and the question does not arise; that one runs at other shapes and
 * reads the pixels against what the specification says should be there.
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

/* -------------------------------------------------------------------------- */
/* World geometry                                                             */
/* -------------------------------------------------------------------------- */
//
// The mine has a coordinate space of its own, in the same logical units as the
// stage, and the viewport is a window onto it. Nothing here reads the build: each
// is the arithmetic `specs/world.md` states, so a check that samples a pixel over
// a tile is sampling where the specification says that tile is drawn.

/** The world-space rectangle a cell occupies. */
export function cellRect(
  col: number,
  row: number,
): { x: number; y: number; w: number; h: number } {
  return { x: col * TILE, y: row * TILE, w: TILE, h: TILE };
}

/** The world-space centre of a cell. */
export function cellCenter(col: number, row: number): { x: number; y: number } {
  return { x: col * TILE + TILE / 2, y: row * TILE + TILE / 2 };
}

/** The cell a world point falls in. */
export function cellAt(x: number, y: number): CellRef {
  return { col: Math.floor(x / TILE), row: Math.floor(y / TILE) };
}

/** The world-space centre of the miner's box. */
export function minerCenter(miner: MinerView): { x: number; y: number } {
  return { x: miner.x + MINER_W / 2, y: miner.y + MINER_H / 2 };
}

/** The world `y` of the bottom of the miner's box: its feet. */
export function minerFeet(miner: MinerView): number {
  return miner.y + MINER_H;
}

/** The box `x` that centres the miner on `col`. */
export function minerXOn(col: number): number {
  return col * TILE + (TILE - MINER_W) / 2;
}

/** The box `y` of a miner standing on top of `row`. */
export function minerYOn(row: number): number {
  return row * TILE - MINER_H;
}

/** The box `y` of a miner standing on the camp ground. */
export const CAMP_MINER_Y = SURFACE_Y - MINER_H;

/**
 * Where a world point is drawn on the stage: `(wx - camX, wy - camY + HUD_H)`.
 *
 * The camera is read off the snapshot the caller already has, so the mapping is
 * the one in force at the frame that was sampled.
 */
export function worldToStage(
  snapshot: DeepcoreSnapshot,
  wx: number,
  wy: number,
): { x: number; y: number } {
  return {
    x: wx - snapshot.camera.x,
    y: wy - snapshot.camera.y + HUD_H,
  };
}

/** Whether a stage point falls inside the mine viewport rather than the status bar. */
export function inViewport(x: number, y: number): boolean {
  return x >= 0 && x <= STAGE_W && y >= HUD_H && y <= STAGE_H;
}

/** The band a row falls in, at the mine the snapshot describes. */
export function bandOfRow(snapshot: DeepcoreSnapshot, row: number): Band {
  return BAND_ORDER[bandIndexAt(depthFraction(row, snapshot.coreRow))];
}

/** A row well inside `band`, at a mine of `coreRow` rows: the band's midpoint. */
export function rowInBand(band: Band, coreRow: number): number {
  const index = BAND_ORDER.indexOf(band);
  return rowAtFraction((index + 0.5) / 4, coreRow);
}

/** The load fraction the snapshot reports: `loadKg / liftLimitKg`. */
export function loadFraction(snapshot: DeepcoreSnapshot): number {
  return snapshot.cargo.loadKg / snapshot.cargo.liftLimitKg;
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
//    kept is the part the check is ABOUT and never the setup that got there.
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
 * `validation/drilling/down-cut-sinks.test.ts` — because that is the path the
 * review item's declared script resolves to, and so the only name the case's
 * manifest and the runner both already agree on. Stating the prefix here is what
 * keeps that address the same when this project is run in place against a
 * reference implementation, where the project root is `validation/none/` instead.
 */
const STAGED_PROJECT_DIR = "validation";

/**
 * The most frames a written recording holds.
 *
 * The injected recorder already holds the page's side to twice this, decimating
 * as it fills, so what arrives here is at most a few hundred frames however long
 * the section ran. This is the same cap the engine-backed harness writes under,
 * so a replay recorded under either engine is the same size of thing.
 */
const MAX_REPLAY_FRAMES = 300;

/**
 * The ground the console's player paints behind a recorded frame.
 *
 * The specification fixes no palette: the build paints its own stage background
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
   *
   * A build may `save` on one frame and `restore` on the next, so the stack of
   * saved states survives a frame boundary along with the state on top of it. A
   * player pushes these before the frame's own state, which is what makes a
   * `restore` among the frame's operations return where the original returned.
   */
  stack: number[];
  /** Indices into the recording's `ops`, in the order the frame issued them. */
  ops: number[];
  /**
   * Whether part of what this frame inherited was too large for the format to
   * carry, and was cut down to the bound.
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

/**
 * A recording, as the console's player reads it.
 *
 * A frame names its state and its operations by index, and the values those
 * operations draw with — the gradients, the captured sprite sheets — live in
 * tables the whole recording shares. So every reference a frame makes resolves at
 * whichever frame a reviewer lands on, and each distinct thing is written once.
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
 * the file that no frame asks for — dead weight in a document whose whole point
 * is to say each thing once, and the bulk of it in a game that redraws a
 * scrolling tile field every frame.
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
    if (typeof record.$res === "number")
      return { $res: takeResource(record.$res) };
    const rewritten: Record<string, unknown> = {};
    for (const [key, held] of Object.entries(record)) {
      // Defined rather than assigned: a build's own object may carry a field
      // named `__proto__`, and assigning that name reaches the prototype setter
      // instead of writing a field the document carries.
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
      // The stride spent the whole budget on the way to a frame short of the
      // end. Drop the frame it stopped on, and put the moment back to the one
      // before it: a kept frame's restated delta is measured from exactly that
      // moment, so subtracting it recovers it, and the last frame's own delta
      // then spans the gap the two of them leave.
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
    console.warn(`deepcore: could not write ${destination}: ${String(error)}`);
  }
}

/**
 * Record the frames `scenario` drives and keep them as the review item's
 * `outputId` output, handing back whatever the scenario returned.
 *
 * Wrap the drive, not the arrangement:
 *
 * ```ts
 * const cut = await captureReplay(h, "shaft", () => driveDownCut(h));
 * assertEqual(cut.broke, true);
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
        window as unknown as { __deepcoreRec: { arm(d: unknown): boolean } }
      ).__deepcoreRec.arm(design),
    { width: STAGE_W, height: STAGE_H, background: REPLAY_BACKGROUND },
  );
  try {
    return await scenario();
  } finally {
    // In a `finally`, so a scenario that failed still leaves its evidence behind.
    const recording = (await h.page.evaluate(() =>
      (
        window as unknown as { __deepcoreRec: { disarm(): unknown } }
      ).__deepcoreRec.disarm(),
    )) as Recording | null;
    writeReplay(destination, recording);
  }
}

/**
 * Keep the picture currently on the canvas as the review item's `outputId`
 * output.
 *
 * The companion to {@link captureReplay}, for a point whose evidence is one
 * PICTURE rather than a stretch of motion: which screen the game opened on, what
 * a panel lists, where the letterbox bars fell, how a band's rock is drawn.
 *
 * What is written is whatever the last frame that RAN left behind, so call it
 * after the frame that poses the thing under test and before the assertions, so a
 * check that fails still leaves the picture that shows why. Nothing here can
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
    console.warn(`deepcore: could not write ${destination}: ${String(error)}`);
  }
}

/* -------------------------------------------------------------------------- */
/* Cues                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Record every sound the build emits from now on, stamped with the frame of the
 * drive it sounded on.
 *
 * WHAT IS OBSERVED, AND WHY IT IS THE FAIR READING. `specs/assets.md` fixes which
 * sounds the game produces and `specs/ui.md` when they are heard, and neither
 * says how a build makes a sound — under this engine the whole audio layer is the
 * build's. So `audio-init.js` watches the two doors a browser can emit sound
 * through (a Web Audio source being `start()`ed, whatever kind it is, and an
 * `<audio>` element being played) and counts what goes through them; the harness
 * brackets each driven frame around that count, so a sound is attributed to the
 * frame that produced it. A detonation made of two layered sources counts as two,
 * which is why a check asserts that a frame sounded rather than how many times:
 * the number of sources is the build's business.
 *
 * WHAT IS LOST HERE THAT AN ENGINE GIVES. The cue's NAME. Under an engine the
 * game asks the bus for a cue by name and the bus announces it, so a build that
 * plays its launch cue on every drill hit is caught. There is no bus here to ask,
 * so these checks confirm that a sound was emitted and on which frame, and a
 * reviewer decides by ear whether the cues are told apart. That is a real
 * reduction, and the alternative — inferring the cue from the waveform the
 * reference happens to produce — would grade builds against an implementation
 * rather than against the specification.
 */
export function watchCues(h: Harness): TimedCue[] {
  const played: TimedCue[] = [];
  harnessCues.get(h)?.push(played);
  return played;
}

/* -------------------------------------------------------------------------- */
/* Isolation: opening a scene                                                 */
/* -------------------------------------------------------------------------- */
//
// A validator poses an isolated world: it clears every entity its requirement is
// not about and puts back exactly what it is. In Deepcore that means an empty
// mine — no ore to bank by accident, no gas to detonate under the miner, no lava
// to drain hull while a fuel check runs — and a miner carrying only the faculties
// the requirement exercises. `reset` already leaves the mine empty, the cargo
// empty, the satchel empty and no supplies held, so a scene is that plus the
// screen, the size, and the faculties.

/** How a scene opens. Everything is optional; the defaults are the resting world. */
export interface SceneOptions {
  /** The generator's seed. Defaults to `DEFAULT_SEED`. */
  seed?: number;
  /**
   * The world size. Naming one also regenerates the grid, because `setWorldSize`
   * moves `coreRow` and leaves the cells where they were: a scene that changed
   * the size and not the grid would be one whose grid and `coreRow` disagree.
   */
  size?: WorldSize;
  /** The expedition's mode. Defaults to `standard`, as a `reset` leaves it. */
  mode?: Mode;
  /** The screen to open on. Defaults to `in-mine`. */
  screen?: Screen;
  /** Whether the miner's body moves. Defaults to on, as a `reset` leaves it. */
  travel?: boolean;
  /** Whether the miner's drill cuts. Defaults to on, as a `reset` leaves it. */
  drill?: boolean;
}

/**
 * The opening every posed check shares: the game off the clock, the world back at
 * its resting value on a named seed, and the screen the check is about.
 *
 * What it leaves is an EMPTY mine — `reset` restores the grid to what `clearMine`
 * leaves — with the miner standing at the camp, tier 1 everywhere, a full tank and
 * hull, no Credits, nothing held, and no notice fired. A check then places exactly
 * what its requirement is about.
 *
 * `muted` and the save slot are deliberately outside this, because `reset` leaves
 * both alone: a fresh page is what clears them, and every harness opens one.
 */
export async function openScene(
  h: Harness,
  options: SceneOptions = {},
): Promise<void> {
  await h.debug.setAutoStep(false);
  await h.debug.reset({ seed: options.seed ?? DEFAULT_SEED });
  if (options.size !== undefined) {
    await h.debug.setWorldSize(options.size);
    await h.debug.clearMine();
  }
  if (options.mode !== undefined) await h.debug.setMode(options.mode);
  await h.debug.setScreen(options.screen ?? "in-mine");
  if (options.travel !== undefined)
    await h.debug.setMinerTravel(options.travel);
  if (options.drill !== undefined) await h.debug.setMinerDrill(options.drill);
}

/**
 * Hold the miner's body still for what follows: gravity, walking, thrust,
 * knockback and collision displacement all move it nowhere.
 *
 * The faculty gate `specs/instrumentation.md` fixes, named for what it is FOR. A
 * check about the drill, about fuel burn, about a hazard's damage or about the
 * cargo does not want the miner falling out of the scenario it was posed in, and
 * everything else about the miner carries on: it still reads as grounded, still
 * starts and holds a cut, still spends fuel, still takes damage, and the camera
 * still follows it.
 */
export function pinMiner(h: Harness): Promise<void> {
  return h.debug.setMinerTravel(false);
}

/**
 * Hold the miner's drill for what follows: no cut starts, none progresses, no
 * cell loses health, nothing is banked, and no drill hit spends fuel.
 *
 * The companion gate. A check about movement, about the camera, about fall
 * impact or about fuel's other drains holds this, so a key held to steer the
 * miner cannot quietly bore a hole through the scenario.
 */
export function pinDrill(h: Harness): Promise<void> {
  return h.debug.setMinerDrill(false);
}

/* -------------------------------------------------------------------------- */
/* Isolation: laying the terrain a check is about                             */
/* -------------------------------------------------------------------------- */

/** Fill a run of cells down one column with one kind. */
export async function fillColumn(
  h: Harness,
  col: number,
  fromRow: number,
  toRow: number,
  kind: TileKind,
): Promise<void> {
  for (let row = fromRow; row <= toRow; row += 1) {
    await h.debug.setTile(col, row, kind);
  }
}

/** Fill a run of cells across one row with one kind. */
export async function fillRow(
  h: Harness,
  row: number,
  fromCol: number,
  toCol: number,
  kind: TileKind,
): Promise<void> {
  for (let col = fromCol; col <= toCol; col += 1) {
    await h.debug.setTile(col, row, kind);
  }
}

/** Fill a rectangular block of cells with one kind. */
export async function fillBlock(
  h: Harness,
  block: { fromCol: number; toCol: number; fromRow: number; toRow: number },
  kind: TileKind,
): Promise<void> {
  for (let row = block.fromRow; row <= block.toRow; row += 1) {
    await fillRow(h, row, block.fromCol, block.toCol, kind);
  }
}

/**
 * A floor across the whole playable width at `row`, so a miner anywhere above it
 * lands rather than falling out of the scenario.
 *
 * `rock` by default, because rock is the kind that yields nothing: a floor of ore
 * would bank a unit the moment a check drilled it, and a floor of gas would end
 * the check in a detonation.
 */
export function layFloor(
  h: Harness,
  row: number,
  kind: TileKind = "rock",
): Promise<void> {
  return fillRow(h, row, PLAYABLE_COL_MIN, PLAYABLE_COL_MAX, kind);
}

/**
 * Lay the camp's ground: `row 1` solid across the playable width, with the cave
 * mouth left open, exactly as generation leaves it.
 *
 * An empty mine is open everywhere, `row 0` included, so a miner posed at the
 * camp falls the moment the first frame runs. Generation leaves `row 1` minable
 * apart from `(CAVE_MOUTH_COL, 1)`, and that is what holds the miner up while it
 * walks the camp — so a scene about the surface, the buildings, or a panel lays
 * it back rather than posing the miner in mid-air and pinning it.
 */
export async function layCamp(
  h: Harness,
  kind: TileKind = "rock",
): Promise<void> {
  await layFloor(h, 1, kind);
  await h.debug.setTile(CAVE_MOUTH_COL, 1, "tunnel");
}

/**
 * Open every cell of a block, so a scenario has room to move through it.
 *
 * A cleared mine is already open everywhere, so this is for a scene that laid
 * terrain and now wants a pocket back — the run-up in front of a wall, the space
 * under a miner that must fall.
 */
export function openBlock(
  h: Harness,
  block: { fromCol: number; toCol: number; fromRow: number; toRow: number },
): Promise<void> {
  return fillBlock(h, block, "tunnel");
}

/**
 * Stand the miner on top of the cell `(col, row)`, centred on its column, at rest.
 *
 * THAT CELL IS THE FLOOR UNDERFOOT, and so the cell a held down cut bites into —
 * not the one below it. A check that wants a gas pocket under the drill poses it
 * at `(col, row)` and stands the miner here with the same `row`.
 *
 * The cell the miner's BOX occupies is the one above, so a scene lays its floor
 * at `row` and leaves `row - 1` open.
 */
export async function standOn(
  h: Harness,
  col: number,
  row: number,
  facing?: Facing,
): Promise<void> {
  await h.debug.setMinerPosition(minerXOn(col), minerYOn(row));
  await h.debug.setMinerVelocity(0, 0);
  if (facing !== undefined) await h.debug.setFacing(facing);
}

/** Put the miner's box at a world position, at rest. */
export async function placeAt(h: Harness, x: number, y: number): Promise<void> {
  await h.debug.setMinerPosition(x, y);
  await h.debug.setMinerVelocity(0, 0);
}

/** Stand the miner on the camp ground at `col`, where it spawns by default. */
export function standAtCamp(
  h: Harness,
  col: number = SPAWN_COL,
  facing?: Facing,
): Promise<void> {
  return standOn(h, col, 1, facing);
}

/**
 * A one-tile shaft down `col`, open from `fromRow` to `toRow`, standing on the
 * solid cell beneath it, with solid walls either side.
 *
 * The scene a climb, a fall, or a sink is measured in: the walls are what stop a
 * miner drifting laterally out of the column, and the floor is what a fall lands
 * on and a down cut bites into.
 */
export async function digShaft(
  h: Harness,
  col: number,
  fromRow: number,
  toRow: number,
  wall: TileKind = "rock",
): Promise<void> {
  await fillColumn(h, col, fromRow, toRow, "tunnel");
  await fillColumn(h, col - 1, fromRow, toRow, wall);
  await fillColumn(h, col + 1, fromRow, toRow, wall);
  await h.debug.setTile(col, toRow + 1, wall);
}

/** Put an ore vein at a cell, at its band's full health. */
export function layOre(
  h: Harness,
  col: number,
  row: number,
  ore: Ore,
): Promise<void> {
  return h.debug.setOreTile(col, row, ore);
}

/** Put a material node at a cell, at its band's full health. */
export function layMaterial(
  h: Harness,
  col: number,
  row: number,
  material: Material,
): Promise<void> {
  return h.debug.setMaterialTile(col, row, material);
}

/* -------------------------------------------------------------------------- */
/* Isolation: posing the expedition's holdings                                */
/* -------------------------------------------------------------------------- */

/**
 * Pose the cargo bay as exactly the ore listed, and nothing else.
 *
 * `setCargo` sets one ore's count and leaves the rest, so a scene that wants a
 * known load clears the bay first — otherwise it is posing a load on top of
 * whatever the check before it banked.
 */
export async function stageCargo(
  h: Harness,
  ore: Partial<Record<Ore, number>>,
): Promise<void> {
  await h.debug.clearCargo();
  for (const [id, count] of Object.entries(ore)) {
    await h.debug.setCargo(id as Ore, count as number);
  }
}

/**
 * Load the bay with `ore` until the load fraction is at least `fraction`, and
 * report the fraction reached.
 *
 * One unit of one ore at a time, because the load is whole units of whole ores:
 * a fraction is reached by the unit that crosses it rather than exactly, which is
 * the point of the overload wall — the flag flips on the unit that crosses the
 * limit. The count is derived from the lift limit the snapshot reports, so it
 * follows the jetpack tier the scene posed rather than assuming tier 1.
 */
export async function loadToFraction(
  h: Harness,
  fraction: number,
  ore: Ore = "ferron",
): Promise<{ count: number; fraction: number }> {
  await h.debug.clearCargo();
  const { cargo } = await h.snapshot();
  const weight = ORES[ore].weight;
  const count = Math.ceil((fraction * cargo.liftLimitKg) / weight);
  await h.debug.setCargo(ore, count);
  const after = await h.snapshot();
  return { count, fraction: loadFraction(after) };
}

/** Pose the six field-supply counts as exactly what is listed, and nothing else. */
export async function stageItems(
  h: Harness,
  items: Partial<Record<ItemId, number>>,
): Promise<void> {
  await h.debug.clearItems();
  for (const [id, count] of Object.entries(items)) {
    await h.debug.setItemCount(id as ItemId, count as number);
  }
}

/** Pose every upgrade track at one tier, so a check reads one configuration. */
export async function stageTiers(
  h: Harness,
  tiers: Partial<Record<UpgradeTrack, number>>,
): Promise<void> {
  for (const [track, tier] of Object.entries(tiers)) {
    await h.debug.setTier(track as UpgradeTrack, tier as number);
  }
}

/* -------------------------------------------------------------------------- */
/* Compound sequences                                                         */
/* -------------------------------------------------------------------------- */
//
// Each of these poses a situation through `window.__deepcore` and then lets the
// real simulation run. The geometry and the tolerances they encode are the ones
// the specification established, and they are the same in the engine-backed
// projects next door.

/**
 * One key per action, for the sequences that press one.
 *
 * The FIRST code the specification binds to each action, because an action bound
 * to several is satisfied by any of them and a scenario needs one. A check about
 * the bindings presses each of them itself.
 */
export const ACTION_KEY = {
  left: "KeyA",
  right: "KeyD",
  down: "KeyS",
  up: "KeyW",
  activate: "KeyE",
  inventory: "KeyI",
  pause: "Escape",
  mute: "KeyM",
  jettison: "KeyJ",
  supply1: "Digit1",
  supply2: "Digit2",
  supply3: "Digit3",
  supply4: "Digit4",
  supply5: "Digit5",
  supply6: "Digit6",
} as const;

/**
 * Open an expedition through the SURFACE alone: the mode, the size, a mine
 * generated from the seed, and the miner standing at the spawn.
 *
 * This is how a check about the MINE reaches its ground without driving the
 * menus — a build with a broken menu and a working world must fail the navigation
 * checks and pass the generation ones. A check about the menus enters with
 * {@link startWithKeys} instead.
 */
export async function openExpedition(
  h: Harness,
  options: { seed?: number; size?: WorldSize; mode?: Mode } = {},
): Promise<void> {
  await h.debug.setAutoStep(false);
  await h.debug.reset({ seed: options.seed ?? DEFAULT_SEED });
  if (options.mode !== undefined) await h.debug.setMode(options.mode);
  if (options.size !== undefined) await h.debug.setWorldSize(options.size);
  await h.debug.generateMine();
  await h.debug.setScreen("in-mine");
  await standAtCamp(h);
}

/**
 * Start an expedition from the title the way a player does: menu keys only.
 *
 * The title menu leads with `CONTINUE` only while a save exists, so this clears
 * the slot first — otherwise the index every step below counts from moves under
 * it, and a check about the menus would be reading a menu it did not mean to
 * open. `NEW EXPEDITION` then leads, the mode is one step down for Hardcore, and
 * the size is however many steps down its entry sits.
 */
export async function startWithKeys(
  h: Harness,
  options: { mode?: Mode; size?: WorldSize } = {},
): Promise<void> {
  const mode = options.mode ?? "standard";
  const size = options.size ?? "standard";
  await h.debug.clearSave();
  await h.debug.reset();
  await h.debug.setScreen("title");

  const down = ACTION_KEY.down;
  const confirm = ACTION_KEY.activate;

  // title -> mode-select, on `NEW EXPEDITION`, which leads with no save banked.
  await h.tap(confirm);
  // mode-select: STANDARD leads, HARDCORE is one down.
  if (mode === "hardcore") await h.tap(down);
  await h.tap(confirm);
  // size-select: QUICK, STANDARD, MARATHON, in that order.
  const steps = { quick: 0, standard: 1, marathon: 2 }[size];
  for (let i = 0; i < steps; i += 1) await h.tap(down);
  await h.tap(confirm);
}

/**
 * Stand the miner at the building `id`, on the camp ground, and report its
 * footprint.
 *
 * The footprints are the BUILD'S — `specs/world.md` fixes only that each sits on
 * the ground line inside the playable columns, spaced apart — so a check that
 * activates one asks the surface where it is rather than assuming a layout. The
 * miner is centred on the footprint, which is the one spot inside it whatever
 * reach the build gives its buildings.
 */
export async function standAtBuilding(
  h: Harness,
  id: string,
): Promise<BuildingBox> {
  const boxes = await h.debug.buildings();
  const box = boxes.find((b) => b.id === id);
  if (box === undefined) {
    fail(
      `a surface building with id "${id}" among the six specs/world.md fixes`,
      `buildings() reported ${boxes.length === 0 ? "none" : boxes.map((b) => b.id).join(", ")}`,
    );
  }
  await placeAt(h, box.x + box.w / 2 - MINER_W / 2, CAMP_MINER_Y);
  return box;
}

/** What a driven cut did. */
export interface CutResult {
  /** Whether the target cell broke inside the sweep. */
  broke: boolean;
  /** Frames driven before the sample that saw it break. */
  frames: number;
  /** The cell as it stands at the end of the sweep. */
  tile: TileRead;
  snapshot: DeepcoreSnapshot;
}

/**
 * Hold a direction until the cell it cuts breaks, and report the instant it did.
 *
 * The real drill: the key goes down through the surface's own input, the game's
 * update lands the hits at its own interval and spends its own fuel, and the
 * sweep watches the cell rather than the clock. Sampled every frame, because the
 * frame the cell breaks on is what several checks read.
 *
 * The key is released before this returns, so a caller reads a settled miner
 * rather than one still boring into whatever was behind the cell.
 */
export async function driveCut(
  h: Harness,
  direction: "down" | "left" | "right",
  target: CellRef,
  options: UntilOptions = {},
): Promise<CutResult> {
  const code = ACTION_KEY[direction];
  await h.hold(code);
  try {
    // The sweep is over the CELL rather than the snapshot, which is what
    // `until` reads, so the loop is written out here rather than borrowed.
    const maxFrames = options.maxFrames ?? 600;
    const poll = Math.max(1, options.poll ?? 1);
    let frames = 0;
    let tile = await h.tileAt(target.col, target.row);
    while (frames < maxFrames && tile.kind !== "tunnel") {
      const step = Math.min(poll, maxFrames - frames);
      await h.advance(step);
      frames += step;
      tile = await h.tileAt(target.col, target.row);
    }
    return {
      broke: tile.kind === "tunnel",
      frames,
      tile,
      snapshot: await h.snapshot(),
    };
  } finally {
    await h.release(code);
  }
}

/** What a held movement did. */
export interface MoveResult {
  /** The miner's box position before the measured window. */
  start: { x: number; y: number };
  /** And after it. */
  end: { x: number; y: number };
  dx: number;
  dy: number;
  snapshot: DeepcoreSnapshot;
}

/**
 * Hold a key for `frames` frames and report how far the miner's box travelled.
 *
 * Nothing here poses a velocity: the key goes down and the game's own movement
 * code moves the miner, so what is measured is the build's walk, thrust or fall
 * rather than an integration the harness did.
 */
export async function driveHold(
  h: Harness,
  code: string,
  frames: number,
  options: { leadFrames?: number } = {},
): Promise<MoveResult> {
  await h.hold(code);
  try {
    // With a lead, the key is already down for `leadFrames` before the measured
    // window opens, so the window reads a miner in steady travel rather than the
    // frame the press was first seen on.
    if (options.leadFrames) await h.advance(options.leadFrames);
    const before = (await h.snapshot()).miner;
    await h.advance(frames);
    const after = await h.snapshot();
    return {
      start: { x: before.x, y: before.y },
      end: { x: after.miner.x, y: after.miner.y },
      dx: after.miner.x - before.x,
      dy: after.miner.y - before.y,
      snapshot: after,
    };
  } finally {
    await h.release(code);
  }
}

/**
 * Drop the miner from `height` world units above the floor at `(col, floorRow)`
 * and run the real physics until it lands, reporting the speed it landed at and
 * the hull it cost.
 *
 * The fall is the game's own: gravity, the terminal speed the load sets, and the
 * impact rule all run from a miner posed at rest in open air.
 */
export async function driveFall(
  h: Harness,
  col: number,
  floorRow: number,
  height: number,
  options: UntilOptions = {},
): Promise<{
  landed: boolean;
  impactSpeed: number;
  hullBefore: number;
  hullAfter: number;
  snapshot: DeepcoreSnapshot;
}> {
  await placeAt(h, minerXOn(col), minerYOn(floorRow) - height);
  const before = (await h.snapshot()).miner;
  let fastest = 0;
  const swept = await h.until(
    (s) => {
      if (s.miner.vy > fastest) fastest = s.miner.vy;
      return s.miner.grounded;
    },
    { maxFrames: options.maxFrames ?? 900, poll: options.poll ?? 1 },
  );
  // One frame past the first that reads as grounded. A build is free to report a
  // miner about to touch down as grounded — the flag says it is resting on solid
  // ground, and a probe a unit or two ahead of the box is a conformant way to
  // answer that — so the frame the flag first turns on is not necessarily the
  // frame the contact was resolved and the hull was billed on. The extra frame
  // costs a settled miner nothing and is what makes the reading the LANDING
  // rather than the approach to it. The speed is the fastest the sweep saw, which
  // is the speed it arrived at whichever frame resolved it.
  if (swept.hit) await h.advance(1);
  const settled = await h.snapshot();
  return {
    landed: swept.hit,
    impactSpeed: fastest,
    hullBefore: before.hull,
    hullAfter: settled.miner.hull,
    snapshot: settled,
  };
}

/* -------------------------------------------------------------------------- */
/* Rendering and colour                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The RGB distance two sampled colours must exceed to count as "clearly apart".
 *
 * `specs/overview.md` requires that a player tells one band's rock from the next,
 * an ore vein from plain rock, a gemstone from an ore, and lava from safe ground,
 * and it deliberately fixes no palette — so distinguishability is the whole of
 * what a visibility check can read, and a number is the only way to read it. 50
 * of the 441 the RGB cube spans: comfortably crossed by two colours a player
 * would call different, and not by two shades of the same one.
 */
export const DISTINCT_MIN = 50;

/** A sampled colour, each channel 0–255. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** The five offsets a colour sample is averaged over, in logical units. */
const SAMPLE_OFFSETS: readonly (readonly [number, number])[] = [
  [0, 0],
  [6, 0],
  [-6, 0],
  [0, 6],
  [0, -6],
];

/**
 * The rendered colour at a logical stage point, averaged over a small cluster.
 *
 * The centre pixel plus four neighbours 6 units out, which at an 80-unit tile
 * stays well inside the cell whatever the build drew there, so one stray
 * anti-aliased or glowing pixel cannot swing the reading.
 */
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

/**
 * The rendered colour over the centre of a WORLD cell, through the camera the
 * snapshot reports.
 *
 * The reading a terrain check takes: pose one cell, drive a frame, and sample
 * where the specification says that cell is drawn.
 */
export async function sampleCell(
  h: Harness,
  snapshot: DeepcoreSnapshot,
  col: number,
  row: number,
): Promise<Rgb> {
  const centre = cellCenter(col, row);
  const at = worldToStage(snapshot, centre.x, centre.y);
  return sampleColor(h, at.x, at.y);
}

/** Euclidean distance between two colours, 0 to about 441. */
export function colorDistance(a: Rgb, b: Rgb): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

/* ---- Reading one frame's render ------------------------------------------- */

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

/** One run of text a frame drew, and where it drew it in canvas pixels. */
export interface TextDraw {
  text: string;
  /** The anchor the run was drawn at, mapped through the transform in force. */
  x: number;
  y: number;
}

/** A 2D affine transform, in the canvas's `[a, b, c, d, e, f]` order. */
type Matrix = [number, number, number, number, number, number];

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

/**
 * Every run of text the frame drew, with its anchor in canvas pixels.
 *
 * A build is free to draw under a transform — to translate to the status bar and
 * draw at the origin, or to translate by the camera and draw the world in world
 * units — so the position a `fillText` names is only where the text landed once
 * the transform in force at that call is applied. This walks the frame's
 * operations and carries that transform: `save`/`restore`, `translate`, `scale`,
 * `rotate`, `transform`, `setTransform` and `resetTransform`. At the harness's
 * default shape the canvas is the stage at one pixel per unit, so the result is
 * in logical units as well.
 */
export function textDraws(calls: readonly DrawCall[]): TextDraw[] {
  const draws: TextDraw[] = [];
  const stack: Matrix[] = [];
  let current: Matrix = IDENTITY;
  for (const call of calls) {
    if (call.kind !== "call") continue;
    const { method, args } = call;
    if (method === "save") {
      stack.push(current);
    } else if (method === "restore") {
      current = stack.pop() ?? IDENTITY;
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
    } else if (method === "fillText" || method === "strokeText") {
      const [text] = args;
      const at = numbers(args.slice(1), 2);
      if (typeof text !== "string" || at === null) continue;
      const [x, y] = at;
      draws.push({
        text,
        x: current[0] * x + current[2] * y + current[4],
        y: current[1] * x + current[3] * y + current[5],
      });
    }
  }
  return draws;
}

/**
 * The geometry calls a frame made, by name.
 *
 * Enough of a count to compare two frames of the same scene: a frame that drew a
 * scanner indicator asked for strictly more of these than the same frame with
 * nothing locked, whatever shape the build chose to draw it as.
 */
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
 * Every logical point a frame's drawing calls named.
 *
 * The leading pair of arguments is the position for every method listed, except
 * the curve calls, whose control points come first and whose endpoint is the last
 * pair.
 */
export function drawnPoints(
  calls: readonly DrawCall[],
): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  const push = (x: unknown, y: unknown): void => {
    if (typeof x === "number" && typeof y === "number") points.push({ x, y });
  };

  for (const call of calls) {
    if (call.kind !== "call") continue;
    const { method, args } = call;
    if (
      method === "arc" ||
      method === "ellipse" ||
      method === "rect" ||
      method === "roundRect" ||
      method === "fillRect" ||
      method === "strokeRect" ||
      method === "moveTo" ||
      method === "lineTo" ||
      method === "drawImage"
    ) {
      push(args[0], args[1]);
    } else if (method === "quadraticCurveTo") {
      push(args[0], args[1]);
      push(args[2], args[3]);
    } else if (method === "bezierCurveTo") {
      push(args[0], args[1]);
      push(args[2], args[3]);
      push(args[4], args[5]);
    }
  }
  return points;
}

/* -------------------------------------------------------------------------- */
/* Small shared readings                                                      */
/* -------------------------------------------------------------------------- */

/** The Core tile's cell at a size, without asking the build where it is. */
export function coreCell(size: WorldSize): CellRef {
  return { col: CORE_COL, row: coreRowFor(size) };
}
