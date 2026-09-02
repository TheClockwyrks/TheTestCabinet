// Cascade — the shared validator harness. CASE-PROVIDED.
//
// Every check in this suite is an ordinary vitest test that runs IN THE SAME
// PROCESS as the build. It imports the engine and the build's own modules, creates
// an engine over a canvas it owns and a clock it chose, and steps the game with
// `engine.advance`. Nothing drives a browser, nothing polls, and no wall-clock time
// passes: a check asks for a number of frames and gets exactly that number, at
// exactly the deltas its clock supplied.
//
// WHAT A CHECK READS. The game's own state (through the debug surface's
// `snapshot`), the engine's frame counter, the cues the engine broadcast, and, for
// the rendering checks, the pixels on the canvas or the calls the 2D context
// received. Nothing here fabricates an outcome: the scenario helpers below only
// ARRANGE the table through the debug surface, and the real `update` the build
// wrote is what runs from there.
//
// WHY THE DEBUG SURFACE RATHER THAN RAW ASSIGNMENT. specs/instrumentation.md fixes
// its operations, so they mean the same thing in every build: `addCard` appends one
// card to a pile's top with a fresh id, `clearTable` empties all thirteen piles,
// `move` applies the game's own rules and reports what they decided, and `reset`
// gives everything back. Posing through it is how a scenario is reproducible, and
// it is the seam the case's specification documents. `surface.ts` is that
// specification as types, and it is the only description of the surface this
// harness reads: the build's own module for it is never imported.
//
// WHERE THE SURFACE COMES FROM. Off `engine.debug`, never built here. The build's
// `initialize` returns it beside the state, as `[state, debug]`, and the engine
// holds the second element and returns it from `engine.debug`. Reading it back off
// the engine is the only way a surface reaches a check, so a build that returned no
// surface, or a surface missing an operation, fails the checks that reach the game
// through it. See {@link readDebugSurface}.
//
// HOW THE SURFACE IS DRIVEN. The engine holds the state by value and hands it out
// read-only, so the surface is pure: a pose takes the current state and returns the
// next, a reading takes the current state and returns what it read, and `move` and
// `autoMove` do both and return the pair `[nextState, verdict]` (`surface.ts`). A
// check still writes `h.debug.setScreen("playing")` and `h.debug.move(...)`, because
// `h.debug` is a {@link Driver} over the raw surface: it runs each pose through
// `engine.apply`, hands each reading `engine.state`, and splits a verdict pair
// INSIDE the transition. Nothing a check does holds a writable state; `h.state` is
// the engine's current value, read fresh on every access, and the only way to change
// it is a pose.
//
// THE HARNESS SUPPLIES THE CLOCK, NOT THE GAME. `ConstantClock(TICK_MS)` is the
// default, so one frame is one 240 Hz tick and every duration this case fixes is a
// whole number of them. That is why `[instrumentation]` carries no `tick_hz`:
// Cascade mandates no fixed timestep, every rate is per second and integrated
// against the delta the frame hands the game, and the SUITE is what fixes a step so
// a tolerance can be stated in frames and mean the same thing on every machine. A
// check that is specifically about the step size builds its own harness with a
// clock of its own, which is what `createHarness({ clock })` is for.
//
// THE PAINTED LAYER NEEDS A DRAWING SURFACE. specs/victory.md has the cascade paint
// onto a persistent layer of the build's own, which a browser build makes with
// `OffscreenCanvas` or a detached canvas element. This process has neither, so
// `canvas-shim.ts` stands both up over `@napi-rs/canvas`, and it is imported first
// below so it is in place before any module of the build's is evaluated.

import "./canvas-shim";

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { createCanvas, type Canvas, type SKRSContext2D } from "@napi-rs/canvas";
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
  CARD_H,
  CARD_W,
  COLUMN_BOTTOM_LIMIT,
  COLUMN_X,
  FACE_DOWN_OFFSET,
  FACE_UP_OFFSET,
  FACE_UP_OFFSET_MIN,
  FOUNDATION_X,
  RANK_MAX,
  RANK_MIN,
  STAGE_H,
  STAGE_W,
  STOCK_X,
  SUITS,
  TABLEAU_Y,
  TOP_ROW_Y,
  WASTE_X,
  type Rect,
} from "./constants";
import { BACKGROUND, game as build, type CascadeState } from "../src/game";
import { fail } from "./assert";
import {
  READINGS,
  VERDICTS,
  type CardSnapshot,
  type CascadeDebugApi,
  type CascadeSnapshot,
  type DragSnapshot,
  type DropTargetSnapshot,
  type FlyerSnapshot,
  type PileKind,
  type Screen,
  type SourcePile,
  type Suit,
} from "./surface";

export type {
  CardSnapshot,
  CascadeSnapshot,
  DragSnapshot,
  DropTargetSnapshot,
  FlyerSnapshot,
  PileKind,
  Screen,
  SourcePile,
  Suit,
};

/**
 * The clock the engine takes each frame's delta from.
 *
 * Re-exported so a check that is about the step size itself builds its second
 * harness out of one import rather than two.
 */
export { ConstantClock };
export type { Clock };

/** The case's surface, bound to the state type the build declared. */
export type CascadeSurface = CascadeDebugApi<CascadeState>;

/**
 * The build's game, typed against the surface the CASE specifies.
 *
 * The build declares its own type for the surface its `initialize` returns, and
 * that type is the build's: what a check holds it to is `surface.ts`, so the game
 * is cast to the case's `Game<CascadeState, CascadeSurface>` here and the engine is
 * parameterized with it. A surface that departs from the specification is caught
 * where a check reaches for the missing member, not by the build's own compiler.
 */
const game = build as unknown as Game<CascadeState, CascadeSurface>;

/**
 * A member of a pure surface, as a check calls it.
 *
 * A reading `(state) => CascadeSnapshot` becomes `() => CascadeSnapshot`: the
 * driver hands it `engine.state`. A verdict-returning operation
 * `(state, ...args) => [S, V]` becomes `(...args) => V`: the driver splits the pair
 * inside the transition, stores the state half and hands back the verdict. A pose
 * `(state, ...args) => S` becomes `(...args) => void`: the driver runs it through
 * `engine.apply`, so the state it returns is the state the next frame receives.
 * Anything else (`version`) is carried as it is.
 *
 * The first branch names the reading by its return type rather than by shape,
 * because a pose returns the build's own state and the compiler would otherwise
 * have to decide which of two structurally similar returns it was looking at.
 * {@link READINGS} states the same fact for the runtime driver.
 */
type Driven<S, M> = M extends (state: DeepReadonly<S>) => CascadeSnapshot
  ? () => CascadeSnapshot
  : M extends (state: DeepReadonly<S>, ...args: infer A) => [S, infer V]
    ? (...args: A) => V
    : M extends (state: DeepReadonly<S>, ...args: infer A) => S
      ? (...args: A) => void
      : M;

/**
 * The imperative reading of a pure surface: every member of `D`, minus its state
 * argument, over the engine that holds the state.
 */
export type Driver<S, D> = {
  [K in keyof D]: Driven<S, NonNullable<D[K]>>;
};

/** The surface as every check drives it. */
export type CascadeDriver = Driver<CascadeState, CascadeSurface>;

/* -------------------------------------------------------------------------- */
/* The clock                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The frame the suite steps in, in milliseconds.
 *
 * This is the SUITE's choice, not the game's: the specification deliberately
 * fixes no timestep, because the engine hands the game whatever elapsed time a
 * frame really took. Fixing it here makes a duration a whole number of frames, so a
 * tolerance can be stated in frames and mean the same thing on every machine.
 *
 * 240 Hz divides every duration this case is timed against exactly: the launch
 * interval (`0.18` s) is `43.2` frames, the double-click window (`0.30` s) is `72`,
 * and the half-second the flight items integrate over is `120`. It is also the step
 * the cascade group's timing items are written against, so a figure quantized to a
 * frame boundary still meets the tolerances those items state.
 */
export const TICK_HZ = 240;
export const TICK_MS = 1000 / TICK_HZ;

/** Seconds of game time in `frames` frames of the default clock. */
export function seconds(frames: number): number {
  return frames / TICK_HZ;
}

/**
 * Whole frames of the default clock covering at least `duration` seconds.
 *
 * Rounded UP, so a hold stated in seconds always covers the whole of it; a check
 * that needs the exact elapsed time asserts against `seconds(framesFor(d))` rather
 * than against `d`.
 */
export function framesFor(duration: number): number {
  return Math.ceil(duration * TICK_HZ);
}

