// Shatter — the shared validator harness. CASE-PROVIDED.
//
// Every check in this suite is an ordinary vitest test that runs IN THE SAME
// PROCESS as the build. It imports the engine and the build's own modules,
// creates an engine over a canvas it owns and a clock it chose, and steps the
// game with `engine.advance`. Nothing drives a browser, nothing polls, and no
// wall-clock time passes: a check asks for a number of frames and gets exactly
// that number, at exactly the deltas its clock supplied.
//
// WHAT A CHECK READS. The game's own state (through the debug surface's
// `snapshot`), the engine's object model — the open world, its game state — the
// events the engine broadcast (the cues), and — for the presentation checks —
// the pixels on the canvas or the calls the 2D context received. Nothing here
// fabricates an outcome: the scenario helpers below only ARRANGE the game
// through the debug surface, and the real rules the build wrote are what decide
// every move from there.
//
// WHY THE DEBUG SURFACE RATHER THAN RAW ASSIGNMENT. specs/instrumentation.md
// fixes its operations, so they mean the same thing in every build: `addRock`
// places a rock the well pulls and the collision pass resolves, `addBullet`
// places a round the build's own shot code spends, `addSaucer` brings in a
// saucer its own mind steers, and `reset` gives everything back. Posing through
// it is how a scenario is reproducible, and it is the seam the case's
// specification documents. `surface.ts` is that specification as types, and it
// is the only description of the surface this harness reads: the build's own
// module for it is never imported.
//
// WHERE THE SURFACE COMES FROM. Off `engine.debug`, never built here. The game
// instance's `initialize` returns it, the engine holds that same object, and
// reading it back off the engine is the only way a surface reaches a check —
// so a build that returned no surface, or a surface missing an operation, fails
// the checks that reach the game through it. See `readDebugSurface`.
//
// HOW THE SURFACE IS DRIVEN. Directly, and immediately: under this engine a
// pose acts on the live game at the moment of the call and a reading is built
// at the call (specs/instrumentation.md), so a scenario poses and then reads
// with no frame in between. A frame is advanced when the check wants the game
// to RUN — a rock to drift, a round to land, a wave to turn over.
//
// THE HARNESS OWNS EVERY COMPOUND SEQUENCE. The surface is atomic by design:
// each operation sets one field, so "live play on an empty, quiet field" is a
// helper here rather than an operation there. A check that needs only part of a
// sequence calls the operations it needs, and nothing it did not ask for
// happens. The helpers fix GEOMETRY — where a rock is posed, which side of it a
// round comes in on — and never a threshold: every figure a check asserts is
// stated in that check, derived from what specs/ fixes for it.
//
// THE CLOCK IS THE HARNESS'S. `ConstantClock(TICK_MS)` at `TICK_HZ`, so one
// advanced frame is exactly one of Shatter's own simulation ticks. The engine
// mandates no timestep — it hands the game the real elapsed seconds of each
// frame and specs/simulation.md fixes the game's own step, which is why
// `[instrumentation]` carries no `tick_hz` — so the fixed clock is the SUITE's
// choice, and it is what makes a count of frames a count of game time. A check
// that is specifically about the step size builds its own harnesses with clocks
// of its own.
//
// NO ASSETS. Shatter seeds none and loads none, so nothing here stands `fetch`
// or `createImageBitmap` up: the whole picture is drawn in code, and the
// presentation checks read it off the canvas and off the recorded draw calls.
//
// A FRAME THAT NOBODY LOOKS AT IS NOT RASTERIZED. Every tick this harness runs
// is a real tick: the engine's whole frame runs, the world ticks, and the
// rendering pipeline walks the scene exactly as it always does. What a march
// does without is the RASTER — the handful of calls that actually put ink on the
// canvas (`fill`, `stroke`, `fillText`, `drawImage` and their kin), which is a
// third of what a frame costs here and all of what a frame it draws for nobody
// buys. {@link Harness.advance} therefore rasterizes its LAST frame and no
// other: the state it leaves and the picture on the canvas are exactly what
// drawing every frame would have left, because each frame clears and redraws the
// whole canvas, and only the intermediate frames' entries in
// {@link Harness.calls} are gone. A frame the engine's replay recorder is
// capturing is always drawn, whatever a march asked for, so a captured section
// is never a run of blank frames.
//
// AND A MARCH THAT WANTS NO PICTURE AT ALL SAYS SO. {@link Harness.skip} and
// {@link Harness.quiet} run every tick without the raster, for the sweeps that
// sample the state on EVERY tick and would otherwise draw every one of them.
// What they leave behind is a canvas holding an older frame, so the harness
// tracks that: {@link Harness.pixel}, every reading taken off
// {@link Harness.ctx}, and {@link captureStill} REFUSE while the canvas is stale
// rather than reading a picture from a tick that is no longer the current one. A
// check that wants the picture after a quiet sweep advances one drawn tick for
// it.

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
  type GameDefinition,
  type GameInstance,
  type GameState,
  type PathSegment,
  type RecordedFrame,
  type Recording,
  type Resource,
  type SurfaceMetrics,
  type Viewport,
  type World,
} from "@clockwyrks/structured-2d";
import {
  BINDINGS,
  BULLET_LIFE,
  FACE_UP,
  FIELD_H,
  FIELD_W,
  LAYOUT,
  MUZZLE_SPEED,
  SAFE_X,
  SAFE_Y,
  START_LIVES,
  TICK_HZ,
} from "./constants";
import { BACKGROUND, game as build } from "../src/game";
import { fail } from "./assert";
import { STAR, wrapPoint } from "./geometry";
import type {
  BulletSnapshot,
  RockSize,
  RockSnapshot,
  SaucerSnapshot,
  ShatterDebugApi,
  ShatterSnapshot,
  ShipSnapshot,
  TorpedoSnapshot,
} from "./surface";

export type {
  BulletSnapshot,
  RockSize,
  RockSnapshot,
  SaucerSnapshot,
  ShatterSnapshot,
  ShipSnapshot,
  TorpedoSnapshot,
};

/** The case's surface, exactly as `surface.ts` specifies it. */
export type ShatterSurface = ShatterDebugApi;

/**
 * The surface as every check drives it.
 *
 * Under this engine the raw surface IS imperative — a pose takes only its own
 * arguments and returns nothing, a reading takes nothing and returns plain
 * data — so no wrapper stands between a check and the object the build
 * returned, and the driver type is the surface type itself. The alias is kept
 * so a check reads the same way it does under an engine whose surface needs
 * driving.
 */
export type ShatterDriver = ShatterSurface;

/**
 * The build's game, typed against the surface the CASE specifies.
 *
 * The build declares its own type for the surface its instance's `initialize`
 * returns — the `D` of its `GameDefinition<D>` — and that type is the build's:
 * what a check holds it to is `surface.ts`, so the definition is cast to the
 * case's `GameDefinition<ShatterSurface>` here and the engine is parameterized
 * with it. A surface that departs from the specification is caught where a
 * check reaches for the missing member, not by the build's own compiler.
 */
const game = build as unknown as GameDefinition<ShatterSurface>;

/* -------------------------------------------------------------------------- */
/* The clock                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The frame the suite steps in, in milliseconds: one of Shatter's own ticks.
 *
 * specs/simulation.md fixes the GAME's timestep at `TICK_HZ` and has the game
 * accumulate whatever delta a frame brings into whole ticks. Handing it exactly
 * one tick per frame means the accumulator never carries a remainder, so
 * `advance(n)` runs exactly `n` ticks and a duration is a whole number of frames
 * on every machine.
 */
export const TICK_MS = 1000 / TICK_HZ;

/** Seconds of simulated time in `ticks` frames of the default clock. */
export function seconds(ticks: number): number {
  return ticks / TICK_HZ;
}

/** Frames of the default clock covering `duration` seconds, rounded to whole. */
export function ticksFor(duration: number): number {
  return Math.round(duration * TICK_HZ);
}

/* -------------------------------------------------------------------------- */
/* Recording the render                                                       */
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
 * Where a `fillText`/`strokeText` call put its text, read off the real context
 * at the moment of the call: the current transform, so the anchor can be mapped
 * to logical units whatever transform the pipeline applied, the measured width
 * under the current font, and the alignment that places the run about its
 * anchor.
 */
export interface TextGeometry {
  transform: Matrix;
  width: number;
  textAlign: string;
}

/** One recorded operation on the 2D context, in the order the render made it. */
export type DrawCall =
  | {
      kind: "call";
      method: string;
      args: unknown[];
      text?: TextGeometry;
      transform?: Matrix;
    }
  | { kind: "set"; property: string; value: unknown };

/** One cue the build played, as the engine announced it. */
export interface PlayedCue {
  cue: string;
  t: number;
  gain: number;
}

