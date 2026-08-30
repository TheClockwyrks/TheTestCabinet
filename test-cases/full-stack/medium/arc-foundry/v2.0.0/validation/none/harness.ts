// Arc Foundry — the shared validator harness. CASE-PROVIDED.
//
// Every check in this project is an ordinary vitest test that drives the built
// site IN A REAL BROWSER. There is nothing to import: an engineless run seeds no
// `src/` at all, so the build wrote its own frame loop, its own canvas fit, its
// own keyboard and pointer, its own audio, its own asset loading, and its own
// `window.__foundry` — and the only place all of that exists is a page that has
// loaded the bundle. So the project serves `dist/`, loads it in Chromium, and
// reaches the game the way anything reaches it: over the surface the
// specification told the build to install.
//
// IT IS STILL A VITEST PROJECT, AND THAT IS DELIBERATE. The runner locates the
// build output before it chooses between the vitest and browser paths, so `dist/`
// is on disk by the time this project runs. Staying a vitest project is what lets
// the case name ONE script per review item and have it resolve under every engine
// — `validation/firing/in-range.test.ts` is the same path whichever runtime the
// run selected — and what keeps `format = 2` resolution passing.
//
// WHAT A CHECK READS. The game's own state (through `window.__foundry`'s
// `snapshot`), the four control readings, the frames the harness itself drove,
// the operations the build issued against its 2D context, the pixels those
// operations left on the canvas, and the sounds the build emitted. Nothing here
// fabricates an outcome: the scenario helpers below only ARRANGE the yard through
// the surface, and the real update the build wrote is what runs from there.
//
// THE CLOCK IS THE SURFACE'S. Nothing outside an engineless build owns its loop,
// so `specs/instrumentation.md` puts the clock on the surface: `setAutoStep(false)`
// takes the game off real time and `advance(seconds, frames)` runs whole frames of
// a chosen length. Every harness opens by taking the game off the clock, so a
// check asks for a number of frames and gets exactly that number — no polling, no
// waiting, and no measurement of the machine it ran on.
//
// EVERYTHING CROSSING INTO THE PAGE IS ASYNC. That is the whole of the difference
// between a suite here and its counterpart under an engine: `await h.snapshot()`
// rather than `h.snapshot()`, `await h.debug.setCharge(500)` rather than
// `debug.setCharge(state, 500)`. The scenarios, the tolerances, and the assertions
// are the same ones, because they are the case's rather than the runtime's.
//
// ONE SERVER, ONE BROWSER, ONE PAGE PER HARNESS. `globalSetup.ts` starts the
// server and the browser once for the whole project; this module connects to them
// from inside each suite's worker and opens a page per harness, so every check
// drives a build that has just started and no check can be affected by what the
// one before it pressed, placed or muted.
//
// AND THIS FILE OWNS EVERY COMPOUND SEQUENCE. The surface is atomic by design: one
// operation sets one field. Opening a run, emptying the yard, standing one
// structure up, releasing one held unit, pressing one named control — each of
// those is several operations in a fixed order, and each lives HERE so that a
// hundred suites say what their scenario is about in one line and say it the same
// way. A check that needs only part of a sequence calls the operations it needs.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { expect, inject } from "vitest";
import type { Browser, BrowserContext, Page } from "playwright";
import { connectChromium } from "./chromium";
import { assertTruthy, fail } from "./assert";
import {
  DEFAULT_SEED,
  STAGE_H,
  STAGE_W,
  STAMPS_PER_LEVEL,
  TARGETING_PRIORITIES,
  UNBOUND_KEY,
  keyFor,
  structureCenter,
  tileCenter,
  type Action,
  type ComboId,
  type ComponentType,
  type DifficultyId,
  type MapId,
  type MenuAction,
  type PanelAction,
  type Point,
  type PressAction,
  type Screen,
  type SpawnType,
  type StatusAction,
  type Targeting,
  type Tier,
} from "./constants";
import {
  HANDLE,
  REQUIRED_OPS,
  type DrivenFoundryDebugApi,
  type FoundrySnapshot,
  type MenuButton,
  type PanelButton,
  type PressButton,
  type StatusControl,
  type StructureView,
  type UnitView,
} from "./surface";

export {
  HANDLE,
  REQUIRED_OPS,
  FOUNDRY_DEBUG_VERSION,
  type FoundrySnapshot,
  type MenuButton,
  type PanelButton,
  type PressButton,
  type StatusControl,
  type StructureView,
  type UnitView,
} from "./surface";

declare module "vitest" {
  export interface ProvidedContext {
    /** Where the built site is served, from `globalSetup.ts`. */
    foundryUrl: string;
    /** The one Chromium every suite worker connects to. */
    foundryBrowserWs: string;
  }
}

/* -------------------------------------------------------------------------- */
/* The step schedule                                                          */
/* -------------------------------------------------------------------------- */
//
// The suite chooses the size of a frame, because the specification deliberately
// fixes none: every rate in this game is per second and is integrated against the
// elapsed time of the frame, so a build must reach the same place however that
// time was divided. The default is a steady 120 Hz, which makes every duration
// below a whole number of frames — and which keeps a projectile's step
// (`PROJECTILE_SPEED / 120`, about 4.3 units) inside its own hit radius, so a
// shot's arrival is a fact about the game rather than about the step size.

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
    const step = this.stepsMs[this.index % this.stepsMs.length]!;
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

