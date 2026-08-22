// Carom — the shared validator harness. CASE-PROVIDED.
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
//
// ONE SERVER, ONE BROWSER, ONE PAGE PER HARNESS. `globalSetup.ts` starts the
// server and the browser once for the whole project; this module connects to
// them from inside each suite's worker and opens a page per harness, so every
// check drives a build that has just started and no check can be affected by
// what the one before it pressed, opened or muted.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { expect, inject } from "vitest";
import type { Browser, BrowserContext, Page } from "playwright";
import { connectChromium } from "./chromium";
import {
  BALL_R,
  COLOR,
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
} from "./constants";

declare module "vitest" {
  export interface ProvidedContext {
    /** Where the built site is served, from `globalSetup.ts`. */
    caromUrl: string;
    /** The one Chromium every suite worker connects to. */
    caromBrowserWs: string;
  }
}

/* -------------------------------------------------------------------------- */
/* The contract the build owes                                                */
/* -------------------------------------------------------------------------- */

/** The handle an engineless build installs its surface on. */
export const HANDLE = "__carom";

/**
 * Every operation `specs/instrumentation.md` requires on the surface under this
 * engine, including the two clock operations that exist only here.
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
  expect(
    one,
    "snapshot() must report the ball as `ball` (base, gyre) or the balls as " +
      "`balls` (multi); see specs/instrumentation.md",
  ).toBeTruthy();
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
/* The step schedule                                                          */
/* -------------------------------------------------------------------------- */
//
// The suite chooses the size of a frame, because the specification deliberately
// fixes none: every rate in this game is per second and is integrated against the
// elapsed time of the frame, so a build must reach the same place however that
// time was divided. The default is a steady 120 Hz, which makes every duration
// below a whole number of frames — the unit the tolerances in this suite were
// established in. The check that is ABOUT the step size
// (`gameplay/delta-time-independent`) drives the same scenario under the other
// two schedules here.

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
 * neighbouring outputs. The constants and the order are the engine's
 * (`packages/simple-2d/src/clocks.ts`), so a seed means the same thing here.
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

/** A speed in px/s from a displacement measured over `ticks` frames. */
export function speedOverTicks(delta: number, ticks: number): number {
  return (Math.abs(delta) * TICK_HZ) / ticks;
}

/** The angle from horizontal of a velocity, in degrees, ignoring direction. */
export function angleDeg(v: { vx: number; vy: number }): number {
  return (Math.atan2(Math.abs(v.vy), Math.abs(v.vx)) * 180) / Math.PI;
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

/** How the field is mapped onto the canvas: one uniform scale and a letterbox. */
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
  /** The window's CSS width. Defaults to the logical field width. */
  cssWidth?: number;
  /** The window's CSS height. Defaults to the logical field height. */
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
  snapshot: CaromSnapshot;
}

export interface Harness {
  /** The page the build is running in. For a check that needs Playwright itself. */
  readonly page: Page;
  /**
   * The surface the BUILD installed, as operations that cross into the page.
   *
   * Read off `window.__carom` and never constructed here — see
   * {@link unexposedSurface}.
   */
  readonly debug: CaromDebugApi;
  /**
   * Why the build's surface cannot be driven, or `null` when it can.
   *
   * A fault here is the build's: the surface is missing, or it is missing an
   * operation the specification requires. Every operation fails by assertion with
   * this message rather than throwing, so the fault lands on the points whose
   * checks reach the game through the surface.
   */
  readonly surfaceFault: string | null;
  /** Everything the page logged to `console.error`, or threw, oldest first. */
  readonly pageErrors: string[];

  /** The frames this harness has driven, 1-based, as a recorded frame counts them. */
  frame(): number;
  /** The simulated time those frames covered, in milliseconds. */
  timeMs(): number;

  /** A fresh read of the game's state through the build's `snapshot`. */
  snapshot(): Promise<CaromSnapshot>;
  /** Run `frames` frames back to back, each the length the clock says. */
  advance(frames: number): Promise<void>;
  /** Advance until `predicate` holds, sampling every `poll` frames. */
  until(
    predicate: (snapshot: CaromSnapshot) => boolean,
    options?: UntilOptions,
  ): Promise<UntilResult>;
  /** Hand the game back to its own frame loop for `ms` of real time, then take it back. */
  runFor(ms: number): Promise<void>;

