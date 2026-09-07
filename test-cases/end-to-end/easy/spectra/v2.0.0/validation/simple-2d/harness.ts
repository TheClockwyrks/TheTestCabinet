// Spectra — the case's half of the validator harness, under the Simple 2D
// engine. CASE-PROVIDED.
//
// Every validator in this project is an ordinary vitest test that runs IN THE SAME
// PROCESS as the build. It imports the engine and the build's own modules, creates
// an engine over a canvas it owns and a clock it chose, and steps the game with
// `engine.advance`. Nothing drives a browser, nothing polls, and no wall-clock time
// passes: a validator asks for a number of frames and gets exactly that number, at
// exactly the deltas its clock supplied.
//
// THE MACHINERY THAT DOES THAT IS NOT SPECTRA'S. The draw-command recorder, the
// debug surface read off the engine and the stand-in for a missing one, the driver
// that threads a PURE surface through `engine.apply`, the frame sweep, the cue
// stamping, the host that serves the seeded art to a build with no page under it,
// and the evidence a review item declares — every engine-backed case needs exactly
// that, and it lives once, in `@clockwyrks/case-harness`, staged beside this file
// as `./case-harness/`. What is left here is what is genuinely Spectra's: its
// snapshot and surface types, the rate its suites step at, the sentence a missing
// surface is failed against, every scenario helper that poses this game, the
// seeded sprite art a drawn bitmap is identified against, and the readings its
// presentation items take over the canvas.
//
// WHAT A VALIDATOR READS. The game's own state (through the debug surface's
// `snapshot`), the engine's frame counter, the cues the engine broadcast, and —
// for the presentation items — the pixels on the canvas or the calls the 2D context
// received. Nothing here fabricates an outcome: the scenario helpers below only
// ARRANGE the field through the debug surface, and the real `update` the build
// wrote is what runs from there.
//
// WHY THE DEBUG SURFACE RATHER THAN RAW ASSIGNMENT. specs/instrumentation.md fixes
// its operations, so they mean the same thing in every build: `addDrone` appends a
// cyan drone in formation with all three of its faculties on, `setDroneBand` moves
// the stored band and leaves the band clock exactly where it stands, a world gate
// stays off until something turns it back on, and `reset` gives everything back.
// Posing through it is how a scenario is arranged the same way in every build,
// and it is the seam the case's specification documents. `surface.ts` is that specification as types, and
// it is the only description of the surface this harness reads: the build's own
// module for the surface is never imported.
//
// WHERE THE SURFACE COMES FROM. Off `engine.debug`, never built here. The build's
// `initialize` returns it beside the state, as `[state, debug]`, and the engine
// holds the second element and returns it from `engine.debug`. Reading it back off
// the engine is the only way a surface reaches a validator, so a build that
// returned no surface, or a surface missing an operation, fails the items that
// reach the game through it. The package's `readDebugSurface` does that read and
// stands an `absentSurface` in when there is nothing to read, so the fault lands on
// the items whose validators reach the game through the surface rather than on the
// `beforeEach` that built the harness — which is why every suite's `afterEach`
// disposes its harness with `?.`.
//
// HOW THE SURFACE IS DRIVEN — the APPLY-THREADED strategy, which is what a simple
// engine's state model forces. The engine holds the state by value and hands it out
// read-only, so the surface is pure: a pose takes the current state and returns the
// next, a reading takes the current state and returns what it read (`surface.ts`).
// A validator still writes `h.debug.setShipBand("magenta")` and
// `h.debug.snapshot()`, because `h.debug` is the package's `applyDriver` over the
// raw surface: it runs each pose through `engine.apply` and hands each reading
// `engine.state` FOLLOWED BY the reading's own arguments — which is what keeps
// `menuItemRect(index)` asking about the item the caller named. `surface.ts`'s
// `READINGS` is what tells a pose from a reading, because nothing about a pure
// surface distinguishes them at run time. Nothing a validator does holds a writable
// state — `h.state` is the engine's current value, read fresh on every access, and
// the only way to change it is a pose.
//
// THE HARNESS SUPPLIES THE CLOCK, NOT THE GAME. `ConstantClock(TICK_MS)` is the
// default, so one frame is one 120 Hz tick and every duration below is a whole
// number of them. That is why `[instrumentation]` carries no `tick_hz`: Spectra
// mandates no fixed timestep, every rate is per second and integrated against the
// delta the frame hands the game, and the SUITE is what fixes a step so a tolerance
// can be stated in ticks and mean the same thing on every machine. 120 Hz is also
// exactly `1 / SUBSTEP_MAX`, so one frame of the default clock is one whole
// sub-step and nothing is ever measured across a partial one. An item that is
// specifically about the step size — `instrumentation.elapsed-time-steps` — builds
// its own harnesses with clocks of its own.
//
// THE SEEDED ART IS SERVED HEADLESS. specs/assets.md has the build load its four
// sprites and its drone-burst through the engine's asset loader, which resolves
// each path under `assets/` relative to the page and fetches it. This project runs
// in a Node process with no page, so the package's `installAssetHost` stands
// `fetch` and `createImageBitmap` up over the workspace's own tree for the life of
// each harness and puts them back on `dispose`. That is the same kind of thing the
// canvas, the surface metrics and the clock are — the host the engine runs on — and
// without it every scenario would draw a field the build was never given the art
// for. The install is REFERENCE COUNTED by the package, which is what an item that
// compares two seeds and holds two harnesses at once needs.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createCanvas,
  loadImage,
  type Canvas,
  type SKRSContext2D,
} from "@napi-rs/canvas";
import {
  ConstantClock,
  createEngine,
  type Engine,
  type Game,
  type SurfaceMetrics,
} from "@clockwyrks/simple-2d";
import type { DeepReadonly } from "ts-essentials";
import { colorDistance, type Rgb } from "./case-harness/color";
import {
  callsTo,
  setsOf,
  type DrawCall as RecordedCall,
  type TextGeometry,
} from "./case-harness/draw-calls";
import { apply as applyMatrix, type Matrix } from "./case-harness/matrix";
import type { Pixel, PixelRect } from "./case-harness/pixels";
import {
  distance,
  rectCenter,
  type Point,
  type Rect,
} from "./case-harness/point";
import { retable } from "./case-harness/replay/retable";
import { drawnText, drawnTextRuns, type TextDraw } from "./case-harness/text";
import {
  DevicePointerEvent,
  applyDriver,
  createEngineCaseHarness,
  installAssetHost,
  rasterize as rasterizeColor,
  recordingContext,
  type AssetFailure,
  type AssetHost,
  type EngineHarness,
  type EngineHarnessOptions,
  type PlayedCue,
  type PointerEventType,
  type PureDriver,
  type SurfaceShape,
  type TimedCue,
  type UntilOptions,
  type UntilResult as SweptResult,
} from "./case-harness/engine/index";
import {
  allInLogical,
  makeReplayCapture,
  pixelAt as devicePixelAt,
  sampleColor as clusterColor,
} from "./case-harness/engine/2d";
import {
  BURST_SYSTEM,
  LAYOUT,
  PLAYER_BULLET_SPEED,
  SHIP_X_MAX,
  SHIP_X_MIN,
  SPRITES,
  STAGE_H,
  STAGE_W,
  START_LIVES,
  slotX,
  slotY,
} from "./constants";
import { BACKGROUND, game as build, type SpectraState } from "../src/game";
import { assertTruthy, fail } from "./assert";
import { clearBeforeCoveringFills } from "./covered-frames";
import {
  READINGS,
  type Band,
  type BulletSnapshot,
  type BurstSnapshot,
  type DischargeSnapshot,
  type DroneKind,
  type DronePhase,
  type DroneSnapshot,
  type MenuRect,
  type Mode,
  type Phase,
  type Screen,
  type ShipSnapshot,
  type SpectraDebugApi,
  type SpectraSnapshot,
} from "./surface";

export type {
  Band,
  BulletSnapshot,
  BurstSnapshot,
  DischargeSnapshot,
  DroneKind,
  DronePhase,
  DroneSnapshot,
  MenuRect,
  Mode,
  Phase,
  Screen,
  ShipSnapshot,
  SpectraSnapshot,
};

/* The readings this project takes straight off the package, under its names. */
export {
  callsTo,
  colorDistance,
  distance,
  drawnText,
  rectCenter,
  retable,
  setsOf,
};
export type { AssetFailure, Matrix, PlayedCue, TextGeometry, TimedCue };

/** The case's surface, bound to the state type the build declared. */
export type SpectraSurface = SpectraDebugApi<SpectraState>;

/**
 * The build's game, typed against the surface the CASE specifies.
 *
 * The build declares its own type for the surface its `initialize` returns, and
 * that type is the build's: what a validator holds it to is `surface.ts`, so the
 * game is cast to the case's `Game<SpectraState, SpectraSurface>` here and the
 * engine is parameterized with it. A surface that departs from the specification is
 * caught where a validator reaches for the missing member, not by the build's own
 * compiler.
 */
const game = build as unknown as Game<SpectraState, SpectraSurface>;

/**
 * The imperative reading of a pure surface: every member of `D`, minus its state
 * argument, over the engine that holds the state.
 *
 * The package's `PureDriver` under this project's own name, because `surface.ts`
 * refers to the surface's driven form as `Driver` and the two must not drift. A
 * pose `(state, ...args) => S` becomes `(...args) => void`: the driver runs it
 * through `engine.apply`, so the state it returns is the state the next frame
 * receives. A reading `(state, ...args) => R` becomes `(...args) => R`: the driver
 * hands it `engine.state` and forwards everything else the caller passed. Anything
 * else (`version`) is carried as it is.
 */
export type Driver<S, D> = PureDriver<DeepReadonly<S>, S, D>;

/** The surface as every validator drives it. */
export type SpectraDriver = Driver<SpectraState, SpectraSurface>;

/** The engine this project stands a build up on. */
export type SpectraEngine = Engine<SpectraState, SpectraSurface>;