/** Frames of the default clock covering `s` seconds, rounded up. */
export function ticks(s: number): number {
  return Math.ceil(s * TICK_HZ);
}

/** A speed in units per second from a displacement measured over `n` frames. */
export function speedOverTicks(delta: number, n: number): number {
  return (Math.abs(delta) * TICK_HZ) / n;
}

/** The straight-line distance between two points. */
export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
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
  snapshot: FoundrySnapshot;
}

export interface Harness {
  /** The page the build is running in. For a check that needs Playwright itself. */
  readonly page: Page;
  /**
   * The surface the BUILD installed, as operations that cross into the page.
   *
   * Read off `window.__foundry` and never constructed here — see
   * {@link unexposedSurface}.
   */
  readonly debug: DrivenFoundryDebugApi;
  /**
   * Why the build's surface cannot be driven, or `null` when it can.
   *
   * A fault here is the build's: the surface is missing, or it is missing an
   * operation the specification requires. It says what was found
   * (`window.__foundry was still absent 5s after the page loaded`), and
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
  snapshot(): Promise<FoundrySnapshot>;
  /** Run `frames` frames back to back, each the length the clock says. */
  advance(frames: number): Promise<void>;
  /** Run whole frames of the default clock covering `s` seconds of game time. */
  advanceSeconds(s: number): Promise<void>;
  /** Advance until `predicate` holds, sampling every `poll` frames. */
  until(
    predicate: (snapshot: FoundrySnapshot) => boolean,
    options?: UntilOptions,
  ): Promise<UntilResult>;
  /** Hand the game back to its own frame loop for `ms` of real time, then take it back. */
  runFor(ms: number): Promise<void>;

