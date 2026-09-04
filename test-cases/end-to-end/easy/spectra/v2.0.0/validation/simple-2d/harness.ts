// Spectra — the shared validator harness. CASE-PROVIDED.
//
// Every validator in this project is an ordinary vitest test that runs IN THE SAME
// PROCESS as the build. It imports the engine and the build's own modules, creates
// an engine over a canvas it owns and a clock it chose, and steps the game with
// `engine.advance`. Nothing drives a browser, nothing polls, and no wall-clock time
// passes: a validator asks for a number of frames and gets exactly that number, at
// exactly the deltas its clock supplied.
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
// Posing through it is how a scenario is reproducible, and it is the seam the
// case's specification documents. `surface.ts` is that specification as types, and
// it is the only description of the surface this harness reads: the build's own
// module for the surface is never imported.
//
// WHERE THE SURFACE COMES FROM. Off `engine.debug`, never built here. The build's
// `initialize` returns it beside the state, as `[state, debug]`, and the engine
// holds the second element and returns it from `engine.debug`. Reading it back off
// the engine is the only way a surface reaches a validator, so a build that
// returned no surface, or a surface missing an operation, fails the items that
// reach the game through it. See {@link readDebugSurface}.
//
// HOW THE SURFACE IS DRIVEN. The engine holds the state by value and hands it out
// read-only, so the surface is pure: a pose takes the current state and returns the
// next, a reading takes the current state and returns what it read (`surface.ts`).
// A validator still writes `h.debug.setShipBand("magenta")` and
// `h.debug.snapshot()`, because `h.debug` is a {@link Driver} over the raw surface:
// it runs each pose through `engine.apply` and hands each reading `engine.state`.
// Nothing a validator does holds a writable state — `h.state` is the engine's
// current value, read fresh on every access, and the only way to change it is a
// pose.
//
// THE HARNESS SUPPLIES THE CLOCK, NOT THE GAME. `ConstantClock(TICK_MS)` is the
// default, so one frame is one 120 Hz tick and every duration below is a whole
// number of them. That is why `[instrumentation]` carries no `tick_hz`: Spectra
// mandates no fixed timestep, every rate is per second and integrated against the
// delta the frame hands the game, and the SUITE is what fixes a step so a tolerance
// can be stated in ticks and mean the same thing on every machine. 120 Hz is also
// exactly `1 / SUBSTEP_MAX`, so one frame of the default clock is one whole
// sub-step and nothing is ever measured across a partial one. An item that is
// specifically about the step size — `instrumentation.deterministic-core` — builds
// its own harnesses with clocks of its own.
//
// THE SEEDED ART IS SERVED HEADLESS. specs/assets.md has the build load its four
// sprites and its drone-burst through the engine's asset loader, which resolves
// each path under `assets/` relative to the page and fetches it. This project runs
// in a Node process with no page, so `fetch` and `createImageBitmap` are stood up
// over the workspace's own `assets/` tree for the life of each harness and put back
// on `dispose`. That is the same kind of thing the canvas, the surface metrics and
// the clock are — the host the engine runs on — and without it every scenario would
// draw a field the build was never given the art for.

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
 * A member of a pure surface, as a validator calls it.
 *
 * A pose `(state, ...args) => S` becomes `(...args) => void`: the driver runs it
 * through `engine.apply`, so the state it returns is the state the next frame
 * receives. A reading `(state) => R` becomes `() => R`: the driver hands it
 * `engine.state`. Anything else (`version`) is carried as it is.
 */
type Driven<S, M> = M extends (state: DeepReadonly<S>, ...args: infer A) => S
  ? (...args: A) => void
  : M extends (state: DeepReadonly<S>, ...args: infer A) => infer R
    ? (...args: A) => R
    : M;

/**
 * The imperative reading of a pure surface: every member of `D`, minus its state
 * argument, over the engine that holds the state.
 */
export type Driver<S, D> = {
  [K in keyof D]: Driven<S, NonNullable<D[K]>>;
};

