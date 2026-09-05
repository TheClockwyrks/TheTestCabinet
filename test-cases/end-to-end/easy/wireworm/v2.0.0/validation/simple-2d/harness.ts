// Wireworm — the shared validator harness. CASE-PROVIDED.
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
// ARRANGE the world through the debug surface, and the real `update` the build
// wrote is what runs from there.
//
// WHY THE DEBUG SURFACE RATHER THAN RAW ASSIGNMENT. specs/instrumentation.md fixes
// its operations, so they mean the same thing in every build: `setNode` creates
// the node if the tile was empty, `addWorm` appends a one-segment worm heading
// right, a world gate stays off until something turns it back on, and `reset`
// gives everything back. Posing through it is how a scenario is reproducible, and
// it is the seam the case's specification documents. `surface.ts` is that
// specification as types, and it is the only description of the surface this
// harness reads: the build's own module for it is never imported.
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
// (`surface.ts`). A check still writes `h.debug.setNode(4, 4, 3)` and
// `h.debug.snapshot()`, because `h.debug` is a {@link Driver} over the raw
// surface: it runs each pose through `engine.apply` and hands each reading
// `engine.state`. Nothing a check does holds a writable state — `h.state` is the
// runtime's current value, read fresh on every access, and the only way to change
// it is a pose.
//
// THE HARNESS SUPPLIES THE CLOCK, NOT THE GAME. `ConstantClock(TICK_MS)` is the
// default, so one frame is one 120 Hz tick and every duration below is a whole
// number of them. That is why `[instrumentation]` carries no `tick_hz`: Wireworm
// mandates no fixed timestep, every rate is per second and integrated against the
// delta the frame hands the game, and the SUITE is what fixes a step so a
// tolerance can be stated in ticks and mean the same thing on every machine. A
// check that is specifically about the step size builds its own harness with a
// clock of its own.
//
// THE SEEDED ART IS SERVED HEADLESS. specs/assets.md has the build load every
// frame through the engine, which resolves each path under `assets/` relative to
// the page and fetches it. This project runs in a Node process with no page, so
// `fetch` and `createImageBitmap` are stood up over the workspace's own `assets/`
// tree for the life of each harness and put back on `dispose`. That is the same
// kind of thing the canvas, the surface metrics and the clock are — the host the
// engine runs on — and without it every scenario would draw a board the build was
// never given the art for.

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
  type PathSegment,
  type Engine,
  type Game,
  type RecordedFrame,
  type Recording,
  type PointerButton,
  type PointerDevice,
  type Resource,
  type SurfaceMetrics,
  type Viewport,
} from "@clockwyrks/simple-2d";
import type { DeepReadonly } from "ts-essentials";
import {
  BOARD_Y,
  CORRUPTOR_FRAMES,
  CURSOR_FRAMES,
  CURSOR_X_MAX,
  CURSOR_X_MIN,
  CURSOR_Y_MAX,
  CURSOR_Y_MIN,
  DROPPER_FRAMES,
  GLITCH_FRAMES,
  LAYOUT,
  NODE_FRAMES,
  STAGE_H,
  STAGE_W,
  TILE,
  WORM_FRAMES,
  tileCX,
  tileCY,
} from "./constants";
import { BACKGROUND, game as build, type WirewormState } from "../src/game";
import { assertTruthy, fail } from "./assert";
import {
  READINGS,
  type ArcSnapshot,
  type BoltSnapshot,
  type FoeKind,
  type FoeSnapshot,
  type NodeSnapshot,
  type Phase,
  type Screen,
  type MenuRect,
  type TileSnapshot,
  type WirewormDebugApi,
  type WirewormSnapshot,
  type WormSnapshot,
} from "./surface";

export type {
  ArcSnapshot,
  BoltSnapshot,
  FoeKind,
  FoeSnapshot,
  MenuRect,
  NodeSnapshot,
  Phase,
  Screen,
  TileSnapshot,
  WirewormSnapshot,
  WormSnapshot,
};

/** The case's surface, bound to the state type the build declared. */
export type WirewormSurface = WirewormDebugApi<WirewormState>;

/**
 * The build's game, typed against the surface the CASE specifies.
 *
 * The build declares its own type for the surface its `initialize` returns, and
 * that type is the build's: what a check holds it to is `surface.ts`, so the game
 * is cast to the case's `Game<WirewormState, WirewormSurface>` here and the
 * runtime is parameterized with it. A surface that departs from the specification
 * is caught where a check reaches for the missing member, not by the build's own
 * compiler.
 */
const game = build as unknown as Game<WirewormState, WirewormSurface>;