  /** Press a real key and leave it down, as a player holding it would. */
  hold(code: string): Promise<void>;
  /** Release a real key held by `hold`. */
  release(code: string): Promise<void>;
  /**
   * Press a real key, run the one frame that delivers it, and release it.
   *
   * A press that ran no frame would never reach the game, and a press released
   * before a frame ran would be invisible to a build that reads its keyboard by
   * comparing held state between frames — so the frame goes between the two.
   */
  tap(code: string): Promise<void>;

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
 * already or is not going to. What the ceiling really bounds is the cost of a
 * build with no surface at all, which pays it once per harness — and there is a
 * cap on the whole suite run, so a wait long enough to exhaust it would turn
 * "every point this decides failed" into "the validators did not run", which
 * tells a reviewer far less.
 */
const SURFACE_TIMEOUT_MS = 5_000;

let browserPromise: Promise<Browser> | null = null;

async function sharedBrowser(): Promise<Browser> {
  browserPromise ??= connectChromium(inject("foundryBrowserWs"));
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
 * one thing the window-fit checks vary. Everything else about a harness is the
 * page: a fresh one opens on a build that has just started, with no key held, no
 * audio context opened, and the mute preference back off, which is a stronger
 * guarantee than any reset the surface offers, since `reset()` deliberately
 * leaves muting alone.
 *
 * A page per harness rather than a page reused between them, because a check may
 * legitimately hold two harnesses at once — a delta-time check runs the same
 * scenario under two step sizes — and a harness whose page had been taken over by
 * a later one would read someone else's game while looking exactly like it
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
 * A proxy rather than a hand-written stub, so an operation the specification adds
 * later, or one a check reaches for by name, reports the build's missing install
 * rather than looking like a harness bug.
 *
 * Keys that belong to the MACHINERY rather than to a check are answered with
 * `undefined` instead: awaiting a value probes `then`, and vitest's own error
 * formatting probes symbols and `constructor`. Failing those would replace the
 * verdict below with noise from the machinery that was trying to report it.
 */
function unexposedSurface(reason: string): DrivenFoundryDebugApi {
  return new Proxy({} as DrivenFoundryDebugApi, {
    get: (_target, property): unknown => {
      if (typeof property === "symbol") return undefined;
      if (property === "then" || property === "constructor") return undefined;
      return () => failSurface(reason);
    },
  });
}

/**
 * What `specs/instrumentation.md` requires of the surface: the `Expected:` line of
 * the failure a build with no usable surface lands on every check that reaches
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
      )[handle]!;
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
 * window-fit ones has to think about the fit at all.
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

  await page.goto(inject("foundryUrl"), { waitUntil: "load" });

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
        )[handle]![name]!(...rest),
      [HANDLE, operation, args] as const,
    );
  };

  const debug =
    surfaceFault !== null
      ? unexposedSurface(surfaceFault)
      : (new Proxy({} as DrivenFoundryDebugApi, {
          get: (_target, property): unknown => {
            if (typeof property === "symbol") return undefined;
            if (property === "then" || property === "constructor")
              return undefined;
            const name = String(property);
            return (...args: unknown[]) => call(name, args);
          },
        }) as DrivenFoundryDebugApi);

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
            window as unknown as { __foundryRec: { ready(): boolean } }
          ).__foundryRec.ready(),
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
  const drive = async (frames: number): Promise<FoundrySnapshot> => {
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
        )[handle]!;
        const rec = (
          window as unknown as {
            __foundryRec: Record<string, (...a: unknown[]) => unknown>;
          }
        ).__foundryRec;
        const audio = (
          window as unknown as { __foundryAudio: { started(): number } }
        ).__foundryAudio;
        const sounds: number[] = [];
        for (const dt of dts) {
          const before = audio.started();
          rec.begin!();
          api.advance!(dt / 1000, 1);
          rec.end!(dt);
          sounds.push(audio.started() - before);
        }
        return { snapshot: api.snapshot!(), sounds };
      },
      [HANDLE, deltas] as const,
    )) as { snapshot: FoundrySnapshot; sounds: number[] };

    for (const [index, delta] of deltas.entries()) {
      frameCount += 1;
      timeMs += delta;
      for (let n = 0; n < result.sounds[index]!; n += 1) {
        for (const sink of cueSinks)
          sink.push({ frame: frameCount, t: timeMs });
      }
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
          throw new Error("arc foundry: the page has no <canvas>");
        let canvas = canvases[0]!;
        for (const other of canvases) {
          if (other.width * other.height > canvas.width * canvas.height)
            canvas = other;
        }
        const ctx = canvas.getContext("2d");
        if (ctx === null)
          throw new Error("arc foundry: the canvas has no 2D context");
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

    advanceSeconds: async (s) => {
      await drive(ticks(s));
    },

    async until(predicate, untilOptions = {}) {
      const maxFrames = untilOptions.maxFrames ?? 1200;
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
            window as unknown as { __foundryRec: { setMode(m: string): void } }
          ).__foundryRec.setMode("raf");
          (
            window as unknown as Record<
              string,
              { setAutoStep(on: boolean): void }
            >
          )[handle]!.setAutoStep(true);
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
          )[handle]!.setAutoStep(false);
          (
            window as unknown as { __foundryRec: { setMode(m: string): void } }
          ).__foundryRec.setMode("manual");
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

    async frameCalls() {
      await drive(1);
      const ops = (await page.evaluate(() =>
        (
          window as unknown as { __foundryRec: { last(): unknown[] } }
        ).__foundryRec.last(),
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
    pixel: async (x, y) => (await readPixels([toDevice(view, x, y)]))[0]!,
    pixels: (points) => readPixels(points.map((p) => toDevice(view, p.x, p.y))),
    devicePixel: async (x, y) => (await readPixels([{ x, y }]))[0]!,

    surface: () =>
      page.evaluate(() => {
        const canvases = Array.from(document.querySelectorAll("canvas"));
        if (canvases.length === 0) {
          throw new Error(
            "arc foundry: the page has no <canvas>, so the build drew nowhere " +
              "— index.html supplies one and the build is asked not to edit it " +
              "(specs/overview.md)",
          );
        }
        let canvas = canvases[0]!;
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
      // is bound to nothing, so arming changes no game state.
      await page.keyboard.press(UNBOUND_KEY);
    },

    async dispose() {
      // The context stays: it holds the init scripts and the window shape, and the
      // next harness of this shape wants both. The page goes, so nothing this
      // check pressed, placed or muted can reach the next one.
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
 * evenly into two bars.
 *
 * Computed rather than read from the build, deliberately. Under an engine the fit
 * is the engine's and a check can ask it what it derived; here the fit is the
 * build's own work, so asking it would be asking a build to grade itself. Every
 * check but the window-fit ones runs at the stage's own size, where this is the
 * identity and the question does not arise.
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
 * `validation/firing/in-range.test.ts` — because that is the path the review
 * item's declared script resolves to, and so the only name the case's manifest and
 * the runner both already agree on. Stating the prefix here is what keeps that
 * address the same when this suite is run in place against a reference
 * implementation, where the project root is `validation/none/` instead.
 */
const STAGED_PROJECT_DIR = "validation";

/**
 * The most frames a written recording holds.
 *
 * The injected recorder already holds the page's side to twice this, decimating
 * as it fills, so what arrives here is at most a few hundred frames however long
 * the section ran. This is the same cap the engine-backed harness writes under, so
 * a replay recorded under either engine is the same size of thing.
 */
const MAX_REPLAY_FRAMES = 300;

/**
 * The ground the console's player paints behind a recorded frame.
 *
 * The specification fixes no palette: the build paints its own yard, its status
 * bar and its build panel each frame, and the recorded frames carry that paint.
 * What the player needs is a colour for the canvas under them, and the page the
 * build is served on is painted `#05080c` by the case's own `index.html`, so that
 * is what a replay says.
 */
export const REPLAY_BACKGROUND = "#05080c";

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
   *
   * The save stack, the clip region and the current path are each shadowed by the
   * recorder and each bounded. Past a bound the recorder keeps what a following
   * operation can still reach and drops the rest, so the frame replays under a
   * state close to the build's rather than equal to it — and the player reports
   * that beside everything else it could not reproduce. Present only on a frame
   * that was in fact cut down.
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
  /**
   * The current path, as the operations issued since the last `beginPath`.
   *
   * A canvas keeps its path across a frame boundary, so a build is free to open
   * one on one frame and fill it on the next. Carrying it is also what an
   * inherited clip makes unavoidable: applying a clip means replaying that clip's
   * own path operations, which leaves the clip outline current, and a frame that
   * then issues a bare `fill` would fill the outline of its clip.
   */
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
 *
 * Two operations that mean the same thing have to serialize identically for a
 * table to hold one copy of each, and the key order inside an argument the build
 * passed is the build's own business rather than ours.
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
 * is to say each thing once, and the bulk of it in a game that draws procedurally
 * and so repeats almost nothing between frames.
 *
 * Every entry here is reached from a kept frame, and every reference inside one
 * is rewritten as it is reached, transitively: a frame names its own state and
 * the states saved under it, whose clip and path segments and inherited fill name
 * operations and resources, whose own creating calls may name images. What is
 * deduplicated is the rewritten entry, so an operation two hundred frames issue
 * identically is written once and named two hundred times, and every index a
 * frame carries addresses the table it was interned into.
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
 * whatever the stride lands on — it is the frame the check's sweep stopped at, and
 * the one a reviewer looks at first.
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
 *
 * Exported for the suite beside this file, which reaches it over frame counts a
 * driven section cannot hand it. The injected recorder decimates in the page as
 * the section runs, halving its kept set the moment it reaches twice this cap, so
 * a written recording is thinned twice and what arrives here is never more than
 * twice the cap. Twice it EXACTLY does arrive, and with it the exact multiple of
 * the cap that the arithmetic above turns on: the page holds up to 599 frames
 * after a halving and its `stop()` appends the section's last frame to them, so a
 * section of 1,198 driven frames hands this 600. The displacement branch is
 * therefore ordinary production behaviour rather than a case only a test can pose.
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
 * the browser inflates it before the player sees it. The document inside is the
 * same one.
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
    console.warn(
      `arc foundry: could not write ${destination}: ${String(error)}`,
    );
  }
}