/** The surface as every validator drives it. */
export type SpectraDriver = Driver<SpectraState, SpectraSurface>;

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
 * because a build draws a sprite by translating to the entity's centre and drawing
 * the frame about the origin, so the destination arguments alone say nothing about
 * where the sprite landed. {@link drawnImages} is what maps one back to logical
 * units.
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
 * The list is what a presentation item reads, and a presentation item reads ONE
 * frame: the idiom is `h.calls.length = 0`, one `advance(1)`, then the reading —
 * which is what {@link drawFrame} does. But the list is recorded whether an item
 * reads it or not, and this case's longest sweeps run thousands of frames of a
 * field drawing a starfield, a HUD, a formation and its bursts, so an uncapped list
 * would be hundreds of megabytes in a validator that never looks at it. Past the
 * cap the oldest half is dropped, which is far beyond any single frame and so
 * cannot cost a reading anything.
 */
const MAX_RECORDED_CALLS = 200_000;

/** The methods whose transform is captured beside the call. */
const TRANSFORMED = new Set(["drawImage", "fillText", "strokeText"]);

/**
 * A proxy that records every call and property set on its way to the real context,
 * so one frame produces both a pixel buffer to sample and a call list to inspect.
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

/** One cue the build played, as the engine announced it. */
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
  /** The clock each frame takes its delta from. Defaults to 120 Hz. */
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
  snapshot: SpectraSnapshot;
}

/**
 * How long a wait on the engine's own frame loop may run before it gives up.
 *
 * The bound on `runUntil`, and it is a bound rather than a measurement: the wait
 * ends the moment the build's own reading says what the check is waiting for, so
 * a quiet host leaves it in a fraction of a second and a host running a hundred
 * other jobs simply takes longer to get there. What reaching this bound means is
 * that the loop never ran, which is the failure the point is looking for.
 */
const FREE_RUN_DEADLINE_MS = 30_000;

/** How often the build is asked what its own loop has done, while it holds the clock. */
const FREE_RUN_POLL_MS = 25;

export interface Harness {
  readonly engine: Engine<SpectraState, SpectraSurface>;
  /**
   * The engine's current state, read fresh on every access. Read it, or pose it
   * through `debug`; nothing here can write to it.
   */
  readonly state: DeepReadonly<SpectraState>;
  /**
   * The debug surface the BUILD returned beside its state, driven over the engine:
   * each pose runs through `engine.apply`, each reading is handed `engine.state`.
   *
   * The raw surface is read off `engine.debug` rather than built here — see
   * {@link readDebugSurface} — and {@link driveSurface} is the wrapper.
   */
  readonly debug: SpectraDriver;
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
  /** Every cue the build played, oldest first. */
  readonly cues: PlayedCue[];
  /** Every asset the build failed to load, oldest first. */
  readonly assetFailures: AssetFailure[];

  /** A fresh read of the game's state through the case's `snapshot`. */
  snapshot(): SpectraSnapshot;
  /** Run `frames` frames back to back. */
  advance(frames: number): Promise<void>;
  /**
   * Run whole frames covering at least `duration` seconds of game time.
   *
   * `ticksFor(duration)` frames of the DEFAULT clock. A harness built with a clock
   * of its own advances the frames that clock hands out, so an item that supplied
   * one — `instrumentation.deterministic-core` is the only one that does — counts
   * its own frames with {@link Harness.advance} instead.
   */
  advanceSeconds(duration: number): Promise<void>;
  /** Advance until `predicate` holds, sampling every `poll` frames. */
  until(
    predicate: (snapshot: SpectraSnapshot) => boolean,
    options?: UntilOptions,
  ): Promise<UntilResult>;
  /**
   * Drive the engine's own frame loop for `ms` of real time, then halt it.
   *
   * NO POINT MAY BE SIZED AGAINST THIS. How many frames a loop covers over a
   * stretch of the wall clock is a fact about the machine, not about the build, so
   * a reading taken across a fixed `ms` reaches further on a quiet host than on a
   * busy one. A point that genuinely needs the build's own clock uses `runUntil`,
   * which ends on the build's own reading passing a floor and simply takes longer
   * on a loaded host; a point that needs game time to pass uses `advance`. This is
   * the raw primitive both of those rest on, kept for a caller that wants the loop
   * running and asserts nothing about how far it got.
   */
  runFor(ms: number): Promise<void>;
  /**
   * Drive the engine's own frame loop until `predicate` holds of what the build
   * reports, then halt it, and hand back the state that ended it.
   *
   * The wait a point about the build's own clock runs. Real time passes and
   * nothing steps the game, exactly as `runFor` leaves it, but what ends the wait
   * is the build's own reading rather than a stretch of the wall clock: how many
   * frames a host's frame callback delivers in a given second is a fact about the
   * machine, so a host running a hundred other jobs makes this wait longer
   * instead of making the build look stopped. `deadlineMs` bounds it, and a build
   * whose loop never runs reaches that bound with the predicate still false.
   */
  runUntil(
    predicate: (snapshot: SpectraSnapshot) => boolean,
    options?: { deadlineMs?: number; pollMs?: number },
  ): Promise<SpectraSnapshot>;