/* -------------------------------------------------------------------------- */
/* The clock                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The frame the suite steps in, in milliseconds.
 *
 * This is the SUITE's choice, not the game's: the specification deliberately fixes
 * no timestep, because the engine hands the game whatever elapsed time a frame
 * really took. Fixing it here makes a duration a whole number of frames, so a
 * tolerance can be stated in ticks and mean the same thing on every machine.
 *
 * 120 Hz is `1 / SUBSTEP_MAX`, so one frame of this clock is exactly one sub-step
 * of the simulation `specs/simulation.md` fixes, and nothing this suite measures is
 * ever read across a partial one. It also divides the figures this case is timed
 * against finely enough to read a threshold rather than a rounding: the flip
 * lockout (`0.3` s) is 36 ticks, the entry group gap (`0.6` s) is 72, the discharge
 * (`0.5` s) is 60, the shimmer (`0.4` s) is 48, and a stage-1 Flux window
 * (`2.0` s) is 240.
 *
 * The three readings below are the package's `makeTickMath` figures under this
 * case's own names, restated here rather than bound off the kit because they are
 * the vocabulary every suite writes its tolerances in and because `defaultClock`
 * needs `TICK_MS` before the kit exists.
 */
export const TICK_HZ = 120;
export const TICK_MS = 1000 / TICK_HZ;

/** Seconds of simulated time in `ticks` frames of the default clock. */
export function seconds(ticks: number): number {
  return ticks / TICK_HZ;
}

/**
 * Whole frames of the default clock covering at least `duration` seconds.
 *
 * Rounded UP, so a hold stated in seconds always covers the whole of it; a
 * validator that needs the exact elapsed time asserts against
 * `seconds(ticksFor(d))` rather than against `d`.
 */
export function ticksFor(duration: number): number {
  return Math.ceil(duration * TICK_HZ);
}

/** A rate in units per second from a displacement measured over `ticks` frames. */
export function speedOverTicks(delta: number, ticks: number): number {
  return (Math.abs(delta) * TICK_HZ) / ticks;
}

/* -------------------------------------------------------------------------- */
/* What a frame drew                                                          */
/* -------------------------------------------------------------------------- */
//
// The recorder itself is the package's `recordingContext`, and so are `DrawCall`,
// `TextGeometry`, `Matrix`, `callsTo` and `setsOf`. TWO FACTS ABOUT THIS CASE'S
// FRAMES ARE NOT THE PACKAGE'S, and both live in the list the recorder is handed
// rather than in a recorder of our own — see {@link recordedCalls}.

/**
 * One recorded operation on the 2D context, in the order the render made it.
 *
 * The package's `DrawCall`, plus the transform the context held at the call.
 *
 * THE EXTRA FIELD IS WHY THIS IS NOT SIMPLY THE PACKAGE'S TYPE. `RecorderOptions`
 * records the transform at a `fillText`/`strokeText` (as `text.transform`, under
 * `measureText`) and at nothing else, because the package's own image reading
 * RECONSTRUCTS the transform by walking the operation list. This case does not
 * read it that way: a build draws a sprite by translating to the entity's centre
 * and drawing the frame about the origin, and {@link drawnImages} maps the
 * destination box back to logical units through the transform the context ACTUALLY
 * held — which is exact under a `setTransform` the engine's own fit issues and
 * under a `reset` an operation walk cannot see through. So a `drawImage` carries
 * the transform beside it here.
 */
export type DrawCall = RecordedCall & { transform?: Matrix };

/**
 * The most calls {@link Harness.calls} holds before the oldest are dropped.
 *
 * The list is what a presentation item reads, and a presentation item reads ONE
 * frame: the idiom is `h.calls.length = 0`, one `advance(1)`, then the reading —
 * which is what {@link drawFrame} does. But the list is recorded whether an item
 * reads it or not, and this case's longest sweeps run thousands of frames of a
 * field drawing a starfield, a HUD, a formation and its bursts, so an uncapped list
 * would be hundreds of megabytes in a validator that never looks at it. Past the
 * cap the oldest half is dropped, which is far beyond any single frame and so
 * cannot cost a reading anything.
 *
 * The package's recorder appends without a cap, which is the right default for a
 * case whose frames are a few dozen operations; this one's are a few hundred.
 */
const MAX_RECORDED_CALLS = 200_000;

/** The methods whose transform is captured beside the call. */
const TRANSFORMED = new Set(["drawImage"]);

/**
 * The list the recorder appends to: capped, and stamping the transform in force at
 * a `drawImage`.
 *
 * A LIST WITH ITS OWN `push` RATHER THAN A RECORDER OF OUR OWN. The package's
 * `recordingContext` builds each call and appends it to the array it was handed
 * BEFORE forwarding to the real context, so at the moment of the append the
 * transform in force is still the one the call was made under. Both of the facts
 * above therefore belong to the LIST, and putting them there is what lets this case
 * bind the package's recorder — and with it the package's `DrawCall`, its text
 * readings and its `callsTo`/`setsOf` — rather than keeping a near-copy of it.
 *
 * Everything else about the list is an ordinary array: `h.calls.length = 0` empties
 * it, and a reading spreads or filters it exactly as before.
 */
function recordedCalls(ctx: SKRSContext2D): DrawCall[] {
  const calls: DrawCall[] = [];
  const append = (call: DrawCall): void => {
    if (call.kind === "call" && TRANSFORMED.has(call.method)) {
      const m = ctx.getTransform();
      call.transform = [m.a, m.b, m.c, m.d, m.e, m.f];
    }
    if (calls.length >= MAX_RECORDED_CALLS) {
      calls.splice(0, Math.floor(MAX_RECORDED_CALLS / 2));
    }
    Array.prototype.push.call(calls, call);
  };
  Object.defineProperty(calls, "push", {
    value: (...added: DrawCall[]): number => {
      for (const call of added) append(call);
      return calls.length;
    },
    writable: true,
    enumerable: false,
    configurable: true,
  });
  return calls;
}

/** The canvas one harness draws into, and everything the recorder over it kept. */
interface CaseCanvas {
  canvas: Canvas;
  ctx: SKRSContext2D;
  calls: DrawCall[];
  element: HTMLCanvasElement;
}

/**
 * A canvas of the harness's own, with the recorder installed, dressed as the
 * element the engine takes.
 *
 * THE PACKAGE'S `createRecordingCanvas` CANNOT BE USED HERE, and the reason is
 * `covered-frames.ts`: the clear it issues ahead of a covering fill has to reach
 * the REAL context, under the recorder, or it would appear in the draw-call list
 * and in every captured replay and a check would read a clear the build never made.
 * `createRecordingCanvas` builds the context and wraps it in one call, so there is
 * no seam between the two to stand in — so the three lines of it are written out
 * here, over the package's own `recordingContext`. Everything the recorder itself
 * does is the package's.
 */
function caseCanvas(shape: SurfaceShape): CaseCanvas {
  const canvas = createCanvas(
    Math.round(shape.cssWidth * shape.dpr),
    Math.round(shape.cssHeight * shape.dpr),
  );
  const ctx = canvas.getContext("2d");
  const calls = recordedCalls(ctx);
  // Under the recorder, so the clear it issues is in no draw-call list and in no
  // captured replay: what a check reads is what the build itself drew.
  const recorded = recordingContext(clearBeforeCoveringFills(ctx), calls, {
    // The text readings below place a run about its anchor, so each text call is
    // measured and the transform in force at it recorded.
    measureText: true,
  });
  const element = Object.assign(canvas, {
    style: {} as CSSStyleDeclaration,
    getContext: (): SKRSContext2D => recorded,
  }) as unknown as HTMLCanvasElement;
  return { canvas, ctx, calls, element };
}

/**
 * The canvas each engine is drawing into, by the engine that holds it.
 *
 * Threaded rather than closed over because two harnesses may be alive at once — an
 * item that compares two seeds builds a second — and keying on the engine is the
 * only identity that cannot be interleaved by an `await` between the two.
 */
const surfaces = new WeakMap<object, CaseCanvas>();

/* -------------------------------------------------------------------------- */
/* The harness                                                                */
/* -------------------------------------------------------------------------- */

/** The window a harness reports to the engine, and the clock it steps on. */
export type HarnessOptions = EngineHarnessOptions;

/** How far a sweep may run, and how many frames separate two samples. */
export type { UntilOptions };

/**
 * What a sweep found: whether the predicate ever held, and where it stopped.
 *
 * `frames` and `ticks` are ONE counter under two names, both filled by the
 * package; this suite counts in `frames`.
 */
export type UntilResult = SweptResult<SpectraSnapshot>;

/**
 * What Spectra adds to the package's engine harness, and what it takes back.
 *
 * Four members differ from the kit's, and each is a deliberate keep rather than an
 * omission:
 *
 *  - {@link SpectraModel.pointer} is ASYNC and runs the one driven frame that
 *    delivers the event. The kit's raises the event and runs nothing, which is the
 *    right reading for a case whose checks batch a gesture; every pointer and touch
 *    check here counts frames across a press, a travel and a release.
 *  - {@link SpectraModel.advanceSeconds} takes SECONDS of the default clock. The
 *    engineless half's member of that name takes a span the BUILD divides, which is
 *    a different call entirely.
 *  - {@link SpectraModel.state} and {@link SpectraModel.css} are this engine's
 *    state model and this case's gesture arithmetic.
 *
 * The canvas trio and `pixel` are here for a different reason: they read the canvas
 * THIS case builds — see {@link caseCanvas} — rather than the one the kit builds.
 */
interface SpectraModel {
  /**
   * The engine's current state, read fresh on every access. Read it, or pose it
   * through `debug`; nothing here can write to it.
   */
  readonly state: DeepReadonly<SpectraState>;
  /** The real 2D context, for `getImageData`. Draw calls also reach it. */
  readonly ctx: SKRSContext2D;
  /**
   * The surface the engine drew into, holding the last frame that ran.
   *
   * Exposed for {@link captureStill}, which encodes it: a still output is the
   * picture the build actually put on the canvas, and the only place that picture
   * exists is here.
   */
  readonly canvas: Canvas;
  /**
   * Every call and property set the render made, oldest first.
   *
   * It accumulates across frames, so a validator that reads what ONE frame drew
   * empties it first — `h.calls.length = 0`, one `advance(1)`, then the reading,
   * which is {@link drawFrame}. It is capped at {@link MAX_RECORDED_CALLS}; the cap
   * is orders of magnitude past one frame and cannot cost such a reading anything.
   */
  readonly calls: DrawCall[];

