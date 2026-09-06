// Floe — the shared validator harness. CASE-PROVIDED.
//
// Every check in this suite is an ordinary vitest test that runs IN THE SAME
// PROCESS as the build. It imports the runtime and the build's own modules,
// creates a runtime over a canvas it owns and a clock it chose, and steps the game
// with `engine.advance`. Nothing drives a browser, nothing polls, and no
// wall-clock time passes: a check asks for a number of frames and gets exactly
// that number, at exactly the deltas its clock supplied.
//
// WHAT IS HERE AND WHAT IS NOT. The machinery of that paragraph — the canvas and
// its draw-command recorder, the debug surface and the stand-in for a missing
// one, the driver that threads a PURE surface through the runtime's `apply`, the
// frame sweep, the cue stamping, the pixel and text readings, the `fetch` and the
// image decoder a headless host lacks, and the evidence a review item's output is
// written from — is the shared `@clockwyrks/case-harness` package's, staged in
// beside this file as `./case-harness/`. What stays HERE is what is genuinely
// Floe's: the operations its `specs/instrumentation.md` requires, the shape of its
// snapshot, the way it divides an interval into calls, the readings it makes off
// its own seeded art, and the scenarios its checks are posed from.
//
// WHAT A CHECK READS. The game's own state (through the debug surface's
// `snapshot`), the runtime's frame counter, the cues the runtime broadcast, and —
// for the rendering checks — the pixels on the canvas or the calls the 2D context
// received. Nothing here fabricates an outcome: the scenario helpers below only
// ARRANGE the strait through the debug surface, and the real `update` the build
// wrote is what runs from there.
//
// WHY THE DEBUG SURFACE RATHER THAN RAW ASSIGNMENT. specs/instrumentation.md fixes
// its operations, so they mean the same thing in every build: `addBear` appends a
// settled bear with its three faculties on, `setLevel` lays the sixteen lanes out
// for the level, a world gate stays off until something turns it back on, and
// `reset` gives everything back. Posing through it is how a scenario is
// arranged, and it is the seam the case's specification documents.
// `surface.ts` is that specification as types, and it is the only description of
// the surface this harness reads: the build's own module for it is never imported.
//
// WHERE THE SURFACE COMES FROM. Off `engine.debug`, never built here. The build's
// `initialize` returns it beside the state, as `[state, debug]`, and the runtime
// holds the second element and returns it from `engine.debug`. Reading it back off
// the runtime is the only way a surface reaches a check, so a build that returned
// no surface, or a surface missing an operation, fails the checks that reach the
// game through it. The package's `readDebugSurface` does that read and stands an
// `absentSurface` in when there is nothing to read, so the fault lands on the
// points whose checks reach the game through the surface rather than on the
// `beforeEach` that built the harness.
//
// HOW THE SURFACE IS DRIVEN — the APPLY-THREADED strategy, which is what a simple
// runtime's state model forces. The runtime holds the state by value and hands it
// out read-only, so the surface is pure: a pose takes the current state and
// returns the next, a reading takes the current state and returns what it read
// (`surface.ts`). A check still writes `h.debug.setLives(1)` and
// `h.debug.snapshot()`, because `h.debug` is the package's `applyDriver` over the
// raw surface: it runs each pose through `engine.apply` and hands each reading
// `engine.state` FOLLOWED BY the reading's own arguments — which is what lets
// `menuItemRect(state, index)` be called as `menuItemRect(index)` and reach the
// item the check asked about. `surface.ts`'s `READINGS` is what tells a reading
// from a pose, because nothing about a pure surface distinguishes them at run
// time. Nothing a check does holds a writable state: `h.state` is the runtime's
// current value, read fresh on every access, and the only way to change it is a
// pose.
//
// THE HARNESS SUPPLIES THE CLOCK, NOT THE GAME. `ConstantClock(TICK_MS)` is the
// default, at the simulation's own tick length, so ONE ADVANCED FRAME IS EXACTLY
// ONE TICK: the frame's delta completes one whole `TICK_DT` and carries no
// remainder (specs/overview.md). Every duration in this suite is therefore a whole
// number of frames, which is the unit a frame-counted tolerance is stated in, and
// it is why `[instrumentation]` carries no `tick_hz` — the fixed step is a rule of
// the GAME, asserted by `instrumentation/tick-length`, not a property of whatever
// drives it. A check that is specifically about the step size, or about the game
// running on a real clock, builds its own harness with a clock of its own.
//
// THE SEEDED ART IS SERVED HEADLESS. specs/assets.md has the build load every
// frame through the engine, which resolves each path under `assets/` relative to
// the page and fetches it. This project runs in a Node process with no page — the
// suite's environment is `node`, where `fetch` and `createImageBitmap` are
// undefined — so the package's asset host stands both up over the workspace's own
// tree for the life of each harness and puts them back on `dispose`. That is the
// same kind of thing the canvas, the surface metrics and the clock are — the host
// the engine runs on — and without it every scenario would draw a strait the build
// was never given the art for.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import {
  ConstantClock,
  createEngine,
  type Engine,
  type Game,
  type SurfaceMetrics,
} from "@clockwyrks/simple-2d";
import type { DeepReadonly } from "ts-essentials";
import { makeTickMath } from "./case-harness/clock";
import { colorDistance, type Rgb } from "./case-harness/color";
import {
  applyDriver,
  boundDrawLog,
  createEngineCaseHarness,
  installAssetHost,
  type AssetFailure,
  type AssetHost,
  type EngineHarness,
  type EngineHarnessOptions,
  type PlayedCue,
  type PointerEventType,
  type PureDriver,
  type TimedCue,
  type UntilOptions,
  type UntilResult,
} from "./case-harness/engine/index";
import {
  allInLogical,
  makeReplayCapture,
  sampleColor as sampleClusterColor,
  type EnginePointReader,
} from "./case-harness/engine/2d";
import { callsTo, setsOf, type DrawCall } from "./case-harness/draw-calls";
import { IDENTITY, transformed, type Matrix } from "./case-harness/matrix";
import { rectCenter, type Point } from "./case-harness/point";
import {
  drawnText as rawDrawnText,
  textDraws,
  type TextDraw,
} from "./case-harness/text";
import {
  BAYS,
  BEAR_FRAMES,
  BINDINGS,
  CAR_FRAMES,
  COLS,
  CROSSER_FRAMES,
  DOGSLED_FRAMES,
  HOP_COOLDOWN,
  ICE_BOTTOM,
  ICE_TOP,
  LAYOUT,
  PAN_FRAMES,
  PLOW_FRAMES,
  RAFT_FRAMES,
  ROWS,
  ROW_BAYS,
  ROW_CAP,
  ROW_MEDIAN,
  ROW_NEAR,
  STAGE_H,
  STAGE_W,
  START_COL,
  START_LIVES,
  TICK_HZ,
  TILE,
  WATER_BOTTOM,
  WATER_TOP,
  colAt,
  crossingTimer,
  rowAt,
  tileCX,
  tileCY,
  tileLeft,
  type ActionName,
} from "./constants";
import { BACKGROUND, game as build, type FloeState } from "../src/game";
import { assertTruthy, fail } from "./assert";
import {
  READINGS,
  type BearSnapshot,
  type CritterSnapshot,
  type Facing,
  type FloeDebugApi,
  type FloeItemSnapshot,
  type FloeKind,
  type FloeSnapshot,
  type Footing,
  type LaneSnapshot,
  type MenuRect,
  type Phase,
  type Screen,
  type Tile,
  type VehicleKind,
  type VehicleSnapshot,
} from "./surface";

export type {
  BearSnapshot,
  CritterSnapshot,
  Facing,
  FloeItemSnapshot,
  FloeKind,
  FloeSnapshot,
  Footing,
  LaneSnapshot,
  MenuRect,
  Phase,
  Screen,
  Tile,
  VehicleKind,
  VehicleSnapshot,
};

/* The readings this project takes straight off the package, under its names. */
export type { AssetFailure, DrawCall, Matrix, PlayedCue, Point, Rgb, TimedCue };
export { callsTo, colorDistance, rectCenter, setsOf };

/** The case's surface, bound to the state type the build declared. */
export type FloeSurface = FloeDebugApi<FloeState>;

/**
 * The surface as every check drives it: every member of the pure surface, minus
 * its state argument, over the runtime that holds the state.
 */
export type FloeDriver = PureDriver<
  DeepReadonly<FloeState>,
  FloeState,
  FloeSurface
>;

/** The runtime this project stands a build up on. */
export type FloeEngine = Engine<FloeState, FloeSurface>;

/**
 * The build's game, typed against the surface the CASE specifies.
 *
 * The build declares its own type for the surface its `initialize` returns, and
 * that type is the build's: what a check holds it to is `surface.ts`, so the game
 * is cast to the case's `Game<FloeState, FloeSurface>` here and the runtime is
 * parameterized with it. A surface that departs from the specification is caught
 * where a check reaches for the missing member, not by the build's own compiler.
 */