  /** Press a key and leave it down, as a player holding it would. */
  hold(code: string): void;
  /** Release a key held by `hold`. */
  release(code: string): void;
  /**
   * Press and release a key, then run the one frame that delivers its edge.
   *
   * The engine discards an edge nothing consumed by the end of the frame it was
   * armed in, so a tap that ran no frame would never reach the game.
   */
  tap(code: string): Promise<void>;

  /** Where a logical point lands in the canvas's backing store. */
  device(x: number, y: number): { x: number; y: number };
  /** Where a logical point lands in CSS pixels, which is where a gesture goes. */
  css(x: number, y: number): { x: number; y: number };
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
    type: "pointerdown" | "pointermove" | "pointerup",
    x: number,
    y: number,
    device?: "mouse" | "touch",
  ): Promise<void>;
  /** The device pixel under a logical point, as `[r, g, b, a]`. */
  pixel(x: number, y: number): [number, number, number, number];

  /** Drop the engine's listeners, release the canvas, and put the host back. */
  dispose(): void;
}

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
 * A `PointerEvent`-shaped event: the engine reads the position, the pointer's id,
 * whether it is primary, the device that drove it, and the buttons it carries.
 *
 * Dispatched at the very target the engine attached its own pointer listeners to,
 * so a gesture reaches the build the way a hand's does: the engine maps the
 * position through the same letterboxed fit the game draws under, and the build
 * reads it off the input reader like any other frame's pointer.
 */
class PointerDispatch extends Event {
  readonly clientX: number;
  readonly clientY: number;
  readonly pointerId: number;
  readonly isPrimary = true;
  readonly pointerType: "mouse" | "touch";
  readonly button: number;
  readonly buttons: number;

