// Volute — the shared validator harness, under the Simple 2D engine.
// CASE-PROVIDED.
//
// Every check in this suite is an ordinary vitest test that runs IN THE SAME
// PROCESS as the build. It imports the engine and the build's own module, stands
// the engine up over a canvas it owns and a clock it chose, and steps the game
// with `engine.advance`. Nothing drives a browser, nothing polls, and no
// wall-clock time passes: a check asks for a number of ticks and gets exactly
// that number, at exactly the delta its clock supplied.
//
// WHAT A CHECK READS. The game's own state (through the debug surface's
// `snapshot`), the ticks this harness stepped, the operations the build issued
// against its 2D context, the pixels those operations left on the canvas, and the
// cues the engine's audio bus announced. Nothing here fabricates an outcome: the
// scenario helpers below only ARRANGE the hall through the surface, and the real
// `update` the build wrote is what runs from there.
//
// WHERE THE SURFACE COMES FROM. Off `engine.debug`, never built here.
// `specs/instrumentation.md`: "the build's `initialize` returns the finished
// surface beside the state it built, as the pair `[state, debug]`. The engine
// returns that same value from `engine.debug`, and it is reached that way alone".
// Reading it back off the engine is the only route a check has to it, so a build
// that returned no surface, or a surface missing an operation, fails the checks
// that reach the hall through it. See {@link readDebugSurface}.
//
// HOW THE SURFACE IS DRIVEN. The engine holds the state by value and hands it out
// read-only, so the surface is pure: "A pose takes the current state, as
// `DeepReadonly<VoluteState>`, and returns the next `VoluteState`; a reading takes
// the state the same way and returns what it read." A check still writes
// `await h.debug.startLevel(2)`, because `h.debug` is a {@link Driver} over the
// raw surface: it runs each pose through `engine.apply` and hands each reading
// `engine.state`. Nothing a check does holds a writable state.
//
// THE CLOCK IS THE CHECK'S, AND THE STEP IS STATED HERE. The engine mandates no
// timestep: `specs/instrumentation.md` has a scenario pair "a `ConstantClock` of
// `1000 / 60` milliseconds with `engine.advance`" so one frame is exactly one
// simulation tick of `TICK_DT`. That clock is what every harness below is built
// with, so a duration written as a tick count means the same thing here as it
// does in the engineless project, and the tolerances the case states in ticks
// carry across unchanged. The one check that is ABOUT the game running itself
// (`channel/self-advancing`) hands the loop back with {@link Harness.runFor},
// which is the only place real time enters this project.
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
// (`specs/assets.md`). Node has no `fetch` that reads a page-relative path and no
// `createImageBitmap`, so a check running here would see a build's every produced
// file fail to load — and the produced-asset points would fail every conformant
// build for a fact about the host. {@link installAssetHost} is what closes that:
// the engine's asset root is served off the build's own `public/` directory and
// images are decoded with the canvas library the workspace already ships, so the
// build loads exactly the files it committed, by exactly the paths it wrote.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
import { expect } from "vitest";
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
  type Game,
  type PathSegment,
  type RecordedFrame,
  type Recording,
  type Resource,
  type SurfaceMetrics,
} from "@clockwyrks/simple-2d";
import type { DeepReadonly } from "ts-essentials";
import { BACKGROUND, game as build, type VoluteState } from "../src/game";
import { assertTruthy, fail } from "./assert";
import {
  BINDINGS,
  CELLS,
  CHANNEL,
  CHANNEL_ARC,
  DEFAULT_SEED,
  FIELD_H,
  FIELD_W,
  HANDLE,
  INJECTOR,
  LAYOUT,
  PATH_LENGTH,
  READINGS,
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
  /** Restore every declared field to its title value and reseed the generator. */
  reset(state: DeepReadonly<S>, options?: { seed?: number }): S;
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
  /** Set the charge the injector holds loaded. The generator is untouched. */
  setLoaded(state: DeepReadonly<S>, charge: ChargeId): S;
  /** Set the charge the injector holds queued. The generator is untouched. */
  setQueued(state: DeepReadonly<S>, charge: ChargeId): S;
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
  /** Restore every declared field to its title value and reseed the generator. */
  reset(options?: { seed?: number }): Promise<void>;
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
  /** Set the charge the injector holds loaded. The generator is untouched. */
  setLoaded(charge: ChargeId): Promise<void>;
  /** Set the charge the injector holds queued. The generator is untouched. */
  setQueued(charge: ChargeId): Promise<void>;
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
/* The host the build loads its produced files through                        */
/* -------------------------------------------------------------------------- */
//
// `specs/assets.md` has this build commit its produced files "under
// `public/assets/`, which the engine serves at its asset root", and load every
// one of them with `api.assets.loadImage`, `api.assets.load` and
// `api.audio.load`. The engine resolves each path under `assets/` and fetches it,
// which on a served page reaches the committed file and in a bare Node process
// reaches nothing: there is no `fetch` for a page-relative path, no
// `createImageBitmap`, and no `AudioContext`.
//
// So the harness supplies all three, and each is the SAME loading the browser
// does rather than a stand-in for it: the fetch reads the very file the build
// committed, off the build's own `public/`, addressed by the path the build
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
 * directory.
 */
const WORKSPACE_ROOT = resolve(PROJECT_ROOT, "..");

/**
 * Where a page-relative asset URL is looked for, in order.
 *
 * `public/` first, because that is where `specs/assets.md` tells the build to
 * commit its produced files and what Vite copies into `dist/` unchanged. `dist/`
 * and the repository root follow so a build that arranged its produced tree
 * differently is still loading its own committed files rather than nothing.
 */
const ASSET_ROOTS = ["public", "dist", "."] as const;

/** Where a fetched body came from, so a decoded image can carry its source. */
const blobSource = new WeakMap<object, string>();

/** Where a decoded image came from, or absent for one the build painted itself. */
const imageSource = new WeakMap<object, string>();

/** The file a page-relative URL names, or `null` when no root holds it. */
function assetFile(url: string): string | null {
  const path = url.replace(/^\.\//, "");
  if (
    path === "" ||
    path.startsWith("/") ||
    /^[a-z][a-z0-9+.-]*:/i.test(path)
  ) {
    return null;
  }
  for (const root of ASSET_ROOTS) {
    const candidate = resolve(WORKSPACE_ROOT, root, path);
    if (
      candidate.startsWith(resolve(WORKSPACE_ROOT)) &&
      existsSync(candidate)
    ) {
      return candidate;
    }
  }
  return null;
}

/** A 32-bit hash of a string, as the identity a source URL is named by. */
function hash(text: string): string {
  let value = 0;
  for (let i = 0; i < text.length; i += 1) {
    value = (Math.imul(value, 31) + text.charCodeAt(i)) | 0;
  }
  return (value >>> 0).toString(16).padStart(8, "0");
}

/**
 * One 16-bit PCM `.wav` as the channel data an `AudioBuffer` reports.
 *
 * Enough of a decode to satisfy `api.audio.load`, which binds a cue name only
 * once its file decodes. Nothing here sounds, so what the samples are worth never
 * reaches a verdict; what matters is that a build's fifteen produced cues bind,
 * exactly as they do on a page.
 */
function decodeWav(bytes: Uint8Array): {
  sampleRate: number;
  channels: number;
  frames: Float32Array[];
} {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 12 || view.getUint32(0, false) !== 0x52494646) {
    throw new Error("not a RIFF file");
  }
  let sampleRate = 44100;
  let channels = 1;
  let bits = 16;
  let data: Uint8Array | null = null;
  let at = 12;
  while (at + 8 <= bytes.byteLength) {
    const id = view.getUint32(at, false);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (id === 0x666d7420) {
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
    } else if (id === 0x64617461) {
      data = bytes.subarray(body, Math.min(body + size, bytes.byteLength));
    }
    at = body + size + (size % 2);
  }
  if (data === null) throw new Error("the file carries no data chunk");
  const bytesPerSample = Math.max(1, bits >> 3);
  const count = Math.floor(data.byteLength / (bytesPerSample * channels));
  const frames = Array.from(
    { length: channels },
    () => new Float32Array(count),
  );
  const samples = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let i = 0; i < count; i += 1) {
    for (let c = 0; c < channels; c += 1) {
      const offset = (i * channels + c) * bytesPerSample;
      frames[c][i] = bits === 16 ? samples.getInt16(offset, true) / 32768 : 0;
    }
  }
  return { sampleRate, channels, frames };
}