/**
 * Record the frames `scenario` drives and keep them as the review item's
 * `outputId` output, handing back whatever the scenario returned.
 *
 * Wrap the drive, not the arrangement:
 *
 * ```ts
 * const point = await captureReplay(h, "goal", () => driveGoal(h));
 * assertEqual(point.hit, true);
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
        window as unknown as { __foundryRec: { arm(d: unknown): boolean } }
      ).__foundryRec.arm(design),
    { width: STAGE_W, height: STAGE_H, background: REPLAY_BACKGROUND },
  );
  try {
    return await scenario();
  } finally {
    // In a `finally`, so a scenario that failed still leaves its evidence behind.
    const recording = (await h.page.evaluate(() =>
      (
        window as unknown as { __foundryRec: { disarm(): unknown } }
      ).__foundryRec.disarm(),
    )) as Recording | null;
    writeReplay(destination, recording);
  }
}

/**
 * Keep the picture currently on the canvas as the review item's `outputId` output.
 *
 * The companion to {@link captureReplay}, for a point whose evidence is one
 * PICTURE rather than a stretch of motion: which screen the game opened on, what
 * the inspector drew for a selected structure, where the letterbox bars fell.
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
    console.warn(
      `arc foundry: could not write ${destination}: ${String(error)}`,
    );
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
 * cue per event, played on the update its event happens and at most once on that
 * update, and says nothing at all about how a build makes a sound — under this
 * engine the whole audio layer is the build's. So `audio-init.js` watches the two
 * doors a browser can emit sound through (a Web Audio source being `start()`ed,
 * whatever kind it is, and an `<audio>` element being played) and counts what
 * goes through them; the harness brackets each driven frame around that count, so
 * a sound is attributed to the frame that produced it. A firing blip made of two
 * oscillators counts as two, which is why a check asserts that a frame sounded
 * rather than how many times: the number of sources is the build's business and
 * the specification never fixed it.
 *
 * WHAT IS LOST HERE THAT AN ENGINE GIVES. The cue's NAME. Under an engine the
 * game asks the bus for `CUES.kill` by name and the bus announces it, so a build
 * that plays its leak blip on every kill is caught. There is no bus here to ask,
 * so these checks confirm that a sound was emitted and on which frame, and a
 * reviewer decides by ear whether the twelve are told apart. That is a real
 * reduction, and the alternative — inferring the cue from the waveform the
 * reference happens to use — would grade builds against an implementation rather
 * than against the specification.
 *
 * THE MUSIC BED IS A SOUND LIKE ANY OTHER. `specs/ui.md` loops `music` under the
 * yard from the first build phase onward, and a loop restarting is a source
 * starting, so a check that counts sounds over a long stretch must either park
 * itself on a frame it can attribute or read the frame a cue landed on rather
 * than the total.
 */
export function watchCues(h: Harness): TimedCue[] {
  const played: TimedCue[] = [];
  harnessCues.get(h)?.push(played);
  return played;
}

/* -------------------------------------------------------------------------- */
/* Reading a snapshot                                                         */
/* -------------------------------------------------------------------------- */
//
// A snapshot is a plain document, so these are pure functions over one. They
// exist so that a check reads what it is about by name and fails by assertion
// when the thing it named is not there, rather than dereferencing `undefined` a
// few lines later and reporting a `TypeError` where a verdict belonged.

