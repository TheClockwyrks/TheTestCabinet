// Volute — the shared validator harness. CASE-PROVIDED.
//
// Every check in this suite is an ordinary vitest test that runs IN THE SAME
// PROCESS as the build. It imports the engine and the build's own modules,
// creates an engine over a canvas it owns and a clock it chose, and steps the
// game with `engine.advance`. Nothing drives a browser, nothing polls, and no
// wall-clock time passes: a check asks for a number of ticks and gets exactly
// that number, at exactly the deltas its clock supplied.
//
// WHAT A CHECK READS. The game's own state (through the debug surface's
// `snapshot`), the engine's frame counter, the cues the engine broadcast, the
// operations the build issued against its 2D context, and the pixels those
// operations left on the canvas. Nothing here fabricates an outcome: the
// scenario helpers below only ARRANGE the hall through the surface, and the real
// frames the build wrote are what run from there.
//
// WHERE THE SURFACE COMES FROM. Off `engine.debug`, never built here. The game
// instance's `initialize` returns it (`specs/instrumentation.md`), the engine
// holds that same object, and reading it back off the engine is the only way a
// surface reaches a check — so a build that returned no surface, or a surface
// missing an operation, fails the checks that reach the hall through it. See
// {@link readDebugSurface}.
//
// HOW THE SURFACE IS DRIVEN. Directly, and synchronously. Under this engine "A
// pose takes only the parameters its heading names and returns nothing; a
// reading takes none and returns what it read", and each acts on the live world
// at the moment of the call — so a pose is `h.debug.setPressure(50)` and a
// reading is `h.snapshot()`, with nothing in between. One consequence is worth
// stating once, here: a pose that OPENS A LEVEL (`reset`, `start`,
// `startLevel`) "takes effect no later than the end of the next advanced frame",
// so a scenario poses, advances one frame, and only then poses further, presses
// a key, or reads. {@link poseHall} and {@link startRun} carry those advances so
// a check never counts them.
//
// THE CLOCK IS THE SUITE'S, AND A TICK IS THE UNIT.
// `specs/instrumentation.md`: "A `ConstantClock` of `1000 / 60` milliseconds
// makes one frame exactly one simulation step of `1 / 60` second, which is the
// step a scenario advances the engine by." So one `advance` is one tick worth
// exactly `TICK_DT`, a count of ticks converts to simulated seconds with no
// rounding, and every duration in this project is written as a tick count. The
// one check that is ABOUT the engine running itself (`channel/self-advancing`)
// hands the loop back with {@link Harness.runFor}.
//
// THE HOST THE BUILD IS STOOD UP OVER. A browser game runs on a page; this runs
// in Node, so the four browser facilities the build's own loading needs are
// supplied here and nowhere else: `fetch` serves the produced files out of
// `public/` exactly as a static host would, `createImageBitmap` decodes a PNG
// through the same canvas library the engine draws into, `AudioContext` decodes
// a `.wav`, and `ImageBitmap` names the decoded type so the engine's recorder
// carries the produced sprites it drew. None of them changes what the build
// does: they are the page, not the game.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import {
  createCanvas,
  loadImage,
  Image,
  type Canvas,
  type SKRSContext2D,
} from "@napi-rs/canvas";
import { expect, vi } from "vitest";
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
  type GameDefinition,
  type PathSegment,
  type RecordedFrame,
  type Recording,
  type Resource,
  type SurfaceMetrics,
  type Viewport,
} from "@test-cabinet/structured-2d";
import { BACKGROUND, game as build } from "../src/game";
import { assertTruthy, fail } from "./assert";
import {
  CHANNEL,
  CHANNEL_ARC,
  CORE_RADIUS,
  DEFAULT_SEED,
  FIELD_H,
  FIELD_W,
  INJECTOR,
  PATH_LENGTH,
  REQUIRED_OPS,
  SPACING,
  TICK_HZ,
  TICK_MS,
  UNBOUND_KEY,
  type ChargeId,
  type MachineryKind,
  type Point,
  type ScreenName,
} from "./constants";

/* -------------------------------------------------------------------------- */
/* The contract the build owes                                                */
/* -------------------------------------------------------------------------- */

/** One core of the train, as `snapshot()` reports it. */
export interface TrainCore {
  /** The arc position, from the inlet along the channel polyline. */
  s: number;
  /** The field point that arc position gives. */
  x: number;
  y: number;
  charge: ChargeId;
  mark: MachineryKind | null;
  /** `0` is the lead segment, rising toward the tail. */
  segment: number;
}

/** One segment, as `snapshot()` reports it. */
export interface SegmentView {
  count: number;
  /** The recoil hold's seconds left. */
  hold: number;
}

/** One projectile, as `snapshot()` reports it. */
export interface ProjectileView {
  x: number;
  y: number;
  /** The heading it was fired along, in degrees. */
  angle: number;
  charge: ChargeId;
}

/** The injector, as `snapshot()` reports it. */
export interface InjectorView {
  aim: number;
  cooldown: number;
  loaded: ChargeId | null;
  queued: ChargeId | null;
}

/** The timed machinery in force, as `snapshot()` reports it. */
export interface MachineryView {
  kind: MachineryKind;
  remaining: number;
}

/**
 * The state a snapshot reports, as `specs/instrumentation.md` documents it under
 * "Snapshot shape".
 *
 * "The shape is fixed, and every field is present whatever the screen."
 */
export interface VoluteSnapshot {
  version: number;
  screen: ScreenName;
  score: number;
  level: number;
  cells: number;
  /** The cores the inlet has left to emit this level. */
  quotaRemaining: number;
  /** The level's quota less `quotaRemaining`. */
  emitted: number;
  pressure: number;
  /** The effective feed speed, in units/s. */
  feedSpeed: number;
  chainStep: number;
  /** Seconds left before the step returns to 1. */
  chainTimer: number;
  /** Seconds left of the interlude, else 0. */
  interlude: number;
  danger: boolean;
  /** Every core on the channel, head first. */
  train: TrainCore[];
  /** The segments, head first, entry 0 the lead segment. */
  segments: SegmentView[];
  injector: InjectorView;
  /** Every projectile, oldest first. */
  projectiles: ProjectileView[];
  machinery: MachineryView | null;
  muted: boolean;
  /** Accumulated simulation time, in seconds. */
  simTime: number;
  rngState: number;
}

/**
 * One core as `poseTrain` takes it: `[s, charge, mark]`.
 *
 * "`s` is an arc position, clamped to at most `5000`; `charge` is one of the five
 * charge ids; and `mark` is one of the four machinery kinds or `null` for an
 * unmarked core."
 */
export type PosedCore = [
  s: number,
  charge: ChargeId,
  mark: MachineryKind | null,
];

/**
 * The operations a check poses the hall through, exactly as
 * `specs/instrumentation.md` specifies them for this engine.
 *
 * Each is a method on the live game: a pose takes only the arguments its heading
 * names and returns nothing, and a reading takes none and returns plain data.
 * The engine owns the clock, the keyboard, the pointer and the overlay, so the
 * surface carries no operation for any of them.
 */
export interface VoluteDebugApi {
  /** `VOLUTE_DEBUG_VERSION`, a plain number. */
  version: number;
  /** Restore every declared field to its title value and reseed the generator. */
  reset(options?: { seed?: number }): void;
  /** A pure read of the running game. */
  snapshot(): VoluteSnapshot;
  /** Pose what the start control on the title does: score 0, cells full, level 1. */
  start(): void;
  /** Open `level`, exactly as the interlude before it opens it. */
  startLevel(level: number): void;
  /** Replace every core on the channel with the cores given. */
  poseTrain(cores: readonly PosedCore[]): void;
  /** Remove every core from the channel and every projectile. */
  clearTrain(): void;
  /** Set the charge the injector holds loaded. The generator is untouched. */
  setLoaded(charge: ChargeId): void;
  /** Set the charge the injector holds queued. The generator is untouched. */
  setQueued(charge: ChargeId): void;
  /** Aim at `angleDegrees` and release the loaded core along it. Always launches. */
  fire(angleDegrees: number): void;
  /** Set the pressure, clamped to 0 through 100. */
  setPressure(value: number): void;
  /** Set the cores the inlet has left to emit this level. */
  setQuotaRemaining(n: number): void;
  /** Grant a kind exactly as extracting a run holding that mark grants it. */
  grantMachinery(kind: MachineryKind): void;
  /** Pose the pause control: the screen becomes `paused`. */
  pause(): void;
  /** Pose it again: the screen returns to `playing`. */
  resume(): void;
}

/**
 * The build's game, typed against the surface the CASE specifies.
 *
 * The build declares its own type for the surface its instance's `initialize`
 * returns — the `D` of its `GameInstance<D>` — and that type is the build's:
 * what a check holds it to is `specs/instrumentation.md`, so the definition is
 * cast to the case's `GameDefinition<VoluteDebugApi>` here and the engine is
 * parameterized with it. A surface that departs from the specification is caught
 * where a check reaches for the missing member, not by the build's own compiler.
 */
const game = build as unknown as GameDefinition<VoluteDebugApi>;

/* -------------------------------------------------------------------------- */
/* Reading a snapshot                                                         */
/* -------------------------------------------------------------------------- */
//
// The train is reported head first, so `train[0]` is the head and the last entry
// is the tail. These name that rather than leaving every suite to remember it,
// and each of them FAILS the point when the reading is not there — a build whose
// snapshot reports no train at all is a build whose surface cannot be driven, and
// `writing-debug-apis-and-validators` puts that on the point rather than leaving
// it undecided.