/** Whether the host has already been given its three loaders. */
let assetHostInstalled = false;

/**
 * Give this process the three things a browser gives the engine's asset loader:
 * a `fetch` that reads the build's own committed files, a `createImageBitmap`
 * that decodes one, and an `AudioContext` that decodes a produced `.wav`.
 *
 * Idempotent, and installed the first time a harness is built. Each falls through
 * to whatever the platform already had for anything it does not recognize, so
 * nothing outside the asset root changes behaviour.
 */
function installAssetHost(): void {
  if (assetHostInstalled) return;
  assetHostInstalled = true;

  const platformFetch = globalThis.fetch?.bind(globalThis);
  globalThis.fetch = (async (
    input: unknown,
    init?: unknown,
  ): Promise<Response> => {
    const url = typeof input === "string" ? input : String(input);
    const file = assetFile(url);
    if (file === null) {
      if (platformFetch === undefined) {
        throw new Error(`volute: nothing to fetch "${url}" with`);
      }
      return platformFetch(input as RequestInfo, init as RequestInit);
    }
    const bytes = readFileSync(file);
    const blob = new Blob([bytes]);
    blobSource.set(blob, url);
    return {
      ok: true,
      status: 200,
      blob: () => Promise.resolve(blob),
      arrayBuffer: () => Promise.resolve(bytes.buffer.slice(0)),
    } as unknown as Response;
  }) as typeof fetch;

  const host = globalThis as {
    createImageBitmap?: unknown;
    AudioContext?: unknown;
    ImageBitmap?: unknown;
  };
  // The type name the engine's own recorder looks a drawable source up under.
  // It shadows every `drawImage` a frame issues so a replay can carry the picture
  // the build actually drew, and it recognizes a source by `instanceof` against
  // the host's own constructors — of which a bare Node process has none. Naming
  // the canvas library's decoded image as `ImageBitmap`, which is exactly what
  // `createImageBitmap` hands back here, is what lets a produced sprite reach the
  // recording as its pixels rather than as an opaque marker, so a reviewer scrubs
  // the hall the build drew rather than the hall minus its art. Nothing else in
  // this process reads the name.
  host.ImageBitmap ??= Image;

  host.createImageBitmap = async (blob: Blob): Promise<ImageBitmap> => {
    const bytes = Buffer.from(await blob.arrayBuffer());
    const image = await loadImage(bytes);
    const from = blobSource.get(blob);
    if (from !== undefined) imageSource.set(image, from);
    return image as unknown as ImageBitmap;
  };

  host.AudioContext = class {
    readonly currentTime = 0;
    readonly destination = {};
    resume(): Promise<void> {
      return Promise.resolve();
    }
    decodeAudioData(buffer: ArrayBuffer): Promise<AudioBuffer> {
      const { sampleRate, channels, frames } = decodeWav(
        new Uint8Array(buffer),
      );
      return Promise.resolve({
        sampleRate,
        numberOfChannels: channels,
        length: frames[0]?.length ?? 0,
        duration: (frames[0]?.length ?? 0) / sampleRate,
        getChannelData: (channel: number): Float32Array =>
          frames[channel] ?? new Float32Array(0),
      } as unknown as AudioBuffer);
    }
  };
}

