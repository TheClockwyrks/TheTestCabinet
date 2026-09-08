// Volute — the case's half of the validator harness, under the Simple 2D engine.
// CASE-PROVIDED.
//
// Every check in this suite is an ordinary vitest test that runs IN THE SAME
// PROCESS as the build. It imports the engine and the build's own module, stands
// the engine up over a canvas it owns and a clock it chose, and steps the game
// with `engine.advance`. Nothing drives a browser, nothing polls, and no
// wall-clock time passes: a check asks for a number of ticks and gets exactly
// that number, at exactly the delta its clock supplied.
//
// THE MACHINERY THAT DOES THAT IS NOT VOLUTE'S. The canvas and its draw-command
// recorder, the debug surface read off the engine, the apply-threaded driver, the
// sweep, the cue stamping, the pixel and text readings, the host that serves the
// build's produced files, and the evidence a review item declares — every
// engine-backed case needs exactly that, and it lives once, in
// `@clockwyrks/case-harness`, staged beside this file as `./case-harness/`. What
// is left here is what is genuinely Volute's: the shape of its snapshot, the
// surface `specs/instrumentation.md` requires, the channel's own geometry, the
// way a produced sprite is identified, and the hall a scenario poses.
//
// WHAT A CHECK READS. The game's own state (through the debug surface's
// `snapshot`), the ticks this harness stepped, the operations the build issued
// against its 2D context, the pixels those operations left on the canvas, and the
// cues the engine's audio bus announced. Nothing here fabricates an outcome: the
// scenario helpers below only ARRANGE the hall through the surface, and the real
// `update` the build wrote is what runs from there.
//
// RECONCILING AFTER A POSE. `reconcile()` brings every reading the surface
// reports into agreement with the hall a pose has just arranged, without
// advancing anything, so a build that keeps a derived reading as a stored copy —
// the SEGMENTS, most often — answers for the hall as posed rather than as it
// was. {@link poseHall} and {@link startRun} reconcile before they return, so a
// check that poses through the helpers never calls it itself. A check that poses
// with `h.debug.set…` directly calls it once before its first read or sweep.
//
// WHERE THE SURFACE COMES FROM. Off `engine.debug`, never built here.
// `specs/instrumentation.md`: "the build's `initialize` returns the finished
// surface beside the state it built, as the pair `[state, debug]`. The engine
// returns that same value from `engine.debug`, and it is reached that way alone".
// Reading it back off the engine is the only route a check has to it, so a build
// that returned no surface, or a surface missing an operation, fails the checks
// that reach the hall through it — see {@link surfaceFaultOf}.
//
// HOW THE SURFACE IS DRIVEN. The engine holds the state by value and hands it out
// read-only, so the surface is pure: "A pose takes the current state, as
// `DeepReadonly<VoluteState>`, and returns the next `VoluteState`; a reading takes
// the state the same way and returns what it read." The package's `applyDriver`
// supplies the state — a reading is handed `engine.state`, a pose is run through
// `engine.apply` — and `promiseDriver` over the top of it is what lets a check
// still write `await h.debug.startLevel(2)`. Nothing a check does holds a writable
// state.
//
// THE CLOCK IS THE CHECK'S, AND THE STEP IS STATED HERE. The engine mandates no
// timestep: `specs/instrumentation.md` has a scenario pair "a `ConstantClock` of
// `1000 / 60` milliseconds with `engine.advance`" so one frame is exactly one
// simulation tick of `TICK_DT`. That clock is what every harness below is built
// with, so a duration written as a tick count means the same thing here as it
// does in the engineless project, and the tolerances the case states in ticks
// carry across unchanged. Nothing in this project hands the loop back to a real
// clock: the frames a check drives are the whole of what it measures, so a
// check lands the same ticks on any host.
//
// EVERY OPERATION IS STILL ASYNC. `engine.advance` and `engine.initialize` really
// are, and the rest are written the same way so one vocabulary — `await
// h.snapshot()`, `await h.debug.setPressure(50)` — reads the same in every one of
// this case's validator projects. The scenarios, the tolerances, and the
// assertions are the case's rather than the runtime's, so they are identical to
// the engineless project's; what differs is only how a drive reaches the game.
//
// THE HOST THE BUILD LOADS ITS PRODUCED FILES THROUGH. This is a full-stack case:
// the build produces its own sprites, sheets, systems and cues, commits them under
// `public/assets/`, and loads them through the engine's own loader
// (`specs/assets.md`). Node has no `fetch` that reads a page-relative path, no
// `createImageBitmap` and no `AudioContext`, so a check running here would see a
// build's every produced file fail to load — and the produced-asset points would
// fail every conformant build for a fact about the host. The package's
// {@link installAssetHost} and {@link installAudioContext} close that, bound below
// to the roots and the decoder this case has always used.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createCanvas,
  type Canvas,
  type Image,
  type SKRSContext2D,
} from "@napi-rs/canvas";
import {
  ConstantClock,
  createEngine,
  type Clock,
  type Engine,
  type Game,
  type SurfaceMetrics,
} from "@clockwyrks/simple-2d";
import type { DeepReadonly } from "ts-essentials";
import {
  applyDriver,
  breathe,
  captureOutput,
  createEngineCaseHarness,
  installAssetHost,
  installAudioContext,
  missingOpsFault,
  promiseDriver,
  wavAudioBuffer,
  DEFAULT_MAX_FRAMES,
  type DrivenEngine,
  type EngineHarnessOptions,
  type EngineViewport,
  type PureDriver,
  type TimedCue,
  type UntilOptions,
  type UntilResult as BaseUntilResult,
} from "./case-harness/engine/index";
import { makeReplayCapture } from "./case-harness/engine/2d";
import {
  callsTo,
  drawOps,
  drawnPoints,
  pointsNear,
  setsOf,
  DRAW_METHODS,
  type DrawCall,
} from "./case-harness/draw-calls";
import { drawnText, textDraws, type TextDraw } from "./case-harness/text";
import { differingPoints, pixelsDiffering } from "./case-harness/color";
import { apply, IDENTITY, numbers, transformed } from "./case-harness/matrix";
import type { Matrix } from "./case-harness/matrix";
import { distance } from "./case-harness/point";
import type { PixelRect } from "./case-harness/pixels";
import { BACKGROUND, game as build, type VoluteState } from "../src/game";
import { assertTruthy, fail } from "./assert";
import {
  BINDINGS,
  CELLS,
  CHANNEL,
  CHANNEL_ARC,
  FIELD_H,
  FIELD_W,
  HANDLE,
  INJECTOR,
  LAYOUT,
  PATH_LENGTH,
  READINGS,
  REQUIRED_OPS,
  SPACING,
  TICK_HZ,
  TICK_MS,
  UNBOUND_KEY,
  levelSpec,
  type ChargeId,
  type MachineryKind,
  type Point,
  type ScreenName,
  type TimedMachineryKind,
} from "./constants";

