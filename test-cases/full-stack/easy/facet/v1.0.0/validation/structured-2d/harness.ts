// Facet — the shared validator harness, structured-2d. CASE-PROVIDED.
//
// Every check in this suite is an ordinary vitest test that runs IN THE SAME
// PROCESS as the build. It imports the engine and the build's `src/game.ts`,
// creates an engine over a canvas it owns and a clock it chose, and steps the
// game with `engine.advance`. Nothing drives a browser, nothing polls, and no
// wall-clock time passes: a check asks for a number of frames and gets exactly
// that number, at exactly the deltas its clock supplied.
//
// WHAT IS HERE AND WHAT IS NOT. The machinery of that paragraph — the canvas and
// its draw-command recorder, the debug surface and the stand-in for a missing
// one, the key and pointer events, the driven frame, the sweep, the cue
// stamping, the transport a produced file is loaded through, the audio context
// that decodes and never sounds, and the evidence a review item's output is
// written from — is the shared `@clockwyrks/case-harness` package's, staged in
// beside this file as `./case-harness/`. It arrives through ONE seam,
// `createEngineCaseHarness`, which takes this case's types as GENERICS and
// everything else about it as one config object — including the engine itself,
// which arrives as VALUES (`createEngine`, `ConstantClock`, the game
// definition), because the package names no engine and cannot.
//
// What stays HERE is what is genuinely Facet's: the case's types, the tick rate
// its suites step at, the sentence a missing surface is failed against, the
// board's own readings, the patch its cells are sampled through, the two
// frame-counting helpers every drive is sized by, and every scenario helper that
// poses this game. A migrated harness is still most of a thousand lines, and
// nearly all of them are the case's own.
//
// WHAT A CHECK READS. The game's own state (through the surface's `snapshot`),
// the engine's object model — the open world and its game state — the engine's
// frame counter, the events the engine broadcast (`cue:played`, `cue:looped`,
// `asset:failed`), and, for the appearance checks, the pixels on the canvas or
// the calls the 2D context received. Nothing here fabricates an outcome: the
// helpers only ARRANGE the game through the debug surface, and the real ticks
// the build wrote are what run from there.
//
// WHY THE DEBUG SURFACE RATHER THAN RAW ASSIGNMENT. specs/instrumentation.md
// fixes its operations, so they mean the same thing in every build:
// `loadBoard(rows)` poses the written board exactly, `requestSwap` goes through
// the same acceptance path a player's swap takes, and `reset()` gives
// everything back. Posing through it is how a scenario is arranged, and it
// is the seam the case's specification documents. `surface.ts` is that
// specification as types, and it is the only description of the surface this
// harness reads: the build's own module for it is never imported.
//
// WHERE THE SURFACE COMES FROM. Off `engine.debug`, never built here. The game
// instance's `initialize` returns it, the engine holds that same object, and
// reading it back off the engine is the only way a surface reaches a check — so
// a build that returned no surface, or a surface missing an operation, fails the
// checks that reach the game through it. The package's `readDebugSurface` does
// that read and stands an `absentSurface` in where there is nothing to read, so
// the fault lands on the points whose checks reach through the surface rather
// than on every suite's `beforeEach`.
//
// HOW THE SURFACE IS DRIVEN. Directly — `identityDriver`, the object the build
// returned, untouched. Under this engine the world is LIVE, so a pose is
// `h.debug.loadBoard(rows)` and it has already happened when the call returns,
// and a reading is `h.debug.snapshot()`. There is no driver in between, which is
// the one thing that differs from the `simple-2d` copy of this file, where state
// is held by value and each pose runs through `engine.apply`.
//
// POSES DO NOT ADVANCE. No helper here advances a frame implicitly except the
// eight that are named for it: `swapAndStep`, `advanceStep`, `resolveChain`,
// `swapAndResolve`, `frameCalls`, `tap`, `tapAction` and `warmAudio`. The
// pointer verbs are not among them — `press`, `moveTo` and `lift` ARM an event
// and return, and the frame that delivers it is the caller's own next
// `advance`, which is what lets a check put its frame boundary where the
// question is. The gesture helpers below are not among them either: a press,
// the moves that carry it and the release all take effect at their calls, so a
// whole move is posed without the game advancing at all.
// Facet runs in ONE level (specs/overview.md), so no pose is a level
// transition and none of them needs a frame to land — which is what keeps
// `simTime`, `stepTimer` and the refusal timer readable exactly as the specs
// state them. A check that needs the frame DRAWN calls `h.advance(1)` itself.
//
// EVERY FIGURE COMES FROM `./constants`, NEVER FROM `../src/constants`. The build
// is held to the specification, not to its own numbers; see that file's header.
// The only things imported from the build are `game` and `BACKGROUND`, its two
// named deliverables in `src/game.ts`, and they are taken BY NAME, one binding at
// a time: a two-name list is a list a reader can count, where a namespace binding
// would name the same module and hand this file everything in it.

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
  type GameDefinition,
  type GameInstance,
  type GameState,
  type SurfaceMetrics,
  type Viewport,
  type World,
} from "@clockwyrks/structured-2d";
import {
  createEngineCaseHarness,
  captureOutputSync,
  identityDriver,
  installAssetHost,
  installAudioContext,
  missingOps,
  outputDestination,
  type AssetFailure,
  type AudioBufferLike,
  type EngineHarness,
  type OutputExtension,
  type TimedCue as EngineCue,
  type UntilOptions,
  type UntilResult as EngineUntilResult,
} from "./case-harness/engine/index";
import { deviceOf, makeReplayCapture } from "./case-harness/engine/2d";
import {
  callsTo,
  setsOf,
  type DrawCall,
  type TextGeometry,
} from "./case-harness/draw-calls";
import { drawnText } from "./case-harness/text";
import type { Pixel } from "./case-harness/pixels";
import { BACKGROUND as buildBackground, game as buildGame } from "../src/game";
import { fail } from "./assert";
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
import type { FacetDebugApi, FacetSnapshot, Screen } from "./surface";

export { ConstantClock, JitterClock, SequenceClock };
export type { Clock, Viewport, World };
export { MAX_REPLAY_FRAMES };

/* -------------------------------------------------------------------------- */
/* The build under test                                                       */
/* -------------------------------------------------------------------------- */