/* -------------------------------------------------------------------------- */
/* The harness                                                                */
/* -------------------------------------------------------------------------- */

/** One recorded operation on the 2D context, in the order the render made it. */
export type DrawCall =
  | { kind: "call"; method: string; args: unknown[] }
  | { kind: "set"; property: string; value: unknown };

/**
 * A bitmap source a frame drew, as this harness names it.
 *
 * `id` is identity WITHIN ONE HARNESS: the same decoded sprite drawn on a hundred
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

/** A cue the build played, and the tick of the drive it played it on. */
export interface TimedCue {
  /** The cue's own name, as `specs/ui.md` fixes it. */
  cue: string;
  /** The tick it sounded on, 1-based, as {@link Harness.tick} counts them. */
  tick: number;
  /** The simulated time at that tick, in milliseconds. */
  t: number;
  /** The gain it sounded at; `0` on a muted bus. */
  gain: number;
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
  /** The element's laid-out CSS width. Defaults to the logical field width. */
  cssWidth?: number;
  /** The element's laid-out CSS height. Defaults to the logical field height. */
  cssHeight?: number;
  /** Device pixels per CSS pixel. Defaults to 1, so one device pixel is one unit. */
  dpr?: number;
  /** The seed the opening `reset` is given. Defaults to `DEFAULT_SEED`. */
  seed?: number;
  /** The clock each frame takes its delta from. Defaults to one tick a frame. */
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
  /** The engine the build's game is bound to. */
  readonly engine: Engine<VoluteState, VoluteDebugSurface>;
  /**
   * The surface the BUILD returned beside its state, driven over the engine:
   * each pose runs through `engine.apply`, each reading is handed `engine.state`.
   *
   * The raw surface is read off `engine.debug` rather than built here — see
   * {@link readDebugSurface} — and {@link driveSurface} is the wrapper.
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
  /** Hand the game to the engine's own frame loop for `ms` of real time. */
  runFor(ms: number): Promise<void>;

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

/* ---- Key and pointer events ----------------------------------------------- */

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
class PointEvent extends Event {
  readonly clientX: number;
  readonly clientY: number;
  readonly isPrimary = true;

