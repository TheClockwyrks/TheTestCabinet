// Kessler — the shared validator harness. CASE-PROVIDED.
//
// Every check in this project is an ordinary vitest test that drives the built
// site IN A REAL BROWSER. There is nothing to import: an engineless run seeds no
// `src/` at all, so the build wrote its own frame loop, its own canvas fit, its
// own keyboard, its own audio, and its own `window.__kessler` — and the only
// place all of that exists is a page that has loaded the bundle. So the project
// serves `dist/`, loads it in Chromium, and reaches the game the way anything
// reaches it: over the surface `specs/instrumentation.md` told the build to
// install.
//
// WHAT A CHECK READS. The game's own state (through `window.__kessler`'s
// `snapshot`), the ticks the harness itself drove, the operations the build
// issued against its 2D context, the sprites it blitted and where, the pixels
// all of that left on the canvas, and the cues it played. Nothing here
// fabricates an outcome: the scenario helpers below only ARRANGE the world
// through the surface, one atomic operation at a time, and the real tick the
// build wrote is what runs from there.
//
// THE CLOCK IS THE SURFACE'S. Nothing outside an engineless build owns its
// loop, so `specs/instrumentation.md` puts the clock on the surface:
// `setAutoStep(false)` stops the frame loop feeding the wall clock into the
// tick accumulator, and `step(ticks)` runs whole ticks immediately, each the
// full tick followed by a render. Every harness opens by taking the game off
// the clock, so a check asks for a number of ticks and gets exactly that number
// — no polling, no waiting, and no measurement of the machine it ran on. The
// one check that is ABOUT the loop running itself hands it back with `runFor`.
//
// WHERE THE COMPOUND SEQUENCES LIVE. Here, and nowhere else. The debug surface
// is atomic by design — one field, one read, one clock move — so posing an
// isolated field, starting a session the way a player does, or arranging a
// bounce is several calls in a fixed order. Each of those orders is written
// ONCE, in the scenario section at the foot of this file, and every suite that
// needs part of one calls the operations it needs instead of restating the
// whole.
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
import type { Browser, BrowserContext, CDPSession, Page } from "playwright";
import { connectChromium } from "./chromium";
import { fail } from "./assert";
import { hostFault } from "./case-harness/host";
import {
  CUE_NAMES,
  MUSIC_PLAY,
  MUSIC_TITLE,
  STAGE_H,
  STAGE_W,
  TICK_MS,
  UNBOUND_KEY,
  WAVECLEAR_TICKS,
  outwardVelocity,
  pointAt,
  type Screen,
} from "./constants";
import {
  HANDLE,
  REQUIRED_OPS,
  type DrivenSurface,
  type KesslerDebugApi,
  type KesslerSnapshot,
  type MenuItemRect,
} from "./surface";

export { HANDLE, REQUIRED_OPS };
export type { KesslerSnapshot, KesslerDebugApi, DrivenSurface, MenuItemRect };

declare module "vitest" {
  export interface ProvidedContext {
    /** Where the built site is served, from `globalSetup.ts`. */
    kesslerUrl: string;
    /** The one Chromium every suite worker connects to. */
    kesslerBrowserWs: string;
  }
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
   * The quarter turns the blit carried the sprite's own `+x` axis through, or
   * `null` when the transform was not a whole number of quarter turns — which,
   * in a game whose deflector rides any angle, is ordinary rather than a fault.
   */
  quarterTurns: number | null;
}

/** A cue the build played, and the tick of the drive it played on. */
export interface TimedCue {
  /** The driven tick it sounded on, 1-based, as {@link Harness.tickCount} counts. */
  tick: number;
  /** The drive's simulated time at that tick, in milliseconds. */
  t: number;
  /**
   * The cue, named from the file the sound came from, or `null` for a sound
   * whose file could not be named. See `audio-init.js`.
   */
  name: string | null;
  /** Whether the source was asked to loop, which is what a music bed is. */
  loop: boolean;
  /** The URL the sound's bytes came from, where there was one. */
  url: string | null;
}

/** What one tick's render issued: its operations, and its bitmap blits. */
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
  /**
   * Whether the browser reports a touchscreen.
   *
   * Off by default, because it is a property of the DEVICE the build believes
   * it is running on: with it on `navigator.maxTouchPoints` is non-zero and a
   * contact arrives with `pointerType: "touch"`. `specs/controls.md` requires
   * the menus to answer a touch contact, so the check that is ABOUT touch asks
   * for it and every other check stays on the shape the rest were taken at.
   */
  touch?: boolean;
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
  snapshot: KesslerSnapshot;
}

export interface Harness {
  /** The page the build is running in. For a check that needs Playwright itself. */
  readonly page: Page;
  /**
   * The surface the BUILD installed, as operations that cross into the page.
   *
   * Read off `window.__kessler` and never constructed here — see
   * {@link unexposedSurface}.
   */
  readonly debug: DrivenSurface;
  /**
   * Why the build's surface cannot be driven, or `null` when it can.
   *
   * A fault here is the build's: the surface is missing, or it is missing an
   * operation the specification requires. Every operation fails by assertion
   * with that fault beside what the specification requires, rather than
   * throwing, so the fault lands on the points whose checks reach the game
   * through the surface.
   */
  readonly surfaceFault: string | null;
  /** Everything the page logged to `console.error`, or threw, oldest first. */
  readonly pageErrors: string[];

  /** The ticks this harness has driven, 1-based as a recorded tick counts. */
  tickCount(): number;
  /** The simulated time those ticks covered, in milliseconds. */
  timeMs(): number;

  /** A fresh read of the game's state through the build's `snapshot`. */
  snapshot(): Promise<KesslerSnapshot>;
  /**
   * Reset to the boot state through the build's `reset`, seeding the pod
   * generator when `seed` is given, and read what it left.
   */
  reset(seed?: number): Promise<KesslerSnapshot>;
  /** Run `ticks` whole simulation ticks, and read what they left. */
  tick(ticks?: number): Promise<KesslerSnapshot>;
  /** Drive a tick at a time until `predicate` holds, or the budget is spent. */
  until(
    predicate: (snapshot: KesslerSnapshot) => boolean,
    options?: UntilOptions,
  ): Promise<UntilResult>;
  /** Hand the game back to its own frame loop for `ms` of real time, then take it back. */
  runFor(ms: number): Promise<void>;

