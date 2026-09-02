// Wick — the shared validator harness. CASE-PROVIDED.
//
// Every check in this project is an ordinary vitest test that runs IN THE SAME
// PROCESS as the build. It imports the engine and the build's own
// `src/game.ts`, creates an engine over a canvas it owns and a clock it
// scripts, and steps the game with `engine.advance`. Nothing drives a browser,
// nothing polls, and no wall-clock time passes: a check asks for a number of
// frames and gets exactly that number, each worth exactly the delta it asked
// for.
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
// arranges the running game through the same systems play uses, the seven
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
// {@link readDebugSurface}.
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
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import {
  createCanvas,
  Image,
  loadImage,
  type Canvas,
  type SKRSContext2D,
} from "@napi-rs/canvas";
import { expect } from "vitest";
import {
  createEngine,
  PlayerController,
  type CapturedImage,
  type Clock,
  type DiagnosticReading,
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
} from "@test-cabinet/structured-2d";
import { BACKGROUND, game as build } from "../src/game";
import { fail } from "./assert";
import {
  ASSET_ROOT,
  BASE_MAX_HP,
  ISOLATE_LEVEL,
  LAST_TICK,
  LAYOUT,
  MOVE_SPEED,
  OVERLAY_TOGGLE_CODE,
  PICKUP_RADIUS,
  STAGE_H,
  STAGE_W,
  TICK_HZ,
  TICK_MS,
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
  WickSnapshot,
  ZoneKind,
};
export { REQUIRED_OPS, SWITCH_NAMES };

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

/* -------------------------------------------------------------------------- */
/* The clock                                                                  */
/* -------------------------------------------------------------------------- */
//
// One frame is one tick. `specs/instrumentation.md` states the pairing itself:
// "a scenario pairs a `ConstantClock` of `1000 / 60` milliseconds with
// `engine.advance`, so one frame on `playing` consumes exactly one tick, and a
// clock of any other length poses a partial frame". The delta each frame
// supplies is the very float the build's accumulator compares against and
// subtracts, so the arithmetic is exact frame after frame — which the harness
// self-test proves against the reference rather than assumes.

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

/** A 2D affine transform, in the canvas's `[a, b, c, d, e, f]` order. */
export type Matrix = [number, number, number, number, number, number];

/** Where a placed call was issued, read off the real context at the call. */
export interface CallGeometry {
  transform: Matrix;
  smoothing: boolean;
  width?: number;
  textAlign?: string;
}

/** One recorded operation on the 2D context, in the order the render made it. */
export type DrawCall =
  | { kind: "call"; method: string; args: unknown[]; at?: CallGeometry }
  | { kind: "set"; property: string; value: unknown };

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
// with no page, so the globals the loader and the cue bus reach for are stood
// up over the workspace's own `assets/` directory, once, for the life of the
// process: `fetch` over the files, `createImageBitmap` through this canvas
// library's decoder, `ImageBitmap` so the recorder knows a bitmap when it sees
// one, and an `AudioContext` that decodes nothing but remembers which produced
// file each buffer came from and which buffers were started — so a check reads
// which FILE a cue sounded from, and how many sources of a loop are running,
// without a speaker.

/**
 * The directory this harness sits in, which is the validator project's root.
 * Taken from this module's own URL so it names the same directory in both
 * layouts this file lives in: the case's own `validation/structured-2d/`, and
 * the `validation/` the runner stages that directory to in the build's tree.
 */
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

/** The build's workspace, which is where `assets/` and `src/` sit. */
export const WORKSPACE = resolve(PROJECT_ROOT, "..");

/** Matches a leading URI scheme, which names a location outside the workspace. */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** The produced file each served blob's bytes came from, by content digest. */
const servedPaths = new Map<string, string>();

/** The produced file each decoded bitmap came from. */
const bitmapPaths = new WeakMap<object, string>();

let hostServed = false;

/** The digest a served file and a decoded blob are matched on. */
function digest(bytes: Uint8Array): string {
  return createHash("sha1").update(bytes).digest("hex");
}

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

