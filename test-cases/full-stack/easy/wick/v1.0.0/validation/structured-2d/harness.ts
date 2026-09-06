// Wick — the case's half of the validator harness, under the Structured 2D
// engine. CASE-PROVIDED.
//
// Every check in this project is an ordinary vitest test that runs IN THE SAME
// PROCESS as the build. It imports the engine and the build's own
// `src/game.ts`, creates an engine over a canvas it owns and a clock it
// scripts, and steps the game with `engine.advance`. Nothing drives a browser,
// nothing polls, and no wall-clock time passes: a check asks for a number of
// frames and gets exactly that number, each worth exactly the delta it asked
// for.
//
// THE MACHINERY THAT DOES THAT IS NOT WICK'S. The canvas and its draw-command
// recorder, the debug surface read, the frame loop, the transport that serves
// the build's own produced files to the engine's loader, and the writers a
// review item's evidence lands through — every engine-backed case needs exactly
// that, and it lives once, in `@clockwyrks/case-harness`, staged beside this
// file as `./case-harness/`. What is left HERE is what is genuinely Wick's: its
// types, the headless audio graph its cue points are decided on, the blit and
// text readings its produced art is decided on, the produced-file readers, and
// every scenario helper that poses this game.
//
// WHAT A CHECK READS. The game's own state (through the case's `snapshot`),
// the engine's object model — the open world, the game state its mode built,
// its controllers — the engine's frame counter, the cue events it broadcast
// and the sound each one reached, the draw calls the pipeline issued, the
// pixels those calls left on the canvas, and the produced files on disk.
// Nothing here fabricates an outcome: the helpers below only ARRANGE the
// world through the debug surface, and the real ticks the build wrote are
// what run from there. Wick's contacts are simulation-owned (`specs/world.md`
// and `specs/weapons.md` decide every hit from the state's own circles and
// rectangles), so no engine collision event is read anywhere.
//
// WHY THE DEBUG SURFACE RATHER THAN RAW ASSIGNMENT. `specs/instrumentation.md`
// fixes its operations, so they mean the same thing in every build: a pose
// arranges the running game through the same systems play uses, the nine
// driver switches hold the game's autonomous systems still while one behavior
// is watched, and `reset` gives everything back. `surface.ts` is that
// specification as types, and it is the only description of the surface this
// harness reads: the build's own module for it is never imported.
//
// WHERE THE SURFACE COMES FROM. Off `engine.debug`, never built here. The
// build's game instance returns it from `initialize`, the engine holds that
// same object, and reading it back off the engine is the only way a surface
// reaches a check — so a build that returned no surface, or one missing an
// operation, fails the checks that reach the game through it. See
// {@link readDebugSurface}, which is this case's own reading and NOT the
// package's, for the reason stated there.
//
// THE CLOCK. A {@link ScriptedClock} worth `TICK_MS` (1000/60 ms) a frame by
// default — exactly the pairing `specs/instrumentation.md` names: one frame on
// `playing` consumes exactly one tick, because the accumulator receives the
// same float it compares against and consumes, so `engine.advance(n)` is `n`
// ticks. A check about the subdivision of a tick poses a partial frame with
// {@link Harness.frameOf}, which hands the next frame any delta it names.
//
// INPUT EDGES ARE CONSUMED PER CONTROLLER. An edge is `pressed` once for each
// reader that asks, so a check that read `world.players()[0].input` would eat
// the copy the BUILD's own controller was going to read. A check that wants to
// read an action for itself takes {@link addObserver} instead.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createCanvas,
  loadImage,
  type Canvas,
  type Image,
  type SKRSContext2D,
} from "@napi-rs/canvas";
import {
  createEngine,
  PlayerController,
  type Clock,
  type DiagnosticReading,
  type Engine,
  type GameDefinition,
  type GameInstance,
  type GameState,
  type SurfaceMetrics,
  type Viewport,
  type World,
} from "@clockwyrks/structured-2d";
import {
  breathe,
  captureOutputSync,
  createEngineCaseHarness,
  identityDriver,
  installAssetHost,
  missingOps,
  type AssetHost,
  type EngineHarness,
} from "./case-harness/engine/index";
import { deviceOf, makeReplayCapture, pixelAt } from "./case-harness/engine/2d";
import {
  callsTo,
  drawOps,
  setsOf,
  DRAW_METHODS,
  type DrawCall,
} from "./case-harness/draw-calls";
import {
  apply,
  IDENTITY,
  numbers,
  transformed,
  type Matrix,
} from "./case-harness/matrix";
import {
  drawnText,
  DEFAULT_FONT,
  DEFAULT_TEXT_ALIGN,
} from "./case-harness/text";
import { colorDistance, type Rgb } from "./case-harness/color";
import type { PixelRect } from "./case-harness/pixels";
import { game as build } from "../src/game";
import { fail } from "./assert";
import {
  ASSET_ROOT,
  BACKGROUND,
  BASE_MAX_HP,
  LAST_TICK,
  LAYOUT,
  MOVE_SPEED,
  OVERLAY_TOGGLE_CODE,
  PICKUP_RADIUS,
  STAGE_H,
  STAGE_W,
  TICK_HZ,
  TICK_MS,
  WHEEL_ROW,
  XP_BASE,
  type EnemyId,
  type GemTier,
  type PassiveId,
  type PickupKind,
  type WeaponId,
} from "./constants";
import {
  REQUIRED_OPS,
  SWITCH_NAMES,
  type ProjectileWeapon,
  type PuddleWeapon,
  type Screen,
  type SnapshotEnemy,
  type SnapshotGem,
  type SnapshotPassive,
  type SnapshotPickup,
  type SnapshotProjectile,
  type SnapshotRun,
  type SnapshotWeapon,
  type SnapshotZone,
  type SwitchName,
  type WickDebugApi,
  type WickRect,
  type WickSnapshot,
  type ZoneKind,
} from "./surface";

export type {
  ProjectileWeapon,
  PuddleWeapon,
  Screen,
  SnapshotEnemy,
  SnapshotGem,
  SnapshotPassive,
  SnapshotPickup,
  SnapshotProjectile,
  SnapshotRun,
  SnapshotWeapon,
  SnapshotZone,
  SwitchName,
  WickDebugApi,
  WickRect,
  WickSnapshot,
  ZoneKind,
};
export { REQUIRED_OPS, SWITCH_NAMES };

// The readings over a frame's operation log that are the same reading in every
// case, re-exported under the names this project's suites already say. A
// `DrawCall` here is the shared package's, and so is the transform algebra every
// placed reading below walks with.
export { callsTo, drawOps, setsOf, drawnText, DRAW_METHODS, colorDistance };
export type { DrawCall, Matrix, PixelRect, Rgb };

/**
 * The build's game, typed against the surface the CASE specifies.
 *
 * The build declares its own type for the surface its instance's `initialize`
 * returns; what a check holds it to is `surface.ts`, so the definition is cast
 * to the case's `GameDefinition<WickDebugApi>` here and the engine is
 * parameterized with it. A surface that departs from the specification is
 * caught where a check reaches for the missing member, not by the build's own
 * compiler.
 */
const game = build as unknown as GameDefinition<WickDebugApi>;

/** The engine this project stands the build up on, as a check holds it. */
export type WickEngine = Engine<WickDebugApi>;

/* -------------------------------------------------------------------------- */
/* The clock                                                                  */
/* -------------------------------------------------------------------------- */
//
// One frame is one tick. `specs/instrumentation.md` states the pairing itself:
// "a scenario pairs a `ConstantClock` of `1000 / 60` milliseconds with
// `engine.advance`, so one frame on `playing` consumes exactly one tick, and a
// clock of any other length poses a partial frame". The delta each frame
// supplies is the very float the build's accumulator compares against and
// subtracts, so the arithmetic is exact frame after frame.

/**
 * A clock worth `stepMs` a frame, except for the frames a check has queued a
 * delta for: those take the queued delta, oldest first, and the clock returns
 * to its step once the queue is spent. A queued delta is what poses a partial
 * frame, and it never declines a tick.
 */
export class ScriptedClock implements Clock {
  private readonly queued: number[] = [];

  constructor(readonly stepMs: number = TICK_MS) {
    if (!(Number.isFinite(stepMs) && stepMs > 0)) {
      throw new RangeError(
        `ScriptedClock needs a positive stepMs, got ${stepMs}`,
      );
    }
  }

  /** Hand the next frame `ms` of delta instead of the step. */
  queue(ms: number): void {
    if (!(Number.isFinite(ms) && ms > 0)) {
      throw new RangeError(`a frame's delta must be positive, got ${ms}`);
    }
    this.queued.push(ms);
  }

  delta(): number {
    const next = this.queued.shift();
    return next === undefined ? this.stepMs : next;
  }
}

/** Frames covering `ticks` whole ticks of simulation time: one for one. */
export const FRAMES_PER_TICK = 1;

/** Frames covering `seconds` of simulation time, rounded up to a whole frame. */
export function secondFrames(seconds: number): number {
  return Math.ceil(seconds * TICK_HZ - 1e-9);
}

/* -------------------------------------------------------------------------- */
/* Readings taken off one frame's render                                      */
/* -------------------------------------------------------------------------- */
//
// WHAT THE RECORDER KEEPS, AND WHAT THIS FILE RECOVERS. The shared recorder
// writes every call and property set the render made, in order, and — because
// this project's kit asks for `measureText` — the transform, the measured width
// and the alignment in force at each `fillText`/`strokeText`. It records nothing
// beside a `drawImage`, and it records no font. So the two facts this project's
// points are decided on that are NOT on a call — the image smoothing flag at a
// blit, and the font size at a run of text — are recovered by WALKING the
// frame's own operations, which carry both as ordinary context state:
// `save`/`restore` stack them, `imageSmoothingEnabled` and `font` are recorded
// sets, and this engine issues its viewport fit and its camera as recorded
// `setTransform` calls and never calls `ctx.reset()`. The walk is therefore
// exact, and it is the same walk `../case-harness/matrix` already carries for
// every other placed reading in the tree.
//
// AND A WALK HAS TO START SOMEWHERE. Both of those flags are context state that
// SURVIVES A FRAME BOUNDARY: a build free to set `imageSmoothingEnabled` once
// when it starts, or to set a font in one frame and draw under it in the next,
// is drawing under a value no operation in the frame being read carries.
// Starting either walk from the canvas's own default would report that build's
// smoothing as on and its glyphs as ten pixels tall — silently, and in the
// direction that fails it. So the harness records what each frame OPENED under,
// off the real context, in the moment before it runs the frame, and the walks
// begin there. See {@link openedUnder}.

/**
 * The context state a frame opened under, against the frame's own call log.
 *
 * A side table rather than a parameter, because the two readings that need it
 * are called by SUITES, over an array they were handed — `textDraws(calls)`,
 * `blitsOf(calls)` — and there is nowhere in those calls to thread a value
 * through. Every array {@link createHarness} hands out is registered here, and
 * an array from anywhere else falls back to the canvas's own defaults, which is
 * exactly what a reading over a synthesized list of calls should assume.
 */
const openedUnder = new WeakMap<readonly DrawCall[], FrameOpen>();

/** The two pieces of context state a frame inherits from the frame before it. */
interface FrameOpen {
  font: string;
  smoothing: boolean;
}

/** What a walk assumes about a log nothing recorded the opening state of. */
const CANVAS_DEFAULTS: FrameOpen = { font: DEFAULT_FONT, smoothing: true };

/** The state `calls` opened under, or the canvas's own defaults. */
function openOf(calls: readonly DrawCall[]): FrameOpen {
  return openedUnder.get(calls) ?? CANVAS_DEFAULTS;
}

/**
 * One bitmap the build blitted. `id` is the produced file the bytes were
 * served from, as the engine resolved it under the asset root — so
 * `assets/sprites/lamplighter/idle.png` — and `""` names a source this harness
 * never served (a canvas or image the build made for itself). The rectangle is
 * the axis-aligned box of the destination in DEVICE pixels, mapped through the
 * transform in force at the call, so `x + w / 2, y + h / 2` is its center
 * under any transform the build drew under.
 */
export interface Blit {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Whether image smoothing was on at the moment of this blit. */
  smoothing: boolean;
  /**
   * Whether the transform in force reflected the picture: its determinant is
   * negative, which is what a horizontal mirror (`scale(-1, 1)`) leaves.
   */
  mirrored: boolean;
  /** The transform in force at the call. */
  transform: Matrix;
}

/**
 * A cue the build played, and the frame of the drive it played it on.
 *
 * `file` is filled in by the headless audio graph the moment the cue's sound
 * starts: the produced file it was decoded from (`assets/audio/hit.wav`), `""`
 * for a synthesized cue that sounded from no file, and `null` while nothing
 * sounded — a muted play announces itself at gain `0` and starts no source.
 *
 * NOT THE KIT'S `TimedCue`, AND IT CANNOT BE. The shared kit stamps a cue with
 * `cue`, `tick` and `looped` and nothing can fill in a `file` on it, because the
 * file is not known until the SOURCE starts a moment later and only this
 * project's own graph sees that. So the subscription, the stamping and the list
 * are all this case's — see {@link Harness.cues} — and the kit's own list is
 * simply not exposed.
 */
export interface TimedCue {
  /** The frame it sounded on, as {@link Harness.frame} counts them. */
  frame: number;
  /** The engine's simulated time at that frame, in milliseconds. */
  t: number;
  /** The cue's name, as the build declared and played it. */
  name: string;
  /** Whether this was the start of a loop, which is what a music bed is. */
  loop: boolean;
  /** The gain it sounded at. `0` while muted. */
  gain: number;
  file: string | null;
}

/** One asset the build asked for and did not get. */
export interface AssetFailure {
  path: string;
  reason: string;
}

/** One loop the headless audio graph has running: its cue and its file. */
export interface LiveLoop {
  cue: string | null;
  file: string;
}