/** The case's surface, exactly as `surface.ts` specifies it. */
export type FacetSurface = FacetDebugApi;

/**
 * The surface as every check drives it.
 *
 * Under this engine the raw surface IS imperative — a pose takes only its own
 * arguments and returns nothing, a reading takes nothing and returns plain
 * data — so no wrapper stands between a check and the object the build returned,
 * and the driver type is the surface type itself. The alias is kept so a check
 * reads the same way it does under `simple-2d`, where the state is held by value
 * and every member has to be threaded through `engine.apply`.
 */
export type FacetDriver = FacetSurface;

/** The engine this project stands a build up on. */
export type FacetEngine = Engine<FacetSurface>;

/**
 * The state specs/state.md declares, as the CASE declares it.
 *
 * Written here rather than imported from `../src/game` on purpose. A build's own
 * `FacetState` is the build's; what a check reads it against is the
 * specification, and this is the specification. It is a view over the engine's
 * `GameState` — the world's state IS an instance of the build's class, and these
 * are the fields specs/state.md says that class carries.
 *
 * A check should prefer `snapshot()`, which is the specified reading. This exists
 * for the rare point that is about the state itself rather than about the view of
 * it, and for a reader who wants to see what `engine.world.state` holds.
 */
export type FacetState = GameState & {
  screen: string;
  menuIndex: number;
  board: { cols: number; rows: number; cells: unknown[] };
  phase: string;
  chainStep: number;
  swapTimer: number;
  stepTimer: number;
  score: number;
  level: number;
  levelScore: number;
  lastCleared: number;
  lastPoints: number;
  lastWaves: number;
  moveScore: number;
  bestMove: number;
  bestChain: number;
  selection: { col: number; row: number } | null;
  offer: { col: number; row: number } | null;
  refusal: { a: CellRef; b: CellRef; timer: number } | null;
  armedTarget: string | null;
  pointer: { x: number; y: number; down: boolean; device: PointerDevice };
  simTime: number;
  muted: boolean;
  refillKinds: string[];
};

/**
 * The build's game, typed against the surface the CASE specifies.
 *
 * The build declares its own type for the surface its instance's `initialize`
 * returns — the `D` of its `GameInstance<D>` — and that type is the build's:
 * what a check holds it to is `surface.ts`, so the definition is cast to the
 * case's `GameDefinition<FacetSurface>` here and the engine is parameterized with
 * it. A surface that departs from the specification is caught where a check
 * reaches for the missing member, not by the build's own compiler.
 */
const game = buildGame as unknown as GameDefinition<FacetSurface>;

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

/* -------------------------------------------------------------------------- */
/* Reading one frame's render                                                 */
/* -------------------------------------------------------------------------- */

/**
 * One recorded operation on the 2D context, and where a text call put its run.
 *
 * BOTH ARE THE PACKAGE'S, because the recorder that writes them is. The one
 * thing that moved in the move is `TextGeometry.transform`, which the package
 * writes as the six numbers `[a, b, c, d, e, f]` where the copy here wrote them
 * as a named object; nothing in this directory reads it either way.
 */
export type { DrawCall, TextGeometry };

/* The two list readings over a frame, taken straight off the package. */
export { callsTo, setsOf };

/**
 * Every string the frame drew: the `fillText` runs in call order, then the
 * `strokeText` runs in call order.
 *
 * The two channels are kept apart on purpose, and the package's reading keeps
 * them apart the same way. A build that outlines its title issues a `strokeText`
 * and a `fillText` for each glyph, and a single list in true call order would
 * read `F F A A C C E E T T` — a run that spells nothing. Listed by channel,
 * each channel spells the copy on its own.
 */
export { drawnText };

/*
 * COPY IS READ BY THE PACKAGE, NOT HERE. specs/ui.md fixes the COPY — `FACET`,
 * `PRESSURE FINDS THE FLAW`, `SCORE`, `PLAY AGAIN` — and fixes nothing about how
 * many draw calls a build spends on it, so a suite reads a frame's calls
 * (`frameCalls`) through `drewTextAnywhere` from `./case-harness/text`: the
 * logical runs the measured glyphs coalesce into, joined across every baseline,
 * matched as a substring ignoring case and whitespace. That finds one call per
 * line, one per word, one per glyph, an entry decorated with a marker, and a
 * title letter-spaced under a drop shadow alike, and it is bounded the way any
 * reading over the joined frame is: it decides that copy IS on screen and NEVER
 * that two pieces of copy are separate, so an item about two readouts asks about
 * each of them. `drawnTextLines` from the same module words a failure with the
 * runs the frame spelled.
 */

