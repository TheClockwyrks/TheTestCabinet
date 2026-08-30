// Refract — the shared validator harness. CASE-PROVIDED.
//
// Every check in this suite is an ordinary vitest test that drives the built site
// IN A REAL BROWSER. There is nothing to import: an engineless run seeds no
// `src/` at all, so the build wrote its own frame loop, its own canvas fit, its
// own keyboard and pointer, its own audio, and its own `window.__refract` — and
// the only place all of that exists is a page that has loaded the bundle. So the
// project serves `dist/`, loads it in Chromium, and reaches the game the way
// anything reaches it: over the surface the specification told the build to
// install.
//
// IT IS STILL A VITEST PROJECT, AND THAT IS DELIBERATE. The runner locates the
// build output before it chooses between the vitest and browser paths, so `dist/`
// is on disk by the time this project runs. Staying a vitest project is what lets
// the case name ONE script per review item and have it resolve under any engine —
// `validation/ruleset/r1-adjacency.test.ts` is the same path whichever runtime
// the run selected — and what keeps `format = 2` resolution passing.
//
// WHAT A CHECK READS. The game's own state (through `window.__refract`'s
// `snapshot`), the frames the harness itself drove, the operations the build
// issued against its 2D context, the pixels those operations left on the canvas,
// and the sounds the build emitted. Nothing here fabricates an outcome: the
// scenario helpers below only ARRANGE the world through the surface, and the real
// rules the build wrote decide everything from there.
//
// THE CLOCK IS THE SURFACE'S. Nothing outside an engineless build owns its loop,
// so `specs/instrumentation.md` puts the clock on the surface: `setAutoStep(false)`
// takes the game off real time and `advance(seconds, frames)` runs whole frames
// of a chosen length. Every harness opens by taking the game off the clock, so a
// check asks for a number of frames and gets exactly that number. The POINTER
// needs no frames at all: `specs/instrumentation.md` makes `pointerDown`,
// `pointerMove`, `pointerUp`, and `trace` take effect the moment they are called,
// so a whole route — a whole campaign course — is drawn without advancing the
// game, and a frame is driven only where something is genuinely per-frame: a
// render to sample, a cue to hear, a key to deliver.
//
// EVERYTHING CROSSING INTO THE PAGE IS ASYNC. That is the whole of the difference
// between a suite here and its counterpart under an engine: `await h.snapshot()`
// rather than reading the state in process. The scenarios, the tolerances, and
// the assertions are the same ones, because they are the case's rather than the
// runtime's.
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
import { ACTION_KEYS, OVERLAY_KEY, type ActionName } from "./constants";
import {
  CHANNELS,
  STAGE_H,
  STAGE_W,
  cellCenter,
  parseBoard,
  boardToNotation,
  type Board,
  type Channel,
} from "./notation";
import type { Beams, Cell } from "./rules";
import { solve, type SolveResult } from "./solver";
import { CAMPAIGN_BOARDS } from "./routes";

declare module "vitest" {
  export interface ProvidedContext {
    /** Where the built site is served, from `globalSetup.ts`. */
    refractUrl: string;
    /** The one Chromium every suite worker connects to. */
    refractBrowserWs: string;
  }
}

/* -------------------------------------------------------------------------- */
/* The contract the build owes                                                */
/* -------------------------------------------------------------------------- */

/** The handle an engineless build installs its surface on. */
export const HANDLE = "__refract";

/**
 * Every operation `specs/instrumentation.md` requires on the surface under this
 * engine, including the two clock operations that exist only here.
 */
export const REQUIRED_OPS = [
  "setAutoStep",
  "advance",
  "reset",
  "snapshot",
  "startMode",
  "loadBoard",
  "pointerDown",
  "pointerMove",
  "pointerUp",
  "trace",
  "clear",
] as const;

/** The version the surface reports (`REFRACT_DEBUG_VERSION`). */
export const REFRACT_DEBUG_VERSION = 1;

/** The screens the game can be on. */
export type Screen =
  | "title"
  | "howto"
  | "select"
  | "playing"
  | "solved"
  | "complete";

/** The two ways to play. */
export type Mode = "campaign" | "cascade";

/** One node, as a snapshot reports it. */
export interface SnapshotNode {
  col: number;
  row: number;
  x: number;
  y: number;
  kind: "emitter" | "lens" | "crystal";
  channel: Channel | null;
  charges: number | null;
  spent: number | null;
}

/** The board a snapshot reports. */
export interface SnapshotBoard {
  cols: number;
  rows: number;
  nodes: SnapshotNode[];
}

/** One channel's beam, as a snapshot reports it. */
export interface BeamView {
  cells: { col: number; row: number }[];
  complete: boolean;
}

/** The state a snapshot reports, as `specs/instrumentation.md` documents it. */
export interface RefractSnapshot {
  version: number;
  screen: Screen;
  mode: Mode;
  menuIndex: number;
  boardIndex: number;
  solvedBoards: number[];
  unlockedCount: number;
  selectIndex: number;
  solvedCount: number;
  tier: number;
  board: SnapshotBoard;
  /** One entry per channel present on the board, none for an absent channel. */
  beams: Partial<Record<Channel, BeamView>>;
  solved: boolean;
  tracing: { channel: Channel; live: { col: number; row: number } } | null;
  pointer: { x: number; y: number; down: boolean };
  muted: boolean;
  simTime: number;
}

/** The operations a check poses the game through. Every one crosses into the page. */
export interface RefractDebugApi {
  setAutoStep(enabled: boolean): Promise<void>;
  advance(seconds: number, frames?: number): Promise<void>;
  reset(options?: { seed?: number }): Promise<void>;
  snapshot(): Promise<RefractSnapshot>;
  startMode(mode: Mode): Promise<void>;
  loadBoard(board: readonly string[]): Promise<void>;
  pointerDown(x: number, y: number): Promise<void>;
  pointerMove(x: number, y: number): Promise<void>;
  pointerUp(): Promise<void>;
  trace(cells: readonly { col: number; row: number }[]): Promise<void>;
  clear(): Promise<void>;
}