/* The readings this project takes straight off the package, under its names. */
export {
  callsTo,
  differingPoints,
  distance,
  drawOps,
  drawnPoints,
  drawnText,
  pixelsDiffering,
  pointsNear,
  setsOf,
  textDraws,
  DRAW_METHODS,
};
export type { DrawCall, PixelRect, TextDraw, TimedCue, UntilOptions };

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
  /** Whether the inlet emits, the driver's first switch. */
  emission: boolean;
  /** Whether the train advances, the driver's second switch. */
  feed: boolean;
  muted: boolean;
  /** Accumulated simulation time, in seconds. */
  simTime: number;
  /** The charge posed for the next emission, `null` while none stands. */
  nextEmitted: ChargeId | null;
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
 * The surface as `specs/instrumentation.md` fixes it under this engine, over the
 * build's own state type `S`.
 *
 * This is the specification written down as types, and it is the ONLY description
 * of the surface the validators read. The build declares its own `VoluteDebugApi`
 * in `src/game.ts`; nothing here imports it, and the harness reaches the object
 * itself through `engine.debug` alone, so a build whose surface departs from the
 * specification is held against the specification rather than against its own idea
 * of what it wrote.
 *
 * Every member is written in the shape of `update`: a POSE takes the current state
 * and returns the next one, and a READING takes the current state and returns what
 * it read. Neither touches the state it was handed.
 */
export interface VoluteSurface<S = unknown> {
  /** `VOLUTE_DEBUG_VERSION`, a plain number. */
  version: number;
  /** Restore every declared field to its title value. */
  reset(state: DeepReadonly<S>): S;
  /**
   * Bring every value the surface reports into agreement with the hall as it
   * stands, without advancing anything. A build that works its derived readings
   * out at the read has nothing to do; one that keeps any of them — the
   * segments, most often — rewrites that copy from its source.
   */
  reconcile(state: DeepReadonly<S>): S;
  /** A pure reading of the running game. */
  snapshot(state: DeepReadonly<S>): VoluteSnapshot;
  /** Set the screen, and nothing else. */
  setScreen(state: DeepReadonly<S>, name: ScreenName): S;
  /** Set the level in play, and nothing else. */
  setLevel(state: DeepReadonly<S>, level: number): S;
  /** Set the run's score, clamped to at least 0. */
  setScore(state: DeepReadonly<S>, n: number): S;
  /** Set the cells remaining, clamped to 0 through CELLS. */
  setCells(state: DeepReadonly<S>, n: number): S;
  /** Set the chain step, and restart the window that returns it to 1. */
  setChainStep(state: DeepReadonly<S>, k: number): S;
  /** Open `level`, exactly as the interlude before it opens it. */
  startLevel(state: DeepReadonly<S>, level: number): S;
  /** Replace every core on the channel with the cores given. */
  poseTrain(state: DeepReadonly<S>, cores: readonly PosedCore[]): S;
  /** Remove every core from the channel and every projectile. */
  clearTrain(state: DeepReadonly<S>): S;
  /** Set the charge the injector holds loaded, and nothing else. */
  setLoaded(state: DeepReadonly<S>, charge: ChargeId): S;
  /** Set the charge the injector holds queued, and nothing else. */
  setQueued(state: DeepReadonly<S>, charge: ChargeId): S;
  /** Pose the charge of the next core the inlet emits, or clear it with `null`. */
  setNextEmitted(state: DeepReadonly<S>, charge: ChargeId | null): S;
  /** Set the aim, normalized into [0, 360), and nothing else. */
  setAim(state: DeepReadonly<S>, angleDegrees: number): S;
  /** Release the loaded core along the current aim. Always launches. */
  fire(state: DeepReadonly<S>): S;
  /** Set the pressure, clamped to 0 through 100. */
  setPressure(state: DeepReadonly<S>, value: number): S;
  /** Set the cores the inlet has left to emit this level. */
  setQuotaRemaining(state: DeepReadonly<S>, n: number): S;
  /** Hold the inlet, and let it go again. */
  setEmission(state: DeepReadonly<S>, enabled: boolean): S;
  /** Hold the train where it stands, and let it advance again. */
  setFeed(state: DeepReadonly<S>, enabled: boolean): S;
  /** Grant one of the three timed kinds, as extracting its mark grants it. */
  grantMachinery(state: DeepReadonly<S>, kind: TimedMachineryKind): S;
  /** Pose the pause control: the screen becomes `paused`. */
  pause(state: DeepReadonly<S>): S;
  /** Pose it again: the screen returns to `playing`. */
  resume(state: DeepReadonly<S>): S;
}

/** The case's surface, bound to the state type the build declared. */
export type VoluteDebugSurface = VoluteSurface<VoluteState>;

/**
 * The pure surface with the state threaded through the engine, but still
 * synchronous: what the package's `applyDriver` produces, and what the kit's own
 * sweep reads a snapshot through.
 *
 * A step short of {@link VoluteDebugApi}, which is this with every member
 * answering a promise. Both exist because the two are genuinely different
 * audiences: the kit's `until` needs a reading it can take without awaiting, and
 * every suite in this case is written in the one async vocabulary its three
 * validator projects share.
 */
export type VoluteSyncDriver = PureDriver<
  DeepReadonly<VoluteState>,
  VoluteState,
  VoluteDebugSurface
>;

/**
 * The operations a check poses the hall through: every member of the surface,
 * minus its state argument, over the engine that holds the state.
 *
 * A pose `(state, ...args) => S` becomes `(...args) => Promise<void>`, run through
 * `engine.apply`; a reading `(state) => R` becomes `() => Promise<R>`, handed
 * `engine.state`. The promise is the project's own vocabulary rather than the
 * engine's — nothing here actually waits — so a suite reads identically to its
 * counterpart in the engineless project.
 */
export interface VoluteDebugApi {
  /** Restore every declared field to its title value. */
  reset(): Promise<void>;
  /**
   * Bring every value the surface reports into agreement with the hall as it
   * stands, without advancing anything. A build that works its derived readings
   * out at the read has nothing to do; one that keeps any of them — the
   * segments, most often — rewrites that copy from its source.
   */
  reconcile(): Promise<void>;
  /** A pure read of the running game. */
  snapshot(): Promise<VoluteSnapshot>;
  /** Set the screen, and nothing else. */
  setScreen(name: ScreenName): Promise<void>;
  /** Set the level in play, and nothing else. */
  setLevel(level: number): Promise<void>;
  /** Set the run's score, clamped to at least 0. */
  setScore(n: number): Promise<void>;
  /** Set the cells remaining, clamped to 0 through CELLS. */
  setCells(n: number): Promise<void>;
  /** Set the chain step, and restart the window that returns it to 1. */
  setChainStep(k: number): Promise<void>;
  /** Open `level`, exactly as the interlude before it opens it. */
  startLevel(level: number): Promise<void>;
  /** Replace every core on the channel with the cores given. */
  poseTrain(cores: readonly PosedCore[]): Promise<void>;
  /** Remove every core from the channel and every projectile. */
  clearTrain(): Promise<void>;
  /** Set the charge the injector holds loaded, and nothing else. */
  setLoaded(charge: ChargeId): Promise<void>;
  /** Set the charge the injector holds queued, and nothing else. */
  setQueued(charge: ChargeId): Promise<void>;
  /** Pose the charge of the next core the inlet emits, or clear it with `null`. */
  setNextEmitted(charge: ChargeId | null): Promise<void>;
  /** Set the aim, normalized into [0, 360), and nothing else. */
  setAim(angleDegrees: number): Promise<void>;
  /** Release the loaded core along the current aim. Always launches. */
  fire(): Promise<void>;
  /** Set the pressure, clamped to 0 through 100. */
  setPressure(value: number): Promise<void>;
  /** Set the cores the inlet has left to emit this level. */
  setQuotaRemaining(n: number): Promise<void>;
  /** Hold the inlet, and let it go again. */
  setEmission(enabled: boolean): Promise<void>;
  /** Hold the train where it stands, and let it advance again. */
  setFeed(enabled: boolean): Promise<void>;
  /** Grant one of the three timed kinds, as extracting its mark grants it. */
  grantMachinery(kind: TimedMachineryKind): Promise<void>;
  /** Pose the pause control: the screen becomes `paused`. */
  pause(): Promise<void>;
  /** Pose it again: the screen returns to `playing`. */
  resume(): Promise<void>;
}

