// Meltdown — the shared validator harness. CASE-PROVIDED.
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
// ARRANGE the floor through the debug surface, and the real `update` the build
// wrote is what runs from there.
//
// WHY THE DEBUG SURFACE RATHER THAN RAW ASSIGNMENT. specs/instrumentation.md fixes
// its operations, so they mean the same thing in every build: `addTower` costs
// nothing and runs no placement check, `removeTower` pays no refund, a faculty
// gate stays off until something turns it back on, and `reset` gives everything
// back. Posing through it is how a scenario is reproducible, and it is the seam
// the case's specification documents. `surface.ts` is that specification as types,
// and it is the only description of the surface this harness reads: the build's
// own module for it is never imported.
//
// THE ATOM AND THE ACT. The surface carries both, and the distinction is
// load-bearing. An ATOM poses one field with no side effect — `addTower`,
// `removeTower`, `setTowerLevel`, `removeUnit` — and is what a scenario is built
// from. An ACT is a single indivisible thing a player does, running through the
// game's own code with every consequence specs/building.md gives it — `place`,
// `upgradeTower`, `sellTower`. A check that merely wants a tower gone calls
// `removeTower`; a check about what selling does calls `sellTower`. No helper
// below reaches an act on the way to a scenario the act is not about.
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
// (`surface.ts`). A check still writes `h.debug.setTowerHeat(id, 60)` and
// `h.debug.snapshot()`, because `h.debug` is a {@link Driver} over the raw
// surface: it runs each pose through `engine.apply` and hands each reading
// `engine.state`. Nothing a check does holds a writable state — `h.state` is the
// runtime's current value, read fresh on every access, and the only way to change
// it is a pose.
//
// THE HARNESS SUPPLIES THE CLOCK, NOT THE GAME. `ConstantClock(TICK_MS)` is the
// default, so one frame is one 120 Hz tick and every duration below is a whole
// number of them. That is why `[instrumentation]` carries no `tick_hz`: Meltdown
// mandates no fixed timestep, every rate is per second and integrated against the
// delta the frame hands the game, and the SUITE is what fixes a step so a
// tolerance can be stated in ticks and mean the same thing on every machine. A
// check that is specifically about the step size — `heat.two-phase-resolution`
// takes one frame of `1/30` s — builds its own harness with a clock of its own.
//
// AND IT CAN HAND THE CLOCK BACK. `createRealtimeHarness` builds one over a
// `WallClock`, and {@link Harness.runFor} then runs the engine's own frame loop
// for a stretch of REAL time. That is what a check about whether time passes at
// all needs — see THE CLOCK RULE below.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { createCanvas, type Canvas, type SKRSContext2D } from "@napi-rs/canvas";
import { expect } from "vitest";
import {
  ConstantClock,
  WallClock,
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
  BUILD_PHASE_TIME,
  DIFFICULTY_TABLE,
  LAYOUT,
  MODE_TABLE,
  STAGE_H,
  STAGE_W,
  TILE,
  TRIP_TIME,
  tileCX,
  tileCY,
} from "../src/constants";
import { BACKGROUND, game as build, type MeltdownState } from "../src/game";
import { fail } from "./assert";
import {
  footprintCentreOf,
  sizeOf,
  tileCentre,
  type Point,
  type Tile,
} from "./geometry";
import {
  READINGS,
  type BuildSnapshot,
  type ControlsSnapshot,
  type DifficultyName,
  type ExhaustName,
  type Face,
  type MeltdownDebugApi,
  type MeltdownSnapshot,
  type ModeName,
  type Phase,
  type RectSnapshot,
  type Screen,
  type ShopRectSnapshot,
  type SurgeType,
  type TowerSnapshot,
  type TowerType,
  type UnitSnapshot,
  type VentName,
} from "./surface";

export type {
  BuildSnapshot,
  ControlsSnapshot,
  DifficultyName,
  ExhaustName,
  Face,
  MeltdownSnapshot,
  ModeName,
  Phase,
  Point,
  RectSnapshot,
  Screen,
  ShopRectSnapshot,
  SurgeType,
  Tile,
  TowerSnapshot,
  TowerType,
  UnitSnapshot,
  VentName,
};

/** The case's surface, bound to the state type the build declared. */
export type MeltdownSurface = MeltdownDebugApi<MeltdownState>;

/**
 * The build's game, typed against the surface the CASE specifies.
 *
 * The build declares its own type for the surface its `initialize` returns, and
 * that type is the build's: what a check holds it to is `surface.ts`, so the game
 * is cast to the case's `Game<MeltdownState, MeltdownSurface>` here and the
 * runtime is parameterized with it. A surface that departs from the specification
 * is caught where a check reaches for the missing member, not by the build's own
 * compiler.
 */
const game = build as unknown as Game<MeltdownState, MeltdownSurface>;

/**
 * A member of a pure surface, as a check calls it.
 *
 * A pose `(state, ...args) => S` becomes `(...args) => void`: the driver runs it
 * through `engine.apply`, so the state it returns is the state the next frame
 * receives. A reading `(state) => R` becomes `() => R`: the driver hands it
 * `engine.state`. Anything else (`version`) is carried as it is.
 */
type Driven<S, M> = M extends (state: DeepReadonly<S>, ...args: infer A) => S
  ? (...args: A) => void
  : M extends (state: DeepReadonly<S>) => infer R
    ? () => R
    : M;

/**
 * The imperative reading of a pure surface: every member of `D`, minus its state
 * argument, over the runtime that holds the state.
 */