/**
 * The geometry calls a frame made, by name.
 *
 * FACET'S OWN LIST, and one entry short of the package's, which also counts
 * `putImageData`. Keeping the case's list is the point: `drawOps` is a COUNT two
 * frames of one scene are compared by, and a list that counted one more method
 * would move every such comparison for a build that blits an image buffer,
 * silently and in one direction. The package's list is the right one to fold onto
 * the day a point here is stated over it on purpose.
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
/* Events the engine broadcasts                                               */
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
 * NOT THE PACKAGE'S `TimedCue`, and the difference is not cosmetic. The package
 * ships TWO cues and neither is this one: its ENGINE half spells the same firing
 * `{ cue: string; t; gain; frame; tick; looped }` — a NON-nullable name, and
 * `looped` where this says `loop` — and its ENGINELESS half's carries `{ frame,
 * tick, t }` and no name or gain at all. So there is no half to fold onto:
 * binding the engine one here would make `cue: string` a promise `none` cannot
 * keep, and it is the three projects reading identically that this type exists
 * for. Facet keeps its own, and {@link FacetModel.cues} and
 * {@link FacetModel.loops} are read off the package's list through
 * {@link asTimedCue}.
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

/** One asset the build asked for and did not get. Also the package's. */
export type { AssetFailure };

/* -------------------------------------------------------------------------- */
/* Pixels and patches                                                         */
/* -------------------------------------------------------------------------- */

/** One device pixel, as `[r, g, b, a]`. */
export type Rgba = Pixel;

/** A square of device pixels read off the canvas, centered on a cell. */
export interface Patch {
  /** The half-size in LOGICAL units the patch was asked for. */
  half: number;
  width: number;
  height: number;
  data: Uint8ClampedArray;
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
/* Options and results                                                        */
/* -------------------------------------------------------------------------- */

export interface HarnessOptions {
  /** The clock each frame takes its delta from. Defaults to `TICK_MS`. */
  clock?: Clock;
  /** The element's laid-out CSS width. Defaults to `STAGE_W`. */
  cssWidth?: number;
  /** The element's laid-out CSS height. Defaults to `STAGE_H`. */
  cssHeight?: number;
  /** Device pixels per CSS pixel. Defaults to 1, so one device pixel is one unit. */
  dpr?: number;
  /**
   * The sub-path the build is served from, as though the page sat there.
   * Defaults to `"/"`.
   *
   * specs/assets.md has a build load every produced file PAGE-RELATIVE, so that
   * the same tree works wherever it is mounted. A page-relative path resolves
   * BELOW the mount, and the tree this harness serves is the tree the mount is a
   * mount of — so posing a sub-path moves nothing about which file answers, and
   * every produced file stands up for this check exactly as for every other.
   * That is the arrangement `assets/assets-load-page-relative` needs: it reads
   * its verdict off the PATHS the build resolved and never off a withheld file,
   * and a build that spelled one asset `/assets/...` is caught by that reading.
   */
  basePath?: string;
}

/** How far a sweep may run, and how many frames separate two samples. */
export type { UntilOptions };

/**
 * What a sweep found: whether the predicate ever held, and where it stopped.
 *
 * The package's, which carries the same count under both `frames` and `ticks`
 * because the harnesses in the tree disagreed about the word. This project has
 * always counted `frames`, and does.
 */
export type UntilResult = EngineUntilResult<FacetSnapshot>;

/** What driving a chain to its end found. */
export interface SettleResult {
  /** Whether `phase` really reached `idle` inside the cap. */
  settled: boolean;
  /** Chain steps driven. */
  steps: number;
  /** Frames advanced. */
  frames: number;
  snapshot: FacetSnapshot;
}

/* -------------------------------------------------------------------------- */
/* The surface                                                                */
/* -------------------------------------------------------------------------- */

/**
 * What the build owes when its surface is missing: the `Expected:` line of the
 * failure every check that reaches for the surface lands on, beside what
 * `engine.debug` was found holding instead.
 *
 * The case's own sentence rather than the package's, because where the surface
 * comes from is this engine's business, and a fault that misdescribed the return
 * would send a reviewer to the wrong line of the build.
 */
export const SURFACE_REQUIREMENT =
  "the debug surface src/game.ts's instance returns from initialize, which " +
  "the engine hands back from engine.debug (specs/instrumentation.md)";

/**
 * Fail the running check on `fault` — this harness's account of what is wrong
 * with the build's surface — paired with what the specification requires.
 */
export function failSurface(fault: string): never {
  return fail(SURFACE_REQUIREMENT, fault);
}

/* -------------------------------------------------------------------------- */
/* The clock                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The suite's clock: the caller's, with a queue of exact deltas in front of it.
 *
 * `advanceSeconds(s, n)` pushes `n` deltas of `s * 1000 / n` and advances `n`
 * frames, so one API covers both "n frames at the suite's tick" and "this second
 * of game time, in this many frames" under every engine. When the queue is empty
 * the base clock answers, so a check that set up a `SequenceClock` or a
 * `JitterClock` keeps it.
 *
 * STAYS WITH THE CASE. The package's kit drives `n` frames by making `n` calls of
 * one frame each and fixes every boundary itself; the interval a build is asked
 * to DIVIDE is the subject of `instrumentation/delta-time-independent`, and this
 * queue is how that interval is posed on an engine whose clock is asked for a
 * delta per frame.
 */
export class HarnessClock implements Clock {
  private readonly base: Clock;
  private readonly queued: number[] = [];

  constructor(base: Clock) {
    this.base = base;
  }

  /** Queue `count` frames of exactly `deltaMs` each. */
  queue(deltaMs: number, count: number): void {
    for (let i = 0; i < count; i += 1) this.queued.push(deltaMs);
  }

  delta(nowMs: number): number | null {
    const next = this.queued.shift();
    if (next !== undefined) return next;
    return this.base.delta(nowMs);
  }
}

/** The seconds `frames` frames of the suite's own clock cover. */
export function seconds(frames: number): number {
  return frames / TICK_HZ;
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
 *
 * The kit's own `pointer` does this same arithmetic and dispatches the same
 * event; this stays because {@link Harness.client} is a reading a check takes
 * WITHOUT raising anything, and because it is the one place the guard on a
 * nonsense `dpr` lives.
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
 * real time, and wide enough that a build that makes no sound at all is reported
 * rather than waited on.
 */
const AUDIO_WARM_FRAMES = 240;

/* -------------------------------------------------------------------------- */
/* The two roots, and the platform a headless run stands in for               */
/* -------------------------------------------------------------------------- */
//
// The suites in this directory run the build IN PROCESS, in Node, over an
// `@napi-rs/canvas` canvas. The engine takes every measurement through the
// `SurfaceMetrics` the harness supplies, so it needs no DOM — but four faculties
// a browser has and Node does not are still reached for, by the ENGINE and by
// the packages a Facet build is entitled to use, while a frame runs. Each is the
// CASE's responsibility rather than the build's: without them the build would
// fail checks over a fault this harness created.
//
//  1. `fetch`, over the build's own tree on disk. The engine's asset loader
//     resolves every path under `assets/` and fetches it, and a Facet build's
//     gems, break sheets, particle systems, sounds and music are ALL produced
//     files (specs/assets.md) — so with no transport not one of them loads and
//     every check that reads the board's drawing would be deciding a question
//     about Node rather than about the build.
//  2. `createImageBitmap`. The loader decodes an image with it and rejects by
//     name where the host has none.
//  3. `AudioContext`, decoding only. This one is load-bearing in a way that is
//     easy to miss: `api.audio.load(cue, file)` decodes through
//     `decodeAudioData`, and a rejected load leaves the cue UNDECLARED — after
//     which the engine's `play` THROWS ("unknown audio cue …") from inside the
//     build's own `update`, failing every check in the suite over a fault the
//     harness created.
//  4. A `document` that can make a canvas, and an `OffscreenCanvas`. A build is
//     entitled to compose a picture on a scratch surface of its own before it
//     blits that surface over the frame, and a browser hands one out both ways.
//
// ALL FOUR ARE THE PACKAGE'S NOW, from `installAssetHost` and
// `installAudioContext`. The `OffscreenCanvas` used to be this file's own, because
// Facet was the only case in the tree that stood one up; spectra and cascade
// wanted the same one, which is the moment the package's README named for moving
// it, so `installAssetHost`'s `offscreenCanvas` supplies it and the stub that used
// to sit below is gone.
//
// WHERE THEY ARE INSTALLED, AND WHEN. At this module's scope, which under ES
// modules is AFTER `../src/game` above has been evaluated — the setup file that
// used to install them ran before it. That order is only observable to a build
// that reads one of these globals while its own modules are being evaluated
// rather than while a frame is running, which no conformant build does and the
// reference does not: every use in it sits inside a function the engine calls.
// It is also what every migrated engine project in the tree does.

/**
 * The directory this harness sits in, which is the validator project's root.
 *
 * Taken from this module's own URL rather than from the working directory,
 * because it has to name the same directory in both layouts this file lives in:
 * the case's own `validation/<engine>/`, and the `validation/` the runner stages
 * that directory to inside the build's tree. Never derived inside the package,
 * which is staged one level deeper than this file — a root taken there would
 * address every written output one directory too far down, silently, because the
 * writers are required not to raise.
 */
export const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

/** The build's own root, one level above the staged project. */
export const WORKSPACE_ROOT = resolve(PROJECT_ROOT, "..");

/**
 * The transport, standing for the whole of this worker's run.
 *
 * THE ROOT ORDER IS THIS CASE'S AND IS LOAD-BEARING: the built output FIRST, then
 * `public/` last, which is narrower in intent than the package's default
 * `[".", "public", "dist"]`. That is what an asset check here is really about —
 * `dist/` is what a player is served — and it means a build whose built tree is
 * missing a produced file it committed has a fault worth seeing rather than one
 * papered over by the source tree. Only a build that has not been built at all
 * falls through to `public/`.
 *
 * `onMissing: "404"` is the answer the shim this replaces gave, and it is what
 * makes the engine announce `asset:failed` with a status for a file the build
 * never produced, so a missing file fails the items about that file and only
 * those.
 *
 * `documentElement` and `offscreenCanvas` are the two ways a browser hands out the
 * scratch surface `src/scratch.ts` asks for. Both are named rather than the second
 * left to its default, because this project cannot run without one of them and a
 * reader of `domScratchCanvas` has to be able to find where each comes from.
 *
 * `nameImageBitmap` is off, deliberately, and it is the one field here whose
 * default would change a recording. Naming the canvas library's decoded image as
 * `globalThis.ImageBitmap` is what lets the ENGINE's own draw-op recorder
 * recognize a produced sprite as a bitmap source and capture its pixels into
 * every replay this project writes. The shim this replaces never named it, every
 * replay in the baseline was taken without it, and turning it on would change
 * what a reviewer's evidence holds without any point asking for it.
 *
 * The handle is kept for {@link Harness.requests}: `mark()` is taken when a
 * harness is built and `requestsSince` reads the traffic from there on.
 */
const assetHost = installAssetHost({
  workspaceRoot: WORKSPACE_ROOT,
  roots: ["dist", "build", "out", "public"],
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
 * Every figure below is inert: nothing sounds, and the engine's bus reads none of
 * them off a file-backed buffer — it announces `cue:played`, `cue:looped` and
 * `cue:stopped` from the play call itself and never from a buffer ending. The
 * length is the body's, as it was, so a decoded cue is still a value whose size
 * follows the file.
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
/* What one harness keeps beside the engine it built                          */
/* -------------------------------------------------------------------------- */

/**
 * The bookkeeping one harness starts before its engine has run any game code,
 * held against the engine it belongs to.
 *
 * WHY IT IS KEYED BY THE ENGINE. The kit builds a harness in four case-supplied
 * steps — `createEngine`, `initialize`, `driver`, `extend` — and three of them
 * need to reach the same per-harness state. The engine is the one value all
 * three are handed, and a `WeakMap` over it is therefore the only place that
 * state can live that two harnesses built in one worker cannot confuse. Nothing
 * here is module state that a second construction could overwrite.
 */
interface HarnessBox {
  /** The clock the caller's frames are queued in front of. */
  readonly clock: HarnessClock;
  /** Everything the build logged to `console.error` or threw out of a frame. */
  readonly pageErrors: string[];
  /**
   * Every LOOPING cue the build started, oldest first, as the PACKAGE stamps a
   * firing — the same shape the kit's own `cue:played` list carries, so both
   * lists cross into this case's vocabulary at the one boundary,
   * {@link asTimedCue}.
   */
  readonly loops: EngineCue[];
  /** Where the shared transport's log stood when this harness was built. */
  readonly mark: number;
  /** Give the console back. */
  readonly restore: () => void;
  /** Why the build's surface cannot be driven, or `null`. */
  fault: string | null;
}

const boxes = new WeakMap<object, HarnessBox>();

/** The bookkeeping `engine`'s harness started. */
function boxOf(engine: object): HarnessBox {
  const box = boxes.get(engine);
  if (box === undefined) {
    throw new Error("facet: this engine was not built by createHarness");
  }
  return box;
}

/* -------------------------------------------------------------------------- */
/* Everything a check reads off one engine running one build                  */
/* -------------------------------------------------------------------------- */

/**
 * What this project's `Harness` carries PAST the package's neutral contract.
 *
 * Two kinds of thing are here. The engine's own object model — the world, the
 * live state, the game instance — which this engine has and its simple sibling
 * does not; and the readings and verbs Facet's suites were written against, which
 * the kit deliberately does not guess at.
 */
export interface FacetModel {
  /**
   * The world currently open, read fresh on every access. STRUCTURED-2D ONLY.
   *
   * This engine alone has a world and a camera; `simple-2d` holds a single state
   * by value and `none` has neither.
   */
  readonly world: World;
  /**
   * The open world's game state, read fresh on every access. ENGINE-ONLY.
   *
   * Live here, because `engine.world.state` IS the build's own object; under
   * `simple-2d` the same member is a value copy. Under `none` the state never
   * leaves the page and `snapshot()` is the only reading.
   */
  readonly state: FacetState;
  /**
   * The game instance, the one framework object that outlives every level.
   * STRUCTURED-2D ONLY: this engine alone has a `GameInstance`.
   */
  readonly instance: GameInstance<FacetSurface>;
  /**
   * Every ONE-SHOT cue the build played, oldest first.
   *
   * Declared here rather than left to the kit, because the kit's own `cues` is
   * the PACKAGE's cue and this case's is not — see {@link TimedCue}. It is the
   * same list, read through {@link asTimedCue}.
   */
  readonly cues: TimedCue[];
  /** Every looping cue the build started, oldest first: the two music beds. */
  readonly loops: TimedCue[];
  /**
   * Why the build's surface cannot be driven, or `null` when nothing is wrong.
   *
   * Set when `initialize` threw, when `engine.debug` holds something that is not
   * an object, or when the object it holds carries no `reset`. A check reports
   * the same fault by the same name under all three engines; what differs is only
   * where the surface was looked for.
   */
  readonly surfaceFault: string | null;
  /**
   * Everything the build logged to `console.error`, or threw out of a frame
   * this harness drove, oldest first.
   *
   * So a check can say the build FAULTED rather than merely produced a wrong
   * number.
   */
  readonly pageErrors: string[];
  /**
   * Every asset request that failed, as `<reason> <path>`, oldest first.
   *
   * The engine reports a refused path, a bad status and a failed decode alike
   * through `asset:failed`, so this is the same reading `none` takes from the
   * page's own responses.
   */
  readonly failedRequests: string[];
  /**
   * EVERY path the build's loader asked for, in order — not only the failures.
   *
   * What an item about where a build fetches from reads: that nothing left the
   * build's own tree, that the produced systems were asked for at all, and that
   * every path was written relative to the page.
   *
   * Read off the shared transport's log from the mark this harness took when it
   * was built, so it is this build's traffic and not the worker's.
   */
  readonly requests: readonly string[];

  /** The board the build holds, in the notation of specs/board.md. */
  board(): string[];
  /**
   * Run `seconds` of game time as `frames` equal frames.
   *
   * The only way to exercise "an interval of game time reaches the same state
   * however it was divided into frames" (specs/instrumentation.md), which is
   * what the `delta-time-independent` point is about.
   */
  advanceSeconds(seconds: number, frames?: number): Promise<void>;
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
   * Press a REAL pointer at a LOGICAL stage point — the same `cellCenter(col,
   * row)` a surface pose takes.
   *
   * The other path from `debug.pointerDown`, and both exist. A point about the
   * press RULES poses through the surface, which specs/instrumentation.md says
   * takes effect at the call and needs no frame. A point about what the press
   * SOUNDS must come through here, because specs/ui.md plays a cue from a FRAME
   * and never from a pose of the debug surface, so a build is entitled to raise
   * no cue for a posed press.
   *
   * It arms the event and returns; the frame that delivers it is the caller's
   * next `advance`.
   */
  press(x: number, y: number): void;
  /**
   * Move the real pointer to a logical stage point; while it is held down that
   * is a DRAG.
   *
   * Every intermediate `moveTo` before the next `advance` becomes its own
   * `PointerSample`, which is what specs/controls.md requires of this engine — a
   * drag that crossed several cells between two frames arrives as every position
   * it visited rather than as the last one alone.
   */
  moveTo(x: number, y: number): void;
  /** Lift the real pointer at its last position, ending the drag. */
  lift(): void;
  /**
   * Where a logical stage point sits in the CLIENT/CSS coordinates a pointer
   * event carries — the inverse of the mapping a runtime applies to an incoming
   * event.
   *
   * The one conversion {@link FacetModel.press} and {@link FacetModel.moveTo} go
   * through, and what keeps them correct at a `dpr` other than 1.
   */
  client(x: number, y: number): { x: number; y: number };

  /**
   * Clear the call log, run one frame, and hand back what that frame drew.
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
   * surface, read with {@link FacetModel.debugVersion}, and in the snapshot, read
   * as `snapshot().version`.
   */
  probe(names: readonly string[]): Promise<Record<string, string>>;
  /**
   * The `version` the surface itself carries, as a VALUE.
   *
   * `specs/instrumentation.md` puts the version in two places — on the surface
   * ("carries `version` … a plain number") and in the snapshot — so
   * `instrumentation/debug-api-version` reads both, and this is the surface half.
   * One spelling under all three engines: {@link FacetModel.probe} reports only
   * the `typeof` of a name, and the surface's own members are not otherwise
   * reachable as values under every engine.
   */
  debugVersion(): Promise<number>;

  /**
   * Where a WORLD point lands in the canvas's backing store, through the world's
   * camera first. STRUCTURED-2D ONLY.
   *
   * Kept apart from the kit's `device` rather than folded into it: this engine
   * alone has a camera, `device` maps a LOGICAL stage point because
   * specs/board.md fixes cell centers on the stage, and collapsing the two would
   * silently apply a camera to a stage figure. It is also why this project binds
   * NO `toLogical` on the kit — every pointer this harness raises and every pixel
   * it samples is stated on the stage, and running them through the camera would
   * move both.
   */
  deviceFromWorld(x: number, y: number): { x: number; y: number };
  /** The device-pixel box centered on a cell's center. */
  patch(col: number, row: number, half?: number): Patch;

  /**
   * Give the build whatever it needs before it may make a sound.
   *
   * A NO-OP under this engine, and the name still has to exist. Under `none` it
   * is a real, browser-trusted gesture, because specs/ui.md has audio start only
   * after the player has interacted with the page; here the bus is the engine's
   * and nothing gates it. Every audio item opens with "Arm audio", and the three
   * scripts must read the same.
   */
  armAudio(): Promise<void>;
  /**
   * Open the audio and drive frames until a sound has actually gone out; answer
   * whether anything was ever heard.
   *
   * specs/assets.md has a build DECODE its produced `.wav`s asynchronously, so a
   * conformant build's first frames are silent and a cue check that read the very
   * first event would be reading the decoder. This drives one frame at a time,
   * yielding between frames so the decode can land, and answers `false` after a
   * counted number of frames so a check can say the build made no sound at all.
   * The frames are counted, never timed.
   *
   * It DRIVES FRAMES. Call it while arranging, and read `frame()` after.
   */
  warmAudio(): Promise<boolean>;

  /**
   * Run `frames` frames back to back, at the harness clock's delta, recording
   * anything the build throws out of its own update before it travels on.
   *
   * The kit's own `advance` under a wrapper, so a fault the build raises is on
   * {@link FacetModel.pageErrors} as well as failing the check that drove the
   * frame. A sweep started by `until` runs the kit's frames directly and is not
   * wrapped: nothing it can throw is swallowed either way.
   */
  advance(frames: number): Promise<void>;
  /** Close the world, halt the loop, and give the console back. */
  dispose(): void;
}

/**
 * Everything a check reads off one engine running one build.
 *
 * The package's contract, less its `cues` — which is the package's `TimedCue`
 * and this case's is not, see {@link TimedCue} — plus everything above.
 */
export type Harness = Omit<
  EngineHarness<FacetSnapshot, FacetDriver, FacetEngine>,
  "cues"
> &
  FacetModel;

/* -------------------------------------------------------------------------- */
/* The kit                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The package's engine machinery, bound to Facet on this engine.
 *
 * Three of the config's members are where the four engines really differ, and
 * each is answered here from what THIS engine is:
 *
 *  - `driver` is the identity, because a structured engine's surface is already
 *    imperative and the object the build returned IS what a check calls.
 *  - `toLogical` is left at the identity, unlike this case's sibling projects'
 *    reading of the same word elsewhere in the tree: every figure Facet states —
 *    a cell center, a target rectangle, a patch — is stated on the STAGE, so the
 *    camera belongs to {@link FacetModel.deviceFromWorld} alone and nowhere on
 *    the pointer or pixel paths.
 *  - `pointerPrecision` is `"exact"`: a raised pointer lands where the caller
 *    asked, unrounded, which is what this project's checks have always been
 *    decided under.
 *
 * `cueEvents` is left at its default, `["cue:played"]` alone, and that is
 * load-bearing rather than incidental. A LOOP IS NOT A PLAY here:
 * `audio/cue-select` asserts that NO one-shot cue sounds on the quiet frames of a
 * menu move, and a music bed starting on one of those frames would answer for the
 * cue if the two lists were one. So the kit's `cues` are the one-shots, and the
 * beds are collected separately below.
 */
const kit = createEngineCaseHarness<
  FacetSnapshot,
  FacetDriver,
  FacetEngine,
  FacetModel
>({
  slug: "facet",
  projectRoot: PROJECT_ROOT,
  stage: { width: STAGE_W, height: STAGE_H },
  tickHz: TICK_HZ,
  surfaceRequirement: SURFACE_REQUIREMENT,
  // Every text call is measured and the transform in force at it recorded, which
  // is what the recorder this replaces always did, and what lets the package's
  // copy readings coalesce a heading drawn a glyph at a time back into the word
  // it spells; without a width every draw is a point and nothing merges.
  recorder: { measureText: true },
  defaultClock: () => new HarnessClock(new ConstantClock(TICK_MS)),

  // The one place a harness's own bookkeeping can be started BEFORE the engine
  // has run a line of game code. Everything opened here is closed by `dispose`.
  createEngine: ({ canvas, clock, surface }) => {
    // The console is taken over before the engine is built, so a fault raised
    // during the build's own loading is recorded too. The real console still
    // receives every line: suppressing a build's own diagnostics would take from
    // a reviewer the very sentence that explains a verdict.
    const pageErrors: string[] = [];
    const previousConsoleError = console.error.bind(console);
    console.error = (...args: unknown[]): void => {
      pageErrors.push(args.map((value) => String(value)).join(" "));
      previousConsoleError(...args);
    };

    const engine = createEngine<FacetSurface>({
      canvas,
      // The logical design size from specs/overview.md, exactly as src/main.ts
      // hands it.
      width: STAGE_W,
      height: STAGE_H,
      game,
      background: BACKGROUND,
      layout: LAYOUT,
      clock,
      surface: surface as SurfaceMetrics,
    });

    const loops: EngineCue[] = [];
    // Subscribed here, which is the same moment the kit subscribes `cue:played`
    // and `asset:failed`: construction runs no game code, so nothing has
    // happened yet and the game's own loading is observable.
    engine.events.on("cue:looped", ({ cue, t, gain }) => {
      const frame = engine.frame().count;
      loops.push({ cue, t, gain, frame, tick: frame, looped: true });
    });

    boxes.set(engine, {
      clock: clock as HarnessClock,
      pageErrors,
      loops,
      mark: assetHost.mark(),
      restore: () => {
        console.error = previousConsoleError;
      },
      fault: null,
    });
    return engine;
  },

  // A build whose `initialize` THROWS is a build with no surface, and that is a
  // verdict about the build rather than a broken harness — so it is recorded and
  // the harness is still built. Nothing below is reached through the missing
  // instance: every check reads the game through `debug`, which stands in.
  initialize: async (engine) => {
    const box = boxOf(engine);
    try {
      return await engine.initialize();
    } catch (error) {
      box.fault = `src/game.ts's instance threw from initialize: ${String(error)}`;
      box.pageErrors.push(String(error));
      return undefined;
    }
  },

  driver: (_engine, raw) => identityDriver(raw as FacetSurface),
  snapshot: (debug) => debug.snapshot(),
  pointerPrecision: "exact",

  extend: (base, engine, initialized) => {
    const box = boxOf(engine);

    // Read ONCE, after `initialize`, because that is the moment the build has
    // returned whatever it is going to return. It is recorded rather than
    // thrown: a fault belongs on the checks that reach through the surface,
    // never on every suite's `beforeEach`.
    const raw: unknown = engine.debug;
    if (box.fault === null) {
      if (typeof raw !== "object" || raw === null) {
        box.fault =
          `engine.debug holds ` +
          `${raw === null ? "null" : typeof raw}, not an object`;
      } else if (missingOps(raw, ["reset"]).length > 0) {
        box.fault = "the surface on engine.debug carries no reset operation";
      }
    }

    // THE KIT'S OWN TWO, TAKEN BEFORE THIS OBJECT IS DEFINED OVER THEM. What
    // `extend` answers is installed ONTO `base`, so `base.advance` and
    // `base.dispose` are these very members by the time a check calls one, and
    // reaching for them through `base` afterwards would be a call into itself.
    // Everything else below goes through `base` on purpose, so it reaches the
    // wrapper rather than the member the wrapper replaced.
    const drive = base.advance.bind(base);
    const halt = base.dispose.bind(base);
    /** Every one-shot the kit stamped, before `cues` below is defined over it. */
    const firings = base.cues;
    // What `base` BECOMES the moment the object below is defined onto it. The
    // members that reach forward to one of this case's own — the wrapped
    // `advance`, `frameCalls`, the patch reading — go through this name, which
    // is the same object under the type it ends up with.
    const whole = base as unknown as Harness;

    /** Where the last real pointer event was, so a release needs no position. */
    let lastPointer = { x: 0, y: 0 };
    const point = (
      type: "pointerdown" | "pointermove" | "pointerup",
      x: number,
      y: number,
    ): void => {
      lastPointer = { x, y };
      base.pointer(type, x, y);
    };

    const model: FacetModel = {
      get world() {
        return engine.world;
      },
      get state() {
        return engine.world.state as FacetState;
      },
      instance: initialized as GameInstance<FacetSurface>,
      get cues() {
        return firings.map(asTimedCue);
      },
      get loops() {
        return box.loops.map(asTimedCue);
      },
      surfaceFault: box.fault,
      pageErrors: box.pageErrors,
      get failedRequests() {
        return base.assetFailures.map(
          (failure) => `${failure.reason} ${failure.path}`,
        );
      },
      get requests() {
        return assetHost.requestsSince(box.mark).map((request) => request.url);
      },

      board: () => renderBoard(base.debug.snapshot()),

      async advance(frames) {
        try {
          await drive(frames);
        } catch (error) {
          box.pageErrors.push(String(error));
          throw error;
        }
      },

      async advanceSeconds(span, frames = 1) {
        // A fixture error fails as one, the way `loadBoard` already refuses a
        // malformed row: a count below one, or a fractional count, is a mistake
        // in the check, and repairing it silently would run a drive nobody asked
        // for.
        if (!Number.isInteger(frames) || frames < 1) {
          fail(
            "advanceSeconds to be given a whole number of frames, at least 1",
            frames,
          );
        }
        box.clock.queue((span * 1000) / frames, frames);
        await whole.advance(frames);
      },

      async tapAction(action) {
        await base.tap(BINDINGS[action][0]);
      },

      client: (x, y) => toClient(base.viewport(), base.shape.dpr, x, y),
      press: (x, y) => point("pointerdown", x, y),
      moveTo: (x, y) => point("pointermove", x, y),
      lift: () => point("pointerup", lastPointer.x, lastPointer.y),

      async frameCalls() {
        base.calls.length = 0;
        await whole.advance(1);
        return [...base.calls];
      },
      probe(names) {
        const reflected: Record<string, string> = {};
        const surface =
          typeof raw === "object" && raw !== null
            ? (raw as Record<string, unknown>)
            : undefined;
        for (const name of names) {
          reflected[name] = typeof surface?.[name];
        }
        return Promise.resolve(reflected);
      },
      // Through the driver, so a build with no usable surface fails here on the
      // surface fault rather than answering `undefined`.
      debugVersion: () => Promise.resolve(base.debug.version),

      deviceFromWorld: (x, y) => {
        const at = engine.world.camera.worldToLogical({ x, y });
        return deviceOf(base.viewport(), at.x, at.y);
      },
      patch: (col, row, half) => readPatch(whole, col, row, half),

      armAudio: () => Promise.resolve(),
      async warmAudio() {
        const heard = (): boolean => firings.length + box.loops.length > 0;
        for (let frame = 0; frame < AUDIO_WARM_FRAMES && !heard(); frame += 1) {
          // A frame, so the build asks for the screen's bed and for anything else
          // it plays from `update`. The drive is awaited, so a decode the frame
          // kicked off lands before the next one is driven.
          await whole.advance(1);
        }
        return heard();
      },

      dispose: () => {
        halt();
        box.restore();
      },
    };
    return model;
  },
});

