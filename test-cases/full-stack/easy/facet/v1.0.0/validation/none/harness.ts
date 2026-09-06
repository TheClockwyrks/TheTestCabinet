// Facet — the case's half of the validator harness. CASE-PROVIDED.
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
// THE MACHINERY THAT DOES THAT IS NOT FACET'S. Finding and launching Chromium,
// serving the built site, holding one browser per worker, instrumenting a context
// with the draw-command recorder and the audio probe, reading the build's surface
// and reporting what is wrong with it, the frame clocks, the viewport fit, the
// readings taken off a frame, and the replay document a review point's evidence is
// written as — every engineless case needs exactly that, and it lives once, in
// `@clockwyrks/case-harness`, staged beside this file as `./case-harness/`. What
// stays here is what is genuinely Facet's.
//
// The seam is one call. `createCaseHarness` takes the case's TYPES as type
// arguments and the case's VALUES as one object, and hands back the machinery
// with Facet's names and Facet's types on it.
//
// WHAT THIS FILE STILL BUILDS AROUND THAT CALL, AND WHY. Three things, and each
// is a fact about FACET rather than a gap in the kit. An earlier revision of this
// header named three reasons for hand-rolling the whole of `createHarness`; all
// three are now the kit's, and what is written below is what is left:
//
//   - THE REQUEST LOG. `assets/` reads WHERE a build loaded from — that a produced
//     file was asked for at all, that it was named page-relative rather than from
//     the origin root, and which one never arrived. That log has to be attached
//     before the page navigates, which is exactly the window
//     `HarnessOptions.beforeLoad` opens: the kit hands the case its Playwright
//     page after it is opened and before the build is fetched into it.
//   - THE SERVED TREE A CHECK POSES. `specs/assets.md` says the site is played
//     back "mounted under a per-run sub-path", so `basePath` opens the page under
//     one. NOTHING IS REFUSED: every request the build makes is answered,
//     including one the build rooted at the origin, and the verdict is read off
//     the paths the build itself resolved rather than off a withheld file.
//   - THE CUE AND THE BED, TOLD APART. `specs/ui.md` puts nine one-shot cues and
//     two looping music beds under this game, and a bed starting as a screen
//     changes must not answer a check about a cue. See {@link watchCues} and
//     {@link watchLoops} for how the two are separated, and what each costs.
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
// server and the browser once for the whole project; the kit takes a page off
// them per harness, so every check drives a build that has just started and no
// check can be affected by what the one before it pressed, opened or muted.

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inject } from "vitest";
import type { Page } from "playwright";
import {
  ConstantClock,
  JitterClock,
  PROVIDE_URL_KEY,
  RECORDER_READY_TIMEOUT_MS,
  SequenceClock,
  callsTo,
  captureReplay as captureBaseReplay,
  captureStill as captureBaseStill,
  closeWorkerBrowser,
  createCaseHarness,
  drawnText,
  drawnTextLines,
  drewTextAnywhere,
  mediaDestination as mediaPath,
  setsOf,
  type Clock,
  type DrawCall,
  type Harness as BaseHarness,
  type Pixel,
  type Point,
  type TimedCue as BaseTimedCue,
  type UntilOptions as BaseUntilOptions,
  type UntilResult as BaseUntilResult,
  type Viewport,
} from "./case-harness/index";
import { fail } from "./assert";
import {
  type ActionName,
  BINDINGS,
  DEFAULT_SEED,
  HANDLE,
  MAX_CHAIN_STEPS,
  PATCH_HALF,
  STAGE_H,
  STAGE_W,
  SWAP_DRIVE_FRAMES,
  TICK_HZ,
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
 * A source of frame deltas, in milliseconds, and the three schedules a check may
 * drive under.
 *
 * THE SHARED HARNESS'S, not this project's. Under the two engines these are
 * re-exported from the engine package, so a suite imports its clocks from
 * `./harness` whichever engine ran and the three read the same; there is no
 * engine here to re-export from, so they come from `@clockwyrks/case-harness`,
 * whose copies are the same names, the same behavior and the same seeded jitter
 * constants. What this project does with a delta is its own: each one becomes a
 * `__facet.advance(dt / 1000, 1)`.
 */
export { ConstantClock, JitterClock, SequenceClock };
export type { Clock };

/* -------------------------------------------------------------------------- */
/* What a check reads                                                         */
/* -------------------------------------------------------------------------- */

/**
 * One recorded operation on the 2D context, in the order the render made it, and
 * where a `fillText` put its run.
 *
 * THE SHARED HARNESS'S, because the document a replay is written as is the
 * console player's rather than this case's: the recorder that produces these is
 * the package's injected one, and the two have to agree call for call.
 */
export type { DrawCall, TextGeometry } from "./case-harness/index";

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
 * which is what every `none` audio check reads. The shared harness's own cue
 * carries the frame and the time and nothing else, so every cue this project
 * hands a check is widened into this shape at the moment it is heard — see
 * {@link watchCues}.
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

/**
 * A device pixel as the canvas holds it.
 *
 * THE SHARED HARNESS'S. `Rgba` is this case's name for the package's `Pixel`,
 * kept because the two engine projects' harnesses spell it that way too and the
 * same suite text has to compile against all three.
 */
export type Rgba = Pixel;

/** A square of device pixels read off the canvas, centered on a cell. */
export interface Patch {
  /** The half-size the box was read at, in logical units. */
  half: number;
  width: number;
  height: number;
  /** RGBA, four bytes per pixel, row-major. */
  data: Uint8ClampedArray;
}

/**
 * How the stage is mapped onto the canvas: one uniform scale and a letterbox.
 *
 * THE SHARED HARNESS'S, and the same shape the two engine projects re-export
 * from their engine.
 */
export type { Viewport };

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
   * The sub-path the built site is served from. Defaults to `"/"`.
   *
   * `specs/assets.md` says the site "is not guaranteed to be served from the root
   * of its origin; it is played back mounted under a per-run sub-path". A non-root
   * value opens the page under that sub-path, so a page-relative URL resolves
   * from there and a root-absolute one resolves somewhere else — which is what
   * `assets/assets-load-page-relative` reads off the request log. Every request
   * is still answered, whichever of the two it is.
   */
  basePath?: string;
}