  /** Press a key and leave it down, as a player holding it would. */
  hold(code: string): Promise<void>;
  /** Release a key held by `hold`. */
  release(code: string): Promise<void>;
  /**
   * Press a key, run the one frame that delivers it, and release it.
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

  /** How the field is mapped onto this harness's canvas. */
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
  browserPromise ??= connectChromium(inject("caromBrowserWs"));
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
 * one thing `rendering/window-fit` varies. Everything else about a harness is the
 * page: a fresh one opens on a build that has just started, with no key held, no
 * audio context opened, and the mute preference back off, which is a stronger
 * guarantee than any reset the surface offers, since `reset()` deliberately
 * leaves muting alone.
 *
 * A page per harness rather than a page reused between them, because a check may
 * legitimately hold two harnesses at once — `ball/no-tunnel` runs the same probe
 * under two step sizes — and a harness whose page had been taken over by a later
 * one would read someone else's game while looking exactly like it worked.
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
 * A proxy rather than a hand-written stub, because the surface is not a closed
 * list — the gyre variant adds `setObstacleClock` — and a stub written against
 * the common surface would report a gyre-only operation as merely absent rather
 * than as the consequence of the build's missing install.
 *
 * Keys that belong to the MACHINERY rather than to a check are answered with
 * `undefined` instead: awaiting a value probes `then`, and vitest's own error
 * formatting probes symbols and `constructor`. Failing those would replace the
 * verdict below with noise from the machinery that was trying to report it.
 */
function unexposedSurface(reason: string): CaromDebugApi {
  return new Proxy({} as CaromDebugApi, {
    get: (_target, property): unknown => {
      if (typeof property === "symbol") return undefined;
      if (property === "then" || property === "constructor") return undefined;
      return () => expect.fail(reason);
    },
  });
}

/** What is wrong with the surface this page installed, or `null` when nothing is. */
async function readSurfaceFault(page: Page): Promise<string | null> {
  const preamble =
    `this build never installed a usable debug and automation surface, so nothing ` +
    `can reach the game: specs/instrumentation.md requires the finished surface on ` +
    `window.${HANDLE} as soon as the game has initialized`;
  try {
    await page.waitForFunction(
      (handle) =>
        typeof (window as never)[handle] === "object" &&
        (window as never)[handle] !== null,
      HANDLE,
      { timeout: SURFACE_TIMEOUT_MS },
    );
  } catch {
    return `${preamble}. window.${HANDLE} was still absent ${SURFACE_TIMEOUT_MS / 1000}s after the page loaded.`;
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
    return `${preamble}. window.${HANDLE} is installed but carries no ${missing
      .map((op) => `${op}()`)
      .join(", ")}.`;
  }
  return null;
}

/* ---- Building one --------------------------------------------------------- */

/**
 * Load the built site in a browser, take the game off the wall clock, and hand
 * back everything a check reads.
 *
 * The default shape is the field's own size at one device pixel per CSS pixel, so
 * a logical coordinate and a canvas pixel are the same thing and no check but
 * `rendering/window-fit` has to think about the fit at all.
 */
export async function createHarness(
  options: HarnessOptions = {},
): Promise<Harness> {
  const cssWidth = options.cssWidth ?? FIELD_W;
  const cssHeight = options.cssHeight ?? FIELD_H;
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

  await page.goto(inject("caromUrl"), { waitUntil: "load" });

  const surfaceFault = await readSurfaceFault(page);
  const fail = (): never => expect.fail(surfaceFault ?? "");

  const call = async (operation: string, args: unknown[]): Promise<unknown> => {
    if (surfaceFault !== null) fail();
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
      : (new Proxy({} as CaromDebugApi, {
          get: (_target, property): unknown => {
            if (typeof property === "symbol") return undefined;
            if (property === "then" || property === "constructor")
              return undefined;
            const name = String(property);
            return (...args: unknown[]) => call(name, args);
          },
        }) as CaromDebugApi);

  if (surfaceFault === null) {
    // Off the wall clock and back to the title before a check touches anything:
    // from here the game changes only when this harness says so.
    await call("setAutoStep", [false]);
    await call("reset", []);
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
  const drive = async (frames: number): Promise<CaromSnapshot> => {
    if (surfaceFault !== null) fail();
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
            __caromRec: Record<string, (...a: unknown[]) => unknown>;
          }
        ).__caromRec;
        const audio = (
          window as unknown as { __caromAudio: { started(): number } }
        ).__caromAudio;
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
    )) as { snapshot: CaromSnapshot; sounds: number[] };

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