/**
 * A member of a pure surface, as a check calls it.
 *
 * A pose `(state, ...args) => S` becomes `(...args) => void`: the driver runs it
 * through `engine.apply`, so the state it returns is the state the next frame
 * receives. A reading `(state, ...args) => R` becomes `(...args) => R`: the
 * driver hands it `engine.state` and passes the rest through, which is what
 * `menuItemRect(index)` needs. Anything else (`version`) is carried as it is.
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
export type WirewormDriver = Driver<WirewormState, WirewormSurface>;

/* -------------------------------------------------------------------------- */
/* The clock                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The frame the suite steps in, in milliseconds.
 *
 * This is the SUITE's choice, not the game's: the specification deliberately
 * fixes no timestep, because the runtime hands the game whatever elapsed time a
 * frame really took. Fixing it here makes a duration a whole number of frames, so
 * a tolerance can be stated in ticks and mean the same thing on every machine.
 *
 * 120 Hz divides every figure this case is timed against finely enough to read a
 * threshold rather than a rounding: the level-1 step interval (`0.14` s) is
 * 16.8 ticks, the fire interval (`0.15` s) is 18, an arc's life (`0.32` s) and the
 * glitch's dart interval (`0.32` s) are 38.4.
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
 * A `drawImage` carries the transform the context held at the call as well,
 * because a build draws a sprite by translating to the tile's center and drawing
 * the frame about the origin (`ctx.translate(cx, cy); ctx.drawImage(f, -16, -16)`),
 * so the destination arguments alone say nothing about where the sprite landed.
 * {@link drawnImages} is what maps one back to logical units.
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
 * reads it or not, and this case's longest sweeps run thousands of frames of a
 * board drawing hundreds of operations each, so an uncapped list would be hundreds
 * of megabytes in a check that never looks at it. Past the cap the oldest half is
 * dropped, which is far beyond any single frame and so cannot cost a reading
 * anything.
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
  /** The clock each frame takes its delta from. Defaults to 120 Hz. */
  clock?: Clock;
  /** The element's laid-out CSS width. Defaults to the logical stage width. */
  cssWidth?: number;
  /** The element's laid-out CSS height. Defaults to the logical stage height. */
  cssHeight?: number;
  /** Device pixels per CSS pixel. Defaults to 1, so one device pixel is one unit. */
  dpr?: number;
}

/**
 * How one dispatched pointer event is shaped, and how long the build is given to
 * see it.
 *
 * `device` is what separates a finger from a mouse: `specs/ui.md` gives a touch
 * contact a rule of its own (a landing selects, because a finger does not
 * hover), so a check about touch passes `device: "touch"` and the runtime
 * reports the contact to the build as one.
 */
export interface PointerOptions {
  /** Which device drove the event. Defaults to a mouse. */
  device?: PointerDevice;
  /** Which button the event names. Defaults to the primary one. */
  button?: PointerButton;
  /** The pointer's id, so a second contact can be driven beside the first. */
  id?: number;
  /** Whether this is the primary pointer. Defaults to true. */
  primary?: boolean;
  /**
   * Frames advanced after the event, so the frame loop delivers it. Defaults to
   * one; `0` leaves the event undelivered so a second can join it on one frame.
   */
  frames?: number;
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
  snapshot: WirewormSnapshot;
}

