// Shatter — the shared validator harness. CASE-PROVIDED.
//
// Every check in this suite is an ordinary vitest test that runs IN THE SAME
// PROCESS as the build. It imports the engine and the build's own modules,
// creates an engine over a canvas it owns and a clock it chose, and steps the
// game with `engine.advance`. Nothing drives a browser, nothing polls, and no
// wall-clock time passes: a check asks for a number of ticks and gets exactly
// that number.
//
// THE HARNESS SUPPLIES THE CLOCK. `ConstantClock(TICK_MS)` at Shatter's own
// `TICK_HZ`, so one advanced frame delivers exactly one `TICK_DT` of game time
// and `h.advance(n)` runs `n` whole simulation ticks. That is why
// `[instrumentation]` in `test-case.toml` carries no `tick_hz`: the rate is a
// rule of the GAME (`specs/simulation.md`), transcribed into `./constants` and
// asserted by the checklist, and the suite reads it from there rather than being
// handed it by the runner.
//
// WHAT A CHECK READS. The game's own state, through the debug surface's
// `snapshot`; the cues the engine broadcast; the calls the 2D context received
// and the pixels they left on the canvas. Nothing here fabricates an outcome:
// the scenario helpers below only ARRANGE the world through the debug surface,
// and the real `update` the build wrote is what runs from there.
//
// WHERE THE SURFACE COMES FROM. Off `engine.debug`, never built here. The
// build's `initialize` returns it beside the state, as `[state, debug]`
// (`specs/instrumentation.md`), and the engine holds the second element. Reading
// it back off the engine is the only way a surface reaches a check, so a build
// that returned no surface, or one missing an operation, fails the checks that
// reach the game through it — and fails them at the point that reached, never in
// a `beforeEach`. See {@link readDebugSurface} and {@link missingSurface}.
//
// HOW THE SURFACE IS DRIVEN. The engine holds the state by value and hands it
// out read-only, so the surface is pure: a pose takes the current state and
// returns the next, a reading takes the current state and returns what it read
// (`surface.ts`). A check still writes `h.debug.setShipPosition(640, 560)` and
// `h.debug.snapshot()`, because `h.debug` is a {@link Driver} over the raw
// surface: it runs each pose through `engine.apply` and hands each reading
// `engine.state`. Nothing a check does holds a writable state.
//
// THE THREE RULES THIS FILE IS BUILT TO, which a validator author should read
// before reaching for anything below:
//
//  1. THE HARNESS OWNS EVERY COMPOUND SEQUENCE. The debug surface is atomic by
//     design — one field, one roster, one entity per operation — so "open a
//     quiet run", "empty the world" and "shoot the field down" are helpers here,
//     built out of those atoms, and never operations on the surface. A check
//     that needs only part of a sequence calls the atoms it needs: nothing a
//     check did not ask for happens.
//  2. HELPERS FIX GEOMETRY, NEVER THRESHOLDS. Where a rock is put, which side of
//     it a round comes in on, how many ticks a sweep strides — those are here.
//     Every bound a check asserts is stated IN THAT CHECK, derived from the
//     figure `specs/` fixes for it. There is no `TOLERANCE` in this file.
//  3. AN ENTITY A CHECK READS IS HARD-ASSERTED FIRST. {@link rockById},
//     {@link lastBullet}, {@link theSaucer} and the rest fail by assertion,
//     naming what the specification owed, rather than handing back `undefined`
//     for a later line to dereference. A build that launched nothing must fail
//     the check about launching, not crash the file and be misreported as having
//     exposed no debug surface. (Fold-in fix D.)
//
// A FRAME THAT NOBODY LOOKS AT IS NOT DRAWN. Every tick this harness runs is a
// real tick of the build's own `update`; what a march does without is the
// build's `render`. `engine.advance(n)` renders every one of the `n` frames it
// runs, and rendering is ninety-six per cent of what a frame costs in this
// project — 0.16 ms against 0.006 ms for the simulation itself — so a check that
// waits out the eighteen seconds before the first saucer spent almost all of its
// budget drawing 2 160 pictures nothing would ever read. {@link Harness.advance}
// therefore draws its LAST frame and no other: the state it leaves and the
// picture on the canvas are exactly what drawing every frame would have left,
// because each frame clears and redraws the whole canvas, and only the
// intermediate frames' entries in {@link Harness.calls} are gone. A frame the
// engine's replay recorder is capturing is always drawn, whatever a march asked
// for, so a captured section is never a run of blank frames.
//
// AND A MARCH THAT WANTS NO PICTURE AT ALL SAYS SO. {@link Harness.skip} and
// `until(..., { quiet: true })` run every tick undrawn, for the sweeps that
// sample the state on EVERY tick and would otherwise draw every one of them.
// What they leave behind is a canvas holding an older frame, so the harness
// tracks that: {@link Harness.pixel}, {@link sample} and {@link captureStill}
// REFUSE while the canvas is stale rather than reading a picture from a tick
// that is no longer the current one. A check that wants the picture after a
// quiet sweep advances one drawn tick for it.

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
  BINDINGS,
  FACE_UP,
  FIELD_H,
  FIELD_W,
  LAYOUT,
  MUZZLE_SPEED,
  SAFE_X,
  SAFE_Y,
  START_LIVES,
  TICK_DT,
  TICK_HZ,
  type ActionName,
} from "./constants";
import { BACKGROUND, game as build, type ShatterState } from "../src/game";
import { fail } from "./assert";
import {
  closestApproachTo,
  outwardFromStar,
  wrap,
  type Point,
} from "./geometry";
import {
  READINGS,
  type BulletSnapshot,
  type RockSize,
  type RockSnapshot,
  type SaucerSnapshot,
  type Screen,
  type ShatterDebugApi,
  type ShatterSnapshot,
  type TorpedoSnapshot,
} from "./surface";

export type { Point, RockSize, Screen };

/** The case's surface, bound to the state type the build declared. */
export type ShatterSurface = ShatterDebugApi<ShatterState>;

/**
 * The build's game, typed against the surface the CASE specifies.
 *
 * The build declares its own type for the surface its `initialize` returns, and
 * that type is the build's: what a check holds it to is `surface.ts`, so the
 * game is cast to the case's `Game<ShatterState, ShatterSurface>` here and the
 * engine is parameterized with it. A surface that departs from the specification
 * is caught where a check reaches for the missing member, not by the build's own
 * compiler.
 */
const game = build as unknown as Game<ShatterState, ShatterSurface>;

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
  : M extends (state: DeepReadonly<S>, ...args: infer A) => infer R
    ? (...args: A) => R
    : M;

/**
 * The imperative reading of a pure surface: every member of `D`, minus its state
 * argument, over the engine that holds the state.
 *
 * Optional members stay optional, so a `warhead`-only pose is still
 * `h.debug.clearTorpedoes?.()` and a `base` slice never reaches for one.
 */
export type Driver<S, D> = {
  [K in keyof D]: Driven<S, NonNullable<D[K]>>;
};

/** The surface as every check drives it. */
export type ShatterDriver = Driver<ShatterState, ShatterSurface>;

/* -------------------------------------------------------------------------- */
/* The clock                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The frame the suite steps in, in milliseconds.
 *
 * Derived from the game's OWN fixed step, which `specs/simulation.md` fixes and
 * `./constants` transcribes. One advanced frame therefore delivers exactly one
 * `TICK_DT` of delta, so `h.advance(n)` runs `n` whole simulation ticks and a
 * tolerance stated in ticks means the same thing on every machine.
 */
export const TICK_MS = 1000 / TICK_HZ;

/** The whole ticks that cover `seconds` of game time. */
export function ticksFor(seconds: number): number {
  return Math.round(seconds * TICK_HZ);
}

/** The seconds of game time `ticks` ticks cover. */
export function secondsFor(ticks: number): number {
  return ticks * TICK_DT;
}

/** The magnitude of a velocity, as `ship.speed` and `rocks[].radius` are built. */
export function speedOf(v: { vx: number; vy: number }): number {
  return Math.hypot(v.vx, v.vy);
}

/* -------------------------------------------------------------------------- */
/* The harness                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Where a `fillText`/`strokeText` call put its text, read off the real context
 * at the moment of the call: the current transform, so the anchor can be mapped
 * to logical units whatever `translate`/`scale` the build applied, the measured
 * width under the current font, and the alignment that places the run about its
 * anchor.
 */
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

/** One cue the build played, as the engine announced it. */
export interface PlayedCue {
  cue: string;
  /** Frame-loop time, in milliseconds. */
  t: number;
  /** `0` while muted, which is how `audio/mute-silences` reads a silenced cue. */
  gain: number;
}

/** One looping cue the build started or stopped, as the engine announced it. */
export interface LoopedCue {
  cue: string;
  t: number;
}

export interface HarnessOptions {
  /** The clock each frame takes its delta from. Defaults to Shatter's own tick. */
  clock?: Clock;
  /** The element's laid-out CSS width. Defaults to the logical field width. */
  cssWidth?: number;
  /** The element's laid-out CSS height. Defaults to the logical field height. */
  cssHeight?: number;
  /** Device pixels per CSS pixel. Defaults to 1, so one device pixel is one unit. */
  dpr?: number;
}