/** The live unit that id, or a failure naming the id and what was on the yard. */
export function unitById(snapshot: FoundrySnapshot, id: number): UnitView {
  const found = snapshot.units.find((u) => u.id === id);
  assertTruthy(
    found,
    `snapshot().units to carry the unit #${id}; it carries ${
      snapshot.units.length === 0
        ? "none"
        : snapshot.units.map((u) => `#${u.id}`).join(", ")
    }`,
  );
  return found as UnitView;
}

/** The structure of that id, or a failure naming the id and what was on the yard. */
export function structureById(
  snapshot: FoundrySnapshot,
  id: number,
): StructureView {
  const found = snapshot.structures.find((s) => s.id === id);
  assertTruthy(
    found,
    `snapshot().structures to carry the structure #${id}; it carries ${
      snapshot.structures.length === 0
        ? "none"
        : snapshot.structures.map((s) => `#${s.id}`).join(", ")
    }`,
  );
  return found as StructureView;
}

/**
 * The last unit the snapshot reports, which `specs/instrumentation.md` fixes as
 * the one `spawnUnit` just released.
 */
export function lastUnit(snapshot: FoundrySnapshot): UnitView {
  const found = snapshot.units[snapshot.units.length - 1];
  assertTruthy(
    found,
    "snapshot().units to carry the unit spawnUnit just released, as its last " +
      "entry (specs/instrumentation.md); it is empty",
  );
  return found as UnitView;
}

/**
 * The last structure the snapshot reports, which `specs/instrumentation.md` fixes
 * as the one the `place` operation just stood up.
 */
export function lastStructure(snapshot: FoundrySnapshot): StructureView {
  const found = snapshot.structures[snapshot.structures.length - 1];
  assertTruthy(
    found,
    "snapshot().structures to carry the structure just placed, as its last " +
      "entry (specs/instrumentation.md); it is empty",
  );
  return found as StructureView;
}

/** The structure anchored at that tile, or `undefined`. */
export function structureAt(
  snapshot: FoundrySnapshot,
  col: number,
  row: number,
): StructureView | undefined {
  return snapshot.structures.find((s) => s.col === col && s.row === row);
}

/** Every structure that fires: the seven firing base types and the towers. */
export function firingStructures(snapshot: FoundrySnapshot): StructureView[] {
  return snapshot.structures.filter((s) => s.targeting !== null);
}

/**
 * The progress ordering of `specs/pathing.md`, furthest along the chain first.
 *
 * Compared first by the checkpoint the unit is heading for, and then, among units
 * heading for the same one, by the REMAINING route length to it — so a shorter
 * `progress` is further along. This is the ordering `first` and `last` select on,
 * and the tie-break every targeting priority resolves toward.
 */
export function compareAlongChain(a: UnitView, b: UnitView): number {
  if (a.waypointIndex !== b.waypointIndex)
    return b.waypointIndex - a.waypointIndex;
  return a.progress - b.progress;
}

/** The units of a snapshot, ordered furthest along the chain first. */
export function alongChain(snapshot: FoundrySnapshot): UnitView[] {
  return [...snapshot.units].sort(compareAlongChain);
}

/** The priority `steps` activations of the targeting control past `current`. */
export function targetingAfter(current: Targeting, steps: number): Targeting {
  const at = TARGETING_PRIORITIES.indexOf(current);
  assertTruthy(at >= 0, `a targeting priority; received ${String(current)}`);
  const n = TARGETING_PRIORITIES.length;
  return TARGETING_PRIORITIES[(at + (steps % n) + n) % n]!;
}

/* -------------------------------------------------------------------------- */
/* Compound sequences                                                         */
/* -------------------------------------------------------------------------- */
//
// The surface is atomic by design, so opening a run, emptying the yard, standing
// one structure up and releasing one held unit are each several operations in a
// fixed order. Every one of them lives here, so a suite says what its scenario is
// about in one line and every suite says it the same way. A check that needs only
// part of a sequence calls the operations it needs.
//
// Nothing here poses an outcome. Each of these arranges a precondition through
// the same systems play uses — a placed rock rolls through the real press, a
// released unit walks the real pathfinder — and what happens next comes from
// advancing the real simulation.

/** What a run opens as, and what the yard holds when it opens. */
export interface YardOptions {
  /** The map the run opens on. Defaults to the reset value, `substation`. */
  map?: MapId;
  /** The difficulty. Defaults to the reset value, `medium`. */
  difficulty?: DifficultyId;
  /** The seed every random draw runs off. Defaults to `DEFAULT_SEED`. */
  seed?: number;
  /** The wave units released from now on scale to. */
  wave?: number;
  /** Charge in the bank. */
  charge?: number;
  /** Grid Integrity remaining. */
  integrity?: number;
  /** The refinement level, and with it the roll odds. */
  refinement?: number;
  /** The stamps left in the level's allowance. */
  stamps?: number;
  /** The speed multiplier. Defaults to the reset value, `1`. */
  speed?: number;
}

/**
 * A run at its first build phase, entered the way choosing a difficulty enters
 * one: reset to the title, choose the map and the difficulty, start the run.
 *
 * What it arranges is exactly the opening allocation `specs/campaign.md` states,
 * because `startRun` takes the path confirming the difficulty select takes.
 */
export async function openRun(
  h: Harness,
  options: YardOptions = {},
): Promise<void> {
  await h.debug.reset({ seed: options.seed ?? DEFAULT_SEED });
  if (options.map !== undefined) await h.debug.setMap(options.map);
  if (options.difficulty !== undefined) {
    await h.debug.setDifficulty(options.difficulty);
  }
  await h.debug.startRun();
}

/**
 * Everything off the yard: every structure, every live unit, every projectile.
 *
 * The isolation the validator guide asks for, in one line. `clearStructures` also
 * clears the selection and the combine set and recomputes the route, and
 * `clearUnits` kills nothing and leaks nothing, so no bounty is paid and no Grid
 * Integrity is lost by emptying the yard.
 */
export async function emptyYard(h: Harness): Promise<void> {
  await h.debug.clearStructures();
  await h.debug.clearUnits();
  await h.debug.clearProjectiles();
}

/**
 * THE OPENING LINE OF ALMOST EVERY CHECK: a run on an empty yard, posed to the
 * resources and the progress the scenario needs.
 *
 * The order matters and is fixed here so no suite has to think about it: the run
 * opens first, because `startRun` installs the opening allocation over anything
 * posed before it, and the resources are posed after, because a check that wants
 * `500` Charge wants it whatever the run opened with.
 */
export async function openYard(
  h: Harness,
  options: YardOptions = {},
): Promise<void> {
  await openRun(h, options);
  await emptyYard(h);
  if (options.wave !== undefined) await h.debug.setWave(options.wave);
  if (options.charge !== undefined) await h.debug.setCharge(options.charge);
  if (options.integrity !== undefined) {
    await h.debug.setIntegrity(options.integrity);
  }
  if (options.refinement !== undefined) {
    await h.debug.setRefinement(options.refinement);
  }
  if (options.stamps !== undefined) await h.debug.setStamps(options.stamps);
  if (options.speed !== undefined) await h.debug.setSpeed(options.speed);
}

/**
 * Put away whatever is held on the cursor, as `back` does.
 *
 * `placeRock` goes through the real continuous-placement path, so it re-arms the
 * press the moment it lands and the panel then shows the held-rock read rather
 * than the inspector. A check that placed a rock and wants to read the inspector
 * clears the hand first — and `back` is what a player presses to do it.
 */
export async function clearHand(h: Harness): Promise<void> {
  await pressAction(h, "back");
}

/** Refill the level's stamp allowance, for a scenario that needs a sixth rock. */
export async function refillStamps(h: Harness): Promise<void> {
  await h.debug.setStamps(STAMPS_PER_LEVEL);
}

/* ---- Standing one structure up -------------------------------------------- */
//
// Each of these stands exactly one thing on the yard and hands back its id, read
// off the snapshot's last entry as `specs/instrumentation.md` fixes it. Each
// asserts the placement landed, so a scenario that asked for an anchor the
// never-seal rule refuses fails where it asked rather than several frames later
// with a structure it never got.

/** A permanent firing component of that type and quality, at that anchor. */
export async function standComponent(
  h: Harness,
  type: ComponentType,
  quality: Tier,
  col: number,
  row: number,
): Promise<number> {
  const before = (await h.snapshot()).structures.length;
  await h.debug.placeComponent(type, quality, col, row);
  return placed(
    await h.snapshot(),
    before,
    `placeComponent(${type}, ${quality}, ${col}, ${row})`,
  );
}

/** A combination tower at that anchor, landed at level `0` and raised to `level`. */
export async function standCombo(
  h: Harness,
  combo: ComboId,
  col: number,
  row: number,
  level = 0,
): Promise<number> {
  const before = (await h.snapshot()).structures.length;
  await h.debug.placeCombo(combo, col, row);
  const id = placed(
    await h.snapshot(),
    before,
    `placeCombo(${combo}, ${col}, ${row})`,
  );
  if (level !== 0) await h.debug.setComboLevel(id, level);
  return id;
}

/** An inert blocker at that anchor: a wall with no head and no glow. */
export async function standBlocker(
  h: Harness,
  col: number,
  row: number,
): Promise<number> {
  const before = (await h.snapshot()).structures.length;
  await h.debug.placeBlocker(col, row);
  return placed(await h.snapshot(), before, `placeBlocker(${col}, ${row})`);
}

/**
 * A candidate of a chosen type and quality, dropped through the real press.
 *
 * The roll is armed first, so the rock that lands rolls exactly what the scenario
 * asked for; the drop itself still goes through the placement path, so it spends
 * a stamp and is refused exactly where a pointer press would be. The hand is
 * cleared afterwards, because the press re-arms itself on a successful drop and a
 * held rock is what the panel shows instead of the inspector.
 */
export async function standCandidate(
  h: Harness,
  type: ComponentType,
  quality: Tier,
  col: number,
  row: number,
): Promise<number> {
  const before = (await h.snapshot()).structures.length;
  await h.debug.setNextRoll(type, quality);
  await h.debug.placeRock(col, row);
  await h.debug.clearNextRoll();
  await clearHand(h);
  return placed(
    await h.snapshot(),
    before,
    `placeRock(${col}, ${row}) armed to roll ${type} at quality ${quality}`,
  );
}

/** The id the structure a `place` operation just appended carries. */
function placed(
  snapshot: FoundrySnapshot,
  before: number,
  what: string,
): number {
  assertTruthy(
    snapshot.structures.length === before + 1,
    `${what} to stand one structure up and append it to snapshot().structures ` +
      `(specs/instrumentation.md); the yard went from ${before} structures to ` +
      `${snapshot.structures.length}`,
  );
  return lastStructure(snapshot).id;
}

/** Select a structure, as a pointer press on it would. */
export async function selectStructure(h: Harness, id: number): Promise<void> {
  await h.debug.select(id);
}

/* ---- Releasing one unit --------------------------------------------------- */

/**
 * How a released unit is posed, one faculty at a time.
 *
 * Isolation reaches inside the entity: a check about a burn's damage wants a unit
 * that burns and does not walk, and a check about a slow's expiry wants one that
 * walks and carries a slow. So each faculty a scenario must hold is its own field
 * here, and every one it leaves out is left exactly as the spawner set it.
 */
export interface UnitPose {
  /** A logical position to stand it at. */
  at?: Point;
  /** Or the center of a tile to stand it at. */
  tile?: { col: number; row: number };
  /** The checkpoint it heads for, `1`–`7`, where `7` is the collector. */
  waypoint?: number;
  /** Its current health, at least `1` and at most its maximum. */
  hp?: number;
  /** A slow, applied through the rule `specs/enemies.md` fixes. */
  slow?: { amount: number; seconds: number };
  /** A burn, applied through the same rule, credited to no structure. */
  burn?: { dps: number; seconds: number };
  /** Travel held, and nothing else held with it. */
  frozen?: boolean;
}

/**
 * One unit of that type at the map's entry, scaled to the current wave, posed.
 *
 * `spawnUnit` releases through the real spawner and so puts the run into a live
 * wave whose spawn schedule is empty: the units on the yard are exactly the ones
 * released here and nothing else arrives. That wave clears the ordinary way, when
 * every one of them has died or leaked, and clearing it pays the ordinary
 * wave-clear bonus — so a check reading `charge` after a kill either keeps a
 * bystander alive with {@link holdWaveOpen} or expects the bounty and the bonus.
 *
 * The poses are applied in the order `specs/instrumentation.md` leaves them
 * independent in: the checkpoint first, because setting it moves the unit
 * nowhere, then the position, then the health, then the statuses, and the travel
 * hold last so nothing after it has to think about whether the unit moved.
 */
export async function releaseUnit(
  h: Harness,
  type: SpawnType,
  pose: UnitPose = {},
): Promise<number> {
  const before = (await h.snapshot()).units.length;
  await h.debug.spawnUnit(type);
  const after = await h.snapshot();
  assertTruthy(
    after.units.length === before + 1,
    `spawnUnit(${type}) to release one unit and append it to snapshot().units ` +
      `(specs/instrumentation.md); the yard went from ${before} units to ` +
      `${after.units.length}`,
  );
  const id = lastUnit(after).id;

  if (pose.waypoint !== undefined) {
    await h.debug.setUnitWaypoint(id, pose.waypoint);
  }
  const at =
    pose.at ??
    (pose.tile === undefined
      ? undefined
      : tileCenter(pose.tile.col, pose.tile.row));
  if (at !== undefined) await h.debug.setUnitPosition(id, at.x, at.y);
  if (pose.hp !== undefined) await h.debug.setUnitHp(id, pose.hp);
  if (pose.slow !== undefined) {
    await h.debug.setUnitSlow(id, pose.slow.amount, pose.slow.seconds);
  }
  if (pose.burn !== undefined) {
    await h.debug.setUnitBurn(id, pose.burn.dps, pose.burn.seconds);
  }
  if (pose.frozen !== undefined) {
    await h.debug.setUnitFrozen(id, pose.frozen);
  }
  return id;
}

/**
 * One unit standing still at a chosen point, keeping every faculty but travel.
 *
 * The workhorse of this project. A held unit is targetable, it takes damage, its
 * burn ticks, its slow runs down and expires, and its body holds the position it
 * was posed at however long the scenario runs — so a check about damage, about a
 * status effect, or about which unit a priority picks reads a number that moved
 * for exactly one reason.
 */
export async function parkUnit(
  h: Harness,
  type: SpawnType,
  at: Point,
  pose: Omit<UnitPose, "at" | "tile" | "frozen"> = {},
): Promise<number> {
  return releaseUnit(h, type, { ...pose, at, frozen: true });
}

/**
 * A held unit at the map's entry that nothing is shooting at, so the live wave
 * `spawnUnit` opened cannot clear while the check is reading.
 *
 * Clearing a wave pays the wave-clear bonus, and a bonus landing in the middle of
 * a check that is reading `charge` would be indistinguishable from the bounty it
 * was measuring. Keeping one unit alive is what separates them.
 */
export async function holdWaveOpen(h: Harness): Promise<number> {
  return releaseUnit(h, "mote", { frozen: true });
}

/**
 * Commit the level's harvest, which is what starts the wave.
 *
 * There is no send control (`specs/campaign.md`): a wave begins when a candidate
 * is kept, downgraded, or folded into a combine. So this stands one candidate at
 * the anchor given and keeps it, and the wave the level composed starts on the
 * next advance. The component it leaves standing is the one the harvest produced,
 * and its id comes back.
 */
export async function startWave(
  h: Harness,
  type: ComponentType,
  quality: Tier,
  col: number,
  row: number,
): Promise<number> {
  const candidate = await standCandidate(h, type, quality, col, row);
  await h.debug.keep(candidate);
  return candidate;
}

/* ---- Controls ------------------------------------------------------------- */
//
// A control is found by the action it carries rather than by where it was drawn,
// because `specs/ui.md` fixes each menu's content and navigation and leaves its
// layout to the build. The rectangle a reading reports is the control's real hit
// region, so pressing the center of a reported, non-disabled rectangle activates
// it — which is how a check operates the game the way a player does without
// knowing anything about the build's layout.

/** A rectangle a reading reports. */
export interface ControlRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The center of a reported control rectangle. */
export function controlCenter(rect: ControlRect): Point {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/** A press and a release at a logical point: one click. */
export async function clickAt(h: Harness, x: number, y: number): Promise<void> {
  await h.debug.pointerDown(x, y);
  await h.debug.pointerUp();
}

/** A click at the center of a tile. */
export async function clickTile(
  h: Harness,
  col: number,
  row: number,
): Promise<void> {
  const point = tileCenter(col, row);
  await clickAt(h, point.x, point.y);
}

/** A click at the center of a structure anchored at that tile. */
export async function clickStructure(
  h: Harness,
  col: number,
  row: number,
): Promise<void> {
  const point = structureCenter(col, row);
  await clickAt(h, point.x, point.y);
}

/** A click at the center of a reported control rectangle. */
export async function clickControl(
  h: Harness,
  rect: ControlRect,
): Promise<void> {
  const point = controlCenter(rect);
  await clickAt(h, point.x, point.y);
}

/** The inspector's control carrying that action, or a failure naming what was drawn. */
export async function panelControl(
  h: Harness,
  action: PanelAction,
  label?: string,
): Promise<PanelButton> {
  const drawn = await h.debug.panelButtons();
  const found = drawn.find(
    (b) => b.action === action && (label === undefined || b.label === label),
  );
  assertTruthy(
    found,
    `panelButtons() to carry a \`${action}\` control${
      label === undefined ? "" : ` labelled ${label}`
    } (specs/instrumentation.md); it carries ${describeControls(drawn)}`,
  );
  return found as PanelButton;
}

