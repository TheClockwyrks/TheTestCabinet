// Volute — the shared validator harness. CASE-PROVIDED.
//
// Every check in this suite is an ordinary vitest test that drives the built site
// IN A REAL BROWSER. There is nothing to import: an engineless run seeds no
// `src/` at all, so the build wrote its own frame loop, its own canvas fit, its
// own keyboard and pointer, its own audio, its own loading of the produced files,
// and its own `window.__volute` — and the only place all of that exists is a page
// that has loaded the bundle. So the project serves `dist/`, loads it in
// Chromium, and reaches the game the way anything reaches it: over the surface
// the specification told the build to install.
//
// IT IS STILL A VITEST PROJECT, AND THAT IS DELIBERATE. The runner locates the
// build output before it chooses between the vitest and browser paths, so `dist/`
// is on disk by the time this project runs. Staying a vitest project is what lets
// the case name ONE script per review item and have it resolve under every engine
// — `validation/channel/feed-advance.test.ts` is the same path whichever runtime
// the run selected — and what keeps `format = 2` resolution passing.
//
// WHAT A CHECK READS. The game's own state (through `window.__volute`'s
// `snapshot`), the ticks the harness itself drove, the operations the build
// issued against its 2D context, the pixels those operations left on the canvas,
// and the sounds the build emitted. Nothing here fabricates an outcome: the
// scenario helpers below only ARRANGE the hall through the surface, and the real
// tick the build wrote is what runs from there.
//
// THE CLOCK IS THE SURFACE'S. Nothing outside an engineless build owns its loop,
// so `specs/instrumentation.md` puts the clock on the surface: `setAutoStep(false)`
// takes the game off real time and `step(ticks)` runs whole simulation ticks.
// Every harness opens by taking the game off the clock, so a check asks for a
// number of ticks and gets exactly that number — no polling, no waiting, and no
// measurement of the machine it ran on. The one check that is ABOUT the loop
// running itself (`channel/self-advancing`) hands it back with {@link Harness.runFor}.
//
// A TICK IS THE UNIT. `specs/instrumentation.md` fixes the simulation at 60 ticks
// a second, each worth exactly 1/60 s, so a count of stepped ticks converts to
// simulated seconds with no rounding and no ambiguity about what a step means.
// Every duration in this project is written as a tick count for that reason.
//
// EVERYTHING CROSSING INTO THE PAGE IS ASYNC. That is the whole of the difference
// between a suite here and its counterpart under an engine: `await h.snapshot()`
// rather than `h.snapshot()`, `await h.debug.setPressure(50)` rather than
// `h.debug.setPressure(50)`. The scenarios, the tolerances, and the assertions
// are the same ones, because they are the case's rather than the runtime's.
//
// ONE SERVER, ONE BROWSER, ONE PAGE PER HARNESS. `globalSetup.ts` starts the
// server and the browser once for the whole project; this module connects to
// them from inside each suite's worker and opens a page per harness, so every
// check drives a build that has just started and no check can be affected by
// what the one before it pressed, opened or muted.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { expect, inject } from "vitest";
import type { Browser, BrowserContext, Page } from "playwright";
import { connectChromium } from "./chromium";
import { assertTruthy, fail } from "./assert";
import {
  CHANNEL,
  CHANNEL_ARC,
  CORE_RADIUS,
  DEFAULT_SEED,
  FIELD_H,
  FIELD_W,
  HANDLE,
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

declare module "vitest" {
  export interface ProvidedContext {
    /** Where the built site is served, from `globalSetup.ts`. */
    voluteUrl: string;
    /** The one Chromium every suite worker connects to. */
    voluteBrowserWs: string;
  }
}

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

/** The operations a check poses the hall through. Every one crosses into the page. */
export interface VoluteDebugApi {
  /** Take the game off real time, and give it back. */
  setAutoStep(enabled: boolean): Promise<void>;
  /**
   * Run whole simulation ticks, each the full tick followed by a render.
   *
   * Prefer {@link Harness.step}, which brackets each tick for the recorder and
   * the audio probe. This is here for the check that reflects the surface.
   */
  step(ticks?: number): Promise<void>;
  /** Restore every declared field to its title value and reseed the generator. */
  reset(options?: { seed?: number }): Promise<void>;
  /** A pure read of the running game. */
  snapshot(): Promise<VoluteSnapshot>;
  /** Pose what the start control on the title does: score 0, cells full, level 1. */
  start(): Promise<void>;
  /** Open `level`, exactly as the interlude before it opens it. */
  startLevel(level: number): Promise<void>;
  /** Replace every core on the channel with the cores given. */
  poseTrain(cores: readonly PosedCore[]): Promise<void>;
  /** Remove every core from the channel and every projectile. */
  clearTrain(): Promise<void>;
  /** Set the charge the injector holds loaded. The generator is untouched. */
  setLoaded(charge: ChargeId): Promise<void>;
  /** Set the charge the injector holds queued. The generator is untouched. */
  setQueued(charge: ChargeId): Promise<void>;
  /** Aim at `angleDegrees` and release the loaded core along it. Always launches. */
  fire(angleDegrees: number): Promise<void>;
  /** Set the pressure, clamped to 0 through 100. */
  setPressure(value: number): Promise<void>;
  /** Set the cores the inlet has left to emit this level. */
  setQuotaRemaining(n: number): Promise<void>;
  /** Grant a kind exactly as extracting a run holding that mark grants it. */
  grantMachinery(kind: MachineryKind): Promise<void>;
  /** Pose the pause control: the screen becomes `paused`. */
  pause(): Promise<void>;
  /** Pose it again: the screen returns to `playing`. */
  resume(): Promise<void>;
}

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
 * A bitmap source an idle frame named, as `recorder-init.js` writes it.
 *
 * `id` is identity WITHIN ONE PAGE: the same `<img>` drawn on a hundred frames
 * carries one id, and two different produced sprites never share one. `width` and
 * `height` are the source's own natural size, which is how a 28 x 28 core sprite
 * is told from a 24 x 24 HUD icon. `src` is present only when it is short enough
 * to be a path rather than an inlined file; `srcHash` is there either way — a
 * bundler is free to inline a small produced PNG as a `data:` URI, so a check
 * identifies a sprite by the image drawn and NEVER by matching a path under
 * `assets/`.
 */
export interface ImageRef {
  id: number;
  /** `"bitmap"` for anything a canvas can draw, `"pixels"` for an `ImageData`. */
  kind: "bitmap" | "pixels";
  /** The host type, such as `HTMLImageElement` or `HTMLCanvasElement`. */
  name: string;
  width: number;
  height: number;
  src: string | null;
  srcHash: string | null;
}

/** A sound the build emitted, and the tick of the drive it emitted it on. */
export interface TimedCue {
  /** The tick it sounded on, 1-based, as {@link Harness.tick} counts them. */
  tick: number;
  /** The simulated time at that tick, in milliseconds. */
  t: number;
}

/** How the field is mapped onto the canvas: one uniform scale and a letterbox. */
export interface Viewport {
  width: number;
  height: number;
  /** Device pixels per logical unit. */
  scale: number;
  /** The letterbox bars, in device pixels. */
  offsetX: number;
  offsetY: number;
  /** CSS pixels per logical unit, which is what the pointer is moved in. */
  cssScale: number;
  cssOffsetX: number;
  cssOffsetY: number;
}

export interface HarnessOptions {
  /** The window's CSS width. Defaults to the logical field width. */
  cssWidth?: number;
  /** The window's CSS height. Defaults to the logical field height. */
  cssHeight?: number;
  /** Device pixels per CSS pixel. Defaults to 1, so one device pixel is one unit. */
  dpr?: number;
  /** The seed the opening `reset` is given. Defaults to `DEFAULT_SEED`. */
  seed?: number;
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
 *
 * IT TRAVELS AS BYTES RATHER THAN AS NUMBERS. A whole field is 960 x 540 x 4 —
 * two million entries, which as a JSON array costs about five seconds to cross
 * out of the page and lands as sixteen megabytes of boxed numbers. Encoded as
 * base64 and decoded here it costs under two tenths of a second and two
 * megabytes, and the reading is identical, so a point that compares two whole
 * frames is affordable.
 */
export interface PixelRect {
  width: number;
  height: number;
  /** RGBA, four bytes per pixel, row-major. */
  data: Uint8ClampedArray;
}

/** A pixel rectangle as it crosses out of the page. */
interface EncodedRect {
  width: number;
  height: number;
  /** The RGBA bytes, base64. */
  b64: string;
}

/** An encoded rectangle as a {@link PixelRect}. */
function decodeRect(encoded: EncodedRect): PixelRect {
  return {
    width: encoded.width,
    height: encoded.height,
    data: new Uint8ClampedArray(Buffer.from(encoded.b64, "base64")),
  };
}

export interface Harness {
  /** The page the build is running in. For a check that needs Playwright itself. */
  readonly page: Page;
  /**
   * The surface the BUILD installed, as operations that cross into the page.
   *
   * Read off `window.__volute` and never constructed here — see
   * {@link unexposedSurface}.
   */
  readonly debug: VoluteDebugApi;
  /**
   * Why the build's surface cannot be driven, or `null` when it can.
   *
   * A fault here is the build's: the surface is missing, or it is missing an
   * operation the specification requires. It says what was found
   * (`window.__volute was still absent 10s after the page loaded`), and
   * {@link failSurface} pairs it with what the specification requires. Every
   * operation fails by assertion with that pair rather than throwing, so the
   * fault lands on the points whose checks reach the hall through the surface.
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
  /** Everything the page logged to `console.error`, or threw, oldest first. */
  readonly pageErrors: string[];

  /** The ticks this harness has stepped, 1-based, as a recorded frame counts them. */
  tick(): number;
  /** The simulated time those ticks covered, in milliseconds. */
  timeMs(): number;

  /** A fresh read of the game's state through the build's `snapshot`. */
  snapshot(): Promise<VoluteSnapshot>;
  /**
   * Run `ticks` whole simulation ticks and read the state they left.
   *
   * Each tick is opened and closed around a single `step(1)`, all inside one
   * synchronous evaluation, so nothing the page's own animation frame renders can
   * land inside a recorded frame — and so a frame the recorder keeps is exactly
   * one tick the game ran.
   */
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
  /** Hand the game back to its own frame loop for `ms` of real time, then take it back. */
  runFor(ms: number): Promise<void>;

  /** Press a key and leave it down, as a player holding it would. */
  hold(code: string): Promise<void>;
  /** Release a key held by {@link hold}. */
  release(code: string): Promise<void>;
  /**
   * Press a key, run the one tick that delivers it, and release it.
   *
   * A press that ran no tick would never reach the game, and a press released
   * before a tick ran would be invisible to a build that reads its keyboard by
   * comparing held state at the top of each tick — so the tick goes between the
   * two. Exactly one tick passes, so a caller's count moves by one.
   */
  tap(code: string): Promise<VoluteSnapshot>;
  /** Hold `code` for `ticks` ticks, then release it. */
  holdFor(code: string, ticks: number): Promise<VoluteSnapshot>;

  /** Move the pointer to a logical field point. Sets the aim on the next tick. */
  movePointer(x: number, y: number): Promise<void>;
  /**
   * Press and release a mouse button over the field, running one tick between.
   *
   * "The field answers a secondary press as a control", so `"right"` is the swap
   * control and `"left"` the fire control. The pointer is moved to the point
   * first, which also sets the aim — pass the point the shot is aimed at.
   */
  clickPointer(
    x: number,
    y: number,
    button?: "left" | "right",
  ): Promise<VoluteSnapshot>;

  /** Run exactly one tick and hand back every operation its render issued. */
  frameCalls(): Promise<DrawCall[]>;
  /** Every operation the last CLOSED tick's render issued, without stepping. */
  lastCalls(): Promise<DrawCall[]>;
  /** Reflect the surface without invoking it: `typeof` for each name, and the version. */
  probe(
    names: readonly string[],
  ): Promise<{ version: unknown; ops: Record<string, string> }>;

  /** How the field is mapped onto this harness's canvas. */
  viewport(): Viewport;
  /** Where a logical point lands in the canvas's backing store. */
  device(x: number, y: number): Point;
  /** Where a logical point lands in CSS pixels, which is where the pointer goes. */
  cssPoint(x: number, y: number): Point;
  /** The device pixel under a logical point, as `[r, g, b, a]`. */
  pixel(x: number, y: number): Promise<[number, number, number, number]>;
  /** Many logical points at once, in one crossing into the page. */
  pixels(points: readonly Point[]): Promise<[number, number, number, number][]>;
  /**
   * A rectangle of the canvas, addressed in logical units and read back as RGBA.
   *
   * The rectangle is `width` x `height` LOGICAL units with its top-left at
   * `(x, y)`; at the harness's default shape that is one device pixel per unit,
   * so a 28 x 28 read is the 28 x 28 sprite the build drew there.
   */
  pixelRect(
    x: number,
    y: number,
    width: number,
    height: number,
  ): Promise<PixelRect>;
  /** A pixel addressed in the canvas's own backing store, past the fit. */
  devicePixel(x: number, y: number): Promise<[number, number, number, number]>;
  /** The canvas's backing store size, as the build sized it. */
  surface(): Promise<{ width: number; height: number; dpr: number }>;

  /**
   * The RGBA bytes of a source a frame drew, by its {@link ImageRef} id.
   *
   * The produced file itself, at its own natural size, rather than the corner of
   * the field it landed on — which is what a check about a sprite's own pixels
   * needs. `null` when the page no longer holds that source.
   */
  imagePixels(id: number): Promise<PixelRect | null>;

  /** Give the build a real, browser-trusted gesture, so its audio can open. */
  armAudio(): Promise<void>;

  /** Release anything held, and let the page go. */
  dispose(): Promise<void>;
}

/* ---- The page ------------------------------------------------------------- */

/** The init scripts injected before any of the build's own script runs. */
const INIT_SCRIPTS = ["recorder-init.js", "audio-init.js"] as const;

/** This module's directory: the validator project's root. */
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * How long the surface is waited for before the build is called non-conformant.
 *
 * Generous against a conformant build and cheap against one: the wait is a poll
 * that returns the instant the global appears. A full-stack build loads its whole
 * produced set — fifteen sprites, three sheets, four systems and fifteen cues —
 * before it installs the surface, and `specs/assets.md` has it do exactly that,
 * so the ceiling has to clear a decode rather than a module evaluation. What it
 * really bounds is the cost of a build with no surface at all, which pays it once
 * per harness.
 */
const SURFACE_TIMEOUT_MS = 15_000;

let browserPromise: Promise<Browser> | null = null;

async function sharedBrowser(): Promise<Browser> {
  browserPromise ??= connectChromium(inject("voluteBrowserWs"));
  return browserPromise;
}

/**
 * One browser context per WINDOW SHAPE, shared by every harness of that shape in
 * this file, and one PAGE per harness inside it.
 *
 * The split is what the init scripts force and what correctness wants. The
 * recorder and the audio probe are installed on the CONTEXT, so every page it
 * opens is instrumented before a line of the build's script runs, and a context
 * is also where the viewport and the device pixel ratio are fixed. Everything
 * else about a harness is the page: a fresh one opens on a build that has just
 * started, with no key held, no audio context opened, and the mute preference
 * back off — which is a stronger guarantee than any reset the surface offers,
 * since `reset()` deliberately leaves muting alone.
 */
const contexts = new Map<string, BrowserContext>();

/** Every page this worker opened, so none is left behind in the shared browser. */
const openPages = new Set<Page>();

function shapeKey(cssWidth: number, cssHeight: number, dpr: number): string {
  return `${cssWidth}x${cssHeight}@${dpr}`;
}

/** The context for a window of this shape, opened and instrumented on demand. */
async function contextFor(
  cssWidth: number,
  cssHeight: number,
  dpr: number,
): Promise<BrowserContext> {
  const key = shapeKey(cssWidth, cssHeight, dpr);
  const existing = contexts.get(key);
  if (existing !== undefined) return existing;

  const browser = await sharedBrowser();
  const context = await browser.newContext({
    viewport: { width: cssWidth, height: cssHeight },
    deviceScaleFactor: dpr,
  });
  for (const name of INIT_SCRIPTS) {
    await context.addInitScript(readFileSync(join(PROJECT_ROOT, name), "utf8"));
  }
  contexts.set(key, context);
  return context;
}

/**
 * Shut everything this worker opened.
 *
 * Registered from `setup.ts` as an `afterAll`, so a suite file never has to think
 * about it and a worker cannot leave a page behind in the shared browser.
 */
export async function closeWorkerBrowser(): Promise<void> {
  for (const page of openPages) await page.close().catch(() => undefined);
  openPages.clear();
  for (const context of contexts.values()) {
    await context.close().catch(() => undefined);
  }
  contexts.clear();
  const browser = browserPromise;
  browserPromise = null;
  if (browser !== null) await (await browser).close().catch(() => undefined);
}

/* ---- The surface a build never installed ---------------------------------- */

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
  `a usable debug and automation surface on window.${HANDLE} as soon as the ` +
  `game has initialized, carrying every operation specs/instrumentation.md ` +
  `requires`;

/**
 * Fail the running check on `fault`, the harness's account of what is wrong
 * with the build's surface, paired with what the specification requires.
 */
export function failSurface(fault: string): never {
  return fail(SURFACE_REQUIREMENT, fault);
}

/**
 * What is wrong with the surface this page installed, or `null` when nothing
 * is: the surface never appeared, or it appeared without an operation the
 * specification requires.
 */
async function readSurfaceFault(page: Page): Promise<string | null> {
  try {
    await page.waitForFunction(
      (handle) =>
        typeof (window as never)[handle] === "object" &&
        (window as never)[handle] !== null,
      HANDLE,
      { timeout: SURFACE_TIMEOUT_MS },
    );
  } catch {
    return `window.${HANDLE} was still absent ${SURFACE_TIMEOUT_MS / 1000}s after the page loaded`;
  }
  const missing = await page.evaluate(
    ([handle, ops]) => {
      const target = (
        window as unknown as Record<string, Record<string, unknown>>
      )[handle];
      return ops.filter((op) => typeof target[op] !== "function");
    },
    [HANDLE, [...REQUIRED_OPS]] as const,
  );
  if (missing.length > 0) {
    return `window.${HANDLE} is installed but carries no ${missing
      .map((op) => `${op}()`)
      .join(", ")}`;
  }
  return null;
}

/* ---- Building one --------------------------------------------------------- */

/**
 * Load the built site in a browser, take the game off the wall clock, reset it to
 * the title on a known seed, and hand back everything a check reads.
 *
 * The default shape is the field's own size at one device pixel per CSS pixel, so
 * a logical coordinate, a CSS pixel and a canvas pixel are all the same thing and
 * no check has to think about the fit at all.
 */
export async function createHarness(
  options: HarnessOptions = {},
): Promise<Harness> {
  const cssWidth = options.cssWidth ?? FIELD_W;
  const cssHeight = options.cssHeight ?? FIELD_H;
  const dpr = options.dpr ?? 1;
  const seed = options.seed ?? DEFAULT_SEED;
  const context = await contextFor(cssWidth, cssHeight, dpr);
  const page = await context.newPage();
  openPages.add(page);

  // Whatever this page throws or logs as an error while THIS harness drives it.
  // The page belongs to one harness, so the log cannot pick up what some other
  // check provoked.
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => {
    pageErrors.push(String(error.message || error));
  });
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });

  await page.goto(inject("voluteUrl"), { waitUntil: "load" });

  const surfaceFault = await readSurfaceFault(page);
  const refuse = (): never => failSurface(surfaceFault ?? "");

  const call = async (operation: string, args: unknown[]): Promise<unknown> => {
    if (surfaceFault !== null) refuse();
    return page.evaluate(
      ([handle, name, rest]) =>
        (
          window as unknown as Record<
            string,
            Record<string, (...a: unknown[]) => unknown>
          >
        )[handle][name](...rest),
      [HANDLE, operation, args] as const,
    );
  };

  const debug =
    surfaceFault !== null
      ? unexposedSurface(surfaceFault)
      : (new Proxy({} as VoluteDebugApi, {
          get: (_target, property): unknown => {
            if (typeof property === "symbol") return undefined;
            if (property === "then" || property === "constructor")
              return undefined;
            const name = String(property);
            return (...args: unknown[]) => call(name, args);
          },
        }) as VoluteDebugApi);

  // What the build opened on, read before the `reset` below puts it back to the
  // title whatever it opened on. `specs/ui.md`: "The game opens here."
  const openingScreen =
    surfaceFault === null
      ? ((await call("snapshot", [])) as VoluteSnapshot).screen
      : null;

  if (surfaceFault === null) {
    // Off the wall clock and back to the title before a check touches anything:
    // from here the hall changes only when this harness says so. `reset` is what
    // seeds the generator, so a scenario driven from a known seed is reproducible
    // from this line on.
    await call("setAutoStep", [false]);
    await call("reset", [{ seed }]);
    // And a recorder over the surface before a check can arm one. A build is
    // free to ask for its 2D context on the frame it first draws rather than
    // while it initializes, so the surface can be installed and answering
    // before any context exists to record — and a `captureReplay` armed in that
    // window arms nothing and writes no evidence for a section that drew.
    await page
      .waitForFunction(
        () =>
          (
            window as unknown as { __voluteRec: { ready(): boolean } }
          ).__voluteRec.ready(),
        undefined,
        { timeout: SURFACE_TIMEOUT_MS },
      )
      .catch(() => undefined);
  }

  const view = fitViewport(cssWidth, cssHeight, dpr);
  const cueSinks: TimedCue[][] = [];
  let tickCount = 0;
  let timeMs = 0;

  /**
   * Run `ticks` ticks and read the state they left, in one crossing.
   *
   * Each tick is bracketed for the recorder, and the audio probe is read either
   * side of it, so a sound is attributed to the tick that produced it. `sample`
   * asks for the snapshot after every tick rather than only the last, which is
   * what a check about a cadence reads.
   */
  const drive = async (
    ticks: number,
    sample = false,
  ): Promise<{ snapshots: VoluteSnapshot[]; sounds: number[] }> => {
    if (surfaceFault !== null) refuse();
    const result = (await page.evaluate(
      ([handle, count, deltaMs, every]) => {
        const api = (
          window as unknown as Record<
            string,
            Record<string, (...a: unknown[]) => unknown>
          >
        )[handle];
        const rec = (
          window as unknown as {
            __voluteRec: Record<string, (...a: unknown[]) => unknown>;
          }
        ).__voluteRec;
        const audio = (
          window as unknown as { __voluteAudio: { started(): number } }
        ).__voluteAudio;
        const sounds: number[] = [];
        const snapshots: unknown[] = [];
        for (let i = 0; i < count; i += 1) {
          const before = audio.started();
          rec.begin();
          api.step(1);
          rec.end(deltaMs);
          sounds.push(audio.started() - before);
          if (every || i === count - 1) snapshots.push(api.snapshot());
        }
        if (count === 0) snapshots.push(api.snapshot());
        return { snapshots, sounds };
      },
      [HANDLE, Math.max(0, Math.floor(ticks)), TICK_MS, sample] as const,
    )) as { snapshots: VoluteSnapshot[]; sounds: number[] };

    for (const count of result.sounds) {
      tickCount += 1;
      timeMs += TICK_MS;
      for (let n = 0; n < count; n += 1) {
        for (const sink of cueSinks) sink.push({ tick: tickCount, t: timeMs });
      }
    }
    return result;
  };

  const last = (snapshots: VoluteSnapshot[]): VoluteSnapshot =>
    snapshots[snapshots.length - 1];

  const readPixels = async (
    devicePoints: readonly Point[],
  ): Promise<[number, number, number, number][]> =>
    page.evaluate((points) => {
      const canvases = Array.from(document.querySelectorAll("canvas"));
      if (canvases.length === 0)
        throw new Error("volute: the page has no <canvas>");
      let canvas = canvases[0];
      for (const other of canvases) {
        if (other.width * other.height > canvas.width * canvas.height)
          canvas = other;
      }
      const ctx = canvas.getContext("2d");
      if (ctx === null) throw new Error("volute: the canvas has no 2D context");
      return points.map((point) => {
        const x = Math.min(Math.max(point.x, 0), Math.max(canvas.width - 1, 0));
        const y = Math.min(
          Math.max(point.y, 0),
          Math.max(canvas.height - 1, 0),
        );
        const { data } = ctx.getImageData(x, y, 1, 1);
        return [data[0], data[1], data[2], data[3]] as [
          number,
          number,
          number,
          number,
        ];
      });
    }, devicePoints as Point[]);

  const harness: Harness = {
    page,
    debug,
    surfaceFault,
    openingScreen,
    pageErrors,

    tick: () => tickCount,
    timeMs: () => timeMs,

    snapshot: () => debug.snapshot(),

    async step(ticks = 1) {
      return last((await drive(ticks)).snapshots);
    },

    async stepUntil(predicate, untilOptions = {}) {
      const maxTicks = untilOptions.maxTicks ?? 600;
      const poll = Math.max(1, untilOptions.poll ?? 1);

      let snapshot = await this.snapshot();
      if (predicate(snapshot)) return { hit: true, ticks: 0, snapshot };

      let ticks = 0;
      while (ticks < maxTicks) {
        const stride = Math.min(poll, maxTicks - ticks);
        // Sampled per tick when the stride is one, so the snapshot handed back is
        // the state on the tick the predicate first held rather than a later one.
        snapshot = last((await drive(stride)).snapshots);
        ticks += stride;
        if (predicate(snapshot)) return { hit: true, ticks, snapshot };
      }
      return { hit: false, ticks, snapshot };
    },

    async stepWatching(ticks, watch) {
      const seen: VoluteSnapshot[] = [];
      for (let i = 0; i < ticks; i += 1) {
        const snapshot = last((await drive(1)).snapshots);
        seen.push(snapshot);
        if (watch?.(snapshot, i + 1) === true) break;
      }
      return seen;
    },

    async runFor(ms) {
      if (surfaceFault !== null) refuse();
      // The one thing here that depends on real elapsed time, so the one thing a
      // browser's own idea of which page matters can distort. The launch already
      // turns the throttling off; bringing the page forward as well means this
      // does not rest on a flag alone.
      await page.bringToFront().catch(() => undefined);
      await page.evaluate(
        ([handle]) => {
          (
            window as unknown as { __voluteRec: { setMode(m: string): void } }
          ).__voluteRec.setMode("raf");
          (
            window as unknown as Record<
              string,
              { setAutoStep(on: boolean): void }
            >
          )[handle].setAutoStep(true);
        },
        [HANDLE] as const,
      );
      await page.waitForTimeout(ms);
      await page.evaluate(
        ([handle]) => {
          (
            window as unknown as Record<
              string,
              { setAutoStep(on: boolean): void }
            >
          )[handle].setAutoStep(false);
          (
            window as unknown as { __voluteRec: { setMode(m: string): void } }
          ).__voluteRec.setMode("manual");
        },
        [HANDLE] as const,
      );
    },

    hold: (code) => page.keyboard.down(code),
    release: (code) => page.keyboard.up(code),

    async tap(code) {
      // Down, ONE tick, up. The tick between the two is what makes this a press a
      // build can actually see: an engineless build wrote its own keyboard layer,
      // and the two conformant ways to read a press — latching the edge in the
      // event handler, or comparing held state at the top of each tick — agree
      // only if the key is genuinely held while a tick runs.
      await page.keyboard.down(code);
      const snapshot = await this.step(1);
      await page.keyboard.up(code);
      return snapshot;
    },

    async holdFor(code, ticks) {
      await page.keyboard.down(code);
      try {
        return await this.step(ticks);
      } finally {
        await page.keyboard.up(code);
      }
    },

    async movePointer(x, y) {
      const at = this.cssPoint(x, y);
      await page.mouse.move(at.x, at.y);
    },

    async clickPointer(x, y, button = "left") {
      const at = this.cssPoint(x, y);
      await page.mouse.move(at.x, at.y);
      await page.mouse.down({ button });
      const snapshot = await this.step(1);
      await page.mouse.up({ button });
      return snapshot;
    },

    async frameCalls() {
      await drive(1);
      return this.lastCalls();
    },

    async lastCalls() {
      const ops = (await page.evaluate(() =>
        (
          window as unknown as { __voluteRec: { last(): unknown[] } }
        ).__voluteRec.last(),
      )) as RecordedOp[];
      return ops.map(toDrawCall);
    },

    probe: (names) =>
      page.evaluate(
        ([handle, wanted]) => {
          const target =
            (window as unknown as Record<string, Record<string, unknown>>)[
              handle
            ] ?? {};
          const ops: Record<string, string> = {};
          for (const name of wanted) ops[name] = typeof target[name];
          return { version: target.version, ops };
        },
        [HANDLE, [...names]] as const,
      ),

    viewport: () => ({ ...view }),
    device: (x, y) => toDevice(view, x, y),
    cssPoint: (x, y) => ({
      x: view.cssOffsetX + x * view.cssScale,
      y: view.cssOffsetY + y * view.cssScale,
    }),
    pixel: async (x, y) => (await readPixels([toDevice(view, x, y)]))[0],
    pixels: (points) => readPixels(points.map((p) => toDevice(view, p.x, p.y))),
    devicePixel: async (x, y) => (await readPixels([{ x, y }]))[0],

    async pixelRect(x, y, width, height) {
      const origin = toDevice(view, x, y);
      const deviceW = Math.max(1, Math.round(width * view.scale));
      const deviceH = Math.max(1, Math.round(height * view.scale));
      const encoded = (await page.evaluate(
        ([left, top, wide, high]) => {
          const canvases = Array.from(document.querySelectorAll("canvas"));
          if (canvases.length === 0)
            throw new Error("volute: the page has no <canvas>");
          let canvas = canvases[0];
          for (const other of canvases) {
            if (other.width * other.height > canvas.width * canvas.height)
              canvas = other;
          }
          const ctx = canvas.getContext("2d");
          if (ctx === null)
            throw new Error("volute: the canvas has no 2D context");
          const clampedX = Math.min(Math.max(left, 0), canvas.width);
          const clampedY = Math.min(Math.max(top, 0), canvas.height);
          const clampedW = Math.max(1, Math.min(wide, canvas.width - clampedX));
          const clampedH = Math.max(
            1,
            Math.min(high, canvas.height - clampedY),
          );
          const pixels = ctx.getImageData(
            clampedX,
            clampedY,
            clampedW,
            clampedH,
          );
          // Base64 rather than an array of numbers: see {@link PixelRect}. The
          // string is built in chunks because `String.fromCharCode` is applied to
          // its arguments, and two million of them overflow the stack.
          let binary = "";
          const chunk = 0x8000;
          for (let i = 0; i < pixels.data.length; i += chunk) {
            binary += String.fromCharCode(
              ...pixels.data.subarray(i, i + chunk),
            );
          }
          return {
            width: pixels.width,
            height: pixels.height,
            b64: btoa(binary),
          };
        },
        [origin.x, origin.y, deviceW, deviceH] as const,
      )) as EncodedRect;
      return decodeRect(encoded);
    },

    surface: () =>
      page.evaluate(() => {
        const canvases = Array.from(document.querySelectorAll("canvas"));
        if (canvases.length === 0) {
          throw new Error(
            "volute: the page has no <canvas>, so the build drew nowhere — " +
              "index.html supplies one and the build is asked not to edit it " +
              "(specs/overview.md)",
          );
        }
        let canvas = canvases[0];
        for (const other of canvases) {
          if (other.width * other.height > canvas.width * canvas.height)
            canvas = other;
        }
        return {
          width: canvas.width,
          height: canvas.height,
          dpr: window.devicePixelRatio,
        };
      }),

    async imagePixels(id) {
      const read = (await page.evaluate(
        (wanted) =>
          (
            window as unknown as {
              __voluteRec: {
                imagePixels(
                  n: number,
                ): { width: number; height: number; data: number[] } | null;
              };
            }
          ).__voluteRec.imagePixels(wanted),
        id,
      )) as { width: number; height: number; data: number[] } | null;
      if (read === null) return null;
      // A sprite is small enough that the array costs nothing; it is widened to
      // the same shape a canvas read has, so the two are interchangeable.
      return {
        width: read.width,
        height: read.height,
        data: Uint8ClampedArray.from(read.data),
      };
    },

    async armAudio() {
      // A GENUINE browser gesture, not a posed one: a build is free to open its
      // audio context from a real DOM event alone (both are conformant), so a key
      // delivered any other way would leave a perfectly good build silent. The key
      // is bound to nothing, so arming changes no game state.
      await page.keyboard.press(UNBOUND_KEY);
    },

    async dispose() {
      // The context stays: it holds the init scripts and the window shape, and the
      // next harness of this shape wants both. The page goes, so nothing this
      // check pressed, opened or muted can reach the next one.
      openPages.delete(page);
      await page.close().catch(() => undefined);
    },
  };

  harnessCues.set(harness, cueSinks);
  return harness;
}