/**
 * Stand `fetch`, `createImageBitmap`, `ImageBitmap`, and `AudioContext` up
 * over the workspace, once. Idempotent and never undone. The `fetch` wrapper
 * delegates anything carrying a scheme or a leading slash to whatever `fetch`
 * was already there.
 */
function serveWorkspaceAssets(): void {
  if (hostServed) return;
  hostServed = true;
  const host = globalThis as unknown as Record<string, unknown>;
  const inherited = host.fetch as
    ((input: string, init?: unknown) => Promise<Response>) | undefined;

  host.fetch = async (input: unknown, init?: unknown): Promise<Response> => {
    const url = typeof input === "string" ? input : String(input);
    if (SCHEME.test(url) || url.startsWith("/")) {
      if (inherited === undefined) {
        throw new Error(`wick harness: this host cannot fetch ${url}`);
      }
      return inherited(url, init);
    }
    let bytes: Buffer;
    try {
      bytes = readFileSync(join(WORKSPACE, url));
    } catch {
      // The shape the engine's loader reads as "that file is missing".
      return new Response(null, { status: 404, statusText: "Not Found" });
    }
    servedPaths.set(digest(bytes), url);
    return new Response(new Uint8Array(bytes));
  };

  host.createImageBitmap ??= async (blob: Blob): Promise<unknown> => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const image = await loadImage(Buffer.from(bytes));
    const path = servedPaths.get(digest(bytes));
    if (path !== undefined) bitmapPaths.set(image as object, path);
    return image;
  };

  // The engine's recorder decides what IS a bitmap by asking whether a value
  // is an instance of the host's own image classes, `ImageBitmap` among them.
  // Node has none, so without this every sprite records as an opaque and the
  // replay plays back with the produced art missing. `@napi-rs/canvas`'s
  // `Image` is literally what `createImageBitmap` above returns here, and
  // nothing in the engine or a build READS this global — to both of them
  // `ImageBitmap` is a type — so the game runs exactly as it does without it.
  host.ImageBitmap ??= Image;

  // Both the loader's decode and the bus's unlock ask the host for one.
  host.AudioContext ??= HeadlessAudioContext;
}

/**
 * The produced file a drawn source came from, or `""` for one this harness
 * never served — so a build that drew a canvas it painted itself is reported
 * as having drawn something other than the produced file rather than nothing.
 */
export function sourceId(source: unknown): string {
  if (source === null || typeof source !== "object") return "";
  return bitmapPaths.get(source) ?? "";
}

/* -------------------------------------------------------------------------- */
/* The harness                                                                */
/* -------------------------------------------------------------------------- */

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