/**
 * Build an engine over a canvas of the harness's own, initialize the build's
 * game, and hand back everything a check reads.
 *
 * The options the kit passes the factory are the ones the seeded `src/main.ts`
 * passes — the design size, the build's exported `BACKGROUND`, and the touch
 * layout — so one harness serves every build of this case. Everything else the
 * build decided lives inside `src/game.ts`.
 *
 * The opening `reset` is posed HERE rather than by the kit, because it is this
 * case's opening move and its seed is this case's option: every check opens on
 * the same, seeded, title-screen state (specs/instrumentation.md). It is GUARDED,
 * so a build that returned no surface, or one whose `reset` is missing, fails the
 * checks that reach through the surface rather than every suite's `beforeEach`.
 */
export async function createHarness(
  options: HarnessOptions = {},
): Promise<Harness> {
  const h = await kit.createHarness({
    clock: new HarnessClock(options.clock ?? new ConstantClock(TICK_MS)),
    cssWidth: options.cssWidth ?? STAGE_W,
    cssHeight: options.cssHeight ?? STAGE_H,
    dpr: options.dpr ?? 1,
  });

  if (h.surfaceFault === null) {
    try {
      h.debug.reset();
    } catch {
      // A `reset` that throws is the build's fault and belongs to the point about
      // `reset`, not to every other suite's setup.
    }
  }
  return h;
}