/**
 * The frame a RUN-OUT is stepped in.
 *
 * Three checks have to sit through the whole victory cascade before they can read
 * anything: `cascade/cascade-completes`, `screens/won-shows-message` and
 * `cascade/trail-survives-completion`. Twelve and a half seconds of game time at
 * {@link TICK_HZ} is three thousand frames, and every one of them renders up to
 * fifty-two card faces into a real canvas — so the wait, and not the reading, is
 * what those checks cost, and what they cost is what a busy host turns into a
 * timeout against a build that did nothing wrong.
 *
 * NONE OF THE THREE READS AN ACCELERATED QUANTITY. They read the cascade's own end
 * flag, the launched count, the flight being empty, the text the frame after it
 * drew, and how much of the table is still painted — facts about where the cascade
 * ENDED, none of them quantised to a frame. `TICK_HZ`'s own note says the fine step
 * is for the checks whose tolerances are stated in frames, and these state none;
 * `specs/instrumentation.md` has the game integrate whatever delta a frame supplies,
 * and `instrumentation/advances-in-frames` is the point that grades exactly that. So
 * a run-out stepped at sixty reaches the same end as one stepped at two hundred and
 * forty and costs a quarter as much, which was measured on the references: at 240,
 * 120, 60 and 30 Hz alike the cascade ends `cascadeDone` with all fifty-two launched
 * and nothing in flight, at the same `12.57` s of game time.
 *
 * Sixty is also what a browser gives a game on an ordinary display, so it is the
 * rate the ending a player sees really runs at.
 */
export const RUNOUT_HZ = 60;

/** Whole frames of the run-out clock covering at least `duration` seconds. */
export function runoutFrames(duration: number): number {
  return Math.ceil(duration * RUNOUT_HZ);
}