  constructor(
    type: "pointerdown" | "pointermove" | "pointerup",
    at: { x: number; y: number },
    device: "mouse" | "touch",
    held: boolean,
  ) {
    super(type);
    this.clientX = at.x;
    this.clientY = at.y;
    // A mouse keeps one id for the life of the page; a touch contact gets its own.
    this.pointerId = device === "mouse" ? 1 : 2;
    this.pointerType = device;
    // `-1` on a move, which is the browser's own "no button reported here".
    this.button = type === "pointermove" ? -1 : 0;
    this.buttons = held ? 1 : 0;
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
 * The debug surface the BUILD returned beside its state, read off the engine that
 * holds it.
 *
 * This is deliberately a READ and never a construction. The surface is the build's
 * deliverable: its `initialize` returns `[state, debug]`
 * (specs/instrumentation.md), the engine keeps the second element, and
 * `engine.debug` is the only way it reaches a validator. Nothing here could stand
 * in for it, because the build's own module for the surface is never imported.
 *
 * By the time this runs `engine.initialize()` has resolved, which is the one
 * precondition `engine.debug` has: it holds whatever the build returned as the
 * pair's second element, and a build that returned no pair at all never gets this
 * far, because the engine rejects `initialize` itself and the rejection fails the
 * suite's `beforeEach` with the engine's own message. Such a build does not run on
 * the engine under any entry point, so it is not this harness's fault to report —
 * which is why every suite's `afterEach` disposes its harness with `?.`: the hook
 * then has nothing to add to that message.
 *
 * What IS decided here is a pair whose second element is no surface — a build that
 * returned `[state, null]`, or something other than an object. That is a fault in
 * the build and not in this harness, so it must not present as one:
 *
 * - It is NOT thrown from here. Every suite builds its harness in a `beforeEach`,
 *   so a throw at this point would fail the hook and bury the real verdict under
 *   the harness's own stack in the case's own file.
 * - It is NOT swallowed either. {@link missingSurface} stands in for the missing
 *   surface and fails, by assertion, at the moment a validator first reaches for an
 *   operation on it — naming the return the build owes.
 *
 * So the harness is built, teardown runs, and the fault lands exactly where
 * specs/instrumentation.md says it should: on the items whose validators reach the
 * game through the surface. A validator that needs no surface is decided on its own
 * merits, and `instrumentation/surface-present` names the missing surface outright.
 */
function readDebugSurface(
  engine: Engine<SpectraState, SpectraSurface>,
): SpectraSurface {
  const surface: unknown = engine.debug;
  if (typeof surface !== "object" || surface === null) {
    return missingSurface(
      `engine.debug holds ${surface === null ? "null" : typeof surface}, ` +
        `not an object`,
    );
  }
  return surface as SpectraSurface;
}

/**
 * A stand-in for the surface a build never returned: every operation on it fails
 * the validator that reached for it, with the missing return named.
 *
 * A proxy rather than a hand-written stub, so a member the specification names and
 * this file has not thought about still reports the missing surface rather than
 * reporting itself merely absent.
 *
 * Keys that belong to the RUNTIME rather than to a validator are answered with
 * `undefined` instead: awaiting the harness probes `then`, and vitest's own error
 * formatting probes symbols and `constructor`. Failing those would replace the
 * verdict below with noise from the machinery that was trying to report it.
 */
function missingSurface(reason: string): SpectraSurface {
  return new Proxy({} as SpectraSurface, {
    get: (_target, property): unknown => {
      if (typeof property === "symbol") return undefined;
      if (property === "then" || property === "constructor") return undefined;
      return fail(SURFACE_REQUIREMENT, reason);
    },
  });
}

/**
 * What the build owes when its surface is missing: the `Expected:` line of the
 * failure every validator that reaches for the surface lands on, beside what
 * `engine.debug` was found holding instead.
 */
const SURFACE_REQUIREMENT =
  "the debug surface src/game.ts's initialize returns beside its state, as " +
  "[state, debug], which the engine hands back from engine.debug " +
  "(specs/instrumentation.md)";

/**
 * The imperative reading of the raw surface, over the engine that holds the state.
 *
 * A proxy, and a lazy one, for the same reason {@link missingSurface} is: the
 * member is read off the raw surface at the moment a validator reaches for it, so a
 * missing surface or a missing operation fails the validator that needed it and
 * never the `beforeEach` that built the harness. A member that is not a function
 * (`version`, or an operation the build left out) comes back as it is, which is
 * what lets `instrumentation/surface-present` test for each operation by `typeof`
 * and what lets an `overload/` suite ask whether `setDroneCharge` is there at all.
 *
 * A reading is called with `engine.state` and its result handed back. A pose is run
 * through `engine.apply`, so the engine stores what it returned and the next
 * frame's `update` receives it; a pose that returns nothing is refused by the
 * engine with a message naming the rule.
 */
function driveSurface(
  engine: Engine<SpectraState, SpectraSurface>,
  raw: SpectraSurface,
): SpectraDriver {
  const readings: readonly string[] = READINGS;
  return new Proxy({} as SpectraDriver, {
    get: (_target, property): unknown => {
      if (typeof property === "symbol") return undefined;
      if (property === "then" || property === "constructor") return undefined;
      const member = (raw as unknown as Record<string, unknown>)[property];
      if (typeof member !== "function") return member;
      const op = member as (
        state: DeepReadonly<SpectraState>,
        ...args: unknown[]
      ) => unknown;
      if (readings.includes(property)) {
        // The state FIRST and the caller's arguments after it, because
        // `menuItemRect(index)` is a reading that takes one of its own and a
        // driver that dropped it would ask every menu for item `undefined`.
        return (...args: unknown[]): unknown =>
          op.call(raw, engine.state, ...args);
      }
      return (...args: unknown[]): void => {
        engine.apply((state) => op.call(raw, state, ...args) as SpectraState);
      };
    },
  });
}

/**
 * The operation named, or a failure naming what the specification requires.
 *
 * For the handful of places a member has to be THERE before it is called: the two
 * members only the overload variant carries (`setDroneCharge`), and
 * {@link poseDrone} when a caller poses a charge. Reaching for a missing operation
 * through the driver hands back `undefined`, and calling that would fail with a
 * type error naming nothing; this fails with the operation named instead.
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
//
// specs/assets.md has the build load its four sprites and its drone-burst through
// the engine's loader, which resolves a path under the fixed `assets/` root,
// relative to the page, and fetches it. There is no page here, so the two globals
// the loader reaches for are stood up over the workspace's own `assets/` tree while
// a harness is alive and put back when it is disposed. Two harnesses may be alive
// at once — an item that compares two seeds builds a second — so the install is
// counted rather than nested, and the originals go back when the last one goes.

/**
 * The directory this harness sits in, which is the validator project's root.
 *
 * Taken from this module's own URL rather than from the working directory, because
 * it has to name the same directory in both layouts this file lives in: the case's
 * own `validation/<engine>/`, and the `validation/` the runner stages that
 * directory to inside the build's tree.
 */
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * The workspace this project is staged into, which is where `assets/` sits.
 *
 * The tree the build was handed, so the seeded art a validator reads is exactly the
 * art the case seeded and the engine's loader resolves `assets/shard.png` to the
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
 * Build an engine over a canvas of the harness's own, initialize the build's game,
 * and hand back everything a validator reads.
 *
 * The options passed to the factory are the ones the seeded `src/main.ts` passes —
 * the design size, the build's exported `BACKGROUND`, and the touch layout — so one
 * harness serves every build of this case. Everything else the build decided lives
 * inside `src/game.ts`.
 *
 * Dispose it in an `afterEach`, with `?.`, so a build whose `initialize` rejected
 * fails with the engine's own message rather than with a teardown error on top of
 * it.
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
  // Under the recorder, so the clear it issues is in no draw-call list and in no
  // captured replay: what a check reads is what the build itself drew.
  const recorded = recorder(clearBeforeCoveringFills(ctx), calls);
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

  const engine = createEngine<SpectraState, SpectraSurface>({
    canvas: element,
    width: STAGE_W,
    height: STAGE_H,
    game,
    // The build's own stage background, handed to the engine exactly as the seeded
    // `src/main.ts` hands it (specs/overview.md).
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

  // Before `initialize`, because that is where the build loads its sprite art and
  // its drone-burst system.
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

    async until(predicate, untilOptions = {}) {
      const maxFrames = untilOptions.maxFrames ?? 600;
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

    async runUntil(predicate, runOptions = {}) {
      const deadline =
        Date.now() + (runOptions.deadlineMs ?? FREE_RUN_DEADLINE_MS);
      const pollMs = Math.max(1, runOptions.pollMs ?? FREE_RUN_POLL_MS);
      const controller = new AbortController();
      const running = engine.run({ signal: controller.signal });
      try {
        let snapshot = debug.snapshot();
        while (!predicate(snapshot) && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, pollMs));
          snapshot = debug.snapshot();
        }
        return snapshot;
      } finally {
        controller.abort();
        await running;
      }
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
    async pointer(type, x, y, device = "mouse") {
      const at = toDevice(engine.viewport(), x, y);
      keys.dispatchEvent(
        new PointerDispatch(
          type,
          { x: at.x / dpr, y: at.y / dpr },
          device,
          type !== "pointerup",
        ),
      );
      await engine.advance(1);
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
// the build itself drew while a validator drove it, kept as evidence a reviewer can
// scrub against the reference implementation's — or an `image`, one frame of it.
// `captureReplay` and `captureStill` are how a validator produces them.
//
// Four properties are what make them usable, and each is deliberate:
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
//    reviewer a replay of nothing.
// 4. THEY COST NOTHING WHEN NOBODY IS COLLECTING. Outside a run — a case author
//    running this suite from a shell — the media directory is unset, and the whole
//    thing is a no-op that still runs the scenario. The suite behaves identically
//    either way, so a validator cannot pass in one place and fail in the other.

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
 * `validation/bands/flip-instant.test.ts` — because that is the path the review
 * item's declared script resolves to, and so the only name the case's manifest and
 * the runner both already agree on.
 */
const STAGED_PROJECT_DIR = "validation";

/**
 * The most frames a written recording holds.
 *
 * A recording is one JSON operation log per frame, and a frame of this game is a
 * few hundred operations — the starfield, both HUD strips, every drone of a
 * formation, every bullet, every live burst — so a section a validator drives for
 * half a minute of game time runs to tens of megabytes: a file nobody can serve to
 * a reviewer and nobody wants in a run's artifacts. The cap is what makes
 * `captureReplay` safe to wrap ANY section in.
 *
 * It is generous enough that the great majority of this suite's sections — a dive,
 * a discharge wave, a Flux cycle, a second of an entrance — are written whole.
 */
const MAX_REPLAY_FRAMES = 300;

/**
 * Where the running suite's `outputId` output belongs, or `null` when nothing is
 * collecting media.
 *
 * The suite is the one vitest is currently running rather than one the caller
 * names, because the two must not be able to disagree: a validator that named its
 * own path would be free to write its evidence under some other point's address.
 *
 * `extension` is the one the runner collects that OUTPUT KIND under — `json.gz` for
 * a recording (a JSON document stored gzipped: `.json` is what the bytes are and
 * `.gz` is how they are framed), `png` for a still. The suite and the runner agree
 * by both stating the same thing about what the kind is.
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
 * Two entries that mean the same thing have to serialize identically for a table to
 * hold one copy of each, and the key order inside an argument the build passed is
 * the build's own business rather than ours.
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
 * DROPPING A FRAME DROPS THE LAST REFERENCE TO WHATEVER ONLY THAT FRAME DREW WITH.
 * The four tables in front of a recording are shared by every frame in it, so
 * carrying them over whole would put operations, states, gradients and images in
 * the file that no surviving frame asks for — dead weight in a document whose whole
 * point is to say each thing once.
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
 * what these outputs are named for. A recording of a wave's entrance is evidence
 * that every group flew in and assembled, and the arrivals are spread across the
 * whole of it.
 *
 * Thinning is legitimate because every frame in a recording is drawable on its own:
 * a frame names the whole of the state it opened with and reaches everything it
 * draws with through tables the recording shares, so dropping the frames between
 * two kept ones cannot leave a frame undrawable. Each kept frame's `deltaMs` is
 * restated as the time since the frame kept before it, so the deltas still sum to
 * the section's elapsed time and a player pacing itself off them runs at the speed
 * the game really ran at. The frame `count` is left as the host reported it, so a
 * reader can see that frames were skipped rather than being told a smooth lie.
 *
 * The last frame is always kept, whatever the stride lands on: it is the frame the
 * validator's sweep stopped at — the kill, the absorb, the stage cleared — and it
 * is the one a reviewer looks at first.
 *
 * Keeping it costs a frame rather than the cap. The stride rounds up, so a section
 * whose length is an exact multiple of the cap strides over exactly that many
 * frames and stops one stride short of the end: the last frame still has to come
 * in, and the cap is a ceiling rather than a target. It takes the place of the final
 * strided frame — the frame nearest it, so the swap opens the smallest gap
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
      // Drop the frame it stopped on, and put the moment back to the one before it:
      // a kept frame's restated delta is measured from exactly that moment, so
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
 * draw, and a file holding an empty frame list would be collected as an output that
 * turned up — the run would tell the reviewer there is a replay to watch and the
 * player would open on nothing. A declared output that never turned up is already
 * reported as absent, and that is the truthful reading of a section that drew no
 * frames.
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
    console.warn(`spectra: could not write ${destination}: ${String(error)}`);
  }
}

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
export function captureStill(h: Harness, outputId: string): void {
  const destination = mediaDestination(outputId, "png");
  if (destination === null) return;
  try {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, h.canvas.toBuffer("image/png"));
  } catch (error) {
    console.warn(`spectra: could not write ${destination}: ${String(error)}`);
  }
}

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

/** The distance between two reported centres, in logical units. */
export function distance(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
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
 * reset: the seed and the art are already as a run finds them. A validator that
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
 * The engine publishes `cue:played` synchronously from inside `audio.play`, so the
 * handler runs while the frame that played it is still running and
 * `engine.frame().count` is that frame's own number. That is what lets a validator
 * assert not merely that a cue sounded but that it sounded on the frame of the
 * event — which is what tells a build that plays a cue on the right event apart from
 * one that plays it on every frame, or a frame late.
 *
 * The cue NAMES are `CUES` in `constants.ts`; specs/ui.md says which event each
 * one belongs to, and states the mute rule these readings turn on: while sound is
 * muted the game starts no sound at all, so a muted cue reaches the bus not at all
 * rather than reaching it at zero gain.
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
 * Substring rather than equality on purpose: the copy a validator asserts is the
 * case's own, but how a build presents it is the build's, and a menu entry is
 * commonly drawn with a selection marker or padding around it. Requiring the exact
 * run would fail a screen that shows precisely the right words.
 */
export function drewText(calls: readonly DrawCall[], text: string): boolean {
  const wanted = text.trim().toLowerCase();
  return drawnText(calls).some((drawn) => drawn.toLowerCase().includes(wanted));
}

/** One run of text a frame drew, and the logical x range its glyphs span. */
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
 * A build may anchor its text through any `translate`/`scale` it likes and align it
 * any way it likes, so the anchor is mapped through the transform the context held
 * at the call and the run is extended about it by its measured width and
 * `textAlign`. Which way a `start`/`end` alignment reads is the page's direction;
 * this game draws no right-to-left text, so they are left and right.
 *
 * This is how the HUD items decide WHERE a reading was drawn — which strip it sits
 * in, which half of the strip, whether it clears the play field.
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
    const lx = dx + dw / 2;
    const ly = dy + dh / 2;
    const deviceX = m.a * lx + m.c * ly + m.e;
    const deviceY = m.b * lx + m.d * ly + m.f;
    drawn.push({
      source,
      x: (deviceX - view.offsetX) / view.scale,
      y: (deviceY - view.offsetY) / view.scale,
      w: Math.abs(dw * Math.hypot(m.a, m.b)) / view.scale,
      h: Math.abs(dh * Math.hypot(m.c, m.d)) / view.scale,
      // A negative determinant is a flip, whichever axis the build wrote it on.
      mirrored: m.a * m.d - m.b * m.c < 0,
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

/** A sampled colour, each channel 0–255. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** A rectangle of the stage, in logical units, by its top-left corner. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The rendered colour at a logical point, averaged over a small cluster.
 *
 * The centre pixel plus four neighbours 3 units out, which stay well inside even
 * the smallest drawn body — a Shard is `SHARD_SIZE` (`28`) across — so one stray
 * anti-aliased or glow pixel cannot swing the reading.
 */
export function sampleColor(h: Harness, x: number, y: number): Rgb {
  const offsets: readonly (readonly [number, number])[] = [
    [0, 0],
    [3, 0],
    [-3, 0],
    [0, 3],
    [0, -3],
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

/** Euclidean distance between two colours, 0 to about 441. */
export function colorDistance(a: Rgb, b: Rgb): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
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

/** A rectangle of the canvas, read once, in device pixels. */
export interface Region {
  width: number;
  height: number;
  /** RGBA, four channels per pixel, row-major. */
  data: Uint8ClampedArray;
}

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

/** The colour of one pixel of a region already read. */
export function pixelAt(region: Region, x: number, y: number): Rgb {
  const at = (y * region.width + x) * 4;
  return { r: region.data[at], g: region.data[at + 1], b: region.data[at + 2] };
}

/**
 * How many pixels of `region` sit further than `minDistance` from `colour`.
 *
 * The plain count, for an item that asks whether ANYTHING was painted over a
 * stretch of field. {@link countMarks} is what asks how many separate things were.
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
 * The fill is repeated rather than applied once so a translucent colour reads as the
 * engine leaves it: the engine composites its clear over the previous frame every
 * frame, which converges on the colour's own channels, and a single fill over a
 * transparent canvas would not.
 */
export function clearColor(): Rgb {
  const probe = createCanvas(1, 1);
  const ctx = probe.getContext("2d");
  ctx.fillStyle = BACKGROUND;
  for (let i = 0; i < 255; i += 1) ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
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

/** The middle of a hit region: where a gesture aimed at that item lands. */
export function rectCenter(rect: MenuRect): { x: number; y: number } {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
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