/* -------------------------------------------------------------------------- */
/* Serving the produced tree to the engine's loader                           */
/* -------------------------------------------------------------------------- */
//
// `specs/assets.md` has the build load every produced sprite and sound through
// the engine, which resolves each path under `assets/` relative to the page
// the build is served from and fetches it. This project runs in a Node process
// with no page, so the globals the loader and the cue bus reach for have to be
// stood up over the workspace's own tree — and that transport is the shared
// package's {@link installAssetHost}, once, for the life of the process:
// `fetch` over the files, `createImageBitmap` through this canvas library's
// decoder, and `ImageBitmap` so the recorder knows a bitmap when it sees one.
//
// THE ROOT ORDER IS `["."]` AND THAT IS THIS CASE'S ANSWER, not a default.
// `specs/assets.md` commits every produced file under `assets/` at the root of
// the repository, so the root of the served tree IS the workspace and nothing
// else is looked in. A URL no root carries answers `404` — the package's own
// default, and what a served page gives — which is what makes the engine
// announce `asset:failed` with a status, so a build that produced no file fails
// the items about that file and only those.
//
// TWO THINGS THE PACKAGE'S TRANSPORT IS SLIGHTLY WIDER ABOUT than the shim this
// replaced, both about a URL neither engine's loader ever writes: it drops a
// `?query` or `#fragment` before resolving, where the shim here looked for a
// file whose name carried them and 404ed; and it serves a URL written with one
// leading `/`, where the shim here handed that to the platform. Neither can be
// reached through `api.assets`, whose `resolve` refuses a leading `/` outright
// and appends no query.
//
// WHAT IS NOT THE PACKAGE'S IS WHICH FILE A DECODED SOUND CAME FROM. The host
// remembers where a decoded IMAGE came from ({@link AssetHost.sourceOf}), which
// is what {@link sourceId} answers, but a cue is decoded through
// `AudioContext.decodeAudioData` and arrives there as bare bytes. So this
// project keeps its own record of what it served — see {@link servedPaths}.

/**
 * The directory this harness sits in, which is the validator project's root.
 * Taken from this module's own URL so it names the same directory in both
 * layouts this file lives in: the case's own `validation/structured-2d/`, and
 * the `validation/` the runner stages that directory to in the build's tree.
 *
 * NEVER DERIVED INSIDE THE PACKAGE. The shared harness is staged one directory
 * DEEPER than this file, so a root taken from its own `import.meta.url` would
 * address a tree one level too far down — every produced file would quietly 404
 * and every written output would land where nothing looks.
 */
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

/** The build's workspace, which is where `assets/` and `src/` sit. */
export const WORKSPACE = resolve(PROJECT_ROOT, "..");

/**
 * The produced file each served body's bytes came from, by CONTENT DIGEST.
 *
 * A DIGEST RATHER THAN THE BUFFER'S IDENTITY, deliberately, and it must stay
 * that way. Keying by identity would be strictly more precise — every fetch
 * would name its own file — and that is exactly why it may not change here: two
 * byte-identical produced cues collapse to ONE path under a digest, and every
 * verdict this project has ever reached about a cue sounding from its own file
 * was reached under that reading. Tightening it would quietly pass a build this
 * case has always failed.
 */
const servedPaths = new Map<string, string>();

/** The digest a served file and a decoded body are matched on. */
function digest(bytes: Uint8Array): string {
  return createHash("sha1").update(bytes).digest("hex");
}

/** The transport this worker installed, and the handle the readings go through. */
let assetHost: AssetHost | null = null;

let hostServed = false;

/**
 * Stand the transport up over the workspace, once, and tag what it serves.
 *
 * Idempotent and never undone: a worker that simply exits leaves the shims
 * standing, which is what every engine project in the tree does and what makes
 * them cheap.
 *
 * THE SECOND HALF IS THIS CASE'S OWN AND SITS ON TOP OF THE PACKAGE'S. Both 2D
 * engines load a cue as `decodeAudioData(await (await response.blob())
 * .arrayBuffer())`, so the one place the bytes of a served body and the URL they
 * came from are both in hand is the moment that `arrayBuffer()` resolves. The
 * wrapper below shadows `blob()` on the response the transport answered and
 * `arrayBuffer()` on the `Blob` that answers, records the digest, and changes
 * nothing else — every other property of the response is the transport's.
 */
function serveWorkspaceAssets(): void {
  if (hostServed) return;
  hostServed = true;

  assetHost = installAssetHost({
    workspaceRoot: WORKSPACE,
    roots: ["."],
    images: true,
    label: "wick",
  });

  const served = globalThis.fetch;
  globalThis.fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const response = await served(input, init);
    const url = typeof input === "string" ? input : String(input);
    const blobOf = response.blob.bind(response);
    Object.defineProperty(response, "blob", {
      value: async (): Promise<Blob> => {
        const blob = await blobOf();
        const bytesOf = blob.arrayBuffer.bind(blob);
        Object.defineProperty(blob, "arrayBuffer", {
          value: async (): Promise<ArrayBuffer> => {
            const bytes = await bytesOf();
            servedPaths.set(digest(new Uint8Array(bytes)), url);
            return bytes;
          },
          writable: true,
          configurable: true,
        });
        return blob;
      },
      writable: true,
      configurable: true,
    });
    return response;
  }) as typeof fetch;

  // Both the loader's decode and the bus's unlock ask the host for one, and this
  // graph is the case's own — see the section above it. Defined only where the
  // host has none, so a host that really carries Web Audio keeps the decoder
  // that really works.
  const bag = globalThis as unknown as Record<string, unknown>;
  bag.AudioContext ??= HeadlessAudioContext;
}

/**
 * The produced file a drawn source came from, or `""` for one this harness
 * never served — so a build that drew a canvas it painted itself is reported
 * as having drawn something other than the produced file rather than nothing.
 */
export function sourceId(source: unknown): string {
  if (source === null || typeof source !== "object") return "";
  return assetHost?.sourceOf(source) ?? "";
}

/* -------------------------------------------------------------------------- */
/* The headless audio graph                                                   */
/* -------------------------------------------------------------------------- */
//
// THIS IS THE CASE'S OWN GRAPH AND NOT THE PACKAGE'S, for a reason that decides
// points. The shared `installAudioContext` answers every node with an INERT one:
// `start()` and `stop()` are swallowed. This project's two audio readings are
// observations OF exactly those two calls — {@link TimedCue.file} is filled in
// by the source that starts a moment after the bus announces the cue, and
// {@link Harness.liveLoops} is the set of sources that started and have not
// stopped. Bound to the package's graph, both would answer nothing at all, and
// every point about which file a cue sounds from would fail a conformant build.
// {@link FakeBuffer} is the second half of the same fact: it carries the `file`
// the buffer was decoded from and no `getChannelData` at all, which is a fact
// about this case's own bookkeeping rather than about a decoded buffer, and is
// recorded in the package's README as deliberately not extracted.
//
// THE DECODE IS LENIENT AND MUST STAY LENIENT. See the paragraph above
// {@link wavHeader}, which is where the whole of that reasoning lives.
//
// The context is installed only where the host has none, exactly as before, so a
// host that really does carry Web Audio keeps the decoder that really works.

/**
 * The headless audio graph's owner: the harness whose engine's bus is sounding
 * through it. Set around the gesture that unlocks a harness's bus, so the
 * context the bus creates inside that gesture reports to that harness.
 */
interface SoundOwner {
  /** The cue the bus announced last, awaiting the source its sound starts. */
  pending: TimedCue | null;
  /** Every loop source started and not yet stopped. */
  live: Set<FakeSource>;
}

let audioOwner: SoundOwner | null = null;

/** A decoded buffer stand-in, remembering the produced file it came from. */
class FakeBuffer {
  constructor(
    readonly file: string,
    readonly duration: number,
    readonly sampleRate: number,
    readonly numberOfChannels: number,
    readonly length: number,
  ) {}
}

/** A parameter stand-in: the bus schedules values on it and reads none back. */
function fakeParam(value: number): Record<string, unknown> {
  return {
    value,
    setValueAtTime: (): void => undefined,
    linearRampToValueAtTime: (): void => undefined,
    exponentialRampToValueAtTime: (): void => undefined,
  };
}

/** A node the bus wires and starts; what is recorded is the start and the stop. */
class FakeSource {
  buffer: FakeBuffer | null = null;
  loop = false;
  started = false;
  stopped = false;
  /** The cue whose sound this source is, taken at `start` from the owner. */
  cue: string | null = null;
  readonly type = "sine";
  readonly frequency = fakeParam(440);

  constructor(
    private readonly owner: SoundOwner | null,
    private readonly kind: "file" | "synth",
  ) {}

  connect(): void {
    return undefined;
  }
  disconnect(): void {
    return undefined;
  }
  start(): void {
    this.started = true;
    const owner = this.owner;
    if (owner === null) return;
    const announced = owner.pending;
    owner.pending = null;
    if (announced !== null) {
      this.cue = announced.name;
      announced.file = this.kind === "file" ? (this.buffer?.file ?? "") : "";
    }
    if (this.loop) owner.live.add(this);
  }
  stop(): void {
    this.stopped = true;
    this.owner?.live.delete(this);
  }
}

/**
 * The `AudioContext` this host stands in place of. The engine's asset loader
 * decodes each produced `.wav` through one, and its cue bus sounds every cue
 * and loop through another; neither hears anything here, and both report to
 * the harness instead.
 */
class HeadlessAudioContext {
  readonly owner = audioOwner;
  readonly destination = {};
  readonly state = "running";
  currentTime = 0;

  resume(): Promise<void> {
    return Promise.resolve();
  }
  suspend(): Promise<void> {
    return Promise.resolve();
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
  decodeAudioData(bytes: ArrayBuffer): Promise<FakeBuffer> {
    const view = new Uint8Array(bytes);
    const file = servedPaths.get(digest(view)) ?? "";
    const header = wavHeader(Buffer.from(view));
    return Promise.resolve(
      new FakeBuffer(
        file,
        header?.duration ?? 0,
        header?.sampleRate ?? 0,
        header?.channels ?? 0,
        header?.frames ?? 0,
      ),
    );
  }
  createBufferSource(): FakeSource {
    return new FakeSource(this.owner, "file");
  }
  createOscillator(): FakeSource {
    return new FakeSource(this.owner, "synth");
  }
  createGain(): Record<string, unknown> {
    return {
      gain: fakeParam(1),
      connect: (): void => undefined,
      disconnect: (): void => undefined,
    };
  }
}

export interface HarnessOptions {
  /**
   * What every frame is worth by default, in milliseconds. One tick a frame
   * unless a check names another cadence.
   */
  stepMs?: number;
  /**
   * A clock of the check's own in place of the scripted one, for a check
   * that drives an uneven cadence; {@link Harness.frameOf} is unavailable
   * under it.
   */
  clock?: Clock;
  /** The element's laid-out CSS width. Defaults to the logical stage width. */
  cssWidth?: number;
  /** The element's laid-out CSS height. Defaults to the logical stage height. */
  cssHeight?: number;
  /** Device pixels per CSS pixel. Defaults to 1, one device pixel per unit. */
  dpr?: number;
  /**
   * The root the engine resolves every asset path under. Defaults to the
   * engine's own `assets/`; a check about the missing-art path names a root
   * with nothing under it.
   */
  assetRoot?: string;
  /**
   * Whether to give the build's audio its unlocking gesture at open, so every
   * cue's sound reaches the headless graph and reports its file. On by
   * default; a check about the locked bus turns it off.
   *
   * SPELLED THE SAME WAY IN ALL THREE OF THIS CASE'S PROJECTS. Wick used to
   * call this `unlockAudio` under `simple-2d` and `armAudio` here, for one
   * concept — and `Harness.armAudio()` was already the method's name in both,
   * so the option was the only place the two spellings met. The engineless
   * project spells it `armAudio`, which is also the shared harness's own
   * `HarnessOptions.armAudio`; no suite in either engine project passes either
   * spelling and both defaulted to `true`, so the fold costs no call site and
   * the case now says one word for one gesture everywhere.
   */
  armAudio?: boolean;
}

/** How far a sweep may run, in whole ticks. */
export interface UntilOptions {
  maxTicks?: number;
}

/** What a sweep found: whether the predicate ever held, and where it stopped. */
export interface UntilResult {
  hit: boolean;
  /** Ticks driven before the sample that ended the sweep. */
  ticks: number;
  snapshot: WickSnapshot;
}

/** What one frame's render issued: its operations, and its bitmap blits. */
export interface FrameDraw {
  calls: DrawCall[];
  blits: Blit[];
}

/** A `KeyboardEvent`-shaped event's extra fields: the engine reads `code` and `repeat`. */
export interface KeyInit {
  repeat?: boolean;
  key?: string;
}
/** A `KeyboardEvent`-shaped event: the engine reads `code` and `repeat`. */
export class KeyEvent extends Event {
  readonly code: string;
  readonly repeat: boolean;
  readonly key: string;

  constructor(type: "keydown" | "keyup", code: string, init: KeyInit = {}) {
    super(type);
    this.code = code;
    this.repeat = init.repeat ?? false;
    this.key = init.key ?? code;
  }
}

/**
 * A `PointerEvent`-shaped event's extra fields.
 *
 * The engine reads a pointer event STRUCTURALLY (any object carrying the
 * fields drives it), so a check drives the pointer with these plain events
 * exactly as a browser's would. The defaults are one primary mouse.
 */
export interface PointerInit {
  pointerId?: number;
  isPrimary?: boolean;
  pointerType?: "mouse" | "pen" | "touch";
  /** `0` is the primary button; a move reports `-1`, meaning none. */
  button?: number;
  /** The held-button mask: `1` while the primary button is down. */
  buttons?: number;
}

/**
 * A `PointerEvent`-shaped event, dispatched at the same target the key events
 * go to. Its `clientX`/`clientY` are CSS pixels from the canvas's corner,
 * which is what the engine maps onto the stage.
 */
export class PointerInputEvent extends Event {
  readonly clientX: number;
  readonly clientY: number;
  readonly pointerId: number;
  readonly isPrimary: boolean;
  readonly pointerType: string;
  readonly button: number;
  readonly buttons: number;