  /** Press a key and leave it down, as a player holding it would. */
  keyDown(code: string): Promise<void>;
  /** Release a key held by {@link keyDown}. */
  keyUp(code: string): Promise<void>;
  /** Let the build's own animation loop run at least one frame of its own. */
  settleFrame(): Promise<void>;

  /** Run exactly one tick and hand back everything its render issued. */
  frameDraw(): Promise<FrameDraw>;
  /** Run exactly one tick and hand back the operations its render issued. */
  frameCalls(): Promise<DrawCall[]>;
  /** Run exactly one tick and hand back the bitmaps it blitted. */
  frameBlits(): Promise<Blit[]>;
  /** Reflect the surface without invoking it: `typeof` for each name. */
  probe(names: readonly string[]): Promise<Record<string, string>>;

  /** How the stage is mapped onto this harness's canvas. */
  viewport(): Viewport;
  /** Where a logical point lands in the canvas's backing store. */
  device(x: number, y: number): { x: number; y: number };
  /**
   * Where a logical point lands in CSS pixels, which is what a real pointer or
   * a real contact is moved in.
   *
   * Taken through the DEVICE mapping and back, so it answers the CSS position
   * of the pixel the point lands on — which is where a press has to land to
   * reach what was drawn there.
   */
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

  /**
   * Whether the build has the cue `name` sounding as a loop at this moment.
   *
   * `audio-init.js` holds each looping source from the moment it starts until
   * something ends it, so this is a reading of what is playing NOW rather than
   * of what was once asked for. {@link onCue} records the other thing: the
   * moments a cue was ASKED for.
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

/** The case this project validates, which prefixes what the harness prints. */
const SLUG = "kessler";

/** This module's directory: the validator project's root. */
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * How long the surface is waited for before the build is called non-conformant.
 *
 * Generous against a conformant build and cheap against one: the wait is a poll
 * that returns the instant the global appears, and `specs/instrumentation.md`
 * has the build install it as soon as the game has initialized, so a page that
 * has fired `load` has either installed it already or is not going to. What the
 * ceiling really bounds is the cost of a build with no surface at all, which
 * pays it once per harness.
 */
const SURFACE_TIMEOUT_MS = 5_000;

/**
 * How long {@link Harness.armAudio} waits for the build's cues to decode.
 *
 * Short, because it is paid in full by a build that decodes nothing — one that
 * synthesizes its sound, plays through an `<audio>` element, or ships none at
 * all — and none of those is a build this wait can help. A build that does
 * decode its files off a loopback server is ready in a few milliseconds, and
 * this returns the instant it is.
 */
const AUDIO_LOAD_TIMEOUT_MS = 2_000;

let browserPromise: Promise<Browser> | null = null;

async function sharedBrowser(): Promise<Browser> {
  browserPromise ??= connectChromium(inject("kesslerBrowserWs"), {
    slug: SLUG,
  });
  return browserPromise;
}

/**
 * One browser context per WINDOW SHAPE, shared by every harness of that shape
 * in this file, and one PAGE per harness inside it.
 *
 * The split is what the init scripts force and what correctness wants. The
 * three probes are installed on the CONTEXT, so every page it opens is
 * instrumented before a line of the build's script runs, and a context is also
 * where the viewport and the device pixel ratio are fixed — the one thing a
 * window-fit check varies. Everything else about a harness is the page: a fresh
 * one opens on a build that has just started, with no key held and no audio
 * context opened.
 */
const contexts = new Map<string, BrowserContext>();

/** Every page this worker opened, so none is left behind in the shared browser. */
const openPages = new Set<Page>();

function shapeKey(
  cssWidth: number,
  cssHeight: number,
  dpr: number,
  touch: boolean,
): string {
  return `${cssWidth}x${cssHeight}@${dpr}${touch ? "+touch" : ""}`;
}

/** The context for a window of this shape, opened and instrumented on demand. */
async function contextFor(
  cssWidth: number,
  cssHeight: number,
  dpr: number,
  touch: boolean,
): Promise<BrowserContext> {
  const key = shapeKey(cssWidth, cssHeight, dpr, touch);
  const existing = contexts.get(key);
  if (existing !== undefined) return existing;

  const browser = await sharedBrowser();
  const context = await browser.newContext({
    viewport: { width: cssWidth, height: cssHeight },
    deviceScaleFactor: dpr,
    hasTouch: touch,
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
 * Registered from `setup.ts` as an `afterAll`, so a suite file never has to
 * think about it and a worker cannot leave a page behind in the shared browser.
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
 * so a logical coordinate and a canvas pixel are the same thing and no check
 * but a window-fit one has to think about the fit at all.
 */
export async function openHarness(
  options: HarnessOptions = {},
): Promise<Harness> {
  const cssWidth = options.cssWidth ?? STAGE_W;
  const cssHeight = options.cssHeight ?? STAGE_H;
  const dpr = options.dpr ?? 1;

  // A BROWSER THAT NEVER CAME UP, OR A PAGE THAT WAS NEVER SERVED, IS THE HOST'S
  // DOING AND NOT THE BUILD'S, so it leaves the running check UNDECIDED rather
  // than failing it. `hostFault` is the shared harness's — see its `host.ts` —
  // and it reaches the running check through the hook `setup.ts` registers. A
  // throw here would instead mark every point the file decides failed, on a
  // build that was never asked anything, because this runs in the `beforeEach`
  // of every check file.
  //
  // Only these three reach it: the browser, the page, and the served file.
  // A page that loaded and then installed no surface, drew nothing, or answered
  // a call wrongly is the build's own doing, and is failed as such below.
  let page: Page;
  try {
    const context = await contextFor(
      cssWidth,
      cssHeight,
      dpr,
      options.touch ?? false,
    );
    page = await context.newPage();
  } catch (error) {
    return hostFault(
      `no page could be opened in the shared Chromium (${String(error)})`,
    );
  }
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

  try {
    await page.goto(inject("kesslerUrl"), { waitUntil: "load" });
  } catch (error) {
    return hostFault(
      `the built site would not load from this project's own server ` +
        `(${String(error)})`,
    );
  }

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
    // from here the game changes only when this harness says so. `reset` leaves
    // `autoStep` untouched by design (specs/instrumentation.md), so the explicit
    // call before it is what holds the simulation for the whole session.
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
            window as unknown as { __kesslerRec: { ready(): boolean } }
          ).__kesslerRec.ready(),
        undefined,
        { timeout: SURFACE_TIMEOUT_MS },
      )
      .catch(() => undefined);
  }

  const view = fitViewport(cssWidth, cssHeight, dpr);
  const cueSinks: TimedCue[][] = [];
  let tickCount = 0;
  let timeMs = 0;

  /** One sound, as `audio-init.js` logs it. */
  type Sound = { name: string | null; url: string | null; loop: boolean };

  /**
   * How many sounds of the page's log have already been handed to the sinks.
   *
   * Kept here rather than in the page because it is a fact about what THIS
   * harness has attributed, and because a sound can be played outside every
   * driven tick — see {@link takeCues}.
   */
  let heard = 0;

  /**
   * Hand `sounds` to every watcher, stamped with the tick they belong to.
   *
   * A SOUND PLAYED OUTSIDE A DRIVEN TICK BELONGS TO THE LAST TICK DRIVEN. The
   * build's own animation frame keeps running while the simulation is held off
   * the wall clock — `specs/instrumentation.md` says so, because a menu still
   * has to answer a key press with the game stopped — and the cues those
   * frames play (`menu-move`, `menu-select`, a bed starting) land between two
   * crossings. Attributing those to the tick count as it stands is exact where
   * it matters — a tap advances the counter by exactly one tick, so a cue the
   * tap caused is stamped with the tap's tick whichever loop played it — and
   * never loses a sound.
   */
  const takeCues = (sounds: readonly Sound[], tick: number): void => {
    for (const sound of sounds) {
      for (const sink of cueSinks) {
        sink.push({ tick, t: timeMs, ...sound });
      }
    }
  };

  /**
   * Read the game's state, and with it everything played since the last look.
   *
   * One crossing rather than two, and the reason it is the SNAPSHOT that
   * carries the drain is that a check reads the state at the end of every
   * scenario: it is the one call the harness can be sure happens after the last
   * thing a build was asked to do.
   */
  const readSnapshot = async (): Promise<KesslerSnapshot> => {
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
            __kesslerAudio: { count(): number; since(n: number): unknown[] };
          }
        ).__kesslerAudio;
        return {
          snapshot: api.snapshot(),
          outside: audio.since(from),
          count: audio.count(),
        };
      },
      [HANDLE, heard] as const,
    )) as { snapshot: KesslerSnapshot; outside: Sound[]; count: number };
    heard = result.count;
    takeCues(result.outside, tickCount);
    return result.snapshot;
  };

  /**
   * Run `ticks` ticks and read the state they left, in one crossing.
   *
   * Each tick is opened and closed around a single `step(1)`, all inside one
   * synchronous evaluation, so nothing the page's own animation frame renders
   * can land inside a recorded tick — and so a frame the recorder keeps is
   * exactly one tick the game ran. That is also what makes the per-tick cue and
   * blit readings exact: nothing else in the page can run between a tick
   * opening and closing.
   *
   * `collect` asks for the last tick's operations and blits as well. It is off
   * for a plain drive because a frame of this game is hundreds of operations,
   * and a sweep that carried them all back would spend its time on drawing no
   * check is going to read.
   */
  const drive = async (
    ticks: number,
    collect = false,
  ): Promise<{ snapshot: KesslerSnapshot; draw: FrameDraw }> => {
    if (surfaceFault !== null) refuse();
    const result = (await page.evaluate(
      ([handle, count, tickMs, wanted, from]) => {
        const api = (
          window as unknown as Record<
            string,
            Record<string, (...a: unknown[]) => unknown>
          >
        )[handle];
        const rec = (
          window as unknown as {
            __kesslerRec: Record<string, (...a: unknown[]) => unknown>;
          }
        ).__kesslerRec;
        const audio = (
          window as unknown as {
            __kesslerAudio: { count(): number; since(n: number): unknown[] };
          }
        ).__kesslerAudio;
        const images = (
          window as unknown as {
            __kesslerImages: { count(): number; since(n: number): unknown[] };
          }
        ).__kesslerImages;
        // Anything played since the last look, before this drive opens a tick.
        const outside = audio.since(from);
        let cursor = audio.count();
        const sounds: unknown[][] = [];
        let blits: unknown[] = [];
        for (let i = 0; i < count; i += 1) {
          const blitsBefore = images.count();
          rec.begin();
          api.step(1);
          rec.end(tickMs);
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
      [HANDLE, ticks, TICK_MS, collect, heard] as const,
    )) as {
      snapshot: KesslerSnapshot;
      outside: Sound[];
      sounds: Sound[][];
      count: number;
      ops: RecordedOp[];
      blits: Blit[];
    };

    heard = result.count;
    takeCues(result.outside, tickCount);
    for (let i = 0; i < ticks; i += 1) {
      tickCount += 1;
      timeMs += TICK_MS;
      takeCues(result.sounds[i], tickCount);
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
          throw new Error("kessler: the page has no <canvas>");
        let canvas = canvases[0];
        for (const other of canvases) {
          if (other.width * other.height > canvas.width * canvas.height)
            canvas = other;
        }
        const ctx = canvas.getContext("2d");
        if (ctx === null)
          throw new Error("kessler: the canvas has no 2D context");
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

    tickCount: () => tickCount,
    timeMs: () => timeMs,

    snapshot: () => readSnapshot(),

    reset: async (seed) => {
      await (seed === undefined ? debug.reset() : debug.reset(seed));
      return readSnapshot();
    },

    tick: async (ticks = 1) => (await drive(ticks)).snapshot,

    async until(predicate, untilOptions = {}) {
      const maxTicks = untilOptions.maxTicks ?? 400;

      let snapshot = await readSnapshot();
      if (predicate(snapshot)) return { hit: true, ticks: 0, snapshot };

      for (let ticks = 1; ticks <= maxTicks; ticks += 1) {
        snapshot = (await drive(1)).snapshot;
        if (predicate(snapshot)) return { hit: true, ticks, snapshot };
      }
      return { hit: false, ticks: maxTicks, snapshot };
    },

    async runFor(ms) {
      if (surfaceFault !== null) refuse();
      // The one thing here that depends on real elapsed time, so the one thing
      // a browser's own idea of which page matters can distort. The launch
      // already turns the throttling off; bringing the page forward as well
      // means this does not rest on a flag alone.
      await page.bringToFront().catch(() => undefined);
      await page.evaluate(
        ([handle]) => {
          (
            window as unknown as { __kesslerRec: { setMode(m: string): void } }
          ).__kesslerRec.setMode("raf");
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
            window as unknown as { __kesslerRec: { setMode(m: string): void } }
          ).__kesslerRec.setMode("manual");
        },
        [HANDLE] as const,
      );
    },

    keyDown: (code) => page.keyboard.down(code),
    keyUp: (code) => page.keyboard.up(code),

    settleFrame: async () => {
      // Two animation frames of the build's OWN loop, which keeps running while
      // the simulation is held (`specs/instrumentation.md`): one for a frame
      // that may already be mid-flight, one that is guaranteed to begin after
      // this call. It is how a real key press reaches a build that reads its
      // keyboard on its own frames — a menu answers here, with no tick run.
      await page.evaluate(
        () =>
          new Promise<void>((done) => {
            requestAnimationFrame(() => requestAnimationFrame(() => done()));
          }),
      );
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
          return ops;
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
            "kessler: the page has no <canvas>, so the build drew nowhere — " +
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
      // The FILES first. A build fetches and decodes its cues after the page
      // has loaded (`specs/assets.md` puts the produced `.wav`s under `assets/`
      // and has the build load them itself), so a check that drove the game the
      // instant the page settled could reach a bounce before the bounce's own
      // clip had arrived and read silence from a build that is simply still
      // starting up. The wait is BOUNDED and never fails, so a build whose
      // cues never decode reaches its cue points and fails them there, rather
      // than hanging here.
      //
      // Then a GENUINE browser gesture, not a posed one: a build is free to
      // open its audio context from a real DOM event alone (conformant), so a
      // key delivered any other way would leave a perfectly good build silent.
      // The key is bound to nothing, so arming changes no game state.
      await page
        .waitForFunction(
          (wanted) => {
            const audio = (
              window as unknown as { __kesslerAudio?: { decoded(): string[] } }
            ).__kesslerAudio;
            if (audio === undefined) return false;
            const held = audio.decoded();
            return wanted.every((name) => held.includes(name));
          },
          [...CUE_NAMES, MUSIC_TITLE, MUSIC_PLAY],
          { timeout: AUDIO_LOAD_TIMEOUT_MS, polling: 25 },
        )
        .catch(() => undefined);
      await page.keyboard.press(UNBOUND_KEY);
      await harness.settleFrame();
    },

    async looping(name) {
      const sounding = (await page.evaluate(() => {
        const audio = (
          window as unknown as { __kesslerAudio: { looping(): string[] } }
        ).__kesslerAudio;
        return audio.looping();
      })) as string[];
      return sounding.includes(name);
    },

    async dispose() {
      // The context stays: it holds the init scripts and the window shape, and
      // the next harness of this shape wants both. The page goes, so nothing
      // this check pressed or opened can reach the next one.
      openPages.delete(page);
      await page.close().catch(() => undefined);
    },
  };

  harnessCues.set(harness, cueSinks);
  return harness;
}

/** Where {@link onCue} attaches, per harness. */
const harnessCues = new WeakMap<Harness, TimedCue[][]>();

/* -------------------------------------------------------------------------- */
/* The keyboard                                                               */
/* -------------------------------------------------------------------------- */
//
// Real key events, through Chromium's own input pipeline, because the keyboard
// belongs to the runtime layer the build wrote and `specs/instrumentation.md`
// carries no operation for it: a dispatched key is required to work exactly as
// a player's key does, and these are how a check dispatches one.
//
// WHY A TAP SPANS BOTH A SETTLED FRAME AND A DRIVEN TICK. `specs/controls.md`
// makes every action either a held value or a press EDGE, and it deliberately
// does not fix WHERE a build consumes an edge: a menu answers on the build's
// own animation frame even while the simulation is held (the specification
// requires exactly that), while a build is equally free to latch the edge and
// resolve it on the next simulation tick. So a tap gives the press both
// moments: the key goes down, the build's own loop runs a frame with it held
// (a menu answers here), one tick is driven (a latched edge resolves here),
// and the key comes up. Exactly ONE tick passes per tap, whichever design the
// build chose, so a scenario that counts ticks counts the tap as one — and a
// check that needs a position exact to the tick poses it through the surface
// instead of pressing for it.

/**
 * Press `code`, let the press land, and release it — one action's worth, as
 * `specs/controls.md` reads a press edge. Advances the simulation by exactly
 * one tick.
 */
export async function tap(h: Harness, code: string): Promise<void> {
  await h.keyDown(code);
  await h.settleFrame();
  await h.tick(1);
  await h.keyUp(code);
}

/**
 * Hold `code` down while `ticks` ticks run, then release it — how a check
 * drives the deflector's held rotation, which tick step 1 of `specs/field.md`
 * reads from the held keys. The key is down for every one of the ticks, so a
 * conformant build turns the deflector `ticks / 60` seconds' worth.
 */
export async function hold(
  h: Harness,
  code: string,
  ticks: number,
): Promise<KesslerSnapshot> {
  await h.keyDown(code);
  await h.settleFrame();
  try {
    return await h.tick(ticks);
  } finally {
    await h.keyUp(code);
  }
}

/* -------------------------------------------------------------------------- */
/* The fit                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * How the stage maps onto a surface of this shape, as `specs/overview.md` fixes
 * it: one uniform scale, the whole stage inside, centred, with the leftover
 * split evenly into two bars.
 *
 * Computed rather than read from the build, deliberately: here the fit is the
 * build's own work, so asking it would be asking a build to grade itself. Every
 * check but a window-fit one runs at the stage's own size, where this is the
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
// A review item may declare a `replay` OUTPUT beside its verdict: the frames
// the build itself drew while a check drove it, kept as evidence a reviewer can
// scrub and compare against the reference implementation's. `captureReplay` is
// how a check produces one.
//
// Four properties are what make it usable, and each is deliberate:
//
// 1. IT RECORDS THE SECTION, NOT THE RUN. The recorder is armed around the
//    caller's scenario and disarmed the moment that scenario returns, so what
//    is kept is the part the check is ABOUT and never the setup that got there.
// 2. IT IS EVIDENCE, NEVER A VERDICT. The scenario's own value comes straight
//    back, and a scenario that THROWS still writes what it had recorded before
//    the failure travels on — a failing check is the one whose replay a
//    reviewer most wants. A recording that cannot be written is reported as an
//    output that never turned up, which is a fact about the host rather than
//    about the build.
// 3. IT WRITES ONLY WHAT THERE IS TO LOOK AT. A capture that closed no frames
//    leaves no file, so the run reports the output absent instead of offering
//    the reviewer a replay of nothing.
// 4. IT COSTS NOTHING WHEN NOBODY IS COLLECTING. Outside a run the media
//    directory is unset and the whole thing is a no-op that still runs the
//    scenario, so a check cannot pass in one place and fail in the other.

/** The environment variable the runner names the media directory in. */
const MEDIA_DIR_ENV = "TCAB_VALIDATION_MEDIA_DIR";

/**
 * The directory the runner stages this project to inside the build's tree.
 *
 * A recording is addressed by the STAGED path of the suite that produced it,
 * because that is the path the review item's declared script resolves to, and
 * so the only name the case's manifest and the runner both already agree on.
 * Stating the prefix here is what keeps that address the same when this suite
 * is run in place against a reference implementation, where the project root is
 * `validation/none/` instead.
 */
const STAGED_PROJECT_DIR = "validation";

/**
 * The most frames a written recording holds.
 *
 * The injected recorder already holds the page's side to twice this, decimating
 * as it fills, so what arrives here is at most a few hundred frames however
 * long the section ran. This is the same cap the engine-backed harnesses write
 * under, so a replay recorded under any engine is the same size of thing.
 */
export const MAX_REPLAY_FRAMES = 300;

/**
 * The ground the console's player paints behind a recorded frame.
 *
 * The specification fixes no palette: the build paints its own stage background
 * each frame, letterbox bars included, and the recorded frames carry that
 * paint. What the player needs is a colour for the canvas under them, and the
 * page the build is served on is painted `#000` by the case's own `index.html`,
 * so that is what a replay says.
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
   * carry, and was cut down to the bound. Present only on a frame that was in
   * fact cut down.
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
   * inherited clip makes unavoidable: applying a clip means replaying that
   * clip's own path operations, which leaves the clip outline current, and a
   * frame that then issues a bare `fill` would fill the outline of its clip.
   */
  path: RecordedPathSegment[];
}