/**
 * One held cue starting or stopping, as the engine announced it.
 *
 * specs/audio.md makes `thrust` a HELD cue — it starts on the tick thrust
 * begins, sounds for as long as thrust is applied, and stops within a tenth of
 * a second of release — so a check about it reads these rather than
 * {@link PlayedCue}s.
 */
export interface LoopedCue {
  cue: string;
  /** `true` for a loop starting, `false` for one ending. */
  running: boolean;
  t: number;
}

export interface HarnessOptions {
  /** The clock each frame takes its delta from. Defaults to one tick a frame. */
  clock?: Clock;
  /** The element's laid-out CSS width. Defaults to the logical field width. */
  cssWidth?: number;
  /** The element's laid-out CSS height. Defaults to the logical field height. */
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
  snapshot: ShatterSnapshot;
}

export interface Harness {
  readonly engine: Engine<ShatterSurface>;
  /**
   * The world currently open, read fresh on every access. Shatter runs in one
   * world for the whole session — every screen is a value of the state's
   * `screen` field — but reading it through the engine keeps a check honest
   * against a build that rebuilt it anyway.
   */
  readonly world: World;
  /**
   * The open world's game state — the live `ShatterState` specs/state.md
   * declares — read fresh on every access. Its arrangement is the build's; what
   * a check asserts is read through `snapshot`.
   */
  readonly state: GameState;
  /** The game instance, the one framework object that outlives every level. */
  readonly instance: GameInstance<ShatterSurface>;
  /**
   * The debug surface the BUILD's instance returned from `initialize`, read off
   * `engine.debug` — see {@link readDebugSurface} — and driven directly: each
   * operation acts on the live game at the moment of the call.
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
  /** Every one-shot cue the build played, oldest first. */
  readonly cues: PlayedCue[];
  /** Every held cue starting or stopping, oldest first. */
  readonly loops: LoopedCue[];

  /** A fresh read of the game's state through the case's `snapshot`. */
  snapshot(): ShatterSnapshot;
  /**
   * Run `frames` frames back to back — one simulation tick each — rasterizing
   * the last of them.
   *
   * Every frame is a whole engine frame: the world ticks and the pipeline walks
   * the scene. Only the last puts ink on the canvas, which is all a caller can
   * read anyway — each frame clears and redraws the whole canvas, so the picture
   * after `advance(n)` is the picture the nth frame drew either way. What is gone
   * is the intermediate frames' entries in {@link calls}; a check reading one
   * frame's render clears the list and advances one frame, which is unchanged.
   * See the header.
   */
  advance(frames: number): Promise<void>;
  /** Run the whole frames covering `duration` seconds of game time. */
  advanceSeconds(duration: number): Promise<void>;
  /**
   * Run `frames` frames back to back, rasterizing NONE of them.
   *
   * The march to a state nobody needs to watch — waiting out the eighteen
   * seconds before the first saucer, running a torpedo's ten-second recharge
   * down, settling a pose. The same real frames {@link advance} runs; what is
   * skipped is the ink. The canvas is left holding an older frame, so
   * {@link pixel}, a reading off {@link ctx} and {@link captureStill} refuse
   * until a drawn frame has run.
   */
  skip(frames: number): Promise<void>;
  /**
   * Run `body` with the raster suppressed for every frame inside it, whatever
   * those frames were asked for through.
   *
   * The route for a check that samples the state on EVERY frame — the aim
   * group's shot-by-shot sweep, `saucer/at-most-one-at-a-time`'s trace of the
   * reported ids across two minutes. Those loops call `advance(1)` a frame at a
   * time on purpose, so that no frame is ever stepped over, and each of those
   * calls would otherwise draw its one picture: fourteen thousand of them to
   * read one number off each. Inside a quiet scope the same frames run, the same
   * snapshots are read, and one picture is drawn rather than all of them.
   *
   * The canvas is left holding an older frame, so a check that wants evidence of
   * where its sweep ended advances one drawn frame after it — after the reading
   * its verdict rests on has been taken.
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
  /** Advance until `predicate` holds, sampling every `poll` frames. */
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
   * One press of a key: hold it down, run the ONE frame that press is worth,
   * and let it up.
   *
   * THE KEY IS DOWN FOR THE WHOLE OF THAT FRAME, and that is the whole point.
   * specs/controls.md has Shatter read its inputs two different ways — the
   * menus, the pause, the mute and (under `warhead`) the torpedo are PRESS
   * EDGES, while turning, thrusting and firing are HOLDS — and a build is free
   * to read each the way its specification states. A tap that pressed and
   * released BETWEEN two frames would arm the edge but never present a held
   * value, so it would drive a menu perfectly and fire nothing at all: a check
   * written with it would grade how the build reads its keyboard rather than
   * what the ship does, and would fail a conformant build for reading the fire
   * key as the hold it is specified to be.
   *
   * Held across exactly one frame, both readings see one press: the edge is
   * armed before the frame and consumed inside it, and the value is non-zero
   * for that frame and zero on the next. So this is the press for every action
   * in the game, and {@link holdFor} is for a key a check means to keep down.
   */
  tap(code: string): Promise<void>;

  /**
   * The event target the surface hands the engine — where the engine's own
   * input system attached its `keydown`/`keyup` listeners, and where the
   * engine's overlay listens for the backtick.
   *
   * {@link hold}, {@link release} and {@link tap} are the named way in; this is
   * for a check that needs to raise an event of its own shape.
   */
  readonly events: EventTarget;

  /**
   * Move the pointer to a logical point without pressing anything, then run the
   * frame that delivers it.
   */
  movePointer(x: number, y: number, options?: PointerOptions): Promise<void>;
  /** Press the pointer at a logical point and leave it down. */
  pressPointer(x: number, y: number, options?: PointerOptions): Promise<void>;
  /** Release a pointer pressed by {@link pressPointer}, at a logical point. */
  releasePointer(x: number, y: number, options?: PointerOptions): Promise<void>;

  /** Where a logical point lands in the canvas's backing store. */
  device(x: number, y: number): { x: number; y: number };
  /**
   * Where a logical point lands in the client coordinates a pointer event
   * reports its position in.
   *
   * The engine's own letterboxed fit run backwards, in the CSS pixels a pointer
   * event carries. The camera is deliberately not in it: `menuItemRect` reports
   * a region in LOGICAL units, and this is the map that puts a device on one.
   */
  client(x: number, y: number): { x: number; y: number };
  /**
   * The device pixel under a logical point, as `[r, g, b, a]`.
   *
   * Fails by assertion when the last frame that ran was not drawn — after a
   * {@link skip} or inside a {@link quiet} scope — rather than reporting a
   * picture from a frame that is no longer the current one.
   */
  pixel(x: number, y: number): [number, number, number, number];
  /**
   * Whether the canvas holds the picture of the frame the game is on.
   *
   * False after a {@link skip} or a quiet sweep, and true again once a drawn
   * frame has run. {@link captureStill} reads it, so a still is never an older
   * frame wearing the current one's name.
   */
  drawn(): boolean;

