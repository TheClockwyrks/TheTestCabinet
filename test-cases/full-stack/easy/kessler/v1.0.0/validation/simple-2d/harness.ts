// Kessler — the shared validator harness. CASE-PROVIDED.
//
// Every check in this project is an ordinary vitest test that runs IN THE SAME
// PROCESS as the build. It imports the engine and the build's own `src/game.ts`,
// creates an engine over a canvas it owns and a `ConstantClock` of `1000 / 60`
// milliseconds, and steps the game with `engine.advance` — so ONE FRAME CONSUMES
// EXACTLY ONE TICK, which is the pairing `specs/instrumentation.md` itself
// prescribes for a scenario. Nothing drives a browser, nothing polls, and no
// wall-clock time passes.
//
// WHAT A CHECK READS. The game's own state (through the case's `snapshot`), the
// engine's frame counter, the cue events it broadcast, the draw calls the render
// issued, and the pixels those calls left on the canvas. Nothing here fabricates
// an outcome: the scenario helpers below only ARRANGE the world through the
// debug surface, and per the spec "no pose decides an outcome: every bounce,
// hit, destruction, catch, burn-up, life loss, and clearing comes from the ticks
// run after the pose".
//
// WHY THE DEBUG SURFACE RATHER THAN RAW ASSIGNMENT. `specs/instrumentation.md`
// fixes its operations, so they mean the same thing in every build; posing
// through it is how a scenario is reproducible, and it is the seam the case's
// specification documents. `surface.ts` is that specification as types, and it
// is the only description of the surface this harness reads: the build's own
// module for it is never imported.
//
// WHERE THE SURFACE COMES FROM. Off `engine.debug`, never built here. The
// build's `initialize` returns it beside the state, as `[state, debug]`, the
// engine holds the second element, and reading it back off the engine is the
// only way a surface reaches a check — so a build that returned no surface, or
// a surface missing an operation, fails the checks that reach the game through
// it. See {@link readDebugSurface}.
//
// HOW THE SURFACE IS DRIVEN. The engine holds the state by value and hands it
// out read-only, so the surface is pure: a pose takes the current state and
// returns the next, a reading takes the current state and returns what it read.
// A check still writes `h.debug.setScore(500)` and `h.debug.snapshot()`,
// because `h.debug` is a {@link Driver} over the raw surface: it runs each pose
// through `engine.apply` and hands each reading `engine.state`.
//
// WHAT THE HARNESS OWNS THAT THE SURFACE MUST NOT. The surface is ATOMIC by
// design — one field per operation — so every compound sequence lives here:
// {@link isolate} (the empty posed field with both driver switches off),
// {@link startPlay} (the real, key-pressed path into a session), and the polar
// spawn helpers a scenario stages contacts with.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
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
  ConstantClock,
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
  type Viewport,
} from "@clockwyrks/simple-2d";
import type { DeepReadonly } from "ts-essentials";
import { BACKGROUND, game as build, type KesslerState } from "../src/game";
import { fail } from "./assert";
import {
  STAGE_CX,
  STAGE_CY,
  STAGE_H,
  STAGE_W,
  TICK_HZ,
  WAVECLEAR_TICKS,
} from "./constants";
import {
  READINGS,
  type EffectKind,
  type KesslerDebugApi,
  type KesslerSnapshot,
  type MenuItemRect,
  type PodKind,
  type Screen,
} from "./surface";

export type { EffectKind, KesslerSnapshot, MenuItemRect, PodKind, Screen };

/** The case's surface, bound to the state type the build declared. */
export type KesslerSurface = KesslerDebugApi<KesslerState>;

/**
 * The build's game, typed against the surface the CASE specifies.
 *
 * The build declares its own type for the surface its `initialize` returns, and
 * that type is the build's: what a check holds it to is `surface.ts`, so the
 * game is cast to the case's `Game<KesslerState, KesslerSurface>` here and the
 * engine is parameterized with it. A surface that departs from the specification
 * is caught where a check reaches for the missing member, not by the build's
 * own compiler.
 */
const game = build as unknown as Game<KesslerState, KesslerSurface>;

/* -------------------------------------------------------------------------- */
/* The step schedule                                                          */
/* -------------------------------------------------------------------------- */
//
// One frame is one tick, on the spec's own advice: "a scenario pairs a
// ConstantClock of 1000 / 60 milliseconds with engine.advance, so one frame
// consumes exactly one tick" (specs/instrumentation.md). Every duration this
// case states is a whole count of ticks, so a check asks for that count of
// frames and no arithmetic sits between the two. A check that is ABOUT the
// subdivision of ticks into frames builds a harness with a clock of its own,
// which {@link HarnessOptions.clock} is for.

/** One frame — one tick — of game time, in milliseconds. */
export const TICK_MS = 1000 / TICK_HZ;

/* -------------------------------------------------------------------------- */
/* Polar arithmetic, as specs/field.md fixes the conventions                  */
/* -------------------------------------------------------------------------- */
//
// The game is polar, and its rules speak in radii and degrees; a check speaks
// the same way and converts at the edge, with the mapping specs/overview.md
// fixes: `x = 500 + r cos(theta)`, `y = 500 + r sin(theta)`, angles in degrees,
// `0` along `+x`, increasing toward `+y`, normalized to `[0, 360)`.

/** Degrees to radians. */
const RAD = Math.PI / 180;

/** `deg` normalized into `[0, 360)`. */
export function normalizeDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/**
 * The signed wrap-aware angular offset from `fromDeg` to `toDeg`, in
 * `[-180, 180)` — the reading every span and arc membership rule compares by.
 */
export function angularOffset(fromDeg: number, toDeg: number): number {
  return ((((toDeg - fromDeg) % 360) + 540) % 360) - 180;
}

