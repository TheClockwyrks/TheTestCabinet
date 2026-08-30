// Coil — the shared validator harness. CASE-PROVIDED.
//
// Every check in this project is an ordinary vitest test that drives the built
// site IN A REAL BROWSER. There is nothing to import: an engineless run seeds no
// `src/` at all, so the build wrote its own frame loop, its own canvas fit, its
// own keyboard, its own audio, and its own `window.__coil` — and the only place
// all of that exists is a page that has loaded the bundle. So the project serves
// `dist/`, loads it in Chromium, and reaches the game the way anything reaches
// it: over the surface `specs/instrumentation.md` told the build to install.
//
// IT IS STILL A VITEST PROJECT, AND THAT IS DELIBERATE. The runner locates the
// build output before it chooses between the vitest and browser paths, so `dist/`
// is on disk by the time this project runs. Staying a vitest project is what lets
// the case name ONE script per review item and have it resolve under every engine
// — `validation/turning/reversal-discarded.test.ts` is the same path whichever
// runtime the run selected — and what keeps `format = 2` resolution passing.
//
// WHAT A CHECK READS. The game's own state (through `window.__coil`'s
// `snapshot`), the frames the harness itself drove, the operations the build
// issued against its 2D context, the sprites it blitted and where, the pixels all
// of that left on the canvas, and the cues it played. Nothing here fabricates an
// outcome: the scenario helpers below only ARRANGE the world through the surface,
// one atomic operation at a time, and the real tick the build wrote is what runs
// from there.
//
// THE CLOCK IS THE SURFACE'S. Nothing outside an engineless build owns its loop,
// so `specs/instrumentation.md` puts the clock on the surface: `setAutoStep(false)`
// takes the game off real time and `advance(seconds, frames)` runs whole frames
// of a chosen length. Every harness opens by taking the game off the clock, so a
// check asks for a number of ticks and gets exactly that number — no polling, no
// waiting, and no measurement of the machine it ran on. The one check that is
// ABOUT the loop running itself (`movement/advances-in-real-time`) hands it back
// with `runFor`.
//
// WHERE THE COMPOUND SEQUENCES LIVE. Here, and nowhere else. The debug surface is
// atomic by design — one field, one read, one clock move — so reaching a screen,
// posing a chain, arranging an eat, or filling the board to its last free cell is
// several calls in a fixed order. Each of those orders is written ONCE, in the
// scenario section at the foot of this file, and every suite that needs part of
// one calls the operations it needs instead of restating the whole.
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
import { fail } from "./assert";
import {
  BOARD_X,
  BOARD_Y,
  CELL,
  CUE_NAMES,
  DIRECTIONS,
  INTERIOR_COL_MAX,
  INTERIOR_COL_MIN,
  INTERIOR_ROW_MAX,
  INTERIOR_ROW_MIN,
  OPPOSITE,
  STAGE_H,
  STAGE_W,
  STEP,
  TICK_SECONDS,
  UNBOUND_KEY,
  type Cell,
  type Dir,
  type Screen,
} from "./constants";
import {
  HANDLE,
  OBSTACLE_OPS,
  REQUIRED_OPS,
  type CoilDebugApi,
  type CoilSnapshot,
  type DrivenSurface,
} from "./surface";

export { HANDLE, REQUIRED_OPS, OBSTACLE_OPS };
export type { Cell, CoilSnapshot, CoilDebugApi, DrivenSurface };

declare module "vitest" {
  export interface ProvidedContext {
    /** Where the built site is served, from `globalSetup.ts`. */
    coilUrl: string;
    /** The one Chromium every suite worker connects to. */
    coilBrowserWs: string;
  }
}

/* -------------------------------------------------------------------------- */
/* The step schedule                                                          */
/* -------------------------------------------------------------------------- */
//
// The suite chooses the length of a frame, because the specification deliberately
// fixes none: `specs/movement.md` puts the game on a fixed TICK of
// `TICK_SECONDS`, fed by whatever elapsed time the runtime hands each update and
// carrying the remainder, so a build must reach the same place however that time
// was divided into frames.
//
// The choice here is 64 Hz, and the reason is exactness. A tick is then EIGHT
// frames, a frame is `0.015625` s, and both are exact in binary floating point —
// so a check that asks for twenty-eight ticks of game time hands the build
// exactly `3.5` s of it, and the tick a combo window lapses on is decided by the
// build's arithmetic rather than by the last bit of ours. Every duration this
// specification states is a whole number of these frames: the combo window is
// 224, the bite is 16. The check that is ABOUT the subdivision
// (`movement/subdivision-invariant`) drives the same second under other divisions
// of its own.

/** Frames the harness drives per second of game time. */
export const FRAME_HZ = 64;

/** One frame of game time, in milliseconds. */
export const FRAME_MS = 1000 / FRAME_HZ;

/** Frames of the harness's clock one tick of the simulation covers. */
export const FRAMES_PER_TICK = Math.round(TICK_SECONDS * FRAME_HZ);

/** Frames covering `ticks` whole ticks of simulation time. */
export function tickFrames(ticks: number): number {
  return ticks * FRAMES_PER_TICK;
}

/** Frames covering `seconds` of simulation time, rounded up to a whole frame. */
export function secondFrames(seconds: number): number {
  return Math.ceil(seconds * FRAME_HZ);
}

/* -------------------------------------------------------------------------- */
/* Readings taken off the page                                                */
/* -------------------------------------------------------------------------- */

/** One recorded operation on the 2D context, in the order the render made it. */
export type DrawCall =
  | { kind: "call"; method: string; args: unknown[] }
  | { kind: "set"; property: string; value: unknown };

/** One operation as the injected recorder writes it. */
export type RecordedOp =
  | { op: "call"; method: string; args: unknown[] }
  | { op: "set"; property: string; value: unknown };

/**
 * One bitmap the build blitted, as `image-init.js` logs it.
 *
 * `id` is the source's identity: two blits carry the same one exactly when they
 * painted the same file. The rectangle is in DEVICE pixels, mapped through the
 * transform in force at the call, and `x + w / 2, y + h / 2` is its centre under
 * any transform the build drew under.
 */