/** The head: the core with the greatest arc position. */
export function head(snapshot: VoluteSnapshot): TrainCore {
  const core = snapshot.train?.[0];
  assertTruthy(
    core,
    "a core on the channel, reported head first as snapshot().train " +
      "(specs/instrumentation.md)",
  );
  return core as TrainCore;
}

/** The tail: the core with the least arc position. */
export function tail(snapshot: VoluteSnapshot): TrainCore {
  const train = snapshot.train ?? [];
  const core = train[train.length - 1];
  assertTruthy(
    core,
    "a core on the channel, reported head first as snapshot().train " +
      "(specs/instrumentation.md)",
  );
  return core as TrainCore;
}

/** How many cores stand on the channel. */
export function coreCount(snapshot: VoluteSnapshot): number {
  return snapshot.train?.length ?? 0;
}

/** Every core's arc position, head first. */
export function arcPositions(snapshot: VoluteSnapshot): number[] {
  return (snapshot.train ?? []).map((core) => core.s);
}

/** Every core's charge, head first. */
export function charges(snapshot: VoluteSnapshot): ChargeId[] {
  return (snapshot.train ?? []).map((core) => core.charge);
}

/** Every core carrying a mark, head first. */
export function markedCores(snapshot: VoluteSnapshot): TrainCore[] {
  return (snapshot.train ?? []).filter((core) => core.mark !== null);
}

/**
 * The core nearest arc position `s`, or `undefined` on an empty channel.
 *
 * What a check that posed a core and then let the hall run reads it back with:
 * the core moved, so its index may have moved too, and its arc position is the
 * thing that identifies it.
 */
export function coreNear(
  snapshot: VoluteSnapshot,
  s: number,
): TrainCore | undefined {
  let best: TrainCore | undefined;
  let bestGap = Infinity;
  for (const core of snapshot.train ?? []) {
    const gap = Math.abs(core.s - s);
    if (gap < bestGap) {
      bestGap = gap;
      best = core;
    }
  }
  return best;
}

/** The core carrying `charge`, or `undefined` — the train holds at most one. */
export function coreWithCharge(
  snapshot: VoluteSnapshot,
  charge: ChargeId,
): TrainCore | undefined {
  return (snapshot.train ?? []).find((core) => core.charge === charge);
}

/** Every projectile in flight, as `snapshot().projectiles` reports them. */
export function projectiles(snapshot: VoluteSnapshot): ProjectileView[] {
  return snapshot.projectiles ?? [];
}

/** How many projectiles are in flight. */
export function projectileCount(snapshot: VoluteSnapshot): number {
  return projectiles(snapshot).length;
}

/** Seconds of simulated time in `ticks` ticks. */
export function seconds(ticks: number): number {
  return ticks / TICK_HZ;
}

/** Whole ticks covering `duration` seconds, rounded up. */
export function ticksFor(duration: number): number {
  return Math.ceil(duration * TICK_HZ);
}

/** An arc gain measured over `ticks` ticks, as a speed in units/s. */
export function speedOverTicks(gain: number, ticks: number): number {
  return (gain * TICK_HZ) / ticks;
}

/* -------------------------------------------------------------------------- */
/* The channel's geometry                                                     */
/* -------------------------------------------------------------------------- */
//
// Computed from the twelve vertices `specs/channel.md` lists, by the rule that
// file states, so a check can say where an arc position IS without asking the
// build. That is the point: `channel/arc-position` compares the field point the
// build reports for an arc position against the point the specification puts it
// at, and a shot is aimed at a place on the channel the same way.

/** The leg an arc position lies on: the greatest start arc not exceeding `s`. */
function legFor(s: number): number {
  const last = CHANNEL.length - 2;
  if (!(s > 0)) return 0;
  for (let i = last; i >= 0; i -= 1) {
    if (s >= CHANNEL_ARC[i]) return i;
  }
  return 0;
}

/**
 * The field point at arc position `s`, as `specs/channel.md` walks it:
 * `point = leg.start + leg.direction x (s - a)`.
 *
 * "An arc position below `0` selects the first leg as well: its point is the
 * inlet", and at `PATH_LENGTH` the final leg is the one selected.
 */
export function channelPoint(s: number): Point {
  const leg = legFor(s);
  const from = CHANNEL[leg];
  const to = CHANNEL[leg + 1];
  const length = CHANNEL_ARC[leg + 1] - CHANNEL_ARC[leg];
  const along = Math.max(0, s) - CHANNEL_ARC[leg];
  return {
    x: from.x + ((to.x - from.x) / length) * along,
    y: from.y + ((to.y - from.y) / length) * along,
  };
}