/** Where {@link watchCues} attaches, per harness. */
const harnessCues = new WeakMap<Harness, TimedCue[][]>();

/* ---- The fit -------------------------------------------------------------- */

/**
 * How the field maps onto a surface of this shape, as `specs/overview.md` fixes
 * it: one uniform scale, the whole field inside, centred, with the leftover split
 * evenly into two bars.
 *
 * Computed rather than read from the build, deliberately. Under an engine the fit
 * is the engine's and a check can ask it what it derived; here the fit is the
 * build's own work, so asking it would be asking a build to grade itself. Every
 * check runs at the field's own size, where this is the identity and the question
 * does not arise.
 */
export function fitViewport(
  cssWidth: number,
  cssHeight: number,
  dpr: number,
): Viewport {
  const deviceWidth = Math.round(cssWidth * dpr);
  const deviceHeight = Math.round(cssHeight * dpr);
  const cssScale = Math.min(cssWidth / FIELD_W, cssHeight / FIELD_H);
  const scale = cssScale * dpr;
  return {
    width: FIELD_W,
    height: FIELD_H,
    scale,
    offsetX: (deviceWidth - FIELD_W * scale) / 2,
    offsetY: (deviceHeight - FIELD_H * scale) / 2,
    cssScale,
    cssOffsetX: (cssWidth - FIELD_W * cssScale) / 2,
    cssOffsetY: (cssHeight - FIELD_H * cssScale) / 2,
  };
}