/** How far a sweep may run, and how many frames separate two samples. */
export type UntilOptions = BaseUntilOptions;

/** What a sweep found: whether the predicate ever held, and where it stopped. */
export type UntilResult = BaseUntilResult<FacetSnapshot>;

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

/** The build's surface, as every check in this project drives it. */
export type FacetSurface = AsyncSurface<FacetWindowApi>;

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
   * Read off `window.__facet` by the shared harness and never constructed there:
   * what a check drives is the build's own deliverable either way, and a harness
   * that assembled one would be grading a build against itself.
   */
  readonly debug: FacetSurface;
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
   * through, and what keeps them correct at a `dpr` other than 1. It is the
   * shared harness's UNROUNDED reading (`cssPoint`) rather than its `css`, which
   * answers the CSS position of the whole device pixel a logical point lands on:
   * the two agree wherever the device point is already whole, which is every
   * shape but the ones a fit check runs at, and this is the one the pointer has
   * always been moved through here.
   */
  client(x: number, y: number): Point;

  /** Run exactly one frame and hand back every operation its render issued. */
  frameCalls(): Promise<DrawCall[]>;
  /**
   * Run one frame and hand back what that frame put on screen: its draw calls,
   * and the page's own RENDERED DOM text beside them.
   *
   * Both halves, because `specs/assets.md` says the chrome is "drawn in code
   * (canvas or DOM)" and an engineless build is entitled to either. A DOM
   * string counts only where it is on screen: an element hidden by `display`,
   * `visibility`, a zero `opacity` or a zero-sized box has drawn nothing, so a
   * check that reads an ABSENCE reads the frame rather than the document.
   *
   * A check asks {@link frameShows} whether the copy is on screen rather than
   * looking for it in either half itself: a build that letter-spaces a title
   * issues one `fillText` per GLYPH, and only the shared harness's reading over
   * the logical runs those measured glyphs coalesce into spells `"FACET"` out of
   * `"F", "A", "C", "E", "T"`.
   */
  frameText(): Promise<FrameText>;
  /**
   * Reflect the surface WITHOUT invoking it: the `typeof` of each name.
   *
   * A `typeof` and nothing more, so the version's VALUE is not reported here.
   * `specs/instrumentation.md` puts that value in two places, and each has its
   * own reader: the surface's own member is {@link Harness.debugVersion} and
   * the snapshot's is `(await h.snapshot()).version`. Both spellings are the
   * same under all three engines.
   *
   * NARROWER THAN THE SHARED HARNESS'S `probe`, DELIBERATELY. That one answers
   * the version beside the `typeof` table, in one crossing; this hands back the
   * table alone, so the two readings `specs/instrumentation.md` names stay two
   * readings and a check cannot take the version off a probe that was asked
   * about operations.
   */
  probe(names: readonly string[]): Promise<Record<string, string>>;
  /**
   * The `version` the surface itself carries, as a VALUE.
   *
   * `specs/instrumentation.md` puts the version in two places — on the surface
   * ("carries `version` … a plain number") and in the snapshot — so
   * `instrumentation/debug-api-version` reads both, and this is the surface half.
   * One spelling under all three engines.
   */
  debugVersion(): Promise<number>;

  /** How the stage is mapped onto this harness's canvas. */
  viewport(): Viewport;
  /** Where a logical point lands in the canvas's backing store. */
  device(x: number, y: number): Point;
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
   * IT COUNTS BEDS AS WELL AS CUES, and it has to: the sound a title screen makes
   * is a LOOPING one, so a warm-up that waited for a one-shot would wait out its
   * whole allowance on a perfectly conformant build.
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

