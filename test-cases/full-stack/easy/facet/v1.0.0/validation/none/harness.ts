// Facet — the shared validator harness. CASE-PROVIDED.
//
// Every check in this suite is an ordinary vitest test that drives the built site
// IN A REAL BROWSER. There is nothing to import: an engineless run seeds no
// `src/` at all, so the build wrote its own frame loop, its own canvas fit, its
// own keyboard and pointer, its own audio, and its own `window.__facet` — and the
// only place all of that exists is a page that has loaded the bundle. So the
// project serves `dist/`, loads it in Chromium, and reaches the game the way
// anything reaches it: over the surface the specification told the build to
// install.
//
// WHAT A CHECK READS. The game's own state (through `snapshot`), the board it
// reports written back into `specs/board.md`'s notation, the frames the harness
// itself drove, the operations the build issued against its 2D context, the
// pixels those operations left on the canvas, and the sounds the build emitted.
// Nothing here fabricates an outcome: the scenario helpers below only POSE a
// world through the surface, and the real update the build wrote is what runs
// from there.
//
// THE CLOCK IS THE SURFACE'S. Nothing outside an engineless build owns its loop,
// so `specs/instrumentation.md` puts the clock on the surface: `setAutoStep(false)`
// takes the game off real time and `advance(seconds, frames)` runs whole frames
// of a chosen length. Every harness opens by taking the game off the clock, so a
// check asks for a number of frames and gets exactly that number — no polling, no
// waiting, and no measurement of the machine it ran on. The one check that is
// ABOUT the loop running itself hands it back with `runFor`.
//
// POSES DO NOT ADVANCE. Every helper below that only poses returns the state the
// pose left, with no frame run: `specs/instrumentation.md` says a pointer edge and
// a requested swap take effect at the call, and Facet plays in one level, so
// nothing here is a transition that needs a frame to land. Beside the three
// members that ARE the clock — `advance`, `advanceSeconds` and `until` — and the
// two that hand it over for real time — `runFor` and `warmAudio` — exactly seven
// helpers run a frame of their own: `swapAndStep`, `advanceStep`,
// `resolveChain`, `swapAndResolve`, `frameCalls`, `frameText` and `tap` (with
// `tapAction`, which is one `tap`). Everything else leaves the clock where it
// found it, and that is what keeps `simTime`, `stepTimer` and the refusal timer
// readable exactly as the specification states them. A whole pointer GESTURE is
// among the things that leave it: a press, the moves that carry it and the
// release each take effect at the call, so a move is posed without the game
// advancing at all.
//
// THE POINTER VERBS ARM AND RETURN. `press`, `moveTo` and `lift` deliver a real
// browser event and run no frame: the frame that reads it is the caller's next
// `advance`. So a check that presses and then reads takes a frame between the
// two, and a drag is a press, some moves, and one frame.
//
// EVERYTHING CROSSING INTO THE PAGE IS ASYNC. That is the whole of the difference
// between a suite here and its counterpart under an engine: `await h.snapshot()`
// rather than `h.snapshot()`, `await h.debug.loadBoard(rows)` rather than
// `h.debug.loadBoard(rows)`. The scenarios, the fixtures, the figures and the
// assertions are the same ones, because they are the case's rather than the
// runtime's.
//
// ONE SERVER, ONE BROWSER, ONE PAGE PER HARNESS. `globalSetup.ts` starts the
// server and the browser once for the whole project; this module connects to them
// from inside each suite's worker and opens a page per harness, so every check
// drives a build that has just started and no check can be affected by what the
// one before it pressed, opened or muted.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { expect, inject } from "vitest";
import type { Browser, BrowserContext, Page } from "playwright";
import { connectChromium } from "./chromium";
import { fail } from "./assert";
import {
  type ActionName,
  BINDINGS,
  DEFAULT_SEED,
  HANDLE,
  MAX_CHAIN_STEPS,
  MAX_REPLAY_FRAMES,
  PATCH_HALF,
  STAGE_H,
  STAGE_W,
  SWAP_DRIVE_FRAMES,
  TICK_HZ,
  TICK_MS,
  TICK_S,
  UNBOUND_KEY,
  type PointerDevice,
} from "./constants";
import {
  cellCenter,
  parseRows,
  renderBoard,
  targetCenter,
  type BoardRows,
  type CellRef,
  type PlacedToken,
  type TargetRect,
  quietRowsWith,
  quietRowsWithEscape,
} from "./board";
import {
  REQUIRED_OPS,
  type FacetSnapshot,
  type FacetWindowApi,
  type Screen,
} from "./surface";

export { TICK_HZ, TICK_MS, MAX_REPLAY_FRAMES } from "./constants";
export { REQUIRED_OPS } from "./surface";
export type {
  BoardSnapshot,
  CellSnapshot,
  FacetSnapshot,
  FacetWindowApi,
  Phase,
  Screen,
} from "./surface";

declare module "vitest" {
  export interface ProvidedContext {
    /** Where the built site is served, from `globalSetup.ts`. */
    facetUrl: string;
    /** The one Chromium every suite worker connects to. */
    facetBrowserWs: string;
  }
}

/* -------------------------------------------------------------------------- */
/* The step schedule                                                          */
/* -------------------------------------------------------------------------- */
//
// The suite chooses the size of a frame, because the specification deliberately
// fixes none: every duration in this game is counted against the elapsed time of
// the frame, so a build must reach the same place however that time was divided.
// The default is a steady 64 Hz, chosen in `constants.ts` because sixteen of its
// frames sum to EXACTLY `STEP_SECONDS` in binary. The check that is ABOUT the
// step size drives the same scenario under the other two schedules here.

/**
 * A source of frame deltas, in milliseconds.
 *
 * Under the two engines this and the three clocks below are RE-EXPORTED from the
 * engine package, so a suite imports its clocks from `./harness` whichever engine
 * ran and the three read the same. There is no engine here to re-export from, so
 * this project owns them — same names, same behavior, same seeded jitter
 * constants — and turns each delta into its own `__facet.advance(dt, 1)`.
 */
export interface Clock {
  /** The next frame's delta, in ms. */
  delta(nowMs?: number): number;
}

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
 * A hash of the seed and the frame index, avalanched so that neighboring
 * indices — which is all a frame counter ever produces — do not yield
 * neighboring outputs. The constants and the order are the engine's
 * (`packages/simple-2d/src/clocks.ts`), so a seed means the same thing under all
 * three engines' harnesses.
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

/* -------------------------------------------------------------------------- */
/* What a check reads                                                         */
/* -------------------------------------------------------------------------- */

/** Where a `fillText`/`strokeText` put its run, and how wide it measured. */
export interface TextGeometry {
  transform: {
    a: number;
    b: number;
    c: number;
    d: number;
    e: number;
    f: number;
  };
  width: number;
  textAlign: string;
}

/**
 * One recorded operation on the 2D context, in the order the render made it.
 *
 * `text` is carried only on a `fillText` or a `strokeText`, and only where the
 * recorder could measure the run — so a check that wants geometry rather than
 * copy guards on it before reading it.
 */
export type DrawCall =
  | { kind: "call"; method: string; args: unknown[]; text?: TextGeometry }
  | { kind: "set"; property: string; value: unknown };

/**
 * A sound the build emitted, and the frame of the drive it emitted it on.
 *
 * ONE TYPE IN ALL THREE PROJECTS, so a cue script reads the same whichever engine
 * ran it. Two of its fields carry a documented ABSENCE under this engine rather
 * than a different shape:
 *
 * - `cue` is `null`. `specs/ui.md` fixes the nine cue names inside the BUILD's
 *   own code and says nothing about how a build makes a sound, so an engineless
 *   build announces no name to anything outside it. NO `none` CHECK MAY ASSERT A
 *   CUE NAME.
 * - `gain` is `NaN`, for the same reason and with the same rule: the level a
 *   sound went out at belongs to a mixer the build wrote, and there is no bus to
 *   ask. A comparison against it fails rather than quietly reading a placeholder
 *   as evidence.
 *
 * What IS observable here is that a sound went out and which frame produced it,
 * which is what every `none` audio check reads.
 */
export interface TimedCue {
  /** The cue's name under the two engines; `null` under this one. */
  cue: string | null;
  /** The drive's simulated time at that frame, in milliseconds. */
  t: number;
  /** The bus gain under the two engines; `NaN` under this one. */
  gain: number;
  /** The frame it sounded on, 1-based, as {@link Harness.frame} reports. */
  frame: number;
  /** Whether the source that started was a looping one. */
  loop: boolean;
}

/** One asset the build asked for and did not get. */
export interface AssetFailure {
  path: string;
  reason: string;
}

/** A color read off the canvas. */
export type Rgb = { r: number; g: number; b: number };

/** A device pixel, as the canvas holds it. */
export type Rgba = [number, number, number, number];

/** A square of device pixels read off the canvas, centered on a cell. */
export interface Patch {
  /** The half-size the box was read at, in logical units. */
  half: number;
  width: number;
  height: number;
  /** RGBA, four bytes per pixel, row-major. */
  data: Uint8ClampedArray;
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
  /** The clock each frame takes its delta from. Defaults to 64 Hz. */
  clock?: Clock;
  /** The window's CSS width. Defaults to the logical stage width. */
  cssWidth?: number;
  /** The window's CSS height. Defaults to the logical stage height. */
  cssHeight?: number;
  /** Device pixels per CSS pixel. Defaults to 1, so one device pixel is one unit. */
  dpr?: number;
  /** The seed the opening `reset` carries. Defaults to `DEFAULT_SEED`. */
  seed?: number;
  /**
   * Whether the build's produced assets are served at all. Defaults to `true`.
   *
   * `false` answers every request for a PRODUCED file with a 404 — the sprites,
   * the particle systems and the `.wav`s `specs/assets.md` commits under
   * `public/assets/{gems,fx,audio}/`. It is how a check poses a build whose art
   * and audio never arrive, and it is the same option under all three engines;
   * only the mechanism differs, since under this one the assets travel over HTTP.
   * The build's own bundle is not an asset in this sense and still loads, so what
   * is posed is a game with nothing to draw with rather than a page with nothing
   * to run.
   */
  assets?: boolean;
  /**
   * The sub-path the built site is served from. Defaults to `"/"`.
   *
   * `specs/assets.md` says the site "is not guaranteed to be served from the root
   * of its origin; it is played back mounted under a per-run sub-path", and that a
   * root-absolute URL "resolves against the origin root and 404s under a
   * sub-path". So a non-root value here does BOTH halves of that sentence: the
   * page is opened under the sub-path, and everything the build then asks for
   * outside it is answered 404 exactly as a real sub-path mount would answer it.
   */
  basePath?: string;
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
  snapshot: FacetSnapshot;
}

/** What a chain drive found: whether it ended, and where. */
export interface SettleResult {
  /** Whether `phase` returned to `idle` inside the cap. */
  settled: boolean;
  /** Chain steps driven. */
  steps: number;
  /** Frames driven. */
  frames: number;
  snapshot: FacetSnapshot;
}