export type Driver<S, D> = {
  [K in keyof D]: Driven<S, NonNullable<D[K]>>;
};

/** The surface as every check drives it. */
export type MeltdownDriver = Driver<MeltdownState, MeltdownSurface>;

/* -------------------------------------------------------------------------- */
/* The clock                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The frame the suite steps in, in milliseconds.
 *
 * This is the SUITE's choice, not the game's: `src/constants.ts` deliberately
 * fixes no timestep, because the runtime hands the game whatever elapsed time a
 * frame really took. Fixing it here makes a duration a whole number of frames, so
 * a tolerance can be stated in ticks and mean the same thing on every machine.
 *
 * 120 Hz divides every figure this case is timed against finely enough to read a
 * threshold rather than a rounding: the wave spawner's `0.6` s cadence is 72
 * ticks, the trip's `5.0` s cooldown is 600, a `15` s build phase is 1800, and
 * the fastest emitter's `1 / 7` s fire interval is a shade over 17.
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
 * Rounded UP, so a hold stated in seconds always covers the whole of it; a check
 * that needs the exact elapsed time asserts against `seconds(ticksFor(d))` rather
 * than against `d`.
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
 * A rectangle and a text run carry the transform the context held at the call as
 * well, because a build draws a tower by translating to its footprint centre and
 * drawing about the origin, so the destination arguments alone say nothing about
 * where it landed. {@link drawnRects} and {@link drawnTextSpans} are what map one
 * back to logical units.
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
 * reads it or not, and this case's longest sweeps run tens of thousands of frames
 * of a floor drawing a 50x36 grid, a build panel and a roster of towers each, so
 * an uncapped list would be hundreds of megabytes in a check that never looks at
 * it. Past the cap the oldest half is dropped, which is far beyond any single
 * frame and so cannot cost a reading anything.
 */
const MAX_RECORDED_CALLS = 200_000;

/** The methods whose transform is captured beside the call. */
const TRANSFORMED = new Set([
  "drawImage",
  "fillText",
  "strokeText",
  "fillRect",
  "strokeRect",
  "clearRect",
]);

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
  snapshot: MeltdownSnapshot;
}

export interface Harness {
  readonly engine: Engine<MeltdownState, MeltdownSurface>;
  /**
   * The runtime's current state, read fresh on every access. Read it, or pose it
   * through `debug`; nothing here can write to it.
   */
  readonly state: DeepReadonly<MeltdownState>;
  /**
   * The debug surface the BUILD returned beside its state, driven over the
   * runtime: each pose runs through `engine.apply`, each reading is handed
   * `engine.state`.
   *
   * The raw surface is read off `engine.debug` rather than built here — see
   * {@link readDebugSurface} — and {@link driveSurface} is the wrapper.
   */
  readonly debug: MeltdownDriver;
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
  /**
   * Whether this harness's frames are worth the REAL time they took.
   *
   * False for the default `ConstantClock` harness, true for one built by
   * {@link createRealtimeHarness}. {@link overRealWindow} reads it, so a check
   * that measures a real window on a harness that has no real clock is told so
   * rather than quietly measuring nothing.
   */
  readonly realtime: boolean;

  /** A fresh read of the game's state through the case's `snapshot`. */
  snapshot(): MeltdownSnapshot;
  /** Run `frames` frames back to back. */
  advance(frames: number): Promise<void>;
  /** Advance until `predicate` holds, sampling every `poll` frames. */
  until(
    predicate: (snapshot: MeltdownSnapshot) => boolean,
    options?: UntilOptions,
  ): Promise<UntilResult>;
  /**
   * HAND THE CLOCK BACK TO THE BUILD: drive the runtime's own frame loop for `ms`
   * of REAL time, then halt it.
   *
   * Nothing steps the game while this runs. The loop schedules its own frames and
   * the clock measures them, exactly as it does in a browser, so what the floor
   * did over the window is what the floor does when a player is watching it. See
   * THE CLOCK RULE below for when a check must use this and when `advance` is the
   * same thing.
   */
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

  /**
   * Report a pointer event to the ENGINE's own pointer input, at a logical stage
   * position.
   *
   * The path a player's finger takes. The debug surface's `pointerDown`,
   * `pointerMove` and `pointerUp` resolve the same interaction at the call, which
   * is what a check about the interaction's RESULT uses; this is what a check
   * about a CUE uses, because a cue is raised by the frame that resolves the
   * event and no operation of the surface can play one.
   */
  point(type: "down" | "move" | "up", x: number, y: number): void;

  /** Where a logical point lands in the canvas's backing store. */
  device(x: number, y: number): { x: number; y: number };
  /** The device pixel under a logical point, as `[r, g, b, a]`. */
  pixel(x: number, y: number): [number, number, number, number];

  /** Drop the runtime's listeners and release the canvas. */
  dispose(): void;
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

/**
 * A `PointerEvent`-shaped event: the runtime reads `clientX`, `clientY` and
 * `isPrimary`, and narrows structurally, so a plain `Event` carrying them drives
 * the pointer exactly as a real one does.
 */
class PointEvent extends Event {
  readonly clientX: number;
  readonly clientY: number;
  readonly isPrimary = true;

