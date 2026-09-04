// Facet — the shared validator harness for `simple-2d`. CASE-PROVIDED.
//
// Every check in this suite is an ordinary vitest test that runs IN THE SAME
// PROCESS as the build. It imports the engine and the build's own `src/game`,
// builds an engine over a canvas it owns and a clock it chose, and steps the
// game with `engine.advance`. Nothing drives a browser, nothing polls, and no
// wall-clock time passes: a check asks for a number of frames and gets exactly
// that number, at exactly the deltas its clock supplied.
//
// WHAT A CHECK READS. The game's own state (through the surface's `snapshot`),
// the engine's frame counter, the events the engine broadcast (`cue:played`,
// `cue:looped`, `asset:failed`), and — for the drawing checks — the pixels on
// the canvas or the calls the 2D context received. Nothing here fabricates an
// outcome: the scenario helpers only ARRANGE the world through the debug
// surface, and the real `update` the build wrote is what runs from there.
//
// WHY THE DEBUG SURFACE RATHER THAN RAW ASSIGNMENT. specs/instrumentation.md
// fixes its operations, so they mean the same thing in every build:
// `loadBoard(rows)` poses the exact board a check wrote, `requestSwap` goes
// through the same acceptance path a player's swap takes, and `reset({ seed })`
// gives everything back. Posing through it is how a scenario is reproducible,
// and it is the seam the case's specification documents. `surface.ts` is that
// specification as types, and it is the ONLY description of the surface this
// harness reads: the build's own module for it is never imported.
//
// WHAT THIS HARNESS TAKES FROM THE BUILD, AND WHAT IT DOES NOT. It reads three
// names off `../src/game`, the build's entry, and they are read BY NAME, one
// binding at a time: the values `game` and `BACKGROUND`, which are what
// `createEngine` needs and are the build's two named deliverables there, and the
// type `FacetState`, which is erased before anything runs. That is the whole
// list, and a list a reader can count is the point: a namespace binding would
// name the same module and hand this file everything in it.
// It reads NO figure from `../src/constants`: every number comes from the
// case's own `./constants`, so a build that edited the file it was told not to
// edit is still held to the specification. It could not be otherwise in any
// case — the same three suites must read identically under `none`, where no
// such file is seeded at all.
//
// THE CLOCK. `ConstantClock(TICK_MS)` is the default, so one frame is one 64 Hz
// tick and every duration is a whole number of them — sixteen frames is exactly
// STEP_SECONDS, with no floating-point drift. `./constants` states why 64 and
// not 60. A check that is specifically about the step size builds its own
// harnesses with clocks of its own, or uses `advanceSeconds`.
//
// POSES DO NOT ADVANCE. No helper here runs a frame implicitly except
// `swapAndStep`, `advanceStep`, `resolveChain`, `swapAndResolve`, `frameCalls`,
// `frameText` and `tap`; `warmAudio` and `runFor` run frames too, and each says
// so where it is declared. A pose takes effect at the call, so `simTime`,
// `stepTimer` and the refusal timer stay readable exactly as the specs state
// them, and a check that needs the frame DRAWN calls `h.advance(1)` itself. A
// cue, by contrast, is played by a frame and never by a pose (specs/ui.md), so a
// check about a cue advances one.
//
// A WHOLE POINTER GESTURE IS A POSE. A press, the moves that carry it, and the
// release all take effect at their calls, so `dragGem` poses the whole of a move
// without a frame passing — which is what lets a check read the offer standing
// between two of them.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { createCanvas, type Canvas, type SKRSContext2D } from "@napi-rs/canvas";
import { expect } from "vitest";
import {
  ConstantClock,
  JitterClock,
  SequenceClock,
  createEngine,
  type CapturedImage,
  type Clock,
  type DrawOp,
  type DrawState,
  type DrawValue,
  type Engine,
  type Game,
  type PathSegment,
  type RecordedFrame,
  type Recording,
  type Resource,
  type SurfaceMetrics,
  type Viewport,
} from "@test-cabinet/simple-2d";
import type { DeepReadonly } from "ts-essentials";
import {
  BACKGROUND as buildBackground,
  game as buildGame,
  type FacetState,
} from "../src/game";
import { fail } from "./assert";
import {
  BACKGROUND_FALLBACK,
  BINDINGS,
  LAYOUT,
  MAX_CHAIN_STEPS,
  MAX_REPLAY_FRAMES,
  PATCH_HALF,
  STAGE_H,
  STAGE_W,
  SWAP_DRIVE_FRAMES,
  TICK_HZ,
  TICK_MS,
  TICK_S,
  type ActionName,
  type PointerDevice,
} from "./constants";
import {
  cellCenter,
  parseRows,
  renderBoard,
  quietRowsWith,
  quietRowsWithEscape,
  targetCenter,
  type BoardRows,
  type CellRef,
  type PlacedToken,
  type TargetRect,
} from "./board";
import {
  DEFAULT_SEED,
  READINGS,
  type FacetDebugApi,
  type FacetSnapshot,
  type Screen,
} from "./surface";
import { setAssetTransport } from "./dom-shim";

export { ConstantClock, JitterClock, SequenceClock };
export type { Clock, Viewport };

/**
 * The state type the build declares and exports.
 *
 * specs/state.md fixes that `src/game.ts` declares and exports it, so naming it
 * here holds the build to that. Nothing in this file reads a FIELD of it: the
 * one reading of the game's state a check makes is `snapshot()`, and this type
 * exists so the surface's poses are typed as the transitions they are.
 */
export type { FacetState };

/** The case's surface, bound to the state type the build declared. */
export type FacetSurface = FacetDebugApi<FacetState>;

/**
 * The build's game, typed against the surface the CASE specifies.
 *
 * The build declares its own type for the surface its `initialize` returns, and
 * that type is the build's: what a check holds it to is `surface.ts`, so the
 * game is cast to the case's `Game<FacetState, FacetSurface>` here and the
 * engine is parameterized with it. A surface that departs from the
 * specification is caught where a check reaches for the missing member, not by
 * the build's own compiler.
 */
const game = buildGame as unknown as Game<FacetState, FacetSurface>;

/**
 * The build's exported stage background (specs/overview.md).
 *
 * Guarded rather than taken as read: `BACKGROUND` is handed to the engine as the
 * color the canvas is cleared to, and a build that exported something other than
 * a color string would stand the game up on it. Nothing asserts this value, so a
 * build that got it wrong is failed by the checks that are about the picture and
 * not by every check in the project.
 */
const BACKGROUND =
  typeof buildBackground === "string" ? buildBackground : BACKGROUND_FALLBACK;

/** Seconds of simulated time in `frames` frames of the default clock. */
export function seconds(frames: number): number {
  return frames / TICK_HZ;
}

/* -------------------------------------------------------------------------- */
/* The surface, driven                                                        */
/* -------------------------------------------------------------------------- */

/**
 * A member of a pure surface, as a check calls it.
 *
 * ENGINE-ONLY, and only under THIS engine. It exists because this engine's
 * surface is pure — `(state, ...args) => state` — so the imperative
 * `h.debug.loadBoard(rows)` a check writes has to be built. `structured-2d`'s
 * surface is live and is called directly, and `none`'s crosses into a page, so
 * neither has a counterpart and neither needs one.
 *
 * A pose `(state, ...args) => S` becomes `(...args) => void`: the driver runs
 * it through `engine.apply`, so the state it returns is the state the next
 * frame receives. A reading `(state) => R` becomes `() => R`: the driver hands
 * it `engine.state`. Anything else (`version`) is carried as it is.
 */
