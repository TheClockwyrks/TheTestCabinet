// Shatter — the shared validator harness. CASE-PROVIDED, over the shared package.
//
// Every check in this suite is an ordinary vitest test that runs IN THE SAME
// PROCESS as the build. It imports the engine and the build's own modules,
// creates an engine over a canvas it owns and a clock it chose, and steps the
// game with `engine.advance`. Nothing drives a browser, nothing polls, and no
// wall-clock time passes: a check asks for a number of ticks and gets exactly
// that number.
//
// RECONCILING AFTER A POSE. A helper here that poses anything a reading derives
// from ends with `reconcile`, so a check that poses through these helpers never
// calls it itself. Shatter's derived readings are the ship's `speed`, each rock's
// `radius` and, on `warhead`, `torpedoReady` — so `startPlaying` and `poseRock`
// carry the call and the helpers that only add a bullet, a saucer or a torpedo do
// not. A check that poses with `h.debug.set...` DIRECTLY, outside these helpers,
// calls `reconcile` once itself before its first read or sweep. It costs no
// simulation time, so it never moves a measurement that begins at a posed rest
// state, which is exactly what stepping a frame to refresh a reading would do.
//
// WHAT COMES FROM `@clockwyrks/case-harness`, which the runner stages beside
// this project at `validation/case-harness/`: the key event, the surface metrics
// an engine takes its measurements through, the READ of the debug surface and the
// stand-in for a build that returned none, the apply-threaded driver, the device
// mapping and the pixel read, the colour, draw-call and text readings — the merge
// rule that reads a letter-spaced run as the copy it spells among them — the
// event-loop yield, the evidence writers, and the assertions. A fix landed there
// reaches Shatter; the copy of it that used to live here drifted from the day it
// was made.
//
// WHAT DOES NOT, AND WHY THIS PROJECT DOES NOT BIND `createEngineCaseHarness`.
// The kit's frame is one call of `engine.advance` per frame with the recorder
// always on, and Shatter's frame is neither of those: this case's whole reason
// for finishing in seconds rather than minutes is that A FRAME NOBODY LOOKS AT IS
// NOT DRAWN AND NOT RECORDED (see below), which needs the gate to sit inside the
// recorder and inside the game's `render` — two places the kit builds for itself
// and offers no seam into. Bound to the kit, `saucer/at-most-one-at-a-time`'s
// two minutes of game time sampled every tick would rasterize and record fourteen
// thousand pictures nothing reads, and `h.calls` would hold every one of those
// frames' operations where the suites are written against the last frame's alone.
// So the FRAME LOOP, the RECORDER and the CANVAS stay here, and every reading and
// every writer around them is the package's.
//
// WHAT A CHECK READS. The game's own state, through the debug surface's
// `snapshot`; the cues the engine broadcast; the calls the 2D context received
// and the pixels they left on the canvas. Nothing here fabricates an outcome:
// the scenario helpers below only ARRANGE the world through the debug surface,
// and the real `update` the build wrote is what runs from there.
//
// THE HARNESS SUPPLIES THE CLOCK. `ConstantClock(TICK_MS)` at Shatter's own
// `TICK_HZ`, so one advanced frame delivers exactly one `TICK_DT` of game time
// and `h.advance(n)` runs `n` whole simulation ticks. That is why
// `[instrumentation]` in `test-case.toml` carries no `tick_hz`: the rate is a
// rule of the GAME (`specs/simulation.md`), transcribed into `./constants` and
// asserted by the checklist, and the suite reads it from there rather than being
// handed it by the runner.
//
// WHERE THE SURFACE COMES FROM. Off `engine.debug`, never built here. The
// build's `initialize` returns it beside the state, as `[state, debug]`
// (`specs/instrumentation.md`), and the engine holds the second element. Reading
// it back off the engine is the only way a surface reaches a check, so a build
// that returned no surface, or one missing an operation, fails the checks that
// reach the game through it — and fails them at the point that reached, never in
// a `beforeEach`. The package's `readDebugSurface` does that read and stands an
// `absentSurface` in when there is nothing to read.
//
// HOW THE SURFACE IS DRIVEN — the APPLY-THREADED strategy, which is what a simple
// engine's state model forces. The engine holds the state by value and hands it
// out read-only, so the surface is pure: a pose takes the current state and
// returns the next, a reading takes the current state and returns what it read
// (`surface.ts`). A check still writes `h.debug.setShipPosition(640, 560)` and
// `h.debug.snapshot()`, because `h.debug` is the package's `applyDriver` over the
// raw surface: it runs each pose through `engine.apply` and hands each reading
// `engine.state` followed by whatever else the check passed — which is what keeps
// `menuItemRect(index)` answering about the entry the check named. `READINGS` in
// `surface.ts` is what tells a pose from a reading, because nothing about a pure
// surface distinguishes them at run time. Nothing a check does holds a writable
// state.
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
// `quiet` run every tick undrawn, for the sweeps that sample the state on EVERY
// tick and would otherwise draw every one of them. What they leave behind is a
// canvas holding an older frame, so the harness tracks that: {@link Harness.pixel},
// {@link sample} and {@link captureStill} REFUSE while the canvas is stale rather
// than reading a picture from a tick that is no longer the current one. A check
// that wants the picture after a quiet sweep advances one drawn tick for it.

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, type Canvas, type SKRSContext2D } from "@napi-rs/canvas";
import {
  ConstantClock,
  createEngine,
  type Clock,
  type Engine,
  type Game,
  type SurfaceMetrics,
  type Viewport,
} from "@clockwyrks/simple-2d";
import type { DeepReadonly } from "ts-essentials";
import { colorDistance, rgbOf, type Rgb } from "./case-harness/color";
import {
  callsTo,
  setsOf,
  type DrawCall,
  type TextGeometry,
} from "./case-harness/draw-calls";
import {
  DEFAULT_MAX_FRAMES,
  KeyEvent,
  applyDriver,
  breathe,
  captureOutputSync,
  readDebugSurface,
  surfaceMetrics,
  type PureDriver,
  type UntilOptions,
  type UntilResult as SweepResult,
} from "./case-harness/engine/index";
import { deviceOf, makeReplayCapture, pixelAt } from "./case-harness/engine/2d";
import type { Matrix } from "./case-harness/matrix";
import {
  drawnText,
  drawnTextRuns as coalesceTextDraws,
  restrikes,
} from "./case-harness/text";
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