/* -------------------------------------------------------------------------- */
/* Sampling                                                                   */
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
/* -------------------------------------------------------------------------- */
/* Cues                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Record every ONE-SHOT cue the build plays from now on, stamped with its frame.
 *
 * The case's own rather than the kit's `watchCues`, for the one reason the type
 * above gives: the kit stamps the package's cue and a script here reads this
 * case's, which the `none` project reads too. The subscription is the same one
 * the kit makes — `cue:played` alone, which is exactly what this project has
 * always meant by a cue.
 *
 * The engine publishes that event synchronously from inside `audio.play`, so the
 * handler runs while the frame that played it is still running and
 * `engine.frame().count` is that frame's own number. That is what lets a check
 * assert not merely that a cue sounded but that it sounded on the frame of the
 * event — which tells a build that plays a cue on the right event apart from one
 * that plays it every frame, or a frame late.
 */
export function watchCues(h: Harness): TimedCue[] {
  const played: TimedCue[] = [];
  h.engine.events.on("cue:played", ({ cue, t, gain }) => {
    played.push({ cue, t, gain, frame: h.engine.frame().count, loop: false });
  });
  return played;
}

/**
 * Record every LOOPING cue, which under specs/ui.md is what the two music beds
 * are.
 *
 * Kept apart from {@link watchCues} for one reason: a screen change starts a bed,
 * and a bed starting must never be able to answer a point about a one-shot cue.
 * The package leaves this split to the case deliberately —
 * `EngineCaseConfig.cueEvents` is the case's to name, and naming `"cue:looped"`
 * there would fold the two lists into one.
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
 * Just the names, in order.
 *
 * `null` under `none`, where the names are inside the build's own code and
 * nothing on the page reports them; a real name here. The return type carries the
 * null so one cue script reads the same text under all three engines. A check
 * asserts CONTAINMENT of a frame's cues and never exclusivity: specs/ui.md has
 * `clear` sound the chain ladder and calls the rungs "that one cue's sources
 * rather than events of their own", so a build is entitled to name a rung on the
 * bus beside the cue itself.
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
// Each of these poses a situation through the debug surface and then lets the
// real simulation run. They fix only the arrangement: which board, which cells.
// Every threshold a check asserts is stated in the check itself, derived from the
// figure or rule specs/ states for it.
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
 * Pose the run-free filler with the scenario's own cells written over it: the
 * one-line way to arrange an isolated world.
 *
 * THE FILLER CARRIES NO LEGAL SWAP OF ITS OWN, which is what makes a scenario
 * isolated — the only productive swap on the posed board is the one the check
 * put there. It has a consequence a check author must know: specs/rules.md ends
 * the round when a chain settles on a board with no legal swap, so a scenario
 * posed this way will usually find `screen` at `gameover` once its chain
 * SETTLES. That is the specification behaving correctly, not a fault.
 *
 * So: read `phase`, `lastCleared`, `lastPoints`, `score` and the board — never
 * `screen` — after a chain posed this way; or use {@link poseBoardWithEscape},
 * which plants one spare legal swap in the far corner and keeps the round alive.
 */