  /**
   * Run whole frames covering at least `duration` seconds of game time.
   *
   * `ticksFor(duration)` frames of the DEFAULT clock. A harness built with a clock
   * of its own advances the frames that clock hands out, so an item that supplied
   * one — `instrumentation.elapsed-time-steps` is the only one that does — counts
   * its own frames with {@link Harness.advance} instead.
   */
  advanceSeconds(duration: number): Promise<void>;
  /** Where a logical point lands in CSS pixels, which is where a gesture goes. */
  css(x: number, y: number): Point;
  /**
   * Dispatch one real pointer event at the target the engine listens on, and run
   * the frame that delivers it.
   *
   * The menus take a mouse and a finger as well as the keyboard
   * (`specs/ui.md`), and each part of a gesture runs exactly ONE driven frame,
   * so a caller counting frames can add them up and a build that reads its input
   * once per frame sees every edge.
   */
  pointer(
    type: PointerEventType,
    x: number,
    y: number,
    device?: "mouse" | "touch",
  ): Promise<void>;
  /** The device pixel under a logical point, as `[r, g, b, a]`. */
  pixel(x: number, y: number): Pixel;
}

/**
 * Everything a validator reads off one engine running one build.
 *
 * The package's engine harness with {@link SpectraModel} over the top of it: the
 * members the model names come from the model, and everything else — the driver,
 * the sweep, the keyboard, the cue record, the frame counters and the fit — is the
 * package's, under the package's own contract.
 */
export type Harness = Omit<
  EngineHarness<SpectraSnapshot, SpectraDriver, SpectraEngine>,
  keyof SpectraModel
> &
  SpectraModel;

/**
 * What the build owes when its surface is missing: the `Expected:` line of the
 * failure every validator that reaches for the surface lands on, beside what
 * `engine.debug` was found holding instead.
 *
 * The case's own sentence rather than the package's, because where the surface
 * comes from is this engine's business — beside the state, as a pair — and a fault
 * that misdescribed the return would send a reviewer to the wrong line of the
 * build.
 */
const SURFACE_REQUIREMENT =
  "the debug surface src/game.ts's initialize returns beside its state, as " +
  "[state, debug], which the engine hands back from engine.debug " +
  "(specs/instrumentation.md)";

/**
 * The operation named, or a failure naming what the specification requires.
 *
 * For the handful of places a member has to be THERE before it is called: the two
 * members only the overload variant carries (`setDroneCharge`), and
 * {@link poseDrone} when a caller poses a charge. Reaching for a missing operation
 * through the driver hands back `undefined`, and calling that would fail with a
 * type error naming nothing; this fails with the operation named instead.
 *
 * The package's `missingOps` answers WHICH operations a surface lacks and lands no
 * verdict anywhere; this lands one, on the check that reached, with the operation
 * named — which is a different question and stays here.
 */
export function requireOp<K extends keyof SpectraDriver>(
  h: Harness,
  name: K,
): NonNullable<SpectraDriver[K]> {
  const member = h.debug[name];
  if (typeof member !== "function") {
    fail(
      `${String(name)} to be a function on the debug surface ` +
        "(specs/instrumentation.md)",
      typeof member,
    );
  }
  return member as NonNullable<SpectraDriver[K]>;
}

/* -------------------------------------------------------------------------- */
/* Serving the seeded art to a headless engine                                */
/* -------------------------------------------------------------------------- */

/**
 * The directory this harness sits in, which is the validator project's root.
 *
 * Taken from this module's own URL rather than from the working directory, because
 * it has to name the same directory in both layouts this file lives in: the case's
 * own `validation/<engine>/`, and the `validation/` the runner stages that
 * directory to inside the build's tree.
 *
 * IT MAY NEVER BE DERIVED INSIDE THE PACKAGE, which is staged one directory deeper
 * than this file: every replay and still would be addressed one directory too far
 * down, silently, because both writers are required not to raise.
 */
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * The workspace this project is staged into, which is where `assets/` sits.
 *
 * The tree the build was handed, so the seeded art a validator reads is exactly the
 * art the case seeded and the engine's loader resolves `assets/shard.png` to the
 * file the run was given. It comes from the CASE for the same reason
 * {@link PROJECT_ROOT} does.
 */
const WORKSPACE = dirname(PROJECT_ROOT);

/**
 * Stand `fetch` and `createImageBitmap` up over the workspace's own tree.
 *
 * specs/assets.md has the build load its four sprites and its drone-burst through
 * the engine's loader, which resolves a path under the fixed `assets/` root,
 * relative to the page, and fetches it. There is no page here, so the two globals
 * the loader reaches for are the ones this stands up, and nothing else is shimmed:
 *
 *  - `roots` is the WORKSPACE ALONE, which is what this case's own shim served
 *    from. The package's default is `[".", "public", "dist"]`, and the extra two
 *    would let a build's staged copy of a produced file answer for the committed
 *    one with nothing to say so. Spectra seeds its art under `assets/` in the
 *    workspace and nowhere else, so there is exactly one place to look.
 *  - `onMissing` is the package's `"404"` — the honest answer a served page gives,
 *    and what makes the engine announce `asset:failed` with a status. This case's
 *    own shim let the read THROW instead, which reached the loader as a rejected
 *    fetch; the two are indistinguishable to this suite, because no check reads
 *    {@link Harness.assetFailures} and every path a build asks for under `assets/`
 *    is seeded.
 *  - `images` supplies `createImageBitmap`. `nameImageBitmap` is deliberately OFF:
 *    naming the canvas library's decoded image as the host's `ImageBitmap` would
 *    change what the ENGINE's own recorder captures into a replay, which is
 *    evidence this case's outputs were never sized for.
 *  - `documentElement` supplies `document.createElement("canvas")`. It is ON
 *    because specs/assets.md leaves the BAND ROUTE to the build: the tint may be
 *    "composited over the seeded PNG at draw time" or "a per-band copy is baked
 *    once at load time", and the second route composes on a scratch canvas the
 *    build asks the document for. With no document that call throws inside the
 *    build's own `initialize`, `createHarness` rejects, and EVERY check in this
 *    project fails on a fact about Node rather than about the build. The shim
 *    hands back a canvas of the same `@napi-rs/canvas` implementation every
 *    reading in this project rasterizes through, so a source a build baked is
 *    read exactly as a seeded bitmap is. Nothing else of a document is supplied,
 *    because nothing else is something the engine's own runtime would give a
 *    build either.
 */
function serveSeededAssets(): AssetHost {
  return installAssetHost({
    workspaceRoot: WORKSPACE,
    roots: ["."],
    onMissing: "404",
    images: true,
    nameImageBitmap: false,
    documentElement: true,
    label: "spectra",
  });
}

/* -------------------------------------------------------------------------- */
/* Building one                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The package's engine machinery, bound to Spectra on this engine.
 *
 * Five of the config's members are where the engines differ, and each is answered
 * here from what THIS engine is:
 *
 *  - `createEngine` stands the engine up over a canvas of this case's own rather
 *    than over the one the kit offers — see {@link caseCanvas} for why — with the
 *    options the seeded `src/main.ts` passes: the design size, the build's exported
 *    `BACKGROUND`, and the touch layout. Everything else the build decided lives
 *    inside `src/game.ts`.
 *  - `driver` is the APPLY-THREADED strategy, over `surface.ts`'s `READINGS`. It
 *    forwards a reading's own arguments past the state, which is what keeps
 *    `menuItemRect(index)` asking about the item the caller named.
 *  - `toLogical` is left at the identity. There is no camera under this engine —
 *    the engine maps the stage onto the canvas and nothing else stands between.
 *  - `pointerPrecision` is `"device-pixel"`, because this case's gestures have
 *    always been dispatched at the pixel a reading samples first: half a device
 *    pixel decides a point wherever a build's hit region passes through one.
 *  - `pointerEvent` is the DEVICE-bearing event, because `specs/ui.md`
 *    distinguishes a mouse from a finger and the engine's pointer input reads
 *    `pointerType`, `button` and `buttons` off the event to tell them apart. A
 *    touch contact carries an id of its own; a mouse keeps one for the life of the
 *    page.
 *
 * `cueEvents` is left at its default of `cue:played` alone: `specs/ui.md` states
 * the mute rule these readings turn on, and this case counts firings rather than
 * beds.
 */
const kit = createEngineCaseHarness<
  SpectraSnapshot,
  SpectraDriver,
  SpectraEngine,
  SpectraModel
>({
  slug: "spectra",
  projectRoot: PROJECT_ROOT,
  stage: { width: STAGE_W, height: STAGE_H },
  tickHz: TICK_HZ,
  surfaceRequirement: SURFACE_REQUIREMENT,
  defaultClock: () => new ConstantClock(TICK_MS),
  createEngine: ({ clock, surface, shape }) => {
    const drawn = caseCanvas(shape);
    const engine = createEngine<SpectraState, SpectraSurface>({
      canvas: drawn.element,
      width: STAGE_W,
      height: STAGE_H,
      game,
      // The build's own stage background, handed to the engine exactly as the
      // seeded `src/main.ts` hands it (specs/overview.md).
      background: BACKGROUND,
      layout: LAYOUT,
      clock,
      surface: surface as SurfaceMetrics,
    });
    surfaces.set(engine as object, drawn);
    return engine;
  },
  driver: (engine, raw) =>
    applyDriver<DeepReadonly<SpectraState>, SpectraState, SpectraDriver>(
      engine,
      raw,
      { readings: READINGS },
    ),
  snapshot: (debug) => debug.snapshot(),
  pointerPrecision: "device-pixel",
  pointerEvent: (type, x, y, device) =>
    new DevicePointerEvent(
      type,
      x,
      y,
      device ?? "mouse",
      device === "touch" ? 2 : 1,
    ),
  extend: (base, engine) => {
    // Written by `createEngine` above, which the kit calls before this and for
    // this same engine; unreachable, and stated rather than asserted away.
    const drawn = surfaces.get(engine as object);
    if (drawn === undefined) throw new Error("spectra: no canvas for engine");
    const { dpr } = base.shape;
    // THE KIT DEFINES WHAT THIS RETURNS ONTO `base` ITSELF, so every member named
    // below is about to REPLACE the one it is written over. A member that then
    // reached for `base.pointer` would be reaching for its own replacement, which
    // is a stack overflow rather than a wrong answer — so the kit's own is taken
    // by hand, here, while it is still the kit's.
    const raisePointer = base.pointer.bind(base);
    const step = base.advance.bind(base);
    const deviceOf = base.device.bind(base);
    return {
      get state() {
        return engine.state;
      },
      ctx: drawn.ctx,
      canvas: drawn.canvas,
      calls: drawn.calls,
      // The kit's own `pixel` reads the canvas the kit built, which this case does
      // not draw into; the reading is otherwise the package's, point for point.
      pixel: (x: number, y: number): Pixel =>
        devicePixelAt(drawn.ctx, deviceOf(x, y)),

      advanceSeconds: (duration: number): Promise<void> =>
        step(ticksFor(duration)),

      css: (x: number, y: number): Point => {
        const at = deviceOf(x, y);
        return { x: at.x / dpr, y: at.y / dpr };
      },

      async pointer(
        type: PointerEventType,
        x: number,
        y: number,
        device: "mouse" | "touch" = "mouse",
      ): Promise<void> {
        raisePointer(type, x, y, device);
        await step(1);
      },
    };
  },
});