/** `forward(s)`: the unit direction of the leg the same rule selects. */
export function channelForward(s: number): Point {
  const leg = legFor(s);
  const from = CHANNEL[leg];
  const to = CHANNEL[leg + 1];
  const length = CHANNEL_ARC[leg + 1] - CHANNEL_ARC[leg];
  return { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
}

/** Straight-line distance between two field points. */
export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * The aim, in degrees, that points the injector at a field point.
 *
 * "every angle is in degrees measured from `+x` and increasing toward `+y`", so
 * this is `atan2` in the field's own convention, normalized into `[0, 360)`.
 */
export function aimAt(target: Point, from: Point = INJECTOR): number {
  const degrees =
    (Math.atan2(target.y - from.y, target.x - from.x) * 180) / Math.PI;
  return ((degrees % 360) + 360) % 360;
}

/**
 * The signed shortest turn from one bearing to another, in degrees.
 *
 * Negative counter-clockwise, positive clockwise, always in `(-180, 180]`. What a
 * check reads a turn with rather than subtracting two bearings, because
 * `specs/injector.md` wraps the aim "continuously through a full turn" — so a
 * turn that crosses the seam between 359 and 0 is still one small turn, and a
 * bare subtraction would call it a large one.
 */
export function signedTurn(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

/** A field point `units` from `from` along `angleDegrees`. */
export function alongAim(
  angleDegrees: number,
  units: number,
  from: Point = INJECTOR,
): Point {
  const radians = (angleDegrees * Math.PI) / 180;
  return {
    x: from.x + Math.cos(radians) * units,
    y: from.y + Math.sin(radians) * units,
  };
}

/**
 * A spaced list of cores for `poseTrain`, head first.
 *
 * `charges[0]` takes `headS` and each one after it sits {@link SPACING} behind
 * the one before, which is what makes the list ONE segment: "A **segment** is a
 * maximal run of consecutive cores in the train whose arc positions differ by
 * exactly `SPACING`". A `marks` entry is the mark of the core at the same index.
 */
export function spacedRun(
  headS: number,
  runCharges: readonly ChargeId[],
  marks: readonly (MachineryKind | null)[] = [],
): PosedCore[] {
  return runCharges.map((charge, index) => [
    headS - index * SPACING,
    charge,
    marks[index] ?? null,
  ]);
}

/** `count` cores of one charge, spaced into one segment with its head at `headS`. */
export function spacedBlock(
  headS: number,
  count: number,
  charge: ChargeId,
): PosedCore[] {
  return spacedRun(
    headS,
    Array.from({ length: count }, () => charge),
  );
}

/* -------------------------------------------------------------------------- */
/* The harness                                                                */
/* -------------------------------------------------------------------------- */

/** One recorded operation on the 2D context, in the order the render made it. */
export type DrawCall =
  | { kind: "call"; method: string; args: unknown[] }
  | { kind: "set"; property: string; value: unknown };

/**
 * A bitmap source a frame named.
 *
 * `id` is identity WITHIN ONE HARNESS: the same decoded sprite drawn on a
 * hundred frames carries one id, and two different produced sprites never share
 * one. `width` and `height` are the source's own natural size, which is how a
 * 28 x 28 core sprite is told from a 24 x 24 HUD icon. `srcHash` is a digest of
 * the BYTES the source was decoded from, present on every source that came off
 * disk and absent on a canvas the build painted itself — which is what separates
 * a produced file from geometry drawn in code, without ever matching a path
 * under `assets/`.
 */
export interface ImageRef {
  id: number;
  /** `"bitmap"` for anything a canvas can draw, `"pixels"` for an `ImageData`. */
  kind: "bitmap" | "pixels";
  /** The host type, such as `Image` or `Canvas`. */
  name: string;
  width: number;
  height: number;
  src: string | null;
  srcHash: string | null;
}

/** A sound the build emitted, and the tick of the drive it emitted it on. */
export interface TimedCue {
  /** The cue's name, as the build asked the engine's bus for it. */
  cue: string;
  /** The tick it sounded on, 1-based, as {@link Harness.tick} counts them. */
  tick: number;
  /** The simulated time at that tick, in milliseconds. */
  t: number;
  /** The gain it sounded at: zero while the bus is muted. */
  gain: number;
  /** Whether it started a loop rather than playing once. */
  looped: boolean;
}

export interface HarnessOptions {
  /** The canvas's laid-out CSS width. Defaults to the logical field width. */
  cssWidth?: number;
  /** The canvas's laid-out CSS height. Defaults to the logical field height. */
  cssHeight?: number;
  /** Device pixels per CSS pixel. Defaults to 1, so one device pixel is one unit. */
  dpr?: number;
  /** The seed the opening `reset` is given. Defaults to `DEFAULT_SEED`. */
  seed?: number;
  /** The clock each frame takes its delta from. Defaults to 60 Hz. */
  clock?: Clock;
}

/** How far a sweep may run, and how many ticks separate two samples. */
export interface UntilOptions {
  maxTicks?: number;
  poll?: number;
}

/** What a sweep found: whether the predicate ever held, and where it stopped. */
export interface UntilResult {
  hit: boolean;
  /** Ticks stepped before the sample that ended the sweep. */
  ticks: number;
  snapshot: VoluteSnapshot;
}

/**
 * A rectangle of pixels, read back as RGBA rows.
 *
 * `data` is four bytes per pixel, row-major, so the pixel at `(x, y)` starts at
 * `(y * width + x) * 4`.
 */
export interface PixelRect {
  width: number;
  height: number;
  /** RGBA, four bytes per pixel, row-major. */
  data: Uint8ClampedArray;
}

export interface Harness {
  /** The engine the build is running on. For a check that needs the engine itself. */
  readonly engine: Engine<VoluteDebugApi>;
  /**
   * The surface the BUILD's instance returned from `initialize`, read off
   * `engine.debug` — see {@link readDebugSurface} — and driven directly: each
   * operation acts on the live world at the moment of the call.
   */
  readonly debug: VoluteDebugApi;
  /**
   * Why the build's surface cannot be driven, or `null` when it can.
   *
   * A fault here is the build's: `engine.debug` held no object, or the object it
   * held is missing an operation the specification requires. It says what was
   * found, and {@link failSurface} pairs it with what the specification
   * requires. Every operation fails by assertion with that pair rather than
   * throwing, so the fault lands on the points whose checks reach the hall
   * through the surface.
   */
  readonly surfaceFault: string | null;
  /**
   * The screen the build stood the game up on, read before anything reset it.
   *
   * `specs/ui.md` says of the title screen "The game opens here", which is a fact
   * about what a fresh game OPENS on and not about what a `reset` puts it back
   * to. Every check here runs after this harness's opening `reset`, so that half
   * of the requirement would be invisible without a reading taken first. `null`
   * when the surface could not be driven at all, which the surface fault itself
   * reports.
   */
  readonly openingScreen: VoluteSnapshot["screen"] | null;
  /** Every produced file the build asked for and did not get, oldest first. */
  readonly assetFailures: string[];
  /** The real 2D context, for `getImageData`. Draw calls also reach it. */
  readonly ctx: SKRSContext2D;
  /** The surface the engine drew into, holding the last frame that ran. */
  readonly canvas: Canvas;

  /** The frames this harness has advanced, as `engine.frame().count` counts them. */
  tick(): number;
  /** The simulated time those frames covered, in milliseconds. */
  timeMs(): number;

  /** A fresh read of the game's state through the build's `snapshot`. */
  snapshot(): VoluteSnapshot;
  /** Run `ticks` whole simulation ticks and read the state they left. */
  step(ticks?: number): Promise<VoluteSnapshot>;
  /** Step until `predicate` holds, sampling every `poll` ticks. */
  stepUntil(
    predicate: (snapshot: VoluteSnapshot) => boolean,
    options?: UntilOptions,
  ): Promise<UntilResult>;
  /**
   * Step one tick at a time, handing each tick's snapshot to `watch`, and stop
   * when it answers `true`.
   *
   * What a check about a CADENCE reads: the tick a core appears at the inlet, the
   * tick a cell is spent. The whole history is handed back, so a check can say
   * what happened on every tick before the one it stopped on.
   */
  stepWatching(
    ticks: number,
    watch?: (snapshot: VoluteSnapshot, tick: number) => boolean,
  ): Promise<VoluteSnapshot[]>;
  /**
   * Hand the engine its own frame loop and a real wall clock for `ms` of real
   * time, then take both back.
   *
   * The one thing in this file that depends on elapsed real time, and the only
   * reading of "the hall runs without being stepped" there is.
   */
  runFor(ms: number): Promise<void>;

  /** Press a key and leave it down, as a player holding it would. */
  hold(code: string): void;
  /** Release a key held by {@link hold}. */
  release(code: string): void;
  /**
   * Press a key, run the one tick that delivers its edge, and release it.
   *
   * "The engine closes the input frame after the frame renders", so a key held
   * across exactly one advanced frame is a press the build sees once. Exactly one
   * tick passes, so a caller's count moves by one.
   */
  tap(code: string): Promise<VoluteSnapshot>;
  /** Hold `code` for `ticks` ticks, then release it. */
  holdFor(code: string, ticks: number): Promise<VoluteSnapshot>;

  /** Move the pointer to a logical field point. Sets the aim on the next tick. */
  movePointer(x: number, y: number): void;
  /**
   * Press and release the pointer over the field, running one tick between.
   *
   * The pointer is moved to the point first, which also sets the aim — pass the
   * point the shot is aimed at.
   */
  clickPointer(x: number, y: number): Promise<VoluteSnapshot>;

  /** Run exactly one tick and hand back every operation its render issued. */
  frameCalls(): Promise<DrawCall[]>;
  /** Every operation the last advanced tick's render issued, without stepping. */
  lastCalls(): DrawCall[];
  /** Reflect the surface without invoking it: `typeof` for each name, and the version. */
  probe(names: readonly string[]): {
    version: unknown;
    ops: Record<string, string>;
  };

  /** How the field is mapped onto this harness's canvas. */
  viewport(): Viewport;
  /** Where a logical point lands in the canvas's backing store. */
  device(x: number, y: number): Point;
  /** The device pixel under a logical point, as `[r, g, b, a]`. */
  pixel(x: number, y: number): [number, number, number, number];
  /** Many logical points at once. */
  pixels(points: readonly Point[]): [number, number, number, number][];
  /**
   * A rectangle of the canvas, addressed in logical units and read back as RGBA.
   *
   * The rectangle is `width` x `height` LOGICAL units with its top-left at
   * `(x, y)`; at the harness's default shape that is one device pixel per unit,
   * so a 28 x 28 read is the 28 x 28 sprite the build drew there.
   */
  pixelRect(x: number, y: number, width: number, height: number): PixelRect;
  /** A pixel addressed in the canvas's own backing store, past the fit. */
  devicePixel(x: number, y: number): [number, number, number, number];
  /** The canvas's backing store size, as the engine sized it. */
  surface(): { width: number; height: number; dpr: number };

  /**
   * The RGBA bytes of a source a frame drew, by its {@link ImageRef} id.
   *
   * The produced file itself, at its own natural size, rather than the corner of
   * the field it landed on — which is what a check about a sprite's own pixels
   * needs. `null` when this harness never saw that source.
   */
  imagePixels(id: number): PixelRect | null;

  /** Give the build a gesture, so the engine's audio unlock runs. */
  armAudio(): void;

  /** Release anything held, and tear the engine down. */
  dispose(): Promise<void>;
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

/** A pointer-shaped event: the engine reads `clientX`, `clientY` and `isPrimary`. */
class PointerEvent extends Event {
  readonly clientX: number;
  readonly clientY: number;
  readonly isPrimary = true;

  constructor(type: string, x: number, y: number) {
    super(type);
    this.clientX = x;
    this.clientY = y;
  }
}

/** A decoded buffer stand-in: the engine only ever hands it to a node. */
class HeadlessAudioContext {
  decodeAudioData(): Promise<AudioBuffer> {
    return Promise.resolve({ duration: 1 } as unknown as AudioBuffer);
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}

/** This module's directory: the validator project's root. */
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * The repository root of the build this project is stood up over.
 *
 * The runner stages this directory to `validation/` inside the build's tree,
 * which is the one layout these suites ever run in: `../src/game` above resolves
 * against exactly that, and `public/` is served from beside it. Taken from this
 * module's own URL rather than from the working directory, so the suite runs the
 * same from any shell.
 */
const BUILD_ROOT = resolve(PROJECT_ROOT, "..");

/**
 * Serve one produced file out of `public/`, as a static host would.
 *
 * `specs/assets.md` has the build commit its produced files "under
 * `public/assets/`, which the engine serves at its asset root and the build
 * copies into `dist/` unchanged", so this is that host and nothing more: the
 * bytes on disk, at the path the engine resolved, with a 404 for anything the
 * build never produced.
 */
async function serveProduced(url: string): Promise<Response> {
  try {
    const bytes = readFileSync(join(BUILD_ROOT, "public", String(url)));
    return new Response(new Uint8Array(bytes), { status: 200 });
  } catch {
    return new Response(null, { status: 404 });
  }
}

/**
 * The surface the BUILD's instance returned from `initialize`, read off the
 * engine that holds it, or a stand-in that fails whatever reaches for it.
 *
 * This is deliberately a READ and never a construction. The surface is the
 * build's deliverable: its instance's `initialize` returns it
 * (`specs/instrumentation.md`), the engine keeps that same object, and
 * `engine.debug` is the only way it reaches a check. Nothing here could stand in
 * for it, because the build's own module for the surface is never imported.
 *
 * A build whose `initialize` returned nothing at all never reaches this: the
 * engine rejects `initialize` itself, naming the missing surface, and the
 * rejection fails the suite's `beforeEach` with the engine's own message. Such a
 * build does not run on the engine under any entry point, so it is not this
 * harness's fault to report. What IS decided here is a return that is no
 * surface, or one missing an operation: that is the build's fault and not the
 * harness's, so it is neither thrown from here — which would bury the verdict
 * under a failing hook — nor swallowed. {@link unexposedSurface} stands in and
 * fails, by assertion, at the moment a check first reaches for an operation.
 */
function readDebugSurface(engine: Engine<VoluteDebugApi>): {
  debug: VoluteDebugApi;
  fault: string | null;
} {
  let held: unknown;
  try {
    held = engine.debug;
  } catch (error) {
    const fault = `engine.debug could not be read: ${String(error)}`;
    return { debug: unexposedSurface(fault), fault };
  }
  if (typeof held !== "object" || held === null) {
    const fault = `engine.debug holds ${held === null ? "null" : typeof held}, not an object`;
    return { debug: unexposedSurface(fault), fault };
  }
  const target = held as Record<string, unknown>;
  const missing = REQUIRED_OPS.filter((op) => typeof target[op] !== "function");
  if (missing.length > 0) {
    const fault =
      `engine.debug holds a surface that carries no ` +
      missing.map((op) => `${op}()`).join(", ");
    return { debug: unexposedSurface(fault), fault };
  }
  return { debug: held as VoluteDebugApi, fault: null };
}

/**
 * A stand-in for a surface that is missing or incomplete: every operation on it
 * fails the check that reached for it, with the fault named.
 *
 * Keys that belong to the MACHINERY rather than to a check are answered with
 * `undefined` instead: awaiting a value probes `then`, and vitest's own error
 * formatting probes symbols and `constructor`. Failing those would replace the
 * verdict below with noise from the machinery that was trying to report it.
 */
function unexposedSurface(reason: string): VoluteDebugApi {
  return new Proxy({} as VoluteDebugApi, {
    get: (_target, property): unknown => {
      if (typeof property === "symbol") return undefined;
      if (property === "then" || property === "constructor") return undefined;
      return () => failSurface(reason);
    },
  });
}

/**
 * What `specs/instrumentation.md` requires of the surface: the `Expected:` line of
 * the failure a build with no usable surface lands on every check that reaches
 * for it, beside the {@link Harness.surfaceFault} that says what was found.
 */
export const SURFACE_REQUIREMENT =
  "a usable debug and automation surface returned from the game instance's " +
  "initialize and handed back by engine.debug, carrying every operation " +
  "specs/instrumentation.md requires";

/**
 * Fail the running check on `fault`, the harness's account of what is wrong
 * with the build's surface, paired with what the specification requires.
 */
export function failSurface(fault: string): never {
  return fail(SURFACE_REQUIREMENT, fault);
}

/* ---- Draw-call recording -------------------------------------------------- */

/**
 * Every bitmap source this suite has seen, and what is known about each.
 *
 * One table for the whole file rather than one per harness, because an id has to
 * mean the same thing to the check reading a frame and to the harness that
 * decoded the file: `createImageBitmap` is a global the harness stands in for
 * while it runs, so the decode and the reading are the same process. Ids are
 * handed out in order and never reused, so two different produced sprites never
 * share one and the same sprite drawn on a hundred frames carries one.
 */
const IMAGES = {
  /** The id given to each source, by identity. */
  ids: new WeakMap<object, number>(),
  /** Every source seen, by id. */
  held: new Map<number, object>(),
  /** The digest of the bytes each decoded source came from, by id. */
  hashes: new Map<number, string>(),
  next: 1,
};

/**
 * A proxy that records every call and property set on its way to the real
 * context, so one frame produces both a pixel buffer to sample and a call list
 * to inspect.
 *
 * Only the CURRENT frame's operations are held. The frame counter moves at the
 * top of every frame and the pipeline draws inside it, so an operation whose
 * frame number differs from the one before it opens a new bucket and drops the
 * one before that. A drive of ten thousand ticks therefore costs one frame of
 * operations rather than ten thousand.
 */
function recorder(
  target: SKRSContext2D,
  bucket: { frame: number; calls: DrawCall[] },
  frameCount: () => number,
): SKRSContext2D {
  const push = (call: DrawCall): void => {
    const now = frameCount();
    if (now !== bucket.frame) {
      bucket.frame = now;
      bucket.calls = [];
    }
    bucket.calls.push(call);
  };
  return new Proxy(target, {
    get(object, property) {
      const value = Reflect.get(object, property, object) as unknown;
      if (typeof value !== "function") return value;
      return (...args: unknown[]): unknown => {
        push({ kind: "call", method: String(property), args });
        return (value as (...rest: unknown[]) => unknown).apply(object, args);
      };
    },
    set(object, property, value) {
      push({ kind: "set", property: String(property), value });
      return Reflect.set(object, property, value, object);
    },
  });
}

/* ---- Building one --------------------------------------------------------- */

/**
 * Stand the build's game up on the engine over a canvas of the harness's own,
 * reset it to the title on a known seed, and hand back everything a check reads.
 *
 * The options handed to the factory are the ones the seeded `src/main.ts` hands
 * it — the logical design size and the build's exported `BACKGROUND` — plus the
 * clock and the `SurfaceMetrics` a headless run needs. Everything else the build
 * decided lives inside its own modules.
 *
 * The default shape is the field's own size at one device pixel per CSS pixel, so
 * a logical coordinate and a canvas pixel are the same thing and no check has to
 * think about the fit at all.
 */
export async function createHarness(
  options: HarnessOptions = {},
): Promise<Harness> {
  const cssWidth = options.cssWidth ?? FIELD_W;
  const cssHeight = options.cssHeight ?? FIELD_H;
  const dpr = options.dpr ?? 1;
  const seed = options.seed ?? DEFAULT_SEED;

  // The page, supplied. Each of these is a browser facility the build's own
  // loading needs and Node does not have; none of them changes what the build
  // does. `createImageBitmap` also records the digest of the bytes each source
  // was decoded from, which is how a check tells a produced file apart from a
  // canvas the build painted (see {@link ImageRef}).
  vi.stubGlobal("fetch", vi.fn(serveProduced));
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async (blob: Blob) => {
      const bytes = Buffer.from(await blob.arrayBuffer());
      const decoded = (await loadImage(bytes)) as unknown as object;
      const id = IMAGES.next;
      IMAGES.next += 1;
      IMAGES.ids.set(decoded, id);
      IMAGES.held.set(id, decoded);
      IMAGES.hashes.set(id, createHash("sha1").update(bytes).digest("hex"));
      return decoded as unknown as ImageBitmap;
    }),
  );
  vi.stubGlobal("AudioContext", HeadlessAudioContext);
  // The engine's recorder names a bitmap source by its host type, and in process
  // the class this canvas library decodes into is the one that stands for it —
  // which is what lets a recording carry the produced sprites the pipeline drew.
  vi.stubGlobal("ImageBitmap", Image);

  const canvas = createCanvas(
    Math.round(cssWidth * dpr),
    Math.round(cssHeight * dpr),
  );
  const ctx = canvas.getContext("2d");
  const bucket = { frame: -1, calls: [] as DrawCall[] };
  let engineRef: Engine<VoluteDebugApi> | null = null;
  const frameCount = (): number => {
    try {
      return engineRef === null ? -1 : engineRef.frame().count;
    } catch {
      return -1;
    }
  };
  const recorded = recorder(ctx, bucket, frameCount);
  const element = Object.assign(canvas, {
    style: {} as CSSStyleDeclaration,
    getContext: (): SKRSContext2D => recorded,
  }) as unknown as HTMLCanvasElement;

  const events = new EventTarget();
  const metrics: SurfaceMetrics = {
    cssWidth: () => cssWidth,
    cssHeight: () => cssHeight,
    dpr: () => dpr,
    events: () => events,
  };

  const clock = options.clock ?? new ConstantClock(TICK_MS);
  const engine = createEngine<VoluteDebugApi>({
    canvas: element,
    width: FIELD_W,
    height: FIELD_H,
    game,
    // The build's own field background, handed to the engine exactly as the
    // seeded `src/main.ts` hands it (specs/overview.md).
    background: BACKGROUND,
    clock,
    surface: metrics,
  });
  engineRef = engine;

  // Subscribed BEFORE `initialize`, which is what makes the game's own loading
  // and its cues observable: construction runs no game code, so nothing has
  // happened yet.
  const assetFailures: string[] = [];
  engine.events.on("asset:failed", ({ path, reason }) => {
    assetFailures.push(`${path}: ${reason}`);
  });
  const cueSinks: TimedCue[][] = [];
  let looping = 0;
  let loopStarts = 0;
  let started = 0;
  const sound = (cue: string, gain: number, looped: boolean): void => {
    started += 1;
    if (looped) {
      looping += 1;
      loopStarts += 1;
    }
    const stamp: TimedCue = {
      cue,
      tick: frameCount(),
      t: engine.frame().timeMs,
      gain,
      looped,
    };
    for (const sink of cueSinks) sink.push(stamp);
  };
  engine.events.on("cue:played", ({ cue, gain }) => sound(cue, gain, false));
  engine.events.on("cue:looped", ({ cue, gain }) => sound(cue, gain, true));
  engine.events.on("cue:stopped", () => {
    looping = Math.max(0, looping - 1);
  });

  await engine.initialize();
  const { debug, fault } = readDebugSurface(engine);

  // Back to the title on a known seed before a check touches anything: `reset` is
  // what seeds the generator, so a scenario driven from a known seed is
  // reproducible from this line on. The transition it may request lands by the
  // end of the next advanced frame, which is the frame after it.
  // What the build opened on, read before the `reset` below puts it back to the
  // title whatever it opened on. `specs/ui.md`: "The game opens here."
  let openingScreen: VoluteSnapshot["screen"] | null = null;
  if (fault === null) {
    openingScreen = debug.snapshot().screen;
    debug.reset({ seed });
    await engine.advance(1);
  }

  const key = (type: "keydown" | "keyup", code: string): void => {
    events.dispatchEvent(new KeyEvent(type, code));
  };
  const pointer = (type: string, x: number, y: number): void => {
    const view = engine.viewport();
    // The engine reads a client position in CSS pixels from the canvas's corner
    // and maps it through the same fit it renders under, so a logical point is
    // handed over in exactly that space.
    events.dispatchEvent(
      new PointerEvent(
        type,
        (view.offsetX + x * view.scale) / dpr,
        (view.offsetY + y * view.scale) / dpr,
      ),
    );
  };

  const toDevice = (x: number, y: number): Point => {
    const view = engine.viewport();
    return {
      x: Math.round(view.offsetX + x * view.scale),
      y: Math.round(view.offsetY + y * view.scale),
    };
  };

  const readRect = (
    left: number,
    top: number,
    wide: number,
    high: number,
  ): PixelRect => {
    const x = Math.min(Math.max(left, 0), canvas.width);
    const y = Math.min(Math.max(top, 0), canvas.height);
    const w = Math.max(1, Math.min(wide, canvas.width - x));
    const h = Math.max(1, Math.min(high, canvas.height - y));
    const pixels = ctx.getImageData(x, y, w, h);
    return {
      width: pixels.width,
      height: pixels.height,
      data: pixels.data as unknown as Uint8ClampedArray,
    };
  };

  const harness: Harness = {
    engine,
    debug,
    surfaceFault: fault,
    openingScreen,
    assetFailures,
    ctx,
    canvas,

    tick: () => engine.frame().count,
    timeMs: () => engine.frame().timeMs,

    snapshot: () => debug.snapshot(),

    async step(ticks = 1) {
      await engine.advance(Math.max(0, Math.floor(ticks)));
      return debug.snapshot();
    },

    async stepUntil(predicate, untilOptions = {}) {
      const maxTicks = untilOptions.maxTicks ?? 600;
      const poll = Math.max(1, untilOptions.poll ?? 1);

      let snapshot = debug.snapshot();
      if (predicate(snapshot)) return { hit: true, ticks: 0, snapshot };

      let ticks = 0;
      while (ticks < maxTicks) {
        const stride = Math.min(poll, maxTicks - ticks);
        await engine.advance(stride);
        ticks += stride;
        snapshot = debug.snapshot();
        if (predicate(snapshot)) return { hit: true, ticks, snapshot };
      }
      return { hit: false, ticks, snapshot };
    },

    async stepWatching(ticks, watch) {
      const seen: VoluteSnapshot[] = [];
      for (let i = 0; i < ticks; i += 1) {
        await engine.advance(1);
        const snapshot = debug.snapshot();
        seen.push(snapshot);
        if (watch?.(snapshot, i + 1) === true) break;
      }
      return seen;
    },

    async runFor(ms) {
      // A real wall clock, so what the loop delivers is time really passing
      // rather than a scripted delta, and the engine's own frame callback rather
      // than `advance`.
      engine.setClock(new WallClock());
      const controller = new AbortController();
      const running = engine.run({ signal: controller.signal });
      await new Promise((done) => setTimeout(done, ms));
      controller.abort();
      await running;
      engine.setClock(clock);
    },

    hold: (code) => key("keydown", code),
    release: (code) => key("keyup", code),

    async tap(code) {
      // Down, ONE tick, up. "The engine closes the input frame after the frame
      // renders", so the edge armed by the press is consumed by exactly the frame
      // between the two.
      key("keydown", code);
      const snapshot = await this.step(1);
      key("keyup", code);
      return snapshot;
    },

    async holdFor(code, ticks) {
      key("keydown", code);
      try {
        return await this.step(ticks);
      } finally {
        key("keyup", code);
      }
    },

    movePointer: (x, y) => pointer("pointermove", x, y),

    async clickPointer(x, y) {
      pointer("pointermove", x, y);
      pointer("pointerdown", x, y);
      const snapshot = await this.step(1);
      pointer("pointerup", x, y);
      return snapshot;
    },

    async frameCalls() {
      await engine.advance(1);
      return [...bucket.calls];
    },

    lastCalls: () => [...bucket.calls],

    probe(names) {
      const target = (engine.debug ?? {}) as unknown as Record<string, unknown>;
      const ops: Record<string, string> = {};
      for (const name of names) ops[name] = typeof target[name];
      return { version: target.version, ops };
    },

    viewport: () => engine.viewport(),
    device: (x, y) => toDevice(x, y),

    pixel(x, y) {
      const at = toDevice(x, y);
      return this.devicePixel(at.x, at.y);
    },

    pixels(points) {
      return points.map((point) => harness.pixel(point.x, point.y));
    },

    pixelRect(x, y, width, height) {
      const view = engine.viewport();
      const origin = toDevice(x, y);
      return readRect(
        origin.x,
        origin.y,
        Math.max(1, Math.round(width * view.scale)),
        Math.max(1, Math.round(height * view.scale)),
      );
    },

    devicePixel(x, y) {
      const rect = readRect(Math.round(x), Math.round(y), 1, 1);
      return [rect.data[0], rect.data[1], rect.data[2], rect.data[3]];
    },

    surface: () => ({ width: canvas.width, height: canvas.height, dpr }),

    imagePixels(id) {
      const source = IMAGES.held.get(id);
      if (source === undefined) return null;
      const sized = source as { width: number; height: number };
      const width = Math.max(1, Math.round(sized.width));
      const height = Math.max(1, Math.round(sized.height));
      const off = createCanvas(width, height);
      const offCtx = off.getContext("2d");
      offCtx.clearRect(0, 0, width, height);
      offCtx.drawImage(source as never, 0, 0);
      const pixels = offCtx.getImageData(0, 0, width, height);
      return {
        width: pixels.width,
        height: pixels.height,
        data: pixels.data as unknown as Uint8ClampedArray,
      };
    },

    armAudio() {
      // "The engine opens the audio context on the first pointer or key event it
      // sees." `KeyZ` is bound to nothing (specs/controls.md), so the gesture
      // changes no game state.
      key("keydown", UNBOUND_KEY);
      key("keyup", UNBOUND_KEY);
    },

    async dispose() {
      engine.destroy();
      vi.unstubAllGlobals();
      await Promise.resolve();
    },
  };

  harnessCues.set(harness, cueSinks);
  harnessAudio.set(harness, {
    looping: () => looping,
    loopStarts: () => loopStarts,
    started: () => started,
  });
  return harness;
}

/** Where {@link watchCues} attaches, per harness. */
const harnessCues = new WeakMap<Harness, TimedCue[][]>();

/** What a harness has heard, per harness. */
const harnessAudio = new WeakMap<
  Harness,
  { looping(): number; loopStarts(): number; started(): number }
>();

/* -------------------------------------------------------------------------- */
/* Draw calls                                                                 */
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

/**
 * The {@link ImageRef} an argument names, or `null` when it is not a source.
 *
 * A source is anything the canvas can draw from: the decoded produced files, and
 * any canvas the build painted itself. Which of the two it is comes from
 * `srcHash`, which is present only on a source decoded from bytes off disk.
 */
export function imageRef(value: unknown): ImageRef | null {
  if (value === null || typeof value !== "object") return null;
  const sized = value as { width?: unknown; height?: unknown; src?: unknown };
  if (typeof sized.width !== "number" || typeof sized.height !== "number") {
    return null;
  }
  let id = IMAGES.ids.get(value as object);
  if (id === undefined) {
    id = IMAGES.next;
    IMAGES.next += 1;
    IMAGES.ids.set(value as object, id);
    IMAGES.held.set(id, value as object);
  }
  const src = typeof sized.src === "string" ? sized.src : null;
  return {
    id,
    kind: "bitmap",
    name: (value as object).constructor.name,
    width: sized.width,
    height: sized.height,
    src: src !== null && src.length <= 256 ? src : null,
    srcHash: IMAGES.hashes.get(id) ?? null,
  };
}

/** A 2D affine transform, in the canvas's `[a, b, c, d, e, f]` order. */
type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function numbers(args: unknown[], count: number): number[] | null {
  const taken = args.slice(0, count);
  return taken.length === count && taken.every((v) => typeof v === "number")
    ? (taken as number[])
    : null;
}

function apply(m: Matrix, x: number, y: number): Point {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

/** The transform after `method(...args)` is applied to `current`. */
function transformed(
  current: Matrix,
  method: string,
  args: unknown[],
): Matrix | null {
  if (method === "translate") {
    const v = numbers(args, 2);
    return v ? multiply(current, [1, 0, 0, 1, v[0], v[1]]) : current;
  }
  if (method === "scale") {
    const v = numbers(args, 2);
    return v ? multiply(current, [v[0], 0, 0, v[1], 0, 0]) : current;
  }
  if (method === "rotate") {
    const v = numbers(args, 1);
    if (!v) return current;
    const c = Math.cos(v[0]);
    const s = Math.sin(v[0]);
    return multiply(current, [c, s, -s, c, 0, 0]);
  }
  if (method === "transform") {
    const v = numbers(args, 6);
    return v ? multiply(current, v as Matrix) : current;
  }
  if (method === "setTransform") {
    const v = numbers(args, 6);
    if (v) return v as Matrix;
    if (args.length === 0) return IDENTITY;
    if (typeof args[0] === "object" && args[0] !== null) {
      const m = args[0] as Record<string, unknown>;
      const parts = [m.a, m.b, m.c, m.d, m.e, m.f];
      if (parts.every((p) => typeof p === "number")) return parts as Matrix;
    }
    return current;
  }
  if (method === "resetTransform") return IDENTITY;
  return null;
}

/** One run of text a frame drew, and where it drew it. */
export interface TextDraw {
  text: string;
  /** The anchor the run was drawn at, mapped through the transform in force. */
  x: number;
  y: number;
}

/** One image a frame drew, and where it landed. */
export interface ImageDraw {
  image: ImageRef;
  /** The source rectangle, when the call named one. */
  sx: number | null;
  sy: number | null;
  sw: number | null;
  sh: number | null;
  /** The destination's top-left, mapped through the transform in force. */
  dx: number;
  dy: number;
  /** The destination's size, scaled by the transform in force. */
  dw: number;
  dh: number;
  /** The destination's centre, which is where a sprite is placed. */
  cx: number;
  cy: number;
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
 * Substring rather than equality on purpose: the value a check asserts is the
 * case's own — a score of 50, a level of 4 — but how a build presents it is the
 * build's, and a readout is commonly drawn with a label or padding around it.
 * Requiring the exact run would fail a HUD that shows precisely the right figure.
 */
export function drewText(calls: readonly DrawCall[], text: string): boolean {
  const wanted = String(text).trim().toLowerCase();
  return drawnText(calls).some((drawn) => drawn.toLowerCase().includes(wanted));
}

/**
 * Every run of text the frame drew, with its anchor in logical units.
 *
 * The pipeline sets the world-to-device transform on the context before a
 * component draws, and a build is free to add a transform of its own, so the
 * position a `fillText` names is only where the text landed once the transform
 * in force at that call is applied. This walks the frame's operations carrying
 * that transform. At the harness's default shape the canvas is the field at one
 * pixel per unit, so the result is in logical units.
 */
export function textDraws(calls: readonly DrawCall[]): TextDraw[] {
  const draws: TextDraw[] = [];
  const stack: Matrix[] = [];
  let current: Matrix = IDENTITY;
  for (const call of calls) {
    if (call.kind !== "call") continue;
    const { method, args } = call;
    if (method === "save") {
      stack.push(current);
      continue;
    }
    if (method === "restore") {
      current = stack.pop() ?? IDENTITY;
      continue;
    }
    const moved = transformed(current, method, args);
    if (moved !== null) {
      current = moved;
      continue;
    }
    if (method !== "fillText" && method !== "strokeText") continue;
    const [text] = args;
    const at = numbers(args.slice(1), 2);
    if (typeof text !== "string" || at === null) continue;
    const point = apply(current, at[0], at[1]);
    draws.push({ text, x: point.x, y: point.y });
  }
  return draws;
}

/**
 * Every image the frame drew, with the source it drew and where it landed.
 *
 * The three `drawImage` forms are all read: `(image, dx, dy)` takes the source's
 * own natural size, `(image, dx, dy, dw, dh)` names the destination size, and
 * `(image, sx, sy, sw, sh, dx, dy, dw, dh)` names both. The destination is mapped
 * through the transform in force, so a sprite drawn under a translate reports
 * where it actually landed on the field.
 *
 * A source is identified by the {@link ImageRef} the harness gives it — its
 * identity within this harness, its natural size, and a digest of the bytes it
 * was decoded from — NEVER by matching a path under `assets/`.
 */
export function imageDraws(calls: readonly DrawCall[]): ImageDraw[] {
  const draws: ImageDraw[] = [];
  const stack: Matrix[] = [];
  let current: Matrix = IDENTITY;
  for (const call of calls) {
    if (call.kind !== "call") continue;
    const { method, args } = call;
    if (method === "save") {
      stack.push(current);
      continue;
    }
    if (method === "restore") {
      current = stack.pop() ?? IDENTITY;
      continue;
    }
    const moved = transformed(current, method, args);
    if (moved !== null) {
      current = moved;
      continue;
    }
    if (method !== "drawImage") continue;
    const image = imageRef(args[0]);
    if (image === null) continue;

    let sx: number | null = null;
    let sy: number | null = null;
    let sw: number | null = null;
    let sh: number | null = null;
    let dx: number;
    let dy: number;
    let dw: number;
    let dh: number;
    if (args.length >= 9) {
      const v = numbers(args.slice(1), 8);
      if (v === null) continue;
      [sx, sy, sw, sh, dx, dy, dw, dh] = v;
    } else if (args.length >= 5) {
      const v = numbers(args.slice(1), 4);
      if (v === null) continue;
      [dx, dy, dw, dh] = v;
    } else {
      const v = numbers(args.slice(1), 2);
      if (v === null) continue;
      [dx, dy] = v;
      dw = image.width;
      dh = image.height;
    }

    const at = apply(current, dx, dy);
    const far = apply(current, dx + dw, dy + dh);
    draws.push({
      image,
      sx,
      sy,
      sw,
      sh,
      dx: at.x,
      dy: at.y,
      dw: far.x - at.x,
      dh: far.y - at.y,
      cx: (at.x + far.x) / 2,
      cy: (at.y + far.y) / 2,
    });
  }
  return draws;
}

/**
 * The geometry calls a frame made, by name.
 *
 * Enough of a count to compare two frames of the same scene: a frame that played
 * an effect asked for strictly more of these than the same frame without it,
 * whatever shape the build chose to draw it as.
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
  "putImageData",
];

/** How many drawing operations the frame issued. */
export function drawOps(calls: readonly DrawCall[]): number {
  return calls.filter(
    (call) => call.kind === "call" && DRAW_METHODS.includes(call.method),
  ).length;
}

/**
 * Every logical point a frame's drawing calls named, mapped through the transform
 * in force at the call.
 *
 * A particle burst is a sequence of draws rather than one shape, so where a
 * render put its geometry is the direct reading of it: the coordinates near an
 * extraction point are the burst. The leading pair of arguments is the position
 * for every method listed, except the curve calls, whose control points come
 * first and whose endpoint is the last pair.
 */
export function drawnPoints(calls: readonly DrawCall[]): Point[] {
  const points: Point[] = [];
  const stack: Matrix[] = [];
  let current: Matrix = IDENTITY;
  const push = (x: unknown, y: unknown): void => {
    if (typeof x === "number" && typeof y === "number") {
      points.push(apply(current, x, y));
    }
  };

  for (const call of calls) {
    if (call.kind !== "call") continue;
    const { method, args } = call;
    if (method === "save") {
      stack.push(current);
      continue;
    }
    if (method === "restore") {
      current = stack.pop() ?? IDENTITY;
      continue;
    }
    const moved = transformed(current, method, args);
    if (moved !== null) {
      current = moved;
      continue;
    }
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
    } else if (method === "drawImage" || method === "putImageData") {
      push(args[1], args[2]);
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

/** Every point a frame drew that lies within `radius` of `centre`. */
export function pointsNear(
  calls: readonly DrawCall[],
  centre: Point,
  radius: number,
): Point[] {
  return drawnPoints(calls).filter(
    (point) => distance(point, centre) <= radius,
  );
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
//    kept is the part the check is ABOUT and never the setup that got there.
// 2. IT IS EVIDENCE, NEVER A VERDICT. The scenario's own value comes straight
//    back, and a scenario that THROWS still writes what it had recorded before
//    the failure travels on — a failing check is the one whose replay a reviewer
//    most wants. A recording that cannot be written is reported as an output that
//    never turned up, which is a fact about the host rather than about the build.
// 3. IT WRITES ONLY WHAT THERE IS TO LOOK AT. A capture that closed no frames
//    leaves no file, so the run reports the output absent instead of offering the
//    reviewer a replay of nothing.
// 4. IT COSTS NOTHING WHEN NOBODY IS COLLECTING. Outside a run the media
//    directory is unset and the whole thing is a no-op that still runs the
//    scenario, so a check cannot pass in one place and fail in the other.

/** The environment variable the runner names the media directory in. */
const MEDIA_DIR_ENV = "TCAB_VALIDATION_MEDIA_DIR";

/**
 * The directory the runner stages this project to inside the build's tree.
 *
 * A recording is addressed by the STAGED path of the suite that produced it —
 * `validation/channel/feed-advance.test.ts` — because that is the path the review
 * item's declared script resolves to, and so the only name the case's manifest and
 * the runner both already agree on. Stating the prefix here is what keeps that
 * address the same when this suite is run in place against a reference
 * implementation, where the project root is `validation/structured-2d/` instead.
 */
const STAGED_PROJECT_DIR = "validation";

/**
 * The most frames a written recording holds.
 *
 * A recording is one operation log per frame, and a frame of this game is a
 * couple of hundred operations, so a section a check drives for half a minute of
 * game time runs to tens of megabytes — a file nobody can serve to a reviewer.
 * The cap is what makes `captureReplay` safe to wrap ANY section in.
 */
const MAX_REPLAY_FRAMES = 300;

/**
 * Where the running suite's `outputId` output belongs, or `null` when nothing is
 * collecting media.
 *
 * The suite is the one vitest is currently running rather than one the caller
 * names, because the two must not be able to disagree: a check that named its own
 * path would be free to write its evidence under some other point's address.
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
 * in the file that no surviving frame asks for.
 *
 * Every entry here is reached from a kept frame, and every reference inside one
 * is rewritten as it is reached, transitively. What is deduplicated is the
 * rewritten entry, so an operation two hundred frames issue identically is
 * written once and named two hundred times.
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
 * first — or last — few seconds at the full one. Thinning is legitimate because
 * every frame in a recording is drawable on its own. Each kept frame's `deltaMs`
 * is restated as the time since the frame kept before it, so the deltas still sum
 * to the section's elapsed time. The last frame is always kept, whatever the
 * stride lands on: it is the frame the check's sweep stopped at.
 */
export function thinReplay(recording: Recording): Recording {
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
      // subtracting it recovers it.
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
 * A capture that closed no frames writes nothing: a declared output that never
 * turned up is already reported as absent, and that is the truthful reading of a
 * section that drew no frames. What lands on disk is gzip rather than raw JSON,
 * which is what keeps a run's whole set of recordings to a few megabytes.
 *
 * Never throws. A directory that cannot be made or a file that cannot be written
 * says something about the machine the validators ran on, and failing the point
 * over it would blame the build for the host's problem.
 */
function writeReplay(destination: string, recording: Recording | null): void {
  if (recording === null || recording.frames.length === 0) return;
  try {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, gzipSync(JSON.stringify(thinReplay(recording))));
  } catch (error) {
    console.warn(`volute: could not write ${destination}: ${String(error)}`);
  }
}

/**
 * Record the frames `scenario` drives and keep them as the review item's
 * `outputId` output, handing back whatever the scenario returned.
 *
 * Wrap the drive, not the arrangement:
 *
 * ```ts
 * const after = await captureReplay(h, "extract", () => h.step(60));
 * assertEqual(coreCount(after), 1);
 * ```
 *
 * The assertions stay exactly where they were and read exactly what they did.
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
    let recording: Recording | null = null;
    try {
      recording = h.engine.stopRecording();
    } catch (error) {
      console.warn(`volute: could not stop the recorder: ${String(error)}`);
    }
    writeReplay(destination, recording);
  }
}

/**
 * Keep the picture currently on the canvas as the review item's `outputId` output.
 *
 * The companion to {@link captureReplay}, for a point whose evidence is one
 * PICTURE rather than a stretch of motion: which screen the game opened on, what
 * gauge the HUD drew at a pressure of 100, which charge the injector held.
 *
 * What is written is whatever the last frame that RAN left behind, so call it
 * after the frame that poses the thing under test and before the assertions, so a
 * check that fails still leaves the picture that shows why. Nothing here can
 * change a verdict: outside a run this is a no-op, and a still that cannot be
 * written is reported as an output that never turned up.
 */
export function captureStill(h: Harness, outputId: string): void {
  const destination = mediaDestination(outputId, "png");
  if (destination === null) return;
  try {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, h.canvas.toBuffer("image/png"));
  } catch (error) {
    console.warn(`volute: could not write ${destination}: ${String(error)}`);
  }
}

/* -------------------------------------------------------------------------- */
/* Cues                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Record every cue the build plays from now on, stamped with the tick it sounded
 * on.
 *
 * The engine announces every `play` and every `loop` synchronously from inside
 * the call, so the handler runs while the frame that played it is still running
 * and `engine.frame().count` is that frame's own number. That is what lets a
 * check assert not merely that a cue sounded but that it sounded on the tick of
 * the event — which is what tells a build that plays a cue on the right event
 * apart from one that plays it on every tick, or a tick late.
 *
 * A POSE SOUNDS NOTHING. `specs/instrumentation.md`: "Audio belongs to the ticks.
 * A pose changes the state alone and sounds nothing; the cues a scenario hears
 * come from the ticks run after it." So a cue raised by `fire()` sounds on the
 * next tick ADVANCED, not at the call — arrange, then step, then read.
 */
export function watchCues(h: Harness): TimedCue[] {
  const played: TimedCue[] = [];
  harnessCues.get(h)?.push(played);
  return played;
}

/**
 * How many cues the build has running as loops, right now.
 *
 * `specs/ui.md` has the two beds "loop until stopped rather than playing once",
 * and "Exactly one of them is looping on `playing`". The engine announces a loop
 * when it starts and again when it stops, so this is the count standing between
 * the two.
 */
export function loopingSources(h: Harness): number {
  return harnessAudio.get(h)?.looping() ?? 0;
}

/** How many cues the build has sounded since the engine was built. */
export function soundsStarted(h: Harness): number {
  return harnessAudio.get(h)?.started() ?? 0;
}

/** How many of the cues sounded started a loop. */
export function loopsStarted(h: Harness): number {
  return harnessAudio.get(h)?.loopStarts() ?? 0;
}

/**
 * Step until the build has a looping bed running, and answer how many it has.
 *
 * WHY A CHECK WAITS FOR THIS RATHER THAN READING IT ON ONE TICK. `specs/ui.md`
 * fixes what a bed sounds like and never which tick a build starts it on, so a
 * check that read the bed on one fixed tick would grade a build on when it chose
 * to open its loop rather than on whether it runs one.
 *
 * Never throws and never asserts: a build with no bed at all spends the budget
 * and answers `0`, so the point that is ABOUT the bed reaches its own failure
 * with its own message.
 */
export async function stepUntilBed(
  h: Harness,
  maxTicks = 300,
): Promise<number> {
  for (let i = 0; i < maxTicks; i += 1) {
    const running = loopingSources(h);
    if (running > 0) return running;
    await h.step(1);
  }
  return loopingSources(h);
}

/**
 * Step until the build has sounded a cue at all, and answer how many it has.
 *
 * The weaker companion to {@link stepUntilBed}, for a build that runs its bed by
 * re-scheduling the cue end to end rather than through the bus's own loop —
 * which `specs/ui.md` permits, since it fixes what a bed SOUNDS like and not how
 * it is made. Same shape: no throw, and the count comes back whatever it is.
 */
export async function stepUntilSound(
  h: Harness,
  maxTicks = 300,
): Promise<number> {
  for (let i = 0; i < maxTicks; i += 1) {
    const started = soundsStarted(h);
    if (started > 0) return started;
    await h.step(1);
  }
  return soundsStarted(h);
}

/* -------------------------------------------------------------------------- */
/* Colour                                                                     */
/* -------------------------------------------------------------------------- */
//
// `specs/ui.md`: "Volute fixes no palette, no font, no layout, and no styling for
// any screen." So nothing here reads a hex value. What the appearance points may
// assert is PRESENCE and DISTINGUISHABILITY — that a charge stands apart from the
// field, from the plate, and from every other charge — and the reading is the
// distance between two sampled colours on the 0-441 scale the case's standing
// tolerance names.

/** A sampled colour, each channel 0-255. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Euclidean distance between two colours, 0 to about 441. */
export function colorDistance(a: Rgb, b: Rgb): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

/** A colour's luminance, on the same 0-255 scale as its channels. */
export function luminance(c: Rgb): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/** The mean colour of a {@link PixelRect}, over the pixels `keep` accepts. */
export function meanColor(
  rect: PixelRect,
  keep: (x: number, y: number) => boolean = () => true,
): Rgb {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = 0; y < rect.height; y += 1) {
    for (let x = 0; x < rect.width; x += 1) {
      if (!keep(x, y)) continue;
      const at = (y * rect.width + x) * 4;
      r += rect.data[at];
      g += rect.data[at + 1];
      b += rect.data[at + 2];
      n += 1;
    }
  }
  if (n === 0) return { r: 0, g: 0, b: 0 };
  return { r: r / n, g: g / n, b: b / n };
}

/**
 * The mean colour of the `size` x `size` patch centred on a logical point.
 *
 * A patch rather than one pixel because every edge on the field is
 * anti-aliased, so a single sample on a rim reads as a mixture rather than as
 * the thing that was drawn.
 */
export function samplePatch(h: Harness, x: number, y: number, size = 9): Rgb {
  const half = (size - 1) / 2;
  return meanColor(h.pixelRect(x - half, y - half, size, size));
}

/**
 * The mean colour of the disc of `radius` centred on a logical point.
 *
 * What a check about a CORE reads: a core is a disc of {@link CORE_RADIUS} that
 * carries a glyph over its face, so one pixel is either the mineral or the glyph
 * and the mean over the disc is the charge.
 */
export function sampleDisc(
  h: Harness,
  x: number,
  y: number,
  radius = CORE_RADIUS - 1,
): Rgb {
  const size = 2 * radius + 1;
  const rect = h.pixelRect(x - radius, y - radius, size, size);
  const cx = (rect.width - 1) / 2;
  const cy = (rect.height - 1) / 2;
  const limit = Math.min(cx, cy);
  return meanColor(rect, (px, py) => Math.hypot(px - cx, py - cy) <= limit);
}

/**
 * A binary luminance mask of a {@link PixelRect}, thresholded at its own median.
 *
 * What tells two sprites apart WITH COLOUR REMOVED: the mask is the shape the
 * sprite draws rather than the hue it draws it in, so two charges that differ
 * only by hue produce the same mask and two that carry different glyphs do not.
 * A fully transparent pixel is dark, because nothing is drawn there.
 */
export function luminanceMask(rect: PixelRect): boolean[] {
  const values: number[] = [];
  for (let i = 0; i < rect.width * rect.height; i += 1) {
    const at = i * 4;
    const alpha = rect.data[at + 3] / 255;
    values.push(
      alpha *
        luminance({
          r: rect.data[at],
          g: rect.data[at + 1],
          b: rect.data[at + 2],
        }),
    );
  }
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return values.map((value) => value > median);
}

/** The fraction of positions two masks of the same size disagree on, 0 to 1. */
export function maskDifference(
  a: readonly boolean[],
  b: readonly boolean[],
): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let differing = 0;
  for (let i = 0; i < n; i += 1) if (a[i] !== b[i]) differing += 1;
  return differing / n;
}

/** How many pixels of two equally shaped rectangles differ by more than `tolerance`. */
export function pixelsDiffering(
  a: PixelRect,
  b: PixelRect,
  tolerance = 8,
): number {
  const n = Math.min(a.data.length, b.data.length) / 4;
  let differing = 0;
  for (let i = 0; i < n; i += 1) {
    const at = i * 4;
    if (
      Math.abs(a.data[at] - b.data[at]) > tolerance ||
      Math.abs(a.data[at + 1] - b.data[at + 1]) > tolerance ||
      Math.abs(a.data[at + 2] - b.data[at + 2]) > tolerance ||
      Math.abs(a.data[at + 3] - b.data[at + 3]) > tolerance
    ) {
      differing += 1;
    }
  }
  return differing;
}

/** Every logical point of two frames that differ, as `pixelRect` addressed them. */
export function differingPoints(
  a: PixelRect,
  b: PixelRect,
  origin: Point = { x: 0, y: 0 },
  tolerance = 8,
): Point[] {
  const points: Point[] = [];
  for (let y = 0; y < Math.min(a.height, b.height); y += 1) {
    for (let x = 0; x < Math.min(a.width, b.width); x += 1) {
      const at = (y * a.width + x) * 4;
      const bt = (y * b.width + x) * 4;
      if (
        Math.abs(a.data[at] - b.data[bt]) > tolerance ||
        Math.abs(a.data[at + 1] - b.data[bt + 1]) > tolerance ||
        Math.abs(a.data[at + 2] - b.data[bt + 2]) > tolerance ||
        Math.abs(a.data[at + 3] - b.data[bt + 3]) > tolerance
      ) {
        points.push({ x: origin.x + x, y: origin.y + y });
      }
    }
  }
  return points;
}

/** The whole field, read back as RGBA. */
export function fieldPixels(h: Harness): PixelRect {
  return h.pixelRect(0, 0, FIELD_W, FIELD_H);
}

/* -------------------------------------------------------------------------- */
/* Scenario helpers                                                           */
/* -------------------------------------------------------------------------- */
//
// Each of these poses a situation through the debug surface and then lets the
// real simulation run. `writing-debug-apis-and-validators` puts every COMPOUND
// sequence here rather than on the surface: the surface carries atomic poses, and
// the arrangements a check needs are assembled from them in one place every check
// shares.
//
// A VALIDATOR POSES AN ISOLATED HALL. Everything a check's requirement does not
// concern is removed before its scenario is staged, rather than parked somewhere
// harmless: containment leans on the game's own rules holding, and a broken build
// is broken in exactly those rules. {@link poseHall} is the shape of that — it
// opens a level, stops the inlet, empties the channel, and puts back exactly the
// cores the requirement is about.

/** What {@link poseHall} arranges. Every field is optional; each defaults below. */
export interface PoseOptions {
  /** The level to open, 1 through 5. Defaults to 1. */
  level?: number;
  /**
   * The cores the inlet has left to emit. Defaults to 0, which stops the inlet.
   *
   * A check that wants the inlet running names a count; a check that does not
   * takes the default, so nothing arrives to join the scenario it posed.
   */
  quotaRemaining?: number;
  /** The pressure. Defaults to 0, the value a level starts at. */
  pressure?: number;
  /** The cores to put on the channel. Defaults to none. */
  cores?: readonly PosedCore[];
  /** The charge the injector holds loaded. Left as the level drew it by default. */
  loaded?: ChargeId;
  /** The charge the injector holds queued. Left as the level drew it by default. */
  queued?: ChargeId;
  /**
   * A machinery to grant once the hall is posed.
   *
   * Granted LAST, because `bore` "resolves at once, centered on the head core's
   * position" — so it reads the train this call posed rather than the one the
   * level opened with.
   */
  machinery?: MachineryKind;
}

/**
 * The arc position a bystander core is parked at: the inlet, `s = 0`.
 *
 * `(40, 40)` on specs/channel.md's polyline — the far corner of the field, 380
 * units from the vertical shot every insertion and injector check flies and
 * further still from the intake at the other end.
 */
export const PARK_S = 0;

/**
 * One core parked clear of a scenario, so an exhausted level cannot clear under
 * a check that is not about clearing.
 *
 * WHY IT IS NEEDED AT ALL, given that a check poses an ISOLATED hall. Nearly
 * every check stops the inlet ({@link poseHall} defaults `quotaRemaining` to 0),
 * and specs/progression.md clears a level "the moment its quota is exhausted and
 * no cores remain on the channel" — so a hall posed with an exhausted quota and
 * an EMPTY channel leaves `playing` on its very next tick, taking the pointer,
 * the turn actions, fire and swap with it. One core is the least that keeps the
 * hall in play, and it is parked at {@link PARK_S} where nothing any of these
 * checks drives can reach it.
 *
 * This is not a bystander the scenario has to contain: it is the hall's own
 * "there is still something on the channel" condition, and the checks that pose
 * cores of their own replace it with them.
 */
export function parkedCore(s: number = PARK_S): PosedCore[] {
  return [[s, "cobalt", null]];
}

/**
 * Open a level and pose an isolated hall on it.
 *
 * The order is the one the operations' own definitions force: `startLevel` seeds
 * the channel and refills the quota, so the quota and the pressure are set after
 * it; `clearTrain` removes the twelve the level opened with along with every
 * projectile; `poseTrain` then puts back exactly the cores the check is about;
 * and the machinery is granted last so an instant `bore` reads the posed train.
 *
 * ONE FRAME IS ADVANCED AFTER `startLevel`, and it is the whole of what this
 * engine adds. `specs/instrumentation.md`: "A pose that opens a level takes
 * effect no later than the end of the next advanced frame, so a caller advances
 * one frame after `reset`, `start`, or `startLevel` before it poses, presses a
 * key, or reads further." Everything after that frame acts on the live hall the
 * level opened.
 *
 * Nothing here decides an outcome. Every extraction, score, chain step, grant,
 * cell and clear a check reads comes from the ticks it steps afterwards.
 */
export async function poseHall(
  h: Harness,
  options: PoseOptions = {},
): Promise<void> {
  h.debug.startLevel(options.level ?? 1);
  await h.step(1);
  h.debug.setQuotaRemaining(options.quotaRemaining ?? 0);
  h.debug.setPressure(options.pressure ?? 0);
  h.debug.clearTrain();
  if (options.cores !== undefined && options.cores.length > 0) {
    h.debug.poseTrain(options.cores);
  }
  if (options.loaded !== undefined) h.debug.setLoaded(options.loaded);
  if (options.queued !== undefined) h.debug.setQueued(options.queued);
  if (options.machinery !== undefined) {
    h.debug.grantMachinery(options.machinery);
  }
}

/**
 * Open a run from the title exactly as the start control does, and open `level`.
 *
 * `start()` is "the score `0`, the cells at `CELLS` (`3`), and level `1` opened
 * exactly as `startLevel` opens it", so a run from a known seed is the harness's
 * opening `reset` followed by this. A `level` beyond 1 is opened after it, which
 * leaves the score and the cells at their opening values. Each pose is followed
 * by the one frame the transition it may request lands in.
 */
export async function startRun(h: Harness, level = 1): Promise<void> {
  h.debug.start();
  await h.step(1);
  if (level !== 1) {
    h.debug.startLevel(level);
    await h.step(1);
  }
}

/**
 * Aim at `angleDegrees` and release the loaded core along it.
 *
 * `fire()` on the surface always launches — "Any cooldown outstanding at the call
 * is cleared first" — so this is how a check that is not ABOUT the cooldown gets
 * a projectile into the hall. A check that IS about the cooldown raises the fire
 * CONTROL instead, with {@link pressFire}, which honours it.
 */
export function fireAt(h: Harness, angleDegrees: number): void {
  h.debug.fire(angleDegrees);
}

/** Aim at a field point and release the loaded core toward it. */
export function fireToward(h: Harness, target: Point): void {
  h.debug.fire(aimAt(target));
}

/** Raise the fire control itself, which honours the cooldown. One tick passes. */
export function pressFire(h: Harness): Promise<VoluteSnapshot> {
  return h.tap("Space");
}

/** Raise the swap control. One tick passes. */
export function pressSwap(h: Harness): Promise<VoluteSnapshot> {
  return h.tap("KeyX");
}

/** Raise the confirm control: starts a run on the title, dismisses an ending. */
export function pressConfirm(h: Harness): Promise<VoluteSnapshot> {
  return h.tap("Enter");
}

/** Raise the pause control, which pauses and resumes. One tick passes. */
export function pressPause(h: Harness): Promise<VoluteSnapshot> {
  return h.tap("Escape");
}

/** Raise the mute control. One tick passes. */
export function pressMute(h: Harness): Promise<VoluteSnapshot> {
  return h.tap("KeyM");
}

/**
 * Step until the projectile the check fired has left the hall, and say what
 * happened.
 *
 * A shot resolves in one of three ways — it seats, it leaves the field, or it is
 * still flying — and a check that drove one wants to know which without spelling
 * the sweep out.
 */
export interface ShotResult {
  /** Whether every projectile is gone. */
  landed: boolean;
  /** Ticks stepped before the sweep ended. */
  ticks: number;
  snapshot: VoluteSnapshot;
}

/** Step until no projectile remains, or `maxTicks` have passed. */
export async function driveShot(
  h: Harness,
  maxTicks = 120,
): Promise<ShotResult> {
  const swept = await h.stepUntil(
    (snapshot) => (snapshot.projectiles?.length ?? 0) === 0,
    { maxTicks, poll: 1 },
  );
  return { landed: swept.hit, ticks: swept.ticks, snapshot: swept.snapshot };
}

/**
 * The straight top run of the channel, which is where most insertion scenarios
 * are posed.
 *
 * Leg 0 runs from the inlet `(40, 40)` to `(920, 40)`, so an arc position on it
 * puts a core at `y = 40` with forward pointing along `+x` — the one place on the
 * channel where "ahead" and "larger x" are the same statement, which is what
 * `insertion/insert-ahead` and `insertion/insert-behind` turn on. The injector at
 * `(420, 330)` sits below it, so a shot fired near 270 degrees crosses it.
 */
export const TOP_RUN = {
  /** The arc position at the start of the leg. */
  fromS: CHANNEL_ARC[0],
  /** The arc position at the end of the leg. */
  toS: CHANNEL_ARC[1],
  /** The `y` every core on the leg sits at. */
  y: CHANNEL[0].y,
  /** The forward direction along the leg. */
  forward: { x: 1, y: 0 } as Point,
} as const;

/** The arc position on the top run directly above a field `x`. */
export function topRunS(x: number): number {
  return x - CHANNEL[0].x;
}

/** Where the whole channel runs, for a check that has to place a core off it. */
export const CHANNEL_END_S = PATH_LENGTH;