/**
 * The surface as this harness exposes it: every operation of the build's own
 * surface, awaited.
 *
 * `version` is a value rather than an operation and is read through
 * {@link Harness.probe} instead, so it is filtered out here.
 */
export type AsyncSurface<T> = {
  [K in keyof T as T[K] extends (...args: never[]) => unknown
    ? K
    : never]: T[K] extends (...args: infer A) => infer R
    ? (...args: A) => Promise<R>
    : never;
};

export interface Harness {
  /**
   * The Playwright page the build is running in.
   *
   * THIS ENGINE ONLY, and necessarily so: under the two engines the build is a
   * library in this same process and there is no page at all, so a check that
   * needs the browser itself — a real gesture, a route, a screenshot — has
   * nowhere else to reach.
   */
  readonly page: Page;
  /**
   * The surface the BUILD installed, as operations that cross into the page.
   *
   * Read off `window.__facet` and never constructed here — see
   * {@link readDebugSurface}.
   */
  readonly debug: AsyncSurface<FacetWindowApi>;
  /**
   * Why the build's surface cannot be driven, or `null` when it can.
   *
   * A fault here is the build's: the surface is missing, or it is missing an
   * operation the specification requires. Every operation then fails by assertion
   * with {@link failSurface} rather than throwing, so the fault lands on the
   * points whose checks reach the game through the surface and not on a
   * `beforeEach` that would report nothing about the build.
   */
  readonly surfaceFault: string | null;
  /** Everything the page logged to `console.error`, or threw, oldest first. */
  readonly pageErrors: string[];
  /** Every request that failed or answered outside 2xx, as `<status> <url>`. */
  readonly failedRequests: string[];
  /**
   * EVERY request the page made, in order — not only the ones that failed.
   *
   * What a check about where a build loads from reads: that nothing was fetched
   * off this origin, that a produced file was asked for at all, and that an asset
   * was named page-relative rather than from the origin root.
   */
  readonly requests: string[];
  /**
   * Every asset the build asked for and did not get, oldest first.
   *
   * Derived from {@link Harness.failedRequests}, narrowed to the produced tree
   * `specs/assets.md` commits the art, the particle systems and the `.wav`s to,
   * so the name means the same thing here as the engines' own `asset:failed`
   * event does there.
   */
  readonly assetFailures: AssetFailure[];
  /** Every call and property set the render made, oldest first. */
  readonly calls: DrawCall[];
  /** Every ONE-SHOT sound the build emitted, oldest first. */
  readonly cues: TimedCue[];
  /** Every LOOPING start: the two music beds of `specs/ui.md`, oldest first. */
  readonly loops: TimedCue[];

  /** The frames this harness has driven, 1-based, as a recorded frame counts them. */
  frame(): number;
  /** The simulated time those frames covered, in milliseconds. */
  timeMs(): number;

  /** A fresh read of the game's state through the build's `snapshot`. */
  snapshot(): Promise<FacetSnapshot>;
  /** The board the snapshot reports, written back into the notation. */
  board(): Promise<string[]>;
  /** Run `frames` frames back to back, each the length the clock says. */
  advance(frames: number): Promise<void>;
  /**
   * Run `seconds` of game time as `frames` equal deltas, in ONE `advance` call.
   *
   * The only way to pose `advance(1, 1)` and `advance(1, 60)` against each other,
   * which is what `specs/instrumentation.md` requires reach the same state.
   *
   * `frames` is ASSERTED to be at least 1 and a whole number. A count of zero or
   * a fraction is a mistake in the fixture, and it fails as one rather than being
   * quietly repaired into a drive the check did not ask for.
   */
  advanceSeconds(seconds: number, frames?: number): Promise<void>;
  /** Advance until `predicate` holds, sampling every `poll` frames. */
  until(
    predicate: (snapshot: FacetSnapshot) => boolean,
    options?: UntilOptions,
  ): Promise<UntilResult>;
  /** Hand the game back to its own frame loop for `ms` of real time, then take it back. */
  runFor(ms: number): Promise<void>;

  /**
   * Press a key and leave it down, as a player holding it would.
   *
   * A KEYBOARD verb. `code` is a `KeyboardEvent.code`, and the pointer's own
   * press is {@link Harness.press}.
   */
  hold(code: string): Promise<void>;
  /**
   * Release a key held by {@link Harness.hold}.
   *
   * A KEYBOARD verb, named apart from the pointer's {@link Harness.lift}.
   */
  release(code: string): Promise<void>;
  /**
   * One press of a key, delivered: down, ONE frame, up.
   *
   * A KEYBOARD verb. The frame goes BETWEEN the two halves here, and under the
   * two engines it goes after both — the difference is deliberate rather than
   * accidental. An engineless build wrote its own keyboard layer, and the two
   * conformant ways to read a press (latching the edge in the event handler, or
   * comparing held state at the top of each frame) agree only if the key is
   * genuinely held while a frame runs. An engine instead arms an edge that
   * survives to the next frame and drops one nothing consumed, so there the frame
   * comes last. Same meaning: one press, delivered.
   */
  tap(code: string): Promise<void>;
  /**
   * Fire one registered ACTION through the real input path — the level a review
   * item is actually written at ("fire the `up` action").
   *
   * It taps the action's FIRST binding in `BINDINGS`. `specs/controls.md` fixes
   * that whole table for a build of every engine, so all six actions can be
   * pressed here whatever the build was stood up on, and the alternate key
   * listed beside an action is there for a check that wants to prove the second
   * key fires it as well.
   */
  tapAction(action: ActionName): Promise<void>;

  /**
   * Press a REAL browser mouse at a logical stage point.
   *
   * The surface's `pointerDown` is the way to pose a press for a check about what
   * a press DOES: `specs/instrumentation.md` fixes it as feeding the same input
   * path a real pointer feeds, and it takes effect at the call, so a scenario
   * needs no frame and depends on nothing the build wired up in the DOM.
   *
   * This is the other path, and it exists because one class of check needs it.
   * `specs/ui.md` requires a cue on the frame its event happens and adds that a
   * cue is played by a FRAME rather than by a pose of the debug surface — so a
   * build is entitled to raise no cue at all for a posed press, and a cue check
   * that posed one would be reading that entitlement rather than the build's
   * audio. A real press is delivered by the browser, reaches the build's own
   * listeners, and is read by the frame that follows, which is exactly the
   * sequence the specification describes.
   *
   * The point is in logical stage units and is mapped through
   * {@link Harness.client} here, so a caller hands it the same
   * `cellCenter(col, row)` the surface poses take. It arms the press and returns:
   * the frame that delivers it is the caller's next {@link Harness.advance}.
   */
  press(x: number, y: number): Promise<void>;
  /**
   * Move the real pointer to a logical stage point; while it is held down that is
   * a DRAG.
   *
   * Like {@link Harness.press}, it arms the movement and returns — the frame that
   * delivers it is the caller's next {@link Harness.advance}.
   */
  moveTo(x: number, y: number): Promise<void>;
  /**
   * Lift the real pointer at its last position, ending the drag.
   *
   * Named apart from the keyboard's {@link Harness.release} on purpose: one is a
   * key going up, the other a pointer.
   */
  lift(): Promise<void>;
  /**
   * Where a logical stage point sits in the CLIENT/CSS coordinates a pointer
   * event carries — the inverse of the mapping a runtime applies to an incoming
   * event.
   *
   * The one conversion {@link Harness.press} and {@link Harness.moveTo} go
   * through, and what keeps them correct at a `dpr` other than 1.
   */
  client(x: number, y: number): { x: number; y: number };

  /** Run exactly one frame and hand back every operation its render issued. */
  frameCalls(): Promise<DrawCall[]>;
  /**
   * Run one frame and hand back every string that frame put on screen.
   *
   * The union of the frame's canvas text and the page's own DOM text, because
   * `specs/assets.md` says the chrome is "drawn in code (canvas or DOM)" and an
   * engineless build is entitled to either. The canvas strings come first, in the
   * order the frame drew them, and the DOM strings after.
   *
   * The pieces are as the build drew them, which is not always a word: a build
   * that letter-spaces a title issues one `fillText` per GLYPH, and the array then
   * holds `"F", "A", "C", "E", "T"`. So a check asks {@link showsText} whether the
   * copy is on screen rather than looking for it in the array itself.
   */
  frameText(): Promise<string[]>;
  /**
   * Reflect the surface WITHOUT invoking it: the `typeof` of each name.
   *
   * A `typeof` and nothing more, so the version's VALUE is not reported here.
   * `specs/instrumentation.md` puts that value in two places, and each has its
   * own reader: the surface's own member is {@link Harness.debugVersion} and
   * the snapshot's is `(await h.snapshot()).version`. Both spellings are the
   * same under all three engines.
   */
  probe(names: readonly string[]): Promise<Record<string, string>>;
  /**
   * The `version` the surface itself carries, as a VALUE.
   *
   * `specs/instrumentation.md` puts the version in two places — on the surface
   * ("carries `version` … a plain number") and in the snapshot — so
   * `instrumentation/debug-api` reads both, and this is the surface half. One
   * spelling under all three engines: {@link Harness.probe} reports only the
   * `typeof` of a name, and the surface's own members are not otherwise
   * reachable as values under every engine.
   */
  debugVersion(): Promise<number>;

  /** How the stage is mapped onto this harness's canvas. */
  viewport(): Viewport;
  /** Where a logical point lands in the canvas's backing store. */
  device(x: number, y: number): { x: number; y: number };
  /** The device pixel under a logical point. */
  pixel(x: number, y: number): Promise<Rgba>;
  /**
   * Many logical points at once, in ONE crossing into the page.
   *
   * THIS ENGINE ONLY, and it exists for the process boundary rather than for the
   * measurement: sampling a point costs a round trip here and costs nothing under
   * the engines, where the pixels are in this process and `pixel` is already
   * cheap. Adding it there would be vocabulary with nothing behind it.
   */
  pixels(points: readonly { x: number; y: number }[]): Promise<Rgba[]>;
  /** The square of pixels a cell's gem is drawn in. */
  patch(col: number, row: number, half?: number): Promise<Patch>;
  /**
   * The canvas's backing store size AS THE BUILD SIZED IT, and the page's density.
   *
   * THIS ENGINE ONLY. Here the build owns its runtime and sizing its canvas is
   * its own work, so it is a thing to read and a fit check can hold it to
   * `specs/overview.md`. Under the two engines the harness hands the engine a
   * `SurfaceMetrics` and the answer would be the harness's own input, which
   * decides nothing about the build.
   */
  surface(): Promise<{ width: number; height: number; dpr: number }>;

