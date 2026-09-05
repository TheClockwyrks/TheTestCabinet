// Carom — the shared validator harness. CASE-PROVIDED.
//
// Every check in this suite is an ordinary vitest test that runs IN THE SAME
// PROCESS as the build. It imports the engine and the build's own modules,
// creates an engine over a canvas it owns and a clock it chose, and steps the
// game with `engine.advance`. Nothing drives a browser, nothing polls, and no
// wall-clock time passes: a check asks for a number of frames and gets exactly
// that number, at exactly the deltas its clock supplied.
//
// WHAT A CHECK READS. The game's own state (through the debug surface's
// `snapshot`), the engine's object model — the open world, its game state, its
// tagged actors — the engine's frame counter, the events the engine broadcast,
// and — for the rendering checks — the pixels on the canvas or the calls the 2D
// context received. Nothing here fabricates an outcome: the scenario helpers
// below only ARRANGE the world through the debug surface, and the real ticks
// the build wrote are what run from there.
//
// WHY THE DEBUG SURFACE RATHER THAN RAW ASSIGNMENT. specs/instrumentation.md
// fixes its operations, so they mean the same thing in every build: a screen is
// set by `setScreen`, a paddle is taken from the player by `setPaddleDriven`,
// and `reset` gives everything back. Posing through it is how a scenario is
// reproducible, and it is the seam the case's specification documents.
// `surface.ts` is that specification as types, and it is the only description of
// the surface this harness reads: the build's own module for it is never
// imported.
//
// EVERY OPERATION IS ATOMIC, AND THE SEQUENCES LIVE HERE. Each operation sets
// one field or one fixed pair, places or removes one entity, reads the state, or
// moves the clock; `reset` alone restores everything at once. The surface carries
// nothing that starts a match, reaches a screen, or stages a rally, because a
// sequence of atomic operations is exactly what this file is for: the SCENARIO
// HELPERS below are those sequences, written once and shared by every check. A
// check that needs the whole of a sequence calls the helper, and a check that
// needs only part of it calls the operations it needs. That distinction is what
// the retired `startMatch` destroyed — it took both paddles from the player on
// its way to the countdown, so no check could open a match and then press a
// movement key — and it is why every helper below is assembled from parts a
// check can call on its own.
//
// A CHECK POSES AN ISOLATED WORLD. `clearWorld`, `spawnBall` and `spawnObstacle`
// are what let a check hold only what its requirement concerns: it clears the
// field and spawns back exactly what the check is about. Nothing here parks a
// spare ball in a corner or pins an obstacle still to keep it quiet —
// containment leans on the game's own rules holding, and a broken build is
// broken in exactly those rules, so a contained bystander makes one check report
// another check's defect. The paddles are the one exception the specification
// names: they are field furniture the game always has and no operation removes,
// so a check that must keep one out of the way takes it from the player with
// `setPaddleDriven` and holds it there.
//
// HOW THE SURFACE IS DRIVEN. Directly. Each operation is a method that acts on
// the live world at the moment of the call — the instance holds the engine, and
// `engine.world` follows transitions — so a pose is `h.debug.setScreen("paused")`
// and a reading is `h.debug.snapshot()`, with nothing in between. One consequence
// is worth stating once, here: a SCREEN-CHANGING pose (`setScreen`, a `reset`
// away from the title) may land at the call or as late as the end of the next
// advanced frame — the spec fixes the arrangement, not the moment, and both
// designs are conformant — so a scenario poses, advances a frame, and then
// reads, which is correct under either design. The scenario helpers below carry
// those advances so a check does not have to.
//
// THE KEYBOARD, THE MOUSE AND THE FINGER. specs/ui.md drives the menus with all
// three, so this harness dispatches all three at the event target the engine
// listens on: a `KeyboardEvent`-shaped event for a key, and a
// `PointerEvent`-shaped event carrying `pointerType` for a mouse, a pen or a
// touch contact. Everything past the dispatch — the mapping onto logical units,
// the edges, the contacts — is the engine's own, so what a check drives is the
// pipeline a player drives.
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
  type GameDefinition,
  type GameInstance,
  type GameState,
  type PointerButton,
  type PointerDevice,
  type RecordedFrame,
  type Recording,
  type Resource,
  type SurfaceMetrics,
  type Viewport,
  type World,
} from "@test-cabinet/structured-2d";
import {
  BALL_COUNT,
  BALL_R,
  FIELD_CX,
  FIELD_CY,
  FIELD_H,
  FIELD_W,
  HOLD_TIME,
  LAYOUT,
  OBSTACLES,
  P1_X1,
  P2_X0,
  SPEED_CAP,
  SPEED_MULT,
  WIN_SCORE,
} from "./constants";
// `game` is the build's entry, and `BACKGROUND` is the clear colour it exports
// beside it. `BACKGROUND` is a value specs/overview.md leaves to the build, and
// it is handed straight back to the engine as the colour the canvas is cleared
// to, exactly as the seeded `src/main.ts` does; nothing compares it against
// anything. Those two names are the whole of what this project takes from the
// build outside a type.
import { BACKGROUND, game as build } from "../src/game";
import { assertEqual, assertTruthy, fail } from "./assert";
import type {
  BallSnapshot,
  CaromDebugApi,
  CaromSnapshot,
  MenuRect,
  Mode,
  MultiBallOps,
  ResumeScreen,
  Screen,
  Side,
  SingleBallOps,
} from "./surface";

export type { MenuRect, Mode, ResumeScreen, Screen, Side };

/* -------------------------------------------------------------------------- */
/* The two typed views of one surface                                         */
/* -------------------------------------------------------------------------- */
//
// A BALL INDEX IS A `multi` CONCEPT. `base` and `gyre` play with one ball and
// none of their ball operations takes an index; `multi` plays with three and
// every one of its ball operations takes `index` FIRST. `surface.ts` writes the
// two shapes out as {@link SingleBallOps} and {@link MultiBallOps} and makes
// `CaromDebugApi` generic over them, so ONE object is described by two types and
// a caller says which variant it is driving by which type it holds.
//
// Both views are exposed here, over the same object, so neither a `base` check
// nor a `multi` check needs a cast: `h.debug.setBallPosition(x, y)` under `base`
// and `gyre`, `h.debugMulti.setBallPosition(index, x, y)` under `multi`. They
// are NOT unioned, because a union is what forces the cast back on every call
// site.
//
// A check that runs under EVERY variant — most of this suite — holds neither
// view for a ball operation. It goes through {@link ballOps}, which binds one
// ball's operations into the no-index shape whichever variant is underneath, and
// which is the single place in this file that has to know that the two exist.
// Every operation that is NOT a ball operation is identical in both views, so a
// shared check reaches those through `h.debug` like any other.

/** The surface as `base` and `gyre` carry it: one ball, no index anywhere. */
export type CaromSurface = CaromDebugApi<SingleBallOps>;

/**
 * The same object as `multi` carries it: `index` first on every ball operation.
 *
 * Reached through `h.debugMulti`, which is `h.debug` under this type rather than
 * a second object.
 */
export type CaromMultiSurface = CaromDebugApi<MultiBallOps>;

/**
 * The surface as every check drives it.
 *
 * Under this engine the raw surface IS imperative — a pose takes only its own
 * arguments and returns nothing, a reading takes only its own arguments and
 * returns plain data — so no wrapper stands between a check and the object the
 * build returned, and the driver type is the surface type itself. The alias is
 * kept so a check reads the same way it does under an engine whose surface needs
 * driving.
 */
export type CaromDriver = CaromSurface;

/**
 * The build's game, typed against the surface the CASE specifies.
 *
 * The build declares its own type for the surface its instance's `initialize`
 * returns — the `D` of its `GameInstance<D>` — and that type is the build's:
 * what a check holds it to is `surface.ts`, so the definition is cast to the
 * case's `GameDefinition<CaromSurface>` here and the engine is parameterized
 * with it. A surface that departs from the specification is caught where a
 * check reaches for the missing member, not by the build's own compiler.
 */