/* -------------------------------------------------------------------------- */
/* The step schedule                                                          */
/* -------------------------------------------------------------------------- */
//
// The suite chooses the size of a frame, because the specification deliberately
// fixes none: every rate in this game is per second and is integrated against
// the elapsed time of the frame, so a build must reach the same place however
// that time was divided. Little rides on it in a pointer-driven puzzle — the
// pointer operations do not even need a frame — so the suite steps a plain
// 60 Hz, the rate a healthy display would have handed the build anyway. The one
// check that is ABOUT the step size (`instrumentation/deterministic-core`)
// calls `advance` with its own divisions directly.

/** A source of frame deltas, in milliseconds. */
export interface Clock {
  /** The next frame's delta, in ms. */
  delta(): number;
}

/** The frame the suite steps in, in milliseconds. */
export const TICK_HZ = 60;
export const TICK_MS = 1000 / TICK_HZ;

/** Every frame the same length. */
export class ConstantClock implements Clock {
  constructor(private readonly ms: number) {}
  delta(): number {
    return this.ms;
  }
}

/** Seconds of simulated time in `ticks` frames of the default clock. */
export function seconds(ticks: number): number {
  return ticks / TICK_HZ;
}

/* -------------------------------------------------------------------------- */
/* The harness                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Where a `fillText`/`strokeText` call put its text, as this harness measures
 * it after the fact.
 *
 * The injected recorder writes the console player's replay format and carries
 * no measurement, so the width is taken afterwards, in the page, under the font
 * the walk found in force at the call. See {@link measureTextCalls}.
 */
export interface TextGeometry {
  width: number;
  textAlign: string;
}

/** One recorded operation on the 2D context, in the order the render made it. */
export type DrawCall =
  | { kind: "call"; method: string; args: unknown[]; text?: TextGeometry }
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
  /** The clock each frame takes its delta from. Defaults to 60 Hz. */
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
  snapshot: RefractSnapshot;
}