  /** Give the build a real, browser-trusted gesture, so its audio can open. */
  armAudio(): Promise<void>;
  /**
   * Open the build's audio and wait until it has actually made a sound.
   *
   * `specs/assets.md` has the build DECODE its produced `.wav`s with the Web Audio
   * API, which is asynchronous, and `specs/ui.md` has audio start only after the
   * player has interacted with the page. So a build is conformant when its first
   * frames are silent while the files decode, and a cue check that observed the
   * very first event would be reading the decoder rather than the build. This
   * gives the gesture and then waits, in real time, until a sound has gone out —
   * which under `specs/ui.md` it must, since one of the two music beds plays on
   * every screen.
   *
   * Answers whether anything was ever heard, so a check can say "the build made no
   * sound at all" rather than hanging. It DRIVES FRAMES, so call it while
   * arranging and take {@link Harness.frame} readings after.
   */
  warmAudio(): Promise<boolean>;
  /**
   * Let `ms` of REAL time pass while the game stands still.
   *
   * The game is off the wall clock, so nothing here advances it. What this is for
   * is the work a build does off the frame loop: decoding a sound, resolving a
   * fetch, decoding an image. Never use it to wait for something the simulation
   * does — that is what {@link Harness.advance} is for.
   */
  settle(ms: number): Promise<void>;

  /** Release the page. The context, and the browser, stay. */
  dispose(): Promise<void>;
}

/* -------------------------------------------------------------------------- */
/* The page                                                                   */
/* -------------------------------------------------------------------------- */

/** The init scripts injected before any of the build's own script runs. */
const INIT_SCRIPTS = ["recorder-init.js", "audio-init.js"] as const;

/* -------------------------------------------------------------------------- */
/* The build's own tree, and the addresses derived from it                    */
/* -------------------------------------------------------------------------- */
//
// Every root here derives from this module's own URL rather than from the working
// directory, so the same files work in both layouts this project lives in: the
// case's own `validation/none/`, and the `validation/` the runner stages it to
// inside the build's tree.

/** This module's directory: the validator project's root. */
export const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

/** The workspace the build was produced in: the directory above this project. */
export const WORKSPACE_ROOT = resolve(PROJECT_ROOT, "..");

/**
 * The built site, or the committed `public/` tree when nothing has been built:
 * where a check about a PRODUCED FILE looks for it on disk.
 *
 * `specs/assets.md` commits every produced file under `public/assets/` and has
 * Vite copy that directory into the build output unchanged, so both layouts name
 * the same asset by the same path below the root.
 */
export function siteRoot(): string | null {
  for (const candidate of ["dist", "build", "out", "public"]) {
    const path = join(WORKSPACE_ROOT, candidate);
    if (existsSync(path)) return path;
  }
  return null;
}

/**
 * The three served directories `specs/assets.md` commits the PRODUCED files to,
 * below the `assets/` root it names.
 *
 * "a file committed at `public/assets/gems/ruby.png` is served at
 * `assets/gems/ruby.png` beside the page", and the three sections below it land
 * the art under `assets/gems/`, the particle systems under `assets/fx/` and the
 * `.wav`s under `assets/audio/`.
 *
 * The pair is what tells a produced file apart, and BOTH halves are needed: Vite
 * emits the bundle into `assets/` too, so the `assets/` segment on its own would
 * count the build's own JavaScript as produced art — and a harness posing a build
 * whose sprites never arrived would be posing one whose code never arrived, which
 * is a different question and not one any point asks.
 */
const PRODUCED_DIRS = ["gems", "fx", "audio"] as const;

/** The path a URL asks for, or the URL itself when it is not one this page made. */
function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/** Whether a served path names one of the build's own produced files. */
function isAssetPath(path: string): boolean {
  const segments = path.split("/");
  return segments.some(
    (segment, index) =>
      segment === "assets" &&
      (PRODUCED_DIRS as readonly string[]).includes(segments[index + 1] ?? ""),
  );
}

/**
 * A sub-path as a mount point: leading and trailing slash, so it both prefixes a
 * request path and resolves as a directory the page sits in.
 */
function normalizeBasePath(basePath: string): string {
  const trimmed = basePath.replace(/^\/+|\/+$/gu, "");
  return trimmed === "" ? "/" : `/${trimmed}/`;
}

/**
 * How long the surface is waited for before the build is called non-conformant.
 *
 * Generous against a conformant build and cheap against one: the wait is a poll
 * that returns the instant the global appears, and a build installs it while its
 * entry module runs. What the ceiling really bounds is the cost of a build with no
 * surface at all, which pays it once per harness.
 */
const SURFACE_TIMEOUT_MS = 5_000;

/** Real milliseconds a warm-up waits between attempts, and how many it makes. */
const AUDIO_WARM_POLL_MS = 50;
const AUDIO_WARM_ATTEMPTS = 40;

let browserPromise: Promise<Browser> | null = null;

async function sharedBrowser(): Promise<Browser> {
  browserPromise ??= connectChromium(inject("facetBrowserWs"));
  return browserPromise;
}

/**
 * One browser context per WINDOW SHAPE, shared by every harness of that shape in
 * this file, and one PAGE per harness inside it.
 *
 * The split is what the init scripts force and what correctness wants. The
 * recorder and the audio probe are installed on the CONTEXT, so every page it
 * opens is instrumented before a line of the build's script runs, and a context is
 * also where the viewport and the device pixel ratio are fixed. Everything else
 * about a harness is the page: a fresh one opens on a build that has just started,
 * with no key held, no audio context opened and the mute preference back off,
 * which is a stronger guarantee than any reset the surface offers, since `reset()`
 * deliberately leaves muting alone.
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

/* -------------------------------------------------------------------------- */
/* The surface a build never installed                                        */
/* -------------------------------------------------------------------------- */

/**
 * A stand-in for a surface that is missing or incomplete: every operation on it
 * fails the check that reached for it, with the fault named.
 *
 * A proxy rather than a hand-written stub, so an operation outside
 * {@link REQUIRED_OPS} that some future variant adds fails the same way.
 *
 * Keys that belong to the MACHINERY rather than to a check are answered with
 * `undefined` instead: awaiting a value probes `then`, and vitest's own error
 * formatting probes symbols and `constructor`. Failing those would replace the
 * verdict below with noise from the machinery that was trying to report it.
 */
export function missingSurface(reason: string): AsyncSurface<FacetWindowApi> {
  return new Proxy({} as AsyncSurface<FacetWindowApi>, {
    get: (_target, property): unknown => {
      if (typeof property === "symbol") return undefined;
      if (property === "then" || property === "constructor") return undefined;
      return () => failSurface(reason);
    },
  });
}

/**
 * The surface the BUILD installed, as operations that cross into the page — or
 * the stand-in above when `fault` says there is nothing to drive.
 *
 * A READ, never a construction. The counterpart under the two engines reads
 * `engine.debug` and this one reads `window.__facet`, which is the whole of the
 * difference: what is returned is the build's own surface either way, and a
 * harness that assembled one would be grading a build against itself.
 */
export function readDebugSurface(
  page: Page,
  fault: string | null,
): AsyncSurface<FacetWindowApi> {
  if (fault !== null) return missingSurface(fault);
  return new Proxy({} as AsyncSurface<FacetWindowApi>, {
    get: (_target, property): unknown => {
      // `then` and `constructor` belong to the MACHINERY rather than to a check:
      // awaiting a value probes `then`, and vitest's own error formatting probes
      // symbols and `constructor`. Answering those with an operation would turn
      // an awaited call into a thenable and a reported failure into noise.
      if (typeof property === "symbol") return undefined;
      if (property === "then" || property === "constructor") return undefined;
      const name = String(property);
      return (...args: unknown[]) =>
        page.evaluate(
          ([handle, operation, rest]) =>
            (
              window as unknown as Record<
                string,
                Record<string, (...a: unknown[]) => unknown>
              >
            )[handle][operation](...rest),
          [HANDLE, name, args] as const,
        );
    },
  }) as AsyncSurface<FacetWindowApi>;
}

/**
 * What `specs/instrumentation.md` requires of the surface: the `Expected:` line of
 * the failure a build with no usable surface lands on every check that reaches for
 * it, beside the {@link Harness.surfaceFault} that says what was found.
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

/* -------------------------------------------------------------------------- */
/* Building one                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Load the built site in a browser, take the game off the wall clock, reset it on
 * a known seed, and hand back everything a check reads.
 *
 * The default shape is the stage's own size at one device pixel per CSS pixel, so
 * a logical coordinate and a canvas pixel are the same thing and only a check
 * about the fit itself has to think about the letterbox.
 */