/** A rectangle of the canvas read back as RGBA, four bytes a pixel, row-major. */
export interface PixelRect {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** A `KeyboardEvent`-shaped event's extra fields: the engine reads `code` and `repeat`. */
export interface KeyInit {
  repeat?: boolean;
  key?: string;
}

export interface Harness {
  readonly engine: Engine<WickDebugApi>;
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
  /** Every cue the build played since the harness opened, oldest first. */
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
  /**
   * `debug.reset`, with the seed spelled as a plain argument: the boot state,
   * on `title`, every switch on, the generator seeded with `seed`
   * (`DEFAULT_SEED` when omitted).
   */
  reset(seed?: number): void;
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

/** A key the case binds nothing to, whose press is the audio's gesture alone. */
const GESTURE_CODE = "F24";

/** A logical point's device pixel through the engine's fit. */
function fit(view: Viewport, x: number, y: number): { x: number; y: number } {
  return {
    x: Math.round(view.offsetX + x * view.scale),
    y: Math.round(view.offsetY + y * view.scale),
  };
}

/**
 * A world point's device pixel, through the world's camera and the engine's
 * fit. The camera follows the lamplighter (`specs/world.md`), so a world
 * point's stage position is `(wx − player.x + STAGE_CX, wy − player.y +
 * STAGE_CY)`; mapping through the camera reads that off the engine.
 */
function toDevice(
  world: World,
  view: Viewport,
  x: number,
  y: number,
): { x: number; y: number } {
  const logical = world.camera.worldToLogical({ x, y });
  return fit(view, logical.x, logical.y);
}

/** The methods whose position only means something once the transform applies. */
const PLACED_METHODS = ["drawImage", "fillText", "strokeText"];

/**
 * A proxy that records every call and property set on its way to the real
 * context, so one frame produces both a pixel buffer to sample and a call list
 * to inspect. The transform and smoothing flag are read off the real context
 * at the moment of a PLACED call, because the context is the authority on
 * where any transform the build drew under put it.
 *
 * Only the CURRENT frame's operations are held. The frame counter moves at the
 * top of every frame and the pipeline draws inside it, so an operation whose
 * frame number differs from the one before it opens a new bucket and drops the
 * one before that. A drive to dawn therefore costs one frame of operations
 * rather than thirty-six thousand.
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
        const method = String(property);
        const call: DrawCall = { kind: "call", method, args };
        if (PLACED_METHODS.includes(method)) {
          const m = object.getTransform();
          const at: CallGeometry = {
            transform: [m.a, m.b, m.c, m.d, m.e, m.f],
            smoothing: object.imageSmoothingEnabled,
          };
          if (method !== "drawImage" && typeof args[0] === "string") {
            at.width = object.measureText(args[0]).width;
            at.textAlign = object.textAlign;
          }
          call.at = at;
        }
        push(call);
        return (value as (...rest: unknown[]) => unknown).apply(object, args);
      };
    },
    set(object, property, value) {
      push({ kind: "set", property: String(property), value });
      return Reflect.set(object, property, value, object);
    },
  });
}

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
  const missing = REQUIRED_OPS.filter((op) => typeof target[op] !== "function");
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
  const missing = new Set<string>(
    REQUIRED_OPS.filter((op) => typeof target[op] !== "function"),
  );
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
 * Build an engine over a canvas of the harness's own, initialize the build's
 * game, give its audio the gesture that unlocks it, and hand back everything a
 * check reads.
 *
 * The options passed to the factory are the ones the seeded `src/main.ts`
 * passes — the 1280x720 design size, the build's exported `BACKGROUND`, image
 * smoothing off, and the `dpad-4` layout — plus the clock and the surface
 * metrics a headless run needs. So one harness serves every build of this
 * case, and everything else the build decided lives inside `src/game.ts`.
 * Nothing is reset here: the state the build BOOTS on is what a check reads
 * first, and {@link isolate} or {@link Harness.reset} is where a scenario
 * starts.
 */
export async function createHarness(
  options: HarnessOptions = {},
): Promise<Harness> {
  serveWorkspaceAssets();

  const cssWidth = options.cssWidth ?? STAGE_W;
  const cssHeight = options.cssHeight ?? STAGE_H;
  const dpr = options.dpr ?? 1;

  const canvas = createCanvas(
    Math.round(cssWidth * dpr),
    Math.round(cssHeight * dpr),
  );
  const ctx = canvas.getContext("2d");
  const bucket = { frame: -1, calls: [] as DrawCall[] };
  let engineRef: Engine<WickDebugApi> | null = null;
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

  const keys = new EventTarget();
  const surface: SurfaceMetrics = {
    cssWidth: () => cssWidth,
    cssHeight: () => cssHeight,
    dpr: () => dpr,
    events: () => keys,
  };

  const scripted =
    options.clock === undefined ? new ScriptedClock(options.stepMs) : null;
  const engine = createEngine<WickDebugApi>({
    canvas: element,
    width: STAGE_W,
    height: STAGE_H,
    game,
    // The build's own stage background, image smoothing off for its pixel art,
    // and the four-way layout, handed to the engine exactly as the seeded
    // `src/main.ts` hands them (specs/overview.md, specs/controls.md).
    background: BACKGROUND,
    imageSmoothing: false,
    layout: LAYOUT,
    clock: options.clock ?? (scripted as ScriptedClock),
    surface,
    ...(options.assetRoot === undefined
      ? {}
      : { assetRoot: options.assetRoot }),
  });
  engineRef = engine;

  // Subscribed BEFORE `initialize`, which is what makes the game's own loading
  // and its opening sounds observable: construction runs no game code.
  const assetFailures: AssetFailure[] = [];
  const assetLoads: string[] = [];
  const cues: TimedCue[] = [];
  const owner: SoundOwner = { pending: null, live: new Set() };
  engine.events.on("asset:failed", ({ path, reason }) => {
    assetFailures.push({ path, reason });
  });
  engine.events.on("asset:loaded", ({ path }) => {
    assetLoads.push(path);
  });
  const sinks: TimedCue[][] = [];
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
      owner.pending = timed;
      cues.push(timed);
      for (const sink of sinks) sink.push(timed);
    };
  engine.events.on("cue:played", noteCue(false));
  engine.events.on("cue:looped", noteCue(true));