export interface Harness {
  /** The page the build is running in. For a check that needs Playwright itself. */
  readonly page: Page;
  /**
   * The surface the BUILD installed, as operations that cross into the page.
   *
   * Read off `window.__refract` and never constructed here — see
   * {@link unexposedSurface}.
   */
  readonly debug: RefractDebugApi;
  /**
   * Why the build's surface cannot be driven, or `null` when it can.
   *
   * A fault here is the build's: the surface is missing, or it is missing an
   * operation the specification requires. It says what was found
   * (`window.__refract was still absent 5s after the page loaded`), and
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
  snapshot(): Promise<RefractSnapshot>;
  /** Run `frames` frames back to back, each the length the clock says. */
  advance(frames: number): Promise<void>;
  /** Advance until `predicate` holds, sampling every `poll` frames. */
  until(
    predicate: (snapshot: RefractSnapshot) => boolean,
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
   * A press that ran no frame would never reach a build that reads its actions
   * once per frame as a press edge (`specs/controls.md`), and a press released
   * before a frame ran would be invisible to a build that compares held state
   * between frames — so the frame goes between the two.
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
  /** Where a logical point lands in CSS pixels, for a real mouse. */
  css(x: number, y: number): { x: number; y: number };

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
  browserPromise ??= connectChromium(inject("refractBrowserWs"));
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
 * one thing `presentation/stage-fit` varies. Everything else about a harness is
 * the page: a fresh one opens on a build that has just started, with no key
 * held, no audio context opened, and the mute preference back off, which is a
 * stronger guarantee than any reset the surface offers, since `reset()`
 * deliberately leaves muting alone.
 *
 * A page per harness rather than a page reused between them, because a check may
 * legitimately hold two harnesses at once, and a harness whose page had been
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
 * A proxy rather than a hand-written stub, so a check that reaches for anything
 * at all on a missing surface lands on the same named fault, rather than on a
 * `TypeError` several calls later.
 *
 * Keys that belong to the MACHINERY rather than to a check are answered with
 * `undefined` instead: awaiting a value probes `then`, and vitest's own error
 * formatting probes symbols and `constructor`. Failing those would replace the
 * verdict below with noise from the machinery that was trying to report it.
 */
function unexposedSurface(reason: string): RefractDebugApi {
  return new Proxy({} as RefractDebugApi, {
    get: (_target, property): unknown => {
      if (typeof property === "symbol") return undefined;
      if (property === "then" || property === "constructor") return undefined;
      return () => failSurface(reason);
    },
  });
}

/**
 * What specs/instrumentation.md requires of the surface: the `Expected:` line of
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

/**
 * A snapshot with every beam cell narrowed to the two fields the specs fix.
 *
 * specs/state.md declares `interface Cell { col, row }` and
 * specs/instrumentation.md's Snapshot shape writes `cells: [{ col, row }]`, so
 * `col` and `row` are what a cell means. Neither says a cell may carry nothing
 * else, and specs/state.md's contract grants the build fields that "hold
 * derived data you can rebuild from the declared ones" — a cell that also names
 * its node's kind or channel is exactly that. So every check compares on the
 * two fields the specs fix, and no check grades the rest either way. A cell
 * missing `col` or `row` still fails: the projection reads those two properties
 * and yields `undefined`.
 *
 * The snapshot the page returned is never touched. Every container the
 * projection rewrites is a fresh object, so a check holding an earlier snapshot
 * sees what it saw.
 *
 * The engineless project reads the build through `window.__refract` in a
 * browser rather than in process, so the narrowing happens on THIS side of the
 * crossing, on the structure Playwright handed back — but it is the same
 * narrowing the `simple-2d` and `structured-2d` harnesses apply at their own
 * single read point, and a build that passes there passes here.
 */
function projectCells(snapshot: RefractSnapshot): RefractSnapshot {
  const projected: RefractSnapshot = { ...snapshot };

  const beams: unknown = snapshot.beams;
  if (typeof beams === "object" && beams !== null) {
    const narrowed: Record<string, unknown> = { ...beams };
    for (const [channel, beam] of Object.entries(narrowed)) {
      if (typeof beam !== "object" || beam === null) continue;
      const cells: unknown = (beam as { cells?: unknown }).cells;
      if (!Array.isArray(cells)) continue;
      narrowed[channel] = {
        ...beam,
        cells: (cells as { col: number; row: number }[]).map((cell) => ({
          col: cell.col,
          row: cell.row,
        })),
      };
    }
    projected.beams = narrowed as RefractSnapshot["beams"];
  }

  const tracing = snapshot.tracing;
  if (typeof tracing === "object" && tracing !== null) {
    const live: unknown = tracing.live;
    if (typeof live === "object" && live !== null) {
      const cell = live as { col: number; row: number };
      projected.tracing = {
        ...tracing,
        live: { col: cell.col, row: cell.row },
      };
    }
  }

  return projected;
}

/* ---- Building one --------------------------------------------------------- */

/**
 * Load the built site in a browser, take the game off the wall clock, and hand
 * back everything a check reads.
 *
 * The default shape is the stage's own size at one device pixel per CSS pixel,
 * so a logical coordinate and a canvas pixel are the same thing and no check but
 * `presentation/stage-fit` has to think about the fit at all.
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

  await page.goto(inject("refractUrl"), { waitUntil: "load" });

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
      : (new Proxy({} as RefractDebugApi, {
          get: (_target, property): unknown => {
            if (typeof property === "symbol") return undefined;
            if (property === "then" || property === "constructor")
              return undefined;
            const name = String(property);
            // One of the two points a snapshot crosses back out of the page, so
            // one of the two places a beam's cells are narrowed. `h.snapshot()`
            // reads through here; `drive` — which reads one back beside the
            // frames it ran — is the other.
            if (name === "snapshot") {
              return async (...args: unknown[]): Promise<RefractSnapshot> =>
                projectCells((await call(name, args)) as RefractSnapshot);
            }
            return (...args: unknown[]) => call(name, args);
          },
        }) as RefractDebugApi);

  if (surfaceFault === null) {
    // Off the wall clock and back to the title before a check touches anything:
    // from here the game changes only when this harness says so. The reset seeds
    // rngState with DEFAULT_SEED, so two harnesses open on the same game.
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
            window as unknown as { __refractRec: { ready(): boolean } }
          ).__refractRec.ready(),
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
  const drive = async (frames: number): Promise<RefractSnapshot> => {
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
            __refractRec: Record<string, (...a: unknown[]) => unknown>;
          }
        ).__refractRec;
        const audio = (
          window as unknown as { __refractAudio: { started(): number } }
        ).__refractAudio;
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
    )) as { snapshot: RefractSnapshot; sounds: number[] };

    for (const [index, delta] of deltas.entries()) {
      frameCount += 1;
      timeMs += delta;
      for (let n = 0; n < result.sounds[index]; n += 1) {
        for (const sink of cueSinks)
          sink.push({ frame: frameCount, t: timeMs });
      }
    }
    // The second of the two points a snapshot crosses back out of the page.
    return projectCells(result.snapshot);
  };

  const readPixels = async (
    devicePoints: readonly { x: number; y: number }[],
  ): Promise<[number, number, number, number][]> =>
    page.evaluate(
      (points) => {
        const canvases = Array.from(document.querySelectorAll("canvas"));
        if (canvases.length === 0)
          throw new Error("refract: the page has no <canvas>");
        let canvas = canvases[0];
        for (const other of canvases) {
          if (other.width * other.height > canvas.width * canvas.height)
            canvas = other;
        }
        const ctx = canvas.getContext("2d");
        if (ctx === null)
          throw new Error("refract: the canvas has no 2D context");
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
      if (surfaceFault !== null) refuse();
      // The one thing here that depends on real elapsed time, so the one thing a
      // browser's own idea of which page matters can distort. The launch already
      // turns the throttling off; bringing the page forward as well means this
      // does not rest on a flag alone.
      await page.bringToFront().catch(() => undefined);
      await page.evaluate(
        ([handle]) => {
          (
            window as unknown as { __refractRec: { setMode(m: string): void } }
          ).__refractRec.setMode("raf");
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
            window as unknown as { __refractRec: { setMode(m: string): void } }
          ).__refractRec.setMode("manual");
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
          window as unknown as { __refractRec: { last(): unknown[] } }
        ).__refractRec.last(),
      )) as RecordedOp[];
      const calls = ops.map(toDrawCall);
      await measureTextCalls(page, calls);
      return calls;
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
            "refract: the page has no <canvas>, so the build drew nowhere — " +
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
      // audio context from a real DOM event alone (both are conformant), so a
      // pointer press delivered any other way would leave a perfectly good build
      // silent. Refract fixes no key binding this suite could trust to be
      // inert — the menu bindings are the build's own — so the gesture is a real
      // mouse press in the stage's top-left corner: farther than NODE_HIT_R from
      // every cell center of every board, so it matches no row of the grab table
      // and begins no trace, and the pointer does not operate menus
      // (specs/controls.md, specs/ui.md). Arming changes no game state beyond
      // the mirrored pointer fields.
      await page.mouse.move(2, 2);
      await page.mouse.down();
      await page.mouse.up();
    },

    sounds: () =>
      page.evaluate(() =>
        (
          window as unknown as { __refractAudio: { started(): number } }
        ).__refractAudio.started(),
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
 * it: one uniform scale, the whole stage inside, centred, with the leftover split
 * evenly into two bars.
 *
 * Computed rather than read from the build, deliberately: the fit is the build's
 * own work here, so asking it would be asking a build to grade itself. Every
 * check but `presentation/stage-fit` runs at the stage's own size, where this is
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

/** One text call, and the text state the walk found in force at it. */
interface PendingMeasure {
  call: Extract<DrawCall, { kind: "call" }>;
  text: string;
  font: string;
  textAlign: string;
}

/** The 2D context's own defaults, in force until the build sets its own. */
const DEFAULT_FONT = "10px sans-serif";
const DEFAULT_TEXT_ALIGN = "start";

/**
 * Attach a measured width and the alignment in force to every text call of a
 * recorded frame.
 *
 * The recorder records `font` and `textAlign` as ordinary property sets, and
 * `save`/`restore` stack them exactly as they stack the transform, so the state
 * at each call is recovered by walking the frame. The widths themselves are
 * measured IN THE PAGE, against an offscreen 2D context, so a run is measured
 * under the build's own loaded fonts — in ONE crossing, over the distinct
 * (text, font) pairs the frame used, however many calls spelled them.
 *
 * The walk starts from the context's own defaults, because a frame's operation
 * list holds what that frame issued and not what it inherited. A build that
 * sets its font every frame, which is the ordinary render, is measured exactly;
 * one that sets it once and relies on the inheritance is measured against the
 * default font, which under-reports the width and so only ever leaves runs
 * apart that would otherwise have joined.
 */
async function measureTextCalls(page: Page, calls: DrawCall[]): Promise<void> {
  const pending: PendingMeasure[] = [];
  const stack: { font: string; textAlign: string }[] = [];
  let current = { font: DEFAULT_FONT, textAlign: DEFAULT_TEXT_ALIGN };

  for (const call of calls) {
    if (call.kind === "set") {
      if (call.property === "font" && typeof call.value === "string") {
        current = { ...current, font: call.value };
      } else if (
        call.property === "textAlign" &&
        typeof call.value === "string"
      ) {
        current = { ...current, textAlign: call.value };
      }
      continue;
    }
    if (call.method === "save") {
      stack.push(current);
      continue;
    }
    if (call.method === "restore") {
      const popped = stack.pop();
      if (popped !== undefined) current = popped;
      continue;
    }
    if (call.method !== "fillText" && call.method !== "strokeText") continue;
    const text = call.args[0];
    if (typeof text !== "string" || text.length === 0) continue;
    pending.push({
      call,
      text,
      font: current.font,
      textAlign: current.textAlign,
    });
  }
  if (pending.length === 0) return;

  const key = (font: string, text: string): string => `${font}\u0000${text}`;
  const distinct = new Map<string, { font: string; text: string }>();
  for (const item of pending) {
    distinct.set(key(item.font, item.text), {
      font: item.font,
      text: item.text,
    });
  }
  const wanted = [...distinct.values()];

  const widths = (await page.evaluate((items) => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (ctx === null) throw new Error("refract: no 2D context to measure in");
    return items.map((item) => {
      ctx.font = item.font;
      return ctx.measureText(item.text).width;
    });
  }, wanted)) as number[];

  const measured = new Map<string, number>();
  for (const [index, item] of wanted.entries()) {
    measured.set(key(item.font, item.text), widths[index]);
  }
  for (const item of pending) {
    item.call.text = {
      width: measured.get(key(item.font, item.text)) ?? 0,
      textAlign: item.textAlign,
    };
  }
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
// scrub. `captureReplay` is how a check produces one.
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
 * `validation/tracing/extend.test.ts` — because that is the path the review
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
 * the section ran. This is the same cap the engine-backed harness writes under,
 * so a replay recorded under either engine is the same size of thing.
 */
const MAX_REPLAY_FRAMES = 300;

/**
 * The ground the console's player paints behind a recorded frame.
 *
 * The specification fixes no bench colour: the build paints its own background
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
    console.warn(`refract: could not write ${destination}: ${String(error)}`);
  }
}

/**
 * Record the frames `scenario` drives and keep them as the review item's
 * `outputId` output, handing back whatever the scenario returned.
 *
 * Wrap the drive, not the arrangement:
 *
 * ```ts
 * const swept = await captureReplay(h, "retract", () => unwind(h));
 * assertEqual(swept.cells.length, 1);
 * ```
 *
 * The assertions stay exactly where they were and read exactly what they did.
 * Remember that a pointer operation drives NO frame: a section that should show
 * motion advances a frame between the moves it wants seen.
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
        window as unknown as { __refractRec: { arm(d: unknown): boolean } }
      ).__refractRec.arm(design),
    { width: STAGE_W, height: STAGE_H, background: REPLAY_BACKGROUND },
  );
  try {
    return await scenario();
  } finally {
    // In a `finally`, so a scenario that failed still leaves its evidence behind.
    const recording = (await h.page.evaluate(() =>
      (
        window as unknown as { __refractRec: { disarm(): unknown } }
      ).__refractRec.disarm(),
    )) as Recording | null;
    writeReplay(destination, recording);
  }
}

/**
 * Keep the picture currently on the canvas as the review item's `outputId`
 * output.
 *
 * The companion to {@link captureReplay}, for a point whose evidence is one
 * PICTURE rather than a stretch of motion: the posed board, the select grid, the
 * screen a menu landed on. What is written is whatever the last frame that RAN
 * left behind, so drive a frame after the pose and call this before the
 * assertions, so a check that fails still leaves the picture that shows why.
 * Nothing here can change a verdict: outside a run this is a no-op, and a still
 * that cannot be written is reported as an output that never turned up.
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
    console.warn(`refract: could not write ${destination}: ${String(error)}`);
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
 * cue per event, played from `update` on the frame its event happens, and says
 * nothing at all about how a build makes a sound — under this engine the whole
 * audio layer is the build's. So `audio-init.js` watches the two doors a browser
 * can emit sound through (a Web Audio source being `start()`ed, whatever kind it
 * is, and an `<audio>` element being played) and counts what goes through them;
 * the harness brackets each driven frame around that count, so a sound is
 * attributed to the frame that produced it. A blip made of two oscillators
 * counts as two, which is why a check asserts that a frame sounded rather than
 * how many times: the number of sources is the build's business and the
 * specification never fixed it.
 *
 * TIMING UNDER THIS GAME'S POINTER. A pointer operation resolves its move the
 * moment it is called, between frames, and the cue for the segment it added is
 * played "on the frame its event happens, from update" — the next frame driven.
 * So a cue check makes its move with the pointer, then drives ONE frame, and
 * reads the sound on that frame. A build that emits during the pointer call
 * itself shows up through {@link Harness.sounds}, which counts everything
 * whether or not a frame was open.
 *
 * WHAT IS LOST HERE THAT AN ENGINE GIVES. The cue's NAME. Under an engine the
 * game asks the bus for `CUES.connect` by name and the bus announces it. There
 * is no bus here to ask, so these checks confirm that a sound was emitted and on
 * which frame, and a reviewer decides by ear whether the five are told apart.
 * That is a real reduction, and the alternative — inferring the cue from the
 * waveform the reference happens to use — would grade builds against an
 * implementation rather than against the specification.
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
 * Whether the frame spelled `text` inside some logical run of text, ignoring
 * case.
 *
 * Substring rather than equality on purpose: the copy a check asserts is the
 * case's own, but how a build presents it is the build's, and a menu entry is
 * commonly drawn with a selection marker or padding around it. Requiring the
 * exact run would fail a screen that shows precisely the right words.
 *
 * Read off {@link drawnTextLines} rather than off the raw calls, so a heading
 * letter-spaced a glyph per `fillText` is found by the words it spells. Every
 * raw string is a substring of the run it belongs to, so coalescing can only
 * add a match and never take one away.
 */
export function drewText(calls: readonly DrawCall[], text: string): boolean {
  const wanted = text.trim().toLowerCase();
  return drawnTextLines(calls).some((line) =>
    line.toLowerCase().includes(wanted),
  );
}

/** One run of text a frame drew, and where it drew it in canvas pixels. */
export interface TextDraw {
  text: string;
  /** The anchor the run was drawn at, mapped through the transform in force. */
  x: number;
  y: number;
  /** The horizontal extent of the glyphs, under the same transform. */
  left: number;
  right: number;
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
 * A build is free to draw under a transform — to translate to a HUD corner and
 * draw at the origin, say — so the position a `fillText` names is only where the
 * text landed once the transform in force at that call is applied. This walks
 * the frame's operations and carries that transform: `save`/`restore`,
 * `translate`, `scale`, `rotate`, `transform`, `setTransform` and
 * `resetTransform`. At the harness's default shape the canvas is the stage at
 * one pixel per unit, so the result is in logical units as well.
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
      const anchorX = current[0] * x + current[2] * y + current[4];
      const anchorY = current[1] * x + current[3] * y + current[5];
      // The run's width under the same horizontal scale the anchor took, and
      // the alignment that places it about that anchor. A call the measurement
      // pass never reached carries no width, and stands as a point.
      const width =
        (call.text?.width ?? 0) * Math.hypot(current[0], current[1]);
      const align = call.text?.textAlign ?? DEFAULT_TEXT_ALIGN;
      const before =
        align === "center"
          ? width / 2
          : align === "right" || align === "end"
            ? width
            : 0;
      draws.push({
        text,
        x: anchorX,
        y: anchorY,
        left: anchorX - before,
        right: anchorX - before + width,
      });
    }
  }
  return draws;
}