const game = build as unknown as GameDefinition<CaromSurface>;

/**
 * The frame the suite steps in, in milliseconds.
 *
 * This is the SUITE's choice, not the game's: the case's own `validation/constants.ts` deliberately
 * fixes no timestep, because the engine hands the game whatever elapsed time a
 * frame really took. Fixing it here makes a duration a whole number of frames, so
 * a tolerance can be stated in ticks and mean the same thing on every machine.
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
 * sound under `multi` is isolation: a shared scenario clears the field and spawns
 * ONE ball back (see {@link isolateField}), so the reading is of the driven ball
 * and the other two are not on the field to interfere.
 *
 * `CaromSnapshot` declares both shapes as optional, because which one a build
 * reports is its variant's to decide. A build reporting neither fails by
 * assertion here rather than throwing a `TypeError` several frames later, so the
 * point names the fault.
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

/**
 * Every ball a snapshot reports, in play order.
 *
 * A cleared field reports `balls: []` under `multi` and `ball: null` under the
 * other two, so both read back as no balls at all — which is what makes
 * {@link isolateField} verifiable by reading it.
 */
export function allBalls(snapshot: CaromSnapshot): BallView[] {
  if (snapshot.balls !== undefined) return snapshot.balls;
  const one = snapshot.ball;
  return one === undefined || one === null ? [] : [one];
}

/**
 * Whether the build underneath plays with INDEXED balls.
 *
 * The discriminator is the one specs/instrumentation.md fixes: `multi` reports
 * its balls as `balls`, each entry under its own `index`, and `base` and `gyre`
 * report the single ball as `ball` with no index on it. It is read off the
 * snapshot rather than off the shape of the build's functions, so it says what
 * the specification says and not what a build's argument list happens to look
 * like, and it answers on a CLEARED field too: `multi` reports `balls: []` where
 * `base` and `gyre` report `ball: null`.
 */
export function isMultiBall(h: Harness): boolean {
  return h.snapshot().balls !== undefined;
}

/**
 * One ball's six operations in the no-index shape, whichever variant is
 * underneath.
 *
 * This is the ONLY place in the suite that has to know that the two ball shapes
 * exist. A `base` or `gyre` check drives `h.debug` directly and a `multi` check
 * drives `h.debugMulti` directly, each in its own variant's slice with no cast;
 * a SHARED check — one that runs under all three — cannot name either, so it
 * comes here and drives ball `index` through a facade that is `SingleBallOps`
 * under both.
 *
 * Under `base` and `gyre` the facade IS the surface, so nothing stands between
 * the check and the build's own method. Under `multi` each call forwards with
 * `index` in front. Asking for an index other than `0` of a single-ball build is
 * a fault in the CHECK rather than in the build, and it fails here naming the
 * ball asked for, rather than reaching a build operation that has no such
 * argument.
 */
export function ballOps(h: Harness, index = 0): SingleBallOps {
  if (!isMultiBall(h)) {
    assertEqual(
      index,
      0,
      "the ball asked for: base and gyre play with one ball, so ball 0 is " +
        "the only one there is (specs/instrumentation.md)",
    );
    return h.debug;
  }
  const many = h.debugMulti;
  return {
    spawnBall: () => many.spawnBall(index),
    setBallPosition: (x, y) => many.setBallPosition(index, x, y),
    setBallVelocity: (vx, vy) => many.setBallVelocity(index, vx, vy),
    setBallSpin: (spin) => many.setBallSpin(index, spin),
    setBallHeld: (held) => many.setBallHeld(index, held),
    setBallHoldTimer: (seconds) => many.setBallHoldTimer(index, seconds),
  };
}

/* -------------------------------------------------------------------------- */
/* The harness                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Where a `fillText`/`strokeText` call put its text, read off the real context
 * at the moment of the call: the current transform, so the anchor can be mapped
 * to logical units whatever transform the pipeline applied, the measured
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
  /** The element's laid-out CSS width. Defaults to the logical field width. */
  cssWidth?: number;
  /** The element's laid-out CSS height. Defaults to the logical field height. */
  cssHeight?: number;
  /** Device pixels per CSS pixel. Defaults to 1, so one device pixel is one unit. */
  dpr?: number;
}

/**
 * Which pointer a dispatched event comes from, and what it is holding.
 *
 * The engine reads `pointerType`, `pointerId`, `isPrimary`, `button` and
 * `buttons` off a pointer event and nothing else (the engine's `input.md`), so
 * these are exactly the facts a check can vary. Every one of them has a default
 * that describes an ordinary left mouse button, which is what most menu checks
 * want.
 */
export interface PointerOptions {
  /**
   * Which kind of device drove it, carried as `pointerType`.
   *
   * `"touch"` is a finger and `"mouse"` is a mouse, and the engine reports the
   * difference to the game as `device`. It is what lets one check drive a menu
   * with a mouse and its sibling drive the same menu with a finger, over the
   * same helpers.
   */
  device?: PointerDevice;
  /**
   * Which pointer, carried as `pointerId`. A mouse keeps one id for the life of
   * the page, and each touch contact gets its own — so a check about a second
   * finger landing gives it an id of its own.
   */
  id?: number;
  /** Whether this is the primary pointer, the one the snapshot and edges follow. */
  primary?: boolean;
  /** The button a press or a release names. Defaults to the primary button. */
  button?: PointerButton;
  /**
   * The buttons the pointer holds once the event has been applied.
   *
   * Left out, the harness keeps the count itself: a press adds its button, a
   * release drops it, and a move reports whatever the pointer is still holding.
   * Stating it is for a check that is about the mask itself.
   */
  buttons?: readonly PointerButton[];
}

/** How a drag is dispatched: where it stops on the way, and how long it takes. */
export interface DragOptions extends PointerOptions {
  /** How many moves the travel is dispatched as. Defaults to four. */
  steps?: number;
  /** Frames advanced after the press and after each move. Defaults to one. */
  framesPerStep?: number;
  /**
   * Whether the drag ends with a release at `to`. Defaults to `true`; `false`
   * leaves the pointer down, for a check about a gesture still in progress.
   */
  release?: boolean;
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

export interface Harness {
  readonly engine: Engine<CaromSurface>;
  /**
   * The world currently open, read fresh on every access. A level transition
   * REBUILDS the world, so nothing here holds one across a frame: a check that
   * travels asks again.
   */
  readonly world: World;
  /**
   * The open world's game state, read fresh on every access. Its arrangement
   * is the build's to design (specs/state.md), so nothing here reads a field
   * off it: every value the specification names is reported by `snapshot()`,
   * and that is where a check reads it.
   */
  readonly state: GameState;
  /** The game instance, the one framework object that outlives every level. */
  readonly instance: GameInstance<CaromSurface>;
  /**
   * The debug surface the BUILD's instance returned from `initialize`, read
   * off `engine.debug` — see {@link readDebugSurface} — and driven directly:
   * each operation acts on the live world at the moment of the call.
   *
   * Typed as `base` and `gyre` carry it, which is the shape every operation
   * that is NOT a ball operation has in all three variants. A `multi` check
   * reaches the indexed ball operations through {@link debugMulti}, and a check
   * that runs under every variant reaches one ball's through {@link ballOps}.
   */
  readonly debug: CaromDriver;
  /**
   * The SAME object, typed as `multi` carries it: `index` first on every ball
   * operation.
   *
   * Not a second surface and not a copy — `h.debug` and `h.debugMulti` are one
   * object under two types, so a `multi` check writes
   * `setBallPosition(index, x, y)` and a `base` check writes
   * `setBallPosition(x, y)`, each without a cast. Reaching for it from a check
   * that is not multi's compiles and then drives the build's single-ball
   * operation with an index as its first coordinate, so a variant slice holds
   * the view its own specification names and no other.
   */
  readonly debugMulti: CaromMultiSurface;
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
   * The engine closes the input frame after the frame renders and an edge is
   * consumed once, so a tap between frames arms the edge for exactly the next
   * frame — which this runs.
   */
  tap(code: string): Promise<void>;