/**
 * Build an engine over a canvas of the harness's own, initialize the build's game,
 * and hand back everything a validator reads.
 *
 * Dispose it in an `afterEach`, with `?.`, so a build whose `initialize` rejected
 * fails with the engine's own message rather than with a teardown error on top of
 * it.
 *
 * THE ASSET HOST IS STOOD UP AROUND THE WHOLE OF THIS, because the build loads its
 * sprite art and its drone-burst from `initialize` and the kit runs that. It is
 * reference counted by the package, so two harnesses alive at once hold one
 * installation between them and the globals go back when the last one goes; a build
 * whose `initialize` rejects gives its hold back here rather than leaving the shims
 * standing on a harness that never existed.
 */
export async function createHarness(
  options: HarnessOptions = {},
): Promise<Harness> {
  const host = serveSeededAssets();
  let harness: Harness;
  try {
    harness = await kit.createHarness(options);
  } catch (error) {
    host.uninstall();
    throw error;
  }
  const release = harness.dispose;
  let disposed = false;
  harness.dispose = (): void => {
    if (disposed) return;
    disposed = true;
    release();
    host.uninstall();
  };
  return harness;
}

/** Collect every cue the build plays FROM NOW ON, stamped with its frame. */
export const watchCues = kit.watchCues;

/* -------------------------------------------------------------------------- */
/* Evidence capture                                                           */
/* -------------------------------------------------------------------------- */
//
// A review item declares its OUTPUTS beside its verdict: a `replay` — the frames
// the build itself drew while a validator drove it, kept as evidence a reviewer can
// scrub against the reference implementation's — or an `image`, one frame of it.
// Both writers are the package's, bound here to this case's slug and to THIS
// directory, and four properties are what make them usable:
//
// 1. THEY RECORD THE SECTION, NOT THE RUN. The recorder is armed around the
//    caller's scenario and disarmed the moment that scenario returns, so what is
//    kept is the part the item is ABOUT and never the setup that got there. An item
//    that poses a formation and then opens the dive gate records the dive; the pose
//    costs nothing, and the reviewer is not asked to scrub past a minute of
//    arrangement to reach the two seconds that decide the point. ARM IT NARROWLY. A
//    frame of this game redraws a starfield, both HUD strips, every drone, every
//    bullet and every live burst; the recorder holds 16 MB of captured image bytes
//    before new captures degrade to an opaque marker, so a recording armed around a
//    whole scenario buys a reviewer nothing and can cost the frames the item was
//    about.
// 2. THEY ARE EVIDENCE, NEVER A VERDICT. The scenario's own value comes straight
//    back, so a validator reads it exactly as it did before capture existed, and a
//    scenario that THROWS still writes what it had recorded before the failure
//    travels on — a failing validator is the one whose replay a reviewer most
//    wants. Nothing here can turn a passing validator into a failing one: a
//    recording that cannot be written is reported as an output that never turned
//    up, which is a fact about the host rather than about the build.
// 3. THEY WRITE ONLY WHAT THERE IS TO LOOK AT. A capture that closed no frames
//    leaves no file, so the run reports the output absent instead of offering the
//    reviewer a replay of nothing. An over-long section is THINNED to the package's
//    cap rather than cut short — every nth frame is kept, so the reviewer sees the
//    entire section at a lower frame rate instead of its first few seconds at the
//    full one, which is the reading that matches what these outputs are named for.
// 4. THEY COST NOTHING WHEN NOBODY IS COLLECTING. Outside a run — a case author
//    running this suite from a shell — the media directory is unset, and the whole
//    thing is a no-op that still runs the scenario. The suite behaves identically
//    either way, so a validator cannot pass in one place and fail in the other.

/**
 * Record the frames `scenario` draws and keep them as the review item's `outputId`
 * output, handing back whatever the scenario returned.
 *
 * Wrap the drive, not the arrangement:
 *
 * ```ts
 * const swept = await captureReplay(h, "dive", () =>
 *   h.until((s) => droneOf(s, id).phase === "diving", { maxFrames: 600 }),
 * );
 * assertTrue(swept.hit);
 * ```
 *
 * The assertions stay exactly where they were and read exactly what they did.
 * Capture sits BESIDE them rather than in place of them: a validator still fails for
 * the reasons it failed before, and the recording is what a reviewer looks at
 * afterwards to see what the build actually drew while it did.
 */
export const captureReplay = makeReplayCapture("spectra", PROJECT_ROOT);

/**
 * Keep the frame currently on the canvas as the review item's `outputId` output.
 *
 * The companion to {@link captureReplay}, for a point whose evidence is one PICTURE
 * rather than a stretch of motion: the field a discharge left behind, which screen
 * the game opened on, what the HUD read. A recording of a still field would be the
 * same frame three hundred times over.
 *
 * What is written is whatever the last frame that RAN left behind, so call it after
 * the frame that poses the thing under test — an `advance(1)` following the
 * arrangement — and before the assertions, so a validator that fails still leaves
 * the picture that shows why. Nothing here can change a verdict: outside a run the
 * media directory is unset and this is a no-op.
 */
export const captureStill = kit.captureStill;

/* -------------------------------------------------------------------------- */
/* Reading a snapshot                                                         */
/* -------------------------------------------------------------------------- */
//
// The snapshot is plain data, so most readings are a field access and belong in the
// validator that makes them. What is here is the handful a validator would
// otherwise write out every time: finding an entity by the id a pose handed back,
// splitting the one bullet roster by `friendly`, and the distance between two
// reported centres.
//
// EVERY LOOK-UP BY ID FAILS RATHER THAN RETURNING NOTHING. A validator holds an id
// because a pose put an entity on the field and the snapshot reported it; an id
// that is no longer there is the build having lost the entity, which is a verdict
// and not an absent value for the validator to reason about. So these fail by
// assertion, naming what the surface promised, and the validator reads the entity
// on the next line. Where the ABSENCE is the thing under test — a destroyed drone,
// a consumed bullet — `findDrone` and `findBullet` answer `null` instead.

/** The drone with that id, or `null` once it has left the field. */
export function findDrone(
  snapshot: SpectraSnapshot,
  id: number,
): DroneSnapshot | null {
  return snapshot.drones.find((drone) => drone.id === id) ?? null;
}

/** The drone with that id. Fails the validator if the roster no longer holds it. */
export function droneOf(snapshot: SpectraSnapshot, id: number): DroneSnapshot {
  const found = findDrone(snapshot, id);
  assertTruthy(
    found,
    `snapshot() must report the drone with id ${id}: an entity added through ` +
      "the surface keeps its id until something removes it " +
      "(specs/instrumentation.md)",
  );
  return found as DroneSnapshot;
}

/** The last drone in the roster, which is the one an `addDrone` appended. */
export function lastDrone(snapshot: SpectraSnapshot): DroneSnapshot {
  const found = snapshot.drones[snapshot.drones.length - 1];
  assertTruthy(
    found,
    "snapshot() must report the drone addDrone appended to the roster " +
      "(specs/instrumentation.md)",
  );
  return found;
}

/** Every drone of `kind` on the field, in roster order. */
export function dronesOfKind(
  snapshot: SpectraSnapshot,
  kind: DroneKind,
): DroneSnapshot[] {
  return snapshot.drones.filter((drone) => drone.kind === kind);
}

/** The bullet with that id, or `null` once it has resolved or left the field. */
export function findBullet(
  snapshot: SpectraSnapshot,
  id: number,
): BulletSnapshot | null {
  return snapshot.bullets.find((bullet) => bullet.id === id) ?? null;
}

/** The bullet with that id. Fails the validator if the roster no longer holds it. */
export function bulletOf(
  snapshot: SpectraSnapshot,
  id: number,
): BulletSnapshot {
  const found = findBullet(snapshot, id);
  assertTruthy(
    found,
    `snapshot() must report the bullet with id ${id}: an entity added through ` +
      "the surface keeps its id until something removes it " +
      "(specs/instrumentation.md)",
  );
  return found as BulletSnapshot;
}

/** The last bullet in the roster, which is the one an `add*Bullet` appended. */
export function lastBullet(snapshot: SpectraSnapshot): BulletSnapshot {
  const found = snapshot.bullets[snapshot.bullets.length - 1];
  assertTruthy(
    found,
    "snapshot() must report the bullet addPlayerBullet or addEnemyBullet " +
      "appended to the roster (specs/instrumentation.md)",
  );
  return found;
}

/** The player's bullets, in roster order. One roster holds both kinds. */
export function playerBullets(snapshot: SpectraSnapshot): BulletSnapshot[] {
  return snapshot.bullets.filter((bullet) => bullet.friendly);
}

/** The enemy bullets, in roster order. */
export function enemyBullets(snapshot: SpectraSnapshot): BulletSnapshot[] {
  return snapshot.bullets.filter((bullet) => !bullet.friendly);
}

/** The burst with that id, or `null` once it has finished playing. */
export function findBurst(
  snapshot: SpectraSnapshot,
  id: number,
): BurstSnapshot | null {
  return snapshot.bursts.find((burst) => burst.id === id) ?? null;
}