function toDevice(view: Viewport, x: number, y: number): Point {
  return {
    x: Math.round(view.offsetX + x * view.scale),
    y: Math.round(view.offsetY + y * view.scale),
  };
}

/* -------------------------------------------------------------------------- */
/* Draw calls                                                                 */
/* -------------------------------------------------------------------------- */

/** One operation as the injected recorder writes it. */
export type RecordedOp =
  | { op: "call"; method: string; args: unknown[] }
  | { op: "set"; property: string; value: unknown };

function toDrawCall(op: RecordedOp): DrawCall {
  return op.op === "call"
    ? { kind: "call", method: op.method, args: op.args }
    : { kind: "set", property: op.property, value: op.value };
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

/** The {@link ImageRef} an argument names, or `null` when it is not a source. */
export function imageRef(value: unknown): ImageRef | null {
  if (value === null || typeof value !== "object") return null;
  const named = (value as { $src?: ImageRef }).$src;
  return named !== undefined && typeof named.id === "number" ? named : null;
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
 * A build is free to draw under a transform — to translate to a HUD corner and
 * draw at the origin, say — so the position a `fillText` names is only where the
 * text landed once the transform in force at that call is applied. This walks the
 * frame's operations carrying that transform. At the harness's default shape the
 * canvas is the field at one pixel per unit, so the result is in logical units.
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
 * A source is identified by the {@link ImageRef} the recorder gives it — its
 * per-page identity, its natural size, and a hash of wherever it came from —
 * NEVER by matching a path under `assets/`: `specs/assets.md` has the build
 * resolve every produced file through the bundler, and a bundler inlines a small
 * produced PNG as a `data:` URI, which is still the committed file.
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
// how a check produces one.
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
 * implementation, where the project root is `validation/none/` instead.
 */
const STAGED_PROJECT_DIR = "validation";

/**
 * The most frames a written recording holds.
 *
 * The injected recorder already holds the page's side to twice this, decimating
 * as it fills, so what arrives here is at most a few hundred frames however long
 * the section ran. This is the same cap the engine-backed harness writes under, so
 * a replay recorded under either engine is the same size of thing.
 */
const MAX_REPLAY_FRAMES = 300;

/**
 * The ground the console's player paints behind a recorded frame.
 *
 * The specification fixes no field colour: the build paints its own background
 * each frame, and the recorded frames carry that paint. What the player needs is
 * a colour for the canvas under them, and the page the build is served on is
 * painted `#000` by the case's own `index.html`, so that is what a replay says.
 */
export const REPLAY_BACKGROUND = "#000";

/** One frame of a recording, as the console's player reads it. */
export interface RecordedFrame {
  count: number;
  timeMs: number;
  deltaMs: number;
  surface: { width: number; height: number };
  /** Index into the recording's `states` of the state this frame inherited. */
  state: number;
  /**
   * Indices into the recording's `states` of the states saved under this frame,
   * outermost first.
   *
   * A build may `save` on one frame and `restore` on the next, so the stack of
   * saved states survives a frame boundary along with the state on top of it. A
   * player pushes these before the frame's own state, which is what makes a
   * `restore` among the frame's operations return where the original returned.
   */
  stack: number[];
  /** Indices into the recording's `ops`, in the order the frame issued them. */
  ops: number[];
  /**
   * Whether part of what this frame inherited was too large for the format to
   * carry, and was cut down to the bound.
   *
   * The save stack, the clip region and the current path are each shadowed by the
   * recorder and each bounded. Past a bound the recorder keeps what a following
   * operation can still reach and drops the rest, so the frame replays under a
   * state close to the build's rather than equal to it — and the player reports
   * that beside everything else it could not reproduce. Present only on a frame
   * that was in fact cut down.
   */
  truncated?: boolean;
}

/** The context state a frame is drawn from, before its own operations. */
export interface RecordedState {
  properties: Record<string, unknown>;
  transform: number[] | null;
  lineDash: number[] | null;
  /** The clip region in force, as the segments that built it, in order. */
  clip: RecordedPathSegment[];
  /**
   * The current path, as the operations issued since the last `beginPath`.
   *
   * A canvas keeps its path across a frame boundary, so a build is free to open
   * one on one frame and fill it on the next. Carrying it is also what an
   * inherited clip makes unavoidable: applying a clip means replaying that clip's
   * own path operations, which leaves the clip outline current, and a frame that
   * then issues a bare `fill` would fill the outline of its clip.
   */
  path: RecordedPathSegment[];
}

/**
 * One run of path operations, and the transform they were issued under.
 *
 * A path is given in user space, so both the clip and the current path are split
 * into one segment per transform and a player replays each under its own.
 */
export interface RecordedPathSegment {
  transform: number[] | null;
  ops: RecordedOp[];
}

/** A value the context produced, as the recipe that rebuilds it. */
export interface RecordedResource {
  make: { method: string; args: unknown[] };
  then: RecordedOp[];
}

/**
 * A recording, as the console's player reads it.
 *
 * A frame names its state and its operations by index, and the values those
 * operations draw with — the gradients, the captured images — live in tables the
 * whole recording shares. So every reference a frame makes resolves at whichever
 * frame a reviewer lands on, and each distinct thing is written once.
 */
export interface Recording {
  format: number;
  width: number;
  height: number;
  background: string | null;
  images: unknown[];
  resources: RecordedResource[];
  ops: RecordedOp[];
  states: RecordedState[];
  frames: RecordedFrame[];
}

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
 *
 * Two operations that mean the same thing have to serialize identically for a
 * table to hold one copy of each, and the key order inside an argument the build
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
 * WITH. Tables carried over whole would put operations, gradients and images in
 * the file that no frame asks for — dead weight in a document whose whole point
 * is to say each thing once, and the bulk of it in a game that draws procedurally
 * and so repeats almost nothing between frames.
 *
 * Every entry here is reached from a kept frame, and every reference inside one
 * is rewritten as it is reached, transitively: a frame names its own state and
 * the states saved under it, whose clip and path segments and inherited fill name
 * operations and resources, whose own creating calls may name images. What is
 * deduplicated is the rewritten entry, so an operation two hundred frames issue
 * identically is written once and named two hundred times, and every index a
 * frame carries addresses the table it was interned into.
 *
 * Exported for the suite beside this file, which drives it over a recording a
 * browser cannot deliver: Playwright's serializer drops an own field named
 * `__proto__` on the way out of the page, so handing one to this directly is the
 * only way to check that the rewrite carries it.
 */
export function retable(
  recording: Recording,
  frames: RecordedFrame[],
): Recording {
  const images: unknown[] = [];
  const imageAt = new Map<number, number>();
  const resources: RecordedResource[] = [];
  const resourceAt = new Map<number, number>();
  const ops: RecordedOp[] = [];
  const opAt = new Map<string, number>();
  const states: RecordedState[] = [];
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
    // A recipe's own arguments can only name values made before it, so rewriting
    // it terminates and cannot re-enter this resource.
    const rebuilt: RecordedResource = {
      make: { method: recipe.make.method, args: recipe.make.args.map(value) },
      then: recipe.then.map(operation),
    };
    const index = resources.length;
    resources.push(rebuilt);
    resourceAt.set(source, index);
    return index;
  };

  const value = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(value);
    if (entry === null || typeof entry !== "object") return entry;
    const record = entry as Record<string, unknown>;
    if (typeof record.$img === "number")
      return { $img: takeImage(record.$img) };
    if (typeof record.$res === "number")
      return { $res: takeResource(record.$res) };
    const rewritten: Record<string, unknown> = {};
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

  const operation = (op: RecordedOp): RecordedOp =>
    op.op === "call"
      ? { op: "call", method: op.method, args: op.args.map(value) }
      : { op: "set", property: op.property, value: value(op.value) };

  const segments = (list: RecordedPathSegment[]): RecordedPathSegment[] =>
    list.map((segment) => ({
      transform: segment.transform,
      ops: segment.ops.map(operation),
    }));

  const stateOf = (state: RecordedState): RecordedState => {
    const properties: Record<string, unknown> = {};
    for (const [name, held] of Object.entries(state.properties)) {
      Object.defineProperty(properties, name, {
        value: value(held),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return {
      properties,
      transform: state.transform,
      lineDash: state.lineDash,
      clip: segments(state.clip),
      path: segments(state.path),
    };
  };

  const takeState = (source: number): number =>
    intern(states, stateAt, stateOf(recording.states[source]));

  return {
    ...recording,
    images,
    resources,
    ops,
    states,
    frames: frames.map((frame) => ({
      ...frame,
      state: takeState(frame.state),
      stack: frame.stack.map(takeState),
      ops: frame.ops.map((op) =>
        intern(ops, opAt, operation(recording.ops[op])),
      ),
    })),
  };
}

/**
 * A recording of at most {@link MAX_REPLAY_FRAMES} frames, covering the whole of
 * what was captured, with each kept frame's `deltaMs` restated as the time since
 * the frame kept before it.
 *
 * The restatement is what makes a decimated recording play at the speed the game
 * really ran at: the deltas still sum to the section's elapsed time. The frame
 * `count` is left as it was recorded, so a reader can see that frames were
 * skipped rather than being told a smooth lie. The last frame is always kept
 * whatever the stride lands on — it is the frame the check's sweep stopped at, and
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
 * What survives is then re-expressed against tables of its own, so the file
 * carries what the kept frames draw with and nothing the dropped ones did.
 *
 * Exported for the suite beside this file, which reaches it over frame counts a
 * driven section cannot hand it. The injected recorder decimates in the page as
 * the section runs, halving its kept set the moment it reaches twice this cap, so
 * a written recording is thinned twice and what arrives here is never more than
 * twice the cap. Twice it EXACTLY does arrive, and with it the exact multiple of
 * the cap that the arithmetic above turns on: the page holds up to 599 frames
 * after a halving and its `stop()` appends the section's last frame to them, so a
 * section of 1,198 driven frames hands this 600. The displacement branch is
 * therefore ordinary production behaviour rather than a case only a test can pose.
 */
export function thinReplay(recording: Recording): Recording {
  const { frames } = recording;
  if (frames.length === 0) return recording;

  const stride = Math.max(1, Math.ceil(frames.length / MAX_REPLAY_FRAMES));
  const kept: RecordedFrame[] = [];
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
 * A capture that closed no frames writes nothing: a file holding an empty frame
 * list would be collected as an output that turned up, and the run would tell the
 * reviewer there is a replay to watch and then open the player on nothing.
 *
 * What lands on disk is gzip rather than raw JSON. A recording is text made
 * almost entirely of numbers and repeated field names, which gzip takes down to a
 * fraction of its size, and every host that serves one declares the encoding so
 * the browser inflates it before the player sees it. The document inside is the
 * same one.
 *
 * Never throws. A file that cannot be written says something about the machine the
 * validators ran on, and failing the point over it would blame the build for the
 * host's problem.
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

  await h.page.evaluate(
    (design) =>
      (
        window as unknown as { __voluteRec: { arm(d: unknown): boolean } }
      ).__voluteRec.arm(design),
    { width: FIELD_W, height: FIELD_H, background: REPLAY_BACKGROUND },
  );
  try {
    return await scenario();
  } finally {
    // In a `finally`, so a scenario that failed still leaves its evidence behind.
    const recording = (await h.page.evaluate(() =>
      (
        window as unknown as { __voluteRec: { disarm(): unknown } }
      ).__voluteRec.disarm(),
    )) as Recording | null;
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
export async function captureStill(
  h: Harness,
  outputId: string,
): Promise<void> {
  const destination = mediaDestination(outputId, "png");
  if (destination === null) return;
  try {
    mkdirSync(dirname(destination), { recursive: true });
    await h.page.screenshot({ path: destination, type: "png" });
  } catch (error) {
    console.warn(`volute: could not write ${destination}: ${String(error)}`);
  }
}

/* -------------------------------------------------------------------------- */
/* Cues                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Record every sound the build emits from now on, stamped with the tick of the
 * drive it sounded on.
 *
 * WHAT IS OBSERVED, AND WHY IT IS THE FAIR READING. `specs/ui.md` requires one
 * cue per event, played on the tick its event happens, and says nothing at all
 * about how a build makes a sound — under this engine the whole audio layer is
 * the build's. So `audio-init.js` watches the two doors a browser can emit sound
 * through (a Web Audio source being `start()`ed, whatever kind it is, and an
 * `<audio>` element being played) and counts what goes through them; the harness
 * brackets each driven tick around that count, so a sound is attributed to the
 * tick that produced it. A cue made of a tone and a noise burst counts as two,
 * which is why a check asserts that a tick sounded rather than how many times:
 * the number of sources is the build's business and the specification never fixed
 * it.
 *
 * WHAT IS LOST HERE THAT AN ENGINE GIVES. The cue's NAME. Under an engine the
 * game asks the bus for a cue by name and the bus announces it, so a build that
 * plays its extraction cue on every shot is caught. There is no bus here to ask,
 * so these checks confirm that a sound was emitted and on which tick, and a
 * reviewer decides by ear whether the fifteen are told apart. That is a real
 * reduction, and the alternative — inferring the cue from the waveform the
 * reference happens to use — would grade builds against an implementation rather
 * than against the specification.
 *
 * A POSE SOUNDS NOTHING. "Audio belongs to the ticks. A pose changes the state
 * alone and sounds nothing; the cues a scenario hears come from the ticks run
 * after it." So a cue raised by `fire()` sounds on the next tick STEPPED, not at
 * the call — arrange, then step, then read.
 */
export function watchCues(h: Harness): TimedCue[] {
  const played: TimedCue[] = [];
  harnessCues.get(h)?.push(played);
  return played;
}

/**
 * How many sources the build has running that are set to loop, right now.
 *
 * `specs/ui.md` has the two beds "loop until stopped rather than playing once",
 * and "Exactly one of them is looping on `playing`". A build that loops by
 * setting `loop` on its source is read directly here.
 *
 * A build that instead re-schedules the buffer end to end is equally conformant
 * and reports zero, so a check about the bed pairs this with
 * {@link soundsStarted}: a bed that is sounding at all is the weaker reading that
 * every conformant build satisfies.
 */
export function loopingSources(h: Harness): Promise<number> {
  return h.page.evaluate(() =>
    (
      window as unknown as { __voluteAudio: { looping(): number } }
    ).__voluteAudio.looping(),
  );
}

/** How many sounds the build has emitted since the page loaded. */
export function soundsStarted(h: Harness): Promise<number> {
  return h.page.evaluate(() =>
    (
      window as unknown as { __voluteAudio: { started(): number } }
    ).__voluteAudio.started(),
  );
}

/**
 * Step until the build has a looping bed running, and answer how many it has.
 *
 * WHY A CHECK HAS TO WAIT FOR THIS RATHER THAN READ IT ON ONE TICK.
 * `specs/assets.md` has the build load its own produced files, and a `.wav` is
 * DECODED asynchronously — so a bed asked for before its file finished decoding
 * cannot start yet, and a conformant build asks again on the next tick. That is
 * behaviour the specification leaves open, and a check that read the bed on one
 * fixed tick would pass or fail on how fast the host decoded rather than on what
 * the build did.
 *
 * It also cannot be waited for inside a step. {@link Harness.step} runs its whole
 * count inside ONE synchronous evaluation, so nothing the page awaits can settle
 * in the middle of it; this steps one tick at a time, and each tick is its own
 * crossing, which is what gives the page's own promises a turn.
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
    const running = await loopingSources(h);
    if (running > 0) return running;
    await h.step(1);
  }
  return loopingSources(h);
}

/**
 * Step until the build has emitted a sound at all, and answer how many it has.
 *
 * The weaker companion to {@link stepUntilBed}, for a build that runs its bed by
 * re-scheduling the buffer end to end rather than by setting `loop` — which
 * `specs/ui.md` permits, since it fixes what a bed SOUNDS like and not how it is
 * made. Same shape: one tick per crossing, no throw, and the count comes back
 * whatever it is.
 */
export async function stepUntilSound(
  h: Harness,
  maxTicks = 300,
): Promise<number> {
  for (let i = 0; i < maxTicks; i += 1) {
    const started = await soundsStarted(h);
    if (started > 0) return started;
    await h.step(1);
  }
  return soundsStarted(h);
}

/** How many of the sounds emitted were looping when they started. */
export function loopsStarted(h: Harness): Promise<number> {
  return h.page.evaluate(() =>
    (
      window as unknown as { __voluteAudio: { loopStarts(): number } }
    ).__voluteAudio.loopStarts(),
  );
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
export async function samplePatch(
  h: Harness,
  x: number,
  y: number,
  size = 9,
): Promise<Rgb> {
  const half = (size - 1) / 2;
  return meanColor(await h.pixelRect(x - half, y - half, size, size));
}

/**
 * The mean colour of the disc of `radius` centred on a logical point.
 *
 * What a check about a CORE reads: a core is a disc of {@link CORE_RADIUS} that
 * carries a glyph over its face, so one pixel is either the mineral or the glyph
 * and the mean over the disc is the charge.
 */
export async function sampleDisc(
  h: Harness,
  x: number,
  y: number,
  radius = CORE_RADIUS - 1,
): Promise<Rgb> {
  const size = 2 * radius + 1;
  const rect = await h.pixelRect(x - radius, y - radius, size, size);
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
export function fieldPixels(h: Harness): Promise<PixelRect> {
  return h.pixelRect(0, 0, FIELD_W, FIELD_H);
}

/* -------------------------------------------------------------------------- */
/* Scenario helpers                                                           */
/* -------------------------------------------------------------------------- */
//
// Each of these poses a situation through `window.__volute` and then lets the
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
 * Nothing here decides an outcome. Every extraction, score, chain step, grant,
 * cell and clear a check reads comes from the ticks it steps afterwards.
 */
export async function poseHall(
  h: Harness,
  options: PoseOptions = {},
): Promise<void> {
  await h.debug.startLevel(options.level ?? 1);
  await h.debug.setQuotaRemaining(options.quotaRemaining ?? 0);
  await h.debug.setPressure(options.pressure ?? 0);
  await h.debug.clearTrain();
  if (options.cores !== undefined && options.cores.length > 0) {
    await h.debug.poseTrain(options.cores);
  }
  if (options.loaded !== undefined) await h.debug.setLoaded(options.loaded);
  if (options.queued !== undefined) await h.debug.setQueued(options.queued);
  if (options.machinery !== undefined) {
    await h.debug.grantMachinery(options.machinery);
  }
}

/**
 * Open a run from the title exactly as the start control does, and open `level`.
 *
 * `start()` is "the score `0`, the cells at `CELLS` (`3`), and level `1` opened
 * exactly as `startLevel` opens it", so a run from a known seed is the harness's
 * opening `reset` followed by this. A `level` beyond 1 is opened after it, which
 * leaves the score and the cells at their opening values.
 */
export async function startRun(h: Harness, level = 1): Promise<void> {
  await h.debug.start();
  if (level !== 1) await h.debug.startLevel(level);
}

/**
 * Aim at `angleDegrees` and release the loaded core along it.
 *
 * `fire()` on the surface always launches — "Any cooldown outstanding at the call
 * is cleared first" — so this is how a check that is not ABOUT the cooldown gets
 * a projectile into the hall. A check that IS about the cooldown raises the fire
 * CONTROL instead, with {@link pressFire}, which honours it.
 */
export async function fireAt(h: Harness, angleDegrees: number): Promise<void> {
  await h.debug.fire(angleDegrees);
}

/** Aim at a field point and release the loaded core toward it. */
export async function fireToward(h: Harness, target: Point): Promise<void> {
  await h.debug.fire(aimAt(target));
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
 * the sweep out. `seated` is the core count rising, which is what an insertion
 * that did not immediately extract leaves; a check about the extraction reads the
 * train instead.
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