export async function createHarness(
  options: HarnessOptions = {},
): Promise<Harness> {
  const cssWidth = options.cssWidth ?? STAGE_W;
  const cssHeight = options.cssHeight ?? STAGE_H;
  const dpr = options.dpr ?? 1;
  const clock = options.clock ?? new ConstantClock(TICK_MS);
  const seed = options.seed ?? DEFAULT_SEED;
  const serveAssets = options.assets ?? true;
  const basePath = normalizeBasePath(options.basePath ?? "/");
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

  // Every file the page asked for, and every file it asked for and did not get.
  // An asset item reads both: the whole log says WHERE a build loads from, and
  // the failures say which produced file never arrived — neither of which a
  // snapshot can show.
  const requests: string[] = [];
  const failedRequests: string[] = [];
  const assetFailures: AssetFailure[] = [];
  page.on("request", (request) => {
    requests.push(request.url());
  });
  const noteFailure = (url: string, reason: string): void => {
    failedRequests.push(`${reason} ${url}`);
    const path = pathOf(url);
    if (isAssetPath(path)) assetFailures.push({ path, reason });
  };
  page.on("requestfailed", (request) => {
    noteFailure(request.url(), "failed");
  });
  page.on("response", (response) => {
    const status = response.status();
    if (status < 200 || status >= 300) {
      noteFailure(response.url(), String(status));
    }
  });

  // What a sub-path mount and a stripped asset tree both are, on this engine: the
  // page asks over HTTP, so both are answered on the wire rather than in a loader.
  // A route is installed only when one of them is actually posed, so the ordinary
  // harness carries no interception at all.
  if (basePath !== "/" || !serveAssets) {
    await page.route("**/*", (route, request) => {
      const path = pathOf(request.url());
      // A root-absolute URL under a sub-path mount reaches the ORIGIN root, where
      // nothing of this build is published. `specs/assets.md` says exactly that
      // and calls it a 404, so that is what it gets.
      if (!path.startsWith(basePath)) {
        void route.fulfill({ status: 404, body: "not found" });
        return;
      }
      // A produced file alone. The bundle shares the `assets/` root and is not
      // what `assets: false` is about.
      if (!serveAssets && isAssetPath(path)) {
        void route.fulfill({ status: 404, body: "not found" });
        return;
      }
      void route.continue();
    });
  }

  // Never throws from here: a page that will not load is a fault to be reported
  // on the checks that reach through the surface, alongside every other way a
  // build can fail to stand up, rather than an exception out of a `beforeEach`.
  const url = new URL(basePath, inject("facetUrl")).href;
  let loadFault: string | null = null;
  try {
    await page.goto(url, { waitUntil: "load" });
  } catch (error) {
    loadFault = `the page at ${url} did not load: ${
      error instanceof Error ? error.message : String(error)
    }`;
  }

  const surfaceFault = loadFault ?? (await readSurfaceFault(page));
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

  const debug = readDebugSurface(page, surfaceFault);

  if (surfaceFault === null) {
    // Off the wall clock and back to a known title screen before a check touches
    // anything: from here the game changes only when this harness says so, and the
    // deal a `start` makes is the one this seed makes.
    await call("setAutoStep", [false]);
    await call("reset", [{ seed }]);
    // And a recorder over the surface before a check can arm one. A build is free
    // to ask for its 2D context on the frame it first draws rather than while it
    // initializes, so the surface can be installed and answering before any
    // context exists to record — and a `captureReplay` armed in that window arms
    // nothing and writes no evidence for a section that drew.
    await page
      .waitForFunction(
        () =>
          (
            window as unknown as { __facetRec: { ready(): boolean } }
          ).__facetRec.ready(),
        undefined,
        { timeout: SURFACE_TIMEOUT_MS },
      )
      .catch(() => undefined);
  }

  const view = fitViewport(cssWidth, cssHeight, dpr);
  const calls: DrawCall[] = [];
  const cueSinks: TimedCue[][] = [];
  const loopSinks: TimedCue[][] = [];
  // The harness's own standing log of everything it heard, registered like any
  // other watcher so `h.cues` and a sink from `watchCues` are the same mechanism.
  const cues: TimedCue[] = [];
  const loops: TimedCue[] = [];
  cueSinks.push(cues);
  loopSinks.push(loops);
  let frameCount = 0;
  let timeMs = 0;

  /** Stamp one sound onto the frame that made it, in every open sink. */
  const heard = (sinks: TimedCue[][], loop: boolean): void => {
    for (const sink of sinks) {
      // `cue` and `gain` are the two readings an engineless build publishes to
      // nothing; see {@link TimedCue} for why they are absences rather than
      // guesses, and why no check here may assert either.
      sink.push({
        cue: null,
        t: timeMs,
        gain: Number.NaN,
        frame: frameCount,
        loop,
      });
    }
  };

  /**
   * Run `frames` frames and read the state they left, in one crossing.
   *
   * Each frame is opened and closed around a single `advance(dt, 1)`, all inside
   * one synchronous evaluation, so nothing the page's own animation frame renders
   * can land inside a recorded frame — and so a frame the recorder keeps is
   * exactly one frame the game ran. The audio counters are read on both sides of
   * each frame, so a sound is attributed to the frame that made it.
   */
  const drive = async (frames: number): Promise<FacetSnapshot> => {
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
            __facetRec: Record<string, (...a: unknown[]) => unknown>;
          }
        ).__facetRec;
        const audio = (
          window as unknown as {
            __facetAudio: { oneShots(): number; loops(): number };
          }
        ).__facetAudio;
        const oneShots: number[] = [];
        const loops: number[] = [];
        const ops: unknown[][] = [];
        for (const dt of dts) {
          const shotsBefore = audio.oneShots();
          const loopsBefore = audio.loops();
          rec.begin();
          api.advance(dt / 1000, 1);
          rec.end(dt);
          oneShots.push(audio.oneShots() - shotsBefore);
          loops.push(audio.loops() - loopsBefore);
          ops.push(rec.last() as unknown[]);
        }
        return { snapshot: api.snapshot(), oneShots, loops, ops };
      },
      [HANDLE, deltas] as const,
    )) as {
      snapshot: FacetSnapshot;
      oneShots: number[];
      loops: number[];
      ops: RecordedOp[][];
    };

    for (const [index, delta] of deltas.entries()) {
      frameCount += 1;
      timeMs += delta;
      for (const op of result.ops[index]) calls.push(toDrawCall(op));
      for (let n = 0; n < result.oneShots[index]; n += 1)
        heard(cueSinks, false);
      for (let n = 0; n < result.loops[index]; n += 1) heard(loopSinks, true);
    }
    return result.snapshot;
  };

  const readPixels = async (
    devicePoints: readonly { x: number; y: number }[],
  ): Promise<Rgba[]> =>
    page.evaluate(
      (points) => {
        const canvases = Array.from(document.querySelectorAll("canvas"));
        if (canvases.length === 0)
          throw new Error("facet: the page has no <canvas>");
        let canvas = canvases[0];
        for (const other of canvases) {
          if (other.width * other.height > canvas.width * canvas.height) {
            canvas = other;
          }
        }
        const ctx = canvas.getContext("2d");
        if (ctx === null)
          throw new Error("facet: the canvas has no 2D context");
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
          return [data[0], data[1], data[2], data[3]] as Rgba;
        });
      },
      devicePoints as { x: number; y: number }[],
    );

  const harness: Harness = {
    page,
    debug,
    surfaceFault,
    pageErrors,
    failedRequests,
    requests,
    assetFailures,
    calls,
    cues,
    loops,

    frame: () => frameCount,
    timeMs: () => timeMs,

    snapshot: () => debug.snapshot(),
    board: async () => renderBoard(await debug.snapshot()),

    advance: async (frames) => {
      await drive(frames);
    },

    async advanceSeconds(span, frames = 1) {
      if (surfaceFault !== null) refuse();
      // A fixture error fails as one, the way `loadBoard` already refuses a
      // malformed row: a count below one, or a fractional count, is a mistake in
      // the check, and repairing it silently would run a drive nobody asked for.
      if (!Number.isInteger(frames) || frames < 1) {
        fail(
          "advanceSeconds to be given a whole number of frames, at least 1",
          frames,
        );
      }
      // ONE call, so the build divides the interval rather than the harness. The
      // recorder brackets the whole of it as a single kept frame, which is the
      // honest reading: the harness cannot see where the build put its own frame
      // boundaries inside an `advance` it did not drive.
      const ms = span * 1000;
      const sounds = (await page.evaluate(
        ([handle, secs, count, deltaMs]) => {
          const api = (
            window as unknown as Record<
              string,
              Record<string, (...a: unknown[]) => unknown>
            >
          )[handle];
          const rec = (
            window as unknown as {
              __facetRec: Record<string, (...a: unknown[]) => unknown>;
            }
          ).__facetRec;
          const audio = (
            window as unknown as {
              __facetAudio: { oneShots(): number; loops(): number };
            }
          ).__facetAudio;
          const shotsBefore = audio.oneShots();
          const loopsBefore = audio.loops();
          rec.begin();
          api.advance(secs, count);
          rec.end(deltaMs);
          return {
            oneShots: audio.oneShots() - shotsBefore,
            loops: audio.loops() - loopsBefore,
            ops: rec.last(),
          };
        },
        [HANDLE, span, frames, ms] as const,
      )) as { oneShots: number; loops: number; ops: RecordedOp[] };
      frameCount += frames;
      timeMs += ms;
      for (const op of sounds.ops) calls.push(toDrawCall(op));
      for (let n = 0; n < sounds.oneShots; n += 1) heard(cueSinks, false);
      for (let n = 0; n < sounds.loops; n += 1) heard(loopSinks, true);
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
            window as unknown as { __facetRec: { setMode(m: string): void } }
          ).__facetRec.setMode("raf");
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
            window as unknown as { __facetRec: { setMode(m: string): void } }
          ).__facetRec.setMode("manual");
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
      // agree only if the key is genuinely held while a frame runs.
      await page.keyboard.down(code);
      await drive(1);
      await page.keyboard.up(code);
    },

    async tapAction(action) {
      await this.tap(BINDINGS[action][0]);
    },

    async press(x, y) {
      const point = toClient(view, dpr, x, y);
      await page.mouse.move(point.x, point.y);
      await page.mouse.down();
    },
    async moveTo(x, y) {
      const point = toClient(view, dpr, x, y);
      await page.mouse.move(point.x, point.y);
    },
    lift: () => page.mouse.up(),
    client: (x, y) => toClient(view, dpr, x, y),

    async frameCalls() {
      // Clear the log, run EXACTLY one frame, hand back what that frame drew.
      calls.length = 0;
      await drive(1);
      return [...calls];
    },

    async frameText() {
      const calls = await this.frameCalls();
      const dom = await page.evaluate(() => {
        const found: string[] = [];
        const skip = new Set([
          "SCRIPT",
          "STYLE",
          "NOSCRIPT",
          "TITLE",
          "TEMPLATE",
        ]);
        const walker = document.createTreeWalker(
          document.body,
          NodeFilter.SHOW_TEXT,
        );
        while (walker.nextNode()) {
          const parent = walker.currentNode.parentElement;
          if (parent !== null && skip.has(parent.tagName)) continue;
          const text = (walker.currentNode.nodeValue ?? "").trim();
          if (text !== "") found.push(text);
        }
        return found;
      });
      return [...drawnText(calls), ...dom];
    },

    probe: (names) =>
      page.evaluate(
        ([handle, wanted]) => {
          const target =
            (window as unknown as Record<string, Record<string, unknown>>)[
              handle
            ] ?? {};
          const found: Record<string, string> = {};
          for (const name of wanted) found[name] = typeof target[name];
          return found;
        },
        [HANDLE, [...names]] as const,
      ),

    // Read off the RAW surface in the page rather than through `harness.debug`,
    // whose proxy answers every name with an operation: a value is not an
    // operation, and there is nothing to call.
    debugVersion: () =>
      page.evaluate(
        (handle) =>
          (window as unknown as Record<string, { version: number }>)[handle]
            ?.version,
        HANDLE,
      ),

    viewport: () => ({ ...view }),
    device: (x, y) => toDevice(view, x, y),
    pixel: async (x, y) => (await readPixels([toDevice(view, x, y)]))[0],
    pixels: (points) => readPixels(points.map((p) => toDevice(view, p.x, p.y))),

    async patch(col, row, half = PATCH_HALF) {
      const center = cellCenter(col, row);
      const middle = toDevice(view, center.x, center.y);
      const reach = Math.max(1, Math.round(half * view.scale));
      const box = await page.evaluate(
        ([cx, cy, r]) => {
          const canvases = Array.from(document.querySelectorAll("canvas"));
          if (canvases.length === 0) {
            throw new Error("facet: the page has no <canvas>");
          }
          let canvas = canvases[0];
          for (const other of canvases) {
            if (other.width * other.height > canvas.width * canvas.height) {
              canvas = other;
            }
          }
          const ctx = canvas.getContext("2d");
          if (ctx === null)
            throw new Error("facet: the canvas has no 2D context");
          const size = r * 2 + 1;
          const x0 = Math.max(0, Math.min(canvas.width - size, cx - r));
          const y0 = Math.max(0, Math.min(canvas.height - size, cy - r));
          const image = ctx.getImageData(x0, y0, size, size);
          return {
            width: image.width,
            height: image.height,
            data: Array.from(image.data),
          };
        },
        [middle.x, middle.y, reach] as const,
      );
      return {
        half,
        width: box.width,
        height: box.height,
        data: Uint8ClampedArray.from(box.data),
      };
    },

    surface: () =>
      page.evaluate(() => {
        const canvases = Array.from(document.querySelectorAll("canvas"));
        if (canvases.length === 0) {
          throw new Error(
            "facet: the page has no <canvas>, so the build drew nowhere — " +
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

    async warmAudio() {
      const heard = async (): Promise<number> =>
        page.evaluate(() =>
          (
            window as unknown as { __facetAudio: { started(): number } }
          ).__facetAudio.started(),
        );
      await this.armAudio();
      for (let attempt = 0; attempt < AUDIO_WARM_ATTEMPTS; attempt += 1) {
        // A frame, so the build asks for the screen's bed and for anything else it
        // plays from `update`; then real time, so a decode that frame kicked off
        // can finish.
        await drive(1);
        if ((await heard()) > 0) return true;
        await page.waitForTimeout(AUDIO_WARM_POLL_MS);
      }
      return (await heard()) > 0;
    },

    settle: (ms) => page.waitForTimeout(ms),

    async dispose() {
      // The context stays: it holds the init scripts and the window shape, and the
      // next harness of this shape wants both. The page goes, so nothing this
      // check pressed, opened or muted can reach the next one.
      openPages.delete(page);
      await page.close().catch(() => undefined);
    },
  };

  harnessCues.set(harness, cueSinks);
  harnessLoops.set(harness, loopSinks);
  return harness;
}

/** Where {@link watchCues} attaches, per harness. */
const harnessCues = new WeakMap<Harness, TimedCue[][]>();

/** Where {@link watchLoops} attaches, per harness. */
const harnessLoops = new WeakMap<Harness, TimedCue[][]>();

/* -------------------------------------------------------------------------- */
/* The fit                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * How the stage maps onto a surface of this shape, as `specs/overview.md` fixes
 * it: one uniform scale, the whole stage inside, centered, with the leftover split
 * evenly into two bars.
 *
 * Computed rather than read from the build, deliberately. Under an engine the fit
 * is the engine's and a check can ask it what it derived; here the fit is the
 * build's own work, so asking it would be asking a build to grade itself. Every
 * check but one about the fit runs at the stage's own size, where this is the
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

/**
 * A logical stage point in the CLIENT/CSS coordinates a pointer event carries.
 *
 * `(x * view.scale + view.offsetX) / dpr`, the inverse of the mapping a runtime
 * applies to an incoming event, and the one conversion the pointer verbs go
 * through. The fit is stated in DEVICE pixels and a pointer event carries CSS
 * pixels, so dividing by `dpr` is what keeps a press correct on a surface whose
 * backing store is denser than its layout. At the default shape the two are the
 * same number; a `dpr` of zero or less is no density at all and reads as 1.
 */
function toClient(
  view: Viewport,
  dpr: number,
  x: number,
  y: number,
): { x: number; y: number } {
  const ratio = dpr > 0 ? dpr : 1;
  return {
    x: (x * view.scale + view.offsetX) / ratio,
    y: (y * view.scale + view.offsetY) / ratio,
  };
}

/* -------------------------------------------------------------------------- */
/* Draw calls                                                                 */
/* -------------------------------------------------------------------------- */

/** One operation as the injected recorder writes it. */
export type RecordedOp =
  | { op: "call"; method: string; args: unknown[]; text?: TextGeometry }
  | { op: "set"; property: string; value: unknown };

function toDrawCall(op: RecordedOp): DrawCall {
  if (op.op !== "call") {
    return { kind: "set", property: op.property, value: op.value };
  }
  const call: DrawCall = { kind: "call", method: op.method, args: op.args };
  // Carried only where the recorder could measure the run: a `fillText` or a
  // `strokeText`, on a context that answered `measureText`.
  if (op.text !== undefined) call.text = op.text;
  return call;
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

/**
 * Every string the frame drew: the `fillText` runs in call order, then the
 * `strokeText` runs in call order.
 *
 * The two channels are kept apart on purpose. A build that outlines its title
 * issues a `strokeText` and a `fillText` for each glyph, and a single list in
 * true call order would read `F F A A C C E E T T` — a run that spells nothing.
 * Listed by channel, each channel spells the copy on its own.
 */
export function drawnText(calls: readonly DrawCall[]): string[] {
  const drawn: string[] = [];
  for (const method of ["fillText", "strokeText"]) {
    for (const args of callsTo(calls, method)) {
      if (typeof args[0] === "string") drawn.push(args[0]);
    }
  }
  return drawn;
}

/**
 * Whether `wanted` is among the words a frame put on screen.
 *
 * `specs/ui.md` fixes the COPY — `FACET`, `PRESSURE FINDS THE FLAW`, `SCORE`,
 * `PLAY AGAIN` — and fixes nothing about how many draw calls a build spends on
 * it. All four of these are conformant renderings of the same screen, and this
 * reads all four the same way:
 *
 *   one call per line     `"FACET"`
 *   one call per word     `"HOW"`, `"TO"`, `"PLAY"`
 *   one call per glyph    `"F"`, `"A"`, `"C"`, `"E"`, `"T"`
 *   a decorated entry     `"> PLAY <"`, or `"SCORE 120"` for a check about
 *                         the label alone
 *
 * Four readings, tried from the most local to the most permissive, so a build
 * that drew the copy in ONE call is decided by that call alone: a piece that IS
 * the copy; a piece that CONTAINS it; the frame's whole run of text; and that
 * run with all whitespace taken out of both sides, which is the only reading
 * that finds a line a build drew one word at a time.
 *
 * What the last two readings buy is bounded, and the bound is the rule for
 * using this: a search over the joined run can find a phrase that spans two
 * adjacent draws, so this decides that copy IS on screen and NEVER that two
 * pieces of copy are separate. An item about two readouts asks about each of
 * them; an item that asserts copy is ABSENT asserts the absence of that one
 * string and pairs it with a frame that does show it, so an accidental join
 * shows up as the two frames agreeing rather than as a verdict.
 */
export function showsText(pieces: readonly string[], wanted: string): boolean {
  const needle = wanted.trim().toLowerCase();
  if (needle === "") return true;
  const lower = pieces.map((piece) => piece.toLowerCase());
  if (lower.some((piece) => piece.trim() === needle)) return true;
  if (lower.some((piece) => piece.includes(needle))) return true;
  const joined = lower.join("");
  if (joined.includes(needle)) return true;
  const bare = (value: string): string => value.replace(/\s+/gu, "");
  return bare(joined).includes(bare(needle));
}

/** Whether the frame's own draw calls put `wanted` on screen. */
export function drewText(calls: readonly DrawCall[], wanted: string): boolean {
  return showsText(drawnText(calls), wanted);
}

/**
 * The operations a frame spends on MAKING a picture, as against the ones that
 * set up a style or a transform to make it with.
 *
 * One list in all three projects, so `drawOps` returns the same count for the
 * same render whichever engine drove it. Path construction is in it because a
 * build that draws a gem as a path spends its whole render there and would
 * otherwise read as a frame that painted nothing, and `drawImage` is in it
 * because a check about produced sprites asks whether the frame drew an image at
 * all.
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

/** How many operations a frame issued that actually painted. */
export function drawOps(calls: readonly DrawCall[]): number {
  return calls.filter(
    (call) => call.kind === "call" && DRAW_METHODS.includes(call.method),
  ).length;
}

/* -------------------------------------------------------------------------- */
/* Pixels                                                                     */
/* -------------------------------------------------------------------------- */

/** The color of one logical point of the stage. */
export async function sampleColor(
  h: Harness,
  x: number,
  y: number,
): Promise<Rgb> {
  const [r, g, b] = await h.pixel(x, y);
  return { r, g, b };
}

/** Euclidean distance between two colors, 0..441. */
export function colorDistance(a: Rgb, b: Rgb): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

/**
 * The device-pixel box centered on a cell's center.
 *
 * `half` defaults to `PATCH_HALF` (20) LOGICAL units, so the box sits inside
 * `GEM_R` (30), where the gem's own form is drawn, and clear of every neighbor,
 * whose nearest center is `CELL_PITCH` (72) away.
 *
 * THE BOX IS CUT INSIDE THE PAGE. This is a hand-off to {@link Harness.patch},
 * which is where the arithmetic lives under this engine: the pixels are in the
 * browser, so the cell center, the box's size and its clamp are worked out
 * BESIDE the `getImageData` that reads them, and one crossing carries back the
 * whole box. Working them out here instead would cost a crossing to learn the
 * canvas's size and another to read the pixels, for the same box. Under the two
 * engines the canvas is in this process, so the same arithmetic sits in this
 * function's own body there.
 *
 * The box `Harness.patch` cuts is the same one: `2 * round(half * scale) + 1`
 * device pixels on a side — ODD, so it is centered on the cell center rather
 * than half a pixel off it — and it is that size wherever the cell sits, since
 * at a canvas edge the ORIGIN slides inward and the size holds. `patchDistance`
 * is a MEAN over the box, and `PATCH_DISTINCT_MIN` and `PATCH_SAME_MAX` are one
 * pair of thresholds under all three engines, so a box that changed shape near
 * an edge would make them mean different things.
 */
export function readPatch(
  h: Harness,
  col: number,
  row: number,
  half: number = PATCH_HALF,
): Promise<Patch> {
  return h.patch(col, row, half);
}

/**
 * The mean per-pixel Euclidean RGB distance between two patches, 0 to about 441.
 *
 * THE DISTINGUISHABILITY INSTRUMENT. Per-pixel rather than between the two mean
 * colors, because a build is entitled to tell two kinds apart by FORM — the same
 * hue, a different facet pattern — and two patches with identical means can still
 * differ in every pixel. A hue difference and a form difference both register
 * here, which is what makes this reading fair to a build whose look is not the
 * reference's. It says nothing about which colors were used, and no check may
 * ask it to.
 *
 * Two patches of different shapes are a fixture fault rather than a reading, and
 * a patch of no pixels at all measures no distance.
 */
export function patchDistance(a: Patch, b: Patch): number {
  if (a.width !== b.width || a.height !== b.height) {
    fail(
      `two patches of the same shape (${a.width}x${a.height})`,
      `${b.width}x${b.height}`,
    );
  }
  const pixels = a.width * a.height;
  if (pixels === 0) return 0;
  let total = 0;
  for (let i = 0; i < pixels; i += 1) {
    const at = i * 4;
    total += Math.hypot(
      a.data[at] - b.data[at],
      a.data[at + 1] - b.data[at + 1],
      a.data[at + 2] - b.data[at + 2],
    );
  }
  return total / pixels;
}

/** The mean color of a patch, or black when the patch holds no pixels. */
export function meanColor(patch: Patch): Rgb {
  const pixels = patch.width * patch.height;
  if (pixels === 0) return { r: 0, g: 0, b: 0 };
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < pixels; i += 1) {
    const at = i * 4;
    r += patch.data[at];
    g += patch.data[at + 1];
    b += patch.data[at + 2];
  }
  return { r: r / pixels, g: g / pixels, b: b / pixels };
}

/* -------------------------------------------------------------------------- */
/* Evidence capture                                                           */
/* -------------------------------------------------------------------------- */
//
// A review item may declare a `replay` OUTPUT beside its verdict: the frames the
// build itself drew while a check drove it, kept as evidence a reviewer can scrub
// against the reference implementation's. Four properties make it usable, and each
// is deliberate:
//
// 1. IT RECORDS THE SECTION, NOT THE RUN. The recorder is armed around the
//    caller's scenario and disarmed the moment that scenario returns.
// 2. IT IS EVIDENCE, NEVER A VERDICT. The scenario's own value comes straight
//    back, and a scenario that THROWS still writes what it had recorded before the
//    failure travels on.
// 3. IT WRITES ONLY WHAT THERE IS TO LOOK AT. A capture that closed no frames
//    leaves no file.
// 4. IT COSTS NOTHING WHEN NOBODY IS COLLECTING. Outside a run the media directory
//    is unset and the whole thing is a no-op that still runs the scenario.

/** The environment variable the runner names the media directory in. */
export const MEDIA_DIR_ENV = "TCAB_VALIDATION_MEDIA_DIR";

/**
 * The directory the runner stages this project to inside the build's tree.
 *
 * A recording is addressed by the STAGED path of the suite that produced it —
 * `validation/moves/r1-adjacent-accepted.test.ts` — because that is the path the
 * review item's declared script resolves to, and so the only name the case's
 * manifest and the runner both already agree on. Stating the prefix here is what
 * keeps that address the same when this suite is run in place against a reference
 * implementation.
 */
export const STAGED_PROJECT_DIR = "validation";

/**
 * The ground the console's player paints behind a recorded frame.
 *
 * The specification fixes no background: the build paints its own each frame, and
 * the recorded frames carry that paint. What the player needs is a color for the
 * canvas under them, and the page the build is served on is painted `#000` by the
 * case's own `index.html`, so that is what a replay says.
 *
 * THIS ENGINE ONLY. Under the two engines `specs/overview.md` makes `BACKGROUND`
 * an export of `src/game.ts` that `src/main.ts` hands the engine, so a capture
 * there reads the build's own answer. Nothing is exported to read here — an
 * engineless build clears its canvas however it likes inside its own render — so
 * the ground is the page's, which the case supplies.
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
  /** Indices into `states` of the states saved under this frame, outermost first. */
  stack: number[];
  /** Indices into the recording's `ops`, in the order the frame issued them. */
  ops: number[];
  /** Whether part of what this frame inherited was cut down to a bound. */
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

/** A recording, as the console's player reads it. */
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
export function mediaDestination(
  outputId: string,
  extension: string,
): string | null {
  const mediaDir = process.env[MEDIA_DIR_ENV];
  if (mediaDir === undefined || mediaDir === "") return null;
  const testPath = expect.getState().testPath;
  if (testPath === undefined) return null;
  const suite = relative(PROJECT_ROOT, testPath).split(sep).join("/");
  return join(mediaDir, STAGED_PROJECT_DIR, suite, `${outputId}.${extension}`);
}

/** A value's JSON with object keys in a fixed order, as a table's dedup key. */
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
 * Dropping a frame drops the last reference to whatever only that frame drew
 * with, so tables carried over whole would put operations, gradients and images in
 * the file that no frame asks for. Every entry here is reached from a kept frame,
 * and every reference inside one is rewritten as it is reached, transitively.
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
 * `count` is left as it was recorded, so a reader can see that frames were skipped
 * rather than being told a smooth lie. The last frame is always kept whatever the
 * stride lands on — it is the frame the check's sweep stopped at, and the one a
 * reviewer looks at first.
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
    console.warn(`facet: could not write ${destination}: ${String(error)}`);
  }
}