/** The last burst in the roster, which is the newest one a kill left behind. */
export function lastBurst(snapshot: SpectraSnapshot): BurstSnapshot {
  const found = snapshot.bursts[snapshot.bursts.length - 1];
  assertTruthy(
    found,
    "snapshot() must report the drone-burst a destroyed drone left behind " +
      "(specs/assets.md)",
  );
  return found;
}

/* -------------------------------------------------------------------------- */
/* Scenario helpers                                                           */
/* -------------------------------------------------------------------------- */
//
// Each of these poses a situation through the debug surface and then lets the real
// simulation run. THEY FIX ONLY GEOMETRY: where a drone stands, which slot of the
// grid a formation drone rests in, where the ship is parked, how far below its
// target a shot starts. Every threshold a validator asserts is stated in the
// validator itself, derived from the figure `specs/` fixes for it, because a helper
// that carried the tolerance would hide what the validator is really asserting.
//
// The debug surface is atomic by design (specs/instrumentation.md), so every
// compound sequence lives here. A validator that needs all of a sequence calls the
// helper; a validator that needs only part of it calls the operations it needs.
// Nothing a validator does not ask for happens.

/**
 * Where the ship rests when a run opens and after every respawn
 * (specs/progression.md).
 *
 * Derived from the lane's own clamp bounds rather than restated, so the two cannot
 * drift. It coincides with `FORM_CENTER_X`, which is where the formation grid is
 * centred, because the stage is symmetric about its middle.
 */
export const LANE_CENTER = (SHIP_X_MIN + SHIP_X_MAX) / 2;

/**
 * Open live play on an EMPTY, QUIET field at stage 1, with the ship parked at the
 * centre of its lane on cyan and the run's figures at their opening values.
 *
 * This is the ground almost every validator in this suite stands on, and both
 * halves of it are load-bearing.
 *
 * EMPTY is what the isolation rule asks for: a validator poses exactly the entities
 * its requirement concerns and nothing else, rather than keeping a bystander drone
 * alive in a corner to hold the stage open.
 *
 * QUIET is the four world gates. With `waveEntry`, `diveLaunching`, `stageClearing`
 * and `ship.contact` all off, nothing the scenario did not ask for arrives,
 * launches, ends the stage, or costs a life — and each of the four would otherwise
 * reach in. The stage's own wave releases a group every `ENTER_GROUP_GAP`, so any
 * scenario running longer than half a second would be joined by drones it never
 * asked for; an assembled formation launches its first dive `DIVE_FIRST_DELAY` later
 * and one every `DIVE_GAP_MIN`–`DIVE_GAP_MAX` after that, so a posed formation drone
 * can be pulled into a dive mid-scenario; the live stage's own clear test would end
 * the stage the moment a scenario destroyed the last drone it posed, taking the
 * screen off `inWave` and paying a bonus into a score about to be read; and the ship
 * is the one entity no scenario can remove, so its contact test reaches into every
 * scenario that poses a drone near the bottom or an enemy bullet anywhere, where a
 * life lost enters the `ready` phase and stops the wave.
 *
 * Each gate is the WAVE's or the STAGE's own faculty rather than any entity's, so
 * shutting one removes nothing a requirement concerns.
 *
 * TURNING A GATE BACK ON IS THE EXCEPTION, AND THE ITEM THAT DOES IT IS THE ITEM
 * WHOSE REQUIREMENT THE GATE IS — the wave-entry and challenge items for
 * `setWaveEntry`, the dive-timing items for `setDiveLaunching`, the stage-end items
 * for `setStageClearing`, and the shield, contact and life-loss items for
 * `setShipContact`. Any other validator that finds itself needing one has been
 * mis-posed; re-pose it.
 *
 * It poses and returns; it runs no frame. A validator advances the frames its own
 * reading needs.
 *
 * It is written for a FRESH harness, whose state is the opening one, so it does not
 * reset: the state and the art are already as a run finds them. A validator that
 * reuses a harness across scenarios calls `h.debug.reset()` first.
 */
export function startPosed(h: Harness): void {
  h.debug.clearDrones();
  h.debug.clearPlayerBullets();
  h.debug.clearEnemyBullets();
  h.debug.clearBursts();

  h.debug.setWaveEntry(false);
  h.debug.setDiveLaunching(false);
  h.debug.setStageClearing(false);
  h.debug.setShipContact(false);

  h.debug.setScreen("inWave");
  h.debug.setPhase("live");
  h.debug.setPhaseTimer(0);
  h.debug.setStage(1);

  h.debug.setShipX(LANE_CENTER);
  h.debug.setShipBand("cyan");
  h.debug.setFireLockout(0);
  h.debug.setFireCooldown(0);

  h.debug.setResonance(0);
  h.debug.setInversion(0);

  h.debug.setLives(START_LIVES);
  h.debug.setScore(0);
  h.debug.setExtraLifeAwarded(false);
  h.debug.setChallengeHits(0);
  h.debug.setDiveClock(0);
}

/**
 * Pose a live run PAUSED, with `index` highlighted on the pause menu.
 *
 * The ground the pause menu's pointer and touch points stand on, and the pose
 * `screens/pause-quit` already uses: {@link startPosed} opens a live, empty, quiet
 * wave, and the screen and the highlight are then PLACED rather than walked to.
 * `specs/instrumentation.md` provides `setScreen` and `setMenuIndex` for exactly
 * that, so no menu key is pressed on the way in and the menu keys cannot fail the
 * points that stand here — a build whose `pause` binding or whose menu arrows are
 * broken still has its pointer and its touch graded on this screen, and
 * `controls/pause-escape`, `controls/pause-p` and the `controls` menu-arrow
 * points still decide the keys.
 *
 * One frame is run after the pose, so the screen the gesture then arrives on is
 * the paused screen the build's own code drew.
 */
export async function posePausedMenu(h: Harness, index: number): Promise<void> {
  startPosed(h);
  h.debug.setScreen("paused");
  h.debug.setMenuIndex(index);
  await h.advance(1);
}

/** The lost run the gesture is made from (specs/progression.md). */
const POSED_STAGE = 6;
const POSED_SCORE = 7250;
const POSED_LIVES = 0;

/**
 * Pose a lost run on the game-over screen, with `index` highlighted on its menu.
 *
 * The ground the game-over menu's pointer and touch points stand on, and the pose
 * `screens/game-over-menu-returns` already uses: the run is PLACED lost — the
 * stage it reached, the score it ended on, no lives left — and the screen and the
 * highlight are placed with it. `specs/instrumentation.md` provides `setScreen`
 * and `setMenuIndex` for exactly that, so no life is spent and no menu key is
 * pressed on the way in, and neither the death path nor the menu keys can fail the
 * points that stand here — `progression/game-over-at-zero` still decides the route
 * in, and the `controls` menu-arrow points still decide the keys.
 *
 * There is no live wave to open first, unlike {@link posePausedMenu}: the run is
 * over, so the screen is placed on the field the harness starts with. One frame is
 * run after the pose, so the screen the gesture then arrives on is the game-over
 * screen the build's own code drew.
 */
export async function poseGameOverMenu(
  h: Harness,
  index: number,
): Promise<void> {
  h.debug.setScreen("gameOver");
  h.debug.setStage(POSED_STAGE);
  h.debug.setScore(POSED_SCORE);
  h.debug.setLives(POSED_LIVES);
  h.debug.setMenuIndex(index);
  await h.advance(1);
}

/**
 * Let the GAME build and enter stage `n`'s own wave, and run the one frame that
 * does it.
 *
 * The intro hold is posed to nothing and one frame is run, so the build's own
 * stage-intro code gives way and opens the wave it built — the roster, the layout,
 * the bands and the entry groups are all the build's, and none of them is posed. It
 * is what the items whose requirement IS the wave the game builds stand on: the
 * entrance, the assembly, the composition, the challenge flyover, the stage clear.
 *
 * Call it after {@link startPosed}, which clears the field and quiets the three
 * gates, and then turn back on the one gate the item is about — for almost all of
 * these, `setWaveEntry(true)`.
 *
 * It poses `screen` and the intro's own timer and nothing else. A validator coming
 * off a lost life poses `setPhase("live")` itself, because the phase belongs to the
 * `inWave` screen rather than to the intro.
 */
export async function startStage(h: Harness, n: number): Promise<void> {
  h.debug.setStage(n);
  h.debug.setScreen("stageIntro");
  h.debug.setPhaseTimer(0);
  await h.advance(1);
}

/**
 * Stand the wave the game built where its entrance ends: every drone at its own
 * slot, in phase `formation`, with the entry gate shut behind it.
 *
 * For the items whose requirement is the ASSEMBLED block the build laid out — its
 * composition, its symmetry, the bands it holds — and not the entrance that
 * assembles it. Every drone reports the slot it is bound for from the moment the
 * wave is built (specs/swarm.md, specs/instrumentation.md), and a drone in phase
 * `formation` sits at that slot plus the sway, so posing each drone there is the
 * state its entrance would leave it in, reached without flying the twelve seconds
 * `swarm/assembles` grades. Nothing about the roster is touched: which drones the
 * wave holds, their kinds, their stored bands and their slots are all still the
 * build's. The entry gate is shut so the wave's own release schedule cannot send a
 * drone back out on its way in.
 *
 * Call it after {@link startStage}. It poses and returns; it runs no frame.
 */
export function settleWave(h: Harness): void {
  h.debug.setWaveEntry(false);
  for (const drone of h.snapshot().drones) {
    h.debug.setDronePhase(drone.id, "formation");
    h.debug.setDronePosition(drone.id, drone.slotX, drone.slotY);
  }
}

/**
 * What {@link poseDrone} may pose beyond the position, each defaulting to what
 * `addDrone` gives.
 *
 * The three faculties are the exception: they default OFF here, so a posed drone is
 * a PROP until an item asks for a faculty. That is what lets a validator isolate the
 * one thing it is about — a Flux's rhythm with `oscillation` on and `travel` off, a
 * dive's path with `travel` on and `fire` off, a target for a shot with all three
 * off — which is the separation specs/instrumentation.md provides them for.
 */
