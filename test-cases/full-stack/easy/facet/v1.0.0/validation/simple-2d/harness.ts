// Facet — the shared validator harness for `simple-2d`. CASE-PROVIDED.
//
// Every check in this suite is an ordinary vitest test that runs IN THE SAME
// PROCESS as the build. It imports the engine and the build's own `src/game`,
// builds an engine over a canvas it owns and a clock it chose, and steps the
// game with `engine.advance`. Nothing drives a browser, nothing polls, and no
// wall-clock time passes: a check asks for a number of frames and gets exactly
// that number, at exactly the deltas its clock supplied.
//
// WHAT IS HERE AND WHAT IS NOT. The machinery of that paragraph — the canvas and
// its draw-command recorder, the debug surface and the stand-in for a missing
// one, the driver that threads a PURE surface through the engine's `apply`, the
// frame sweep, the cue stamping, the transport a produced file is fetched over,
// the audio context a produced `.wav` decodes through, and the evidence a review
// item's output is written from — is the shared `@clockwyrks/case-harness`
// package's, staged in beside this file as `./case-harness/` and bound here in
// ONE call to `createEngineCaseHarness`. What stays HERE is what is genuinely
// Facet's: the case's types, the tick rate its suites step at, the sentence a
// missing surface is failed against, the readings its checks take over a frame,
// and every scenario helper that poses this game.
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
// through the same acceptance path a player's swap takes, and `reset()` gives
// everything back. Posing through it is how a scenario is arranged, and it is
// the seam the case's specification documents. `surface.ts` is that
// specification as types, and it is the ONLY description of the surface this
// harness reads: the build's own module for it is never imported.
//
// HOW THE SURFACE IS DRIVEN — the APPLY-THREADED strategy, which is what a
// simple engine's state model forces. The engine holds the state BY VALUE, so
// the surface the build returns is pure: a pose is `(state, ...args) => S` and a
// reading is `(state) => R`, and neither can be called by a check directly
// because neither has the state. The package's `applyDriver` supplies it — a
// reading is handed `engine.state`, a pose is run through `engine.apply` so the
// state it returns is the state the next frame receives — and `surface.ts`'s
// `READINGS` is what tells the two apart, because nothing about a pure surface
// distinguishes them at run time. Facet declares exactly one reading,
// `snapshot`, and it takes no arguments of its own, which is the precondition
// the package's arm has: a reading that took arguments would have them dropped
// silently and would answer a plausible value for the wrong question.
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
// `swapAndStep`, `advanceStep`, `resolveChain`, `swapAndResolve`, `frameCalls`
// and `tap`; `warmAudio` runs frames too, and says so where it is declared. A
// pose takes effect at the call, so `simTime`, `stepTimer` and the refusal
// timer stay readable exactly as the specs state them, and a check that needs
// the frame DRAWN calls `h.advance(1)` itself. A cue, by contrast, is played by
// a frame and never by a pose (specs/ui.md), so a check about a cue advances
// one.
//
// A WHOLE POINTER GESTURE IS A POSE. A press, the moves that carry it, and the
// release all take effect at their calls, so `dragGem` poses the whole of a move
// without a frame passing — which is what lets a check read the offer standing
// between two of them.

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ConstantClock,
  JitterClock,
  SequenceClock,
  createEngine,
  type Clock,
  type Engine,
  type Game,
  type SurfaceMetrics,
  type Viewport,
} from "@clockwyrks/simple-2d";
import type { DeepReadonly } from "ts-essentials";
import {
  PointerPositionEvent,
  absentSurface,
  applyDriver,
  captureOutputSync,
  createEngineCaseHarness,
  installAssetHost,
  installAudioContext,
  type AssetFailure,
  type AudioBufferLike,
  type EngineHarness,
  type PointerEventType,
  type PureDriver,
  type TimedCue as EngineCue,
  type UntilOptions,
  type UntilResult as EngineUntilResult,
} from "./case-harness/engine/index";
import { makeReplayCapture } from "./case-harness/engine/2d";
import {
  MEDIA_DIR_ENV,
  STAGED_PROJECT_DIR,
  mediaDestination as mediaDestinationIn,
} from "./case-harness/media";
import {
  callsTo,
  setsOf,
  type DrawCall,
  type TextGeometry,
} from "./case-harness/draw-calls";
import { drawnText } from "./case-harness/text";
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
  READINGS,
  type FacetDebugApi,
  type FacetSnapshot,
  type Screen,
} from "./surface";

export { ConstantClock, JitterClock, SequenceClock };
export type { Clock, Viewport };

/* The readings this project takes straight off the package, under its names. */
export { callsTo, setsOf, drawnText };
export type { AssetFailure, DrawCall, TextGeometry };
export { MEDIA_DIR_ENV, STAGED_PROJECT_DIR };

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
 * The surface as every check drives it: every member of the pure surface, minus
 * its state argument, over the engine that holds the state.
 *
 * The package's mapping rather than one written here. `Read` is the deep-readonly
 * view this engine hands out and `Write` is the state a transition returns; the
 * two are different types, the case knows both, and the package names neither.
 */
export type FacetDriver = PureDriver<
  DeepReadonly<FacetState>,
  FacetState,
  FacetSurface
>;

