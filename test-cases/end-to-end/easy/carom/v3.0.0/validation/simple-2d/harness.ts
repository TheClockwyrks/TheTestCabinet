// Carom — the shared validator harness. CASE-PROVIDED.
//
// Every check in this suite is an ordinary vitest test that runs IN THE SAME
// PROCESS as the build. It imports the runtime and the build's own modules,
// creates a runtime over a canvas it owns and a clock it chose, and steps the
// game with `engine.advance`. Nothing drives a browser, nothing polls, and no
// wall-clock time passes: a check asks for a number of frames and gets exactly
// that number, at exactly the deltas its clock supplied.
//
// WHAT A CHECK READS. The game's own state (through the debug surface's
// `snapshot`), the runtime's frame counter, the events the runtime broadcast, and
// — for the rendering checks — the pixels on the canvas or the calls the 2D
// context received. Nothing here fabricates an outcome: the scenario helpers
// below only ARRANGE the world through the debug surface, and the real `update`
// the build wrote is what runs from there.
//
// WHY THE DEBUG SURFACE RATHER THAN RAW ASSIGNMENT. specs/instrumentation.md
// fixes its operations, so each means the same thing in every build: `setScreen`
// puts the game on a screen and touches nothing else, `setPaddleDriven` takes ONE
// paddle from the player, a posed `drivenVy` persists across frames, `clearWorld`
// empties the field, and `reset` gives everything back. Posing through it is how a
// scenario is reproducible, and it is the seam the case's specification documents.
// `surface.ts` is that specification as types, and it is the only description of
// the surface this harness reads: the build's own module for it is never imported.
//
// EVERY OPERATION IS ATOMIC, AND THE SEQUENCES LIVE HERE. Each operation on the
// surface sets one field or one fixed pair, places or removes one entity, or
// reads the state; `reset` is the sole exception. A match is therefore not an
// operation. Opening one on the countdown, reaching live play, staging a serve,
// reaching the pause menu, reaching the match-over screen — each of those is a
// SEQUENCE of atomic poses, and every sequence lives in this file so every check
// shares one.
//
// Each sequence is reachable in parts, which is the whole reason they are here.
// {@link openCountdown} opens a match and takes NOTHING from the player, so a
// check about the real controls plays the match a player would; a check that
// wants the paddles posed adds {@link drivePaddleAt} for the side it is about,
// and the other side stays live. Nothing a check did not ask for happens.
//
// ISOLATION. A check poses a world holding only what its requirement concerns.
// {@link poseWorld} empties the field with `clearWorld` and spawns back exactly
// the balls and obstacles the check is about, so a bank shot runs against one
// obstacle and a goal runs against one ball. Nothing here parks a spare ball in a
// corner or pins an obstacle still: containment leans on the very rules a broken
// build breaks, and an escaped bystander makes one check report another check's
// defect. The paddles are the exception the specification names — a paddle is
// field furniture the game always has, so a paddle a check must keep out of the
// way is DRIVEN out of the way ({@link parkPaddles}) rather than removed.
//
// WHERE THE SURFACE COMES FROM. Off `engine.debug`, never built here. The build's
// `initialize` returns it beside the state, as `[state, debug]`, and the runtime
// holds the second element and returns it from `engine.debug`. Reading it back
// off the runtime is the only way a surface reaches a check, so a build that
// returned no surface, or a surface missing an operation, fails the checks that
// reach the game through it. See `readDebugSurface`.
//
// HOW THE SURFACE IS DRIVEN. The runtime holds the state by value and hands it
// out read-only, so the surface is pure: a pose takes the current state and
// returns the next, a reading takes the current state and returns what it read
// (`surface.ts`). A check still writes `h.debug.setScreen("playing")` and
// `h.debug.snapshot()`, because `h.debug` is a {@link Driver} over the raw
// surface: it runs each pose through `engine.apply` and hands each reading
// `engine.state`. Nothing a check does holds a writable state — `h.state` is the
// runtime's current value, read fresh on every access, and the only way to change
// it is a pose.
//
// THE TWO TYPED VIEWS. A ball index is a `multi` concept, so the surface's ball
// operations take one under `multi` and none under `base` and `gyre`. Both
// typings are exposed over the SAME object: `h.debug` is the single-ball view a
// `base` or `gyre` check drives (`setBallPosition(x, y)`), and `h.multi` is the
// indexed view a `multi` check drives (`setBallPosition(index, x, y)`). They are
// two names for one surface, so neither call site casts and the two shapes cannot
// be confused for one another. The shared scenarios below drive the ball the
// scenario is about through {@link placeBall} and its siblings, which resolve the
// form off the build's own snapshot.
//
// THE KEYBOARD, THE POINTER, AND THE FINGER. The runtime attaches its key and
// pointer listeners to the event target the `surface` option supplies, so a check
// reaches the game by the path a player's hand takes. `hold`/`release`/`tap`
// dispatch a `KeyboardEvent`-shaped event at that target; `movePointer`,
// `pressPointer`, `releasePointer`, `tapPointer` and `dragPointer` dispatch a
// `PointerEvent`-shaped one, carrying `pointerType` so a finger is distinguishable
// from a mouse (specs/ui.md gives the menus all three). Each of them runs the
// frames the build needs to see the event, because the runtime discards an edge
// nothing consumed by the end of the frame it was armed in.
//
// THE CLOCK. `ConstantClock(TICK_MS)` is the default, so one frame is one
// 120 Hz tick and every duration below is a whole number of them, which is the
// unit a suite's frame-counted tolerance is stated in. A check that is
// specifically about the step size (gameplay/delta-time-independent) builds its
// own harnesses with clocks of its own.

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
  type PathSegment,
  type Engine,
  type Game,
  type PointerButton,
  type PointerDevice,
  type RecordedFrame,
  type Recording,
  type Resource,
  type SurfaceMetrics,
  type Viewport,
} from "@test-cabinet/simple-2d";
import type { DeepReadonly } from "ts-essentials";
import {
  BALL_R,
  FIELD_CX,
  FIELD_CY,
  FIELD_H,
  FIELD_W,
  LAYOUT,
  P1_X1,
  P2_X0,
  SPEED_CAP,
  SPEED_MULT,
  WIN_SCORE,
  type Point,
} from "./constants";
// `game` is the build's entry, and `BACKGROUND` is the clear colour it exports
// beside it. `BACKGROUND` is a value specs/overview.md leaves to the build, and
// it is handed straight back to the engine as the colour the canvas is cleared
// to, exactly as the seeded `src/main.ts` does; nothing compares it against
// anything. Those two names are the whole of what this project takes from the
// build outside a type.
import { BACKGROUND, game as build, type CaromState } from "../src/game";
import { assertEqual, assertNotEqual, assertTruthy, fail } from "./assert";
import {
  READINGS,
  type BallSnapshot,
  type CaromDebugApi,
  type CaromSnapshot,
  type MenuRect,
  type Mode,
  type MultiBallOps,
  type ResumeScreen,
  type Screen,
  type Side,
  type SingleBallOps,
} from "./surface";

export type { MenuRect, Mode, ResumeScreen, Screen, Side };

/**
 * The case's surface as `base` and `gyre` carry it: one ball, and no index on any
 * ball operation.
 *
 * This is the typing the runtime is parameterized with, because it is the shape
 * every operation OUTSIDE the ball group has in every variant — the six ball
 * operations are the only members the variants disagree about.
 */
export type CaromSurface = CaromDebugApi<CaromState, SingleBallOps<CaromState>>;

/**
 * The same surface as `multi` carries it: `index` first on every ball operation.
 *
 * Not a union with {@link CaromSurface} and not a cast at the call site. One
 * object is exposed under both typings — `h.debug` and `h.multi` — so a check
 * says which variant it is driving by which name it reaches for, and the
 * compiler holds it to that variant's arguments from there.
 */
export type CaromMultiSurface = CaromDebugApi<
  CaromState,
  MultiBallOps<CaromState>
>;

/**
 * The build's game, typed against the surface the CASE specifies.
 *
 * The build declares its own type for the surface its `initialize` returns, and
 * that type is the build's: what a check holds it to is `surface.ts`, so the game
 * is cast to the case's `Game<CaromState, CaromSurface>` here and the runtime is
 * parameterized with it. A surface that departs from the specification is caught
 * where a check reaches for the missing member, not by the build's own compiler.
 */
const game = build as unknown as Game<CaromState, CaromSurface>;

/**
 * A member of a pure surface, as a check calls it.
 *
 * A pose `(state, ...args) => S` becomes `(...args) => void`: the driver runs it
 * through `engine.apply`, so the state it returns is the state the next frame
 * receives. A reading `(state, ...args) => R` becomes `(...args) => R`: the
 * driver hands it `engine.state` and passes on whatever arguments follow, which
 * is what keeps `menuItemRect(index)` an indexed read rather than a bare one.
 * Anything else (`version`) is carried as it is.
 */
type Driven<S, M> = M extends (state: DeepReadonly<S>, ...args: infer A) => S
  ? (...args: A) => void
  : M extends (state: DeepReadonly<S>, ...args: infer A) => infer R
    ? (...args: A) => R
    : M;

/**
 * The imperative reading of a pure surface: every member of `D`, minus its
 * state argument, over the runtime that holds the state.
 *
 * Optional members stay optional, so a variant-only pose such as gyre's
 * `setObstacleClock` is still `h.debug.setObstacleClock?.(t)`.
 */
export type Driver<S, D> = {
  [K in keyof D]: Driven<S, NonNullable<D[K]>>;
};

/** The surface as a `base` or `gyre` check drives it. */
export type CaromDriver = Driver<CaromState, CaromSurface>;

/** The surface as a `multi` check drives it: `index` first on the ball group. */
export type CaromMultiDriver = Driver<CaromState, CaromMultiSurface>;

/**
 * The frame the suite steps in, in milliseconds.
 *
 * This is the SUITE's choice, not the game's: the case's own
 * `validation/constants.ts` deliberately fixes no timestep, because the runtime
 * hands the game whatever elapsed time a frame really took. Fixing it here makes
 * a duration a whole number of frames, so a tolerance can be stated in ticks and
 * mean the same thing on every machine.
 */
export const TICK_HZ = 120;
export const TICK_MS = 1000 / TICK_HZ;

/** Seconds of simulated time in `ticks` frames of the default clock. */
export function seconds(ticks: number): number {
  return ticks / TICK_HZ;
}

/** A speed in px/s from a displacement measured over `ticks` frames. */
export function speedOverTicks(delta: number, ticks: number): number {
  return (Math.abs(delta) * TICK_HZ) / ticks;
}

