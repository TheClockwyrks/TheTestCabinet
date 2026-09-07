// Volute — the case's half of the validator harness, under the Structured 2D
// engine. CASE-PROVIDED.
//
// Every check in this suite is an ordinary vitest test that runs IN THE SAME
// PROCESS as the build. It imports the engine and the build's own modules,
// creates an engine over a canvas it owns and a clock it chose, and steps the
// game with `engine.advance`. Nothing drives a browser, nothing polls, and no
// wall-clock time passes: a check asks for a number of ticks and gets exactly
// that number, at exactly the deltas its clock supplied.
//
// THE MACHINERY THAT DOES THAT IS NOT VOLUTE'S. The canvas and its draw-command
// recorder, the debug surface read off the engine, the sweep, the cue stamping,
// the pixel and text readings, the host that serves the build's produced files,
// and the evidence a review item declares — every engine-backed case needs
// exactly that, and it lives once, in `@clockwyrks/case-harness`, staged beside
// this file as `./case-harness/`. What is left here is what is genuinely
// Volute's: the shape of its snapshot, the operations `specs/instrumentation.md`
// requires, the channel's own geometry, the way a produced sprite is identified,
// and the hall a scenario poses.
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
// {@link surfaceFaultOf}.
//
// HOW THE SURFACE IS DRIVEN. Directly, and synchronously — the package's
// `identityDriver`, which is the strategy a structured engine's state model
// forces. Under this engine "A pose takes only the parameters its heading names
// and returns nothing; a reading takes none and returns what it read", and each
// acts on the live world at the moment of the call — so a pose is
// `h.debug.setPressure(50)` and a reading is `h.snapshot()`, with nothing in
// between. One consequence is worth stating once, here: a pose that OPENS A LEVEL
// (`reset` and `startLevel`) "takes effect no later than the end of the next
// advanced frame", so a scenario poses, advances one frame, and only then poses
// further, presses a key, or reads. {@link createHarness} carries that frame for
// its opening `reset` and {@link startRun} for the level it opens, so a check
// never counts them. A scenario assembled from SINGLE-FIGURE poses opens no level
// and needs no frame: {@link poseHall} advances none, and every tick a check runs
// is one it asked for.
//
// THE CLOCK IS THE SUITE'S, AND A TICK IS THE UNIT.
// `specs/instrumentation.md`: "A `ConstantClock` of `1000 / 60` milliseconds
// makes one frame exactly one simulation step of `1 / 60` second, which is the
// step a scenario advances the engine by." So one `advance` is one tick worth
// exactly `TICK_DT`, a count of ticks converts to simulated seconds with no
// rounding, and every duration in this project is written as a tick count.
// Nothing in this project hands the loop back to a real clock: the frames a
// check drives are the whole of what it measures, so a check lands the same
// ticks on any host.
//
// THE HOST THE BUILD IS STOOD UP OVER. A browser game runs on a page; this runs
// in Node, so the browser facilities the build's own loading needs are supplied
// by the package's asset and audio hosts and nowhere else: `fetch` serves the
// produced files out of `public/` exactly as a static host would,
// `createImageBitmap` decodes a PNG through the same canvas library the engine
// draws into, `AudioContext` decodes a `.wav`, and `ImageBitmap` names the
// decoded type so the engine's recorder carries the produced sprites it drew.
// None of them changes what the build does: they are the page, not the game.

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
  type GameDefinition,
  type SurfaceMetrics,
} from "@clockwyrks/structured-2d";
import {
  breathe,
  captureOutputSync,
  createEngineCaseHarness,
  identityDriver,
  installAssetHost,
  installAudioContext,
  missingOpsFault,
  DEFAULT_MAX_FRAMES,
  type AudioBufferLike,
  type DrivenEngine,
  type EngineHarnessOptions,
  type EngineViewport,
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
import { BACKGROUND, game as build } from "../src/game";
import { assertTruthy, fail } from "./assert";
import {
  BINDINGS,
  CELLS,
  CHANNEL,
  CHANNEL_ARC,
  FIELD_H,
  FIELD_W,
  INJECTOR,
  PATH_LENGTH,
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
 * The operations a check poses the hall through, as `specs/instrumentation.md`
 * fixes them under this engine.
 *
 * This is the specification written down as types, and it is the ONLY description
 * of the surface the validators read. The build declares its own type for the
 * surface its instance's `initialize` returns; nothing here imports it, and the
 * harness reaches the object itself through `engine.debug` alone, so a build whose
 * surface departs from the specification is held against the specification rather
 * than against its own idea of what it wrote.
 *
 * "A pose takes only the parameters its heading names and returns nothing; a
 * reading takes none and returns what it read." Both act on the live world at the
 * moment of the call.
 */
export interface VoluteDebugApi {
  /** `VOLUTE_DEBUG_VERSION`, a plain number. */
  version: number;
  /** Restore every declared field to its title value. */
  reset(): void;
  /** A pure reading of the running game. */
  snapshot(): VoluteSnapshot;
  /** Set the screen, and do nothing else. */
  setScreen(name: ScreenName): void;
  /** Set the level in play, and do nothing else. */
  setLevel(level: number): void;
  /** Set the run's score, clamped to at least 0. */
  setScore(n: number): void;
  /** Set the cells remaining, clamped to 0 through CELLS. */
  setCells(n: number): void;
  /** Set the chain step, and restart the window that returns it to 1. */
  setChainStep(k: number): void;
  /** Open `level`, exactly as the interlude before it opens it. */
  startLevel(level: number): void;
  /** Replace every core on the channel with the cores given. */
  poseTrain(cores: readonly PosedCore[]): void;
  /** Remove every core from the channel and every projectile. */
  clearTrain(): void;
  /** Set the charge the injector holds loaded, and nothing else. */
  setLoaded(charge: ChargeId): void;
  /** Set the charge the injector holds queued, and nothing else. */
  setQueued(charge: ChargeId): void;
  /** Pose the charge of the next core the inlet emits, or clear it with `null`. */
  setNextEmitted(charge: ChargeId | null): void;
  /** Set the aim, normalized into [0, 360), and do nothing else. */
  setAim(angleDegrees: number): void;
  /** Release the loaded core along the current aim. Always launches. */
  fire(): void;
  /** Set the pressure, clamped to 0 through 100. */
  setPressure(value: number): void;
  /** Set the cores the inlet has left to emit this level. */
  setQuotaRemaining(n: number): void;
  /** Hold the inlet, and let it go again. Independent of the quota. */
  setEmission(enabled: boolean): void;
  /** Hold the train where it stands, and let it advance again. */
  setFeed(enabled: boolean): void;
  /** Grant one of the three timed kinds, as extracting its mark grants it. */
  grantMachinery(kind: TimedMachineryKind): void;
  /** Pose the pause control: the screen becomes `paused`. */
  pause(): void;
  /** Pose it again: the screen returns to `playing`. */
  resume(): void;
}

/** The engine this project stands a build up on. */
export type VoluteEngine = Engine<VoluteDebugApi>;

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
// `specs/assets.md` has the build commit its produced files "under
// `public/assets/`, which the engine serves at its asset root and the build
// copies into `dist/` unchanged", so this is that host and nothing more: the
// bytes on disk, at the path the engine resolved, with a 404 for anything the
// build never produced.

/** This module's directory: the validator project's root. */
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * The repository root of the build this project is stood up over.
 *
 * The runner stages this directory to `validation/` inside the build's tree,
 * which is the one layout these suites ever run in: `../src/game` above resolves
 * against exactly that, and `public/` is served from beside it. Taken from this
 * module's own URL rather than from the working directory, so the suite runs the
 * same from any shell — and never from the shared package's, which is staged one
 * directory deeper still.
 */
const WORKSPACE_ROOT = resolve(PROJECT_ROOT, "..");

/**
 * The transport, standing for the whole of this worker's run.
 *
 * `public/` ALONE, which is narrower than the package's default and narrower than
 * this case's own Simple 2D project: the harness this replaces served
 * `join(BUILD_ROOT, "public", url)` and answered 404 for everything else, and
 * that is the tree this project's verdicts were taken over. `onMissing: "404"` is
 * the same answer, and it is what makes the engine announce `asset:failed` with a
 * status for a file the build never produced.
 *
 * No `document` shim: nothing in this build asks for one, and a build that never
 * asks cannot tell the difference. The handle is kept for {@link imageRef}, which
 * asks it where a decoded image came from.
 */
const assets = installAssetHost({
  workspaceRoot: WORKSPACE_ROOT,
  roots: ["public"],
  onMissing: "404",
  images: true,
  documentElement: false,
  label: "volute",
});

/**
 * A decoded cue that CANNOT FAIL, which is what this project has always handed
 * `api.audio.load`.
 *
 * NOT `wavAudioBuffer`, and the difference is the whole point. This project's
 * stand-in context was `decodeAudioData() { return Promise.resolve({ duration: 1 }) }`
 * — it took no argument, inspected nothing, and bound every produced cue whatever
 * the bytes were. The package's real decoders THROW on a body that is not a
 * RIFF/WAVE file or that carries no `data` chunk, and `specs/assets.md` has a
 * build bind its cues from `initialize`: a build whose produced `.wav` files are
 * malformed would have its `initialize` reject, which fails the `beforeEach` and
 * with it EVERY point in this project. That is an inversion, not a refinement,
 * and it is not this migration's to make.
 *
 * So the lenient reading stays, under this case's own name. The case's OTHER two
 * projects do decode for real — `simple-2d` through `wavAudioBuffer` and `none`
 * through a browser — so the three disagree about what a malformed cue file
 * costs. That disagreement predates this file and is the case's to settle on
 * purpose, in a change whose subject is the verdict rather than the harness.
 *
 * Every figure below is inert: nothing sounds, and neither engine reads a
 * file-backed buffer's rate, channel count, length or duration — the bus
 * announces `cue:played`, `cue:looped` and `cue:stopped` from the play call
 * itself, never from a buffer ending. `duration` is `1` because that is what
 * stood here.
 */
const SILENCE = new Float32Array(0);

function decodeCue(): AudioBufferLike {
  return {
    sampleRate: 44100,
    numberOfChannels: 1,
    length: 44100,
    duration: 1,
    getChannelData: () => SILENCE,
    copyFromChannel: () => undefined,
    copyToChannel: () => undefined,
  };
}

installAudioContext({ decode: decodeCue });

/* -------------------------------------------------------------------------- */
/* Which produced file a frame drew                                           */
/* -------------------------------------------------------------------------- */
//
// THIS IS THE CASE'S OWN RECORDER IDENTITY, NOT THE PACKAGE'S. The package's
// recorder can intern a drawn bitmap for itself (`RecorderOptions.internImages`),
// and its `ImageRef` carries the same seven fields as the one below — but it
// fills `src` and `srcHash` off the source object's OWN `src` property, which is
// a string for a browser's `<img>` and a BUFFER for the canvas library's decoded
// `Image`. Read that way every produced sprite in this project would report
// `srcHash: null`, and `presentation/produced-core-sprites` asserts on exactly
// that field being present. So Volute keeps its own reading, and `hash()` below
// is this project's own digest. See the package README's collision table.

/** A 32-bit hash of a string, as the identity a source URL is named by. */
function hash(text: string): string {
  let value = 0;
  for (let i = 0; i < text.length; i += 1) {
    value = (Math.imul(value, 31) + text.charCodeAt(i)) | 0;
  }
  return (value >>> 0).toString(16).padStart(8, "0");
}

/**
 * A bitmap source a frame named.
 *
 * `id` is identity WITHIN ONE WORKER: the same decoded sprite drawn on a hundred
 * frames carries one id, and two different produced sprites never share one.
 * `width` and `height` are the source's own natural size, which is how a 28 x 28
 * core sprite is told from a 24 x 24 HUD icon. `srcHash` is a digest of WHERE the
 * source came from, present on every source that came off disk and absent on a
 * canvas the build painted itself — which is what separates a produced file from
 * geometry drawn in code, without ever matching a path under `assets/`.
 *
 * The digest used to be taken over the decoded BYTES, which needed a hook in the
 * decode itself; the asset host knows the URL each decode came from, so the
 * digest is over that instead and the discrimination — off disk, or painted here
 * — is exactly the one it always was.
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

/**
 * Every bitmap source this suite has seen, and the id each was given.
 *
 * One table for the whole file rather than one per harness, because an id has to
 * mean the same thing to the check reading a frame and to the harness that
 * decoded the file. Ids are handed out in order and never reused, so two
 * different produced sprites never share one and the same sprite drawn on a
 * hundred frames carries one.
 */
const imageIds = new WeakMap<object, number>();
const imagesById = new Map<number, object>();
let nextImageId = 1;

/**
 * The {@link ImageRef} an argument names, or `null` when it is not a source.
 *
 * A source is anything the canvas can draw from: the decoded produced files, and
 * any canvas the build painted itself. Which of the two it is comes from
 * `srcHash`, which is present only on a source the asset host fetched.
 */
export function imageRef(value: unknown): ImageRef | null {
  if (value === null || typeof value !== "object") return null;
  const sized = value as { width?: unknown; height?: unknown };
  if (typeof sized.width !== "number" || typeof sized.height !== "number") {
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
    kind: "bitmap",
    name: value.constructor.name,
    width: sized.width,
    height: sized.height,
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
 * `imageRef`s disagree about where `srcHash` comes from.
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

/**
 * Why the build's surface cannot be driven, or `null` when it can.
 *
 * Read off `engine.debug` directly rather than off whatever the kit handed the
 * driver, because the kit already stands a fail-on-access proxy in for a return
 * that is not an object — and asking THAT what it carries would raise the
 * verdict here, inside the `beforeEach`, instead of on the points whose checks
 * reach the hall through the surface.
 *
 * A build whose `initialize` returned nothing at all never reaches this: the
 * engine rejects `initialize` itself, naming the missing surface, and the
 * rejection fails the suite's `beforeEach` with the engine's own message. Such a
 * build does not run on the engine under any entry point, so it is not this
 * harness's fault to report.
 */
function surfaceFaultOf(engine: VoluteEngine): string | null {
  let held: unknown;
  try {
    held = engine.debug;
  } catch (error) {
    return `engine.debug could not be read: ${String(error)}`;
  }
  if (typeof held !== "object" || held === null) {
    return `engine.debug holds ${held === null ? "null" : typeof held}, not an object`;
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
 * here needs to answer a `typeof`.
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

/* -------------------------------------------------------------------------- */
/* The harness                                                                */
/* -------------------------------------------------------------------------- */

/** How the field is mapped onto the canvas, as the ENGINE's own fit reports it. */
export type Viewport = EngineViewport;

export interface HarnessOptions extends EngineHarnessOptions {
  /** The clock each frame takes its delta from. Defaults to 60 Hz. */
  clock?: Clock;
}

/** What a sweep found: whether the predicate ever held, and where it stopped. */
export type UntilResult = BaseUntilResult<VoluteSnapshot>;

export interface Harness {
  /** The engine the build is running on. For a check that needs the engine itself. */
  readonly engine: VoluteEngine;
  /**
   * The surface the BUILD's instance returned from `initialize`, read off
   * `engine.debug` and driven directly: each operation acts on the live world at
   * the moment of the call.
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
 * `pointerEvent` is left at the package's default, {@link PointerPositionEvent}:
 * this project has always dispatched a position and nothing more, and a
 * structured engine's pointer input takes a DIFFERENT path when `button` and
 * `buttons` are absent — it falls back to a primary-button contact — so the
 * device-bearing event is not a richer version of the same gesture.
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
  VoluteDebugApi,
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
    const engine = createEngine<VoluteDebugApi>({
      canvas,
      width: FIELD_W,
      height: FIELD_H,
      game,
      // The build's own field background, handed to the engine exactly as the
      // seeded `src/main.ts` hands it (specs/overview.md).
      background: BACKGROUND,
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
    if (fault !== null) return unexposedSurface(fault);
    return identityDriver(raw as VoluteDebugApi);
  },
  snapshot: (debug) => debug.snapshot(),
  // The engine's own fit maps the field onto the backing store and the pointer
  // event is handed the client position that fit gives, unrounded — which is
  // exactly what this project has always dispatched.
  pointerPrecision: "exact",
});

/**
 * Stand the build's game up on the engine over a canvas of the harness's own,
 * reset it to the title, and hand back everything a check reads.
 *
 * The default shape is the field's own size at one device pixel per CSS pixel, so
 * a logical coordinate and a canvas pixel are the same thing and no check has to
 * think about the fit at all.
 *
 * WHY THIS WRAPS THE KIT RATHER THAN EXTENDING IT. This project's vocabulary is
 * this case's — `h.step(2)`, `h.stepWatching`, `h.frameCalls()` — because its
 * suites are the same suites as `validation/none`'s and `validation/simple-2d`'s,
 * differing only in where an `await` falls. The kit's own harness answers a
 * different vocabulary for the same machinery, and folding the two names together
 * would leave `h.advance` and `h.step` meaning one thing under one project and
 * another under the next. So the kit's harness is the machinery underneath, and
 * what a check holds is this case's own shape over it.
 */
export async function createHarness(
  options: HarnessOptions = {},
): Promise<Harness> {
  const base = await kit.createHarness(options);
  const engine = base.engine;
  const calls = base.calls;

  const surfaceFault = surfaceFaultOf(engine);
  const debug =
    surfaceFault === null ? base.debug : unexposedSurface(surfaceFault);

  // What the build opened on, read before the `reset` below puts it back to the
  // title whatever it opened on. `specs/ui.md`: "The game opens here." The reset's
  // own transition lands by the end of the next advanced frame, which is why one
  // is advanced here and why no check ever counts it.
  let openingScreen: VoluteSnapshot["screen"] | null = null;
  if (surfaceFault === null) {
    openingScreen = debug.snapshot().screen;
    debug.reset();
    await base.advance(1);
  }

  // Every driven tick opens a fresh operation log, so `lastCalls` is the last
  // tick's render and nothing before it, and a drive of ten thousand ticks costs
  // one tick's worth of operations rather than ten thousand.
  const drive = async (ticks: number): Promise<void> => {
    const count = Math.max(0, Math.floor(ticks));
    for (let i = 0; i < count; i += 1) {
      calls.length = 0;
      await base.advance(1);
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
    const x = Math.min(Math.max(left, 0), canvas.width);
    const y = Math.min(Math.max(top, 0), canvas.height);
    const w = Math.max(1, Math.min(wide, canvas.width - x));
    const h = Math.max(1, Math.min(high, canvas.height - y));
    const pixels = base.ctx.getImageData(x, y, w, h);
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
    get assetFailures(): string[] {
      return base.assetFailures.map(
        (failure) => `${failure.path}: ${failure.reason}`,
      );
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

      let snapshot = debug.snapshot();
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
        snapshot = debug.snapshot();
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
        const snapshot = debug.snapshot();
        seen.push(snapshot);
        if (watch?.(snapshot, i + 1) === true) break;
      }
      return seen;
    },

    hold: (code) => base.hold(code),
    release: (code) => base.release(code),

    async tap(code) {
      // Down, ONE tick, up. "The engine closes the input frame after the frame
      // renders", so the edge armed by the press is consumed by exactly the frame
      // between the two.
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

    movePointer: (x, y) => base.pointer("pointermove", x, y),

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

    lastCalls: () => [...calls],

    probe(names) {
      const held: unknown = engine.debug;
      const surface = (
        typeof held === "object" && held !== null ? held : {}
      ) as Record<string, unknown>;
      const ops: Record<string, string> = {};
      for (const name of names) ops[name] = typeof surface[name];
      return { version: surface.version, ops };
    },

    viewport: () => base.viewport(),
    device: (x, y) => base.device(x, y),

    // Through {@link Harness.devicePixel} rather than through the kit's own
    // `pixel`, which reads the backing store at whatever coordinate it is handed:
    // this project's reading has always been CLAMPED to the canvas, so a point
    // off the field answers the nearest pixel rather than throwing.
    pixel(x, y) {
      const at = base.device(x, y);
      return this.devicePixel(at.x, at.y);
    },

    pixels: (points) => points.map((point) => harness.pixel(point.x, point.y)),

    pixelRect(x, y, width, height) {
      const view = base.viewport();
      const origin = base.device(x, y);
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

    surface: () => ({
      width: base.canvas.width,
      height: base.canvas.height,
      dpr: base.shape.dpr,
    }),

    imagePixels(id) {
      const source = imagesById.get(id);
      if (source === undefined) return null;
      const sized = source as { width: number; height: number };
      const width = Math.max(1, Math.round(sized.width));
      const height = Math.max(1, Math.round(sized.height));
      const off = createCanvas(width, height);
      const offCtx = off.getContext("2d");
      offCtx.clearRect(0, 0, width, height);
      offCtx.drawImage(source as unknown as Image, 0, 0);
      const pixels = offCtx.getImageData(0, 0, width, height);
      return {
        width: pixels.width,
        height: pixels.height,
        data: new Uint8ClampedArray(pixels.data),
      };
    },

    armAudio() {
      // "The engine opens the audio context on the first pointer or key event it
      // sees." `KeyZ` is bound to nothing (specs/controls.md), so the gesture
      // changes no game state.
      base.hold(UNBOUND_KEY);
      base.release(UNBOUND_KEY);
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
 * Wrap the drive, not the arrangement — the assertions stay exactly where they
 * were and read exactly what they did. Capture sits BESIDE them rather than in
 * place of them: a check still fails for the reasons it failed before, and the
 * recording is what a reviewer looks at afterwards to see what the build actually
 * drew while it did.
 */
export const captureReplay = makeReplayCapture("volute", PROJECT_ROOT);

/**
 * Keep the picture currently on the canvas as the review item's `outputId` output.
 *
 * The companion to {@link captureReplay}, for a point whose evidence is one
 * PICTURE rather than a stretch of motion: which screen the game opened on, what
 * gauge the HUD drew at a pressure of 100, which charge the injector held.
 *
 * SYNCHRONOUS, and the suites next door say `captureStill(h, "icon")` with no
 * `await`: a 2D canvas is already rasterized, so `toBuffer` answers now. The
 * package ships the asynchronous twin as well, and this case's Simple 2D project
 * binds that one — see the README's collision table.
 *
 * What is written is whatever the last frame that RAN left behind, so call it
 * after the frame that poses the thing under test and before the assertions, so a
 * check that fails still leaves the picture that shows why.
 */
export function captureStill(h: Harness, outputId: string): void {
  captureOutputSync("volute", PROJECT_ROOT, outputId, "png", () =>
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
// concern is removed before its scenario is staged, and every faculty its
// requirement does not exercise is held, rather than parked somewhere harmless:
// containment leans on the game's own rules holding, and a broken build is broken
// in exactly those rules. {@link poseHall} is the shape of that — it poses the
// screen and the level with single-figure poses, holds the inlet, empties the
// channel, and puts back exactly the cores the requirement is about. Nothing it
// arranges has to be undone, because nothing it calls arranges more than the one
// figure its own heading names.

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
  /** The level in play, 1 through 5. Defaults to 1. */
  level?: number;
  /**
   * Whether the inlet emits. Defaults to `false`, which holds it.
   *
   * `specs/instrumentation.md` (`setEmission`) makes the gate independent of the
   * quota, so a check that wants nothing to arrive holds the inlet and leaves the
   * quota alone — and an empty channel under an unexhausted quota never clears.
   * A check that IS about the inlet lets it go.
   */
  emission?: boolean;
  /**
   * Whether the train advances. Defaults to `true`, the value play runs at.
   *
   * A check whose requirement does not exercise the feed holds it, so its
   * scenario stands exactly where it was posed and the point it decides does not
   * also turn on `channel/feed-advance`'s figure.
   */
  feed?: boolean;
  /**
   * The cores the inlet has left to emit this level.
   *
   * Defaults to the level's own quota, which is the value furthest from the
   * exhausted one: `specs/progression.md` clears a level "the moment its quota is
   * exhausted and no cores remain on the channel", so a hall posed with the quota
   * full is never cleared out from under a check that is not about clearing.
   */
  quotaRemaining?: number;
  /** The pressure. Defaults to 0, the value a level starts at. */
  pressure?: number;
  /** The cores to put on the channel. Defaults to none. */
  cores?: readonly PosedCore[];
  /** The charge the injector holds loaded. Left as it stands by default. */
  loaded?: ChargeId;
  /** The charge the injector holds queued. Left as it stands by default. */
  queued?: ChargeId;
  /** The chain step. Defaults to 1, the step a level begins at. */
  chainStep?: number;
  /** The run's score. Left where it stands by default, which is 0 after a reset. */
  score?: number;
  /** The cells remaining. Left where they stand, which is CELLS after a reset. */
  cells?: number;
  /** The aim, in degrees. Left where it stands by default. */
  aim?: number;
  /** A timed machinery to grant once the hall is posed. */
  machinery?: TimedMachineryKind;
}

/**
 * Pose an isolated hall in play, from single-figure poses alone.
 *
 * Every call is one operation setting one figure, so nothing here has to be
 * undone: the screen becomes `playing`, the level is set, the inlet is held, the
 * quota and the pressure and the chain step are set, the channel is emptied, and
 * exactly the cores the check is about are put back. No level is OPENED — that is
 * `startLevel`, and the checks that are about a level opening (`channel/
 * seeded-twelve`, `channel/seed-layout`, `progression/quota-table`) call it
 * themselves.
 *
 * NO FRAME IS ADVANCED HERE. `specs/instrumentation.md` asks a caller to advance
 * one frame after a pose that OPENS A LEVEL, and the harness's opening `reset`
 * carries that frame; none of the single-figure poses below opens one. So a check
 * reads back exactly what it posed, with no tick of the game's own rules in
 * between, and every tick that runs is one the check asked for.
 *
 * The active machinery is left as it stands, which on a harness fresh from its
 * opening `reset` is none (`specs/instrumentation.md`: a reset leaves "no active
 * machinery"). A check that grants one names it here.
 *
 * Nothing here decides an outcome. Every extraction, score, chain step, grant,
 * cell and clear a check reads comes from the ticks it steps afterwards.
 */
export async function poseHall(
  h: Harness,
  options: PoseOptions = {},
): Promise<void> {
  const level = options.level ?? 1;
  h.debug.setScreen(options.screen ?? "playing");
  h.debug.setLevel(level);
  h.debug.setEmission(options.emission ?? false);
  h.debug.setFeed(options.feed ?? true);
  h.debug.setQuotaRemaining(options.quotaRemaining ?? levelSpec(level).quota);
  h.debug.setPressure(options.pressure ?? 0);
  h.debug.setChainStep(options.chainStep ?? 1);
  if (options.score !== undefined) h.debug.setScore(options.score);
  if (options.cells !== undefined) h.debug.setCells(options.cells);
  h.debug.clearTrain();
  if (options.cores !== undefined && options.cores.length > 0) {
    h.debug.poseTrain(options.cores);
  }
  if (options.loaded !== undefined) h.debug.setLoaded(options.loaded);
  if (options.queued !== undefined) h.debug.setQueued(options.queued);
  if (options.aim !== undefined) h.debug.setAim(options.aim);
  if (options.machinery !== undefined) {
    h.debug.grantMachinery(options.machinery);
  }
}

/**
 * Open a run from the title exactly as the start control does, and open `level`.
 *
 * `specs/instrumentation.md` carries no operation for this: starting a match is a
 * SEQUENCE, and `writing-debug-apis-and-validators` puts every sequence in the
 * harness. The three poses are the three figures the start control leaves — "the
 * score `0`, the cells at `CELLS` (`3`), and level `1` opened" — each set by the
 * operation whose heading names it. A `level` beyond 1 is opened after it, which
 * leaves the score and the cells at their opening values. Each pose that opens a
 * level is followed by the one frame the transition it may request lands in.
 */
export async function startRun(h: Harness, level = 1): Promise<void> {
  h.debug.setScore(0);
  h.debug.setCells(CELLS);
  h.debug.startLevel(1);
  await h.step(1);
  if (level !== 1) {
    h.debug.startLevel(level);
    await h.step(1);
  }
}

/**
 * Aim at `angleDegrees` and release the loaded core along it.
 *
 * Two operations, not one: `setAim` poses the aim and nothing else, and `fire()`
 * releases along whatever aim stands. A check that wants the aim posed WITHOUT a
 * shot calls `h.debug.setAim` on its own, which is what
 * `injector/aim-rotate-left` and `injector/aim-rotate-right` do.
 *
 * `fire()` always launches — "Any cooldown outstanding at the call is cleared
 * first" — so this is how a check that is not ABOUT the cooldown gets a
 * projectile into the hall. A check that IS about the cooldown raises the fire
 * CONTROL instead, with {@link pressFire}, which honours it.
 */
export function fireAt(h: Harness, angleDegrees: number): void {
  h.debug.setAim(angleDegrees);
  h.debug.fire();
}

/** Aim at a field point and release the loaded core toward it. */
export function fireToward(h: Harness, target: Point): void {
  fireAt(h, aimAt(target));
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
  return harnessAudio.get(h)?.watch() ?? [];
}

/** How many of the cues sounded started a loop. */
function loopsStartedIn(audio: { cues(): readonly TimedCue[] }): number {
  return audio.cues().filter((cue) => cue.looped).length;
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
  const audio = harnessAudio.get(h);
  if (audio === undefined) return 0;
  return Math.max(0, loopsStartedIn(audio) - audio.stopped());
}

/** How many cues the build has sounded since the engine was built. */
export function soundsStarted(h: Harness): number {
  return harnessAudio.get(h)?.cues().length ?? 0;
}

/** How many of the cues sounded started a loop. */
export function loopsStarted(h: Harness): number {
  const audio = harnessAudio.get(h);
  return audio === undefined ? 0 : loopsStartedIn(audio);
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