/** The engine this project stands a build up on. */
export type VoluteEngine = Engine<VoluteState, VoluteDebugSurface>;

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
/* The host the build loads its produced files through                        */
/* -------------------------------------------------------------------------- */
//
// `specs/assets.md` has this build commit its produced files "under
// `public/assets/`, which the engine serves at its asset root", and load every
// one of them with `api.assets.loadImage`, `api.assets.load` and
// `api.audio.load`. The engine resolves each path under `assets/` and fetches it,
// which on a served page reaches the committed file and in a bare Node process
// reaches nothing.
//
// So the harness supplies the page's half, and each is the SAME loading the
// browser does rather than a stand-in for it: the fetch reads the very file the
// build committed, off the build's own `public/`, addressed by the path the build
// itself wrote; the decode is the canvas library the workspace already ships; and
// the audio context decodes the produced PCM `.wav` and does nothing else, since
// nothing here listens.
//
// WHAT WOULD HAPPEN WITHOUT IT. Every produced file would fail to load, and every
// point about a produced sprite would fail on every build ever written — a fact
// about Node rather than about the build. The engine's own documentation names
// this as the reason its loader takes its transport as an option: "the same game
// loads from a served page, from a build output, or from a test process without
// editing a line of it."

/** The directory this module sits in, which is the validator project's root. */
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * The build's repository root.
 *
 * The runner stages this project into the collected tree at `validation/`, which
 * is the sibling layout the project requires: a check resolves the build's
 * modules by the same relative paths the build itself uses, so `../src/game` here
 * is the module `src/main.ts` imports. The root is therefore this directory's
 * parent, taken from this module's own URL rather than from the working
 * directory — and never from the shared package's, which is staged one directory
 * deeper still.
 */
const WORKSPACE_ROOT = resolve(PROJECT_ROOT, "..");

/**
 * Where a page-relative asset URL is looked for, in order.
 *
 * NOT THE PACKAGE'S DEFAULT, AND THE ORDER IS LOAD-BEARING. `public/` first,
 * because that is where `specs/assets.md` tells the build to commit its produced
 * files and what Vite copies into `dist/` unchanged; `dist/` and the repository
 * root follow so a build that arranged its produced tree differently is still
 * loading its own committed files rather than nothing. Under the package's
 * `[".", "public", "dist"]` a build carrying the same path at its root would be
 * served that file instead, with nothing to say so.
 */
const ASSET_ROOTS = ["public", "dist", "."] as const;

/**
 * The transport, standing for the whole of this worker's run.
 *
 * `onMissing: "upstream"` is this case's own answer, and it is the one its
 * verdicts were taken under: a relative URL no root carries goes to the
 * platform's own `fetch`, which rejects on it, so the load fails with a parse
 * error rather than with a 404 status. No `document` shim: nothing in this build
 * asks for one, and a build that never asks cannot tell the difference.
 *
 * The handle is kept for {@link imageRef}, which asks it where a decoded image
 * came from — that is the one thing about a drawn bitmap this project cannot read
 * off the bitmap itself, and it is what separates a produced file from a canvas
 * the build painted geometry onto.
 */
const assets = installAssetHost({
  workspaceRoot: WORKSPACE_ROOT,
  roots: ASSET_ROOTS,
  onMissing: "upstream",
  images: true,
  documentElement: false,
  label: "volute",
});

/**
 * One 16-bit PCM `.wav` as the channel data an `AudioBuffer` reports.
 *
 * Enough of a decode to satisfy `api.audio.load`, which binds a cue name only
 * once its file decodes. Nothing here sounds, so what the samples are worth never
 * reaches a verdict; what matters is that a build's fifteen produced cues bind,
 * exactly as they do on a page. The `defaults` are the figures this case has
 * always fallen back on for a file that declares no usable `fmt ` chunk.
 *
 * Declared once, at module scope, because the package's audio host is reference
 * counted per worker and refuses a second install naming a DIFFERENT decoder —
 * a harness that asked for the samples and joined one answering silence would
 * read silence off every channel with nothing to say so.
 */
function decodeCue(bytes: Uint8Array): ReturnType<typeof wavAudioBuffer> {
  return wavAudioBuffer(bytes, {
    defaults: { sampleRate: 44100, channels: 1, bitsPerSample: 16 },
  });
}

installAudioContext({ decode: decodeCue });

/* -------------------------------------------------------------------------- */
/* Which produced file a frame drew                                           */
/* -------------------------------------------------------------------------- */
//
// THIS IS THE CASE'S OWN RECORDER IDENTITY, NOT THE PACKAGE'S. The package's
// recorder can intern a drawn bitmap for itself (`RecorderOptions.internImages`),
// and its `ImageRef` carries the same seven fields as the one below — but it fills
// two of them differently, and the difference decides a point:
//
//   - `src`/`srcHash` there come off the source object's OWN `src` property, which
//     is a string for a browser's `<img>` and a BUFFER for the canvas library's
//     decoded `Image`. Read that way every produced sprite in this project would
//     report `srcHash: null`, and `presentation/produced-core-sprites` asserts on
//     exactly that field being present.
//   - `kind` there is `"pixels"` for any source carrying a `data` member, and the
//     canvas library's `Canvas` carries `data` as a METHOD, so a scratch canvas a
//     build painted would report `"pixels"` rather than `"bitmap"`.
//
// So Volute keeps its own reading: the source's URL comes from the asset host,
// which is where the decode actually happened, and `hash()` is this project's own
// digest of it. See the package README's collision table.

/** A 32-bit hash of a string, as the identity a source URL is named by. */
function hash(text: string): string {
  let value = 0;
  for (let i = 0; i < text.length; i += 1) {
    value = (Math.imul(value, 31) + text.charCodeAt(i)) | 0;
  }
  return (value >>> 0).toString(16).padStart(8, "0");
}

/**
 * A bitmap source a frame drew, as this harness names it.
 *
 * `id` is identity WITHIN ONE WORKER: the same decoded sprite drawn on a hundred
 * frames carries one id, and two different produced sprites never share one.
 * `width` and `height` are the source's own natural size, which is how a 28 x 28
 * core sprite is told from a 24 x 24 HUD icon. `src` is the asset path the build
 * asked the engine's loader for; `srcHash` is a digest of it, and both are absent
 * on a source the build painted itself — a canvas it drew geometry onto — which
 * is what separates a decoded produced file from code-drawn art.
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

/** Every source this process has seen a frame draw, by the id it was given. */
const imageIds = new WeakMap<object, number>();
const imagesById = new Map<number, object>();
let nextImageId = 1;