export function poseBoard(
  h: Harness,
  cells: readonly PlacedToken[],
): FacetSnapshot {
  return loadBoard(h, quietRowsWith(cells));
}

/**
 * {@link poseBoard} with one spare legal swap planted in the bottom-left corner,
 * so the round is not already over at the moment the scenario is posed.
 *
 * For every check that must still be `playing` afterwards: the level items, the
 * HUD items, and anything that goes on to make a second swap.
 *
 * WHAT IT GUARANTEES IS ABOUT THE POSED BOARD. The escape does not survive an
 * arbitrary chain: a clear reaching the bottom-left corner takes the escape's own
 * cells with it, and R9's refill drops what is left out of position. A check that
 * must still be `playing` once its chain has SETTLED keeps its scenario clear of
 * rows 6-7 and columns 0-2, and asserts `snapshot().legalSwap` before it reads
 * `screen`.
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
/* Evidence capture                                                           */
/* -------------------------------------------------------------------------- */
//
// A review item may declare a `replay` or an `image` OUTPUT beside its verdict:
// what the build itself drew while a check drove it, kept as evidence a reviewer
// can scrub and compare against the reference implementation's.
//
// ALL OF IT IS THE PACKAGE'S NOW — the destination, the thinning, the re-tabling
// of a thinned recording's four shared tables, the gzip, and both writers — bound
// here to this case's slug and to THIS directory. The project root may never be
// derived inside the package, which is staged one level deeper than this file, or
// every output would be addressed one directory too far down and silently,
// because the writers are required not to raise.
//
// Four properties make them usable, and each is deliberate:
//
//  1. THEY RECORD THE SECTION, NOT THE RUN. The recorder is armed around the
//     caller's scenario and disarmed the moment it returns, so what is kept is
//     the part the check is ABOUT and never the setup that got there.
//  2. THEY ARE EVIDENCE, NEVER A VERDICT. The scenario's own value comes straight
//     back, and a scenario that THROWS still writes what it had — a failing check
//     is the one whose replay a reviewer most wants. Nothing here can turn a
//     passing check into a failing one.
//  3. THEY WRITE ONLY WHAT THERE IS TO LOOK AT. A capture that closed no frames
//     leaves no file, so the run reports the output absent rather than offering
//     the reviewer a replay of nothing.
//  4. THEY COST NOTHING WHEN NOBODY IS COLLECTING. Outside a run the media
//     directory is unset and the whole thing is a no-op that still runs the
//     scenario, so a check cannot pass in one place and fail in the other.