  constructor(type: string, clientX: number, clientY: number) {
    super(type);
    this.clientX = clientX;
    this.clientY = clientY;
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
function readDebugSurface(
  engine: Engine<MeltdownState, MeltdownSurface>,
): MeltdownSurface {
  const surface: unknown = engine.debug;
  if (typeof surface !== "object" || surface === null) {
    return missingSurface(
      `engine.debug holds ${surface === null ? "null" : typeof surface}, ` +
        `not an object`,
    );
  }
  return surface as MeltdownSurface;
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
function missingSurface(reason: string): MeltdownSurface {
  return new Proxy({} as MeltdownSurface, {
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
  engine: Engine<MeltdownState, MeltdownSurface>,
  raw: MeltdownSurface,
): MeltdownDriver {
  const readings: readonly string[] = READINGS;
  return new Proxy({} as MeltdownDriver, {
    get: (_target, property): unknown => {
      if (typeof property === "symbol") return undefined;
      if (property === "then" || property === "constructor") return undefined;
      const member = (raw as unknown as Record<string, unknown>)[property];
      if (typeof member !== "function") return member;
      const op = member as (
        state: DeepReadonly<MeltdownState>,
        ...args: unknown[]
      ) => unknown;
      if (readings.includes(property)) {
        return (): unknown => op.call(raw, engine.state);
      }
      return (...args: unknown[]): void => {
        engine.apply((state) => op.call(raw, state, ...args) as MeltdownState);
      };
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Building one                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The validator project's own root, taken from this module's own URL rather than
 * from the working directory, because it has to name the same directory in both
 * layouts this file lives in: the case's own `validation/<engine>/`, and the
 * `validation/` the runner stages that directory to inside the build's tree.
 */
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * Build a runtime over a canvas of the harness's own, initialize the build's game,
 * and hand back everything a check reads.
 *
 * The options passed to the factory are the ones the seeded `src/main.ts` passes —
 * the design size, the build's exported `BACKGROUND`, and the touch layout — so
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
  const clock = options.clock ?? new ConstantClock(TICK_MS);

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

  const events = new EventTarget();
  const surface: SurfaceMetrics = {
    cssWidth: () => cssWidth,
    cssHeight: () => cssHeight,
    dpr: () => dpr,
    events: () => events,
  };

  const engine = createEngine<MeltdownState, MeltdownSurface>({
    canvas: element,
    width: STAGE_W,
    height: STAGE_H,
    game,
    // The build's own stage background, handed to the engine exactly as the
    // seeded `src/main.ts` hands it (specs/overview.md).
    background: BACKGROUND,
    layout: LAYOUT,
    clock,
    surface,
  });

  // Subscribed BEFORE `initialize`, which is what makes the game's own opening
  // observable: construction runs no game code, so nothing has happened yet.
  const cues: PlayedCue[] = [];
  engine.events.on("cue:played", (played) => {
    cues.push(played);
  });

  await engine.initialize();
  const debug = driveSurface(engine, readDebugSurface(engine));

  let disposed = false;
  const dispatch = (type: "keydown" | "keyup", code: string): void => {
    events.dispatchEvent(new KeyEvent(type, code));
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
    realtime: clock instanceof WallClock,

    snapshot: () => debug.snapshot(),

    advance: (frames) => engine.advance(frames),

    async until(predicate, untilOptions = {}) {
      const maxFrames = untilOptions.maxFrames ?? 1200;
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

    point: (type, x, y) => {
      const at = toDevice(engine.viewport(), x, y);
      events.dispatchEvent(
        new PointEvent(`pointer${type}`, at.x / dpr, at.y / dpr),
      );
    },

    device: (x, y) => toDevice(engine.viewport(), x, y),
    pixel: (x, y) => {
      const point = toDevice(engine.viewport(), x, y);
      const { data } = ctx.getImageData(point.x, point.y, 1, 1);
      return [data[0], data[1], data[2], data[3]];
    },

    dispose: () => {
      if (disposed) return;
      disposed = true;
      engine.destroy();
    },
  };

  return harness;
}

/**
 * A harness whose frames are worth the REAL time they took: the same runtime over
 * a `WallClock`, which is the clock a shipped game runs under.
 *
 * Build one for a check governed by THE CLOCK RULE below, and spend its windows
 * with {@link Harness.runFor} or {@link overRealWindow}. `advance` still works on
 * it and still runs whole frames, but each is worth however long the call took, so
 * a check that wants an exact quantity of game time uses the default harness
 * instead.
 */
export function createRealtimeHarness(
  options: Omit<HarnessOptions, "clock"> = {},
): Promise<Harness> {
  return createHarness({ ...options, clock: new WallClock() });
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
//    check that poses a maze and then releases a wave against it records the
//    crossing; the pose costs nothing, and the reviewer is not asked to scrub past
//    a minute of arrangement to reach the seconds that decide the point. ARM IT
//    NARROWLY. A frame of this game redraws a 50x36 grid, the casing, every tower
//    and the whole build panel; the recorder holds 16 MB of captured image bytes
//    before new captures degrade to an opaque marker, so a recording armed around
//    a whole scenario buys a reviewer nothing and can cost the frames the check
//    was about.
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
 * `validation/waves/pause-freezes-the-floor.test.ts` — because that is the path
 * the review item's declared script resolves to, and so the only name the case's
 * manifest and the runner both already agree on.
 */
const STAGED_PROJECT_DIR = "validation";

/**
 * The most frames a written recording holds.
 *
 * A recording is one JSON operation log per frame, and a frame of this game is a
 * few thousand operations — the tile grid, the casing, every tower, every unit,
 * the whole panel — so a section a check drives for half a minute of game time
 * runs to tens of megabytes: a file nobody can serve to a reviewer and nobody
 * wants in a run's artifacts. The cap is what makes `captureReplay` safe to wrap
 * ANY section in.
 *
 * It is generous enough that the great majority of this suite's sections — a
 * paused window, a trip cooldown, a wave crossing a maze — are written whole.
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
 * what these outputs are named for. A recording of a wave crossing a maze is
 * evidence that it wound the whole way through, and the turns are spread across
 * the whole of it.
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
 * check's sweep stopped at — the trip, the clear, the leak — and it is the one a
 * reviewer looks at first.
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
    console.warn(`meltdown: could not write ${destination}: ${String(error)}`);
  }
}

/**
 * Record the frames `scenario` draws and keep them as the review item's
 * `outputId` output, handing back whatever the scenario returned.
 *
 * Wrap the drive, not the arrangement:
 *
 * ```ts
 * const swept = await captureReplay(h, "cooldown", () =>
 *   h.until((s) => !towerOf(s, id).tripped, { maxFrames: ticksFor(6) }),
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
 * PICTURE rather than a stretch of motion: the maze a placement left behind, which
 * screen the game opened on, what the build panel read. A recording of a still
 * floor would be the same frame three hundred times over.
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
    console.warn(`meltdown: could not write ${destination}: ${String(error)}`);
  }
}

/* -------------------------------------------------------------------------- */
/* Reading a snapshot                                                         */
/* -------------------------------------------------------------------------- */
//
// The snapshot is plain data, so most readings are a field access and belong in
// the check that makes them. What is here is the handful a check would otherwise
// write out every time: finding an entity by the id a pose handed back, and the
// panel rectangle a press is aimed at.
//
// EVERY LOOK-UP BY ID FAILS RATHER THAN RETURNING NOTHING. A check holds an id
// because a pose put an entity on the floor and the snapshot reported it; an id
// that is no longer there is the build having lost the entity, which is a verdict
// and not an absent value for the check to reason about. So these fail by
// assertion, naming what the surface promised, and the check reads the entity on
// the next line.

/** The tower with that id, or the failure that it is gone. */
export function towerOf(snapshot: MeltdownSnapshot, id: number): TowerSnapshot {
  const found = snapshot.towers.find((tower) => tower.id === id);
  if (found === undefined) {
    fail(
      `a tower with id ${id} in snapshot().towers, which an entity keeps for ` +
        `its whole life (specs/instrumentation.md, Identity)`,
      snapshot.towers.map((tower) => tower.id),
    );
  }
  return found;
}

/**
 * The tower a pose most recently appended.
 *
 * An entity added through the surface is appended to its roster, so it is the
 * last entry and its id is read from there (specs/instrumentation.md, Identity).
 */
export function lastTower(snapshot: MeltdownSnapshot): TowerSnapshot {
  const last = snapshot.towers[snapshot.towers.length - 1];
  if (last === undefined) {
    fail(
      "a tower appended to snapshot().towers by the pose that just ran " +
        "(specs/instrumentation.md, Identity)",
      "no towers on the floor",
    );
  }
  return last;
}

/** The surge unit with that id, or the failure that it is gone. */
export function unitOf(snapshot: MeltdownSnapshot, id: number): UnitSnapshot {
  const found = snapshot.surge.find((unit) => unit.id === id);
  if (found === undefined) {
    fail(
      `a unit with id ${id} in snapshot().surge, which an entity keeps for ` +
        `its whole life (specs/instrumentation.md, Identity)`,
      snapshot.surge.map((unit) => unit.id),
    );
  }
  return found;
}

/** The surge unit a pose most recently appended. */
export function lastUnit(snapshot: MeltdownSnapshot): UnitSnapshot {
  const last = snapshot.surge[snapshot.surge.length - 1];
  if (last === undefined) {
    fail(
      "a unit appended to snapshot().surge by the pose that just ran " +
        "(specs/instrumentation.md, Identity)",
      "no units on the floor",
    );
  }
  return last;
}

/** Whether the floor still carries a tower with that id. */
export function hasTower(snapshot: MeltdownSnapshot, id: number): boolean {
  return snapshot.towers.some((tower) => tower.id === id);
}

/** Whether the floor still carries a unit with that id. */
export function hasUnit(snapshot: MeltdownSnapshot, id: number): boolean {
  return snapshot.surge.some((unit) => unit.id === id);
}

/** The centre of a panel control's reported hit rectangle. */
export function centreOf(rect: RectSnapshot): Point {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/** The shop entry that arms `type`, or the failure that the panel has none. */
export function shopEntry(
  controls: ControlsSnapshot,
  type: TowerType,
): ShopRectSnapshot {
  const found = controls.shop.find((entry) => entry.type === type);
  if (found === undefined) {
    fail(
      `a shop entry for ${type} in snapshot().controls.shop, one per tower ` +
        `type in shop order (specs/hud.md)`,
      controls.shop.map((entry) => entry.type),
    );
  }
  return found;
}

/** The centre of a tower's footprint, from the tile it is anchored at. */
export function towerCentre(tower: TowerSnapshot): Point {
  return footprintCentreOf(tower.type, tower.col, tower.row);
}

/**
 * The distance from a tower's footprint centre to a point, in TILES — the
 * measure range is stated in (specs/combat.md).
 */
export function tileDistance(from: Point, to: Point): number {
  return Math.hypot(to.x - from.x, to.y - from.y) / TILE;
}

/* -------------------------------------------------------------------------- */
/* Scenario helpers                                                           */
/* -------------------------------------------------------------------------- */
//
// Each of these poses a situation through the debug surface and then lets the real
// simulation run. THEY FIX ONLY GEOMETRY: which tile a tower is anchored on, which
// vent a unit entered at, where a target stands. Every threshold a check asserts
// is stated in the check itself, derived from the figure specs/ fixes for it,
// because a helper that carried the tolerance would hide what the check is really
// asserting.
//
// The debug surface is atomic by design (specs/instrumentation.md), so every
// compound sequence lives here. A check that needs all of a sequence calls the
// helper; a check that needs only part of it calls the operations it needs.
// Nothing a check does not ask for happens.

/** The money a run on this pair opens with (specs/modes.md). */
export function startMoneyOf(
  mode: ModeName,
  difficulty: DifficultyName,
): number {
  return MODE_TABLE[mode].startMoney ?? DIFFICULTY_TABLE[difficulty].money;
}

/** The lives a run on this mode opens with (specs/modes.md). */
export function startLivesOf(mode: ModeName): number {
  return MODE_TABLE[mode].startLives;
}

/** The waves a run on this pair fights (specs/modes.md). */
export function waveCountOf(
  mode: ModeName,
  difficulty: DifficultyName,
): number {
  return MODE_TABLE[mode].waveCount ?? DIFFICULTY_TABLE[difficulty].waves;
}

/**
 * Open live play on an EMPTY, QUIET floor: a `building` phase of wave 1, with the
 * run's own release of surge off.
 *
 * This is the ground almost every check in this suite stands on, and both halves
 * of it are load-bearing.
 *
 * EMPTY is safe because of the wave-clear rule: a wave clears on the transition in
 * which its last unit goes, so a phase that never released one never clears
 * (specs/waves.md). A check therefore poses exactly the entities its requirement
 * concerns and nothing else, rather than keeping a bystander unit alive to hold
 * the wave open.
 *
 * QUIET is the world gate. With `waveSpawning` off, the build timer's automatic
 * start of the next wave and the spawner's release of `wavePending` are both held,
 * so nothing the scenario did not ask for arrives — and the timer this helper
 * poses would otherwise run out mid-scenario and release a wave across whatever
 * the check was measuring.
 *
 * TURNING THE GATE BACK ON IS THE EXCEPTION, AND THE ITEM THAT DOES IT IS THE ITEM
 * WHOSE REQUIREMENT THE GATE IS — the two `instrumentation` gate items, the
 * `surge` release items, and the `waves` items about the opening phase, the
 * auto-start, the send and the clear. Any other check that finds itself needing it
 * has been mis-posed; re-pose it rather than turning it on.
 *
 * The money and the lives are the figures `specs/modes.md` derives for the pair,
 * read from the case's own seeded table rather than from the snapshot, so a build
 * that derives them wrongly fails the `modes` items alone and every other check
 * still stands on the floor it asked for.
 *
 * It poses and returns; it runs no frame. A check advances the frames its own
 * reading needs.
 */
export function startRun(
  h: Harness,
  mode: ModeName = "containment",
  difficulty: DifficultyName = "medium",
): void {
  h.debug.reset();
  h.debug.setMode(mode);
  h.debug.setDifficulty(difficulty);

  h.debug.clearTowers();
  h.debug.clearSurge();

  h.debug.setScreen("playing");
  h.debug.setPhase("building");
  h.debug.setWave(1);
  h.debug.setBuildTimer(BUILD_PHASE_TIME);
  h.debug.setWavePending(0);
  h.debug.setWaveSpawning(false);

  h.debug.setMoney(startMoneyOf(mode, difficulty));
  h.debug.setLives(startLivesOf(mode));
  h.debug.setScore(0);

  h.debug.setSelected(null);
  h.debug.setHoverShop(null);
  h.debug.setArmed(null);
  h.debug.setSpeed(1);
}

/**
 * Pose one tower of `type`, footprint top-left at `(col, row)`, and report its id.
 *
 * The ATOM: `addTower` costs nothing, spends nothing and runs no placement check,
 * so a posed floor is never limited by the economy or by the build zone. It starts
 * at heat `0`, level `1`, not tripped, fresh, with both faculties on
 * (specs/instrumentation.md). A check about what PLACING does uses `setArmed`,
 * `setPreview` and `place` instead.
 */
export function poseTower(
  h: Harness,
  type: TowerType,
  col: number,
  row: number,
  rotation = 0,
): number {
  h.debug.addTower(type, col, row, rotation);
  return lastTower(h.snapshot()).id;
}

/**
 * The thermal-scenario atom: one tower at `heat`, with its guns held.
 *
 * `setTowerFiring(id, false)` holds the targeting, the shot, its damage and the
 * `heatPerShot` it would add, and leaves the thermal model running exactly as an
 * idle tower's (specs/instrumentation.md). So what moves this tower's heat over a
 * window is air, conduction and the movers alone, which is what `thermal.ts`
 * computes.
 */
export function poseIdleTower(
  h: Harness,
  type: TowerType,
  col: number,
  row: number,
  rotation = 0,
  heat = 0,
): number {
  const id = poseTower(h, type, col, row, rotation);
  h.debug.setTowerFiring(id, false);
  h.debug.setTowerHeat(id, heat);
  return id;
}

/**
 * The combat-scenario atom: one tower firing at a heat that cannot drift.
 *
 * `setTowerThermal(id, false)` pins the heat where it was posed while the tower
 * goes on acquiring targets, firing at its rate, and dealing its damage at that
 * heat (specs/instrumentation.md). So a damage figure a check reads is
 * `baseDamage * heatMultiplier(heat, redline)` at exactly the heat it asked for,
 * rather than at whatever the tower had cooled to by the time the shot landed.
 */
export function posePinnedTower(
  h: Harness,
  type: TowerType,
  col: number,
  row: number,
  heat: number,
  rotation = 0,
): number {
  const id = poseTower(h, type, col, row, rotation);
  h.debug.setTowerThermal(id, false);
  h.debug.setTowerHeat(id, heat);
  return id;
}

/**
 * The already-tripped atom: one tower offline on a trip, with `timer` seconds of
 * cooldown left.
 *
 * The trip is a CROSSING, not a value: a tower posed at `100` and cooling does not
 * trip (specs/heat.md). So every trip item except the one about the crossing
 * itself poses the tripped state directly rather than trying to manufacture it.
 */
export function poseTrippedTower(
  h: Harness,
  type: TowerType,
  col: number,
  row: number,
  heat = 100,
  timer = TRIP_TIME,
  rotation = 0,
): number {
  const id = poseTower(h, type, col, row, rotation);
  h.debug.setTowerTripped(id, true);
  h.debug.setTowerTripTimer(id, timer);
  h.debug.setTowerHeat(id, heat);
  return id;
}

/**
 * A stationary, effectively unkillable target standing on tile `(col, row)`, and
 * its id.
 *
 * The combat-scenario counterpart to {@link posePinnedTower}: motion off so it
 * stays in range for the whole window, and an hp ceiling far past anything a
 * window of shots removes, so what a check reads is the DAMAGE DEALT rather than
 * the moment the target died. A check about a kill poses the hp the kill needs.
 *
 * It enters at the left vent, because a unit's vent is fixed by where it entered
 * and `addUnit` takes one; the position is then posed outright, and the vent only
 * decides which exhaust its route runs to.
 */
export function poseTarget(
  h: Harness,
  type: SurgeType,
  col: number,
  row: number,
  hp = 1e6,
  vent: VentName = "left",
): number {
  h.debug.addUnit(type, vent);
  const id = lastUnit(h.snapshot()).id;
  const at = tileCentre(col, row);
  h.debug.setUnitPosition(id, at.x, at.y);
  h.debug.setUnitMotion(id, false);
  h.debug.setUnitMaxHp(id, hp);
  h.debug.setUnitHp(id, hp);
  return id;
}

/**
 * One unit walking the floor from `vent`, exactly as the spawner released it, and
 * its id.
 *
 * Motion on, hp as the type and the current wave give it, its exhaust the fixed
 * opposite of the vent (specs/surge.md, specs/mazing.md).
 */
export function poseWalker(
  h: Harness,
  type: SurgeType,
  vent: VentName = "left",
): number {
  h.debug.addUnit(type, vent);
  return lastUnit(h.snapshot()).id;
}

/**
 * Box a tower in: one tower of the named type against each face named, and their
 * ids by face.
 *
 * The thermal-blanket arrangement. An edge-tile facing another tower sheds nothing
 * to air (specs/heat.md), so a tower boxed on all four faces sheds nothing at all
 * and only the movers among its neighbours can move its heat. Naming fewer than
 * four faces boxes fewer than four.
 *
 * Each neighbour is centred on the face it covers, so its own faces do not reach
 * round the corner onto another neighbour's. THAT IS ONLY TRUE WHILE EVERY
 * NEIGHBOUR IS NO LARGER THAN THE TOWER IT BOXES: a bigger neighbour overhangs the
 * corner and abuts the neighbour on the next face, which would put a conduction
 * term in the scenario nobody asked for. This throws rather than posing that
 * floor, because it is a fault in the check and not a verdict about the build.
 */
export function boxIn(
  h: Harness,
  id: number,
  types: Partial<Record<Face, TowerType>>,
): Partial<Record<Face, number>> {
  const target = towerOf(h.snapshot(), id);
  const size = sizeOf(target.type);
  const placed: Partial<Record<Face, number>> = {};
  for (const [face, type] of Object.entries(types) as [Face, TowerType][]) {
    const side = sizeOf(type);
    if (side > size) {
      throw new Error(
        `meltdown harness.ts: boxIn cannot put a ${side}x${side} ${type} on ` +
          `the ${face} face of a ${size}x${size} ${target.type} without it ` +
          `abutting the neighbour on the next face; box it with a tower no ` +
          `larger than the one it boxes`,
      );
    }
    const along = Math.floor((size - side) / 2);
    const at =
      face === "N"
        ? { col: target.col + along, row: target.row - side }
        : face === "S"
          ? { col: target.col + along, row: target.row + size }
          : face === "W"
            ? { col: target.col - side, row: target.row + along }
            : { col: target.col + size, row: target.row + along };
    placed[face] = poseTower(h, type, at.col, at.row);
  }
  return placed;
}

/**
 * Hold every key in `codes` for `ticks` frames, then release them.
 *
 * Nothing here poses anything: the keys go to the engine's own input, so the game
 * answers them exactly as it answers a player. Which key drives which action is
 * `BINDINGS` in `src/constants.ts` and specs/controls.md.
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
 * Press and release the pointer at a logical stage position through the ENGINE's
 * own input, running the frames that deliver the samples.
 *
 * specs/controls.md resolves an interaction on the RELEASE, at the position the
 * release landed on, so the move and the press only carry the preview and the
 * hover. This is the path a player takes, which is why it is what a check about a
 * CUE uses: a cue is raised by the frame that resolves its event, and no operation
 * of the debug surface can play one (specs/instrumentation.md). A check about the
 * interaction's result alone may pose it instead, through
 * `h.debug.pointerDown`/`pointerUp`, which resolve at the call.
 */
export async function clickAt(h: Harness, x: number, y: number): Promise<void> {
  h.point("move", x, y);
  h.point("down", x, y);
  await h.advance(1);
  h.point("up", x, y);
  await h.advance(1);
}

/** Press and release a panel control, at the centre of the rectangle it reported. */
export function clickControl(h: Harness, rect: RectSnapshot): Promise<void> {
  const at = centreOf(rect);
  return clickAt(h, at.x, at.y);
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
/* THE CLOCK RULE                                                             */
/* ========================================================================== */
//
// ANY CHECK ABOUT WHETHER TIME PASSES IS MEASURED ON THE CLOCK THE PLAYER'S GAME
// ACTUALLY RUNS ON, NEVER THROUGH A STEPPING OPERATION, BECAUSE THE STEPPING
// OPERATION IS INSTRUMENTATION AND THE QUESTION IS ABOUT THE GAME.
//
// The rule was bought with a defect. A previous version of this case decided
// "pausing freezes the floor" by pausing the game and then calling the debug
// API's own step. That measures WHERE A BUILD PUTS ITS PAUSE GATE, not whether
// the floor freezes. A build holding the pause in the shell that drives the clock
// is equally legal and stepped straight through the check while its real-time clip
// showed the unit stopping dead, so the verdict contradicted its own evidence. And
// worse in the other direction: a build whose pause menu opens over a floor that
// keeps running — the actual defect the item exists to catch — passed outright
// whenever the step happened to be gated.
//
// UNDER THIS ENGINE the rule has a specific and slightly happier reading, and it
// is worth being exact about it. `engine.advance(n)` is not an instrument bolted
// onto the game: it is the engine's OWN frame loop, running the identical `update`
// a player's frame runs, with a clock object that answers a different number of
// milliseconds. The build owns no loop it could gate separately — it owns
// `update` and nothing else — so there is no place for a pause to hide from
// `advance`. `advance` IS the player's clock here.
//
// So a pause check under `simple-2d` spends its windows with {@link overWindow}.
// What the rule still binds is the SHAPE of the measurement, and every part of it
// is load-bearing:
//
//   - TWO LEGS OF THE SAME LENGTH ON THE SAME UNIT. A running leg in which the
//     unit must travel, and a paused leg in which it must not. The running leg is
//     what stops a dead floor — a build that never moves anything — passing
//     vacuously.
//   - BOTH READINGS FROM THE ONE SNAPSHOT ON THE PRESS. The drift and the
//     simulated-clock gain come from the same pair of snapshots, so the pair spans
//     the paused window and nothing else. {@link overWindow} is built so the two
//     cannot disagree: it takes one snapshot at the call and one at the end.
//   - NON-ZERO TOLERANCES. The pause and the position are read a round trip apart,
//     and a build may legally resolve an injected key on its next frame rather
//     than inside the call.
//
// And one item is not about pausing at all but about the clock itself —
// `waves.game-runs-on-its-own-clock`, "with nothing stepping it, the floor
// advances". Nothing stepping it means exactly that: {@link createRealtimeHarness}
// and {@link overRealWindow}, which hand the clock to the build and let its own
// loop run for a stretch of real time.
//
// The tolerances themselves are NOT here. They belong to the checks that assert
// them, derived from the figures the specs fix — a Mote covers 60 logical units a
// second (specs/surge.md), a build may clamp a long frame's delta, a handover may
// stall. A helper that carried them would hide what the check is really asserting.

/** A stretch of the game's own time, and the two readings that bracket it. */
export interface Window {
  /** The snapshot taken at the call, before a frame of the window ran. */
  before: MeltdownSnapshot;
  /** The snapshot taken once the window closed. */
  after: MeltdownSnapshot;
  /** Frames the window ran. */
  frames: number;
  /** Real milliseconds the window spanned, for a window spent in real time. */
  elapsedMs: number;
  /** The game time the simulation says it advanced by across the window. */
  clockGain: number;
  /** How far the unit with that id moved, in logical units. */
  travel(id: number): number;
  /** How much the heat of the tower with that id changed, signed. */
  heatChange(id: number): number;
}

/** Assemble a window's readings from the pair of snapshots that bracket it. */
function windowOf(
  before: MeltdownSnapshot,
  after: MeltdownSnapshot,
  frames: number,
  elapsedMs: number,
): Window {
  return {
    before,
    after,
    frames,
    elapsedMs,
    clockGain: after.simTime - before.simTime,
    travel(id) {
      const from = unitOf(before, id);
      const to = unitOf(after, id);
      return Math.hypot(to.x - from.x, to.y - from.y);
    },
    heatChange(id) {
      return towerOf(after, id).heat - towerOf(before, id).heat;
    },
  };
}

/**
 * Spend `frames` frames of the build's own clock, bracketed by ONE snapshot at
 * the call and ONE when it closes.
 *
 * The measurement THE CLOCK RULE above prescribes. Call it immediately after the
 * press whose effect is being measured, so the pair spans the window that press
 * opened and nothing else, and give both legs of a comparison the same `frames`.
 */
export async function overWindow(h: Harness, frames: number): Promise<Window> {
  const before = h.snapshot();
  const startedMs = Date.now();
  await h.advance(frames);
  return windowOf(before, h.snapshot(), frames, Date.now() - startedMs);
}

/**
 * HAND THE CLOCK BACK TO THE BUILD and spend `ms` of REAL time, bracketed the same
 * way.
 *
 * Nothing steps the game: the engine's own frame loop schedules its frames and its
 * `WallClock` measures them, so what the floor did is what the floor does when a
 * player is watching. `frames` reports how many frames the loop actually got
 * through, which is the host's business rather than the build's — a check asserts
 * on the travel and the clock gain, never on the frame count.
 *
 * It needs a harness built by {@link createRealtimeHarness}. On a `ConstantClock`
 * harness the loop would still run, but each frame would be worth a fixed tick
 * rather than the time it took, so the window would measure nothing. That is a
 * fault in the check rather than a verdict about the build, so it throws.
 */
export async function overRealWindow(h: Harness, ms: number): Promise<Window> {
  if (!h.realtime) {
    throw new Error(
      "meltdown harness.ts: overRealWindow needs a harness built by " +
        "createRealtimeHarness, whose frames are worth the real time they " +
        "took; on the default ConstantClock harness a real window measures " +
        "nothing",
    );
  }
  const before = h.snapshot();
  const openedAt = h.engine.frame().count;
  const startedMs = Date.now();
  await h.runFor(ms);
  return windowOf(
    before,
    h.snapshot(),
    h.engine.frame().count - openedAt,
    Date.now() - startedMs,
  );
}

/* ========================================================================== */
/* What the build drew, and what it played                                    */
/* ========================================================================== */
//
// The presentation and audio halves of this suite need three things the scenario
// helpers above do not provide: a cue record stamped with the frame each cue fired
// on, a colour sampler over the rendered canvas, and a way to ask what a single
// frame's render put where. THE PALETTE IS THE BUILD'S — specs/overview.md fixes
// no colour and no typeface, only what a player must be able to tell apart — so
// nothing here knows a colour: the samplers compare what was painted against what
// else was painted.

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
 * The cue NAMES are `CUES` in `src/constants.ts`; specs/audio.md says which event
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
 * A build may anchor its text through any `translate`/`scale` it likes and align
 * it any way it likes, so the anchor is mapped through the transform the context
 * held at the call and the run is extended about it by its measured width and
 * `textAlign`. Which way a `start`/`end` alignment reads is the page's direction;
 * this game draws no right-to-left text, so they are left and right.
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

/* ---- Where a frame put its rectangles -------------------------------------- */

/** One rectangle a frame drew, placed in logical units. */
export interface DrawnRect {
  /** `fillRect`, `strokeRect` or `clearRect`. */
  method: string;
  /** The rectangle's edges, in logical units, left/top always the smaller. */
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** Its centre, in logical units. */
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Every `fillRect`, `strokeRect` and `clearRect` in `calls`, mapped into logical
 * units.
 *
 * A build draws a tower by translating to its footprint centre and drawing about
 * the origin, so the call's own arguments say nothing about where the rectangle
 * landed: the corners are taken through the transform the context held at the call
 * and then back through the engine's fit. Which is how a draw is attributed to the
 * tile, the footprint or the panel strip it was drawn for.
 *
 * A rotated transform is reported as the axis-aligned box its corners span, which
 * is what a check asking "did anything get drawn over this tile" wants.
 */
export function drawnRects(
  h: Harness,
  calls: readonly DrawCall[] = h.calls,
): DrawnRect[] {
  const view = h.engine.viewport();
  const drawn: DrawnRect[] = [];
  for (const call of calls) {
    if (call.kind !== "call") continue;
    if (!["fillRect", "strokeRect", "clearRect"].includes(call.method))
      continue;
    const m = call.transform;
    if (m === undefined) continue;
    const [rx, ry, rw, rh] = call.args;
    if (
      typeof rx !== "number" ||
      typeof ry !== "number" ||
      typeof rw !== "number" ||
      typeof rh !== "number"
    ) {
      continue;
    }
    const xs: number[] = [];
    const ys: number[] = [];
    for (const [cx, cy] of [
      [rx, ry],
      [rx + rw, ry],
      [rx, ry + rh],
      [rx + rw, ry + rh],
    ]) {
      const deviceX = m.a * cx + m.c * cy + m.e;
      const deviceY = m.b * cx + m.d * cy + m.f;
      xs.push((deviceX - view.offsetX) / view.scale);
      ys.push((deviceY - view.offsetY) / view.scale);
    }
    const left = Math.min(...xs);
    const right = Math.max(...xs);
    const top = Math.min(...ys);
    const bottom = Math.max(...ys);
    drawn.push({
      method: call.method,
      left,
      top,
      right,
      bottom,
      x: (left + right) / 2,
      y: (top + bottom) / 2,
      w: right - left,
      h: bottom - top,
    });
  }
  return drawn;
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
 * The centre pixel plus four neighbours 3 units out, which on a `19`-unit tile all
 * stay well inside it, so one stray anti-aliased or grid-line pixel cannot swing
 * the reading.
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
 * How a check reads whether the build drew something ALONG a line — a casing band,
 * a health bar, a range ring — without knowing what colour it drew it in.
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

/**
 * The build's exported `BACKGROUND`, rasterized: the colour the engine clears the
 * whole canvas to each frame (specs/overview.md), read back through the same
 * canvas implementation the harness samples with, so a pixel the game never drew
 * over compares against it exactly.
 *
 * The fill is repeated rather than applied once so a translucent colour reads as
 * the engine leaves it: the engine composites its clear over the previous frame
 * every frame, which converges on the colour's own channels, and a single fill
 * over a transparent canvas would not.
 */
export function clearColor(): Rgb {
  const probe = createCanvas(1, 1);
  const ctx = probe.getContext("2d");
  ctx.fillStyle = BACKGROUND;
  for (let i = 0; i < 255; i += 1) ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return { r, g, b };
}