export interface DroneOptions {
  /** Its stored band. Defaults to cyan, which is what `addDrone` gives. */
  band?: Band;
  /** Its phase. Defaults to `"formation"`. */
  phase?: DronePhase;
  /** The centre of its resting slot. Defaults to where it was placed. */
  slotX?: number;
  slotY?: number;
  /** A Flux's position inside its current band window. Defaults to `0`. */
  bandClock?: number;
  /** Whether a Prism's outer shell stands. Defaults to intact. */
  shell?: boolean;
  /** Its charge. OVERLOAD ONLY: posing it under `base` fails the validator. */
  charge?: number;
  /** The locomotion faculty. Defaults OFF. */
  travel?: boolean;
  /** The band-clock faculty. Defaults OFF. */
  oscillation?: boolean;
  /** The firing faculty. Defaults OFF. */
  fire?: boolean;
}

/**
 * Pose one drone of `kind` with its CENTRE at `(x, y)`, and report its id.
 *
 * The fields `opts` names are posed one at a time through the surface's own
 * per-field operations, in the order specs/instrumentation.md lists them, and
 * nothing else is touched: a field `opts` does not name keeps whatever `addDrone`
 * gave it.
 *
 * All three faculties are posed on every call, because `addDrone` opens them ON and
 * a prop that quietly flies away is the defect this suite exists to avoid. Name the
 * one the item is about.
 */
export function poseDrone(
  h: Harness,
  kind: DroneKind,
  x: number,
  y: number,
  opts: DroneOptions = {},
): number {
  h.debug.addDrone(kind, x, y);
  const id = lastDrone(h.snapshot()).id;

  if (opts.band !== undefined) h.debug.setDroneBand(id, opts.band);
  if (opts.phase !== undefined) h.debug.setDronePhase(id, opts.phase);
  if (opts.slotX !== undefined || opts.slotY !== undefined) {
    h.debug.setDroneSlot(id, opts.slotX ?? x, opts.slotY ?? y);
  }
  if (opts.bandClock !== undefined) {
    h.debug.setDroneBandClock(id, opts.bandClock);
  }
  if (opts.shell !== undefined) h.debug.setDroneShell(id, opts.shell);
  if (opts.charge !== undefined) {
    requireOp(h, "setDroneCharge")(id, opts.charge);
  }

  h.debug.setDroneTravel(id, opts.travel ?? false);
  h.debug.setDroneOscillation(id, opts.oscillation ?? false);
  h.debug.setDroneFire(id, opts.fire ?? false);

  return id;
}

/** One drone of a posed formation: a kind, a slot of the grid, and its options. */
export interface FormationEntry extends DroneOptions {
  kind: DroneKind;
  /** The column of the slot grid, `0..FORM_COLS - 1` (specs/field.md). */
  col: number;
  /** The row of the slot grid, `0..FORM_ROWS - 1`. */
  row: number;
}

/**
 * Pose a formation from a list of slots, and report the ids in the order given.
 *
 * Each drone is placed at the CENTRE of its slot — `slotX(col)`, `slotY(row)` — in
 * phase `"formation"` with that same point as its resting slot, so the block stands
 * exactly where the grid puts it and the sway carries it from there. Every faculty
 * still defaults OFF, so a formation posed as scenery stays scenery; an item about
 * the sway poses `travel: true` on the entries it measures.
 *
 * ```ts
 * const [left, right] = poseFormation(h, [
 *   { kind: "shard", col: 3, row: 1, band: "cyan" },
 *   { kind: "shard", col: 5, row: 1, band: "magenta" },
 * ]);
 * ```
 */
export function poseFormation(
  h: Harness,
  spec: readonly FormationEntry[],
): number[] {
  return spec.map(({ kind, col, row, ...opts }) =>
    poseDrone(h, kind, slotX(col), slotY(row), {
      phase: "formation",
      slotX: slotX(col),
      slotY: slotY(row),
      ...opts,
    }),
  );
}

/**
 * How far below its target {@link fireAt} places its shot, in logical units.
 *
 * Geometry, not a tolerance: it is far enough that the bullet is unmistakably in
 * flight and clear of the target's own footprint when it is placed — the largest
 * drone, a Prism, is `PRISM_SIZE` (`56`) across — and short enough that the flight
 * is a handful of frames. An item whose requirement IS the distance a shot travels
 * states its own gap.
 */
export const SHOT_GAP = 60;

/**
 * Put one of the player's bullets on the field `gap` units below `(x, y)` carrying
 * `band`, run it up to the point, and report its id.
 *
 * The frames are DERIVED rather than chosen: the bullet climbs at
 * `PLAYER_BULLET_SPEED`, which `specs/ship.md` fixes, so the flight is exactly the
 * frames that speed needs to cover `gap`. Nothing about the outcome is posed — the
 * game's own contact, band and scoring rules are what resolve the shot when it
 * arrives — so a validator reads the roster, the score or the drone afterwards and
 * asserts its own requirement.
 *
 * The id is taken BEFORE the flight, so a validator can ask whether the bullet was
 * consumed on contact ({@link findBullet} answering `null`) or passed through.
 */
export async function fireAt(
  h: Harness,
  x: number,
  y: number,
  band: Band,
  gap: number = SHOT_GAP,
): Promise<number> {
  h.debug.addPlayerBullet(x, y + gap, band);
  const id = lastBullet(h.snapshot()).id;
  await h.advance(ticksFor(gap / PLAYER_BULLET_SPEED));
  return id;
}

/**
 * Hold every key in `codes` for `ticks` frames, then release them.
 *
 * Nothing here poses anything: the keys go to the engine's own input, so the game
 * answers them exactly as it answers a player. Which key drives which action is
 * `BINDINGS` in `constants.ts` and specs/controls.md.
 */
export async function holdFor(
  h: Harness,
  codes: string | readonly string[],
  ticks: number,
): Promise<void> {
  const held = typeof codes === "string" ? [codes] : codes;
  for (const code of held) h.hold(code);
  try {
    await h.advance(ticks);
  } finally {
    for (const code of held) h.release(code);
  }
}

/**
 * Run exactly one frame and hand back the calls THAT frame made.
 *
 * The reading every presentation validator opens with. {@link Harness.calls}
 * accumulates across frames, so what an item about the picture wants is the frame it
 * just drove and not the setup before it.
 */
export async function drawFrame(h: Harness): Promise<DrawCall[]> {
  h.calls.length = 0;
  await h.advance(1);
  return [...h.calls];
}

/* ========================================================================== */
/* What the build drew, and what it played                                    */
/* ========================================================================== */
//
// The presentation and audio halves of this suite need four things the scenario
// helpers above do not provide: a cue record stamped with the frame each cue fired
// on, a way to ask what a single frame's render put where, a colour sampler over
// the rendered canvas, and the seeded art to hold a drawn sprite against. THE
// PALETTE IS THE BUILD'S — specs/overview.md fixes no colour and no typeface, only
// what a player must be able to tell apart — so nothing here knows a colour: the
// samplers compare what was painted against what else was painted.
//
// The cue record is the package's {@link TimedCue}, and {@link watchCues} above is
// the package's collector. The engine publishes `cue:played` synchronously from
// inside `audio.play`, so the handler runs while the frame that played it is still
// running and `engine.frame().count` is that frame's own number. That is what lets
// a validator assert not merely that a cue sounded but that it sounded on the frame
// of the event — which is what tells a build that plays a cue on the right event
// apart from one that plays it on every frame, or a frame late. The cue NAMES are
// `CUES` in `constants.ts`; specs/ui.md says which event each one belongs to, and
// states the mute rule these readings turn on: while sound is muted the game starts
// no sound at all, so a muted cue reaches the bus not at all rather than reaching it
// at zero gain.

/* ---- Text ----------------------------------------------------------------- */

/**
 * One run of text a frame drew, and the logical x range its glyphs span.
 *
 * The package's `TextDraw`, which carries the alignment beside the four figures
 * this case reads.
 */
export type TextSpan = TextDraw;

/**
 * Every logical run of text `calls` drew, placed in logical units.
 *
 * A build may anchor its text through any `translate`/`scale` it likes and align it
 * any way it likes, so the anchor is mapped through the transform the context held
 * at the call and the run is extended about it by its measured width and
 * `textAlign`. Which way a `start`/`end` alignment reads is the page's direction;
 * this game draws no right-to-left text, so they are left and right.
 *
 * COALESCED, never one entry per call. A build that letter-spaces a heading or a
 * readout draws one glyph per `fillText`, which is the only portable way to
 * letter-space canvas text, and every reader of these looks a run up by the copy
 * it carries and then asks where it sits — and no glyph reads as the figure it
 * is part of. So this is the package's `drawnTextRuns`, not its `textDraws`: the
 * merge rule (`case-harness/text.ts`) folds side-by-side glyphs on one baseline
 * back into the run they spell, decided in the canvas's own pixels because the
 * rule is relative, and the merged runs are then carried back through the
 * engine's fit to logical units. A run keeps the anchor of its first draw, so a
 * call that stands alone comes back exactly as `textDraws` would place it, and
 * every raw string is a substring of its run, so this can only add a match and
 * never take one away.
 *
 * This is how the HUD items decide WHERE a reading was drawn — which strip it sits
 * in, which half of the strip, whether it clears the play field.
 */
export function drawnTextSpans(
  h: Harness,
  calls: readonly DrawCall[] = h.calls,
): TextSpan[] {
  return allInLogical(h.engine.viewport(), drawnTextRuns(calls));
}

/* ---- Where a frame put its sprites ---------------------------------------- */

/** One `drawImage` a frame made, placed in logical units. */
export interface DrawnImage {
  /** The image the build handed the context: the frame it drew from. */
  source: unknown;
  /** The destination box's CENTRE, in logical units. */
  x: number;
  y: number;
  /** The destination box's size, in logical units, always positive. */
  w: number;
  h: number;
  /** The build drew it flipped, whichever axis it wrote the flip on. */
  mirrored: boolean;
  /**
   * The SOURCE rectangle a nine-argument `drawImage` named, in the source's own
   * pixels, where the call named one.
   *
   * The destination box above says where the draw landed; this says what part of
   * the bitmap it took. A build that composed an atlas of its own, or that draws a
   * Prism's core out of the middle of `prism.png`, blits a SUB-RECT of the source
   * it handed the context — so a reading that holds a drawn source against the
   * seeded art has to compare the rect the call named rather than the whole sheet
   * behind it. `undefined` for the three- and five-argument forms, which draw the
   * whole of the source.
   */
  crop?: { x: number; y: number; width: number; height: number };
}