/* The readings over one frame's drawing that are the package's, under the names
 * this suite has always called them by. */
export { callsTo, colorDistance, drawnText, setsOf };
export type { DrawCall, Rgb, TextGeometry };

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
 * The imperative reading of a pure surface: every member of `D`, minus its state
 * argument, over the engine that holds the state.
 *
 * The package's `PureDriver` under this case's own name — `Read` is the
 * deep-readonly view the engine hands out and `Write` the state a pose returns,
 * and those are the two faces of `ShatterState`. Optional members stay optional,
 * so a `warhead`-only pose is still `h.debug.clearTorpedoes?.()` and a `base`
 * slice never reaches for one.
 */
export type Driver<S, D> = PureDriver<DeepReadonly<S>, S, D>;

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

/**
 * The whole ticks that cover `seconds` of game time.
 *
 * ROUNDED TO NEAREST, and not the package's `ticksFor`, which rounds UP. Every
 * duration this suite poses is a figure `specs/` states in seconds against a
 * 120 Hz tick, so the two agree on every whole-tick span and part company only on
 * a fraction of a tick — where rounding up would run one tick past the moment a
 * window closes, which is exactly where the `lives` and `weapons` items measure.
 * The two spellings are a genuine disagreement, so this one keeps its own name
 * and body.
 */
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