export interface Blit {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Whether image smoothing was on at the moment of this blit. */
  smoothing: boolean;
  /**
   * The quarter turns the blit carried the sprite's OWN `+x` axis through, or
   * `null` when the transform was not a whole number of quarter turns.
   *
   * `0` is the sprite drawn the way it was authored, `1` a quarter turn toward
   * `down`, `2` a half turn, `3` a quarter turn toward `up` — the same order
   * `right`, `down`, `left`, `up` runs in on a y-down canvas. `specs/assets.md`
   * authors each sprite in ONE orientation and has it "rotated in quarter turns
   * when it is drawn", and this is the turn it was drawn under. The picture on
   * the canvas cannot answer that on its own: a sprite authored backwards and a
   * renderer that turns it backwards compose to the right picture, and only the
   * turn itself tells the two halves apart. See `image-init.js`.
   */
  quarterTurns: number | null;
}

/** A cue the build played, and the frame of the drive it played it on. */
export interface TimedCue {
  /** The frame it sounded on, 1-based, as {@link Harness.frame} reports. */
  frame: number;
  /** The frame loop's simulated time at that frame, in milliseconds. */
  t: number;
  /**
   * The cue, named from the file the sound came from, or `null` for a sound
   * whose file could not be named. See `audio-init.js`.
   */
  name: string | null;
  /** Whether the source was asked to loop, which is what `music` is. */
  loop: boolean;
  /** The URL the sound's bytes came from, where there was one. */
  url: string | null;
}

/** What one frame's render issued: its operations, and its bitmap blits. */
export interface FrameDraw {
  calls: DrawCall[];
  blits: Blit[];
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

/** How far a sweep may run, in whole ticks. */
export interface UntilOptions {
  maxTicks?: number;
}

/** What a sweep found: whether the predicate ever held, and where it stopped. */
export interface UntilResult {
  hit: boolean;
  /** Ticks driven before the sample that ended the sweep. */
  ticks: number;
  snapshot: CoilSnapshot;
}

export interface Harness {
  /** The page the build is running in. For a check that needs Playwright itself. */
  readonly page: Page;
  /**
   * The surface the BUILD installed, as operations that cross into the page.
   *
   * Read off `window.__coil` and never constructed here — see
   * {@link unexposedSurface}.
   */
  readonly debug: DrivenSurface;
  /**
   * Why the build's surface cannot be driven, or `null` when it can.
   *
   * A fault here is the build's: the surface is missing, or it is missing an
   * operation the specification requires. It says what was found
   * (`window.__coil was still absent 5s after the page loaded`), and
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
  snapshot(): Promise<CoilSnapshot>;
  /** Run `frames` frames of the harness's clock, back to back. */
  advance(frames: number): Promise<void>;
  /** Run `ticks` whole ticks of simulation time, and read what they left. */
  tick(ticks?: number): Promise<CoilSnapshot>;
  /** Drive a tick at a time until `predicate` holds, or the budget is spent. */
  until(
    predicate: (snapshot: CoilSnapshot) => boolean,
    options?: UntilOptions,
  ): Promise<UntilResult>;
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
   * `specs/controls.md` makes every action a press EDGE, so one tap is one action
   * however long the key is nominally down.
   */
  tap(code: string): Promise<void>;

  /** Run exactly one frame and hand back everything its render issued. */
  frameDraw(): Promise<FrameDraw>;
  /** Run exactly one frame and hand back the operations its render issued. */
  frameCalls(): Promise<DrawCall[]>;
  /** Run exactly one frame and hand back the bitmaps it blitted. */
  frameBlits(): Promise<Blit[]>;
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

  /**
   * Whether the build has the cue `name` sounding as a loop at this moment.
   *
   * `audio-init.js` holds each looping source from the moment it starts until
   * something ends it, so this is a reading of what is playing NOW rather than of
   * what was once asked for. {@link watchCues} records the other thing: the
   * moments a cue was ASKED for. A bed that was started and never stopped shows
   * one entry in the log and reads `true` here.
   */
  looping(name: string): Promise<boolean>;