  constructor(
    type: "pointermove" | "pointerdown" | "pointerup" | "pointercancel",
    clientX: number,
    clientY: number,
    init: PointerInit = {},
  ) {
    super(type);
    this.clientX = clientX;
    this.clientY = clientY;
    this.pointerId = init.pointerId ?? 0;
    this.isPrimary = init.isPrimary ?? true;
    this.pointerType = init.pointerType ?? "mouse";
    this.button = init.button ?? (type === "pointermove" ? -1 : 0);
    this.buttons = init.buttons ?? (type === "pointerdown" ? 1 : 0);
  }
}

/**
 * A `WheelEvent`-shaped event. `deltaMode` is `0`, pixels, so a delta is CSS
 * pixels and the engine divides it by the same fit a position goes through.
 */
export class WheelInputEvent extends Event {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly deltaMode = 0;

  constructor(deltaX: number, deltaY: number) {
    super("wheel");
    this.deltaX = deltaX;
    this.deltaY = deltaY;
  }
}

/** A key the case binds nothing to, whose press is the audio's gesture alone. */
const GESTURE_CODE = "F24";
/**
 * What the build owes when its surface is missing: the `Expected:` line of the
 * failure every check that reaches for the surface lands on.
 */
const SURFACE_REQUIREMENT =
  "the debug surface src/game.ts's instance returns from initialize, which " +
  "the engine hands back from engine.debug, carrying every operation " +
  "specs/instrumentation.md names";

/** Fail the running check because the build's surface is not what it must be. */
export function failSurface(fault: string): never {
  return fail(SURFACE_REQUIREMENT, fault);
}

/**
 * The debug surface the BUILD's instance returned from `initialize`, read off
 * the engine that holds it. Deliberately a READ and never a construction: the
 * surface is the build's deliverable, and `engine.debug` is the only way it
 * reaches a check.
 *
 * A return that is no surface, or one missing an operation, is failed by
 * assertion at the moment a check first reaches for a MISSING member, not
 * thrown from here — every suite builds its harness in a `beforeEach`, and a
 * throw there would bury the real verdict under the harness's own stack. The
 * operations that ARE there still drive, so a build missing one operation
 * fails the checks that need that one and no other. Keys that belong to the
 * machinery (`then`, `constructor`, symbols) answer `undefined` so the verdict
 * is not buried under formatting noise.
 */
function readDebugSurface(engine: Engine<WickDebugApi>): {
  debug: WickDebugApi;
  fault: string | null;
} {
  let held: unknown;
  try {
    held = engine.debug;
  } catch (error) {
    const fault = `engine.debug could not be read: ${String(error)}`;
    return { debug: missingSurface({}, fault), fault };
  }
  if (typeof held !== "object" || held === null) {
    const fault = `engine.debug holds ${held === null ? "null" : typeof held}, not an object`;
    return { debug: missingSurface({}, fault), fault };
  }
  const target = held as Record<string, unknown>;
  // WHICH operations are absent is the shared harness's pure reading; WHERE the
  // fault lands, and what it says, is this case's — see {@link missingSurface}.
  const missing = missingOps(target, REQUIRED_OPS);
  if (missing.length === 0) return { debug: held as WickDebugApi, fault: null };
  const fault =
    "engine.debug holds a surface that carries no " +
    missing.map((op) => `${op}()`).join(", ");
  return { debug: missingSurface(target, fault), fault };
}

/** A surface that drives what it has and fails the check reaching for what it lacks. */
function missingSurface(
  target: Record<string, unknown>,
  fault: string,
): WickDebugApi {
  const missing = new Set<string>(missingOps(target, REQUIRED_OPS));
  return new Proxy(target as unknown as WickDebugApi, {
    get: (object, property): unknown => {
      if (typeof property === "symbol") return undefined;
      if (property === "then" || property === "constructor") return undefined;
      if (missing.has(property)) return () => failSurface(fault);
      return Reflect.get(object, property, object) as unknown;
    },
  });
}
/**
 * Everything a check reads off one engine running one build.
 *
 * THE CASE'S OWN SHAPE OVER THE KIT'S, RATHER THAN AN EXTENSION OF IT. The
 * shared `EngineHarness` spells a DRIVE `advance(n)` and spells the frame
 * COUNTER `tick()`, where this project's vocabulary — five hundred call sites
 * of it — is `h.tick(n)` for a drive that answers the snapshot it left. The two
 * cannot be joined: intersected, `h.tick()` would resolve to the counter and
 * every awaited drive would be reading a number. So the kit's harness is the
 * machinery underneath and this is what a check holds.
 */
export interface Harness {
  readonly engine: WickEngine;
  /**
   * The world currently open, read fresh on every access. Wick runs in ONE
   * level for the whole session (`specs/overview.md`), so this world lives as
   * long as the engine — but it is the engine's live object, so anything that
   * has to survive a later frame is copied rather than kept.
   */
  readonly world: World;
  /** The open world's game state. Its arrangement is the build's; a check reads
   * {@link Harness.snapshot} for anything the specification states. */
  readonly state: GameState;
  /** The game instance, the one framework object that outlives every level. */
  readonly instance: GameInstance<WickDebugApi>;
  /**
   * The debug surface the BUILD's instance returned from `initialize`, read
   * off `engine.debug` — see {@link readDebugSurface} — and driven directly:
   * each operation acts on the live world at the moment of the call.
   */
  readonly debug: WickDebugApi;
  /**
   * What is wrong with the build's surface, or `null` when every operation
   * `specs/instrumentation.md` names is there: `engine.debug` held no object,
   * or the object it held is missing operations. An operation that is there
   * still drives; one that is missing fails the check that reaches for it.
   */
  readonly surfaceFault: string | null;
  /** The real 2D context, for `getImageData`. Draw calls also reach it. */
  readonly ctx: SKRSContext2D;
  /** The surface the engine drew into, holding the last frame that ran. */
  readonly canvas: Canvas;
  /**
   * Every cue the build played since the harness opened, oldest first.
   *
   * THIS CASE'S LIST, not the kit's. The kit stamps a cue with `cue`, `tick`
   * and `looped`; this one is stamped with the frame, the bus's own time and
   * gain, and — filled in a moment later by the source the bus starts — the
   * produced FILE it sounded from, which nothing outside this project's own
   * graph can see. See {@link TimedCue}.
   */
  readonly cues: TimedCue[];
  /** Every asset the build failed to load, oldest first. */
  readonly assetFailures: AssetFailure[];
  /** Every asset path the build loaded, oldest first. */
  readonly assetLoads: string[];

  /** Whether the build has the cue `name` looping at this moment, off the bus. */
  looping(name: string): boolean;
  /** Every loop source the headless graph has running right now. */
  liveLoops(): LiveLoop[];

  /** Frames run since the engine started. */
  frame(): number;
  /** The simulated time those frames covered, in milliseconds. */
  timeMs(): number;

  /** A fresh read of the game's state through the case's `snapshot`. */
  snapshot(): WickSnapshot;
  /** `debug.reset`: the boot state, on `title`, every switch on. */
  reset(): void;
  /** Run `frames` frames of the harness's clock, back to back. */
  advance(frames: number): Promise<void>;
  /** Run exactly one frame worth `ms` of delta time, and read what it left. */
  frameOf(ms: number): Promise<WickSnapshot>;
  /** Run `ticks` whole ticks of simulation time, and read what they left. */
  tick(ticks?: number): Promise<WickSnapshot>;
  /** Drive a tick at a time until `predicate` holds, or the budget is spent. */
  until(
    predicate: (snapshot: WickSnapshot) => boolean,
    options?: UntilOptions,
  ): Promise<UntilResult>;

  /** Press a key and leave it down, as a player holding it would. */
  holdKey(code: string, init?: KeyInit): void;
  /** Release a key held by {@link Harness.holdKey}. */
  releaseKey(code: string): void;

  /**
   * Move the pointer to the STAGE point `(x, y)`, running no frame. Follow it
   * with a frame to let the build read it, or take {@link hoverAt}.
   */
  movePointer(x: number, y: number, init?: PointerInit): void;
  /**
   * Press the primary button at the STAGE point `(x, y)` and leave it down,
   * running no frame: the press edge the next frame reads.
   */
  pressPointer(x: number, y: number, init?: PointerInit): void;
  /** Release the primary button at the STAGE point `(x, y)`, running no frame. */
  releasePointer(x: number, y: number, init?: PointerInit): void;
  /**
   * Turn the wheel by `(dx, dy)` STAGE units, running no frame. Travel
   * accumulates until the frame that reads it closes, so several turns before
   * one frame are one frame's travel, exactly as `specs/controls.md` sums
   * them.
   */
  turnWheel(dx: number, dy: number): void;

  /** Every operation the LAST frame's render issued. */
  lastCalls(): DrawCall[];
  /** Run exactly one frame and hand back everything its render issued. */
  frameDraw(): Promise<FrameDraw>;
  /** Run exactly one frame and hand back the operations its render issued. */
  frameCalls(): Promise<DrawCall[]>;
  /** Run exactly one frame and hand back the bitmaps it blitted. */
  frameBlits(): Promise<Blit[]>;

  /** How the stage is mapped onto this harness's canvas. */
  viewport(): Viewport;
  /** Where a WORLD point lands in the canvas's backing store, through the camera. */
  device(x: number, y: number): { x: number; y: number };
  /** Where a STAGE point lands in the canvas's backing store, past the fit alone. */
  stageDevice(x: number, y: number): { x: number; y: number };
  /** The device pixel under a world point, as `[r, g, b, a]`. */
  pixel(x: number, y: number): [number, number, number, number];
  /** The device pixel under a stage point, as `[r, g, b, a]`. */
  stagePixel(x: number, y: number): [number, number, number, number];
  /** A rectangle of the canvas, addressed in DEVICE pixels, read back as RGBA. */
  pixelRect(x: number, y: number, width: number, height: number): PixelRect;

  /** Every diagnostic source the build registered, evaluated now. Pure. */
  diagnostics(): readonly DiagnosticReading[];

  /** Give the build's audio its unlocking gesture. Idempotent. */
  armAudio(): void;