  constructor(
    type: "pointerdown" | "pointermove" | "pointerup",
    x: number,
    y: number,
  ) {
    super(type);
    this.clientX = x;
    this.clientY = y;
  }
}

/* ---- Watching the context -------------------------------------------------- */

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
  const from = imageSource.get(value) ?? null;
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
        calls.push({ kind: "call", method: String(property), args });
        return (value as (...rest: unknown[]) => unknown).apply(object, args);
      };
    },
    set(object, property, value) {
      calls.push({ kind: "set", property: String(property), value });
      return Reflect.set(object, property, value, object);
    },
  });
}

/* ---- The surface a build never returned ------------------------------------ */

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
 * A stand-in for a surface that is missing or incomplete: every operation on it
 * fails the check that reached for it, with the fault named.
 *
 * Keys that belong to the MACHINERY rather than to a check are answered with
 * `undefined` instead: awaiting a value probes `then`, and vitest's own error
 * formatting probes symbols and `constructor`. Failing those would replace the
 * verdict below with noise from the machinery that was trying to report it.
 */
function unusableSurface(reason: string): VoluteDebugApi {
  return new Proxy({} as VoluteDebugApi, {
    get: (_target, property): unknown => {
      if (typeof property === "symbol") return undefined;
      if (property === "then" || property === "constructor") return undefined;
      return () => failSurface(reason);
    },
  });
}