/* ---- Logical runs of text -------------------------------------------------- */
//
// A build that letter-spaces a heading draws a glyph per `fillText`, which is
// the only portable way to letter-space canvas text: the property canvas
// exposes for it is not portable, so the ordinary implementation walks the
// string. specs/ui.md fixes the COPY a screen shows; "Palettes, fonts, layouts,
// and styling are the build's choices" makes the spacing between its glyphs the
// build's. So a check that asserts copy reads it off the logical RUN the frame
// spells, never off the `fillText` split that spelled it.
//
// THE MERGE RULE, the same in all three engine projects. A draw joins the run
// before it when the two share a baseline and sit side by side:
// `|Δbaseline| <= 0.75` device px, the later draw's left edge at or after the
// run's right edge less `0.5` px, and the gap between them at most
// `0.6 * meanAdvance` of the run so far, where `meanAdvance` is its measured
// width over its character count. A run's measured width is the extent it
// occupies, right minus left, so its mean advance carries whatever letter
// spacing its own glyphs were set at: a heading tracked wider than 0.6 of a
// bare glyph still reads as one run, while a HUD figure a clear gap from its
// label stays its own. Texts are concatenated verbatim, so a run drawn a glyph
// at a time comes back as the string it spells, tracked spaces included. The comparison is RELATIVE, so it is decided where the calls were
// made, in the canvas's own pixels, and needs no conversion to decide it.
//
// WHAT STAYS RAW. {@link drawnText} is untouched, and {@link textDraws} still
// reports one entry per call: the overlay check diffs line SETS off the first,
// and the readout-geometry checks need each draw's own extent, because a merged
// run is wider than any of its members and holding one clear of a region asks a
// different question. Every reader opts in.
//
// NOT EXERCISED BY A MODEL BUILD. No engineless build exists in the cohort this
// was written against, so the walk above and the merge below are proven here
// against the `none` reference alone.