const game = build as unknown as Game<FloeState, FloeSurface>;

/* -------------------------------------------------------------------------- */
/* The clock                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The frame the suite steps in, in milliseconds: the game's own tick.
 *
 * specs/overview.md fixes the simulation at `TICK_HZ` (`120`) whole ticks a
 * second, each of `TICK_DT`, with a frame running as many whole ticks as its
 * elapsed time completes and carrying the remainder. Stepping at exactly one tick
 * per frame makes the two the same thing: `advance(n)` runs `n` ticks, no
 * remainder is ever carried, and a duration in seconds is a whole number of
 * frames.
 *
 * `TICK_MS` is derived from the build's own `TICK_HZ` rather than restated, so a
 * check that reads `TICK_HZ` and a frame the harness steps cannot disagree.
 */
export const TICK_MS = 1000 / TICK_HZ;

/**
 * The ticks {@link FloeModel.skip} and {@link FloeModel.pace} put in one frame.
 *
 * Waiting out a cadence the specification measures in tens of seconds is
 * thousands of ticks, and drawing a picture for each of them is most of what it
 * costs. Ten ticks a frame runs exactly the same ticks — specs/overview.md has
 * the simulation advance by the whole `TICK_DT` ticks a frame's delta completes,
 * so the state reached over an interval of game time does not depend on how that
 * interval was divided into frames — and skips nine pictures in ten.
 *
 * Ten rather than more because a frame's delta stays small: ten ticks is `83` ms,
 * well inside any sane ceiling a build puts on how much time one frame may carry.
 */
export const COARSE_TICKS = 10;

/**
 * How far {@link FloeModel.skipUntil} sweeps when the caller names no ceiling, and
 * how much game time separates two of its readings. Both are in SECONDS of game
 * time, because a coarse sweep is for a wait the specification measures in
 * seconds rather than in ticks.
 *
 * A minute is the longest span any point in this suite watches for, and a quarter
 * of a second is a thirty-second of `FISH_INTERVAL` (`8` s), the longest cadence
 * the specification states — so no arrival is stepped over.
 */
const DEFAULT_SWEEP_SECONDS = 60;
const DEFAULT_SKIP_POLL_SECONDS = 0.25;

/**
 * The package's tick arithmetic, bound to the rate this suite steps at.
 *
 * Taken here rather than off the kit below, because the kit's own harness reaches
 * for {@link ticksFor} and {@link seconds} and a kit that supplied them to its own
 * configuration would be defined in terms of itself.
 */
const arithmetic = makeTickMath(TICK_HZ);

/** Seconds of simulated time in `ticks` frames of the default clock. */
export const seconds = arithmetic.seconds;

/**
 * Whole frames of the default clock covering at least `duration` seconds.
 *
 * Rounded UP, so a hold stated in seconds always covers the whole of it. Floe has
 * one duration no whole number of ticks reaches exactly — `HOP_COOLDOWN` (`0.12`
 * s) is `14.4` ticks — and rounding up is the reading specs/hopping.md fixes: the
 * cooldown is spent on the fifteenth tick, the first at which none of it is left.
 * A check that needs the exact elapsed time asserts against `seconds(ticksFor(d))`
 * rather than against `d`.
 *
 * NOT THE SAME ROUNDING AS THE STRUCTURED-2D PROJECT'S, whose `ticksFor` rounds to
 * the NEAREST whole tick and whose `restHop` is measured from that. The two
 * projects have always disagreed here, so each keeps the one its verdicts were
 * taken under.
 */
export const ticksFor = arithmetic.ticksFor;

/** A rate in units per second from a displacement measured over `ticks` frames. */
export const speedOverTicks = arithmetic.speedOverTicks;

/** A rate in TILES per second from a displacement measured over `ticks` frames. */
export function tilesPerSecond(delta: number, ticks: number): number {
  return speedOverTicks(delta, ticks) / TILE;
}

/* -------------------------------------------------------------------------- */
/* What a frame drew                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The most calls {@link EngineHarness.calls} holds before the oldest are dropped.
 *
 * The list is what a rendering check reads, and a rendering check reads ONE
 * frame: the idiom is `h.calls.length = 0`, one `advance(1)`, then the reading —
 * which is what {@link drawFrame} does. But the list is recorded whether a check
 * reads it or not, and this case's longest sweeps run a minute of game time
 * (7,200 frames) over a strait drawing five bands, sixteen lanes of items and the
 * HUD each frame, so an uncapped list would be hundreds of megabytes in a check
 * that never looks at it. Past the cap the oldest half is dropped, which is far
 * beyond any single frame and so cannot cost a reading anything.
 */
const MAX_RECORDED_CALLS = 200_000;

/** One `drawImage` a frame made, with the transform in force at the call. */
export interface ImageCall {
  /** The call's own arguments, the bitmap source first. */
  args: readonly unknown[];
  /** The transform the context held when the call was made. */
  transform: Matrix;
}

/**
 * Every `drawImage` in `calls`, each with the transform in force at it.
 *
 * A build draws a lane item by translating to its left edge and drawing the frame
 * about the origin (`ctx.translate(x, top); ctx.drawImage(f, 0, 0, w, 32)`) — and
 * mirrors a leftward one by translating to its RIGHT edge and scaling by `-1` — so
 * the destination arguments alone say nothing about where the sprite landed. The
 * transform is what maps one back, and it is recovered by REPLAYING the frame's
 * own operations: `save`/`restore` stack it, the runtime's letterbox fit arrives
 * as a `setTransform` the recorder sees, and the build's own `translate`/`scale`
 * are in the same list. So the state in force at a call is recovered exactly from
 * the record, and nothing here has to ask the context a question after the fact.
 *
 * {@link drawnImages} is the only reader, and this is where the walk lives so
 * that where a sprite landed is decided in one place.
 */
export function imageCalls(calls: readonly DrawCall[]): ImageCall[] {
  const found: ImageCall[] = [];
  const stack: Matrix[] = [];
  let current: Matrix = IDENTITY;
  for (const call of calls) {
    if (call.kind !== "call") continue;
    const { method, args } = call;
    if (method === "save") {
      stack.push(current);
      continue;
    }
    if (method === "restore") {
      current = stack.pop() ?? IDENTITY;
      continue;
    }
    const moved = transformed(current, method, args);
    if (moved !== null) {
      current = moved;
      continue;
    }
    if (method === "drawImage") found.push({ args, transform: current });
  }
  return found;
}

/* -------------------------------------------------------------------------- */
/* The harness                                                                */
/* -------------------------------------------------------------------------- */

/** The window a harness reports to the runtime, and the clock it steps on. */
export type HarnessOptions = EngineHarnessOptions;

export type { UntilOptions, UntilResult };

/** How far a coarse sweep may run, and how much game time separates two samples. */
export interface SkipOptions {
  maxSeconds?: number;
  pollSeconds?: number;
}

/** What a coarse sweep found. */
export interface SkipResult {
  hit: boolean;
  /** Seconds of game time covered before the sample that ended the sweep. */
  elapsed: number;
  snapshot: FloeSnapshot;
}

/**
 * What this case adds to the package's harness: the runtime's own state, the
 * coarse sweeps a cadence measured in tens of seconds is waited out with, and the
 * pointer path this game's menus are driven through.
 */
export interface FloeModel {
  /**
   * The runtime's current state, read fresh on every access. Read it, or pose it
   * through `debug`; nothing here can write to it.
   */
  readonly state: DeepReadonly<FloeState>;

  /** Run the whole ticks covering `duration` seconds of game time. */
  advanceSeconds(duration: number): Promise<void>;
  /**
   * Run `ticks` whole simulation ticks in COARSE frames.
   *
   * The tick-exact companion to {@link skip}, for a wait a check states in TICKS:
   * the coarse stretch runs whole {@link COARSE_TICKS} frames and the leftover
   * runs at one tick a frame, so exactly `ticks` ticks are spent. {@link skip} is
   * this over a duration in seconds, rounded the way {@link ticksFor} rounds.
   */
  skipTicks(ticks: number): Promise<void>;
  /**
   * Cover `duration` seconds of game time in COARSE frames, for waiting out a
   * cadence the specification measures in tens of seconds.
   *
   * The same ticks run — the simulation advances by the whole `TICK_DT` ticks a
   * frame's delta completes, which is what specs/overview.md fixes and what
   * `instrumentation/tick-length` decides — and only the pictures between them
   * are skipped. It leaves the clock at one tick a frame, so what follows
   * steps tick by tick again.
   *
   * Not for a measurement stated per frame or per picture: use
   * {@link advanceSeconds} where each frame has to be a tick.
   */
  skip(duration: number): Promise<void>;
  /** {@link skip} until `predicate` holds, sampling every `pollSeconds`. */
  skipUntil(
    predicate: (snapshot: FloeSnapshot) => boolean,
    options?: SkipOptions,
  ): Promise<SkipResult>;
  /** Put `ticksPerFrame` whole ticks in each frame from here on. */
  pace(ticksPerFrame: number): void;
  /** Drive the runtime's own frame loop for `ms` of real time, then halt it. */
  runFor(ms: number): Promise<void>;