  /** Close the world, halt the loop, and drop the engine's listeners. */
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
 * A logical point's device pixel, through the world's camera and the engine's
 * fit. The camera opens at the defaults — world and logical coordinates
 * coincide, which is the space every figure `specs/overview.md` fixes is stated
 * in — so the projection is the identity unless the build moved it, and
 * mapping through it keeps the reading honest either way.
 */
function toDevice(
  world: World,
  view: Viewport,
  x: number,
  y: number,
): { x: number; y: number } {
  const logical = world.camera.worldToLogical({ x, y });
  return {
    x: Math.round(view.offsetX + logical.x * view.scale),
    y: Math.round(view.offsetY + logical.y * view.scale),
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
 * The context calls that put ink on the canvas, as opposed to the ones that move
 * the pen, set a style, build a path or measure something.
 *
 * The set an undrawn frame skips (see the header). Everything else goes through
 * untouched, so the pipeline's own bookkeeping — its transforms, its saves and
 * restores, its `measureText` and its gradients — behaves exactly as it does on
 * a drawn frame, and a build's own `DrawComponent` reads back what it always
 * reads back. The only difference an undrawn frame makes is that nothing lands
 * in the pixels.
 */
const RASTER_OPS: ReadonlySet<string> = new Set([
  "clearRect",
  "drawImage",
  "fill",
  "fillRect",
  "fillText",
  "putImageData",
  "stroke",
  "strokeRect",
  "strokeText",
]);

/**
 * A proxy that records every call and property set on its way to the real
 * context, so one frame produces both a pixel buffer to sample and a call list
 * to inspect.
 *
 * `drawing` is the harness's own gate. On a frame that is not being drawn the
 * raster calls are dropped and nothing is recorded: a march has no picture and
 * no call list to leave, and keeping either would be tens of thousands of
 * entries from frames no check reads. `requirePainted` is how every reading of
 * the PIXELS — `getImageData`, wherever a check takes it from — is stopped from
 * answering off a canvas a march left behind.
 */
function recorder(
  target: SKRSContext2D,
  calls: DrawCall[],
  drawing: () => boolean,
  requirePainted: (what: string) => void,
): SKRSContext2D {
  return new Proxy(target, {
    get(object, property) {
      const value = Reflect.get(object, property, object) as unknown;
      if (typeof value !== "function") return value;
      return (...args: unknown[]): unknown => {
        const method = String(property);
        if (method === "getImageData") requirePainted("a pixel reading");
        if (!drawing()) {
          if (RASTER_OPS.has(method)) return undefined;
          return (value as (...rest: unknown[]) => unknown).apply(object, args);
        }
        const call: DrawCall = { kind: "call", method, args };
        if (
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
        if (method === "drawImage") {
          const m = object.getTransform();
          call.transform = { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f };
        }
        calls.push(call);
        return (value as (...rest: unknown[]) => unknown).apply(object, args);
      };
    },
    set(object, property, value) {
      if (drawing())
        calls.push({ kind: "set", property: String(property), value });
      return Reflect.set(object, property, value, object);
    },
  });
}

/**
 * The debug surface the BUILD's instance returned from `initialize`, read off
 * the engine that holds it.
 *
 * This is deliberately a READ and never a construction. The surface is the
 * build's deliverable: its instance's `initialize` returns it
 * (specs/instrumentation.md), the engine keeps that same object, and
 * `engine.debug` is the only way it reaches a check. Nothing here could stand
 * in for it, because the build's own module for the surface is never imported.
 *
 * By the time this runs `engine.initialize()` has resolved, which is the one
 * precondition `engine.debug` has: it holds whatever the instance returned. A
 * build whose `initialize` returned `undefined` never gets this far, because
 * the engine rejects `initialize` itself, naming the missing surface, and the
 * rejection fails the suite's `beforeEach` with the engine's own message. Such
 * a build does not run on the engine under any entry point, so it is not this
 * harness's fault to report — which is why every suite's `afterEach` disposes
 * its harness with `?.`: the hook then has nothing to add to that message.
 *
 * What IS decided here is a return that is no surface — a build whose
 * `initialize` returned `null`, or something other than an object. That is a
 * fault in the build and not in this harness, so it must not present as one:
 *
 * - It is NOT thrown from here. Every suite builds its harness in a
 *   `beforeEach`, so a throw at this point would fail the hook and bury the
 *   real verdict under the harness's own stack in the case's own file.
 * - It is NOT swallowed either. {@link missingSurface} stands in for the
 *   missing surface and fails, by assertion, at the moment a check first
 *   reaches for an operation on it — naming the return the build owes.
 *
 * So the harness is built, teardown runs, and the fault lands exactly where
 * specs/instrumentation.md says it should: on the points whose checks reach the
 * game through the surface. A check that needs no surface is decided on its own
 * merits, and `instrumentation/surface-present` names the missing surface
 * outright.
 */
function readDebugSurface(engine: Engine<ShatterSurface>): ShatterSurface {
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
 * A stand-in for the surface a build never returned: every operation on it
 * fails the check that reached for it, with the missing return named.
 *
 * A proxy rather than a hand-written stub, so a check that reaches for ANY
 * member — an operation this engine's surface carries, one the `warhead`
 * variant adds, or one a future revision adds — reports the missing surface
 * rather than a `TypeError`.
 *
 * Keys that belong to the MACHINERY rather than to a check are answered with
 * `undefined` instead: awaiting the harness probes `then`, and vitest's own
 * error formatting probes symbols and `constructor`. Failing those would
 * replace the verdict below with noise from the machinery that was trying to
 * report it.
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
 * What the build owes when its surface is missing: the `Expected:` line of the
 * failure every check that reaches for the surface lands on, beside what
 * `engine.debug` was found holding instead.
 */
const SURFACE_REQUIREMENT =
  "the debug surface src/game.ts's instance returns from initialize, which " +
  "the engine hands back from engine.debug (specs/instrumentation.md)";

/**
 * Build an engine over a canvas of the harness's own, initialize the build's
 * game, and hand back everything a check reads.
 *
 * The options passed to the factory are the ones the seeded `src/main.ts`
 * passes — the fixed logical field size, the build's exported `BACKGROUND`, and
 * the four-way-plus-two-buttons layout — so one harness serves every build of
 * this case under either variant. Everything else the build decided lives inside
 * `src/game.ts`.
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
   * How many {@link Harness.quiet} scopes are open around the frame now running,
   * plus the one {@link Harness.advance} and {@link Harness.skip} open around
   * the frames of a march.
   *
   * A frame runs undrawn while this is above zero — unless the engine's replay
   * recorder is capturing, because the recorder is armed around the stretch a
   * reviewer will watch and a section of blank frames would be evidence of
   * nothing.
   */
  let quietDepth = 0;
  /** Whether the canvas holds the picture of the frame the game is on. */
  let painted = true;
  /** Frames run since the event loop last had a turn. See {@link YIELD_EVERY}. */
  let sinceYield = 0;
  let live: { recording(): boolean } | null = null;
  const drawingNow = (): boolean =>
    quietDepth === 0 || (live?.recording() ?? false);

  /**
   * Refuse a reading of the canvas taken after an undrawn march.
   *
   * A harness fault rather than a build's: the check asked for the picture of a
   * frame nothing drew. It fails here, naming what to do about it, instead of
   * quietly answering with an older frame — which is the one way a march that
   * skips the raster could buy speed by making a check decide less.
   */
  const requirePainted = (what: string): void => {
    if (painted) return;
    fail(
      `${what} taken on a drawn frame`,
      "the last frame that ran was not drawn (h.skip, or a quiet scope), so " +
        "the canvas still holds an older frame — advance one frame before " +
        "reading it",
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

  const engine = createEngine<ShatterSurface>({
    canvas: element,
    width: FIELD_W,
    height: FIELD_H,
    game,
    // The build's own field background, handed to the engine exactly as the
    // seeded `src/main.ts` hands it (specs/overview.md), so the letterbox bars
    // match the field.
    background: BACKGROUND,
    layout: LAYOUT,
    clock: options.clock ?? new ConstantClock(TICK_MS),
    surface,
  });

  // Subscribed BEFORE `initialize`, which is what makes anything the game does
  // while starting up observable: construction runs no game code, so nothing
  // has happened yet.
  const cues: PlayedCue[] = [];
  const loops: LoopedCue[] = [];
  engine.events.on("cue:played", ({ cue, t, gain }) => {
    cues.push({ cue, t, gain });
  });
  engine.events.on("cue:looped", ({ cue, t }) => {
    loops.push({ cue, running: true, t });
  });
  engine.events.on("cue:stopped", ({ cue, t }) => {
    loops.push({ cue, running: false, t });
  });

  live = engine;
  const instance = await engine.initialize();

  /**
   * Run `frames` frames with the raster gate held where `draw` says.
   *
   * The gate is restored whatever the frames do, so a build that throws out of
   * an undrawn march leaves the next harness call drawing again and the failure
   * is the one the build produced.
   */
  const run = async (frames: number, draw: boolean): Promise<void> => {
    if (frames <= 0) return;
    if (!draw) quietDepth += 1;
    // Read while the gate is still where these frames ran under, so what the
    // canvas holds is recorded from the frames themselves.
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
      if (!draw) quietDepth -= 1;
    }
    painted = drew;
  };
  const debug = readDebugSurface(engine);

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
    get world() {
      return engine.world;
    },
    get state() {
      return engine.world.state;
    },
    instance,
    debug,
    ctx,
    canvas,
    calls,
    cues,
    loops,

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
    async advanceSeconds(duration) {
      await harness.advance(ticksFor(duration));
    },

    skip: (frames) => run(frames, false),

    async quiet(body) {
      quietDepth += 1;
      const before = painted;
      try {
        return await body();
      } finally {
        quietDepth -= 1;
        // A scope that ran no frame at all leaves the canvas as it found it.
        painted = painted && before;
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
        // The sampled frame is drawn, so the picture a sweep leaves is the
        // picture of the frame it stopped on — unless the whole sweep is inside
        // a quiet scope, which suppresses that too.
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
      // The frame the press is worth, with the key still down: see the note on
      // `Harness.tap`. Releasing first would arm the edge and present no value.
      await engine.advance(1);
      dispatch("keyup", code);
    },
    events: keys,

    movePointer,
    pressPointer,
    releasePointer,

    device: (x, y) => toDevice(engine.world, engine.viewport(), x, y),
    client: (x, y) => toClient(engine.viewport(), dpr, x, y),
    pixel: (x, y) => {
      requirePainted("a pixel read");
      const point = toDevice(engine.world, engine.viewport(), x, y);
      const { data } = ctx.getImageData(point.x, point.y, 1, 1);
      return [data[0], data[1], data[2], data[3]];
    },
    drawn: () => painted,

    dispose: () => engine.destroy(),
  };

  return harness;
}

/* -------------------------------------------------------------------------- */
/* Evidence capture                                                           */
/* -------------------------------------------------------------------------- */
//
// A review item declares an OUTPUT beside its verdict: the picture the build
// itself drew while a check drove it, kept as evidence a reviewer can look at
// and compare against the reference implementation's. `captureStill` keeps one
// frame; `captureReplay` keeps a stretch of motion, over the engine's own
// draw-command recorder.
//
// Four properties are what make capture usable, and each is deliberate:
//
// 1. IT RECORDS THE SECTION, NOT THE RUN. The recorder is armed around the
//    caller's scenario and disarmed the moment that scenario returns, so what is
//    kept is the part the check is ABOUT and never the setup that got there.
//    A RECORDING ENDS ON THE OUTCOME, NOT ON THE INSTANT OF MEASUREMENT: arm the
//    recorder before the scenario's last beat and stop it after the effect has
//    played out — a second of the fragments coming apart, of the wave arriving,
//    of the core that took the shot. The reading the verdict rests on is still
//    taken at the instant the event happened. A clip that cuts on the frame of
//    the measurement shows the reviewer everything except the thing the item is
//    named for.
// 2. IT IS EVIDENCE, NEVER A VERDICT. The scenario's own value comes straight
//    back, so a check reads it exactly as it did before capture existed, and a
//    scenario that THROWS still writes what it had recorded before the failure
//    travels on — a failing check is the one whose replay a reviewer most wants.
//    Nothing here can turn a passing check into a failing one: a recording that
//    cannot be written is reported as an output that never turned up, which is a
//    fact about the host rather than about the build.
// 3. IT WRITES ONLY WHAT THERE IS TO LOOK AT. A capture that closed no frames
//    leaves no file, so the run reports the output absent instead of offering the
//    reviewer a replay of nothing.
// 4. IT COSTS NOTHING WHEN NOBODY IS COLLECTING. Outside a run — a developer
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
 * The directory this harness sits in, which is the validator project's root.
 *
 * Taken from this module's own URL rather than from the working directory,
 * because it has to name the same directory wherever the suite is run from.
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
 * A recording is one JSON operation log per frame, so a section a check drives
 * for half a minute of game time runs to tens of megabytes — a file nobody can
 * serve to a reviewer and nobody wants in a run's artifacts. The cap is what
 * makes `captureReplay` safe to wrap ANY section in: an author arms the
 * recorder around what the check is about and never has to reason about how
 * long that turns out to be.
 *
 * The cap is generous enough that the great majority of this suite's sections —
 * a shot curving around the star, a Large coming apart, a saucer crossing the
 * field — are written whole.
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
 * Every entry here is reached from a kept frame, and every reference inside one
 * is rewritten as it is reached, transitively: a frame names its own state and
 * the states saved under it, whose clip and path segments and inherited fill name
 * operations and resources, whose own creating calls may name images. What is
 * deduplicated is the rewritten entry, so an operation two hundred frames issue
 * identically is written once and named two hundred times, and every index a
 * frame carries addresses the table it was interned into.
 *
 * Exported so the `__proto__` path can be reached directly: a recording carrying
 * an own field named `__proto__` is one the engine's recorder writes and this one
 * has to rewrite as a field rather than as a prototype, and no drawing the
 * reference implementation makes produces one — so nothing that captures a build
 * ever reaches that branch. No suite in this project exercises it at present.
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
 * what these outputs are named for. A sweep is evidence that the shot curved all
 * the way around the star, and the curve is spread across the whole of it.
 *
 * Thinning is legitimate because every frame in a recording is drawable on its
 * own: a frame names the whole of the state it opened with and reaches everything
 * it draws with through tables the recording shares, so dropping the frames
 * between two kept ones cannot leave a frame undrawable. Each kept frame's
 * `deltaMs` is restated as the time since the frame kept before it, so the deltas
 * still sum to the section's elapsed time and a player pacing itself off them
 * runs at the speed the game really ran at. The frame `count` is left as the host
 * reported it, so a reader can see that frames were skipped rather than being
 * told a smooth lie.
 *
 * The last frame is always kept, whatever the stride lands on: it is the frame the
 * check's sweep stopped at — the fragments apart, the wave up — and it is the one
 * a reviewer looks at first.
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
 * tables are shared by every frame the recorder kept and a dropped frame takes
 * the last reference to whatever only it drew with.
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
 * What lands on disk is gzip rather than raw JSON. A recording is text made
 * almost entirely of numbers, index lists and field names repeated once per
 * frame, which is close to the shape gzip is best at. That is what keeps a run's
 * whole set of recordings to a few megabytes. Every host that serves one declares
 * the encoding, so the browser inflates it before the player sees it, and the
 * document inside is the same one.
 *
 * Never throws. A directory that cannot be made or a file that cannot be written
 * says something about the machine the validators ran on, and failing the point
 * over it would blame the build for the host's problem. The runner already reads
 * a declared output that never turned up as exactly that.
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
 * const split = await captureReplay(h, "split", async () => {
 *   const round = aimedRound(rock, MUZZLE_SPEED);
 *   h.debug.addBullet(round.x, round.y, round.vx, round.vy);
 *   await h.until((s) => s.rocks.length === 2, { maxFrames: 30 });
 *   const fragments = h.snapshot().rocks;   // the reading, at the instant
 *   await h.advanceSeconds(1);              // and a second of them coming apart
 *   return fragments;
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
    // In a `finally`, so a scenario that failed still leaves its evidence behind.
    writeReplay(destination, h.engine.stopRecording());
  }
}

/**
 * Keep the frame currently on the canvas as the review item's `outputId` output.
 *
 * The companion to {@link captureReplay}, and the DEFAULT for this case: most
 * items declare an image, because most of them are decided on a posed scenario
 * read once — the field mid-wave, the title screen, the HUD, a rock at each
 * size. A recording of a still screen would be the same frame three hundred
 * times over, and a reviewer looking at a field wants to look at the field.
 *
 * What is written is whatever the last frame that RAN left behind, so call it
 * after the frame that poses the thing under test — an `advance(1)` following the
 * arrangement — and before the assertions, so a check that fails still leaves the
 * picture that shows why. Nothing here can change a verdict: outside a run the
 * media directory is unset and this is a no-op, and a still that cannot be written
 * is reported as an output that never turned up, which is a fact about the host
 * rather than about the build.
 */
export function captureStill(h: Harness, outputId: string): void {
  // Before the destination is resolved, so a still taken off a stale canvas is
  // refused on every run rather than only on the runs that collect media.
  if (!h.drawn()) {
    fail(
      "a still captured on a drawn frame",
      "the last frame that ran was not drawn (h.skip, or a quiet scope), so " +
        "the canvas still holds an older frame — advance one frame before " +
        "capturing",
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
// Each of these poses a situation through the debug surface — or the real
// registered actions — and then lets the build's own rules run. They fix only
// arrangement: where a rock stands, which side of it a round comes in on, which
// key is held. Every threshold a check asserts is stated in the check itself,
// derived from the figure or rule specs/ states for it.
//
// A check calls the ones it needs and no more. Nothing here is a prerequisite of
// anything else here: a check about the title menu poses no field, and a check
// about a rock's drift poses no saucer.

/**
 * `reset({seed})`: the title screen, a seeded generator, every declared field at
 * its title-screen value, both world gates back ON.
 *
 * No frame is advanced. A pose acts on the live game at the call under this
 * engine (specs/instrumentation.md), so the state is restored when this returns,
 * and a check about what `reset` restores — `simTime` among them — reads a game
 * that has run no frame since.
 */
export function resetTo(h: Harness, seed?: number): void {
  h.debug.reset(seed === undefined ? undefined : { seed });
}

/**
 * A NEW RUN, opened the way a player opens one.
 *
 * `reset(seed)` for the title screen and a seeded generator, then `confirm` on
 * the title's highlighted first entry, `PLAY`, which is what opens a game
 * (specs/ui.md) — and a game opens on wave 1, as specs/progression.md states.
 * No pose on the surface starts a run, and there is not meant to be one: the
 * opening wave is laid by the path the menu takes, and that path is what a check
 * about the starting field is about.
 *
 * ONE FRAME RUNS, the frame that delivers the key's edge. `reset` restores both
 * world gates to ON, and this helper leaves them there — so a run opened this
 * way has the game's own wave loop and its own saucer arrival running, which is
 * how a check about either reaches one without turning a gate back on by hand.
 */
export async function startRun(h: Harness, seed?: number): Promise<void> {
  resetTo(h, seed);
  await tapAction(h, "confirm");
}

/**
 * Everything off the field: every rock, every round of either kind, the saucer,
 * and — under `warhead` — every torpedo.
 *
 * A harness sequence rather than a debug operation because the surface is atomic
 * by design: every line below is one of its own clears.
 *
 * `clearRocks()` DESTROYS NOTHING. specs/instrumentation.md is explicit that it
 * is a way to make room — it scores nothing and no rock was destroyed on the
 * tick it ran — so a field it emptied is a wave being played rather than a wave
 * cleared. That is what makes it safe here, and it is also why NO CHECK IN THIS
 * CASE REACHES A CLEARED WAVE WITH IT. A wave clears on the tick its last rock
 * is DESTROYED (specs/progression.md), and the only way to a cleared wave is to
 * shoot the field down: {@link shootFieldDown}.
 */
export function clearWorld(h: Harness): void {
  h.debug.clearRocks();
  h.debug.clearBullets();
  h.debug.clearEnemyBullets();
  h.debug.removeSaucer();
  // `warhead` only. A `base` surface carries no such operation and there is
  // nothing to clear; a build that owes one and did not ship it is decided by
  // `instrumentation/clear-torpedoes`, not silently here.
  h.debug.clearTorpedoes?.();
}

/**
 * Live play on an EMPTY, QUIET field at wave 1, with the ship at the safe point,
 * facing up, at rest, and able to fire.
 *
 * This is the ground almost every mechanical check stands on, and it is a
 * harness sequence rather than a debug operation because the surface is atomic:
 * every line below is one of its operations.
 *
 * EMPTY is safe. A wave clears on the tick in which the last rock on the field
 * is DESTROYED (specs/progression.md), so a field that never held one never
 * clears, and a posed rule runs without a wave turning over underneath it.
 *
 * QUIET is the three gates. With `waveSpawning`, `saucerSpawning` and the ship's
 * `collision` all off, nothing the scenario did not ask for arrives, spawns, or
 * costs a life: no wave lands on top of the reading, no saucer wanders in at
 * eighteen seconds and starts shooting, and no incidental contact empties the
 * field mid-scenario.
 *
 * A check whose REQUIREMENT is one of those three faculties turns that one back
 * on itself, and only that one. A check that finds itself wanting a gate for any
 * other reason has almost always been mis-posed, and re-posing it is the fix.
 * Parking a bystander rock in a harmless corner to hold a wave off is NOT the
 * defence — `setWaveSpawning(false)` is.
 *
 * The generator is left as it stands, so a check that wants a seeded one calls
 * {@link resetTo} first. No frame is advanced: every pose here lands at the call.
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

  // `warhead` only: a game begins with the charge full (specs/weapons.md), so a
  // scenario posed into live play begins there too.
  h.debug.setTorpedoCharge?.(1);
}

/** The ship, posed in one call. Anything omitted is left exactly as it stands. */
export interface ShipPose {
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  /** The facing, in radians. */
  angle?: number;
}

/**
 * The ship posed at a place, on a course, facing a way.
 *
 * Position, velocity and facing are three separate operations on the surface
 * because each is independently verifiable; this is the one call a scenario
 * makes when it wants all three. Rotation changes no velocity and velocity
 * changes no facing, here as on the surface.
 */
export function poseShip(h: Harness, pose: ShipPose): void {
  if (pose.x !== undefined || pose.y !== undefined) {
    const ship = h.snapshot().ship;
    h.debug.setShipPosition(pose.x ?? ship.x, pose.y ?? ship.y);
  }
  if (pose.vx !== undefined || pose.vy !== undefined) {
    const ship = h.snapshot().ship;
    h.debug.setShipVelocity(pose.vx ?? ship.vx, pose.vy ?? ship.vy);
  }
  if (pose.angle !== undefined) h.debug.setShipAngle(pose.angle);
}

/**
 * One rock of `size` at a logical field position, on a course, and its id.
 *
 * The id comes off the snapshot's last rock, which is where an added rock lands
 * (specs/instrumentation.md, Identity). A build whose `addRock` added nothing
 * fails here, naming the operation.
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
  const rocks = h.snapshot().rocks;
  if (rocks.length === 0) {
    fail(
      `addRock(${JSON.stringify(size)}, ${x}, ${y}) to append a rock to the ` +
        `roster (specs/instrumentation.md)`,
      "the rock roster is empty",
    );
  }
  const id = rocks[rocks.length - 1].id;
  if (vx !== 0 || vy !== 0) h.debug.setRockVelocity(id, vx, vy);
  return id;
}

/** One of the ship's rounds in flight at a logical field position, and its id. */
export function poseBullet(
  h: Harness,
  x: number,
  y: number,
  vx: number,
  vy: number,
): number {
  h.debug.addBullet(x, y, vx, vy);
  const bullets = h.snapshot().bullets;
  if (bullets.length === 0) {
    fail(
      `addBullet(${x}, ${y}, ${vx}, ${vy}) to append a bullet to the roster ` +
        `(specs/instrumentation.md)`,
      "the bullet roster is empty",
    );
  }
  return bullets[bullets.length - 1].id;
}

/** One saucer bullet in flight at a logical field position, and its id. */
export function poseEnemyBullet(
  h: Harness,
  x: number,
  y: number,
  vx: number,
  vy: number,
): number {
  h.debug.addEnemyBullet(x, y, vx, vy);
  const bullets = h.snapshot().enemyBullets;
  if (bullets.length === 0) {
    fail(
      `addEnemyBullet(${x}, ${y}, ${vx}, ${vy}) to append a saucer bullet to ` +
        `the roster (specs/instrumentation.md)`,
      "the saucer-bullet roster is empty",
    );
  }
  return bullets[bullets.length - 1].id;
}

/**
 * A saucer on the field at a logical position, and its id.
 *
 * It arrives at cruise with all three faculties on (specs/instrumentation.md),
 * so a check that wants it still holds `travel` off, a check that wants it
 * unsteered holds `mind` off, and a check that wants a quiet crossing holds
 * `gun` off. Each faculty is its own switch, and a check turns off exactly the
 * ones its requirement is not about.
 */
export function poseSaucer(h: Harness, x: number, y: number): number {
  h.debug.addSaucer(x, y);
  const saucer = h.snapshot().saucer;
  if (saucer === null) {
    fail(
      `addSaucer(${x}, ${y}) to bring a saucer onto the field ` +
        `(specs/instrumentation.md)`,
      "snapshot().saucer is null",
    );
  }
  return saucer.id;
}

/* ---- Shooting the field down ---------------------------------------------- */

/**
 * A round placed on a target's doorstep, ready to be handed to `addBullet`.
 *
 * Everything about it is arrangement, and every piece of that arrangement exists
 * to stop the round from measuring something other than the hit:
 *
 * ON THE SIDE FACING AWAY FROM THE STAR. The round is placed on the far side of
 * the target from `(STAR_X, STAR_Y)` and fired INWARD, so its whole flight is
 * the standoff and it is travelling away from the core the entire time. A round
 * placed on the near side would have the core between it and the target on any
 * miss, and specs/collision.md has the core absorb a shot that reaches it — so a
 * near-side round that missed would vanish into the star and the check would
 * read a shot that was never spent on the rock.
 *
 * CARRYING THE TARGET'S OWN VELOCITY. The round's velocity is the target's plus
 * `speed` inward, so the closing speed is exactly `speed` whatever the target
 * was doing. A Small drifts at up to `210` units per second; a round that did
 * not carry it would be aimed at where the rock was rather than where it is
 * going, and would miss a drifting rock at exactly the moment a check needs it
 * not to.
 *
 * The `standoff` is the gap between the round's centre and the target's surface.
 * It is short on purpose: the closing speed is `speed`, so the round covers it
 * within a tick or two and the gravity the well adds over that stretch is a
 * fraction of a unit per second.
 */
export interface Round {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** The default gap between a placed round's centre and its target's surface. */
export const ROUND_STANDOFF = 4;

/** A round placed on `target`'s doorstep and fired inward. See {@link Round}. */
export function aimedRound(
  target: { x: number; y: number; vx: number; vy: number; radius: number },
  speed: number = MUZZLE_SPEED,
  standoff: number = ROUND_STANDOFF,
): Round {
  const dx = target.x - STAR.x;
  const dy = target.y - STAR.y;
  const away = Math.hypot(dx, dy);
  // A target standing exactly on the star has no side facing away from it.
  // Nothing in the game reaches that point — the core takes a rock well outside
  // it — so any direction is as good as another, and `+x` is a direction.
  const ux = away === 0 ? 1 : dx / away;
  const uy = away === 0 ? 0 : dy / away;

  const reach = target.radius + standoff;
  const placed = wrapPoint({
    x: target.x + ux * reach,
    y: target.y + uy * reach,
  });
  return {
    x: placed.x,
    y: placed.y,
    vx: target.vx - ux * speed,
    vy: target.vy - uy * speed,
  };
}

/** How {@link shootFieldDown} is told when to stop, and how hard to shoot. */
export interface ShootDownOptions {
  /**
   * How many rocks may remain. The sweep stops when the field holds at most this
   * many AND every one of them is a Small — `0` for an empty field.
   */
  leave?: number;
  /** The speed each round closes at. Defaults to the gun's own `MUZZLE_SPEED`. */
  speed?: number;
  /** The gap between a round's centre and its target's surface. */
  standoff?: number;
  /**
   * The most rounds the sweep will spend before giving up. A build whose bullets
   * do not destroy the rocks they strike hits this, and fails naming the rule.
   */
  maxRounds?: number;
}

/**
 * Shoot the field down for real, round after round, and answer how many rounds
 * it took.
 *
 * THIS IS THE ONLY WAY A CHECK IN THIS CASE REACHES A CLEARED WAVE.
 * specs/progression.md clears a wave on the tick in which the last rock on the
 * field is DESTROYED — a transition, not a predicate over an empty field — and
 * specs/instrumentation.md is explicit that `clearRocks()` destroys nothing. A
 * build that raises its next wave from the destruction event rather than from
 * polling field emptiness is exactly conformant, and a check that emptied the
 * field with `clearRocks` would fail it. So every round here goes in through
 * `addBullet` and is resolved by the build's own collision, split and scoring
 * code.
 *
 * Two details are the difference between this working and this being a coin
 * toss, and both live in {@link aimedRound}: the round comes in from the side
 * facing away from the star, so it can never be absorbed by the core on the way;
 * and it carries the target's own velocity, so a Small drifting at `210` units
 * per second is not missed.
 *
 * IT SHOOTS THE SMALLEST ROCK ON THE FIELD, always. Destroying a Large replaces
 * it with two Mediums and destroying a Medium replaces it with two Smalls, so
 * the field's rock COUNT rises for every hit but the fatal one; only destroying
 * a Small takes a rock off the field. That is also why the stop condition is not
 * a count alone: the sweep stops when the field holds at most `leave` rocks and
 * every one of them is a Small.
 *
 * Each round is followed until it is SPENT — landed, absorbed, or expired at the
 * end of its `BULLET_LIFE` — so at most one of the harness's rounds is ever in
 * flight and the `MAX_BULLETS` cap is never in the way.
 *
 * A caller that wants the LAST rock left standing for itself asks for
 * `{ leave: 1 }`: the field then holds one Small, and the round the check fires
 * at it is the one whose tick the wave clears on. A caller running with the wave
 * loop ON must do exactly that — with `leave: 0` the wave would clear and spawn
 * the next one underneath the sweep, which would never end.
 */
export async function shootFieldDown(
  h: Harness,
  options: ShootDownOptions = {},
): Promise<number> {
  const leave = options.leave ?? 0;
  const speed = options.speed ?? MUZZLE_SPEED;
  const standoff = options.standoff ?? ROUND_STANDOFF;
  const maxRounds = options.maxRounds ?? 240;
  // A round is spent when it lands, is absorbed, or reaches the end of its life.
  // Waiting the whole of `BULLET_LIFE` costs nothing in the ordinary case — a
  // round on a rock's doorstep lands within a tick or two — and it is what keeps
  // a build that misses from leaving rounds in flight behind the sweep.
  const settle = ticksFor(BULLET_LIFE) + 2;

  let rounds = 0;
  for (;;) {
    const rocks = h.snapshot().rocks;
    const down =
      rocks.length <= leave && rocks.every((rock) => rock.size === "small");
    if (down) return rounds;

    if (rounds >= maxRounds) {
      fail(
        `the field to be shot down to ${leave} Small rock(s) within ` +
          `${maxRounds} rounds — a bullet destroys the rock it strikes ` +
          `(specs/collision.md)`,
        `${rocks.length} rock(s) left after ${rounds} rounds: ` +
          rocks.map((rock) => rock.size).join(", "),
      );
    }

    const target = smallestRock(rocks);
    if (target === undefined) {
      // Nothing on the field, and yet not down: the caller asked to leave more
      // rocks than there are, which is a scenario that cannot be posed.
      fail(
        `at least ${leave} rock(s) on the field to shoot down`,
        "the field is empty",
      );
    }

    const round = aimedRound(target, speed, standoff);
    const id = poseBullet(h, round.x, round.y, round.vx, round.vy);
    rounds += 1;
    await h.until((s) => s.bullets.every((bullet) => bullet.id !== id), {
      maxFrames: settle,
    });
  }
}

/* ---- Driving the real input path ------------------------------------------ */

/** An action the game registers, as `specs/controls.md` names them. */
export type Action = keyof typeof BINDINGS;

/** Every key bound to an action, from the case-fixed `BINDINGS` table. */
export function keysFor(action: Action): readonly string[] {
  return BINDINGS[action].keys;
}

/**
 * One press of the action's first bound key — the REAL registered-action path,
 * which is the only way the menus move (specs/ui.md) and the only way the gun
 * fires.
 *
 * The key is down for exactly one frame, so an action read as a press edge and
 * an action read as a held value both see one press. See {@link Harness.tap}.
 */
export async function tapAction(h: Harness, action: Action): Promise<void> {
  await h.tap(keysFor(action)[0]);
}

/** Hold the action's first bound key down, as a player holding it would. */
export function holdAction(h: Harness, action: Action): void {
  h.hold(keysFor(action)[0]);
}

/** Release the action's first bound key. */
export function releaseAction(h: Harness, action: Action): void {
  h.release(keysFor(action)[0]);
}

/**
 * Hold `code` down for `frames` frames and let it up.
 *
 * The key is down for the whole of the run, so a check that measures a rate
 * measures exactly `frames` frames of movement. The release is in a `finally`,
 * so a scenario that failed mid-hold does not leave the key down for the next
 * one.
 */
export async function holdFor(
  h: Harness,
  code: string,
  frames: number,
): Promise<void> {
  h.hold(code);
  try {
    await h.advance(frames);
  } finally {
    h.release(code);
  }
}

/** {@link holdFor} against an action's first bound key. */
export function holdActionFor(
  h: Harness,
  action: Action,
  frames: number,
): Promise<void> {
  return holdFor(h, keysFor(action)[0], frames);
}

/**
 * Hold two keys down together for `frames` frames and let both up — turning
 * while thrusting, which is how a ship actually flies.
 */
export async function holdBothFor(
  h: Harness,
  first: string,
  second: string,
  frames: number,
): Promise<void> {
  h.hold(first);
  h.hold(second);
  try {
    await h.advance(frames);
  } finally {
    h.release(first);
    h.release(second);
  }
}

/**
 * Toggle the engine's diagnostics overlay and run the frame that draws — or
 * stops drawing — it.
 *
 * The overlay is ENGINE CHROME under this engine: the backtick key
 * (`Backquote`) toggles it through a keydown listener the engine itself owns on
 * the harness's event target, never through a registered action (engine docs,
 * diagnostics.md). It is drawn after the pipeline renders, through the same
 * context this harness records — so with the overlay up, the registered
 * sources' lines land in `h.calls` as ordinary text draws, readable with
 * {@link drawnText} — but AFTER the engine recorder's bracket closes, so none of
 * it appears in a `captureReplay` recording. Capture overlay evidence with
 * {@link captureStill}.
 */
export async function toggleOverlay(h: Harness): Promise<void> {
  h.hold("Backquote");
  h.release("Backquote");
  await h.advance(1);
}

/* -------------------------------------------------------------------------- */
/* Sampling a run                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Read something off the game every `stride` frames over `frames` frames, and
 * answer every reading in order.
 *
 * The first reading is taken BEFORE any frame runs, so the first entry is the
 * scenario as it was posed and each later one is `stride` frames further on. The
 * final frame is always sampled, whatever the stride lands on, so the reading at
 * the end of the stretch is in the answer.
 *
 * This is how a long scenario is watched without a snapshot every tick: a
 * crossing of the whole field is 1097 ticks, and a sweep that flies 54 of them
 * cannot afford to read them all. What a coarse stride costs is stated where it
 * is spent — a path sampled every eight ticks is a path whose closest approach
 * falls BETWEEN two samples far more often than on one, so a check that measures
 * a distance to that path measures it to the line between consecutive samples
 * (`geometry.ts`'s `closestApproachToStar`), never to the samples themselves.
 */
export async function sampleEvery<T>(
  h: Harness,
  frames: number,
  stride: number,
  read: (snapshot: ShatterSnapshot) => T,
): Promise<T[]> {
  const step = Math.max(1, Math.round(stride));
  const samples: T[] = [read(h.snapshot())];
  let run = 0;
  while (run < frames) {
    const next = Math.min(step, frames - run);
    await h.advance(next);
    run += next;
    samples.push(read(h.snapshot()));
  }
  return samples;
}

/* -------------------------------------------------------------------------- */
/* Reading the snapshot                                                       */
/* -------------------------------------------------------------------------- */
//
// Plain functions over the object `snapshot()` returned, so a check reads what
// it is about without walking a roster by hand.
//
// They come in two kinds, and the difference matters. The `...By`/`...Of`
// readings ASSERT NOTHING: a reading that is not there comes back `undefined`,
// and what that means is the check's to state. The `require...` readings assert
// that the entity is there and fail naming it.
//
// REACH FOR THE `require...` FORM WHENEVER THE CHECK GOES ON TO READ THE
// ENTITY. A check that drove the game and then dereferenced whatever came back
// crashes on a build that produced nothing — and a crashed suite is reported as
// a build that failed to expose its debug surface, which is a different and much
// worse verdict than the true one. Hard-asserting the entity first turns that
// into the failure the item is for.

/** The rock with that id, or `undefined` where no rock carries it. */
export function rockById(
  snapshot: ShatterSnapshot,
  id: number,
): RockSnapshot | undefined {
  return snapshot.rocks.find((rock) => rock.id === id);
}

/** The ship's bullet with that id, or `undefined` where none carries it. */
export function bulletById(
  snapshot: ShatterSnapshot,
  id: number,
): BulletSnapshot | undefined {
  return snapshot.bullets.find((bullet) => bullet.id === id);
}

/** The saucer bullet with that id, or `undefined` where none carries it. */
export function enemyBulletById(
  snapshot: ShatterSnapshot,
  id: number,
): BulletSnapshot | undefined {
  return snapshot.enemyBullets.find((bullet) => bullet.id === id);
}

/** Every torpedo in flight — an empty list under `base`, which has none. */
export function torpedoesOf(snapshot: ShatterSnapshot): TorpedoSnapshot[] {
  return snapshot.torpedoes ?? [];
}

/** The torpedo with that id, or `undefined` where none carries it. */
export function torpedoById(
  snapshot: ShatterSnapshot,
  id: number,
): TorpedoSnapshot | undefined {
  return torpedoesOf(snapshot).find((torpedo) => torpedo.id === id);
}

/** Every rock of one size, in roster order. */
export function rocksOf(
  snapshot: ShatterSnapshot,
  size: RockSize,
): RockSnapshot[] {
  return snapshot.rocks.filter((rock) => rock.size === size);
}

/** How the sizes order, smallest first — the order a field is shot down in. */
const SIZE_ORDER: Readonly<Record<RockSize, number>> = {
  small: 0,
  medium: 1,
  large: 2,
};

/**
 * The smallest rock on the field, or `undefined` where there is none. Ties go
 * to the earliest in roster order, so the answer is stable.
 */
export function smallestRock(
  rocks: readonly RockSnapshot[],
): RockSnapshot | undefined {
  let best: RockSnapshot | undefined;
  for (const rock of rocks) {
    if (best === undefined || SIZE_ORDER[rock.size] < SIZE_ORDER[best.size]) {
      best = rock;
    }
  }
  return best;
}

/** The rock with that id, hard-asserted. See the note above. */
export function requireRock(
  snapshot: ShatterSnapshot,
  id: number,
  context?: string,
): RockSnapshot {
  const rock = rockById(snapshot, id);
  if (rock === undefined) {
    fail(
      context === undefined
        ? `rock ${id} to be on the field`
        : `rock ${id} to be on the field (${context})`,
      snapshot.rocks.map((entry) => entry.id),
    );
  }
  return rock;
}

/** The ship's bullet with that id, hard-asserted. */
export function requireBullet(
  snapshot: ShatterSnapshot,
  id: number,
  context?: string,
): BulletSnapshot {
  const bullet = bulletById(snapshot, id);
  if (bullet === undefined) {
    fail(
      context === undefined
        ? `bullet ${id} to be in flight`
        : `bullet ${id} to be in flight (${context})`,
      snapshot.bullets.map((entry) => entry.id),
    );
  }
  return bullet;
}

/** The saucer bullet with that id, hard-asserted. */
export function requireEnemyBullet(
  snapshot: ShatterSnapshot,
  id: number,
  context?: string,
): BulletSnapshot {
  const bullet = enemyBulletById(snapshot, id);
  if (bullet === undefined) {
    fail(
      context === undefined
        ? `saucer bullet ${id} to be in flight`
        : `saucer bullet ${id} to be in flight (${context})`,
      snapshot.enemyBullets.map((entry) => entry.id),
    );
  }
  return bullet;
}

/** The saucer, hard-asserted to be up. */
export function requireSaucer(
  snapshot: ShatterSnapshot,
  context?: string,
): SaucerSnapshot {
  const saucer = snapshot.saucer;
  if (saucer === null) {
    fail(
      context === undefined
        ? "a saucer on the field"
        : `a saucer on the field (${context})`,
      null,
    );
  }
  return saucer;
}

/**
 * The torpedo with that id, hard-asserted. `warhead` only.
 *
 * This is the reading that turns a build which launched nothing into
 * `torpedo/the-torpedo-action-launches-one` failing, rather than into the whole
 * suite crashing on an undefined and the build being misreported as one with no
 * debug surface at all.
 */
export function requireTorpedo(
  snapshot: ShatterSnapshot,
  id: number,
  context?: string,
): TorpedoSnapshot {
  const torpedo = torpedoById(snapshot, id);
  if (torpedo === undefined) {
    fail(
      context === undefined
        ? `torpedo ${id} to be in flight`
        : `torpedo ${id} to be in flight (${context})`,
      torpedoesOf(snapshot).map((entry) => entry.id),
    );
  }
  return torpedo;
}

/**
 * The one torpedo in flight, hard-asserted. `warhead` only: specs/weapons.md
 * allows at most one at a time, so a check that launched one reads it here.
 */
export function requireOnlyTorpedo(
  snapshot: ShatterSnapshot,
  context?: string,
): TorpedoSnapshot {
  const torpedoes = torpedoesOf(snapshot);
  if (torpedoes.length !== 1) {
    fail(
      context === undefined
        ? "exactly one torpedo in flight"
        : `exactly one torpedo in flight (${context})`,
      torpedoes.length,
    );
  }
  return torpedoes[0];
}

/* -------------------------------------------------------------------------- */
/* The cues                                                                   */
/* -------------------------------------------------------------------------- */

/** A one-shot cue the build played, and the frame of the run it played on. */
export interface TimedCue {
  cue: string;
  /** The frame loop's simulated time when it played, in milliseconds. */
  t: number;
  /** The cue's gain: zero while the bus is muted, positive otherwise. */
  gain: number;
  /** The frame it played on, 1-based, as `engine.frame().count` reports. */
  frame: number;
}

/** A held cue starting or stopping, and the frame it happened on. */
export interface TimedLoop {
  cue: string;
  running: boolean;
  t: number;
  frame: number;
}

/**
 * Record every one-shot cue the build plays from now on, stamped with its frame.
 *
 * The engine publishes `cue:played` synchronously from inside `audio.play`, so
 * the handler runs while the frame that played it is still running and
 * `engine.frame().count` is that frame's own number. That is what lets a check
 * assert not merely that a cue sounded but that it sounded on the frame of the
 * event — which is what tells a build that plays a cue on the right event apart
 * from one that plays it on every frame, or a frame late.
 */
export function watchCues(h: Harness): TimedCue[] {
  const played: TimedCue[] = [];
  h.engine.events.on("cue:played", ({ cue, t, gain }) => {
    played.push({ cue, t, gain, frame: h.engine.frame().count });
  });
  return played;
}

/**
 * Record every held cue starting and stopping from now on, stamped with its
 * frame.
 *
 * specs/audio.md makes `thrust` a held cue: it starts on the tick thrust begins,
 * sounds for as long as thrust is applied, and stops within a tenth of a second
 * of release. A single blip at the start of a burn is not this cue — which is
 * why a check about it reads the loop's start and stop rather than a count of
 * one-shots.
 */
export function watchLoops(h: Harness): TimedLoop[] {
  const events: TimedLoop[] = [];
  h.engine.events.on("cue:looped", ({ cue, t }) => {
    events.push({ cue, running: true, t, frame: h.engine.frame().count });
  });
  h.engine.events.on("cue:stopped", ({ cue, t }) => {
    events.push({ cue, running: false, t, frame: h.engine.frame().count });
  });
  return events;
}

/** Every recorded firing of the cue named `name`, oldest first. */
export function cuesNamed(h: Harness, name: string): PlayedCue[] {
  return h.cues.filter((cue) => cue.cue === name);
}

/** Forget every cue recorded so far, so a check reads its own section alone. */
export function clearCues(h: Harness): void {
  h.cues.length = 0;
  h.loops.length = 0;
}

/* -------------------------------------------------------------------------- */
/* Reading the rendered pixels                                                */
/* -------------------------------------------------------------------------- */

/** A sampled colour, each channel 0–255. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * The rendered colour at a logical point, averaged over a small cluster: the
 * centre pixel plus four neighbours `4` units out, so one stray anti-aliased
 * pixel cannot swing the reading.
 *
 * The right reading for a body drawn as a solid shape — a bullet, the core, a
 * filled rock — and the wrong one for a sparse figure such as an outlined ship
 * or a wireframe rock, which a five-point cross can miss entirely. Read those
 * with {@link litAround}.
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

/** How bright a colour is, on the 0–255 scale (Rec. 601). */
export function luminance(colour: Rgb): number {
  return 0.299 * colour.r + 0.587 * colour.g + 0.114 * colour.b;
}

/** Euclidean distance between two colours, 0 to about 441. */
export function colorDistance(a: Rgb, b: Rgb): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

/**
 * The fraction of a box's pixels {@link litAround} takes its colour from: the
 * brightest of them.
 *
 * A twentieth is a mark a player sees rather than a stray pixel, and small
 * enough that a body drawn as an outline is read by its own strokes rather than
 * by the space they enclose.
 */
const LIT_FRACTION = 0.05;

/**
 * The colour of whatever is LIT within `radius` logical units of a point: the
 * mean of the brightest {@link LIT_FRACTION} of the pixels in the box around it.
 *
 * Shatter's bodies are line art on a dark field — a ship drawn as a triangle
 * outline, a rock as a jagged closed path — and a cross through the centre of
 * one lands on empty space as often as on the figure. This reads the figure
 * instead, which is what specs/overview.md's legibility requirements are written
 * about.
 *
 * On bare field every pixel is the ground, so this reads the ground, and a body
 * and the field behind it are always compared like with like.
 */
export function litAround(
  h: Harness,
  x: number,
  y: number,
  radius: number,
): Rgb {
  const from = h.device(x - radius, y - radius);
  const to = h.device(x + radius, y + radius);
  const { data } = h.ctx.getImageData(
    from.x,
    from.y,
    Math.max(1, to.x - from.x),
    Math.max(1, to.y - from.y),
  );
  const pixels: Rgb[] = [];
  for (let i = 0; i < data.length; i += 4) {
    pixels.push({ r: data[i], g: data[i + 1], b: data[i + 2] });
  }
  pixels.sort((a, b) => luminance(b) - luminance(a));
  const taken = Math.max(1, Math.round(pixels.length * LIT_FRACTION));
  let red = 0;
  let green = 0;
  let blue = 0;
  for (let i = 0; i < taken; i += 1) {
    red += pixels[i].r;
    green += pixels[i].g;
    blue += pixels[i].b;
  }
  return { r: red / taken, g: green / taken, b: blue / taken };
}

/**
 * The build's exported `BACKGROUND`, rasterized: the colour the engine clears
 * the whole canvas to each frame (specs/overview.md), read back through the
 * same canvas implementation the harness samples with, so a pixel the game
 * never drew over compares against it exactly.
 *
 * The fill is repeated rather than applied once so a translucent colour reads
 * as the engine leaves it: the engine composites its clear over the previous
 * frame every frame, which converges on the colour's own channels, and a single
 * fill over a transparent canvas would not.
 */
export function clearColor(): Rgb {
  const probe = createCanvas(1, 1);
  const ctx = probe.getContext("2d");
  ctx.fillStyle = BACKGROUND;
  for (let i = 0; i < 255; i += 1) ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return { r, g, b };
}

/**
 * The canvas's whole backing store, copied — so a check can hold two frames
 * apart and say whether anything the build drew changed between them.
 */
export function canvasPixels(h: Harness): Uint8ClampedArray {
  const { width, height } = h.canvas;
  return Uint8ClampedArray.from(h.ctx.getImageData(0, 0, width, height).data);
}

/** How many bytes differ between two {@link canvasPixels} captures. */
export function pixelsChanged(
  before: Uint8ClampedArray,
  after: Uint8ClampedArray,
): number {
  let changed = 0;
  const length = Math.min(before.length, after.length);
  for (let i = 0; i < length; i += 1) {
    if (before[i] !== after[i]) changed += 1;
  }
  return changed + Math.abs(before.length - after.length);
}

/* -------------------------------------------------------------------------- */
/* Reading one frame's render                                                 */
/* -------------------------------------------------------------------------- */

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

/** Forget every call recorded so far, so a check reads one frame's render. */
export function clearCalls(h: Harness): void {
  h.calls.length = 0;
}

/**
 * Run one frame and answer the calls THAT frame made, and only those.
 *
 * `h.calls` accumulates for the life of the harness, which is what a check
 * comparing two stretches of a run wants. A check about what the game DRAWS
 * wants one frame's worth, and this is it.
 */
export async function renderFrame(h: Harness): Promise<DrawCall[]> {
  clearCalls(h);
  await h.advance(1);
  return [...h.calls];
}

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
 * commonly drawn with a selection marker or padding around it. Requiring the
 * exact run would fail a screen that shows precisely the right words.
 */
export function drewText(calls: readonly DrawCall[], text: string): boolean {
  const wanted = text.trim().toLowerCase();
  return drawnText(calls).some((drawn) => drawn.toLowerCase().includes(wanted));
}

/**
 * The geometry calls a frame made, by name.
 *
 * Enough of a count to compare two frames of the same scene: a frame that drew a
 * thrust flame asked for strictly more of these than the same frame with the
 * thrust released, whatever shape the build chose to draw it as.
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

/**
 * Every point a frame's drawing calls named, in the space the game draws in.
 *
 * The pipeline sets the world-to-device transform on the context before a
 * component draws, so the coordinates a drawing call carries are the game's own
 * — and with the camera at its defaults those are logical units. Where a render
 * put its geometry is the direct reading of it: the points strung along a curve
 * away from a bullet are its trail, and the points ringing the field's centre
 * are the star.
 *
 * The leading pair of arguments is the position for every method listed, except
 * the curve calls, whose control points come first and whose endpoint is the
 * last pair. `drawImage` is not in here, because its leading argument is a
 * bitmap rather than a coordinate — and this game draws none.
 */
export function drawnPoints(
  calls: readonly DrawCall[],
): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  const push = (x: unknown, y: unknown): void => {
    if (typeof x === "number" && typeof y === "number") points.push({ x, y });
  };

  for (const call of calls) {
    if (call.kind !== "call") continue;
    const { method, args } = call;
    if (
      method === "arc" ||
      method === "ellipse" ||
      method === "rect" ||
      method === "roundRect" ||
      method === "fillRect" ||
      method === "strokeRect" ||
      method === "moveTo" ||
      method === "lineTo"
    ) {
      push(args[0], args[1]);
    } else if (method === "quadraticCurveTo") {
      push(args[0], args[1]);
      push(args[2], args[3]);
    } else if (method === "bezierCurveTo") {
      push(args[0], args[1]);
      push(args[2], args[3]);
      push(args[4], args[5]);
    }
  }
  return points;
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
 * Every run of text the frame drew, placed in logical units.
 *
 * A build may anchor its text through any transform the pipeline or its own
 * drawing applies and align it any way it likes, so the anchor is mapped
 * through the transform the context held at the call and the run is extended
 * about it by its measured width and `textAlign`. Which way a `start`/`end`
 * alignment reads is the page's direction; this game draws no right-to-left
 * text, so they are left and right.
 *
 * The OVERLAY's text is in here too when the overlay is up: the engine draws
 * it through the same context, in device pixels under an identity transform,
 * which this mapping carries back to logical units like any other run.
 */
export function drawnTextSpans(h: Harness): TextSpan[] {
  const view = h.engine.viewport();
  const spans: TextSpan[] = [];
  for (const call of h.calls) {
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