/** The specification a surface fault points the build's author at. */
const SPEC_PATH = "specs/instrumentation.md";

/** The ground a replay is composited over when a frame paints no background. */
export const REPLAY_BACKGROUND = "#000";

/**
 * The page global this project's cue accounting is read off.
 *
 * NOT the package's own `__tcabAudio`, and the difference is the whole of how a
 * cue and a bed are told apart here — see {@link watchCues}. `audio-cues.js` is
 * injected after the package's probe and narrows it to the ONE-SHOTS.
 */
const AUDIO_GLOBAL = "__facetCues";

/**
 * Facet, as the shared harness needs to know it.
 *
 * ONE OBJECT, and every value in it is the case's: the global the specification
 * told the build to install its surface on, the operations that specification
 * requires, the logical stage its coordinates are stated in, and the rate this
 * suite steps at. The package's browser, its context, its recorder and its
 * surface probe are all driven from here, so nothing about Facet is baked into
 * the package and nothing about the package is baked into a figure of Facet's.
 *
 * `projectRoot` MUST come from this module and never from the package's: the
 * package is staged one directory deeper, and a produced replay or still is
 * addressed relative to it. Taken from the package every output would be
 * addressed one level too deep, and silently, since a writer that raised on a
 * failed write would be blaming the build for the host's problem.
 */
const kit = createCaseHarness<FacetSnapshot, FacetSurface>({
  slug: "facet",
  handle: HANDLE,
  requiredOps: REQUIRED_OPS,
  // `advance(seconds, frames)`: a span of simulated time divided into whole
  // frames, so the harness's clock decides how long a frame is.
  step: { kind: "seconds-frames", op: "advance" },
  stage: { width: STAGE_W, height: STAGE_H },
  tickHz: TICK_HZ,
  defaultSeed: DEFAULT_SEED,
  // Measure every text call a frame made, in the page and under the build's own
  // loaded fonts, so the shared harness's readers over LOGICAL RUNS of text can
  // coalesce a heading drawn a glyph at a time back into the word it spells;
  // without a width every draw is a point and nothing merges. `frameShows`
  // reads those runs.
  measureText: true,
  // A GENUINE browser gesture, so the build's audio context can open: a build is
  // free to open its audio from a real DOM event alone, so a gesture delivered
  // any other way would leave a perfectly good build silent. A KEY rather than a
  // click, because Facet's pointer works the board and every screen's targets, so
  // a press anywhere is a press on something. `UNBOUND_KEY` is bound to nothing
  // in specs/controls.md's whole binding table.
  arm: { kind: "key", code: UNBOUND_KEY },
  // A build installs its surface while its entry module runs, so a page that has
  // fired `load` has either installed it already or is not going to. Facet's
  // build decodes its whole produced asset set before its first frame, so the
  // wait is the generous one rather than the short one.
  surfaceTimeoutMs: 15_000,
  specPath: SPEC_PATH,
  replayBackground: REPLAY_BACKGROUND,
  // The narrowed cue counter, and the script that installs it. `audio-cues.js`
  // is an `extraInitScript`, so it runs AFTER the package's own audio probe and
  // has one to wrap; it is resolved against `projectRoot`, which is why that
  // field has to be the case's.
  audioGlobal: AUDIO_GLOBAL,
  extraInitScripts: ["audio-cues.js"],
  projectRoot: PROJECT_ROOT,
});

export const { fitViewport, failSurface, SURFACE_REQUIREMENT, seconds } = kit;

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

/** Real milliseconds a warm-up waits between attempts, and how many it makes. */
const AUDIO_WARM_POLL_MS = 50;
const AUDIO_WARM_ATTEMPTS = 40;

/**
 * The browser, the instrumented context, and the pages this worker opened.
 *
 * ALL THREE ARE THE SHARED HARNESS'S. Connecting to the one Chromium
 * `globalSetup.ts` launched, opening one context per WINDOW SHAPE with the
 * draw-command recorder and the audio probe installed on it before a line of the
 * build's script runs, holding a page per harness inside that context, and
 * shutting the lot when the worker's last file is done — none of that is about
 * Facet, and it lives in `@clockwyrks/case-harness`.
 */
export { closeWorkerBrowser };

/* -------------------------------------------------------------------------- */
/* Cue sinks                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A sink of the SHARED harness's shape that widens every cue it is handed into
 * this project's.
 *
 * The package's cue is the frame and the simulated time and nothing else, which
 * is all an engineless page can report; this case's carries `cue` and `gain` as
 * documented absences so that one {@link TimedCue} reads the same in all three
 * projects. The widening happens at the moment a sound is heard rather than at
 * the moment a check reads, so a list handed to a check is complete as it stands
 * and never has to be refreshed.
 */