/**
 * The debug surface the BUILD returned beside its state, read off the engine that
 * holds it, or `null` when there is nothing usable there.
 *
 * This is deliberately a READ and never a construction. The surface is the build's
 * deliverable: its `initialize` returns `[state, debug]`, the engine keeps the
 * second element, and `engine.debug` is the only way it reaches a check. Nothing
 * here could stand in for it, because the build's own module for the surface is
 * never imported.
 *
 * A build that returned no pair at all never gets this far — the engine rejects
 * `initialize` itself, and the rejection fails the suite's `beforeEach` with the
 * engine's own message, which is the right report for a build that does not run
 * on this engine under any entry point. What IS decided here is a pair whose
 * second element is no surface, or a surface missing an operation: that is the
 * build's fault, and it is reported as {@link Harness.surfaceFault} rather than
 * thrown, so it lands on the points whose checks reach the hall through it.
 */
function readDebugSurface(surface: unknown): string | null {
  if (typeof surface !== "object" || surface === null) {
    return `${HANDLE} holds ${surface === null ? "null" : typeof surface}, not an object`;
  }
  const held = surface as Record<string, unknown>;
  const missing = REQUIRED_SURFACE_OPS.filter(
    (op) => typeof held[op] !== "function",
  );
  if (missing.length > 0) {
    return `${HANDLE} is an object but carries no ${missing
      .map((op) => `${op}()`)
      .join(", ")}`;
  }
  return null;
}

/**
 * The operations the harness itself has to be able to call to pose a hall.
 *
 * The same list `constants.ts` publishes as `REQUIRED_OPS`, restated here as the
 * harness's own precondition; `instrumentation/debug-surface` is the point that
 * holds the build to it, and this is what makes every OTHER point fail cleanly
 * rather than throwing a `TypeError` several ticks later.
 */
const REQUIRED_SURFACE_OPS = [
  "reset",
  "snapshot",
  "setScreen",
  "setLevel",
  "setScore",
  "setCells",
  "setChainStep",
  "startLevel",
  "poseTrain",
  "clearTrain",
  "setLoaded",
  "setQueued",
  "setAim",
  "fire",
  "setPressure",
  "setQuotaRemaining",
  "setEmission",
  "setFeed",
  "grantMachinery",
  "pause",
  "resume",
] as const;

/**
 * The imperative reading of the pure surface, over the engine that holds the
 * state.
 *
 * A proxy, and a lazy one: the member is read off the raw surface at the moment a
 * check reaches for it, so a missing operation fails the check that needed it and
 * never the `beforeEach` that built the harness. A reading is called with
 * `engine.state` and its result handed back; a pose is run through `engine.apply`,
 * so the engine stores what it returned and the next frame's `update` receives it.
 */
function driveSurface(
  engine: Engine<VoluteState, VoluteDebugSurface>,
  raw: object,
): VoluteDebugApi {
  const readings: readonly string[] = READINGS;
  return new Proxy({} as VoluteDebugApi, {
    get: (_target, property): unknown => {
      if (typeof property === "symbol") return undefined;
      if (property === "then" || property === "constructor") return undefined;
      const member = (raw as Record<string, unknown>)[property];
      if (typeof member !== "function") return member;
      const op = member as (
        state: DeepReadonly<VoluteState>,
        ...args: unknown[]
      ) => unknown;
      if (readings.includes(property)) {
        return (): Promise<unknown> =>
          Promise.resolve(op.call(raw, engine.state));
      }
      return (...args: unknown[]): Promise<void> => {
        engine.apply((state) => op.call(raw, state, ...args) as VoluteState);
        return Promise.resolve();
      };
    },
  });
}

/* ---- The fit -------------------------------------------------------------- */