  /** Close the world, halt the loop, and drop the engine's listeners. */
  dispose(): void;
}

/** The extra cue sinks {@link onCue} opened, per harness. */
const cueSinks = new WeakMap<Harness, TimedCue[][]>();

/* -------------------------------------------------------------------------- */
/* The kit, and the harness built over it                                     */
/* -------------------------------------------------------------------------- */

/**
 * What `createHarness` hands the kit's own hooks for the harness it is building.
 *
 * The kit constructs the engine and runs its `initialize` on this project's
 * behalf, and three things have to reach inside those two moments: the asset
 * root a check asked for, the cue subscriptions that must be in place BEFORE
 * any game code runs, and the audio owner the bus's context must report to. A
 * config object is built once, at module scope, so the only way through is a
 * slot the builder sets and clears — set immediately before `kit.createHarness`
 * and cleared in a `finally`, so a build that throws cannot leave it standing.
 * Nothing here is concurrent: a suite builds one harness at a time in its
 * `beforeEach`.
 */
interface Pending {
  readonly owner: SoundOwner;
  readonly cues: TimedCue[];
  readonly sinks: TimedCue[][];
  readonly assetLoads: string[];
  readonly assetRoot: string | undefined;
}

let pending: Pending | null = null;

/** The pending build, or a thrown error naming the mistake that lost it. */
function pendingBuild(): Pending {
  if (pending === null) {
    throw new Error(
      "wick harness: the engine was constructed outside createHarness, so " +
        "there is nothing for its cues and its audio to report to",
    );
  }
  return pending;
}

/**
 * The shared package's engine machinery, bound to Wick on this engine.
 *
 * `recorder: { measureText: true }` is what gives a text draw the width and the
 * alignment `hud/readouts.ts` and `instrumentation/rects.ts` place a run by.
 * `internImages` is deliberately NOT asked for: a blit is identified here by the
 * produced file its bytes were served from ({@link sourceId}, off the asset
 * host), which is a different reading from the recorder's per-page image
 * identity and the one every produced-sprite point in this project was decided
 * on.
 *
 * `cueEvents` names BOTH firings because `specs/assets.md` gives this case a
 * music bed beside its one-shot cues and a bed is announced as a loop. The kit's
 * own `cues` list is not exposed — see {@link Harness.cues} — but naming the
 * events honestly is what keeps the config a true statement of what this case
 * listens to.
 *
 * `pointerPrecision: "exact"` maps a logical point straight through the fit,
 * unrounded, which is where this project's pointer verdicts were taken. It is
 * stated for completeness rather than used: the pointer this case dispatches is
 * its own ({@link PointerInputEvent}, see below), raised on the kit's event
 * target, so the kit's `pointer` member is never called.
 */
const kit = createEngineCaseHarness<WickSnapshot, WickDebugApi, WickEngine>({
  slug: "wick",
  projectRoot: PROJECT_ROOT,
  stage: { width: STAGE_W, height: STAGE_H },
  tickHz: TICK_HZ,
  surfaceRequirement: SURFACE_REQUIREMENT,
  recorder: { measureText: true },
  cueEvents: ["cue:played", "cue:looped"],
  defaultClock: () => new ScriptedClock(),
  createEngine: ({ canvas, clock, surface }) => {
    const held = pendingBuild();
    const engine = createEngine<WickDebugApi>({
      canvas,
      width: STAGE_W,
      height: STAGE_H,
      game,
      // The build's own stage background and the four-way layout, handed to the
      // engine exactly as the seeded `src/main.ts` hands them (specs/overview.md,
      // specs/controls.md). Nothing here touches image smoothing: turning it off
      // for the pixel art is the build's own work under
      // `presentation/pixel-art-sampled-nearest`, so the harness leaves the engine
      // at its default and reads what each blit was actually sampled under.
      background: BACKGROUND,
      layout: LAYOUT,
      clock: clock as Clock,
      surface: surface as SurfaceMetrics,
      ...(held.assetRoot === undefined ? {} : { assetRoot: held.assetRoot }),
    });

    // Subscribed HERE rather than after `createHarness` returns, which is what
    // makes the game's own loading and its opening sounds observable: the kit
    // runs `initialize` after this call, and construction runs no game code, so
    // nothing has happened yet.
    const frameCount = (): number => {
      try {
        return engine.frame().count;
      } catch {
        return -1;
      }
    };
    engine.events.on("asset:loaded", ({ path }) => {
      held.assetLoads.push(path);
    });
    const noteCue =
      (loop: boolean) => (played: { cue: string; t: number; gain: number }) => {
        const timed: TimedCue = {
          frame: frameCount(),
          t: played.t,
          name: played.cue,
          loop,
          gain: played.gain,
          file: null,
        };
        // The bus announces first and sounds second, synchronously, so the next
        // source to start is this cue's.
        held.owner.pending = timed;
        held.cues.push(timed);
        for (const sink of held.sinks) sink.push(timed);
      };
    engine.events.on("cue:played", noteCue(false));
    engine.events.on("cue:looped", noteCue(true));
    return engine;
  },
  // The engine shares ONE audio context between its loader and its bus, built by
  // whichever asks first: a build that decodes its produced sounds in
  // `initialize` builds it there. The context reports to whichever harness owned
  // the moment it was built, so the kit's `initialize` runs inside this owner.
  initialize: async (engine) => {
    const held = pendingBuild();
    const previous = audioOwner;
    audioOwner = held.owner;
    try {
      return await engine.initialize();
    } finally {
      audioOwner = previous;
    }
  },
  driver: (_engine, raw) => identityDriver(raw as WickDebugApi),
  snapshot: (debug) => debug.snapshot(),
  // A structured engine draws through a camera, so a WORLD point becomes a
  // logical stage point before the viewport fit maps it onto the canvas. This is
  // the one place the four engines really diverge, and it is a parameter for
  // exactly that reason.
  toLogical: (engine, x, y) => engine.world.camera.worldToLogical({ x, y }),
  pointerPrecision: "exact",
});

/**
 * Record the frames `act` draws and keep them as the review item's `outputId`
 * output, handing back whatever `act` returned.
 *
 * Wrap the drive, not the arrangement:
 *
 * ```ts
 * const after = await captureReplay(h, "flight", () => advanceTicks(h, 40));
 * assertEqual(after.run.projectiles.length, 1);
 * ```
 *
 * The assertions stay exactly where they were and read exactly what they did;
 * a scenario that THROWS still writes what it had recorded before the failure
 * travels on — a failing check is the one whose replay a reviewer most wants.
 * A capture that closed no frames writes nothing, and outside a run the whole
 * thing is a no-op that still runs the scenario, so a check cannot pass in a
 * shell and fail in a run.
 */
export const captureReplay = makeReplayCapture("wick", PROJECT_ROOT);

/**
 * Keep the frame currently on the canvas as the review item's `outputId`
 * output — the companion to {@link captureReplay}, for a point whose evidence
 * is one PICTURE: which screen the game opened on, what it drew a gem as.
 *
 * What is written is whatever the last frame that RAN left behind, so call it
 * after the frame that poses the thing under test — a `frameDraw()` or an
 * `advance(1)` following the arrangement — and before the assertions, so a
 * check that fails still leaves the picture that shows why. Nothing here can
 * change a verdict: a directory that cannot be written to is reported and never
 * raised.
 */
export function captureStill(h: Harness, outputId: string): void {
  captureOutputSync("wick", PROJECT_ROOT, outputId, "png", () =>
    h.canvas.toBuffer("image/png"),
  );
}

/**
 * Build an engine over a canvas of the harness's own, initialize the build's
 * game, give its audio the gesture that unlocks it, and hand back everything a
 * check reads.
 *
 * The options the kit passes the factory are the ones the seeded `src/main.ts`
 * passes — the 1280x720 design size, the build's exported `BACKGROUND`, and the
 * `dpad-4` layout — plus the clock and the surface metrics a headless run needs.
 * So one harness serves every build of this case, and everything else the build
 * decided lives inside `src/game.ts`. Nothing is reset here: the state the build
 * BOOTS on is what a check reads first, and {@link isolate} or
 * {@link Harness.reset} is where a scenario starts.
 */
export async function createHarness(
  options: HarnessOptions = {},
): Promise<Harness> {
  serveWorkspaceAssets();

  const owner: SoundOwner = { pending: null, live: new Set() };
  const cues: TimedCue[] = [];
  const sinks: TimedCue[][] = [];
  const assetLoads: string[] = [];

  // The scripted clock is this harness's own so `frameOf` can queue a delta on
  // it; a check that brought a clock of its own gets that one, and `frameOf`
  // refuses rather than queueing onto something that would ignore it.
  const scripted =
    options.clock === undefined ? new ScriptedClock(options.stepMs) : null;
  const clock = options.clock ?? (scripted as ScriptedClock);

  pending = { owner, cues, sinks, assetLoads, assetRoot: options.assetRoot };
  let base: EngineHarness<WickSnapshot, WickDebugApi, WickEngine>;
  try {
    base = await kit.createHarness({
      clock,
      ...(options.cssWidth === undefined ? {} : { cssWidth: options.cssWidth }),
      ...(options.cssHeight === undefined
        ? {}
        : { cssHeight: options.cssHeight }),
      ...(options.dpr === undefined ? {} : { dpr: options.dpr }),
    });
  } finally {
    pending = null;
  }

  const engine = base.engine;
  const { debug, fault } = readDebugSurface(engine);
  const calls = base.calls;
  const dpr = base.shape.dpr;

  /**
   * Run `frames` frames, one at a time, keeping ONLY the current frame's
   * operations.
   *
   * `engine.advance(n)` is exactly `n` calls of `advance(1)` — its loop ticks
   * the clock once per frame and runs no host callback in between — so driving
   * one at a time changes nothing about the simulation and gives this harness
   * the frame boundary its readings are taken at. Emptying the log at the top of
   * each frame is what the per-frame bucket this replaced did: a drive to dawn
   * costs one frame of operations rather than thirty-six thousand, and
   * {@link Harness.lastCalls} is exactly the frame that just ran. The shared
   * `boundDrawLog` is deliberately not used — it caps a log at a figure this
   * case never measured, where the bucket is exact.
   */
  let opened: FrameOpen = { ...CANVAS_DEFAULTS };
  const drive = async (frames: number): Promise<void> => {
    for (let i = 0; i < frames; i += 1) {
      // Read off the REAL context, in the moment before the frame runs: this is
      // the smoothing and the font the frame inherits, which no operation in it
      // need carry. See {@link openedUnder}.
      opened = {
        font: base.ctx.font,
        smoothing: base.ctx.imageSmoothingEnabled,
      };
      calls.length = 0;
      openedUnder.set(calls, opened);
      await base.advance(1);
    }
  };

  /** A log the harness is handing out, tagged with the state it opened under. */
  const handOut = (log: DrawCall[]): DrawCall[] => {
    openedUnder.set(log, opened);
    return log;
  };

  const dispatch = (
    type: "keydown" | "keyup",
    code: string,
    init?: KeyInit,
  ): void => {
    base.events.dispatchEvent(new KeyEvent(type, code, init));
  };

  // WHERE A STAGE POINT LANDS AS A CLIENT POSITION. `specs/controls.md` reads
  // the pointer "in the stage's own coordinates, `0` to `STAGE_W` across and
  // `0` to `STAGE_H` down, whatever the canvas's size on the page and wherever
  // the letterbox bars fall", and the engine does that mapping itself: it
  // takes the client position relative to the surface's origin, scales it by
  // the device pixel ratio, and runs it back through the viewport fit. This
  // surface declares no `origin`, so the origin reads `(0, 0)` and a check
  // driving the DEFAULT harness — `cssWidth`/`cssHeight` of `STAGE_W`/`STAGE_H`
  // at a `dpr` of `1` — sends a stage point through unchanged. Inverting the
  // engine's own mapping here rather than assuming that identity is what keeps
  // a check correct when it builds its harness at another size or ratio.
  const stageToClient = (x: number, y: number): Point => {
    const view = base.viewport();
    return {
      x: (view.offsetX + x * view.scale) / dpr,
      y: (view.offsetY + y * view.scale) / dpr,
    };
  };
  const pointerAt = (
    type: "pointermove" | "pointerdown" | "pointerup",
    x: number,
    y: number,
    init?: PointerInit,
  ): void => {
    const at = stageToClient(x, y);
    base.events.dispatchEvent(new PointerInputEvent(type, at.x, at.y, init));
  };

  let armed = false;
  const armAudio = (): void => {
    if (armed) return;
    armed = true;
    // The bus creates its context inside the gesture, so the context built
    // here reports to this harness and no other.
    const previous = audioOwner;
    audioOwner = owner;
    try {
      dispatch("keydown", GESTURE_CODE);
      dispatch("keyup", GESTURE_CODE);
    } finally {
      audioOwner = previous;
    }
  };
  if (options.armAudio ?? true) armAudio();

  const harness: Harness = {
    engine,
    get world() {
      return engine.world;
    },
    get state() {
      return engine.world.state;
    },
    // The instance the engine's `initialize` resolved to, live off the engine
    // that holds it — the one framework object that outlives every level.
    get instance() {
      return engine.instance;
    },
    debug,
    surfaceFault: fault,
    ctx: base.ctx,
    canvas: base.canvas,
    cues,
    assetFailures: base.assetFailures,
    assetLoads,

    looping: (name) => engine.world.audio.looping(name),
    liveLoops: () =>
      [...owner.live].map((source) => ({
        cue: source.cue,
        file: source.buffer?.file ?? "",
      })),

    frame: () => base.frame(),
    timeMs: () => base.timeMs(),

    snapshot: () => debug.snapshot(),
    reset: () => debug.reset(),

    advance: (frames) => drive(frames),

    async frameOf(ms) {
      if (scripted === null) {
        throw new Error(
          "wick harness: frameOf needs the scripted clock; this harness was built with a clock of its own",
        );
      }
      scripted.queue(ms);
      await drive(1);
      return debug.snapshot();
    },

    async tick(ticks = 1) {
      await drive(ticks * FRAMES_PER_TICK);
      return debug.snapshot();
    },

    // WRITTEN HERE RATHER THAN TAKEN FROM THE KIT, so a sweep's frames are the
    // same frames every other drive runs: one at a time, with the operation log
    // emptied at each boundary. The yield is the shared one — a sweep of several
    // hundred frames runs inside one `await`, and node's timers, socket reads
    // and the vitest reporter all live on the loop it is holding.
    async until(predicate, untilOptions = {}) {
      const maxTicks = untilOptions.maxTicks ?? 600;
      let snapshot = debug.snapshot();
      if (predicate(snapshot)) return { hit: true, ticks: 0, snapshot };
      let since = Date.now();
      for (let ticks = 1; ticks <= maxTicks; ticks += 1) {
        await drive(FRAMES_PER_TICK);
        snapshot = debug.snapshot();
        if (predicate(snapshot)) return { hit: true, ticks, snapshot };
        since = await breathe(since);
      }
      return { hit: false, ticks: maxTicks, snapshot };
    },

    holdKey: (code, init) => dispatch("keydown", code, init),
    releaseKey: (code) => dispatch("keyup", code),

    movePointer: (x, y, init) => pointerAt("pointermove", x, y, init),
    pressPointer: (x, y, init) => pointerAt("pointerdown", x, y, init),
    releasePointer: (x, y, init) => pointerAt("pointerup", x, y, init),
    turnWheel: (dx, dy) => {
      // The engine accumulates `delta x dpr / scale` as logical units, so the
      // CSS delta that is worth `dx` stage units is `dx x scale / dpr` — the
      // same inversion `stageToClient` performs on a position.
      const view = base.viewport();
      base.events.dispatchEvent(
        new WheelInputEvent((dx * view.scale) / dpr, (dy * view.scale) / dpr),
      );
    },

    lastCalls: () => handOut([...calls]),
    async frameDraw() {
      await drive(1);
      const frameCalls = handOut([...calls]);
      return { calls: frameCalls, blits: blitsOf(frameCalls) };
    },
    async frameCalls() {
      await drive(1);
      return handOut([...calls]);
    },
    async frameBlits() {
      await drive(1);
      return blitsOf(calls);
    },

    viewport: () => base.viewport() as Viewport,
    device: (x, y) => base.device(x, y),
    stageDevice: (x, y) => deviceOf(base.viewport(), x, y),
    pixel: (x, y) => base.pixel(x, y),
    stagePixel: (x, y) => pixelAt(base.ctx, deviceOf(base.viewport(), x, y)),
    pixelRect: (left, top, wide, high) => {
      const canvas = base.canvas;
      const x = Math.min(Math.max(Math.round(left), 0), canvas.width);
      const y = Math.min(Math.max(Math.round(top), 0), canvas.height);
      const w = Math.max(1, Math.min(Math.round(wide), canvas.width - x));
      const h = Math.max(1, Math.min(Math.round(high), canvas.height - y));
      const pixels = base.ctx.getImageData(x, y, w, h);
      return {
        width: pixels.width,
        height: pixels.height,
        data: pixels.data as unknown as Uint8ClampedArray,
      };
    },

    diagnostics: () => engine.diagnostics(),

    armAudio,

    dispose: () => base.dispose(),
  };

  cueSinks.set(harness, sinks);
  return harness;
}
/* -------------------------------------------------------------------------- */
/* The shared helper contract                                                 */
/* -------------------------------------------------------------------------- */
//
// The surface is ATOMIC by design — one field per operation — so every
// compound sequence lives here, spelled once, and the category suites stay
// near-identical across engines. Nothing below decides an outcome: each
// helper only arranges the world through the surface and runs real ticks.

/**
 * Run `n` whole ticks of simulation time and read what they left.
 *
 * Under this engine one frame is one tick (see The clock above), so this is
 * `engine.advance(n)` followed by a snapshot.
 */
export async function advanceTicks(
  h: Harness,
  n: number,
): Promise<WickSnapshot> {
  await h.advance(n * FRAMES_PER_TICK);
  return h.snapshot();
}

/**
 * Press a key, run the one frame that delivers its edge, and release it.
 *
 * An edge arms the moment the `keydown` is dispatched and the engine closes
 * the input frame after the frame renders, discarding whatever no controller
 * consumed — so a tap that ran no frame would never reach the game.
 * `specs/controls.md` makes every menu action a press EDGE, so one tap is one
 * action however long the key is nominally down. The frame it runs consumes
 * one tick on `playing` and none elsewhere.
 */
export async function tap(h: Harness, code: string): Promise<WickSnapshot> {
  h.holdKey(code);
  try {
    await h.advance(1);
  } finally {
    h.releaseKey(code);
  }
  return h.snapshot();
}

/**
 * Hold a key down for `ticks` whole ticks of real frames, then release it.
 *
 * How the four movement actions are driven: `specs/controls.md` reads them as
 * held values sampled once per frame, and `specs/world.md` moves the
 * lamplighter `moveSpeed × TICK_DT` per tick while one is held — so `hold`
 * for `n` ticks moves it `180 × n / 60` units with no Bellows held.
 */
export async function hold(
  h: Harness,
  code: string,
  ticks: number,
): Promise<WickSnapshot> {
  h.holdKey(code);
  try {
    await h.advance(ticks * FRAMES_PER_TICK);
  } finally {
    h.releaseKey(code);
  }
  return h.snapshot();
}

/**
 * Hold several keys down together for `ticks` ticks, then release them all:
 * the diagonal and the opposed-pair scenarios of `specs/world.md`.
 */
export async function holdTogether(
  h: Harness,
  codes: readonly string[],
  ticks: number,
): Promise<WickSnapshot> {
  for (const code of codes) h.holdKey(code);
  try {
    await h.advance(ticks * FRAMES_PER_TICK);
  } finally {
    for (const code of codes) h.releaseKey(code);
  }
  return h.snapshot();
}

/**
 * Hold `codes` down together and run `ticks` whole ticks ONE FRAME AT A TIME,
 * reading the snapshot after each, then release them all: the tick-by-tick
 * trace of a held movement, for a check that asserts something "tick over
 * tick" (`specs/world.md`, Movement and Facing) rather than at the end of a
 * span. Entry `i` is the state after tick `i + 1` of the hold; the state
 * before the first tick is the caller's to read before calling.
 */
export async function holdSampling(
  h: Harness,
  codes: readonly string[],
  ticks: number,
): Promise<WickSnapshot[]> {
  const trace: WickSnapshot[] = [];
  for (const code of codes) h.holdKey(code);
  try {
    for (let tick = 0; tick < ticks; tick += 1) {
      await h.advance(FRAMES_PER_TICK);
      trace.push(h.snapshot());
    }
  } finally {
    for (const code of codes) h.releaseKey(code);
  }
  return trace;
}

/**
 * Dispatch a `keydown` carrying the `repeat` flag for a key already held, run
 * one frame, and leave the key down: the auto-repeat a held key produces,
 * which `specs/controls.md` says arms no second edge.
 */
export async function repeatKey(
  h: Harness,
  code: string,
): Promise<WickSnapshot> {
  h.holdKey(code, { repeat: true });
  await h.advance(1);
  return h.snapshot();
}

/** Tap the engine's overlay key, showing the diagnostics overlay or hiding it. */
export function toggleOverlay(h: Harness): Promise<WickSnapshot> {
  return tap(h, OVERLAY_TOGGLE_CODE);
}

/* ---- The pointer -------------------------------------------------------- */
//
// `specs/controls.md`, The pointer, applies three rules "on every frame, after
// that frame's press edges and before its update": a hover moves the
// highlight, a primary press edge takes the item under it, and wheel travel
// scrolls the almanac's list. All three are read from what a FRAME collected,
// so every helper below dispatches its events and then runs the one frame that
// reads them — a gesture that ran no frame reaches the game as nothing.
//
// Positions are STAGE coordinates throughout, "0 to STAGE_W across and 0 to
// STAGE_H down", the coordinates `menuRects` and `tabRects` report their
// rectangles in. The harness converts them to the client positions the engine
// maps back onto the stage, so a check names the same point under any surface
// size.

/**
 * The rectangles of the current screen's vertical menu, in menu order.
 *
 * A thin, typed name over the surface's own reading, spelled the same way on
 * every engine so a pointer check reads identically under each. On `almanac`
 * these are the VISIBLE entry rows, so the rectangle at position `i` belongs
 * to the entry at `menuIndex` `almanacScroll + i` (`specs/controls.md`).
 */
export function menuRects(h: Harness): readonly WickRect[] {
  return h.debug.menuRects();
}

/** The rectangles of the almanac's tab bar, in `ALMANAC_TABS` order. */
export function tabRects(h: Harness): readonly WickRect[] {
  return h.debug.tabRects();
}

/**
 * The middle of a rectangle: the one point inside it that no build's padding,
 * border, or rounding can put outside it, and, because "no two of a screen's
 * rectangles overlap" (`specs/controls.md`), inside no other.
 */
export function centerOf(rect: WickRect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/**
 * Move the pointer to the STAGE point `(x, y)`, run the one frame that reads
 * it, and hand back what that frame left.
 *
 * The hover rule is applied per frame, so the move alone changes nothing: the
 * frame is what carries "the pointer inside the rectangle of the item at
 * `menuIndex` `i` ... sets `menuIndex` to `i` and plays `menu-move`". The
 * pointer stays where it was put, so a later frame sees it there still.
 */
export async function hoverAt(
  h: Harness,
  x: number,
  y: number,
): Promise<WickSnapshot> {
  h.movePointer(x, y);
  await h.advance(1);
  return h.snapshot();
}

/** Rest the pointer in the middle of a reported rectangle. */
export function hoverRect(h: Harness, rect: WickRect): Promise<WickSnapshot> {
  const at = centerOf(rect);
  return hoverAt(h, at.x, at.y);
}

/**
 * Click the primary button at the STAGE point `(x, y)`, run the one frame that
 * reads the press edge, and hand back the snapshot that frame left.
 *
 * The move, the press, and the release are all delivered before the frame, the
 * way a real click between two frames arrives, so the frame sees the pointer at
 * the point AND the press edge armed there, and no contact is left open behind
 * it. "A primary press edge inside the rectangle of the item at `menuIndex` `i`
 * sets `menuIndex` to `i`, playing `menu-move` if that changed it, and then
 * takes that item exactly as `confirm` on it does" (`specs/controls.md`), and
 * that whole rule lands on this one frame.
 */
export async function clickAt(
  h: Harness,
  x: number,
  y: number,
): Promise<WickSnapshot> {
  h.movePointer(x, y);
  h.pressPointer(x, y);
  h.releasePointer(x, y);
  await h.advance(1);
  return h.snapshot();
}

/** Click the middle of a reported rectangle. */
export function clickRect(h: Harness, rect: WickRect): Promise<WickSnapshot> {
  const at = centerOf(rect);
  return clickAt(h, at.x, at.y);
}

/**
 * Press the primary button at a logical stage point, run the one frame that
 * reads it, and LEAVE the button down.
 *
 * The half of a click a check about arming needs: "a primary press edge inside
 * the rectangle of the item at `menuIndex` `i` sets `menuIndex` to `i` ... and
 * arms that item" (specs/controls.md), with the release still to come.
 */
export async function pressAt(
  h: Harness,
  x: number,
  y: number,
): Promise<WickSnapshot> {
  h.pressPointer(x, y);
  await h.advance(1);
  return h.snapshot();
}

/** Press the middle of a reported rectangle, leaving the button down. */
export function pressRect(h: Harness, rect: WickRect): Promise<WickSnapshot> {
  const at = centerOf(rect);
  return pressAt(h, at.x, at.y);
}

/** Travel the held mouse to a logical stage point, one driven frame. */
export async function glideTo(
  h: Harness,
  x: number,
  y: number,
): Promise<WickSnapshot> {
  h.movePointer(x, y, { button: -1, buttons: 1 });
  await h.advance(1);
  return h.snapshot();
}

/** Lift the primary button at a logical stage point, one driven frame. */
export async function liftAt(
  h: Harness,
  x: number,
  y: number,
): Promise<WickSnapshot> {
  h.releasePointer(x, y);
  await h.advance(1);
  return h.snapshot();
}

/** Lift the primary button in the middle of a reported rectangle. */
export function liftRect(h: Harness, rect: WickRect): Promise<WickSnapshot> {
  const at = centerOf(rect);
  return liftAt(h, at.x, at.y);
}

/* ---- Touch ---------------------------------------------------------------- */
//
// A CONTACT REACHES THE SAME RULES. "A touch contact landing inside a rectangle
// is that rectangle's press edge and lifting is its release edge", and "a touch
// contact never hovers: only a device reporting a position while out of contact
// moves the highlight this way" (specs/controls.md). So a contact is driven as
// the events a finger really produces: a `pointerdown` naming `touch`, moves
// that carry the held mask while it travels, and a `pointerup` naming `touch`.
// There is no move before the landing, because a finger reports no position
// before it touches the glass.

/** What a contact's events carry: the device, and the mask while it travels. */
const CONTACT: PointerInit = { pointerType: "touch" };
const CONTACT_HELD: PointerInit = {
  pointerType: "touch",
  button: -1,
  buttons: 1,
};

/** Land a real contact at a logical stage point, one driven frame. */
export async function touchLandAt(
  h: Harness,
  x: number,
  y: number,
): Promise<WickSnapshot> {
  h.pressPointer(x, y, CONTACT);
  await h.advance(1);
  return h.snapshot();
}

/** Land a contact in the middle of a reported rectangle. */
export function touchLandRect(
  h: Harness,
  rect: WickRect,
): Promise<WickSnapshot> {
  const at = centerOf(rect);
  return touchLandAt(h, at.x, at.y);
}

/** Travel the held contact to a logical stage point, one driven frame. */
export async function touchGlideTo(
  h: Harness,
  x: number,
  y: number,
): Promise<WickSnapshot> {
  h.movePointer(x, y, CONTACT_HELD);
  await h.advance(1);
  return h.snapshot();
}

/** Lift the contact at a logical stage point, one driven frame. */
export async function touchLiftAt(
  h: Harness,
  x: number,
  y: number,
): Promise<WickSnapshot> {
  h.releasePointer(x, y, CONTACT);
  await h.advance(1);
  return h.snapshot();
}

/**
 * Land a contact on a logical stage point and lift it there: two driven frames.
 *
 * The landing and the lift are separately observable, so the tap runs a frame
 * for each.
 */
export async function touchTapAt(
  h: Harness,
  x: number,
  y: number,
): Promise<WickSnapshot> {
  await touchLandAt(h, x, y);
  return touchLiftAt(h, x, y);
}

/** Tap the middle of a reported rectangle. */
export function touchTapRect(
  h: Harness,
  rect: WickRect,
): Promise<WickSnapshot> {
  const at = centerOf(rect);
  return touchTapAt(h, at.x, at.y);
}

/**
 * Turn the wheel by `rows` rows and run the one frame that reads the travel.
 *
 * `specs/controls.md` makes a frame's travel "that frame's wheel deltas summed
 * in stage units, divided by `WHEEL_ROW` (`100`) and truncated toward zero to
 * give the number of rows `almanacScroll` moves, downward travel moving it
 * toward the end of the list" — so `rows` whole rows are `rows x WHEEL_ROW`
 * units of downward travel, positive scrolling toward the end. A fractional
 * `rows` poses the remainder the rule discards.
 */
export async function wheelBy(h: Harness, rows: number): Promise<WickSnapshot> {
  h.turnWheel(0, rows * WHEEL_ROW);
  await h.advance(1);
  return h.snapshot();
}

/** The operation that sets each driver switch, by the switch's name. */
const SWITCH_OPS: Readonly<
  Record<SwitchName, keyof WickDebugApi & `set${string}`>
> = {
  spawning: "setSpawning",
  events: "setEvents",
  despawning: "setDespawning",
  enemyMotion: "setEnemyMotion",
  enemyContact: "setEnemyContact",
  weaponFire: "setWeaponFire",
  effectMotion: "setEffectMotion",
  drops: "setDrops",
  progression: "setProgression",
};

/** Set one driver switch through its own operation. */
export function setSwitch(h: Harness, name: SwitchName, on: boolean): void {
  const setter = h.debug[SWITCH_OPS[name]] as (on: boolean) => void;
  setter(on);
}

/** Set all nine driver switches to `on`. */
export function setSwitches(h: Harness, on: boolean): void {
  for (const name of SWITCH_NAMES) setSwitch(h, name, on);
}

/**
 * Turn the named driver switches on, leaving the others as they stand: how a
 * check turns on exactly the faculties its requirement is about.
 */
export function enable(h: Harness, ...switches: readonly SwitchName[]): void {
  for (const name of switches) setSwitch(h, name, true);
}

/** Turn the named driver switches off, leaving the others as they stand. */
export function disable(h: Harness, ...switches: readonly SwitchName[]): void {
  for (const name of switches) setSwitch(h, name, false);
}

/** The nine switches as the snapshot reports them, by name. */
export function switchesOf(s: WickSnapshot): Record<SwitchName, boolean> {
  return {
    spawning: s.spawning,
    events: s.events,
    despawning: s.despawning,
    enemyMotion: s.enemyMotion,
    enemyContact: s.enemyContact,
    weaponFire: s.weaponFire,
    effectMotion: s.effectMotion,
    drops: s.drops,
    progression: s.progression,
  };
}

export interface IsolateOptions {
  /**
   * The level the run is posed at. Left at the idle run's `1` when it is not
   * named: the `progression` switch, off with the rest, is what keeps a gain
   * from becoming a level-up mid-scenario, so nothing here has to outrun the
   * build's own `xpToNext`.
   */
  level?: number;
  /**
   * Whether to put Taper at level `1` in the first weapon slot. Off by
   * default, so a check about another weapon sees no slash when it turns
   * `weaponFire` on; a check that needs a weapon held asks for one.
   *
   * `setScreen("playing")` installs nothing — it sets the screen and nothing
   * else (`specs/instrumentation.md`) — so the loadout an isolated world holds
   * is exactly what the check posed into it. `setWeapon` zeroes the slot's
   * timer when its id changes, so the Taper this leaves is the level `1` and
   * cooldown `0` a run starts with.
   */
  taper?: boolean;
}

/**
 * Pose an ISOLATED world: the `playing` screen over an idle run holding
 * nothing — no enemy, projectile, zone, gem, or pickup, no weapon and no
 * passive — with every driver switch off.
 *
 * The arrangement the authoring guide requires of a validator — clear every
 * entity the requirement is not about, then spawn back exactly what it IS
 * about through the surface's atomic poses. All NINE switches are off, so no
 * autonomous consequence (a director spawn, an event, a despawn, a move, a
 * contact hit, a weapon firing, an effect moving, a death's drop, or a gain
 * spent on a level) arrives on top of the behavior being watched; a check that
 * is ABOUT one turns it back on with {@link enable}. `drops` and `progression`
 * are why an isolated run needs no posed level: a scenario that kills leaves
 * nothing on the field, and one that collects a gem raises `xp` without the
 * level-up overlay taking the screen out from under the check. The loadout is
 * empty, so no slash appears when `weaponFire` is turned on for a check about
 * another weapon, and `taper` puts Taper back for a check that needs a weapon
 * held.
 *
 * `reset` first, so nothing a previous section left is inherited; then
 * `setScreen("playing")`, which sets the screen and nothing else over the idle
 * run `reset` restored; then the clears, which score nothing, draw nothing,
 * and sound nothing.
 */
export function isolate(
  h: Harness,
  options: IsolateOptions = {},
): WickSnapshot {
  h.reset();
  h.debug.setScreen("playing");
  setSwitches(h, false);
  h.debug.clearEnemies();
  h.debug.clearProjectiles();
  h.debug.clearZones();
  h.debug.clearGems();
  h.debug.clearPickups();
  if (options.taper ?? false) {
    h.debug.setWeapon(0, "taper", 1);
  }
  if (options.level !== undefined) {
    h.debug.setLevel(options.level);
  }
  return h.snapshot();
}

/**
 * Compose a fresh run out of atomic poses, every switch as it stands: `reset`
 * to the idle run, `setScreen("playing")`, and Taper at level `1` in the first
 * weapon slot — the sequence `specs/instrumentation.md` names under
 * `setScreen` for arranging what `LIGHT THE LAMP` and `TRY AGAIN` begin.
 * `setWeapon` zeroes the slot's timer when its id changes, so the Taper this
 * leaves is the level `1` and cooldown `0` of `specs/ui.md`'s fresh run.
 *
 * For a check about the run the game PLAYS — the director, the first tick's
 * spawn — as opposed to a scenario posed into an isolated world. A check about
 * what STARTING a run does drives `LIGHT THE LAMP` or `TRY AGAIN` instead: the
 * surface begins no run, so nothing here stands in for that.
 */
export function freshRun(h: Harness): WickSnapshot {
  h.reset();
  h.debug.setScreen("playing");
  h.debug.setWeapon(0, "taper", 1);
  return h.snapshot();
}

/**
 * The idle run of `specs/state.md`, as the snapshot reports it: every stored
 * field at the value the table "The idle run" gives, and every derived field
 * (`specs/instrumentation.md`, "Snapshot shape") at what those values derive
 * to with no passive held. What `run` holds on `title`, `howto`, and
 * `almanac` as play reaches them, and what `reset` restores; a check compares
 * a whole run against it with `assertDeepEqual`.
 */
export const IDLE_RUN: SnapshotRun = {
  tick: 0,
  time: 0,
  level: 1,
  xp: 0,
  xpToNext: XP_BASE,
  kills: 0,
  player: { x: 0, y: 0, facing: "right", hp: BASE_MAX_HP },
  hurtFlash: 0,
  maxHp: BASE_MAX_HP,
  armor: 0,
  moveSpeed: MOVE_SPEED,
  pickupRadius: PICKUP_RADIUS,
  weapons: [],
  passives: [],
  enemies: [],
  projectiles: [],
  zones: [],
  gems: [],
  pickups: [],
  offers: [],
  pool: [],
  nextOffers: null,
  pendingLevelUps: 0,
  chestResult: null,
  spawnTimer: 0,
  spawnWindow: 0,
  firedEvents: [],
  aliveCommons: 0,
  nextId: 0,
  nextSpawnAngle: null,
  nextSwarmAngle: null,
  nextSpawnType: null,
  nextPuddleOffset: null,
  nextStrikeTarget: null,
  nextChestItem: null,
  nextDrop: null,
};

/**
 * A fresh run's loadout: "the idle run with Taper at level `1` and cooldown
 * `0` in the first weapon slot" (`specs/state.md`, `specs/ui.md`).
 */
export const FRESH_WEAPONS: readonly SnapshotWeapon[] = [
  { id: "taper", level: 1, cooldown: 0 },
];

/**
 * Reach the `playing` screen the way a player does: reset to the title and
 * confirm LIGHT THE LAMP with a real key.
 *
 * The REAL path, for the checks that are about the flow into play; a check
 * about anything else poses its screen with {@link poseScreen},
 * {@link freshRun}, or {@link isolate} and never touches a menu — a build with
 * a broken title and a working tick must fail the navigation points and pass
 * the others. The frame the press runs consumes the run's first tick.
 */
export async function startPlay(h: Harness): Promise<WickSnapshot> {
  h.reset();
  // Entry 0 of the title menu is LIGHT THE LAMP (specs/ui.md), highlighted on
  // entry, and Enter carries `confirm` (specs/controls.md).
  return tap(h, "Enter");
}

/**
 * Pose screen `screen` through the surface and read what it left.
 *
 * A thin name over `debug.setScreen`, which sets `screen` and the three menu
 * indices and nothing else (`specs/instrumentation.md`), so a suite says which
 * screen it is posing; it deliberately does NOT reset first, so a check can
 * arrange a run and then pose the screen that shows it. A check that wants a
 * clean slate calls `h.reset()` first or uses {@link isolate}. A check about
 * what a REAL transition does drives the transition instead.
 */
export function poseScreen(h: Harness, screen: Screen): WickSnapshot {
  h.debug.setScreen(screen);
  return h.snapshot();
}

/**
 * Open the level-up overlay the way a gain does: pose `count` level-ups
 * pending and run the one `playing` tick that opens the overlay at its end
 * (`specs/progression.md`). Read on return: `screen` is `levelup` with the
 * pool computed and the offers drawn, or the build failed to open it.
 */
export async function openLevelUp(
  h: Harness,
  count = 1,
): Promise<WickSnapshot> {
  h.debug.setPendingLevelUps(count);
  return advanceTicks(h, 1);
}

/**
 * Open the chest overlay the way a chest does: pose a chest pickup at the
 * lamplighter's center and run the one tick that collects it, applies its
 * result, and ends on `chest` (`specs/progression.md`). The result is decided
 * by the loadout as the check posed it before calling this.
 */
export async function openChest(h: Harness): Promise<WickSnapshot> {
  const { player } = h.snapshot().run;
  h.debug.spawnPickup("chest", player.x, player.y);
  return advanceTicks(h, 1);
}

/**
 * End the run fallen through the ending rule: `hp` posed to `0` and one tick,
 * which `specs/world.md` ends at the end of that tick.
 */
export async function endFallen(h: Harness): Promise<WickSnapshot> {
  h.debug.setHp(0);
  return advanceTicks(h, 1);
}

/**
 * End the run at dawn through the ending rule: the clock posed to the last
 * tick and one more, on which the run clock reaches `DAWN_TIME`.
 */
export async function endDawn(h: Harness): Promise<WickSnapshot> {
  h.debug.setTick(LAST_TICK);
  return advanceTicks(h, 1);
}

/* ---- The loadout -------------------------------------------------------- */
//
// `weapons` and `passives` stay contiguous (`specs/instrumentation.md`), so
// the first free slot of a kind is that list's length, and a placement there
// appends. The helpers answer the slot they filled so a check can address it
// with `setWeaponCooldown` and `removeWeapon` afterwards.

/** Put weapon `id` at `level` in the first free weapon slot; the slot it took. */
export function holdWeapon(h: Harness, id: WeaponId, level = 1): number {
  const slot = h.snapshot().run.weapons.length;
  h.debug.setWeapon(slot, id, level);
  return slot;
}

/** Put passive `id` at `level` in the first free passive slot; the slot it took. */
export function holdPassive(h: Harness, id: PassiveId, level = 1): number {
  const slot = h.snapshot().run.passives.length;
  h.debug.setPassive(slot, id, level);
  return slot;
}

/**
 * Make the weapon in `slot` fire on the next `playing` tick: its timer posed
 * to `0` and `weaponFire` on. "`setWeaponCooldown(slot, 0)` makes that the
 * next tick" (`specs/instrumentation.md`).
 */
export function armWeapon(h: Harness, slot: number): void {
  h.debug.setWeaponCooldown(slot, 0);
  h.debug.setWeaponFire(true);
}

/* ---- Placing entities, and finding them again --------------------------- */
//
// A pose that creates an entity gives it the next id from `nextId`
// (`specs/instrumentation.md`), so the id a placement will take is read off
// the snapshot before the call and handed back, and a check addresses the
// entity by it from then on.

/** Spawn one enemy through the real spawn path, answering the id it took. */
export function placeEnemy(
  h: Harness,
  type: EnemyId,
  x: number,
  y: number,
): number {
  const id = h.snapshot().run.nextId;
  h.debug.spawnEnemy(type, x, y);
  return id;
}

/** Spawn one enemy of `type` at `(dx, dy)` from the lamplighter's center; its id. */
export function placeEnemyNear(
  h: Harness,
  type: EnemyId,
  dx: number,
  dy: number,
): number {
  const { player } = h.snapshot().run;
  return placeEnemy(h, type, player.x + dx, player.y + dy);
}

/** Place one unattracted gem, answering the id it took. */
export function placeGem(
  h: Harness,
  tier: GemTier,
  x: number,
  y: number,
): number {
  const id = h.snapshot().run.nextId;
  h.debug.spawnGem(tier, x, y);
  return id;
}

/** Place one pickup, answering the id it took. */
export function placePickup(
  h: Harness,
  kind: PickupKind,
  x: number,
  y: number,
): number {
  const id = h.snapshot().run.nextId;
  h.debug.spawnPickup(kind, x, y);
  return id;
}

/** Add one projectile with the figures its weapon would give it, answering its id. */
export function placeProjectile(
  h: Harness,
  weapon: ProjectileWeapon,
  x: number,
  y: number,
  vx: number,
  vy: number,
  pierce: number,
): number {
  const id = h.snapshot().run.nextId;
  h.debug.spawnProjectile(weapon, x, y, vx, vy, pierce);
  return id;
}

/** Add one puddle with the figures its weapon would give it, answering its id. */
export function placePuddle(
  h: Harness,
  weapon: PuddleWeapon,
  x: number,
  y: number,
): number {
  const id = h.snapshot().run.nextId;
  h.debug.spawnPuddle(weapon, x, y);
  return id;
}

/** The enemy with id `id`, or `undefined` once it is gone. */
export function enemyById(
  s: WickSnapshot,
  id: number,
): SnapshotEnemy | undefined {
  return s.run.enemies.find((enemy) => enemy.id === id);
}

/** The projectile with id `id`, or `undefined` once it is gone. */
export function projectileById(
  s: WickSnapshot,
  id: number,
): SnapshotProjectile | undefined {
  return s.run.projectiles.find((projectile) => projectile.id === id);
}

/** The zone with id `id`, or `undefined` once it is gone. */
export function zoneById(
  s: WickSnapshot,
  id: number,
): SnapshotZone | undefined {
  return s.run.zones.find((zone) => zone.id === id);
}

/** The gem with id `id`, or `undefined` once it is collected. */
export function gemById(s: WickSnapshot, id: number): SnapshotGem | undefined {
  return s.run.gems.find((gem) => gem.id === id);
}

/** The pickup with id `id`, or `undefined` once it is collected. */
export function pickupById(
  s: WickSnapshot,
  id: number,
): SnapshotPickup | undefined {
  return s.run.pickups.find((pickup) => pickup.id === id);
}

/** Every zone of `kind`, in id order. */
export function zonesOfKind(s: WickSnapshot, kind: ZoneKind): SnapshotZone[] {
  return s.run.zones.filter((zone) => zone.kind === kind);
}

/**
 * The zones `after` holds that did not exist when `before` was read.
 *
 * Every entity a tick or a pose creates takes the next id from `nextId`
 * (`specs/instrumentation.md`), so a zone whose id is at least the `nextId`
 * `before` reported was created since — which is how a check reads what one
 * tick fired, telling a fresh slash from one a previous tick left.
 */
export function zonesCreatedSince(
  before: WickSnapshot,
  after: WickSnapshot,
): SnapshotZone[] {
  return after.run.zones.filter((zone) => zone.id >= before.run.nextId);
}

/** The projectiles `after` holds that did not exist when `before` was read. */
export function projectilesCreatedSince(
  before: WickSnapshot,
  after: WickSnapshot,
): SnapshotProjectile[] {
  return after.run.projectiles.filter(
    (projectile) => projectile.id >= before.run.nextId,
  );
}

/** Every zone `weapon` produced, in id order. */
export function zonesOf(s: WickSnapshot, weapon: string): SnapshotZone[] {
  return s.run.zones.filter((zone) => zone.weapon === weapon);
}

/** Every projectile `weapon` produced, in id order. */
export function projectilesOf(
  s: WickSnapshot,
  weapon: string,
): SnapshotProjectile[] {
  return s.run.projectiles.filter((projectile) => projectile.weapon === weapon);
}

/** The slot holding weapon `id`, or `undefined` when it is not held. */
export function heldWeapon(
  s: WickSnapshot,
  id: string,
): SnapshotWeapon | undefined {
  return s.run.weapons.find((weapon) => weapon.id === id);
}

/** The index of the slot holding weapon `id`, or `-1`. */
export function weaponSlotOf(s: WickSnapshot, id: string): number {
  return s.run.weapons.findIndex((weapon) => weapon.id === id);
}

/** The slot holding passive `id`, or `undefined` when it is not held. */
export function heldPassive(
  s: WickSnapshot,
  id: string,
): SnapshotPassive | undefined {
  return s.run.passives.find((passive) => passive.id === id);
}

/** The index of the slot holding passive `id`, or `-1`. */
export function passiveSlotOf(s: WickSnapshot, id: string): number {
  return s.run.passives.findIndex((passive) => passive.id === id);
}

/** The level of passive `id` as held: `0` when it is not, as every formula reads it. */
export function passiveLevel(s: WickSnapshot, id: string): number {
  return heldPassive(s, id)?.level ?? 0;
}

/* ---- Geometry, as the specification fixes it ---------------------------- */

export interface Point {
  x: number;
  y: number;
}

/** Euclidean distance between two centers. */
export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** The unit vector of `(x, y)`; the zero vector answers itself. */
export function unit(x: number, y: number): Point {
  const length = Math.hypot(x, y);
  return length === 0 ? { x: 0, y: 0 } : { x: x / length, y: y / length };
}

/**
 * The point `dist` from `from` at `angleDeg`: `0` along `+x`, positive angles
 * turning toward `+y`, which is clockwise on screen (`specs/weapons.md`).
 */
export function pointAt(from: Point, angleDeg: number, dist: number): Point {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: from.x + dist * Math.cos(rad), y: from.y + dist * Math.sin(rad) };
}

/** The angle of `(x, y)` in degrees, in `[0, 360)`, under the same convention. */
export function angleOf(x: number, y: number): number {
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
}

/** The wrap-aware signed offset from `fromDeg` to `toDeg`, in `[-180, 180)`. */
export function angularOffset(fromDeg: number, toDeg: number): number {
  return ((((toDeg - fromDeg + 180) % 360) + 360) % 360) - 180;
}

/* -------------------------------------------------------------------------- */
/* Reading an action for oneself                                              */
/* -------------------------------------------------------------------------- */

/**
 * A player controller of the check's own, which reads the frame's actions and
 * does nothing with them.
 *
 * Input reaches the simulation through `PlayerController.input` alone, and
 * each player controller consumes edges INDEPENDENTLY — so a check that
 * reached into `h.world.players()[0].input` would eat the copy the BUILD's
 * own controller was about to read. The observer is built from the engine's
 * own base class, whose `tick` does nothing, so nothing is acted on twice.
 * Read it BETWEEN the press and the frame that delivers it:
 *
 * ```ts
 * const observer = addObserver(h);
 * h.holdKey("KeyP");
 * const seen = observer.input.pressed("pause"); // the observer's own copy
 * await h.advance(1);                           // the build reads its copy
 * h.releaseKey("KeyP");
 * ```
 */
export function addObserver(h: Harness): PlayerController {
  return h.world.mode.addPlayer({
    name: "observer",
    // Possessing nothing, so nothing is spawned into the world the check posed.
    pawn: null,
    controller: PlayerController,
  });
}

/* -------------------------------------------------------------------------- */
/* Cues                                                                       */
/* -------------------------------------------------------------------------- */
//
// The build declares each cue by name and plays it by name, and the engine
// announces every play on its bus — so what a check reads is WHICH cue
// sounded, without a decoder. Audio belongs to the ticks
// (`specs/instrumentation.md`): a pose sounds nothing, so what a collector
// holds is exactly what the driven ticks caused.

/**
 * Record every cue the build plays from this call onward.
 *
 * A live array the harness pushes into: a check opens the collector after its
 * arrangement and reads it after the drive it is about, and what it holds is
 * exactly the cues that sounded during that drive and none of the ones that
 * sounded while the scene was being posed.
 */
export function onCue(h: Harness): TimedCue[] {
  const played: TimedCue[] = [];
  cueSinks.get(h)?.push(played);
  return played;
}

/** Every recorded play of the cue `name`, in the order they sounded. */
export function cuesNamed(cues: readonly TimedCue[], name: string): TimedCue[] {
  return cues.filter((cue) => cue.name === name);
}

/** Every recorded play that fell on frame `frame` of the drive. */
export function cuesOnFrame(
  cues: readonly TimedCue[],
  frame: number,
): TimedCue[] {
  return cues.filter((cue) => cue.frame === frame);
}

/* -------------------------------------------------------------------------- */
/* Reading one frame's render                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The destination rectangle of a `drawImage` call, in the space it was issued
 * in, or `null` for a call whose arguments are not one of the three forms. A
 * two-argument placement takes its size from the source.
 */
function destinationOf(args: unknown[]): {
  x: number;
  y: number;
  w: number;
  h: number;
} | null {
  const source = args[0];
  const numbers = args.slice(1);
  if (!numbers.every((value) => typeof value === "number")) return null;
  const at = numbers as number[];
  if (at.length === 8) return { x: at[4], y: at[5], w: at[6], h: at[7] };
  if (at.length === 4) return { x: at[0], y: at[1], w: at[2], h: at[3] };
  if (at.length === 2) {
    const size = source as { width?: unknown; height?: unknown } | null;
    const w = typeof size?.width === "number" ? size.width : 0;
    const h = typeof size?.height === "number" ? size.height : 0;
    return { x: at[0], y: at[1], w, h };
  }
  return null;
}

/**
 * Every bitmap the recorded calls blitted, as axis-aligned boxes in device
 * pixels: the four corners of each destination rectangle are mapped through
 * the transform in force at the call and the box is taken around them.
 *
 * THE FRAME IS WALKED, CARRYING THE TRANSFORM AND THE SMOOTHING FLAG. Both are
 * ordinary context state: `save`/`restore` stack them together, this engine's
 * own frame preparation issues the letterbox fit and the camera as
 * `setTransform` calls the recorder sees, its scene sets
 * `imageSmoothingEnabled` where it means to, and the build's renderer draws each
 * sprite under a `translate` and a `scale` inside a `save`. Nothing in the
 * engine calls `ctx.reset()`. So the state in force at a call is recovered
 * exactly by replaying the operations the frame issued, and nothing here has to
 * ask the context a question the record cannot answer.
 *
 * `smoothing` is the flag in force AT THE CALL, which is why the walk starts
 * from the value in force when the FRAME OPENED rather than from the canvas's
 * own default: the flag is context state that survives every frame boundary, so
 * a build that set it once when it started is drawing every later frame under a
 * value no operation in that frame carries. That opening value comes off
 * {@link openedUnder}, which the harness fills from the real context in the
 * moment before it runs each frame — and it is what
 * `presentation/pixel-art-sampled-nearest` is decided on. `smoothingAtOpen`
 * overrides it, for a caller reading a log this harness did not hand out.
 */
export function blitsOf(
  calls: readonly DrawCall[],
  smoothingAtOpen?: boolean,
): Blit[] {
  const atOpen = smoothingAtOpen ?? openOf(calls).smoothing;
  const blits: Blit[] = [];
  const stack: { matrix: Matrix; smoothing: boolean }[] = [];
  let matrix: Matrix = IDENTITY;
  let smoothing = atOpen;

  for (const call of calls) {
    if (call.kind === "set") {
      if (call.property === "imageSmoothingEnabled") {
        smoothing = call.value !== false;
      }
      continue;
    }
    const { method, args } = call;
    if (method === "save") {
      stack.push({ matrix, smoothing });
      continue;
    }
    if (method === "restore") {
      const held = stack.pop();
      matrix = held?.matrix ?? IDENTITY;
      smoothing = held?.smoothing ?? atOpen;
      continue;
    }
    const moved = transformed(matrix, method, args);
    if (moved !== null) {
      matrix = moved;
      continue;
    }
    if (method !== "drawImage") continue;
    const box = destinationOf(args);
    if (box === null) continue;
    const corners = [
      apply(matrix, box.x, box.y),
      apply(matrix, box.x + box.w, box.y),
      apply(matrix, box.x, box.y + box.h),
      apply(matrix, box.x + box.w, box.y + box.h),
    ];
    const xs = corners.map((corner) => corner.x);
    const ys = corners.map((corner) => corner.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const [a, b, c, d] = matrix;
    blits.push({
      id: sourceId(args[0]),
      x,
      y,
      w: Math.max(...xs) - x,
      h: Math.max(...ys) - y,
      smoothing,
      mirrored: a * d - b * c < 0,
      transform: matrix,
    });
  }
  return blits;
}
/** Where a blit's center landed, in device pixels. */
export function blitCenter(blit: Blit): { x: number; y: number } {
  return { x: blit.x + blit.w / 2, y: blit.y + blit.h / 2 };
}

/**
 * Every blit whose center landed within `tolerance` device pixels of the
 * WORLD point `(x, y)` — how a sprite is attributed to the object it was
 * drawn on, since `specs/assets.md` centers each sprite on its object.
 */
export function blitsNear(
  h: Harness,
  blits: readonly Blit[],
  x: number,
  y: number,
  tolerance: number,
): Blit[] {
  const at = h.device(x, y);
  return blits.filter((blit) => {
    const center = blitCenter(blit);
    return Math.hypot(center.x - at.x, center.y - at.y) <= tolerance;
  });
}

/** Every blit whose center landed within `tolerance` device pixels of the STAGE point. */
export function blitsNearStage(
  h: Harness,
  blits: readonly Blit[],
  x: number,
  y: number,
  tolerance: number,
): Blit[] {
  const at = h.stageDevice(x, y);
  return blits.filter((blit) => {
    const center = blitCenter(blit);
    return Math.hypot(center.x - at.x, center.y - at.y) <= tolerance;
  });
}

/** Every blit whose bytes were served from the produced file `path` under `assets/`. */
export function blitsFrom(blits: readonly Blit[], path: string): Blit[] {
  const id = `${ASSET_ROOT}/${path}`;
  return blits.filter((blit) => blit.id === id);
}

/**
 * The produced file painted nearest to and within `tolerance` device pixels
 * of the WORLD point `(x, y)`, or `null` when no blit landed there. The LAST
 * such blit, because that is the one a player sees.
 */
export function spriteNear(
  h: Harness,
  blits: readonly Blit[],
  x: number,
  y: number,
  tolerance: number,
): string | null {
  const found = blitsNear(h, blits, x, y, tolerance);
  return found.length === 0 ? null : found[found.length - 1].id;
}

/**
 * Whether the frame drew `text` as part of some run of text, ignoring case.
 * Substring on purpose: the copy a check asserts is the case's own, but how a
 * build presents it — a selection marker, padding — is the build's.
 *
 * A NAME THE SHARED HARNESS ALSO CARRIES, FOR A DIFFERENT QUESTION. Its
 * `drewText` spells the frame into merged LOGICAL RUNS first, so a heading drawn
 * a glyph per `fillText` reads as the word it spells; this one asks whether some
 * RAW call contains the copy. Binding the shared one would widen what every
 * `screens` point in this project accepts, so this stays the case's — and
 * `drawnText`, which both agree on exactly, is the shared one.
 */
export function drewText(calls: readonly DrawCall[], text: string): boolean {
  const wanted = text.trim().toLowerCase();
  return drawnText(calls).some((drawn) => drawn.toLowerCase().includes(wanted));
}

/**
 * The separators a build may set between the digit triples of a figure.
 *
 * `Number.prototype.toLocaleString` groups by default, so a build showing a
 * kill count of `1234` is free to write it `1,234`; the specification fixes the
 * figure and leaves how it is written to the build. ASCII space is not among
 * them: a frame's runs are read as separate strings and a build sets its own
 * spacing within one, so accepting it would read the two figures of `40 130` as
 * the single figure `40130`.
 */
const GROUP_SEPARATORS = [",", "'", "\u00A0", "\u202F", "\u2009"];

/**
 * Every way a build may write `value`: the value itself, and, where its whole
 * part runs past three digits, the same digits with each separator a build may
 * group them by. A figure of three digits or fewer is written one way, so `48`
 * stays `48`, and anything that is not a number is left as it stands.
 */
function spellings(value: string): string[] {
  const parsed = /^(-?)(\d{4,})(\.\d+)?$/.exec(value);
  if (parsed === null) return [value];
  const [, sign, whole, fraction = ""] = parsed;
  const grouped = GROUP_SEPARATORS.map((separator) => {
    const triples: string[] = [];
    for (let at = whole.length; at > 0; at -= 3) {
      triples.unshift(whole.slice(Math.max(0, at - 3), at));
    }
    return `${sign}${triples.join(separator)}${fraction}`;
  });
  return [value, ...grouped];
}

/**
 * Whether `value` appears in `lines` as its own token: a digit run matches
 * whole (`48` is found in `48 / 100` and not in `348`), and a word matches
 * case-insensitively. How a figure the HUD shows (a level, a kill count, the
 * clock) is found among the strings a frame drew, whatever the build put
 * around it. A figure is looked for as any of its {@link spellings}, so a build
 * that groups a figure's digits shows the same figure; the bound either side is
 * unchanged, so `50` is still not found in `150`.
 */
export function hasToken(lines: readonly string[], value: string): boolean {
  return spellings(value).some((written) => {
    const escaped = written.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(?<![\\w])${escaped}(?![\\w])`, "i");
    return lines.some((line) => pattern.test(line));
  });
}

/** One run of text a frame drew, and where it drew it in device pixels. */
export interface TextDraw {
  text: string;
  /** The anchor the run was drawn at, mapped through the transform in force. */
  x: number;
  y: number;
  /** The run's measured width under the font in force, in the call's space. */
  width: number;
  /** The alignment that places the run about its anchor. */
  textAlign: string;
  /**
   * The pixel size of the font in force, in the call's space, or `0` where the
   * shorthand named no pixel size. The height a run of glyphs stands off its
   * baseline is under this figure, so it is the slack a reading that has only
   * the anchor to go on can allow either side of the glyphs.
   */
  fontSize: number;
}

/** The pixel size a CSS font shorthand names, or `0` where it names none. */
function fontSizeOf(font: string | undefined): number {
  const px = /(\d*\.?\d+)px/.exec(font ?? "");
  return px === null ? 0 : Number(px[1]);
}

/**
 * Every run of text the frame drew, with its anchor in device pixels.
 *
 * THE ANCHOR, THE WIDTH AND THE ALIGNMENT ARE THE RECORDER'S; THE FONT IS THE
 * WALK'S. The shared recorder is asked for `measureText`, so it takes the
 * transform in force, the run's measured width under the font in force, and the
 * alignment, AT the call — which is exact under any pipeline, including a
 * `setTransform` the engine's own fit issues. It records no font, so the CSS
 * font shorthand in force is carried by the same walk {@link blitsOf} uses,
 * over the `font` sets the frame issued and through `save`/`restore`, starting
 * from the font the frame OPENED under ({@link openedUnder}) rather than from
 * the canvas's own default — a build that set its font in one frame and drew
 * under it in the next is drawing under a value this frame's log does not
 * carry. A call the measurement never reached — one a build made before this
 * project asked to measure — stands as the point its anchor names, with a width
 * of `0` and the default alignment.
 *
 * ONE ENTRY PER CALL, deliberately, and NOT the shared `textDraws`: that one
 * answers `{ text, x, y, left, right, align }` over merged logical runs, and
 * `hud/readouts.ts` and `instrumentation/rects.ts` read this shape's `width`,
 * `textAlign` and `fontSize` directly. Two different readings under one name is
 * exactly the drift that must not be folded, so this stays the case's.
 */
export function textDraws(calls: readonly DrawCall[]): TextDraw[] {
  const atOpen = openOf(calls).font;
  const draws: TextDraw[] = [];
  const stack: { matrix: Matrix; font: string }[] = [];
  let matrix: Matrix = IDENTITY;
  let font = atOpen;

  for (const call of calls) {
    if (call.kind === "set") {
      if (call.property === "font" && typeof call.value === "string") {
        font = call.value;
      }
      continue;
    }
    const { method, args } = call;
    if (method === "save") {
      stack.push({ matrix, font });
      continue;
    }
    if (method === "restore") {
      const held = stack.pop();
      matrix = held?.matrix ?? IDENTITY;
      font = held?.font ?? atOpen;
      continue;
    }
    const moved = transformed(matrix, method, args);
    if (moved !== null) {
      matrix = moved;
      continue;
    }
    if (method !== "fillText" && method !== "strokeText") continue;
    const [text] = args;
    const at = numbers(args.slice(1), 2);
    if (typeof text !== "string" || at === null) continue;
    // The transform the recorder took at the call, when it took one, and
    // otherwise the one this walk has carried to here.
    const placed = call.text?.transform ?? matrix;
    const anchor = apply(placed, at[0], at[1]);
    draws.push({
      text,
      x: anchor.x,
      y: anchor.y,
      width: call.text?.width ?? 0,
      textAlign: call.text?.textAlign ?? DEFAULT_TEXT_ALIGN,
      fontSize: fontSizeOf(font),
    });
  }
  return draws;
}
/* -------------------------------------------------------------------------- */
/* Colour and pixels                                                          */
/* -------------------------------------------------------------------------- */

/** The colour rendered at the WORLD point `(x, y)`. */
export function sampleAt(h: Harness, x: number, y: number): Rgb {
  const [r, g, b] = h.pixel(x, y);
  return { r, g, b };
}

/** The colour rendered at the STAGE point `(x, y)`. */
export function sampleStage(h: Harness, x: number, y: number): Rgb {
  const [r, g, b] = h.stagePixel(x, y);
  return { r, g, b };
}

/**
 * How many pixels of two same-sized rectangles differ in any channel by more
 * than `eps`.
 *
 * A NAME THE SHARED HARNESS ALSO CARRIES, AT A DIFFERENT DEFAULT. Its
 * `pixelsDiffering` allows `8` per channel before it counts a pixel; this one
 * allows NOTHING unless a caller says otherwise, and every suite here calls it
 * with two arguments. Binding the shared one would silently loosen every
 * frame-against-frame comparison in this project, so this stays the case's.
 */
export function pixelsDiffering(a: PixelRect, b: PixelRect, eps = 0): number {
  if (a.width !== b.width || a.height !== b.height) {
    return Math.max(a.width * a.height, b.width * b.height);
  }
  let count = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (
      Math.abs(a.data[i] - b.data[i]) > eps ||
      Math.abs(a.data[i + 1] - b.data[i + 1]) > eps ||
      Math.abs(a.data[i + 2] - b.data[i + 2]) > eps ||
      Math.abs(a.data[i + 3] - b.data[i + 3]) > eps
    ) {
      count += 1;
    }
  }
  return count;
}

/** `rect` with its columns reversed: what a horizontal mirror of it looks like. */
export function mirroredRect(rect: PixelRect): PixelRect {
  const data = new Uint8ClampedArray(rect.data.length);
  for (let row = 0; row < rect.height; row += 1) {
    for (let col = 0; col < rect.width; col += 1) {
      const from = (row * rect.width + col) * 4;
      const to = (row * rect.width + (rect.width - 1 - col)) * 4;
      data[to] = rect.data[from];
      data[to + 1] = rect.data[from + 1];
      data[to + 2] = rect.data[from + 2];
      data[to + 3] = rect.data[from + 3];
    }
  }
  return { width: rect.width, height: rect.height, data };
}

/* -------------------------------------------------------------------------- */
/* The produced files                                                         */
/* -------------------------------------------------------------------------- */
//
// `specs/assets.md` fixes each produced file's path, canvas, and, for the two
// loops, its seam; those points are about FILES rather than about a frame, so
// they read the files where they live. A PNG is decoded by the canvas this
// project already runs the engine on, which reads every spelling of the
// container rather than the few a reader written here would; a `.wav` is
// read by the plain RIFF walk below, because the generation tools write
// linear PCM and nothing else, so every spelling they can emit is read.

/** The repository-relative path of a produced file, as an absolute path. */
export function producedFile(path: string): string {
  return join(WORKSPACE, path);
}

/** The bytes of a produced file, or `null` where the build shipped none. */
export function producedBytes(path: string): Buffer | null {
  try {
    return readFileSync(producedFile(path));
  } catch {
    return null;
  }
}

/** One produced image, decoded to straight-alpha RGBA. */
export interface DecodedImage {
  width: number;
  height: number;
  /** Four bytes a pixel, row-major from the top-left. */
  pixels: Uint8ClampedArray;
}

/**
 * Decode a produced PNG, or answer why it could not be: the file is missing,
 * or the bytes are not a picture this host decodes.
 */
export async function readPng(
  path: string,
): Promise<{ image: DecodedImage | null; reason: string | null }> {
  const bytes = producedBytes(path);
  if (bytes === null) return { image: null, reason: `no file at ${path}` };
  if (bytes.length === 0) return { image: null, reason: `${path} is empty` };
  let decoded: Image;
  try {
    decoded = await loadImage(bytes);
  } catch (error) {
    return { image: null, reason: `${path} does not decode: ${String(error)}` };
  }
  const width = decoded.width;
  const height = decoded.height;
  if (!(width > 0 && height > 0)) {
    return { image: null, reason: `${path} decodes to ${width} x ${height}` };
  }
  const scratch = createCanvas(width, height);
  const ctx = scratch.getContext("2d");
  ctx.drawImage(decoded, 0, 0);
  const { data } = ctx.getImageData(0, 0, width, height);
  return {
    image: { width, height, pixels: data as unknown as Uint8ClampedArray },
    reason: null,
  };
}

/** Whether two decoded images are the same picture, within `eps` per channel. */
export function imagesIdentical(
  a: DecodedImage,
  b: DecodedImage,
  eps = 0,
): boolean {
  if (a.width !== b.width || a.height !== b.height) return false;
  for (let i = 0; i < a.pixels.length; i += 1) {
    if (Math.abs(a.pixels[i] - b.pixels[i]) > eps) return false;
  }
  return true;
}

/** One decoded `.wav`: every channel's samples, normalized to `[-1, 1]`. */
export interface DecodedWav {
  sampleRate: number;
  channels: Float32Array[];
  /** Sample frames per channel. */
  frames: number;
  /** `frames / sampleRate`, in seconds. */
  duration: number;
}

/** What a RIFF/WAVE header states, before its samples are read. */
interface WavHeader {
  tag: number;
  channels: number;
  sampleRate: number;
  bits: number;
  dataStart: number;
  dataSize: number;
  frames: number;
  duration: number;
}

/** `WAVE_FORMAT_PCM`, `WAVE_FORMAT_IEEE_FLOAT`, and the extensible wrapper. */
const FORMAT_PCM = 0x0001;
const FORMAT_FLOAT = 0x0003;
const FORMAT_EXTENSIBLE = 0xfffe;

/**
 * Walk a RIFF/WAVE container's chunks for its format and its samples, or answer
 * `null` for a file that is not one this reader can make sense of.
 *
 * THIS READER IS LENIENT AND MUST STAY LENIENT, AND IT IS NOT THE SHARED
 * HARNESS'S. `@clockwyrks/case-harness`'s `decodeWavHeader` — and the
 * `silentAudioBuffer` built on it — THROW on a body that is not a readable
 * RIFF/WAVE. This one answers `null`, and {@link HeadlessAudioContext} turns
 * that into a buffer of zeroed figures rather than a rejection.
 *
 * THE DIFFERENCE IS THE WHOLE PROJECT. Under an engine `api.audio.load` binds a
 * cue name only once its file DECODES, so a rejected decode leaves the cue
 * undeclared — and the build's own `play` for that cue then throws from inside
 * its `update`, on every tick that would have sounded it. A build shipping ONE
 * malformed `.wav` would go from losing the single asset point about that file
 * to losing EVERY point in the project, for a strictness the browser this stands
 * in for does have and this harness has never had. The committed reference
 * carries no malformed file, so no verdict digest can see this: it is a
 * correctness decision about builds that are not the reference, and the only
 * defence is not to make the change.
 *
 * IT IS ALSO THE READER `readWav` NEEDS. The samples are decoded off this
 * header's `dataStart`, `bits` and `tag`, none of which the shared reader's
 * `WavHeader` carries, so one walk serves both the cue bus and the
 * produced-file points and there is nothing to keep in step.
 */
function wavHeader(bytes: Buffer): WavHeader | null {
  if (
    bytes.length < 12 ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WAVE"
  ) {
    return null;
  }
  let format: {
    tag: number;
    channels: number;
    sampleRate: number;
    bits: number;
    blockAlign: number;
  } | null = null;
  let data: { start: number; size: number } | null = null;
  let at = 12;
  while (at + 8 <= bytes.length) {
    const id = bytes.toString("ascii", at, at + 4);
    const size = bytes.readUInt32LE(at + 4);
    const start = at + 8;
    // Clamped, because a writer that streamed its output may have left the
    // declared size larger than what it actually wrote.
    const held = Math.min(size, bytes.length - start);
    if (id === "fmt " && held >= 16) {
      let tag = bytes.readUInt16LE(start);
      // The extensible wrapper carries the real tag as the first two bytes
      // of its subformat GUID, twenty-four bytes into the chunk.
      if (tag === FORMAT_EXTENSIBLE && held >= 40) {
        tag = bytes.readUInt16LE(start + 24);
      }
      format = {
        tag,
        channels: bytes.readUInt16LE(start + 2),
        sampleRate: bytes.readUInt32LE(start + 4),
        blockAlign: bytes.readUInt16LE(start + 12),
        bits: bytes.readUInt16LE(start + 14),
      };
    }
    if (id === "data") data = { start, size: held };
    at = start + size + (size % 2);
  }
  if (format === null || data === null) return null;
  if (format.channels < 1 || format.sampleRate < 1 || format.bits < 1) {
    return null;
  }
  const blockAlign =
    format.blockAlign > 0
      ? format.blockAlign
      : (format.bits / 8) * format.channels;
  const frames = Math.floor(data.size / blockAlign);
  return {
    tag: format.tag,
    channels: format.channels,
    sampleRate: format.sampleRate,
    bits: format.bits,
    dataStart: data.start,
    dataSize: data.size,
    frames,
    duration: frames / format.sampleRate,
  };
}

/**
 * Decode a produced `.wav`, or answer why it could not be: the file is
 * missing, is not a RIFF/WAVE container, or carries samples in an encoding
 * outside the linear PCM the generation tools write (integer at 8, 16, 24 or
 * 32 bits; IEEE float at 32 or 64).
 */
export function readWav(path: string): {
  wav: DecodedWav | null;
  reason: string | null;
} {
  const bytes = producedBytes(path);
  if (bytes === null) return { wav: null, reason: `no file at ${path}` };
  if (bytes.length === 0) return { wav: null, reason: `${path} is empty` };
  const header = wavHeader(bytes);
  if (header === null) {
    return { wav: null, reason: `${path} is not a readable RIFF/WAVE file` };
  }
  const { tag, bits, channels, frames, dataStart } = header;
  let read: ((offset: number) => number) | null = null;
  const width = bits / 8;
  if (tag === FORMAT_PCM) {
    if (bits === 8) read = (o) => (bytes.readUInt8(o) - 128) / 128;
    else if (bits === 16) read = (o) => bytes.readInt16LE(o) / 32768;
    else if (bits === 24) read = (o) => bytes.readIntLE(o, 3) / 8388608;
    else if (bits === 32) read = (o) => bytes.readInt32LE(o) / 2147483648;
  } else if (tag === FORMAT_FLOAT) {
    if (bits === 32) read = (o) => bytes.readFloatLE(o);
    else if (bits === 64) read = (o) => bytes.readDoubleLE(o);
  }
  if (read === null || !Number.isInteger(width)) {
    return {
      wav: null,
      reason:
        `${path} is a WAV, but its samples are format 0x${tag.toString(16)} ` +
        `at ${bits} bits, which is not one of the PCM encodings the ` +
        "generation tools write",
    };
  }
  const decoded = Array.from(
    { length: channels },
    () => new Float32Array(frames),
  );
  let at = dataStart;
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      decoded[channel][frame] = read(at);
      at += width;
    }
  }
  return {
    wav: {
      sampleRate: header.sampleRate,
      channels: decoded,
      frames,
      duration: header.duration,
    },
    reason: null,
  };
}

/** The largest absolute sample in any channel, on a full scale of `1`. */
export function wavPeak(wav: DecodedWav): number {
  let peak = 0;
  for (const channel of wav.channels) {
    for (let i = 0; i < channel.length; i += 1) {
      const level = Math.abs(channel[i]);
      if (level > peak) peak = level;
    }
  }
  return peak;
}

/** The largest `|last sample − first sample|` across the channels: the loop's seam. */
export function wavSeam(wav: DecodedWav): number {
  let seam = 0;
  for (const channel of wav.channels) {
    if (channel.length === 0) continue;
    const gap = Math.abs(channel[channel.length - 1] - channel[0]);
    if (gap > seam) seam = gap;
  }
  return seam;
}

/** Whether two decoded sounds carry the same samples. */
export function wavsIdentical(a: DecodedWav, b: DecodedWav): boolean {
  if (a.channels.length !== b.channels.length || a.frames !== b.frames) {
    return false;
  }
  for (let c = 0; c < a.channels.length; c += 1) {
    const left = a.channels[c];
    const right = b.channels[c];
    for (let i = 0; i < left.length; i += 1) {
      if (left[i] !== right[i]) return false;
    }
  }
  return true;
}