/**
 * One run of path operations, and the transform they were issued under.
 *
 * A path is given in user space, so both the clip and the current path are
 * split into one segment per transform and a player replays each under its own.
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
 * operations draw with — the gradients, the captured images — live in tables
 * the whole recording shares. So every reference a frame makes resolves at
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
 * Where the running suite's `outputId` output belongs, or `null` when nothing
 * is collecting media.
 *
 * The suite is the one vitest is currently running rather than one the caller
 * names, because the two must not be able to disagree: a check that named its
 * own path would be free to write its evidence under some other point's
 * address.
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
 * table to hold one copy of each, and the key order inside an argument the
 * build passed is the build's own business rather than ours.
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
 * WITH. Every entry here is reached from a kept frame, and every reference
 * inside one is rewritten as it is reached, transitively: a frame names its own
 * state and the states saved under it, whose clip and path segments name
 * operations and resources, whose own creating calls may name images. What is
 * deduplicated is the rewritten entry, so an operation two hundred frames issue
 * identically is written once and named two hundred times, and every index a
 * frame carries addresses the table it was interned into.
 *
 * A field named `__proto__` is rewritten like any other, defensively: no
 * recording this project writes arrives carrying one, because Playwright's
 * serializer drops such a field on the way out of the page.
 */
function retable(recording: Recording, frames: RecordedFrame[]): Recording {
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
    // A recipe's own arguments can only name values made before it, so
    // rewriting it terminates and cannot re-enter this resource.
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
 * A recording of at most {@link MAX_REPLAY_FRAMES} frames, covering the whole
 * of what was captured, with each kept frame's `deltaMs` restated as the time
 * since the frame kept before it.
 *
 * The restatement is what makes a decimated recording play at the speed the
 * game really ran at: the deltas still sum to the section's elapsed time. The
 * frame `count` is left as it was recorded, so a reader can see that frames
 * were skipped rather than being told a smooth lie. The last frame is always
 * kept whatever the stride lands on — it is the frame the check's sweep stopped
 * at, and the one a reviewer looks at first.
 *
 * Keeping it costs a frame rather than the cap. The stride rounds up, so a
 * section whose length is an exact multiple of the cap strides over exactly
 * that many frames and stops one stride short of the end: the last frame still
 * has to come in, and the cap is a ceiling rather than a target. It takes the
 * place of the final strided frame — the frame nearest it, so the swap opens
 * the smallest gap available anywhere in the section — and is measured from
 * where that frame was measured from, which is what keeps the kept deltas
 * summing to the elapsed time.
 *
 * What survives is then re-expressed against tables of its own, so the file
 * carries what the kept frames draw with and nothing the dropped ones did.
 *
 * A written recording is thinned twice: the injected recorder decimates in the
 * page as the section runs, and this thins whatever survived that on the way
 * out.
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
 * Write a recording out, reporting rather than raising anything that goes
 * wrong.
 *
 * A capture that closed no frames writes nothing: a file holding an empty frame
 * list would be collected as an output that turned up, and the run would tell
 * the reviewer there is a replay to watch and then open the player on nothing.
 *
 * What lands on disk is gzip rather than raw JSON. A recording is text made
 * almost entirely of numbers and repeated field names, which gzip takes down to
 * a fraction of its size, and every host that serves one declares the encoding
 * so the browser inflates it before the player sees it.
 *
 * Never throws. A file that cannot be written says something about the machine
 * the validators ran on, and failing the point over it would blame the build
 * for the host's problem.
 */
function writeReplay(destination: string, recording: Recording | null): void {
  if (recording === null || recording.frames.length === 0) return;
  try {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, gzipSync(JSON.stringify(thinReplay(recording))));
  } catch (error) {
    console.warn(`kessler: could not write ${destination}: ${String(error)}`);
  }
}