/**
 * How the field maps onto a surface of this shape, as `specs/overview.md` fixes
 * it: one uniform scale, the whole field inside, centred, with the leftover split
 * evenly into two bars.
 *
 * The engine's own fit, restated so a check can address a logical point without
 * asking the engine on every call. Every check runs at the field's own size,
 * where this is the identity and the question does not arise.
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

/* ---- Building one --------------------------------------------------------- */

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
 * Stand the engine up over a canvas of the harness's own, initialize the build's
 * game, reset it to the title on a known seed, and hand back everything a check
 * reads.
 *
 * The options handed to the factory are the ones the seeded `src/main.ts` hands
 * it — the design size, the build's exported `BACKGROUND`, and the touch layout —
 * so one harness serves every build of this case. The clock is the HARNESS's
 * choice: one `ConstantClock` tick of `TICK_MS` a frame, which is exactly one
 * simulation tick.
 *
 * The default shape is the field's own size at one device pixel per CSS pixel, so
 * a logical coordinate, a CSS pixel and a canvas pixel are all the same thing and
 * no check has to think about the fit at all.
 */
export async function createHarness(
  options: HarnessOptions = {},
): Promise<Harness> {
  installAssetHost();

  const cssWidth = options.cssWidth ?? FIELD_W;
  const cssHeight = options.cssHeight ?? FIELD_H;
  const dpr = options.dpr ?? 1;
  const seed = options.seed ?? DEFAULT_SEED;

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
  const metrics: SurfaceMetrics = {
    cssWidth: () => cssWidth,
    cssHeight: () => cssHeight,
    dpr: () => dpr,
    events: () => events,
  };

  const engine = createEngine<VoluteState, VoluteDebugSurface>({
    canvas: element,
    width: FIELD_W,
    height: FIELD_H,
    game,
    // The build's own field background, handed to the engine exactly as the
    // seeded `src/main.ts` hands it (specs/overview.md).
    background: BACKGROUND,
    layout: LAYOUT,
    clock: options.clock ?? new ConstantClock(TICK_MS),
    surface: metrics,
  });

  // Subscribed BEFORE `initialize`, which is what makes the game's own loading
  // and its first cues observable: construction runs no game code, so nothing has
  // happened yet.
  const pageErrors: string[] = [];
  const cueSinks: TimedCue[][] = [];
  let tickCount = 0;
  let timeMs = 0;
  let loopsRunning = 0;
  let loopStarts = 0;
  let soundCount = 0;

  engine.events.on("asset:failed", ({ path, reason }) => {
    pageErrors.push(`asset ${path} failed: ${reason}`);
  });
  const sound = (cue: string, gain: number): void => {
    soundCount += 1;
    for (const sink of cueSinks) {
      sink.push({ cue, tick: tickCount, t: timeMs, gain });
    }
  };
  engine.events.on("cue:played", ({ cue, gain }) => {
    sound(cue, gain);
  });
  engine.events.on("cue:looped", ({ cue, gain }) => {
    loopsRunning += 1;
    loopStarts += 1;
    sound(cue, gain);
  });
  engine.events.on("cue:stopped", () => {
    loopsRunning = Math.max(0, loopsRunning - 1);
  });

  await engine.initialize();

  const raw: unknown = engine.debug;
  const surfaceFault = readDebugSurface(raw);
  const debug =
    surfaceFault !== null
      ? unusableSurface(surfaceFault)
      : driveSurface(engine, raw as object);

  // What the build opened on, read before the `reset` below puts it back to the
  // title whatever it opened on. `specs/ui.md`: "The game opens here."
  const openingScreen =
    surfaceFault === null ? (await debug.snapshot()).screen : null;

  // Back to the title on a known seed before a check touches anything: `reset` is
  // what seeds the generator, so a scenario driven from a known seed is
  // reproducible from this line on.
  if (surfaceFault === null) await debug.reset({ seed });

  const view = fitViewport(cssWidth, cssHeight, dpr);
  let lastFrameStart = 0;
  let lastFrameEnd = 0;

  /**
   * Run one tick, keeping the boundary of the operations its render issued.
   *
   * The tick counter is raised BEFORE the frame runs, so a cue the engine
   * announces from inside that frame is stamped with the tick that produced it.
   */
  const runTick = async (): Promise<void> => {
    const start = calls.length;
    tickCount += 1;
    timeMs += TICK_MS;
    try {
      await engine.advance(1);
    } catch (error) {
      pageErrors.push(String(error instanceof Error ? error.message : error));
      throw error;
    }
    lastFrameStart = start;
    lastFrameEnd = calls.length;
  };

  const drive = async (ticks: number): Promise<void> => {
    const count = Math.max(0, Math.floor(ticks));
    for (let i = 0; i < count; i += 1) await runTick();
  };

  const readRect = (
    left: number,
    top: number,
    wide: number,
    high: number,
  ): PixelRect => {
    const clampedX = Math.min(Math.max(left, 0), canvas.width);
    const clampedY = Math.min(Math.max(top, 0), canvas.height);
    const clampedW = Math.max(1, Math.min(wide, canvas.width - clampedX));
    const clampedH = Math.max(1, Math.min(high, canvas.height - clampedY));
    const pixels = ctx.getImageData(clampedX, clampedY, clampedW, clampedH);
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
    pageErrors,
    ctx,
    canvas,

    tick: () => tickCount,
    timeMs: () => timeMs,

    snapshot: () => debug.snapshot(),

    async step(ticks = 1) {
      await drive(ticks);
      return debug.snapshot();
    },

    async stepUntil(predicate, untilOptions = {}) {
      const maxTicks = untilOptions.maxTicks ?? 600;
      const poll = Math.max(1, untilOptions.poll ?? 1);

      let snapshot = await debug.snapshot();
      if (predicate(snapshot)) return { hit: true, ticks: 0, snapshot };

      let ticks = 0;
      while (ticks < maxTicks) {
        const stride = Math.min(poll, maxTicks - ticks);
        await drive(stride);
        ticks += stride;
        snapshot = await debug.snapshot();
        if (predicate(snapshot)) return { hit: true, ticks, snapshot };
      }
      return { hit: false, ticks, snapshot };
    },

    async stepWatching(ticks, watch) {
      const seen: VoluteSnapshot[] = [];
      for (let i = 0; i < ticks; i += 1) {
        await runTick();
        const snapshot = await debug.snapshot();
        seen.push(snapshot);
        if (watch?.(snapshot, i + 1) === true) break;
      }
      return seen;
    },

    async runFor(ms) {
      // The one thing in this project that depends on real elapsed time: the
      // engine's own loop, pumped off the host's frame callback, with a clock
      // that reads the host timestamp. The scripted clock goes back afterwards,
      // so everything after this call is exact again.
      const controller = new AbortController();
      engine.setClock(new WallClock());
      const running = engine.run({ signal: controller.signal });
      await new Promise((done) => setTimeout(done, ms));
      controller.abort();
      await running;
      engine.setClock(options.clock ?? new ConstantClock(TICK_MS));
    },

    hold: (code) => {
      events.dispatchEvent(new KeyEvent("keydown", code));
      return Promise.resolve();
    },
    release: (code) => {
      events.dispatchEvent(new KeyEvent("keyup", code));
      return Promise.resolve();
    },

    async tap(code) {
      // Down, ONE tick, up. The engine arms the edge at the event and discards it
      // after the frame that could have consumed it, so the tick between the two
      // is what makes this a press the game can actually see.
      events.dispatchEvent(new KeyEvent("keydown", code));
      const snapshot = await this.step(1);
      events.dispatchEvent(new KeyEvent("keyup", code));
      return snapshot;
    },

    async holdFor(code, ticks) {
      events.dispatchEvent(new KeyEvent("keydown", code));
      try {
        return await this.step(ticks);
      } finally {
        events.dispatchEvent(new KeyEvent("keyup", code));
      }
    },

    movePointer(x, y) {
      const at = this.cssPoint(x, y);
      events.dispatchEvent(new PointEvent("pointermove", at.x, at.y));
      return Promise.resolve();
    },

    async clickPointer(x, y) {
      const at = this.cssPoint(x, y);
      events.dispatchEvent(new PointEvent("pointermove", at.x, at.y));
      events.dispatchEvent(new PointEvent("pointerdown", at.x, at.y));
      const snapshot = await this.step(1);
      events.dispatchEvent(new PointEvent("pointerup", at.x, at.y));
      return snapshot;
    },

    async frameCalls() {
      await runTick();
      return calls.slice(lastFrameStart, lastFrameEnd);
    },

    lastCalls: () => Promise.resolve(calls.slice(lastFrameStart, lastFrameEnd)),

    probe: (names) => {
      const held = (
        typeof raw === "object" && raw !== null ? raw : {}
      ) as Record<string, unknown>;
      const ops: Record<string, string> = {};
      for (const name of names) ops[name] = typeof held[name];
      return Promise.resolve({ version: held.version, ops });
    },

    viewport: () => ({ ...view }),
    device: (x, y) => toDevice(view, x, y),
    cssPoint: (x, y) => ({
      x: view.cssOffsetX + x * view.cssScale,
      y: view.cssOffsetY + y * view.cssScale,
    }),

    pixel(x, y) {
      const at = toDevice(view, x, y);
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
      const origin = toDevice(view, x, y);
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
      Promise.resolve({ width: canvas.width, height: canvas.height, dpr }),

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
      events.dispatchEvent(new KeyEvent("keydown", UNBOUND_KEY));
      events.dispatchEvent(new KeyEvent("keyup", UNBOUND_KEY));
      return Promise.resolve();
    },

    dispose() {
      engine.destroy();
      harnessAudio.delete(harness);
      return Promise.resolve();
    },
  };

  harnessCues.set(harness, cueSinks);
  harnessAudio.set(harness, {
    loops: () => loopsRunning,
    starts: () => soundCount,
    loopStarts: () => loopStarts,
  });
  return harness;
}