  /** Release anything held, and let the page go. */
  dispose(): Promise<void>;
}

/* ---- The page ------------------------------------------------------------- */

/** The init scripts injected before any of the build's own script runs. */
const INIT_SCRIPTS = [
  "recorder-init.js",
  "audio-init.js",
  "image-init.js",
] as const;

/** This module's directory: the validator project's root. */
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * How long the surface is waited for before the build is called non-conformant.
 *
 * Generous against a conformant build and cheap against one: the wait is a poll
 * that returns the instant the global appears, and `specs/instrumentation.md`
 * has the build install it as soon as the game has initialized, so a page that
 * has fired `load` has either installed it already or is not going to. What the
 * ceiling really bounds is the cost of a build with no surface at all, which pays
 * it once per harness.
 */
const SURFACE_TIMEOUT_MS = 5_000;

/**
 * How long {@link Harness.armAudio} waits for the build's cues to decode.
 *
 * Short, because it is paid in full by a build that decodes nothing — one that
 * synthesizes its sound, or plays it through an `<audio>` element, or ships none
 * at all — and none of those is a build this wait can help. A build that does
 * decode its files off a loopback server is ready in a few milliseconds, and this
 * returns the instant it is.
 */
const AUDIO_LOAD_TIMEOUT_MS = 2_000;

let browserPromise: Promise<Browser> | null = null;

async function sharedBrowser(): Promise<Browser> {
  browserPromise ??= connectChromium(inject("coilBrowserWs"));
  return browserPromise;
}

/**
 * One browser context per WINDOW SHAPE, shared by every harness of that shape in
 * this file, and one PAGE per harness inside it.
 *
 * The split is what the init scripts force and what correctness wants. The three
 * probes are installed on the CONTEXT, so every page it opens is instrumented
 * before a line of the build's script runs, and a context is also where the
 * viewport and the device pixel ratio are fixed — which is the one thing
 * `presentation/window-fit` varies. Everything else about a harness is the page:
 * a fresh one opens on a build that has just started, with no key held, no audio
 * context opened, and the mute preference back off, which is a stronger guarantee
 * than any reset the surface offers, since `reset()` deliberately leaves muting
 * alone.
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
 * list — `specs/mode.md` gives an obstacle-laying mode two operations no other
 * mode carries — and a stub written against the common surface would report one
 * of those as merely absent rather than as the consequence of the build's missing
 * install.
 *
 * Keys that belong to the MACHINERY rather than to a check are answered with
 * `undefined` instead: awaiting a value probes `then`, and vitest's own error
 * formatting probes symbols and `constructor`. Failing those would replace the
 * verdict below with noise from the machinery that was trying to report it.
 */
function unexposedSurface(reason: string): DrivenSurface {
  return new Proxy({} as DrivenSurface, {
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
 * Fail the running check on `fault`, the harness's account of what is wrong
 * with the build's surface, paired with what the specification requires.
 */
export function failSurface(fault: string): never {
  return fail(SURFACE_REQUIREMENT, fault);
}

/**
 * What is wrong with the surface this page installed, or `null` when nothing
 * is: the surface never appeared, or it appeared without an operation the
 * specification requires of every mode.
 *
 * The two obstacle operations are deliberately not required here. They are laid
 * by an obstacle-placing mode alone, so their absence is a fault only in a build
 * whose snapshot reports such a mode — which is what {@link obstacleOps} decides,
 * at the one moment the mode is known.
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

  await page.goto(inject("coilUrl"), { waitUntil: "load" });

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
      : (new Proxy({} as DrivenSurface, {
          get: (_target, property): unknown => {
            if (typeof property === "symbol") return undefined;
            if (property === "then" || property === "constructor")
              return undefined;
            const name = String(property);
            return (...args: unknown[]) => call(name, args);
          },
        }) as DrivenSurface);

  if (surfaceFault === null) {
    // Off the wall clock and back to the title before a check touches anything:
    // from here the game changes only when this harness says so. `reset` re-arms
    // manual stepping on its own (specs/instrumentation.md), and the explicit
    // call before it is what stops the loop while the reset itself runs.
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
            window as unknown as { __coilRec: { ready(): boolean } }
          ).__coilRec.ready(),
        undefined,
        { timeout: SURFACE_TIMEOUT_MS },
      )
      .catch(() => undefined);
  }

  const view = fitViewport(cssWidth, cssHeight, dpr);
  const cueSinks: TimedCue[][] = [];
  let frameCount = 0;
  let timeMs = 0;

  /** One sound, as `audio-init.js` logs it. */
  type Sound = { name: string | null; url: string | null; loop: boolean };

  /**
   * How many sounds of the page's log have already been handed to the sinks.
   *
   * Kept here rather than in the page because it is a fact about what THIS
   * harness has attributed, and because a sound can be played outside every
   * driven frame — see {@link takeCues}.
   */
  let heard = 0;

  /**
   * Hand `sounds` to every watcher, stamped with the frame they belong to.
   *
   * A SOUND PLAYED OUTSIDE A DRIVEN FRAME BELONGS TO THE LAST FRAME DRIVEN. The
   * build's own animation frame keeps running while the simulation is held off
   * the wall clock: `specs/instrumentation.md` says so, because a menu still has
   * to answer a key press with the game stopped. So an action a check taps can be
   * drained by the build's own frame rather than by the one the harness drove a
   * moment later, and the cue it plays lands between two crossings. Attributing
   * those to the frame count as it stands is exact where it matters — a tap
   * advances the counter by exactly one frame, so a cue the tap caused is stamped
   * with the tap's frame whichever loop drained it — and never loses a sound.
   */
  const takeCues = (sounds: readonly Sound[], frame: number): void => {
    for (const sound of sounds) {
      for (const sink of cueSinks) {
        sink.push({ frame, t: timeMs, ...sound });
      }
    }
  };

  /**
   * Read the game's state, and with it everything played since the last look.
   *
   * One crossing rather than two, and the reason it is the SNAPSHOT that carries
   * the drain is that a check reads the state at the end of every scenario: it is
   * the one call the harness can be sure happens after the last thing a build was
   * asked to do.
   */
  const readSnapshot = async (): Promise<CoilSnapshot> => {
    if (surfaceFault !== null) refuse();
    const result = (await page.evaluate(
      ([handle, from]) => {
        const api = (
          window as unknown as Record<
            string,
            Record<string, (...a: unknown[]) => unknown>
          >
        )[handle];
        const audio = (
          window as unknown as {
            __coilAudio: { count(): number; since(n: number): unknown[] };
          }
        ).__coilAudio;
        return {
          snapshot: api.snapshot(),
          outside: audio.since(from),
          count: audio.count(),
        };
      },
      [HANDLE, heard] as const,
    )) as { snapshot: CoilSnapshot; outside: Sound[]; count: number };
    heard = result.count;
    takeCues(result.outside, frameCount);
    return result.snapshot;
  };

  /**
   * Run `frames` frames and read the state they left, in one crossing.
   *
   * Each frame is opened and closed around a single `advance(dt, 1)`, all inside
   * one synchronous evaluation, so nothing the page's own animation frame renders
   * can land inside a recorded frame — and so a frame the recorder keeps is
   * exactly one frame the game ran. That is also what makes the per-frame cue and
   * blit readings exact: nothing else in the page can run between a frame opening
   * and closing.
   *
   * `collect` asks for the last frame's operations and blits as well. It is off
   * for a plain drive because a frame of a grid game is hundreds of operations,
   * and a sweep that carried them all back would spend its time on drawing no
   * check is going to read.
   */
  const drive = async (
    frames: number,
    collect = false,
  ): Promise<{ snapshot: CoilSnapshot; draw: FrameDraw }> => {
    if (surfaceFault !== null) refuse();
    const deltas: number[] = [];
    for (let i = 0; i < frames; i += 1) deltas.push(FRAME_MS);
    const result = (await page.evaluate(
      ([handle, dts, wanted, from]) => {
        const api = (
          window as unknown as Record<
            string,
            Record<string, (...a: unknown[]) => unknown>
          >
        )[handle];
        const rec = (
          window as unknown as {
            __coilRec: Record<string, (...a: unknown[]) => unknown>;
          }
        ).__coilRec;
        const audio = (
          window as unknown as {
            __coilAudio: { count(): number; since(n: number): unknown[] };
          }
        ).__coilAudio;
        const images = (
          window as unknown as {
            __coilImages: { count(): number; since(n: number): unknown[] };
          }
        ).__coilImages;
        // Anything played since the last look, before this drive opens a frame.
        const outside = audio.since(from);
        let cursor = audio.count();
        const sounds: unknown[][] = [];
        let blits: unknown[] = [];
        for (const dt of dts) {
          const blitsBefore = images.count();
          rec.begin();
          api.advance(dt / 1000, 1);
          rec.end(dt);
          sounds.push(audio.since(cursor));
          cursor = audio.count();
          if (wanted) blits = images.since(blitsBefore);
        }
        return {
          snapshot: api.snapshot(),
          outside,
          sounds,
          count: cursor,
          ops: wanted ? rec.last() : [],
          blits,
        };
      },
      [HANDLE, deltas, collect, heard] as const,
    )) as {
      snapshot: CoilSnapshot;
      outside: Sound[];
      sounds: Sound[][];
      count: number;
      ops: RecordedOp[];
      blits: Blit[];
    };

    heard = result.count;
    takeCues(result.outside, frameCount);
    for (const [index, delta] of deltas.entries()) {
      frameCount += 1;
      timeMs += delta;
      takeCues(result.sounds[index], frameCount);
    }
    return {
      snapshot: result.snapshot,
      draw: { calls: result.ops.map(toDrawCall), blits: result.blits },
    };
  };

  const readPixels = async (
    devicePoints: readonly { x: number; y: number }[],
  ): Promise<[number, number, number, number][]> =>
    page.evaluate(
      (points) => {
        const canvases = Array.from(document.querySelectorAll("canvas"));
        if (canvases.length === 0)
          throw new Error("coil: the page has no <canvas>");
        let canvas = canvases[0];
        for (const other of canvases) {
          if (other.width * other.height > canvas.width * canvas.height)
            canvas = other;
        }
        const ctx = canvas.getContext("2d");
        if (ctx === null) throw new Error("coil: the canvas has no 2D context");
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

    snapshot: () => readSnapshot(),

    advance: async (frames) => {
      await drive(frames);
    },

    tick: async (ticks = 1) => (await drive(tickFrames(ticks))).snapshot,

    async until(predicate, untilOptions = {}) {
      const maxTicks = untilOptions.maxTicks ?? 400;

      let snapshot = await readSnapshot();
      if (predicate(snapshot)) return { hit: true, ticks: 0, snapshot };

      for (let ticks = 1; ticks <= maxTicks; ticks += 1) {
        snapshot = (await drive(FRAMES_PER_TICK)).snapshot;
        if (predicate(snapshot)) return { hit: true, ticks, snapshot };
      }
      return { hit: false, ticks: maxTicks, snapshot };
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
            window as unknown as { __coilRec: { setMode(m: string): void } }
          ).__coilRec.setMode("raf");
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
            window as unknown as { __coilRec: { setMode(m: string): void } }
          ).__coilRec.setMode("manual");
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

    frameDraw: async () => (await drive(1, true)).draw,
    frameCalls: async () => (await drive(1, true)).draw.calls,
    frameBlits: async () => (await drive(1, true)).draw.blits,

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
            "coil: the page has no <canvas>, so the build drew nowhere — " +
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
      // Two things, in this order, and each of them is something a build is
      // entitled to make a check wait for.
      //
      // The FILES first. A build fetches and decodes its cues after the page has
      // loaded (`specs/assets.md` puts the four `.wav`s under `assets/` and has
      // the build load them itself), so a check that drove the game the instant
      // the page settled could reach the eat before the eat's own clip had
      // arrived and read silence from a build that is simply still starting up.
      // The wait is BOUNDED and never fails: `specs/assets.md` says a load that
      // fails leaves the game running, so a build with no audio at all must reach
      // its cue points and fail them, rather than hang here.
      //
      // Then a GENUINE browser gesture, not a posed one: a build is free to open
      // its audio context from a real DOM event alone (both are conformant), so a
      // key delivered any other way would leave a perfectly good build silent.
      // The key is bound to nothing, so arming changes no game state.
      await page
        .waitForFunction(
          (wanted) => {
            const audio = (
              window as unknown as { __coilAudio?: { decoded(): string[] } }
            ).__coilAudio;
            if (audio === undefined) return false;
            const held = audio.decoded();
            return wanted.every((name) => held.includes(name));
          },
          [...CUE_NAMES],
          { timeout: AUDIO_LOAD_TIMEOUT_MS, polling: 25 },
        )
        .catch(() => undefined);
      await page.keyboard.press(UNBOUND_KEY);
    },

    async looping(name) {
      const sounding = (await page.evaluate(() => {
        const audio = (
          window as unknown as { __coilAudio: { looping(): string[] } }
        ).__coilAudio;
        return audio.looping();
      })) as string[];
      return sounding.includes(name);
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

/* -------------------------------------------------------------------------- */
/* The fit and the board's geometry                                           */
/* -------------------------------------------------------------------------- */

/**
 * How the stage maps onto a surface of this shape, as `specs/overview.md` fixes
 * it: one uniform scale, the whole stage inside, centred, with the leftover split
 * evenly into two bars.
 *
 * Computed rather than read from the build, deliberately. Under an engine the fit
 * is the engine's and a check can ask it what it derived; here the fit is the
 * build's own work, so asking it would be asking a build to grade itself. Every
 * check but `presentation/window-fit` runs at the stage's own size, where this is
 * the identity and the question does not arise; that one check runs at other
 * shapes and reads the pixels against what the specification says should be there.
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

/** The logical centre of cell `(col, row)`, as `specs/board.md` places it. */
export function cellCenter(col: number, row: number): { x: number; y: number } {
  return {
    x: BOARD_X + col * CELL + CELL / 2,
    y: BOARD_Y + row * CELL + CELL / 2,
  };
}

/** Whether `(col, row)` is an interior cell, which is any cell not a wall cell. */
export function isInterior(col: number, row: number): boolean {
  return (
    col >= INTERIOR_COL_MIN &&
    col <= INTERIOR_COL_MAX &&
    row >= INTERIOR_ROW_MIN &&
    row <= INTERIOR_ROW_MAX
  );
}

/** Whether the two name the same cell. */
export function sameCell(a: Cell, b: Cell): boolean {
  return a.col === b.col && a.row === b.row;
}

/** Whether `cells` holds `cell`. */
export function holdsCell(cells: readonly Cell[], cell: Cell): boolean {
  return cells.some((held) => sameCell(held, cell));
}

/** The cell `n` steps along `dir` from `cell`. */
export function ahead(cell: Cell, dir: Dir, n = 1): Cell {
  return {
    col: cell.col + STEP[dir].col * n,
    row: cell.row + STEP[dir].row * n,
  };
}

/**
 * A straight chain of `length` cells with its head at `head`, laid out behind it.
 *
 * The body trails OPPOSITE `dir`, which is where a snake that arrived travelling
 * that way left it, so the chain a check poses is one the game could have reached
 * by playing. `specs/board.md` requires each cell after the first to be
 * orthogonally adjacent to the one before it, which this satisfies by
 * construction.
 */
export function chainFrom(head: Cell, dir: Dir, length: number): Cell[] {
  const back = OPPOSITE[dir];
  const cells: Cell[] = [];
  for (let i = 0; i < length; i += 1) cells.push(ahead(head, back, i));
  return cells;
}
/* ---- Draw calls ----------------------------------------------------------- */

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
 * `validation/turning/reversal-discarded.test.ts` — because that is the path the review
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
export const MAX_REPLAY_FRAMES = 300;

/**
 * The ground the console's player paints behind a recorded frame.
 *
 * The specification fixes no palette: `specs/overview.md` has the build paint its
 * own stage background each frame, letterbox bars included, and the recorded
 * frames carry that paint. What the player needs is a colour for the canvas under
 * them, and the page the build is served on is painted `#000` by the case's own
 * `index.html`, so that is what a replay says.
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
    console.warn(`coil: could not write ${destination}: ${String(error)}`);
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
        window as unknown as { __coilRec: { arm(d: unknown): boolean } }
      ).__coilRec.arm(design),
    { width: STAGE_W, height: STAGE_H, background: REPLAY_BACKGROUND },
  );
  try {
    return await scenario();
  } finally {
    // In a `finally`, so a scenario that failed still leaves its evidence behind.
    const recording = (await h.page.evaluate(() =>
      (
        window as unknown as { __coilRec: { disarm(): unknown } }
      ).__coilRec.disarm(),
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
    console.warn(`coil: could not write ${destination}: ${String(error)}`);
  }
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
 * A build is free to draw under a transform — and an engineless build always is,
 * because `specs/overview.md` makes the fit from the logical stage to the canvas
 * the build's own work, which is most naturally a transform on the context. So
 * the position a `fillText` names is only where the text landed once the
 * transform in force at that call is applied. This walks the frame's operations
 * and carries that transform: `save`/`restore`, `translate`, `scale`, `rotate`,
 * `transform`, `setTransform` and `resetTransform`. At the harness's default
 * shape the canvas is the stage at one pixel per unit, so the result is in
 * logical units as well.
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
 * combo bar asked for strictly more of these than the same frame with no
 * multiplier to show, whatever shape the build chose to draw it as.
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
 * Every point a frame's drawing calls named, in the space they were issued in.
 *
 * Where a render put its geometry is the direct reading of what it drew: the
 * coordinates inside the HUD band are the HUD, and the ones over the board are
 * the board. The leading pair of arguments is the position for every method
 * listed, except the curve calls, whose control points come first and whose
 * endpoint is the last pair. Unlike {@link textDraws} these are NOT mapped
 * through the transform, so a check that needs canvas pixels reads text draws or
 * blits instead.
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
/* Cues                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Record every cue the build plays from now on, stamped with the frame of the
 * drive it played on and named by the file it came from.
 *
 * WHAT IS OBSERVED, AND WHY IT IS THE FAIR READING. `specs/ui.md` requires one
 * cue per event, played on the tick its event resolves, and names the four:
 * `eat`, `combo-up`, `death`, and a looping `music`. It says nothing about how a
 * build makes a sound — under this engine the whole audio layer is the build's —
 * but `specs/assets.md` DOES fix the file behind each cue, so `audio-init.js`
 * carries the file's name from the fetch, through the decode, to the source that
 * plays it. A check therefore reads which cue sounded, not merely that something
 * did.
 *
 * A sound whose file cannot be named arrives with a `name` of `null` and is
 * still recorded, so a build's own synthesized flourish is never mistaken for one
 * of the four and never silently dropped.
 */
export function watchCues(h: Harness): TimedCue[] {
  const played: TimedCue[] = [];
  harnessCues.get(h)?.push(played);
  return played;
}

/** Every recorded play of the cue `name`, in the order they sounded. */
export function cuesNamed(cues: readonly TimedCue[], name: string): TimedCue[] {
  return cues.filter((cue) => cue.name === name);
}

/** Every recorded play that fell on frame `frame` of the drive. */
export function cuesOnFrame(
  cues: readonly TimedCue[],
  frame: number,
): TimedCue[] {
  return cues.filter((cue) => cue.frame === frame);
}

/* -------------------------------------------------------------------------- */
/* Blits                                                                      */
/* -------------------------------------------------------------------------- */

/** Where a blit's centre landed, in device pixels. */
export function blitCenter(blit: Blit): { x: number; y: number } {
  return { x: blit.x + blit.w / 2, y: blit.y + blit.h / 2 };
}

/**
 * Every blit whose centre landed inside cell `(col, row)`.
 *
 * A sprite covers one cell (`specs/assets.md`), so the cell a blit belongs to is
 * the one its centre falls in — which stays true under the quarter turns that
 * same file has a sprite drawn with, and under whatever fit the build applied.
 */
export function blitsOnCell(
  h: Harness,
  blits: readonly Blit[],
  col: number,
  row: number,
): Blit[] {
  const view = h.viewport();
  const half = (CELL * view.scale) / 2;
  const middle = cellCenter(col, row);
  const at = toDevice(view, middle.x, middle.y);
  return blits.filter((blit) => {
    const centre = blitCenter(blit);
    return (
      Math.abs(centre.x - at.x) <= half && Math.abs(centre.y - at.y) <= half
    );
  });
}

/**
 * The blit that painted cell `(col, row)`, or `null` for a cell no blit landed
 * on.
 *
 * The LAST blit on the cell, for the same reason {@link spriteOnCell} takes it:
 * that is the one a player sees. A check that needs the whole stack has
 * {@link blitsOnCell}.
 */
export function blitOnCell(
  h: Harness,
  blits: readonly Blit[],
  col: number,
  row: number,
): Blit | null {
  const on = blitsOnCell(h, blits, col, row);
  return on.length === 0 ? null : on[on.length - 1]!;
}

/**
 * The identity of the sprite painted on cell `(col, row)`, or `null` for a cell
 * no blit landed on.
 *
 * The LAST blit on the cell, because that is the one a player sees: a build that
 * paints a cell twice has shown the second.
 */
export function spriteOnCell(
  h: Harness,
  blits: readonly Blit[],
  col: number,
  row: number,
): string | null {
  const found = blitsOnCell(h, blits, col, row);
  return found.length === 0 ? null : found[found.length - 1].id;
}

/* -------------------------------------------------------------------------- */
/* Colour                                                                     */
/* -------------------------------------------------------------------------- */

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

/**
 * The colour rendered at the centre of cell `(col, row)`.
 *
 * The centre pixel itself rather than an average over a cluster, because that is
 * how the visibility points are worded and because a cell is `CELL` (32) units
 * across: its centre is sixteen units from the nearest edge, far outside any
 * anti-aliased rim, and a build's own ruling or glow at a cell's border cannot
 * reach it.
 */
export async function sampleCell(
  h: Harness,
  col: number,
  row: number,
): Promise<Rgb> {
  const middle = cellCenter(col, row);
  const [r, g, b] = await h.pixel(middle.x, middle.y);
  return { r, g, b };
}

/** The colours at the centres of several cells, in one crossing into the page. */
export async function sampleCells(
  h: Harness,
  cells: readonly Cell[],
): Promise<Rgb[]> {
  const read = await h.pixels(
    cells.map((cell) => cellCenter(cell.col, cell.row)),
  );
  return read.map(([r, g, b]) => ({ r, g, b }));
}

/**
 * An interior cell the posed board leaves empty: no snake segment, no pellet, no
 * obstacle, and none of `exclude`.
 *
 * Scanned in a fixed order from the board's top-left, so the same posed scene
 * always yields the same cell and a failing check replays. A board with no empty
 * interior cell at all is the board-cleared ending rather than a scene a check
 * samples, so finding none fails loudly here rather than returning a cell that is
 * not empty.
 */
export function emptyInteriorCell(
  snapshot: CoilSnapshot,
  exclude: readonly Cell[] = [],
): Cell {
  for (let row = INTERIOR_ROW_MIN; row <= INTERIOR_ROW_MAX; row += 1) {
    for (let col = INTERIOR_COL_MIN; col <= INTERIOR_COL_MAX; col += 1) {
      const cell = { col, row };
      if (holdsCell(snapshot.snake, cell)) continue;
      if (snapshot.pellet !== null && sameCell(snapshot.pellet, cell)) continue;
      if (holdsCell(snapshot.obstacles, cell)) continue;
      if (holdsCell(exclude, cell)) continue;
      return cell;
    }
  }
  return fail(
    "an empty interior cell on the posed board",
    "every interior cell carries the snake, the pellet or an obstacle",
  );
}

/**
 * A cell of the wall border, on the left edge halfway down.
 *
 * `specs/board.md` makes the border one cell thick on all four sides, so column
 * `0` is border at every row, and the mid-height row is as far from a corner as
 * the board goes.
 */
export const WALL_CELL: Cell = {
  col: 0,
  row: Math.floor((INTERIOR_ROW_MIN + INTERIOR_ROW_MAX) / 2),
};

/* -------------------------------------------------------------------------- */
/* The obstacle operations                                                    */
/* -------------------------------------------------------------------------- */

/** The two operations a mode that lays obstacle cells adds to the surface. */
export interface ObstacleSurface {
  clearObstacles(): Promise<void>;
  addObstacle(col: number, row: number): Promise<void>;
}

/** Whether the mode this build ships lays obstacle cells at all. */
export function laysObstacles(snapshot: CoilSnapshot): boolean {
  return snapshot.mode === "maze";
}

/** What each harness's page answered about its obstacle operations. */
const obstacleSurfaces = new WeakMap<Harness, ObstacleSurface | null>();

/**
 * The obstacle operations, or `null` under a mode that lays no obstacle cell.
 *
 * `specs/instrumentation.md` puts `clearObstacles` and `addObstacle` on the
 * surface of an obstacle-placing mode alone, so their absence is a fault only in
 * a build whose snapshot reports such a mode. This is the one moment the mode is
 * known, so it is where the requirement is decided.
 *
 * Answered once per harness and remembered, because a page runs one build and
 * `specs/mode.md` gives that build one mode for the whole session — and because
 * every posed scene asks, so the two crossings this costs would otherwise be paid
 * a few hundred times over a suite run.
 */
export async function obstacleSurface(
  h: Harness,
): Promise<ObstacleSurface | null> {
  const remembered = obstacleSurfaces.get(h);
  if (remembered !== undefined) return remembered;
  const surface = await readObstacleSurface(h);
  obstacleSurfaces.set(h, surface);
  return surface;
}

async function readObstacleSurface(
  h: Harness,
): Promise<ObstacleSurface | null> {
  const snapshot = await h.snapshot();
  if (!laysObstacles(snapshot)) return null;
  const { ops } = await h.probe(OBSTACLE_OPS);
  const missing = OBSTACLE_OPS.filter((op) => ops[op] !== "function");
  if (missing.length > 0) {
    failSurface(
      `window.${HANDLE} is installed and the build reports the ${snapshot.mode} ` +
        `mode, which lays obstacle cells, but the surface carries no ${missing
          .map((op) => `${op}()`)
          .join(", ")}`,
    );
  }
  const surface = h.debug as unknown as ObstacleSurface;
  return {
    clearObstacles: () => surface.clearObstacles(),
    addObstacle: (col, row) => surface.addObstacle(col, row),
  };
}

/**
 * Take every obstacle cell off the board, under a mode that lays any.
 *
 * A no-op under a mode that lays none, so a scenario that wants an open interior
 * says so once and reads the same board under either build.
 */
export async function clearObstacles(h: Harness): Promise<void> {
  const surface = await obstacleSurface(h);
  if (surface !== null) await surface.clearObstacles();
}

/* -------------------------------------------------------------------------- */
/* Posing a world                                                             */
/* -------------------------------------------------------------------------- */
//
// The surface is atomic — one field, one read, one clock move — so a scenario is
// several calls in a fixed order, and the order matters: an obstacle cannot be
// laid on a cell the snake holds, a pellet cannot be placed on a snake segment or
// an obstacle, and the screen is set last so the tick never runs over a
// half-arranged board. That order is written once, here.
//
// The rule the guide states is that a validator poses an ISOLATED world: it
// clears every entity the requirement is not about and spawns back exactly what
// it is about, and it holds still the faculties the requirement does not
// exercise. `specs/instrumentation.md` gives Coil three switches for that
// (`steering`, `travel`, `pelletRespawn`) and operations that place and remove
// each kind of thing on the board. {@link poseScene} is the one place they are
// spoken in a single breath.

/** A world to pose, one field per thing on the board or switch over it. */
export interface Scene {
  /** The seed `reset` lays the pellet generator with. */
  seed?: number;
  /**
   * The obstacle course: cleared outright, left as the mode lays it, or laid as
   * exactly these cells. Cleared by default — see {@link poseScene}.
   */
  obstacles?: readonly Cell[] | "cleared" | "course";
  /** The chain, head first. */
  snake?: readonly Cell[];
  /** The direction the snake travels in. */
  dir?: Dir;
  /** The live pellet, or `null` for a board with none. */
  pellet?: Cell | null;
  score?: number;
  best?: number;
  /** The multiplier M. */
  combo?: number;
  /** Seconds left on the combo window; `0` is closed. */
  comboWindow?: number;
  /** Whether a steering request is taken and applied. On by default. */
  steering?: boolean;
  /** Whether the head advances and collides. On by default. */
  travel?: boolean;
  /** Whether an eaten pellet is replaced. On by default. */
  pelletRespawn?: boolean;
  /** The screen the world is left on. `playing` by default. */
  screen?: Screen;
  /** The highlighted item, on a screen that carries a menu. */
  menuIndex?: number;
}

/**
 * Reset the game and pose exactly the world `scene` describes, through the
 * surface's atomic operations alone.
 *
 * The reset first, so nothing a previous section left is inherited: the snapshot
 * a scene starts from is a fresh session, on the title, with the starting chain,
 * no pellet, and every switch on. Then, in this order and for the reasons above:
 * the obstacles, the chain, the direction, an emptied turn buffer, the pellet,
 * the figures, the switches, and finally the screen.
 *
 * The turn buffer is emptied whether or not the scene names a direction, because
 * a posed world holds no steering request the scenario did not make.
 *
 * THE OBSTACLE COURSE IS CLEARED UNLESS THE SCENE ASKS FOR IT. A posed world
 * holds what the requirement is about and nothing else, and the course is
 * furniture almost no point is about: a chain a check lays down a column, or a
 * pellet it drops on a cell it chose, must read the same way under a mode that
 * lays a course and one that does not, or the same check decides two different
 * things in two variants. A point that IS about the course says `obstacles:
 * "course"` for the one the mode lays, or names its own cells. Under a mode that
 * lays none this changes nothing.
 *
 * Defaults to the `playing` screen, since that is the only screen a tick resolves
 * on and a scene exists to be ticked; a scenario about a menu names its own.
 */
export async function poseScene(
  h: Harness,
  scene: Scene = {},
): Promise<CoilSnapshot> {
  await h.debug.reset(
    scene.seed === undefined ? undefined : { seed: scene.seed },
  );

  const obstacles = scene.obstacles ?? "cleared";
  if (obstacles !== "course") {
    const surface = await obstacleSurface(h);
    if (surface === null) {
      // A mode that lays no obstacle cell has none to clear and no operation to
      // lay one with, and a scene asking for an empty course already has it.
      if (obstacles !== "cleared" && obstacles.length > 0) {
        return fail(
          "a build whose mode lays obstacle cells, since the scene places some",
          `the build reports the ${(await h.snapshot()).mode} mode, which lays none`,
        );
      }
    } else {
      await surface.clearObstacles();
      if (obstacles !== "cleared") {
        for (const cell of obstacles) {
          await surface.addObstacle(cell.col, cell.row);
        }
      }
    }
  }

  if (scene.snake !== undefined) await h.debug.setSnake(scene.snake);
  if (scene.dir !== undefined) await h.debug.setDirection(scene.dir);
  await h.debug.clearTurns();

  if (scene.pellet !== undefined) {
    if (scene.pellet === null) await h.debug.clearPellet();
    else await h.debug.setPellet(scene.pellet.col, scene.pellet.row);
  }

  if (scene.score !== undefined) await h.debug.setScore(scene.score);
  if (scene.best !== undefined) await h.debug.setBest(scene.best);
  if (scene.combo !== undefined) await h.debug.setCombo(scene.combo);
  if (scene.comboWindow !== undefined) {
    await h.debug.setComboWindow(scene.comboWindow);
  }

  if (scene.steering !== undefined) {
    await h.debug.setSnakeSteering(scene.steering);
  }
  if (scene.travel !== undefined) await h.debug.setSnakeTravel(scene.travel);
  if (scene.pelletRespawn !== undefined) {
    await h.debug.setPelletRespawn(scene.pelletRespawn);
  }

  await h.debug.setScreen(scene.screen ?? "playing");
  if (scene.menuIndex !== undefined) {
    await h.debug.setMenuIndex(scene.menuIndex);
  }
  return h.snapshot();
}

/**
 * The head cell every posed scenario starts from, unless it names another.
 *
 * Row 8 is the row `specs/board.md` lays the starting chain along, and
 * `specs/mode.md` states that the obstacle course carries none of that row — so a
 * chain laid along it is clear of the board's furniture even in a scene that
 * keeps the course. Column 10 leaves a long runway to the right and room behind
 * for a chain to trail into.
 */
export const HOME_HEAD: Cell = { col: 10, row: 8 };

/** What a posed step left, and the cell the next tick will enter. */
export interface StepScene {
  snapshot: CoilSnapshot;
  head: Cell;
  dir: Dir;
  /** The cell the head advances into on the next tick. */
  next: Cell;
}

/** A posed chain: where its head is, which way it faces, and how long it is. */
export interface StepOptions extends Omit<Scene, "snake" | "dir"> {
  head?: Cell;
  dir?: Dir;
  length?: number;
}

/**
 * Pose an isolated chain and say which cell its next tick enters.
 *
 * The single most-used arrangement in this project: nearly every point about
 * movement, turning, growth and collision is "a snake here, facing this way, one
 * tick". What the board holds is the chain and nothing else — the pellet is taken
 * off it and, as {@link poseScene} explains, so is the obstacle course — unless
 * `options` puts something back.
 */
export async function arrangeStep(
  h: Harness,
  options: StepOptions = {},
): Promise<StepScene> {
  const head = options.head ?? HOME_HEAD;
  const dir = options.dir ?? "right";
  const length = options.length ?? 3;
  const snapshot = await poseScene(h, {
    pellet: null,
    ...options,
    snake: chainFrom(head, dir, length),
    dir,
  });
  return { snapshot, head, dir, next: ahead(head, dir) };
}

/** What a posed eat left: the chain, and the pellet the next tick eats. */
export interface EatScene extends StepScene {
  /** The cell the pellet was placed on, which is the head's next cell. */
  pellet: Cell;
}

/**
 * Pose a chain with the pellet one cell ahead of its head, so the next tick eats.
 *
 * Respawn is off by default, because a check watching one eat should not then be
 * met by a pellet landing on a cell it did not choose — `specs/instrumentation.md`
 * gives the switch for exactly this. A check that is ABOUT the respawn passes
 * `pelletRespawn: true`.
 */
export async function arrangeEat(
  h: Harness,
  options: StepOptions = {},
): Promise<EatScene> {
  const head = options.head ?? HOME_HEAD;
  const dir = options.dir ?? "right";
  const pellet = ahead(head, dir);
  const step = await arrangeStep(h, {
    pelletRespawn: false,
    ...options,
    head,
    dir,
    pellet,
  });
  return { ...step, pellet };
}

/**
 * Pose a chain whose head is one cell from `target`, facing it, so the next tick
 * enters it.
 *
 * `target` is the fatal cell a collision point is about — a wall cell, an
 * obstacle cell, or a segment of the snake's own body — and `dir` is the
 * direction it is approached from, defaulting to `right`. The head is placed one
 * cell short of `target` along that direction and the chain trails back behind
 * it. The pellet is off the board, so the tick that resolves is the collision
 * alone.
 */
export async function arrangeApproach(
  h: Harness,
  target: Cell,
  options: StepOptions = {},
): Promise<StepScene> {
  const dir = options.dir ?? "right";
  return arrangeStep(h, {
    ...options,
    head: ahead(target, OPPOSITE[dir]),
    dir,
  });
}

/* -------------------------------------------------------------------------- */
/* Reaching a screen the way a player does                                    */
/* -------------------------------------------------------------------------- */
//
// A point about the menus has to press keys, because the menus are what it is
// about. A point about anything else reaches its screen through `setScreen` and
// never touches a menu — a build with a broken title and a working tick must fail
// the navigation points and pass the movement ones.

/** Reset to a clean title, off the wall clock, with nothing posed on the board. */
export async function openTitle(h: Harness): Promise<CoilSnapshot> {
  await h.debug.reset();
  return h.snapshot();
}

/**
 * Move the highlight to `index` by pressing `down`, and accept it.
 *
 * `specs/controls.md` moves the highlight one item per press and wraps at the
 * ends, and every screen a menu sits on arrives with `menuIndex` at `0`
 * (`specs/ui.md`), so `index` presses of `down` land on item `index`.
 */
export async function chooseItem(h: Harness, index: number): Promise<void> {
  for (let i = 0; i < index; i += 1) await h.tap("ArrowDown");
  await h.tap("Enter");
}

/**
 * Start a round from the title the way a player does: `confirm` on the first
 * item, which `specs/ui.md` makes the mode's own entry.
 */
export async function startRoundWithKeys(h: Harness): Promise<CoilSnapshot> {
  await openTitle(h);
  await chooseItem(h, 0);
  return h.snapshot();
}

/* -------------------------------------------------------------------------- */
/* Filling the board                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Every interior cell in one contiguous path, row by row and alternating
 * direction.
 *
 * A boustrophedon: left to right along row 1, right to left along row 2, and so
 * on. Consecutive cells are orthogonally adjacent within a row by construction,
 * and between rows because a row ends directly above where the next begins — so
 * the whole path is a chain `setSnake` accepts.
 */
export function serpentine(): Cell[] {
  const path: Cell[] = [];
  for (let row = INTERIOR_ROW_MIN; row <= INTERIOR_ROW_MAX; row += 1) {
    const rightwards = (row - INTERIOR_ROW_MIN) % 2 === 0;
    for (let i = INTERIOR_COL_MIN; i <= INTERIOR_COL_MAX; i += 1) {
      const col = rightwards ? i : INTERIOR_COL_MAX - (i - INTERIOR_COL_MIN);
      path.push({ col, row });
    }
  }
  return path;
}

/** What a board posed one eat short of full left behind. */
export interface FullBoardScene {
  snapshot: CoilSnapshot;
  /** The chain, one cell short of the whole interior. */
  chain: Cell[];
  /** The one free interior cell, holding the pellet. */
  pellet: Cell;
}

/**
 * Pose the board one eat short of full: the snake filling every interior cell
 * but one, and the pellet on that one, directly ahead of the head.
 *
 * The next tick eats it, grows the chain onto the last free cell, and finds no
 * valid cell for the pellet that should follow — which is the board-cleared
 * ending `specs/movement.md` states and `specs/board.md` defines the valid set
 * for.
 *
 * The obstacle course is cleared first, because a course laid across the interior
 * leaves no contiguous path through every remaining cell, and the chain has to be
 * one the game could have grown into. Clearing it also makes the obstacle cells
 * ordinary interior cells (`specs/instrumentation.md`), so the valid set the
 * ending turns on is the whole interior under either mode.
 */
export async function arrangeFullBoard(h: Harness): Promise<FullBoardScene> {
  await h.debug.reset();
  await clearObstacles(h);
  const path = serpentine();
  const pellet = path[0];
  const chain = path.slice(1);
  const head = chain[0];
  const facing = DIRECTIONS.find((dir) => sameCell(ahead(head, dir), pellet));
  await h.debug.setSnake(chain);
  if (facing !== undefined) await h.debug.setDirection(facing);
  await h.debug.clearTurns();
  await h.debug.setPellet(pellet.col, pellet.row);
  await h.debug.setScreen("playing");
  return { snapshot: await h.snapshot(), chain, pellet };
}