  /**
   * Where a logical point lands in CSS pixels: the device point the fit puts it
   * at, divided back by the device pixel ratio.
   *
   * What a pointer or touch gesture is aimed with, because the engine reads a
   * device event's position in CSS pixels from the surface's own origin.
   */
  css(x: number, y: number): Point;
  /**
   * Dispatch one pointer-shaped event at the surface, at a LOGICAL stage point.
   *
   * The engine owns the pointer and listens on the same target its key listeners
   * go on (engine/input.md), so an event dispatched here drives the game exactly
   * as a player's mouse or finger does.
   */
  point(
    type: PointerEventType,
    x: number,
    y: number,
    device?: "mouse" | "touch",
  ): void;
}

/** Everything a check reads off one runtime running one build. */
export type Harness = EngineHarness<FloeSnapshot, FloeDriver, FloeEngine> &
  FloeModel;

/**
 * What the build owes when its surface is missing: the `Expected:` line of the
 * failure every check that reaches for the surface lands on, beside what
 * `engine.debug` was found holding instead.
 *
 * The case's own sentence rather than the package's, because where the surface
 * comes from is this runtime's business — beside the state, as a pair — and a
 * fault that misdescribed the return would send a reviewer to the wrong line of
 * the build.
 */
const SURFACE_REQUIREMENT =
  "the debug surface src/game.ts's initialize returns beside its state, as " +
  "[state, debug], which the engine hands back from engine.debug " +
  "(specs/instrumentation.md)";

/**
 * A `PointerEvent`-shaped event: the engine reads `clientX`, `clientY`,
 * `pointerId`, `pointerType`, `isPrimary`, `button` and `buttons` off one
 * (engine/input.md), and maps the client position into the game's own logical
 * coordinates through the inverse of the viewport it drew with.
 *
 * FLOE'S OWN SHAPE, AND NOT THE PACKAGE'S `DevicePointerEvent`, which is the same
 * event but for one field: it reports `button` `-1` on a MOVE, where this reports
 * `0` on every event of a gesture. A structured engine's pointer input reads
 * `button` and takes a different path for a move that names no button, so the two
 * are not interchangeable and this case's verdicts were taken under this one. See
 * the package README's collision table.
 */
class PointerDriveEvent extends Event {
  readonly clientX: number;
  readonly clientY: number;
  readonly pointerId = 1;
  readonly pointerType: string;
  readonly isPrimary = true;
  readonly button = 0;
  readonly buttons: number;

  constructor(
    type: PointerEventType,
    x: number,
    y: number,
    pointerType: "mouse" | "touch",
  ) {
    super(type);
    this.clientX = x;
    this.clientY = y;
    this.pointerType = pointerType;
    this.buttons = type === "pointerup" ? 0 : 1;
  }
}

/**
 * The directory this harness sits in, which is the validator project's root.
 *
 * Taken from this module's own URL rather than from the working directory,
 * because it has to name the same directory in both layouts this file lives in:
 * the case's own `validation/<engine>/`, and the `validation/` the runner stages
 * that directory to inside the build's tree. It may never be derived inside the
 * package, which is staged one level deeper than this file, or every produced
 * output would be addressed one directory too far down.
 */
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * The workspace this project is staged into, which is where `assets/` sits.
 *
 * The tree the build was handed, so the seeded art a check reads is exactly the
 * art the case seeded and the engine's loader resolves `assets/bear/0.png` to the
 * file the run was given.
 */
const WORKSPACE = dirname(PROJECT_ROOT);

/**
 * The package's runtime machinery, bound to Floe on this engine.
 *
 * Where the four engines differ, each is answered here from what THIS engine is:
 *
 *  - `driver` is the apply-threaded strategy, over `surface.ts`'s `READINGS`. It
 *    forwards a reading's own arguments past the state, which is what makes
 *    `menuItemRect(index)` reach the surface with the index the check asked about
 *    rather than about item zero.
 *  - `toLogical` is left at the identity. There is no camera under this runtime —
 *    it maps the stage onto the canvas and nothing else stands between.
 *  - `pointerPrecision` is `"device-pixel"`: a gesture lands on the pixel a
 *    reading would sample first, which is what this case's menu points were
 *    decided under.
 *  - `pointerEvent` is {@link PointerDriveEvent}, this case's own shape.
 */
const kit = createEngineCaseHarness<
  FloeSnapshot,
  FloeDriver,
  FloeEngine,
  FloeModel