/** The engine this project stands a build up on. */
export type FacetEngine = Engine<FacetState, FacetSurface>;

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
/* The two roots, and the browser faculties a headless run needs               */
/* -------------------------------------------------------------------------- */
//
// The engine takes every measurement through the `SurfaceMetrics` the harness
// supplies, so it needs no DOM — but four globals a browser has and Node does not
// are still reached for, by the ENGINE and by the packages a Facet build is
// entitled to use, while a frame runs. Each is the CASE's responsibility rather
// than the build's: without them the build would fail checks over a fault this
// harness created.
//
// 1. `fetch`. The engine's asset loader resolves every path under `assets/` and
//    fetches it. A Facet build's gems, break sheets, particle systems, sounds and
//    music are ALL produced files (specs/assets.md), so with no transport not one
//    of them loads and every check that reads the board's drawing would be
//    deciding a question about Node rather than about the build.
// 2. `createImageBitmap`. The loader decodes an image with it and rejects by name
//    where the host has none.
// 3. `AudioContext`. This one is load-bearing in a way that is easy to miss.
//    `api.audio.load(cue, file)` decodes through `decodeAudioData`, and a
//    rejected load leaves the cue UNDECLARED — after which the engine's `play`
//    THROWS ("unknown audio cue …") from inside the build's own `update`, failing
//    every check in the suite over a fault the harness created.
// 4. `OffscreenCanvas`, and a `document` that can make a canvas.
//    `@clockwyrks/particle-runtime` composites through a context it owns, and
//    `src/scratch.ts` asks the platform for that second surface — the offscreen
//    one first, the document one after it.
//
// ALL FOUR ARE THE PACKAGE'S NOW. `installAssetHost` supplies the transport, the
// image decoder and BOTH ways of making a scratch surface —
// `document.createElement("canvas")` under `documentElement`, and
// `OffscreenCanvas` under `offscreenCanvas`, which defaults to it —
// and `installAudioContext` supplies the context. The stub that used to stand in
// this file is gone: spectra and cascade wanted the same one, which is the moment
// the package's README named for moving it.
//
// AND THEY ARE INSTALLED AT MODULE SCOPE, NOT FROM A `setupFiles` ENTRY. That is
// a later moment: vitest evaluates a setup file before a test file's own imports,
// where this file's body runs after them. It is the same moment as far as a Facet
// build is concerned, because nothing in its module graph READS one of these
// globals at module scope — `src/scratch.ts` asks `typeof OffscreenCanvas` inside
// the factory it exports, at the moment a burst is actually drawn. Installing
// here is what lets the project carry no `setup.ts` at all, which is the shape
// `defineEngineValidationConfig` fixes.

/** The directory this harness sits in, which is the validator project's root. */
export const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * The build's own root, one level above the staged project.
 *
 * Never derived inside the package, which is staged one directory DEEPER than
 * this file: a root taken from there would address a tree one level too far down
 * and every produced file would quietly 404 — and a 404 is a verdict about the
 * build.
 */
export const WORKSPACE_ROOT = resolve(PROJECT_ROOT, "..");

/**
 * Where a produced file is looked for, in order.
 *
 * NOT THE PACKAGE'S DEFAULT, AND THE ORDER IS LOAD-BEARING — the first root that
 * carries a path is the one that answers. The built output first, because that is
 * what a player is served and what an asset check is really about; `public/`
 * last, because a build whose `dist/` is missing a produced file it committed has
 * a fault worth seeing rather than papering over. Under the package's
 * `[".", "public", "dist"]` a build carrying the same path at its repository root
 * would be served that file instead, with nothing to say so.
 */
const ASSET_ROOTS = ["dist", "build", "out", "public"] as const;

/**
 * The transport, standing for the whole of this worker's run.
 *
 * `onMissing: "404"` is this case's own answer and the one its verdicts were
 * taken under: a relative URL no root carries is answered with a status, which is
 * what the loader's own failure path expects and what makes the engine announce
 * `asset:failed` with a reason, so a file the build never produced fails the items
 * about that file and only those.
 *
 * `nameImageBitmap` is off, deliberately, and it is the one field here whose
 * default would change a recording. The ENGINE's own draw-op recorder decides
 * what is a bitmap source by `value instanceof globalThis[name]` over a fixed list
 * of host type names, and `ImageBitmap` is on it (`recording.ts`,
 * `BITMAP_SOURCES`). Naming the canvas library's decoded image as
 * `globalThis.ImageBitmap` would therefore have every produced sprite's PIXELS
 * captured into every replay this project writes. The shim this replaces never
 * named it, every replay in the baseline was taken without it, and no point asks
 * for it.
 *
 * `documentElement` and `offscreenCanvas` are the two ways a browser hands out
 * the scratch surface `src/scratch.ts` asks for, and both are named here rather
 * than left to the second's default: this project cannot run without one of them,
 * and a reader of `domScratchCanvas` has to be able to find where each comes from.
 * The offscreen one is the branch that build actually takes.
 *
 * The handle is kept for {@link Harness.requests}: `mark()` is taken when a
 * harness is built and `requestsSince` reads the traffic from there on.
 */
const assetHost = installAssetHost({
  workspaceRoot: WORKSPACE_ROOT,
  roots: ASSET_ROOTS,
  onMissing: "404",
  images: true,
  nameImageBitmap: false,
  documentElement: true,
  offscreenCanvas: true,
  label: "facet",
});