/**
 * Record the frames `scenario` drives and keep them as the review item's
 * `outputId` output, handing back whatever the scenario returned.
 *
 * Wrap the drive, not the arrangement:
 *
 * ```ts
 * const settled = await captureReplay(h, "chain", () => resolveChain(h));
 * assertTrue(settled.settled);
 * ```
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
        window as unknown as { __facetRec: { arm(d: unknown): boolean } }
      ).__facetRec.arm(design),
    { width: STAGE_W, height: STAGE_H, background: REPLAY_BACKGROUND },
  );
  try {
    return await scenario();
  } finally {
    // In a `finally`, so a scenario that failed still leaves its evidence behind.
    const recording = (await h.page.evaluate(() =>
      (
        window as unknown as { __facetRec: { disarm(): unknown } }
      ).__facetRec.disarm(),
    )) as Recording | null;
    writeReplay(destination, recording);
  }
}

/**
 * Keep the picture currently on the canvas as the review item's `outputId`
 * output.
 *
 * The companion to {@link captureReplay}, for a point whose evidence is one
 * PICTURE rather than a stretch of motion. What is written is whatever the last
 * frame that RAN left behind, so call it after the frame that poses the thing
 * under test and before the assertions.
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
    console.warn(`facet: could not write ${destination}: ${String(error)}`);
  }
}

/* -------------------------------------------------------------------------- */
/* Cues                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Record every ONE-SHOT sound the build emits from now on, stamped with the frame
 * of the drive it sounded on.
 *
 * WHAT IS OBSERVED, AND WHY IT IS THE FAIR READING. `specs/ui.md` requires one cue
 * per event, played on the frame its event happens, and says nothing at all about
 * how a build makes a sound — under this engine the whole audio layer is the
 * build's. So `audio-init.js` watches the two doors a browser can emit sound
 * through (a Web Audio source being `start()`ed, whatever kind it is, and a media
 * element being played) and counts what goes through them; the harness brackets
 * each driven frame around that count, so a sound is attributed to the frame that
 * produced it. A blip made of two oscillators counts as two, which is why a check
 * asserts that a frame SOUNDED rather than how many times.
 *
 * WHY ONE-SHOTS ALONE. `specs/ui.md` also puts two looping music beds under the
 * game, and one of them is playing on every screen. A bed starting as a screen
 * changes is not the cue an item is about, so the looping starts are kept apart in
 * {@link watchLoops} and a cue check never sees them.
 */