/** How far a sweep may run, and how many ticks separate two samples. */
export interface UntilOptions {
  maxFrames?: number;
  poll?: number;
}

/** What a sweep found: whether the predicate ever held, and where it stopped. */
export interface UntilResult {
  hit: boolean;
  /** Ticks advanced before the sample that ended the sweep. */
  frames: number;
  snapshot: ShatterSnapshot;
}

export interface Harness {
  readonly engine: Engine<ShatterState, ShatterSurface>;
  /**
   * The engine's current state, read fresh on every access. Read it, or pose it
   * through `debug`; nothing here can write to it.
   */
  readonly state: DeepReadonly<ShatterState>;
  /**
   * The debug surface the BUILD returned beside its state, driven over the
   * engine: each pose runs through `engine.apply`, each reading is handed
   * `engine.state`.
   */
  readonly debug: ShatterDriver;
  /** The real 2D context, for `getImageData`. Draw calls also reach it. */
  readonly ctx: SKRSContext2D;
  /**
   * The surface the engine drew into, holding the last frame that ran.
   *
   * Exposed for {@link captureStill}, which encodes it: a still output is the
   * picture the build actually put on the canvas, and the only place that
   * picture exists is here.
   */
  readonly canvas: Canvas;
  /** Every call and property set the render made, oldest first. */
  readonly calls: DrawCall[];
  /** Every cue the build played, oldest first. */
  readonly cues: PlayedCue[];
  /** Every looping cue the build started, oldest first: the thrust burn. */
  readonly loops: LoopedCue[];
  /** Every looping cue the build stopped, oldest first. */
  readonly stops: LoopedCue[];

  /** A fresh read of the game's state through the case's `snapshot`. */
  snapshot(): ShatterSnapshot;
  /**
   * Run `frames` whole ticks back to back, drawing the last of them.
   * `advance(0)` runs nothing.
   *
   * Every tick is a real tick of the build's own `update`. Only the last is
   * rendered, which is all a caller can read anyway — each frame clears and
   * redraws the whole canvas, so the picture after `advance(n)` is the picture
   * the nth frame drew either way. What is gone is the intermediate frames'
   * entries in {@link calls}; a check reading one frame's render clears the list
   * and advances one tick, which is unchanged. See the header.
   */
  advance(frames: number): Promise<void>;
  /**
   * Run `frames` whole ticks back to back, drawing NONE of them.
   *
   * The march to a state nobody needs to watch — waiting out the eighteen
   * seconds before the first saucer, running a torpedo's ten-second recharge
   * down, settling a pose. The same real ticks {@link advance} runs; what is
   * skipped is the drawing. The canvas is left holding an older frame, so
   * {@link pixel}, {@link sample} and {@link captureStill} refuse until a drawn
   * tick has run.
   */
  skip(frames: number): Promise<void>;
  /**
   * Run `body` with the drawing suppressed for every tick inside it, whatever
   * those ticks were asked for through.
   *
   * The route for a check that samples the state on EVERY tick — the aim
   * group's shot-by-shot sweep, `saucer/at-most-one-at-a-time`'s trace of the
   * reported ids across two minutes. Those loops call `advance(1)` a tick at a
   * time on purpose, so that no tick is ever stepped over, and each of those
   * calls would otherwise draw its one frame: fourteen thousand pictures to
   * read one number off each. Inside a quiet scope the same ticks run, the
   * same snapshots are read, and one frame is drawn rather than all of them.
   *
   * The canvas is left holding an older frame, so a check that wants evidence
   * of where its sweep ended advances one drawn tick after it — after the
   * reading its verdict rests on has been taken.
   */
  quiet<T>(body: () => Promise<T>): Promise<T>;
  /**
   * Run ONE frame with the drawing on, whatever quiet scope is open around it.
   *
   * The way out of a quiet sweep for a check whose EVIDENCE is a moment inside
   * it — the first arrival of `saucer/at-most-one-at-a-time`, say. The frame is
   * a real frame like any other, so the picture it leaves is one tick past the
   * moment the sweep read, which is what a still of that moment honestly is.
   */
  paint(): Promise<void>;
  /** Advance until `predicate` holds, sampling every `poll` ticks. */
  until(
    predicate: (snapshot: ShatterSnapshot) => boolean,
    options?: UntilOptions,
  ): Promise<UntilResult>;
  /** Drive the engine's own frame loop for `ms` of real time, then halt it. */
  runFor(ms: number): Promise<void>;

  /** Press a key and leave it down, as a player holding it would. */
  hold(code: string): void;
  /** Release a key held by `hold`. */
  release(code: string): void;
  /**
   * Press and release a key with a REAL FRAME between the two, then run the
   * frame that delivers the release.
   *
   * The frame in the middle is deliberate. `specs/controls.md` reads firing "as
   * a press and as a hold", so a build may answer the armed edge or the held
   * value, and both are conformant; a tap with no frame inside it is invisible
   * to the second reading. Two ticks, therefore, and the gun's own
   * `FIRE_INTERVAL_TICKS` gate is what keeps either reading to one shot.
   */
  tap(code: string): Promise<void>;

  /**
   * Move the pointer to a logical point without pressing anything, then run the
   * frame that delivers it.
   */
  movePointer(x: number, y: number, options?: PointerOptions): Promise<void>;
  /** Press the pointer at a logical point and leave it down. */
  pressPointer(x: number, y: number, options?: PointerOptions): Promise<void>;
  /** Release a pointer pressed by {@link pressPointer}, at a logical point. */
  releasePointer(x: number, y: number, options?: PointerOptions): Promise<void>;

  /** Drop every recorded draw call, so what follows is one frame's alone. */
  clearCalls(): void;
  /** Where a logical point lands in the canvas's backing store. */
  device(x: number, y: number): { x: number; y: number };
  /**
   * Where a logical point lands in the client coordinates a pointer event
   * reports its position in.
   *
   * The same letterboxed fit {@link Harness.device} goes through, taken back to
   * CSS pixels, which is what the engine maps a pointer event through
   * (`engine/input.md`). Unrounded, deliberately: a device pixel rounded on the
   * way out lands a fraction of a unit off the point that was asked for, and a
   * menu entry's edge is exactly where that fraction decides the reading.
   */
  client(x: number, y: number): { x: number; y: number };
  /**
   * The device pixel under a logical point, as `[r, g, b, a]`.
   *
   * Fails by assertion when the last tick that ran was not drawn — after a
   * {@link skip} or a quiet sweep — rather than reporting a picture from a tick
   * that is no longer the current one.
   */
  pixel(x: number, y: number): [number, number, number, number];
  /**
   * Whether the canvas holds the picture of the tick the game is on.
   *
   * False after a {@link skip} or a quiet sweep, and true again once a drawn
   * tick has run. {@link captureStill} reads it, so a still is never an older
   * frame wearing the current one's name.
   */
  drawn(): boolean;