/**
 * Record the ticks `scenario` drives and keep them as the review item's
 * `outputId` output, handing back whatever the scenario returned.
 *
 * Wrap the drive, not the arrangement:
 *
 * ```ts
 * const after = await captureReplay(h, "bounce", () => h.tick(30));
 * assertEqual(after.balls.length, 1);
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
        window as unknown as { __kesslerRec: { arm(d: unknown): boolean } }
      ).__kesslerRec.arm(design),
    { width: STAGE_W, height: STAGE_H, background: REPLAY_BACKGROUND },
  );
  try {
    return await scenario();
  } finally {
    // In a `finally`, so a scenario that failed still leaves its evidence
    // behind.
    const recording = (await h.page.evaluate(() =>
      (
        window as unknown as { __kesslerRec: { disarm(): unknown } }
      ).__kesslerRec.disarm(),
    )) as Recording | null;
    writeReplay(destination, recording);
  }
}

/**
 * Keep the picture currently on the canvas as the review item's `outputId`
 * output.
 *
 * The companion to {@link captureReplay}, for a point whose evidence is one
 * PICTURE rather than a stretch of motion: which screen the game opened on,
 * where the letterbox bars fell, what the HUD showed. What is written is
 * whatever the last frame that RAN left behind, so call it after the frame that
 * poses the thing under test and before the assertions, so a check that fails
 * still leaves the picture that shows why. Nothing here can change a verdict:
 * outside a run this is a no-op, and a still that cannot be written is reported
 * as an output that never turned up.
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
    console.warn(`kessler: could not write ${destination}: ${String(error)}`);
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
 * A build is free to draw under a transform — and an engineless build always
 * is, because `specs/overview.md` makes the fit from the logical stage to the
 * canvas the build's own work, which is most naturally a transform on the
 * context. So the position a `fillText` names is only where the text landed
 * once the transform in force at that call is applied. This walks the frame's
 * operations and carries that transform. At the harness's default shape the
 * canvas is the stage at one pixel per unit, so the result is in logical units
 * as well.
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
 * Enough of a count to compare two frames of the same scene: a frame that drew
 * a shield ring asked for strictly more of these than the same frame with none
 * to show, whatever shape the build chose to draw it as.
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
 * Where a render put its geometry is the direct reading of what it drew. The
 * leading pair of arguments is the position for every method listed, except the
 * curve calls, whose control points come first and whose endpoint is the last
 * pair. Unlike {@link textDraws} these are NOT mapped through the transform, so
 * a check that needs canvas pixels reads text draws or blits instead.
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
 * Record every cue the build plays from now on, stamped with the tick of the
 * drive it played on and named by the file it came from.
 *
 * WHAT IS OBSERVED, AND WHY IT IS THE FAIR READING. The specs fix one cue per
 * event, played on the tick its event resolves, and `specs/assets.md` fixes the
 * FILE behind each of the thirteen cues and two beds — so `audio-init.js`
 * carries the file's name from the fetch, through the decode, to the source
 * that plays it, and a check reads WHICH cue sounded, not merely that something
 * did. A sound whose file cannot be named arrives with a `name` of `null` and
 * is still recorded, so a build's own synthesized flourish is never mistaken
 * for one of the thirteen and never silently dropped.
 */