export function watchCues(h: Harness): TimedCue[] {
  const played: TimedCue[] = [];
  harnessCues.get(h)?.push(played);
  return played;
}

/** Record every LOOPING start: what the two music beds are under `specs/ui.md`. */
export function watchLoops(h: Harness): TimedCue[] {
  const played: TimedCue[] = [];
  harnessLoops.get(h)?.push(played);
  return played;
}

/** The sounds attributed to one frame of the drive. */
export function cuesOnFrame(
  cues: readonly TimedCue[],
  frame: number,
): TimedCue[] {
  return cues.filter((cue) => cue.frame === frame);
}

/**
 * The names of a run of sounds, in order — every one of them `null` here.
 *
 * Exported under all three engines so a cue script reads the same, and it reads
 * nothing under this one: `specs/ui.md` fixes the nine cue names inside the
 * build's own code, so an engineless build publishes no name to anything outside
 * itself. NO `none` VALIDATOR MAY ASSERT A NAME. What a `none` cue check asserts
 * is that a sound went out, and on which frame.
 */
export function cueNames(cues: readonly TimedCue[]): (string | null)[] {
  return cues.map((cue) => cue.cue);
}

/* -------------------------------------------------------------------------- */
/* Counting frames for a duration                                             */
/* -------------------------------------------------------------------------- */
//
// A step's hold is the STEP's own figure rather than a constant: it is
// `board.ts`'s `stepHold` over the `lastWaves` R6 gave that step's clear set and
// the `lastFall` R9 left on the board, and the snapshot reports it. So the
// frames that carry a scenario across a hold cannot be a constant either. These
// two turn a duration into a whole number of the suite's frames, and every drive
// below counts through them.

/**
 * The most frames of the suite's clock that fit STRICTLY INSIDE `seconds`.
 *
 * `ceil(seconds / TICK_S) - 1`, so the frames sum to less than `seconds` even
 * where `seconds` is an exact multiple of `TICK_S`. At `REFUSAL_SECONDS`
 * (`0.3` s) it is 19 frames, `0.296875` s, which is the figure
 * `REFUSAL_FRAMES_BEFORE` writes down for that one duration.
 *
 * What a check reaches for to stop SHORT of a threshold and read the state a
 * build is holding just before it.
 */
export function framesShortOf(seconds: number): number {
  return Math.max(0, Math.ceil(seconds / TICK_S) - 1);
}

/**
 * The fewest frames of the suite's clock that carry the game PAST `seconds`,
 * with a whole frame to spare.
 *
 * `ceil(seconds / TICK_S) + 1`. The `ceil` alone only REACHES `seconds`, which a
 * build comparing `>=` acts on and one comparing `>` does not; the extra frame
 * puts a full `TICK_S` (`0.015625` s) of game time beyond it, so both
 * comparisons have fired and no reading taken afterwards depends on which one
 * the build wrote.
 *
 * The overshoot is therefore at most two frames, `0.03125` s, which is what
 * keeps a drive sized this way clear of a SECOND threshold of the same length.
 */
export function framesPast(seconds: number): number {
  return Math.ceil(seconds / TICK_S) + 1;
}

/* -------------------------------------------------------------------------- */
/* Scenario helpers                                                           */
/* -------------------------------------------------------------------------- */
//
// Each of these poses a situation through `window.__facet` and then lets the real
// game run. Every figure they encode is the case's, and the same helpers under the
// same names stand in the two engine-backed projects next door.
//
// COMPOUND SEQUENCES LIVE HERE, NOT ON THE SURFACE. Every operation
// specs/instrumentation.md puts on the debug surface writes ONE element of the
// state, reads it, or moves the clock. Beginning a round, opening the next
// level, quitting to the title and reaching a screen are each several of those
// in a row, and the surface carries no operation for any of them — so those
// sequences are written once, here, where the suites of all three engine
// projects share one copy. What each one arranges is specs/rules.md's and
// specs/ui.md's account of the same transition, field by field.
//
// THE ITEMS THAT DECIDE THOSE TRANSITIONS DO NOT REACH FOR THESE HELPERS.
// Whether `PLAY` really opens a round, `CONTINUE` really opens the next level
// and `QUIT` really returns to the title is what `screens/start-round`,
// `levels/continue-opens-next-level` and `screens/quit-to-title` decide, by
// working the menu the way a player does and reading what the build did. Every
// other check reaches its scenario through here instead, so a build with a
// broken title menu fails those items rather than every item in the project.

/**
 * Write a board onto the game and change NOTHING else.
 *
 * One crossing, and the atomic operation specs/instrumentation.md states:
 * `loadBoard(rows)` writes the board's dimensions and its cells, and "the
 * screen, `menuIndex`, the phase and its timers, the selection, the offer, the
 * refusal, and every figure of the round stand where they were". What a check
 * reaches for when it must put a board under a move already in motion —
 * replacing the gems a running step will read next without disturbing the step.
 *
 * The rows are parsed on this side FIRST, so a fixture typo fails the FIXTURE
 * with the token it could not read rather than crossing into the build and
 * failing it for a mistake the check made.
 *
 * {@link loadBoard} is the one to reach for otherwise: it poses the board on a
 * settled `playing` screen, which is the situation nearly every scenario wants.
 */
export async function writeBoard(
  h: Harness,
  rows: BoardRows,
): Promise<FacetSnapshot> {
  parseRows(rows);
  await h.debug.loadBoard(rows);
  return h.snapshot();
}