type Driven<S, M> = M extends (state: DeepReadonly<S>, ...args: infer A) => S
  ? (...args: A) => void
  : M extends (state: DeepReadonly<S>) => infer R
    ? () => R
    : M;

/** Every member of `D`, minus its state argument, over the engine. */
export type Driver<S, D> = {
  [K in keyof D]: Driven<S, NonNullable<D[K]>>;
};

/** The surface as every check drives it. */
export type FacetDriver = Driver<FacetState, FacetSurface>;

/**
 * What the build owes when its surface is missing: the `Expected:` line of the
 * failure every check that reaches for the surface lands on, beside what
 * `engine.debug` was found holding instead.
 */
export const SURFACE_REQUIREMENT =
  "the debug surface src/game.ts's initialize returns beside its state, as " +
  "[state, debug], which the engine hands back from engine.debug " +
  "(specs/instrumentation.md)";

/**
 * Fail the check that reached for the surface, pairing what
 * specs/instrumentation.md requires with what the harness actually found.
 *
 * The one place the pair is written, so the `Expected:`/`Actual:` a reviewer
 * reads is the same sentence whichever operation was reached for and whichever
 * engine ran.
 */
export function failSurface(fault: string): never {
  return fail(SURFACE_REQUIREMENT, fault);
}

/**
 * A stand-in for the surface a build never returned: every operation on it
 * fails the check that reached for it, with the missing return named.
 *
 * A proxy rather than a stub, so an operation this harness does not itself name
 * is reported as the consequence of the missing surface rather than as merely
 * absent. Keys that belong to the RUNTIME rather than to a check are answered
 * with `undefined` instead: awaiting the harness probes `then`, and vitest's
 * own error formatting probes symbols and `constructor`.
 */
export function missingSurface(reason: string): FacetSurface {
  return new Proxy({} as FacetSurface, {
    get: (_target, property): unknown => {
      if (typeof property === "symbol") return undefined;
      if (property === "then" || property === "constructor") return undefined;
      return failSurface(reason);
    },
  });
}

/**
 * Why the surface the build returned cannot be driven, or `null` when it can.
 *
 * Two faults, and they are the two that make every operation unreachable rather
 * than one: a pair whose second element is no object at all, and an object that
 * carries no `reset` — without which no scenario can be arranged from a known
 * starting point, so nothing this harness poses would mean anything.
 */
function surfaceFaultOf(
  engine: Engine<FacetState, FacetSurface>,
): string | null {
  const surface: unknown = engine.debug;
  if (typeof surface !== "object" || surface === null) {
    return (
      `engine.debug holds ${surface === null ? "null" : typeof surface}, ` +
      `not an object`
    );
  }
  const reset = (surface as Record<string, unknown>).reset;
  if (typeof reset !== "function") {
    return `engine.debug carries no reset operation (typeof ${typeof reset})`;
  }
  return null;
}

/**
 * The debug surface the BUILD returned beside its state, read off the engine
 * that holds it.
 *
 * Deliberately a READ and never a construction. The surface is the build's
 * deliverable: its `initialize` returns `[state, debug]`, the engine keeps the
 * second element, and `engine.debug` is the only way it reaches a check.
 *
 * A pair whose second element is no surface is a fault in the BUILD, and it
 * must not present as a fault in the harness: it is not thrown from here (a
 * throw would fail the suite's `beforeEach` and bury the verdict), and it is
 * not swallowed either — {@link missingSurface} stands in and fails at the
 * moment a check first reaches for an operation.
 */
export function readDebugSurface(
  engine: Engine<FacetState, FacetSurface>,
): FacetSurface {
  const fault = surfaceFaultOf(engine);
  if (fault !== null) return missingSurface(fault);
  return engine.debug as FacetSurface;
}

/**
 * The imperative reading of the raw surface, over the engine that holds the
 * state.
 *
 * A lazy proxy, for the same reason {@link missingSurface} is: the member is
 * read off the raw surface at the moment a check reaches for it, so a missing
 * operation fails the check that needed it and never the `beforeEach`. A member
 * that is not a function comes back as it is, which is what lets
 * `instrumentation/debug-api` test for an operation by `typeof`.
 */
export function driveSurface(
  engine: Engine<FacetState, FacetSurface>,
  raw: FacetSurface,
): FacetDriver {
  const readings: readonly string[] = READINGS;
  return new Proxy({} as FacetDriver, {
    get: (_target, property): unknown => {
      if (typeof property === "symbol") return undefined;
      if (property === "then" || property === "constructor") return undefined;
      const member = (raw as unknown as Record<string, unknown>)[property];
      if (typeof member !== "function") return member;
      const op = member as (
        state: DeepReadonly<FacetState>,
        ...args: unknown[]
      ) => unknown;
      if (readings.includes(property)) {
        return (): unknown => op.call(raw, engine.state);
      }
      return (...args: unknown[]): void => {
        engine.apply((state) => op.call(raw, state, ...args) as FacetState);
      };
    },
  });
}

/* -------------------------------------------------------------------------- */
/* What a check reads                                                         */
/* -------------------------------------------------------------------------- */

/** Where a `fillText` or `strokeText` was issued, and how wide it measured. */
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

/** One recorded operation on the 2D context, in the order the render made it. */
export type DrawCall =
  | { kind: "call"; method: string; args: unknown[]; text?: TextGeometry }
  | { kind: "set"; property: string; value: unknown };

/**
 * One sound the build made, and the frame it sounded on.
 *
 * ONE type under all three engines, so a cue script reads the same whichever
 * one ran. `cue` is `null` under `none` alone — there the whole audio layer is
 * the build's own and specs/ui.md fixes the cue NAMES inside the build's code
 * rather than on anything a page reports, so a `none` check asserts that a
 * one-shot sounded and on which frame and never which cue it was. Under this
 * engine the name is the engine bus's own, so it is always a string.
 */
export interface TimedCue {
  cue: string | null;
  /** The frame loop's simulated time when it sounded, in milliseconds. */
  t: number;
  /** The cue's gain: zero while the bus is muted, positive otherwise. */
  gain: number;
  /** The frame it sounded on, 1-based, as `engine.frame().count` reports. */
  frame: number;
  /** Whether it is a bed that keeps playing, rather than a one-shot. */
  loop: boolean;
}

/** One asset the build asked for and did not get. */
export interface AssetFailure {
  path: string;
  reason: string;
}

/** A sampled color, each channel 0-255. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** A sampled pixel, as `[r, g, b, a]`. */
export type Rgba = [number, number, number, number];