/**
 * A decoded cue that CANNOT FAIL, which is what this project has always handed
 * `api.audio.load`.
 *
 * NOT `silentAudioBuffer`, and the difference is the whole point. The stub this
 * replaces read the body's LENGTH and nothing else — it inspected no header and
 * bound every produced cue whatever the bytes were. The package's decoders parse
 * RIFF/WAVE and THROW on a body that is not one or that carries no `data` chunk,
 * and specs/assets.md has a build bind its cues while it initializes: a build
 * whose produced `.wav` files are malformed would then leave every cue
 * undeclared, and the engine's `play` throws from inside the build's own update,
 * so EVERY point in this project would fail over one bad file. That is an
 * inversion of the verdict, not a refinement of it, and it is not this
 * migration's to make — `assets/audio-produced` reads the produced `.wav`s off
 * disk itself and is where a malformed one is supposed to land.
 *
 * IT IS NOT A HYPOTHETICAL FILE. specs/assets.md has `music` emit a portable
 * `.mid` beside its `.wav`, and the reference commits `play.mid` and `title.mid`
 * under the same `assets/audio/` directory as the cues. Nothing fetches them
 * today — `installCues` names a `.wav` for every cue and every bed — but a
 * decoder that throws is the thing that would decide the project if anything ever
 * asked the audio loader for one.
 *
 * Every figure below is inert: nothing sounds, and the engine's bus reads none of
 * them off a file-backed buffer — it announces `cue:played`, `cue:looped` and
 * `cue:stopped` from the play call itself and never from a buffer ending. The
 * length is the body's, as it was, so a decoded cue is still a value whose size
 * follows the file.
 *
 * Declared once, at module scope, because the package's audio host is reference
 * counted per worker and refuses a second install naming a DIFFERENT decoder: one
 * install stands for every harness this file builds. `validation/structured-2d/`
 * declares the same function under the same name, so a build stood up under one
 * engine is handed exactly the cue a build under the other is, and no check can
 * turn on which project ran.
 */
function decodeCue(bytes: Uint8Array): AudioBufferLike {
  const sampleRate = 48_000;
  const length = Math.max(1, Math.floor(bytes.byteLength / 4));
  const silence = new Float32Array(length);
  return {
    sampleRate,
    numberOfChannels: 1,
    length,
    duration: length / sampleRate,
    getChannelData: () => silence,
    copyFromChannel: (destination, _channel, startInChannel = 0) => {
      destination.set(
        silence.subarray(
          startInChannel,
          Math.min(silence.length, startInChannel + destination.length),
        ),
      );
    },
    copyToChannel: () => undefined,
  };
}

installAudioContext({ decode: decodeCue });

/* -------------------------------------------------------------------------- */
/* The surface, and the two faults that make it undrivable                     */
/* -------------------------------------------------------------------------- */

/**
 * What the build owes when its surface is missing: the `Expected:` line of the
 * failure every check that reaches for the surface lands on, beside what
 * `engine.debug` was found holding instead.
 *
 * The case's own sentence rather than the package's, because where the surface
 * comes from is this engine's business — beside the state, as a pair — and a
 * fault that misdescribed the return would send a reviewer to the wrong line of
 * the build.
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
 * engine ran. Twenty-nine suites open with `if (h.surfaceFault !== null)
 * failSurface(h.surfaceFault)`.
 */
export function failSurface(fault: string): never {
  return fail(SURFACE_REQUIREMENT, fault);
}

/**
 * Why the surface the build returned cannot be driven, or `null` when it can.
 *
 * TWO FAULTS, AND THEY ARE THE TWO THAT MAKE EVERY OPERATION UNREACHABLE rather
 * than one: a pair whose second element is no object at all, and an object that
 * carries no `reset` — without which no scenario can be arranged from a known
 * starting point, so nothing this harness poses would mean anything.
 *
 * The package's `missingOps`/`missingOpsFault` answer the same question over a
 * LIST of operations and spell the fault differently ("engine.debug is present
 * but carries no reset()"). This one keeps Facet's own sentences, including the
 * `typeof` of what was found there, because they are what a reviewer reads.
 */