/**
 * Pose a written board on a settled `playing` screen, and read it back.
 *
 * THE SEQUENCE, not one operation: the board is written, resolution is settled,
 * the selection, the offer and the refusal are put away, the menu highlight goes
 * back to its resting `0` and the screen becomes `playing`. That is the world
 * nearly every scenario in this project wants to stand on — a board, in play,
 * with nothing of an earlier scenario standing on it.
 *
 * No frame is advanced. Every operation in it takes effect at its call, so the
 * arrangement is complete in the state this reads back.
 *
 * A check that wants ONLY the cells written, leaving the screen and the move in
 * motion alone, calls {@link writeBoard}.
 */
export async function loadBoard(
  h: Harness,
  rows: BoardRows,
): Promise<FacetSnapshot> {
  parseRows(rows);
  await h.debug.clearChain();
  await h.debug.clearSelection();
  await h.debug.clearOffer();
  await h.debug.clearRefusal();
  await h.debug.loadBoard(rows);
  await h.debug.setMenuIndex(0);
  await h.debug.setScreen("playing");
  return h.snapshot();
}

/**
 * Begin a fresh round, exactly as choosing `PLAY` from the title does.
 *
 * Every figure specs/rules.md returns to its opening value when a round starts,
 * written one at a time, and then the opening board dealt through the game's own
 * code from `rngState` — which is the one part of it that cannot be decomposed,
 * since what makes a dealt board an opening board is R4 and the generator rather
 * than any cell a check could write.
 *
 * `PLAY AGAIN` on the game-over menu opens the same round; specs/ui.md gives the
 * two menu items the same effect.
 */
export async function startRound(h: Harness): Promise<FacetSnapshot> {
  await h.debug.setScore(0);
  await h.debug.setLevel(1);
  await h.debug.setLevelScore(0);
  await h.debug.setMoveScore(0);
  await h.debug.setBestMove(0);
  await h.debug.setBestChain(0);
  await h.debug.clearSelection();
  await h.debug.clearOffer();
  await h.debug.clearRefusal();
  await h.debug.clearChain();
  await h.debug.dealBoard();
  await h.debug.setMenuIndex(0);
  await h.debug.setScreen("playing");
  return h.snapshot();
}

/**
 * Open the next level, exactly as choosing `CONTINUE` from the level-clear menu
 * does.
 *
 * {@link startRound} with two differences, and both are specs/rules.md's:
 * `score` CARRIES — it is the round's total and a level boundary does not touch
 * it — and `level` goes up by one from wherever the round had reached rather
 * than back to `1`. The level's target follows from `level`, so nothing here
 * writes it.
 */
export async function openNextLevel(h: Harness): Promise<FacetSnapshot> {
  const before = await h.snapshot();
  await h.debug.setLevel(before.level + 1);
  await h.debug.setLevelScore(0);
  await h.debug.setMoveScore(0);
  await h.debug.setBestMove(0);
  await h.debug.setBestChain(0);
  await h.debug.clearSelection();
  await h.debug.clearOffer();
  await h.debug.clearRefusal();
  await h.debug.clearChain();
  await h.debug.dealBoard();
  await h.debug.setMenuIndex(0);
  await h.debug.setScreen("playing");
  return h.snapshot();
}

/**
 * Abandon the round and return to the title, exactly as choosing `QUIT` from
 * either menu that offers it does.
 *
 * specs/ui.md: "Sets `screen = title` and `menuIndex = 0`, abandoning the
 * round." The round is abandoned by taking the board out of play and putting
 * away everything that stood on it; `score` and `level` are left where the round
 * left them, since the title screen reports neither and the next round's
 * {@link startRound} writes both.
 */
export async function quitToTitle(h: Harness): Promise<FacetSnapshot> {
  await h.debug.clearSelection();
  await h.debug.clearOffer();
  await h.debug.clearRefusal();
  await h.debug.clearChain();
  await h.debug.clearBoard();
  await h.debug.setMenuIndex(0);
  await h.debug.setScreen("title");
  return h.snapshot();
}

/**
 * Open the instructions, exactly as choosing `HOW TO PLAY` from the title does.
 *
 * specs/ui.md: "Sets `screen = howto`", and `menuIndex` is `0` on entering every
 * screen but the title entered from here.
 */
export async function openHowTo(h: Harness): Promise<FacetSnapshot> {
  await h.debug.setMenuIndex(0);
  await h.debug.setScreen("howto");
  return h.snapshot();
}

/**
 * Pause the round, exactly as the `pause` action from `playing` does.
 *
 * The board is left exactly as it stands — specs/ui.md shows it behind the menu,
 * quieted — and only the screen and the menu highlight move.
 */
export async function pauseGame(h: Harness): Promise<FacetSnapshot> {
  await h.debug.setMenuIndex(0);
  await h.debug.setScreen("paused");
  return h.snapshot();
}

/**
 * Return to the round, exactly as choosing `RESUME` from the pause menu does.
 *
 * specs/ui.md: "Sets `screen = playing`, with the board exactly as it was left."
 * The highlight goes back to the `0` specs/ui.md rests it at on `playing`.
 */
export async function resumeGame(h: Harness): Promise<FacetSnapshot> {
  await h.debug.setMenuIndex(0);
  await h.debug.setScreen("playing");
  return h.snapshot();
}

/**
 * Stand the game on `screen`, with whatever that screen needs behind it.
 *
 * REACHED DIRECTLY, through the atomic poses, rather than by playing the game
 * into it. specs/instrumentation.md's `setScreen` shows a screen and changes
 * nothing else, and "the screen behaves from there exactly as it does when a
 * player reaches it" — so a check whose requirement is ABOUT a screen stands on
 * it in two crossings instead of driving a chain to its end through the level
 * and end conditions, which are other items' requirements and other items'
 * failure modes.
 *
 * The four screens specs/ui.md draws a board behind get one: a quiet filler
 * carrying no run and one legal swap, so the board behind the menu is a board a
 * round could really be standing on.
 */
export async function reachScreen(
  h: Harness,
  screen: Screen,
): Promise<FacetSnapshot> {
  await h.debug.reset();
  if (screen !== "title" && screen !== "howto") {
    await loadBoard(h, quietRowsWithEscape([]));
  }
  if (screen !== "title") {
    await h.debug.setMenuIndex(0);
    await h.debug.setScreen(screen);
  }
  const reading = await h.snapshot();
  if (reading.screen !== screen) {
    fail(`the ${screen} screen these poses ask for`, reading.screen);
  }
  return reading;
}

/**
 * Take the item at `index` on whichever menu the current screen shows, the way a
 * player takes it.
 *
 * TWO HALVES, AND ONLY ONE OF THEM IS DRIVEN. The highlight is POSED —
 * `setMenuIndex` "highlights the menu item at `index` … and no item is taken" —
 * so a build whose `up` and `down` never worked is still asked this question,
 * and which item the highlight lands on stays the menu items' own point. What is
 * really driven is the `confirm` that takes it, through the key
 * specs/controls.md binds and the build's own input path.
 *
 * This is what the items whose requirement IS the choice reach for: "Choosing
 * PLAY", "Choosing QUIT", "Choosing CONTINUE", "Choosing RESUME". Every other
 * check stands on the screen it needs through {@link reachScreen} and never
 * presses a menu at all.
 */
export async function takeMenuItem(
  h: Harness,
  index: number,
): Promise<FacetSnapshot> {
  await h.debug.setMenuIndex(index);
  await h.tapAction("confirm");
  return h.snapshot();
}

/**
 * Pose the run-free filler with `cells` written over it.
 *
 * The one-line way to pose an isolated world: nothing on the board matches
 * anything except what the scenario itself placed.
 *
 * THE HAZARD, AND IT IS REAL. The filler carries no run AND no legal swap of its
 * own, so a scenario posed on it stands on a board whose only move is the one it
 * planted. `specs/rules.md` ends the round when `phase` returns to `idle` on a
 * board with no legal swap — so a scenario that resolves its chain here can
 * settle into `gameover` rather than back into `playing`, and whether it does
 * depends on where the cleared cells were and what R9 dropped in behind them. A
 * check that must still be `playing` afterwards uses
 * {@link poseBoardWithEscape}, and reads `snapshot.legalSwap` before it reads
 * `screen`.
 */
export function poseBoard(
  h: Harness,
  cells: readonly PlacedToken[],
): Promise<FacetSnapshot> {
  return loadBoard(h, quietRowsWith(cells));
}

/**
 * The same, over a filler that carries one legal swap of its own.
 *
 * The remedy for the hazard above: `quietRowsWithEscape` plants a swap in the
 * bottom-left corner that the board would otherwise not have, so the round has a
 * move left when the scenario's own chain is spent. It REFUSES a scenario cell
 * that lands on one of the escape's own cells, since a scenario that overwrote
 * the escape would be posed on a board with the guarantee silently gone.
 *
 * WHAT IT GUARANTEES IS THE POSED BOARD, NOT WHAT A CHAIN LEAVES BEHIND. A clear
 * that reaches the escape's column takes its gems with it and R9 refills over
 * them, so a long chain near the bottom-left can still end the round. A check
 * that depends on the outcome keeps its scenario clear of the bottom rows and
 * the leftmost columns, and asserts `snapshot.legalSwap` before reading `screen`
 * either way.
 */
export function poseBoardWithEscape(
  h: Harness,
  cells: readonly PlacedToken[],
): Promise<FacetSnapshot> {
  return loadBoard(h, quietRowsWithEscape(cells));
}

/**
 * Request a swap and read the state THE REQUEST ITSELF left, with no frame
 * advanced.
 *
 * WHAT IT RETURNS. Either the standing refusal, or the swap in motion:
 * specs/rules.md has an accepted swap exchange the two cells at once, set
 * `phase` to `swapping`, set `swapTimer` to `0` and leave `chainStep` at `0`,
 * and step 1 does not resolve until `SWAP_SECONDS` (`0.18`) of game time has
 * passed. NOTHING IS CLEARED in the reading this hands back, and a check that
 * reads `lastCleared`, `lastPoints` or a settled board off it is reading the
 * board as it stood before the chain.
 *
 * SO REACH FOR IT ONLY when the check is about the REQUEST — a refusal under R1,
 * R2 or R3, or the swapping phase itself. Every other check wants
 * {@link swapAndStep}, which carries the game through the animation to step 1's
 * result, or {@link swapAndResolve}, which carries it to the end of the chain.
 */
export async function requestSwap(
  h: Harness,
  a: CellRef,
  b: CellRef,
): Promise<FacetSnapshot> {
  await h.debug.requestSwap(a.col, a.row, b.col, b.row);
  return h.snapshot();
}

/**
 * Request a swap and carry it through the swap animation to the result of step
 * 1. THE ONE most checks about a move want.
 *
 * `SWAP_DRIVE_FRAMES` is sized in `constants.ts` for exactly this drive: 14
 * frames, `0.21875` s. `swapTimer` reaches `SWAP_SECONDS` (`0.18`) on the
 * twelfth frame, at `0.1875` s, so the swap is over whether the build compares
 * `>=` or `>` and step 1 has resolved; the `0.0075` s of overrun carries into
 * `stepTimer`, the two remaining frames add `0.03125` s, and the step is left
 * `0.03875` s into a hold of at least `0.3` s. Exactly one step has resolved
 * when this returns, on every board.
 *
 * A REFUSED swap is carried through the same frames and comes back refused. The
 * board never left `idle`, and `0.21875` s is inside `REFUSAL_SECONDS` (`0.3`),
 * so the refusal is still standing to be read — which is why a check may use
 * this even where it does not know in advance whether the swap will be taken.
 */