/** The angle from horizontal of a velocity, in degrees, ignoring direction. */
export function angleDeg(v: { vx: number; vy: number }): number {
  return (Math.atan2(Math.abs(v.vy), Math.abs(v.vx)) * 180) / Math.PI;
}

/* -------------------------------------------------------------------------- */
/* The balls                                                                  */
/* -------------------------------------------------------------------------- */

/** One ball, as a snapshot reports it. */
export type BallView = BallSnapshot;

/**
 * The ball every shared scenario drives: the only one under `base` and `gyre`,
 * and the first of the three under `multi`.
 *
 * The variants agree about what a ball IS and disagree only about how many there
 * are, so a check about the ball — its bounce, its spin, its speed off a paddle —
 * is the same check under all three, driven against ball zero. What makes that
 * sound under `multi` is {@link poseWorld}, which REMOVES the balls the scenario
 * is not about before it is posed, so the reading is of the driven ball alone.
 *
 * `CaromSnapshot` declares both shapes as optional, because which one a build
 * reports is its variant's to decide. A build reporting neither, or reporting no
 * ball on a field a check expected one on, fails by assertion here rather than
 * throwing a `TypeError` several frames later, so the point names the fault.
 */
export function ball0(snapshot: CaromSnapshot): BallView {
  const one = snapshot.ball ?? snapshot.balls?.[0];
  assertTruthy(
    one,
    "snapshot() must report the ball as `ball` (base, gyre) or the balls as " +
      "`balls` (multi); see specs/instrumentation.md",
  );
  return one as BallView;
}

/** Every ball a snapshot reports, in play order. */
export function allBalls(snapshot: CaromSnapshot): BallView[] {
  if (snapshot.balls !== undefined) return snapshot.balls;
  // `ball` is absent under `multi` and null on a cleared field; both are "no
  // ball to read", and `clearWorld` is what makes the second case ordinary.
  return snapshot.ball === undefined || snapshot.ball === null
    ? []
    : [snapshot.ball];
}

/**
 * Whether this build's ball operations take an index: `multi` alone.
 *
 * Read off the build's own snapshot rather than configured, because the snapshot
 * reports the same fact the operations do — `multi` reports its balls as `balls`,
 * each entry under its own `index`, and the other two report the single `ball`
 * with no index on it (specs/instrumentation.md). One harness therefore serves
 * all three variants without being told which one it is running against.
 */
export function ballsAreIndexed(h: Harness): boolean {
  return h.snapshot().balls !== undefined;
}

/** One recorded ball position, as `CaromState` declares it. */
export interface TrailPoint {
  x: number;
  y: number;
  t: number;
}

/** The shape a seeded `src/game.ts` holds the ball's hold and trail in. */
interface BallShape {
  holdTimer?: number;
  trail?: TrailPoint[];
}

/** The two shapes a seeded `src/game.ts` holds its balls in. */
interface StateShapes {
  receiver?: Side;
  ball?: BallShape | null;
  balls?: BallShape[];
}

/** The highlighted menu item, read off the state the build declared. */
export function menuIndex0(h: Harness): number {
  return h.state.menuIndex;
}

/** The title menu's remembered selection, read off the declared state. */
export function titleIndex0(h: Harness): number {
  return h.state.titleIndex;
}

/** The screen the pause menu resumes to, read off the state the build declared. */
export function resumeScreen0(h: Harness): string {
  return h.state.resumeScreen;
}

/**
 * The side the next serve travels toward: `base` and `gyre` only, where the
 * state declares `receiver` (specs/state.md).
 */
export function receiver0(h: Harness): Side {
  const value = (h.state as unknown as StateShapes).receiver;
  assertNotEqual(
    value,
    undefined,
    "the state must hold the next serve's side as `receiver`; see specs/state.md",
  );
  return value as Side;
}

/**
 * Seconds remaining of the driven ball's hold, read off the declared state.
 *
 * The hold is the BALL's own field in every variant (specs/state.md): `base` and
 * `gyre` carry it on their single `ball`, and `multi` on each of its `balls`. Both
 * are the same reading — how long until the ball this scenario drives leaves — and
 * a check about the hold takes it through here.
 */
export function holdTimer0(h: Harness): number {
  const shapes = h.state as unknown as StateShapes;
  const value = shapes.ball?.holdTimer ?? shapes.balls?.[0]?.holdTimer;
  assertEqual(
    typeof value,
    "number",
    "the state must hold the pre-serve hold on the ball as `holdTimer`; see " +
      "specs/state.md",
  );
  return value as number;
}

/* -------------------------------------------------------------------------- */
/* The harness                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Where a `fillText`/`strokeText` call put its text, read off the real context
 * at the moment of the call: the current transform, so the anchor can be mapped
 * to logical units whatever `translate`/`scale` the build applied, the measured
 * width under the current font, and the alignment that places the run about
 * its anchor.
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
  snapshot: CaromSnapshot;
}

/**
 * How one dispatched pointer event is shaped, and how long the build is given to
 * see it.
 *
 * `device` is what separates a finger from a mouse: specs/ui.md gives a touch
 * contact a rule of its own (a landing selects, because a finger does not hover),
 * so a check about touch passes `device: "touch"` and the runtime reports the
 * contact to the build as one.
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
   * one: the runtime discards an edge nothing consumed by the end of the frame it
   * was armed in, so an event no frame followed would never reach the game. Pass
   * `0` to leave the event undelivered and put a second one on the same frame.
   */
  frames?: number;
}

/** A drag, which is a press, a run of moves, and a release. */
export interface DragOptions extends PointerOptions {
  /** Move samples between the press and the release. Defaults to four. */
  steps?: number;
}

export interface Harness {
  readonly engine: Engine<CaromState, CaromSurface>;
  /**
   * The runtime's current state, read fresh on every access. Read it, or pose
   * it through `debug`; nothing here can write to it.
   */
  readonly state: DeepReadonly<CaromState>;
  /**
   * The debug surface the BUILD returned beside its state, driven over the
   * runtime: each pose runs through `engine.apply`, each reading is handed
   * `engine.state`.
   *
   * This is the SINGLE-BALL view, which is `base` and `gyre`'s: its ball
   * operations take no index, because those variants have one ball and nothing to
   * index. A `multi` check drives the same object through {@link Harness.multi}
   * instead.
   *
   * The raw surface is read off `engine.debug` rather than built here — see
   * {@link readDebugSurface} — and {@link driveSurface} is the wrapper.
   */
  readonly debug: CaromDriver;
  /**
   * The same surface under `multi`'s typing: `index` first on every ball
   * operation, selecting a ball in play order.
   *
   * The same object as {@link Harness.debug}, exposed a second time rather than
   * unioned with it, so a `multi` check writes `h.multi.setBallPosition(1, x, y)`
   * and a `base` check writes `h.debug.setBallPosition(x, y)`, each without a
   * cast and neither able to call the other's form.
   */
  readonly multi: CaromMultiDriver;
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
  /** Every call and property set the render made, oldest first. */
  readonly calls: DrawCall[];
  /** Every cue the build played, oldest first. */
  readonly cues: PlayedCue[];
  /** Every asset the build failed to load, oldest first. */
  readonly assetFailures: AssetFailure[];

  /** A fresh read of the game's state through the case's `snapshot`. */
  snapshot(): CaromSnapshot;
  /** Run `frames` frames back to back. */
  advance(frames: number): Promise<void>;
  /** Advance until `predicate` holds, sampling every `poll` frames. */
  until(
    predicate: (snapshot: CaromSnapshot) => boolean,
    options?: UntilOptions,
  ): Promise<UntilResult>;
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
   * Move the pointer to a logical point without pressing anything, then run the
   * frames that deliver it. This is the hover specs/ui.md selects a menu item on.
   */
  movePointer(x: number, y: number, options?: PointerOptions): Promise<void>;
  /** Press the pointer at a logical point and leave it down. */
  pressPointer(x: number, y: number, options?: PointerOptions): Promise<void>;
  /** Release a pointer pressed by `pressPointer`, at a logical point. */
  releasePointer(x: number, y: number, options?: PointerOptions): Promise<void>;
  /**
   * Press and release at one logical point, both edges on ONE frame.
   *
   * specs/ui.md says in as many words that a press and the release that follows it
   * may arrive on one frame and that the frame confirms, so this is the ordinary
   * click and the ordinary tap of a finger. A check that needs the two edges on
   * separate frames presses and releases itself.
   */
  tapPointer(x: number, y: number, options?: PointerOptions): Promise<void>;
  /**
   * Press at `from`, travel to `to` through `steps` moves, and release there.
   *
   * The held button is reported on every move, exactly as a browser reports it,
   * so the contact survives the travel. This is how a check drives the slide-off
   * affordance: a press begun on one item and released on another confirms
   * nothing.
   */
  dragPointer(from: Point, to: Point, options?: DragOptions): Promise<void>;