function surfaceFaultOf(engine: FacetEngine): string | null {
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

/* -------------------------------------------------------------------------- */
/* What a check reads                                                         */
/* -------------------------------------------------------------------------- */

/**
 * One sound the build made, and the frame it sounded on.
 *
 * ONE type under all three engines, so a cue script reads the same whichever one
 * ran. `cue` is `null` under `none` alone — there the whole audio layer is the
 * build's own and specs/ui.md fixes the cue NAMES inside the build's code rather
 * than on anything a page reports, so a `none` check asserts that a one-shot
 * sounded and on which frame and never which cue it was. Under this engine the
 * name is the engine bus's own, so it is always a string.
 *
 * NOT THE PACKAGE'S `TimedCue`, and the difference is not cosmetic. The package's
 * spells the same firing `{ cue: string; t; gain; frame; tick; looped }` — a
 * NON-nullable name, and `looped` where this says `loop`. Folding them would
 * break the one property this type exists for, which is that the `none`, the
 * `simple-2d` and the `structured-2d` cue scripts read identically. So Facet
 * keeps its own, and {@link Harness.cues} and {@link Harness.loops} are read off
 * the package's list through {@link asTimedCue}.
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

/** One firing as the package stamps it, in this case's own vocabulary. */
function asTimedCue(cue: EngineCue): TimedCue {
  return {
    cue: cue.cue,
    t: cue.t,
    gain: cue.gain,
    frame: cue.frame,
    loop: cue.looped,
  };
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

/** How far a sweep may run, and how many frames separate two samples. */
export type { UntilOptions };

/** What a sweep found: whether the predicate ever held, and where it stopped. */
export type UntilResult = EngineUntilResult<FacetSnapshot>;

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

export interface HarnessOptions {
  /** The clock each frame takes its delta from. Defaults to TICK_MS. */
  clock?: Clock;
  /** The element's laid-out CSS width. Defaults to STAGE_W. */
  cssWidth?: number;
  /** The element's laid-out CSS height. Defaults to STAGE_H. */
  cssHeight?: number;
  /** Device pixels per CSS pixel. Defaults to 1, so a unit is a device pixel. */
  dpr?: number;
  /**
   * The sub-path the build is served from. Defaults to `"/"`, the site root.
   *
   * specs/assets.md has a build load its produced files PAGE-RELATIVE, so a
   * deployment under a sub-path serves them unchanged. Set to something like
   * `"/facet/"` and the mount is recorded on {@link Harness.basePath} beside the
   * requests the build made, which is what `assets/assets-load-page-relative`
   * reads. Under THIS engine there is no page and no server, so nothing resolves
   * against the mount: the transport answers every relative URL off the built
   * tree whatever it is, and the item is decided by whether the build's own paths
   * came out page-relative. Every request still succeeds.
   */
  basePath?: string;
}

/**
 * Everything a check reads off one engine running one build, over and above the
 * package's own contract.
 *
 * Two members of that contract are REPLACED rather than added to, and both keep
 * the same signature: `advance`, so a frame that threw lands in
 * {@link Harness.pageErrors}, and `dispose`, so this harness stops recording the
 * build's console.
 */
interface FacetHarness {
  /**
   * The engine's current state, read fresh on every access. ENGINE-ONLY: under
   * `none` the state never leaves the page and `snapshot()` is the only reading.
   * Read it, or pose it through `debug`; nothing here can write to it.
   */
  readonly state: DeepReadonly<FacetState>;
  /** Why the build's surface cannot be driven, or `null` when it can. */
  readonly surfaceFault: string | null;
  /** The mount this harness was built for. See {@link HarnessOptions.basePath}. */
  readonly basePath: string;
  /**
   * Everything the build logged to `console.error`, oldest first — and anything a
   * frame THIS harness drove threw, so a check can say the build FAULTED rather
   * than merely produced a wrong number. A frame the package's own sweep drove
   * reaches the check that drove it and not this log.
   */
  readonly pageErrors: string[];
  /**
   * Every asset request that failed, as `<reason> <path>`, oldest first. The same
   * name and the same meaning under all three engines, so
   * `assets/assets-load-page-relative` reads identically. Read off the engine's
   * own `asset:failed` announcements rather than off the transport: a path the
   * loader itself refused never reached a fetch.
   */
  readonly failedRequests: string[];
  /**
   * EVERY request the build made, in order — not only the failures. Under this
   * engine, every path the asset transport was asked for since this harness was
   * built. The transport's log is the WORKER's, so two harnesses alive at once
   * would each see the other's requests from its own mark onward, which is why a
   * check that reads this keeps one harness alive at a time.
   */
  readonly requests: string[];
  /** Every ONE-SHOT sound the build made, oldest first. */
  readonly cues: TimedCue[];
  /**
   * Every LOOPING start: the two music beds of specs/ui.md. Kept apart from
   * {@link FacetHarness.cues} so a bed starting on a screen change cannot answer
   * a check about a one-shot cue.
   */
  readonly loops: TimedCue[];

  /** The board the game holds, in the notation of specs/board.md. */
  board(): string[];
  /**
   * Run `seconds` of game time as `frames` equal deltas.
   *
   * The only way to pose `advance(1, 1)` against `advance(1, 60)`, which is what
   * `instrumentation/delta-time-independent` is about. A `frames` below one is a
   * FIXTURE error and is refused as one rather than repaired.
   */
  advanceSeconds(seconds: number, frames?: number): Promise<void>;
  /**
   * Fire one registered ACTION through the real input path — the level a review
   * item is actually written at ("fire the `up` action").
   *
   * It taps the action's FIRST binding in `BINDINGS`. specs/controls.md fixes
   * that whole table for a build of every engine, so all six actions can be
   * pressed here whatever the build was stood up on, and the alternate key listed
   * beside an action is there for a check that wants to prove the second key
   * fires it as well.
   */
  tapAction(action: ActionName): Promise<void>;

  /**
   * Press a REAL pointer at a LOGICAL stage point, as a player's pointer does.
   *
   * The debug surface's `pointerDown` feeds the same input path and takes effect
   * at the call, which is what a check about the press RULES uses. This one
   * dispatches the pointer-shaped event the engine listens for, so the press is
   * delivered to the game inside a frame's own `update` — which is the only way
   * an event the build answers with a CUE can be observed, because specs/ui.md
   * says a cue is played by a frame and never by a pose.
   *
   * It arms the event and returns; the frame that delivers it is the caller's
   * next `advance`.
   */
  press(x: number, y: number): void;
  /**
   * Move the real pointer to a logical stage point; while it is held down that is
   * a DRAG.
   */
  moveTo(x: number, y: number): void;
  /**
   * Lift the real pointer at its last position, ending the drag. Named apart from
   * the keyboard's `release` on purpose.
   */
  lift(): void;
  /**
   * Where a logical stage point sits in the CLIENT/CSS coordinates a pointer
   * event carries — the inverse of the mapping the engine applies to an incoming
   * event.
   *
   * The one conversion {@link FacetHarness.press} and {@link FacetHarness.moveTo}
   * go through, and what keeps them correct at a `dpr` other than 1.
   */
  client(x: number, y: number): { x: number; y: number };

  /**
   * One frame's draw calls: clears the list, advances one frame, returns it.
   *
   * What a copy check reads, through the package's `drewTextAnywhere`: every
   * text call is measured, so a heading a build letter-spaces one `fillText`
   * per glyph is read as the word its glyphs coalesce into rather than as
   * `"F", "A", "C", "E", "T"`.
   */
  frameCalls(): Promise<DrawCall[]>;
  /**
   * Reflect over the surface WITHOUT invoking it: the `typeof` of each name.
   *
   * `instrumentation/debug-api-operations-present` is one script under all three
   * engines and needs one spelling. A `typeof` and nothing more, so the version's
   * VALUE is not reported here: the specification puts that value both on the
   * surface, read with {@link FacetHarness.debugVersion}, and in the snapshot,
   * read as `snapshot().version`.
   *
   * Taken off the RAW `engine.debug` rather than through the driver, so a build
   * that shipped no surface reports `"undefined"` for every operation instead of
   * failing here.
   */
  probe(names: readonly string[]): Promise<Record<string, string>>;
  /**
   * The `version` the surface itself carries, as a VALUE.
   *
   * `specs/instrumentation.md` puts the version in two places — on the surface
   * ("carries `version` … a plain number") and in the snapshot — so
   * `instrumentation/debug-api-version` reads both, and this is the surface half.
   * Through `h.debug`, so a build with no usable surface fails here on the
   * surface fault rather than answering `undefined`.
   */
  debugVersion(): Promise<number>;
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
   * Open the audio and drive frames until a sound has actually gone out,
   * answering whether anything was ever heard.
   *
   * specs/assets.md has the build DECODE its produced `.wav`s asynchronously, so
   * a build is conformant when its first frames are silent and a cue check that
   * observed the very first event would be reading the decoder. This gives the
   * gesture and then drives one frame at a time, yielding between frames so a
   * decode that frame kicked off can land, until something sounds, which under
   * specs/ui.md it must, since one of the two music beds plays on every screen.
   * The frames are counted, never timed.
   *
   * It answers rather than hanging, so a check can say "the build made no sound
   * at all". It DRIVES FRAMES, so call it while arranging and read
   * `h.frame()` after.
   */
  warmAudio(): Promise<boolean>;
}

/**
 * Everything a check reads off one engine running one build.
 *
 * The package's contract, less its `cues` — which is the package's `TimedCue` and
 * this case's is not, see {@link TimedCue} — plus everything above.
 */
export type Harness = Omit<
  EngineHarness<FacetSnapshot, FacetDriver, FacetEngine>,
  "cues"
> &
  FacetHarness;

/* -------------------------------------------------------------------------- */
/* Building one                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The clock the harness actually hands the engine.
 *
 * It wraps the caller's clock and lets {@link FacetHarness.advanceSeconds} queue
 * an exact list of deltas for a bounded number of frames, after which the base
 * clock takes over again. One API therefore covers both "n frames at the suite's
 * tick" and "this second, in this many frames", which is what a check about the
 * simulation advancing on elapsed time rather than on frames needs.
 *
 * It stays with the case: the package's engine harness runs `n` frames of
 * whatever the clock says and has no member that divides a named span, which is
 * the engineless half's `advanceSeconds` and not this one's.
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

/**
 * A logical stage point in the CLIENT/CSS coordinates a pointer event carries.
 *
 * `(x * view.scale + view.offsetX) / dpr`, the inverse of the mapping the engine
 * applies to an incoming event, and the one conversion the pointer verbs go
 * through. The fit is stated in DEVICE pixels and a pointer event carries CSS
 * pixels, so dividing by `dpr` is what keeps a press correct on a surface whose
 * backing store is denser than its layout. At the default shape the two are the
 * same number; a `dpr` of zero or less is no density at all and reads as 1.
 *
 * Kept here rather than taken off the package's `Harness.pointer`, which does the
 * same arithmetic without that last guard: the whole point of `client` is that a
 * check can ask where a gesture WILL land, so the reading and the gesture have to
 * be one function.
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
 * How many frames {@link Harness.warmAudio} drives before it gives up.
 *
 * NOT a specification figure. specs/assets.md fixes only that a produced sound is
 * decoded asynchronously, never how many frames that takes, so this is the
 * suite's own patience: a failure cap counted in frames rather than measured in
 * real time.
 */
const AUDIO_WARM_FRAMES = 240;

/**
 * Every live harness's fault log, and the one `console.error` that feeds them.
 *
 * A single wrapper is installed the first time a harness is built and left in
 * place: a per-harness save-and-restore would put back a stale function when two
 * harnesses overlap, and this way what a harness records is bounded by the window
 * it is registered for instead. Everything still reaches the real console, so a
 * build's own logging is not swallowed.
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

/**
 * The package's engine machinery, bound to Facet on this engine.
 *
 * Five of the config's members are where the engines and the cases differ, and
 * each is answered here from what THIS project is:
 *
 *  - `driver` is the apply-threaded strategy, over `surface.ts`'s `READINGS`.
 *    The surface it threads is the build's own, or an `absentSurface` naming the
 *    fault when {@link surfaceFaultOf} found one — so a build that returned no
 *    surface, or one carrying no `reset`, fails the checks that reach the game
 *    through the surface and never the `beforeEach` that built the harness. It
 *    narrows nothing: Facet asserts on the snapshot the specification fixes,
 *    field for field, so there is no projection to apply.
 *  - `toLogical` is left at the identity. There is no camera under this engine —
 *    the engine maps the stage onto the canvas and nothing else stands between.
 *  - `pointerPrecision` is `"exact"`, which is the arithmetic {@link toClient}
 *    has always done: a raised pointer lands where the caller asked rather than
 *    on the nearest device pixel.
 *  - `pointerEvent` is left at the package's default, which for a gesture naming
 *    no device is the POSITION-ONLY event this project has always dispatched.
 *    The engine reads `clientX`, `clientY` and `isPrimary` off it and applies its
 *    own default for the rest.
 *  - `cueEvents` names BOTH firings. The package subscribes `cue:played` alone by
 *    default and a loop is not a play — but Facet reads the two APART, in
 *    {@link FacetHarness.cues} and {@link FacetHarness.loops}, and the only place
 *    a subscription can be made before the build's `initialize` runs is here. A
 *    subscription made afterwards would miss a bed a build started while it was
 *    loading, so both arrive on one list and {@link asTimedCue} splits them by
 *    `looped`.
 */
const kit = createEngineCaseHarness<FacetSnapshot, FacetDriver, FacetEngine>({
  slug: "facet",
  projectRoot: PROJECT_ROOT,
  stage: { width: STAGE_W, height: STAGE_H },
  tickHz: TICK_HZ,
  surfaceRequirement: SURFACE_REQUIREMENT,
  // The package's copy readings coalesce a frame's text into the logical runs
  // it spells, so each text call is measured and the transform in force at it
  // recorded; without a width every draw is a point and nothing merges.
  recorder: { measureText: true },
  cueEvents: ["cue:played", "cue:looped"],
  defaultClock: () => new HarnessClock(new ConstantClock(TICK_MS)),
  createEngine: ({ canvas, clock, surface }) =>
    createEngine<FacetState, FacetSurface>({
      canvas,
      width: STAGE_W,
      height: STAGE_H,
      game,
      // The build's own stage background, handed to the engine exactly as the
      // seeded `src/main.ts` hands it (specs/overview.md).
      background: BACKGROUND,
      layout: LAYOUT,
      clock,
      surface: surface as SurfaceMetrics,
    }),
  driver: (engine, raw) => {
    const fault = surfaceFaultOf(engine);
    return applyDriver<DeepReadonly<FacetState>, FacetState, FacetDriver>(
      engine,
      fault === null
        ? raw
        : absentSurface<FacetSurface>(SURFACE_REQUIREMENT, fault),
      { readings: READINGS },
    );
  },
  snapshot: (debug) => debug.snapshot(),
  pointerPrecision: "exact",
});

/**
 * Build an engine over a canvas of the harness's own, initialize the build's
 * game, and hand back everything a check reads.
 *
 * The options the kit passes the factory are exactly the ones the seeded
 * `src/main.ts` passes — the design size, the build's exported `BACKGROUND`, and
 * the layout — plus the clock and the `SurfaceMetrics` a headless run needs.
 * Everything else the build decided lives inside `src/game.ts`.
 *
 * At the default shape a logical unit is a device pixel, so only a fit check ever
 * has to think about the letterbox.
 *
 * It NEVER throws from its own construction. A surface the build did not return
 * is recorded on {@link FacetHarness.surfaceFault} and lands on the checks that
 * reach through the surface, and `reset` is posed only when there is a surface to
 * pose it on — so a build with no surface fails the items that are about the
 * surface rather than every item in the run.
 *
 * The kit's event subscriptions are made BEFORE `initialize`, which is what makes
 * the game's own loading observable: construction runs no game code, so nothing
 * has happened yet.
 */
export async function createHarness(
  options: HarnessOptions = {},
): Promise<Harness> {
  const pageErrors: string[] = [];
  captureConsoleErrors();
  errorSinks.add(pageErrors);

  // Taken before the engine exists, so `requests` holds the whole of what THIS
  // build asked for — every produced file its `initialize` fetched included.
  const mark = assetHost.mark();

  const clock = new HarnessClock(options.clock ?? new ConstantClock(TICK_MS));
  const base = await kit.createHarness({
    clock,
    cssWidth: options.cssWidth,
    cssHeight: options.cssHeight,
    dpr: options.dpr,
  });

  // Held before the members that replace them are defined below. The extension
  // is written ONTO `base` itself, so from that moment `base.advance`,
  // `base.dispose` and `base.cues` ARE the replacements — and a body that
  // reached for one of them through `base` would call itself.
  const step = base.advance;
  const teardown = base.dispose;
  /** Every firing the kit stamped, one-shots and loop starts on one list. */
  const firings = base.cues;

  /**
   * Every frame this harness drives, so a frame that THREW is on the record.
   *
   * The error still travels: the check that drove the frame fails as it should,
   * and `pageErrors` is what lets a check say the build faulted rather than
   * merely answered wrongly.
   */
  const drive = async (frames: number): Promise<void> => {
    try {
      await step(frames);
    } catch (error) {
      pageErrors.push(String(error));
      throw error;
    }
  };

  const surfaceFault = surfaceFaultOf(base.engine);
  // Only where there is a surface to pose it on: a fault belongs on the checks
  // that reach through the surface, never on this function.
  if (surfaceFault === null) {
    base.debug.reset();
  }

  /** Where the last real pointer event was, so a release needs no position. */
  let lastPointer = { x: 0, y: 0 };
  const point = (type: PointerEventType, x: number, y: number): void => {
    lastPointer = { x, y };
    const at = toClient(base.viewport(), base.shape.dpr, x, y);
    base.events.dispatchEvent(new PointerPositionEvent(type, at.x, at.y));
  };

  const frameCalls = async (): Promise<DrawCall[]> => {
    base.calls.length = 0;
    await drive(1);
    return base.calls.slice();
  };

  let harness: Harness;

  const own: FacetHarness & Pick<Harness, "advance" | "dispose"> = {
    get state() {
      return base.engine.state;
    },
    surfaceFault,
    basePath: options.basePath ?? "/",
    pageErrors,
    get failedRequests() {
      return base.assetFailures.map(
        (failure) => `${failure.reason} ${failure.path}`,
      );
    },
    get requests() {
      return assetHost.requestsSince(mark).map((request) => request.url);
    },
    get cues() {
      return firings.filter((cue) => !cue.looped).map(asTimedCue);
    },
    get loops() {
      return firings.filter((cue) => cue.looped).map(asTimedCue);
    },

    board: () => renderBoard(base.snapshot()),
    advance: drive,

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

    async tapAction(action) {
      await base.tap(BINDINGS[action][0]);
    },

    client: (x, y) => toClient(base.viewport(), base.shape.dpr, x, y),
    press: (x, y) => point("pointerdown", x, y),
    moveTo: (x, y) => point("pointermove", x, y),
    lift: () => point("pointerup", lastPointer.x, lastPointer.y),

    frameCalls,
    probe(names) {
      const surface: unknown = base.engine.debug;
      const held =
        typeof surface === "object" && surface !== null
          ? (surface as Record<string, unknown>)
          : {};
      const ops: Record<string, string> = {};
      for (const name of names) ops[name] = typeof held[name];
      return Promise.resolve(ops);
    },
    debugVersion: () => Promise.resolve(base.debug.version),
    patch: (col, row, half) => readPatch(harness, col, row, half),

    armAudio: () => Promise.resolve(),

    async warmAudio() {
      await own.armAudio();
      for (let frame = 0; frame < AUDIO_WARM_FRAMES; frame += 1) {
        // A frame, so the build asks for the screen's bed and for anything else
        // it plays from `update`. The drive is awaited, so a decode that frame
        // kicked off lands before the next one.
        await drive(1);
        if (firings.length > 0) return true;
      }
      return firings.length > 0;
    },

    // The transport and the audio context are NOT taken down here. They are the
    // worker's, installed once at module scope and reference counted by the
    // package; pulling them out from under the next harness this file builds is
    // exactly what their teardown contract exists to prevent, and a worker that
    // simply exits leaves them standing.
    dispose: () => {
      teardown();
      errorSinks.delete(pageErrors);
    },
  };

  harness = Object.defineProperties(
    base,
    Object.getOwnPropertyDescriptors(own),
  ) as unknown as Harness;
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
// and `QUIT` really returns to the title is what the two `screens/start-round-*`
// points, `levels/continue-opens-next-level` and the two `screens/quit-from-*`
// points decide, by
// working the menu the way a player does and reading what the build did. Every
// other check reaches its scenario through here instead, so a build with a
// broken title menu fails those items rather than every item in the project.
//
// RECONCILING AFTER A POSE. specs/instrumentation.md's `reconcile()` brings
// every reading the surface reports into agreement with the game as it stands,
// without advancing anything — so a build that keeps one of the seven derived
// fields as a stored copy (`legalSwap` above all, which follows from the whole
// board) answers for the board and the screen the helper just posed rather than
// for the ones before it. A helper here that writes a board, takes one out of
// play, shows a screen, or plays a swap calls it before it returns, so a check
// that poses through the helpers never calls it itself. A check that poses with
// `h.debug.set…` directly and then reads calls it once, before its first read.
//

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
  h.debug.reconcile();
  return h.snapshot();
}

/**
 * Put away whatever an earlier scenario left standing on the board: the
 * selection, the offer, the refusal, and any swap or chain step in motion, each
 * cleared only where the snapshot reports one. A no-op, and not an error, on a
 * board with nothing standing.
 *
 * `specs/instrumentation.md` fixes what `clearSelection`, `clearOffer`,
 * `clearRefusal` and `clearChain` do to a thing that stands and says nothing
 * about a call with nothing to put away, and its rule that "no operation returns
 * with the state as it was" lets a build read such a call as one it must fail
 * loudly on. So each clear is issued only where there is something to clear;
 * `pointer/press-selects` and `appearance/selection-marked` still call
 * `clearSelection` and `clearOffer` themselves. The snapshot shape fixes
 * `selection`, `offer` and `refusal` as `null` while none stands and the timers
 * at rest while `phase` is `idle`, so those four readings are the whole of what
 * there is to put away.
 */
export function clearStanding(h: Harness): void {
  const { selection, offer, refusal, phase } = h.snapshot();
  if (selection !== null) h.debug.clearSelection();
  if (offer !== null) h.debug.clearOffer();
  if (refusal !== null) h.debug.clearRefusal();
  if (phase !== "idle") h.debug.clearChain();
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
  clearStanding(h);
  h.debug.loadBoard(rows);
  h.debug.setMenuIndex(0);
  h.debug.setScreen("playing");
  h.debug.reconcile();
  return h.snapshot();
}

/**
 * Pose what R9's refill deals into each named column, one `setRefillKinds`
 * per column, so a scenario whose outcome a draw would otherwise decide is the
 * rules' alone. Every column not named keeps whatever pose it had, and a
 * `reset` returns every column to drawing.
 */
export function poseRefill(
  h: Harness,
  poses: readonly (readonly [col: number, kinds: string])[],
): FacetSnapshot {
  for (const [col, kinds] of poses) h.debug.setRefillKinds(col, kinds);
  return h.snapshot();
}

/**
 * Begin a fresh round, exactly as choosing `PLAY` from the title does.
 *
 * Every figure specs/rules.md returns to its opening value when a round starts,
 * written one at a time, and then the opening board dealt through the game's own
 * code — which is the one part of it that cannot be decomposed, since what makes
 * a dealt board an opening board is R4 and the draw rather than any cell a check
 * could write.
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
  clearStanding(h);
  h.debug.dealBoard();
  h.debug.setMenuIndex(0);
  h.debug.setScreen("playing");
  h.debug.reconcile();
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
  clearStanding(h);
  h.debug.dealBoard();
  h.debug.setMenuIndex(0);
  h.debug.setScreen("playing");
  h.debug.reconcile();
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
  clearStanding(h);
  h.debug.clearBoard();
  h.debug.setMenuIndex(0);
  h.debug.setScreen("title");
  h.debug.reconcile();
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
  h.debug.reconcile();
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
  h.debug.reconcile();
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
  h.debug.reconcile();
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
  h.debug.reconcile();
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
  h.debug.reconcile();
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
  h.debug.reconcile();
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
//
// The two watchers stay with the case, and so does the type they answer. The
// package's kit carries a `watchCues` of its own — but it subscribes whichever
// events `cueEvents` named, and this project named BOTH so that a bed started
// during `initialize` is not missed. Splitting them again at the moment a check
// asks is what these two do, and it is the split every audio item in this
// project is written against.

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
//
// `callsTo`, `setsOf` and `drawnText` are the package's, re-exported above under
// the names this project's suites already use — the three were byte-identical to
// the copies that stood here. `drawnText` keeps the two text channels APART on
// purpose: a build that outlines its title issues a `strokeText` and a `fillText`
// per glyph, and a single list in true call order would read `F F A A C C E E T T`,
// a run that spells nothing. Listed by channel, each channel spells the copy on
// its own.
//
// COPY IS READ BY THE PACKAGE, NOT HERE. specs/ui.md fixes the COPY — `FACET`,
// `PRESSURE FINDS THE FLAW`, `SCORE`, `PLAY AGAIN` — and fixes nothing about how
// many draw calls a build spends on it, so a suite reads a frame's calls
// (`frameCalls`) through `drewTextAnywhere` from `./case-harness/text`: the
// logical runs the measured glyphs coalesce into, joined across every baseline,
// matched as a substring ignoring case and whitespace. That finds one call per
// line, one per word, one per glyph, an entry decorated with a marker, and a
// title letter-spaced under a drop shadow alike, and it is bounded the way any
// reading over the joined frame is: it decides that copy IS on screen and NEVER
// that two pieces of copy are separate, so an item about two readouts asks about
// each of them. `drawnTextLines` from the same module words a failure with the
// runs the frame spelled.

/**
 * The geometry calls a frame made, by name.
 *
 * THIRTEEN, AND NOT THE PACKAGE'S FOURTEEN. The package's list carries
 * `putImageData` as well, which is a blit of raw pixels rather than a drawing
 * operation the build composed — and this case's counts were taken without it.
 * Folding the two would move every count a check compares by however many blits
 * a build's presentation happens to make, silently, so Facet keeps its own.
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
/* Pixels                                                                     */
/* -------------------------------------------------------------------------- */

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
 * size holds. `patchDistance` is a MEAN over the box, so a box that changed
 * shape near an edge would make two readings of one cell answer differently for
 * the box rather than for what was drawn in it.
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
 * THE PRESENCE INSTRUMENT. Per-pixel rather than between the two mean colors,
 * because two patches with identical means can still differ in every pixel, so a
 * mean would call a cell unchanged that the build redrew. Every check that reads
 * it asks one question of the number — whether it is zero — and a check that
 * asked how LARGE it is would be grading a build's palette, its contrast or its
 * treatment, which the reviewer judges and no check here may.
 *
 * NOT the package's `pixelsChanged`, which counts how many BYTES of two
 * whole-frame captures differ, and not its `pixelsDiffering` either, which counts
 * PIXELS past a tolerance. A threshold stated over one of the three is meaningless
 * over the others.
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
// A review item may declare a `replay` or an `image` OUTPUT beside its verdict:
// what the build itself drew while a check drove it, kept as evidence a reviewer
// can scrub or compare against the reference implementation's. Both writers are
// the package's, bound here to this case's slug and to THIS directory — the
// project root may never be derived inside the package, which is staged one level
// deeper than this file, or every output would be addressed one directory too far
// down and silently, because both writers are required not to raise.
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

/**
 * The built site, or the committed `public/` tree when nothing has been built:
 * where a check about a PRODUCED FILE looks for it.
 *
 * specs/assets.md commits every produced file under `public/assets/` and says
 * the build copies that directory into `dist/` unchanged, so both layouts name
 * the same asset by the same path below the root. The order is
 * {@link ASSET_ROOTS}, so a check that opens a produced file reads the same file
 * the transport served the build.
 */
export function siteRoot(): string | null {
  for (const candidate of ASSET_ROOTS) {
    const path = join(WORKSPACE_ROOT, candidate);
    if (existsSync(path)) return path;
  }
  return null;
}

/**
 * Where the running suite's `outputId` output belongs, or `null` when nothing
 * is collecting media.
 *
 * The suite is the one vitest is currently running rather than one the caller
 * names, so a check can never write its evidence under another point's address.
 * The package's reading, bound to this project's root; it throws rather than
 * answering a plausible path when the running suite is not inside that root,
 * which is the one failure the writers below cannot report.
 */
export function mediaDestination(
  outputId: string,
  extension: string,
): string | null {
  return mediaDestinationIn(PROJECT_ROOT, outputId, extension);
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
 *
 * The thinning and re-tabling the recording goes through are the package's: an
 * over-long section is kept whole at a lower frame rate rather than cut short,
 * and the tables are rebuilt to hold only what the surviving frames name.
 */
export const captureReplay = makeReplayCapture("facet", PROJECT_ROOT);

/**
 * Keep the frame currently on the canvas as the review item's `outputId`
 * output.
 *
 * What is written is whatever the last frame that RAN left behind, so call it
 * after the `advance(1)` that poses the thing under test and before the
 * assertions, so a check that fails still leaves the picture that shows why.
 *
 * Synchronous, because a 2D canvas is already rasterized and `toBuffer` answers
 * now — which is what the ninety-five suites that call it without an `await`
 * were written against.
 *
 * The package's writer bound to this case rather than `kit.captureStill`, which
 * is the same three lines over the kit's own `EngineHarness` — a type this
 * project's {@link Harness} deliberately departs from in one member, its `cues`.
 * Reaching the writer directly is what keeps that departure from costing every
 * call site a cast.
 */
export function captureStill(h: Harness, outputId: string): void {
  captureOutputSync("facet", PROJECT_ROOT, outputId, "png", () =>
    h.canvas.toBuffer("image/png"),
  );
}