function widenInto(cues: TimedCue[]): BaseTimedCue[] {
  return Object.assign([] as BaseTimedCue[], {
    push(...heard: BaseTimedCue[]): number {
      for (const cue of heard) {
        cues.push({
          cue: null,
          t: cue.t,
          gain: Number.NaN,
          frame: cue.frame,
          loop: false,
        });
      }
      return cues.length;
    },
  });
}

/** The shared harness behind each of this project's, for the package's writers. */
const bases = new WeakMap<Harness, BaseHarness<FacetSnapshot, FacetSurface>>();

/** Where {@link watchLoops} attaches, per harness. */
const harnessLoops = new WeakMap<Harness, TimedCue[][]>();

/** The shared harness a check's own is built over, or a loud failure. */
function baseOf(h: Harness): BaseHarness<FacetSnapshot, FacetSurface> {
  const base = bases.get(h);
  if (base === undefined) {
    throw new Error(
      "facet: this harness was not built by createHarness, so the shared " +
        "harness behind it is unknown",
    );
  }
  return base;
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
  const seed = options.seed ?? DEFAULT_SEED;
  const basePath = normalizeBasePath(options.basePath ?? "/");
  const mounted = basePath !== "/";

  // Every file the page asked for, and every file it asked for and did not get.
  // An asset item reads both: the whole log says WHERE a build loads from, and
  // the failures say which produced file never arrived — neither of which a
  // snapshot can show.
  const requests: string[] = [];
  const failedRequests: string[] = [];
  const assetFailures: AssetFailure[] = [];

  /**
   * Watch this page's traffic, and pose the mount when the caller asked for one.
   *
   * BOTH HAVE TO BE IN PLACE BEFORE THE PAGE NAVIGATES, which is the one moment
   * `HarnessOptions.beforeLoad` exists for: a listener attached afterwards would
   * miss the document and the first files it pulled in, and a route installed
   * afterwards would not be there for them either.
   */
  const watch = async (page: Page): Promise<void> => {
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

    // THE MOUNT IS THE HARNESS'S, NOT THE SERVER'S. The static server the shared
    // harness runs publishes the build at the origin root and nowhere else, so
    // the sub-path `specs/assets.md` describes — "it is played back mounted under
    // a per-run sub-path, a path like `/runs/<id>/build/`" — is posed here: a
    // request that stays inside the mount has the mount stripped off before the
    // server sees it.
    //
    // NOTHING IS REFUSED. Every request the build makes is answered, including
    // one the build rooted at the origin, which reaches the published tree
    // unchanged. The record of what the build asked for is what a check reads —
    // `requests` holds every URL — so `assets/assets-load-page-relative` decides
    // its point off the paths the build resolved rather than off a withheld file,
    // and every produced file stands up for every check this project runs. A
    // route is installed only when a mount is actually posed, so the ordinary
    // harness carries no interception at all.
    if (!mounted) return;
    await page.route("**/*", (route, request) => {
      const path = pathOf(request.url());
      if (!path.startsWith(basePath)) {
        void route.continue();
        return;
      }
      const under = new URL(request.url());
      under.pathname = `/${path.slice(basePath.length)}`;
      void route.continue({ url: under.href });
    });
  };

  const base = await kit.createHarness({
    clock: options.clock,
    cssWidth: options.cssWidth,
    cssHeight: options.cssHeight,
    dpr: options.dpr,
    seed,
    beforeLoad: watch,
  });

  if (mounted) {
    // THE PAGE IS OPENED AT THE MOUNT, AND THAT TAKES A SECOND NAVIGATION. What
    // decides `assets/assets-load-page-relative` is where the DOCUMENT sits: a
    // page-relative URL resolves against it and a root-absolute one does not, and
    // the item reads the paths the build actually resolved. The shared harness
    // navigates to the origin root, which is the right default for every other
    // check here and the wrong document for this one, so the page is re-opened
    // under the mount and the log emptied first — what a check reads is what the
    // build asked for FROM THE MOUNT, and the harness's own first load is neither
    // the build's doing nor part of the question.
    requests.length = 0;
    failedRequests.length = 0;
    assetFailures.length = 0;
    await base.page.goto(new URL(basePath, inject(PROVIDE_URL_KEY)).href, {
      waitUntil: "load",
    });
    if (base.surfaceFault === null) {
      // The opening the shared harness performs on its own navigation, performed
      // again on this one: off the wall clock, back to a known title screen on
      // this harness's seed, and a recorder over the surface before a check can
      // arm one. A build is free to ask for its 2D context on the frame it first
      // draws, so the surface can be answering before any context exists to
      // record — and a `captureReplay` armed in that window writes no evidence.
      await base.debug.setAutoStep(false);
      await base.debug.reset({ seed });
      await base.page
        .waitForFunction(
          (recorder) =>
            (window as unknown as Record<string, { ready(): boolean }>)[
              recorder
            ]?.ready() === true,
          base.config.recorderGlobal,
          { timeout: RECORDER_READY_TIMEOUT_MS, polling: 100 },
        )
        .catch(() => undefined);
    }
  }

  // The harness's own standing log of everything it heard, registered like any
  // other watcher so `h.cues` and a sink from `watchCues` are the same mechanism.
  const cues: TimedCue[] = [];
  base.cues.push(widenInto(cues));

  const loopSinks: TimedCue[][] = [];
  const loops: TimedCue[] = [];
  loopSinks.push(loops);

  /**
   * How many looping starts have already been accounted to a frame.
   *
   * The page's probe counts cumulatively, so what a drive started is the
   * difference across it.
   */
  let heardLoops = 0;

  /**
   * Stamp every bed that started since the last drive onto the frame the drive
   * ended on.
   *
   * WHY A BED IS COUNTED HERE AND A CUE IS NOT. The shared harness reads the
   * page's sound counter on both sides of each driven FRAME, so a one-shot is
   * attributed exactly; `audio-cues.js` narrows that counter to the one-shots, so
   * `h.cues` and a `watchCues` list hold cues alone and a bed starting on a screen
   * change cannot answer for one. What the same crossing cannot also carry back is
   * the LOOP count, so a bed is read at the boundary of the drive rather than
   * inside it, and its `frame` is the frame that drive ended on. That is the whole
   * of the reduction, and it costs a point nothing: `specs/ui.md` puts one bed
   * under each screen and `audio/music-round` asks whether a FURTHER piece started
   * once the round had begun, which is a question about the run of the drive and
   * not about which of its frames.
   *
   * WHAT IT COSTS is one crossing per drive, paid whether or not a check is
   * watching for a bed — a few milliseconds against the tens the drive itself
   * costs. It is paid unconditionally rather than only for a harness that has
   * opened a loop watch, because a watch opened later would then start from a
   * counter nothing had been reading, and would report every bed the build had
   * already begun as one it began after the watch opened.
   */
  const noteLoops = async (): Promise<void> => {
    if (base.surfaceFault !== null) return;
    const total = await base.loopStarts();
    for (; heardLoops < total; heardLoops += 1) {
      for (const sink of loopSinks) {
        sink.push({
          cue: null,
          t: base.timeMs(),
          gain: Number.NaN,
          frame: base.frame(),
          loop: true,
        });
      }
    }
  };

  /** Every sound the page has emitted, beds included: what a warm-up waits for. */
  const soundsHeard = async (): Promise<number> =>
    base.page.evaluate((probe) => {
      const audio = (
        window as unknown as Record<
          string,
          { started(): number; loopStarts(): number }
        >
      )[probe];
      return audio === undefined ? 0 : audio.started() + audio.loopStarts();
    }, AUDIO_GLOBAL);

  const drive = async (frames: number): Promise<void> => {
    await base.advance(frames);
    await noteLoops();
  };

  const frameCalls = async (): Promise<DrawCall[]> => {
    const drawn = await base.frameCalls();
    await noteLoops();
    return drawn;
  };

  const tap = async (code: string): Promise<void> => {
    await base.tap(code);
    await noteLoops();
  };

  const harness: Harness = {
    page: base.page,
    debug: base.debug,
    surfaceFault: base.surfaceFault,
    pageErrors: base.pageErrors,
    failedRequests,
    requests,
    assetFailures,
    cues,
    loops,

    frame: () => base.frame(),
    timeMs: () => base.timeMs(),

    snapshot: () => base.snapshot(),
    board: async () => renderBoard(await base.snapshot()),

    advance: drive,

    async advanceSeconds(span, frames = 1) {
      await base.advanceSeconds(span, frames);
      await noteLoops();
    },

    async until(predicate, untilOptions) {
      const swept = await base.until(predicate, untilOptions);
      await noteLoops();
      return swept;
    },

    async runFor(ms) {
      await base.runFor(ms);
      await noteLoops();
    },

    hold: (code) => base.hold(code),
    release: (code) => base.release(code),
    tap,
    tapAction: (action) => tap(BINDINGS[action][0]),

    async press(x, y) {
      await base.movePointer(x, y);
      await base.page.mouse.down();
    },
    moveTo: (x, y) => base.movePointer(x, y),
    lift: () => base.page.mouse.up(),
    client: (x, y) => base.cssPoint(x, y),

    frameCalls,

    async frameText() {
      const calls = await frameCalls();
      const dom = await base.page.evaluate(() => {
        const found: string[] = [];
        const skip = new Set([
          "SCRIPT",
          "STYLE",
          "NOSCRIPT",
          "TITLE",
          "TEMPLATE",
        ]);
        // WHAT IS RENDERED, NOT WHAT IS IN THE DOCUMENT. A build that keeps a
        // readout in the DOM and hides it while it does not apply has drawn
        // nothing, and a reading that could not tell that apart from an absent
        // element would decide document membership rather than the frame. So a
        // text node whose nearest rendered ancestor is hidden — by `display`, by
        // `visibility`, by a zero `opacity`, or by carrying no box at all — is
        // not text this frame put on screen.
        //
        // `display: contents` IS EXEMPT FROM THE BOX. Such an element carries no
        // box of its own while every word inside it is drawn, so reading its
        // rectangle would take a conformant build's whole HUD off the frame.
        const shown = (element: Element | null): boolean => {
          for (let at = element; at !== null; at = at.parentElement) {
            const style = getComputedStyle(at);
            if (
              style.display === "none" ||
              style.visibility === "hidden" ||
              style.opacity === "0"
            ) {
              return false;
            }
            if (style.display === "contents") continue;
            const box = at.getBoundingClientRect();
            if (box.width === 0 && box.height === 0) return false;
          }
          return true;
        };
        const walker = document.createTreeWalker(
          document.body,
          NodeFilter.SHOW_TEXT,
        );
        while (walker.nextNode()) {
          const parent = walker.currentNode.parentElement;
          if (parent !== null && skip.has(parent.tagName)) continue;
          if (!shown(parent)) continue;
          const text = (walker.currentNode.nodeValue ?? "").trim();
          if (text !== "") found.push(text);
        }
        return found;
      });
      return { calls, dom };
    },

    probe: async (names) => (await base.probe(names)).ops,

    debugVersion: async () => (await base.probe([])).version as number,

    viewport: () => base.viewport(),
    device: (x, y) => base.device(x, y),
    pixel: (x, y) => base.pixel(x, y),
    pixels: (points) => base.pixels(points.map(({ x, y }) => ({ x, y }))),

    /**
     * THE BOX IS CUT INSIDE THE PAGE, which is where the arithmetic belongs under
     * this engine: the pixels are in the browser, so the cell center, the box's
     * size and its clamp are worked out BESIDE the `getImageData` that reads them
     * and one crossing carries back the whole box. The shared harness's own
     * `pixelRect` addresses a rectangle by its TOP-LEFT and clamps its SIZE at an
     * edge; this one is centered on a cell and clamps its ORIGIN, so the box is
     * `2 * round(half * scale) + 1` device pixels on a side — ODD, so it sits on
     * the cell center rather than half a pixel off it — and it is that size
     * wherever the cell sits. {@link patchDistance} is a MEAN over the box, so a
     * box that changed shape near an edge would make two readings of one cell
     * answer differently for the box rather than for what was drawn in it.
     */
    async patch(col, row, half = PATCH_HALF) {
      const view = base.viewport();
      const center = cellCenter(col, row);
      const middle = base.device(center.x, center.y);
      const reach = Math.max(1, Math.round(half * view.scale));
      const box = await base.page.evaluate(
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
          if (ctx === null) {
            throw new Error("facet: the canvas has no 2D context");
          }
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

    surface: () => base.surface(),

    armAudio: () => base.armAudio(),

    async warmAudio() {
      await base.armAudio();
      for (let attempt = 0; attempt < AUDIO_WARM_ATTEMPTS; attempt += 1) {
        // A frame, so the build asks for the screen's bed and for anything else it
        // plays from `update`; then real time, so a decode that frame kicked off
        // can finish.
        await drive(1);
        if ((await soundsHeard()) > 0) return true;
        await base.page.waitForTimeout(AUDIO_WARM_POLL_MS);
      }
      return (await soundsHeard()) > 0;
    },

    settle: (ms) => base.page.waitForTimeout(ms),

    dispose: () => base.dispose(),
  };

  bases.set(harness, base);
  harnessLoops.set(harness, loopSinks);
  return harness;
}

/* -------------------------------------------------------------------------- */
/* Draw calls                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * One operation as the injected recorder writes it, and its reading as a
 * {@link DrawCall}.
 *
 * THE SHARED HARNESS'S, both of them: the recorder that writes these is the
 * package's, so the shape it writes and the reading of it are the package's too.
 */
export { toDrawCall, type RecordedOp } from "./case-harness/index";

/**
 * Every call to `method`, and every value `property` was set to, in order.
 *
 * THE SHARED HARNESS'S. Both walk the recorder's own list and neither has an
 * opinion about Facet.
 */
export { callsTo, setsOf };

/**
 * Every string the frame drew: the `fillText` runs in call order, then the
 * `strokeText` runs in call order.
 *
 * THE SHARED HARNESS'S, and the two channels are kept apart there for the reason
 * this case needs them kept apart: a build that outlines its title issues a
 * `strokeText` and a `fillText` for each glyph, and a single list in true call
 * order would read `F F A A C C E E T T` — a run that spells nothing. Listed by
 * channel, each channel spells the copy on its own.
 */
export { drawnText };

/**
 * What one frame put on screen, as {@link Harness.frameText} hands it back.
 *
 * TWO HALVES, because `specs/assets.md` says the chrome is "drawn in code
 * (canvas or DOM)" and an engineless build is entitled to either: the
 * operations the frame's render issued, and the strings the page's own RENDERED
 * document shows beside the canvas. They are kept apart rather than folded into
 * one list because they are read differently — the calls by the shared
 * harness's readers over the logical runs they spell, the document by the same
 * comparison over its strings — and a check reads them together through
 * {@link frameShows}.
 */
export interface FrameText {
  /** Every operation the frame's render issued, as {@link Harness.frameCalls}. */
  calls: DrawCall[];
  /**
   * Every text node the document shows, trimmed, in document order.
   *
   * WHAT IS RENDERED, NOT WHAT IS IN THE DOCUMENT: a text node whose nearest
   * rendered ancestor is hidden — by `display`, by `visibility`, by a zero
   * `opacity`, or by carrying no box at all — has drawn nothing and is not here,
   * so a check that reads an ABSENCE reads the frame rather than the document.
   */
  dom: string[];
}

/**
 * Whether `wanted` is on screen: spelled by the frame's draw calls, or shown by
 * the rendered document.
 *
 * THE CANVAS HALF IS THE SHARED HARNESS'S `drewTextAnywhere`, and it is what
 * decides every build that draws its chrome on the canvas. `specs/ui.md` fixes
 * the COPY — `FACET`, `PRESSURE FINDS THE FLAW`, `SCORE`, `PLAY AGAIN` — and
 * fixes nothing about how many draw calls a build spends on it, and that reading
 * finds one call per line, one per word, one per glyph, an entry decorated with
 * a marker, and a title letter-spaced under a drop shadow alike: the measured
 * glyphs are coalesced into the logical runs they spell, every run of the frame
 * is joined, and `wanted` is matched as a substring of that, ignoring case and
 * whitespace.
 *
 * THE DOCUMENT HALF IS THE SAME COMPARISON over the strings the rendered page
 * shows, so a build that keeps its HUD in the DOM is read by the rule the canvas
 * is. It is the one thing Facet reads that the shared harness does not, and it
 * is the whole reason this reader exists beside the package's.
 *
 * BOUNDED THE WAY ANY READING OVER A JOINED FRAME IS: a search over the joined
 * text can find a phrase that spans two adjacent runs, so this decides that copy
 * IS on screen and NEVER that two pieces of copy are separate. An item about two
 * readouts asks about each of them; an item that asserts copy is ABSENT asserts
 * the absence of that one string and pairs it with a frame that does show it, so
 * an accidental join shows up as the two frames agreeing rather than as a
 * verdict.
 */
export function frameShows(frame: FrameText, wanted: string): boolean {
  return (
    drewTextAnywhere(frame.calls, wanted) || documentShows(frame.dom, wanted)
  );
}

/**
 * Whether the rendered document shows `wanted`: the comparison
 * `drewTextAnywhere` makes, over the document's strings rather than a frame's
 * runs — joined, whitespace folded out of both sides, matched ignoring case.
 */
function documentShows(dom: readonly string[], wanted: string): boolean {
  const fold = (value: string): string =>
    value.replace(/\s+/gu, "").toLowerCase();
  return fold(dom.join(" ")).includes(fold(wanted));
}

/**
 * The text a frame shows, as the strings a failure is worded with: the logical
 * runs its calls spell (the shared harness's `drawnTextLines`), then the
 * document's. For reading a frame's copy, {@link frameShows} is the reader;
 * this is what a check prints beside the copy the screen owed.
 */
export function shownText(frame: FrameText): string[] {
  return [...drawnTextLines(frame.calls), ...frame.dom];
}

/**
 * The operations a frame spends on MAKING a picture, as against the ones that
 * set up a style or a transform to make it with.
 *
 * FACET'S OWN LIST, and it is one entry shorter than the shared harness's: that
 * one also counts `putImageData`, which is a blit of pixels a check here has
 * never counted as a draw. One list in all three projects, so `drawOps` returns
 * the same count for the same render whichever engine drove it — and folding it
 * into the package's would move that count on any build that blits.
 *
 * Path construction is in it because a build that draws a gem as a path spends
 * its whole render there and would otherwise read as a frame that painted
 * nothing, and `drawImage` is in it because a check about produced sprites asks
 * whether the frame drew an image at all.
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

/**
 * The device-pixel box centered on a cell's center.
 *
 * `half` defaults to `PATCH_HALF` (20) LOGICAL units, so the box sits inside
 * `GEM_R` (30), where the gem's own form is drawn, and clear of every neighbor,
 * whose nearest center is `CELL_PITCH` (72) away.
 *
 * A hand-off to {@link Harness.patch}, which is where the arithmetic lives under
 * this engine and which says why. Under the two engines the canvas is in this
 * process, so the same arithmetic sits in this function's own body there.
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
 * THE PRESENCE INSTRUMENT. Per-pixel rather than between the two mean colors,
 * because two patches with identical means can still differ in every pixel, so a
 * mean would call a cell unchanged that the build redrew. Every check that reads
 * it asks one question of the number — whether it is zero — and a check that
 * asked how LARGE it is would be grading a build's palette, its contrast or its
 * treatment, which the reviewer judges and no check here may.
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

/* -------------------------------------------------------------------------- */
/* Evidence capture                                                           */
/* -------------------------------------------------------------------------- */
//
// A review item may declare a `replay` OUTPUT beside its verdict: the frames the
// build itself drew while a check drove it, kept as evidence a reviewer can scrub
// against the reference implementation's. Four properties make it usable, and each
// is deliberate, and all four are the shared harness's:
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

/**
 * Where a produced output is written, and under what name.
 *
 * THE SHARED HARNESS'S: the address is `validation/<suite path>/<id>.<ext>`
 * under the directory the runner names in `TCAB_VALIDATION_MEDIA_DIR`, and that
 * address is the runner's contract rather than this case's. `PROJECT_ROOT` is
 * passed in from THIS module, never from the package's — the package is staged
 * one directory deeper, and taken from there every output would be addressed one
 * level too deep, silently, since a writer that raised on a failed write would
 * be blaming the build for the host's problem.
 */
export { MEDIA_DIR_ENV, STAGED_PROJECT_DIR } from "./case-harness/index";

/** Where the running suite's `outputId` output belongs, or `null` when nothing is collecting. */
export function mediaDestination(
  outputId: string,
  extension: string,
): string | null {
  return mediaPath(PROJECT_ROOT, outputId, extension);
}

/**
 * The replay document, exactly as the console's player reads it.
 *
 * THE SHARED HARNESS'S, every type of it. The format is the console's
 * (`packages/ui`), the injected recorder that writes it is the package's, and
 * the two have to agree field for field — so neither half is Facet's to restate.
 */
export type {
  RecordedFrame,
  RecordedPathSegment,
  RecordedResource,
  RecordedState,
  Recording,
} from "./case-harness/index";

/**
 * The recorder's frames folded into the shared document, and that document cut
 * down to what a reviewer can scrub.
 *
 * THE SHARED HARNESS'S, both of them. `retable` interns a run of frames into the
 * op, state and resource tables the console's player reads, and `thinReplay`
 * decimates a long section to {@link MAX_REPLAY_FRAMES} evenly across its whole
 * span. Neither is about Facet, and both have to agree with the player.
 */
export { retable, thinReplay } from "./case-harness/index";

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
export function captureReplay<T>(
  h: Harness,
  outputId: string,
  scenario: () => T | Promise<T>,
): Promise<T> {
  return captureBaseReplay(baseOf(h), outputId, scenario);
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
export function captureStill(h: Harness, outputId: string): Promise<void> {
  return captureBaseStill(baseOf(h), outputId);
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
 * build's. So the shared harness's injected probe watches the two doors a browser
 * can emit sound through (a Web Audio source being `start()`ed, whatever kind it
 * is, and a media element being played) and counts what goes through them; the
 * harness brackets each driven frame around that count, so a sound is attributed
 * to the frame that produced it. A blip made of two oscillators counts as two,
 * which is why a check asserts that a frame SOUNDED rather than how many times.
 *
 * WHY ONE-SHOTS ALONE, AND HOW. `specs/ui.md` also puts two looping music beds
 * under the game, and one of them is playing on every screen. A bed starting as a
 * screen changes is not the cue an item is about, so it must not answer for one —
 * and the shared probe counts every start alike. `audio-cues.js` closes that: it
 * is injected after the package's probe and stands a NARROWED one beside it,
 * whose `started()` is the one-shots alone, and `CaseConfig.audioGlobal` points
 * the harness at that. So the per-frame counter the drive reads is a count of
 * CUES, and the beds are kept apart in {@link watchLoops}.
 */
export function watchCues(h: Harness): TimedCue[] {
  const played: TimedCue[] = [];
  baseOf(h).cues.push(widenInto(played));
  return played;
}

/**
 * Record every LOOPING start: what the two music beds are under `specs/ui.md`.
 *
 * Stamped with the frame the DRIVE that started it ended on rather than with the
 * frame itself, for the reason `createHarness`'s own note gives: the page's loop
 * counter is not carried back by the crossing that runs the frames, so it is read
 * at the boundary. Every drive this harness makes reads it, so a bed cannot be
 * missed — only placed at the end of the drive that started it.
 */
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
// and `QUIT` really returns to the title is what the two `screens/start-round-*`
// points, `levels/continue-opens-next-level` and the two `screens/quit-from-*`
// points decide, by
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