/** How far apart two draws' baselines may sit and still read as one run. */
const RUN_BASELINE_SLACK = 0.75;

/** How far a draw may sit back inside the run before it and still join it. */
const RUN_BACKTRACK_SLACK = 0.5;

/** The share of the run's mean advance a gap may reach and still join it. */
const RUN_GAP_RATIO = 0.6;

/** Whether `next` continues `open`, `chars` long, under the rule stated above. */
function joinsRun(open: TextDraw, chars: number, next: TextDraw): boolean {
  if (Math.abs(next.y - open.y) > RUN_BASELINE_SLACK) return false;
  if (!(next.left >= open.right - RUN_BACKTRACK_SLACK)) return false;
  const meanAdvance = (open.right - open.left) / chars;
  return next.left - open.right <= RUN_GAP_RATIO * meanAdvance;
}

/**
 * The frame's text draws coalesced into logical runs, placed as `textDraws`
 * places one draw.
 *
 * A PARTITION: every text draw belongs to exactly one run, so a heading drawn
 * `1 OF 24 SOLVED` a glyph at a time yields one run and no stray run equal to
 * `"2"`. The runs come back in reading order — down the frame, then across
 * it — because that is the order the merge walks them in.
 *
 * A run's anchor is derived back from its merged extent under the alignment of
 * its first draw, so a run of one draw comes back exactly as `textDraws`
 * reports it.
 */