  /**
   * Move the pointer to a logical point, with no button pressed.
   *
   * Every pointer method below dispatches a `PointerEvent`-shaped event at the
   * target the engine listens on and lets the ENGINE do the rest — the mapping
   * onto logical units, the contacts, the edges — so what a check drives is the
   * pipeline a player drives. The position is given in the same logical units
   * `menuItemRect` reports, and the harness converts it back to the client
   * position an event carries.
   */
  pointerMove(x: number, y: number, options?: PointerOptions): void;
  /** Press a button at a logical point, bringing the pointer into contact. */
  pointerDown(x: number, y: number, options?: PointerOptions): void;
  /** Release a button at a logical point, ending the contact it was holding. */
  pointerUp(x: number, y: number, options?: PointerOptions): void;
  /** End a contact the way the browser does when it takes the gesture back. */
  pointerCancel(x: number, y: number, options?: PointerOptions): void;
  /**
   * Press and release at one logical point, then run the one frame that reads
   * both edges.
   *
   * A press and the release that follows it may arrive on one frame, and that
   * frame is the one specs/ui.md says confirms.
   */
  pointerTap(x: number, y: number, options?: PointerOptions): Promise<void>;
  /**
   * Press at `from`, travel to `to` over driven frames, and release there.
   *
   * The travel is dispatched as separate moves with a frame between them, so
   * the game reads the gesture as a player's rather than as a teleport, and a
   * build that resolves each sample sees the path the drag took.
   */
  pointerDrag(
    from: { x: number; y: number },
    to: { x: number; y: number },
    options?: DragOptions,
  ): Promise<void>;