/** Where {@link watchCues} attaches, per harness. */
const harnessCues = new WeakMap<Harness, TimedCue[][]>();

/** What the audio readings below report, per harness. */
const harnessAudio = new WeakMap<
  Harness,
  { loops(): number; starts(): number; loopStarts(): number }
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
 * The directory the runner stages this project to inside the build's tree.
 *
 * A recording is addressed by the STAGED path of the suite that produced it —
 * `validation/channel/feed-advance.test.ts` — because that is the path the review
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
 * a shot seating, a run extracting, a level clearing — are written whole.
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
    console.warn(`volute: could not write ${destination}: ${String(error)}`);
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
export function captureStill(h: Harness, outputId: string): Promise<void> {
  const destination = mediaDestination(outputId, "png");
  if (destination === null) return Promise.resolve();
  try {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, h.canvas.toBuffer("image/png"));
  } catch (error) {
    console.warn(`volute: could not write ${destination}: ${String(error)}`);
  }
  return Promise.resolve();
}

/* -------------------------------------------------------------------------- */
/* Comparing two frames                                                       */
/* -------------------------------------------------------------------------- */
//
// `specs/ui.md`: "Volute fixes no palette, no font, no layout, and no styling for
// any screen." So nothing here reads a colour, a contrast, or how far a drawn
// mark reaches. A frame is read against ANOTHER frame of the same hall, and what
// the two readings below report is where the picture changed — which is presence,
// the one thing a pixel may decide.

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
  const played: TimedCue[] = [];
  harnessCues.get(h)?.push(played);
  return played;
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
  return Promise.resolve(harnessAudio.get(h)?.loops() ?? 0);
}

/** How many sounds the build has made since the engine was built. */
export function soundsStarted(h: Harness): Promise<number> {
  return Promise.resolve(harnessAudio.get(h)?.starts() ?? 0);
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

/** How many of the sounds the build made were loops starting. */
export function loopsStarted(h: Harness): Promise<number> {
  return Promise.resolve(harnessAudio.get(h)?.loopStarts() ?? 0);
}