/** The panel's own control carrying that action, or a failure naming what was drawn. */
export async function pressControl(
  h: Harness,
  action: PressAction,
): Promise<PressButton> {
  const drawn = await h.debug.pressControls();
  const found = drawn.find((c) => c.action === action);
  assertTruthy(
    found,
    `pressControls() to carry a \`${action}\` control ` +
      `(specs/instrumentation.md); it carries ${describeControls(drawn)}`,
  );
  return found as PressButton;
}

/** The menu choice carrying that action, or a failure naming what was drawn. */
export async function menuControl(
  h: Harness,
  action: MenuAction,
): Promise<MenuButton> {
  const drawn = await h.debug.menuButtons();
  const found = drawn.find((b) => b.action === action);
  assertTruthy(
    found,
    `menuButtons() to carry a \`${action}\` choice ` +
      `(specs/instrumentation.md); it carries ${describeControls(drawn)}`,
  );
  return found as MenuButton;
}

/** The status-bar control carrying that action, or a failure naming what was drawn. */
export async function statusControl(
  h: Harness,
  action: StatusAction,
): Promise<StatusControl> {
  const drawn = await h.debug.statusControls();
  const found = drawn.find((c) => c.action === action);
  assertTruthy(
    found,
    `statusControls() to carry a \`${action}\` control ` +
      `(specs/instrumentation.md); it carries ${describeControls(drawn)}`,
  );
  return found as StatusControl;
}