/** The environment variable the runner names the media directory in, and the
 * directory the runner stages this project to inside the build's tree. */
export { MEDIA_DIR_ENV, STAGED_PROJECT_DIR } from "./case-harness/media";

/**
 * Where the running suite's `outputId` output belongs, or `null` when nothing is
 * collecting media.
 *
 * The suite is the one vitest is currently running rather than one the caller
 * names, because the two must not be able to disagree: a check that named its own
 * path would be free to write its evidence under some other point's address.
 *
 * Bound to {@link PROJECT_ROOT}, which is the whole of what this case has to say
 * about it. The package's own reading THROWS rather than answering a
 * plausible-looking path when the running suite does not sit under that root —
 * which is the one failure the writers below cannot report, since they are
 * required not to raise.
 */
export function mediaDestination(
  outputId: string,
  extension: OutputExtension,
): string | null {
  return outputDestination(PROJECT_ROOT, outputId, extension);
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
 * The assertions stay exactly where they were and read exactly what they did.
 */
export const captureReplay = makeReplayCapture("facet", PROJECT_ROOT);

/**
 * Keep the frame currently on the canvas as the review item's `outputId` output.
 *
 * For a point whose evidence is one PICTURE rather than a stretch of motion.
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

/* -------------------------------------------------------------------------- */
/* The build's own tree                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The built site, or the committed `public/` tree when nothing has been built:
 * where a check about a PRODUCED FILE looks for it.
 *
 * specs/assets.md commits every produced file under `public/assets/` and says the
 * build copies that directory into `dist/` unchanged, so both layouts name the
 * same asset by the same path below the root.
 */
export function siteRoot(): string | null {
  for (const candidate of ["dist", "build", "out", "public"]) {
    const path = join(WORKSPACE_ROOT, candidate);
    if (existsSync(path)) return path;
  }
  return null;
}