/** A square of device pixels read off the canvas, centered on a cell. */
export interface Patch {
  half: number;
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface HarnessOptions {
  /** The clock each frame takes its delta from. Defaults to TICK_MS. */
  clock?: Clock;
  /** The element's laid-out CSS width. Defaults to STAGE_W. */
  cssWidth?: number;
  /** The element's laid-out CSS height. Defaults to STAGE_H. */
  cssHeight?: number;
  /** Device pixels per CSS pixel. Defaults to 1, so a unit is a device pixel. */
  dpr?: number;
  /** The seed `reset` is posed with. Defaults to DEFAULT_SEED. */
  seed?: number;
  /**
   * Whether the disk transport serves the build's produced files. `false` is
   * for the one kind of check that is about a build surviving assets that never
   * arrive. It is process-global, so such a harness must be the only one alive.
   */
  assets?: boolean;
  /**
   * The sub-path the build is served from. Defaults to `"/"`, the site root.
   *
   * specs/assets.md has a build load its produced files PAGE-RELATIVE, so a
   * deployment under a sub-path serves them unchanged. Set to something like
   * `"/facet/"` and every request the build makes is answered as a browser on a
   * page at that base would answer it: a relative path still resolves, and a
   * path the build rooted at `/` does not — which is the whole of what
   * `assets/assets-load-page-relative` is about.
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

/** What driving a chain to its end found. */
export interface SettleResult {
  /** Whether `phase` returned to `idle` within the cap. */
  settled: boolean;
  /** Chain steps driven. */
  steps: number;
  /** Frames advanced. */
  frames: number;
  snapshot: FacetSnapshot;
}

export interface Harness {
  /**
   * The engine the build's game was stood up on. ENGINE-ONLY, and there is no
   * counterpart under `none`: the frame loop, the event bus, the viewport and
   * the recorder all hang off it, and under `none` every one of those is the
   * build's own inside a page.
   */
  readonly engine: Engine<FacetState, FacetSurface>;
  /**
   * The engine's current state, read fresh on every access. ENGINE-ONLY: under
   * `none` the state never leaves the page and `snapshot()` is the only reading.
   * Read it, or pose it through `debug`; nothing here can write to it.
   */
  readonly state: DeepReadonly<FacetState>;
  /**
   * The debug surface the BUILD returned beside its state, driven over the
   * engine: each pose runs through `engine.apply`, each reading is handed
   * `engine.state`.
   *
   * A member is read at the moment a check reaches for it, so a missing
   * operation fails THAT check with the surface's Expected/Actual pair and
   * never a `beforeEach`. A member that is not a function passes through
   * unwrapped, which is what lets `instrumentation/debug-api` test an operation
   * by `typeof`.
   */
  readonly debug: FacetDriver;
  /** Why the build's surface cannot be driven, or `null` when it can. */
  readonly surfaceFault: string | null;
  /**
   * The real 2D context, for `getImageData`. Draw calls also reach it.
   * ENGINE-ONLY: under `none` the pixels live in the page.
   */
  readonly ctx: SKRSContext2D;
  /** The surface the engine drew into, holding the last frame that ran. */
  readonly canvas: Canvas;
  /**
   * Everything the build logged to `console.error` or threw out of a frame,
   * oldest first — so a check can say the build FAULTED rather than merely
   * produced a wrong number.
   */
  readonly pageErrors: string[];
  /**
   * Every asset request that failed, as `<reason> <path>`, oldest first. The
   * same name and the same meaning under all three engines, so
   * `assets/assets-load-page-relative` reads identically.
   */
  readonly failedRequests: string[];
  /**
   * EVERY request the build made, in order — not only the failures. Under this
   * engine, every path the asset transport was asked for.
   */
  readonly requests: string[];
  /** Every call and property set the render made, oldest first. */
  readonly calls: DrawCall[];
  /** Every ONE-SHOT sound the build made, oldest first. */
  readonly cues: TimedCue[];
  /**
   * Every LOOPING start: the two music beds of specs/ui.md. Kept apart from
   * {@link Harness.cues} so a bed starting on a screen change cannot answer a
   * check about a one-shot cue.
   */
  readonly loops: TimedCue[];
  /** Every asset the build failed to load, oldest first. */
  readonly assetFailures: AssetFailure[];

  /** The engine's frame counter, 1-based. */
  frame(): number;
  /** The simulated time those frames covered, in milliseconds. */
  timeMs(): number;
  /** A fresh read of the game's state through the case's `snapshot`. */
  snapshot(): FacetSnapshot;
  /** The board the game holds, in the notation of specs/board.md. */
  board(): string[];
  /** Run `frames` frames back to back, each the length the clock says. */
  advance(frames: number): Promise<void>;
  /**
   * Run `seconds` of game time as `frames` equal deltas.
   *
   * The only way to pose `advance(1, 1)` against `advance(1, 60)`, which is
   * what `instrumentation/delta-time-independent` is about. A `frames` below
   * one is a FIXTURE error and is refused as one rather than repaired.
   */
  advanceSeconds(seconds: number, frames?: number): Promise<void>;
  /** Advance until `predicate` holds, sampling every `poll` frames. */
  until(
    predicate: (snapshot: FacetSnapshot) => boolean,
    options?: UntilOptions,
  ): Promise<UntilResult>;
  /**
   * Hand the game to its OWN frame loop for `ms` of real time, then take it
   * back. `instrumentation/advances-in-real-time` is the one item that needs it.
   */
  runFor(ms: number): Promise<void>;

  /**
   * Press a key and leave it down, as a player holding it would. `code` is a
   * `KeyboardEvent.code`. A KEYBOARD verb, never a pointer one.
   */
  hold(code: string): void;
  /**
   * Release a key held by {@link Harness.hold}. A KEYBOARD verb, named apart
   * from the pointer's {@link Harness.lift}.
   */
  release(code: string): void;
  /**
   * One press of a key, delivered. A KEYBOARD verb.
   *
   * Under this engine it is down, up, then ONE frame: the engine arms an edge
   * that survives to the next frame and drops one nothing consumed, so a tap
   * that ran no frame would never reach the game. Under `none` the order is
   * down, one frame, up, because a press released before a frame ran would be
   * invisible to a build that compares held state between frames. Same meaning,
   * different mechanism, and the difference is deliberate.
   */
  tap(code: string): Promise<void>;
  /**
   * Fire one registered ACTION through the real input path — the level a review
   * item is actually written at ("fire the `up` action").
   *
   * It taps the action's FIRST binding in `BINDINGS`. specs/controls.md fixes
   * that whole table for a build of every engine, so all six actions can be
   * pressed here whatever the build was stood up on, and the alternate key
   * listed beside an action is there for a check that wants to prove the second
   * key fires it as well.
   */
  tapAction(action: ActionName): Promise<void>;

  /**
   * Press a REAL pointer at a LOGICAL stage point, as a player's pointer does.
   *
   * The debug surface's `pointerDown` feeds the same input path and takes
   * effect at the call, which is what a check about the press RULES uses. This
   * one dispatches the pointer-shaped event the engine listens for, so the
   * press is delivered to the game inside a frame's own `update` — which is the
   * only way an event the build answers with a CUE can be observed, because
   * specs/ui.md says a cue is played by a frame and never by a pose.
   *
   * It arms the event and returns; the frame that delivers it is the caller's
   * next `advance`.
   */
  press(x: number, y: number): void;
  /**
   * Move the real pointer to a logical stage point; while it is held down that
   * is a DRAG.
   */
  moveTo(x: number, y: number): void;
  /**
   * Lift the real pointer at its last position, ending the drag. Named apart
   * from the keyboard's {@link Harness.release} on purpose.
   */
  lift(): void;
  /**
   * Where a logical stage point sits in the CLIENT/CSS coordinates a pointer
   * event carries — the inverse of the mapping a runtime applies to an incoming
   * event.
   *
   * The one conversion {@link Harness.press} and {@link Harness.moveTo} go
   * through, and what keeps them correct at a `dpr` other than 1.
   */
  client(x: number, y: number): { x: number; y: number };

  /** One frame's draw calls: clears the list, advances one frame, returns it. */
  frameCalls(): Promise<DrawCall[]>;
  /**
   * Every string one frame put on screen.
   *
   * The pieces are as the build DREW them, which is not always a word: a build
   * that letter-spaces a heading issues one `fillText` per glyph and the list
   * then holds `"F", "A", "C", "E", "T"`. So a check asks {@link showsText}
   * whether the copy is on screen rather than looking for it in the list.
   */
  frameText(): Promise<string[]>;
  /**
   * Reflect over the surface WITHOUT invoking it: the `typeof` of each name.
   *
   * `instrumentation/debug-api` is one script under all three engines and needs
   * one spelling. A `typeof` and nothing more, so the version's VALUE is not
   * reported here: the specification puts that value both on the surface, read
   * with {@link Harness.debugVersion}, and in the snapshot, read as
   * `snapshot().version`.
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

  /** How the stage is mapped onto this harness's canvas, in device pixels. */
  viewport(): Viewport;
  /** Where a LOGICAL stage point lands in the canvas's backing store. */
  device(x: number, y: number): { x: number; y: number };
  /**
   * The single device pixel under a logical stage point. One pixel, not an
   * average: an average silently reads points the check never named, which near
   * a letterbox bar's edge blends the bar with the stage.
   */
  pixel(x: number, y: number): Rgba;
  /** The device-pixel box centered on a cell's center. */
  patch(col: number, row: number, half?: number): Patch;

  /**
   * Give the build whatever it needs before it may make a sound.
   *
   * A no-op under this engine: nothing in Node withholds audio until a gesture,
   * and the engine opens its bus on the first pointer or key event at its own
   * target in any case. The NAME exists because all ten audio items open with
   * "Arm audio" and the three scripts must read the same.
   */
  armAudio(): Promise<void>;
  /**
   * Open the audio and wait until a sound has actually gone out, answering
   * whether anything was ever heard.
   *
   * specs/assets.md has the build DECODE its produced `.wav`s asynchronously,
   * so a build is conformant when its first frames are silent and a cue check
   * that observed the very first event would be reading the decoder. This gives
   * the gesture and then waits — a frame, then real time for a decode that
   * frame kicked off — until something sounds, which under specs/ui.md it must,
   * since one of the two music beds plays on every screen.
   *
   * It answers rather than hanging, so a check can say "the build made no sound
   * at all". It DRIVES FRAMES, so call it while arranging and read
   * {@link Harness.frame} after.
   */
  warmAudio(): Promise<boolean>;
  /**
   * Let `ms` of REAL time pass while the game stands still.
   *
   * The game is off the wall clock, so nothing here advances it. What this is
   * for is work a build does OFF the frame loop: decoding a sound, resolving a
   * fetch, decoding an image. Never for something the simulation does — that is
   * {@link Harness.advance}.
   */
  settle(ms: number): Promise<void>;

  /** Release everything this harness took. */
  dispose(): void;
}

/* -------------------------------------------------------------------------- */
/* Building one                                                               */
/* -------------------------------------------------------------------------- */

/** A `KeyboardEvent`-shaped event: the engine reads `code` and `repeat`. */
class KeyEvent extends Event {
  readonly code: string;
  readonly repeat: boolean;

  constructor(type: "keydown" | "keyup", code: string, repeat = false) {
    super(type);
    this.code = code;
    this.repeat = repeat;
  }
}

/**
 * A `PointerEvent`-shaped event: the engine reads `clientX`, `clientY` and
 * `isPrimary`, and maps the position through the live fit itself.
 */
class PointerEvt extends Event {
  readonly clientX: number;
  readonly clientY: number;
  readonly isPrimary = true;

  constructor(
    type: "pointerdown" | "pointermove" | "pointerup",
    x: number,
    y: number,
  ) {
    super(type);
    this.clientX = x;
    this.clientY = y;
  }
}

/**
 * The clock the harness actually hands the engine.
 *
 * It wraps the caller's clock and lets {@link Harness.advanceSeconds} queue an
 * exact list of deltas for a bounded number of frames, after which the base
 * clock takes over again. One API therefore covers both "n frames at the
 * suite's tick" and "this second, in this many frames", which is what a check
 * about the simulation advancing on elapsed time rather than on frames needs.
 */
export class HarnessClock implements Clock {
  private readonly base: Clock;
  private queued: number[] = [];

  constructor(base: Clock) {
    this.base = base;
  }

  /** Queue `frames` deltas of `ms` each, ahead of the base clock. */
  queue(ms: number, frames: number): void {
    for (let i = 0; i < frames; i++) this.queued.push(ms);
  }

  /**
   * A queued delta where one stands, and the base clock's otherwise.
   *
   * `null` is the base clock's own answer for a tick that is not a frame; a
   * queued delta is always a frame, because `advanceSeconds` asked for exactly
   * that many.
   */
  delta(nowMs: number): number | null {
    const queued = this.queued.shift();
    return queued ?? this.base.delta(nowMs);
  }
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

/**
 * A proxy that records every call and property set on its way to the real
 * context, so one frame produces both a pixel buffer to sample and a call list
 * to inspect.
 */
function recorder(target: SKRSContext2D, calls: DrawCall[]): SKRSContext2D {
  return new Proxy(target, {
    get(object, property) {
      const value = Reflect.get(object, property, object) as unknown;
      if (typeof value !== "function") return value;
      return (...args: unknown[]): unknown => {
        const method = String(property);
        const call: DrawCall = { kind: "call", method, args };
        if (
          (method === "fillText" || method === "strokeText") &&
          typeof args[0] === "string"
        ) {
          const m = object.getTransform();
          call.text = {
            transform: { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f },
            width: object.measureText(args[0]).width,
            textAlign: object.textAlign,
          };
        }
        calls.push(call);
        return (value as (...rest: unknown[]) => unknown).apply(object, args);
      };
    },
    set(object, property, value) {
      calls.push({ kind: "set", property: String(property), value });
      return Reflect.set(object, property, value, object);
    },
  });
}

/** Real milliseconds a warm-up waits between attempts, and how many it makes. */
const AUDIO_WARM_POLL_MS = 50;
const AUDIO_WARM_ATTEMPTS = 40;

/**
 * Every live harness's fault log, and the one `console.error` that feeds them.
 *
 * A single wrapper is installed the first time a harness is built and left in
 * place: a per-harness save-and-restore would put back a stale function when two
 * harnesses overlap, and this way what a harness records is bounded by the
 * window it is registered for instead. Everything still reaches the real
 * console, so a build's own logging is not swallowed.
 */
const errorSinks = new Set<string[]>();
let errorsCaptured = false;

function captureConsoleErrors(): void {
  if (errorsCaptured) return;
  errorsCaptured = true;
  const console_ = console as unknown as {
    error: (...args: unknown[]) => void;
  };
  const previous = console_.error.bind(console);
  console_.error = (...args: unknown[]): void => {
    const line = args.map((arg) => String(arg)).join(" ");
    for (const sink of errorSinks) sink.push(line);
    previous(...args);
  };
}

/** What one live harness wants of every request the build makes. */
interface Transport {
  requests: string[];
  basePath: string;
}

/**
 * Whether a page served at `basePath` would reach `url`.
 *
 * At the site root everything resolves. Under a sub-path a PAGE-RELATIVE path
 * still resolves — that is what specs/assets.md asks a build for — while a path
 * the build rooted at `/` names a file the deployment does not serve, and an
 * absolute URL is off-site and the check's own business rather than this
 * function's.
 */
function servedUnder(basePath: string, url: string): boolean {
  if (basePath === "/") return true;
  if (/^[a-z][a-z0-9+.-]*:/iu.test(url)) return true;
  return !url.startsWith("/") || url.startsWith(basePath);
}

/**
 * Every live harness's request log, and the one `fetch` wrapper that feeds them.
 *
 * Installed once, over whatever transport `dom-shim.ts` put in place, for the
 * same reason the console wrapper is. A harness records only while it is alive —
 * from its construction to its `dispose` — so two harnesses up at once would
 * each see the other's requests, which is why a check that reads `requests` or
 * poses a `basePath` keeps one harness alive at a time.
 */
const transports = new Set<Transport>();
let fetchWrapped = false;

function wrapFetch(): void {
  if (fetchWrapped) return;
  fetchWrapped = true;
  const globals = globalThis as unknown as {
    fetch: (input: unknown, init?: unknown) => Promise<Response>;
  };
  const previous = globals.fetch.bind(globalThis);
  globals.fetch = async (input: unknown, init?: unknown): Promise<Response> => {
    const asked = String(input);
    let refused = false;
    for (const transport of transports) {
      transport.requests.push(asked);
      if (!servedUnder(transport.basePath, asked)) refused = true;
    }
    if (refused) {
      return new Response(null, { status: 404, statusText: "Not Found" });
    }
    return previous(input, init);
  };
}

/**
 * Build an engine over a canvas of the harness's own, initialize the build's
 * game, and hand back everything a check reads.
 *
 * The options passed to the factory are exactly the ones the seeded
 * `src/main.ts` passes — the design size, the build's exported `BACKGROUND`,
 * and the layout — plus the clock and the `SurfaceMetrics` a headless run
 * needs. Everything else the build decided lives inside `src/game.ts`.
 *
 * At the default shape a logical unit is a device pixel, so only a fit check
 * ever has to think about the letterbox.
 *
 * It NEVER throws from its own construction. A surface the build did not return
 * is recorded on {@link Harness.surfaceFault} and lands on the checks that reach
 * through the surface, and `reset` is posed only when there is a surface to pose
 * it on — so a build with no surface fails the items that are about the surface
 * rather than every item in the run.
 *
 * The event subscriptions are made BEFORE `initialize`, which is what makes the
 * game's own loading observable: construction runs no game code, so nothing has
 * happened yet.
 */
export async function createHarness(
  options: HarnessOptions = {},
): Promise<Harness> {
  const cssWidth = options.cssWidth ?? STAGE_W;
  const cssHeight = options.cssHeight ?? STAGE_H;
  const dpr = options.dpr ?? 1;
  const basePath = options.basePath ?? "/";

  const canvas = createCanvas(
    Math.round(cssWidth * dpr),
    Math.round(cssHeight * dpr),
  );
  const ctx = canvas.getContext("2d");
  const calls: DrawCall[] = [];
  const recorded = recorder(ctx, calls);
  const element = Object.assign(canvas, {
    style: {} as CSSStyleDeclaration,
    getContext: (): SKRSContext2D => recorded,
  }) as unknown as HTMLCanvasElement;

  const keys = new EventTarget();
  const metrics: SurfaceMetrics = {
    cssWidth: () => cssWidth,
    cssHeight: () => cssHeight,
    dpr: () => dpr,
    events: () => keys,
  };

  const clock = new HarnessClock(options.clock ?? new ConstantClock(TICK_MS));

  const pageErrors: string[] = [];
  captureConsoleErrors();
  errorSinks.add(pageErrors);

  const requests: string[] = [];
  const transport: Transport = { requests, basePath };
  wrapFetch();
  transports.add(transport);

  const engine = createEngine<FacetState, FacetSurface>({
    canvas: element,
    width: STAGE_W,
    height: STAGE_H,
    game,
    background: BACKGROUND,
    layout: LAYOUT,
    clock,
    surface: metrics,
  });

  const assetFailures: AssetFailure[] = [];
  const failedRequests: string[] = [];
  const cues: TimedCue[] = [];
  const loops: TimedCue[] = [];
  /** How many sounds have gone out, for {@link Harness.warmAudio} to wait on. */
  let heard = 0;
  engine.events.on("asset:failed", ({ path, reason }) => {
    assetFailures.push({ path, reason });
    failedRequests.push(`${reason} ${path}`);
  });
  engine.events.on("cue:played", ({ cue, t, gain }) => {
    cues.push({ cue, t, gain, frame: engine.frame().count, loop: false });
    heard += 1;
  });
  engine.events.on("cue:looped", ({ cue, t, gain }) => {
    loops.push({ cue, t, gain, frame: engine.frame().count, loop: true });
    heard += 1;
  });

  if (options.assets === false) setAssetTransport(false);
  await engine.initialize();
  const surfaceFault = surfaceFaultOf(engine);
  const debug = driveSurface(engine, readDebugSurface(engine));
  // Only where there is a surface to pose it on: a fault belongs on the checks
  // that reach through the surface, never on this function.
  if (surfaceFault === null) {
    debug.reset({ seed: options.seed ?? DEFAULT_SEED });
  }

  const dispatch = (type: "keydown" | "keyup", code: string): void => {
    keys.dispatchEvent(new KeyEvent(type, code));
  };

  /** Where the last real pointer event was, so a release needs no position. */
  let lastPointer = { x: 0, y: 0 };
  const point = (
    type: "pointerdown" | "pointermove" | "pointerup",
    x: number,
    y: number,
  ): void => {
    lastPointer = { x, y };
    const at = toClient(engine.viewport(), dpr, x, y);
    keys.dispatchEvent(new PointerEvt(type, at.x, at.y));
  };

  /**
   * Every frame this harness drives, so a frame that THREW is on the record.
   *
   * The error still travels: the check that drove the frame fails as it should,
   * and `pageErrors` is what lets a check say the build faulted rather than
   * merely answered wrongly.
   */
  const drive = async (frames: number): Promise<void> => {
    try {
      await engine.advance(frames);
    } catch (error) {
      pageErrors.push(String(error));
      throw error;
    }
  };

  const wait = (ms: number): Promise<void> =>
    new Promise((resolve_) => setTimeout(resolve_, ms));

  const harness: Harness = {
    engine,
    get state() {
      return engine.state;
    },
    debug,
    surfaceFault,
    ctx,
    canvas,
    pageErrors,
    failedRequests,
    requests,
    calls,
    cues,
    loops,
    assetFailures,

    frame: () => engine.frame().count,
    timeMs: () => engine.frame().timeMs,
    snapshot: () => debug.snapshot(),
    board: () => renderBoard(debug.snapshot()),

    advance: (frames) => drive(frames),

    async advanceSeconds(span, frames = 1) {
      // A fixture error fails as one, the way `loadBoard` already refuses a
      // malformed row: a count below one, or a fractional count, is a mistake in
      // the check, and repairing it silently would run a drive nobody asked for.
      if (!Number.isInteger(frames) || frames < 1) {
        fail(
          "advanceSeconds to be given a whole number of frames, at least 1",
          frames,
        );
      }
      clock.queue((span * 1000) / frames, frames);
      await drive(frames);
    },

    async until(predicate, untilOptions = {}) {
      const maxFrames = untilOptions.maxFrames ?? 600;
      const poll = Math.max(1, untilOptions.poll ?? 1);

      let snapshot = debug.snapshot();
      if (predicate(snapshot)) return { hit: true, frames: 0, snapshot };

      let frames = 0;
      while (frames < maxFrames) {
        const step = Math.min(poll, maxFrames - frames);
        await drive(step);
        frames += step;
        snapshot = debug.snapshot();
        if (predicate(snapshot)) return { hit: true, frames, snapshot };
      }
      return { hit: false, frames, snapshot };
    },

    async runFor(ms) {
      const controller = new AbortController();
      const running = engine.run({ signal: controller.signal });
      await wait(ms);
      controller.abort();
      await running;
    },

    hold: (code) => dispatch("keydown", code),
    release: (code) => dispatch("keyup", code),
    client: (x, y) => toClient(engine.viewport(), dpr, x, y),
    press: (x, y) => point("pointerdown", x, y),
    moveTo: (x, y) => point("pointermove", x, y),
    lift: () => point("pointerup", lastPointer.x, lastPointer.y),
    async tap(code) {
      dispatch("keydown", code);
      dispatch("keyup", code);
      await drive(1);
    },
    async tapAction(action) {
      await harness.tap(BINDINGS[action][0]);
    },

    async frameCalls() {
      calls.length = 0;
      await drive(1);
      return calls.slice();
    },
    async frameText() {
      return drawnText(await harness.frameCalls());
    },
    probe(names) {
      const surface: unknown = engine.debug;
      const held =
        typeof surface === "object" && surface !== null
          ? (surface as Record<string, unknown>)
          : {};
      const ops: Record<string, string> = {};
      for (const name of names) ops[name] = typeof held[name];
      return Promise.resolve(ops);
    },

    // Through `harness.debug`, so a build with no usable surface fails here on
    // the surface fault rather than answering `undefined`.
    debugVersion: () => Promise.resolve(harness.debug.version),

    viewport: () => engine.viewport(),
    device: (x, y) => toDevice(engine.viewport(), x, y),
    pixel: (x, y) => {
      const at = toDevice(engine.viewport(), x, y);
      const { data } = ctx.getImageData(at.x, at.y, 1, 1);
      return [data[0], data[1], data[2], data[3]];
    },
    patch: (col, row, half) => readPatch(harness, col, row, half),

    armAudio: () => Promise.resolve(),

    async warmAudio() {
      await harness.armAudio();
      for (let attempt = 0; attempt < AUDIO_WARM_ATTEMPTS; attempt += 1) {
        // A frame, so the build asks for the screen's bed and for anything else
        // it plays from `update`; then real time, so a decode that frame kicked
        // off can finish.
        await drive(1);
        if (heard > 0) return true;
        await wait(AUDIO_WARM_POLL_MS);
      }
      return heard > 0;
    },

    settle: (ms) => wait(ms),

    dispose: () => {
      engine.destroy();
      errorSinks.delete(pageErrors);
      transports.delete(transport);
      if (options.assets === false) setAssetTransport(true);
    },
  };

  return harness;
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
// Each of these poses a situation through the debug surface and then, where it
// has to, lets the real simulation run. They fix only the arrangement: which
// board is posed, and which swap is asked for. Every threshold a check asserts
// is stated in the check itself, from the rule specs/ states for it.
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
export function writeBoard(h: Harness, rows: BoardRows): FacetSnapshot {
  parseRows(rows);
  h.debug.loadBoard(rows);
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
export function loadBoard(h: Harness, rows: BoardRows): FacetSnapshot {
  parseRows(rows);
  h.debug.clearChain();
  h.debug.clearSelection();
  h.debug.clearOffer();
  h.debug.clearRefusal();
  h.debug.loadBoard(rows);
  h.debug.setMenuIndex(0);
  h.debug.setScreen("playing");
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
export function startRound(h: Harness): FacetSnapshot {
  h.debug.setScore(0);
  h.debug.setLevel(1);
  h.debug.setLevelScore(0);
  h.debug.setMoveScore(0);
  h.debug.setBestMove(0);
  h.debug.setBestChain(0);
  h.debug.clearSelection();
  h.debug.clearOffer();
  h.debug.clearRefusal();
  h.debug.clearChain();
  h.debug.dealBoard();
  h.debug.setMenuIndex(0);
  h.debug.setScreen("playing");
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
export function openNextLevel(h: Harness): FacetSnapshot {
  const before = h.snapshot();
  h.debug.setLevel(before.level + 1);
  h.debug.setLevelScore(0);
  h.debug.setMoveScore(0);
  h.debug.setBestMove(0);
  h.debug.setBestChain(0);
  h.debug.clearSelection();
  h.debug.clearOffer();
  h.debug.clearRefusal();
  h.debug.clearChain();
  h.debug.dealBoard();
  h.debug.setMenuIndex(0);
  h.debug.setScreen("playing");
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
export function quitToTitle(h: Harness): FacetSnapshot {
  h.debug.clearSelection();
  h.debug.clearOffer();
  h.debug.clearRefusal();
  h.debug.clearChain();
  h.debug.clearBoard();
  h.debug.setMenuIndex(0);
  h.debug.setScreen("title");
  return h.snapshot();
}

/**
 * Open the instructions, exactly as choosing `HOW TO PLAY` from the title does.
 *
 * specs/ui.md: "Sets `screen = howto`", and `menuIndex` is `0` on entering every
 * screen but the title entered from here.
 */
export function openHowTo(h: Harness): FacetSnapshot {
  h.debug.setMenuIndex(0);
  h.debug.setScreen("howto");
  return h.snapshot();
}

/**
 * Pause the round, exactly as the `pause` action from `playing` does.
 *
 * The board is left exactly as it stands — specs/ui.md shows it behind the menu,
 * quieted — and only the screen and the menu highlight move.
 */
export function pauseGame(h: Harness): FacetSnapshot {
  h.debug.setMenuIndex(0);
  h.debug.setScreen("paused");
  return h.snapshot();
}

/**
 * Return to the round, exactly as choosing `RESUME` from the pause menu does.
 *
 * specs/ui.md: "Sets `screen = playing`, with the board exactly as it was left."
 * The highlight goes back to the `0` specs/ui.md rests it at on `playing`.
 */
export function resumeGame(h: Harness): FacetSnapshot {
  h.debug.setMenuIndex(0);
  h.debug.setScreen("playing");
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
export function reachScreen(h: Harness, screen: Screen): FacetSnapshot {
  h.debug.reset();
  if (screen !== "title" && screen !== "howto") {
    loadBoard(h, quietRowsWithEscape([]));
  }
  if (screen !== "title") {
    h.debug.setMenuIndex(0);
    h.debug.setScreen(screen);
  }
  const reading = h.snapshot();
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
  h.debug.setMenuIndex(index);
  await h.tapAction("confirm");
  return h.snapshot();
}

/**
 * The run-free filler with the scenario's own cells written over it.
 *
 * THE FILLER ITSELF CARRIES NO LEGAL SWAP. specs/rules.md ends the round when
 * `phase` returns to idle on a board with no legal swap, so a scenario posed
 * here that resolves its chain can settle into `gameover` — which is the right
 * answer for the board it was given, and a surprise to a check that only wanted
 * a board to look at. A check that must still be `playing` afterwards poses
 * through {@link poseBoardWithEscape} instead.
 */
export function poseBoard(
  h: Harness,
  cells: readonly PlacedToken[],
): FacetSnapshot {
  return loadBoard(h, quietRowsWith(cells));
}

/**
 * {@link poseBoard} with one spare legal swap planted in the bottom-left
 * corner, so the round does not end the moment the scenario's chain settles.
 *
 * WHAT IT GUARANTEES IS THE POSED BOARD, and no more. The escape is two cells
 * of the filler, and a clear whose refill reaches them takes it away again — a
 * scenario in the bottom rows or the left-hand columns can still settle into
 * `gameover`. A check that must be `playing` after its chain asserts
 * `snapshot.legalSwap` before it reads `screen`, or keeps its own cells clear of
 * rows 6-7 and columns 0-2.
 */
export function poseBoardWithEscape(
  h: Harness,
  cells: readonly PlacedToken[],
): FacetSnapshot {
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
export function requestSwap(h: Harness, a: CellRef, b: CellRef): FacetSnapshot {
  h.debug.requestSwap(a.col, a.row, b.col, b.row);
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
  requestSwap(h, a, b);
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
  await h.advance(stepDriveFrames(h.snapshot()));
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
  let snapshot = h.snapshot();
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
export function pressPoint(
  h: Harness,
  x: number,
  y: number,
  device?: PointerDevice,
): FacetSnapshot {
  if (device === undefined) h.debug.pointerDown(x, y);
  else h.debug.pointerDown(x, y, device);
  return h.snapshot();
}

/**
 * Move the pointer to a logical stage point. While it is held down that is a
 * DRAG, which is the only kind of move the board reads.
 */
export function movePointer(
  h: Harness,
  x: number,
  y: number,
  device?: PointerDevice,
): FacetSnapshot {
  if (device === undefined) h.debug.pointerMove(x, y);
  else h.debug.pointerMove(x, y, device);
  return h.snapshot();
}

/** Release the pointer where it stands: the edge that plays a standing offer. */
export function releasePointer(
  h: Harness,
  device?: PointerDevice,
): FacetSnapshot {
  if (device === undefined) h.debug.pointerUp();
  else h.debug.pointerUp(device);
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
export function pressCell(
  h: Harness,
  cell: CellRef,
  device?: PointerDevice,
): FacetSnapshot {
  const at = cellCenter(cell.col, cell.row);
  return pressPoint(h, at.x, at.y, device);
}

/** Carry a held pointer onto a cell, at its center: the drag that offers. */
export function dragOntoCell(
  h: Harness,
  cell: CellRef,
  device?: PointerDevice,
): FacetSnapshot {
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
export function dragGem(
  h: Harness,
  from: CellRef,
  to: CellRef,
  device?: PointerDevice,
): FacetSnapshot {
  pressCell(h, from, device);
  dragOntoCell(h, to, device);
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
export function moveOverTarget(
  h: Harness,
  target: TargetRect,
  device?: PointerDevice,
): FacetSnapshot {
  const at = targetCenter(target);
  return movePointer(h, at.x, at.y, device);
}

/** Press inside a target, at its center: the press that highlights and arms. */
export function pressTarget(
  h: Harness,
  target: TargetRect,
  device?: PointerDevice,
): FacetSnapshot {
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
export function takeTarget(
  h: Harness,
  target: TargetRect,
  device?: PointerDevice,
): FacetSnapshot {
  pressTarget(h, target, device);
  return releasePointer(h, device);
}

/* -------------------------------------------------------------------------- */
/* Cues                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Record every one-shot cue the build plays from now on, stamped with its
 * frame.
 *
 * The engine publishes `cue:played` synchronously from inside `audio.play`, so
 * the handler runs while the frame that played it is still running and
 * `engine.frame().count` is that frame's own number. That is what lets a check
 * assert not merely that a cue sounded but that it sounded on the frame of its
 * event — which tells a build that plays a cue on the right event apart from
 * one that plays it every frame, or a frame late.
 *
 * Under this engine the cue's NAME is observable, so a check may assert that
 * the frame of a refusal played `CUES.refuse`. The `none` counterpart cannot,
 * and that asymmetry is expected.
 */
export function watchCues(h: Harness): TimedCue[] {
  const played: TimedCue[] = [];
  h.engine.events.on("cue:played", ({ cue, t, gain }) => {
    played.push({ cue, t, gain, frame: h.engine.frame().count, loop: false });
  });
  return played;
}

/**
 * Record every LOOPING cue the build starts: the two music beds of
 * specs/ui.md.
 *
 * Kept apart from {@link watchCues} so a screen change that starts a bed can
 * never answer a check about a one-shot cue.
 */
export function watchLoops(h: Harness): TimedCue[] {
  const looped: TimedCue[] = [];
  h.engine.events.on("cue:looped", ({ cue, t, gain }) => {
    looped.push({ cue, t, gain, frame: h.engine.frame().count, loop: true });
  });
  return looped;
}

/** The cues attributed to one frame. */
export function cuesOnFrame(
  cues: readonly TimedCue[],
  frame: number,
): TimedCue[] {
  return cues.filter((cue) => cue.frame === frame);
}

/**
 * The names of a list of cues, in order.
 *
 * Under this engine every name is the engine bus's own, so none of them is
 * `null`; under `none` they all are, and no `none` validator may assert one.
 * The signature is the same in all three so one cue script reads the same
 * whichever engine ran.
 */
export function cueNames(cues: readonly TimedCue[]): (string | null)[] {
  return cues.map((cue) => cue.cue);
}

/* -------------------------------------------------------------------------- */
/* Reading one frame's render                                                 */
/* -------------------------------------------------------------------------- */

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
 * specs/ui.md fixes the COPY — `FACET`, `PRESSURE FINDS THE FLAW`, `SCORE`,
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

/* -------------------------------------------------------------------------- */
/* Pixels                                                                     */
/* -------------------------------------------------------------------------- */

/** The color at a logical stage point. */
export function sampleColor(h: Harness, x: number, y: number): Rgb {
  const [r, g, b] = h.pixel(x, y);
  return { r, g, b };
}

/** The Euclidean distance between two colors, 0..441. */
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
 * The box is `2 * round(half * scale) + 1` device pixels on a side — ODD, so it
 * is centered on the cell center rather than half a pixel off it — and it is that
 * size wherever the cell sits: at a canvas edge the ORIGIN slides inward and the
 * size holds. `patchDistance` is a MEAN over the box, and `PATCH_DISTINCT_MIN`
 * and `PATCH_SAME_MAX` are one pair of thresholds under all three engines, so a
 * box that changed shape near an edge would make them mean different things.
 */
export function readPatch(
  h: Harness,
  col: number,
  row: number,
  half: number = PATCH_HALF,
): Patch {
  const view = h.viewport();
  const center = cellCenter(col, row);
  const device = h.device(center.x, center.y);
  const halfDev = Math.max(1, Math.round(half * view.scale));
  const size = halfDev * 2 + 1;
  const x0 = Math.max(0, Math.min(h.canvas.width - size, device.x - halfDev));
  const y0 = Math.max(0, Math.min(h.canvas.height - size, device.y - halfDev));
  const image = h.ctx.getImageData(x0, y0, size, size);
  return {
    half,
    width: image.width,
    height: image.height,
    data: image.data as unknown as Uint8ClampedArray,
  };
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
// A review item may declare a `replay` or an `image` OUTPUT beside its verdict:
// what the build itself drew while a check drove it, kept as evidence a
// reviewer can scrub or compare against the reference implementation's.
//
// Four properties make them usable, and each is deliberate:
//
// 1. THEY RECORD THE SECTION, NOT THE RUN. The recorder is armed around the
//    caller's scenario and disarmed the moment it returns.
// 2. THEY ARE EVIDENCE, NEVER A VERDICT. The scenario's own value comes
//    straight back, and a scenario that THROWS still leaves what it had.
// 3. THEY WRITE ONLY WHAT THERE IS TO LOOK AT. A capture that closed no frames
//    leaves no file, so the run reports the output absent rather than offering
//    a replay of nothing.
// 4. THEY COST NOTHING WHEN NOBODY IS COLLECTING. Outside a run the media
//    directory is unset and the whole thing is a no-op that still runs the
//    scenario, so a check cannot pass in one place and fail in the other.

/** The environment variable the runner names the media directory in. */
export const MEDIA_DIR_ENV = "TCAB_VALIDATION_MEDIA_DIR";

/** The directory this harness sits in, which is the validator project's root. */
export const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

/** The build's own root, one level above the staged project. */
export const WORKSPACE_ROOT = resolve(PROJECT_ROOT, "..");

/**
 * The built site, or the committed `public/` tree when nothing has been built:
 * where a check about a PRODUCED FILE looks for it.
 *
 * specs/assets.md commits every produced file under `public/assets/` and says
 * the build copies that directory into `dist/` unchanged, so both layouts name
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
 * The directory the runner stages this project to inside the build's tree.
 *
 * An output is addressed by the STAGED path of the suite that produced it —
 * `validation/runs/r4-horizontal-run.test.ts` — because that is the path the
 * review item's declared script resolves to. Stating the prefix here keeps that
 * address the same when this suite is run in place against a reference
 * implementation, where the project root is `validation/simple-2d/` instead.
 */
export const STAGED_PROJECT_DIR = "validation";

/**
 * Where the running suite's `outputId` output belongs, or `null` when nothing
 * is collecting media.
 *
 * The suite is the one vitest is currently running rather than one the caller
 * names, so a check can never write its evidence under another point's address.
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

/** A value's JSON with object keys in a fixed order, as a table's key. */
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
 * with, so carrying the recording's tables over whole would put operations,
 * states, gradients and images in the file that no surviving frame asks for.
 * Every entry here is reached from a kept frame, and every reference inside one
 * is rewritten as it is reached, transitively.
 *
 * Exported for the suite beside this file: a recording carrying an own field
 * named `__proto__` is one the engine's recorder writes and this one has to
 * rewrite as a field rather than as a prototype.
 */
export function retable(
  recording: Recording,
  frames: readonly RecordedFrame[],
): Recording {
  const images: CapturedImage[] = [];
  const imageAt = new Map<number, number>();
  const resources: Resource[] = [];
  const resourceAt = new Map<number, number>();
  const ops: DrawOp[] = [];
  const opAt = new Map<string, number>();
  const states: DrawState[] = [];
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
    const rebuilt: Resource = {
      make: { method: recipe.make.method, args: recipe.make.args.map(value) },
      then: recipe.then.map(operation),
    };
    const index = resources.length;
    resources.push(rebuilt);
    resourceAt.set(source, index);
    return index;
  };

  const value = (entry: DrawValue): DrawValue => {
    if (Array.isArray(entry)) return entry.map(value);
    if (entry === null || typeof entry !== "object") return entry;
    const record = entry as Record<string, DrawValue>;
    if (typeof record.$img === "number")
      return { $img: takeImage(record.$img) };
    if (typeof record.$res === "number") {
      return { $res: takeResource(record.$res) };
    }
    const rewritten: Record<string, DrawValue> = {};
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

  const operation = (op: DrawOp): DrawOp =>
    op.op === "call"
      ? { op: "call", method: op.method, args: op.args.map(value) }
      : { op: "set", property: op.property, value: value(op.value) };

  const segments = (list: readonly PathSegment[]): PathSegment[] =>
    list.map((segment) => ({
      transform: segment.transform,
      ops: segment.ops.map(operation),
    }));

  const stateOf = (source: number): number => {
    const state = recording.states[source];
    const properties: Record<string, DrawValue> = {};
    for (const [name, held] of Object.entries(state.properties)) {
      Object.defineProperty(properties, name, {
        value: value(held),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return intern(states, stateAt, {
      properties,
      transform: state.transform,
      lineDash: state.lineDash,
      clip: segments(state.clip),
      path: segments(state.path),
    });
  };

  return {
    ...recording,
    images,
    resources,
    ops,
    states,
    frames: frames.map((frame) => ({
      ...frame,
      state: stateOf(frame.state),
      stack: frame.stack.map(stateOf),
      ops: frame.ops.map((op) =>
        intern(ops, opAt, operation(recording.ops[op])),
      ),
    })),
  };
}

/**
 * A recording of at most MAX_REPLAY_FRAMES frames, covering the whole of what
 * was captured.
 *
 * An over-long section is THINNED rather than cut short: every nth frame is
 * kept, so the reviewer sees the entire section at a lower frame rate instead
 * of its first few seconds at the full one. Each kept frame's `deltaMs` is
 * restated as the time since the frame kept before it, so the deltas still sum
 * to the section's elapsed time. The last frame is always kept: it is the frame
 * the check's drive stopped at.
 */
export function thinReplay(recording: Recording): Recording {
  const { frames } = recording;
  if (frames.length <= MAX_REPLAY_FRAMES) return recording;

  const stride = Math.ceil(frames.length / MAX_REPLAY_FRAMES);
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
 * list would be collected as an output that turned up, and the reviewer would
 * open a player on nothing. What lands on disk is gzip, because a recording is
 * text made almost entirely of numbers and repeated field names.
 *
 * Never throws. A file that cannot be written says something about the machine
 * the validators ran on, and failing a point over it would blame the build for
 * the host's problem.
 */
function writeReplay(destination: string, recording: Recording): void {
  if (recording.frames.length === 0) return;
  try {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, gzipSync(JSON.stringify(thinReplay(recording))));
  } catch (error) {
    console.warn(`facet: could not write ${destination}: ${String(error)}`);
  }
}

/**
 * Record the frames `scenario` draws and keep them as the review item's
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

  h.engine.startRecording();
  try {
    return await scenario();
  } finally {
    // In a `finally`, so a scenario that failed still leaves its evidence.
    writeReplay(destination, h.engine.stopRecording());
  }
}

/**
 * Keep the frame currently on the canvas as the review item's `outputId`
 * output.
 *
 * What is written is whatever the last frame that RAN left behind, so call it
 * after the `advance(1)` that poses the thing under test and before the
 * assertions, so a check that fails still leaves the picture that shows why.
 */
export function captureStill(h: Harness, outputId: string): void {
  const destination = mediaDestination(outputId, "png");
  if (destination === null) return;
  try {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, h.canvas.toBuffer("image/png"));
  } catch (error) {
    console.warn(`facet: could not write ${destination}: ${String(error)}`);
  }
}