>({
  slug: "floe",
  projectRoot: PROJECT_ROOT,
  stage: { width: STAGE_W, height: STAGE_H },
  tickHz: TICK_HZ,
  surfaceRequirement: SURFACE_REQUIREMENT,
  // The text readings below place a run about its anchor, so each text call is
  // measured and the transform in force at it is recorded off the real context.
  recorder: { measureText: true },
  defaultClock: () => new ConstantClock(TICK_MS),
  createEngine: ({ canvas, clock, surface }) =>
    createEngine<FloeState, FloeSurface>({
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
  driver: (engine, raw) =>
    applyDriver<DeepReadonly<FloeState>, FloeState, FloeDriver>(engine, raw, {
      readings: READINGS,
    }),
  snapshot: (debug) => debug.snapshot(),
  pointerPrecision: "device-pixel",
  pointerEvent: (type, x, y, device) =>
    new PointerDriveEvent(type, x, y, (device ?? "mouse") as "mouse" | "touch"),
  extend: (base, engine) => {
    const pace = (ticksPerFrame: number): void => {
      engine.setClock(new ConstantClock(TICK_MS * ticksPerFrame));
    };

    const skipTicks = async (ticks: number): Promise<void> => {
      const total = Math.max(0, Math.trunc(ticks));
      const coarse = Math.floor(total / COARSE_TICKS);
      if (coarse > 0) {
        pace(COARSE_TICKS);
        try {
          await base.advance(coarse);
        } finally {
          // In a `finally`, and outside the branch, so this always returns the
          // clock to one tick a frame — whatever the count was, and whether or
          // not the coarse stretch ran to the end.
          pace(1);
        }
      } else {
        pace(1);
      }
      await base.advance(total - coarse * COARSE_TICKS);
    };

    const skip = (duration: number): Promise<void> =>
      skipTicks(ticksFor(duration));

    return {
      get state() {
        return engine.state;
      },

      advanceSeconds: (duration: number) => base.advance(ticksFor(duration)),
      skipTicks,
      skip,
      pace,

      async skipUntil(
        predicate: (snapshot: FloeSnapshot) => boolean,
        options: SkipOptions = {},
      ) {
        const maxSeconds = options.maxSeconds ?? DEFAULT_SWEEP_SECONDS;
        const pollSeconds = Math.max(
          seconds(COARSE_TICKS),
          options.pollSeconds ?? DEFAULT_SKIP_POLL_SECONDS,
        );

        // The state as it stands is read first, so a sweep whose condition
        // already holds reports it without spending any game time.
        let snapshot = base.snapshot();
        if (predicate(snapshot)) return { hit: true, elapsed: 0, snapshot };

        let elapsed = 0;
        while (elapsed < maxSeconds) {
          const step = Math.min(pollSeconds, maxSeconds - elapsed);
          await skip(step);
          elapsed += step;
          snapshot = base.snapshot();
          if (predicate(snapshot)) return { hit: true, elapsed, snapshot };
        }
        return { hit: false, elapsed, snapshot };
      },

      async runFor(ms: number) {
        const controller = new AbortController();
        const running = engine.run({ signal: controller.signal });
        await new Promise((resolve) => setTimeout(resolve, ms));
        controller.abort();
        await running;
      },

      css: (x: number, y: number) => {
        const at = base.device(x, y);
        return { x: at.x / base.shape.dpr, y: at.y / base.shape.dpr };
      },
      point: (
        type: PointerEventType,
        x: number,
        y: number,
        device: "mouse" | "touch" = "mouse",
      ) => {
        base.pointer(type, x, y, device);
      },
    };
  },
});

/**
 * The workspace, served to the engine's loader for the life of each harness.
 *
 * ONE ROOT, AND THE ROOT ORDER IS STATED RATHER THAN DEFAULTED. specs/assets.md
 * seeds the art under `assets/` in the workspace itself, so a page-relative URL is
 * looked for there and nowhere else. The package's default would also look under
 * `public/` and `dist/`, which for this case are either absent or hold a STAGED
 * copy of the same tree — and a root order that answered from the second copy
 * would grade a build on a file it did not just produce, with nothing to say so.
 *
 * Installed and released per harness rather than once for the process, because
 * that is what this project has always done: the shim is what the HOST lacks
 * while a harness is alive, and `dispose` puts it back. The package's host counts
 * references, so two harnesses alive at once — a check that builds a second while
 * the first is still standing — share one installation and the globals go back
 * when the last one goes.
 */
function serveSeededAssets(): AssetHost {
  return installAssetHost({
    workspaceRoot: WORKSPACE,
    roots: ["."],
    // The honest answer a served page gives for a file that is not in the tree,
    // and what makes the engine announce `asset:failed` with a status.
    onMissing: "404",
    // The engine's loader decodes a fetched body through `createImageBitmap`,
    // which a bare Node process has none of.
    images: true,
    // The TYPE NAME is deliberately left alone. Defining `globalThis.ImageBitmap`
    // would change what the engine's own recorder captures into a replay — this
    // project has never defined it, and a replay is evidence rather than a
    // verdict, so nothing is gained by moving it here.
    nameImageBitmap: false,
    label: "floe",
  });
}

/**
 * Build a runtime over a canvas of the harness's own, initialize the build's game,
 * and hand back everything a check reads.
 *
 * The options the kit passes the factory above are the ones the seeded
 * `src/main.ts` passes — the design size, the build's exported `BACKGROUND`, and
 * the `dpad-4` layout — so one harness serves every build of this case. Everything
 * else the build decided lives inside `src/game.ts`.
 *
 * Dispose it in an `afterEach`, with `?.`, so a build whose `initialize` rejected
 * fails with the runtime's own message rather than with a teardown error on top
 * of it.
 */
export async function createHarness(
  options: HarnessOptions = {},
): Promise<Harness> {
  // Before the engine is built, because the build loads its sprite art inside
  // `initialize` and the kit runs that as part of building the harness.
  const host = serveSeededAssets();
  let harness: Harness;
  try {
    harness = await kit.createHarness(options);
  } catch (error) {
    host.uninstall();
    throw error;
  }
  boundDrawLog(harness.calls, MAX_RECORDED_CALLS);

  const release = harness.dispose.bind(harness);
  let disposed = false;
  return Object.defineProperty(harness, "dispose", {
    value: () => {
      if (disposed) return;
      disposed = true;
      release();
      host.uninstall();
    },
    writable: true,
    configurable: true,
  });
}

/* -------------------------------------------------------------------------- */
/* Evidence capture                                                           */
/* -------------------------------------------------------------------------- */
//
// A review item declares its OUTPUTS beside its verdict: a `replay` — the frames
// the build itself drew while a check drove it, kept as evidence a reviewer can
// scrub against the reference implementation's — or an `image`, one frame of it.
// Both writers are the package's, bound here to this case's slug and to THIS
// directory, because the project root may never be derived inside the package.
//
// Four properties are what make them usable, and each is deliberate:
//
// 1. THEY RECORD THE SECTION, NOT THE RUN. The recorder is armed around the
//    caller's scenario and disarmed the moment that scenario returns, so what is
//    kept is the part the check is ABOUT and never the setup that got there. A
//    check that poses a bear beside the critter and then releases it records the
//    lunge; the pose costs nothing, and the reviewer is not asked to scrub past a
//    minute of arrangement to reach the second that decides the point.
//    ARM IT NARROWLY. A Floe frame redraws five bands, sixteen lanes of items and
//    the HUD, and the recorder holds 16 MB of captured image bytes before new
//    captures degrade to an opaque marker, so a recording armed around a whole
//    scenario buys a reviewer nothing and can cost the frames the check was about.
// 2. THEY ARE EVIDENCE, NEVER A VERDICT. The scenario's own value comes straight
//    back, so a check reads it exactly as it did before capture existed, and a
//    scenario that THROWS still writes what it had recorded before the failure
//    travels on — a failing check is the one whose replay a reviewer most wants.
// 3. THEY WRITE ONLY WHAT THERE IS TO LOOK AT. A capture that closed no frames
//    leaves no file, so the run reports the output absent instead of offering the
//    reviewer a replay of nothing.
// 4. THEY COST NOTHING WHEN NOBODY IS COLLECTING. Outside a run — a developer
//    running this suite from a shell — the media directory is unset, and the whole
//    thing is a no-op that still runs the scenario.

/**
 * Record the frames `scenario` draws and keep them as the review item's
 * `outputId` output, handing back whatever the scenario returned.
 *
 * Wrap the drive, not the arrangement:
 *
 * ```ts
 * const swept = await captureReplay(h, "catch", () =>
 *   h.until((s) => s.lives < 3, { maxFrames: 600 }),
 * );
 * assertTrue(swept.hit);
 * ```
 *
 * The assertions stay exactly where they were and read exactly what they did.
 */
export const captureReplay = makeReplayCapture("floe", PROJECT_ROOT);

/**
 * Keep the frame currently on the canvas as the review item's `outputId` output.
 *
 * The companion to {@link captureReplay}, for a point whose evidence is one
 * PICTURE rather than a stretch of motion: the strait a level laid out, which
 * screen the game opened on, what the HUD read. A recording of a still strait
 * would be the same frame three hundred times over.
 *
 * What is written is whatever the last frame that RAN left behind, so call it
 * after the frame that poses the thing under test — an `advance(1)` following the
 * arrangement — and before the assertions, so a check that fails still leaves the
 * picture that shows why.
 */
export const captureStill = kit.captureStill;

/* -------------------------------------------------------------------------- */
/* Reading a snapshot                                                         */
/* -------------------------------------------------------------------------- */
//
// The snapshot is plain data, so most readings are a field access and belong in
// the check that makes them. What is here is the handful a check would otherwise
// write out every time: the tile map both ways, the covering rule, which band a
// row belongs to, and finding an entity by the id a pose handed back.
//
// EVERY LOOK-UP BY ID FAILS RATHER THAN RETURNING NOTHING. A check holds an id
// because a pose put an entity on the strait and the snapshot reported it; an id
// that is no longer there is the build having lost the entity, which is a verdict
// and not an absent value for the check to reason about. So these fail by
// assertion, naming what the surface promised, and the check reads the entity on
// the next line.

/** The tile a reported center stands on (specs/strait.md's `colAt`/`rowAt`). */
export function tileOf(x: number, y: number): Tile {
  return { col: colAt(x), row: rowAt(y) };
}

/** A tile's CENTER in stage units (specs/strait.md's `tileCX`/`tileCY`). */
export function tileCenter(col: number, row: number): Point {
  return { x: tileCX(col), y: tileCY(row) };
}

/** Whether two tiles are the same tile. */
export function sameTile(a: Tile, b: Tile): boolean {
  return a.col === b.col && a.row === b.row;
}

/** A tile as `"col,row"`, for a set comparison or a failure message. */
export function tileKey(tile: Tile): string {
  return `${tile.col},${tile.row}`;
}

/** Whether a tile lies on the strait at all (specs/strait.md's `inBounds`). */
export function onStrait(col: number, row: number): boolean {
  return col >= 0 && col < COLS && row >= 0 && row < ROWS;
}

/** The five bands of specs/strait.md, plus the two far-shore rows above them. */
export type Band = "cap" | "bays" | "water" | "median" | "ice" | "near" | "off";

/**
 * Which band a strait row belongs to (specs/strait.md's table).
 *
 * `"off"` for a row outside the strait. The bay row and the cap are named apart
 * because they behave differently: the cap is solid across its whole width and the
 * bay row is solid except at the five bays.
 */
export function bandOf(row: number): Band {
  if (row === ROW_CAP) return "cap";
  if (row === ROW_BAYS) return "bays";
  if (row >= WATER_TOP && row <= WATER_BOTTOM) return "water";
  if (row === ROW_MEDIAN) return "median";
  if (row >= ICE_TOP && row <= ICE_BOTTOM) return "ice";
  if (row === ROW_NEAR) return "near";
  return "off";
}

/** Whether the row is one of the eight ice lanes. */
export function isIceRow(row: number): boolean {
  return bandOf(row) === "ice";
}

/** Whether the row is one of the eight water lanes. */
export function isWaterRow(row: number): boolean {
  return bandOf(row) === "water";
}

/** The bay a column of the bay row belongs to, or `null` for solid far shore. */
export function bayAt(col: number): number | null {
  const index = BAYS.findIndex((pair) => pair[0] === col || pair[1] === col);
  return index === -1 ? null : index;
}

/** A lane item: what the covering rule and the span helpers below need of one. */
export interface LaneItem {
  row: number;
  /** The LEFT EDGE, in stage units. */
  x: number;
  /** Its length in tiles. */
  len: number;
}

/** An item's span in stage units: it covers `[left, right)` (specs/ice.md). */
export function spanOf(item: LaneItem): { left: number; right: number } {
  return { left: item.x, right: item.x + TILE * item.len };
}

/** Whether the item covers the point `x` on its own row (specs/ice.md). */
export function coversX(item: LaneItem, x: number): boolean {
  return x >= item.x && x < item.x + TILE * item.len;
}

/** Whether the item covers a tile of its row — that is, the tile's center. */
export function coversTile(item: LaneItem, col: number): boolean {
  return coversX(item, tileCX(col));
}

/** Every item of `row`, ordered by left edge ascending. */
export function itemsInRow<T extends LaneItem>(
  items: readonly T[],
  row: number,
): T[] {
  return items.filter((item) => item.row === row).sort((a, b) => a.x - b.x);
}

/**
 * The clear runs between consecutive items, in TILES, for items already ordered
 * by left edge.
 *
 * One entry per adjacent pair, so `n` items give `n - 1` gaps: the distance from
 * one item's right edge to the next item's left edge, divided by `TILE`. The wrap
 * is deliberately NOT among them — a lane's population reaches past both edges of
 * the strait, so the pair that straddles the edge is a fact about the lane's cycle
 * rather than about the strait, and a check that reads it says so itself.
 */
export function gapsBetween(items: readonly LaneItem[]): number[] {
  const gaps: number[] = [];
  for (let i = 1; i < items.length; i += 1) {
    gaps.push((items[i].x - spanOf(items[i - 1]).right) / TILE);
  }
  return gaps;
}

/** The lane at `row`, ice band or water band. Fails where there is none. */
export function laneAt(snapshot: FloeSnapshot, row: number): LaneSnapshot {
  const found =
    snapshot.iceLanes.find((lane) => lane.row === row) ??
    snapshot.waterLanes.find((lane) => lane.row === row);
  assertTruthy(
    found,
    `snapshot() must report a lane at row ${row}: the ice band is rows ` +
      `${ICE_TOP}-${ICE_BOTTOM} and the water band rows ${WATER_TOP}-` +
      `${WATER_BOTTOM} (specs/strait.md)`,
  );
  return found as LaneSnapshot;
}

/** The critter's tile, as the snapshot reports it. */
export function critterTile(snapshot: FloeSnapshot): Tile {
  return { col: snapshot.critter.col, row: snapshot.critter.row };
}

/** The bear with that id. Fails the check if the roster no longer holds it. */
export function bearOf(snapshot: FloeSnapshot, id: number): BearSnapshot {
  const found = snapshot.bears.find((bear) => bear.id === id);
  assertTruthy(
    found,
    `snapshot() must report the bear with id ${id}: an entity added through ` +
      "the surface keeps its id until something removes it " +
      "(specs/instrumentation.md)",
  );
  return found as BearSnapshot;
}

/** The last bear in the roster, which is the one an `addBear` appended. */
export function lastBear(snapshot: FloeSnapshot): BearSnapshot {
  const found = snapshot.bears[snapshot.bears.length - 1];
  assertTruthy(
    found,
    "snapshot() must report the bear addBear appended to the roster " +
      "(specs/instrumentation.md)",
  );
  return found;
}

/** The vehicle with that id. Fails the check if the roster no longer holds it. */
export function vehicleOf(snapshot: FloeSnapshot, id: number): VehicleSnapshot {
  const found = snapshot.vehicles.find((item) => item.id === id);
  assertTruthy(
    found,
    `snapshot() must report the vehicle with id ${id}: an entity added ` +
      "through the surface keeps its id until something removes it " +
      "(specs/instrumentation.md)",
  );
  return found as VehicleSnapshot;
}

/** The last vehicle in the roster, which is the one an `addVehicle` appended. */
export function lastVehicle(snapshot: FloeSnapshot): VehicleSnapshot {
  const found = snapshot.vehicles[snapshot.vehicles.length - 1];
  assertTruthy(
    found,
    "snapshot() must report the vehicle addVehicle appended to the roster " +
      "(specs/instrumentation.md)",
  );
  return found;
}

/** The floe with that id. Fails the check if the roster no longer holds it. */
export function floeOf(snapshot: FloeSnapshot, id: number): FloeItemSnapshot {
  const found = snapshot.floes.find((item) => item.id === id);
  assertTruthy(
    found,
    `snapshot() must report the floe with id ${id}: an entity added through ` +
      "the surface keeps its id until something removes it " +
      "(specs/instrumentation.md)",
  );
  return found as FloeItemSnapshot;
}

/** The last floe in the roster, which is the one an `addFloe` appended. */
export function lastFloe(snapshot: FloeSnapshot): FloeItemSnapshot {
  const found = snapshot.floes[snapshot.floes.length - 1];
  assertTruthy(
    found,
    "snapshot() must report the floe addFloe appended to the roster " +
      "(specs/instrumentation.md)",
  );
  return found;
}

/* -------------------------------------------------------------------------- */
/* Scenario helpers                                                           */
/* -------------------------------------------------------------------------- */
//
// Each of these poses a situation through the debug surface and then lets the real
// simulation run. THEY FIX ONLY GEOMETRY: which tile a bear stands on, which
// column a vehicle's left edge sits at, where the critter is parked. Every
// threshold a check asserts is stated in the check itself, derived from the figure
// specs/ fixes for it, because a helper that carried the tolerance would hide what
// the check is really asserting.
//
// The debug surface is atomic by design (specs/instrumentation.md), so every
// compound sequence lives here. A check that needs all of a sequence calls the
// helper; a check that needs only part of it calls the operations it needs.
// Nothing a check does not ask for happens.

/**
 * Open live play on an EMPTY, QUIET strait at `level`, with the critter on the
 * near shore at `START_COL`.
 *
 * This is the ground almost every check in this suite stands on, and every part of
 * it is load-bearing.
 *
 * THE ORDER IS LOAD-BEARING: THE LEVEL IS SET BEFORE THE STRAIT IS CLEARED.
 * `setLevel` re-lays the sixteen lanes by design, because a level IS its lane
 * speeds and gaps (specs/instrumentation.md). A `setLevel` call AFTER
 * `clearVehicles()` and `clearFloes()` would put sixteen lanes of traffic straight
 * back onto the strait the clears just emptied, and every check staged on this
 * helper would run beside bystander traffic it never asked for. Taking the level
 * as an argument is what makes that impossible to get wrong check by check.
 *
 * AN ITEM THAT CHANGES LEVEL AFTER POSING CARRIES THE SAME TRAP AND HANDLES IT
 * ITSELF. Unless the level's own layout is the thing the check reads, a
 * `h.debug.setLevel(n)` is followed by `h.debug.clearVehicles()` and
 * `h.debug.clearFloes()` again.
 *
 * EMPTY is safe because of the level-clear rule: a level clears on the hop that
 * fills the last open bay, so a strait whose bays were posed rather than hopped
 * into never clears (specs/bays.md). A check therefore poses exactly the entities
 * its requirement concerns and nothing else.
 *
 * QUIET is the four world gates. With `bearEmergence`, `catchTest`, `fishCadence`
 * and `timerRunning` all off, nothing the scenario did not ask for arrives,
 * catches, scores or expires — and each of the four would otherwise reach in. A
 * bear emerges into every scenario that runs past `BEAR_EMERGE_DELAY` with the
 * critter three rows up; a posed bear pursues, so a long hunter scenario ends in a
 * catch that empties the strait and costs a life; a bonus catch appearing in the
 * bay a scoring check aims at silently adds `SCORE_BONUS_CATCH`; and a scenario
 * that runs thirty seconds of game time expires the crossing timer and kills the
 * critter.
 *
 * TURNING A GATE BACK ON IS THE EXCEPTION, AND THE CHECK THAT DOES IT IS THE CHECK
 * WHOSE REQUIREMENT THE GATE IS — the emergence items for `setBearEmergence`, the
 * catch and catch-cost items for `setCatchTest`, the bonus-catch cadence items for
 * `setFishCadence`, and the timer-drain items for `setTimerRunning`. Any other
 * check that finds itself needing one has been mis-posed; re-pose it.
 *
 * It poses and returns; it runs no frame. A check advances the frames its own
 * reading needs.
 */
export function startCrossing(h: Harness, level = 1): void {
  h.debug.reset();
  h.debug.setLevel(level);

  h.debug.clearVehicles();
  h.debug.clearFloes();
  h.debug.clearBears();
  h.debug.clearBays();
  h.debug.clearFish();

  h.debug.setBearEmergence(false);
  h.debug.setCatchTest(false);
  h.debug.setFishCadence(false);
  h.debug.setTimerRunning(false);

  h.debug.setScreen("playing");
  h.debug.setPhase("crossing");
  h.debug.setPhaseTimer(0);

  h.debug.setLives(START_LIVES);
  h.debug.setScore(0);
  h.debug.setTimer(crossingTimer(level));

  h.debug.addCritter(START_COL, ROW_NEAR);
}

/** The three kinds the ice band carries (specs/ice.md). */
export const VEHICLE_KINDS: readonly VehicleKind[] = ["plow", "dogsled", "car"];

/** The three kinds the water band carries (specs/water.md). */
export const FLOE_KINDS: readonly FloeKind[] = ["pan", "raft3", "raft4"];

/** Whether `kind` is one the ice band carries. */
export function isVehicleKind(kind: string): kind is VehicleKind {
  return (VEHICLE_KINDS as readonly string[]).includes(kind);
}

/**
 * Park a lane and lay `cols` items of `kind` along it, one left edge per column,
 * and report their ids in the order given.
 *
 * The lane is set to speed `0` FIRST, so the items stay exactly where they are put
 * and a check reads the geometry it posed rather than the geometry plus however
 * many frames it advanced. A check about how a lane MOVES releases it afterwards
 * with `h.debug.setLaneSpeed(row, s)` — which repopulates nothing, so the layout
 * survives.
 *
 * Which roster the items join is the ROW's band, not the kind's: the ice band
 * takes vehicles and the water band floes (specs/strait.md). A kind that does not
 * belong to the row's band is a mis-posed scenario and fails here rather than
 * silently landing in the other roster.
 *
 * `x` is a LEFT EDGE, so an item posed at column `c` covers `[tileLeft(c),
 * tileLeft(c) + 32 * len)` — the `len` tiles from `c` rightward.
 */
export function poseLane(
  h: Harness,
  row: number,
  kind: VehicleKind | FloeKind,
  cols: readonly number[],
): number[] {
  const band = bandOf(row);
  const vehicle = isVehicleKind(kind);
  if (vehicle ? band !== "ice" : band !== "water") {
    fail(
      `a ${vehicle ? "vehicle" : "floe"} lane, which is ` +
        `${vehicle ? "the ice band" : "the water band"} (specs/strait.md)`,
      `row ${row}, which is ${band === "off" ? "off the strait" : `the ${band}`}`,
    );
  }

  h.debug.setLaneSpeed(row, 0);
  const ids: number[] = [];
  for (const col of cols) {
    if (vehicle) {
      h.debug.addVehicle(row, kind, tileLeft(col));
      ids.push(lastVehicle(h.snapshot()).id);
    } else {
      h.debug.addFloe(row, kind as FloeKind, tileLeft(col));
      ids.push(lastFloe(h.snapshot()).id);
    }
  }
  return ids;
}

/** Which of a bear's three faculties a scenario holds off. Omitted means on. */
export interface BearFaculties {
  /** Its reading of the critter's tile. */
  sense?: boolean;
  /** Its choice of the next step. */
  routing?: boolean;
  /** Its locomotion. */
  travel?: boolean;
}

/**
 * Pose one bear settled on tile `(col, row)`, and report its id.
 *
 * `addBear` gives it all three faculties on, its target its own tile and its
 * facing `up`; each entry of `faculties` set to `false` turns that one off. The
 * three are what let a check pose the isolation its requirement needs:
 *
 * - A check on where the ROUTING sends a bear runs with `travel: false`, so the
 *   committed step is read with nothing moving.
 * - A check on how fast a bear TRAVELS runs with `routing: false` and one
 *   `setBearStep`, so the reading is a rate and not a route.
 * - A check on a bear as a pure OBSTACLE runs with all three off.
 *
 * It poses and returns; it runs no frame.
 */
export function poseBear(
  h: Harness,
  col: number,
  row: number,
  faculties: BearFaculties = {},
): number {
  h.debug.addBear(col, row);
  const id = lastBear(h.snapshot()).id;
  if (faculties.sense === false) h.debug.setBearSense(id, false);
  if (faculties.routing === false) h.debug.setBearRouting(id, false);
  if (faculties.travel === false) h.debug.setBearTravel(id, false);
  return id;
}

/* ---- Driving the keyboard -------------------------------------------------- */

/**
 * Every key bound to an action (`BINDINGS` in `constants.ts`,
 * specs/controls.md).
 *
 * A check about a particular binding names the `KeyboardEvent.code` itself —
 * that is the whole of what `controls/key-w` decides — and reads this table only
 * to say which action the key it named is supposed to drive.
 */
export function keysFor(action: ActionName): readonly string[] {
  return BINDINGS[action];
}

/**
 * The first key bound to a direction, which is the arrow key.
 *
 * What a scenario that needs to MOVE the critter presses, when which key it
 * pressed is not the thing under test.
 */
export function keyFor(direction: Facing): string {
  return BINDINGS[direction][0];
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
 * Whole frames covering `HOP_COOLDOWN`: the cadence a hop is spent at.
 *
 * `HOP_COOLDOWN` (`0.12` s) is `14.4` ticks, which no whole number of ticks
 * reaches exactly, so the cooldown is spent on the FIFTEENTH tick — the first at
 * which none of it is left (specs/hopping.md).
 */
export const HOP_COOLDOWN_TICKS = ticksFor(HOP_COOLDOWN);

/**
 * Hop the critter one tile with a real key press, and leave the cooldown spent.
 *
 * One tap, one frame — which is the frame that delivers the press edge, and so
 * the tick that takes the hop — then `HOP_COOLDOWN_TICKS` frames with NO key held,
 * which runs the cooldown out without offering a second hop. So exactly one hop
 * happens, and the critter is free to hop again when this returns.
 *
 * `1 + HOP_COOLDOWN_TICKS` frames of game time pass, during which every released
 * lane moves and every posed bear travels. A check that needs a hop and NOTHING
 * else moving parks the lanes it posed with {@link poseLane} and holds the bears
 * it posed with `travel: false`.
 */
export async function hop(h: Harness, direction: Facing): Promise<void> {
  await h.tap(keyFor(direction));
  await h.advance(HOP_COOLDOWN_TICKS);
}

/**
 * Hop the critter to tile `(col, row)` with real key presses, sideways first and
 * then up or down.
 *
 * This is the ONE way a check reaches a tile by playing the game. A scenario that
 * merely needs the critter somewhere poses it with `addCritter` or
 * `setCritterTile` directly and costs no game time at all; `crossTo` exists for
 * the checks whose requirement IS the hopping — the row-advance award, the best-row
 * bookkeeping, a bay filled by entering it.
 *
 * Sideways first, then vertically, because the row a crossing starts on is solid
 * footing across its whole width: travelling along it and then climbing keeps the
 * critter out of the water for as long as the path allows. A check that needs a
 * particular path drives {@link hop} itself.
 *
 * Every rule the game applies to a hop applies here. A hop the rules refuse moves
 * nothing (specs/hopping.md), so this can leave the critter short of the tile
 * asked for — which is the honest outcome, and the check reads where it actually
 * ended up rather than being told it arrived.
 */
export async function crossTo(
  h: Harness,
  col: number,
  row: number,
): Promise<void> {
  const steps = (): Tile => critterTile(h.snapshot());

  for (let guard = 0; guard < COLS; guard += 1) {
    const at = steps();
    if (at.col === col) break;
    await hop(h, at.col < col ? "right" : "left");
    if (steps().col === at.col) break; // The hop was refused; go no further.
  }
  for (let guard = 0; guard < ROWS; guard += 1) {
    const at = steps();
    if (at.row === row) break;
    await hop(h, at.row > row ? "up" : "down");
    if (steps().row === at.row) break;
  }
}

/**
 * Run exactly one frame and hand back the calls THAT frame made.
 *
 * The reading every rendering check opens with. `Harness.calls` accumulates
 * across frames, so what a check about the picture wants is the frame it just
 * drove and not the setup before it.
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
// on, a way to ask what a single frame's render put where, the seeded art to hold
// a drawn sprite against, and a pixel sampler over the rendered canvas. THE
// PALETTE IS THE BUILD'S — specs/overview.md fixes no colour, no typeface and no
// HUD layout, and whether a player can tell two things apart is the reviewer's to
// judge — so nothing here knows a colour, and the samplers exist to answer
// presence: whether what was painted at a point changed.

/* ---- Cues ----------------------------------------------------------------- */

/**
 * Record every cue the build plays from now on, stamped with its frame.
 *
 * The runtime publishes `cue:played` synchronously from inside `audio.play`, so
 * the handler runs while the frame that played it is still running and
 * `engine.frame().count` is that frame's own number. That is what lets a check
 * assert not merely that a cue sounded but that it sounded on the frame of the
 * event — which is what tells a build that plays a cue on the right event apart
 * from one that plays it on every frame, or a frame late.
 *
 * The cue NAMES are `CUES` in `constants.ts`; specs/ui.md says which event
 * each one belongs to.
 */
export const watchCues = kit.watchCues;

/* ---- Text ----------------------------------------------------------------- */

/** Every string the frame drew, through `fillText` or `strokeText`. */
export function drawnText(calls: readonly DrawCall[]): string[] {
  return rawDrawnText(calls);
}

/**
 * Whether the frame drew `text` as part of some RAW run of text, ignoring case.
 *
 * Substring rather than equality on purpose: the copy a check asserts is the
 * case's own, but how a build presents it is the build's, and a menu entry is
 * commonly drawn with a selection marker or padding around it. Requiring the exact
 * run would fail a screen that shows precisely the right words.
 *
 * A DIFFERENT QUESTION FROM THE PACKAGE'S `drewText`, which reads off the LOGICAL
 * runs the frame spells rather than off the calls that spelled them: a heading
 * letter-spaced a glyph per `fillText` is one string there and many here. Every
 * screen-copy reading in this project is taken over the runs already — see
 * `screens/screens.ts`, which walks {@link drawnTextSpans} — so this stays the raw
 * reading it has always been, under this case's own name.
 */
export function drewText(calls: readonly DrawCall[], text: string): boolean {
  const wanted = text.trim().toLowerCase();
  return drawnText(calls).some((drawn) => drawn.toLowerCase().includes(wanted));
}

/** One run of text a frame drew, and the logical box its glyphs span. */
export type TextSpan = TextDraw;

/**
 * Every run of text `calls` drew, placed in logical units, ONE PER CALL.
 *
 * A build may anchor its text through any `translate`/`scale` it likes and align
 * it any way it likes, so the anchor is mapped through the transform the context
 * held at the call and the run is extended about it by its measured width and
 * `textAlign`. Which way a `start`/`end` alignment reads is the page's direction;
 * this game draws no right-to-left text, so they are left and right.
 *
 * This is what the HUD items read: `strait/hud-above-strait` holds every span's
 * `y` inside `[0, HUD_H]`, and each `presentation/hud-*` item finds the readout it
 * is about among them.
 */
export function drawnTextSpans(
  h: Harness,
  calls: readonly DrawCall[] = h.calls,
): TextSpan[] {
  return allInLogical(h.viewport(), textDraws(calls));
}

/* ---- The diagnostics overlay ---------------------------------------------- */

/**
 * Toggle the engine's diagnostics overlay and run the frame that draws — or
 * stops drawing — it.
 *
 * The overlay is ENGINE CHROME under this engine: `Backquote` reaches it through
 * a `keydown` listener the engine itself owns on the harness's event target,
 * outside the action registry the game registers into, so this is the same
 * gesture a player makes and not a call into anything the build wrote
 * (specs/controls.md, specs/instrumentation.md). The engine ignores an
 * auto-repeat, so one toggle is one press.
 *
 * The panel is drawn after `render` returns, through the same context this
 * harness records — so with the overlay up, the registered sources' lines land in
 * `Harness.calls` as ordinary text draws, readable with {@link drawnText} — but
 * AFTER the engine recorder's bracket has closed, so none of it appears in a
 * {@link captureReplay} recording. Overlay evidence is captured with
 * {@link captureStill}.
 */
export async function toggleOverlay(h: Harness): Promise<void> {
  h.hold("Backquote");
  h.release("Backquote");
  await h.advance(1);
}

/* ---- Where a frame put its sprites ---------------------------------------- */

/** The source rectangle a nine-argument `drawImage` named, in source pixels. */
export interface SourceRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** One `drawImage` a frame made, placed in logical units. */
export interface DrawnImage {
  /** The image the build handed the context: the frame it drew from. */
  source: unknown;
  /** The destination box's CENTER, in logical units. */
  x: number;
  y: number;
  /** The destination box's size, in logical units, always positive. */
  w: number;
  h: number;
  /** The destination box's top-left corner, in logical units. */
  left: number;
  top: number;
  /** The build drew it flipped, which is how a leftward vehicle is mirrored. */
  mirrored: boolean;
  /**
   * The part of the source the call named, or `null` where it drew the whole
   * image.
   *
   * specs/assets.md puts the THREE-TILE raft in the left `96 x 32` of
   * `assets/raft/0.png` and the four-tile raft in the whole of `raft/1.png`, so a
   * `presentation/sprite-raft3` check reads both which frame was drawn from — by
   * {@link identifySprite} — and that this is `{ sx: 0, sy: 0, sw: 96, sh: 32 }`.
   */
  sourceRect: SourceRect | null;
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
 * Every `drawImage` in `calls`, with its destination box mapped into logical
 * units.
 *
 * A build draws a lane item by translating to its edge and drawing the frame about
 * the origin — and mirrors a leftward one by translating to its RIGHT edge and
 * scaling by `-1` — so the call's own arguments say nothing about where the sprite
 * landed. The destination box's center is taken through the transform in force at
 * the call ({@link imageCalls}) and then back through the engine's fit, so what
 * comes out is the point on the stage a check can hold against a reported center
 * or left edge — which is how a draw is attributed to the critter, bear, vehicle
 * or floe it was drawn for.
 *
 * All three argument forms are read: `(image, dx, dy)`, `(image, dx, dy, dw, dh)`,
 * and the nine-argument form with a source rectangle, which is reported as
 * {@link DrawnImage.sourceRect}.
 */
export function drawnImages(
  h: Harness,
  calls: readonly DrawCall[] = h.calls,
): DrawnImage[] {
  const view = h.viewport();
  const drawn: DrawnImage[] = [];
  for (const { args, transform: m } of imageCalls(calls)) {
    const [source, ...rest] = args;

    let box: [number, number, number, number] | null = null;
    let sourceRect: SourceRect | null = null;
    if (rest.length >= 8) {
      const [sx, sy, sw, sh] = rest.slice(0, 4) as [
        number,
        number,
        number,
        number,
      ];
      if ([sx, sy, sw, sh].every((value) => typeof value === "number")) {
        sourceRect = { sx, sy, sw, sh };
      }
      box = rest.slice(4, 8) as [number, number, number, number];
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
    const lx = dx + dw / 2;
    const ly = dy + dh / 2;
    const deviceX = m[0] * lx + m[2] * ly + m[4];
    const deviceY = m[1] * lx + m[3] * ly + m[5];
    const x = (deviceX - view.offsetX) / view.scale;
    const y = (deviceY - view.offsetY) / view.scale;
    const w = Math.abs(dw * Math.hypot(m[0], m[1])) / view.scale;
    const height = Math.abs(dh * Math.hypot(m[2], m[3])) / view.scale;
    drawn.push({
      source,
      x,
      y,
      w,
      h: height,
      left: x - w / 2,
      top: y - height / 2,
      // A flip, whichever of the two ways the build wrote it: a negative
      // determinant in the transform it drew under, or a negative destination
      // extent in the call itself. Both reverse the mapped box, and a build is
      // free to mirror a leftward vehicle either way (specs/assets.md).
      mirrored: (m[0] * m[3] - m[1] * m[2]) * Math.sign(dw) * Math.sign(dh) < 0,
      sourceRect,
    });
  }
  return drawn;
}

/**
 * Every `drawImage` whose destination box is centred within `tolerance` logical
 * units of `(x, y)`.
 *
 * The reading a sprite check makes: the critter, a bear and a floe are all on the
 * strait at once, and what a check about one of them wants is the draw made FOR
 * it. The centre a body reports is the point to hold against
 * (specs/instrumentation.md), and a tolerance is what the check chooses.
 */
export function drawnAt(
  images: readonly DrawnImage[],
  x: number,
  y: number,
  tolerance: number,
): DrawnImage[] {
  return images.filter(
    (image) =>
      Math.abs(image.x - x) <= tolerance && Math.abs(image.y - y) <= tolerance,
  );
}

/* ---- The seeded art ------------------------------------------------------- */

/** Every folder under `assets/`, and how many frames each holds (specs/assets.md). */
export const SPRITE_FOLDERS = {
  crosser: CROSSER_FRAMES,
  bear: BEAR_FRAMES,
  plow: PLOW_FRAMES,
  dogsled: DOGSLED_FRAMES,
  car: CAR_FRAMES,
  pan: PAN_FRAMES,
  raft: RAFT_FRAMES,
} as const;

export type SpriteFolder = keyof typeof SPRITE_FOLDERS;

/**
 * specs/assets.md's frame tables, named once so three checks cannot each
 * transcribe them differently.
 *
 * These are the case's own tables and nothing else: which frames a facing's pair
 * is, which set a state draws from. What a check asserts — that the frame drawn
 * for a bear facing left while swimming is one of `BEAR_SWIM_FRAMES.left` — is
 * still stated in the check.
 */
export const CROSSER_FRAMES_BY_FACING: Readonly<
  Record<Facing, readonly [number, number]>
> = {
  down: [0, 1],
  up: [2, 3],
  left: [4, 5],
  right: [6, 7],
};

export const BEAR_RUN_FRAMES: Readonly<
  Record<Facing, readonly [number, number]>
> = {
  down: [0, 1],
  up: [2, 3],
  left: [4, 5],
  right: [6, 7],
};

export const BEAR_SWIM_FRAMES: Readonly<
  Record<Facing, readonly [number, number]>
> = {
  down: [8, 9],
  up: [10, 11],
  left: [12, 13],
  right: [14, 15],
};

/** The lunge pair, drawn for the bear that catches the critter, any facing. */
export const BEAR_LUNGE_FRAMES: readonly [number, number] = [16, 17];

/** One seeded frame, as the comparison reads it. */
export interface SeededFrame {
  folder: SpriteFolder;
  index: number;
  width: number;
  height: number;
  /** Premultiplied RGBA, four channels per pixel. */
  pixels: Float64Array;
}

/**
 * How far a drawn source's pixels may sit from a seeded frame's, as a mean
 * absolute difference over premultiplied RGBA channels, out of `255`.
 *
 * The requirement is IDENTITY — the source IS the seeded frame — so this is not a
 * likeness tolerance. It is room for the one lossy step in reading a bitmap back
 * out of a canvas: a partially transparent pixel is premultiplied on the way in
 * and un-premultiplied on the way out, so it can shift by a unit. Comparing on
 * premultiplied channels removes even that, and a different frame of the SAME
 * folder measures several times this.
 */
export const SPRITE_MATCH_MAX = 1;

/** A drawable source's premultiplied RGBA channels, rasterized at its own size. */
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

/** Read once, because every presentation check reads the same thirty-two files. */
let seeded: Promise<SeededFrame[]> | null = null;

/**
 * Every frame of the seeded art, read off the workspace's own `assets/` tree.
 *
 * The same tree the build was handed, so a match is against exactly the art the
 * case seeded rather than against a copy of it (specs/assets.md).
 */
export function seededFrames(): Promise<SeededFrame[]> {
  // A read that failed is NOT kept: a memoised rejection would answer every later
  // check with the first one's error, long after whatever caused it.
  seeded ??= readSeededFrames().catch((error: unknown) => {
    seeded = null;
    throw error;
  });
  return seeded;
}

/** Every seeded frame, read off disk and rasterized once. */
async function readSeededFrames(): Promise<SeededFrame[]> {
  const frames: SeededFrame[] = [];
  for (const folder of Object.keys(SPRITE_FOLDERS) as SpriteFolder[]) {
    for (let index = 0; index < SPRITE_FOLDERS[folder]; index += 1) {
      const bytes = readFileSync(
        join(WORKSPACE, "assets", folder, `${index}.png`),
      );
      const raster = await rasterize(await loadImage(bytes));
      if (raster === null) continue;
      frames.push({ folder, index, ...raster });
    }
  }
  return frames;
}

/** Which seeded frame a drawn source is, or `null` where it is none of them. */
export interface SpriteMatch {
  folder: SpriteFolder;
  index: number;
  /** The mean absolute channel difference the match was made at. */
  difference: number;
}

/**
 * Identify the seeded frame a build drew from, or `null` where it drew from
 * something else.
 *
 * The reading is the IMAGE SOURCE ITSELF rather than the pixels on the stage: the
 * bitmap the build handed the context is rasterized and held against the seeded
 * PNGs. A source that IS a seeded frame matches it exactly; anything else — a
 * canvas the build painted, art of its own, a recoloured copy — does not. That is
 * what tells a build drawing the game from the seeded art apart from one drawing
 * convincing shapes in code, which is the whole point of the sprite items.
 *
 * It identifies the whole image, so a call that drew PART of one — the three-tile
 * raft, which is the left `96 x 32` of `assets/raft/0.png` — still matches
 * `raft` frame `0`, and which part was drawn is
 * {@link DrawnImage.sourceRect}.
 *
 * Pass `frames` where a check makes many comparisons: reading and rasterizing the
 * seeded art is the expensive half, and `seededFrames()` hands back the same list
 * every time.
 */
export async function identifySprite(
  source: unknown,
  frames?: readonly SeededFrame[],
): Promise<SpriteMatch | null> {
  const sheet = frames ?? (await seededFrames());
  const raster = await rasterize(source);
  if (raster === null) return null;
  let best: SpriteMatch | null = null;
  for (const frame of sheet) {
    if (frame.width !== raster.width || frame.height !== raster.height)
      continue;
    const difference = meanDifference(raster.pixels, frame.pixels);
    if (best === null || difference < best.difference) {
      best = { folder: frame.folder, index: frame.index, difference };
    }
  }
  return best !== null && best.difference <= SPRITE_MATCH_MAX ? best : null;
}

/* ---- Colour --------------------------------------------------------------- */
//
// The readings are the package's, bound to this case's geometry. The pure halves —
// what a colour distance is, how a cluster is placed — live in
// `./case-harness/color` and are shared with the other two projects, so none of
// them can drift on what a threshold means.

/**
 * The rendered colour at a logical point, averaged over a small cluster.
 *
 * The centre pixel plus four neighbours 4 units out, which on a `32`-unit tile all
 * stay well inside it, so one stray anti-aliased or outlined pixel cannot swing
 * the reading.
 */
export function sampleColor(h: Harness, x: number, y: number): Rgb {
  return sampleClusterColor(h as EnginePointReader, x, y);
}

/** The rendered colour on tile `(col, row)`, sampled about its centre. */
export function sampleTile(h: Harness, col: number, row: number): Rgb {
  return sampleColor(h, tileCX(col), tileCY(row));
}

/**
 * `steps` colours sampled evenly along the segment joining two logical points,
 * both ends included.
 *
 * How a check reads whether the build drew something ALONG a line without knowing
 * what colour it drew it in.
 */
export function samplesAlong(
  h: Harness,
  from: Point,
  to: Point,
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

/* -------------------------------------------------------------------------- */
/* The menus, as a pointer and a finger reach them                            */
/* -------------------------------------------------------------------------- */
//
// specs/ui.md leaves each menu's ARRANGEMENT to the build and requires the build
// to report where it put each item, through `menuItemRect`
// (specs/instrumentation.md). So a check that drives a menu with a pointer asks
// the build where the item is and aims at the middle of the region it named:
// every layout passes, and a build that reports a region it does not answer on is
// the only one that fails.
//
// EACH PART OF A GESTURE RUNS ITS OWN FRAME. A press that ran no frame would
// never reach a build that reads its input once per frame, and a press released
// before a frame ran would be invisible to a build that compares held state
// between frames, so each of the three drives exactly one frame and a check
// counting frames can add them up.

/**
 * The region the build reports for item `index` of the menu on screen.
 *
 * A missing region fails the check that asked for one, with the screen named:
 * specs/instrumentation.md requires a region for every index of the menu the
 * current screen shows, so a `null` here is the build's answer rather than the
 * check's mistake.
 */
export function menuRect(h: Harness, index: number): MenuRect {
  const rect = h.debug.menuItemRect(index);
  if (rect === null) {
    fail(
      `menuItemRect(${index}) to report a region on the ` +
        `${h.snapshot().screen} screen (specs/instrumentation.md)`,
      "null",
    );
  }
  return rect;
}

/**
 * Where each harness's pointer stands, so a release needs no position of its own.
 *
 * A real device lifts where it is; a release that had to be told where it was
 * would let a check lift somewhere the contact never travelled to, which is a
 * gesture no player can make.
 */
const pointerAt = new WeakMap<Harness, Point>();

/** Where the harness's pointer stands, or the stage's top-left before it moved. */
function heldAt(h: Harness): Point {
  return pointerAt.get(h) ?? { x: 0, y: 0 };
}

/** Move the mouse to a logical stage point, and run the frame that reads it. */
export async function mouseGlide(
  h: Harness,
  x: number,
  y: number,
): Promise<void> {
  pointerAt.set(h, { x, y });
  h.point("pointermove", x, y);
  await h.advance(1);
}

/** Press the mouse at a logical stage point, and run the frame that reads it. */
export async function mousePress(
  h: Harness,
  x: number,
  y: number,
): Promise<void> {
  pointerAt.set(h, { x, y });
  h.point("pointerdown", x, y);
  await h.advance(1);
}

/** Release the mouse where it stands, and run the frame that reads it. */
export async function mouseRelease(h: Harness): Promise<void> {
  const at = heldAt(h);
  h.point("pointerup", at.x, at.y);
  await h.advance(1);
}

/** Land a touch contact at a logical stage point, and run the frame that reads it. */
export async function touchPress(
  h: Harness,
  x: number,
  y: number,
): Promise<void> {
  pointerAt.set(h, { x, y });
  h.point("pointerdown", x, y, "touch");
  await h.advance(1);
}

/** Travel the held contact to a logical stage point, and run the frame that reads it. */
export async function touchGlide(
  h: Harness,
  x: number,
  y: number,
): Promise<void> {
  pointerAt.set(h, { x, y });
  h.point("pointermove", x, y, "touch");
  await h.advance(1);
}

/** Lift the contact where it stands, and run the frame that reads it. */
export async function touchRelease(h: Harness): Promise<void> {
  const at = heldAt(h);
  h.point("pointerup", at.x, at.y, "touch");
  await h.advance(1);
}