export function drawnTextRuns(calls: readonly DrawCall[]): TextDraw[] {
  const draws = textDraws(calls)
    .filter((draw) => draw.text.length > 0)
    .sort((a, b) => a.y - b.y || a.left - b.left);

  const runs: TextDraw[] = [];
  /** How many characters each run spells, for its mean advance. */
  const chars: number[] = [];

  for (const draw of draws) {
    const open = runs[runs.length - 1];
    const last = chars.length - 1;
    if (open !== undefined && joinsRun(open, chars[last], draw)) {
      // The anchor holds: the run keeps the placement of its first draw, and
      // only its right edge and the copy it spells grow.
      open.text += draw.text;
      open.right = Math.max(open.right, draw.right);
      chars[last] += draw.text.length;
      continue;
    }
    runs.push({ ...draw });
    chars.push(draw.text.length);
  }
  return runs;
}

/** Every logical run of text the frame spelled, as the strings it spells. */
export function drawnTextLines(calls: readonly DrawCall[]): string[] {
  return drawnTextRuns(calls).map((run) => run.text);
}

/**
 * The geometry calls a frame made, by name.
 *
 * Enough of a count to compare two frames of the same scene: a frame that drew
 * an overlay, a highlight, or a beam asked for strictly more of these than the
 * same frame without it, whatever shape the build chose to draw it as.
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

/* -------------------------------------------------------------------------- */
/* Colour sampling                                                            */
/* -------------------------------------------------------------------------- */

/** A colour read off the canvas. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

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
 * The centre pixel plus four neighbours 4 px out, all comfortably inside
 * `NODE_R` when the point is a cell center, so one stray anti-aliased or glow
 * pixel cannot swing the reading.
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

/** Euclidean distance between two colours, 0 to about 441. */
export function colorDistance(a: Rgb, b: Rgb): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

/** A colour's luminance, the reading the bench is darkest on. */
function luminance(c: Rgb): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/**
 * Candidate patches of bare bench, in logical units, clear of the largest
 * board's extent (`specs/board.md` puts every cell center inside x `352..928`,
 * y `152..632`, and every node inside `NODE_R` of its center) and of the edges
 * where a build most plausibly seats its heading and its readouts.
 *
 * The bench is dark and everything placed on it is drawn to be read against it
 * (`specs/overview.md`), but the readouts' exact placement is the build's, so
 * no single patch is guaranteed bare. The darkest of several is: anything
 * drawn to be read is lighter than the bench it sits on, so a patch something
 * covers reads lighter than one nothing does.
 */
export const BENCH_POINTS: readonly { x: number; y: number }[] = [
  { x: 200, y: 392 },
  { x: 1080, y: 392 },
  { x: 200, y: 600 },
  { x: 1080, y: 200 },
];

/**
 * The bare bench's colour: the darkest of the {@link BENCH_POINTS} patches,
 * sampled off the canvas as it stands.
 */
export async function sampleBench(h: Harness): Promise<Rgb> {
  const samples: Rgb[] = [];
  for (const point of BENCH_POINTS) {
    samples.push(await sampleColor(h, point.x, point.y));
  }
  return samples.reduce((darkest, sample) =>
    luminance(sample) < luminance(darkest) ? sample : darkest,
  );
}

/* -------------------------------------------------------------------------- */
/* Scenario helpers                                                           */
/* -------------------------------------------------------------------------- */
//
// Each of these poses a situation through `window.__refract` and then lets the
// real rules the build wrote decide everything from there. None of them asserts
// a verdict of its own; a helper fails only when the game is not even in the
// situation the caller's scenario needs, and then with the requirement named.

/**
 * Fire one registered action, through a real key press and the frame that
 * delivers it.
 *
 * `specs/controls.md` fixes only the `clear` binding (`KeyR`); of the rest it
 * requires that "each action carries the keys a player reaches for by habit",
 * and the habitual keys of a keyboard-only menu are the arrow cluster, Enter,
 * and Escape — the keys `constants.ts` pins per action. The press goes through
 * Chromium's own input pipeline, never through the surface, which carries no
 * operation for the registered actions at all: the menus are driven exactly the
 * way a player drives them.
 */
export async function fireAction(
  h: Harness,
  action: ActionName,
): Promise<void> {
  await h.tap(ACTION_KEYS[action]);
}

/** Show or hide the debug overlay, through its fixed Backquote binding. */
export async function toggleOverlay(h: Harness): Promise<void> {
  await h.tap(OVERLAY_KEY);
}

