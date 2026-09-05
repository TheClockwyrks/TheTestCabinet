// Floe — the shared validator harness. CASE-PROVIDED.
//
// Every check in this suite is an ordinary vitest test that runs IN THE SAME
// PROCESS as the build. It imports the runtime and the build's own modules,
// creates a runtime over a canvas it owns and a clock it chose, and steps the game
// with `engine.advance`. Nothing drives a browser, nothing polls, and no
// wall-clock time passes: a check asks for a number of frames and gets exactly
// that number, at exactly the deltas its clock supplied.
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
// reproducible, and it is the seam the case's specification documents.
// `surface.ts` is that specification as types, and it is the only description of
// the surface this harness reads: the build's own module for it is never imported.
//
// WHERE THE SURFACE COMES FROM. Off `engine.debug`, never built here. The build's
// `initialize` returns it beside the state, as `[state, debug]`, and the runtime
// holds the second element and returns it from `engine.debug`. Reading it back off
// the runtime is the only way a surface reaches a check, so a build that returned
// no surface, or a surface missing an operation, fails the checks that reach the
// game through it. See `readDebugSurface`.
//
// HOW THE SURFACE IS DRIVEN. The runtime holds the state by value and hands it out
// read-only, so the surface is pure: a pose takes the current state and returns
// the next, a reading takes the current state and returns what it read
// (`surface.ts`). A check still writes `h.debug.setLives(1)` and
// `h.debug.snapshot()`, because `h.debug` is a {@link Driver} over the raw
// surface: it runs each pose through `engine.apply` and hands each reading
// `engine.state`. Nothing a check does holds a writable state — `h.state` is the
// runtime's current value, read fresh on every access, and the only way to change
// it is a pose.
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
// undefined — so both are stood up over the workspace's own `assets/` tree for the
// life of each harness and put back on `dispose`. That is the same kind of thing
// the canvas, the surface metrics and the clock are — the host the engine runs on
// — and without it every scenario would draw a strait the build was never given
// the art for.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import {
  createCanvas,
  loadImage,
  type Canvas,
  type SKRSContext2D,
} from "@napi-rs/canvas";
import { expect } from "vitest";
import {
  ConstantClock,
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

/** The case's surface, bound to the state type the build declared. */
export type FloeSurface = FloeDebugApi<FloeState>;

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

/**
 * A member of a pure surface, as a check calls it.
 *
 * A pose `(state, ...args) => S` becomes `(...args) => void`: the driver runs it
 * through `engine.apply`, so the state it returns is the state the next frame
 * receives. A reading `(state, ...args) => R` becomes `(...args) => R`: the
 * driver hands it `engine.state` and passes the rest along, which is what lets
 * `menuItemRect(state, index)` be called as `menuItemRect(index)`. Anything else
 * (`version`) is carried as it is.
 *
 * A reading is told from a pose by `READINGS` at run time rather than by this
 * type: `snapshot` and `menuItemRect` both return something other than the state,
 * but a type cannot say which of two same-shaped members the driver must hand the
 * state to and hand back.
 */
type Driven<S, M> = M extends (state: DeepReadonly<S>, ...args: infer A) => S
  ? (...args: A) => void
  : M extends (state: DeepReadonly<S>, ...args: infer A) => infer R
    ? (...args: A) => R
    : M;

/**
 * The imperative reading of a pure surface: every member of `D`, minus its state
 * argument, over the runtime that holds the state.
 */
export type Driver<S, D> = {
  [K in keyof D]: Driven<S, NonNullable<D[K]>>;
};

/** The surface as every check drives it. */
export type FloeDriver = Driver<FloeState, FloeSurface>;

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
 * The ticks {@link Harness.skip} and {@link Harness.pace} put in one frame.
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
 * How far {@link Harness.skipUntil} sweeps when the caller names no ceiling, and
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

/** Seconds of simulated time in `ticks` frames of the default clock. */
export function seconds(ticks: number): number {
  return ticks / TICK_HZ;
}

/**
 * Whole frames of the default clock covering at least `duration` seconds.
 *
 * Rounded UP, so a hold stated in seconds always covers the whole of it. Floe has
 * one duration no whole number of ticks reaches exactly — `HOP_COOLDOWN` (`0.12`
 * s) is `14.4` ticks — and rounding up is the reading specs/hopping.md fixes: the
 * cooldown is spent on the fifteenth tick, the first at which none of it is left.
 * A check that needs the exact elapsed time asserts against `seconds(ticksFor(d))`
 * rather than against `d`.
 */
export function ticksFor(duration: number): number {
  return Math.ceil(duration * TICK_HZ);
}

/**
 * How far {@link Harness.until} sweeps when the caller names no ceiling: five
 * seconds of game time.
 *
 * Deliberately short. Most of what this suite waits for — a hop, a glide, a
 * cooldown, a lane crossing the strait — happens inside a second, and a sweep
 * that is over quickly is a sweep whose failure is quick. Floe's long waits are
 * long on purpose (a bear emerging, the crossing timer expiring, a bonus catch's
 * cadence), and a check that waits for one names its own `maxFrames` from the
 * figure specs/ fixes for it.
 */
const DEFAULT_SWEEP_FRAMES = 600;

/** A rate in units per second from a displacement measured over `ticks` frames. */
export function speedOverTicks(delta: number, ticks: number): number {
  return (Math.abs(delta) * TICK_HZ) / ticks;
}

/** A rate in TILES per second from a displacement measured over `ticks` frames. */
export function tilesPerSecond(delta: number, ticks: number): number {
  return speedOverTicks(delta, ticks) / TILE;
}

/* -------------------------------------------------------------------------- */
/* What a frame drew                                                          */
/* -------------------------------------------------------------------------- */

/** A 2D affine transform, as the context held it at the moment of a call. */
export interface Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

/**
 * Where a `fillText`/`strokeText` call put its text, read off the real context at
 * the moment of the call: the current transform, so the anchor can be mapped to
 * logical units whatever `translate`/`scale` the build applied, the measured width
 * under the current font, and the alignment that places the run about its anchor.
 */
export interface TextGeometry {
  transform: Matrix;
  width: number;
  textAlign: string;
}

/**
 * One recorded operation on the 2D context, in the order the render made it.
 *
 * A `drawImage` carries the transform the context held at the call as well,
 * because a build draws a lane item by translating to its left edge and drawing
 * the frame about the origin (`ctx.translate(x, top); ctx.drawImage(f, 0, 0, w, 32)`)
 * — and mirrors a leftward one by translating to its RIGHT edge and scaling by
 * `-1` — so the destination arguments alone say nothing about where the sprite
 * landed. {@link drawnImages} is what maps one back to logical units.
 */
export type DrawCall =
  | {
      kind: "call";
      method: string;
      args: unknown[];
      text?: TextGeometry;
      transform?: Matrix;
    }
  | { kind: "set"; property: string; value: unknown };

/**
 * The most calls {@link Harness.calls} holds before the oldest are dropped.
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

/** The methods whose transform is captured beside the call. */
const TRANSFORMED = new Set(["drawImage", "fillText", "strokeText"]);

/**
 * A proxy that records every call and property set on its way to the real
 * context, so one frame produces both a pixel buffer to sample and a call list to
 * inspect.
 */
function recorder(target: SKRSContext2D, calls: DrawCall[]): SKRSContext2D {
  return new Proxy(target, {
    get(object, property) {
      const value = Reflect.get(object, property, object) as unknown;
      if (typeof value !== "function") return value;
      return (...args: unknown[]): unknown => {
        const method = String(property);
        const call: DrawCall = { kind: "call", method, args };
        if (TRANSFORMED.has(method)) {
          const m = object.getTransform();
          call.transform = { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f };
          if (
            (method === "fillText" || method === "strokeText") &&
            typeof args[0] === "string"
          ) {
            call.text = {
              transform: call.transform,
              width: object.measureText(args[0]).width,
              textAlign: object.textAlign,
            };
          }
        }
        push(calls, call);
        return (value as (...rest: unknown[]) => unknown).apply(object, args);
      };
    },
    set(object, property, value) {
      push(calls, { kind: "set", property: String(property), value });
      return Reflect.set(object, property, value, object);
    },
  });
}

/** Append a call, dropping the oldest half once the list reaches its cap. */
function push(calls: DrawCall[], call: DrawCall): void {
  if (calls.length >= MAX_RECORDED_CALLS) {
    calls.splice(0, Math.floor(MAX_RECORDED_CALLS / 2));
  }
  calls.push(call);
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
/* The harness                                                                */
/* -------------------------------------------------------------------------- */

/** One cue the build played, as the runtime announced it. */
export interface PlayedCue {
  cue: string;
  t: number;
  gain: number;
}

/** One asset the build asked for and did not get. */
export interface AssetFailure {
  path: string;
  reason: string;
}

export interface HarnessOptions {
  /**
   * The clock each frame takes its delta from. Defaults to one game tick, so one
   * advanced frame is one tick. A check about real time passes a `WallClock`.
   */
  clock?: Clock;
  /** The element's laid-out CSS width. Defaults to the logical stage width. */
  cssWidth?: number;
  /** The element's laid-out CSS height. Defaults to the logical stage height. */
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
  snapshot: FloeSnapshot;
}

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

export interface Harness {
  readonly engine: Engine<FloeState, FloeSurface>;
  /**
   * The runtime's current state, read fresh on every access. Read it, or pose it
   * through `debug`; nothing here can write to it.
   */
  readonly state: DeepReadonly<FloeState>;
  /**
   * The debug surface the BUILD returned beside its state, driven over the
   * runtime: each pose runs through `engine.apply`, each reading is handed
   * `engine.state`.
   *
   * The raw surface is read off `engine.debug` rather than built here — see
   * {@link readDebugSurface} — and {@link driveSurface} is the wrapper.
   */
  readonly debug: FloeDriver;
  /** The real 2D context, for `getImageData`. Draw calls also reach it. */
  readonly ctx: SKRSContext2D;
  /**
   * The surface the runtime drew into, holding the last frame that ran.
   *
   * Exposed for {@link captureStill}, which encodes it: a still output is the
   * picture the build actually put on the canvas, and the only place that picture
   * exists is here.
   */
  readonly canvas: Canvas;
  /**
   * Every call and property set the render made, oldest first.
   *
   * It accumulates across frames, so a check that reads what ONE frame drew
   * empties it first — `h.calls.length = 0`, one `advance(1)`, then the reading,
   * which is {@link drawFrame}. It is capped at {@link MAX_RECORDED_CALLS}; the
   * cap is orders of magnitude past one frame and cannot cost such a reading
   * anything.
   */
  readonly calls: DrawCall[];
  /** Every cue the build played, oldest first. */
  readonly cues: PlayedCue[];
  /** Every asset the build failed to load, oldest first. */
  readonly assetFailures: AssetFailure[];

  /** A fresh read of the game's state through the case's `snapshot`. */
  snapshot(): FloeSnapshot;
  /** Run `frames` frames back to back. One frame is one tick. */
  advance(frames: number): Promise<void>;
  /** Run the whole ticks covering `duration` seconds of game time. */
  advanceSeconds(duration: number): Promise<void>;
  /**
   * Run `ticks` whole simulation ticks in COARSE frames.
   *
   * The tick-exact companion to {@link skip}, for a wait a check states in TICKS:
   * the coarse stretch runs whole `COARSE_TICKS` frames and the leftover runs at
   * one tick a frame, so exactly `ticks` ticks are spent. {@link skip} is this
   * over a duration in seconds, rounded the way `ticksFor` rounds.
   */
  skipTicks(ticks: number): Promise<void>;
  /**
   * Cover `duration` seconds of game time in COARSE frames, for waiting out a
   * cadence the specification measures in tens of seconds.
   *
   * The same ticks run — the simulation advances by the whole `TICK_DT` ticks a
   * frame's delta completes, which is what specs/overview.md fixes and what
   * `instrumentation/deterministic-core` decides — and only the pictures between
   * them are skipped. It leaves the clock at one tick a frame, so what follows
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
  /** Advance until `predicate` holds, sampling every `poll` frames. */
  until(
    predicate: (snapshot: FloeSnapshot) => boolean,
    options?: UntilOptions,
  ): Promise<UntilResult>;
  /** Drive the runtime's own frame loop for `ms` of real time, then halt it. */
  runFor(ms: number): Promise<void>;

  /** Press a key and leave it down, as a player holding it would. */
  hold(code: string): void;
  /** Release a key held by `hold`. */
  release(code: string): void;
  /**
   * Press and release a key, then run the one frame that delivers its edge.
   *
   * The runtime discards an edge nothing consumed by the end of the frame it was
   * armed in, so a tap that ran no frame would never reach the game.
   */
  tap(code: string): Promise<void>;

  /** Where a logical point lands in the canvas's backing store. */
  device(x: number, y: number): { x: number; y: number };
  /**
   * Where a logical point lands in CSS pixels: the device point the fit puts it
   * at, divided back by the device pixel ratio.
   *
   * What a pointer or touch gesture is aimed with, because the engine reads a
   * device event's position in CSS pixels from the surface's own origin.
   */
  css(x: number, y: number): { x: number; y: number };
  /**
   * Dispatch one pointer-shaped event at the surface, at a LOGICAL stage point.
   *
   * The engine owns the pointer and listens on the same target its key listeners
   * go on (engine/input.md), so an event dispatched here drives the game exactly
   * as a player's mouse or finger does.
   */
  point(
    type: "pointerdown" | "pointermove" | "pointerup",
    x: number,
    y: number,
    device?: "mouse" | "touch",
  ): void;
  /** The device pixel under a logical point, as `[r, g, b, a]`. */
  pixel(x: number, y: number): [number, number, number, number];

  /** Drop the runtime's listeners, release the canvas, and put the host back. */
  dispose(): void;
}

/**
 * A `PointerEvent`-shaped event: the engine reads `clientX`, `clientY`,
 * `pointerId`, `pointerType`, `isPrimary`, `button` and `buttons` off one
 * (engine/input.md), and maps the client position into the game's own logical
 * coordinates through the inverse of the viewport it drew with.
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
    type: "pointerdown" | "pointermove" | "pointerup",
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

/** A `KeyboardEvent`-shaped event: the runtime reads `code` and `repeat`. */
class KeyEvent extends Event {
  readonly code: string;
  readonly repeat: boolean;

  constructor(type: "keydown" | "keyup", code: string, repeat = false) {
    super(type);
    this.code = code;
    this.repeat = repeat;
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
 * The debug surface the BUILD returned beside its state, read off the runtime that
 * holds it.
 *
 * This is deliberately a READ and never a construction. The surface is the
 * build's deliverable: its `initialize` returns `[state, debug]`
 * (specs/instrumentation.md), the runtime keeps the second element, and
 * `engine.debug` is the only way it reaches a check. Nothing here could stand in
 * for it, because the build's own module for the surface is never imported.
 *
 * By the time this runs `engine.initialize()` has resolved, which is the one
 * precondition `engine.debug` has: it holds whatever the build returned as the
 * pair's second element, and a build that returned no pair at all never gets this
 * far, because the runtime rejects `initialize` itself and the rejection fails the
 * suite's `beforeEach` with the runtime's own message. Such a build does not run
 * on the engine under any entry point, so it is not this harness's fault to
 * report — which is why every suite's `afterEach` disposes its harness with `?.`:
 * the hook then has nothing to add to that message.
 *
 * What IS decided here is a pair whose second element is no surface — a build that
 * returned `[state, null]`, or something other than an object. That is a fault in
 * the build and not in this harness, so it must not present as one:
 *
 * - It is NOT thrown from here. Every suite builds its harness in a `beforeEach`,
 *   so a throw at this point would fail the hook and bury the real verdict under
 *   the harness's own stack in the case's own file.
 * - It is NOT swallowed either. {@link missingSurface} stands in for the missing
 *   surface and fails, by assertion, at the moment a check first reaches for an
 *   operation on it — naming the return the build owes.
 *
 * So the harness is built, teardown runs, and the fault lands exactly where
 * specs/instrumentation.md says it should: on the points whose checks reach the
 * game through the surface. A check that needs no surface is decided on its own
 * merits, and `instrumentation/surface-present` names the missing surface
 * outright.
 */
function readDebugSurface(engine: Engine<FloeState, FloeSurface>): FloeSurface {
  const surface: unknown = engine.debug;
  if (typeof surface !== "object" || surface === null) {
    return missingSurface(
      `engine.debug holds ${surface === null ? "null" : typeof surface}, ` +
        `not an object`,
    );
  }
  return surface as FloeSurface;
}

/**
 * A stand-in for the surface a build never returned: every operation on it fails
 * the check that reached for it, with the missing return named.
 *
 * A proxy rather than a hand-written stub, so a member the specification names and
 * this file has not thought about still reports the missing surface rather than
 * reporting itself merely absent.
 *
 * Keys that belong to the RUNTIME rather than to a check are answered with
 * `undefined` instead: awaiting the harness probes `then`, and vitest's own error
 * formatting probes symbols and `constructor`. Failing those would replace the
 * verdict below with noise from the machinery that was trying to report it.
 */
function missingSurface(reason: string): FloeSurface {
  return new Proxy({} as FloeSurface, {
    get: (_target, property): unknown => {
      if (typeof property === "symbol") return undefined;
      if (property === "then" || property === "constructor") return undefined;
      return fail(SURFACE_REQUIREMENT, reason);
    },
  });
}

/**
 * What the build owes when its surface is missing: the `Expected:` line of the
 * failure every check that reaches for the surface lands on, beside what
 * `engine.debug` was found holding instead.
 */
const SURFACE_REQUIREMENT =
  "the debug surface src/game.ts's initialize returns beside its state, as " +
  "[state, debug], which the engine hands back from engine.debug " +
  "(specs/instrumentation.md)";

/**
 * The imperative reading of the raw surface, over the runtime that holds the
 * state.
 *
 * A proxy, and a lazy one, for the same reason {@link missingSurface} is: the
 * member is read off the raw surface at the moment a check reaches for it, so a
 * missing surface or a missing operation fails the check that needed it and never
 * the `beforeEach` that built the harness. A member that is not a function
 * (`version`, or an operation the build left out) comes back as it is, which is
 * what lets `instrumentation/surface-present` test for each operation by `typeof`.
 *
 * A reading is called with `engine.state` and its result handed back. A pose is
 * run through `engine.apply`, so the runtime stores what it returned and the next
 * frame's `update` receives it; a pose that returns nothing is refused by the
 * runtime with a message naming the rule.
 */
function driveSurface(
  engine: Engine<FloeState, FloeSurface>,
  raw: FloeSurface,
): FloeDriver {
  const readings: readonly string[] = READINGS;
  return new Proxy({} as FloeDriver, {
    get: (_target, property): unknown => {
      if (typeof property === "symbol") return undefined;
      if (property === "then" || property === "constructor") return undefined;
      const member = (raw as unknown as Record<string, unknown>)[property];
      if (typeof member !== "function") return member;
      const op = member as (
        state: DeepReadonly<FloeState>,
        ...args: unknown[]
      ) => unknown;
      if (readings.includes(property)) {
        return (...args: unknown[]): unknown =>
          op.call(raw, engine.state, ...args);
      }
      return (...args: unknown[]): void => {
        engine.apply((state) => op.call(raw, state, ...args) as FloeState);
      };
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Serving the seeded art to a headless engine                                */
/* -------------------------------------------------------------------------- */
//
// specs/assets.md has the build load every frame through the engine's loader,
// which resolves a path under the fixed `assets/` root, relative to the page, and
// fetches it. There is no page here, so the two globals the loader reaches for are
// stood up over the workspace's own `assets/` tree while a harness is alive and
// put back when it is disposed. Two harnesses may be alive at once — a check that
// compares two seeds builds a second — so the install is counted rather than
// nested, and the originals go back when the last one goes.

/**
 * The directory this harness sits in, which is the validator project's root.
 *
 * Taken from this module's own URL rather than from the working directory,
 * because it has to name the same directory in both layouts this file lives in:
 * the case's own `validation/<engine>/`, and the `validation/` the runner stages
 * that directory to inside the build's tree.
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

/** What the loader reaches for, as it stood before this module replaced it. */
interface HostGlobals {
  fetch: unknown;
  createImageBitmap: unknown;
}

/** The bytes of each seeded file, read once and served to every harness. */
const seededBytes = new Map<string, Uint8Array<ArrayBuffer>>();

let hostDepth = 0;
let hostBefore: HostGlobals | null = null;

/** Stand the two globals up over the workspace's own `assets/` directory. */
function serveSeededAssets(): void {
  hostDepth += 1;
  if (hostDepth > 1) return;
  const host = globalThis as unknown as Record<string, unknown>;
  hostBefore = {
    fetch: host.fetch,
    createImageBitmap: host.createImageBitmap,
  };
  host.fetch = async (url: string): Promise<Response> => {
    let bytes = seededBytes.get(url);
    if (bytes === undefined) {
      // Copied out of the `Buffer` the read hands back, because a `Buffer` is a
      // view onto a pool the next read may reuse and a `Response` keeps its body.
      bytes = Uint8Array.from(readFileSync(join(WORKSPACE, url)));
      seededBytes.set(url, bytes);
    }
    return new Response(bytes);
  };
  host.createImageBitmap = async (blob: Blob): Promise<unknown> =>
    loadImage(Buffer.from(await blob.arrayBuffer()));
}

/** Put them back once the last harness that asked for them has gone. */
function restoreHost(): void {
  if (hostDepth === 0) return;
  hostDepth -= 1;
  if (hostDepth > 0 || hostBefore === null) return;
  const host = globalThis as unknown as Record<string, unknown>;
  host.fetch = hostBefore.fetch;
  host.createImageBitmap = hostBefore.createImageBitmap;
  hostBefore = null;
}

/* -------------------------------------------------------------------------- */
/* Building one                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Build a runtime over a canvas of the harness's own, initialize the build's game,
 * and hand back everything a check reads.
 *
 * The options passed to the factory are the ones the seeded `src/main.ts` passes —
 * the design size, the build's exported `BACKGROUND`, and the `dpad-4` layout — so
 * one harness serves every build of this case. Everything else the build decided
 * lives inside `src/game.ts`.
 *
 * Dispose it in an `afterEach`, with `?.`, so a build whose `initialize` rejected
 * fails with the runtime's own message rather than with a teardown error on top
 * of it.
 */
export async function createHarness(
  options: HarnessOptions = {},
): Promise<Harness> {
  const cssWidth = options.cssWidth ?? STAGE_W;
  const cssHeight = options.cssHeight ?? STAGE_H;
  const dpr = options.dpr ?? 1;

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
  const surface: SurfaceMetrics = {
    cssWidth: () => cssWidth,
    cssHeight: () => cssHeight,
    dpr: () => dpr,
    events: () => keys,
  };

  const engine = createEngine<FloeState, FloeSurface>({
    canvas: element,
    width: STAGE_W,
    height: STAGE_H,
    game,
    // The build's own stage background, handed to the engine exactly as the
    // seeded `src/main.ts` hands it (specs/overview.md).
    background: BACKGROUND,
    layout: LAYOUT,
    clock: options.clock ?? new ConstantClock(TICK_MS),
    surface,
  });

  // Subscribed BEFORE `initialize`, which is what makes the game's own loading
  // observable: construction runs no game code, so nothing has happened yet.
  const assetFailures: AssetFailure[] = [];
  const cues: PlayedCue[] = [];
  engine.events.on("asset:failed", ({ path, reason }) => {
    assetFailures.push({ path, reason });
  });
  engine.events.on("cue:played", (played) => {
    cues.push(played);
  });

  // Before `initialize`, because that is where the build loads its sprite art.
  serveSeededAssets();
  let disposed = false;
  try {
    await engine.initialize();
  } catch (error) {
    restoreHost();
    throw error;
  }
  const debug = driveSurface(engine, readDebugSurface(engine));

  const dispatch = (type: "keydown" | "keyup", code: string): void => {
    keys.dispatchEvent(new KeyEvent(type, code));
  };

  const harness: Harness = {
    engine,
    get state() {
      return engine.state;
    },
    debug,
    ctx,
    canvas,
    calls,
    cues,
    assetFailures,

    snapshot: () => debug.snapshot(),

    advance: (frames) => engine.advance(frames),
    advanceSeconds: (duration) => engine.advance(ticksFor(duration)),

    pace: (ticksPerFrame) => {
      engine.setClock(new ConstantClock(TICK_MS * ticksPerFrame));
    },

    async skipTicks(ticks) {
      const total = Math.max(0, Math.trunc(ticks));
      const coarse = Math.floor(total / COARSE_TICKS);
      if (coarse > 0) {
        harness.pace(COARSE_TICKS);
        try {
          await engine.advance(coarse);
        } finally {
          // In a `finally`, and outside the branch, so this always returns the
          // clock to one tick a frame — whatever the count was, and whether or
          // not the coarse stretch ran to the end.
          harness.pace(1);
        }
      } else {
        harness.pace(1);
      }
      await engine.advance(total - coarse * COARSE_TICKS);
    },

    skip: (duration) => harness.skipTicks(ticksFor(duration)),

    async skipUntil(predicate, skipOptions = {}) {
      const maxSeconds = skipOptions.maxSeconds ?? DEFAULT_SWEEP_SECONDS;
      const pollSeconds = Math.max(
        seconds(COARSE_TICKS),
        skipOptions.pollSeconds ?? DEFAULT_SKIP_POLL_SECONDS,
      );

      // The state as it stands is read first, so a sweep whose condition already
      // holds reports it without spending any game time.
      let snapshot = harness.snapshot();
      if (predicate(snapshot)) return { hit: true, elapsed: 0, snapshot };

      let elapsed = 0;
      while (elapsed < maxSeconds) {
        const step = Math.min(pollSeconds, maxSeconds - elapsed);
        await harness.skip(step);
        elapsed += step;
        snapshot = harness.snapshot();
        if (predicate(snapshot)) return { hit: true, elapsed, snapshot };
      }
      return { hit: false, elapsed, snapshot };
    },

    async until(predicate, untilOptions = {}) {
      const maxFrames = untilOptions.maxFrames ?? DEFAULT_SWEEP_FRAMES;
      const poll = Math.max(1, untilOptions.poll ?? 1);

      let snapshot = debug.snapshot();
      if (predicate(snapshot)) return { hit: true, frames: 0, snapshot };

      let frames = 0;
      while (frames < maxFrames) {
        const step = Math.min(poll, maxFrames - frames);
        await engine.advance(step);
        frames += step;
        snapshot = debug.snapshot();
        if (predicate(snapshot)) return { hit: true, frames, snapshot };
      }
      return { hit: false, frames, snapshot };
    },

    async runFor(ms) {
      const controller = new AbortController();
      const running = engine.run({ signal: controller.signal });
      await new Promise((resolve) => setTimeout(resolve, ms));
      controller.abort();
      await running;
    },

    hold: (code) => dispatch("keydown", code),
    release: (code) => dispatch("keyup", code),
    async tap(code) {
      dispatch("keydown", code);
      dispatch("keyup", code);
      await engine.advance(1);
    },

    device: (x, y) => toDevice(engine.viewport(), x, y),
    css: (x, y) => {
      const at = toDevice(engine.viewport(), x, y);
      return { x: at.x / dpr, y: at.y / dpr };
    },
    point: (type, x, y, device = "mouse") => {
      const at = toDevice(engine.viewport(), x, y);
      keys.dispatchEvent(
        new PointerDriveEvent(type, at.x / dpr, at.y / dpr, device),
      );
    },
    pixel: (x, y) => {
      const point = toDevice(engine.viewport(), x, y);
      const { data } = ctx.getImageData(point.x, point.y, 1, 1);
      return [data[0], data[1], data[2], data[3]];
    },

    dispose: () => {
      if (disposed) return;
      disposed = true;
      engine.destroy();
      restoreHost();
    },
  };

  return harness;
}

/* -------------------------------------------------------------------------- */
/* Evidence capture                                                           */
/* -------------------------------------------------------------------------- */
//
// A review item declares its OUTPUTS beside its verdict: a `replay` — the frames
// the build itself drew while a check drove it, kept as evidence a reviewer can
// scrub against the reference implementation's — or an `image`, one frame of it.
// `captureReplay` and `captureStill` are how a check produces them.
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
//    Nothing here can turn a passing check into a failing one: a recording that
//    cannot be written is reported as an output that never turned up, which is a
//    fact about the host rather than about the build.
// 3. THEY WRITE ONLY WHAT THERE IS TO LOOK AT. A capture that closed no frames
//    leaves no file, so the run reports the output absent instead of offering the
//    reviewer a replay of nothing.
// 4. THEY COST NOTHING WHEN NOBODY IS COLLECTING. Outside a run — a developer
//    running this suite from a shell — the media directory is unset, and the whole
//    thing is a no-op that still runs the scenario. The suite behaves identically
//    either way, so a check cannot pass in one place and fail in the other.

/**
 * The environment variable the runner names the media directory in.
 *
 * Unset is not an error: it is the normal state of a suite nobody is collecting
 * media from.
 */
const MEDIA_DIR_ENV = "TCAB_VALIDATION_MEDIA_DIR";

/**
 * The directory the runner stages this project to inside the build's tree.
 *
 * A recording is addressed by the STAGED path of the suite that produced it —
 * `validation/hunter/catches.test.ts` — because that is the path the review item's
 * declared script resolves to, and so the only name the case's manifest and the
 * runner both already agree on.
 */
const STAGED_PROJECT_DIR = "validation";

/**
 * The most frames a written recording holds.
 *
 * A recording is one JSON operation log per frame, and a frame of this game is a
 * few hundred operations — five band fills, the bay cuts, every vehicle and floe
 * on sixteen lanes, the critter, the bears and the HUD — so a section a check
 * drives for half a minute of game time runs to tens of megabytes: a file nobody
 * can serve to a reviewer and nobody wants in a run's artifacts. The cap is what
 * makes `captureReplay` safe to wrap ANY section in.
 *
 * It is generous enough that the great majority of this suite's sections — a hop,
 * a glide, a lane crossing the strait, a second of a bear's swim — are written
 * whole.
 */
const MAX_REPLAY_FRAMES = 300;

/**
 * Where the running suite's `outputId` output belongs, or `null` when nothing is
 * collecting media.
 *
 * The suite is the one vitest is currently running rather than one the caller
 * names, because the two must not be able to disagree: a check that named its own
 * path would be free to write its evidence under some other point's address.
 *
 * `extension` is the one the runner collects that OUTPUT KIND under — `json.gz`
 * for a recording (a JSON document stored gzipped: `.json` is what the bytes are
 * and `.gz` is how they are framed), `png` for a still. The suite and the runner
 * agree by both stating the same thing about what the kind is.
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
 * Two entries that mean the same thing have to serialize identically for a table
 * to hold one copy of each, and the key order inside an argument the build passed
 * is the build's own business rather than ours.
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
 * WITH. The four tables in front of a recording are shared by every frame in it,
 * so carrying them over whole would put operations, states, gradients and images
 * in the file that no surviving frame asks for — dead weight in a document whose
 * whole point is to say each thing once.
 *
 * Every entry here is reached from a kept frame, and every reference inside one is
 * rewritten as it is reached, transitively: a frame names its own state and the
 * states saved under it, whose clip and path segments and inherited fill name
 * operations and resources, whose own creating calls may name images. What is
 * deduplicated is the rewritten entry, so an operation two hundred frames issue
 * identically is written once and named two hundred times, and every index a frame
 * carries addresses the table it was interned into.
 *
 * Exported for the suite beside this file: a recording carrying an own field named
 * `__proto__` is one the engine's recorder writes and this one has to rewrite as a
 * field rather than as a prototype, and no drawing the reference implementation
 * makes produces one.
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
    // A recipe's own arguments were encoded when the value was used, so they can
    // only name entries interned before it: rewriting one terminates and cannot
    // re-enter this resource.
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
    if (typeof record.$img === "number") {
      return { $img: takeImage(record.$img) };
    }
    if (typeof record.$res === "number") {
      return { $res: takeResource(record.$res) };
    }
    const rewritten: Record<string, DrawValue> = {};
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
      // A frame inherits the current path along with the clip: a canvas keeps its
      // path across a frame boundary, and applying a clip leaves the clip outline
      // current, so a state that stopped at the clip would leave a bare `fill`
      // among the frame's operations filling that outline.
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
 * A recording of at most {@link MAX_REPLAY_FRAMES} frames, covering the whole of
 * what was captured.
 *
 * An over-long section is THINNED rather than cut short: every nth frame is kept,
 * so the reviewer sees the entire section at a lower frame rate instead of its
 * first — or last — few seconds at the full one. That is the reading that matches
 * what these outputs are named for. A recording of a bear's pursuit is evidence
 * that it routed around the traffic, swam the water and closed the whole way, and
 * the turns are spread across the whole of it.
 *
 * Thinning is legitimate because every frame in a recording is drawable on its
 * own: a frame names the whole of the state it opened with and reaches everything
 * it draws with through tables the recording shares, so dropping the frames
 * between two kept ones cannot leave a frame undrawable. Each kept frame's
 * `deltaMs` is restated as the time since the frame kept before it, so the deltas
 * still sum to the section's elapsed time and a player pacing itself off them runs
 * at the speed the game really ran at. The frame `count` is left as the host
 * reported it, so a reader can see that frames were skipped rather than being told
 * a smooth lie.
 *
 * The last frame is always kept, whatever the stride lands on: it is the frame the
 * check's sweep stopped at — the catch, the splash, the bay filled — and it is the
 * one a reviewer looks at first.
 *
 * Keeping it costs a frame rather than the cap. The stride rounds up, so a section
 * whose length is an exact multiple of the cap strides over exactly that many
 * frames and stops one stride short of the end: the last frame still has to come
 * in, and the cap is a ceiling rather than a target. It takes the place of the
 * final strided frame — the frame nearest it, so the swap opens the smallest gap
 * available anywhere in the section — and is measured from where that frame was
 * measured from, which is what keeps the kept deltas summing to the elapsed time.
 *
 * What survives is then re-expressed against tables of its own, because those
 * tables are shared by every frame the recorder kept and a dropped frame takes the
 * last reference to whatever only it drew with.
 */
function thinReplay(recording: Recording): Recording {
  const { frames } = recording;
  if (frames.length <= MAX_REPLAY_FRAMES) return recording;

  const stride = Math.ceil(frames.length / MAX_REPLAY_FRAMES);
  const kept: RecordedFrame[] = [];
  // The moment the section started, so the first kept frame's delta is its own
  // rather than a step measured from nothing.
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
 * A capture that closed no frames writes nothing. There is no picture in it to
 * draw, and a file holding an empty frame list would be collected as an output
 * that turned up — the run would tell the reviewer there is a replay to watch and
 * the player would open on nothing. A declared output that never turned up is
 * already reported as absent, and that is the truthful reading of a section that
 * drew no frames.
 *
 * What lands on disk is gzip rather than raw JSON. A recording is text made almost
 * entirely of numbers, index lists and field names repeated once per frame, which
 * is close to the shape gzip is best at. Every host that serves one declares the
 * encoding, so the browser inflates it before the player sees it, and the document
 * inside is the same one.
 *
 * Never throws. A directory that cannot be made or a file that cannot be written
 * says something about the machine the validators ran on, and failing the point
 * over it would blame the build for the host's problem.
 */
function writeReplay(destination: string, recording: Recording): void {
  if (recording.frames.length === 0) return;
  try {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, gzipSync(JSON.stringify(thinReplay(recording))));
  } catch (error) {
    console.warn(`floe: could not write ${destination}: ${String(error)}`);
  }
}

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
 * Capture sits BESIDE them rather than in place of them: a check still fails for
 * the reasons it failed before, and the recording is what a reviewer looks at
 * afterwards to see what the build actually drew while it did.
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
    // In a `finally`, so a scenario that failed still leaves its evidence behind.
    writeReplay(destination, h.engine.stopRecording());
  }
}

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
 * picture that shows why. Nothing here can change a verdict: outside a run the
 * media directory is unset and this is a no-op.
 */
export function captureStill(h: Harness, outputId: string): void {
  const destination = mediaDestination(outputId, "png");
  if (destination === null) return;
  try {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, h.canvas.toBuffer("image/png"));
  } catch (error) {
    console.warn(`floe: could not write ${destination}: ${String(error)}`);
  }
}

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
export function tileCenter(col: number, row: number): { x: number; y: number } {
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
 * The reading every rendering check opens with. {@link Harness.calls} accumulates
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

/** A cue the build played, and the frame of the run it played on. */
export interface TimedCue {
  cue: string;
  /** The frame loop's simulated time when it played, in milliseconds. */
  t: number;
  /** The cue's gain: zero while the bus is muted, positive otherwise. */
  gain: number;
  /** The frame it played on, 1-based, as `engine.frame().count` reports. */
  frame: number;
}

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
export function watchCues(h: Harness): TimedCue[] {
  const played: TimedCue[] = [];
  h.engine.events.on("cue:played", ({ cue, t, gain }) => {
    played.push({ cue, t, gain, frame: h.engine.frame().count });
  });
  return played;
}

/* ---- Text ----------------------------------------------------------------- */

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
 * commonly drawn with a selection marker or padding around it. Requiring the exact
 * run would fail a screen that shows precisely the right words.
 */
export function drewText(calls: readonly DrawCall[], text: string): boolean {
  const wanted = text.trim().toLowerCase();
  return drawnText(calls).some((drawn) => drawn.toLowerCase().includes(wanted));
}

/** One run of text a frame drew, and the logical box its glyphs span. */
export interface TextSpan {
  text: string;
  /** The anchor, in logical units. */
  x: number;
  y: number;
  /** The horizontal extent of the glyphs, in logical units. */
  left: number;
  right: number;
}

/**
 * Every run of text `calls` drew, placed in logical units.
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
  const view = h.engine.viewport();
  const spans: TextSpan[] = [];
  for (const call of calls) {
    if (call.kind !== "call" || call.text === undefined) continue;
    const [text, ax, ay] = call.args;
    if (typeof text !== "string" || typeof ax !== "number") continue;
    if (typeof ay !== "number") continue;
    const { transform: m, width, textAlign } = call.text;
    // Device-space anchor, then back through the engine's fit to logical units.
    const deviceX = m.a * ax + m.c * ay + m.e;
    const deviceY = m.b * ax + m.d * ay + m.f;
    const x = (deviceX - view.offsetX) / view.scale;
    const y = (deviceY - view.offsetY) / view.scale;
    // The run's width under the same horizontal scale the anchor took.
    const w = (width * Math.hypot(m.a, m.b)) / view.scale;
    const before =
      textAlign === "center"
        ? w / 2
        : textAlign === "right" || textAlign === "end"
          ? w
          : 0;
    spans.push({ text, x, y, left: x - before, right: x - before + w });
  }
  return spans;
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
 * {@link Harness.calls} as ordinary text draws, readable with {@link drawnText} —
 * but AFTER the engine recorder's bracket has closed, so none of it appears in a
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
 * landed. The destination box's center is taken through the transform the context
 * held at the call and then back through the engine's fit, so what comes out is
 * the point on the stage a check can hold against a reported center or left edge —
 * which is how a draw is attributed to the critter, bear, vehicle or floe it was
 * drawn for.
 *
 * All three argument forms are read: `(image, dx, dy)`, `(image, dx, dy, dw, dh)`,
 * and the nine-argument form with a source rectangle, which is reported as
 * {@link DrawnImage.sourceRect}.
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
    const deviceX = m.a * lx + m.c * ly + m.e;
    const deviceY = m.b * lx + m.d * ly + m.f;
    const x = (deviceX - view.offsetX) / view.scale;
    const y = (deviceY - view.offsetY) / view.scale;
    const w = Math.abs(dw * Math.hypot(m.a, m.b)) / view.scale;
    const height = Math.abs(dh * Math.hypot(m.c, m.d)) / view.scale;
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
      mirrored: (m.a * m.d - m.b * m.c) * Math.sign(dw) * Math.sign(dh) < 0,
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

/** A sampled colour, each channel 0–255. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * The rendered colour at a logical point, averaged over a small cluster.
 *
 * The centre pixel plus four neighbours 4 units out, which on a `32`-unit tile all
 * stay well inside it, so one stray anti-aliased or outlined pixel cannot swing
 * the reading.
 */
export function sampleColor(h: Harness, x: number, y: number): Rgb {
  const offsets: readonly (readonly [number, number])[] = [
    [0, 0],
    [4, 0],
    [-4, 0],
    [0, 4],
    [0, -4],
  ];
  let r = 0;
  let g = 0;
  let b = 0;
  for (const [dx, dy] of offsets) {
    const [pr, pg, pb] = h.pixel(x + dx, y + dy);
    r += pr;
    g += pg;
    b += pb;
  }
  return {
    r: r / offsets.length,
    g: g / offsets.length,
    b: b / offsets.length,
  };
}

/** The rendered colour on tile `(col, row)`, sampled about its centre. */
export function sampleTile(h: Harness, col: number, row: number): Rgb {
  return sampleColor(h, tileCX(col), tileCY(row));
}

/** Euclidean distance between two colours, 0 to about 441. */
export function colorDistance(a: Rgb, b: Rgb): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
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

/** The centre of a reported region: where a gesture aimed at that item lands. */
export function rectCenter(rect: MenuRect): { x: number; y: number } {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/**
 * Where each harness's pointer stands, so a release needs no position of its own.
 *
 * A real device lifts where it is; a release that had to be told where it was
 * would let a check lift somewhere the contact never travelled to, which is a
 * gesture no player can make.
 */
const pointerAt = new WeakMap<Harness, { x: number; y: number }>();

/** Where the harness's pointer stands, or the stage's top-left before it moved. */
function heldAt(h: Harness): { x: number; y: number } {
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