/** The stage point at radius `r` and angle `deg` about the stage center. */
export function polarToXy(r: number, deg: number): { x: number; y: number } {
  return {
    x: STAGE_CX + r * Math.cos(deg * RAD),
    y: STAGE_CY + r * Math.sin(deg * RAD),
  };
}

/** The polar reading of a stage point: its radius and its angle in [0, 360). */
export function xyToPolar(x: number, y: number): { r: number; deg: number } {
  const dx = x - STAGE_CX;
  const dy = y - STAGE_CY;
  return { r: Math.hypot(dx, dy), deg: normalizeDeg(Math.atan2(dy, dx) / RAD) };
}

/**
 * The velocity `(vx, vy)` at angle `deg` whose radial speed is `vr` (outward
 * positive) and tangential speed `vt` (toward `+theta` positive). The two axes
 * are specs/field.md's own `n` and `t` at that angle.
 */
export function polarVelocity(
  deg: number,
  vr: number,
  vt: number,
): { vx: number; vy: number } {
  const cos = Math.cos(deg * RAD);
  const sin = Math.sin(deg * RAD);
  return { vx: vr * cos - vt * sin, vy: vr * sin + vt * cos };
}

/**
 * The center angle of slot `slot`'s target arc on ring `ring` (1 to 3), with
 * the ring's angle at `ringAngleDeg` — where a posed ball must be aimed to meet
 * that target. specs/rings.md: slot `k` begins at the ring's angle plus `k`
 * slot widths, and the arc begins 2 degrees into the slot and spans the arc
 * width.
 */
export function targetArcCenterDeg(
  ring: number,
  slot: number,
  ringAngleDeg = 0,
): number {
  const spec = RING_TABLE[ring - 1];
  if (spec === undefined) throw new Error(`no ring ${ring}`);
  return normalizeDeg(
    ringAngleDeg + slot * spec.slotWidthDeg + 2 + spec.arcWidthDeg / 2,
  );
}

/** The slot/arc figures {@link targetArcCenterDeg} reads, from specs/rings.md. */
const RING_TABLE = [
  { slotWidthDeg: 30, arcWidthDeg: 26 },
  { slotWidthDeg: 22.5, arcWidthDeg: 18.5 },
  { slotWidthDeg: 18, arcWidthDeg: 14 },
] as const;

/* -------------------------------------------------------------------------- */
/* Driving the surface                                                        */
/* -------------------------------------------------------------------------- */

/**
 * A member of a pure surface, as a check calls it.
 *
 * A pose `(state, ...args) => S` becomes `(...args) => void`: the driver runs it
 * through `engine.apply`, so the state it returns is the state the next frame
 * receives. A reading `(state, ...args) => R` becomes `(...args) => R`: the
 * driver hands it `engine.state` and passes the rest through, which is what
 * `menuItemRect(state, index)` needs.
 */
type Driven<S, M> = M extends (state: DeepReadonly<S>, ...args: infer A) => S
  ? (...args: A) => void
  : M extends (state: DeepReadonly<S>, ...args: infer A) => infer R
    ? (...args: A) => R
    : M;

/**
 * The imperative reading of a pure surface: every member of `D`, minus its
 * state argument, over the engine that holds the state.
 */
export type Driver<S, D> = {
  [K in keyof D]: Driven<S, NonNullable<D[K]>>;
};

/** The surface as every check drives it. */
export type KesslerDriver = Driver<KesslerState, KesslerSurface>;

/**
 * What the build owes when its surface is missing: the `Expected:` line of the
 * failure every check that reaches for the surface lands on.
 */
const SURFACE_REQUIREMENT =
  "the debug surface src/game.ts's initialize returns beside its state, as " +
  "[state, debug], which the engine hands back from engine.debug " +
  "(specs/instrumentation.md)";

/** Fail the running check because the build's surface is not what it must be. */
export function failSurface(fault: string): never {
  return fail(SURFACE_REQUIREMENT, fault);
}

/**
 * A stand-in for the surface a build never returned: every operation on it
 * fails the check that reached for it, with the missing return named.
 *
 * Keys that belong to the MACHINERY rather than to a check are answered with
 * `undefined` instead: awaiting the harness probes `then`, and vitest's own
 * error formatting probes symbols and `constructor`. Failing those would
 * replace the verdict with noise from the machinery trying to report it.
 */
function missingSurface(reason: string): KesslerSurface {
  return new Proxy({} as KesslerSurface, {
    get: (_target, property): unknown => {
      if (typeof property === "symbol") return undefined;
      if (property === "then" || property === "constructor") return undefined;
      return failSurface(reason);
    },
  });
}

/**
 * The debug surface the BUILD returned beside its state, read off the engine
 * that holds it.
 *
 * Deliberately a READ and never a construction: the surface is the build's
 * deliverable, and `engine.debug` is the only way it reaches a check. A pair
 * whose second element is no surface is a fault in the build, decided not here
 * — every suite builds its harness in a `beforeEach`, and a throw there would
 * bury the real verdict — but by {@link missingSurface}, at the moment a check
 * first reaches for an operation on it.
 */
function readDebugSurface(
  engine: Engine<KesslerState, KesslerSurface>,
): KesslerSurface {
  const surface: unknown = engine.debug;
  if (typeof surface !== "object" || surface === null) {
    return missingSurface(
      `engine.debug holds ${surface === null ? "null" : typeof surface}, ` +
        `not an object`,
    );
  }
  return surface as KesslerSurface;
}