/**
 * Enter a mode the way its title menu item does, through the surface's
 * `startMode` — the pose `specs/instrumentation.md` defines as "exactly as
 * choosing its menu item does". The one frame after it is what puts the new
 * screen on the canvas.
 *
 * Through the pose rather than through the title menu's keys, deliberately: the
 * menu bindings are the build's own under this engine, so entering a mode by
 * key would hang every campaign and cascade check on a binding the
 * specification never fixed. The menu keys get their own checks in
 * `screens/`, where the binding is the subject.
 */
export async function startCampaign(h: Harness): Promise<void> {
  await h.debug.startMode("campaign");
  await h.advance(1);
}

/** See {@link startCampaign}. */
export async function startCascade(h: Harness): Promise<void> {
  await h.debug.startMode("cascade");
  await h.advance(1);
}

/**
 * Pose a board through `loadBoard`, in the notation `specs/board.md` defines,
 * and hand back the parsed board the caller measures against.
 *
 * The one frame after the pose is what draws it, so a caller can sample pixels
 * right away. The pose itself moves the game to `playing` with every beam empty
 * and no trace live.
 */
export async function loadBoard(h: Harness, notation: string): Promise<Board> {
  const board = parseBoard(notation);
  await h.debug.loadBoard(boardToNotation(board).split("\n"));
  await h.advance(1);
  return board;
}

/** The stage position of a cell's center on `board`, off the spec's formula. */
export function center(
  board: Pick<Board, "cols" | "rows">,
  cell: Cell,
): { x: number; y: number } {
  return cellCenter(cell.col, cell.row, board.cols, board.rows);
}

/** The midpoint of the segment joining two cells, in stage units. */
export function segmentMidpoint(
  board: Pick<Board, "cols" | "rows">,
  a: Cell,
  b: Cell,
): { x: number; y: number } {
  const ca = center(board, a);
  const cb = center(board, b);
  return { x: (ca.x + cb.x) / 2, y: (ca.y + cb.y) / 2 };
}

/**
 * Draw a route through the surface's `trace`: a press at the first cell's
 * center, a move to each remaining center, then a release, all resolved the
 * moment the call is made. A list the limits refuse part way through leaves the
 * beam ending at the last segment they permitted, which is itself a specified
 * behaviour a check can read back.
 */
export async function traceCells(
  h: Harness,
  cells: readonly Cell[],
): Promise<void> {
  await h.debug.trace(cells.map(({ col, row }) => ({ col, row })));
}

/** {@link traceCells} over a route stored as `[col, row]` pairs. */
export async function traceRoute(
  h: Harness,
  route: readonly (readonly [number, number])[],
): Promise<void> {
  await traceCells(
    h,
    route.map(([col, row]) => ({ col, row })),
  );
}

/**
 * Draw a whole solution: one `trace` per channel present, in `CHANNELS` order.
 *
 * Each beam's route runs emitter to emitter, so each trace begins on the first
 * row of the grab table — an emitter of a channel whose beam carries no
 * segments — and the game's own rules accept or refuse every segment from
 * there. On the last permitted move of the last channel the board solves and
 * the trace ends on the spot, exactly as `specs/beams.md` states.
 */
export async function drawBeams(h: Harness, beams: Beams): Promise<void> {
  for (const channel of CHANNELS) {
    const route = beams[channel];
    if (route !== undefined && route.length > 0) await traceCells(h, route);
  }
}

/* ---- The real pointer ------------------------------------------------------ */
//
// The surface's pointer operations resolve a move the moment they are called,
// between frames — which is what makes course walks instant — but a CUE is
// played "on the frame its event happens, from update" (specs/ui.md), from the
// pointer samples the build's own input layer hands each update. So a check
// whose subject is what a frame did with a player's input — the audio points
// above all — drives Chromium's real mouse instead, one frame per sample, and
// reads the cue off the frame that consumed it. The mapping from stage units to
// CSS pixels is the harness's own fit, the identity at the default shape.

/** Press the real mouse at a logical stage point, and run the frame that reads it. */
export async function mousePress(
  h: Harness,
  x: number,
  y: number,
): Promise<void> {
  const at = h.css(x, y);
  await h.page.mouse.move(at.x, at.y);
  await h.page.mouse.down();
  await h.advance(1);
}

/** Move the held mouse to a logical stage point, and run the frame that reads it. */
export async function mouseGlide(
  h: Harness,
  x: number,
  y: number,
): Promise<void> {
  const at = h.css(x, y);
  await h.page.mouse.move(at.x, at.y);
  await h.advance(1);
}

/** Release the real mouse, and run the frame that reads it. */
export async function mouseRelease(h: Harness): Promise<void> {
  await h.page.mouse.up();
  await h.advance(1);
}

/**
 * Draw a route with the REAL mouse: a press at the first cell's center, a move
 * to each remaining center, then a release, one driven frame per sample.
 *
 * The slow sibling of {@link traceCells}, for the checks that read what a FRAME
 * did with the move — a cue sounding on it, a segment appearing in a replay —
 * rather than only where the beam ended up.
 */
export async function mouseTrace(
  h: Harness,
  board: Pick<Board, "cols" | "rows">,
  cells: readonly Cell[],
): Promise<void> {
  if (cells.length === 0) return;
  const first = center(board, cells[0]);
  await mousePress(h, first.x, first.y);
  for (const cell of cells.slice(1)) {
    const at = center(board, cell);
    await mouseGlide(h, at.x, at.y);
  }
  await mouseRelease(h);
}

/** Fail a scenario helper on the screen it needed and the screen it found. */
function requireScreen(
  snapshot: RefractSnapshot,
  wanted: Screen,
  doing: string,
): void {
  if (snapshot.screen !== wanted) {
    fail(
      `screen ${JSON.stringify(wanted)} (${doing})`,
      `screen ${JSON.stringify(snapshot.screen)}, mode ${JSON.stringify(snapshot.mode)}`,
    );
  }
}