  /** Where a logical point lands in the canvas's backing store. */
  device(x: number, y: number): { x: number; y: number };
  /** The device pixel under a logical point, as `[r, g, b, a]`. */
  pixel(x: number, y: number): [number, number, number, number];

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
 * A `PointerEvent`-shaped event: the engine reads exactly these six fields.
 *
 * A class rather than an object literal over `new Event(...)` so every
 * dispatched pointer carries the whole set and none of them can be forgotten at
 * one call site. `clientX` and `clientY` are CSS pixels from the canvas's
 * top-left corner, which is what a surface with no `origin` reads them as (the
 * engine's `input.md`).
 */
class PointerShapedEvent extends Event {
  readonly clientX: number;
  readonly clientY: number;
  readonly pointerId: number;
  readonly pointerType: string;
  readonly isPrimary: boolean;
  readonly button: number;
  readonly buttons: number;

  constructor(
    type: PointerEventType,
    fields: {
      clientX: number;
      clientY: number;
      pointerId: number;
      pointerType: string;
      isPrimary: boolean;
      button: number;
      buttons: number;
    },
  ) {
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

/** The four pointer events the engine listens for. */
type PointerEventType =
  "pointerdown" | "pointermove" | "pointerup" | "pointercancel";

/**
 * The browser's own numbering for `PointerEvent.button`, which the engine reads
 * a button's name out of. `-1` is the value a move carries: the field saying the
 * event is about position rather than about a button.
 */
const BUTTON_INDEX: Readonly<Record<PointerButton, number>> = {
  primary: 0,
  auxiliary: 1,
  secondary: 2,
  back: 3,
  forward: 4,
};

/** The bit each button occupies in the `PointerEvent.buttons` mask. */
const BUTTON_BIT: Readonly<Record<PointerButton, number>> = {
  primary: 1,
  secondary: 2,
  auxiliary: 4,
  back: 8,
  forward: 16,
};

/** The `buttons` mask a set of held buttons makes. */
function buttonMask(held: Iterable<PointerButton>): number {
  let mask = 0;
  for (const button of held) mask |= BUTTON_BIT[button];
  return mask;
}

/**
 * The client position a logical point sits at, which is what a dispatched
 * pointer event carries.
 *
 * The inverse of the conversion the engine documents: it takes a client
 * position, subtracts the surface's origin (`(0, 0)` here, because the harness
 * declares none), multiplies by the device pixel ratio, and maps it through the
 * inverse viewport. Going the other way is the viewport map followed by a
 * division by the ratio, so a check names a point in the units
 * `menuItemRect` reports and the game reads that same point back.
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
 * A logical point's device pixel, through the world's camera and the engine's
 * fit. The camera opens at the defaults — world and logical coordinates
 * coincide, which is the space every figure the specification fixes is stated
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
 * The debug surface the BUILD's instance returned from `initialize`, read off
 * the engine that holds it.
 *
 * This is deliberately a READ and never a construction. The surface is the
 * build's deliverable: its instance's `initialize` returns it
 * (specs/instrumentation.md), the engine keeps that same object, and
 * `engine.debug` is the only way it reaches a check. Nothing here could stand in
 * for it, because the build's own module for the surface is never imported.
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
function readDebugSurface(engine: Engine<CaromSurface>): CaromSurface {
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
 * Keys that belong to the MACHINERY rather than to a check are answered with
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
  "the debug surface src/game.ts's instance returns from initialize, which " +
  "the engine hands back from engine.debug (specs/instrumentation.md)";

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
 * Build an engine over a canvas of the harness's own, initialize the build's
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

  const keys = new EventTarget();
  const surface: SurfaceMetrics = {
    cssWidth: () => cssWidth,
    cssHeight: () => cssHeight,
    dpr: () => dpr,
    events: () => keys,
  };

  const engine = createEngine<CaromSurface>({
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
  engine.events.on("cue:played", ({ cue, t, gain }) => {
    cues.push({ cue, t, gain });
  });

  const instance = await engine.initialize();
  const debug = readDebugSurface(engine);

  const dispatch = (type: "keydown" | "keyup", code: string): void => {
    keys.dispatchEvent(new KeyEvent(type, code));
  };

  /**
   * What each pointer id is holding, so a move dispatched mid-drag reports the
   * mask a real one would and a check never has to state it.
   *
   * The engine keeps a contact for as long as a pointer holds a button, so the
   * mask is what says whether a drag is still in progress; keeping the count
   * here is what lets `pointerMove` be a one-argument call during one.
   */
  const held = new Map<number, Set<PointerButton>>();

  const heldBy = (id: number): Set<PointerButton> => {
    const existing = held.get(id);
    if (existing !== undefined) return existing;
    const created = new Set<PointerButton>();
    held.set(id, created);
    return created;
  };

  const point = (
    type: PointerEventType,
    x: number,
    y: number,
    options: PointerOptions,
    button: PointerButton | null,
  ): void => {
    const id = options.id ?? 0;
    const at = toClient(engine.viewport(), dpr, x, y);
    const mask =
      options.buttons === undefined
        ? buttonMask(heldBy(id))
        : buttonMask(options.buttons);
    keys.dispatchEvent(
      new PointerShapedEvent(type, {
        clientX: at.x,
        clientY: at.y,
        pointerId: id,
        pointerType: options.device ?? "mouse",
        isPrimary: options.primary ?? true,
        // A move is about position rather than about a button, which the field
        // says with -1 (the engine's `input.md`).
        button: button === null ? -1 : BUTTON_INDEX[button],
        buttons: mask,
      }),
    );
  };

  const move = (x: number, y: number, options: PointerOptions): void => {
    point("pointermove", x, y, options, null);
  };

  const down = (x: number, y: number, options: PointerOptions): void => {
    const button = options.button ?? "primary";
    heldBy(options.id ?? 0).add(button);
    point("pointerdown", x, y, options, button);
  };

  const up = (x: number, y: number, options: PointerOptions): void => {
    const button = options.button ?? "primary";
    heldBy(options.id ?? 0).delete(button);
    point("pointerup", x, y, options, button);
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
    debugMulti: debug as unknown as CaromMultiSurface,
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

    pointerMove: (x, y, options = {}) => move(x, y, options),
    pointerDown: (x, y, options = {}) => down(x, y, options),
    pointerUp: (x, y, options = {}) => up(x, y, options),
    pointerCancel: (x, y, options = {}) => {
      heldBy(options.id ?? 0).clear();
      point("pointercancel", x, y, options, options.button ?? null);
    },
    async pointerTap(x, y, options = {}) {
      down(x, y, options);
      up(x, y, options);
      await engine.advance(1);
    },
    async pointerDrag(from, to, options = {}) {
      const steps = Math.max(1, options.steps ?? 4);
      const perStep = Math.max(1, options.framesPerStep ?? 1);
      down(from.x, from.y, options);
      await engine.advance(perStep);
      for (let step = 1; step <= steps; step += 1) {
        const t = step / steps;
        move(
          from.x + (to.x - from.x) * t,
          from.y + (to.y - from.y) * t,
          options,
        );
        await engine.advance(perStep);
      }
      if (options.release !== false) {
        up(to.x, to.y, options);
        await engine.advance(perStep);
      }
    },

    device: (x, y) => toDevice(engine.world, engine.viewport(), x, y),
    pixel: (x, y) => {
      const point = toDevice(engine.world, engine.viewport(), x, y);
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
// how a check produces one, over the engine's own draw-command recorder.
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
// THE SEQUENCES THE SURFACE NO LONGER CARRIES. Every operation on the surface is
// atomic, so opening a match, reaching a screen or staging a rally is a SEQUENCE
// of them — and this is where those sequences live, written once and shared by
// every check (see the header). Each is built from parts a check can call on its
// own, so a check that wants only half of one takes the half it wants: a check
// about the real input pipeline opens a match and never calls
// {@link takePaddles}, and its paddles answer the keyboard exactly as a
// player's do.
//
// THE WORLD EACH ONE POSES HOLDS ONLY WHAT THE CHECK CONCERNS. The isolation
// helpers below clear the field and spawn back what a scenario is about — one
// ball, one obstacle, or neither — so a bystander is ABSENT rather than parked
// out of the way. Nothing here contains an entity it could remove.
//
// They fix only geometry: where a ball or a paddle is put. Every threshold a
// check asserts is stated in the check itself, derived from the figure or rule
// specs/ states for it.

/* ---- The world ------------------------------------------------------------ */

/** Every obstacle index the field can hold, in the order of `OBSTACLE_CENTERS`. */
export const ALL_OBSTACLES: readonly number[] = OBSTACLES.map(
  (_rect, index) => index,
);

/** How many balls the variant underneath plays with: one, or three under multi. */
export function ballCount(h: Harness): number {
  return isMultiBall(h) ? BALL_COUNT : 1;
}

/**
 * Take every ball and every obstacle off the field, leaving it empty.
 *
 * The paddles stay, because no operation removes them: they are field furniture
 * the game always has (specs/instrumentation.md), and a check that must keep one
 * out of its scenario takes it from the player with {@link parkPaddle}.
 */
export function clearField(h: Harness): void {
  h.debug.clearWorld();
}

/**
 * Place balls `0 .. count - 1` at their home points, held, each with a full
 * hold timer and an empty trail.
 *
 * `count` defaults to one, which is the world nearly every shared scenario
 * wants: one ball is what a check about a bounce, a spin or a paddle contact is
 * about, and under `multi` the other two are simply not on the field.
 */
export function spawnBalls(h: Harness, count = 1): void {
  for (let index = 0; index < count; index += 1) {
    ballOps(h, index).spawnBall();
  }
}

/** Place each named obstacle at its base centre, upright. */
export function spawnObstacles(
  h: Harness,
  indices: readonly number[] = ALL_OBSTACLES,
): void {
  for (const index of indices) h.debug.spawnObstacle(index);
}

/** What a scenario leaves on the field. */
export interface FieldContents {
  /** How many balls, from ball zero up. Defaults to one. */
  balls?: number;
  /** Which obstacles, by index. Defaults to none. */
  obstacles?: readonly number[];
}

/**
 * Clear the field and spawn back exactly what `contents` names.
 *
 * This is the isolation the policy asks for, in one call: a check on a wall
 * bounce runs against one ball and nothing else, a check on an obstacle face
 * runs against one ball and that one obstacle, and a check on a menu runs
 * against an empty field. Everything a scenario does not name is REMOVED rather
 * than parked in a corner or pinned still, so nothing on the field can escape a
 * containment and report another check's defect as this one's.
 *
 * The default — one ball, no obstacles — is the world most of this suite wants.
 */
export function isolateField(h: Harness, contents: FieldContents = {}): void {
  clearField(h);
  spawnBalls(h, contents.balls ?? 1);
  spawnObstacles(h, contents.obstacles ?? []);
}

/* ---- The paddles ---------------------------------------------------------- */

/** Off-lane parking height for a paddle a scenario must keep out of the way. */
export const PARKED_CY = 150;

/**
 * Take `side`'s paddle from the player and hold it where the options say.
 *
 * Three atomic operations, in the order that leaves the paddle standing exactly
 * where it is put: its centre, the velocity it travels at while driven, and then
 * the flag that takes it from the player and the AI. A driven paddle moves at
 * its `drivenVy` alone, so `vy: 0` is a paddle that does not move at all.
 */
export function drivePaddle(
  h: Harness,
  side: Side,
  options: { cy?: number; vy?: number } = {},
): void {
  if (options.cy !== undefined) h.debug.setPaddleCy(side, options.cy);
  h.debug.setPaddleVy(side, options.vy ?? 0);
  h.debug.setPaddleDriven(side, true);
}

/**
 * Put `side`'s paddle at `cy` and leave it under whoever was moving it.
 *
 * The counterpart to {@link drivePaddle} for a scenario that has to start a
 * paddle somewhere without taking it: the AI's paddle at a chosen height, or a
 * player's paddle at the top of its travel before a key is held.
 */
export function placePaddle(h: Harness, side: Side, cy: number): void {
  h.debug.setPaddleCy(side, cy);
}

/** Take the named paddles from the player, leaving each where it stands. */
export function takePaddles(
  h: Harness,
  sides: readonly Side[] = ["left", "right"],
): void {
  for (const side of sides) h.debug.setPaddleDriven(side, true);
}

/** Hand the named paddles back to the player and the AI. */
export function releasePaddles(
  h: Harness,
  sides: readonly Side[] = ["left", "right"],
): void {
  for (const side of sides) h.debug.setPaddleDriven(side, false);
}

/**
 * Hold one paddle still, out of the mid-field lane.
 *
 * The paddles cannot be removed, so this is how a check keeps the one it is not
 * about out of its scenario: taken from the player and the AI, standing at
 * {@link PARKED_CY} with nothing to move it. It is the one containment this
 * suite performs, and it is the one specs/instrumentation.md provides an
 * operation for.
 */
export function parkPaddle(h: Harness, side: Side): void {
  drivePaddle(h, side, { cy: PARKED_CY, vy: 0 });
}

/** Hold both paddles still and out of the lane, so a shot down it is clear. */
export function parkPaddles(h: Harness): void {
  parkPaddle(h, "left");
  parkPaddle(h, "right");
}

/** Put both paddles at the field's centre height, still. */
export function centerPaddles(h: Harness): void {
  h.debug.setPaddleCy("left", FIELD_CY);
  h.debug.setPaddleCy("right", FIELD_CY);
  h.debug.setPaddleVy("left", 0);
  h.debug.setPaddleVy("right", 0);
}

/* ---- The AI's faculties --------------------------------------------------- */

/**
 * Gate the AI's two faculties, each on its own.
 *
 * A single switch cannot express a check on what the opponent SENSES while its
 * body is held still, so specs/instrumentation.md splits them: `tracking` is
 * whether it senses the ball and chooses a target, `movement` is whether its
 * paddle travels toward that target. Both start `true` and `reset` returns both
 * to `true`, so a scenario names only the faculty it is holding.
 */
export function gateAi(
  h: Harness,
  faculties: { tracking?: boolean; movement?: boolean },
): void {
  if (faculties.tracking !== undefined) {
    h.debug.setAiTracking(faculties.tracking);
  }
  if (faculties.movement !== undefined) {
    h.debug.setAiMovement(faculties.movement);
  }
}

/* ---- The obstacle clock: gyre alone --------------------------------------- */

/**
 * `gyre`: stop the obstacle clock and hold it at `t` seconds.
 *
 * Under `gyre` the obstacles sway and turn with a clock that advances with the
 * frame, so by the time a scenario is posed they are a fraction of a degree off
 * upright. Stopping the clock and setting it to `0` puts them at their base
 * centres, upright and still, which is the pose at which gyre's oriented rule
 * "reduces to the upright case" (specs/playfield.md) and a shared check about an
 * obstacle face means the same thing in every variant.
 *
 * The clock is the only thing this sets: the POSES are the build's own,
 * recomputed from it on the next frame, so a caller advances one frame before it
 * reads or aims at a face. Both operations are gyre's alone and the other two
 * variants' obstacles never move, so this does nothing there.
 */
export function holdObstacleClock(h: Harness, t = 0): void {
  h.debug.setObstacleClockRunning?.(false);
  h.debug.setObstacleClock?.(t);
}

/* ---- Opening a match ------------------------------------------------------ */

/**
 * The title screen, with the standard world and every declared field at its
 * title value.
 *
 * `reset` is the one operation that arranges more than one thing, and it is a
 * lifecycle verb rather than a pose: it is how a check gets back to a known
 * start. It may rebuild its screen even when called on the title, so one frame
 * is advanced before anything else is posed or pressed.
 */
export async function openTitle(h: Harness): Promise<void> {
  h.debug.reset();
  await h.advance(1);
}

/**
 * Arrange everything specs/ui.md's "Starting a match" fixes, on the countdown.
 *
 * The screen is posed FIRST and a frame is advanced before anything else, which
 * is the discipline the header states: a screen-changing pose may ride a level
 * transition the engine honors at the end of the frame, so every field posed
 * after that frame is posed into the match world the transition opened rather
 * than into the world it left.
 *
 * WHAT IT DOES NOT DO IS TAKE THE PADDLES. Both are left under the player and
 * the AI, so a check that presses a movement key gets a paddle that answers it.
 * A scenario that needs them held calls {@link takePaddles},
 * {@link drivePaddle} or {@link parkPaddles} afterwards, and pays for exactly
 * what it asked for.
 */
export async function stageMatchStart(h: Harness, mode: Mode): Promise<void> {
  h.debug.setScreen("countdown");
  await h.advance(1);
  h.debug.setMode(mode);
  h.debug.setResumeScreen("playing");
  h.debug.setMenuIndex(0);
  h.debug.setScore(0, 0);
  h.debug.setWinner(null);
  h.debug.setReceiver?.("left");
  centerPaddles(h);
  spawnBalls(h, ballCount(h));
}

/**
 * Open a match on its pre-serve countdown through the debug surface alone.
 *
 * This is how a countdown scenario reaches its ground without driving the menus
 * — a build with a broken menu and a working countdown must fail the navigation
 * checks and pass the countdown ones — and it is the base every scenario below
 * is built on. A check that wants to arrive the way a player does enters with
 * {@link startWithKeys} instead.
 */
export async function openCountdown(
  h: Harness,
  mode: Mode = "versus",
): Promise<void> {
  await openTitle(h);
  await stageMatchStart(h, mode);
}

/**
 * Stage one ball's serve: at its home point, held, with `seconds` of hold left.
 *
 * `serve()` is gone from the surface, because ending a hold is what serving IS:
 * the game's own rule launches the ball on the first frame its timer, after
 * subtracting the frame's time, is `<= 0` (specs/balls.md), and the launch that
 * follows is the build's own. A check that wants to WATCH a serve stages it with
 * a full hold and counts the frames; one that wants to be past it ends the hold
 * outright with {@link endHolds}.
 *
 * `receiver` is `base` and `gyre`'s: `multi`'s balls launch independently of one
 * another and declare no receiver, so a multi check never names one.
 */
export function stageServe(
  h: Harness,
  options: { ball?: number; receiver?: Side; seconds?: number } = {},
): void {
  const ops = ballOps(h, options.ball ?? 0);
  ops.spawnBall();
  if (options.receiver !== undefined) {
    assertEqual(
      typeof h.debug.setReceiver,
      "function",
      "base and gyre require setReceiver on the debug surface " +
        "(specs/instrumentation.md)",
    );
    h.debug.setReceiver?.(options.receiver);
  }
  ops.setBallHoldTimer(options.seconds ?? HOLD_TIME);
}

/**
 * End every present ball's hold, so the game's own rule launches it on the next
 * frame it runs.
 *
 * Every ball on the field, because the screen becomes `playing` only once no
 * ball is held: under `multi` a scenario that isolated the field to one ball
 * ends one hold, and one that left all three ends three.
 */
export function endHolds(h: Harness): void {
  const balls = allBalls(h.snapshot());
  balls.forEach((ball, position) => {
    ballOps(h, ball.index ?? position).setBallHoldTimer(0);
  });
}

/**
 * End the holds and run the frames that carry the game into live play.
 *
 * The launch is the build's own, on the frame after the hold elapses, so this
 * sweeps until the game reports `playing` rather than counting frames. That is
 * the state every posed scenario below assumes: posing a ball while the game is
 * still counting down would have the build's own launch overwrite the pose.
 */
export function reachPlay(
  h: Harness,
  options: UntilOptions = {},
): Promise<UntilResult> {
  endHolds(h);
  return h.until((s) => s.screen === "playing", {
    maxFrames: options.maxFrames ?? 60,
    poll: options.poll ?? 1,
  });
}

/** Open a match and run it up to live play, with the standard world on the field. */
export async function openPlaying(
  h: Harness,
  mode: Mode = "versus",
  options: UntilOptions = {},
): Promise<UntilResult> {
  await openCountdown(h, mode);
  return reachPlay(h, options);
}

/** What a scenario opens live play over. */
export interface IsolatedPlayOptions {
  mode?: Mode;
  /** The field the scenario runs on. Defaults to one ball and no obstacles. */
  contents?: FieldContents;
  /** How far the launch sweep may run. */
  launch?: UntilOptions;
}

/**
 * Live play over a field holding only what the scenario is about.
 *
 * The three steps every posed scenario below shares: open the countdown, clear
 * the field and spawn back what the check concerns, then end the holds and let
 * the build's own launch carry the game into `playing`. Isolating BEFORE the
 * launch is what keeps the count honest under `multi` — the screen turns over
 * when no ball is held, and the balls a scenario removed are not there to hold.
 */
export async function openIsolatedPlay(
  h: Harness,
  options: IsolatedPlayOptions = {},
): Promise<UntilResult> {
  await openCountdown(h, options.mode ?? "versus");
  isolateField(h, options.contents);
  return reachPlay(h, options.launch);
}

/**
 * Open the how-to screen.
 *
 * The screen is posed and a frame advanced before `menuIndex`, for the reason
 * {@link stageMatchStart} states.
 */
export async function openHowTo(h: Harness): Promise<void> {
  await openTitle(h);
  h.debug.setScreen("howto");
  await h.advance(1);
  h.debug.setMenuIndex(0);
}

/** What a scenario opens the pause menu over. */
export interface PauseOptions {
  mode?: Mode;
  /** The screen the pause resumes to, and the one it is opened from. */
  resumeTo?: ResumeScreen;
  /** The highlighted pause item. Defaults to `RESUME`. */
  menuIndex?: number;
}

/**
 * Reach the pause menu over a real match, from `countdown` or from `playing`.
 *
 * The field behind the menu is the STANDARD one the match was on, frozen, which
 * is what specs/ui.md says the pause screen shows. `resumeScreen` is posed
 * rather than inferred, so a check about resuming reads the field it set rather
 * than the one the build happened to leave.
 *
 * A check that needs the pause menu over an ISOLATED field takes the parts
 * instead: {@link openIsolatedPlay}, then `setScreen("paused")` and one advanced
 * frame.
 */
export async function openPaused(
  h: Harness,
  options: PauseOptions = {},
): Promise<void> {
  const resumeTo = options.resumeTo ?? "playing";
  const mode = options.mode ?? "versus";
  if (resumeTo === "playing") await openPlaying(h, mode);
  else await openCountdown(h, mode);
  h.debug.setScreen("paused");
  await h.advance(1);
  h.debug.setResumeScreen(resumeTo);
  h.debug.setMenuIndex(options.menuIndex ?? 0);
}

/** What a scenario opens an isolated pause menu over. */
export interface IsolatedPauseOptions extends IsolatedPlayOptions {
  /** The highlighted pause item. Defaults to `RESUME`. */
  menuIndex?: number;
}

/**
 * The pause menu over a field holding only what the scenario is about.
 *
 * {@link openPaused} leaves the STANDARD match world frozen behind the menu,
 * which is what a check on what the pause screen SHOWS reads. A check on what
 * the pause menu's own keys DO wants nothing else on the field: a ball left live
 * behind a build whose pause does not really stop the world can bank a shot into
 * a goal and take the screen away from the reading, which would report the
 * pause's defect against this point. So this opens {@link openIsolatedPlay} and
 * poses the pause over it — `setScreen`, the frame the header's discipline asks
 * for, then the `resumeScreen` and `menuIndex` specs/ui.md says a `pause` edge
 * sets.
 *
 * The KEY that opens the pause menu is not pressed. That key belongs to the
 * `controls-solo` and `controls-versus` points and to `navigation/pause-escape`;
 * pressing it to reach the ground here would put it at both ends of every other
 * pause check, and one broken binding would take the whole pause menu's points
 * with it.
 *
 * Neither paddle is taken from the player: a menu is not driven through a
 * paddle, and a driven one would be scenery these checks do not need.
 */
export async function openIsolatedPaused(
  h: Harness,
  options: IsolatedPauseOptions = {},
): Promise<UntilResult> {
  const live = await openIsolatedPlay(h, options);
  h.debug.setScreen("paused");
  await h.advance(1);
  h.debug.setResumeScreen("playing");
  h.debug.setMenuIndex(options.menuIndex ?? 0);
  return live;
}

/** What a scenario opens the match-over screen over. */
export interface MatchOverOptions {
  mode?: Mode;
  /** The winning side. Defaults to the left. */
  winner?: Side;
  /** The final scores. Each defaults to a clean win for `winner`. */
  p1?: number;
  p2?: number;
  /** The highlighted item. Defaults to `PLAY AGAIN`. */
  menuIndex?: number;
}

/**
 * Reach the match-over screen with a stated winner and final score.
 *
 * Posed rather than played out: driving eleven real points to reach the screen
 * would put every rule of the game between a check and the screen it is about.
 * A check that is about the WIN RULE itself takes the parts instead — it poses a
 * score one point short over {@link arrangeGoal} and lets the real scoring
 * resolve the last point.
 */
export async function openMatchOver(
  h: Harness,
  options: MatchOverOptions = {},
): Promise<void> {
  const winner = options.winner ?? "left";
  await openCountdown(h, options.mode ?? "versus");
  h.debug.setScreen("matchover");
  await h.advance(1);
  h.debug.setScore(
    options.p1 ?? (winner === "left" ? WIN_SCORE : 0),
    options.p2 ?? (winner === "right" ? WIN_SCORE : 0),
  );
  h.debug.setWinner(winner);
  h.debug.setMenuIndex(options.menuIndex ?? 0);
}

/**
 * Start a match from the title the way a player does: menu keys only.
 *
 * `reset` may land as late as the end of the next advanced frame, so one frame
 * is advanced before the first tap — otherwise that tap's edge could be consumed
 * by the world the reset is leaving.
 */
export async function startWithKeys(h: Harness, mode: Mode): Promise<void> {
  await openTitle(h);
  // SOLO is the first entry; VERSUS is one down.
  if (mode === "versus") await h.tap("ArrowDown");
  await h.tap("Enter");
}

/* ---- The menus, through the mouse and the finger --------------------------- */
//
// specs/ui.md drives every menu screen with a pointer and with touch as well as
// with the keyboard, over regions the BUILD lays out. The case does not fix
// where a menu is drawn — appearance is loose and reviewed — so a check asks the
// build where it put an item through `menuItemRect` and drives the pointer
// there. What is asserted is the selection that follows, which is the game's own
// input handling.

/**
 * The hit region of item `index` on the menu the current screen shows.
 *
 * Fails naming the reading when the build reports none: `menuItemRect` returns
 * `null` on `countdown` and `playing`, which show no menu, and for an index that
 * names no item — so a `null` here means the check asked about an item the
 * current screen does not have, or that the build does not report its layout.
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
export function menuCenter(
  h: Harness,
  index: number,
): { x: number; y: number } {
  const rect = menuRect(h, index);
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/**
 * Move the pointer onto item `index` and run the frame that reads it.
 *
 * A move alone, with no button: specs/ui.md makes a pointer arriving over an
 * item's region select it, which is the hover a mouse does and the reason this
 * is separate from a click.
 */
export async function hoverMenuItem(
  h: Harness,
  index: number,
  options: PointerOptions = {},
): Promise<void> {
  const at = menuCenter(h, index);
  h.pointerMove(at.x, at.y, options);
  await h.advance(1);
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
export function aimPointerAtItem(
  h: Harness,
  index: number,
  options: PointerOptions = {},
): { x: number; y: number } {
  const at = menuCenter(h, index);
  h.pointerMove(at.x, at.y, options);
  return at;
}

/**
 * Click item `index`: move onto it, press, release, and run the frame.
 *
 * Both edges fall inside the one region, which is what specs/ui.md requires of a
 * confirm. The press and its release arrive on one frame, and that frame
 * confirms.
 */
export async function clickMenuItem(
  h: Harness,
  index: number,
  options: PointerOptions = {},
): Promise<void> {
  const at = menuCenter(h, index);
  h.pointerMove(at.x, at.y, options);
  h.pointerDown(at.x, at.y, options);
  h.pointerUp(at.x, at.y, options);
  await h.advance(1);
}

/**
 * Tap item `index` with a finger: land on it, lift off it, and run the frame.
 *
 * No move in front of the landing, because a finger does not hover — which is
 * why specs/ui.md makes the LANDING select the item as well as confirm it. The
 * contact carries `pointerType: "touch"`, so a build that reads the device sees
 * a finger rather than a mouse.
 */
export async function touchMenuItem(
  h: Harness,
  index: number,
  options: PointerOptions = {},
): Promise<void> {
  const at = menuCenter(h, index);
  const touch: PointerOptions = { device: "touch", ...options };
  h.pointerDown(at.x, at.y, touch);
  h.pointerUp(at.x, at.y, touch);
  await h.advance(1);
}

/**
 * Press on item `from`, travel onto item `to`, and release there.
 *
 * The ordinary affordance that lets a player slide off a control to cancel: two
 * edges in different regions confirm nothing (specs/ui.md). Driven over separate
 * frames so the press, the travel and the release are each read.
 */
export async function dragBetweenMenuItems(
  h: Harness,
  from: number,
  to: number,
  options: PointerOptions = {},
): Promise<void> {
  const start = menuCenter(h, from);
  const end = menuCenter(h, to);
  h.pointerDown(start.x, start.y, options);
  await h.advance(1);
  h.pointerMove(end.x, end.y, options);
  await h.advance(1);
  h.pointerUp(end.x, end.y, options);
  await h.advance(1);
}

/* ---- Goals ---------------------------------------------------------------- */

/** The lane down the middle of the field, level with the ball's home point. */
export const CLEAR_LANE_Y = FIELD_CY;

/**
 * Live play over one ball and an empty field, with that ball aimed at one goal
 * edge down the middle lane and both paddles held out of it.
 *
 * `edge` is the edge the ball exits: "right" scores for player one, "left" for
 * player two. The obstacles are not on the field, so the flight is a straight
 * line and nothing but the goal edge can end it.
 */
export async function arrangeGoal(
  h: Harness,
  edge: Side,
  options: { mode?: Mode; speed?: number } = {},
): Promise<void> {
  await openIsolatedPlay(h, { mode: options.mode });
  parkPaddles(h);
  const speed = options.speed ?? 600;
  const ops = ballOps(h);
  ops.setBallPosition(FIELD_CX, CLEAR_LANE_Y);
  ops.setBallVelocity(edge === "right" ? speed : -speed, 0);
  ops.setBallSpin(0);
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

/* ---- Paddle contact ------------------------------------------------------- */

/** Where a ball is posed to sit just off a paddle's front face. */
export function nearBallX(side: Side): number {
  return side === "left" ? P1_X1 + BALL_R + 10 : P2_X0 - BALL_R - 10;
}

/**
 * How far in front of a paddle contact the ball is posed, in frames of approach.
 *
 * The contact itself is the same one a zero-lead pose makes immediately; the
 * run-up buys the scenario a real approach, and — because a driven paddle's
 * `drivenVy` persists — it is also what lets a SWINGING paddle be moving at the
 * moment it strikes, having travelled the same distance the ball did.
 */
export const LEAD_TICKS = 60; // 0.5 s at 120 Hz

export interface PaddleHitOptions {
  /** The mode the match is opened in. Defaults to Versus. */
  mode?: Mode;
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
 * Pose a contact on `side` over an isolated field: that paddle at `cy` moving at
 * `vy`, the other parked, and one ball aimed straight at the struck paddle's
 * front face at `ballY`.
 *
 * With a lead, the paddle starts the run-up's worth of travel UPSTREAM so it
 * arrives at `cy` as the ball does — which is what lets a swinging paddle really
 * be moving at contact rather than pinned against a bound.
 */
export async function arrangePaddleHit(
  h: Harness,
  side: Side,
  options: PaddleHitOptions = {},
): Promise<void> {
  const {
    cy = FIELD_CY,
    vy = 0,
    ballY = FIELD_CY,
    approachSpeed = 400,
    startX,
    leadTicks = 0,
  } = options;

  await openIsolatedPlay(h, { mode: options.mode });

  const other: Side = side === "left" ? "right" : "left";
  const lead = seconds(leadTicks);
  drivePaddle(h, side, { cy: cy - vy * lead, vy });
  parkPaddle(h, other);

  const near = nearBallX(side);
  const runUp = approachSpeed * lead;
  const x = startX ?? (side === "left" ? near + runUp : near - runUp);
  const ops = ballOps(h);
  ops.setBallPosition(x, ballY);
  ops.setBallVelocity(side === "left" ? -approachSpeed : approachSpeed, 0);
  ops.setBallSpin(0);
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

/* ---- Rally speed ---------------------------------------------------------- */

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
 * Two still, centred paddles and one ball launched level down the middle, over
 * an otherwise empty field.
 *
 * The obstacles are off the field, so every direction reversal the rally sees is
 * a paddle hit and the speeds read back are the ones the paddle rule set.
 */
export async function arrangeRally(
  h: Harness,
  options: { mode?: Mode; speed?: number } = {},
): Promise<void> {
  await openIsolatedPlay(h, { mode: options.mode });
  drivePaddle(h, "left", { cy: FIELD_CY, vy: 0 });
  drivePaddle(h, "right", { cy: FIELD_CY, vy: 0 });
  const ops = ballOps(h);
  ops.setBallPosition(FIELD_CX, FIELD_CY);
  ops.setBallVelocity(-(options.speed ?? RALLY_LAUNCH_SPEED), 0);
  ops.setBallSpin(0);
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

/* ---- Held movement -------------------------------------------------------- */

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
 *
 * Nothing here takes a paddle from the player, so the paddles respond exactly as
 * they do for one. A scenario reaching this point through
 * {@link stageMatchStart} has left both under player control, which is the whole
 * reason the surface no longer carries an operation that opens a match AND seizes
 * them.
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

/* ---- The Solo AI ---------------------------------------------------------- */

/**
 * A live Solo match over one ball and an empty field, with the human paddle
 * parked, the ball posed by `ball`, and the AI's paddle started at `paddleCy`
 * and left under the AI.
 *
 * The AI's paddle is RELEASED rather than driven, and its two faculties are left
 * where `reset` put them — both on. What runs from here is the real opponent
 * against the posed shot. A check about one faculty alone holds the other with
 * {@link gateAi}.
 */
export async function arrangeAiScenario(
  h: Harness,
  scenario: {
    paddleCy: number;
    ball: { x: number; y: number; vx: number; vy?: number };
  },
): Promise<void> {
  await openIsolatedPlay(h, { mode: "solo" });
  parkPaddle(h, "left");
  releasePaddles(h, ["right"]);
  placePaddle(h, "right", scenario.paddleCy);
  const ops = ballOps(h);
  ops.setBallPosition(scenario.ball.x, scenario.ball.y);
  ops.setBallVelocity(scenario.ball.vx, scenario.ball.vy ?? 0);
  ops.setBallSpin(0);
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
export async function arrangeAiChase(
  h: Harness,
  options: { paddleCy?: number; ballY?: number } = {},
): Promise<void> {
  await arrangeAiScenario(h, {
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
export async function arrangeAiMovingHit(h: Harness): Promise<void> {
  await arrangeAiScenario(h, {
    paddleCy: 180, // above the lane
    ball: { x: 1072, y: FIELD_CY, vx: 500 },
  });
}

/* ---- Obstacle bank shots --------------------------------------------------- */

/**
 * Line one ball up 180 px short of `faceX`, level with the obstacle at `y`,
 * travelling straight at that face, over a field holding that obstacle alone.
 *
 * `from` is the side the ball approaches from. The other obstacle is off the
 * field, so a shot that missed the struck face cannot bank off it instead and
 * read as this check's rebound.
 */
export async function arrangeObstacleBounce(
  h: Harness,
  shot: {
    /** Which obstacle stays on the field, in the order of `OBSTACLE_CENTERS`. */
    obstacle?: number;
    faceX: number;
    y: number;
    from: Side;
    speed?: number;
    mode?: Mode;
  },
): Promise<void> {
  const obstacle = shot.obstacle ?? 0;
  await openIsolatedPlay(h, {
    mode: shot.mode,
    contents: { balls: 1, obstacles: [obstacle] },
  });
  holdObstacleClock(h, 0);
  // One frame, so a gyre build has recomputed the obstacle's pose from the held
  // clock before the shot is aimed at where the case says the face is.
  await h.advance(1);
  parkPaddles(h);
  const speed = shot.speed ?? 600;
  const ops = ballOps(h);
  ops.setBallPosition(
    shot.from === "left" ? shot.faceX - 180 : shot.faceX + 180,
    shot.y,
  );
  ops.setBallVelocity(shot.from === "left" ? speed : -speed, 0);
  ops.setBallSpin(0);
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

/* ---- A ball in open flight ------------------------------------------------- */

/**
 * A live match with one ball posed in mid-flight over an otherwise empty field,
 * so a short flight is a straight line. Spin is zeroed so the path is
 * predictable, and both paddles are held out of the lane.
 *
 * A scenario that needs an obstacle on the field names it in `contents` and
 * holds the obstacle clock itself.
 */
export async function arrangeLiveBall(
  h: Harness,
  ball: { x: number; y: number; vx: number; vy?: number },
  options: { mode?: Mode; contents?: FieldContents } = {},
): Promise<void> {
  await openIsolatedPlay(h, {
    mode: options.mode,
    contents: options.contents,
  });
  parkPaddles(h);
  const ops = ballOps(h);
  ops.setBallPosition(ball.x, ball.y);
  ops.setBallVelocity(ball.vx, ball.vy ?? 0);
  ops.setBallSpin(0);
}

/* ========================================================================== */
/* Rendering, input, audio, pause and UI                                      */
/* ========================================================================== */
//
// The second half of the suite — the checks that read what was DRAWN, what was
// PLAYED, and what the keyboard did — needs three things the scenario helpers
// above do not provide: a cue record stamped with the frame each cue fired on,
// a colour sampler over the rendered canvas, and a way to ask what a single
// frame's render actually asked the context for. The palette is the build's
// own (specs/overview.md), so nothing here knows a colour: the samplers compare
// one point painted against the same point with the field bare under it. They are
// gathered here rather than folded in above so the two halves of this file stay
// separable.

import {
  OBSTACLE_CENTERS,
  P1_X0,
  P2_X1,
  PADDLE_MIN_CY,
  TRAIL_TIME,
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
 * The engine publishes `cue:played` synchronously from inside `audio.play`, so
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
 * Where {@link arrangeBareScene} sends the ball instead: down near the bottom of
 * the field, clear of every point {@link COLOR_POINTS} names.
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
 * Pose a clean, static colour scene and paint it: a live match over one ball and
 * both obstacles, with the paddles centred and held still and the ball parked at
 * the mid-field sample point, so each sample point renders an unobstructed,
 * solid body.
 *
 * The field holds exactly what {@link COLOR_POINTS} samples and nothing else:
 * one ball rather than `multi`'s three, so the two the scene is not about cannot
 * drift across a sample point. The obstacle clock is held at `0`, so under
 * `gyre` the obstacle sits at the base centre the sample point names rather than
 * a fraction of a sway away from it.
 *
 * The settle is longer than the trail's own life on purpose. Posing the ball
 * teleports it, and the samples it left along the way would otherwise still be
 * drawn as a streak across the field; a still ball for `TRAIL_TIME` retires
 * every one of them, so what is sampled is the ball rather than its wake.
 */
export async function arrangeColorScene(h: Harness): Promise<void> {
  await openIsolatedPlay(h, {
    mode: "versus",
    contents: { balls: 1, obstacles: ALL_OBSTACLES },
  });
  holdObstacleClock(h, 0);
  drivePaddle(h, "left", { cy: FIELD_CY, vy: 0 });
  drivePaddle(h, "right", { cy: FIELD_CY, vy: 0 });
  const ops = ballOps(h);
  ops.setBallPosition(COLOR_POINTS.ball.x, COLOR_POINTS.ball.y);
  ops.setBallVelocity(0, 0);
  ops.setBallSpin(0);
  await h.advance(Math.ceil(TRAIL_TIME * TICK_HZ) + 4);
}

/**
 * Pose the same match with the field bare under every point
 * {@link COLOR_POINTS} names, so those points can be read a second time with
 * nothing standing on them.
 *
 * The obstacles are left off the field outright and the ball goes to
 * {@link BARE_BALL_AT}, with the same settle {@link arrangeColorScene} takes so
 * its wake is retired again. One ball is left on the field rather than none,
 * because an empty field is a state the match rules are free to serve into. Both
 * paddles go to `PADDLE_MIN_CY`, the top of the travel specs/playfield.md gives
 * them: a paddle centred there spans the field's top 110 units, which clears the
 * mid-field row {@link COLOR_POINTS} samples it on outright.
 */
export async function arrangeBareScene(h: Harness): Promise<void> {
  await openIsolatedPlay(h, {
    mode: "versus",
    contents: { balls: 1, obstacles: [] },
  });
  drivePaddle(h, "left", { cy: PADDLE_MIN_CY, vy: 0 });
  drivePaddle(h, "right", { cy: PADDLE_MIN_CY, vy: 0 });
  const ops = ballOps(h);
  ops.setBallPosition(BARE_BALL_AT.x, BARE_BALL_AT.y);
  ops.setBallVelocity(0, 0);
  ops.setBallSpin(0);
  await h.advance(Math.ceil(TRAIL_TIME * TICK_HZ) + 4);
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
 * Every point a frame's drawing calls named, in the space the game draws in.
 *
 * The pipeline sets the world-to-device transform on the context before a
 * component draws, so the coordinates a drawing call carries are the game's own
 * — and with the camera at its defaults those are logical units. A trail is a
 * sequence of draws rather than one shape, so where a render put its geometry
 * is the direct reading of it: the coordinates behind the ball are the trail,
 * and the ones at the ball are the ball. The leading pair of arguments is the
 * position for every method listed, except the curve calls, whose control
 * points come first and whose endpoint is the last pair.
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
 * A build may anchor its text through any transform the pipeline or its own
 * drawing applies and align it any way it likes, so the anchor is mapped
 * through the transform the context held at the call and the run is extended
 * about it by its measured width and `textAlign`. Which way a `start`/`end`
 * alignment reads is the page's direction; this game draws no right-to-left
 * text, so they are left and right.
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

/* ---- The AI with nothing to defend ---------------------------------------- */

/**
 * A live Solo match with the ball travelling AWAY from the AI paddle, posed far
 * from anything it could strike, and the AI paddle posed well off its home
 * height, so what the real opponent does from here is governed by the homing
 * rule alone (specs/modes/single-player.md).
 */
export async function arrangeAiHome(
  h: Harness,
  options: { paddleCy: number },
): Promise<void> {
  await arrangeAiScenario(h, {
    paddleCy: options.paddleCy,
    ball: { x: 1100, y: 200, vx: -300 },
  });
}

/* ---- A shot at one obstacle face ------------------------------------------ */

/** Which face of an axis-aligned obstacle a shot is aimed at. */
export type Face = "left" | "right" | "top" | "bottom";

/**
 * Live play over one ball and obstacle `obstacle` alone, with a straight shot
 * posed at the midpoint of that obstacle's `face`, starting `runUp` units short
 * of it and travelling at `speed`, and both paddles held out of the way.
 *
 * The rectangle is the case's own `OBSTACLES[obstacle]` rather than one the
 * caller passes, so the face a shot is aimed at is the face specs/playfield.md
 * puts there, and the obstacle spawned is the one the shot is aimed at. The
 * other obstacle is off the field, so a shot that missed cannot bank off it and
 * read as this check's rebound.
 *
 * The obstacle clock is held at `0` and one frame advanced before the ball is
 * posed, so under `gyre` the obstacle is standing at that rectangle rather than
 * partway through a sway.
 *
 * Returns the velocity the shot leaves at, which is what a check compares the
 * rebound against.
 */
export async function arrangeFaceShot(
  h: Harness,
  obstacle: number,
  face: Face,
  options: { runUp?: number; speed?: number; mode?: Mode } = {},
): Promise<{ vx: number; vy: number }> {
  const runUp = options.runUp ?? 180;
  const speed = options.speed ?? 600;
  const rect = OBSTACLES[obstacle];
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

  await openIsolatedPlay(h, {
    mode: options.mode,
    contents: { balls: 1, obstacles: [obstacle] },
  });
  holdObstacleClock(h, 0);
  await h.advance(1);
  parkPaddles(h);
  const ops = ballOps(h);
  ops.setBallPosition(shot.x, shot.y);
  ops.setBallVelocity(shot.vx, shot.vy);
  ops.setBallSpin(0);
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
  await arrangeLiveBall(h, {
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
  const ops = ballOps(h);
  ops.setBallPosition(TRAIL_START_X, TRAIL_LANE_Y);
  ops.setBallVelocity(speed, 0);
  ops.setBallSpin(0);
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