  /** Where a logical point lands in the canvas's backing store. */
  device(x: number, y: number): Point;
  /**
   * Where a logical point lands in the client coordinates a pointer event reports
   * its position in.
   *
   * The same letterboxed fit {@link Harness.device} goes through, taken back to
   * CSS pixels, which is what the runtime maps a pointer event through
   * (`engine/input.md`). Unrounded, deliberately: a device pixel rounded on the
   * way out lands a fraction of a unit off the point that was asked for, and a
   * menu item's edge is exactly where that fraction decides the reading.
   */
  client(x: number, y: number): Point;
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

/** The three pointer events the runtime listens for. */
type PointerEventName = "pointerdown" | "pointermove" | "pointerup";

/** Exactly the fields the runtime's pointer listeners read (`engine/input.md`). */
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

/**
 * A `PointerEvent`-shaped event, carrying the seven fields the runtime reads and
 * nothing else.
 *
 * A shim rather than a real `PointerEvent`, for the same reason {@link KeyEvent}
 * is a shim: this suite runs on a canvas with no document behind it, so there is
 * no `PointerEvent` constructor to call and no element to dispatch from. The
 * runtime narrows structurally — it reads `clientX`, `clientY`, `pointerId`,
 * `pointerType`, `isPrimary`, `button` and `buttons` off whatever arrives — so an
 * event carrying those drives the pointer exactly as a player's does.
 */
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
 * derived from the other. Both are the browser's, and the runtime reads them back
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

/** Where a logical point lands in the canvas's backing store. */
function toDevice(view: Viewport, x: number, y: number): Point {
  return {
    x: Math.round(view.offsetX + x * view.scale),
    y: Math.round(view.offsetY + y * view.scale),
  };
}

/**
 * Where a logical point lands in the client coordinates a pointer event carries.
 *
 * The runtime maps a pointer position by
 * `((client - origin) * dpr - offset) / scale` (`engine/input.md`), and this
 * surface supplies no `origin`, so the origin is the canvas's own corner and this
 * is that map run backwards.
 */
function toClient(view: Viewport, dpr: number, x: number, y: number): Point {
  return {
    x: (view.offsetX + x * view.scale) / dpr,
    y: (view.offsetY + y * view.scale) / dpr,
  };
}

/**
 * A proxy that records every call and property set on its way to the real
 * context, so one frame produces both a pixel buffer to sample and a call list
 * to inspect.
 */
function recorder(target: SKRSContext2D, calls: DrawCall[]): SKRSContext2D {
  return new Proxy(target, {
    get(object, property) {
      const value = Reflect.get(object, property, object) as unknown;
      if (typeof value !== "function") return value;
      return (...args: unknown[]): unknown => {
        const method = String(property);
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
        calls.push(call);
        return (value as (...rest: unknown[]) => unknown).apply(object, args);
      };
    },
    set(object, property, value) {
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

/**
 * The debug surface the BUILD returned beside its state, read off the runtime
 * that holds it.
 *
 * This is deliberately a READ and never a construction. The surface is the
 * build's deliverable: its `initialize` returns `[state, debug]`
 * (specs/instrumentation.md), the runtime keeps the second element, and
 * `engine.debug` is the only way it reaches a check. Nothing here could stand in
 * for it, because the build's own module for the surface is never imported.
 *
 * By the time this runs `engine.initialize()` has resolved, which is the one
 * precondition `engine.debug` has: it holds whatever the build returned as the
 * pair's second element, and a build that returned no pair at all never gets
 * this far, because the runtime rejects `initialize` itself and the rejection
 * fails the suite's `beforeEach` with the runtime's own message. Such a build
 * does not run on the engine under any entry point, so it is not this harness's
 * fault to report — which is why every suite's `afterEach` disposes its harness
 * with `?.`: the hook then has nothing to add to that message.
 *
 * What IS decided here is a pair whose second element is no surface — a build
 * that returned `[state, null]`, or something other than an object. That is a
 * fault in the build and not in this harness, so it must not present as one:
 *
 * - It is NOT thrown from here. Every suite builds its harness in a
 *   `beforeEach`, so a throw at this point would fail the hook and bury the real
 *   verdict under the harness's own stack in the case's own file.
 * - It is NOT swallowed either. {@link missingSurface} stands in for the
 *   missing surface and fails, by assertion, at the moment a check first reaches
 *   for an operation on it — naming the return the build owes.
 *
 * So the harness is built, teardown runs, and the fault lands exactly where
 * specs/instrumentation.md says it should: on the points whose checks reach the
 * game through the surface. A check that needs no surface is decided on its own
 * merits, and `instrumentation/debug-api` names the missing surface outright.
 */
function readDebugSurface(
  engine: Engine<CaromState, CaromSurface>,
): CaromSurface {
  const surface: unknown = engine.debug;
  if (typeof surface !== "object" || surface === null) {
    return missingSurface(
      `engine.debug holds ${surface === null ? "null" : typeof surface}, ` +
        `not an object`,
    );
  }
  return surface as CaromSurface;
}

/**
 * A stand-in for the surface a build never returned: every operation on it fails
 * the check that reached for it, with the missing return named.
 *
 * A proxy rather than a hand-written stub, because the surface is not a closed
 * list — the gyre variant adds `setObstacleClock` and `snapshot().obstacles`, and
 * a stub written against the common surface would report a gyre-only operation as
 * merely absent rather than as the consequence of the build's missing surface.
 *
 * Keys that belong to the RUNTIME rather than to a check are answered with
 * `undefined` instead: awaiting the harness probes `then`, and vitest's own error
 * formatting probes symbols and `constructor`. Failing those would replace the
 * verdict below with noise from the machinery that was trying to report it.
 */
function missingSurface(reason: string): CaromSurface {
  return new Proxy({} as CaromSurface, {
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
 * missing surface or a missing operation fails the check that needed it and
 * never the `beforeEach` that built the harness. A member that is not a
 * function (`version`, or an operation the build left out) comes back as it
 * is, which is what lets a variant slice test for its operation by `typeof`.
 *
 * A reading is called with `engine.state` FOLLOWED BY the arguments the caller
 * passed, because `menuItemRect(index)` is a reading that takes one of its own
 * and a driver that dropped it would ask every menu for item `undefined`. A pose
 * is run through `engine.apply`, so the runtime stores what it returned and the
 * next frame's `update` receives it; a pose that returns nothing is refused by
 * the runtime with a message naming the rule.
 */
function driveSurface(
  engine: Engine<CaromState, CaromSurface>,
  raw: CaromSurface,
): CaromDriver {
  const readings: readonly string[] = READINGS;
  return new Proxy({} as CaromDriver, {
    get: (_target, property): unknown => {
      if (typeof property === "symbol") return undefined;
      if (property === "then" || property === "constructor") return undefined;
      const member = (raw as unknown as Record<string, unknown>)[property];
      if (typeof member !== "function") return member;
      const op = member as (
        state: DeepReadonly<CaromState>,
        ...args: unknown[]
      ) => unknown;
      if (readings.includes(property)) {
        return (...args: unknown[]): unknown =>
          op.call(raw, engine.state, ...args);
      }
      return (...args: unknown[]): void => {
        engine.apply((state) => op.call(raw, state, ...args) as CaromState);
      };
    },
  });
}

/**
 * Hand the host's event loop a turn.
 *
 * A frame this project advances is a SYNCHRONOUS render, and a sweep of them is
 * one unbroken run of them: awaiting an already-settled promise only queues a
 * microtask, so nothing timer-driven gets a turn until the whole sweep is over.
 * The runner watching this worker is timer-driven, and a sweep long enough to
 * outlast its own ping is reported as an error against a run in which every check
 * passed. This is a macrotask, so the loop actually breathes; no game time passes
 * across it and nothing here poses anything.
 */
function breathe(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

/**
 * Build a runtime over a canvas of the harness's own, initialize the build's
 * game, and hand back everything a check reads.
 *
 * The options passed to the factory are the ones the seeded `src/main.ts`
 * passes — the design size, the build's exported `BACKGROUND`, and the touch
 * layout — so one harness serves every build of this case. Everything else the
 * build decided lives inside `src/game.ts`.
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
  const recorded = recorder(ctx, calls);
  const element = Object.assign(canvas, {
    style: {} as CSSStyleDeclaration,
    getContext: (): SKRSContext2D => recorded,
  }) as unknown as HTMLCanvasElement;

  // ONE target for the keys and the pointer alike, because the runtime attaches
  // both sets of listeners to whatever `events()` returns (`engine/input.md`).
  const events = new EventTarget();
  const surface: SurfaceMetrics = {
    cssWidth: () => cssWidth,
    cssHeight: () => cssHeight,
    dpr: () => dpr,
    events: () => events,
  };

  const engine = createEngine<CaromState, CaromSurface>({
    canvas: element,
    width: FIELD_W,
    height: FIELD_H,
    game,
    // The build's own field background, handed to the engine exactly as the
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

  await engine.initialize();
  const debug = driveSurface(engine, readDebugSurface(engine));

  const dispatch = (type: "keydown" | "keyup", code: string): void => {
    events.dispatchEvent(new KeyEvent(type, code));
  };

  /**
   * The buttons each pointer id currently holds, kept exactly as a browser keeps
   * them: a press adds one, a release drops one, and every event reports the set
   * as it stands once the event has been applied. Without it a move issued in the
   * middle of a drag would report no button held, and the runtime would take the
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
    events.dispatchEvent(
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

  const tapPointer = async (
    x: number,
    y: number,
    pointerOptions: PointerOptions = {},
  ): Promise<void> => {
    const button = pointerOptions.button ?? "primary";
    const id = pointerOptions.id ?? 1;
    buttonsOf(id).add(button);
    dispatchPointer("pointerdown", x, y, buttonIndexOf(button), pointerOptions);
    buttonsOf(id).delete(button);
    dispatchPointer("pointerup", x, y, buttonIndexOf(button), pointerOptions);
    await deliver(pointerOptions);
  };

  const dragPointer = async (
    from: Point,
    to: Point,
    pointerOptions: DragOptions = {},
  ): Promise<void> => {
    const steps = Math.max(1, pointerOptions.steps ?? 4);
    await pressPointer(from.x, from.y, pointerOptions);
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      await movePointer(
        from.x + (to.x - from.x) * t,
        from.y + (to.y - from.y) * t,
        pointerOptions,
      );
    }
    await releasePointer(to.x, to.y, pointerOptions);
  };

  const harness: Harness = {
    engine,
    get state() {
      return engine.state;
    },
    debug,
    // One object, a second typing. `multi`'s ball operations take an index and
    // the single-ball view's do not, and no runtime difference separates them:
    // which form a build installed is its variant's, and which form a check calls
    // is the check's own statement of the variant it is written for.
    multi: debug as unknown as CaromMultiDriver,
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
        await breathe();
      }
      return { hit: false, frames, snapshot };
    },

    hold: (code) => dispatch("keydown", code),
    release: (code) => dispatch("keyup", code),
    async tap(code) {
      dispatch("keydown", code);
      dispatch("keyup", code);
      await engine.advance(1);
    },

    movePointer,
    pressPointer,
    releasePointer,
    tapPointer,
    dragPointer,

    device: (x, y) => toDevice(engine.viewport(), x, y),
    client: (x, y) => toClient(engine.viewport(), dpr, x, y),
    pixel: (x, y) => {
      const point = toDevice(engine.viewport(), x, y);
      const { data } = ctx.getImageData(point.x, point.y, 1, 1);
      return [data[0], data[1], data[2], data[3]];
    },

    dispose: () => engine.destroy(),
  };

  return harness;
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
//    kept is the part the check is ABOUT and never the setup that got there. A
//    check that poses a ball in front of a paddle and then plays out the contact
//    records the contact; the pose costs nothing, and the reviewer is not asked to
//    scrub past a minute of arrangement to reach the two seconds that decide the
//    point.
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
 * because it has to name the same directory in both layouts this file lives in:
 * the case's own `validation/<engine>/`, and the `validation/` the runner stages
 * that directory to inside the build's tree.
 */
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * The directory the runner stages this project to inside the build's tree.
 *
 * A recording is addressed by the STAGED path of the suite that produced it —
 * `validation/gameplay/serve-speed.test.ts` — because that is the path the review
 * item's declared script resolves to, and so the only name the case's manifest and
 * the runner both already agree on. Stating the prefix here is what keeps that
 * address the same when this suite is run in place against a reference
 * implementation, where the project root is `validation/<engine>/` instead.
 */
const STAGED_PROJECT_DIR = "validation";

/**
 * The most frames a written recording holds.
 *
 * A recording is one JSON operation log per frame, and a frame of this game is a
 * couple of hundred operations, so a section a check drives for half a minute of
 * game time runs to tens of megabytes — a file nobody can serve to a reviewer and
 * nobody wants in a run's artifacts. The cap is what makes `captureReplay` safe to
 * wrap ANY section in: an author arms the recorder around what the check is about
 * and never has to reason about how long that turns out to be.
 *
 * The cap is generous enough that the great majority of this suite's sections —
 * a paddle contact, a bank shot, a point played out — are written whole.
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
 * whole point is to say each thing once, and the bulk of it in a game that draws
 * procedurally and so repeats almost nothing between frames.
 *
 * Every entry here is reached from a kept frame, and every reference inside one
 * is rewritten as it is reached, transitively: a frame names its own state and
 * the states saved under it, whose clip and path segments and inherited fill name
 * operations and resources, whose own creating calls may name images. What is
 * deduplicated is the rewritten entry, so an operation two hundred frames issue
 * identically is written once and named two hundred times, and every index a
 * frame carries addresses the table it was interned into.
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
 * what these outputs are named for. A rally is evidence that the ball accelerated
 * hit after hit, and the hits are spread across the whole of it.
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
 * check's sweep stopped at — the contact, the point, the rebound — and it is the
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
 * frame, which is close to the shape gzip is best at: a real capture of this game
 * stores about eight times smaller compressed. That is what keeps a run's whole
 * set of recordings to a few megabytes. Every host that serves one declares the
 * encoding, so the browser inflates it before the player sees it, and the
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
    console.warn(`carom: could not write ${destination}: ${String(error)}`);
  }
}

/**
 * Record the frames `scenario` draws and keep them as the review item's
 * `outputId` output, handing back whatever the scenario returned.
 *
 * Wrap the drive, not the arrangement:
 *
 * ```ts
 * const point = await captureReplay(harness, "goal", () => driveGoal(harness));
 * assertEqual(point.hit, true);
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
 * PICTURE rather than a stretch of motion: which screen the game opened on, what
 * colour it drew a paddle, where the letterbox bars fell. A recording of a still
 * screen would be the same frame three hundred times over, and a reviewer looking
 * at a menu wants to look at the menu.
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
  const destination = mediaDestination(outputId, "png");
  if (destination === null) return;
  try {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, h.canvas.toBuffer("image/png"));
  } catch (error) {
    console.warn(`carom: could not write ${destination}: ${String(error)}`);
  }
}

/* -------------------------------------------------------------------------- */
/* Scenario helpers                                                           */
/* -------------------------------------------------------------------------- */
//
// Each of these poses a situation through the debug surface and then lets the real
// simulation run. They fix only geometry: which entities stand on the field, and
// where a ball or a paddle is put. Every threshold a check asserts is stated in
// the check itself, derived from the figure or rule specs/ states for it.
//
// They are built from the surface's ATOMIC operations and from each other, which
// is what makes each of them reachable in parts. `openCountdown` opens a match and
// takes nothing from the player; `enterPlaying` adds the screen; `poseWorld` says
// what stands on the field; `drivePaddleAt` takes ONE paddle. A check assembles
// exactly the arrangement its requirement needs and nothing else happens.

/* ---- The world ----------------------------------------------------------- */

/**
 * What a check's field holds, by index.
 *
 * Ball indices are `multi`'s: `base` and `gyre` play with one ball, which `[0]`
 * names. Obstacle indices are every variant's, in the order of
 * `OBSTACLE_CENTERS`.
 */
export interface WorldContents {
  /** Which balls stand on the field. Defaults to the one the scenario drives. */
  balls?: readonly number[];
  /** Which obstacles stand on the field. Defaults to none. */
  obstacles?: readonly number[];
  /**
   * Whether each spawned ball is taken out of its hold, so it flies the moment it
   * is aimed. Defaults to true; a check about the pre-serve hold itself passes
   * `false` and reads the ball `spawnBall` placed.
   */
  live?: boolean;
}

/**
 * Empty the field and spawn back exactly what the check is about.
 *
 * This is the isolation the case's own policy requires, and it is why the surface
 * carries `clearWorld`, `spawnBall` and `spawnObstacle` at all. A check on a bank
 * shot runs against ONE obstacle, a check on a goal against ONE ball, and the
 * entities a check is not about are REMOVED rather than parked somewhere harmless
 * or frozen: containment leans on exactly the rules a broken build breaks, so an
 * escaped bystander would make one check report another check's defect.
 *
 * The paddles are not removed, because a paddle is field furniture the game always
 * has (specs/instrumentation.md). A paddle a check must keep out of the way is
 * driven out of it with {@link parkPaddles}.
 *
 * `spawnBall` places a ball HELD at its home with a full hold timer, which is a
 * pre-serve ball rather than a flying one, so every spawned ball is taken out of
 * its hold unless the caller asks otherwise.
 */
export function poseWorld(h: Harness, contents: WorldContents = {}): void {
  const balls = contents.balls ?? [0];
  const obstacles = contents.obstacles ?? [];
  // Read BEFORE the field is emptied: a build is free to report an empty `balls`
  // as an absent one, and the question here is which FORM its operations take.
  const indexed = ballsAreIndexed(h);

  h.debug.clearWorld();
  for (const index of balls) {
    if (indexed) h.multi.spawnBall(index);
    else h.debug.spawnBall();
  }
  if (contents.live !== false) {
    for (const index of balls) {
      if (indexed) {
        h.multi.setBallHeld(index, false);
        h.multi.setBallHoldTimer(index, 0);
      } else {
        h.debug.setBallHeld(false);
        h.debug.setBallHoldTimer(0);
      }
    }
  }
  for (const index of obstacles) h.debug.spawnObstacle(index);
}

/**
 * Place one ball at its home, held, with a full hold timer and an empty trail.
 *
 * The shared form of `spawnBall`: `index` is `multi`'s and is ignored by the
 * single-ball variants, which have one ball and nothing to index.
 */
export function spawnBall(h: Harness, index = 0): void {
  if (ballsAreIndexed(h)) h.multi.spawnBall(index);
  else h.debug.spawnBall();
}

/*
 * The five poses below drive THE BALL A SHARED SCENARIO IS ABOUT — the only one
 * under `base` and `gyre`, and the first of the three under `multi`, which is the
 * ball {@link ball0} reads back. Each is one atomic operation and nothing more;
 * they exist only to resolve which FORM of that operation the build installed, so
 * a scenario shared by all three variants poses a ball without naming a variant.
 *
 * A check about a particular ball under `multi` drives `h.multi` directly, where
 * the index is the first argument and the compiler requires it.
 */

/** Place the driven ball: `setBallPosition`. */
export function placeBall(h: Harness, x: number, y: number): void {
  if (ballsAreIndexed(h)) h.multi.setBallPosition(0, x, y);
  else h.debug.setBallPosition(x, y);
}

/** Aim the driven ball, in units per second: `setBallVelocity`. */
export function aimBall(h: Harness, vx: number, vy: number): void {
  if (ballsAreIndexed(h)) h.multi.setBallVelocity(0, vx, vy);
  else h.debug.setBallVelocity(vx, vy);
}

/** Set the driven ball's spin, in units per second squared: `setBallSpin`. */
export function spinBall(h: Harness, spin: number): void {
  if (ballsAreIndexed(h)) h.multi.setBallSpin(0, spin);
  else h.debug.setBallSpin(spin);
}

/** Hold the driven ball at its home, or let it fly: `setBallHeld`. */
export function holdBall(h: Harness, held: boolean): void {
  if (ballsAreIndexed(h)) h.multi.setBallHeld(0, held);
  else h.debug.setBallHeld(held);
}

/** Set the seconds remaining of the driven ball's hold: `setBallHoldTimer`. */
export function setBallHold(h: Harness, remaining: number): void {
  if (ballsAreIndexed(h)) h.multi.setBallHoldTimer(0, remaining);
  else h.debug.setBallHoldTimer(remaining);
}

/**
 * Take every ball on the field out of its hold, without serving it.
 *
 * `held` false with a spent hold timer is the state a served ball is in, so what
 * follows is a ball the game advances and collides normally — but standing where
 * it was rather than launched, which is what lets a scenario aim it itself.
 */
export function releaseBalls(h: Harness): void {
  const snapshot = h.snapshot();
  const indexed = snapshot.balls !== undefined;
  // A ball is addressed by the `index` it reports, not by where it sits in the
  // array: a scenario that cleared the field and spawned ball 1 alone reports one
  // entry, and its index is 1.
  for (const ball of allBalls(snapshot)) {
    if (indexed) {
      h.multi.setBallHeld(ball.index as number, false);
      h.multi.setBallHoldTimer(ball.index as number, 0);
    } else {
      h.debug.setBallHeld(false);
      h.debug.setBallHoldTimer(0);
    }
  }
}

/* ---- The paddles --------------------------------------------------------- */

/** Off-lane parking height for a paddle a scenario must keep out of the way. */
export const PARKED_CY = 150;

/**
 * Take ONE paddle from the player and put it at `cy`, travelling at `vy`.
 *
 * `setPaddleDriven` is the only operation that changes whose paddle a paddle is,
 * and it changes one side (specs/instrumentation.md), so the other side is left
 * exactly as it was — under the player in a Versus match, under the AI in a Solo
 * one. That is the whole reason no arrangement here seizes both paddles by
 * default: a check about the real controls is a check about a paddle nothing took
 * away.
 *
 * A driven paddle travels at its `drivenVy` and holds it across frames, so a
 * paddle posed with a `vy` is still swinging at the moment a ball reaches it.
 */
export function drivePaddleAt(
  h: Harness,
  side: Side,
  cy: number,
  vy = 0,
): void {
  h.debug.setPaddleCy(side, cy);
  h.debug.setPaddleVy(side, vy);
  h.debug.setPaddleDriven(side, true);
}

/**
 * Put a paddle at `cy` and leave it whoever's it was.
 *
 * `setPaddleCy` sets the centre and nothing else, so a paddle the AI is playing
 * stays the AI's and goes on moving from the AI's own rule — which is what a check
 * about the opponent needs, and what the old surface's seize-everything pose made
 * impossible.
 */
export function placePaddle(h: Harness, side: Side, cy: number): void {
  h.debug.setPaddleCy(side, cy);
}

/** Drive one paddle out of the way and hold it still. */
export function parkPaddle(
  h: Harness,
  side: Side,
  cy: number = PARKED_CY,
): void {
  drivePaddleAt(h, side, cy, 0);
}

/**
 * Drive both paddles out of the mid-field lane and hold them still, so a shot
 * down it is unobstructed.
 *
 * The paddles are the one thing on the field a check cannot remove, so this is
 * how they are kept out of a scenario.
 */
export function parkPaddles(h: Harness, cy: number = PARKED_CY): void {
  parkPaddle(h, "left", cy);
  parkPaddle(h, "right", cy);
}

/** Drive both paddles to the field centre and hold them still. */
export function centerPaddles(h: Harness): void {
  drivePaddleAt(h, "left", FIELD_CY, 0);
  drivePaddleAt(h, "right", FIELD_CY, 0);
}

/** Hand both paddles back to the player and the AI. */
export function releasePaddles(h: Harness): void {
  h.debug.setPaddleDriven("left", false);
  h.debug.setPaddleDriven("right", false);
}

/* ---- The obstacles ------------------------------------------------------- */

/**
 * Stop the obstacle clock and put it at zero, where `gyre`'s obstacles stand
 * upright at their base centres.
 *
 * Clock zero is the pose at which gyre's oriented collision rule reduces to the
 * upright case (specs/playfield.md), so a shared check about an obstacle face
 * means the same thing in every variant. The freeze is its own faculty now —
 * `setObstacleClockRunning(false)` — rather than a side effect of holding a
 * paddle, so a check can stop the clock without taking anything else away.
 *
 * Both operations are `gyre`'s alone, so this is a no-op under the other two
 * variants, whose obstacles never move. It poses the SUBJECT of the check rather
 * than quieting a bystander: an obstacle a check is not about is removed by
 * {@link poseWorld}, not held still.
 */
export function pinObstaclesUpright(h: Harness): void {
  h.debug.setObstacleClockRunning?.(false);
  h.debug.setObstacleClock?.(0);
}

/* ---- Reaching a screen --------------------------------------------------- */

/** Return the game to the title screen, exactly as `reset` leaves it. */
export function openTitle(h: Harness): void {
  h.debug.reset();
}

/** A clean title, then the how-to screen with its single item highlighted. */
export function openHowTo(h: Harness): void {
  h.debug.reset();
  h.debug.setMenuIndex(0);
  h.debug.setScreen("howto");
}

/**
 * Open a match on its pre-serve countdown, and take NOTHING from the player.
 *
 * This is the sequence `specs/ui.md`'s "Starting a match" fixes, assembled from
 * atomic poses: `reset` puts every declared field at its title value — both scores
 * `0`, `winner` null, `receiver` left, `menuIndex` `0`, `resumeScreen` `playing`,
 * both paddles centred and NOT driven, the ball held at its home with a full hold
 * timer and an empty trail, both obstacles present — and the mode and the screen
 * are all that is left to say.
 *
 * Nothing here drives a paddle, gates a faculty, or empties the field. A check
 * that wants a match under real player control opens it with this and stops; one
 * that wants a paddle posed adds {@link drivePaddleAt} for the side it is about;
 * one that wants an isolated field adds {@link poseWorld}. That is the failure the
 * retired `startMatch` caused and the reason it is gone.
 *
 * A check that needs the menus themselves exercised enters with
 * {@link startWithKeys} instead — a build with a broken menu and a working
 * countdown must fail the navigation checks and pass the countdown ones.
 */
export function openCountdown(h: Harness, mode: Mode = "versus"): void {
  h.debug.reset();
  h.debug.setMode(mode);
  h.debug.setScreen("countdown");
}

/**
 * Reach live play WITHOUT a serve: a fresh match, every ball out of its hold, and
 * the screen posed on `playing`.
 *
 * The ground almost every posed scenario stands on. The ball is left at its home
 * with no velocity, so what happens next is entirely the scenario's own doing, and
 * no countdown runs first to overwrite a pose. A check about the serve itself
 * wants the game's own rule to fire and uses {@link startPlaying}.
 */
export function enterPlaying(h: Harness, mode: Mode = "versus"): void {
  openCountdown(h, mode);
  releaseBalls(h);
  h.debug.setScreen("playing");
}

/**
 * End the pre-serve hold, so the game serves on the next advanced frame.
 *
 * `setBallHoldTimer(0)` sets one field; the SERVE is the build's own, by the rule
 * specs/balls.md states — the ball leaves at `SERVE_SPEED` and `SERVE_ANGLE`
 * toward `receiver`, the trail is cleared, and the screen becomes `playing`. So
 * this stages the serve and {@link driveServe} runs it.
 */
export function stageServe(h: Harness): void {
  const snapshot = h.snapshot();
  const indexed = snapshot.balls !== undefined;
  // Addressed by the reported `index`, for the reason `releaseBalls` gives.
  for (const ball of allBalls(snapshot)) {
    if (indexed) h.multi.setBallHoldTimer(ball.index as number, 0);
    else h.debug.setBallHoldTimer(0);
  }
}

/** Run the frames the build takes to serve a staged ball and reach live play. */
export function driveServe(
  h: Harness,
  options: UntilOptions = {},
): Promise<UntilResult> {
  return h.until((s) => s.screen === "playing", {
    maxFrames: options.maxFrames ?? 60,
    poll: options.poll ?? 1,
  });
}

/**
 * Open a match, stage its serve, and run it up to live play.
 *
 * The three sequences above, one after another, for a check that wants the real
 * serve to have happened. A check that only wants to BE in live play uses
 * {@link enterPlaying}, which costs no frames and leaves the ball where a scenario
 * can put it.
 */
export async function startPlaying(
  h: Harness,
  mode: Mode = "versus",
): Promise<UntilResult> {
  openCountdown(h, mode);
  stageServe(h);
  return driveServe(h);
}

/** Start a match from the title the way a player does: menu keys only. */
export async function startWithKeys(h: Harness, mode: Mode): Promise<void> {
  h.debug.reset();
  // SOLO is the first entry; VERSUS is one down.
  if (mode === "versus") await h.tap("ArrowDown");
  await h.tap("Enter");
}

/**
 * Open the pause menu over whatever is arranged, resuming to `from`.
 *
 * The three fields `specs/ui.md` says a `pause` edge sets, and nothing else: the
 * field behind the menu is left exactly as the check posed it, which is what a
 * check on "the field is visible and frozen behind the pause menu" reads. A check
 * that wants a paused match from scratch calls {@link openCountdown} or
 * {@link enterPlaying} first.
 */
export function openPause(h: Harness, from: ResumeScreen = "playing"): void {
  h.debug.setResumeScreen(from);
  h.debug.setMenuIndex(0);
  h.debug.setScreen("paused");
}

/** Which side won, and at what score, when a check poses the match-over screen. */
export interface MatchOverOptions {
  /** The winning side. Defaults to the left. */
  winner?: Side;
  /** The final score. Defaults to a clean `WIN_SCORE` win for `winner`. */
  score?: { p1: number; p2: number };
}

/**
 * Pose the match-over screen: the winner, the final score, the first item
 * highlighted, and the screen.
 *
 * Four atomic poses. A check about how the match-over screen is REACHED poses a
 * match point instead ({@link arrangeMatchPoint}) and lets the real win rule
 * resolve it, because reaching it is an outcome rather than a precondition.
 */
export function openMatchOver(
  h: Harness,
  options: MatchOverOptions = {},
): void {
  const winner = options.winner ?? "left";
  const score =
    options.score ??
    (winner === "left" ? { p1: WIN_SCORE, p2: 0 } : { p1: 0, p2: WIN_SCORE });
  h.debug.setScore(score.p1, score.p2);
  h.debug.setWinner(winner);
  h.debug.setMenuIndex(0);
  h.debug.setScreen("matchover");
}

/**
 * Set the score one point short of a win for `side`, with the lead already past
 * `WIN_LEAD`.
 *
 * A precondition, not an outcome: the next point a real rally scores is what
 * satisfies the win rule and sends the build to the match-over screen, so what the
 * check reads is the build's own rule firing.
 */
export function arrangeMatchPoint(h: Harness, side: Side): void {
  if (side === "left") h.debug.setScore(WIN_SCORE - 1, 0);
  else h.debug.setScore(0, WIN_SCORE - 1);
}

/* ---- Goals --------------------------------------------------------------- */

/** The lane down the middle of the field, level with the ball's home point. */
export const CLEAR_LANE_Y = FIELD_CY;

/**
 * Aim the ball at one goal edge down the mid-field lane, on a field holding
 * nothing but that ball. `edge` is the edge the ball exits: "right" scores for
 * player one, "left" for player two.
 */
export function arrangeGoal(h: Harness, edge: Side): void {
  poseWorld(h);
  parkPaddles(h);
  placeBall(h, FIELD_CX, CLEAR_LANE_Y);
  aimBall(h, edge === "right" ? 600 : -600, 0);
  spinBall(h, 0);
}

/**
 * Run the real physics until the point resolves — a scored point returns to the
 * countdown, a match point to the match-over screen — and report that instant.
 */
export function driveGoal(
  h: Harness,
  options: UntilOptions = {},
): Promise<UntilResult> {
  return h.until((s) => s.screen !== "playing", {
    maxFrames: options.maxFrames ?? 360,
    poll: options.poll ?? 6,
  });
}

/* ---- Paddle contact ------------------------------------------------------ */

/** Where a ball is posed to sit just off a paddle's front face. */
export function nearBallX(side: Side): number {
  return side === "left" ? P1_X1 + BALL_R + 10 : P2_X0 - BALL_R - 10;
}

/**
 * How far in front of a paddle contact the ball is posed, in frames of approach.
 *
 * The contact itself is the same one a zero-lead pose makes immediately; the
 * run-up buys the scenario a real approach, and — because a posed `drivenVy`
 * persists — it is also what lets a SWINGING paddle be moving at the moment it
 * strikes, having travelled the same distance the ball did.
 */
export const LEAD_TICKS = 60; // 0.5 s at 120 Hz

export interface PaddleHitOptions {
  /** Where the struck paddle is when the ball arrives. */
  cy?: number;
  /** The velocity it holds through the run-up and the contact, in px/s. */
  vy?: number;
  /** The height the ball arrives at. */
  ballY?: number;
  /** How fast the ball approaches, in px/s. */
  approachSpeed?: number;
  /** An explicit start x, for a contact whose paddle must not be led upstream. */
  startX?: number;
  /** Frames of approach posed in front of the contact. */
  leadTicks?: number;
}

/**
 * Pose a contact on `side`, on a field holding that ball alone: the struck paddle
 * driven to `cy` at `vy`, the other parked, and the ball aimed straight at the
 * struck paddle's front face at `ballY`.
 *
 * Both obstacles are removed, because a paddle bounce is not about them and a ball
 * that clipped one on the way in would report the obstacle rule's defect against
 * the paddle rule's point.
 *
 * With a lead, the paddle starts the run-up's worth of travel UPSTREAM so it
 * arrives at `cy` as the ball does — which is what lets a swinging paddle really
 * be moving at contact rather than pinned against a bound.
 */
export function arrangePaddleHit(
  h: Harness,
  side: Side,
  options: PaddleHitOptions = {},
): void {
  const {
    cy = FIELD_CY,
    vy = 0,
    ballY = FIELD_CY,
    approachSpeed = 400,
    startX,
    leadTicks = 0,
  } = options;

  const other: Side = side === "left" ? "right" : "left";
  const lead = seconds(leadTicks);
  poseWorld(h);
  drivePaddleAt(h, side, cy - vy * lead, vy);
  parkPaddle(h, other);

  const near = nearBallX(side);
  const runUp = approachSpeed * lead;
  const x = startX ?? (side === "left" ? near + runUp : near - runUp);
  placeBall(h, x, ballY);
  aimBall(h, side === "left" ? -approachSpeed : approachSpeed, 0);
  spinBall(h, 0);
}

export interface PaddleHitResult {
  hit: boolean;
  ball: BallView;
  /** The struck paddle, at the instant of the rebound. */
  paddle: { cy: number; vy: number };
  snapshot: CaromSnapshot;
}

/**
 * Run the real simulation until the ball comes off `side`'s front face, and
 * report the ball the instant it rebounds — before spin decays or curves the
 * flight. Sampled every frame, because the instant is what is read.
 */
export async function drivePaddleHit(
  h: Harness,
  side: Side,
  options: { maxFrames?: number; leadTicks?: number } = {},
): Promise<PaddleHitResult> {
  const maxFrames = (options.maxFrames ?? 72) + (options.leadTicks ?? 0);
  const rebounded =
    side === "left"
      ? (s: CaromSnapshot): boolean => ball0(s).vx > 0
      : (s: CaromSnapshot): boolean => ball0(s).vx < 0;
  const swept = await h.until(rebounded, { maxFrames, poll: 1 });
  return {
    hit: swept.hit,
    ball: ball0(swept.snapshot),
    paddle: swept.snapshot.paddles[side],
    snapshot: swept.snapshot,
  };
}

/* ---- Rally speed --------------------------------------------------------- */

/**
 * The speed the rally is launched at, in units per second.
 *
 * Below `SERVE_SPEED` so the climb to `SPEED_CAP` takes a hit or two more than a
 * served ball would, and a round number so the number of hits a check must drive
 * to reach the ceiling follows from it and `SPEED_MULT` alone.
 */
export const RALLY_LAUNCH_SPEED = 500;

/**
 * The paddle hits it takes `SPEED_MULT` to carry {@link RALLY_LAUNCH_SPEED} to
 * `SPEED_CAP`.
 *
 * The two rally checks state their lengths in terms of it rather than picking a
 * number: one hit short of it is the last one the multiplier decides on its own,
 * and one past it is the first spent sitting on the ceiling.
 */
export const RALLY_HITS_TO_CAP = Math.ceil(
  Math.log(SPEED_CAP / RALLY_LAUNCH_SPEED) / Math.log(SPEED_MULT),
);

/**
 * Frames between samples while a rally leg is swept.
 *
 * A leg is the ball crossing between the two paddle faces, and the shortest one
 * it can be is that distance covered at `SPEED_CAP`; sampling eight times inside
 * even that leg catches every reversal. A per-frame sweep would cost eight times
 * as much to read frames between which nothing this collects can change: a ball's
 * speed only ever changes at a paddle hit, and walls and obstacles preserve it
 * exactly, so a sample taken a few frames after a hit reports the same figure the
 * frame of the hit would.
 */
const RALLY_POLL_FRAMES = Math.max(
  1,
  Math.floor((((P2_X0 - P1_X1) / SPEED_CAP) * TICK_HZ) / 8),
);

/**
 * A live match on a field holding one ball, two still centred paddles, and the
 * ball launched level down the middle.
 *
 * The obstacles are removed: the rally is about the speed the ball gains hit after
 * hit, and an obstacle in the way would end the rally early on a build whose
 * obstacles are perfectly correct.
 */
export function arrangeRally(h: Harness): void {
  enterPlaying(h);
  poseWorld(h);
  centerPaddles(h);
  placeBall(h, FIELD_CX, FIELD_CY);
  aimBall(h, -RALLY_LAUNCH_SPEED, 0);
  spinBall(h, 0);
}

/**
 * Play a real rally of `hits` paddle hits and report the ball's speed after each
 * one. Speed is constant between hits, so each leg sweeps coarsely until the
 * horizontal direction reverses. Stops early if play ever leaves the field.
 *
 * `hits` has no default: a rally is the most expensive scenario in this suite,
 * every leg of it is real physics rendered frame by frame, and how many legs a
 * check needs follows from what that check decides. Each caller states its own.
 */
export async function driveRallySpeeds(
  h: Harness,
  hits: number,
): Promise<number[]> {
  const speeds: number[] = [];
  let previousSign = -1; // the ball is launched toward the left paddle

  for (let hit = 0; hit < hits; hit += 1) {
    const sign = Math.sign(ball0(h.snapshot()).vx);
    if (sign !== 0) previousSign = sign;
    const want = -previousSign;

    let leftPlay = false;
    const leg = await h.until(
      (s) => {
        if (s.screen !== "playing") {
          leftPlay = true;
          return true;
        }
        const ball = ball0(s);
        return Math.sign(ball.vx) === want && ball.vx !== 0;
      },
      { maxFrames: 600, poll: RALLY_POLL_FRAMES },
    );
    if (leftPlay || !leg.hit) break;
    speeds.push(ball0(leg.snapshot).speed);
    previousSign = want;
  }
  return speeds;
}

/* ---- Held movement ------------------------------------------------------- */

export interface MoveResult {
  start: number;
  end: number;
  /** The moved paddle's Δcy: negative is upward. */
  delta: number;
  /** Each paddle's Δcy, so a check can also confirm the other stayed still. */
  otherDelta: { left: number; right: number };
}

/**
 * Hold a movement key for `ticks` frames and report how far each paddle moved.
 * Nothing here drives a paddle, so the game stays under normal player control and
 * the paddles respond exactly as they do for a player.
 */
export async function holdMove(
  h: Harness,
  side: Side,
  code: string,
  options: { ticks?: number } = {},
): Promise<MoveResult> {
  const ticks = options.ticks ?? 36; // 0.3 s
  const before = h.snapshot().paddles;
  h.hold(code);
  await h.advance(ticks);
  const after = h.snapshot().paddles;
  h.release(code);

  const moved = (which: Side): number => after[which].cy - before[which].cy;
  return {
    start: before[side].cy,
    end: after[side].cy,
    delta: moved(side),
    otherDelta: { left: moved("left"), right: moved("right") },
  };
}

/* ---- The Solo AI --------------------------------------------------------- */
//
// The AI's two faculties are gated separately (specs/instrumentation.md), which
// is what lets a check hold its body still and watch what it SENSES, or give it
// both and watch it play. Every arrangement below leaves the right paddle with the
// AI — `setPaddleCy` places a paddle without taking it from anyone — because a
// pose that seized it would be posing the very thing the check is about.

/**
 * A live Solo match on a field holding one ball: the human paddle parked, the ball
 * posed by `ball`, the AI paddle placed at `paddleCy` and still the AI's, and both
 * of the AI's faculties on. Running time forward from here pits the real opponent
 * against the posed shot.
 */
export function arrangeAiScenario(
  h: Harness,
  scenario: {
    paddleCy: number;
    ball: { x: number; y: number; vx: number; vy?: number };
  },
): void {
  enterPlaying(h, "solo");
  poseWorld(h);
  parkPaddle(h, "left");
  placePaddle(h, "right", scenario.paddleCy);
  h.debug.setAiTracking(true);
  h.debug.setAiMovement(true);
  placeBall(h, scenario.ball.x, scenario.ball.y);
  aimBall(h, scenario.ball.vx, scenario.ball.vy ?? 0);
  spinBall(h, 0);
}

export type AiOutcome = "blocked" | "scored" | "timeout";

/**
 * Run the posed Solo shot to its resolution.
 *
 * "blocked" — the AI reached the ball and sent it back. "scored" — the shot got
 * past it and player one's score went up. The ball must be SEEN travelling toward
 * the AI before a leftward velocity can count as a block, so the posed approach
 * itself never reads as one.
 */
export async function driveAiScenario(
  h: Harness,
  options: UntilOptions = {},
): Promise<{ result: AiOutcome; snapshot: CaromSnapshot }> {
  const start = h.snapshot().score.p1;
  let sawIncoming = false;
  let result: AiOutcome = "timeout";

  const swept = await h.until(
    (s) => {
      const ball = ball0(s);
      if (ball.vx > 0) sawIncoming = true;
      if (s.score.p1 > start) {
        result = "scored";
        return true;
      }
      if (sawIncoming && ball.vx < 0 && ball.x < FIELD_W) {
        result = "blocked";
        return true;
      }
      return false;
    },
    { maxFrames: options.maxFrames ?? 480, poll: options.poll ?? 2 },
  );
  return { result, snapshot: swept.snapshot };
}

/**
 * A live Solo match with the AI paddle far from a ball moving toward it, so the
 * real opponent chases at its own speed for as long as a check watches.
 */
export function arrangeAiChase(
  h: Harness,
  options: { paddleCy?: number; ballY?: number } = {},
): void {
  arrangeAiScenario(h, {
    paddleCy: options.paddleCy ?? 120,
    ball: { x: FIELD_CX, y: options.ballY ?? 650, vx: 200 },
  });
}

/** How fast the AI paddle travels while it is chasing, in px/s. */
export async function driveAiChaseSpeed(
  h: Harness,
  options: { ticks?: number } = {},
): Promise<{ speed: number; delta: number }> {
  const ticks = options.ticks ?? 12;
  const before = h.snapshot().paddles.right.cy;
  await h.advance(ticks);
  const after = h.snapshot().paddles.right.cy;
  return {
    speed: speedOverTicks(after - before, ticks),
    delta: after - before,
  };
}

/**
 * A live Solo match with a ball aimed to arrive at the AI's front face while the
 * AI is still sweeping down through the lane, so it strikes while moving.
 */
export function arrangeAiMovingHit(h: Harness): void {
  arrangeAiScenario(h, {
    paddleCy: 180, // above the lane
    ball: { x: 1072, y: FIELD_CY, vx: 500 },
  });
}

/**
 * A live Solo match with the ball travelling AWAY from the AI paddle, posed far
 * from anything it could strike, and the AI paddle posed well off its home
 * height, so what the real opponent does from here is governed by the homing
 * rule alone (specs/modes/single-player.md).
 */
export function arrangeAiHome(h: Harness, options: { paddleCy: number }): void {
  arrangeAiScenario(h, {
    paddleCy: options.paddleCy,
    ball: { x: 1100, y: 200, vx: -300 },
  });
}

/* ---- Obstacle bank shots -------------------------------------------------- */

/** A straight shot at one obstacle, on a field holding that obstacle alone. */
export interface ObstacleShot {
  /** Which obstacle, in the order of `OBSTACLE_CENTERS`. */
  obstacle: number;
  /** The x of the face the shot is aimed at. */
  faceX: number;
  /** The height the shot travels at. */
  y: number;
  /** The side the ball approaches from. */
  from: Side;
  /** How fast it approaches, in px/s. Defaults to 600. */
  speed?: number;
}

/**
 * Line the ball up 180 px short of `faceX`, level with the obstacle at `y`,
 * travelling straight at that face, on a field holding one ball and the one
 * obstacle the shot is at.
 */
export function arrangeObstacleBounce(h: Harness, shot: ObstacleShot): void {
  const speed = shot.speed ?? 600;
  poseWorld(h, { obstacles: [shot.obstacle] });
  parkPaddles(h);
  pinObstaclesUpright(h);
  placeBall(
    h,
    shot.from === "left" ? shot.faceX - 180 : shot.faceX + 180,
    shot.y,
  );
  aimBall(h, shot.from === "left" ? speed : -speed, 0);
  spinBall(h, 0);
}

/** Run the real collision until the ball reflects off the struck face. */
export function driveObstacleBounce(
  h: Harness,
  from: Side,
  options: UntilOptions = {},
): Promise<UntilResult> {
  const reversed =
    from === "left"
      ? (s: CaromSnapshot): boolean => ball0(s).vx < 0
      : (s: CaromSnapshot): boolean => ball0(s).vx > 0;
  return h.until(reversed, {
    maxFrames: options.maxFrames ?? 240,
    poll: options.poll ?? 1,
  });
}

/* ---- A ball in open flight ------------------------------------------------ */

/**
 * A live match on an empty field but for one ball, posed in mid-flight so a short
 * flight is a straight line. Spin is zeroed so the path is predictable, and both
 * obstacles are gone rather than dodged.
 */
export function arrangeLiveBall(
  h: Harness,
  ball: { x: number; y: number; vx: number; vy?: number },
  mode: Mode = "versus",
): void {
  enterPlaying(h, mode);
  poseWorld(h);
  parkPaddles(h);
  placeBall(h, ball.x, ball.y);
  aimBall(h, ball.vx, ball.vy ?? 0);
  spinBall(h, 0);
}

/* ========================================================================== */
/* Rendering, input, audio, pause and UI                                      */
/* ========================================================================== */
//
// The second half of the suite — the checks that read what was DRAWN, what was
// PLAYED, and what the keyboard, the mouse and a finger did — needs four things
// the scenario helpers above do not provide: a cue record stamped with the frame
// each cue fired on, a colour sampler over the rendered canvas, a way to ask what
// a single frame's render actually asked the context for, and a way to reach a
// menu item where the BUILD drew it. The palette and the menu layout are the
// build's own (specs/overview.md, specs/ui.md), so nothing here knows a colour or
// a coordinate: the samplers compare one point painted against the same point
// with the field bare under it, and the menu helpers take their geometry from the
// build's own `menuItemRect`. They are gathered here rather than folded in above
// so the two halves of this file stay separable.

import {
  OBSTACLE_CENTERS,
  OBSTACLES,
  P1_X0,
  P2_X1,
  PADDLE_MIN_CY,
  TRAIL_TIME,
  type Rect,
} from "./constants";

/* ---- Controls tolerances -------------------------------------------------- */

/**
 * A clearly non-trivial paddle displacement, in logical units.
 *
 * The controls checks are about which paddle a key moves and which way, not how
 * fast: the speed is the `paddle-movement` category's point, and stating it in
 * both places would fail one build twice for one fault. At PADDLE_SPEED the
 * 36-frame hold `holdMove` defaults to travels 216 units, so this bound is
 * crossed several times over by a build moving the right paddle the right way
 * and never by one that did not move it.
 */
export const MOVE_MIN = 40;

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
 * collision — which is what tells a build that plays a cue on the right event
 * apart from one that plays it on every frame, or a frame late.
 */
export function watchCues(h: Harness): TimedCue[] {
  const played: TimedCue[] = [];
  h.engine.events.on("cue:played", ({ cue, t, gain }) => {
    played.push({ cue, t, gain, frame: h.engine.frame().count });
  });
  return played;
}

/* ---- Colour --------------------------------------------------------------- */

/** A sampled colour, each channel 0–255. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * How far two readings of the SAME unchanged ground may sit apart, in RGB
 * distance, and still be the same ground: rasterization rounding and nothing
 * else.
 *
 * The specification fixes no palette (specs/overview.md), so what a colour check
 * reads is PRESENCE: the same point sampled with a body standing on it and again
 * with the field bare under it. This floor is what separates "the build drew
 * something here" from two reads of one pixel, and nothing beyond presence — no
 * palette, no contrast, no separation between two bodies — is asserted anywhere.
 */
export const READ_NOISE = 8;

/**
 * The on-field points the visibility checks sample, in logical units, valid on
 * the scene `arrangeColorScene` poses.
 *
 * Each sits well inside the shape it names — a paddle is 16 wide and an obstacle
 * 20, so a point on the centre line is 8 px from the nearest edge and the 4 px
 * cluster below stays inside the solid body. That margin is the point: a curved
 * or rounded edge is anti-aliased and blends toward whatever is behind it, so a
 * sample on the rim would read as a mixture rather than as the fill.
 */
export const COLOR_POINTS = {
  leftPaddle: { x: (P1_X0 + P1_X1) / 2, y: FIELD_CY },
  rightPaddle: { x: (P2_X0 + P2_X1) / 2, y: FIELD_CY },
  obstacle: OBSTACLE_CENTERS[0],
  /** A clean mid-field spot, clear of the paddles, both obstacles, and the net. */
  ball: { x: 300, y: FIELD_CY },
} as const;

/**
 * Where `arrangeBareScene` sends the ball instead: down near the bottom of the
 * field, clear of every point {@link COLOR_POINTS} names.
 */
export const BARE_BALL_AT = { x: FIELD_CX, y: 650 } as const;

/**
 * The rendered colour at a logical point, averaged over a small cluster.
 *
 * The centre pixel plus four neighbours 4 px out, all of which stay inside the
 * solid body of every shape sampled, so one stray anti-aliased or glow pixel
 * cannot swing the reading.
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

/** Euclidean distance between two colours, 0 to about 441. */
export function colorDistance(a: Rgb, b: Rgb): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

/** Every point in `COLOR_POINTS`, sampled as the canvas stands. */
export function sampleScene(
  h: Harness,
): Record<keyof typeof COLOR_POINTS, Rgb> {
  return {
    leftPaddle: sampleColor(
      h,
      COLOR_POINTS.leftPaddle.x,
      COLOR_POINTS.leftPaddle.y,
    ),
    rightPaddle: sampleColor(
      h,
      COLOR_POINTS.rightPaddle.x,
      COLOR_POINTS.rightPaddle.y,
    ),
    obstacle: sampleColor(h, COLOR_POINTS.obstacle.x, COLOR_POINTS.obstacle.y),
    ball: sampleColor(h, COLOR_POINTS.ball.x, COLOR_POINTS.ball.y),
  };
}

/**
 * Pose a clean, static colour scene and paint it: a live match with both paddles
 * centred, both obstacles standing upright at their base centres, and the ball
 * parked at the mid-field sample point, so each sample point renders an
 * unobstructed, solid body.
 *
 * This is the one shared scenario that keeps the obstacles, because one of the
 * points it samples IS an obstacle.
 *
 * The settle is longer than the trail's own life on purpose. Posing the ball
 * teleports it, and the samples it left along the way would otherwise still be
 * drawn as a streak across the field; a still ball for `TRAIL_TIME` retires
 * every one of them, so what is sampled is the ball rather than its wake.
 */
export async function arrangeColorScene(h: Harness): Promise<void> {
  enterPlaying(h, "versus");
  poseWorld(h, { obstacles: [0, 1] });
  pinObstaclesUpright(h);
  centerPaddles(h);
  placeBall(h, COLOR_POINTS.ball.x, COLOR_POINTS.ball.y);
  aimBall(h, 0, 0);
  spinBall(h, 0);
  await h.advance(Math.ceil(TRAIL_TIME * TICK_HZ) + 4);
}

/**
 * Re-pose the same live match with the field bare under every point
 * {@link COLOR_POINTS} names, so those points can be read a second time with
 * nothing standing on them.
 *
 * Both obstacles come off the field outright and the ball goes to
 * {@link BARE_BALL_AT}, with the same settle {@link arrangeColorScene} takes so
 * its wake is retired again. One ball is left on the field rather than none,
 * because an empty field is a state the match rules are free to serve into. Both
 * paddles go to `PADDLE_MIN_CY`, the top of the travel specs/playfield.md gives
 * them: a paddle centred there spans the field's top 110 units, which clears the
 * mid-field row {@link COLOR_POINTS} samples it on outright.
 *
 * Called on a match {@link arrangeColorScene} already opened.
 */
export async function arrangeBareScene(h: Harness): Promise<void> {
  poseWorld(h, { obstacles: [] });
  parkPaddles(h, PADDLE_MIN_CY);
  placeBall(h, BARE_BALL_AT.x, BARE_BALL_AT.y);
  aimBall(h, 0, 0);
  spinBall(h, 0);
  await h.advance(Math.ceil(TRAIL_TIME * TICK_HZ) + 4);
}

/* ---- The menus, where the build drew them --------------------------------- */
//
// specs/ui.md gives every menu screen a mouse and a finger as well as the
// keyboard, and deliberately leaves the LAYOUT to the build: what it fixes is
// that the build reports each item's hit region through `menuItemRect`, and that
// a pointer over that region selects the item. So every helper below asks the
// build where it put the item and then drives the real pointer there. Nothing
// here knows a menu coordinate, and a build that lays its menus out any way it
// likes passes.

/**
 * The hit region of item `index` on the menu the current screen shows.
 *
 * `menuItemRect` returns `null` on `countdown` and `playing`, which show no menu,
 * and for an index the current menu has no item at. A check that asked for an
 * item it expects to exist gets a failure naming the reading rather than a
 * `TypeError` on the next line.
 */
export function menuRect(h: Harness, index: number): MenuRect {
  const rect = h.debug.menuItemRect(index);
  assertTruthy(
    rect,
    `menuItemRect(${index}) must report the hit region of item ${index} on the ` +
      `menu the current screen shows; see specs/instrumentation.md`,
  );
  return rect as MenuRect;
}

/** The centre of item `index`'s hit region, in logical units. */
export function menuItemCenter(h: Harness, index: number): Point {
  const rect = menuRect(h, index);
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/**
 * Move the pointer onto item `index` and run the frame that delivers it, then
 * report where it went.
 *
 * The hover specs/ui.md selects on: no button is pressed, so what a check reads
 * afterwards is `menuIndex` alone.
 */
export async function pointAtItem(
  h: Harness,
  index: number,
  options: PointerOptions = {},
): Promise<Point> {
  const at = menuItemCenter(h, index);
  await h.movePointer(at.x, at.y, options);
  return at;
}

/**
 * Move the pointer onto item `index` and run NO frame, reporting where it went.
 *
 * The one pointer drive that delivers no frame of its own, for the one check
 * that needs a pointer move and a key edge to land in the SAME input read:
 * specs/ui.md reads the pointer once per frame, in the same read as the keyboard
 * actions, and applies it after that frame's keyboard edges. Every other drive
 * runs its own frame, so a caller adds this move to the frame it drives itself.
 */
export async function aimPointerAtItem(
  h: Harness,
  index: number,
  options: PointerOptions = {},
): Promise<Point> {
  const at = menuItemCenter(h, index);
  await h.movePointer(at.x, at.y, { ...options, frames: 0 });
  return at;
}

/**
 * Press and release inside item `index`'s region, both edges on one frame, and
 * report where it happened.
 *
 * A press and its release inside ONE region is what confirms (specs/ui.md), and a
 * frame may carry both, so this is the ordinary click. Pass `device: "touch"` for
 * the finger's form of the same gesture, whose landing also selects.
 */
export async function clickItem(
  h: Harness,
  index: number,
  options: PointerOptions = {},
): Promise<Point> {
  const at = menuItemCenter(h, index);
  await h.tapPointer(at.x, at.y, options);
  return at;
}

/** {@link clickItem} with a finger: a touch contact landing and lifting. */
export function touchItem(
  h: Harness,
  index: number,
  options: PointerOptions = {},
): Promise<Point> {
  return clickItem(h, index, { ...options, device: "touch" });
}

/**
 * Press inside item `from`'s region and release inside item `to`'s, travelling
 * between them while held.
 *
 * The slide-off affordance: a press begun on one item and released on another
 * confirms nothing (specs/ui.md). A check reads that nothing was confirmed and
 * that the selection followed the pointer.
 */
export async function slideOffItem(
  h: Harness,
  from: number,
  to: number,
  options: DragOptions = {},
): Promise<{ from: Point; to: Point }> {
  const start = menuItemCenter(h, from);
  const end = menuItemCenter(h, to);
  await h.dragPointer(start, end, options);
  return { from: start, to: end };
}

/* ---- Reading one frame's render ------------------------------------------- */

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
 * trail asked for strictly more of these than the same frame with the ball at
 * rest, whatever shape the build chose to draw it as.
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
 * Every logical point a frame's drawing calls named.
 *
 * A trail is a sequence of draws rather than one shape, so where a render put
 * its geometry is the direct reading of it: the coordinates behind the ball are
 * the trail, and the ones at the ball are the ball. The leading pair of
 * arguments is the position for every method listed, except the curve calls,
 * whose control points come first and whose endpoint is the last pair.
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
      method === "lineTo" ||
      method === "drawImage"
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

/* ---- Where a frame put its text ------------------------------------------- */

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
 * A build may anchor its text through any `translate`/`scale` it likes and
 * align it any way it likes, so the anchor is mapped through the transform the
 * context held at the call and the run is extended about it by its measured
 * width and `textAlign`. Which way a `start`/`end` alignment reads is the
 * page's direction; this game draws no right-to-left text, so they are left and
 * right.
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

/* ---- A shot at one obstacle face ------------------------------------------ */

/** Which face of an axis-aligned obstacle a shot is aimed at. */
export type Face = "left" | "right" | "top" | "bottom";

/**
 * Pose a straight shot at the midpoint of `face` of obstacle `obstacle`, starting
 * `runUp` units short of it and travelling at `speed`, on a field holding one ball
 * and that obstacle alone, with both paddles parked out of the way.
 *
 * The obstacle's rectangle is `OBSTACLES[obstacle]`, the upright pose at the base
 * centre — which under `gyre` is the pose the obstacle clock is pinned to here. A
 * check about an oriented pose passes the rectangle it posed as `rect`.
 */
export function arrangeFaceShot(
  h: Harness,
  obstacle: number,
  face: Face,
  options: { runUp?: number; speed?: number; rect?: Rect } = {},
): { vx: number; vy: number } {
  const rect = options.rect ?? OBSTACLES[obstacle];
  const runUp = options.runUp ?? 180;
  const speed = options.speed ?? 600;
  const cx = (rect.x0 + rect.x1) / 2;
  const cy = (rect.y0 + rect.y1) / 2;
  const shot =
    face === "left"
      ? { x: rect.x0 - runUp, y: cy, vx: speed, vy: 0 }
      : face === "right"
        ? { x: rect.x1 + runUp, y: cy, vx: -speed, vy: 0 }
        : face === "top"
          ? { x: cx, y: rect.y0 - runUp, vx: 0, vy: speed }
          : { x: cx, y: rect.y1 + runUp, vx: 0, vy: -speed };
  poseWorld(h, { obstacles: [obstacle] });
  parkPaddles(h);
  pinObstaclesUpright(h);
  placeBall(h, shot.x, shot.y);
  aimBall(h, shot.vx, shot.vy);
  spinBall(h, 0);
  return { vx: shot.vx, vy: shot.vy };
}

/** Run the real collision until the component normal to `face` reverses. */
export function driveFaceShot(
  h: Harness,
  face: Face,
  options: UntilOptions = {},
): Promise<UntilResult> {
  const reversed: Record<Face, (s: CaromSnapshot) => boolean> = {
    left: (s) => ball0(s).vx < 0,
    right: (s) => ball0(s).vx > 0,
    top: (s) => ball0(s).vy < 0,
    bottom: (s) => ball0(s).vy > 0,
  };
  return h.until(reversed[face], {
    maxFrames: options.maxFrames ?? 240,
    poll: options.poll ?? 1,
  });
}

/* ---- The trail, read off the canvas ------------------------------------- */

/** An empty lane: below both obstacles, clear of the paddles and the net. */
export const TRAIL_LANE_Y = 650;

/** Where a trail drive poses the ball, and an empty patch of the same lane. */
export const TRAIL_START_X = 300;
export const TRAIL_BARE_X = 1100;

/** Frames of flight before the frame that is read: longer than the trail's life. */
export const TRAIL_FILL_TICKS = 24;

/** How far behind the ball the lane is looked at, in logical units. */
const TRAIL_SCAN = 240;

/** The lane's bare pixels, by logical x, read with nothing drawn on it. */
export type BareLane = Map<number, Rgb>;

/** Where the lane scan starts behind the ball's center, and where it ends. */
const TRAIL_SCAN_FROM = BALL_R + 3;
const LANE_X0 = 20;

/**
 * Pose the ball in the empty lane at `speed`, fly it long enough to fill the
 * trail, then record exactly one frame. The ball is returned as it was when that
 * frame was drawn, along with the lane as it looked with nothing on it.
 *
 * The bare lane is read first, pixel by pixel, with the ball parked out of the
 * scan at `TRAIL_BARE_X` for longer than the trail's life. Whatever the build
 * draws on the field that is NOT the trail — a mode label whose copy and place
 * are its own, a texture, a vignette — is in that reading too, so a lit pixel
 * is one the flight changed, and nothing static can read as trail.
 */
export async function driveTrail(
  h: Harness,
  speed: number,
): Promise<{ x: number; y: number; bare: BareLane }> {
  arrangeLiveBall(h, {
    x: TRAIL_BARE_X,
    y: TRAIL_LANE_Y,
    vx: 0,
    vy: 0,
  });
  await h.advance(TRAIL_FILL_TICKS);
  const bare: BareLane = new Map();
  for (let x = LANE_X0; x < TRAIL_BARE_X - 2 * BALL_R; x += 1) {
    const [r, g, b] = h.pixel(x, TRAIL_LANE_Y);
    bare.set(x, { r, g, b });
  }
  placeBall(h, TRAIL_START_X, TRAIL_LANE_Y);
  aimBall(h, speed, 0);
  spinBall(h, 0);
  await h.advance(TRAIL_FILL_TICKS);
  h.calls.length = 0;
  await h.advance(1);
  const ball = ball0(h.snapshot());
  return { x: ball.x, y: ball.y, bare };
}

/**
 * Whether the lane behind the ball holds anything its bare reading did not.
 *
 * Each pixel is read against the same pixel of the bare lane, so whatever the
 * build's palette and whatever else it draws there, a lit pixel is one the
 * flight changed. How far the paint reaches and how it tapers are the build's
 * styling, which the reviewer judges, so nothing here measures a length.
 */
export function trailPainted(
  h: Harness,
  ball: { x: number; y: number; bare: BareLane },
): boolean {
  const ballX = Math.round(ball.x);
  for (let d = TRAIL_SCAN_FROM; d <= TRAIL_SCAN; d += 1) {
    const x = ballX - d;
    const bare = ball.bare.get(x);
    if (bare === undefined) break;
    const [r, g, b] = h.pixel(x, TRAIL_LANE_Y);
    if (colorDistance({ r, g, b }, bare) > READ_NOISE) return true;
  }
  return false;
}