  /** Drop the engine's listeners and release the canvas. */
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

/* ---- The mouse and the touch contacts ------------------------------------- */
//
// `specs/ui.md` has the menus take a mouse and touch over the regions the build
// lays out, and the engine maps a pointer event's client position onto the field
// through the same letterboxed fit the game draws under (`engine/input.md`). So a
// check asks the build where its entry is, through `menuItemRect`, and dispatches
// a real pointer event at the middle of what it answered.
//
// A SHIM RATHER THAN A `PointerEvent`, for the same reason {@link KeyEvent} is a
// shim: this suite runs on a canvas with no document behind it, so there is no
// `PointerEvent` constructor to call and no element to dispatch from. The engine
// narrows structurally — it reads `clientX`, `clientY`, `pointerId`,
// `pointerType`, `isPrimary`, `button` and `buttons` off whatever arrives — so an
// event carrying those drives the pointer exactly as a player's does.

/** What separates a mouse from a finger on the same three events. */
export type PointerDevice = "mouse" | "pen" | "touch";

/** The buttons a pointer may hold, as the engine names them. */
export type PointerButton =
  | "primary"
  | "secondary"
  | "auxiliary"
  | "back"
  | "forward";

/** How one dispatched pointer event is shaped. */
export interface PointerOptions {
  /** The pointer's id, so a second contact can be driven beside the first. */
  id?: number;
  /** Whether this is the primary pointer. Defaults to true. */
  primary?: boolean;
  /** The device the event claims to come from. Defaults to a mouse. */
  device?: PointerDevice;
  /** The button a press or a release is about. Defaults to the primary one. */
  button?: PointerButton;
  /** Frames run after the event, so the build sees it. Defaults to one. */
  frames?: number;
}

/** The three pointer events the engine listens for. */
type PointerEventName = "pointerdown" | "pointermove" | "pointerup";

/** Exactly the fields the engine's pointer listeners read (`engine/input.md`). */
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

/** A `PointerEvent`-shaped event carrying the seven fields the engine reads. */
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
 * derived from the other. Both are the browser's, and the engine reads them back
 * exactly as a browser writes them (`engine/input.md`).
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
 * The engine maps a pointer position by `((client - origin) * dpr - offset) /
 * scale` (`engine/input.md`), and this harness's surface supplies no `origin`, so
 * the origin is the canvas's own corner and this is that map run backwards.
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
 * How many frames run back to back before the worker's event loop is given a
 * turn.
 *
 * NOT A PACING FIGURE, AND IT CHANGES NOTHING THE GAME SEES. Every frame either
 * side of the pause is the same frame with the same delta; what the pause buys is
 * a trip round node's event loop.
 *
 * WHY THAT IS NEEDED. `engine.advance(n)` is synchronous — it runs all `n`
 * frames before it returns — and a check that steps a tick at a time `await`s a
 * promise that is already resolved, which is a microtask and never reaches the
 * loop either. So a march of tens of thousands of frames holds the worker's
 * thread from beginning to end. Vitest's worker talks to the runner over an RPC
 * with a SIXTY-SECOND timeout of its own, armed with an ordinary timer and not
 * configurable from a project's config: on a loaded host a march that blocks
 * longer than that makes the worker throw
 * `[vitest-worker]: Timeout calling "onTaskUpdate"` — an unhandled error vitest
 * itself warns "might cause false positive tests", and a fact about how busy the
 * machine was rather than about the build. Two thousand frames is about a
 * fiftieth of that budget even on a host twenty times oversubscribed.
 */
const YIELD_EVERY = 2_000;

/** Hand the event loop a turn: a real macrotask, not an already-settled await. */
function breathe(): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * A proxy that records every call and property set on its way to the real
 * context, so one frame produces both a pixel buffer to sample and a call list
 * to inspect.
 *
 * `recording` is the harness's own gate: an undrawn frame issues only the
 * engine's own clear and viewport transform, and keeping those would fill
 * {@link Harness.calls} with tens of thousands of entries from a march nobody
 * asked to read. So a frame that is not being drawn is not recorded either, and
 * `calls` holds the frames a check actually looked at.
 */
function recorder(
  target: SKRSContext2D,
  calls: DrawCall[],
  recording: () => boolean,
  requirePainted: (what: string) => void,
): SKRSContext2D {
  return new Proxy(target, {
    get(object, property) {
      const value = Reflect.get(object, property, object) as unknown;
      if (typeof value !== "function") return value;
      return (...args: unknown[]): unknown => {
        const method = String(property);
        // Every reading of the pixels goes through here, whether a check took it
        // off `h.pixel` or reached for the context itself.
        if (method === "getImageData") requirePainted("a pixel reading");
        const call: DrawCall = { kind: "call", method, args };
        if (
          recording() &&
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
        if (recording()) calls.push(call);
        return (value as (...rest: unknown[]) => unknown).apply(object, args);
      };
    },
    set(object, property, value) {
      if (recording())
        calls.push({ kind: "set", property: String(property), value });
      return Reflect.set(object, property, value, object);
    },
  });
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

/** Every string the render drew, in the order it drew them. */
export function drawnText(calls: readonly DrawCall[]): string[] {
  return calls.flatMap((call) =>
    call.kind === "call" &&
    (call.method === "fillText" || call.method === "strokeText") &&
    typeof call.args[0] === "string"
      ? [call.args[0]]
      : [],
  );
}

/** Whether the render drew `text`, ignoring case and surrounding space. */
export function drewText(calls: readonly DrawCall[], text: string): boolean {
  const wanted = text.trim().toUpperCase();
  return drawnText(calls).some(
    (drawn) => drawn.trim().toUpperCase() === wanted,
  );
}

/** A colour sampled off the canvas. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** The colour the build drew at a logical point. */
export function sample(h: Harness, x: number, y: number): Rgb {
  const [r, g, b] = h.pixel(x, y);
  return { r, g, b };
}

/**
 * How far apart two colours are, as the Euclidean distance in RGB.
 *
 * The range runs from `0` to `441.67` (`sqrt(3) * 255`), which is the scale
 * every `presentation` check states its bound on. The bound itself belongs to
 * the check, derived from what `specs/ui.md` requires of the pair it is about.
 */
export function colorDistance(a: Rgb, b: Rgb): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

/**
 * The debug surface the BUILD returned beside its state, read off the engine
 * that holds it.
 *
 * This is deliberately a READ and never a construction. The surface is the
 * build's deliverable: its `initialize` returns `[state, debug]`
 * (`specs/instrumentation.md`), the engine keeps the second element, and
 * `engine.debug` is the only way it reaches a check. Nothing here could stand in
 * for it, because the build's own module for the surface is never imported.
 *
 * By the time this runs `engine.initialize()` has resolved, which is the one
 * precondition `engine.debug` has. A build that returned no pair at all never
 * gets this far, because the engine rejects `initialize` itself and the
 * rejection fails the suite's `beforeEach` with the engine's own message — which
 * is why every suite's `afterEach` disposes with `?.`.
 *
 * What IS decided here is a pair whose second element is no surface — a build
 * that returned `[state, null]`, or something other than an object. That is a
 * fault in the build and not in this harness, so it must not present as one:
 *
 * - It is NOT thrown from here. Every suite builds its harness in a
 *   `beforeEach`, so a throw at this point would fail the hook and bury the real
 *   verdict under the harness's own stack.
 * - It is NOT swallowed either. {@link missingSurface} stands in for the missing
 *   surface and fails, by assertion, at the moment a check first reaches for an
 *   operation on it — naming the return the build owes.
 *
 * So the harness is built, teardown runs, and the fault lands exactly where
 * `specs/instrumentation.md` says it should: on the points whose checks reach
 * the game through the surface. A check that needs no surface is decided on its
 * own merits, and `instrumentation/surface-present` names the fault outright.
 */
function readDebugSurface(
  engine: Engine<ShatterState, ShatterSurface>,
): ShatterSurface {
  const surface: unknown = engine.debug;
  if (typeof surface !== "object" || surface === null) {
    return missingSurface(
      `engine.debug holds ${surface === null ? "null" : typeof surface}, ` +
        `not an object`,
    );
  }
  return surface as ShatterSurface;
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
 * A stand-in for the surface a build never returned: every operation on it fails
 * the check that reached for it, with the missing return named.
 *
 * A proxy rather than a hand-written stub, because the surface is not a closed
 * list — `warhead` adds the whole torpedo section — and a stub written against
 * the common surface would report a `warhead`-only operation as merely absent
 * rather than as the consequence of the build's missing surface.
 *
 * Keys that belong to the RUNTIME rather than to a check are answered with
 * `undefined` instead: awaiting the harness probes `then`, and vitest's own
 * error formatting probes symbols and `constructor`. Failing those would replace
 * the verdict with noise from the machinery that was trying to report it.
 */
function missingSurface(reason: string): ShatterSurface {
  return new Proxy({} as ShatterSurface, {
    get: (_target, property): unknown => {
      if (typeof property === "symbol") return undefined;
      if (property === "then" || property === "constructor") return undefined;
      return fail(SURFACE_REQUIREMENT, reason);
    },
  });
}

/**
 * The imperative reading of the raw surface, over the engine that holds the
 * state.
 *
 * A proxy, and a lazy one, for the same reason {@link missingSurface} is: the
 * member is read off the raw surface at the moment a check reaches for it, so a
 * missing surface or a missing operation fails the check that needed it and
 * never the `beforeEach` that built the harness. A member that is not a function
 * (`version`, or an operation the build left out) comes back as it is, which is
 * what lets a `warhead` slice test for its operation by `typeof`.
 *
 * A reading is called with `engine.state` and its result handed back. A pose is
 * run through `engine.apply`, so the engine stores what it returned and the next
 * frame's `update` receives it; a pose that returns nothing is refused by the
 * engine with a message naming the rule.
 */
function driveSurface(
  engine: Engine<ShatterState, ShatterSurface>,
  raw: ShatterSurface,
): ShatterDriver {
  const readings: readonly string[] = READINGS;
  return new Proxy({} as ShatterDriver, {
    get: (_target, property): unknown => {
      if (typeof property === "symbol") return undefined;
      if (property === "then" || property === "constructor") return undefined;
      const member = (raw as unknown as Record<string, unknown>)[property];
      if (typeof member !== "function") return member;
      const op = member as (
        state: DeepReadonly<ShatterState>,
        ...args: unknown[]
      ) => unknown;
      if (readings.includes(property)) {
        return (...args: unknown[]): unknown =>
          op.call(raw, engine.state, ...args);
      }
      return (...args: unknown[]): void => {
        engine.apply((state) => op.call(raw, state, ...args) as ShatterState);
      };
    },
  });
}

/**
 * Build an engine over a canvas of the harness's own, initialize the build's
 * game, and hand back everything a check reads.
 *
 * The options passed to the factory are the ones the seeded `src/main.ts`
 * passes — the design size, the build's exported `BACKGROUND`, and the touch
 * layout — so one harness serves every build of this case. Everything else the
 * build decided lives inside `src/game.ts`.
 *
 * NO FRAME HAS RUN when this resolves: `initialize` runs the game's setup and
 * nothing else, so the canvas is still bare and `simTime` is `0`. A check that
 * reads pixels or captures a still therefore advances at least one frame first.
 */
export async function createHarness(
  options: HarnessOptions = {},
): Promise<Harness> {
  const cssWidth = options.cssWidth ?? FIELD_W;
  const cssHeight = options.cssHeight ?? FIELD_H;
  const dpr = options.dpr ?? 1;

  const canvas = createCanvas(
    Math.round(cssWidth * dpr),
    Math.round(cssHeight * dpr),
  );
  const ctx = canvas.getContext("2d");
  const calls: DrawCall[] = [];

  /**
   * Whether the frame now running is drawn.
   *
   * A march sets this false around the ticks nobody looks at (see the header).
   * The engine's own clear and viewport transform still run — they are part of
   * its frame, not the game's render — and cost nothing worth counting; what is
   * skipped is the build's `render`, which is where a frame's time goes.
   *
   * A frame the replay recorder is capturing is ALWAYS drawn: the recorder is
   * armed around the stretch a reviewer will watch, and a section of blank
   * frames would be evidence of nothing. That is why the gate reads the engine
   * as well as the flag.
   */
  let drawing = true;
  /**
   * How many {@link Harness.quiet} scopes are open around the frame now running.
   *
   * A scope outranks the flag: inside one, even the frame {@link Harness.advance}
   * would have drawn is skipped, which is what lets a check keep its own
   * tick-at-a-time loop — the shape the sweep's own comment describes — and still
   * pay for one picture rather than fourteen thousand.
   */
  let quietDepth = 0;
  /** Whether the canvas holds the picture of the tick the game is on. */
  let painted = true;
  /** Frames run since the event loop last had a turn. See {@link YIELD_EVERY}. */
  let sinceYield = 0;
  let live: Engine<ShatterState, ShatterSurface> | null = null;
  const drawingNow = (): boolean =>
    (drawing && quietDepth === 0) || (live?.recording() ?? false);

  /**
   * Refuse a reading of the canvas taken after an undrawn march.
   *
   * A harness fault rather than a build's: the check asked for the picture of a
   * tick nothing drew. It fails here, naming what to do about it, instead of
   * quietly answering with an older frame — which is the one way a march that
   * skips the drawing could buy speed by making a check decide less.
   *
   * Every route to the pixels passes through it: {@link Harness.pixel},
   * {@link captureStill}, and the `getImageData` a reading helper takes off
   * {@link Harness.ctx} directly, which the recorder below gates.
   */
  const requirePainted = (what: string): void => {
    if (painted) return;
    fail(
      `${what} taken on a drawn frame`,
      "the last tick that ran was not drawn (h.skip, or a quiet sweep), so the " +
        "canvas still holds an older frame — advance one tick before reading it",
    );
  };

  const recorded = recorder(ctx, calls, drawingNow, requirePainted);
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

  /**
   * The build's game, with its `render` under the harness's gate.
   *
   * A proxy rather than a spread copy, so everything else about the object the
   * build exported — every other member, its prototype, whatever shape it chose
   * — reaches the engine exactly as the build wrote it.
   *
   * SUPPRESSING THE RENDER CANNOT MOVE THE SIMULATION. The engine hands `render`
   * a read-only state and ignores what it returns, and the render API it is
   * given carries the context, the frame counter and the viewport and nothing
   * else — no audio, no way to pose the game. `specs/simulation.md` puts the
   * game's whole step in `update`. So a frame that skips the render runs the
   * same tick and leaves the same state as one that does not, which is the whole
   * reason a march may skip it.
   */
  const gated = new Proxy(game, {
    get(target, property) {
      const value = Reflect.get(target, property, target) as unknown;
      if (property !== "render" || typeof value !== "function") return value;
      return (...args: unknown[]): unknown =>
        drawingNow()
          ? (value as (...rest: unknown[]) => unknown).apply(target, args)
          : undefined;
    },
  });

  const engine = createEngine<ShatterState, ShatterSurface>({
    canvas: element,
    width: FIELD_W,
    height: FIELD_H,
    game: gated,
    // The build's own field background, handed to the engine exactly as the
    // seeded `src/main.ts` hands it, so the letterbox bars match the field.
    background: BACKGROUND,
    layout: LAYOUT,
    clock: options.clock ?? new ConstantClock(TICK_MS),
    surface,
  });

  // Subscribed BEFORE `initialize`, which is what makes the game's own setup
  // observable: construction runs no game code, so nothing has happened yet.
  const cues: PlayedCue[] = [];
  const loops: LoopedCue[] = [];
  const stops: LoopedCue[] = [];
  engine.events.on("cue:played", (played) => {
    cues.push(played);
  });
  engine.events.on("cue:looped", ({ cue, t }) => {
    loops.push({ cue, t });
  });
  engine.events.on("cue:stopped", ({ cue, t }) => {
    stops.push({ cue, t });
  });

  live = engine;
  await engine.initialize();
  const debug = driveSurface(engine, readDebugSurface(engine));

  /**
   * Run `frames` ticks with the drawing gate held where `draw` says.
   *
   * The gate is restored whatever the frames do, so a build that throws out of
   * an undrawn march leaves the next harness call drawing again and the failure
   * is the one the build produced.
   */
  const run = async (frames: number, draw: boolean): Promise<void> => {
    if (frames <= 0) return;
    drawing = draw;
    // Read while the gate is still where these frames ran under, so what the
    // canvas holds is recorded from the frames themselves rather than from the
    // state the gate is restored to.
    const drew = drawingNow();
    try {
      let left = frames;
      while (left > 0) {
        const chunk = Math.max(1, Math.min(left, YIELD_EVERY - sinceYield));
        await engine.advance(chunk);
        left -= chunk;
        sinceYield += chunk;
        if (sinceYield >= YIELD_EVERY) {
          sinceYield = 0;
          await breathe();
        }
      }
    } finally {
      drawing = true;
    }
    painted = drew;
  };

  const dispatch = (type: "keydown" | "keyup", code: string): void => {
    keys.dispatchEvent(new KeyEvent(type, code));
  };

  /**
   * The buttons each pointer id currently holds, kept exactly as a browser keeps
   * them: a press adds one, a release drops one, and every event reports the set
   * as it stands once the event has been applied. Without it a move issued in the
   * middle of a drag would report no button held, and the engine would take the
   * contact's buttons from the event and read the pointer as no longer down.
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

  const movePointer = async (
    x: number,
    y: number,
    pointerOptions: PointerOptions = {},
  ): Promise<void> => {
    // `-1` is what a browser puts in `button` for an event about position alone.
    dispatchPointer("pointermove", x, y, -1, pointerOptions);
    await deliver(pointerOptions);
  };

  const pressPointer = async (
    x: number,
    y: number,
    pointerOptions: PointerOptions = {},
  ): Promise<void> => {
    const button = pointerOptions.button ?? "primary";
    buttonsOf(pointerOptions.id ?? 1).add(button);
    dispatchPointer("pointerdown", x, y, buttonIndexOf(button), pointerOptions);
    await deliver(pointerOptions);
  };

  const releasePointer = async (
    x: number,
    y: number,
    pointerOptions: PointerOptions = {},
  ): Promise<void> => {
    const button = pointerOptions.button ?? "primary";
    buttonsOf(pointerOptions.id ?? 1).delete(button);
    dispatchPointer("pointerup", x, y, buttonIndexOf(button), pointerOptions);
    await deliver(pointerOptions);
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
    loops,
    stops,

    snapshot: () => debug.snapshot(),

    async advance(frames) {
      // A count the engine would refuse is handed straight to it, so the refusal
      // names the number the caller passed rather than one arithmetic here made
      // out of it.
      if (!Number.isInteger(frames) || frames < 1) {
        await engine.advance(frames);
        return;
      }
      await run(frames - 1, false);
      await run(1, true);
    },

    skip: (frames) => run(frames, false),

    async quiet(body) {
      quietDepth += 1;
      try {
        return await body();
      } finally {
        quietDepth -= 1;
      }
    },

    paint: async () => {
      const held = quietDepth;
      quietDepth = 0;
      try {
        await run(1, true);
      } finally {
        quietDepth = held;
      }
    },

    async until(predicate, untilOptions = {}) {
      const maxFrames = untilOptions.maxFrames ?? 600;
      const poll = Math.max(1, untilOptions.poll ?? 1);

      let snapshot = debug.snapshot();
      if (predicate(snapshot)) return { hit: true, frames: 0, snapshot };

      let frames = 0;
      while (frames < maxFrames) {
        const step = Math.min(poll, maxFrames - frames);
        // The sampled tick is drawn, so the picture a sweep leaves is the
        // picture of the tick it stopped on — unless the whole sweep is inside
        // a {@link Harness.quiet} scope, which suppresses that too.
        await run(step - 1, false);
        await run(1, true);
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
      await engine.advance(1);
      dispatch("keyup", code);
      await engine.advance(1);
    },

    movePointer,
    pressPointer,
    releasePointer,

    clearCalls: () => {
      calls.length = 0;
    },
    device: (x, y) => toDevice(engine.viewport(), x, y),
    client: (x, y) => toClient(engine.viewport(), dpr, x, y),
    pixel: (x, y) => {
      requirePainted("a pixel read");
      const point = toDevice(engine.viewport(), x, y);
      const { data } = ctx.getImageData(point.x, point.y, 1, 1);
      return [data[0], data[1], data[2], data[3]];
    },
    drawn: () => painted,

    dispose: () => engine.destroy(),
  };

  return harness;
}

/* -------------------------------------------------------------------------- */
/* Reading the field                                                          */
/* -------------------------------------------------------------------------- */
//
// Every one of these HARD-ASSERTS what it is about to hand back, naming the
// requirement the build missed on the `Expected:` line. That is rule 3 at the
// top of this file: a build that added nothing must fail the check about adding,
// not crash the file three lines later.

/** The rock with that id, or a failure naming the rock the check posed. */
export function rockById(
  snapshot: ShatterSnapshot,
  id: number,
  context?: string,
): RockSnapshot {
  const rock = snapshot.rocks.find((r) => r.id === id);
  if (rock === undefined) {
    fail(
      `a rock with id ${id} on the field (specs/instrumentation.md: an entity ` +
        `keeps its id for as long as it exists)${context === undefined ? "" : ` (${context})`}`,
      snapshot.rocks.map((r) => r.id),
    );
  }
  return rock;
}

/** The ship's bullet with that id, or a failure naming what was expected. */
export function bulletById(
  snapshot: ShatterSnapshot,
  id: number,
  context?: string,
): BulletSnapshot {
  const bullet = snapshot.bullets.find((b) => b.id === id);
  if (bullet === undefined) {
    fail(
      `a bullet with id ${id} in flight${context === undefined ? "" : ` (${context})`}`,
      snapshot.bullets.map((b) => b.id),
    );
  }
  return bullet;
}

/** The saucer bullet with that id, or a failure naming what was expected. */
export function enemyBulletById(
  snapshot: ShatterSnapshot,
  id: number,
  context?: string,
): BulletSnapshot {
  const bullet = snapshot.enemyBullets.find((b) => b.id === id);
  if (bullet === undefined) {
    fail(
      `a saucer bullet with id ${id} in flight${context === undefined ? "" : ` (${context})`}`,
      snapshot.enemyBullets.map((b) => b.id),
    );
  }
  return bullet;
}

/**
 * Whether this build carries torpedoes — which is to say, whether it is the
 * `warhead` variant.
 *
 * `specs/instrumentation.md` gives `snapshot()` a `torpedoes` roster under
 * `warhead` and none under `base`, so its presence is the one reading that tells
 * the two apart. It decides nothing a build is GRADED on: it is read only where a
 * requirement is one item longer under one variant than the other — the how-to
 * screen's list of keys — so that a suite serving both checklists asks each build
 * for the list `specs/controls.md` handed it.
 */
export function carriesTorpedoes(h: Harness): boolean {
  return h.snapshot().torpedoes !== undefined;
}

/**
 * The `warhead` torpedo roster, or a failure naming the member a `base`
 * snapshot does not carry.
 *
 * Every torpedo reading goes through here rather than through
 * `snapshot.torpedoes ?? []`, so a `warhead` build that reports no roster fails
 * the check that wanted one instead of reading as a build that launched nothing.
 */
export function torpedoesOf(snapshot: ShatterSnapshot): TorpedoSnapshot[] {
  if (snapshot.torpedoes === undefined) {
    fail(
      "snapshot() to report the torpedoes in flight as `torpedoes` " +
        "(specs/instrumentation.md, warhead)",
      "undefined",
    );
  }
  return snapshot.torpedoes;
}

/** The torpedo with that id, or a failure naming what was expected. */
export function torpedoById(
  snapshot: ShatterSnapshot,
  id: number,
  context?: string,
): TorpedoSnapshot {
  const torpedo = torpedoesOf(snapshot).find((t) => t.id === id);
  if (torpedo === undefined) {
    fail(
      `a torpedo with id ${id} in flight${context === undefined ? "" : ` (${context})`}`,
      torpedoesOf(snapshot).map((t) => t.id),
    );
  }
  return torpedo;
}

/**
 * The last rock in the roster: the one an `addRock` just appended.
 *
 * `specs/instrumentation.md` fixes the rule this rests on — an entity added
 * through the surface is APPENDED to its roster, so its id is read from the end.
 */
export function lastRock(snapshot: ShatterSnapshot): RockSnapshot {
  const rock = snapshot.rocks[snapshot.rocks.length - 1];
  if (rock === undefined) {
    fail(
      "addRock to append a rock to `rocks` (specs/instrumentation.md)",
      "an empty rock roster",
    );
  }
  return rock;
}

/** The last of the ship's bullets: the one an `addBullet` just appended. */
export function lastBullet(snapshot: ShatterSnapshot): BulletSnapshot {
  const bullet = snapshot.bullets[snapshot.bullets.length - 1];
  if (bullet === undefined) {
    fail(
      "addBullet to append a bullet to `bullets` (specs/instrumentation.md)",
      "an empty bullet roster",
    );
  }
  return bullet;
}

/** The last saucer bullet: the one an `addEnemyBullet` just appended. */
export function lastEnemyBullet(snapshot: ShatterSnapshot): BulletSnapshot {
  const bullet = snapshot.enemyBullets[snapshot.enemyBullets.length - 1];
  if (bullet === undefined) {
    fail(
      "addEnemyBullet to append a bullet to `enemyBullets` " +
        "(specs/instrumentation.md)",
      "an empty saucer-bullet roster",
    );
  }
  return bullet;
}

/** The last torpedo: the one an `addTorpedo`, or a launch, just appended. */
export function lastTorpedo(snapshot: ShatterSnapshot): TorpedoSnapshot {
  const torpedoes = torpedoesOf(snapshot);
  const torpedo = torpedoes[torpedoes.length - 1];
  if (torpedo === undefined) {
    fail(
      "a torpedo in flight, appended to `torpedoes` " +
        "(specs/instrumentation.md, warhead)",
      "an empty torpedo roster",
    );
  }
  return torpedo;
}

/** The saucer on the field, or a failure naming the empty slot. */
export function theSaucer(
  snapshot: ShatterSnapshot,
  context?: string,
): SaucerSnapshot {
  if (snapshot.saucer === null) {
    fail(
      `a saucer on the field${context === undefined ? "" : ` (${context})`}`,
      "snapshot().saucer is null",
    );
  }
  return snapshot.saucer;
}

/** The rock sizes, smallest first, which is the order a field is shot down in. */
const SIZE_ORDER: readonly RockSize[] = ["small", "medium", "large"];

/**
 * The smallest rock on the field, ties broken by the lowest id.
 *
 * Deterministic on purpose: a scenario that shoots the field down has to make
 * the same choices twice for a seeded replay to reproduce, and "smallest" alone
 * does not order two Smalls.
 */
export function smallestRock(snapshot: ShatterSnapshot): RockSnapshot {
  let best: RockSnapshot | undefined;
  for (const rock of snapshot.rocks) {
    if (best === undefined) {
      best = rock;
      continue;
    }
    const rank = SIZE_ORDER.indexOf(rock.size) - SIZE_ORDER.indexOf(best.size);
    if (rank < 0 || (rank === 0 && rock.id < best.id)) best = rock;
  }
  if (best === undefined) {
    fail("a rock on the field to shoot", "an empty rock roster");
  }
  return best;
}

/* -------------------------------------------------------------------------- */
/* The keyboard                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The first key `action` is bound to, read off `./constants`'s `BINDINGS` —
 * the binding table `specs/controls.md` fixes, transcribed on this side.
 *
 * A check that is ABOUT a particular key names that key itself — that is what
 * the whole `controls` group does. This is for every other check, which needs to
 * confirm a menu or hold thrust and does not care which key does it, and which
 * must keep working under `warhead`, where `b` is `KeyF` rather than `Space`.
 */
export function keyFor(action: ActionName): string {
  const key = BINDINGS[action].keys[0];
  if (key === undefined) {
    fail(
      `a key bound to the \`${action}\` action (specs/controls.md)`,
      BINDINGS[action].keys,
    );
  }
  return key;
}

/** Press and release the first key bound to `action`, two ticks in all. */
export function tapAction(h: Harness, action: ActionName): Promise<void> {
  return h.tap(keyFor(action));
}

/** Hold the first key bound to `action` down. */
export function holdAction(h: Harness, action: ActionName): void {
  h.hold(keyFor(action));
}

/** Release the first key bound to `action`. */
export function releaseAction(h: Harness, action: ActionName): void {
  h.release(keyFor(action));
}

/* -------------------------------------------------------------------------- */
/* Evidence capture                                                           */
/* -------------------------------------------------------------------------- */
//
// A review item may declare a `replay` OUTPUT beside its verdict: the frames the
// build itself drew while a check drove it, kept as evidence a reviewer can
// scrub and compare against the reference implementation's. `captureReplay` is
// how a check produces one.
//
// Four properties are what make it usable, and each is deliberate:
//
// 1. IT RECORDS THE SECTION, NOT THE RUN. The recorder is armed around the
//    caller's scenario and disarmed the moment that scenario returns, so what is
//    kept is the part the check is ABOUT and never the setup that got there.
// 2. IT IS EVIDENCE, NEVER A VERDICT. The scenario's own value comes straight
//    back, so a check reads it exactly as it did before capture existed, and a
//    scenario that THROWS still writes what it had recorded before the failure
//    travels on — a failing check is the one whose replay a reviewer most wants.
//    Nothing here can turn a passing check into a failing one.
// 3. IT WRITES ONLY WHAT THERE IS TO LOOK AT. A capture that closed no frames
//    leaves no file, so the run reports the output absent instead of offering
//    the reviewer a replay of nothing.
// 4. IT COSTS NOTHING WHEN NOBODY IS COLLECTING. Outside a run the media
//    directory is unset, and the whole thing is a no-op that still runs the
//    scenario, so a check cannot pass in one place and fail in the other.
//
// AND ONE RULE ABOUT WHERE A CLIP ENDS, which belongs to the CALLER rather than
// to this code, and which fold-in fix D turned into a standing requirement: A
// RECORDING ENDS ON THE OUTCOME, NOT ON THE INSTANT OF MEASUREMENT. Arm the
// recorder before the scenario's last beat and stop it after the effect has
// played out — a second of the fragments coming apart, of the wave arriving, of
// the core that took the torpedo. The reading the verdict rests on is still
// taken at the instant the event happened; the clip simply does not cut on that
// frame.

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
 * Taken from this module's own URL rather than from the working directory,
 * because it has to name the same directory in both layouts this file lives in:
 * the case's own `validation/simple-2d/`, and the `validation/` the runner
 * stages that directory to inside the build's tree.
 */
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * The directory the runner stages this project to inside the build's tree.
 *
 * A recording is addressed by the STAGED path of the suite that produced it —
 * `validation/waves/clears-on-last-rock.test.ts` — because that is the path the
 * review item's declared script resolves to, and so the only name the case's
 * manifest and the runner both already agree on.
 */
const STAGED_PROJECT_DIR = "validation";

/**
 * The most frames a written recording holds.
 *
 * A recording is one JSON operation log per frame, and a frame of this game is a
 * few hundred operations — a wrapped field draws every straddling body up to
 * nine times — so a section a check drives for half a minute of game time runs
 * to tens of megabytes. The cap is what makes `captureReplay` safe to wrap ANY
 * section in: an author arms the recorder around what the check is about and
 * never has to reason about how long that turns out to be.
 */
const MAX_REPLAY_FRAMES = 300;

/**
 * Where the running suite's `outputId` output belongs, or `null` when nothing is
 * collecting media.
 *
 * The suite is the one vitest is currently running rather than one the caller
 * names, because the two must not be able to disagree: a check that named its
 * own path would be free to write its evidence under some other point's address.
 *
 * `extension` is the one the runner collects that OUTPUT KIND under —
 * `json.gz` for a recording, `png` for a still.
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
 * to hold one copy of each, and the key order inside an argument the build
 * passed is the build's own business rather than ours.
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
 * whole point is to say each thing once, and the bulk of it in a game that draws
 * procedurally and so repeats almost nothing between frames.
 *
 * Every entry here is reached from a kept frame, and every reference inside one
 * is rewritten as it is reached, transitively. What is deduplicated is the
 * rewritten entry, so an operation two hundred frames issue identically is
 * written once and named two hundred times, and every index a frame carries
 * addresses the table it was interned into.
 *
 * Exported for the suite beside this file: a recording carrying an own field
 * named `__proto__` is one the engine's recorder writes and this one has to
 * rewrite as a field rather than as a prototype, and no drawing the reference
 * implementation makes produces one.
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
    // A recipe's own arguments were encoded when the value was used, so they can
    // only name entries interned before it: rewriting one terminates and cannot
    // re-enter this resource.
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
      // A frame inherits the current path along with the clip: a canvas keeps
      // its path across a frame boundary, and applying a clip leaves the clip
      // outline current, so a state that stopped at the clip would leave a bare
      // `fill` among the frame's operations filling that outline.
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
 * An over-long section is THINNED rather than cut short: every nth frame is
 * kept, so the reviewer sees the entire section at a lower frame rate instead of
 * its first — or last — few seconds at the full one. That is the reading that
 * matches what these outputs are named for: a saucer's crossing is evidence that
 * it steered clear of the core, and the approach is somewhere in the middle.
 *
 * Thinning is legitimate because every frame in a recording is drawable on its
 * own: a frame names the whole of the state it opened with and reaches
 * everything it draws with through tables the recording shares. Each kept
 * frame's `deltaMs` is restated as the time since the frame kept before it, so
 * the deltas still sum to the section's elapsed time. The frame `count` is left
 * as the host reported it, so a reader can see that frames were skipped rather
 * than being told a smooth lie.
 *
 * The last frame is always kept, whatever the stride lands on: it is the frame
 * the check's sweep stopped at, and it is the one a reviewer looks at first.
 * Keeping it costs a frame rather than the cap: the stride rounds up, so a
 * section whose length is an exact multiple of the cap strides over exactly that
 * many frames and stops one stride short of the end. The last frame takes the
 * place of the final strided frame — the frame nearest it — and is measured from
 * where that frame was measured from, which keeps the kept deltas summing to the
 * elapsed time.
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
      // The stride spent the whole budget on the way to a frame short of the
      // end. Drop the frame it stopped on, and put the moment back to the one
      // before it: a kept frame's restated delta is measured from exactly that
      // moment, so subtracting it recovers it, and the last frame's own delta
      // then spans the gap the two of them leave.
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
 * that turned up — the run would tell the reviewer there is a replay to watch
 * and the player would open on nothing.
 *
 * What lands on disk is gzip rather than raw JSON: a recording is text made
 * almost entirely of numbers, index lists and field names repeated once per
 * frame, which is close to the shape gzip is best at. Every host that serves one
 * declares the encoding, so the browser inflates it before the player sees it.
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
    console.warn(`shatter: could not write ${destination}: ${String(error)}`);
  }
}

/**
 * Record the frames `scenario` draws and keep them as the review item's
 * `outputId` output, handing back whatever the scenario returned.
 *
 * Wrap the drive, not the arrangement, and let the outcome play out inside it:
 *
 * ```ts
 * const cleared = await captureReplay(h, "clear", async () => {
 *   const shot = await shootRock(h, last.id);
 *   const banner = h.snapshot().waveBanner;   // the reading, on its own tick
 *   await h.advance(ticksFor(1));             // a second of the wave arriving
 *   return { shot, banner };
 * });
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
    // In a `finally`, so a scenario that failed still leaves its evidence.
    writeReplay(destination, h.engine.stopRecording());
  }
}

/**
 * Keep the frame currently on the canvas as the review item's `outputId` output.
 *
 * The companion to {@link captureReplay}, for a point whose evidence is one
 * PICTURE rather than a stretch of motion: which screen the game opened on, what
 * the HUD showed, where the letterbox bars fell.
 *
 * What is written is whatever the last frame that RAN left behind, so call it
 * after the frame that poses the thing under test — an `advance(1)` following
 * the arrangement — and before the assertions, so a check that fails still
 * leaves the picture that shows why. Nothing here can change a verdict.
 */
export function captureStill(h: Harness, outputId: string): void {
  // Before the destination is resolved, so a still taken off a stale canvas is
  // refused on every run rather than only on the runs that collect media.
  if (!h.drawn()) {
    fail(
      "a still captured on a drawn frame",
      "the last tick that ran was not drawn (h.skip, or a quiet sweep), so the " +
        "canvas still holds an older frame — advance one tick before capturing",
    );
  }
  const destination = mediaDestination(outputId, "png");
  if (destination === null) return;
  try {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, h.canvas.toBuffer("image/png"));
  } catch (error) {
    console.warn(`shatter: could not write ${destination}: ${String(error)}`);
  }
}

/* -------------------------------------------------------------------------- */
/* Scenario helpers                                                           */
/* -------------------------------------------------------------------------- */
//
// Each of these poses a situation out of the surface's ATOMS and then lets the
// real simulation run. They fix only geometry — where a rock is put, which side
// of it a round comes in on. Every threshold a check asserts is stated in the
// check itself, derived from the figure `specs/` states for it.

/**
 * Empty the world: every roster cleared, the saucer removed, nothing else
 * touched.
 *
 * The sequence `clearField()` would have been, which the surface deliberately
 * does not carry: *a debug API has no operation that arranges several elements
 * at once*. Each per-roster clear empties ONE roster and leaves the others
 * standing, and this is where the four are said in one breath.
 *
 * The torpedo roster is cleared only where there is one, so this serves both
 * variants unchanged.
 */
export function clearWorld(h: Harness): void {
  h.debug.clearRocks();
  h.debug.clearBullets();
  h.debug.clearEnemyBullets();
  h.debug.removeSaucer();
  h.debug.clearTorpedoes?.();
}

/**
 * Open an EMPTY, QUIET run at wave 1: the ground almost every scenario in this
 * suite is posed on.
 *
 * Empty is {@link clearWorld}, and it is safe to leave the field empty because
 * `setWaveSpawning(false)` holds it empty — `specs/progression.md` clears a wave
 * on the TICK THE LAST ROCK IS DESTROYED, not on an empty field, so an empty
 * field is playing rather than cleared, and with the loop off nothing arrives.
 *
 * Quiet is the three gates:
 *
 * - `setWaveSpawning(false)` — otherwise a build is entitled to raise a banner
 *   and put five Large rocks into any scenario that runs for more than a moment.
 * - `setSaucerSpawning(false)` — otherwise any scenario running past
 *   `SAUCER_FIRST_DELAY` (18 s) of game time is joined by a saucer that hunts
 *   and fires.
 * - `setShipCollision(false)` — the ship is the one entity no scenario can
 *   remove, so its LETHAL CONTACT TEST is gated instead. The ship still flies,
 *   still turns, still fires and still slides along the core; nothing a scenario
 *   did not ask for costs a life. This replaces the two defences the guidance
 *   names as insufficient: parking the ship in a corner, and holding
 *   `setShipInvuln` high (which would make every such check depend on the
 *   invulnerability rule `lives/invuln-ignores-a-rock` separately grades).
 *
 * TURNING A GATE BACK ON IS THE EXCEPTION, and the check that does it is the
 * check whose REQUIREMENT the gate is: every `waves` item and
 * `rocks/drift-speed-large` turn the wave loop on; the saucer's own cadence
 * items turn arrivals on; every `lives` item, `star-core/core-costs-no-life` and
 * `detonation/harmless-to-the-ship` turn contact on. A check that finds itself
 * wanting a gate has almost always been mis-posed, and re-posing it is the fix.
 *
 * NO FRAME IS RUN. This is a sequence of poses and nothing else, so the check
 * that follows owns the clock from tick zero and `simTime` is untouched. A check
 * that wants the game to have drawn — a pixel read, a still — advances first.
 *
 * It does not call `reset` either. A check that needs a seeded, title-screen
 * ground calls `h.debug.reset({ seed })` itself, and a check that reaches its
 * scenario through a real title-to-`PLAY` start does not call this at all: after
 * a `reset` both world gates are ON, which is how `waves/wave-one-spawns-four`
 * and `screens/play-starts-a-game` reach a real opening wave.
 */
export function startPlaying(h: Harness): void {
  clearWorld(h);
  h.debug.setWaveSpawning(false);
  h.debug.setSaucerSpawning(false);
  h.debug.setShipCollision(false);
  h.debug.setScreen("playing");
  h.debug.setMenuIndex(0);
  h.debug.setScore(0);
  h.debug.setLives(START_LIVES);
  h.debug.setWave(1);
  h.debug.setWaveBanner(0);
  h.debug.setShipPosition(SAFE_X, SAFE_Y);
  h.debug.setShipVelocity(0, 0);
  h.debug.setShipAngle(FACE_UP);
  h.debug.setShipInvuln(0);
  h.debug.setFireCooldown(0);
  h.debug.setTorpedoCharge?.(1);
}

/**
 * Add a rock of `size` at `(x, y)` travelling at `(vx, vy)`, and answer its id.
 *
 * `addRock` puts a rock down AT REST — the pose is the caller's alone, and
 * `setRockVelocity` is verifiable by set-then-read — so a drifting rock is the
 * two operations in order, addressed by the id the appended rock reports.
 */
export function poseRock(
  h: Harness,
  size: RockSize,
  x: number,
  y: number,
  vx = 0,
  vy = 0,
): number {
  h.debug.addRock(size, x, y);
  const { id } = lastRock(h.snapshot());
  if (vx !== 0 || vy !== 0) h.debug.setRockVelocity(id, vx, vy);
  return id;
}

/** Add one of the ship's bullets in flight, and answer its id. */
export function poseBullet(
  h: Harness,
  x: number,
  y: number,
  vx: number,
  vy: number,
): number {
  h.debug.addBullet(x, y, vx, vy);
  return lastBullet(h.snapshot()).id;
}

/** Add one saucer bullet in flight, and answer its id. */
export function poseEnemyBullet(
  h: Harness,
  x: number,
  y: number,
  vx: number,
  vy: number,
): number {
  h.debug.addEnemyBullet(x, y, vx, vy);
  return lastEnemyBullet(h.snapshot()).id;
}

/** Bring a saucer on at `(x, y)`, and answer the id this visit took. */
export function poseSaucer(h: Harness, x: number, y: number): number {
  h.debug.addSaucer(x, y);
  return theSaucer(h.snapshot()).id;
}

/** Add one torpedo in flight along `heading`, and answer its id: `warhead`. */
export function poseTorpedo(
  h: Harness,
  x: number,
  y: number,
  heading: number,
): number {
  if (h.debug.addTorpedo === undefined) {
    fail(
      "an addTorpedo operation on the debug surface " +
        "(specs/instrumentation.md, warhead)",
      "undefined",
    );
  }
  h.debug.addTorpedo(x, y, heading);
  return lastTorpedo(h.snapshot()).id;
}

/* ---- Shooting a rock down for real --------------------------------------- */
//
// FOLD-IN FIX A, and the single most load-bearing thing in this file. A wave
// clears by SHOOTING EVERY ROCK DOWN — `clearRocks` is a way to make room, it
// destroys nothing and scores nothing, and `specs/instrumentation.md` says so
// outright. A check that reached a cleared wave by calling it would grade the
// debug operation instead of the game, and would fail every conformant build
// that raises its next wave from the destruction event rather than from polling
// whether the field is empty.
//
// SO NO CHECK IN THIS CASE REACHES A CLEARED WAVE WITH `clearRocks`. It poses an
// empty field for a scenario that is not about the wave loop, and every such
// scenario runs under `startPlaying`'s `setWaveSpawning(false)`, where an empty
// field raises nothing.

/**
 * How far outside a target's surface a round is placed, in logical units.
 *
 * Geometry, not a threshold. Big enough that the round starts clear of the rock
 * — so the build's own swept test is what resolves the hit, from outside — and
 * small enough that its whole flight is a couple of ticks, over which the well
 * moves it by a fraction of a unit.
 */
export const ROUND_STANDOFF = 12;

/** A round placed and aimed at one target: `(x, y)` and `(vx, vy)`. */
export interface AimedRound {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** The fields a round is aimed by: a rock's pose, or anything shaped like one. */
export interface RoundTarget {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

/**
 * The pose of a round placed `standoff` units outside `target`'s surface and
 * fired inward at `speed`.
 *
 * Three properties, each of which a wave check depends on:
 *
 * - IT COMES IN FROM THE SIDE FACING AWAY FROM THE STAR. The whole flight is the
 *   standoff, on the far side of the target from the core, so the round can
 *   never be absorbed by the core on its way in — which `specs/collision.md`
 *   says it would be, and which would silently drop a round and stall a sweep.
 * - IT CARRIES THE TARGET'S OWN VELOCITY as well as its muzzle speed, so a Small
 *   drifting at up to `210` units/s is not missed by a round aimed at where it
 *   used to be.
 * - IT IS PLACED, NOT FIRED. There is no operation that fires, and this does not
 *   pretend to be one: the round is a bullet in flight, and the build's own
 *   gravity, wrap and collision are what carry it the rest of the way.
 */
export function aimedRound(
  target: RoundTarget,
  speed: number = MUZZLE_SPEED,
  standoff: number = ROUND_STANDOFF,
): AimedRound {
  const out = outwardFromStar(target);
  const from = wrap({
    x: target.x + out.x * (target.radius + standoff),
    y: target.y + out.y * (target.radius + standoff),
  });
  return {
    x: from.x,
    y: from.y,
    vx: target.vx - out.x * speed,
    vy: target.vy - out.y * speed,
  };
}

/** How a round is placed, for the two helpers that place one. */
export interface RoundOptions {
  /** The muzzle speed the round travels at. Defaults to `MUZZLE_SPEED`. */
  speed?: number;
  /** How far outside the target's surface it starts. Defaults to 12 units. */
  standoff?: number;
}

/** What one aimed round did. */
export interface ShotResult {
  /** The id the round took. */
  bullet: number;
  /** Ticks advanced before the round left the field. */
  ticks: number;
  /** The round left the field within the window: it landed, or was absorbed. */
  spent: boolean;
  /** The rock it was aimed at is no longer on the field. */
  destroyed: boolean;
}

/**
 * Place one {@link aimedRound} on the doorstep of the rock with that id and
 * advance until the round is spent.
 *
 * The rock is destroyed by the BUILD's own collision and split code, not by
 * anything here — which is the whole point. Under `warhead` a rock takes
 * `ROCK_HEALTH` hits for its size, so one call is one hit and `destroyed` says
 * whether that hit was the fatal one.
 */
export async function shootRock(
  h: Harness,
  id: number,
  options: RoundOptions = {},
): Promise<ShotResult> {
  const speed = options.speed ?? MUZZLE_SPEED;
  const standoff = options.standoff ?? ROUND_STANDOFF;
  const target = rockById(h.snapshot(), id, "the rock a round was aimed at");
  const round = aimedRound(target, speed, standoff);
  const bullet = poseBullet(h, round.x, round.y, round.vx, round.vy);

  // The round's whole flight is the standoff, which it covers at `speed`. The
  // window is that flight with room for a build whose sweep resolves a tick
  // late, and short enough that a round which missed is not chased round the
  // field.
  const window = Math.ceil(standoff / (speed * TICK_DT)) + 8;
  for (let tick = 1; tick <= window; tick += 1) {
    await h.advance(1);
    const now = h.snapshot();
    if (!now.bullets.some((b) => b.id === bullet)) {
      return {
        bullet,
        ticks: tick,
        spent: true,
        destroyed: !now.rocks.some((r) => r.id === id),
      };
    }
  }
  const now = h.snapshot();
  return {
    bullet,
    ticks: window,
    spent: false,
    destroyed: !now.rocks.some((r) => r.id === id),
  };
}

/** How far a field is shot down, and how the rounds that do it are placed. */
export interface ShootDownOptions extends RoundOptions {
  /**
   * How many rocks may remain. Every one of them will be a Small, because only
   * destroying a Small takes a rock off the field. Defaults to `0`: empty.
   */
  leave?: number;
  /**
   * The most rounds to fire before giving up and failing the check. Generous:
   * a full wave-1 field is 28 rounds under `base` and 44 under `warhead`.
   */
  maxRounds?: number;
}

/**
 * Shoot the field down until it holds at most `leave` rocks AND every one of
 * them is a Small, and answer how many rounds it took.
 *
 * Rounds go in through `addBullet` and the build's own collision, split and
 * scoring code, one at a time, each aimed at the SMALLEST rock on the field and
 * each advanced until it is spent. Smallest first is what drives the count down:
 * a Large shot becomes two Mediums and a Medium two Smalls, and only destroying
 * a Small takes a rock off the field at all — which is why the stopping
 * condition is a size as well as a count, and not a count alone.
 *
 * `shootFieldDown(h, { leave: 1 })` is how every wave check reaches a field one
 * shot away from clearing; the check then fires that last shot itself, and the
 * banner it reads is the one the build raised on the destruction.
 *
 * A build whose rounds do not destroy rocks fails here by assertion, naming the
 * rule of `specs/collision.md` it missed, rather than spinning.
 */
export async function shootFieldDown(
  h: Harness,
  options: ShootDownOptions = {},
): Promise<number> {
  const leave = options.leave ?? 0;
  const maxRounds = options.maxRounds ?? 400;
  let rounds = 0;

  for (;;) {
    const { rocks } = h.snapshot();
    const done =
      rocks.length <= leave && rocks.every((rock) => rock.size === "small");
    if (done) return rounds;
    if (rounds >= maxRounds) {
      fail(
        "the field to shoot down: a bullet reaching a rock destroys it, a " +
          "Large leaves two Mediums, a Medium two Smalls and a Small nothing " +
          "(specs/collision.md, specs/rocks.md)",
        `${maxRounds} rounds left ${rocks.length} rocks on the field`,
      );
    }
    await shootRock(h, smallestRock(h.snapshot()).id, options);
    rounds += 1;
  }
}

/* ---- How near something came --------------------------------------------- */

/** What a sweep found about how near a body came to a point. */
export interface Approach {
  /** The closest it came, measured to the LINE between samples. */
  distance: number;
  /** The tick the sample opening the closest segment was taken at. */
  tick: number;
  /** Every sample taken, in order. */
  path: Point[];
}

/**
 * Advance `ticks`, sampling the body `read` names every `stride` ticks, and
 * answer the closest it ever came to `point`.
 *
 * THE DISTANCE IS TO THE LINE BETWEEN SAMPLES, NOT TO THE SAMPLES. A sweep that
 * took the smallest sampled distance would report the body FURTHER OUT than it
 * ever got, because the closest point of a pass falls between two samples — the
 * wrong direction for any check hunting a build that came too close. This is
 * fold-in fix B, and `saucer/avoids-the-core` rests on it; the measurement
 * itself is `geometry.ts`'s {@link closestApproachTo}.
 *
 * The sweep stops early when `read` answers `null`, which is how a saucer that
 * left the field, or a body that was destroyed, ends its own crossing.
 */
export async function closestApproach(
  h: Harness,
  point: Point,
  read: (snapshot: ShatterSnapshot) => Point | null,
  ticks: number,
  stride = 8,
): Promise<Approach> {
  const step = Math.max(1, Math.round(stride));
  const path: Point[] = [];
  const at: number[] = [];

  const take = (tick: number): boolean => {
    const here = read(h.snapshot());
    if (here === null) return false;
    path.push({ x: here.x, y: here.y });
    at.push(tick);
    return true;
  };

  let tick = 0;
  let alive = take(tick);
  while (alive && tick < ticks) {
    const run = Math.min(step, ticks - tick);
    await h.advance(run);
    tick += run;
    alive = take(tick);
  }

  const closest = closestApproachTo(point, path);
  return {
    distance: closest.distance,
    tick: closest.segment < 0 ? -1 : at[closest.segment],
    path,
  };
}

/* -------------------------------------------------------------------------- */
/* Gestures over a menu                                                       */
/* -------------------------------------------------------------------------- */
//
// `specs/ui.md` gives a menu entry a hit region the build lays out, and
// `specs/instrumentation.md` has the build report it through `menuItemRect`. So
// every gesture below asks the build where its entry is and drives the device at
// the middle of what it answered: a build that lays its menu out any way it likes
// passes, and one that reports a region it does not actually answer on fails.
//
// A FINGER IS THE SAME THREE EVENTS WITH `device: "touch"`. `specs/ui.md` gives
// the mouse and the contact the same effects, and what separates them in a build
// is which listener it wired, so each has its own helpers and its own items.

/** The middle of the region the build reports for `index` on the current screen. */
export function menuItemCentre(
  h: Harness,
  index: number,
): { x: number; y: number } {
  const rect = h.debug.menuItemRect(index);
  if (rect === null) {
    fail(
      `a hit region for menu entry ${String(index)} on the screen showing it (specs/instrumentation.md)`,
      "menuItemRect answered null",
    );
  }
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/** Move the mouse onto the middle of entry `index`'s region. */
export async function pointerOntoItem(
  h: Harness,
  index: number,
): Promise<void> {
  const centre = menuItemCentre(h, index);
  await h.movePointer(centre.x, centre.y);
}

/** Press and release the mouse inside entry `index`'s region: three driven frames. */
export async function clickItem(h: Harness, index: number): Promise<void> {
  const centre = menuItemCentre(h, index);
  await h.movePointer(centre.x, centre.y);
  await h.pressPointer(centre.x, centre.y);
  await h.releasePointer(centre.x, centre.y);
}

/**
 * Press inside `from`'s region, slide onto `to`'s, and release there.
 *
 * The two edges fall in different regions, so `specs/ui.md` confirms no entry —
 * the slide-off a player uses to change their mind mid-press.
 */
export async function dragBetweenItems(
  h: Harness,
  from: number,
  to: number,
): Promise<void> {
  const start = menuItemCentre(h, from);
  await h.movePointer(start.x, start.y);
  await h.pressPointer(start.x, start.y);
  const end = menuItemCentre(h, to);
  await h.movePointer(end.x, end.y);
  await h.releasePointer(end.x, end.y);
}

/** How a touch contact is dispatched: one finger, reported as a finger. */
const CONTACT: PointerOptions = { device: "touch", id: 2 };

/** Land a contact inside entry `index`'s region, without lifting it. */
export async function touchOntoItem(h: Harness, index: number): Promise<void> {
  const centre = menuItemCentre(h, index);
  await h.pressPointer(centre.x, centre.y, CONTACT);
}

/** Land a contact inside entry `index`'s region and lift it there: two frames. */
export async function tapItem(h: Harness, index: number): Promise<void> {
  const centre = menuItemCentre(h, index);
  await h.pressPointer(centre.x, centre.y, CONTACT);
  await h.releasePointer(centre.x, centre.y, CONTACT);
}

/**
 * Land a contact inside `from`'s region, travel onto `to`'s, and lift it there.
 *
 * The landing and the lift fall in different regions, so `specs/ui.md` confirms
 * no entry.
 */
export async function touchBetweenItems(
  h: Harness,
  from: number,
  to: number,
): Promise<void> {
  const start = menuItemCentre(h, from);
  await h.pressPointer(start.x, start.y, CONTACT);
  const end = menuItemCentre(h, to);
  await h.movePointer(end.x, end.y, CONTACT);
  await h.releasePointer(end.x, end.y, CONTACT);
}