/**
 * The imperative reading of the raw surface, over the engine that holds the
 * state.
 *
 * A lazy proxy, for the same reason {@link missingSurface} is: the member is
 * read off the raw surface at the moment a check reaches for it, so a missing
 * surface or a missing operation fails the check that needed it and never the
 * `beforeEach` that built the harness. A reading is called with `engine.state`
 * and its result handed back; a pose is run through `engine.apply`, so the
 * engine stores what it returned and the next frame's `update` receives it.
 */
function driveSurface(
  engine: Engine<KesslerState, KesslerSurface>,
  raw: KesslerSurface,
): KesslerDriver {
  const readings: readonly string[] = READINGS;
  return new Proxy({} as KesslerDriver, {
    get: (_target, property): unknown => {
      if (typeof property === "symbol") return undefined;
      if (property === "then" || property === "constructor") return undefined;
      const member = (raw as unknown as Record<string, unknown>)[property];
      if (typeof member !== "function") return member;
      const op = member as (
        state: DeepReadonly<KesslerState>,
        ...args: unknown[]
      ) => unknown;
      if (readings.includes(property)) {
        return (...args: unknown[]): unknown =>
          op.call(raw, engine.state, ...args);
      }
      return (...args: unknown[]): void => {
        engine.apply((state) => op.call(raw, state, ...args) as KesslerState);
      };
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Readings taken off one frame's render                                      */
/* -------------------------------------------------------------------------- */

/** A 2D affine transform, in the canvas's `[a, b, c, d, e, f]` order. */
export type Matrix = [number, number, number, number, number, number];

/**
 * Where a call was issued, read off the real context at the moment of the call:
 * the transform in force, whether image smoothing was on, and, for a run of
 * text, its measured width and the alignment that places it about its anchor.
 */
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
 * One bitmap the build blitted.
 *
 * `id` is the source's identity: the path the bitmap's bytes were served from,
 * as the engine resolved it under the asset root — `assets/sprites/planet.png`
 * — so two blits carry the same one exactly when they painted the same produced
 * file. `""` names a source this harness never served, which is a canvas or an
 * image the build made for itself. The rectangle is in DEVICE pixels, mapped
 * through the transform in force at the call, so `x + w / 2, y + h / 2` is its
 * center under any transform the build drew under.
 */
export interface Blit {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Whether image smoothing was on at the moment of this blit. */
  smoothing: boolean;
}

/** A cue the build played, and the tick of the drive it played it on. */
export interface TimedCue {
  /** The frame (= tick) it sounded on, as {@link Harness.frame} counts them. */
  frame: number;
  /** The engine's simulated time at that frame, in milliseconds. */
  t: number;
  /** The cue's name, as the build declared and played it. */
  name: string;
  /** Whether this was the start of a loop, which is what a music bed is. */
  loop: boolean;
  /** The gain it sounded at. `0` while muted. */
  gain: number;
}

/** One asset the build asked for and did not get. */
export interface AssetFailure {
  path: string;
  reason: string;
}

/* -------------------------------------------------------------------------- */
/* Serving the produced tree to the engine's loader                           */
/* -------------------------------------------------------------------------- */
//
// `specs/assets.md` has the build load every produced sprite and sound through
// the engine, which resolves each path under `assets/` relative to the page the
// build is served from and fetches it. This project runs in a Node process with
// no page, so the harness supplies the three things a browser gives the loader:
// a `fetch` that reads the very file the build committed, a `createImageBitmap`
// that decodes one, and an `AudioContext` that decodes a produced PCM `.wav`
// far enough for `api.audio.load` to bind the cue. Each falls through to
// whatever the platform already had for anything it does not recognize.
//
// WHAT WOULD HAPPEN WITHOUT IT. Every produced file would fail to load, and
// every point about a produced sprite or a bound cue would fail every build
// ever written — a fact about Node rather than about the build. So every check
// this project runs gets the produced files, and `assetFailures` records the
// loads that failed for the checks that read that the tree arrived whole.

/**
 * The directory this harness sits in, which is the validator project's root.
 *
 * Taken from this module's own URL rather than from the working directory,
 * because it has to name the same directory in both layouts this file lives in:
 * the case's own `validation/<engine>/`, and the `validation/` the runner
 * stages that directory to inside the build's tree.
 */
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

/** The build's workspace, which is where `assets/` and `src/` sit. */
export const WORKSPACE = resolve(PROJECT_ROOT, "..");

/**
 * Where a page-relative asset URL is looked for, in order: the repository root
 * first, because `specs/assets.md` puts every produced file under `assets/` at
 * the root and the loader asks for `assets/<path>`; `public/` and `dist/`
 * follow so a build that staged its tree for Vite is still loading its own
 * committed files rather than nothing.
 */
const ASSET_ROOTS = [".", "public", "dist"] as const;

/** Where a fetched body came from, so a decoded image can carry its source. */
const blobSource = new WeakMap<object, string>();

/** Where a decoded image came from, or absent for one the build painted. */
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
    const candidate = resolve(WORKSPACE, root, path);
    if (candidate.startsWith(resolve(WORKSPACE)) && existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * One 16-bit PCM `.wav` as the channel data an `AudioBuffer` reports.
 *
 * Enough of a decode to satisfy `api.audio.load`, which binds a cue name only
 * once its file decodes. Nothing here sounds, so what the samples are worth
 * never reaches a verdict; what matters is that the produced cues BIND, exactly
 * as they do on a page, and the cue bus then announces every play.
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

let assetHostInstalled = false;

/**
 * Give this process the three things a browser gives the engine's asset
 * loader. Idempotent, and installed the first time a harness is built.
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
        throw new Error(`kessler harness: nothing to fetch "${url}" with`);
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
  // It shadows every `drawImage` a frame issues so a replay can carry the
  // picture the build actually drew, and it recognizes a source by `instanceof`
  // against the host's own constructors — of which a bare Node process has
  // none. Naming the canvas library's decoded image as `ImageBitmap`, which is
  // exactly what `createImageBitmap` hands back here, is what lets a produced
  // sprite reach a recording as its pixels rather than as an opaque marker.
  // Nothing else in this process reads the name.
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

/**
 * The produced file a drawn source came from, or `""` for one this harness
 * never served — a canvas the build painted itself, reported as having drawn
 * something other than the produced file rather than as having drawn nothing.
 */
export function sourceId(source: unknown): string {
  if (source === null || typeof source !== "object") return "";
  return imageSource.get(source) ?? "";
}

/* -------------------------------------------------------------------------- */
/* The harness                                                                */
/* -------------------------------------------------------------------------- */

export interface HarnessOptions {
  /** The clock each frame takes its delta from. Defaults to one tick a frame. */
  clock?: Clock;
  /** The element's laid-out CSS width. Defaults to the logical stage width. */
  cssWidth?: number;
  /** The element's laid-out CSS height. Defaults to the logical stage height. */
  cssHeight?: number;
  /** Device pixels per CSS pixel. Defaults to 1, one device pixel per unit. */
  dpr?: number;
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
  snapshot: KesslerSnapshot;
}

/** What one frame's render issued: its operations, and its bitmap blits. */
export interface FrameDraw {
  calls: DrawCall[];
  blits: Blit[];
}

export interface Harness {
  readonly engine: Engine<KesslerState, KesslerSurface>;
  /**
   * The target the engine reads input off: where a key event and a pointer
   * event are dispatched, as the engine's validator pages describe.
   */
  readonly keys: EventTarget;
  /** The engine's current state, read fresh on every access. */
  readonly state: DeepReadonly<KesslerState>;
  /**
   * The debug surface the BUILD returned beside its state, driven over the
   * engine: each pose runs through `engine.apply`, each reading is handed
   * `engine.state`.
   */
  readonly debug: KesslerDriver;
  /** The real 2D context, for `getImageData`. Draw calls also reach it. */
  readonly ctx: SKRSContext2D;
  /** The surface the engine drew into, holding the last frame that ran. */
  readonly canvas: Canvas;
  /** Every call and property set the render has made since the last clear. */
  readonly calls: DrawCall[];
  /** Every cue the build played, oldest first. */
  readonly cues: TimedCue[];
  /** Every asset the build failed to load, oldest first. */
  readonly assetFailures: AssetFailure[];

  /** Whether the build has the cue `name` looping at this moment. */
  looping(name: string): boolean;

  /** Frames run since the engine started. One frame is one tick. */
  frame(): number;
  /** The simulated time those frames covered, in milliseconds. */
  timeMs(): number;

  /** A fresh read of the game's state through the case's `snapshot`. */
  snapshot(): KesslerSnapshot;
  /** `debug.reset`, with `seed` seeding the pod generator when given. */
  reset(seed?: number): void;
  /** Run `frames` frames of the harness's clock, back to back. */
  advance(frames: number): Promise<void>;
  /** Run `ticks` whole ticks of simulation time, and read what they left. */
  tick(ticks?: number): Promise<KesslerSnapshot>;
  /** Drive a tick at a time until `predicate` holds, or the budget is spent. */
  until(
    predicate: (snapshot: KesslerSnapshot) => boolean,
    options?: UntilOptions,
  ): Promise<UntilResult>;

  /** Press a key (`KeyboardEvent.code`) and leave it down. */
  holdKey(code: string): void;
  /** Release a key held by {@link holdKey}. */
  releaseKey(code: string): void;

  /** Forget every call recorded so far. */
  clearCalls(): void;
  /** Run exactly one frame and hand back everything its render issued. */
  frameDraw(): Promise<FrameDraw>;
  /** Run exactly one frame and hand back the operations its render issued. */
  frameCalls(): Promise<DrawCall[]>;
  /** Run exactly one frame and hand back the bitmaps it blitted. */
  frameBlits(): Promise<Blit[]>;

  /** How the stage is mapped onto this harness's canvas. */
  viewport(): Viewport;
  /** Where a logical point lands in the canvas's backing store. */
  device(x: number, y: number): { x: number; y: number };
  /** The device pixel under a logical point, as `[r, g, b, a]`. */
  pixel(x: number, y: number): [number, number, number, number];

  /** Drop the engine's listeners and release the canvas. */
  dispose(): void;
}

/** The extra cue sinks {@link onCue} opened, per harness. */
const cueSinks = new WeakMap<Harness, TimedCue[][]>();

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

function toDevice(
  view: Viewport,
  x: number,
  y: number,
): { x: number; y: number } {
  return {
    x: Math.round(view.offsetX + x * view.scale),
    y: Math.round(view.offsetY + y * view.scale),
  };
}

/** The methods whose position only means something once the transform applies. */
const PLACED_METHODS = ["drawImage", "fillText", "strokeText"];

/**
 * A proxy that records every call and property set on its way to the real
 * context, so one frame produces both a pixel buffer to sample and a call list
 * to inspect. The transform and the smoothing flag are read off the real
 * context at the moment of a PLACED call, because the build is free to draw
 * under any transform it likes and the context itself is the authority on
 * where that put it.
 */
function recorder(target: SKRSContext2D, calls: DrawCall[]): SKRSContext2D {
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

/**
 * Build an engine over a canvas of the harness's own, initialize the build's
 * game, and hand back everything a check reads.
 *
 * The options passed to the factory are the ones the seeded `src/main.ts`
 * passes — the design size and the build's exported `BACKGROUND`, with no touch
 * layout, since Kessler is keyboard only — plus the clock and the surface
 * metrics a headless run needs.
 */
export async function openHarness(
  options: HarnessOptions = {},
): Promise<Harness> {
  installAssetHost();

  const cssWidth = options.cssWidth ?? STAGE_W;
  const cssHeight = options.cssHeight ?? STAGE_H;
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

  const engine = createEngine<KesslerState, KesslerSurface>({
    canvas: element,
    width: STAGE_W,
    height: STAGE_H,
    game,
    // The build's own stage background, handed to the engine exactly as the
    // seeded `src/main.ts` hands it (specs/overview.md).
    background: BACKGROUND,
    clock: options.clock ?? new ConstantClock(TICK_MS),
    surface,
  });

  // Subscribed BEFORE `initialize`, which is what makes the game's own loading
  // and its opening sounds observable: construction runs no game code.
  const assetFailures: AssetFailure[] = [];
  const cues: TimedCue[] = [];
  engine.events.on("asset:failed", ({ path, reason }) => {
    assetFailures.push({ path, reason });
  });
  const sinks: TimedCue[][] = [];
  const loops = new Set<string>();
  const noteCue =
    (loop: boolean) => (played: { cue: string; t: number; gain: number }) => {
      const timed: TimedCue = {
        frame: engine.frame().count,
        t: played.t,
        name: played.cue,
        loop,
        gain: played.gain,
      };
      if (loop) loops.add(played.cue);
      cues.push(timed);
      for (const sink of sinks) sink.push(timed);
    };
  engine.events.on("cue:played", noteCue(false));
  engine.events.on("cue:looped", noteCue(true));
  engine.events.on("cue:stopped", ({ cue }) => {
    loops.delete(cue);
  });

  await engine.initialize();
  const debug = driveSurface(engine, readDebugSurface(engine));

  const dispatch = (type: "keydown" | "keyup", code: string): void => {
    keys.dispatchEvent(new KeyEvent(type, code));
  };

  const harness: Harness = {
    engine,
    keys,
    get state() {
      return engine.state;
    },
    debug,
    ctx,
    canvas,
    calls,
    cues,
    assetFailures,

    looping: (name) => loops.has(name),

    frame: () => engine.frame().count,
    timeMs: () => engine.frame().timeMs,

    snapshot: () => debug.snapshot(),
    reset: (seed) => {
      debug.reset(seed);
    },

    advance: (frames) => engine.advance(frames),

    async tick(ticks = 1) {
      await engine.advance(ticks);
      return debug.snapshot();
    },

    async until(predicate, untilOptions = {}) {
      const maxTicks = untilOptions.maxTicks ?? 600;
      let snapshot = debug.snapshot();
      if (predicate(snapshot)) return { hit: true, ticks: 0, snapshot };
      for (let ticks = 1; ticks <= maxTicks; ticks += 1) {
        await engine.advance(1);
        snapshot = debug.snapshot();
        if (predicate(snapshot)) return { hit: true, ticks, snapshot };
      }
      return { hit: false, ticks: maxTicks, snapshot };
    },

    holdKey: (code) => dispatch("keydown", code),
    releaseKey: (code) => dispatch("keyup", code),

    clearCalls: () => {
      calls.length = 0;
    },
    async frameDraw() {
      calls.length = 0;
      await engine.advance(1);
      return { calls: [...calls], blits: blitsOf(calls) };
    },
    async frameCalls() {
      calls.length = 0;
      await engine.advance(1);
      return [...calls];
    },
    async frameBlits() {
      calls.length = 0;
      await engine.advance(1);
      return blitsOf(calls);
    },

    viewport: () => engine.viewport(),
    device: (x, y) => toDevice(engine.viewport(), x, y),
    pixel: (x, y) => {
      const point = toDevice(engine.viewport(), x, y);
      const { data } = ctx.getImageData(point.x, point.y, 1, 1);
      return [data[0], data[1], data[2], data[3]];
    },

    dispose: () => engine.destroy(),
  };

  cueSinks.set(harness, sinks);
  return harness;
}

/* -------------------------------------------------------------------------- */
/* Input, as a player's keys deliver it                                       */
/* -------------------------------------------------------------------------- */

/**
 * Press `code`, run the one frame that delivers its edge, and release it.
 *
 * The engine discards an edge nothing consumed by the end of the frame it was
 * armed in, so a tap that ran no frame would never reach the game. Every
 * non-rotation action in `specs/controls.md` is a press EDGE, so one tap is one
 * action. NOTE: under this harness the delivering frame is one whole tick.
 */
export async function tap(h: Harness, code: string): Promise<void> {
  h.holdKey(code);
  await h.advance(1);
  h.releaseKey(code);
}

/**
 * Hold `code` down for `ticks` whole ticks, then release it.
 *
 * The held rotation actions read the key's value each frame, so the deflector
 * turns at its 270 degrees per second for exactly `ticks / 60` seconds of game
 * time. The release dispatches after the last held frame and delivers on the
 * next frame the caller runs.
 */
export async function hold(
  h: Harness,
  code: string,
  ticks: number,
): Promise<void> {
  h.holdKey(code);
  await h.advance(ticks);
  h.releaseKey(code);
}

/** Run `n` whole ticks of simulation time. One frame is one tick. */
export async function advanceTicks(h: Harness, n: number): Promise<void> {
  await h.advance(n);
}

/* -------------------------------------------------------------------------- */
/* Posing a world                                                             */
/* -------------------------------------------------------------------------- */
//
// The rule the authoring guide states is that a validator poses an ISOLATED
// world: it clears every entity the requirement is not about and spawns back
// exactly what it is about, and it holds still the consequences the
// requirement does not exercise. The surface carries the operations that make
// that possible — `clearTargets`, `clearBalls`, `clearPods`, and the two
// driver switches — and {@link isolate} is the one place they are all spoken
// in a single breath.

/**
 * Reset the game and pose an EMPTY playing field with both driver switches
 * off: no targets, no balls, no pods, `waveAdvance` and `podSpawn` disabled.
 *
 * The reset first, so nothing a previous section left is inherited; then a
 * fresh session through `setScreen("playing")`, entered "exactly as confirming
 * START does"; then the world is emptied and the two autonomous consequences
 * are held. A check spawns back exactly what its requirement is about — a
 * target it aims a ball at, a pod it drops on the deflector — and turns a
 * switch back on only when the switch's consequence IS the requirement.
 *
 * `waveAdvance` off is what lets a destruction that empties the field play on
 * in `playing`, and `podSpawn` off is what keeps a watched destruction from
 * shedding a pod on top of the scenario — the two holds the spec gives a
 * scenario "so it can watch one behavior without another arriving on top of
 * it".
 */
export function isolate(h: Harness, seed?: number): KesslerSnapshot {
  h.reset(seed);
  h.debug.setScreen("playing");
  h.debug.clearTargets();
  h.debug.clearBalls();
  h.debug.clearPods();
  h.debug.setWaveAdvance(false);
  h.debug.setPodSpawn(false);
  return h.snapshot();
}

/**
 * Start a session the way a player does: reset to the title and `confirm` the
 * START entry with a real key press.
 *
 * The one compound sequence that presses keys rather than posing — it is what
 * the navigation and session-start points drive. A point about anything else
 * reaches its screen through {@link poseScene} or {@link isolate} instead,
 * because a build with a broken menu and a correct simulation must fail the
 * menu points and pass the others.
 */
export async function startPlay(
  h: Harness,
  seed?: number,
): Promise<KesslerSnapshot> {
  h.reset(seed);
  await tap(h, "Enter");
  return h.snapshot();
}

/**
 * Reset and enter `screen` through the surface alone, "exactly as the real
 * transition into it enters it" (`setScreen`, specs/instrumentation.md).
 *
 * The reset first, so the screen is entered from the boot state and two poses
 * of the same scene read the same way. A check that wants a scene UNDER the
 * screen — a paused mid-flight ball, a game over with a score — poses the
 * scene first through the atomic operations and calls `h.debug.setScreen`
 * itself.
 */
export function poseScene(h: Harness, screen: Screen): KesslerSnapshot {
  h.reset();
  h.debug.setScreen(screen);
  return h.snapshot();
}

/**
 * Spawn an unparked ball at radius `r` and angle `deg`, moving with radial
 * speed `vr` (outward positive) and tangential speed `vt` (toward `+theta`
 * positive) — the polar spelling of `spawnBall` nearly every contact scenario
 * stages with.
 */
export function spawnBallPolar(
  h: Harness,
  r: number,
  deg: number,
  vr: number,
  vt = 0,
): void {
  const at = polarToXy(r, deg);
  const v = polarVelocity(deg, vr, vt);
  h.debug.spawnBall(at.x, at.y, v.vx, v.vy);
}

/** Spawn a pod of `kind` at radius `r` and angle `deg`. It falls inward. */
export function spawnPodPolar(
  h: Harness,
  kind: PodKind,
  r: number,
  deg: number,
): void {
  const at = polarToXy(r, deg);
  h.debug.spawnPod(kind, at.x, at.y);
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
  if (at.length === 8) {
    return { x: at[4], y: at[5], w: at[6], h: at[7] };
  }
  if (at.length === 4) {
    return { x: at[0], y: at[1], w: at[2], h: at[3] };
  }
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
 * pixels: the four corners of each destination rectangle mapped through the
 * transform in force at the call, and the box taken around them, so a sprite
 * drawn under a rotation still reports the square of the canvas it covered.
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
    blits.push({
      id: sourceId(call.args[0]),
      x,
      y,
      w: Math.max(...xs) - x,
      h: Math.max(...ys) - y,
      smoothing: at.smoothing,
    });
  }
  return blits;
}

/** Where a blit's center landed, in device pixels. */
export function blitCenter(blit: Blit): { x: number; y: number } {
  return { x: blit.x + blit.w / 2, y: blit.y + blit.h / 2 };
}

/**
 * Every blit whose center landed within `within` logical units of the logical
 * point `(x, y)` — how a blit is attributed to the ball, pod, or planet it was
 * drawn on, since every produced sprite is drawn centered on its object
 * (specs/assets.md).
 */
export function blitsNear(
  h: Harness,
  blits: readonly Blit[],
  x: number,
  y: number,
  within: number,
): Blit[] {
  const view = h.viewport();
  const at = toDevice(view, x, y);
  const limit = within * view.scale;
  return blits.filter((blit) => {
    const center = blitCenter(blit);
    return Math.hypot(center.x - at.x, center.y - at.y) <= limit;
  });
}

/**
 * The produced file painted nearest to and within `within` units of `(x, y)`,
 * or `null` when no blit landed there. The LAST such blit, because that is the
 * one a player sees.
 */
export function spriteNear(
  h: Harness,
  blits: readonly Blit[],
  x: number,
  y: number,
  within: number,
): string | null {
  const found = blitsNear(h, blits, x, y, within);
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
 *
 * Substring rather than equality on purpose: the copy a check asserts is the
 * case's own, but how a build presents it is the build's, and a menu entry is
 * commonly drawn with a selection marker or padding around it.
 */
export function drewText(calls: readonly DrawCall[], text: string): boolean {
  const wanted = text.trim().toLowerCase();
  return drawnText(calls).some((drawn) => drawn.toLowerCase().includes(wanted));
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
 * The geometry calls a frame made, by name. Enough of a count to compare two
 * frames of the same scene, whatever shape the build chose to draw as.
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
/* Colour                                                                     */
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

/** The colour rendered at the logical point `(x, y)`. */
export function samplePoint(h: Harness, x: number, y: number): Rgb {
  const [r, g, b] = h.pixel(x, y);
  return { r, g, b };
}

/** The colour rendered at radius `r` and angle `deg` about the stage center. */
export function samplePolar(h: Harness, r: number, deg: number): Rgb {
  const at = polarToXy(r, deg);
  return samplePoint(h, at.x, at.y);
}

/* -------------------------------------------------------------------------- */
/* Cues                                                                       */
/* -------------------------------------------------------------------------- */
//
// `specs/assets.md` fixes the thirteen cue names and the two beds, and the
// file that specifies each event fixes the cue it plays. Under this engine the
// build declares each by name and plays it by name, and the engine announces
// every play — so what a check reads is WHICH cue sounded, without a decoder.
// "Audio belongs to the ticks. A pose changes the state alone and sounds
// nothing; the cues a scenario hears come from the ticks run after it"
// (specs/instrumentation.md).

/**
 * Record every cue the build plays from this call onward.
 *
 * A live array the harness pushes into, rather than a slice taken at the end: a
 * check reads it after the drive it is about, and what it holds is exactly the
 * cues that sounded during that drive and none of the ones that sounded while
 * the scene was being posed.
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
/* Evidence capture                                                           */
/* -------------------------------------------------------------------------- */
//
// A review item may declare a `replay` OUTPUT beside its verdict: the frames
// the build itself drew while a check drove it, kept as evidence a reviewer can
// scrub and compare against the reference implementation's. `captureReplay` is
// how a check produces one; `captureStill` keeps one picture instead.
//
// Four properties, each deliberate:
//
// 1. IT RECORDS THE SECTION, NOT THE RUN. The recorder is armed around the
//    caller's scenario and disarmed the moment that scenario returns, so what
//    is kept is the part the check is ABOUT and never the setup.
// 2. IT IS EVIDENCE, NEVER A VERDICT. The scenario's own value comes straight
//    back, and a scenario that THROWS still writes what it had recorded before
//    the failure travels on. Nothing here can change a verdict.
// 3. IT WRITES ONLY WHAT THERE IS TO LOOK AT. A capture that closed no frames
//    leaves no file, so the run reports the output absent instead of offering
//    the reviewer a replay of nothing.
// 4. IT COSTS NOTHING WHEN NOBODY IS COLLECTING. Outside a run the media
//    directory is unset, and the whole thing is a no-op that still runs the
//    scenario, so a check cannot pass in one place and fail in the other.

/** The environment variable the runner names the media directory in. */
const MEDIA_DIR_ENV = "TCAB_VALIDATION_MEDIA_DIR";

/**
 * The directory the runner stages this project to inside the build's tree.
 *
 * A recording is addressed by the STAGED path of the suite that produced it —
 * `validation/<suite>.test.ts` — because that is the path the review item's
 * declared script resolves to, and so the only name the case's manifest and the
 * runner both already agree on. Stating the prefix here is what keeps that
 * address the same when this suite is run in place against a reference
 * implementation, where the project root is `validation/<engine>/` instead.
 */
const STAGED_PROJECT_DIR = "validation";

/**
 * The most frames a written recording holds.
 *
 * A recording is one JSON operation log per frame, so a section a check drives
 * for many seconds of game time runs to tens of megabytes — a file nobody can
 * serve to a reviewer. The cap is what makes `captureReplay` safe to wrap ANY
 * section in; an over-long capture is thinned, not truncated.
 */
const MAX_REPLAY_FRAMES = 300;

/**
 * Where the running suite's `outputId` output belongs, or `null` when nothing
 * is collecting media.
 *
 * The suite is the one vitest is currently running rather than one the caller
 * names, because the two must not be able to disagree: a check that named its
 * own path would be free to write its evidence under some other point's
 * address. `extension` is `json.gz` for a recording, `png` for a still.
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
 * Dropping a frame drops the last reference to whatever only that frame drew
 * with, so the four shared tables are rebuilt from the kept frames alone,
 * every reference rewritten as it is reached, transitively, and the rewritten
 * entries deduplicated.
 */
function retable(
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
    // A recipe's own arguments were encoded when the value was used, so they
    // can only name entries interned before it: rewriting one terminates and
    // cannot re-enter this resource.
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
 * it, so the deltas still sum to the section's elapsed time. The last frame is
 * always kept — it is the frame the check's sweep stopped at — and takes the
 * place of the final strided frame rather than exceeding the cap.
 */
function thinReplay(recording: Recording): Recording {
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
 * wrong. A capture that closed no frames writes nothing; what lands on disk is
 * gzip, which every host that serves one declares as the encoding. Never
 * throws: a file that cannot be written says something about the machine, and
 * the runner already reads a declared output that never turned up as absent.
 */
function writeReplay(destination: string, recording: Recording): void {
  if (recording.frames.length === 0) return;
  try {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, gzipSync(JSON.stringify(thinReplay(recording))));
  } catch (error) {
    console.warn(`kessler: could not write ${destination}: ${String(error)}`);
  }
}

/**
 * Record the frames `act` draws and keep them as the review item's `outputId`
 * output, handing back whatever the scenario returned.
 *
 * Wrap the drive, not the arrangement:
 *
 * ```ts
 * const after = await captureReplay(h, "bounce", () => h.tick(30));
 * assertEqual(after.balls.length, 1);
 * ```
 *
 * The assertions stay exactly where they were and read exactly what they did:
 * capture sits BESIDE them, and a scenario that failed still leaves its
 * evidence behind.
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
 * output — for a point whose evidence is one PICTURE rather than a stretch of
 * motion. Call it after the frame that poses the thing under test (a
 * `frameDraw()` or an `advance(1)` following the arrangement) and before the
 * assertions, so a check that fails still leaves the picture that shows why.
 */
export function captureStill(h: Harness, outputId: string): void {
  const destination = mediaDestination(outputId, "png");
  if (destination === null) return;
  try {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, h.canvas.toBuffer("image/png"));
  } catch (error) {
    console.warn(`kessler: could not write ${destination}: ${String(error)}`);
  }
}

/**
 * Start a fresh session the way confirming START starts one, out of atomic
 * poses: the reset lays wave 1 — score `0`, `3` lives, wave `1`, every slot
 * filled, every ring angle at `0`, the wave-1 figures in force, the deflector
 * at angle `90` with its baseline span — `setScreen("playing")` puts the game
 * on the live field, and `parkBall` puts the serve on the deflector.
 *
 * `setScreen` sets the screen and nothing else, so the arrangement is this
 * sequence rather than the call: the authoring guide puts every compound
 * sequence in the harness, and this is the one every check that needs a
 * session in play shares. `seed` seeds the pod generator.
 */
export function startFreshSession(h: Harness, seed?: number): KesslerSnapshot {
  h.reset(seed);
  h.debug.setScreen("playing");
  h.debug.parkBall();
  return h.snapshot();
}

/**
 * Enter the interstitial the way the clearing event enters it, out of atomic
 * poses: every ball, every pod, every timed effect and the shield are removed,
 * the interstitial timer is set to the `180` ticks `specs/screens.md` fixes,
 * and the screen becomes `waveclear`.
 *
 * The wave the interstitial is running out belongs to the caller: it poses
 * `setWave` and the ring state it wants before calling this.
 */
export function poseInterstitial(
  h: Harness,
  ticks: number = WAVECLEAR_TICKS,
): KesslerSnapshot {
  h.debug.clearBalls();
  h.debug.clearPods();
  for (const kind of ["widen", "narrow", "pierce"] as const) {
    h.debug.setEffectTicks(kind, 0);
  }
  h.debug.setShield(false);
  h.debug.setInterstitialTicks(ticks);
  h.debug.setScreen("waveclear");
  return h.snapshot();
}

/**
 * Stand on the menu-bearing screen `screen` with entry `index` highlighted,
 * through the two poses that say exactly that and nothing else.
 *
 * The route for every check whose requirement is what `confirm` does to an
 * entry rather than how the highlight got there: walking to the entry with the
 * `down` key would fail the check on a build whose only fault is its `down`
 * key, which is a defect `controls/arrow-down-moves-highlight` already decides.
 */
export function poseMenu(
  h: Harness,
  screen: Screen,
  index: number,
): KesslerSnapshot {
  h.debug.setScreen(screen);
  h.debug.setMenuIndex(index);
  return h.snapshot();
}

/**
 * The hit region the build reports for menu entry `index` on the screen it is
 * standing on, or `null` where there is no such entry.
 *
 * The layout is the build's — `specs/screens.md` fixes no position for a menu —
 * so a check that drives the pointer at an entry asks the build where it drew
 * it, exactly as `specs/instrumentation.md` has it report.
 */
export function menuRect(h: Harness, index: number): MenuItemRect | null {
  return h.debug.menuItemRect(index);
}

/** The middle of a reported hit region, which is where a press aims. */
export function rectCenter(rect: MenuItemRect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/* -------------------------------------------------------------------------- */
/* The pointer and the finger                                                 */
/* -------------------------------------------------------------------------- */
//
// The engine owns the pointer as it owns the keyboard, reading `clientX`,
// `clientY`, `isPrimary` and `pointerType` off events dispatched at the same
// target the keys go to. The harness pins the surface to the stage's own size
// at a device pixel ratio of `1`, so a logical stage point IS the client
// position an event carries.
//
// EACH PART OF A GESTURE RUNS ITS OWN FRAME, because the engine closes its
// input frame each time one runs: a press and a release delivered inside one
// frame would be one sample list rather than the two moments a build reads.

/** One pointer event, as the engine reads it off the target. */
function pointerEvent(
  type: "pointerdown" | "pointermove" | "pointerup",
  x: number,
  y: number,
  device: "mouse" | "touch",
): Event {
  return Object.assign(new Event(type), {
    clientX: x,
    clientY: y,
    isPrimary: true,
    pointerType: device,
  });
}

/** Move the pointer onto the logical stage point `(x, y)`, and run its frame. */
export async function pointerTo(
  h: Harness,
  x: number,
  y: number,
): Promise<void> {
  h.keys.dispatchEvent(pointerEvent("pointermove", x, y, "mouse"));
  await h.advance(1);
}

/** Press the primary button where the pointer stands, and run its frame. */
export async function pointerDown(
  h: Harness,
  x: number,
  y: number,
): Promise<void> {
  h.keys.dispatchEvent(pointerEvent("pointerdown", x, y, "mouse"));
  await h.advance(1);
}

/** Release the primary button where the pointer stands, and run its frame. */
export async function pointerUp(
  h: Harness,
  x: number,
  y: number,
): Promise<void> {
  h.keys.dispatchEvent(pointerEvent("pointerup", x, y, "mouse"));
  await h.advance(1);
}

/** Land a touch contact on the logical stage point `(x, y)`, and run its frame. */
export async function touchDown(
  h: Harness,
  x: number,
  y: number,
): Promise<void> {
  h.keys.dispatchEvent(pointerEvent("pointerdown", x, y, "touch"));
  await h.advance(1);
}

/** Lift the touch contact at `(x, y)`, and run its frame. */
export async function touchUp(h: Harness, x: number, y: number): Promise<void> {
  h.keys.dispatchEvent(pointerEvent("pointerup", x, y, "touch"));
  await h.advance(1);
}