/**
 * Solve the campaign board at `index` (0-based) as it stands on the `playing`
 * screen, by tracing the stored routes for that board.
 *
 * The routes come from `routes.ts`: precomputed from `specs/campaign-boards.md`
 * under the `specs/beams.md` rules by the case's own solver, and never from any
 * implementation. They solve the board AS SPECIFIED; a build playing a board of
 * its own invention refuses them somewhere, the board does not solve, and the
 * caller's assertions read exactly that back.
 */
export async function solveCampaignBoard(
  h: Harness,
  index: number,
): Promise<void> {
  const data = CAMPAIGN_BOARDS[index];
  if (data === undefined) {
    fail(`a campaign board index 0..${CAMPAIGN_BOARDS.length - 1}`, index);
  }
  const beams: Beams = {};
  for (const channel of CHANNELS) {
    const route = data.routes[channel];
    if (route !== undefined) {
      beams[channel] = route.map(([col, row]) => ({ col, row }));
    }
  }
  await drawBeams(h, beams);
}

/** What a course walk saw: each board on entry, and the screen it ended on. */
export interface CourseWalk {
  /** The snapshot on entering each board, `playing` with every beam empty. */
  entered: RefractSnapshot[];
  /** The state after the last solve: `solved`, or `complete` after board 24. */
  final: RefractSnapshot;
}

/**
 * Really play the first `boards` boards of the campaign: enter the course from
 * the title, then solve board after board, crossing each `solved` screen
 * through its first choice (next board, `menuIndex` 0 on arrival).
 *
 * Campaign progress deliberately has NO pose (`specs/instrumentation.md`
 * carries none), so this is the one honest way to a later course state — and
 * because every trace is immediate, the whole course costs milliseconds. Call
 * it on a fresh harness (or straight after `reset`): it starts from the title.
 *
 * `onBoard` runs on each board's entry snapshot before that board is solved,
 * for a check that reads or captures mid-course.
 */
export async function driveCourse(
  h: Harness,
  boards: number,
  onBoard?: (snapshot: RefractSnapshot, index: number) => void | Promise<void>,
): Promise<CourseWalk> {
  await startCampaign(h);
  let snapshot = await h.snapshot();
  requireScreen(
    snapshot,
    "select",
    "entering the campaign puts the course's grid up",
  );
  // A fresh course arrives with the highlight on board 1, so the first confirm
  // enters it (specs/modes/campaign.md).
  await fireAction(h, "confirm");

  const entered: RefractSnapshot[] = [];
  for (let index = 0; index < boards; index += 1) {
    snapshot = await h.snapshot();
    requireScreen(
      snapshot,
      "playing",
      `board ${index + 1} of the course walk should be in play`,
    );
    entered.push(snapshot);
    await onBoard?.(snapshot, index);
    await solveCampaignBoard(h, index);
    snapshot = await h.snapshot();
    if (index < boards - 1) {
      requireScreen(
        snapshot,
        "solved",
        `solving board ${index + 1} short of the last should land on solved`,
      );
      // First choice, highlighted on arrival: next board.
      await fireAction(h, "confirm");
    }
  }
  return { entered, final: snapshot };
}

/** The `board` a snapshot reports, restated as the scenario library's Board. */
export function boardFromSnapshot(snapshot: RefractSnapshot): Board {
  return {
    cols: snapshot.board.cols,
    rows: snapshot.board.rows,
    nodes: snapshot.board.nodes.map((node) => ({
      col: node.col,
      row: node.row,
      kind: node.kind,
      channel: node.channel,
      charges: node.charges,
    })),
  };
}

/** What a cascade sweep saw, board by board. */
export interface CascadeSweep {
  /** Each generated board, as the snapshot reported it on arrival. */
  boards: Board[];
  /** The solver's verdict on each board, in order. */
  verdicts: SolveResult[];
  /** The snapshot after each board's solution was traced. */
  afterSolve: RefractSnapshot[];
}

/**
 * Play `count` boards of a cascade run seeded with `seed`: reset, start the
 * sequence, and for each board read it back, solve it with the case's own
 * spec-derived solver, trace the solution, and cross the solved screen through
 * NEXT BOARD (`SOLVED_ITEMS[0]`, highlighted on arrival).
 *
 * Solvability is proven BY SOLVING: the solver is derived from `specs/beams.md`
 * alone, so a board it cracks is solvable under the specification, whatever the
 * build believes. Nothing here asserts — the sweep's record is handed back, and
 * the caller holds it against its own point: a board the solver called
 * unsolvable, a trace the build refused, a screen that never advanced all
 * surface in `verdicts` and `afterSolve`.
 *
 * `onBoard` runs after each board's arrival snapshot is read and before its
 * solution is traced.
 */
export async function solveGenerated(
  h: Harness,
  count: number,
  seed: number,
  onBoard?: (snapshot: RefractSnapshot, index: number) => void | Promise<void>,
): Promise<CascadeSweep> {
  await h.debug.reset({ seed });
  await h.advance(1);
  await startCascade(h);

  const boards: Board[] = [];
  const verdicts: SolveResult[] = [];
  const afterSolve: RefractSnapshot[] = [];
  for (let index = 0; index < count; index += 1) {
    let snapshot = await h.snapshot();
    requireScreen(
      snapshot,
      "playing",
      `board ${index + 1} of the cascade sweep should be in play`,
    );
    const board = boardFromSnapshot(snapshot);
    boards.push(board);
    await onBoard?.(snapshot, index);
    const verdict = solve(board);
    verdicts.push(verdict);
    if (verdict.status === "solved") await drawBeams(h, verdict.beams);
    snapshot = await h.snapshot();
    afterSolve.push(snapshot);
    if (index < count - 1 && snapshot.screen === "solved") {
      // First choice, highlighted on arrival: NEXT BOARD.
      await fireAction(h, "confirm");
    }
  }
  return { boards, verdicts, afterSolve };
}