  const readPixels = async (
    devicePoints: readonly { x: number; y: number }[],
  ): Promise<[number, number, number, number][]> =>
    page.evaluate(
      (points) => {
        const canvases = Array.from(document.querySelectorAll("canvas"));
        if (canvases.length === 0)
          throw new Error("carom: the page has no <canvas>");
        let canvas = canvases[0];
        for (const other of canvases) {
          if (other.width * other.height > canvas.width * canvas.height)
            canvas = other;
        }
        const ctx = canvas.getContext("2d");
        if (ctx === null)
          throw new Error("carom: the canvas has no 2D context");
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

    async runFor(ms) {
      if (surfaceFault !== null) fail();
      // The one thing here that depends on real elapsed time, so the one thing a
      // browser's own idea of which page matters can distort. The launch already
      // turns the throttling off; bringing the page forward as well means this
      // does not rest on a flag alone.
      await page.bringToFront().catch(() => undefined);
      await page.evaluate(
        ([handle]) => {
          (
            window as unknown as { __caromRec: { setMode(m: string): void } }
          ).__caromRec.setMode("raf");
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
            window as unknown as { __caromRec: { setMode(m: string): void } }
          ).__caromRec.setMode("manual");
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
          window as unknown as { __caromRec: { last(): unknown[] } }
        ).__caromRec.last(),
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
            "carom: the page has no <canvas>, so the build drew nowhere — " +
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
  return harness;
}

/** Where {@link watchCues} attaches, per harness. */
const harnessCues = new WeakMap<Harness, TimedCue[][]>();

/* ---- The fit -------------------------------------------------------------- */

/**
 * How the field maps onto a surface of this shape, as `specs/overview.md` fixes
 * it: one uniform scale, the whole field inside, centred, with the leftover split
 * evenly into two bars.
 *
 * Computed rather than read from the build, deliberately. Under an engine the fit
 * is the engine's and a check can ask it what it derived; here the fit is the
 * build's own work, so asking it would be asking a build to grade itself. Every
 * check but `rendering/window-fit` runs at the field's own size, where this is the
 * identity and the question does not arise; that one check runs at other shapes
 * and reads the pixels against what the specification says should be there.
 */
export function fitViewport(
  cssWidth: number,
  cssHeight: number,
  dpr: number,
): Viewport {
  const deviceWidth = Math.round(cssWidth * dpr);
  const deviceHeight = Math.round(cssHeight * dpr);
  const scale = Math.min(cssWidth / FIELD_W, cssHeight / FIELD_H) * dpr;
  return {
    width: FIELD_W,
    height: FIELD_H,
    scale,
    offsetX: (deviceWidth - FIELD_W * scale) / 2,
    offsetY: (deviceHeight - FIELD_H * scale) / 2,
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
type RecordedOp =
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
 * `validation/gameplay/serve-speed.test.ts` — because that is the path the review
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

/** One frame of a recording, as the console's player reads it. */
interface RecordedFrame {
  count: number;
  timeMs: number;
  deltaMs: number;
  surface: { width: number; height: number };
  state: unknown;
  ops: unknown[];
}

/** A recording, as the console's player reads it. */
interface Recording {
  format: number;
  width: number;
  height: number;
  background: string | null;
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
 */
function thinReplay(recording: Recording): Recording {
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
  if (kept[kept.length - 1].count !== last.count) keep(last);

  return { ...recording, frames: kept };
}

/**
 * Write a recording out, reporting rather than raising anything that goes wrong.
 *
 * A capture that closed no frames writes nothing: a file holding an empty frame
 * list would be collected as an output that turned up, and the run would tell the
 * reviewer there is a replay to watch and then open the player on nothing.
 *
 * What lands on disk is gzip rather than raw JSON. The format is deliberately
 * repetitive — every frame restates the drawing state it inherited so that any
 * frame can be drawn without drawing the frames before it — and that redundancy is
 * almost exactly what gzip removes. The document inside is the same one.
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
    console.warn(`carom: could not write ${destination}: ${String(error)}`);
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
 * expect(point.hit).toBe(true);
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
        window as unknown as { __caromRec: { arm(d: unknown): boolean } }
      ).__caromRec.arm(design),
    { width: FIELD_W, height: FIELD_H, background: COLOR.bg },
  );
  try {
    return await scenario();
  } finally {
    // In a `finally`, so a scenario that failed still leaves its evidence behind.
    const recording = (await h.page.evaluate(() =>
      (
        window as unknown as { __caromRec: { disarm(): unknown } }
      ).__caromRec.disarm(),
    )) as Recording | null;
    writeReplay(destination, recording);
  }
}

/**
 * Keep the picture currently on the canvas as the review item's `outputId` output.
 *
 * The companion to {@link captureReplay}, for a point whose evidence is one
 * PICTURE rather than a stretch of motion: which screen the game opened on, what
 * colour it drew a paddle, where the letterbox bars fell.
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
    console.warn(`carom: could not write ${destination}: ${String(error)}`);
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
 * game asks the bus for `CUES.paddleHit` by name and the bus announces it, so a
 * build that plays its scoring blip on every bounce is caught. There is no bus
 * here to ask, so these checks confirm that a sound was emitted and on which
 * frame, and a reviewer decides by ear whether the four are told apart. That is a
 * real reduction, and the alternative — inferring the cue from the waveform the
 * reference happens to use — would grade builds against an implementation rather
 * than against the specification.
 */
export function watchCues(h: Harness): TimedCue[] {
  const played: TimedCue[] = [];
  harnessCues.get(h)?.push(played);
  return played;
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
 * Open a driven match, put every ball but the first out of the way, and run it up
 * to live play.
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
  options: { ticks?: number } = {},
): Promise<MoveResult> {
  const ticks = options.ticks ?? 36; // 0.3 s
  const before = (await h.snapshot()).paddles;
  await h.hold(code);
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

/** A sampled colour, each channel 0–255. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

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
  /** An empty patch of field, clear of every drawn element. */
  background: { x: 500, y: 650 },
} as const;

/** The five offsets a colour sample is averaged over, in logical px. */
const SAMPLE_OFFSETS: readonly (readonly [number, number])[] = [
  [0, 0],
  [4, 0],
  [-4, 0],
  [0, 4],
  [0, -4],
];

/**
 * The rendered colour at a logical point, averaged over a small cluster.
 *
 * The centre pixel plus four neighbours 4 px out, all of which stay inside the
 * solid body of every shape sampled, so one stray anti-aliased or glow pixel
 * cannot swing the reading.
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

/** A `#rrggbb` colour from `constants.ts`, as channels to compare against. */
export function hexRgb(hex: string): Rgb {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  return {
    r: (value >> 16) & 0xff,
    g: (value >> 8) & 0xff,
    b: value & 0xff,
  };
}

/** Euclidean distance between two colours, 0 to about 441. */
export function colorDistance(a: Rgb, b: Rgb): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

/** Every point in `COLOR_POINTS`, sampled off the canvas as it stands. */
export async function sampleScene(
  h: Harness,
): Promise<Record<keyof typeof COLOR_POINTS, Rgb>> {
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
    background: await sampleColor(
      h,
      COLOR_POINTS.background.x,
      COLOR_POINTS.background.y,
    ),
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

/**
 * The geometry calls a frame made, by name.
 *
 * Enough of a count to compare two frames of the same scene: a frame that drew a
 * trail asked for strictly more of these than the same frame with the ball at
 * rest, whatever shape the build chose to draw it as.
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
 * A trail is a sequence of draws rather than one shape, so where a render put
 * its geometry is the direct reading of it: the coordinates behind the ball are
 * the trail, and the ones at the ball are the ball. The leading pair of
 * arguments is the position for every method listed, except the curve calls,
 * whose control points come first and whose endpoint is the last pair.
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