export function onCue(h: Harness): TimedCue[] {
  const played: TimedCue[] = [];
  harnessCues.get(h)?.push(played);
  return played;
}

/** Every recorded play of the cue `name`, in the order they sounded. */
export function cuesNamed(cues: readonly TimedCue[], name: string): TimedCue[] {
  return cues.filter((cue) => cue.name === name);
}

/** Every recorded play that fell on tick `tick` of the drive. */
export function cuesOnTick(
  cues: readonly TimedCue[],
  tick: number,
): TimedCue[] {
  return cues.filter((cue) => cue.tick === tick);
}

/* -------------------------------------------------------------------------- */
/* Blits                                                                      */
/* -------------------------------------------------------------------------- */

/** Where a blit's centre landed, in device pixels. */
export function blitCenter(blit: Blit): { x: number; y: number } {
  return { x: blit.x + blit.w / 2, y: blit.y + blit.h / 2 };
}

/**
 * Every blit whose centre landed within `within` logical units of the logical
 * point `(x, y)` — how a check asks which sprite was painted on a ball, a pod,
 * or the planet, whose sprites `specs/assets.md` has drawn centered on their
 * objects.
 */
export function blitsNear(
  h: Harness,
  blits: readonly Blit[],
  x: number,
  y: number,
  within: number,
): Blit[] {
  const view = h.viewport();
  const at = h.device(x, y);
  const bound = within * view.scale;
  return blits.filter((blit) => {
    const centre = blitCenter(blit);
    return Math.hypot(centre.x - at.x, centre.y - at.y) <= bound;
  });
}