/** A source's own pixel size, where it reports one. */
function naturalSize(
  source: unknown,
): { width: number; height: number } | null {
  const held = source as { width?: unknown; height?: unknown };
  if (typeof held?.width !== "number" || typeof held?.height !== "number") {
    return null;
  }
  return { width: held.width, height: held.height };
}

/**
 * Every `drawImage` in `calls`, with its destination box mapped into logical units.
 *
 * A build draws a sprite by translating to the entity's centre and drawing the
 * frame about the origin, so the call's own arguments say nothing about where the
 * sprite landed. The destination box's centre is taken through the transform the
 * context held at the call and then back through the engine's fit, so what comes out
 * is the point on the stage a validator can hold against a reported centre — which
 * is how a draw is attributed to the ship, drone or bullet it was drawn for.
 *
 * All three argument forms are read: `(image, dx, dy)`, `(image, dx, dy, dw, dh)`,
 * and the nine-argument form with a source rectangle, which is what a build reaches
 * for to draw a Prism's core out of the middle of its sprite. That source rectangle
 * comes back as {@link DrawnImage.crop}, so a reading that compares the bitmap the
 * build drew FROM can compare the part of it the call actually took.
 *
 * NOT THE PACKAGE'S `imageDraws`, and the two were compared field for field before
 * this stayed. That one answers an `ImageRef` — an interned ID, a natural size and
 * a hash of where the bitmap came from — where this answers THE SOURCE OBJECT
 * ITSELF, which is what {@link identifySprite} rasterizes and holds against the
 * seeded PNGs; it reports the destination in CANVAS pixels where this reports it in
 * logical units, it carries no {@link DrawnImage.mirrored}, and it takes the
 * transform from an operation WALK where this takes the one the context really
 * held. Four differences, each of them load-bearing here.
 */
export function drawnImages(
  h: Harness,
  calls: readonly DrawCall[] = h.calls,
): DrawnImage[] {
  const view = h.engine.viewport();
  const drawn: DrawnImage[] = [];
  for (const call of calls) {
    if (call.kind !== "call" || call.method !== "drawImage") continue;
    const m = call.transform;
    if (m === undefined) continue;
    const [source, ...rest] = call.args;

    let box: [number, number, number, number] | null = null;
    let crop: DrawnImage["crop"];
    if (rest.length >= 8) {
      box = rest.slice(4, 8) as [number, number, number, number];
      const rect = rest.slice(0, 4) as [number, number, number, number];
      if (rect.every((value) => typeof value === "number")) {
        crop = { x: rect[0], y: rect[1], width: rect[2], height: rect[3] };
      }
    } else if (rest.length >= 4) {
      box = rest.slice(0, 4) as [number, number, number, number];
    } else if (rest.length >= 2) {
      const size = naturalSize(source);
      if (size !== null) {
        box = [rest[0] as number, rest[1] as number, size.width, size.height];
      }
    }
    if (box === null || !box.every((value) => typeof value === "number")) {
      continue;
    }

    const [dx, dy, dw, dh] = box;
    const at = applyMatrix(m, dx + dw / 2, dy + dh / 2);
    drawn.push({
      source,
      x: (at.x - view.offsetX) / view.scale,
      y: (at.y - view.offsetY) / view.scale,
      w: Math.abs(dw * Math.hypot(m[0], m[1])) / view.scale,
      h: Math.abs(dh * Math.hypot(m[2], m[3])) / view.scale,
      // A negative determinant is a flip, whichever axis the build wrote it on.
      mirrored: m[0] * m[3] - m[1] * m[2] < 0,
      crop,
    });
  }
  return drawn;
}

/** Every image drawn within `within` units of a logical point, nearest first. */
export function imagesNear(
  drawn: readonly DrawnImage[],
  x: number,
  y: number,
  within: number,
): DrawnImage[] {
  return drawn
    .filter((image) => distance(image, { x, y }) <= within)
    .sort((a, b) => distance(a, { x, y }) - distance(b, { x, y }));
}

/* ---- The seeded art ------------------------------------------------------- */

/** The four seeded sprites, by the name each is drawn for (specs/assets.md). */
export const SPRITE_FILES = SPRITES;

export type SpriteName = keyof typeof SPRITE_FILES;

/** One seeded sprite, as the comparison reads it. */
export interface SeededSprite {
  name: SpriteName;
  width: number;
  height: number;
  /** Premultiplied RGBA, four channels per pixel. */
  pixels: Float64Array;
}

/**
 * How far a drawn source's pixels may sit from a seeded sprite's, as a mean
 * absolute difference over premultiplied RGBA channels, out of `255`.
 *
 * The requirement is IDENTITY — the source IS the seeded file — so this is not a
 * likeness tolerance. It is room for the one lossy step in reading a bitmap back
 * out of a canvas: a partially transparent pixel is premultiplied on the way in and
 * un-premultiplied on the way out, so it can shift by a unit. Comparing on
 * premultiplied channels removes even that, and any two of the four seeded sprites
 * measure several times this apart.
 */
export const SPRITE_MATCH_MAX = 1;

/**
 * A drawable source's premultiplied RGBA channels, rasterized at its own size.
 *
 * Not the package's `rasterize`, which paints a COLOUR STRING onto a probe pixel;
 * this one draws a BITMAP and reads its channels back. Two different readings that
 * happen to share a verb — the package's is bound as `rasterizeColor` below, where
 * {@link clearColor} needs it.
 */
async function rasterize(
  source: unknown,
): Promise<{ width: number; height: number; pixels: Float64Array } | null> {
  const size = naturalSize(source);
  if (size === null || size.width <= 0 || size.height <= 0) return null;
  const canvas = createCanvas(size.width, size.height);
  const ctx = canvas.getContext("2d");
  try {
    ctx.drawImage(
      source as Parameters<SKRSContext2D["drawImage"]>[0],
      0,
      0,
      size.width,
      size.height,
    );
  } catch {
    return null;
  }
  const { data } = ctx.getImageData(0, 0, size.width, size.height);
  const pixels = new Float64Array(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3] / 255;
    pixels[i] = data[i] * alpha;
    pixels[i + 1] = data[i + 1] * alpha;
    pixels[i + 2] = data[i + 2] * alpha;
    pixels[i + 3] = data[i + 3];
  }
  return { width: size.width, height: size.height, pixels };
}

/** The mean absolute difference between two equal-length channel runs. */
function meanDifference(a: Float64Array, b: Float64Array): number {
  let total = 0;
  for (let i = 0; i < a.length; i += 1) total += Math.abs(a[i] - b[i]);
  return total / a.length;
}

/** Read once, because every presentation item reads the same four files. */
let seeded: Promise<SeededSprite[]> | null = null;

/**
 * Every seeded sprite, read off the workspace's own `assets/` tree.
 *
 * The same tree the build was handed, so a match is against exactly the art the
 * case seeded rather than against a copy of it (specs/assets.md).
 */
export function seededSprites(): Promise<SeededSprite[]> {
  // A read that failed is NOT kept: a memoised rejection would answer every later
  // validator with the first one's error, long after whatever caused it.
  seeded ??= readSeededSprites().catch((error: unknown) => {
    seeded = null;
    throw error;
  });
  return seeded;
}

/** Every seeded sprite, read off disk and rasterized once. */
async function readSeededSprites(): Promise<SeededSprite[]> {
  const sprites: SeededSprite[] = [];
  for (const name of Object.keys(SPRITE_FILES) as SpriteName[]) {
    const bytes = readFileSync(join(WORKSPACE, "assets", SPRITE_FILES[name]));
    const raster = await rasterize(await loadImage(bytes));
    if (raster === null) continue;
    sprites.push({ name, ...raster });
  }
  return sprites;
}

/** Which seeded sprite a drawn source is, and how closely it matched. */
export interface SpriteMatch {
  name: SpriteName;
  /** The mean absolute channel difference the match was made at. */
  difference: number;
}

/**
 * Identify the seeded sprite a build drew from, or `null` where it drew from
 * something else.
 *
 * The reading is the IMAGE SOURCE ITSELF rather than the pixels on the stage: the
 * bitmap the build handed the context is rasterized and held against the seeded
 * PNGs. A source that IS a seeded sprite matches it exactly; anything else — a
 * canvas the build painted, art of its own, a recoloured copy — does not. That is
 * what tells a build drawing the game from the seeded art apart from one drawing
 * convincing shapes in code, which is the whole point of the sprite items.
 *
 * A build that composites a band's colour OVER the drawn pixels still matches,
 * because the tint is a separate operation issued after the draw and the source
 * handed to `drawImage` is the seeded bitmap itself (specs/assets.md).
 */
export async function identifySprite(
  source: unknown,
  sprites?: readonly SeededSprite[],
): Promise<SpriteMatch | null> {
  const sheet = sprites ?? (await seededSprites());
  const raster = await rasterize(source);
  if (raster === null) return null;
  let best: SpriteMatch | null = null;
  for (const sprite of sheet) {
    if (sprite.width !== raster.width || sprite.height !== raster.height)
      continue;
    const difference = meanDifference(raster.pixels, sprite.pixels);
    if (best === null || difference < best.difference) {
      best = { name: sprite.name, difference };
    }
  }
  return best !== null && best.difference <= SPRITE_MATCH_MAX ? best : null;
}

/** One emitter of the seeded drone-burst system. */
export interface SeededEmitter {
  name: string;
  emission: { mode: string; count: number; atMs: number };
  lifetimeMs: number;
  lifetimeSpread: number;
}

/** The seeded drone-burst, as much of it as a validator reads. */
export interface SeededBurstSystem {
  durationMs: number;
  field: { width: number; height: number };
  emitters: SeededEmitter[];
}

/** Read once: the seeded particle system is a fixed file. */
let seededBurst: SeededBurstSystem | null = null;

/**
 * The seeded drone-burst system, read off the workspace's own `assets/` tree.
 *
 * `bursts.from-provided-system` holds a live particle count against this file's own
 * emitters, so what it compares against is the file the case seeded rather than a
 * figure restated here.
 */
export function seededBurstSystem(): SeededBurstSystem {
  seededBurst ??= JSON.parse(
    readFileSync(join(WORKSPACE, "assets", BURST_SYSTEM), "utf8"),
  ) as SeededBurstSystem;
  return seededBurst;
}