/** The {@link ImageRef} an argument names, or `null` when it is not a source. */
export function imageRef(value: unknown): ImageRef | null {
  if (value === null || typeof value !== "object") return null;
  const source = value as {
    width?: unknown;
    height?: unknown;
    data?: unknown;
    constructor?: { name?: string };
  };
  if (typeof source.width !== "number" || typeof source.height !== "number") {
    return null;
  }
  let id = imageIds.get(value);
  if (id === undefined) {
    id = nextImageId;
    nextImageId += 1;
    imageIds.set(value, id);
    imagesById.set(id, value);
  }
  const from = assets.sourceOf(value);
  return {
    id,
    kind: source.data instanceof Uint8ClampedArray ? "pixels" : "bitmap",
    name: source.constructor?.name ?? "object",
    width: source.width,
    height: source.height,
    src: from,
    srcHash: from === null ? null : hash(from),
  };
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
 * The package's own `imageDraws` is the same walk over its own `imageRef`, and
 * this is here rather than bound to it for the one reason stated above: the two
 * `imageRef`s disagree about `srcHash` and about `kind`.
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

/* -------------------------------------------------------------------------- */
/* The surface a build never returned                                         */
/* -------------------------------------------------------------------------- */

/**
 * What `specs/instrumentation.md` requires of the surface: the `Expected:` line of
 * the failure a build with no usable surface lands on every check that reaches
 * for it, beside the {@link Harness.surfaceFault} that says what was found.
 */
export const SURFACE_REQUIREMENT =
  `a debug and automation surface returned beside the state from the build's ` +
  `initialize, as [state, debug], which the engine hands back from ` +
  `${HANDLE}, carrying every operation specs/instrumentation.md requires`;

/**
 * Fail the running check on `fault`, the harness's account of what is wrong with
 * the build's surface, paired with what the specification requires.
 */
export function failSurface(fault: string): never {
  return fail(SURFACE_REQUIREMENT, fault);
}

/**
 * Why the build's surface cannot be driven, or `null` when it can.
 *
 * Read off `engine.debug` directly rather than off whatever the kit handed the
 * driver, because the kit already stands a fail-on-access proxy in for a return
 * that is not an object — and asking THAT what it carries would raise the
 * verdict here, inside the `beforeEach`, instead of on the points whose checks
 * reach the hall through the surface.
 */
function surfaceFaultOf(engine: VoluteEngine): string | null {
  const held: unknown = engine.debug;
  if (typeof held !== "object" || held === null) {
    return `${HANDLE} holds ${held === null ? "null" : typeof held}, not an object`;
  }
  return missingOpsFault(held, REQUIRED_OPS);
}

/**
 * A stand-in for a surface that is missing or incomplete: every operation on it
 * fails the check that reached for it, with the fault named.
 *
 * A FUNCTION THAT FAILS WHEN CALLED, which is the engineless half's shape rather
 * than `absentSurface`'s fail-at-access. This project's suites reflect the surface
 * through {@link Harness.probe}, which reads `engine.debug` itself, so nothing
 * here needs to answer a `typeof` — and a stand-in that failed at the access would
 * fail the reads the driver below makes on its way to a call.
 *
 * Keys that belong to the MACHINERY rather than to a check are answered with
 * `undefined` instead: awaiting a value probes `then`, and vitest's own error
 * formatting probes symbols and `constructor`. Failing those would replace the
 * verdict below with noise from the machinery that was trying to report it.
 */
function unusableSurface<D extends object>(reason: string): D {
  return new Proxy({} as D, {
    get: (_target, property): unknown => {
      if (typeof property === "symbol") return undefined;
      if (property === "then" || property === "constructor") return undefined;
      return () => failSurface(reason);
    },
  });
}

/* -------------------------------------------------------------------------- */
/* The harness                                                                */
/* -------------------------------------------------------------------------- */

/** How the field is mapped onto the canvas, as the ENGINE's own fit reports it. */
export type Viewport = EngineViewport;

export interface HarnessOptions extends EngineHarnessOptions {
  /** The clock each frame takes its delta from. Defaults to one tick a frame. */
  clock?: Clock;
}

/** What a sweep found: whether the predicate ever held, and where it stopped. */
export type UntilResult = BaseUntilResult<VoluteSnapshot>;

export interface Harness {
  /** The engine the build's game is bound to. */
  readonly engine: VoluteEngine;
  /**
   * The surface the BUILD returned beside its state, driven over the engine:
   * each pose runs through `engine.apply`, each reading is handed `engine.state`.
   *
   * The raw surface is read off `engine.debug` rather than built here, and the
   * driver is the package's apply-threaded strategy with a promise wrap over it.
   */
  readonly debug: VoluteDebugApi;
  /**
   * Why the build's surface cannot be driven, or `null` when it can.
   *
   * A fault here is the build's: `engine.debug` held no object, or the object it
   * held is missing an operation the specification requires. It says what was
   * found, and {@link failSurface} pairs it with what the specification requires.
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
  /** Everything the build threw while this harness drove it, oldest first. */
  readonly pageErrors: string[];
  /** The real 2D context the engine drew through, for `getImageData`. */
  readonly ctx: SKRSContext2D;
  /** The surface the engine drew into, holding the last frame that ran. */
  readonly canvas: Canvas;

  /** The ticks this harness has stepped, 1-based, as a recorded frame counts them. */
  tick(): number;
  /** The simulated time those ticks covered, in milliseconds. */
  timeMs(): number;

  /** A fresh read of the game's state through the build's `snapshot`. */
  snapshot(): Promise<VoluteSnapshot>;
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
  /** Press a key and leave it down, as a player holding it would. */
  hold(code: string): Promise<void>;
  /** Release a key held by {@link hold}. */
  release(code: string): Promise<void>;
  /**
   * Press a key, run the one tick that delivers it, and release it.
   *
   * The engine closes the input frame after the game has rendered, discarding
   * every edge nothing consumed, so a press that ran no tick would never reach
   * the game. Exactly one tick passes, so a caller's count moves by one.
   */
  tap(code: string): Promise<VoluteSnapshot>;
  /** Hold `code` for `ticks` ticks, then release it. */
  holdFor(code: string, ticks: number): Promise<VoluteSnapshot>;

  /** Move the pointer to a logical field point. Sets the aim on the next tick. */
  movePointer(x: number, y: number): Promise<void>;
  /**
   * Press and release the pointer over the field, running one tick between.
   *
   * The pointer is moved to the point first, which also sets the aim — pass the
   * point the shot is aimed at.
   */
  clickPointer(x: number, y: number): Promise<VoluteSnapshot>;

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
  /** Many logical points at once. */
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
  /** The canvas's backing store size, as the engine sized it. */
  surface(): Promise<{ width: number; height: number; dpr: number }>;

  /**
   * The RGBA bytes of a source a frame drew, by its {@link ImageRef} id.
   *
   * The produced file itself, at its own natural size, rather than the corner of
   * the field it landed on — which is what a check about a sprite's own pixels
   * needs. `null` when nothing this harness saw carries that id.
   */
  imagePixels(id: number): Promise<PixelRect | null>;

  /** Give the build a gesture, so the engine's audio unlocks. */
  armAudio(): Promise<void>;

  /** Drop the engine's listeners and release the canvas. */
  dispose(): Promise<void>;
}

/**
 * The game the build exported, typed against the surface the CASE specifies.
 *
 * The build declares its own type for the surface its `initialize` returns, and
 * that type is the build's: what a check holds it to is the {@link VoluteSurface}
 * above, so the game is cast to the case's `Game<VoluteState, VoluteDebugSurface>`
 * here and the engine is parameterized with it. A surface that departs from the
 * specification is caught where a check reaches for the missing member, not by the
 * build's own compiler.
 */
const game = build as unknown as Game<VoluteState, VoluteDebugSurface>;

/**
 * How many loops each engine's bus has stopped, counted from before the game was
 * initialized. See the subscription in `createEngine` below.
 */
const loopStops = new WeakMap<object, { n: number }>();

/**
 * The package's engine machinery, bound to Volute on this engine.
 *
 * `projectRoot` comes from THIS module and must never come from the package's:
 * the package is staged one directory deeper than this file, and a produced
 * replay or still is addressed by the running suite's path relative to the
 * project root.
 *
 * `cueEvents` names both firings, because `specs/ui.md` treats the two beds as
 * cues like any other and a check about a bed cannot read it without them; the
 * one-shot checks pose a hall in which no bed can start, and {@link TimedCue}'s
 * `looped` tells the two apart afterwards.
 *
 * The recorder measures text (`measureText`), so every `fillText`/`strokeText`
 * carries the width and alignment the package's merge rule needs to coalesce a
 * letter-spaced heading back into the run it spells — which is what the
 * package's `drewText` and `drawnTextLines` (`case-harness/text`) read copy and
 * figures off, and why `specs/ui.md` can fix the copy a screen shows while
 * leaving its spacing to the build. No `internImages`: the identity a produced
 * sprite is recognized by is {@link imageRef}'s, above.
 */
const kit = createEngineCaseHarness<
  VoluteSnapshot,
  VoluteSyncDriver,
  VoluteEngine
>({
  slug: "volute",
  projectRoot: PROJECT_ROOT,
  stage: { width: FIELD_W, height: FIELD_H },
  tickHz: TICK_HZ,
  surfaceRequirement: SURFACE_REQUIREMENT,
  cueEvents: ["cue:played", "cue:looped"],
  recorder: { measureText: true },
  defaultClock: () => new ConstantClock(TICK_MS),
  createEngine: ({ canvas, clock, surface }) => {
    const engine = createEngine<VoluteState, VoluteDebugSurface>({
      canvas,
      width: FIELD_W,
      height: FIELD_H,
      game,
      // The build's own field background, handed to the engine exactly as the
      // seeded `src/main.ts` hands it (specs/overview.md).
      background: BACKGROUND,
      layout: LAYOUT,
      clock: clock as Clock,
      surface: surface as SurfaceMetrics,
    });
    // SUBSCRIBED HERE, WHICH IS BEFORE `initialize`. The kit takes `cue:played`
    // and `cue:looped` before it initializes the game, and the stop has to be
    // taken at the same moment or the running-loop count is wrong for the life of
    // the harness: `AudioBus.load` stops a loop it is about to rebind, which is
    // exactly what a build that opens a bed and then binds its produced file from
    // `initialize` does. A stop counted as never having happened leaves
    // {@link loopingSources} one bed too high, and that decides `audio/music-bed`
    // and `audio/danger-bed-swap`.
    const stops = { n: 0 };
    loopStops.set(engine, stops);
    (engine as unknown as DrivenEngine).events.on("cue:stopped", () => {
      stops.n += 1;
    });
    return engine;
  },
  driver: (engine, raw) => {
    const fault = surfaceFaultOf(engine);
    if (fault !== null) return unusableSurface<VoluteSyncDriver>(fault);
    return applyDriver<
      DeepReadonly<VoluteState>,
      VoluteState,
      VoluteSyncDriver
    >(engine, raw, { readings: READINGS });
  },
  snapshot: (debug) => debug.snapshot(),
  // No camera stands between the field and the canvas under this engine: the
  // engine maps the design size onto the backing store and nothing else.
  pointerPrecision: "exact",
});

/**
 * Stand the engine up over a canvas of the harness's own, initialize the build's
 * game, reset it to the title, and hand back everything a check reads.
 *
 * The default shape is the field's own size at one device pixel per CSS pixel, so
 * a logical coordinate, a CSS pixel and a canvas pixel are all the same thing and
 * no check has to think about the fit at all.
 *
 * WHY THIS WRAPS THE KIT RATHER THAN EXTENDING IT. This project's vocabulary is
 * the engineless one — `await h.snapshot()`, `await h.step(2)` — because its
 * suites are the same suites, word for word, as `validation/none`'s. The kit's
 * own harness answers a snapshot synchronously, which is the right reading for a
 * project running in the same process as the build; folding the two names
 * together would leave `h.snapshot()` meaning two things at once. So the kit's
 * harness is the machinery underneath, and what a check holds is this case's own
 * shape over it.
 */
export async function createHarness(
  options: HarnessOptions = {},
): Promise<Harness> {
  const base = await kit.createHarness(options);
  const engine = base.engine;
  const calls = base.calls;

  const surfaceFault = surfaceFaultOf(engine);
  const debug: VoluteDebugApi =
    surfaceFault === null
      ? promiseDriver<VoluteSyncDriver, VoluteDebugApi>(base.debug)
      : unusableSurface<VoluteDebugApi>(surfaceFault);

  // What the build opened on, read before the `reset` below puts it back to the
  // title whatever it opened on. `specs/ui.md`: "The game opens here."
  const openingScreen =
    surfaceFault === null ? (await debug.snapshot()).screen : null;

  // Back to the title before a check touches anything, so every scenario is
  // posed from the same title values.
  if (surfaceFault === null) await debug.reset();

  // Every driven tick opens a fresh operation log, so `lastCalls` is the last
  // tick's render and nothing before it, and a drive of ten thousand ticks costs
  // one tick's worth of operations rather than ten thousand.
  const driveErrors: string[] = [];
  const drive = async (ticks: number): Promise<void> => {
    const count = Math.max(0, Math.floor(ticks));
    for (let i = 0; i < count; i += 1) {
      calls.length = 0;
      try {
        await base.advance(1);
      } catch (error) {
        driveErrors.push(
          String(error instanceof Error ? error.message : error),
        );
        throw error;
      }
    }
  };

  // A loop the bus is running is the difference between the loops it started and
  // the loops it stopped. The kit records the starts (`cue:looped` is in
  // `cueEvents` above); the stops were counted from `createEngine`, before the
  // game was initialized, so a stop raised by the build's own loading is in the
  // balance rather than lost.
  const stops = loopStops.get(engine) ?? { n: 0 };

  const readRect = (
    left: number,
    top: number,
    wide: number,
    high: number,
  ): PixelRect => {
    const canvas = base.canvas;
    const clampedX = Math.min(Math.max(left, 0), canvas.width);
    const clampedY = Math.min(Math.max(top, 0), canvas.height);
    const clampedW = Math.max(1, Math.min(wide, canvas.width - clampedX));
    const clampedH = Math.max(1, Math.min(high, canvas.height - clampedY));
    const pixels = base.ctx.getImageData(
      clampedX,
      clampedY,
      clampedW,
      clampedH,
    );
    return {
      width: pixels.width,
      height: pixels.height,
      data: new Uint8ClampedArray(pixels.data),
    };
  };

  const harness: Harness = {
    engine,
    debug,
    surfaceFault,
    openingScreen,
    get pageErrors(): string[] {
      return [
        ...base.assetFailures.map(
          (failure) => `asset ${failure.path} failed: ${failure.reason}`,
        ),
        ...driveErrors,
      ];
    },
    ctx: base.ctx,
    canvas: base.canvas,

    tick: () => base.tick(),
    timeMs: () => base.timeMs(),

    snapshot: () => debug.snapshot(),

    async step(ticks = 1) {
      await drive(ticks);
      return debug.snapshot();
    },

    async stepUntil(predicate, untilOptions = {}) {
      // NOT the kit's own `until`, and the difference is one line: the kit
      // advances the engine directly, where this drives through {@link drive},
      // which opens a fresh operation log per tick. A check that sweeps to an
      // event and then reads {@link Harness.lastCalls} — `presentation/hud-score`
      // does exactly that — would otherwise be handed every frame of the sweep at
      // once, and a reading that asks whether the HUD showed a figure can only
      // get MORE generous the more frames it is shown. The sweep is otherwise the
      // kit's, `breathe` included.
      const maxTicks =
        untilOptions.maxTicks ?? untilOptions.maxFrames ?? DEFAULT_MAX_FRAMES;
      const poll = Math.max(1, untilOptions.poll ?? 1);

      let snapshot = await debug.snapshot();
      if (predicate(snapshot)) {
        return { hit: true, frames: 0, ticks: 0, snapshot };
      }

      let ticks = 0;
      let sinceYield = 0;
      while (ticks < maxTicks) {
        const stride = Math.min(poll, maxTicks - ticks);
        await drive(stride);
        ticks += stride;
        sinceYield += stride;
        snapshot = await debug.snapshot();
        if (predicate(snapshot)) {
          return { hit: true, frames: ticks, ticks, snapshot };
        }
        // A sweep of several hundred ticks runs inside one `await`, and the
        // reporter, the timers and every socket read live on the loop it is
        // holding. Nothing observable changes; the host stops looking hung.
        sinceYield = await breathe(sinceYield);
      }
      return { hit: false, frames: ticks, ticks, snapshot };
    },

    async stepWatching(ticks, watch) {
      const seen: VoluteSnapshot[] = [];
      for (let i = 0; i < ticks; i += 1) {
        await drive(1);
        const snapshot = await debug.snapshot();
        seen.push(snapshot);
        if (watch?.(snapshot, i + 1) === true) break;
      }
      return seen;
    },

    hold: (code) => {
      base.hold(code);
      return Promise.resolve();
    },
    release: (code) => {
      base.release(code);
      return Promise.resolve();
    },

    async tap(code) {
      // Down, ONE tick, up. The engine arms the edge at the event and discards it
      // after the frame that could have consumed it, so the tick between the two
      // is what makes this a press the game can actually see.
      base.hold(code);
      const snapshot = await this.step(1);
      base.release(code);
      return snapshot;
    },

    async holdFor(code, ticks) {
      base.hold(code);
      try {
        return await this.step(ticks);
      } finally {
        base.release(code);
      }
    },

    movePointer(x, y) {
      base.pointer("pointermove", x, y);
      return Promise.resolve();
    },

    async clickPointer(x, y) {
      base.pointer("pointermove", x, y);
      base.pointer("pointerdown", x, y);
      const snapshot = await this.step(1);
      base.pointer("pointerup", x, y);
      return snapshot;
    },

    async frameCalls() {
      await drive(1);
      return [...calls];
    },

    lastCalls: () => Promise.resolve([...calls]),

    probe: (names) => {
      const held: unknown = engine.debug;
      const surface = (
        typeof held === "object" && held !== null ? held : {}
      ) as Record<string, unknown>;
      const ops: Record<string, string> = {};
      for (const name of names) ops[name] = typeof surface[name];
      return Promise.resolve({ version: surface.version, ops });
    },

    viewport: () => base.viewport(),
    device: (x, y) => base.device(x, y),
    cssPoint(x, y) {
      // The inverse of the engine's own mapping, which is what a pointer event
      // reports: device pixels back into the CSS pixels the surface is laid out
      // in. At this project's default shape the two coincide.
      const view = base.viewport();
      return {
        x: (view.offsetX + x * view.scale) / base.shape.dpr,
        y: (view.offsetY + y * view.scale) / base.shape.dpr,
      };
    },

    // Through {@link Harness.devicePixel} rather than through the kit's own
    // `pixel`, which reads the backing store at whatever coordinate it is handed:
    // this project's reading has always been CLAMPED to the canvas, so a point
    // off the field answers the nearest pixel rather than throwing.
    pixel(x, y) {
      const at = base.device(x, y);
      return this.devicePixel(at.x, at.y);
    },

    async pixels(points) {
      const read: [number, number, number, number][] = [];
      for (const point of points) read.push(await this.pixel(point.x, point.y));
      return read;
    },

    devicePixel: (x, y) => {
      const rect = readRect(Math.round(x), Math.round(y), 1, 1);
      return Promise.resolve([
        rect.data[0],
        rect.data[1],
        rect.data[2],
        rect.data[3],
      ]);
    },

    pixelRect(x, y, width, height) {
      const view = base.viewport();
      const origin = base.device(x, y);
      return Promise.resolve(
        readRect(
          origin.x,
          origin.y,
          Math.max(1, Math.round(width * view.scale)),
          Math.max(1, Math.round(height * view.scale)),
        ),
      );
    },

    surface: () =>
      Promise.resolve({
        width: base.canvas.width,
        height: base.canvas.height,
        dpr: base.shape.dpr,
      }),

    imagePixels(id) {
      const source = imagesById.get(id);
      if (source === undefined) return Promise.resolve(null);
      const bitmap = source as { width: number; height: number };
      const scratch = createCanvas(
        Math.max(1, bitmap.width),
        Math.max(1, bitmap.height),
      );
      const into = scratch.getContext("2d");
      try {
        into.drawImage(
          source as unknown as Image,
          0,
          0,
          bitmap.width,
          bitmap.height,
        );
      } catch {
        return Promise.resolve(null);
      }
      const pixels = into.getImageData(0, 0, scratch.width, scratch.height);
      return Promise.resolve({
        width: pixels.width,
        height: pixels.height,
        data: new Uint8ClampedArray(pixels.data),
      });
    },

    armAudio() {
      // The engine opens its audio context on the first pointer or key event it
      // sees. The key is bound to nothing, so arming changes no game state.
      base.hold(UNBOUND_KEY);
      base.release(UNBOUND_KEY);
      return Promise.resolve();
    },

    dispose() {
      base.dispose();
      // The cue bookkeeping goes with the harness, so a reading taken after a
      // disposal answers nothing rather than answering the disposed engine's
      // last totals — which is what this project's `dispose` has always done.
      harnessAudio.delete(harness);
      return Promise.resolve();
    },
  };

  harnessAudio.set(harness, {
    cues: () => base.cues,
    stopped: () => stops.n,
    watch: () => kit.watchCues(base),
  });
  return harness;
}

/** What the cue readings below report, per harness. */
const harnessAudio = new WeakMap<
  Harness,
  {
    cues(): readonly TimedCue[];
    stopped(): number;
    watch(): TimedCue[];
  }
>();

/* -------------------------------------------------------------------------- */
/* Tick arithmetic                                                            */
/* -------------------------------------------------------------------------- */

/** Seconds of simulated time in `ticks` ticks. */
export const seconds = kit.seconds;

/** Whole ticks covering `duration` seconds, rounded up. */
export const ticksFor = kit.ticksFor;

/**
 * An arc gain measured over `ticks` ticks, as a speed in units/s.
 *
 * THE SIGNED READING, and that is the whole point of the name it is bound to. The
 * package ships two: `speedOverTicks`, which takes the magnitude, and
 * `gainOverTicks`, which keeps the sign. Every speed this case measures is a
 * train's progress ALONG the channel, and a check that the feed advances must
 * fail a build whose train ran backwards — so the magnitude, which would pass it,
 * is the wrong one, and the signed rate is bound here under the name the suites
 * already say.
 */
export const speedOverTicks = kit.gainOverTicks;

/* -------------------------------------------------------------------------- */
/* Evidence capture                                                           */
/* -------------------------------------------------------------------------- */
//
// A review item may declare a `replay` OUTPUT beside its verdict: the frames the
// build itself drew while a check drove it, kept as evidence a reviewer can
// scrub and compare against the reference implementation's. Both writers are the
// package's, bound here to this case's slug and to THIS directory — the project
// root may never be derived inside the package, which is staged one level deeper
// than this file, or every output would be addressed one directory too far down.
//
// Both are evidence, never a verdict: the scenario's own value comes straight
// back, a scenario that throws still leaves what it recorded, a capture that
// closed no frames writes nothing, and outside a run the media directory is unset
// and the whole thing is a no-op that still runs the scenario.

/**
 * Record the frames `scenario` draws and keep them as the review item's
 * `outputId` output, handing back whatever the scenario returned.
 *
 * Wrap the drive, not the arrangement:
 *
 * ```ts
 * const shot = await captureReplay(h, "seat", () => driveShot(h));
 * assertEqual(shot.landed, true);
 * ```
 *
 * The assertions stay exactly where they were and read exactly what they did.
 * Capture sits BESIDE them rather than in place of them: a check still fails for
 * the reasons it failed before, and the recording is what a reviewer looks at
 * afterwards to see what the build actually drew while it did.
 */
export const captureReplay = makeReplayCapture("volute", PROJECT_ROOT);

/**
 * Keep the frame currently on the canvas as the review item's `outputId` output.
 *
 * The companion to {@link captureReplay}, for a point whose evidence is one
 * PICTURE rather than a stretch of motion: which screen the game opened on, what
 * gauge the HUD drew at a pressure of 100, which charge the injector held.
 *
 * ASYNCHRONOUS, and the suites next door say `await captureStill(h, "core")`. The
 * package ships the synchronous twin as well — a 2D canvas is already rasterized,
 * so thirteen of the engine cases declare it sync — and this project is not one
 * of them; see the README's collision table.
 *
 * What is written is whatever the last frame that RAN left behind, so call it
 * after the frame that poses the thing under test and before the assertions, so a
 * check that fails still leaves the picture that shows why.
 */
export function captureStill(h: Harness, outputId: string): Promise<void> {
  return captureOutput("volute", PROJECT_ROOT, outputId, "png", () =>
    h.canvas.toBuffer("image/png"),
  );
}

/* -------------------------------------------------------------------------- */
/* Comparing two frames                                                       */
/* -------------------------------------------------------------------------- */
//
// `specs/ui.md`: "Volute fixes no palette, no font, no layout, and no styling for
// any screen." So nothing here reads a colour, a contrast, or how far a drawn
// mark reaches. A frame is read against ANOTHER frame of the same hall, through
// the package's `pixelsDiffering` and `differingPoints` re-exported above, and
// what those report is where the picture changed — which is presence, the one
// thing a pixel may decide.

/** The whole field, read back as RGBA. */
export function fieldPixels(h: Harness): Promise<PixelRect> {
  return h.pixelRect(0, 0, FIELD_W, FIELD_H);
}

/* -------------------------------------------------------------------------- */
/* Scenario helpers                                                           */
/* -------------------------------------------------------------------------- */
//
// Each of these poses a situation through the build's own debug surface and then
// lets the real simulation run. `writing-debug-apis-and-validators` puts every COMPOUND
// sequence here rather than on the surface: the surface carries atomic poses, and
// the arrangements a check needs are assembled from them in one place every check
// shares.
//
// A VALIDATOR POSES AN ISOLATED HALL. Everything a check's requirement does not
// concern is removed before its scenario is staged, rather than parked somewhere
// harmless: containment leans on the game's own rules holding, and a broken build
// is broken in exactly those rules. {@link poseHall} is the shape of that — it
// puts the hall in play on a level, HOLDS the inlet, empties the channel, and
// puts back exactly the cores the requirement is about.
//
// WHY IT IS BUILT FROM SINGLE-FIELD POSES AND NOT FROM `startLevel`. `startLevel`
// arranges the whole of a level opening — the screen, the seeded twelve, the
// quota, the pressure, the chain step, the machinery, the projectiles, and both
// injector draws — and a check that wants an empty channel would have to undo
// most of it. `specs/instrumentation.md` carries `setScreen`, `setLevel`,
// `setQuotaRemaining`, `setPressure` and `clearTrain` as poses of their own, so
// this assembles the hall it wants and nothing else happens. `startLevel` is left
// to the checks whose requirement IS the level opening.
//
// WHY THE INLET IS HELD RATHER THAN STARVED. `specs/progression.md` clears a level
// "the moment its quota is exhausted and no cores remain on the channel", so a
// hall posed with an exhausted quota and an EMPTY channel leaves `playing` on its
// very next tick. Holding the inlet with `setEmission(false)` and leaving the
// quota where it stands gives the one world most checks want: nothing arrives and
// nothing clears, with no bystander core standing in a corner to keep the hall in
// play. A check that IS about the inlet names `emission: true`, and a check about
// clearing names `quotaRemaining: 0`.

/** What {@link poseHall} arranges. Every field is optional; each defaults below. */
export interface PoseOptions {
  /**
   * The screen the hall stands on. Defaults to `playing`.
   *
   * A check about an ending names `gameover` or `victory`:
   * `specs/instrumentation.md`'s `setScreen` "changes nothing else", so the rest
   * of the pose stands under whichever screen it names.
   */
  screen?: ScreenName;
  /** The level to put in play, 1 through 5. Defaults to 1. */
  level?: number;
  /**
   * The cores the inlet has left to emit. Defaults to the level's full quota.
   *
   * A check about clearing names `0`; every other check takes the default, so
   * the "quota exhausted and channel empty" clear never fires under it.
   */
  quotaRemaining?: number;
  /**
   * Whether the inlet emits. Defaults to `false`, which holds it.
   *
   * A check that wants cores arriving names `true`; a check that does not takes
   * the default, so nothing joins the scenario it posed.
   */
  emission?: boolean;
  /**
   * Whether the train advances. Defaults to `true`, as play leaves it.
   *
   * A check whose requirement does not exercise the feed names `false`, which
   * holds every core on the arc position it was posed at.
   */
  feed?: boolean;
  /** The pressure. Defaults to 0, the value a level starts at. */
  pressure?: number;
  /** The chain step. Left where it stands by default, which is 1 after a reset. */
  chainStep?: number;
  /** The run's score. Left where it stands by default, which is 0 after a reset. */
  score?: number;
  /** The cells remaining. Left where they stand, which is CELLS after a reset. */
  cells?: number;
  /** The cores to put on the channel. Defaults to none. */
  cores?: readonly PosedCore[];
  /** The charge the injector holds loaded. Left as it stands by default. */
  loaded?: ChargeId;
  /** The charge the injector holds queued. Left as it stands by default. */
  queued?: ChargeId;
  /** The aim, in degrees. Left where it stands by default. */
  aim?: number;
  /**
   * A timed machinery to grant once the hall is posed.
   *
   * `bore` is not one of them: `specs/instrumentation.md` grants only the three
   * timed kinds, and a check that wants a bore poses a run carrying a `bore` mark
   * and lets the ticks extract it.
   */
  machinery?: TimedMachineryKind;
}

/**
 * Pose an isolated hall in play, assembled from single-field poses alone.
 *
 * The order is the one the operations' own definitions force: the screen and the
 * level first, so the level's figures are the ones the rest reads; the driver's
 * two switches next; then the quota, the pressure and the chain; then
 * `clearTrain` to empty the channel and discard every projectile; then the cores
 * the check is about; then the injector; then the machinery.
 *
 * Nothing here decides an outcome. Every extraction, score, chain step, grant,
 * cell and clear a check reads comes from the ticks it steps afterwards.
 *
 * A harness is freshly `reset` when a check receives it, so the fields this leaves
 * alone — the chain, the score, the cells, the active machinery, the interlude —
 * stand at their title values unless the check posed them.
 */
export async function poseHall(
  h: Harness,
  options: PoseOptions = {},
): Promise<void> {
  const level = options.level ?? 1;
  await h.debug.setScreen(options.screen ?? "playing");
  await h.debug.setLevel(level);
  await h.debug.setEmission(options.emission ?? false);
  await h.debug.setFeed(options.feed ?? true);
  await h.debug.setQuotaRemaining(
    options.quotaRemaining ?? levelSpec(level).quota,
  );
  await h.debug.setPressure(options.pressure ?? 0);
  if (options.chainStep !== undefined) {
    await h.debug.setChainStep(options.chainStep);
  }
  if (options.score !== undefined) await h.debug.setScore(options.score);
  if (options.cells !== undefined) await h.debug.setCells(options.cells);
  await h.debug.clearTrain();
  if (options.cores !== undefined && options.cores.length > 0) {
    await h.debug.poseTrain(options.cores);
  }
  if (options.loaded !== undefined) await h.debug.setLoaded(options.loaded);
  if (options.queued !== undefined) await h.debug.setQueued(options.queued);
  if (options.aim !== undefined) await h.debug.setAim(options.aim);
  if (options.machinery !== undefined) {
    await h.debug.grantMachinery(options.machinery);
  }
  await h.debug.reconcile();
}

/**
 * Open a run from the title exactly as the start control does, and open `level`.
 *
 * The start control poses "the score `0`, the cells at `CELLS` (`3`), and level
 * `1` opened exactly as `startLevel` opens it" (specs/ui.md, specs/progression.md),
 * and the surface carries each of those three as a pose of its own, so the
 * sequence lives here. A `level` beyond 1 is opened in place of level 1, which
 * leaves the score and the cells at their opening values either way.
 */
export async function startRun(h: Harness, level = 1): Promise<void> {
  await h.debug.setScore(0);
  await h.debug.setCells(CELLS);
  await h.debug.startLevel(level);
  await h.debug.reconcile();
}

/**
 * Point the injector at `angleDegrees` and release the loaded core along it.
 *
 * Two poses, because the surface carries two: `setAim` "does nothing else: no
 * core is released", and `fire()` "releases the loaded core along the current
 * aim". A check that wants the aim posed WITHOUT a projectile calls
 * `h.debug.setAim` on its own.
 *
 * `fire()` always launches — "Any cooldown outstanding at the call is cleared
 * first" — so this is how a check that is not ABOUT the cooldown gets a
 * projectile into the hall. A check that IS about the cooldown raises the fire
 * CONTROL instead, with {@link pressFire}, which honours it.
 */
export async function fireAt(h: Harness, angleDegrees: number): Promise<void> {
  await h.debug.setAim(angleDegrees);
  await h.debug.fire();
}

/** Aim at a field point and release the loaded core toward it. */
export async function fireToward(h: Harness, target: Point): Promise<void> {
  await fireAt(h, aimAt(target));
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

/**
 * Raise the pause control on `Escape`, which pauses and resumes. One tick passes.
 *
 * `specs/controls.md` ("Pausing") binds pause to two interchangeable keys, so the
 * key is taken from `BINDINGS.pause` rather than spelled here, and
 * {@link pressPauseAlt} raises the same control on the other one.
 */
export function pressPause(h: Harness): Promise<VoluteSnapshot> {
  return h.tap(BINDINGS.pause[0]);
}

/** Raise the pause control on `KeyP`, its second key. One tick passes. */
export function pressPauseAlt(h: Harness): Promise<VoluteSnapshot> {
  return h.tap(BINDINGS.pause[1]);
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

/* -------------------------------------------------------------------------- */
/* Cues                                                                       */
/* -------------------------------------------------------------------------- */
//
// `specs/ui.md` has the game play its cues "through the engine's cue bus", so
// under this engine a sound is a NAMED event: the game asks the bus for a cue by
// name and the bus announces it at the moment of the play, stamped with the frame
// clock's own time. The harness subscribes before `initialize`, which is what
// makes even the game's first cue observable.
//
// A POSE SOUNDS NOTHING. "Audio belongs to the ticks. A pose changes the state
// alone and sounds nothing; the cues a scenario hears come from the ticks run
// after it." So a cue raised by `fire()` sounds on the next tick STEPPED, not at
// the call — arrange, then step, then read.

/**
 * Record every cue the build plays from now on, stamped with the tick of the
 * drive it sounded on.
 *
 * Both one-shots and the start of a loop are recorded, because both are a sound
 * the hall made: `specs/ui.md` treats the two beds as cues like any other, and a
 * check that is about a one-shot poses a hall in which no bed can start.
 */
export function watchCues(h: Harness): TimedCue[] {
  return harnessAudio.get(h)?.watch() ?? [];
}

/**
 * How many cues the build has running as loops right now.
 *
 * `specs/ui.md` has the two beds "loop until stopped rather than playing once",
 * and "Exactly one of them is looping on `playing`". The engine announces
 * `cue:looped` when a loop starts and `cue:stopped` when it ends, so the running
 * count is the difference between the two.
 */
export function loopingSources(h: Harness): Promise<number> {
  const audio = harnessAudio.get(h);
  if (audio === undefined) return Promise.resolve(0);
  return Promise.resolve(Math.max(0, loopsStartedIn(audio) - audio.stopped()));
}

/** How many of the cues the build sounded started a loop. */
function loopsStartedIn(audio: { cues(): readonly TimedCue[] }): number {
  return audio.cues().filter((cue) => cue.looped).length;
}

/** How many sounds the build has made since the engine was built. */
export function soundsStarted(h: Harness): Promise<number> {
  return Promise.resolve(harnessAudio.get(h)?.cues().length ?? 0);
}

/** How many of the sounds the build made were loops starting. */
export function loopsStarted(h: Harness): Promise<number> {
  const audio = harnessAudio.get(h);
  return Promise.resolve(audio === undefined ? 0 : loopsStartedIn(audio));
}

/**
 * Step until the build has a looping bed running, and answer how many it has.
 *
 * WHY A CHECK WAITS FOR THIS RATHER THAN READING IT ON ONE TICK.
 * `specs/assets.md` has the build load its own produced files, and
 * `api.audio.load` binds a cue name only once its file has decoded — so a bed
 * asked for before its file finished decoding cannot start yet, and a conformant
 * build asks again on the next tick. That is behaviour the specification leaves
 * open, and a check that read the bed on one fixed tick would pass or fail on how
 * fast the host decoded rather than on what the build did.
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
 * Step until the build has made a sound at all, and answer how many it has.
 *
 * The weaker companion to {@link stepUntilBed}, for a build that runs its bed by
 * re-playing the cue rather than by looping it — which `specs/ui.md` permits,
 * since it fixes what a bed SOUNDS like and not how it is made.
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