/**
 * The identity of the sprite painted nearest the logical point `(x, y)` among
 * blits within `within` units of it, or `null` when none landed there.
 *
 * The LAST such blit, because that is the one a player sees: a build that
 * paints a spot twice has shown the second.
 */
export function spriteNear(
  h: Harness,
  blits: readonly Blit[],
  x: number,
  y: number,
  within: number,
): string | null {
  const found = blitsNear(h, blits, x, y, within);
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

/** The colour rendered at the logical point `(x, y)`. */
export async function sampleAt(h: Harness, x: number, y: number): Promise<Rgb> {
  const [r, g, b] = await h.pixel(x, y);
  return { r, g, b };
}

/** The colour rendered at radius `r`, angle `thetaDeg`, under the polar map. */
export async function samplePolar(
  h: Harness,
  r: number,
  thetaDeg: number,
): Promise<Rgb> {
  const point = pointAt(r, thetaDeg);
  return sampleAt(h, point.x, point.y);
}

/** The colours at several logical points, in one crossing into the page. */
export async function samplePoints(
  h: Harness,
  points: readonly { x: number; y: number }[],
): Promise<Rgb[]> {
  const read = await h.pixels(points);
  return read.map(([r, g, b]) => ({ r, g, b }));
}

/* -------------------------------------------------------------------------- */
/* Posing a world                                                             */
/* -------------------------------------------------------------------------- */
//
// The surface is atomic — one field, one read, one clock move — so a scenario
// is several calls in a fixed order, written once, here. The rule the guide
// states is that a validator poses an ISOLATED world: it clears every entity
// the requirement is not about and spawns back exactly what it is about, and it
// holds still the consequences the requirement does not exercise.
// `specs/instrumentation.md` gives Kessler two driver switches for that
// (`waveAdvance`, `podSpawn`) and operations that place and remove each kind of
// thing on the field.

/**
 * Reset the game and stand it on an EMPTY `playing` field with both autonomous
 * consequences held: no targets, no balls, no pods, `waveAdvance` off (so an
 * emptied field does not clear into the interstitial), and `podSpawn` off (so a
 * destruction the scenario stages sheds nothing it did not ask for and the
 * seeded stream stays where it stands).
 *
 * The scenario then spawns back exactly what its requirement is about —
 * `spawnTarget` for the one target, `spawnBall` for the one ball, `spawnPod`
 * for the one pod — and turns a switch back on only when the switch's own
 * consequence IS the requirement. `seed` seeds the pod generator for a scenario
 * that will turn `podSpawn` back on.
 *
 * Every call here is one of the surface's atomic poses, in a deliberate order:
 * the reset first, which is what puts the wave-1 figures in force and stands
 * the deflector at angle `90` with its baseline span, so nothing a previous
 * section left is inherited; then `setScreen("playing")`, which sets the screen
 * and nothing else; then the clears, which take away the full wave the reset
 * laid; then the two switches.
 */
export async function isolate(
  h: Harness,
  seed?: number,
): Promise<KesslerSnapshot> {
  await (seed === undefined ? h.debug.reset() : h.debug.reset(seed));
  await h.debug.setScreen("playing");
  await h.debug.clearTargets();
  await h.debug.clearBalls();
  await h.debug.clearPods();
  await h.debug.setWaveAdvance(false);
  await h.debug.setPodSpawn(false);
  return h.snapshot();
}

/**
 * Start a session the way a player does: reset to the title, and press the
 * `confirm` key on the highlighted START entry. For the checks that are ABOUT
 * the real route into play; everything else enters through
 * `poseScene(h, "playing")` and never touches a menu, so a build with a broken
 * title and a working tick fails the navigation points and passes the rest.
 *
 * `Enter` rather than `Space`, deliberately: both are bound to `confirm`, and
 * `Space` also carries `launch` — a check that is about WHICH key confirms
 * presses its own.
 */
export async function startPlay(
  h: Harness,
  seed?: number,
): Promise<KesslerSnapshot> {
  await (seed === undefined ? h.debug.reset() : h.debug.reset(seed));
  await tap(h, "Enter");
  return h.snapshot();
}

/**
 * Set the screen to `screen` and read what stands, without arranging anything
 * else — `setScreen` sets the screen and nothing else, so this is the direct
 * route to a screen for a check that is about the screen rather than about a
 * scene under it.
 *
 * A check that wants the screen arranged the way the real transition into it
 * arranges it calls the sequence that arranges it: {@link startFreshSession}
 * for a session begun the way confirming START begins one, and
 * {@link poseInterstitial} for the interstitial the clearing event enters.
 */
export async function poseScene(
  h: Harness,
  screen: Screen,
): Promise<KesslerSnapshot> {
  await h.debug.setScreen(screen);
  return h.snapshot();
}

/**
 * Run `n` whole simulation ticks and read what they left — the drive every
 * scenario advances by, so an outcome is always the game's own tick's work.
 */
export async function advanceTicks(
  h: Harness,
  n: number,
): Promise<KesslerSnapshot> {
  return h.tick(n);
}

/**
 * Spawn one unparked ball posed polar-wise: at radius `r` and stage angle
 * `thetaDeg`, moving at `speed` headed `offDeg` degrees from the outward radial
 * (positive toward `+theta`; `offDeg` `180` is straight inward). Sugar over
 * `spawnBall`'s cartesian figures for a game whose every rule is polar.
 */
export async function spawnBallPolar(
  h: Harness,
  r: number,
  thetaDeg: number,
  speed: number,
  offDeg = 0,
): Promise<void> {
  const at = pointAt(r, thetaDeg);
  const v = outwardVelocity(speed, thetaDeg, offDeg);
  await h.debug.spawnBall(at.x, at.y, v.vx, v.vy);
}

/**
 * Spawn one pod of `kind` posed polar-wise, at radius `r` and stage angle
 * `thetaDeg`. It falls radially inward at the fixed fall speed from the call
 * onward, exactly as a drawn pod does, and the generator is not consumed.
 */
export async function spawnPodPolar(
  h: Harness,
  kind: Parameters<KesslerDebugApi["spawnPod"]>[0],
  r: number,
  thetaDeg: number,
): Promise<void> {
  const at = pointAt(r, thetaDeg);
  await h.debug.spawnPod(kind, at.x, at.y);
}

/**
 * Start a fresh session the way confirming START starts one, out of atomic
 * poses: the reset lays wave 1 — score `0`, `3` lives, wave `1`, every slot
 * filled, every ring angle at `0`, the wave-1 figures in force, the deflector
 * at angle `90` with its baseline span — `setScreen("playing")` puts the game
 * on the live field, and `parkBall` puts the serve on the deflector.
 *
 * `setScreen` is atomic by specification, so the arrangement is this sequence
 * rather than the call: the guide puts every compound sequence in the harness,
 * and this is the one every check that needs a session in play shares. `seed`
 * seeds the pod generator.
 */
export async function startFreshSession(
  h: Harness,
  seed?: number,
): Promise<KesslerSnapshot> {
  await (seed === undefined ? h.debug.reset() : h.debug.reset(seed));
  await h.debug.setScreen("playing");
  await h.debug.parkBall();
  return h.snapshot();
}

/**
 * Enter the interstitial the way the clearing event enters it, out of atomic
 * poses: every ball, every pod, every timed effect and the shield are removed,
 * the interstitial timer is set to the `180` ticks `specs/screens.md` fixes,
 * and the screen becomes `waveclear`.
 *
 * The wave the interstitial is running out belongs to the caller: it poses
 * `setWave` and the ring state it wants before calling this, exactly as it
 * poses any other part of the world.
 */
export async function poseInterstitial(
  h: Harness,
  ticks: number = WAVECLEAR_TICKS,
): Promise<KesslerSnapshot> {
  await h.debug.clearBalls();
  await h.debug.clearPods();
  for (const kind of ["widen", "narrow", "pierce"] as const) {
    await h.debug.setEffectTicks(kind, 0);
  }
  await h.debug.setShield(false);
  await h.debug.setInterstitialTicks(ticks);
  await h.debug.setScreen("waveclear");
  return h.snapshot();
}

/**
 * Stand on the menu-bearing screen `screen` with entry `index` highlighted,
 * through the two poses that say exactly that and nothing else.
 *
 * The route for every check whose requirement is what `confirm` does to an
 * entry rather than how the highlight got there: walking to the entry with the
 * `down` key would fail the check on a build whose only fault is its `down`
 * key, which is a defect `controls/arrow-down-moves-highlight` already decides.
 */
export async function poseMenu(
  h: Harness,
  screen: Screen,
  index: number,
): Promise<KesslerSnapshot> {
  await h.debug.setScreen(screen);
  await h.debug.setMenuIndex(index);
  return h.snapshot();
}

/**
 * The hit region the build reports for menu entry `index` on the screen it is
 * standing on, or `null` where there is no such entry.
 *
 * The layout is the build's — `specs/screens.md` fixes no position for a menu —
 * so a check that drives the pointer at an entry asks the build where it drew
 * it, exactly as `specs/instrumentation.md` has it report.
 */
export async function menuRect(
  h: Harness,
  index: number,
): Promise<MenuItemRect | null> {
  return h.debug.menuItemRect(index);
}

/** The middle of a reported hit region, which is where a press aims. */
export function rectCenter(rect: MenuItemRect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/* -------------------------------------------------------------------------- */
/* The pointer and the finger                                                 */
/* -------------------------------------------------------------------------- */
//
// `specs/controls.md` puts the pointer in the runtime layer the build wrote, so
// the surface carries no operation for it and a check drives Chromium's own
// mouse and Chromium's own touch contact instead — which is the only way a
// build's pointer handling is exercised at all.
//
// EACH PART OF A GESTURE RUNS ITS OWN FRAME. A build is free to read the
// pointer once per frame, so a press that ran no frame would never reach it and
// a press released before a frame ran would be invisible to a build that
// compares held state between frames. So each of the parts below lets the
// build's own loop run a frame, and a caller can add them up.

/** Move the real mouse onto the logical stage point `(x, y)`, and let it land. */
export async function pointerTo(
  h: Harness,
  x: number,
  y: number,
): Promise<void> {
  const at = h.css(x, y);
  await h.page.mouse.move(at.x, at.y);
  await h.settleFrame();
}

/** Press the real mouse's primary button where it stands, and let it land. */
export async function pointerDown(h: Harness): Promise<void> {
  await h.page.mouse.down();
  await h.settleFrame();
}

/** Release the real mouse's primary button, and let the release land. */
export async function pointerUp(h: Harness): Promise<void> {
  await h.page.mouse.up();
  await h.settleFrame();
}

/**
 * Land a real touch contact on the logical stage point `(x, y)`, and let it
 * land. The harness must have been opened with `touch: true`.
 */
export async function touchDown(
  h: Harness,
  x: number,
  y: number,
): Promise<void> {
  await dispatchTouch(h, "touchStart", h.css(x, y));
  await h.settleFrame();
}

/** Lift the held contact, and let the lift land. */
export async function touchUp(h: Harness): Promise<void> {
  await dispatchTouch(h, "touchEnd", null);
  await h.settleFrame();
}

/** The contact identifier every touch gesture here drives: one finger. */
const CONTACT_ID = 1;

/**
 * The CDP session a page's contacts are driven through, opened once and HELD.
 *
 * Chromium tracks live contacts per CDP client, so a session opened for the
 * landing and detached again takes the contact with it and the lift that
 * follows is refused. The session therefore outlives the whole gesture, and the
 * page closing is what closes it.
 */
const touchSessions = new WeakMap<Page, Promise<CDPSession>>();

async function dispatchTouch(
  h: Harness,
  type: "touchStart" | "touchMove" | "touchEnd",
  point: { x: number; y: number } | null,
): Promise<void> {
  let session = touchSessions.get(h.page);
  if (session === undefined) {
    session = h.page.context().newCDPSession(h.page);
    touchSessions.set(h.page, session);
  }
  await (
    await session
  ).send("Input.dispatchTouchEvent", {
    type,
    touchPoints:
      point === null ? [] : [{ x: point.x, y: point.y, id: CONTACT_ID }],
  });
}