function describeControls(drawn: readonly { action: string }[]): string {
  return drawn.length === 0
    ? "none"
    : drawn.map((c) => `\`${c.action}\``).join(", ");
}

/** Find the inspector's control by action and press its center. */
export async function pressPanel(
  h: Harness,
  action: PanelAction,
  label?: string,
): Promise<void> {
  await clickControl(h, await panelControl(h, action, label));
}

/** Find the panel's own control by action and press its center. */
export async function pressPressControl(
  h: Harness,
  action: PressAction,
): Promise<void> {
  await clickControl(h, await pressControl(h, action));
}

/** Find the menu choice by action and press its center. */
export async function pressMenu(h: Harness, action: MenuAction): Promise<void> {
  await clickControl(h, await menuControl(h, action));
}

/** Find the status-bar control by action and press its center. */
export async function pressStatus(
  h: Harness,
  action: StatusAction,
): Promise<void> {
  await clickControl(h, await statusControl(h, action));
}

/**
 * Fire one action from the keyboard, through the surface's own input path.
 *
 * A press and a release of the key `specs/controls.md` binds the action to. Every
 * action but `modify` is read as a press edge, so this fires it exactly once; the
 * one-shot applies immediately, at the call, rather than being sampled on the
 * next frame.
 */
export async function pressAction(h: Harness, action: Action): Promise<void> {
  const key = keyFor(action);
  await h.debug.keyDown(key);
  await h.debug.keyUp(key);
}

/**
 * Run `body` with the `modify` action held, as a player holding Shift does.
 *
 * `modify` is read as a level rather than as an edge: what the game reads is
 * whether its key is down at the moment it reads it, so it modifies whatever act
 * it is held across. The release is in a `finally`, so a failing body cannot
 * leave the key down under the check that runs next.
 */
export async function withModify<T>(
  h: Harness,
  body: () => T | Promise<T>,
): Promise<T> {
  const key = keyFor("modify");
  await h.debug.keyDown(key);
  try {
    return await body();
  } finally {
    await h.debug.keyUp(key);
  }
}

/**
 * Show a menu screen and hand back the choices it presents, in order.
 *
 * `setScreen` moves to the screen exactly as reaching it in play does, and
 * `menuButtons` lays a frame out before it reads, so the choices come back
 * without the check advancing anything.
 */
export async function openMenu(
  h: Harness,
  screen: Screen,
): Promise<MenuButton[]> {
  await h.debug.setScreen(screen);
  return h.debug.menuButtons();
}