/** A harness whose clock steps the frames a run-out is waited out in. */
export function createRunoutHarness(): Promise<Harness> {
  return createHarness({ clock: new ConstantClock(1000 / RUNOUT_HZ) });
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
 * the moment of the call: the measured width under the current font, and the
 * alignment that places the run about its anchor. The transform is beside it on the
 * call itself.
 */
export interface TextGeometry {
  width: number;
  textAlign: string;
}

/**
 * One recorded operation on the 2D context, in the order the render made it.
 *
 * A geometry call carries the transform the context held at the call as well,
 * because a build is free to draw a card by translating to its corner and drawing
 * the footprint about the origin, so the destination arguments alone say nothing
 * about where the card landed. {@link drawnBoxes} is what maps one back to logical
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
 * The list is what a rendering check reads, and a rendering check reads ONE frame:
 * the idiom is `h.calls.length = 0`, one `advance(1)`, then the reading, which is
 * what {@link drawFrame} does. But the list is recorded whether a check reads it or
 * not, and this case's longest sweeps run a whole cascade of fifty-two cards over
 * thousands of frames, so an uncapped list would be hundreds of megabytes in a check
 * that never looks at it. Past the cap the oldest half is dropped, which is far
 * beyond any single frame and so cannot cost a reading anything.
 */
const MAX_RECORDED_CALLS = 200_000;

/**
 * The methods whose transform is captured beside the call.
 *
 * Every method {@link drawnBoxes} and {@link drawnTextSpans} place, because placing
 * one means mapping its own arguments through the transform that was current when
 * it was issued.
 */
const TRANSFORMED = new Set([
  "fillRect",
  "strokeRect",
  "rect",
  "roundRect",
  "drawImage",
  "fillText",
  "strokeText",
]);

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

export interface HarnessOptions {
  /** The clock each frame takes its delta from. Defaults to 240 Hz. */
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
  snapshot: CascadeSnapshot;
}

/** A point on the stage, in logical units. */
export interface Point {
  x: number;
  y: number;
}

export interface Harness {
  readonly engine: Engine<CascadeState, CascadeSurface>;
  /**
   * The engine's current state, read fresh on every access. Read it, or pose it
   * through `debug`; nothing here can write to it.
   */
  readonly state: DeepReadonly<CascadeState>;
  /**
   * The debug surface the BUILD returned beside its state, driven over the engine:
   * each pose runs through `engine.apply`, each reading is handed `engine.state`,
   * and `move` and `autoMove` are applied and their verdict handed back.
   *
   * The raw surface is read off `engine.debug` rather than built here, see
   * {@link readDebugSurface}, and {@link driveSurface} is the wrapper.
   */
  readonly debug: CascadeDriver;
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
   * It accumulates across frames, so a check that reads what ONE frame drew empties
   * it first, which is {@link drawFrame}. It is capped at
   * {@link MAX_RECORDED_CALLS}; the cap is orders of magnitude past one frame and
   * cannot cost such a reading anything.
   */
  readonly calls: DrawCall[];
  /** Every cue the build played, oldest first. */
  readonly cues: PlayedCue[];
  /**
   * The event target the engine's own listeners are attached to.
   *
   * The engine takes it from the `SurfaceMetrics` this harness supplies, and the
   * one listener it puts there that Cascade has anything to do with is the
   * `Backquote` keydown that toggles the diagnostics overlay (engine docs,
   * `diagnostics.md`). {@link toggleOverlay} is what dispatches to it; a check
   * has no other reason to reach this.
   */
  readonly events: EventTarget;

  /** A fresh read of the game's state through the case's `snapshot`. */
  snapshot(): CascadeSnapshot;
  /** Run `frames` frames back to back. */
  advance(frames: number): Promise<void>;
  /** Advance until `predicate` holds, sampling every `poll` frames. */
  until(
    predicate: (snapshot: CascadeSnapshot) => boolean,
    options?: UntilOptions,
  ): Promise<UntilResult>;

  /**
   * Dispatch a REAL pointer event at a logical stage point, through the engine's own
   * pointer input: the player's path, where the sample is read by the next frame's
   * update. The debug surface's `pointerDown`/`pointerMove`/`pointerUp` are
   * immediate poses instead, resolved before the call returns.
   *
   * The point is mapped through the current viewport and device pixel ratio, so it
   * names the same logical spot under any surface options. Advance a frame after
   * dispatching for the game to read it, which is what {@link sweepPointer} does.
   */
  pointer(
    type: "pointerdown" | "pointermove" | "pointerup",
    x: number,
    y: number,
  ): void;

  /** Where a logical point lands in the canvas's backing store. */
  device(x: number, y: number): { x: number; y: number };
  /** The device pixel under a logical point, as `[r, g, b, a]`. */
  pixel(x: number, y: number): [number, number, number, number];

  /** Drop the engine's listeners and release the canvas. */
  dispose(): void;
}

/**
 * A `KeyboardEvent`-shaped event: the engine's overlay listener reads `code` and
 * `repeat`, structurally, so a plain `Event` carrying them drives it exactly as a
 * browser's does.
 *
 * Cascade binds no key of its own (specs/controls.md), so the only listener this
 * reaches is the engine's own overlay toggle.
 */
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
 * A `PointerEvent`-shaped event: the engine's pointer input reads `clientX`,
 * `clientY`, and `isPrimary`, structurally, so a plain `Event` carrying them drives
 * it exactly as a browser's does.
 */
class PointerLikeEvent extends Event {
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
 * The debug surface the BUILD returned beside its state, read off the engine that
 * holds it.
 *
 * This is deliberately a READ and never a construction. The surface is the build's
 * deliverable: its `initialize` returns `[state, debug]`
 * (specs/instrumentation.md), the engine keeps the second element, and
 * `engine.debug` is the only way it reaches a check. Nothing here could stand in for
 * it, because the build's own module for the surface is never imported.
 *
 * By the time this runs `engine.initialize()` has resolved, which is the one
 * precondition `engine.debug` has: it holds whatever the build returned as the
 * pair's second element, and a build that returned no pair at all never gets this
 * far, because the engine rejects `initialize` itself and the rejection fails the
 * suite's `beforeEach` with the engine's own message. Such a build does not run on
 * the engine under any entry point, so it is not this harness's fault to report,
 * which is why every suite's `afterEach` disposes its harness with `?.`: the hook
 * then has nothing to add to that message.
 *
 * What IS decided here is a pair whose second element is no surface: a build that
 * returned `[state, null]`, or something other than an object. That is a fault in
 * the build and not in this harness, so it must not present as one.
 *
 * - It is NOT thrown from here. Every suite builds its harness in a `beforeEach`,
 *   so a throw at this point would fail the hook and bury the real verdict under the
 *   harness's own stack in the case's own file.
 * - It is NOT swallowed either. {@link missingSurface} stands in for the missing
 *   surface and fails, by assertion, at the moment a check first reaches for an
 *   operation on it, naming the return the build owes.
 *
 * So the harness is built, teardown runs, and the fault lands exactly where
 * specs/instrumentation.md says it should: on the points whose checks reach the
 * game through the surface. A check that needs no surface is decided on its own
 * merits, and `instrumentation/surface-present` names the missing surface outright.
 */
function readDebugSurface(
  engine: Engine<CascadeState, CascadeSurface>,
): CascadeSurface {
  const surface: unknown = engine.debug;
  if (typeof surface !== "object" || surface === null) {
    return missingSurface(
      `engine.debug holds ${surface === null ? "null" : typeof surface}, ` +
        `not an object`,
    );
  }
  return surface as CascadeSurface;
}

/**
 * A stand-in for the surface a build never returned: every operation on it fails the
 * check that reached for it, with the missing return named.
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
function missingSurface(reason: string): CascadeSurface {
  return new Proxy({} as CascadeSurface, {
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
 * The imperative reading of the raw surface, over the engine that holds the state.
 *
 * A proxy, and a lazy one, for the same reason {@link missingSurface} is: the member
 * is read off the raw surface at the moment a check reaches for it, so a missing
 * surface or a missing operation fails the check that needed it and never the
 * `beforeEach` that built the harness. A member that is not a function (`version`,
 * or an operation the build left out) comes back as it is, which is what lets
 * `instrumentation/surface-present` test for each operation by `typeof`.
 *
 * A reading is called with `engine.state` and its result handed back. A pose is run
 * through `engine.apply`, so the engine stores what it returned and the next frame's
 * `update` receives it; a pose that returns nothing is refused by the engine with a
 * message naming the rule. A verdict-returning operation is applied the same way and
 * its pair split INSIDE the transition, because the engine stores whatever the
 * transition returns and a stored tuple would corrupt every frame after it.
 */
function driveSurface(
  engine: Engine<CascadeState, CascadeSurface>,
  raw: CascadeSurface,
): CascadeDriver {
  const readings: readonly string[] = READINGS;
  const verdicts: readonly string[] = VERDICTS;
  return new Proxy({} as CascadeDriver, {
    get: (_target, property): unknown => {
      if (typeof property === "symbol") return undefined;
      if (property === "then" || property === "constructor") return undefined;
      const member = (raw as unknown as Record<string, unknown>)[property];
      if (typeof member !== "function") return member;
      const op = member as (
        state: DeepReadonly<CascadeState>,
        ...args: unknown[]
      ) => unknown;

      if (readings.includes(property)) {
        return (): unknown => op.call(raw, engine.state);
      }

      if (verdicts.includes(property)) {
        return (...args: unknown[]): unknown => {
          let verdict: unknown;
          engine.apply((state) => {
            const returned = op.call(raw, state, ...args);
            if (Array.isArray(returned)) {
              verdict = returned[1];
              return returned[0] as CascadeState;
            }
            // A build that returned a state alone has posed the board and reported
            // nothing. The verdict is `undefined`, which is exactly what
            // `instrumentation/move-returns-verdict` is there to read.
            verdict = undefined;
            return returned as CascadeState;
          });
          return verdict;
        };
      }

      return (...args: unknown[]): void => {
        engine.apply((state) => op.call(raw, state, ...args) as CascadeState);
      };
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Building one                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Build an engine over a canvas of the harness's own, initialize the build's game,
 * and hand back everything a check reads.
 *
 * The options passed to the factory are the ones the seeded `src/main.ts` passes:
 * the design size and the build's exported `BACKGROUND`. Cascade registers no
 * actions and selects no touch layout, because every control is the pointer
 * (specs/controls.md), so neither is passed here either. Everything else the build
 * decided lives inside `src/game.ts`.
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

  const engine = createEngine<CascadeState, CascadeSurface>({
    canvas: element,
    width: STAGE_W,
    height: STAGE_H,
    game,
    // The build's own table color, handed to the engine exactly as the seeded
    // `src/main.ts` hands it (specs/overview.md).
    background: BACKGROUND,
    clock: options.clock ?? new ConstantClock(TICK_MS),
    surface,
  });

  // Subscribed BEFORE `initialize`, so nothing the game's own loading plays is
  // missed: construction runs no game code.
  const cues: PlayedCue[] = [];
  engine.events.on("cue:played", (played) => {
    cues.push(played);
  });

  await engine.initialize();
  const debug = driveSurface(engine, readDebugSurface(engine));

  let disposed = false;

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
    events,

    snapshot: () => debug.snapshot(),

    advance: (frames) => engine.advance(frames),

    async until(predicate, untilOptions = {}) {
      const maxFrames = untilOptions.maxFrames ?? 2400;
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

    pointer: (type, x, y) => {
      // The inverse of the engine's own mapping: it reads a client position,
      // subtracts the surface origin (none here), multiplies by the device pixel
      // ratio, and maps through the viewport to logical units, so a logical point
      // goes back out the same way.
      const view = engine.viewport();
      events.dispatchEvent(
        new PointerLikeEvent(
          type,
          (view.offsetX + x * view.scale) / dpr,
          (view.offsetY + y * view.scale) / dpr,
        ),
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

/* -------------------------------------------------------------------------- */
/* Evidence capture                                                           */
/* -------------------------------------------------------------------------- */
//
// A review item declares its OUTPUTS beside its verdict: a `replay`, the frames the
// build itself drew while a check drove it, kept as evidence a reviewer can scrub
// against the reference implementation's, or an `image`, one frame of it.
// `captureReplay` and `captureStill` are how a check produces them.
//
// Four properties are what make them usable, and each is deliberate:
//
// 1. THEY RECORD THE SECTION, NOT THE RUN. The recorder is armed around the caller's
//    scenario and disarmed the moment that scenario returns, so what is kept is the
//    part the check is ABOUT and never the setup that got there. A check that poses
//    a nearly-won board and then drops the last card home records the win; the pose
//    costs nothing, and the reviewer is not asked to scrub past fifty-one posed
//    cards to reach the second that decides the point.
//    ARM IT NARROWLY. The victory cascade blits a full-screen painted layer every
//    frame, and the recorder captures a source whose content can change at every
//    use; it holds 16 MB of captured image bytes before a new capture degrades to an
//    opaque marker, so a recording armed around a whole cascade with the trail
//    painting on buys a reviewer nothing and can cost the frames the check was
//    about. Every `replay` in the `cascade` group therefore runs with
//    `setTrailPainting(false)`, and the three in `winning` cover the win and the
//    cascade's first frames alone, which is nowhere near the budget.
// 2. THEY ARE EVIDENCE, NEVER A VERDICT. The scenario's own value comes straight
//    back, so a check reads it exactly as it did before capture existed, and a
//    scenario that THROWS still writes what it had recorded before the failure
//    travels on: a failing check is the one whose replay a reviewer most wants.
//    Nothing here can turn a passing check into a failing one; a recording that
//    cannot be written is reported as an output that never turned up, which is a
//    fact about the host rather than about the build.
// 3. THEY WRITE ONLY WHAT THERE IS TO LOOK AT. A capture that closed no frames
//    leaves no file, so the run reports the output absent instead of offering the
//    reviewer a replay of nothing.
// 4. THEY COST NOTHING WHEN NOBODY IS COLLECTING. Outside a run, where the media
//    directory is unset, the whole thing is a no-op that still runs the scenario.
//    The suite behaves identically either way, so a check cannot pass in one place
//    and fail in the other.

/**
 * The environment variable the runner names the media directory in.
 *
 * Unset is not an error: it is the normal state of a suite nobody is collecting
 * media from.
 */
const MEDIA_DIR_ENV = "TCAB_VALIDATION_MEDIA_DIR";

/**
 * The directory this harness sits in, which is the validator project's root.
 *
 * Taken from this module's own URL rather than from the working directory, because
 * it has to name the same directory in both layouts this file lives in: the case's
 * own `validation/<engine>/`, and the `validation/` the runner stages that directory
 * to inside the build's tree.
 */
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * The directory the runner stages this project to inside the build's tree.
 *
 * A recording is addressed by the STAGED path of the suite that produced it,
 * `validation/cascade/gravity.test.ts`, because that is the path the review item's
 * declared script resolves to, and so the only name the case's manifest and the
 * runner both already agree on.
 */
const STAGED_PROJECT_DIR = "validation";

/**
 * The most frames a written recording holds.
 *
 * A recording is one JSON operation log per frame, and a frame of this game is a few
 * hundred operations: the felt, thirteen piles, every card fanned down every column.
 * A section a check drives for ten seconds of game time at 240 Hz runs to tens of
 * megabytes, a file nobody can serve to a reviewer and nobody wants in a run's
 * artifacts. The cap is what makes `captureReplay` safe to wrap ANY section in.
 *
 * It is generous enough that the great majority of this suite's sections, a win, a
 * bounce, a second of one card's flight, are written whole.
 */
const MAX_REPLAY_FRAMES = 300;

/**
 * Where the running suite's `outputId` output belongs, or `null` when nothing is
 * collecting media.
 *
 * The suite is the one vitest is currently running rather than one the caller names,
 * because the two must not be able to disagree: a check that named its own path
 * would be free to write its evidence under some other point's address.
 *
 * `extension` is the one the runner collects that OUTPUT KIND under: `json.gz` for a
 * recording (a JSON document stored gzipped, `.json` being what the bytes are and
 * `.gz` how they are framed), `png` for a still. The suite and the runner agree by
 * both stating the same thing about what the kind is.
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
 * A value's JSON with object keys in a fixed order, as the key a table deduplicates
 * on.
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
 * carrying them over whole would put operations, states, gradients and images in the
 * file that no surviving frame asks for, dead weight in a document whose whole point
 * is to say each thing once.
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
 * `__proto__` is one the engine's recorder writes for a build that passes one, and
 * this one has to rewrite it as a field rather than as a prototype.
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
      // `__proto__`, and assigning that name reaches the prototype setter instead of
      // writing a field the document carries.
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
      // current, so a state that stopped at the clip would leave a bare `fill` among
      // the frame's operations filling that outline.
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
 * An over-long section is THINNED rather than cut short: every nth frame is kept, so
 * the reviewer sees the entire section at a lower frame rate instead of its first,
 * or last, few seconds at the full one. That is the reading that matches what these
 * outputs are named for. A recording of a cascade is evidence that every card
 * launched, arced and retired, and those events are spread across the whole of it.
 *
 * Thinning is legitimate because every frame in a recording is drawable on its own:
 * a frame names the whole of the state it opened with and reaches everything it
 * draws with through tables the recording shares, so dropping the frames between two
 * kept ones cannot leave a frame undrawable. Each kept frame's `deltaMs` is restated
 * as the time since the frame kept before it, so the deltas still sum to the
 * section's elapsed time and a player pacing itself off them runs at the speed the
 * game really ran at. The frame `count` is left as the host reported it, so a reader
 * can see that frames were skipped rather than being told a smooth lie.
 *
 * The last frame is always kept, whatever the stride lands on: it is the frame the
 * check's sweep stopped at, the win, the bounce, the last card retiring, and it is
 * the one a reviewer looks at first.
 *
 * Keeping it costs a frame rather than the cap. The stride rounds up, so a section
 * whose length is an exact multiple of the cap strides over exactly that many frames
 * and stops one stride short of the end: the last frame still has to come in, and
 * the cap is a ceiling rather than a target. It takes the place of the final strided
 * frame, the frame nearest it, so the swap opens the smallest gap available anywhere
 * in the section, and is measured from where that frame was measured from, which is
 * what keeps the kept deltas summing to the elapsed time.
 *
 * What survives is then re-expressed against tables of its own, because those tables
 * are shared by every frame the recorder kept and a dropped frame takes the last
 * reference to whatever only it drew with.
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
 * A capture that closed no frames writes nothing. There is no picture in it to draw,
 * and a file holding an empty frame list would be collected as an output that turned
 * up: the run would tell the reviewer there is a replay to watch and the player would
 * open on nothing. A declared output that never turned up is already reported as
 * absent, and that is the truthful reading of a section that drew no frames.
 *
 * What lands on disk is gzip rather than raw JSON. A recording is text made almost
 * entirely of numbers, index lists and field names repeated once per frame, which is
 * close to the shape gzip is best at. Every host that serves one declares the
 * encoding, so the browser inflates it before the player sees it, and the document
 * inside is the same one.
 *
 * Never throws. A directory that cannot be made or a file that cannot be written
 * says something about the machine the validators ran on, and failing the point over
 * it would blame the build for the host's problem.
 */
function writeReplay(destination: string, recording: Recording): void {
  if (recording.frames.length === 0) return;
  try {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, gzipSync(JSON.stringify(thinReplay(recording))));
  } catch (error) {
    console.warn(`cascade: could not write ${destination}: ${String(error)}`);
  }
}

/**
 * Record the frames `scenario` draws and keep them as the review item's `outputId`
 * output, handing back whatever the scenario returned.
 *
 * Wrap the drive, not the arrangement:
 *
 * ```ts
 * const swept = await captureReplay(h, "bounce", () =>
 *   h.until((s) => s.flyers[0].vy < 0, { maxFrames: 240 }),
 * );
 * assertTrue(swept.hit);
 * ```
 *
 * The assertions stay exactly where they were and read exactly what they did.
 * Capture sits BESIDE them rather than in place of them: a check still fails for the
 * reasons it failed before, and the recording is what a reviewer looks at afterwards
 * to see what the build actually drew while it did.
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
 * rather than a stretch of motion: the table a deal laid out, which screen the game
 * opened on, where a column's cards were fanned. A recording of a still table would
 * be the same frame three hundred times over.
 *
 * What is written is whatever the last frame that RAN left behind, so call it after
 * the frame that poses the thing under test, an `advance(1)` following the
 * arrangement, and before the assertions, so a check that fails still leaves the
 * picture that shows why. Nothing here can change a verdict: outside a run the media
 * directory is unset and this is a no-op.
 */
export function captureStill(h: Harness, outputId: string): void {
  const destination = mediaDestination(outputId, "png");
  if (destination === null) return;
  try {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, h.canvas.toBuffer("image/png"));
  } catch (error) {
    console.warn(`cascade: could not write ${destination}: ${String(error)}`);
  }
}

/* -------------------------------------------------------------------------- */
/* Naming a card                                                              */
/* -------------------------------------------------------------------------- */
//
// A scenario in this game is a table of cards, and writing one out as objects buries
// what it is under punctuation. So a card is written as its rank and its suit, the
// way a deck is read: `"KS"` is the King of spades, `"10H"` the ten of hearts, and a
// leading `"#"` marks it face-down. Nothing about the notation reaches the build;
// {@link parseCard} turns one into the three scalars `addCard` takes, and
// {@link cardSpec} turns a reported card back into one for a failure message.

/** The thirteen rank labels, Ace low, indexed by `rank - 1`. */
export const RANK_LABELS = [
  "A",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
] as const;

/** The letter each suit is written with. */
export const SUIT_LETTERS: Record<Suit, string> = {
  spades: "S",
  hearts: "H",
  diamonds: "D",
  clubs: "C",
};

/** The suit each letter names. */
const SUIT_OF_LETTER: Record<string, Suit> = {
  S: "spades",
  H: "hearts",
  D: "diamonds",
  C: "clubs",
};

/** The color specs/deal.md gives a suit. */
export function colorOf(suit: Suit): "red" | "black" {
  return suit === "hearts" || suit === "diamonds" ? "red" : "black";
}

/** One card as {@link parseCard} reads it: the three scalars `addCard` takes. */
export interface CardSpec {
  suit: Suit;
  rank: number;
  faceUp: boolean;
}

/**
 * The card a spec names.
 *
 * A misspelt spec is a fault in the check rather than in the build, so it throws a
 * plain error rather than failing by assertion: a validator that asked for the
 * `"KX"` of nothing has not decided anything about the game.
 */
export function parseCard(spec: string): CardSpec {
  const faceUp = !spec.startsWith("#");
  const body = faceUp ? spec : spec.slice(1);
  const suit = SUIT_OF_LETTER[body.slice(-1).toUpperCase()];
  const rank = RANK_LABELS.indexOf(
    body.slice(0, -1).toUpperCase() as (typeof RANK_LABELS)[number],
  );
  if (suit === undefined || rank < 0) {
    throw new Error(
      `cascade: "${spec}" is not a card; write a rank of ` +
        `${RANK_LABELS.join("/")} and a suit of S/H/D/C, with a leading # ` +
        `for face-down`,
    );
  }
  return { suit, rank: rank + 1, faceUp };
}

/** A reported card written back as a spec, for a comparison or a failure message. */
export function cardSpec(card: CardSnapshot): string {
  const face = card.faceUp ? "" : "#";
  return `${face}${RANK_LABELS[card.rank - 1] ?? card.rank}${SUIT_LETTERS[card.suit] ?? card.suit}`;
}

/** A whole pile written back as specs, bottom card first. */
export function pileSpecs(cards: readonly CardSnapshot[]): string[] {
  return cards.map(cardSpec);
}

/* -------------------------------------------------------------------------- */
/* Reading a snapshot                                                         */
/* -------------------------------------------------------------------------- */
//
// The snapshot is plain data, so most readings are a field access and belong in the
// check that makes them. What is here is the handful a check would otherwise write
// out every time: reaching a pile by the two scalars every operation names it with,
// its top card, and finding an entity by the id a pose handed back.
//
// A LOOK-UP BY ID FAILS RATHER THAN RETURNING NOTHING. A check holds an id because a
// pose put an entity on the table and the snapshot reported it; an id that is no
// longer there is the build having lost the entity, which is a verdict and not an
// absent value for the check to reason about. So these fail by assertion, naming
// what the surface promised, and the check reads the entity on the next line.

/** The cards on the named pile, bottom card first, as the snapshot reports them. */
export function pileOf(
  snapshot: CascadeSnapshot,
  pile: PileKind,
  index = 0,
): CardSnapshot[] {
  switch (pile) {
    case "stock":
      return snapshot.stock;
    case "waste":
      return snapshot.waste;
    case "foundation":
      return snapshot.foundations[index] ?? [];
    case "tableau":
      return snapshot.tableau[index] ?? [];
  }
}

/** The named pile's top card, or `null` where it holds none. */
export function topOf(
  snapshot: CascadeSnapshot,
  pile: PileKind,
  index = 0,
): CardSnapshot | null {
  const cards = pileOf(snapshot, pile, index);
  return cards.length === 0 ? null : cards[cards.length - 1];
}

/** Every card on the thirteen piles, in no particular order. */
export function tableCards(snapshot: CascadeSnapshot): CardSnapshot[] {
  return [
    ...snapshot.stock,
    ...snapshot.waste,
    ...snapshot.foundations.flat(),
    ...snapshot.tableau.flat(),
  ];
}

/** Where a card sits on the table: its pile, that pile's index, and its row. */
export interface CardPlace {
  pile: PileKind;
  index: number;
  /** The card's index within its pile, counted from the bottom. */
  row: number;
  card: CardSnapshot;
}

/** Where the card with that id sits, or `null` when no pile holds it. */
export function placeOf(
  snapshot: CascadeSnapshot,
  id: number,
): CardPlace | null {
  const piles: readonly { pile: PileKind; index: number }[] = [
    { pile: "stock", index: 0 },
    { pile: "waste", index: 0 },
    ...snapshot.foundations.map((_, index) => ({
      pile: "foundation" as const,
      index,
    })),
    ...snapshot.tableau.map((_, index) => ({
      pile: "tableau" as const,
      index,
    })),
  ];
  for (const at of piles) {
    const cards = pileOf(snapshot, at.pile, at.index);
    const row = cards.findIndex((card) => card.id === id);
    if (row >= 0) return { ...at, row, card: cards[row] };
  }
  return null;
}

/** The card with that id. Fails the check when the table no longer holds it. */
export function cardOf(snapshot: CascadeSnapshot, id: number): CardSnapshot {
  const found = placeOf(snapshot, id);
  if (found === null) {
    fail(
      `snapshot() to report the card with id ${id}: a card keeps its id for as ` +
        "long as it is on the table (specs/instrumentation.md)",
      tableCards(snapshot).map((card) => card.id),
    );
  }
  return found.card;
}

/** The flyer with that id. Fails the check when it is no longer in flight. */
export function flyerOf(snapshot: CascadeSnapshot, id: number): FlyerSnapshot {
  const found = snapshot.flyers.find((flyer) => flyer.id === id);
  if (found === undefined) {
    fail(
      `snapshot() to report the flyer with id ${id}: a flyer added through the ` +
        "surface keeps its id until it retires (specs/instrumentation.md)",
      snapshot.flyers.map((flyer) => flyer.id),
    );
  }
  return found;
}

/** The last flyer in the list, which is the one an `addFlyer` appended. */
export function lastFlyer(snapshot: CascadeSnapshot): FlyerSnapshot {
  const found = snapshot.flyers[snapshot.flyers.length - 1];
  if (found === undefined) {
    fail(
      "snapshot() to report the flyer addFlyer appended to the flight " +
        "(specs/instrumentation.md)",
      snapshot.flyers,
    );
  }
  return found;
}

/* -------------------------------------------------------------------------- */
/* The geometry of the table                                                  */
/* -------------------------------------------------------------------------- */
//
// Every figure here comes from this project's own `constants.ts`, which
// transcribes specs/table.md, so what these compute is the geometry the
// specification fixes rather than the geometry a build wrote down for itself.
//
// WHAT THEY ARE FOR IS AIMING, NOT GRADING. A check that has to press a card, or
// release a run over a column, needs the point that card is drawn at; that is what
// these give it. A check whose REQUIREMENT is the geometry itself, the `table`
// group's fourteen items, states its own figure and reads where the build actually
// drew, through {@link drawnBoxes}. Asserting a build's drawing against
// {@link columnCardTopLeft} would be asserting this file.

/** Whether a point lies inside a rectangle, its top and left edges included. */
export function pointIn(rect: Rect, x: number, y: number): boolean {
  return (
    x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h
  );
}

/** A card-sized rectangle at a top-left. */
export function cardRect(x: number, y: number): Rect {
  return { x, y, w: CARD_W, h: CARD_H };
}

/** The center of a card drawn at a top-left, which a release resolves against. */
export function cardCenter(x: number, y: number): Point {
  return { x: x + CARD_W / 2, y: y + CARD_H / 2 };
}

/** The anchor of one of the thirteen piles: the top-left its cards square to. */
export function pileTopLeft(pile: PileKind, index = 0): Point {
  switch (pile) {
    case "stock":
      return { x: STOCK_X, y: TOP_ROW_Y };
    case "waste":
      return { x: WASTE_X, y: TOP_ROW_Y };
    case "foundation":
      return { x: FOUNDATION_X[index], y: TOP_ROW_Y };
    case "tableau":
      return { x: COLUMN_X[index], y: TABLEAU_Y };
  }
}

/** The faces of a pile's cards, top of the pile last, as the offsets read them. */
export function facesOf(cards: readonly CardSnapshot[]): boolean[] {
  return cards.map((card) => card.faceUp);
}

/**
 * The gap drawn under each face-up card of a column holding cards with these faces,
 * by the compression rule specs/table.md fixes.
 *
 * The natural `FACE_UP_OFFSET` while the column fits above `COLUMN_BOTTOM_LIMIT`,
 * and otherwise the largest uniform value that does fit, never below
 * `FACE_UP_OFFSET_MIN`. The face-down gap stays at `FACE_DOWN_OFFSET` however far a
 * column is compressed, and the fit is made afresh from the cards a column holds, so
 * a column that lost cards draws the full offset again.
 */
export function faceUpGap(faces: readonly boolean[]): number {
  const gaps = faces.length - 1;
  if (gaps <= 0) return FACE_UP_OFFSET;

  let faceUp = 0;
  let faceDown = 0;
  for (let i = 0; i < gaps; i += 1) {
    if (faces[i]) faceUp += 1;
    else faceDown += 1;
  }
  if (faceUp === 0) return FACE_UP_OFFSET;

  const natural =
    TABLEAU_Y + faceDown * FACE_DOWN_OFFSET + faceUp * FACE_UP_OFFSET + CARD_H;
  if (natural <= COLUMN_BOTTOM_LIMIT) return FACE_UP_OFFSET;

  const fits =
    (COLUMN_BOTTOM_LIMIT - CARD_H - TABLEAU_Y - faceDown * FACE_DOWN_OFFSET) /
    faceUp;
  return Math.max(FACE_UP_OFFSET_MIN, Math.min(FACE_UP_OFFSET, fits));
}

/** The top edge of every card in a column, from its first card down. */
export function columnCardTops(faces: readonly boolean[]): number[] {
  const gap = faceUpGap(faces);
  const tops: number[] = [];
  let y = TABLEAU_Y;
  for (const faceUp of faces) {
    tops.push(y);
    y += faceUp ? gap : FACE_DOWN_OFFSET;
  }
  return tops;
}

/** The top-left of the card at `row` of a column whose cards have these faces. */
export function columnCardTopLeft(
  col: number,
  row: number,
  faces: readonly boolean[],
): Point {
  const tops = columnCardTops(faces);
  return { x: COLUMN_X[col], y: tops[row] ?? TABLEAU_Y };
}

/** The bottom edge of a column's lowest drawn card, or of its empty slot. */
export function columnBottom(faces: readonly boolean[]): number {
  const tops = columnCardTops(faces);
  const last = tops.length === 0 ? TABLEAU_Y : tops[tops.length - 1];
  return last + CARD_H;
}

/**
 * The rectangle a pile answers a release in (specs/table.md).
 *
 * Every pile but a column holding cards answers a single card footprint at its
 * anchor; a column holding cards answers the whole extent it draws. The thirteen
 * rectangles do not overlap, so a point lies in at most one of them.
 */
export function dropRect(
  snapshot: CascadeSnapshot,
  pile: PileKind,
  index = 0,
): Rect {
  const anchor = pileTopLeft(pile, index);
  if (pile !== "tableau") return cardRect(anchor.x, anchor.y);
  const faces = facesOf(pileOf(snapshot, pile, index));
  if (faces.length === 0) return cardRect(anchor.x, anchor.y);
  return {
    x: anchor.x,
    y: TABLEAU_Y,
    w: CARD_W,
    h: columnBottom(faces) - TABLEAU_Y,
  };
}

/** The top-left the card at `row` of the named pile is drawn at. */
export function cardTopLeft(
  snapshot: CascadeSnapshot,
  pile: PileKind,
  index: number,
  row: number,
): Point {
  if (pile !== "tableau") return pileTopLeft(pile, index);
  return columnCardTopLeft(index, row, facesOf(pileOf(snapshot, pile, index)));
}

/** The point to press to grab the card at `row` of the named pile. */
export function pressPoint(
  snapshot: CascadeSnapshot,
  pile: PileKind,
  index: number,
  row: number,
): Point {
  const at = cardTopLeft(snapshot, pile, index, row);
  return cardCenter(at.x, at.y);
}

/**
 * The point to release a held run over so its leading card's center lands inside the
 * named pile's drop rectangle: that rectangle's own center.
 *
 * A held run is carried by the pointer's own displacement (specs/controls.md), so
 * the leading card's center sits at the pointer plus whatever separated the two when
 * the run was lifted. {@link pressPoint} presses a card at its center, which makes
 * that separation zero, so a gesture that grabs with {@link pressPoint} and releases
 * at {@link releasePoint} lands the leading card's center exactly on the target's,
 * well inside its rectangle. {@link drag} is the pairing of the two.
 *
 * A check whose requirement is the resolution rule itself states its own point
 * instead, derived from the rectangle specs/table.md fixes.
 */
export function releasePoint(
  snapshot: CascadeSnapshot,
  pile: PileKind,
  index = 0,
): Point {
  const rect = dropRect(snapshot, pile, index);
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/* -------------------------------------------------------------------------- */
/* Scenario helpers                                                           */
/* -------------------------------------------------------------------------- */
//
// Each of these poses a situation through the debug surface and then lets the real
// simulation run. THEY FIX ONLY GEOMETRY AND ARRANGEMENT: which cards are on which
// pile, which card is left off the foundations, where a gesture presses and
// releases. Every threshold a check asserts is stated in the check itself, derived
// from the figure specs/ fixes for it, because a helper that carried the tolerance
// would hide what the check is really asserting.
//
// The debug surface is atomic by design (specs/instrumentation.md), so every
// compound sequence lives here. A check that needs all of a sequence calls the
// helper; a check that needs only part of it calls the operations it needs. Nothing
// a check does not ask for happens.

/**
 * Open an EMPTY table in live play, with every gate at its default.
 *
 * This is the ground almost every check in this suite stands on. An empty table is
 * an isolated world on its own: Cascade has no autonomous entity, nothing arrives
 * uninvited, and the game moves only when a check moves it. So a check poses exactly
 * the cards its requirement concerns and nothing else.
 *
 * THE FOUR GATES ARE LEFT ON. `autoFlip`, `winDetect`, `launching` and
 * `trailPainting` are on after `reset`, which is what a player gets. A check turns
 * one off only when that gate is its own requirement, or when its requirement would
 * otherwise be entangled with the faculty the gate holds still: a single-flyer check
 * turns `launching` off so it reads one parabola instead of fifty-two, and every
 * `replay` in the `cascade` group turns `trailPainting` off so the recorder's budget
 * goes on the flight rather than on a full-screen blit per frame.
 *
 * `clearTable` follows `reset` rather than leaning on it, so the emptiness this
 * promises holds even for a build whose `reset` is wrong. `reset` is graded by its
 * own items.
 *
 * It poses and returns; it runs no frame. A check advances the frames its own
 * reading needs.
 */
export function openTable(h: Harness): void {
  h.debug.reset();
  h.debug.setScreen("playing");
  h.debug.clearTable();
}

/**
 * Pose `specs` onto the named pile, bottom card first, and report their ids.
 *
 * Each card is one `addCard`, which appends, so the LAST spec given ends up the
 * pile's top card. The ids come back in the order the specs were given.
 */
export function posePile(
  h: Harness,
  pile: PileKind,
  index: number,
  specs: readonly string[],
): number[] {
  const before = pileOf(h.snapshot(), pile, index).length;
  for (const spec of specs) {
    const card = parseCard(spec);
    h.debug.addCard(pile, index, card.suit, card.rank, card.faceUp);
  }
  return pileOf(h.snapshot(), pile, index)
    .slice(before)
    .map((card) => card.id);
}

/**
 * Pose one tableau column, bottom card first, and report the ids in that order.
 *
 * ```ts
 * poseColumn(h, 0, ["#5D", "#8C", "KS", "QH"]); // two buried, a King and a Queen
 * ```
 */
export function poseColumn(
  h: Harness,
  col: number,
  specs: readonly string[],
): number[] {
  return posePile(h, "tableau", col, specs);
}

/**
 * Build foundation `index` up from the Ace of `suit` to `upTo`, and report the ids.
 *
 * Every card is face-up, which is what a card on a foundation is. `upTo` is a rank,
 * so `poseFoundation(h, 0, "spades", 13)` completes a foundation.
 */
export function poseFoundation(
  h: Harness,
  index: number,
  suit: Suit,
  upTo: number,
): number[] {
  const letter = SUIT_LETTERS[suit];
  const specs: string[] = [];
  for (let rank = RANK_MIN; rank <= upTo; rank += 1) {
    specs.push(`${RANK_LABELS[rank - 1]}${letter}`);
  }
  return posePile(h, "foundation", index, specs);
}

/**
 * Pose the waste and the set memory it shows, and report the card ids.
 *
 * `specs` are the cards, bottom first, so the last is the waste's top. `sets` are
 * the turned sets, oldest first, and they are never omitted: a waste holding cards
 * with no sets shows none of them (specs/stock.md), so a pose that left the sets out
 * would arrange a table no check meant to ask for.
 *
 * ```ts
 * poseWaste(h, ["2C", "9H", "4S", "7D", "JC"], [3, 2]); // five cards, two showing
 * ```
 *
 * A `sets` that names more cards than `specs` gives is a fault in the check rather
 * than in the build, so it throws a plain error.
 */
export function poseWaste(
  h: Harness,
  specs: readonly string[],
  sets: readonly number[],
): number[] {
  const held = sets.reduce((sum, count) => sum + count, 0);
  if (held > specs.length) {
    throw new Error(
      `cascade: poseWaste was given ${specs.length} cards and sets holding ` +
        `${held}; a set memory never names more cards than the waste holds`,
    );
  }
  const ids = posePile(h, "waste", 0, specs);
  for (const count of sets) h.debug.addWasteSet(count);
  return ids;
}

/**
 * Pose the stock, bottom card first, and report the ids in that order.
 *
 * A turn takes from the stock's top, so the LAST spec given is the first card the
 * next `turnStock` moves onto the waste.
 */
export function poseStock(h: Harness, specs: readonly string[]): number[] {
  return posePile(h, "stock", 0, specs);
}

/** Where {@link poseNearlyWon} puts the one card still to be played. */
export interface NearlyWonOptions {
  /** The card left off the foundations. Defaults to the King of spades. */
  missing?: string;
  /** The pile it waits on. Defaults to `"tableau"`. */
  pile?: SourcePile;
  /** That pile's index. Defaults to `0`. */
  index?: number;
}

/** What {@link poseNearlyWon} left for the check to play. */
export interface NearlyWon {
  /** The id of the one card still to be played. */
  id: number;
  /** The card, as it was posed. */
  card: CardSpec;
  /** The foundation index its suit was built on. */
  foundation: number;
  /** The pile it is waiting on, and its row there. */
  from: { pile: SourcePile; index: number; row: number };
}

/**
 * Pose a table one card short of a win: fifty-one cards home, and the fifty-second
 * waiting where the caller asked for it.
 *
 * Each suit is built Ace to King on the foundation at its own index in `SUITS`, so
 * spades are foundation `0` and clubs foundation `3`, and the named card is left off
 * its suit's foundation and posed face-up on the waiting pile instead. A card waiting
 * on the waste is given a set of one, so the waste shows it.
 *
 * It changes no gate, so `winDetect` is on and the move that sends the last card
 * home wins the game, which is what {@link startCascade} then does. A check that
 * wants fifty-one home and no more reads the table as this leaves it.
 */
export function poseNearlyWon(
  h: Harness,
  options: NearlyWonOptions = {},
): NearlyWon {
  const card = parseCard(options.missing ?? "KS");
  const pile = options.pile ?? "tableau";
  const index = options.index ?? 0;
  const foundation = SUITS.indexOf(card.suit);

  for (const [at, suit] of SUITS.entries()) {
    const letter = SUIT_LETTERS[suit];
    const specs: string[] = [];
    for (let rank = RANK_MIN; rank <= RANK_MAX; rank += 1) {
      if (suit === card.suit && rank === card.rank) continue;
      specs.push(`${RANK_LABELS[rank - 1]}${letter}`);
    }
    posePile(h, "foundation", at, specs);
  }

  const spec = `${RANK_LABELS[card.rank - 1]}${SUIT_LETTERS[card.suit]}`;
  const ids =
    pile === "waste"
      ? poseWaste(h, [spec], [1])
      : posePile(h, pile, index, [spec]);
  const row = pileOf(h.snapshot(), pile, index).length - 1;
  return { id: ids[0], card, foundation, from: { pile, index, row } };
}

/**
 * Open a table one card short of a win and send that card home, so the cascade is
 * entered through the game's own win path.
 *
 * The move runs the build's own rules, so a build that refuses the last Ace of its
 * own suit onto its own foundation fails here rather than silently posing a cascade
 * it never earned. `screen` is `"won"` and the cascade is running when this returns,
 * with no frame yet advanced.
 */
export function startCascade(
  h: Harness,
  options: NearlyWonOptions = {},
): NearlyWon {
  openTable(h);
  const pending = poseNearlyWon(h, options);
  const accepted = h.debug.move(
    pending.from.pile,
    pending.from.index,
    pending.from.row,
    "foundation",
    pending.foundation,
  );
  if (accepted !== true) {
    fail(
      "move() to accept the last card of a suit onto that suit's foundation, " +
        "which is what wins the game (specs/foundations.md)",
      accepted,
    );
  }
  return pending;
}

/* ---- Gestures ------------------------------------------------------------- */
//
// The three pointer operations are immediate poses: each resolves the moment it is
// called, through the same input path a player's pointer feeds
// (specs/instrumentation.md), so a whole gesture is driven without advancing a
// frame. The helpers below compose them; `sweepPointer` is the one that goes through
// the ENGINE's pointer instead, for the check whose subject is what one frame does
// with the samples it was handed.

/**
 * Press at `from`, glide to `to` over `steps` moves, and release there.
 *
 * A DROP rather than a click, provided the two points are farther apart than
 * `DRAG_THRESHOLD` (specs/controls.md); a check that wants a click uses
 * {@link clickAt}, and the check whose requirement is the threshold states both
 * distances itself.
 *
 * Grab with {@link pressPoint} and release at {@link releasePoint} and the run's
 * leading card lands centered on the target.
 *
 * It poses, so it sounds nothing: a cue belongs to the frame its event happened on
 * and a pose runs between frames ({@link watchCues}). A check about the cue a
 * gesture sounds drives {@link sweepPointer} instead.
 */
export function drag(h: Harness, from: Point, to: Point, steps = 8): void {
  h.debug.pointerDown(from.x, from.y);
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    h.debug.pointerMove(
      from.x + (to.x - from.x) * t,
      from.y + (to.y - from.y) * t,
    );
  }
  h.debug.pointerUp(to.x, to.y);
}

/**
 * Press and release at one point, which is a CLICK: the release lies within
 * `DRAG_THRESHOLD` of its press, so it returns any held run, activates whatever
 * control the press landed in, and counts toward the double-click rule
 * (specs/controls.md).
 */
export function clickAt(h: Harness, x: number, y: number): void {
  h.debug.pointerDown(x, y);
  h.debug.pointerUp(x, y);
}

/**
 * Two clicks at one point with no frame between them, so the second press falls `0`
 * seconds of game time after the first and well inside `DOUBLE_CLICK_WINDOW`.
 *
 * A check about the window or the slop drives its own two clicks instead, advancing
 * between them or moving the second, so the figure it asserts is stated in the
 * check.
 */
export function doubleClickAt(h: Harness, x: number, y: number): void {
  clickAt(h, x, y);
  clickAt(h, x, y);
}

/**
 * Press and release at one point through the ENGINE's own pointer, and run the one
 * frame that delivers both.
 *
 * The real path's answer to {@link clickAt}. A control activated this way is
 * activated by a frame's own update, which is what a check about the CUE the control
 * sounds needs; see {@link watchCues}.
 */
export async function tapPointer(
  h: Harness,
  x: number,
  y: number,
): Promise<void> {
  h.pointer("pointerdown", x, y);
  h.pointer("pointerup", x, y);
  await h.advance(1);
}

/**
 * Drive a whole gesture through the ENGINE's own pointer and then run the one frame
 * that delivers it.
 *
 * Every sample is dispatched before the frame runs, so the frame's update is handed
 * the press, the moves and the release together, in arrival order. That is what
 * separates a build answering every sample from one that keeps only the frame's last
 * sample (specs/controls.md): the second sees the release alone and has nothing in
 * hand.
 */
export async function sweepPointer(
  h: Harness,
  from: Point,
  to: Point,
  steps = 4,
): Promise<void> {
  h.pointer("pointerdown", from.x, from.y);
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    h.pointer(
      "pointermove",
      from.x + (to.x - from.x) * t,
      from.y + (to.y - from.y) * t,
    );
  }
  h.pointer("pointerup", to.x, to.y);
  await h.advance(1);
}

/* ========================================================================== */
/* What the build drew, and what it played                                    */
/* ========================================================================== */
//
// The presentation, table, screens and audio halves of this suite need three things
// the scenario helpers do not provide: what one frame's render put where, a color
// sampler over the rendered canvas, and a cue record stamped with the frame each cue
// fired on. THE PALETTE IS THE BUILD'S: specs/overview.md fixes no color and no
// typeface, only what a player must be able to tell apart, so nothing here knows a
// color and the samplers compare what was painted against what else was painted.

/**
 * Run exactly one frame and hand back the calls THAT frame made.
 *
 * The reading every rendering check opens with. {@link Harness.calls} accumulates
 * across frames, so what a check about the picture wants is the frame it just drove
 * and not the setup before it.
 */
export async function drawFrame(h: Harness): Promise<DrawCall[]> {
  h.calls.length = 0;
  await h.advance(1);
  return [...h.calls];
}

/**
 * Toggle the engine's diagnostics overlay and hand back the frame that draws — or
 * stops drawing — it.
 *
 * The overlay is ENGINE CHROME under this engine: the backtick key (`Backquote`)
 * toggles it through a keydown listener the engine itself owns on the harness's
 * event target (engine docs, `diagnostics.md`), and Cascade binds no key of its
 * own (specs/controls.md), so nothing the build wrote answers this. What the
 * BUILD owns is which diagnostic sources it registers, and the engine draws each
 * of them after the game's `render`, through the same context this harness
 * records — so with the panel up, the registered values land among the returned
 * calls as ordinary text draws, readable with {@link drawnText}.
 *
 * What comes back is that one frame's calls alone, exactly as {@link drawFrame}
 * hands them over, so a frame with the panel up is compared against a frame
 * without it rather than against everything drawn before either.
 */
export async function toggleOverlay(h: Harness): Promise<DrawCall[]> {
  h.events.dispatchEvent(new KeyEvent("keydown", "Backquote"));
  h.events.dispatchEvent(new KeyEvent("keyup", "Backquote"));
  return drawFrame(h);
}

/* ---- Where a frame put its shapes ----------------------------------------- */

/** One axis-aligned box a frame drew, placed in logical units. */
export interface DrawnBox {
  /** The context method that drew it. */
  method: string;
  /** The box's TOP-LEFT, in logical units, which is how a card is placed. */
  x: number;
  y: number;
  /** The box's size, in logical units, always positive. */
  w: number;
  h: number;
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

/** The rectangle a call names, in the coordinates the call itself was made in. */
function boxOf(call: DrawCall): [number, number, number, number] | null {
  if (call.kind !== "call") return null;
  const { method, args } = call;
  if (method === "drawImage") {
    const rest = args.slice(1);
    if (rest.length >= 8)
      return rest.slice(4, 8) as [number, number, number, number];
    if (rest.length >= 4)
      return rest.slice(0, 4) as [number, number, number, number];
    if (rest.length >= 2) {
      const size = naturalSize(args[0]);
      if (size === null) return null;
      return [rest[0] as number, rest[1] as number, size.width, size.height];
    }
    return null;
  }
  if (
    method === "fillRect" ||
    method === "strokeRect" ||
    method === "rect" ||
    method === "roundRect"
  ) {
    return args.slice(0, 4) as [number, number, number, number];
  }
  return null;
}

/**
 * Every rectangle `calls` drew, with its box mapped into logical units.
 *
 * A card is a `CARD_W x CARD_H` footprint placed by its corner (specs/table.md), and
 * a build is free to draw one by translating to that corner and drawing the
 * footprint about the origin, so a call's own arguments say nothing about where the
 * card landed. Each box's corners are taken through the transform the context held
 * at the call and then back through the engine's fit, and what comes out is the
 * axis-aligned box on the stage that a check can hold against a pile's anchor.
 *
 * Every way a build can put a card-sized shape on the canvas is read: `fillRect`,
 * `strokeRect`, `rect` and `roundRect` under a fill or a stroke, and `drawImage` in
 * all three of its argument forms.
 */
export function drawnBoxes(
  h: Harness,
  calls: readonly DrawCall[] = h.calls,
): DrawnBox[] {
  const view = h.engine.viewport();
  const drawn: DrawnBox[] = [];
  for (const call of calls) {
    if (call.kind !== "call") continue;
    const m = call.transform;
    if (m === undefined) continue;
    const box = boxOf(call);
    if (box === null || !box.every((value) => typeof value === "number")) {
      continue;
    }

    const [bx, by, bw, bh] = box;
    const xs: number[] = [];
    const ys: number[] = [];
    for (const [cx, cy] of [
      [bx, by],
      [bx + bw, by],
      [bx, by + bh],
      [bx + bw, by + bh],
    ]) {
      const deviceX = m.a * cx + m.c * cy + m.e;
      const deviceY = m.b * cx + m.d * cy + m.f;
      xs.push((deviceX - view.offsetX) / view.scale);
      ys.push((deviceY - view.offsetY) / view.scale);
    }
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    drawn.push({
      method: call.method,
      x: left,
      y: top,
      w: Math.max(...xs) - left,
      h: Math.max(...ys) - top,
    });
  }
  return drawn;
}

/**
 * How far a drawn box's size may sit from the card footprint and still be read as a
 * card, in logical units.
 *
 * A card's footprint is fixed at `CARD_W x CARD_H` (specs/table.md), so this is not
 * a size tolerance: it is room for the one unit a build may lose insetting a stroke
 * or rounding a corner, and a shape that is not a card misses by tens of units.
 */
export const CARD_BOX_TOLERANCE = 2;

/** Every card-sized box among `boxes`, whichever call drew it. */
export function cardBoxes(
  boxes: readonly DrawnBox[],
  tolerance = CARD_BOX_TOLERANCE,
): DrawnBox[] {
  return boxes.filter(
    (box) =>
      Math.abs(box.w - CARD_W) <= tolerance &&
      Math.abs(box.h - CARD_H) <= tolerance,
  );
}

/** The first box in `boxes` whose top-left sits within `tolerance` of a point. */
export function boxAt(
  boxes: readonly DrawnBox[],
  x: number,
  y: number,
  tolerance = CARD_BOX_TOLERANCE,
): DrawnBox | null {
  return (
    boxes.find(
      (box) =>
        Math.abs(box.x - x) <= tolerance && Math.abs(box.y - y) <= tolerance,
    ) ?? null
  );
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
 * Substring rather than equality on purpose: the copy a check asserts is the case's
 * own, but how a build presents it is the build's, and a label is commonly drawn
 * with padding or a marker around it. Requiring the exact run would fail a screen
 * that shows precisely the right words.
 */
export function drewText(calls: readonly DrawCall[], text: string): boolean {
  const wanted = text.trim().toLowerCase();
  return drawnText(calls).some((drawn) => drawn.toLowerCase().includes(wanted));
}

/**
 * Whether the frame drew `token` as a whole word, ignoring case.
 *
 * What the how-to copy's four standalone tokens are matched with: `ACE` inside
 * `PLACE` is not the word the specification asked for, and a substring match would
 * take it.
 */
export function drewToken(calls: readonly DrawCall[], token: string): boolean {
  const pattern = new RegExp(
    `(^|[^A-Za-z0-9])${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^A-Za-z0-9])`,
    "i",
  );
  return drawnText(calls).some((drawn) => pattern.test(drawn));
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
 * A build may anchor its text through any `translate`/`scale` it likes and align it
 * any way it likes, so the anchor is mapped through the transform the context held
 * at the call and the run is extended about it by its measured width and
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
    const m = call.transform;
    if (m === undefined) continue;
    const [text, ax, ay] = call.args;
    if (typeof text !== "string" || typeof ax !== "number") continue;
    if (typeof ay !== "number") continue;
    const { width, textAlign } = call.text;
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

/* ---- Color ---------------------------------------------------------------- */

/** A sampled color, each channel 0 to 255. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** The rendered color of the single device pixel under a logical point. */
export function pixelColor(h: Harness, x: number, y: number): Rgb {
  const [r, g, b] = h.pixel(x, y);
  return { r, g, b };
}

/**
 * The rendered color at a logical point, averaged over a small cluster.
 *
 * The center pixel plus four neighbors `radius` units out, so one stray
 * anti-aliased or shadowed pixel cannot swing the reading. The default keeps every
 * sample well inside a `100 x 140` card.
 */
export function sampleColor(h: Harness, x: number, y: number, radius = 4): Rgb {
  const offsets: readonly (readonly [number, number])[] = [
    [0, 0],
    [radius, 0],
    [-radius, 0],
    [0, radius],
    [0, -radius],
  ];
  let r = 0;
  let g = 0;
  let b = 0;
  for (const [dx, dy] of offsets) {
    const sampled = pixelColor(h, x + dx, y + dy);
    r += sampled.r;
    g += sampled.g;
    b += sampled.b;
  }
  return {
    r: r / offsets.length,
    g: g / offsets.length,
    b: b / offsets.length,
  };
}

/** Euclidean distance between two colors, `0` to about `441`. */
export function colorDistance(a: Rgb, b: Rgb): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

/**
 * `cols x rows` colors sampled evenly over a rectangle, row by row.
 *
 * How a check reads whether something was drawn ANYWHERE inside a region without
 * knowing what color the build drew it in: the painted trail under a flyer, a
 * highlight somewhere in a pile's rectangle. The samples are inset by half a cell,
 * so none of them lands on the rectangle's own edge.
 */
export function sampleGrid(
  h: Harness,
  rect: Rect,
  cols: number,
  rows: number,
): Rgb[] {
  const samples: Rgb[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      samples.push(
        pixelColor(
          h,
          rect.x + (rect.w * (col + 0.5)) / cols,
          rect.y + (rect.h * (row + 0.5)) / rows,
        ),
      );
    }
  }
  return samples;
}

/**
 * The build's exported `BACKGROUND`, rasterized: the color the engine clears the
 * whole canvas to each frame (specs/overview.md), read back through the same canvas
 * implementation the harness samples with, so a pixel the game never drew over
 * compares against it exactly.
 *
 * The fill is repeated rather than applied once so a translucent color reads as the
 * engine leaves it: the engine composites its clear over the previous frame every
 * frame, which converges on the color's own channels, and a single fill over a
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
 * `engine.frame().count` is that frame's own number. That is what lets a check
 * assert not merely that a cue sounded but that it sounded on the frame of the
 * event, which is what tells a build that plays a cue on the right event apart from
 * one that plays it on every frame, or a frame late.
 *
 * A CUE IS RAISED BY A FRAME, NOT BY A POSE. Under this engine a pose is a pure
 * `(state, ...) => state` transform with no route to the audio bus, so a gesture
 * driven through the surface's pointer operations, or a `deal()` or `turnStock()`
 * pose, is free to sound nothing at all. A check whose requirement is a cue
 * therefore drives that cue's event through the REAL path and reads the list after
 * the frame that carried it: {@link tapPointer} and {@link sweepPointer} for the
 * gestures and the controls, and a plain `advance` for the cascade's own launches
 * and its win.
 *
 * The cue NAMES are `CUES` in this project's own `constants.ts`, transcribed
 * from the table in specs/audio.md, which also says which event each one
 * belongs to.
 */
export function watchCues(h: Harness): TimedCue[] {
  const played: TimedCue[] = [];
  h.engine.events.on("cue:played", ({ cue, t, gain }) => {
    played.push({ cue, t, gain, frame: h.engine.frame().count });
  });
  return played;
}