/** One cue the build played, as the engine announced it. */
export interface PlayedCue {
  cue: string;
  /** Frame-loop time, in milliseconds. */
  t: number;
  /** The level the engine played it at; `0` while its own mute bit is set. */
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

/**
 * What a sweep found: whether the predicate ever held, and where it stopped.
 *
 * The package's shape, bound to this case's snapshot. `frames` and `ticks` are
 * ONE counter under two names — here a frame IS a tick — and this suite counts
 * `frames`; the second name is there so a helper written against the shared
 * vocabulary reads the same number.
 */
export type UntilResult = SweepResult<ShatterSnapshot>;
export type { UntilOptions };

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
   * reported ids across fifty seconds. Those loops call `advance(1)` a tick at a
   * time on purpose, so that no tick is ever stepped over, and each of those
   * calls would otherwise draw its one frame: six thousand pictures to
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

/* ---- The mouse and the touch contacts ------------------------------------- */
//
// `specs/ui.md` has the menus take a mouse and touch over the regions the build
// lays out, and the engine maps a pointer event's client position onto the field
// through the same letterboxed fit the game draws under (`engine/input.md`). So a
// check asks the build where its entry is, through `menuItemRect`, and dispatches
// a real pointer event at the middle of what it answered.
//
// A FIFTH POINTER EVENT, AND NOT ONE OF THE PACKAGE'S TWO. `PointerPositionEvent`
// carries a position and nothing else, and `DevicePointerEvent` states a device
// and `buttons: 1` on EVERY move — which is a drag. Shatter drives two contacts
// at once (`touch/landing-selects` lands a finger beside the mouse) and reads a
// slide-off as a press that ended somewhere else, so what the engine has to be
// handed is the mask genuinely HELD by that pointer id, per id: a press adds a
// button, a release drops one, and a move in the middle of a drag reports the
// press still down. That is a different event from either of the package's, so it
// stays here — see the README's collision table, where coil's and gantry's are
// recorded for the same reason.

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
 * How many frames run back to back before the worker's event loop is offered a
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
 * machine was rather than about the build.
 *
 * The chunk is what divides the march; whether the loop is actually given a turn
 * at each boundary is the package's `breathe`, which yields once the run has held
 * the thread for fifty milliseconds. Two thousand frames is a small enough chunk
 * that the check happens often, and large enough that a march that never blocks
 * pays for nothing.
 */
const YIELD_EVERY = 2_000;

/**
 * A proxy that records every call and property set on its way to the real
 * context, so one frame produces both a pixel buffer to sample and a call list
 * to inspect.
 *
 * NOT THE PACKAGE'S `recordingContext`, and this is the one place that matters:
 * `recording` is the harness's own gate. An undrawn frame issues only the
 * engine's own clear and viewport transform, and keeping those would fill
 * {@link Harness.calls} with tens of thousands of entries from a march nobody
 * asked to read. So a frame that is not being drawn is not recorded either, and
 * `calls` holds the frames a check actually looked at. What it RECORDS is the
 * package's {@link DrawCall}, measured text and all, so every reading over the
 * list is the package's.
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
            transform: [m.a, m.b, m.c, m.d, m.e, m.f] as Matrix,
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

/* -------------------------------------------------------------------------- */
/* Where the text landed                                                      */
/* -------------------------------------------------------------------------- */

/** One text call the frame made, placed in the logical `1280 x 720` field. */
export interface TextSpan {
  /** Where the call sits in the list it was read from. */
  at: number;
  text: string;
  /** The anchor, in logical units. */
  x: number;
  y: number;
  /** The horizontal extent of the glyphs, in logical units. */
  left: number;
  right: number;
}

/**
 * Every text call in `calls`, placed in logical units. ONE ENTRY PER CALL.
 *
 * The placement is the real one. `fillText` is called in the build's own user
 * space, so the recorder keeps the context transform at the moment of the call
 * along with the measured width and the alignment; the anchor is pushed through
 * that transform into device pixels, and the engine's viewport — the letterbox
 * offset and the device-pixels-per-logical-unit scale it chose — takes it the
 * rest of the way back into the field's own units. A build that drew its text
 * inside a `translate`/`scale` of its own is read exactly like one that did not.
 * Which way a `start`/`end` alignment reads is the page's direction; this game
 * draws no right-to-left text, so they are left and right.
 *
 * ONE ENTRY PER CALL is what a reader that counts draws or holds one draw clear
 * of a region wants. A reader of COPY wants the logical runs those calls spell
 * — a letter-spaced heading is one run and many calls — and that is
 * {@link spelledTextRuns}, which merges these.
 *
 * A call whose anchor is not a pair of numbers, or that the recorder never
 * measured, placed nothing a check could point at and is left out.
 */
export function drawnTextSpans(
  h: Harness,
  calls: readonly DrawCall[] = h.calls,
): TextSpan[] {
  const view = h.engine.viewport();
  const spans: TextSpan[] = [];
  for (let at = 0; at < calls.length; at += 1) {
    const call = calls[at];
    if (call.kind !== "call" || call.text === undefined) continue;
    if (call.method !== "fillText" && call.method !== "strokeText") continue;
    const [text, ax, ay] = call.args;
    if (typeof text !== "string") continue;
    if (typeof ax !== "number" || typeof ay !== "number") continue;
    const { transform: m, width, textAlign } = call.text;
    if (m === undefined) continue;
    // Device-space anchor, then back through the engine's fit to logical units.
    const deviceX = m[0] * ax + m[2] * ay + m[4];
    const deviceY = m[1] * ax + m[3] * ay + m[5];
    const x = (deviceX - view.offsetX) / view.scale;
    const y = (deviceY - view.offsetY) / view.scale;
    // The measured width is in the build's user space; the same transform's own
    // horizontal scale carries it to device pixels and the viewport's to logical.
    const w = (width * Math.hypot(m[0], m[1])) / view.scale;
    const before =
      textAlign === "center"
        ? w / 2
        : textAlign === "right" || textAlign === "end"
          ? w
          : 0;
    spans.push({ at, text, x, y, left: x - before, right: x - before + w });
  }
  return spans;
}

/** One logical run of text the frame spelled, and the calls that spelled it. */
export interface TextRunSpan extends TextSpan {
  /**
   * The calls the run was drawn in, in reading order; one for a run drawn
   * whole. A restrike — the same string struck again at the same anchor, an
   * outline and its fill — spelled nothing the run does not already, and is not
   * a part: an outlined heading drawn whole is still a run of one call.
   */
  parts: readonly TextSpan[];
}

/**
 * The frame's text calls coalesced into the logical runs they spell, placed in
 * logical units.
 *
 * WHY. A build that letter-spaces a heading draws one glyph per `fillText`,
 * which is the only portable way to letter-space canvas text, and `specs/ui.md`
 * fixes the COPY a screen shows while leaving its spacing to the build. A reader
 * that matched copy against each raw call would fail a screen that drew exactly
 * the right words. So copy is read off the RUNS: the shared harness's merge rule
 * (`case-harness/text.ts`) joins side-by-side draws on one baseline back into
 * the string they spell, which the recorder's measurement of every text call is
 * what makes possible.
 *
 * MERGED HERE, IN LOGICAL UNITS. The shared rule is relative, so it is handed
 * the calls already placed by {@link drawnTextSpans} — each as a left-anchored
 * draw at its logical extent — rather than the raw calls, whose walk would
 * decide in whatever space the build happened to draw in. Every run keeps the
 * anchor of its first call, so a run drawn whole comes back as its own span.
 *
 * AND EVERY RUN KEEPS ITS PARTS. Coalescing can only add a match to a reader
 * that matches by containment — every raw string is a substring of its run —
 * but a reader that wants a standalone word, an exact figure or an equal string
 * can lose one: two runs the build set a bare space apart, in two calls, come
 * back glued. Such a reader reads the run AND its parts, and passes on either.
 *
 * NAMED FOR WHAT IT ADDS. The package's own `drawnTextRuns(calls)` — imported
 * here as `coalesceTextDraws`, and what the engineless validators bind by that
 * name — places the merged runs as `TextDraw[]` in the canvas's own units and
 * keeps no parts. This one is placed in LOGICAL units through the engine's
 * viewport and carries the calls that spelled each run, so it goes by its own
 * name rather than answering the package's with a different signature.
 */
export function spelledTextRuns(
  h: Harness,
  calls: readonly DrawCall[] = h.calls,
): TextRunSpan[] {
  // The shared rule sorts the draws down the frame then across it and walks them
  // in that order, so a run's parts are a contiguous stretch of the same sort.
  const spans = drawnTextSpans(h, calls)
    .filter((span) => span.text.length > 0)
    .sort((a, b) => a.y - b.y || a.left - b.left);
  const merged = coalesceTextDraws(
    spans.map((span) => ({
      kind: "call" as const,
      method: "fillText",
      args: [span.text, span.left, span.y],
      text: { width: span.right - span.left, textAlign: "left" },
    })),
  );
  // The run's copy is its parts' concatenated, plus the SPACES the shared rule
  // writes at a word gap the build advanced over rather than drew, so the parts
  // are matched up with the whitespace folded out of both sides. And the rule
  // FOLDS A RESTRIKE — the same string struck again where the run's last draw
  // stands, `strokeText` then `fillText` of an outlined heading — into the draw
  // it repeats, widening the run without adding to its copy; so a span that
  // restrikes the part just taken is stepped over here, by the package's own
  // `restrikes` (its `RUN_BASELINE_SLACK` and `RUN_BACKTRACK_SLACK` decide it,
  // on the spans as they are handed over), or it would be counted against the
  // NEXT run's copy and throw the lining-up off from there on.
  const fold = (text: string): string => text.replace(/\s+/g, "");
  const runs: TextRunSpan[] = [];
  let next = 0;
  for (const run of merged) {
    const parts: TextSpan[] = [];
    const wanted = fold(run.text);
    let spelled = "";
    while (spelled.length < wanted.length && next < spans.length) {
      const part = spans[next];
      parts.push(part);
      spelled += fold(part.text);
      next += 1;
      while (next < spans.length && restrikes(spans[next], part)) next += 1;
    }
    const first = parts[0];
    if (first === undefined || spelled !== wanted) {
      // A harness fault, never the build's: the merge is a partition of the
      // placed calls, restrikes folded, in the order they were handed over.
      fail(
        "the harness's own reading of the frame's text runs to line up with " +
          "the calls that spelled them",
        { run: run.text, spelled },
      );
    }
    runs.push({
      at: first.at,
      text: run.text,
      x: first.x,
      y: run.y,
      left: run.left,
      right: run.right,
      parts,
    });
  }
  return runs;
}

/**
 * The colour the build drew at a logical point: ONE device pixel.
 *
 * Not the package's `sampleColor`, which averages a five-point cluster four
 * units out on the axes. Shatter's bodies are line art a few units across on a
 * dark field, and a cross that wide lands off the figure as often as on it, so
 * every appearance check in this project was decided on the pixel under the
 * point and the neighbourhood readings live in `presentation/ink.ts`, which
 * weighs what is LIT rather than what is at the centre.
 */
export function sample(h: Harness, x: number, y: number): Rgb {
  return rgbOf(h.pixel(x, y));
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
   * pay for one picture rather than six thousand.
   */
  let quietDepth = 0;
  /** Whether the canvas holds the picture of the tick the game is on. */
  let painted = true;
  /**
   * The moment the worker's event loop was last offered a turn.
   *
   * Held across every call rather than per march, because a check that steps a
   * tick at a time makes one call per tick: a deadline that restarted with each
   * of them would never be reached, and the loop would be held for the whole of
   * a fourteen-thousand-tick sweep. See {@link YIELD_EVERY}.
   */
  let sinceYield = Date.now();
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
  const surface: SurfaceMetrics = surfaceMetrics(
    { cssWidth, cssHeight, dpr },
    keys,
  );

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
  const debug = applyDriver<
    DeepReadonly<ShatterState>,
    ShatterState,
    ShatterDriver
  >(engine, readDebugSurface<ShatterSurface>(engine, SURFACE_REQUIREMENT), {
    readings: READINGS,
  });

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
        const chunk = Math.min(left, YIELD_EVERY);
        await engine.advance(chunk);
        left -= chunk;
        sinceYield = await breathe(sinceYield);
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
      const maxFrames =
        untilOptions.maxFrames ?? untilOptions.maxTicks ?? DEFAULT_MAX_FRAMES;
      const poll = Math.max(1, untilOptions.poll ?? 1);

      let snapshot = debug.snapshot();
      if (predicate(snapshot)) {
        return { hit: true, frames: 0, ticks: 0, snapshot };
      }

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
        if (predicate(snapshot)) {
          return { hit: true, frames, ticks: frames, snapshot };
        }
      }
      return { hit: false, frames, ticks: frames, snapshot };
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
    device: (x, y) => deviceOf(engine.viewport(), x, y),
    client: (x, y) => toClient(engine.viewport(), dpr, x, y),
    pixel: (x, y) => {
      requirePainted("a pixel read");
      return pixelAt(ctx, deviceOf(engine.viewport(), x, y));
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
 * The tie-break is part of the rule: "smallest" alone does not order two Smalls,
 * and a scenario that shoots the field down names one target per round.
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
// how a check produces one, and it is the package's writer — the thinning, the
// re-tabling, the gzip and the refusal to raise are the same ones every case's
// evidence is written under.
//
// AND ONE RULE ABOUT WHERE A CLIP ENDS, which belongs to the CALLER rather than
// to that code, and which fold-in fix D turned into a standing requirement: A
// RECORDING ENDS ON THE OUTCOME, NOT ON THE INSTANT OF MEASUREMENT. Arm the
// recorder before the scenario's last beat and stop it after the effect has
// played out — a second of the fragments coming apart, of the wave arriving, of
// the core that took the torpedo. The reading the verdict rests on is still
// taken at the instant the event happened; the clip simply does not cut on that
// frame.

/**
 * The directory this harness sits in, which is the validator project's root.
 *
 * Taken from this module's own URL rather than from the shared package's,
 * because the package is staged one directory DEEPER than the case's files: a
 * root derived there would address every output one level too far down, and
 * silently, because the writers are required not to raise.
 */
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

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
export const captureReplay = makeReplayCapture("shatter", PROJECT_ROOT);

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
  captureOutputSync("shatter", PROJECT_ROOT, outputId, "png", () =>
    h.canvas.toBuffer("image/png"),
  );
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
 * It does not call `reset` either. A check that needs a title-screen ground
 * calls `h.debug.reset()` itself, and a check that reaches its
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
  // The ship's `speed` follows the velocity this posed and `torpedoReady` follows
  // the charge, so the readings are brought into agreement before anything reads.
  h.debug.reconcile();
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
  // The rock's `radius` follows the size this just added.
  h.debug.reconcile();
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