export interface Harness {
  readonly engine: Engine<WirewormState, WirewormSurface>;
  /**
   * The runtime's current state, read fresh on every access. Read it, or pose it
   * through `debug`; nothing here can write to it.
   */
  readonly state: DeepReadonly<WirewormState>;
  /**
   * The debug surface the BUILD returned beside its state, driven over the
   * runtime: each pose runs through `engine.apply`, each reading is handed
   * `engine.state`.
   *
   * The raw surface is read off `engine.debug` rather than built here — see
   * {@link readDebugSurface} — and {@link driveSurface} is the wrapper.
   */
  readonly debug: WirewormDriver;
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
  snapshot(): WirewormSnapshot;
  /** Run `frames` frames back to back. */
  advance(frames: number): Promise<void>;
  /** Advance until `predicate` holds, sampling every `poll` frames. */
  until(
    predicate: (snapshot: WirewormSnapshot) => boolean,
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

  /**
   * Move the pointer to a logical point with nothing pressed, then run the frame
   * that delivers it. The hover `specs/ui.md` selects a menu item on.
   */
  movePointer(x: number, y: number, options?: PointerOptions): Promise<void>;
  /** Press the pointer at a logical point and leave it down. */
  pressPointer(x: number, y: number, options?: PointerOptions): Promise<void>;
  /** Release a pointer pressed by `pressPointer`, at a logical point. */
  releasePointer(x: number, y: number, options?: PointerOptions): Promise<void>;
  /**
   * Press and release at one logical point, both edges on ONE frame.
   *
   * `specs/ui.md` says a press and the release that follows it may arrive on one
   * frame and that the frame confirms, so this is the ordinary click and the
   * ordinary tap of a finger.
   */
  tapPointer(x: number, y: number, options?: PointerOptions): Promise<void>;

  /** Where a logical point lands in the canvas's backing store. */
  device(x: number, y: number): { x: number; y: number };
  /** The device pixel under a logical point, as `[r, g, b, a]`. */
  pixel(x: number, y: number): [number, number, number, number];

  /** Drop the runtime's listeners, release the canvas, and put the host back. */
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

/* ---- The pointer, as the runtime is delivered one -------------------------- */
//
// The menus take a mouse and a finger as well as the keyboard (`specs/ui.md`),
// and the runtime reads both off the same pointer-event stream on the target the
// `surface` option supplies. This suite runs over a canvas with no document
// behind it, so there is no `PointerEvent` constructor to call and no element to
// dispatch from: the runtime narrows structurally, reading `clientX`, `clientY`,
// `pointerId`, `pointerType`, `isPrimary`, `button` and `buttons` off whatever
// arrives, so an event carrying those drives the pointer exactly as a hand does.

/** The three pointer events the runtime listens for. */
type PointerEventName = "pointerdown" | "pointermove" | "pointerup";

/** Exactly the fields the runtime's pointer listeners read. */
interface PointerEventFields {
  clientX: number;
  clientY: number;
  pointerId: number;
  pointerType: PointerDevice;
  isPrimary: boolean;
  /** The button the event is ABOUT, as `PointerEvent.button` numbers them. */
  button: number;
  /** Every button held once the event has been applied, as a bit mask. */
  buttons: number;
}

/** A `PointerEvent`-shaped event carrying the seven fields the runtime reads. */
class PointerEventShim extends Event {
  readonly clientX: number;
  readonly clientY: number;
  readonly pointerId: number;
  readonly pointerType: PointerDevice;
  readonly isPrimary: boolean;
  readonly button: number;
  readonly buttons: number;

  constructor(type: PointerEventName, fields: PointerEventFields) {
    super(type);
    this.clientX = fields.clientX;
    this.clientY = fields.clientY;
    this.pointerId = fields.pointerId;
    this.pointerType = fields.pointerType;
    this.isPrimary = fields.isPrimary;
    this.button = fields.button;
    this.buttons = fields.buttons;
  }
}

/**
 * The bit each button occupies in `PointerEvent.buttons`, and the order
 * `PointerEvent.button` indexes them in.
 *
 * The two use different numbering, which is why each is written out rather than
 * derived from the other. Both are the browser's.
 */
const BUTTON_BITS: Readonly<Record<PointerButton, number>> = {
  primary: 1,
  secondary: 2,
  auxiliary: 4,
  back: 8,
  forward: 16,
};

const BUTTON_INDEX: readonly PointerButton[] = [
  "primary",
  "auxiliary",
  "secondary",
  "back",
  "forward",
];

/** The value `PointerEvent.button` carries for a named button. */
function buttonIndexOf(button: PointerButton): number {
  return BUTTON_INDEX.indexOf(button);
}

/** The mask `PointerEvent.buttons` carries for a set of held buttons. */
function buttonMask(held: ReadonlySet<PointerButton>): number {
  let bits = 0;
  for (const button of held) bits |= BUTTON_BITS[button];
  return bits;
}

/**
 * Where a logical point lands in the client coordinates a pointer event carries.
 *
 * The runtime maps a pointer position by `((client - origin) * dpr - offset) /
 * scale`, and this harness's surface supplies no origin, so this is that map run
 * backwards. Unrounded, deliberately: a device pixel rounded on the way out
 * lands a fraction of a unit off the point that was asked for, and a menu item's
 * edge is exactly where that fraction decides the reading.
 */
function toClient(
  view: Viewport,
  dpr: number,
  x: number,
  y: number,
): { x: number; y: number } {
  return {
    x: (view.offsetX + x * view.scale) / dpr,
    y: (view.offsetY + y * view.scale) / dpr,
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
  engine: Engine<WirewormState, WirewormSurface>,
): WirewormSurface {
  const surface: unknown = engine.debug;
  if (typeof surface !== "object" || surface === null) {
    return missingSurface(
      `engine.debug holds ${surface === null ? "null" : typeof surface}, ` +
        `not an object`,
    );
  }
  return surface as WirewormSurface;
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
function missingSurface(reason: string): WirewormSurface {
  return new Proxy({} as WirewormSurface, {
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
  engine: Engine<WirewormState, WirewormSurface>,
  raw: WirewormSurface,
): WirewormDriver {
  const readings: readonly string[] = READINGS;
  return new Proxy({} as WirewormDriver, {
    get: (_target, property): unknown => {
      if (typeof property === "symbol") return undefined;
      if (property === "then" || property === "constructor") return undefined;
      const member = (raw as unknown as Record<string, unknown>)[property];
      if (typeof member !== "function") return member;
      const op = member as (
        state: DeepReadonly<WirewormState>,
        ...args: unknown[]
      ) => unknown;
      if (readings.includes(property)) {
        return (...args: unknown[]): unknown =>
          op.call(raw, engine.state, ...args);
      }
      return (...args: unknown[]): void => {
        engine.apply((state) => op.call(raw, state, ...args) as WirewormState);
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
 * art the case seeded and the engine's loader resolves `assets/node/0.png` to the
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

  const engine = createEngine<WirewormState, WirewormSurface>({
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

  /**
   * The buttons each pointer id currently holds, kept exactly as a browser keeps
   * them: a press adds one, a release drops one, and every event reports the set
   * as it stands once the event has been applied. Without it a move issued in
   * the middle of a drag would report no button held, and the runtime would read
   * the contact as no longer down.
   */
  const heldButtons = new Map<number, Set<PointerButton>>();
  const buttonsOf = (id: number): Set<PointerButton> => {
    const found = heldButtons.get(id);
    if (found !== undefined) return found;
    const created = new Set<PointerButton>();
    heldButtons.set(id, created);
    return created;
  };

  const dispatchPointer = (
    type: PointerEventName,
    x: number,
    y: number,
    button: number,
    pointerOptions: PointerOptions,
  ): void => {
    const id = pointerOptions.id ?? 1;
    const point = toClient(engine.viewport(), dpr, x, y);
    keys.dispatchEvent(
      new PointerEventShim(type, {
        clientX: point.x,
        clientY: point.y,
        pointerId: id,
        pointerType: pointerOptions.device ?? "mouse",
        isPrimary: pointerOptions.primary ?? true,
        button,
        buttons: buttonMask(buttonsOf(id)),
      }),
    );
  };

  /** The frames a pointer helper runs so the build sees what it dispatched. */
  const deliver = (pointerOptions: PointerOptions): Promise<void> =>
    engine.advance(pointerOptions.frames ?? 1);

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

    hold: (code) => dispatch("keydown", code),
    release: (code) => dispatch("keyup", code),
    async tap(code) {
      dispatch("keydown", code);
      dispatch("keyup", code);
      await engine.advance(1);
    },

    async movePointer(x, y, pointerOptions = {}) {
      // `-1` is what a browser puts in `button` for an event about position.
      dispatchPointer("pointermove", x, y, -1, pointerOptions);
      await deliver(pointerOptions);
    },
    async pressPointer(x, y, pointerOptions = {}) {
      const button = pointerOptions.button ?? "primary";
      buttonsOf(pointerOptions.id ?? 1).add(button);
      dispatchPointer(
        "pointerdown",
        x,
        y,
        buttonIndexOf(button),
        pointerOptions,
      );
      await deliver(pointerOptions);
    },
    async releasePointer(x, y, pointerOptions = {}) {
      const button = pointerOptions.button ?? "primary";
      buttonsOf(pointerOptions.id ?? 1).delete(button);
      dispatchPointer("pointerup", x, y, buttonIndexOf(button), pointerOptions);
      await deliver(pointerOptions);
    },
    async tapPointer(x, y, pointerOptions = {}) {
      const button = pointerOptions.button ?? "primary";
      const id = pointerOptions.id ?? 1;
      buttonsOf(id).add(button);
      dispatchPointer(
        "pointerdown",
        x,
        y,
        buttonIndexOf(button),
        pointerOptions,
      );
      buttonsOf(id).delete(button);
      dispatchPointer("pointerup", x, y, buttonIndexOf(button), pointerOptions);
      await deliver(pointerOptions);
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
//    check that poses a critical node and then fires a bolt into it records the
//    discharge; the pose costs nothing, and the reviewer is not asked to scrub
//    past a minute of arrangement to reach the half second that decides the point.
//    ARM IT NARROWLY. A discharge redraws a lightning polyline over every arc for
//    `ARC_LIFE`, and a board redraws its grid every frame; the recorder holds
//    16 MB of captured image bytes before new captures degrade to an opaque
//    marker, so a recording armed around a whole scenario buys a reviewer nothing
//    and can cost the frames the check was about.
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
 * `validation/worm/winds-horizontal.test.ts` — because that is the path the review
 * item's declared script resolves to, and so the only name the case's manifest and
 * the runner both already agree on.
 */
const STAGED_PROJECT_DIR = "validation";

/**
 * The most frames a written recording holds.
 *
 * A recording is one JSON operation log per frame, and a frame of this game is a
 * few hundred operations — the trace grid, every node on the board, every segment
 * of every worm — so a section a check drives for half a minute of game time runs
 * to tens of megabytes: a file nobody can serve to a reviewer and nobody wants in
 * a run's artifacts. The cap is what makes `captureReplay` safe to wrap ANY
 * section in.
 *
 * It is generous enough that the great majority of this suite's sections — a
 * discharge, ten worm steps, a second of a foe's descent — are written whole.
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
 * what these outputs are named for. A recording of a worm's descent is evidence
 * that it wound, dropped and reversed the whole way down, and the turns are spread
 * across the whole of it.
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
 * check's sweep stopped at — the detonation, the split, the life lost — and it is
 * the one a reviewer looks at first.
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
    console.warn(`wireworm: could not write ${destination}: ${String(error)}`);
  }
}

/**
 * Record the frames `scenario` draws and keep them as the review item's
 * `outputId` output, handing back whatever the scenario returned.
 *
 * Wrap the drive, not the arrangement:
 *
 * ```ts
 * const swept = await captureReplay(h, "propagation", () =>
 *   h.until((s) => s.arcs.length > 0, { maxFrames: 120 }),
 * );
 * assertGreaterThan(swept.snapshot.arcs.length, 0);
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
 * PICTURE rather than a stretch of motion: the board a discharge left behind,
 * which screen the game opened on, what the HUD read. A recording of a still board
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
    console.warn(`wireworm: could not write ${destination}: ${String(error)}`);
  }
}

/* -------------------------------------------------------------------------- */
/* Reading a snapshot                                                         */
/* -------------------------------------------------------------------------- */
//
// The snapshot is plain data, so most readings are a field access and belong in
// the check that makes them. What is here is the handful a check would otherwise
// write out every time: the tile a reported center stands on, the charge on a
// tile, and finding an entity by the id a pose handed back.
//
// EVERY LOOK-UP BY ID FAILS RATHER THAN RETURNING NOTHING. A check holds an id
// because a pose put an entity on the board and the snapshot reported it; an id
// that is no longer there is the build having lost the entity, which is a verdict
// and not an absent value for the check to reason about. So these fail by
// assertion, naming what the surface promised, and the check reads the entity on
// the next line.

/** The tile a reported center stands on (specs/board.md). */
export function tileOf(x: number, y: number): TileSnapshot {
  return { c: Math.floor(x / TILE), r: Math.floor((y - BOARD_Y) / TILE) };
}

/** Whether two tiles are the same tile. */
export function sameTile(a: TileSnapshot, b: TileSnapshot): boolean {
  return a.c === b.c && a.r === b.r;
}

/** A tile as `"c,r"`, for a set comparison or a failure message. */
export function tileKey(tile: TileSnapshot): string {
  return `${tile.c},${tile.r}`;
}

/**
 * The charge on tile `(c, r)`, or `null` where the tile holds no node.
 *
 * `null` rather than `0`, because the two are different states: an inert node is a
 * node a bolt can clear and a worm can bump, and an empty tile is not
 * (specs/nodes.md).
 */
export function chargeAt(
  snapshot: WirewormSnapshot,
  c: number,
  r: number,
): number | null {
  const node = snapshot.nodes.find((held) => held.c === c && held.r === r);
  return node === undefined ? null : node.charge;
}

/** Every node on the board as `"c,r"`, for a set comparison. */
export function nodeKeys(snapshot: WirewormSnapshot): string[] {
  return snapshot.nodes.map((node) => tileKey(node));
}

/** The worm with that id. Fails the check if the roster no longer holds it. */
export function wormOf(snapshot: WirewormSnapshot, id: number): WormSnapshot {
  const found = snapshot.worms.find((worm) => worm.id === id);
  assertTruthy(
    found,
    `snapshot() must report the worm with id ${id}: an entity added through ` +
      "the surface keeps its id until something removes it " +
      "(specs/instrumentation.md)",
  );
  return found as WormSnapshot;
}

/** The last worm in the roster, which is the one an `addWorm` appended. */
export function lastWorm(snapshot: WirewormSnapshot): WormSnapshot {
  const found = snapshot.worms[snapshot.worms.length - 1];
  assertTruthy(
    found,
    "snapshot() must report the worm addWorm appended to the roster " +
      "(specs/instrumentation.md)",
  );
  return found;
}

/** A worm's head tile, which is `segments[0]`. */
export function headOf(worm: WormSnapshot): TileSnapshot {
  const head = worm.segments[0];
  assertTruthy(
    head,
    `worm ${worm.id} must report at least its head as segments[0] ` +
      "(specs/instrumentation.md)",
  );
  return head;
}

/** A worm's tail tile, which is the last of its segments. */
export function tailOf(worm: WormSnapshot): TileSnapshot {
  const tail = worm.segments[worm.segments.length - 1];
  assertTruthy(
    tail,
    `worm ${worm.id} must report at least its head as segments[0] ` +
      "(specs/instrumentation.md)",
  );
  return tail;
}

/** Whether any worm on the board stands on `(c, r)`. */
export function segmentAt(
  snapshot: WirewormSnapshot,
  c: number,
  r: number,
): boolean {
  return snapshot.worms.some((worm) =>
    worm.segments.some((tile) => tile.c === c && tile.r === r),
  );
}

/** The foe with that id. Fails the check if the roster no longer holds it. */
export function foeOf(snapshot: WirewormSnapshot, id: number): FoeSnapshot {
  const found = snapshot.foes.find((foe) => foe.id === id);
  assertTruthy(
    found,
    `snapshot() must report the foe with id ${id}: an entity added through ` +
      "the surface keeps its id until something removes it " +
      "(specs/instrumentation.md)",
  );
  return found as FoeSnapshot;
}

/** The last foe in the roster, which is the one an `addFoe` appended. */
export function lastFoe(snapshot: WirewormSnapshot): FoeSnapshot {
  const found = snapshot.foes[snapshot.foes.length - 1];
  assertTruthy(
    found,
    "snapshot() must report the foe addFoe appended to the roster " +
      "(specs/instrumentation.md)",
  );
  return found;
}

/** The bolt with that id, or `null` once it has resolved or left the board. */
export function boltOf(
  snapshot: WirewormSnapshot,
  id: number,
): BoltSnapshot | null {
  return snapshot.bolts.find((bolt) => bolt.id === id) ?? null;
}

/** The last bolt in the roster, which is the one an `addBolt` appended. */
export function lastBolt(snapshot: WirewormSnapshot): BoltSnapshot {
  const found = snapshot.bolts[snapshot.bolts.length - 1];
  assertTruthy(
    found,
    "snapshot() must report the bolt addBolt appended to the roster " +
      "(specs/instrumentation.md)",
  );
  return found;
}

/**
 * One arc as `"c,r>c,r"`, in the direction the snapshot reported it.
 *
 * Ordered, because that is what `discharge.detonated-once` reads: a node detonated
 * a second time re-emits its links, so the same ordered pair appearing twice is
 * the witness of a double detonation.
 */
export function arcKey(arc: ArcSnapshot): string {
  return `${tileKey(arc.from)}>${tileKey(arc.to)}`;
}

/** Every live arc as `"c,r>c,r"`, in roster order. */
export function arcKeys(snapshot: WirewormSnapshot): string[] {
  return snapshot.arcs.map(arcKey);
}

/* -------------------------------------------------------------------------- */
/* Scenario helpers                                                           */
/* -------------------------------------------------------------------------- */
//
// Each of these poses a situation through the debug surface and then lets the real
// simulation run. THEY FIX ONLY GEOMETRY: which tile a worm's head is on, which
// tile a node stands on, where the cursor is parked. Every threshold a check
// asserts is stated in the check itself, derived from the figure specs/ fixes for
// it, because a helper that carried the tolerance would hide what the check is
// really asserting.
//
// The debug surface is atomic by design (specs/instrumentation.md), so every
// compound sequence lives here. A check that needs all of a sequence calls the
// helper; a check that needs only part of it calls the operations it needs.
// Nothing a check does not ask for happens.

/**
 * The center of the player band, where a run and every respawn place the cursor
 * (specs/board.md).
 *
 * Derived from the clamp bounds rather than restated, so the two cannot drift.
 */
export const BAND_CX = (CURSOR_X_MIN + CURSOR_X_MAX) / 2;
export const BAND_CY = (CURSOR_Y_MIN + CURSOR_Y_MAX) / 2;

/**
 * Open live play on an EMPTY, QUIET board at level 1, with the cursor parked in
 * the middle of its band.
 *
 * This is the ground almost every check in this suite stands on, and both halves
 * of it are load-bearing.
 *
 * EMPTY is safe because of the level-clear rule: a level clears on the step in
 * which the last of its worm segments is REMOVED, so a board that never held one
 * never clears (specs/progression.md). A check therefore poses exactly the
 * entities its requirement concerns and nothing else, rather than keeping a
 * bystander worm alive to hold the level open.
 *
 * QUIET is the three world gates. With `foeSpawning`, `wormEntry` and the cursor's
 * `contact` all off, nothing the scenario did not ask for arrives, enters, or
 * costs a life — and each of the three would otherwise reach in. An empty board is
 * maximally sparse, so from level 3 a dropper is drawn in on the first
 * `DROPPER_CHECK_INTERVAL` check and from level 2 glitches arrive every
 * `GLITCH_MIN_INTERVAL`–`GLITCH_MAX_INTERVAL`; the level's worm enters as the
 * banner gives way to `active`; and the cursor is the one entity no scenario can
 * remove, so its contact test reaches into any scenario run near the band or
 * advanced far enough for a foe to descend, where a life lost empties both
 * rosters mid-scenario.
 *
 * TURNING A GATE BACK ON IS THE EXCEPTION, AND THE CHECK THAT DOES IT IS THE CHECK
 * WHOSE REQUIREMENT THE GATE IS — the foes' arrival items for `setFoeSpawning`,
 * the worm-entry and respawn items for `setWormEntry`, the contact, life-loss and
 * respawn items for `setCursorContact`. Any other check that finds itself needing
 * one has been mis-posed; re-pose it.
 *
 * It poses and returns; it runs no frame. A check advances the frames its own
 * reading needs.
 *
 * It is written for a FRESH harness, whose state is the opening one, so it does
 * not reset: the score, the lives and the seed are already at their title values.
 * A check that reuses a harness across scenarios calls `h.debug.reset()` first.
 */
export function startPlaying(h: Harness): void {
  h.debug.clearNodes();
  h.debug.clearWorms();
  h.debug.clearFoes();
  h.debug.clearBolts();

  h.debug.setFoeSpawning(false);
  h.debug.setWormEntry(false);
  h.debug.setCursorContact(false);

  h.debug.setScreen("playing");
  h.debug.setPhase("active");
  h.debug.setPhaseTimer(0);
  h.debug.setLevel(1);

  h.debug.setCursor(BAND_CX, BAND_CY);
  h.debug.setCursorInvulnerable(0);
  h.debug.setFireCooldown(0);
}

/**
 * Pose one worm, head on `(c, r)`, `length` segments long, and report its id.
 *
 * The body is laid along the head's row BEHIND the head — the tile the head came
 * from, and the one behind that — so a worm heading right at `(c, r)` occupies
 * `(c, r)`, `(c - 1, r)`, and so on. Pose the head at least `length - 1` tiles
 * from the edge it came from, or a trailing segment lands off the board.
 *
 * The headings are posed after the segments, so `dh` and `dv` are what the worm
 * holds when the first frame runs, whatever `addWorm` opened with. Both faculties
 * are left ON, which is what `addWorm` gives: a check that wants the head to move
 * one tile and nothing else turns `body` off, and a check that wants the worm as
 * an obstacle turns `stepping` off.
 */
export function poseWorm(
  h: Harness,
  c: number,
  r: number,
  length = 1,
  dh = 1,
  dv = 1,
): number {
  h.debug.addWorm(c, r);
  const id = lastWorm(h.snapshot()).id;
  for (let i = 1; i < length; i += 1) {
    h.debug.appendSegment(id, c - dh * i, r);
  }
  h.debug.setWormHeading(id, dh);
  h.debug.setWormDescent(id, dv);
  return id;
}

/**
 * Pose one foe of `kind` centered on tile `(c, r)`, and report its id.
 *
 * It arrives at that kind's own resting velocity with both faculties on, which is
 * what `addFoe` gives. A check about what a foe DOES to the field turns `travel`
 * off, so the effect happens with no motion at all; a check about how it TRAVELS
 * leaves both on and reads distances.
 */
export function poseFoe(
  h: Harness,
  kind: FoeKind,
  c: number,
  r: number,
): number {
  h.debug.addFoe(kind, tileCX(c), tileCY(r));
  return lastFoe(h.snapshot()).id;
}

/**
 * Pose one bolt in flight, centered on tile `(c, r)`, and report its id.
 *
 * The bolt travels up and resolves through the game's own shot rules from there;
 * pose it below the thing the check is about, far enough to leave a frame or two
 * of flight.
 */
export function poseBolt(h: Harness, c: number, r: number): number {
  h.debug.addBolt(tileCX(c), tileCY(r));
  return lastBolt(h.snapshot()).id;
}

/**
 * Pose a patch of node field from a picture of it, its top-left tile at
 * `(c0, r0)`.
 *
 * A digit `0`–`3` sets the node on that tile to that charge; any other character
 * leaves the tile exactly as it was. On the empty board {@link startPlaying}
 * poses, "leaves it as it was" is "leaves it empty", which is what makes a cluster
 * read as the picture of it:
 *
 * ```ts
 * poseField(h, ["...", ".3.", "..."], 10, 5); // one critical node at (11, 6)
 * ```
 */
export function poseField(
  h: Harness,
  rows: readonly string[],
  c0: number,
  r0: number,
): void {
  rows.forEach((row, dr) => {
    [...row].forEach((cell, dc) => {
      if (cell >= "0" && cell <= "3") {
        h.debug.setNode(c0 + dc, r0 + dr, Number(cell));
      }
    });
  });
}

/**
 * Hold every key in `codes` for `ticks` frames, then release them.
 *
 * Nothing here poses anything: the keys go to the engine's own input, so the game
 * answers them exactly as it answers a player. Which key drives which action is
 * `BINDINGS`, as specs/controls.md fixes it and `./constants` restates it.
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
 * The cue NAMES are `CUES` in `./constants`; specs/ui.md fixes each name and
 * says which event it belongs to.
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

/* ---- Where a frame put its sprites ---------------------------------------- */

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
  /** The build drew it flipped, which is how a leftward body is mirrored. */
  mirrored: boolean;
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
 * A build draws a sprite by translating to the tile's center and drawing the frame
 * about the origin, so the call's own arguments say nothing about where the sprite
 * landed. The destination box's center is taken through the transform the context
 * held at the call and then back through the engine's fit, so what comes out is
 * the point on the stage a check can hold against a reported center — which is how
 * a draw is attributed to the node, segment or foe it was drawn for.
 *
 * All three argument forms are read: `(image, dx, dy)`, `(image, dx, dy, dw, dh)`,
 * and the nine-argument form with a source rectangle.
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
    if (rest.length >= 8) {
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
    drawn.push({
      source,
      x: (deviceX - view.offsetX) / view.scale,
      y: (deviceY - view.offsetY) / view.scale,
      w: Math.abs(dw * Math.hypot(m.a, m.b)) / view.scale,
      h: Math.abs(dh * Math.hypot(m.c, m.d)) / view.scale,
      // A negative determinant is a flip, whichever axis the build wrote it on.
      mirrored: m.a * m.d - m.b * m.c < 0,
    });
  }
  return drawn;
}

/* ---- The seeded art ------------------------------------------------------- */

/** Every folder under `assets/`, and how many frames each holds. */
export const SPRITE_FOLDERS = {
  node: NODE_FRAMES,
  worm: WORM_FRAMES,
  cursor: CURSOR_FRAMES,
  glitch: GLITCH_FRAMES,
  dropper: DROPPER_FRAMES,
  corruptor: CORRUPTOR_FRAMES,
} as const;

export type SpriteFolder = keyof typeof SPRITE_FOLDERS;

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

/** Read once, because every presentation check reads the same twenty-one files. */
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
 * stay well inside it, so one stray anti-aliased or glow pixel cannot swing the
 * reading.
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

/** The rendered colour on tile `(c, r)`, sampled about its centre. */
export function sampleTile(h: Harness, c: number, r: number): Rgb {
  return sampleColor(h, tileCX(c), tileCY(r));
}

/** Euclidean distance between two colours, 0 to about 441. */
export function colorDistance(a: Rgb, b: Rgb): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

/**
 * `steps` colours sampled evenly along the segment joining two logical points,
 * both ends included.
 *
 * How a check reads whether the build drew something ALONG a line — an arc between
 * two tile centres, a bolt's climb — without knowing what colour it drew it in.
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
/* The menus, where the build drew them                                       */
/* -------------------------------------------------------------------------- */
//
// `specs/ui.md` gives every menu screen a mouse and a finger as well as the
// keyboard, and deliberately leaves the LAYOUT to the build: what it fixes is
// that the build reports each item's hit region through `menuItemRect`, and that
// a pointer over that region selects the item. So every helper below asks the
// build where it put the item and then drives the pointer there. Nothing here
// knows a menu coordinate, and a build that lays its menus out any way it likes
// passes.

/**
 * The hit region of item `index` on the menu the current screen shows.
 *
 * `menuItemRect` returns `null` on `playing` and `howto`, which show no menu,
 * and for an index the current menu has no item at. A check that asked for an
 * item it expects to exist gets a failure naming the reading rather than a
 * `TypeError` on the next line.
 */
export function menuRect(h: Harness, index: number): MenuRect {
  const rect = h.debug.menuItemRect(index);
  assertTruthy(
    rect,
    `menuItemRect(${index}) must report the hit region of item ${index} on ` +
      `the menu the current screen shows (specs/instrumentation.md)`,
  );
  return rect as MenuRect;
}

/** The centre of item `index`'s hit region, in logical units. */
export function menuItemCenter(
  h: Harness,
  index: number,
): { x: number; y: number } {
  const rect = menuRect(h, index);
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/**
 * Move the pointer onto item `index` and run the frame that delivers it.
 *
 * The hover `specs/ui.md` selects on: no button is pressed, so what a check
 * reads afterwards is `menuIndex` alone.
 */
export async function pointAtItem(
  h: Harness,
  index: number,
  options: PointerOptions = {},
): Promise<void> {
  const at = menuItemCenter(h, index);
  await h.movePointer(at.x, at.y, options);
}

/**
 * Press and release inside item `index`'s region, both edges on one frame.
 *
 * A press and its release inside ONE region is what confirms (`specs/ui.md`),
 * and a frame may carry both, so this is the ordinary click. Pass
 * `device: "touch"` for the finger's form of the same gesture, whose landing
 * also selects.
 */
export async function clickItem(
  h: Harness,
  index: number,
  options: PointerOptions = {},
): Promise<void> {
  const at = menuItemCenter(h, index);
  await h.tapPointer(at.x, at.y, options);
}

/** {@link clickItem} with a finger: a touch contact landing and lifting. */
export function touchItem(
  h: Harness,
  index: number,
  options: PointerOptions = {},
): Promise<void> {
  return clickItem(h, index, { ...options, device: "touch" });
}

/**
 * Press inside item `from`'s region, travel onto item `to`'s, and release there.
 *
 * The slide-off affordance: a press begun on one item and released on another
 * confirms nothing (`specs/ui.md`). Three driven frames, so the press, the
 * travel and the release are each read.
 */
export async function slideOffItem(
  h: Harness,
  from: number,
  to: number,
  options: PointerOptions = {},
): Promise<void> {
  const start = menuItemCenter(h, from);
  await h.pressPointer(start.x, start.y, options);
  const end = menuItemCenter(h, to);
  await h.movePointer(end.x, end.y, options);
  await h.releasePointer(end.x, end.y, options);
}