export async function swapAndStep(
  h: Harness,
  a: CellRef,
  b: CellRef,
): Promise<FacetSnapshot> {
  await requestSwap(h, a, b);
  await h.advance(SWAP_DRIVE_FRAMES);
  return h.snapshot();
}

/**
 * The frames one {@link advanceStep} drives from the state `snapshot` reports.
 *
 * TWO CASES, because a move in motion is in one of two phases and the two are
 * timed by different figures.
 *
 * While `phase` is `swapping` it is `SWAP_DRIVE_FRAMES`, the drive above: past
 * `SWAP_SECONDS` into step 1, and far short of that step's own end.
 *
 * Otherwise it is `framesPast(stepHold - stepTimer)`. The hold is the step's own
 * figure — the snapshot reports it, derived from the `lastWaves` and `lastFall`
 * that step left — and `stepTimer` is how much of it has already run, so what is
 * driven is the REMAINDER plus the frame or two that carries the boundary. Since
 * the boundary is crossed with at most `0.03125` s to spare and the SHORTEST
 * hold any step can have is `0.3` s (`lastWaves` is `0` when the clear set is
 * its seed alone, and `lastFall` is at least `1` because a step that cleared
 * anything refills at least one cell from above row `0`), a drive sized this way
 * never reaches a second board read. A build that reads the board twice inside
 * one hold therefore shows up as an extra chain step rather than being hidden.
 *
 * Exported because a check about the cadence itself needs the same arithmetic
 * from the other side: `framesShortOf(stepHold)` stops before the boundary, this
 * carries past it.
 */
export function stepDriveFrames(snapshot: FacetSnapshot): number {
  if (snapshot.phase === "swapping") return SWAP_DRIVE_FRAMES;
  return framesPast(Math.max(0, snapshot.stepHold - snapshot.stepTimer));
}

/**
 * Carry the board past exactly one boundary of the move in motion: the end of
 * the swap animation, or the end of the step in progress.
 *
 * The count is {@link stepDriveFrames} read off the state AS IT STANDS rather
 * than a constant, because a step's hold is the step's own figure and two steps
 * of one chain rarely hold for the same time.
 */
export async function advanceStep(h: Harness): Promise<FacetSnapshot> {
  await h.advance(stepDriveFrames(await h.snapshot()));
  return h.snapshot();
}

/**
 * Drive a move to its end, or report that it never ended.
 *
 * It ALWAYS RETURNS. `maxSteps` is a cap rather than a wait: a build whose chain
 * never settles comes back as `settled: false` and fails its own item, instead
 * of hanging and costing the whole run the suite's wall-clock budget.
 *
 * A board still `swapping` is driven too, so this may be called straight after
 * {@link requestSwap} as readily as after {@link swapAndStep}. `steps` is
 * therefore a count of the BOUNDARIES driven past rather than of the chain steps
 * that resolved, and a check that wants the depth a chain reached reads
 * `bestChain` off the settled snapshot.
 */
export async function resolveChain(
  h: Harness,
  options: { maxSteps?: number } = {},
): Promise<SettleResult> {
  const maxSteps = options.maxSteps ?? MAX_CHAIN_STEPS;
  let snapshot = await h.snapshot();
  let steps = 0;
  let frames = 0;
  while (snapshot.phase !== "idle" && steps < maxSteps) {
    frames += stepDriveFrames(snapshot);
    snapshot = await advanceStep(h);
    steps += 1;
  }
  return { settled: snapshot.phase === "idle", steps, frames, snapshot };
}

/**
 * Play a swap and carry it all the way, keeping BOTH readings.
 *
 * `first` is step 1 as {@link swapAndStep} left it — its `lastCleared`,
 * `lastPoints`, `chainStep` and `multiplier` all describe that one step — and
 * `settled` is where the chain came to rest.
 */
export async function swapAndResolve(
  h: Harness,
  a: CellRef,
  b: CellRef,
): Promise<{ first: FacetSnapshot; settled: SettleResult }> {
  const first = await swapAndStep(h, a, b);
  const settled = await resolveChain(h);
  return { first, settled };
}

/* -------------------------------------------------------------------------- */
/* The pointer, gesture by gesture                                            */
/* -------------------------------------------------------------------------- */
//
// specs/controls.md plays the whole board with the pointer. A press takes hold
// of a gem, a move while held offers it into an orthogonal neighbor or withdraws
// the offer, and the RELEASE with an offer standing is what requests the swap —
// so a move is a GESTURE rather than a call, and a player who carries a gem onto
// its neighbor and back again has played nothing. These break that gesture into
// the three operations the surface carries, and compose the whole of it.
//
// BUILT FROM THE ATOMS ALONE. Every helper below goes through `pointerDown`,
// `pointerMove` and `pointerUp` and through nothing else. The point of a pointer
// check is that the BUILD's own press, move and release rules produced the
// outcome; a helper that reached for `setSelection`, `setOffer` or `requestSwap`
// to arrive there would be posing the very answer the check is about to read.
//
// EACH TAKES AN OPTIONAL `device`. specs/controls.md reads a mouse, a pen and a
// finger the same way, so the same gesture is posed as a touch by naming one.
// The argument is OMITTED rather than passed as `undefined` when the caller
// named none, so a mouse gesture poses exactly the call a check writing it out
// by hand would make and the specification's own default is what supplies
// `mouse`.
//
// NO FRAME IS RUN. Each of the three operations takes effect at the call
// (specs/instrumentation.md), so a whole gesture is posed without the game
// advancing at all, and `simTime`, `stepTimer` and the refusal timer stay
// readable exactly as the specification states them. A check that needs the
// gesture DRAWN, or that is about the cue an event plays, advances a frame
// itself.

/** Press the pointer at a logical stage point. */
export async function pressPoint(
  h: Harness,
  x: number,
  y: number,
  device?: PointerDevice,
): Promise<FacetSnapshot> {
  if (device === undefined) await h.debug.pointerDown(x, y);
  else await h.debug.pointerDown(x, y, device);
  return h.snapshot();
}

/**
 * Move the pointer to a logical stage point. While it is held down that is a
 * DRAG, which is the only kind of move the board reads.
 */
export async function movePointer(
  h: Harness,
  x: number,
  y: number,
  device?: PointerDevice,
): Promise<FacetSnapshot> {
  if (device === undefined) await h.debug.pointerMove(x, y);
  else await h.debug.pointerMove(x, y, device);
  return h.snapshot();
}

/** Release the pointer where it stands: the edge that plays a standing offer. */
export async function releasePointer(
  h: Harness,
  device?: PointerDevice,
): Promise<FacetSnapshot> {
  if (device === undefined) await h.debug.pointerUp();
  else await h.debug.pointerUp(device);
  return h.snapshot();
}

/**
 * Press on a cell, at its center.
 *
 * The center rather than an offset, because specs/controls.md targets "the cell
 * whose center is nearest the pointer position, when that center lies within
 * `GEM_HIT_R` of it" — and a press at the center is the only position that
 * targets one cell under every reading of that sentence. A check that is about
 * the RADIUS poses its own point through {@link pressPoint}, with
 * `board.ts`'s `insideCell`, `betweenCells` or `offBoardPoint`.
 */
export async function pressCell(
  h: Harness,
  cell: CellRef,
  device?: PointerDevice,
): Promise<FacetSnapshot> {
  const at = cellCenter(cell.col, cell.row);
  return pressPoint(h, at.x, at.y, device);
}

/** Carry a held pointer onto a cell, at its center: the drag that offers. */
export async function dragOntoCell(
  h: Harness,
  cell: CellRef,
  device?: PointerDevice,
): Promise<FacetSnapshot> {
  const at = cellCenter(cell.col, cell.row);
  return movePointer(h, at.x, at.y, device);
}

/**
 * The whole gesture that plays a move: press on `from`, carry the pointer onto
 * `to`, release there.
 *
 * Three operations and no shortcut, so what decides the outcome is the build's
 * own press, move and release rules. The reading handed back is the one the
 * RELEASE left — the swap requested and in motion, or refused, or nothing at all
 * when the build withdrew the offer — so a check about what the move DID drives
 * on from here with {@link advanceStep} or {@link resolveChain}.
 *
 * `to` need not be a neighbor of `from`: a gesture that ends over a cell the
 * rules offer nothing into is exactly the gesture several checks pose, and this
 * poses it faithfully rather than refusing it.
 */
export async function dragGem(
  h: Harness,
  from: CellRef,
  to: CellRef,
  device?: PointerDevice,
): Promise<FacetSnapshot> {
  await pressCell(h, from, device);
  await dragOntoCell(h, to, device);
  return releasePointer(h, device);
}

/**
 * The target the screen `snapshot` reports carries under `id`.
 *
 * A target's rectangle is the BUILD's — specs/controls.md fixes each screen's
 * ids and four requirements over every rectangle, and leaves the design of them
 * to the build — so a check reads the rectangle it is going to press off the
 * snapshot rather than writing one down. This is that lookup, in one place, so a
 * dozen checks do not each repeat it and a screen missing a target it owes fails
 * with the ids it did report rather than with a `TypeError`.
 */
export function targetById(snapshot: FacetSnapshot, id: string): TargetRect {
  const found = snapshot.targets.find((target) => target.id === id);
  if (found === undefined) {
    fail(
      `a pointer target ${JSON.stringify(id)} on the ${snapshot.screen} screen`,
      snapshot.targets.map((target) => target.id),
    );
  }
  return found;
}

/**
 * Move the pointer within a target, at its center: the hover that moves the
 * highlight.
 *
 * The center is where specs/instrumentation.md guarantees a hit — "a target's
 * rectangle is the one the game actually hit-tests against, so pressing and
 * releasing at a listed target's center takes that target" — so it is the one
 * position a check may press without asserting anything about the build's
 * layout.
 */
export async function moveOverTarget(
  h: Harness,
  target: TargetRect,
  device?: PointerDevice,
): Promise<FacetSnapshot> {
  const at = targetCenter(target);
  return movePointer(h, at.x, at.y, device);
}

/** Press inside a target, at its center: the press that highlights and arms. */
export async function pressTarget(
  h: Harness,
  target: TargetRect,
  device?: PointerDevice,
): Promise<FacetSnapshot> {
  const at = targetCenter(target);
  return pressPoint(h, at.x, at.y, device);
}

/**
 * Press and release inside a target, at its center: the gesture that TAKES it.
 *
 * Both edges at the same point, which is the only gesture specs/controls.md
 * makes take a target — "releases within the armed target" — so a check that
 * releases anywhere else composes the atoms itself and reads what was not taken.
 */
export async function takeTarget(
  h: Harness,
  target: TargetRect,
  device?: PointerDevice,
): Promise<FacetSnapshot> {
  await pressTarget(h, target, device);
  return releasePointer(h, device);
}