  // The engine shares ONE audio context between its loader and its bus, built
  // by whichever asks first: a build that decodes its produced sounds in
  // `initialize` builds it there, and one that loads nothing builds it at the
  // unlocking gesture. The context reports to the harness that owned the
  // moment it was built, so this harness owns both moments.
  const owning = async <T>(act: () => Promise<T> | T): Promise<T> => {
    const previous = audioOwner;
    audioOwner = owner;
    try {
      return await act();
    } finally {
      audioOwner = previous;
    }
  };
  const instance = await owning(() => engine.initialize());
  const { debug, fault } = readDebugSurface(engine);

  const dispatch = (
    type: "keydown" | "keyup",
    code: string,
    init?: KeyInit,
  ): void => {
    keys.dispatchEvent(new KeyEvent(type, code, init));
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
    instance,
    debug,
    surfaceFault: fault,
    ctx,
    canvas,
    cues,
    assetFailures,
    assetLoads,

    looping: (name) => engine.world.audio.looping(name),
    liveLoops: () =>
      [...owner.live].map((source) => ({
        cue: source.cue,
        file: source.buffer?.file ?? "",
      })),

    frame: () => engine.frame().count,
    timeMs: () => engine.frame().timeMs,

    snapshot: () => debug.snapshot(),
    reset: (seed) => debug.reset(seed === undefined ? undefined : { seed }),

    advance: (frames) => engine.advance(frames),

    async frameOf(ms) {
      if (scripted === null) {
        throw new Error(
          "wick harness: frameOf needs the scripted clock; this harness was built with a clock of its own",
        );
      }
      scripted.queue(ms);
      await engine.advance(1);
      return debug.snapshot();
    },

    async tick(ticks = 1) {
      await engine.advance(ticks * FRAMES_PER_TICK);
      return debug.snapshot();
    },

    async until(predicate, untilOptions = {}) {
      const maxTicks = untilOptions.maxTicks ?? 600;
      let snapshot = debug.snapshot();
      if (predicate(snapshot)) return { hit: true, ticks: 0, snapshot };
      for (let ticks = 1; ticks <= maxTicks; ticks += 1) {
        await engine.advance(FRAMES_PER_TICK);
        snapshot = debug.snapshot();
        if (predicate(snapshot)) return { hit: true, ticks, snapshot };
      }
      return { hit: false, ticks: maxTicks, snapshot };
    },

    holdKey: (code, init) => dispatch("keydown", code, init),
    releaseKey: (code) => dispatch("keyup", code),

    lastCalls: () => [...bucket.calls],
    async frameDraw() {
      await engine.advance(1);
      const calls = [...bucket.calls];
      return { calls, blits: blitsOf(calls) };
    },
    async frameCalls() {
      await engine.advance(1);
      return [...bucket.calls];
    },
    async frameBlits() {
      await engine.advance(1);
      return blitsOf(bucket.calls);
    },

    viewport: () => engine.viewport(),
    device: (x, y) => toDevice(engine.world, engine.viewport(), x, y),
    stageDevice: (x, y) => fit(engine.viewport(), x, y),
    pixel: (x, y) => {
      const point = toDevice(engine.world, engine.viewport(), x, y);
      const { data } = ctx.getImageData(point.x, point.y, 1, 1);
      return [data[0], data[1], data[2], data[3]];
    },
    stagePixel: (x, y) => {
      const point = fit(engine.viewport(), x, y);
      const { data } = ctx.getImageData(point.x, point.y, 1, 1);
      return [data[0], data[1], data[2], data[3]];
    },
    pixelRect: (left, top, wide, high) => {
      const x = Math.min(Math.max(Math.round(left), 0), canvas.width);
      const y = Math.min(Math.max(Math.round(top), 0), canvas.height);
      const w = Math.max(1, Math.min(Math.round(wide), canvas.width - x));
      const h = Math.max(1, Math.min(Math.round(high), canvas.height - y));
      const pixels = ctx.getImageData(x, y, w, h);
      return {
        width: pixels.width,
        height: pixels.height,
        data: pixels.data as unknown as Uint8ClampedArray,
      };
    },

    diagnostics: () => engine.diagnostics(),

    armAudio,

    dispose: () => engine.destroy(),
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
};

/** Set one driver switch through its own operation. */
export function setSwitch(h: Harness, name: SwitchName, on: boolean): void {
  const setter = h.debug[SWITCH_OPS[name]] as (on: boolean) => void;
  setter(on);
}

/** Set all seven driver switches to `on`. */
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

/** The seven switches as the snapshot reports them, by name. */
export function switchesOf(s: WickSnapshot): Record<SwitchName, boolean> {
  return {
    spawning: s.spawning,
    events: s.events,
    despawning: s.despawning,
    enemyMotion: s.enemyMotion,
    enemyContact: s.enemyContact,
    weaponFire: s.weaponFire,
    effectMotion: s.effectMotion,
  };
}

export interface IsolateOptions {
  /** The seed `reset` lays the generator with. Defaults to `DEFAULT_SEED`. */
  seed?: number;
  /**
   * The level the run is posed at. Defaults to `ISOLATE_LEVEL` (50), whose
   * `xpToNext` of 495 keeps any gain a scenario's kills produce from opening
   * an overlay mid-scenario. A check that reads `level` poses its own.
   */
  level?: number;
  /**
   * Whether to leave the fresh run's Taper in its slot. Off by default, so a
   * check about another weapon sees no slash when it turns `weaponFire` on;
   * a check about Taper itself, or about the fresh run's loadout, keeps it.
   */
  keepTaper?: boolean;
}

/**
 * Pose an ISOLATED world: a fresh `playing` screen holding nothing — no
 * enemy, projectile, zone, gem, or pickup, no weapon and no passive — with
 * every driver switch off and the level at `ISOLATE_LEVEL`.
 *
 * The arrangement the authoring guide requires of a validator — clear every
 * entity the requirement is not about, then spawn back exactly what it IS
 * about through the surface's atomic poses. The switches are off so no
 * autonomous consequence (a director spawn, an event, a despawn, a move, a
 * contact hit, a weapon firing, an effect moving) arrives on top of the
 * behavior being watched; a check that is ABOUT one turns it back on with
 * {@link enable}. Taper, which every fresh run holds, is removed so no slash
 * appears when `weaponFire` is turned on for a check about another weapon.
 * The level is posed high enough that no gain a scenario's kills drop crosses
 * a threshold and opens an overlay mid-scenario; a check that reads `level`
 * poses its own.
 *
 * `reset` first, so nothing a previous section left is inherited, seeding the
 * generator with `seed` when one is named; then the fresh run
 * (`setScreen("playing")` begins one exactly as LIGHT THE LAMP does); then
 * the clears, which score nothing, draw nothing, and sound nothing.
 */
export function isolate(
  h: Harness,
  options: IsolateOptions = {},
): WickSnapshot {
  h.reset(options.seed);
  h.debug.setScreen("playing");
  setSwitches(h, false);
  if (!(options.keepTaper ?? false)) {
    const { weapons } = h.snapshot().run;
    for (let slot = weapons.length - 1; slot >= 0; slot -= 1) {
      h.debug.removeWeapon(slot);
    }
  }
  h.debug.clearEnemies();
  h.debug.clearProjectiles();
  h.debug.clearZones();
  h.debug.clearGems();
  h.debug.clearPickups();
  h.debug.setLevel(options.level ?? ISOLATE_LEVEL);
  return h.snapshot();
}

/**
 * Begin a fresh run through the surface, every switch as it stands and Taper
 * in the first slot: `reset` and `setScreen("playing")`, which `specs/ui.md`
 * makes the same run LIGHT THE LAMP begins. For a check about the run the
 * game plays — the director, the first tick's spawn, the fresh-run state — as
 * opposed to a scenario posed into an isolated world.
 */
export function freshRun(h: Harness, seed?: number): WickSnapshot {
  h.reset(seed);
  h.debug.setScreen("playing");
  return h.snapshot();
}

/**
 * The idle run of `specs/state.md`, as the snapshot reports it: every stored
 * field at the value the table "The idle run" gives, and every derived field
 * (`specs/instrumentation.md`, "Snapshot shape") at what those values derive
 * to with no passive held. What `run` holds on `title` and `howto`, and what
 * `reset` and `setScreen("title")` restore; a check compares a whole run
 * against it with `assertDeepEqual`.
 */
export const IDLE_RUN: SnapshotRun = {
  tick: 0,
  time: 0,
  level: 1,
  xp: 0,
  xpToNext: XP_BASE,
  kills: 0,
  player: { x: 0, y: 0, facing: "right", hp: BASE_MAX_HP },
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
export async function startPlay(
  h: Harness,
  seed?: number,
): Promise<WickSnapshot> {
  h.reset(seed);
  // Entry 0 of the title menu is LIGHT THE LAMP (specs/ui.md), highlighted on
  // entry, and Enter carries `confirm` (specs/controls.md).
  return tap(h, "Enter");
}

/**
 * Enter screen `screen` through the surface, exactly as the real transition
 * enters it, and read what it left.
 *
 * A thin name over `debug.setScreen` so a suite says which screen it is
 * posing; it deliberately does NOT reset first, so a check can arrange a run
 * and then pose the screen that shows it. A check that wants a clean slate
 * calls `h.reset()` first or uses {@link isolate}.
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

/** A point mapped through a transform. */
function through(m: Matrix, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

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
 */
export function blitsOf(calls: readonly DrawCall[]): Blit[] {
  const blits: Blit[] = [];
  for (const call of calls) {
    if (call.kind !== "call" || call.method !== "drawImage") continue;
    const at = call.at;
    if (at === undefined) continue;
    const box = destinationOf(call.args);
    if (box === null) continue;
    const corners = [
      through(at.transform, box.x, box.y),
      through(at.transform, box.x + box.w, box.y),
      through(at.transform, box.x, box.y + box.h),
      through(at.transform, box.x + box.w, box.y + box.h),
    ];
    const xs = corners.map((corner) => corner.x);
    const ys = corners.map((corner) => corner.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const [a, b, c, d] = at.transform;
    blits.push({
      id: sourceId(call.args[0]),
      x,
      y,
      w: Math.max(...xs) - x,
      h: Math.max(...ys) - y,
      smoothing: at.smoothing,
      mirrored: a * d - b * c < 0,
      transform: at.transform,
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

/** Every string the frame drew, through `fillText` or `strokeText`. */
export function drawnText(calls: readonly DrawCall[]): string[] {
  return [
    ...callsTo(calls, "fillText"),
    ...callsTo(calls, "strokeText"),
  ].flatMap((args) => (typeof args[0] === "string" ? [args[0]] : []));
}

/**
 * Whether the frame drew `text` as part of some run of text, ignoring case.
 * Substring on purpose: the copy a check asserts is the case's own, but how a
 * build presents it — a selection marker, padding — is the build's.
 */
export function drewText(calls: readonly DrawCall[], text: string): boolean {
  const wanted = text.trim().toLowerCase();
  return drawnText(calls).some((drawn) => drawn.toLowerCase().includes(wanted));
}

/**
 * Whether `value` appears in `lines` as its own token: a digit run matches
 * whole (`48` is found in `48 / 100` and not in `348`), and a word matches
 * case-insensitively. How a figure the HUD shows (a level, a kill count, the
 * clock) is found among the strings a frame drew, whatever the build put
 * around it.
 */
export function hasToken(lines: readonly string[], value: string): boolean {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?<![\\w])${escaped}(?![\\w])`, "i");
  return lines.some((line) => pattern.test(line));
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
}

/** Every run of text the frame drew, with its anchor in device pixels. */
export function textDraws(calls: readonly DrawCall[]): TextDraw[] {
  const draws: TextDraw[] = [];
  for (const call of calls) {
    if (call.kind !== "call" || call.at === undefined) continue;
    if (call.method !== "fillText" && call.method !== "strokeText") continue;
    const [text, x, y] = call.args;
    if (typeof text !== "string") continue;
    if (typeof x !== "number" || typeof y !== "number") continue;
    const anchor = through(call.at.transform, x, y);
    draws.push({
      text,
      x: anchor.x,
      y: anchor.y,
      width: call.at.width ?? 0,
      textAlign: call.at.textAlign ?? "start",
    });
  }
  return draws;
}

/**
 * The geometry calls a frame made, by name — enough of a count to compare two
 * frames of the same scene, whatever shape the build chose to draw with.
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

/* -------------------------------------------------------------------------- */
/* Colour and pixels                                                          */
/* -------------------------------------------------------------------------- */

/** A sampled colour, each channel 0–255. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Euclidean distance between two colours, 0 to about 441. */
export function colorDistance(a: Rgb, b: Rgb): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

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

/** How many pixels of two same-sized rectangles differ in any channel by more than `eps`. */
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

/** Walk a RIFF/WAVE container's chunks for its format and its samples. */
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

/* -------------------------------------------------------------------------- */
/* Evidence capture                                                           */
/* -------------------------------------------------------------------------- */
//
// A review item may declare a `replay` output beside its verdict: the frames
// the build itself drew while a check drove it, kept as evidence a reviewer
// can scrub against the reference's baseline. `captureReplay` records the
// SECTION, not the run — armed around the caller's scenario and disarmed the
// moment it returns — and it is evidence, never a verdict: the scenario's own
// value comes straight back, a scenario that throws still writes what it had
// recorded, and outside a run (no TCAB_VALIDATION_MEDIA_DIR) the whole thing
// is a no-op that still runs the scenario. A capture that closed no frames
// writes no file, so the run reports the output absent rather than offering a
// replay of nothing. An `image` output is the frame on the canvas, kept as a
// PNG by `captureStill`.

/** The environment variable the runner names the media directory in. */
const MEDIA_DIR_ENV = "TCAB_VALIDATION_MEDIA_DIR";

/**
 * The directory the runner stages this project to inside the build's tree. A
 * recording is addressed by the STAGED path of the suite that produced it —
 * `validation/<category>/<check>.test.ts` — the one name the case's manifest
 * and the runner already agree on, kept the same when this suite is run in
 * place against a reference implementation.
 */
const STAGED_PROJECT_DIR = "validation";

/**
 * The most frames a written recording holds. A recording is one JSON
 * operation log per frame, so a long section is THINNED to this many frames
 * rather than cut short — see {@link thinReplay}.
 */
const MAX_REPLAY_FRAMES = 300;

/**
 * Where the running suite's `outputId` output belongs, or `null` when nothing
 * is collecting media. The suite is the one vitest is currently running
 * rather than one the caller names, so a check cannot write its evidence
 * under another point's address. `extension` is `json.gz` for a recording,
 * `png` for a still.
 */
function mediaDestination(outputId: string, extension: string): string | null {
  const mediaDir = process.env[MEDIA_DIR_ENV];
  if (mediaDir === undefined || mediaDir === "") return null;
  const testPath = expect.getState().testPath;
  if (testPath === undefined) return null;
  const suite = relative(PROJECT_ROOT, testPath).split(sep).join("/");
  return join(mediaDir, STAGED_PROJECT_DIR, suite, `${outputId}.${extension}`);
}

/** A value's JSON with object keys in a fixed order, as a dedup key. */
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
 * Dropping a frame drops the last reference to whatever only that frame drew
 * with, so the tables in front of a thinned recording are rebuilt: every
 * entry here is reached from a kept frame, every reference inside one is
 * rewritten as it is reached, transitively, and what is deduplicated is the
 * rewritten entry. Exported for the harness self-test beside this file.
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
    // A recipe's arguments can only name entries interned before it, so
    // rewriting one terminates and cannot re-enter this resource.
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
      // Defined rather than assigned: a build's own object may carry a field
      // named `__proto__`, and assigning that name reaches the prototype
      // setter instead of writing a field the document carries.
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
      // A frame inherits the current path along with the clip: a canvas keeps
      // its path across a frame boundary, and applying a clip leaves the clip
      // outline current.
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
 * A recording of at most {@link MAX_REPLAY_FRAMES} frames, covering the whole
 * of what was captured.
 *
 * An over-long section is THINNED rather than cut short: every nth frame is
 * kept, so the reviewer sees the entire section at a lower frame rate. Each
 * kept frame's `deltaMs` is restated as the time since the frame kept before
 * it, so a player pacing itself off them runs at the speed the game ran at,
 * and the frame `count` is left as the host reported it so a reader can see
 * frames were skipped. The last frame is always kept — it is the frame the
 * check's sweep stopped at, and the one a reviewer looks at first.
 */
export function thinReplay(recording: Recording): Recording {
  const { frames } = recording;
  if (frames.length <= MAX_REPLAY_FRAMES) return recording;

  const stride = Math.ceil(frames.length / MAX_REPLAY_FRAMES);
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
      // The stride spent the whole budget short of the end: swap the final
      // strided frame for the last one, measured from the same moment.
      const displaced = kept[kept.length - 1];
      kept.length -= 1;
      previousMs = displaced.timeMs - displaced.deltaMs;
    }
    keep(last);
  }

  return retable(recording, kept);
}

/**
 * Write a recording out, reporting rather than raising anything that goes
 * wrong. A capture that closed no frames writes nothing; what lands on disk
 * is gzip (a JSON document stored gzipped, which is what the two extensions
 * say). Never throws: a directory that cannot be made says something about
 * the machine, and the runner already reads a declared output that never
 * turned up as exactly that.
 */
function writeReplay(destination: string, recording: Recording): void {
  if (recording.frames.length === 0) return;
  try {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, gzipSync(JSON.stringify(thinReplay(recording))));
  } catch (error) {
    console.warn(`wick: could not write ${destination}: ${String(error)}`);
  }
}

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
 */
export async function captureReplay<T>(
  h: Harness,
  outputId: string,
  act: () => T | Promise<T>,
): Promise<T> {
  const destination = mediaDestination(outputId, "json.gz");
  if (destination === null) return act();

  h.engine.startRecording();
  try {
    return await act();
  } finally {
    // In a `finally`, so a scenario that failed still leaves its evidence.
    writeReplay(destination, h.engine.stopRecording());
  }
}

/**
 * Keep the frame currently on the canvas as the review item's `outputId`
 * output — the companion to {@link captureReplay}, for a point whose evidence
 * is one PICTURE: which screen the game opened on, what it drew a gem as.
 *
 * What is written is whatever the last frame that RAN left behind, so call it
 * after the frame that poses the thing under test — a `frameDraw()` or an
 * `advance(1)` following the arrangement — and before the assertions, so a
 * check that fails still leaves the picture that shows why. Nothing here can
 * change a verdict.
 */
export function captureStill(h: Harness, outputId: string): void {
  const destination = mediaDestination(outputId, "png");
  if (destination === null) return;
  try {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, h.canvas.toBuffer("image/png"));
  } catch (error) {
    console.warn(`wick: could not write ${destination}: ${String(error)}`);
  }
}