/* ---- Colour --------------------------------------------------------------- */

/** A sampled colour, each channel 0–255. The package's reading. */
export type { Rgb };

/**
 * A rectangle of the stage, in logical units, by its top-left corner.
 *
 * The package's `Rect`, which is the same four fields under a name that says less
 * about which space it is stated in.
 */
export type Box = Rect;

/**
 * How far out on the axes {@link sampleColor} takes its four neighbours.
 *
 * Three logical units, which stays well inside even the smallest drawn body — a
 * Shard is `SHARD_SIZE` (`28`) across — so one stray anti-aliased or glow pixel
 * cannot swing the reading. THE PACKAGE'S DEFAULT IS FOUR, and a radius is a
 * threshold like any other: this case's verdicts were taken at three.
 */
const SAMPLE_RADIUS = 3;

/**
 * The rendered colour at a logical point, averaged over a small cluster.
 *
 * The centre pixel plus four neighbours {@link SAMPLE_RADIUS} units out.
 */
export function sampleColor(h: Harness, x: number, y: number): Rgb {
  return clusterColor(h, x, y, SAMPLE_RADIUS);
}

/**
 * `steps` colours sampled evenly along the segment joining two logical points, both
 * ends included.
 *
 * How a validator reads whether the build drew something ALONG a line — a
 * discharge's expanding ring, a bullet's climb — without knowing what colour it drew
 * it in.
 */
export function samplesAlong(
  h: Harness,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps: number,
): Rgb[] {
  const samples: Rgb[] = [];
  const last = Math.max(1, steps - 1);
  for (let i = 0; i < steps; i += 1) {
    const t = i / last;
    samples.push(
      sampleColor(
        h,
        from.x + (to.x - from.x) * t,
        from.y + (to.y - from.y) * t,
      ),
    );
  }
  return samples;
}

/**
 * A rectangle of the canvas, read once, in device pixels.
 *
 * The package's `PixelRect`: the same three fields, RGBA four bytes per pixel,
 * row-major.
 */
export type Region = PixelRect;

/**
 * Every device pixel inside a logical box, read in ONE `getImageData`.
 *
 * The reading behind the items that count what was painted rather than sampling
 * where — the starfield's marks, the pixels a burst puts inside its footprint, the
 * play that must stay out of a HUD strip. One call rather than a sample per point,
 * because a starfield mark is a pixel or two wide and a grid of samples would walk
 * straight past most of them.
 */
export function readRegion(h: Harness, box: Box): Region {
  const topLeft = h.device(box.x, box.y);
  const bottomRight = h.device(box.x + box.w, box.y + box.h);
  const width = Math.max(1, bottomRight.x - topLeft.x);
  const height = Math.max(1, bottomRight.y - topLeft.y);
  const { data } = h.ctx.getImageData(topLeft.x, topLeft.y, width, height);
  return { width, height, data };
}

/**
 * The colour of one pixel of a region already read.
 *
 * NOT the package's `pixelAt`, which reads ONE DEVICE PIXEL off a live context —
 * a different question over a different subject, sharing a name. That one is bound
 * as the harness's own `pixel`; this one indexes a rectangle already in hand.
 */
export function pixelAt(region: Region, x: number, y: number): Rgb {
  const at = (y * region.width + x) * 4;
  return { r: region.data[at], g: region.data[at + 1], b: region.data[at + 2] };
}

/**
 * How many pixels of `region` sit further than `minDistance` from `colour`.
 *
 * The plain count, for an item that asks whether ANYTHING was painted over a
 * stretch of field. {@link countMarks} is what asks how many separate things were.
 *
 * The package's `pixelsDiffering` and `pixelsChanged` both compare TWO rectangles
 * with each other; this compares one rectangle against a COLOUR, which is the
 * reading an item about a bare field takes when it has nothing to compare against.
 */
export function countUnlike(
  region: Region,
  colour: Rgb,
  minDistance: number,
): number {
  let count = 0;
  for (let i = 0; i < region.data.length; i += 4) {
    const away = Math.hypot(
      region.data[i] - colour.r,
      region.data[i + 1] - colour.g,
      region.data[i + 2] - colour.b,
    );
    if (away > minDistance) count += 1;
  }
  return count;
}

/**
 * How many separate MARKS `region` holds: connected runs of pixels further than
 * `minDistance` from `colour`.
 *
 * Four-connected, so two marks touching only at a corner count as two. This is what
 * `field.starfield` reads — the item asks for a number of marks rather than a number
 * of lit pixels, and one star is several pixels — and what any item asking how many
 * distinct things a frame painted over an empty field reads.
 */
export function countMarks(
  region: Region,
  colour: Rgb,
  minDistance: number,
): number {
  const { width, height, data } = region;
  const lit = new Uint8Array(width * height);
  for (let i = 0; i < lit.length; i += 1) {
    const at = i * 4;
    const away = Math.hypot(
      data[at] - colour.r,
      data[at + 1] - colour.g,
      data[at + 2] - colour.b,
    );
    lit[i] = away > minDistance ? 1 : 0;
  }

  let marks = 0;
  const stack: number[] = [];
  for (let start = 0; start < lit.length; start += 1) {
    if (lit[start] === 0) continue;
    marks += 1;
    lit[start] = 0;
    stack.push(start);
    while (stack.length > 0) {
      const at = stack.pop() as number;
      const x = at % width;
      const y = (at - x) / width;
      if (x > 0 && lit[at - 1] === 1) {
        lit[at - 1] = 0;
        stack.push(at - 1);
      }
      if (x + 1 < width && lit[at + 1] === 1) {
        lit[at + 1] = 0;
        stack.push(at + 1);
      }
      if (y > 0 && lit[at - width] === 1) {
        lit[at - width] = 0;
        stack.push(at - width);
      }
      if (y + 1 < height && lit[at + width] === 1) {
        lit[at + width] = 0;
        stack.push(at + width);
      }
    }
  }
  return marks;
}

/**
 * The build's exported `BACKGROUND`, rasterized: the colour the engine clears the
 * whole canvas to each frame (specs/overview.md), read back through the same canvas
 * implementation the harness samples with, so a pixel the game never drew over
 * compares against it exactly.
 *
 * The package's `rasterize` repeats the fill rather than applying it once, for the
 * reason this case's own copy did: the engine composites its clear over the previous
 * frame every frame, which converges on the colour's own channels, and a single fill
 * over a transparent canvas would not.
 */
export function clearColor(): Rgb {
  const [r, g, b] = rasterizeColor(BACKGROUND);
  return { r, g, b };
}

/* -------------------------------------------------------------------------- */
/* Menus, driven by a real mouse and a real finger                            */
/* -------------------------------------------------------------------------- */
//
// The menus take a pointer and a touch contact as well as the keyboard
// (`specs/ui.md`), and where a build LAYS the items out is the build's own — so a
// check asks the build where it put an item, through `menuItemRect`, and then
// drives a real pointer at that region. Nothing here poses a pointer through the
// surface: a pose would tell the build where the pointer is without making the
// engine's input layer see a press, a travel and a release the way a hand does,
// and what these checks are about is precisely that the build reads them.

/**
 * Where the build put item `index` of the menu the current screen shows.
 *
 * Fails by assertion when the build reports no region for an item its own menu
 * shows, so the point names that fault rather than dividing by a `null` several
 * lines later. A check that is ABOUT the reading returning `null` — on a screen
 * with no menu, or past the end of one — calls `h.debug.menuItemRect` directly.
 */
export function menuRect(h: Harness, index: number): MenuRect {
  const rect = h.debug.menuItemRect(index);
  assertTruthy(
    rect,
    `menuItemRect(${index}) must report the hit region of item ${index} on the ` +
      "menu the current screen shows (specs/instrumentation.md)",
  );
  return rect as MenuRect;
}

/** Move the pointer onto item `index`, and run the frame that reads it. */
export async function pointerOntoItem(
  h: Harness,
  index: number,
): Promise<void> {
  const at = rectCenter(menuRect(h, index));
  await h.pointer("pointermove", at.x, at.y);
}

/** Press and release the pointer inside item `index`'s region. */
export async function clickItem(h: Harness, index: number): Promise<void> {
  const at = rectCenter(menuRect(h, index));
  await h.pointer("pointermove", at.x, at.y);
  await h.pointer("pointerdown", at.x, at.y);
  await h.pointer("pointerup", at.x, at.y);
}

/**
 * Press on one item, travel to another, and release there.
 *
 * The two edges fall in different regions, so this confirms nothing — the
 * affordance that lets a player slide off a control to cancel, which
 * `specs/ui.md` states and a check reads back as a `menuIndex` that moved and a
 * screen that did not.
 */
export async function dragBetweenItems(
  h: Harness,
  from: number,
  to: number,
): Promise<void> {
  const start = rectCenter(menuRect(h, from));
  const end = rectCenter(menuRect(h, to));
  await h.pointer("pointermove", start.x, start.y);
  await h.pointer("pointerdown", start.x, start.y);
  await h.pointer("pointermove", end.x, end.y);
  await h.pointer("pointerup", end.x, end.y);
}

/** Land a touch contact inside item `index`'s region and leave it down. */
export async function landOnItem(h: Harness, index: number): Promise<void> {
  const at = rectCenter(menuRect(h, index));
  await h.pointer("pointerdown", at.x, at.y, "touch");
}

/**
 * Land a touch contact inside item `index`'s region and lift it there.
 *
 * The landing selects the item as well as confirming it, because a finger does
 * not hover (`specs/ui.md`) — which is the difference between this and
 * {@link clickItem}, and the reason both exist.
 */
export async function tapItem(h: Harness, index: number): Promise<void> {
  const at = rectCenter(menuRect(h, index));
  await h.pointer("pointerdown", at.x, at.y, "touch");
  await h.pointer("pointerup", at.x, at.y, "touch");
}

/** Land a contact on one item, travel to another, and lift there: confirms nothing. */
export async function touchBetweenItems(
  h: Harness,
  from: number,
  to: number,
): Promise<void> {
  const start = rectCenter(menuRect(h, from));
  const end = rectCenter(menuRect(h, to));
  await h.pointer("pointerdown", start.x, start.y, "touch");
  await h.pointer("pointermove", end.x, end.y, "touch");
  await h.pointer("pointerup", end.x, end.y, "touch");
}
