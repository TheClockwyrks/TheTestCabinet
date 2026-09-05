// Wick — the shared validator harness, under the Simple 2D engine.
// CASE-PROVIDED.
//
// Every check in this project is an ordinary vitest test that runs IN THE SAME
// PROCESS as the build. It imports the engine and the build's own `src/game.ts`,
// creates an engine over a canvas it owns and a `ConstantClock` of `1000 / 60`
// milliseconds, and steps the game with `engine.advance`, so ONE FRAME ON
// `playing` CONSUMES EXACTLY ONE TICK, which is the pairing
// `specs/instrumentation.md` itself prescribes for a scenario. Nothing drives a
// browser, nothing polls, and no wall-clock time passes.
//
// WHAT A CHECK READS. The game's own state (through the case's `snapshot`), the
// engine's frame counter, the cue events it broadcast, the sounds those cues
// started, the draw calls the render issued, and the pixels those calls left on
// the canvas. Nothing here fabricates an outcome: the scenario helpers below only
// ARRANGE the night through the debug surface, and per the spec "No pose decides
// an outcome: every hit, kill, drop, collection, level-up, evolution, and ending
// comes from the ticks run after the pose".
//
// WHY THE DEBUG SURFACE RATHER THAN RAW ASSIGNMENT. `specs/instrumentation.md`
// fixes its operations, so they mean the same thing in every build; posing
// through it is how a scenario is reproducible, and it is the seam the case's
// specification documents. `surface.ts` is that specification as types, and it
// is the only description of the surface this harness reads: the build's own
// module for it is never imported.
//
// WHERE THE SURFACE COMES FROM. Off `engine.debug`, never built here. The build's
// `initialize` returns it beside the state, as `[state, debug]`, the engine holds
// the second element, and reading it back off the engine is the only way a
// surface reaches a check, so a build that returned no surface, or a surface
// missing an operation, fails the checks that reach the game through it. See
// {@link readDebugSurface}.
//
// HOW THE SURFACE IS DRIVEN. The engine holds the state by value and hands it out
// read-only, so the surface is pure: a pose takes the current state and returns
// the next, a reading takes the current state and returns what it read. A check
// still writes `h.debug.setHp(40)` and `h.snapshot()`, because `h.debug` is a
// {@link Driver} over the raw surface: it runs each pose through `engine.apply`
// and hands each reading `engine.state`.
//
// WHAT THE HARNESS OWNS THAT THE SURFACE MUST NOT. The surface is ATOMIC by
// design, one field per operation, so every compound sequence lives here:
// {@link isolate} (the empty posed night with every driver switch off),
// {@link startPlay} (the real, key-pressed path into a run), {@link openLevelUp}
// and {@link openChest} (the overlays reached through the tick that opens them),
// and the placement helpers a scenario stages contacts with.
//
// THE HOST THE BUILD LOADS ITS PRODUCED FILES THROUGH. This is a full-stack case:
// the build produces its own sprites, sheets, icons, cues and music bed, commits
// them under `assets/` at the root of the repository, and loads them through the
// engine's own loader and cue bus (`specs/assets.md`). Node has no `fetch` that
// reads a page-relative path, no `createImageBitmap`, and no `AudioContext`, so
// a check running here would see a build's every produced file fail to load and
// every presentation point would fail a conformant build for a fact about the
// host. {@link installAssetHost} is what closes that: the engine's asset root is
// served off the build's own tree and images are decoded with the canvas library
// the workspace already ships, so the build loads exactly the files it
// committed, by exactly the paths it wrote.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  type DiagnosticReading,
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
// The build's own module, for the game object the engine is stood up over and
// for the state type. Every FIGURE a point is decided against, and the one
// value the specification leaves to the build, come from `./constants`.
import { game as build, type WickState } from "../src/game";
import { fail } from "./assert";
import {
  BACKGROUND,
  BINDINGS,
  DAWN_TICK,
  LAYOUT,
  OVERLAY_TOGGLE_CODE,
  STAGE_CX,
  STAGE_CY,
  STAGE_H,
  STAGE_W,
  TICK_DT,
  TICK_MS,
  UNBOUND_KEY,
  WHEEL_ROW,
  type ActionName,
  type EnemyId,
  type GemTier,
  type PassiveId,
  type OfferId,
  type PickupKind,
  type ProjectileWeapon,
  type PuddleWeapon,
  type WeaponId,
} from "./constants";
import {
  READINGS,
  REQUIRED_OPS,
  SWITCH_NAMES,
  SWITCH_OPS,
  type ChestResult,
  type EnemySnapshot,
  type Facing,
  type GemSnapshot,
  type OperationName,
  type PassiveSnapshot,
  type PickupSnapshot,
  type PlayerSnapshot,
  type ProjectileSnapshot,
  type RunSnapshot,
  type Screen,
  type SwitchName,
  type WeaponSnapshot,
  type WickDebugApi,
  type WickRect,
  type WickSnapshot,
  type ZoneKind,
  type ZoneSnapshot,
} from "./surface";

export type {
  ChestResult,
  EnemySnapshot,
  Facing,
  GemSnapshot,
  OperationName,
  PassiveSnapshot,
  PickupSnapshot,
  PlayerSnapshot,
  ProjectileSnapshot,
  RunSnapshot,
  Screen,
  SwitchName,
  WeaponSnapshot,
  WickDebugApi,
  WickRect,
  WickSnapshot,
  ZoneKind,
  ZoneSnapshot,
};
export { READINGS, REQUIRED_OPS, SWITCH_NAMES, SWITCH_OPS };

/** The case's surface, bound to the state type the build declared. */
export type WickSurface = WickDebugApi<WickState>;

/**
 * The build's game, typed against the surface the CASE specifies.
 *
 * The build declares its own type for the surface its `initialize` returns, and
 * that type is the build's: what a check holds it to is `surface.ts`, so the
 * game is cast to the case's `Game<WickState, WickSurface>` here and the engine
 * is parameterized with it. A surface that departs from the specification is
 * caught where a check reaches for the missing member, not by the build's own
 * compiler.
 */
const game = build as unknown as Game<WickState, WickSurface>;

/* -------------------------------------------------------------------------- */
/* Driving the surface                                                        */
/* -------------------------------------------------------------------------- */

/**
 * A member of a pure surface, as a check calls it.
 *
 * A pose `(state, ...args) => S` becomes `(...args) => void`: the driver runs it
 * through `engine.apply`, so the state it returns is the state the next frame
 * receives. A reading `(state) => R` becomes `() => R`: the driver hands it
 * `engine.state`. A plain property, `version`, stays what it is.
 */
type Driven<S, M> = M extends (state: DeepReadonly<S>, ...args: infer A) => S
  ? (...args: A) => void
  : M extends (state: DeepReadonly<S>) => infer R
    ? () => R
    : M;

/**
 * The imperative reading of a pure surface: every member of `D`, minus its
 * state argument, over the engine that holds the state.
 */
export type Driver<S, D> = {
  [K in keyof D]: Driven<S, NonNullable<D[K]>>;
};

/** The surface as every check drives it. */
export type WickDriver = Driver<WickState, WickSurface>;

/**
 * What the build owes when its surface is missing: the `Expected:` line of the
 * failure every check that reaches for the surface lands on.
 */
export const SURFACE_REQUIREMENT =
  "the debug surface src/game.ts's initialize returns beside its state, as " +
  "[state, debug], which the engine hands back from engine.debug, carrying " +
  "every operation specs/instrumentation.md names";

/** Fail the running check because the build's surface is not what it must be. */
export function failSurface(fault: string): never {
  return fail(SURFACE_REQUIREMENT, fault);
}

/**
 * A stand-in for the surface a build never returned: every operation on it
 * fails the check that reached for it, with the fault named.
 *
 * Keys that belong to the MACHINERY rather than to a check are answered with
 * `undefined` instead: awaiting the harness probes `then`, and vitest's own
 * error formatting probes symbols and `constructor`. Failing those would
 * replace the verdict with noise from the machinery trying to report it.
 */
function unusableSurface(reason: string): WickDriver {
  return new Proxy({} as WickDriver, {
    get: (_target, property): unknown => {
      if (typeof property === "symbol") return undefined;
      if (property === "then" || property === "constructor") return undefined;
      return (): never => failSurface(reason);
    },
  });
}

/**
 * Why the surface the BUILD returned beside its state cannot be driven, or
 * `null` when it can.
 *
 * Deliberately a READ and never a construction: the surface is the build's
 * deliverable, and `engine.debug` is the only way it reaches a check. A pair
 * whose second element is no surface, or a surface missing an operation, is a
 * fault in the build, reported here so that {@link Harness.surfaceFault} names
 * it and every check that reaches for the surface fails on it through
 * {@link unusableSurface}, rather than throwing a `TypeError` several ticks
 * later or burying the verdict in the `beforeEach` that built the harness.
 */
function readDebugSurface(surface: unknown): string | null {
  if (typeof surface !== "object" || surface === null) {
    return `engine.debug holds ${surface === null ? "null" : typeof surface}, not an object`;
  }
  const held = surface as Record<string, unknown>;
  const missing = REQUIRED_OPS.filter((op) => typeof held[op] !== "function");
  if (missing.length > 0) {
    return `engine.debug is an object but carries no ${missing
      .map((op) => `${op}()`)
      .join(", ")}`;
  }
  return null;
}

/**
 * The imperative reading of the raw surface, over the engine that holds the
 * state.
 *
 * A lazy proxy: the member is read off the raw surface at the moment a check
 * reaches for it. A reading is called with `engine.state` and its result handed
 * back; a pose is run through `engine.apply`, so the engine stores what it
 * returned and the next frame's `update` receives it. A pose that throws, which
 * is what the specification requires of an argument outside its domain, throws
 * out of the driver untouched, and `engine.apply` leaves the state as it was.
 */
function driveSurface(
  engine: Engine<WickState, WickSurface>,
  raw: WickSurface,
): WickDriver {
  const readings: readonly string[] = READINGS;
  return new Proxy({} as WickDriver, {
    get: (_target, property): unknown => {
      if (typeof property === "symbol") return undefined;
      if (property === "then" || property === "constructor") return undefined;
      const member = (raw as unknown as Record<string, unknown>)[property];
      if (typeof member !== "function") return member;
      const op = member as (
        state: DeepReadonly<WickState>,
        ...args: unknown[]
      ) => unknown;
      if (readings.includes(property)) {
        return (): unknown => op.call(raw, engine.state);
      }
      return (...args: unknown[]): void => {
        engine.apply((state) => op.call(raw, state, ...args) as WickState);
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
 * as the engine resolved it under the asset root, `assets/sprites/ground.png`
 * for the produced file `sprites/ground.png` ({@link assetPath} spells it), so
 * two blits carry the same one exactly when they painted the same produced
 * file. `""` names a source this harness never served, which is a canvas or an
 * image the build made for itself. The rectangle is in DEVICE pixels, mapped
 * through the transform in force at the call, so `x + w / 2, y + h / 2` is its
 * center under any transform the build drew under; `transform` is that
 * transform, whose `a` is negative under a horizontal mirror.
 */
export interface Blit {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Whether image smoothing was on at the moment of this blit. */
  smoothing: boolean;
  /** The transform in force at the call. */
  transform: Matrix;
  /** Whether the transform mirrors the source across its vertical axis. */
  mirrored: boolean;
}

/** A cue the build played, and the frame of the drive it played it on. */
export interface TimedCue {
  /** The frame it sounded on, as {@link Harness.frame} counts them. */
  frame: number;
  /** The engine's simulated time at that frame, in milliseconds. */
  t: number;
  /** The cue's name, as the build declared and played it. */
  name: string;
  /** Whether this was the start of a loop, which is what the two beds are. */
  loop: boolean;
  /** The gain it sounded at. `0` while muted. */
  gain: number;
}

/**
 * One sound the engine's bus started on this harness's audio context: a
 * one-shot play or the source of a loop.
 *
 * `file` is the produced file the decoded buffer was served from, as the
 * engine resolved it (`assets/audio/hit.wav`), or `null` for a synthesized cue.
 * `cue` is the name the bus announced synchronously before starting it, or
 * `null` for a loop the unlock started without an announcement. This is what
 * decides that a cue plays the file of its own name: the bus binds a name to a
 * decoded buffer inside the engine, and the buffer's source is observable only
 * where it is started.
 */
export interface SoundStart {
  cue: string | null;
  file: string | null;
  loop: boolean;
  /** The frame it started on, as {@link Harness.frame} counts them. */
  frame: number;
}

/** One asset the build asked for and did not get. */
export interface AssetFailure {
  path: string;
  url: string;
  reason: string;
}

/** One asset the build asked for and got, as the engine announced it. */
export interface AssetLoaded {
  path: string;
  url: string;
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
// that decodes one, and an `AudioContext` that decodes a produced PCM `.wav` far
// enough for `api.audio.load` to bind the cue and then records what the bus
// starts. Each falls through to whatever the platform already had for anything
// it does not recognize.
//
// WHAT WOULD HAPPEN WITHOUT IT. Every produced file would fail to load, and
// every point about a produced sprite or a bound cue would fail every build
// ever written, a fact about Node rather than about the build. Every file the
// build committed is served to every harness this project builds, so a check
// that reads `assetFailures` is reading whether the build's own files loaded.

/**
 * The directory this harness sits in, which is the validator project's root.
 *
 * Taken from this module's own URL rather than from the working directory,
 * because it has to name the same directory in both layouts this file lives in:
 * the case's own `validation/<engine>/`, and the `validation/` the runner
 * stages that directory to inside the build's tree.
 */
export const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

/** The build's repository root, where `assets/`, `src/`, and `dist/` sit. */
export const WORKSPACE = resolve(PROJECT_ROOT, "..");

/**
 * Where a page-relative asset URL is looked for, in order: the repository root
 * first, because `specs/assets.md` puts every produced file under `assets/` at
 * the root and the loader asks for `assets/<path>`; `public/` and `dist/`
 * follow so a build that staged its tree for Vite is still loading its own
 * committed files rather than nothing.
 */
const ASSET_ROOTS = [".", "public", "dist"] as const;

/** A page-relative URL with its leading `./` dropped. */
function normalizeUrl(url: string): string {
  return url.replace(/^\.\//, "");
}

/** The URL the engine's loader asks for a produced file by, under its root. */
export function assetPath(path: string): string {
  return `assets/${path}`;
}

/** The committed file a produced path names, or `null` when the build shipped none. */
export function producedFile(path: string): string | null {
  return assetFile(assetPath(path));
}

/** Where a fetched body came from, so a decoded image can carry its source. */
const blobSource = new WeakMap<object, string>();

/** Where a fetched body's bytes came from, so a decoded sound can carry its source. */
const bufferSource = new WeakMap<ArrayBuffer, string>();

/** Where a decoded image came from, or absent for one the build painted. */
const imageSource = new WeakMap<object, string>();

/** Where a decoded sound came from, or absent for one the build synthesized. */
const audioSource = new WeakMap<object, string>();

/** The file a page-relative URL names, or `null` when no root holds it. */
function assetFile(url: string): string | null {
  const path = normalizeUrl(url);
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
 * One PCM `.wav` as the channel data an `AudioBuffer` reports.
 *
 * Enough of a decode to satisfy `api.audio.load`, which binds a cue name only
 * once its file decodes, and to let a check read the produced samples back
 * through the same host the build loads them with. Integer samples at 8, 16,
 * 24 and 32 bits and IEEE floats at 32 and 64 are read, in the plain and the
 * `WAVE_FORMAT_EXTENSIBLE` containers, which are the spellings the asset tools
 * write. Nothing here sounds.
 */
export function decodeWav(bytes: Uint8Array): {
  sampleRate: number;
  channels: number;
  frames: Float32Array[];
} {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    bytes.byteLength < 12 ||
    view.getUint32(0, false) !== 0x52494646 ||
    view.getUint32(8, false) !== 0x57415645
  ) {
    throw new Error("not a RIFF/WAVE file");
  }
  let sampleRate = 44100;
  let channels = 1;
  let bits = 16;
  let format = 1;
  let data: Uint8Array | null = null;
  let at = 12;
  while (at + 8 <= bytes.byteLength) {
    const id = view.getUint32(at, false);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (id === 0x666d7420) {
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
      // WAVE_FORMAT_EXTENSIBLE carries the real format in its sub-format GUID.
      if (format === 0xfffe && size >= 26)
        format = view.getUint16(body + 24, true);
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
  const read = (offset: number): number => {
    if (format === 3) {
      return bits === 64
        ? samples.getFloat64(offset, true)
        : samples.getFloat32(offset, true);
    }
    switch (bits) {
      case 8:
        return (samples.getUint8(offset) - 128) / 128;
      case 16:
        return samples.getInt16(offset, true) / 32768;
      case 24: {
        const low = samples.getUint16(offset, true);
        const high = samples.getInt8(offset + 2);
        return (high * 65536 + low) / 8388608;
      }
      case 32:
        return samples.getInt32(offset, true) / 2147483648;
      default:
        return 0;
    }
  };
  for (let i = 0; i < count; i += 1) {
    for (let c = 0; c < channels; c += 1) {
      frames[c][i] = read((i * channels + c) * bytesPerSample);
    }
  }
  return { sampleRate, channels, frames };
}

/**
 * The cue the bus announced most recently in the current synchronous turn, so
 * the sound it starts a moment later can be named. Cleared at every frame
 * boundary and before every key event, so a muted play, which is announced
 * and never started, cannot lend its name to a later sound.
 */
let announced: { cue: string; loop: boolean } | null = null;

/** Where the next audio context built records the sounds it starts. */
let nextSoundSink: SoundStart[] = [];

/** The frame counter the next audio context stamps its sounds with. */
let nextFrameOf: () => number = () => 0;

/** A node of the stub audio graph: enough surface for the bus's calls to land. */
class StubNode {
  connect(): void {}
  disconnect(): void {}
}

/** An `AudioParam` stand-in: every scheduling call is accepted and ignored. */
class StubParam {
  value = 0;
  setValueAtTime(): void {}
  linearRampToValueAtTime(): void {}
  exponentialRampToValueAtTime(): void {}
}

/** A stand-in for `AudioContext`, decoding produced files and recording starts. */
class StubAudioContext {
  readonly currentTime = 0;
  readonly destination = new StubNode();
  private readonly sink: SoundStart[];
  private readonly frameOf: () => number;

  constructor() {
    this.sink = nextSoundSink;
    this.frameOf = nextFrameOf;
  }

  resume(): Promise<void> {
    return Promise.resolve();
  }

  decodeAudioData(buffer: ArrayBuffer): Promise<AudioBuffer> {
    const { sampleRate, channels, frames } = decodeWav(new Uint8Array(buffer));
    const decoded = {
      sampleRate,
      numberOfChannels: channels,
      length: frames[0]?.length ?? 0,
      duration: (frames[0]?.length ?? 0) / sampleRate,
      getChannelData: (channel: number): Float32Array =>
        frames[channel] ?? new Float32Array(0),
    };
    const from = bufferSource.get(buffer);
    if (from !== undefined) audioSource.set(decoded, from);
    return Promise.resolve(decoded as unknown as AudioBuffer);
  }

  createGain(): StubNode & { gain: StubParam } {
    return Object.assign(new StubNode(), { gain: new StubParam() });
  }

  createOscillator(): StubNode & {
    type: string;
    frequency: StubParam;
    start(): void;
    stop(): void;
  } {
    const sink = this.sink;
    const frameOf = this.frameOf;
    return Object.assign(new StubNode(), {
      type: "sine",
      frequency: new StubParam(),
      start(): void {
        const named = announced;
        announced = null;
        sink.push({
          cue: named?.cue ?? null,
          file: null,
          loop: named?.loop ?? false,
          frame: frameOf(),
        });
      },
      stop(): void {},
    });
  }

  createBufferSource(): StubNode & {
    buffer: AudioBuffer | null;
    loop: boolean;
    start(): void;
    stop(): void;
  } {
    const sink = this.sink;
    const frameOf = this.frameOf;
    const source = Object.assign(new StubNode(), {
      buffer: null as AudioBuffer | null,
      loop: false,
      start(): void {
        const named = announced;
        announced = null;
        const buffer: unknown = source.buffer;
        sink.push({
          cue: named?.cue ?? null,
          file:
            buffer !== null && typeof buffer === "object"
              ? (audioSource.get(buffer) ?? null)
              : null,
          loop: named?.loop ?? source.loop,
          frame: frameOf(),
        });
      },
      stop(): void {},
    });
    return source;
  }
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
        throw new Error(`wick harness: nothing to fetch "${url}" with`);
      }
      return platformFetch(input as RequestInfo, init as RequestInit);
    }
    const bytes = readFileSync(file);
    const source = normalizeUrl(url);
    const blob = new Blob([bytes]);
    blobSource.set(blob, source);
    // The bytes a decode is handed carry their source, so a decoded sound can
    // be named by the file it came from at the moment the bus starts it.
    const bufferOf = (): ArrayBuffer => {
      const copy = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      bufferSource.set(copy, source);
      return copy;
    };
    Object.defineProperty(blob, "arrayBuffer", {
      value: (): Promise<ArrayBuffer> => Promise.resolve(bufferOf()),
      configurable: true,
    });
    return {
      ok: true,
      status: 200,
      blob: () => Promise.resolve(blob),
      arrayBuffer: () => Promise.resolve(bufferOf()),
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
  // against the host's own constructors, of which a bare Node process has
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

  host.AudioContext = StubAudioContext;
}

/**
 * The produced file a drawn source came from, or `""` for one this harness
 * never served, a canvas the build painted itself, reported as having drawn
 * something other than the produced file rather than as having drawn nothing.
 */
export function sourceId(source: unknown): string {
  if (source === null || typeof source !== "object") return "";
  return imageSource.get(source) ?? "";
}

/* -------------------------------------------------------------------------- */
/* The harness                                                                */
/* -------------------------------------------------------------------------- */
//
// One frame is one tick, on the spec's own advice: "a scenario pairs a
// ConstantClock of 1000 / 60 milliseconds with engine.advance, so one frame on
// playing consumes exactly one tick, and a clock of any other length poses a
// partial frame" (specs/instrumentation.md). Every duration this case states is
// a whole count of ticks under the timer rule, so a check asks for that count of
// frames and no arithmetic sits between the two. A check that is ABOUT the
// division of ticks into frames runs a frame of its own length through
// {@link Harness.frameOf}, or builds a harness with a clock of its own through
// {@link HarnessOptions.clock}.

export interface HarnessOptions {
  /** The clock each frame takes its delta from. Defaults to one tick a frame. */
  clock?: Clock;
  /** The element's laid-out CSS width. Defaults to the logical stage width. */
  cssWidth?: number;
  /** The element's laid-out CSS height. Defaults to the logical stage height. */
  cssHeight?: number;
  /** Device pixels per CSS pixel. Defaults to 1, one device pixel per unit. */
  dpr?: number;
  /**
   * The root the engine resolves every asset path under. Defaults to the
   * engine's own `assets/`.
   */
  assetRoot?: string;
  /**
   * Whether to give the engine the gesture that unlocks its audio once the game
   * has initialized, so the sounds the bus starts are recorded from the first
   * frame on. Defaults to `true`; the gesture is a key bound to no action, so
   * it changes no game state.
   */
  unlockAudio?: boolean;
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

/** A rectangle of the canvas, read back as RGBA bytes in row order. */
export interface PixelRect {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface Harness {
  readonly engine: Engine<WickState, WickSurface>;
  /** The engine's current state, read fresh on every access. */
  readonly state: DeepReadonly<WickState>;
  /**
   * The debug surface the BUILD returned beside its state, driven over the
   * engine: each pose runs through `engine.apply`, each reading is handed
   * `engine.state`.
   */
  readonly debug: WickDriver;
  /**
   * Why the build's surface cannot be driven, or `null` when it can: a fault in
   * the build, named so the point about the surface reports it and every other
   * point fails on it cleanly.
   */
  readonly surfaceFault: string | null;
  /**
   * The state the build booted into, read off the surface before any frame or
   * pose touched it, or `null` when the surface could not be read. `specs/ui.md`
   * says of the title screen "The game opens here", which is a fact about what
   * a fresh game OPENS on and not about what a `reset` puts it back to.
   */
  readonly boot: WickSnapshot | null;
  /** The real 2D context, for `getImageData`. Draw calls also reach it. */
  readonly ctx: SKRSContext2D;
  /** The surface the engine drew into, holding the last frame that ran. */
  readonly canvas: Canvas;
  /** The target the engine listens for keys on, for an event of any shape. */
  readonly keys: EventTarget;
  /** Every call and property set the render has made since the last clear. */
  readonly calls: DrawCall[];
  /** Every cue the build played, oldest first. */
  readonly cues: TimedCue[];
  /** Every sound the bus started on this harness's audio context, oldest first. */
  readonly sounds: SoundStart[];
  /** Every asset the build loaded, as the engine announced it, oldest first. */
  readonly assetsLoaded: AssetLoaded[];
  /** Every asset the build failed to load, oldest first. */
  readonly assetFailures: AssetFailure[];

  /** Whether the build has the cue `name` looping at this moment. */
  looping(name: string): boolean;
  /** Every cue looping at this moment, in the order they started. */
  loopingCues(): string[];
  /** How many loops the build has started since the engine was built. */
  loopStarts(): number;

  /** Frames run since the engine started. One frame on `playing` is one tick. */
  frame(): number;
  /** The simulated time those frames covered, in milliseconds. */
  timeMs(): number;

  /** A fresh read of the game's state through the case's `snapshot`. */
  snapshot(): WickSnapshot;
  /** `debug.reset`, with `seed` seeding the generator when given. */
  reset(seed?: number): void;
  /** Run `frames` frames of the harness's clock, back to back. */
  advance(frames: number): Promise<void>;
  /** Run `ticks` whole frames of the harness's clock, and read what they left. */
  tick(ticks?: number): Promise<WickSnapshot>;
  /**
   * Run one frame worth `seconds` of delta time, whatever the harness's clock,
   * and read what it left. How a check poses a partial frame, or a frame that
   * consumes several ticks at once: the clock is swapped for that one frame
   * and put back.
   */
  frameOf(seconds: number): Promise<WickSnapshot>;
  /** Run `count` frames worth `seconds` each, and read what they left. */
  framesOf(seconds: number, count: number): Promise<WickSnapshot>;
  /** Drive a tick at a time until `predicate` holds, or the budget is spent. */
  until(
    predicate: (snapshot: WickSnapshot) => boolean,
    options?: UntilOptions,
  ): Promise<UntilResult>;
  /**
   * Run `ticks` frames one at a time and hand back the snapshot after each,
   * in order, stopping early when `watch` answers `true`. What a check about
   * a SCHEDULE reads: the tick a hit lands, the tick a timer is due.
   */
  trace(
    ticks: number,
    watch?: (snapshot: WickSnapshot, tick: number) => boolean,
  ): Promise<WickSnapshot[]>;

  /**
   * Press a key (`KeyboardEvent.code`) and leave it down. `repeat` marks the
   * event as an OS auto-repeat; `key` is the character the event reports,
   * which the engine's bindings never read.
   */
  holdKey(code: string, options?: { repeat?: boolean; key?: string }): void;
  /** Release a key held by {@link Harness.holdKey}. */
  releaseKey(code: string): void;

  /**
   * Move the pointer to a LOGICAL STAGE point, `0` to `STAGE_W` across and `0`
   * to `STAGE_H` down, which are the coordinates specs/controls.md reads the
   * pointer in. Runs no frame: the rules are applied by the frame that follows,
   * so a check reads the move's effect after one {@link Harness.tick}.
   */
  movePointer(x: number, y: number, init?: PointerInit): void;
  /** Press the primary button at a logical stage point. Runs no frame. */
  pressPointer(x: number, y: number, init?: PointerInit): void;
  /** Release the primary button at a logical stage point. Runs no frame. */
  releasePointer(x: number, y: number, init?: PointerInit): void;
  /**
   * Turn the wheel by `x` and `y` of travel in LOGICAL STAGE UNITS, the units
   * specs/controls.md sums a frame's travel in. Runs no frame; the frame that
   * follows reads what accumulated.
   */
  turnWheel(x: number, y: number): void;

  /** Forget every call recorded so far. */
  clearCalls(): void;
  /** Run exactly one frame and hand back everything its render issued. */
  frameDraw(): Promise<FrameDraw>;
  /** Run exactly one frame and hand back the operations its render issued. */
  frameCalls(): Promise<DrawCall[]>;
  /** Run exactly one frame and hand back the bitmaps it blitted. */
  frameBlits(): Promise<Blit[]>;
  /** The operations the last frame that ran issued, without running one. */
  lastCalls(): DrawCall[];

  /** How the stage is mapped onto this harness's canvas. */
  viewport(): Viewport;
  /** Where a logical stage point lands in the canvas's backing store. */
  device(x: number, y: number): { x: number; y: number };
  /**
   * Where a world point is drawn on the stage under the camera formula of
   * specs/world.md, read against the lamplighter's current position:
   * `(wx − player.x + STAGE_CX, wy − player.y + STAGE_CY)`.
   */
  stagePoint(wx: number, wy: number): { x: number; y: number };
  /** The device pixel under a logical stage point, as `[r, g, b, a]`. */
  pixel(x: number, y: number): [number, number, number, number];
  /**
   * A rectangle of the canvas, addressed in logical stage units with its
   * top-left at `(x, y)`, read back as RGBA; at the default shape one device
   * pixel is one unit.
   */
  pixelRect(x: number, y: number, width: number, height: number): PixelRect;
  /** A pixel addressed in the canvas's own backing store, past the fit. */
  devicePixel(x: number, y: number): [number, number, number, number];

  /**
   * Every registered diagnostic and what it reports now, in registration
   * order, evaluated against the current state without drawing the overlay.
   */
  diagnostics(): readonly DiagnosticReading[];

  /** Give the engine the gesture that unlocks its audio. Changes no game state. */
  armAudio(): void;

  /** Drop the engine's listeners and release the canvas. */
  dispose(): void;
}

/** The extra cue sinks {@link onCue} opened, per harness. */
const cueSinks = new WeakMap<Harness, TimedCue[][]>();

/** A `KeyboardEvent`-shaped event: the engine reads `code` and `repeat`. */
class KeyEvent extends Event {
  readonly code: string;
  readonly key: string;
  readonly repeat: boolean;

  constructor(
    type: "keydown" | "keyup",
    code: string,
    options: { repeat?: boolean; key?: string } = {},
  ) {
    super(type);
    this.code = code;
    this.key = options.key ?? code;
    this.repeat = options.repeat ?? false;
  }
}

/**
 * What a pointer event carries beyond its position.
 *
 * `specs/controls.md` makes "a mouse, a pen, and a touch contact all reach the
 * menus on those coordinates", so a check drives the device the rule it decides
 * is about. The defaults are one primary mouse; a contact names
 * `pointerType: "touch"` and, while it travels, the held mask a finger in
 * contact carries.
 */
export interface PointerInit {
  pointerType?: "mouse" | "pen" | "touch";
  /** `0` is the primary button; a move reports `-1`, meaning none. */
  button?: number;
  /** The held-button mask: `1` while the primary button is down. */
  buttons?: number;
}

/**
 * A `PointerEvent`-shaped event.
 *
 * The engine reads a pointer event STRUCTURALLY: `clientX`/`clientY` place it,
 * `pointerId` and `isPrimary` identify the pointer, `pointerType` names the
 * device, and `button`/`buttons` say what is held. A move names no button, so
 * it carries `button` `-1` and an empty mask, exactly as a browser's does; a
 * primary press carries `button` `0` and `buttons` `1`, and the release that
 * ends it carries `button` `0` and an empty mask. A contact travelling across
 * the stage is a move with the primary mask held, which is what a finger in
 * contact reports.
 */
class PointerEventShape extends Event {
  readonly pointerId = 1;
  readonly isPrimary = true;
  readonly pointerType: string;
  readonly clientX: number;
  readonly clientY: number;
  readonly button: number;
  readonly buttons: number;

  constructor(
    type: "pointermove" | "pointerdown" | "pointerup",
    clientX: number,
    clientY: number,
    init: PointerInit = {},
  ) {
    super(type);
    this.clientX = clientX;
    this.clientY = clientY;
    this.pointerType = init.pointerType ?? "mouse";
    this.button = init.button ?? (type === "pointermove" ? -1 : 0);
    this.buttons = init.buttons ?? (type === "pointerdown" ? 1 : 0);
  }
}

/**
 * A `WheelEvent`-shaped event, its travel in CSS pixels.
 *
 * `deltaMode` is `0`, the pixel mode, so the engine takes the deltas as CSS
 * pixels and puts them through the same fit a position goes through.
 */
class WheelEventShape extends Event {
  readonly deltaMode = 0;
  readonly deltaX: number;
  readonly deltaY: number;

  constructor(deltaX: number, deltaY: number) {
    super("wheel");
    this.deltaX = deltaX;
    this.deltaY = deltaY;
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
 * passes, the design size, the build's exported `BACKGROUND`, and the touch
 * layout, plus the clock and the surface metrics a headless run needs. Nothing
 * is reset: the state handed back is the one the build booted into, and a
 * check that wants a known seed calls {@link Harness.reset} or one of the
 * scenario helpers, every one of which resets first.
 */
export async function createHarness(
  options: HarnessOptions = {},
): Promise<Harness> {
  installAssetHost();

  const cssWidth = options.cssWidth ?? STAGE_W;
  const cssHeight = options.cssHeight ?? STAGE_H;
  const dpr = options.dpr ?? 1;
  const baseClock = options.clock ?? new ConstantClock(TICK_MS);

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

  // The audio context the engine builds lazily records into this harness's own
  // list; the factory reads the module-level slot at construction, and the
  // engine builds its context during the game's initialization or at the
  // unlock below, both inside this call.
  const sounds: SoundStart[] = [];
  nextSoundSink = sounds;

  const engine = createEngine<WickState, WickSurface>({
    canvas: element,
    width: STAGE_W,
    height: STAGE_H,
    game,
    // The build's own stage background and the seeded layout, handed to the
    // engine exactly as the seeded `src/main.ts` hands them.
    background: BACKGROUND,
    layout: LAYOUT,
    clock: baseClock,
    surface,
    ...(options.assetRoot === undefined
      ? {}
      : { assetRoot: options.assetRoot }),
  });
  nextFrameOf = (): number => engine.frame().count;

  // Subscribed BEFORE `initialize`, which is what makes the game's own loading
  // and its opening sounds observable: construction runs no game code.
  const assetsLoaded: AssetLoaded[] = [];
  const assetFailures: AssetFailure[] = [];
  const cues: TimedCue[] = [];
  const sinks: TimedCue[][] = [];
  const loops: string[] = [];
  let loopStarts = 0;
  engine.events.on("asset:loaded", ({ path, url }) => {
    assetsLoaded.push({ path, url });
  });
  engine.events.on("asset:failed", ({ path, url, reason }) => {
    assetFailures.push({ path, url, reason });
  });
  const noteCue =
    (loop: boolean) => (played: { cue: string; t: number; gain: number }) => {
      const timed: TimedCue = {
        frame: engine.frame().count,
        t: played.t,
        name: played.cue,
        loop,
        gain: played.gain,
      };
      announced = { cue: played.cue, loop };
      if (loop) {
        loopStarts += 1;
        if (!loops.includes(played.cue)) loops.push(played.cue);
      }
      cues.push(timed);
      for (const sink of sinks) sink.push(timed);
    };
  engine.events.on("cue:played", noteCue(false));
  engine.events.on("cue:looped", noteCue(true));
  engine.events.on("cue:stopped", ({ cue }) => {
    const at = loops.indexOf(cue);
    if (at >= 0) loops.splice(at, 1);
  });

  await engine.initialize();

  const raw: unknown = engine.debug;
  const surfaceFault = readDebugSurface(raw);
  const debug =
    surfaceFault === null
      ? driveSurface(engine, raw as WickSurface)
      : unusableSurface(surfaceFault);
  const boot = surfaceFault === null ? debug.snapshot() : null;

  const dispatch = (
    type: "keydown" | "keyup",
    code: string,
    keyOptions?: { repeat?: boolean; key?: string },
  ): void => {
    announced = null;
    keys.dispatchEvent(new KeyEvent(type, code, keyOptions));
  };

  /**
   * The CSS point the page would report for a logical stage point, run through
   * the inverse of the fit the engine places an event by: a client position
   * becomes `((client - origin) * dpr - offset) / scale` on the stage, and this
   * surface states no `origin`. At the harness's default shape the fit is 1:1,
   * so a stage point IS its client point; a check that built its harness with a
   * `cssWidth`, `cssHeight`, or `dpr` of its own still lands where it aimed.
   */
  const clientOf = (x: number, y: number): { x: number; y: number } => {
    const view = engine.viewport();
    return {
      x: (view.offsetX + x * view.scale) / dpr,
      y: (view.offsetY + y * view.scale) / dpr,
    };
  };

  const dispatchPointer = (
    type: "pointermove" | "pointerdown" | "pointerup",
    x: number,
    y: number,
    init?: PointerInit,
  ): void => {
    announced = null;
    const at = clientOf(x, y);
    keys.dispatchEvent(new PointerEventShape(type, at.x, at.y, init));
  };

  /** Wheel travel, in stage units, as the CSS-pixel deltas an event carries. */
  const dispatchWheel = (x: number, y: number): void => {
    announced = null;
    const { scale } = engine.viewport();
    keys.dispatchEvent(
      new WheelEventShape((x * scale) / dpr, (y * scale) / dpr),
    );
  };

  let lastFrameStart = 0;
  let lastFrameEnd = 0;

  /** Run `frames` frames, keeping the boundary of the last one's operations. */
  const drive = async (frames: number): Promise<void> => {
    for (let i = 0; i < frames; i += 1) {
      announced = null;
      const start = calls.length;
      await engine.advance(1);
      lastFrameStart = start;
      lastFrameEnd = calls.length;
    }
  };

  /** Run one frame of `seconds`, under a clock swapped in for that frame alone. */
  const driveFrameOf = async (seconds: number): Promise<void> => {
    engine.setClock(new ConstantClock(seconds * 1000));
    try {
      await drive(1);
    } finally {
      engine.setClock(baseClock);
    }
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
    get state() {
      return engine.state;
    },
    debug,
    surfaceFault,
    boot,
    ctx,
    canvas,
    keys,
    calls,
    cues,
    sounds,
    assetsLoaded,
    assetFailures,

    looping: (name) => loops.includes(name),
    loopingCues: () => [...loops],
    loopStarts: () => loopStarts,

    frame: () => engine.frame().count,
    timeMs: () => engine.frame().timeMs,

    snapshot: () => debug.snapshot(),
    reset: (seed) => {
      debug.reset(seed === undefined ? undefined : { seed });
    },

    advance: (frames) => drive(frames),

    async tick(ticks = 1) {
      await drive(ticks);
      return debug.snapshot();
    },

    async frameOf(seconds) {
      await driveFrameOf(seconds);
      return debug.snapshot();
    },

    async framesOf(seconds, count) {
      for (let i = 0; i < count; i += 1) await driveFrameOf(seconds);
      return debug.snapshot();
    },

    async until(predicate, untilOptions = {}) {
      const maxTicks = untilOptions.maxTicks ?? 600;
      let snapshot = debug.snapshot();
      if (predicate(snapshot)) return { hit: true, ticks: 0, snapshot };
      for (let ticks = 1; ticks <= maxTicks; ticks += 1) {
        await drive(1);
        snapshot = debug.snapshot();
        if (predicate(snapshot)) return { hit: true, ticks, snapshot };
      }
      return { hit: false, ticks: maxTicks, snapshot };
    },

    async trace(ticks, watch) {
      const seen: WickSnapshot[] = [];
      for (let i = 0; i < ticks; i += 1) {
        await drive(1);
        const snapshot = debug.snapshot();
        seen.push(snapshot);
        if (watch?.(snapshot, i + 1) === true) break;
      }
      return seen;
    },

    holdKey: (code, keyOptions) => dispatch("keydown", code, keyOptions),
    releaseKey: (code) => dispatch("keyup", code),

    movePointer: (x, y, init) => dispatchPointer("pointermove", x, y, init),
    pressPointer: (x, y, init) => dispatchPointer("pointerdown", x, y, init),
    releasePointer: (x, y, init) => dispatchPointer("pointerup", x, y, init),
    turnWheel: (x, y) => dispatchWheel(x, y),

    clearCalls: () => {
      calls.length = 0;
    },
    async frameDraw() {
      calls.length = 0;
      await drive(1);
      return { calls: [...calls], blits: blitsOf(calls) };
    },
    async frameCalls() {
      calls.length = 0;
      await drive(1);
      return [...calls];
    },
    async frameBlits() {
      calls.length = 0;
      await drive(1);
      return blitsOf(calls);
    },
    lastCalls: () => calls.slice(lastFrameStart, lastFrameEnd),

    viewport: () => engine.viewport(),
    device: (x, y) => toDevice(engine.viewport(), x, y),
    stagePoint(wx, wy) {
      const { player } = debug.snapshot().run;
      return { x: wx - player.x + STAGE_CX, y: wy - player.y + STAGE_CY };
    },
    pixel(x, y) {
      const point = toDevice(engine.viewport(), x, y);
      return this.devicePixel(point.x, point.y);
    },
    pixelRect(x, y, width, height) {
      const view = engine.viewport();
      const origin = toDevice(view, x, y);
      return readRect(
        origin.x,
        origin.y,
        Math.max(1, Math.round(width * view.scale)),
        Math.max(1, Math.round(height * view.scale)),
      );
    },
    devicePixel: (x, y) => {
      const rect = readRect(Math.round(x), Math.round(y), 1, 1);
      return [rect.data[0], rect.data[1], rect.data[2], rect.data[3]];
    },

    diagnostics: () => engine.diagnostics(),

    armAudio: () => {
      // The engine opens its audio context on the first key or pointer event it
      // sees. The key is bound to nothing, so arming changes no game state.
      dispatch("keydown", UNBOUND_KEY);
      dispatch("keyup", UNBOUND_KEY);
    },

    dispose: () => engine.destroy(),
  };

  if (options.unlockAudio ?? true) harness.armAudio();

  cueSinks.set(harness, sinks);
  return harness;
}

/* -------------------------------------------------------------------------- */
/* Input, as a player's keys deliver it                                       */
/* -------------------------------------------------------------------------- */

/** The `KeyboardEvent.code` values specs/controls.md binds to `action`. */
export function keysOf(action: ActionName): readonly string[] {
  return BINDINGS[action];
}

/**
 * Press `code`, run the one frame that delivers its edge, and release it.
 *
 * The engine discards an edge nothing consumed by the end of the frame it was
 * armed in, so a tap that ran no frame would never reach the game. Every menu
 * action in `specs/controls.md` is a press EDGE, so one tap is one action.
 * Under this harness the delivering frame is one whole tick on `playing`.
 */
export async function tap(h: Harness, code: string): Promise<WickSnapshot> {
  h.holdKey(code);
  const after = await h.tick(1);
  h.releaseKey(code);
  return after;
}

/**
 * Press `code` and deliver its edge on a frame too short to consume a tick.
 *
 * What a check writes where the ARRIVAL is the thing it reads: "The frame's
 * update then runs on the screen the edges left ... a frame whose press enters
 * `playing` ... runs that frame's ticks" (specs/controls.md), so a press that
 * lights the lamp under {@link tap} leaves the run at tick `1` with the
 * director's first window already spawned, and a press that resumes a pause
 * leaves it one tick past where the pause left it. A frame of half a tick
 * delivers the same edge and consumes no tick, since "A tick is consumed while
 * the accumulator is at least `TICK_DT − TICK_EPSILON`"
 * (specs/instrumentation.md), so what the check reads is the state the
 * transition itself produced.
 */
export async function tapWithoutTick(
  h: Harness,
  code: string,
): Promise<WickSnapshot> {
  h.holdKey(code);
  try {
    return await h.frameOf(TICK_DT / 2);
  } finally {
    h.releaseKey(code);
  }
}

/**
 * Hold `code` down for `ticks` whole ticks, then release it.
 *
 * The movement actions are read as held values on `playing`, sampled once per
 * frame and applied to every tick the frame consumes, so the lamplighter walks
 * for exactly `ticks / 60` seconds of game time. The release dispatches after
 * the last held frame and delivers on the next frame the caller runs.
 */
export async function hold(
  h: Harness,
  code: string,
  ticks: number,
): Promise<WickSnapshot> {
  h.holdKey(code);
  try {
    return await h.tick(ticks);
  } finally {
    h.releaseKey(code);
  }
}

/** Hold several keys together for `ticks` whole ticks, then release them all. */
export async function holdTogether(
  h: Harness,
  codes: readonly string[],
  ticks: number,
): Promise<WickSnapshot> {
  for (const code of codes) h.holdKey(code);
  try {
    return await h.tick(ticks);
  } finally {
    for (const code of codes) h.releaseKey(code);
  }
}

/** Press the overlay's toggle once: one real key edge, one frame. */
export function pressToggle(h: Harness): Promise<WickSnapshot> {
  return tap(h, OVERLAY_TOGGLE_CODE);
}

/* -------------------------------------------------------------------------- */
/* The pointer, as a player's mouse delivers it                               */
/* -------------------------------------------------------------------------- */
//
// Every point below is a LOGICAL STAGE point: "The pointer is read in the
// stage's own coordinates, 0 to STAGE_W across and 0 to STAGE_H down, whatever
// the canvas's size on the page and wherever the letterbox bars fall, and wheel
// travel is read in those same units" (specs/controls.md, The pointer). The
// engine delivers the position and the travel already in those units, so the
// harness only has to undo the fit on the way in, which {@link Harness}'s four
// pointer members do.
//
// The three rules are applied "on every frame, after that frame's press edges
// and before its update", so a gesture reaches the game through the frame that
// follows it, exactly as a key edge does through {@link tap}. The helpers here
// therefore dispatch and then run one frame, and hand back what that frame
// left.

/**
 * The rectangles of the current screen's vertical menu, in menu order.
 *
 * On `almanac` these are the visible entry rows, so the rectangle at position
 * `i` belongs to the entry at `menuIndex` `almanacScroll + i`
 * (specs/instrumentation.md, Menus).
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
 * border, or rounding can put outside it.
 */
export function centerOf(rect: WickRect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/**
 * Rest the pointer on a logical stage point, run the one frame that reads it,
 * and hand back what that frame left.
 *
 * "The pointer inside the rectangle of the item at `menuIndex` `i`, with
 * `menuIndex` not `i`, sets `menuIndex` to `i` and plays `menu-move`"
 * (specs/controls.md). The pointer stays where it was put, so a second frame
 * reads the same rest, which is how a check decides that a hover that already
 * moved the highlight moves nothing again.
 */
export async function hoverAt(
  h: Harness,
  x: number,
  y: number,
): Promise<WickSnapshot> {
  h.movePointer(x, y);
  return h.tick(1);
}

/** Rest the pointer in the middle of a reported rectangle. */
export function hoverRect(h: Harness, rect: WickRect): Promise<WickSnapshot> {
  const at = centerOf(rect);
  return hoverAt(h, at.x, at.y);
}

/**
 * Click a logical stage point with the primary button, run the one frame that
 * reads the press edge, and hand back the snapshot that frame left.
 *
 * The move, the press, and the release are all delivered before the frame, the
 * way a real click between two frames arrives, so the frame sees the pointer at
 * the point AND the press edge armed there, and no contact is left open behind
 * it. "A primary press edge inside the rectangle of the item at `menuIndex` `i`
 * sets `menuIndex` to `i`, playing `menu-move` if that changed it, and then
 * takes that item exactly as `confirm` on it does" (specs/controls.md), and
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
  return h.tick(1);
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
  return h.tick(1);
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
  return h.tick(1);
}

/** Lift the primary button at a logical stage point, one driven frame. */
export async function liftAt(
  h: Harness,
  x: number,
  y: number,
): Promise<WickSnapshot> {
  h.releasePointer(x, y);
  return h.tick(1);
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
  return h.tick(1);
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
  return h.tick(1);
}

/** Lift the contact at a logical stage point, one driven frame. */
export async function touchLiftAt(
  h: Harness,
  x: number,
  y: number,
): Promise<WickSnapshot> {
  h.releasePointer(x, y, CONTACT);
  return h.tick(1);
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
 * Turn the wheel by `rows` rows of travel, run the one frame that reads it, and
 * hand back what that frame left.
 *
 * A frame's travel is "that frame's wheel deltas summed in stage units, divided
 * by `WHEEL_ROW` (`100`) and truncated toward zero to give the number of rows
 * `almanacScroll` moves, downward travel moving it toward the end of the list"
 * (specs/controls.md), so `rows` rows is `rows × WHEEL_ROW` of downward travel
 * and a negative `rows` is upward. A fractional `rows` is how a check poses the
 * remainder the rule discards.
 */
export function wheelBy(h: Harness, rows: number): Promise<WickSnapshot> {
  h.turnWheel(0, rows * WHEEL_ROW);
  return h.tick(1);
}

/* -------------------------------------------------------------------------- */
/* Posing a night                                                             */
/* -------------------------------------------------------------------------- */
//
// The rule the authoring guide states is that a validator poses an ISOLATED
// world: it clears every entity the requirement is not about and spawns back
// exactly what it is about, and it holds still the faculties the requirement
// does not exercise. The surface carries the operations that make that possible
// (the five `clear…` operations, `removeWeapon`, and the nine driver switches)
// and {@link isolate} is the one place they are all spoken in a single breath.

/** Set one driver switch through its own operation. */
export function setSwitch(h: Harness, name: SwitchName, on: boolean): void {
  const setter = h.debug[SWITCH_OPS[name]] as (on: boolean) => void;
  setter(on);
}

export interface IsolateOptions {
  /** The seed `reset` lays the generator with. Defaults to `DEFAULT_SEED`. */
  seed?: number;
  /**
   * The level the run is posed at. Left as the fresh run's `1` when it is not
   * given: an isolated world holds the level the check posed, because the
   * `progression` switch, not a level chosen to outrun the build's own
   * `xpToNext`, is what keeps an overlay from opening mid-scenario.
   */
  level?: number;
  /**
   * Whether to put Taper at level `1` in the first weapon slot. Defaults to
   * `false`: the isolated run holds no weapon at all unless a check holds the
   * one its requirement is about.
   */
  keepTaper?: boolean;
}

/**
 * Reset the game and pose an EMPTY `playing` run with every driver switch off:
 * no enemy, projectile, zone, gem, or pickup, no weapon held, no director,
 * nothing moving, nothing hitting, nothing firing, nothing dropping, and no
 * experience spent.
 *
 * The reset first, so nothing a previous section left is inherited; then the
 * atomic `setScreen("playing")`, which sets the screen and leaves the idle run
 * exactly as `reset` restored it; then the world is emptied and the nine
 * autonomous faculties held. A check spawns back exactly what its requirement
 * is about, holds the weapon it is about, and turns on exactly the switches
 * whose faculty IS the requirement.
 *
 * Nothing here is "parked" or "kept quiet": each faculty a scenario has to
 * hold is held by its own operation, so a build that computes a threshold
 * wrongly fails the check that decides that threshold and no other.
 */
export function isolate(
  h: Harness,
  options: IsolateOptions = {},
): WickSnapshot {
  h.reset(options.seed);
  h.debug.setScreen("playing");
  h.debug.clearEnemies();
  h.debug.clearProjectiles();
  h.debug.clearZones();
  h.debug.clearGems();
  h.debug.clearPickups();
  if (options.keepTaper ?? false) h.debug.setWeapon(0, "taper", 1);
  for (const name of SWITCH_NAMES) setSwitch(h, name, false);
  if (options.level !== undefined) h.debug.setLevel(options.level);
  return h.snapshot();
}

/** Turn the named driver switches on, leaving the others as they stand. */
export function enable(h: Harness, ...switches: readonly SwitchName[]): void {
  for (const name of switches) setSwitch(h, name, true);
}

/** Turn the named driver switches off, leaving the others as they stand. */
export function disable(h: Harness, ...switches: readonly SwitchName[]): void {
  for (const name of switches) setSwitch(h, name, false);
}

/**
 * Start a run the way a player does: reset to the title and `confirm` the
 * LIGHT THE LAMP entry with a real key press.
 *
 * The one compound sequence that presses keys rather than posing; it is what
 * the navigation and run-start points drive. A point about anything else
 * reaches its screen through {@link poseScene} or {@link isolate} instead,
 * because a build with a broken menu and a correct simulation must fail the
 * menu points and pass the others. The confirming frame runs the run's first
 * tick, as specs/controls.md states.
 */
export async function startPlay(
  h: Harness,
  seed?: number,
): Promise<WickSnapshot> {
  h.reset(seed);
  return tap(h, "Enter");
}

/**
 * Reset and set `screen` through the surface alone.
 *
 * The reset first, so the screen is set from the boot state and two poses of
 * the same scene read the same way. `setScreen` sets the screen and the three
 * cursors and nothing else, so this reaches the screens a run is not needed
 * for. The screens the game's own systems open are reached through the
 * sequences that open them: {@link openLevelUp}, {@link openChest},
 * {@link endFallen}, and {@link endDawn}.
 */
export function poseScene(
  h: Harness,
  screen: Exclude<Screen, "levelup" | "chest" | "fallen" | "dawn">,
): WickSnapshot {
  h.reset();
  h.debug.setScreen(screen);
  return h.snapshot();
}

/**
 * Begin a fresh run through the surface, the sequence specs/instrumentation.md
 * names: "a fresh run is `reset`, this pose to `playing`, and
 * `setWeapon(0, "taper", 1)`".
 *
 * The run a player starts on `LIGHT THE LAMP`, composed here rather than asked
 * of one operation: `setScreen` sets the screen alone, so the loadout the
 * fresh run carries is put there by the pose that puts weapons in slots.
 */
export function freshRun(h: Harness, seed?: number): WickSnapshot {
  h.reset(seed);
  h.debug.setScreen("playing");
  h.debug.setWeapon(0, "taper", 1);
  return h.snapshot();
}

/**
 * End the run the way the rule ends it: `hp` posed to `0` and one `playing`
 * tick, "the fallen ending is `setHp` at `0` and one tick"
 * (specs/instrumentation.md). The ENDING is the outcome the tick decides, so a
 * check that wants the end screen stands on the rule rather than around it.
 */
export async function endFallen(h: Harness): Promise<WickSnapshot> {
  h.debug.setHp(0);
  return h.tick(1);
}

/**
 * End the run at dawn the way the rule ends it: the clock posed to the tick
 * before `DAWN_TICK` and one `playing` tick, "the dawn ending is `setTick` at
 * `DAWN_TIME × TICK_HZ − 1` (`35999`) and one tick"
 * (specs/instrumentation.md).
 */
export async function endDawn(h: Harness): Promise<WickSnapshot> {
  h.debug.setTick(DAWN_TICK - 1);
  return h.tick(1);
}

/**
 * Queue `count` level-ups on a `playing` run and run the tick that opens the
 * overlay, the real path: "A playing tick that ends with pendingLevelUps above
 * 0 runs to completion and then opens the overlay" (specs/progression.md).
 */
export async function openLevelUp(
  h: Harness,
  count = 1,
): Promise<WickSnapshot> {
  h.debug.setPendingLevelUps(count);
  return h.tick(1);
}

/**
 * Place a chest at the lamplighter's center and run the tick that collects it,
 * the real path to the chest overlay: the collection, the result, and
 * `screen` `chest` all come from that tick.
 */
export async function openChest(h: Harness): Promise<WickSnapshot> {
  const { player } = h.snapshot().run;
  h.debug.spawnPickup("chest", player.x, player.y);
  return h.tick(1);
}

/** Put `id` at `level` in the first free weapon slot; the slot it took. */
export function holdWeapon(h: Harness, id: WeaponId, level = 1): number {
  const slot = h.snapshot().run.weapons.length;
  h.debug.setWeapon(slot, id, level);
  return slot;
}

/** Put `id` at `level` in the first free passive slot; the slot it took. */
export function holdPassive(h: Harness, id: PassiveId, level = 1): number {
  const slot = h.snapshot().run.passives.length;
  h.debug.setPassive(slot, id, level);
  return slot;
}

/** The slot `id` is held in, or `-1`. */
export function weaponSlot(snapshot: WickSnapshot, id: WeaponId): number {
  return snapshot.run.weapons.findIndex((held) => held.id === id);
}

/** The slot `id` is held in, or `-1`. */
export function passiveSlot(snapshot: WickSnapshot, id: PassiveId): number {
  return snapshot.run.passives.findIndex((held) => held.id === id);
}

/**
 * Make the weapon in `slot` fire on the next `playing` tick: its timer posed to
 * `0` and `weaponFire` on. "setWeaponCooldown(slot, 0) makes that the next
 * tick" (specs/instrumentation.md).
 */
export function armWeapon(h: Harness, slot: number): void {
  h.debug.setWeaponCooldown(slot, 0);
  h.debug.setWeaponFire(true);
}

/** Spawn one enemy of `type` at `(x, y)` through the surface; its id. */
export function spawnEnemyAt(
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
export function spawnEnemyNear(
  h: Harness,
  type: EnemyId,
  dx: number,
  dy: number,
): number {
  const { player } = h.snapshot().run;
  return spawnEnemyAt(h, type, player.x + dx, player.y + dy);
}

/** Place one gem of `tier` at `(x, y)` through the surface; its id. */
export function spawnGemAt(
  h: Harness,
  tier: GemTier,
  x: number,
  y: number,
): number {
  const id = h.snapshot().run.nextId;
  h.debug.spawnGem(tier, x, y);
  return id;
}

/** Place one pickup of `kind` at `(x, y)` through the surface; its id. */
export function spawnPickupAt(
  h: Harness,
  kind: PickupKind,
  x: number,
  y: number,
): number {
  const id = h.snapshot().run.nextId;
  h.debug.spawnPickup(kind, x, y);
  return id;
}

/**
 * Add one projectile of `weapon` at `(x, y)` with velocity `(vx, vy)` and
 * `pierce` through the surface; its id. Its figures are the ones the weapon
 * would give a projectile fired on this tick (specs/instrumentation.md,
 * `spawnProjectile`), and it first moves and first hits on the next tick.
 */
export function spawnProjectileAt(
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

/**
 * Add one puddle of `weapon` at `(x, y)` through the surface; its id. It
 * pulses first on the next tick (specs/instrumentation.md, `spawnPuddle`).
 */
export function spawnPuddleAt(
  h: Harness,
  weapon: PuddleWeapon,
  x: number,
  y: number,
): number {
  const id = h.snapshot().run.nextId;
  h.debug.spawnPuddle(weapon, x, y);
  return id;
}

/**
 * `value`, or the item failed: what a check writes where it reads an entity it
 * posed or expects and goes on to read that entity's fields. The failure is
 * `assertDefined`'s, with `what` as its context, and the return is the value
 * narrowed for the reads that follow.
 */
export function present<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) fail(`a value (${what})`, value);
  return value;
}

/** The enemy `id` names in `snapshot`, or `undefined` once it is gone. */
export function enemyById(
  snapshot: WickSnapshot,
  id: number,
): EnemySnapshot | undefined {
  return snapshot.run.enemies.find((enemy) => enemy.id === id);
}

/** The projectile `id` names in `snapshot`, or `undefined` once it is gone. */
export function projectileById(
  snapshot: WickSnapshot,
  id: number,
): ProjectileSnapshot | undefined {
  return snapshot.run.projectiles.find((projectile) => projectile.id === id);
}

/** The zone `id` names in `snapshot`, or `undefined` once it is gone. */
export function zoneById(
  snapshot: WickSnapshot,
  id: number,
): ZoneSnapshot | undefined {
  return snapshot.run.zones.find((zone) => zone.id === id);
}

/** Every zone of `kind`, ascending by id. */
export function zonesOfKind(
  snapshot: WickSnapshot,
  kind: ZoneKind,
): ZoneSnapshot[] {
  return snapshot.run.zones.filter((zone) => zone.kind === kind);
}

/** Every zone `weapon` produced, ascending by id. */
export function zonesOf(
  snapshot: WickSnapshot,
  weapon: WeaponId,
): ZoneSnapshot[] {
  return snapshot.run.zones.filter((zone) => zone.weapon === weapon);
}

/** Every projectile `weapon` fired, ascending by id. */
export function projectilesOf(
  snapshot: WickSnapshot,
  weapon: WeaponId,
): ProjectileSnapshot[] {
  return snapshot.run.projectiles.filter(
    (projectile) => projectile.weapon === weapon,
  );
}

/** The nine switches as the snapshot reports them, by name. */
export function switchesOf(
  snapshot: WickSnapshot,
): Record<SwitchName, boolean> {
  return {
    spawning: snapshot.spawning,
    events: snapshot.events,
    despawning: snapshot.despawning,
    enemyMotion: snapshot.enemyMotion,
    enemyContact: snapshot.enemyContact,
    weaponFire: snapshot.weaponFire,
    effectMotion: snapshot.effectMotion,
    drops: snapshot.drops,
    progression: snapshot.progression,
  };
}

/** The stored fields of a run, in the order specs/state.md's idle table lists them. */
export interface RunFields {
  tick: number;
  level: number;
  xp: number;
  kills: number;
  player: PlayerSnapshot;
  hurtFlash: number;
  weapons: WeaponSnapshot[];
  passives: PassiveSnapshot[];
  enemies: EnemySnapshot[];
  projectiles: ProjectileSnapshot[];
  zones: ZoneSnapshot[];
  gems: GemSnapshot[];
  pickups: PickupSnapshot[];
  offers: OfferId[];
  nextOffers: OfferId[] | null;
  pendingLevelUps: number;
  chestResult: ChestResult | null;
  spawnTimer: number;
  firedEvents: number[];
  nextId: number;
}

/**
 * The twenty STORED fields of a run, projected off a snapshot, for comparison
 * against the `IDLE_RUN` and `FRESH_RUN` of `constants.ts`.
 *
 * The derived readings (`time`, `xpToNext`, `maxHp`, `armor`, `moveSpeed`,
 * `pickupRadius`, `spawnWindow`, `aliveCommons`, `pool`) are left out, because
 * specs/state.md's idle table and specs/ui.md's fresh run each fix the stored
 * fields and the derivations follow from them; a check about a derivation is the
 * snapshot's own.
 */
export function runFields(run: RunSnapshot): RunFields {
  return {
    tick: run.tick,
    level: run.level,
    xp: run.xp,
    kills: run.kills,
    player: run.player,
    hurtFlash: run.hurtFlash,
    weapons: run.weapons,
    passives: run.passives,
    enemies: run.enemies,
    projectiles: run.projectiles,
    zones: run.zones,
    gems: run.gems,
    pickups: run.pickups,
    offers: run.offers,
    nextOffers: run.nextOffers,
    pendingLevelUps: run.pendingLevelUps,
    chestResult: run.chestResult,
    spawnTimer: run.spawnTimer,
    firedEvents: run.firedEvents,
    nextId: run.nextId,
  };
}

/* -------------------------------------------------------------------------- */
/* Geometry, as specs/world.md and specs/weapons.md fix the conventions       */
/* -------------------------------------------------------------------------- */
//
// The plane has x to the right and y downward, the same axes as the stage.
// Angles are in degrees, 0 along +x and positive toward +y, which is clockwise
// on screen (specs/weapons.md, The nearest enemy).

export interface Point {
  x: number;
  y: number;
}

/** Degrees to radians. */
const RAD = Math.PI / 180;

/** The Euclidean distance between two points. */
export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** The unit vector of `(x, y)`; `(0, 0)` for a zero vector. */
export function unit(x: number, y: number): Point {
  const length = Math.hypot(x, y);
  return length === 0 ? { x: 0, y: 0 } : { x: x / length, y: y / length };
}

/** `deg` normalized into `[0, 360)`. */
export function normalizeDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/**
 * The signed wrap-aware angular offset from `fromDeg` to `toDeg`, in
 * `[-180, 180)`, the reading a lantern's revolution is compared by.
 */
export function angularOffset(fromDeg: number, toDeg: number): number {
  return ((((toDeg - fromDeg) % 360) + 540) % 360) - 180;
}

/** The angle of `point` about `center`, in degrees in `[0, 360)`. */
export function angleAbout(center: Point, point: Point): number {
  return normalizeDeg(Math.atan2(point.y - center.y, point.x - center.x) / RAD);
}

/** The point at `distance` from `center` along `deg`. */
export function pointAt(
  center: Point,
  distanceFrom: number,
  deg: number,
): Point {
  return {
    x: center.x + distanceFrom * Math.cos(deg * RAD),
    y: center.y + distanceFrom * Math.sin(deg * RAD),
  };
}

/** `(x, y)` rotated by `deg` degrees, positive toward +y. */
export function rotate(vector: Point, deg: number): Point {
  const cos = Math.cos(deg * RAD);
  const sin = Math.sin(deg * RAD);
  return {
    x: vector.x * cos - vector.y * sin,
    y: vector.x * sin + vector.y * cos,
  };
}

/**
 * Where a world point is drawn on the stage under the camera formula of
 * specs/world.md, given the lamplighter's center.
 */
export function worldToStage(player: Point, wx: number, wy: number): Point {
  return { x: wx - player.x + STAGE_CX, y: wy - player.y + STAGE_CY };
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
function through(m: Matrix, x: number, y: number): Point {
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
 * drawn under a rotation or a mirror still reports the square of the canvas
 * it covered.
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
    // The transform mirrors horizontally when its x axis and y axis have
    // opposite handedness: a negative determinant.
    const [a, b, c, d] = at.transform;
    blits.push({
      id: sourceId(call.args[0]),
      x,
      y,
      w: Math.max(...xs) - x,
      h: Math.max(...ys) - y,
      smoothing: at.smoothing,
      transform: at.transform,
      mirrored: a * d - b * c < 0,
    });
  }
  return blits;
}

/** Where a blit's center landed, in device pixels. */
export function blitCenter(blit: Blit): Point {
  return { x: blit.x + blit.w / 2, y: blit.y + blit.h / 2 };
}

/** Every blit of the produced file at `path`, relative to the `assets/` root. */
export function blitsOfFile(blits: readonly Blit[], path: string): Blit[] {
  const id = assetPath(path);
  return blits.filter((blit) => blit.id === id);
}

/**
 * Every blit of a produced file under the directory `dir`, relative to the
 * `assets/` root: how a blit is attributed to a SHEET whatever frame of it was
 * drawn, `sprites/lamplighter` for the idle sprite and every walk frame alike.
 */
export function blitsUnderDir(blits: readonly Blit[], dir: string): Blit[] {
  const prefix = `${assetPath(dir)}/`;
  return blits.filter((blit) => blit.id.startsWith(prefix));
}

/** A blit's box in logical stage units, past the viewport fit. */
export function blitBoxOnStage(
  h: Harness,
  blit: Blit,
): { x: number; y: number; w: number; h: number } {
  const view = h.viewport();
  return {
    x: (blit.x - view.offsetX) / view.scale,
    y: (blit.y - view.offsetY) / view.scale,
    w: blit.w / view.scale,
    h: blit.h / view.scale,
  };
}

/** Where a blit's center landed, in logical stage units. */
export function blitCenterOnStage(h: Harness, blit: Blit): Point {
  const box = blitBoxOnStage(h, blit);
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

/**
 * Every blit whose center landed within `within` logical units of the logical
 * stage point `(x, y)`: how a blit is attributed to the enemy, gem, or effect
 * it was drawn on, since every produced sprite is drawn centered on the thing
 * it depicts (specs/assets.md).
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
 * The produced file painted nearest to and within `within` units of the stage
 * point `(x, y)`, or `null` when no blit landed there. The LAST such blit,
 * because that is the one a player sees.
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

/**
 * Whether the frame drew the words of `phrase`, in order, whatever runs of text
 * it split them across and whatever it separated them with.
 *
 * What a check about a piece of the case's COPY reads. The specification fixes
 * the words a screen shows (`THE LAMP BURNS BRIGHTER`, `LEVEL 4`) and, by
 * "Wick fixes no palette, no font, and no styling for any screen, and each
 * screen's layout is yours" (specs/ui.md), nothing about how they are laid
 * out, so a build is free to
 * wrap a heading over two lines, draw a tag's label and its number as two runs,
 * or put a marker between them. The frame's runs are read as one corpus and the
 * words are matched in order with any non-alphanumeric separator between them,
 * so every layout of the stated copy passes and a build that shows other words
 * fails.
 */
export function drewPhrase(
  calls: readonly DrawCall[],
  phrase: string,
): boolean {
  const words = phrase.match(/[A-Za-z0-9]+/g);
  if (words === null || words.length === 0) return false;
  const pattern = new RegExp(
    `(?<![A-Za-z0-9])${words.join("[^A-Za-z0-9]+")}(?![A-Za-z0-9])`,
    "i",
  );
  return pattern.test(drawnText(calls).join(" "));
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
 * Every run of text the frame drew that holds `text`, ignoring case.
 *
 * What a check about WHERE a piece of copy sits reads: a build commonly draws
 * one run twice, a shadow under the face of it, and commonly wraps a marker
 * around the item at `menuIndex`, so a run is attributed to the copy it
 * contains rather than matched whole.
 */
export function textDrawsOf(
  calls: readonly DrawCall[],
  text: string,
): TextDraw[] {
  const wanted = text.trim().toLowerCase();
  return textDraws(calls).filter((draw) =>
    draw.text.toLowerCase().includes(wanted),
  );
}

/**
 * The topmost anchor a piece of copy was drawn at, in device pixels, or `null`
 * when the frame drew it nowhere. How a check reads the ORDER two stacked runs
 * of copy sit in.
 */
export function topAnchorOf(
  calls: readonly DrawCall[],
  text: string,
): number | null {
  const draws = textDrawsOf(calls, text);
  return draws.length === 0 ? null : Math.min(...draws.map((draw) => draw.y));
}

/**
 * The multiset difference `a` minus `b`: every string of `a` that `b` does not
 * account for, occurrence by occurrence. Reading the overlay as the difference
 * between a frame with the panel and one without it keeps the game's own text,
 * the HUD or a menu, out of the corpus, even where the two show one value.
 */
export function minusLines(
  a: readonly string[],
  b: readonly string[],
): string[] {
  const counts = new Map<string, number>();
  for (const line of b) counts.set(line, (counts.get(line) ?? 0) + 1);
  const extra: string[] = [];
  for (const line of a) {
    const held = counts.get(line) ?? 0;
    if (held > 0) counts.set(line, held - 1);
    else extra.push(line);
  }
  return extra;
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
 * Whether `value` appears in `lines` as its own token: digit runs match whole
 * (`48` is found in `48 units` and not in `348`), words match case-insensitively.
 * A figure is looked for as any of its {@link spellings}, so a build that groups
 * a figure's digits shows the same figure; the bound either side is unchanged,
 * so `50` is still not found in `150`.
 */
export function hasToken(lines: readonly string[], value: string): boolean {
  return spellings(value).some((written) => {
    const escaped = written.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(?<![\\w])${escaped}(?![\\w])`, "i");
    return lines.some((line) => pattern.test(line));
  });
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
/* Colour and pixels                                                          */
/* -------------------------------------------------------------------------- */
//
// `specs/ui.md`: "Wick fixes no palette, no font, and no styling for any
// screen." So nothing here reads a hex value. What the appearance points may
// assert is PRESENCE and DISTINGUISHABILITY, and the readings below are what
// that is decided with: a colour at a point, the pixels of a rectangle, and how
// many of two rectangles' pixels differ.

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

/** The colour rendered at the logical stage point `(x, y)`. */
export function samplePoint(h: Harness, x: number, y: number): Rgb {
  const [r, g, b] = h.pixel(x, y);
  return { r, g, b };
}

/** The colour a CSS `#rrggbb` string names, or `null` for any other spelling. */
export function parseHex(color: string): Rgb | null {
  const match = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (match === null) return null;
  const value = parseInt(match[1], 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

/** How many pixels of two equally sized rectangles differ in any channel. */
export function pixelsDiffering(a: PixelRect, b: PixelRect): number {
  if (a.width !== b.width || a.height !== b.height) {
    return Math.max(a.width * a.height, b.width * b.height);
  }
  let differing = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (
      a.data[i] !== b.data[i] ||
      a.data[i + 1] !== b.data[i + 1] ||
      a.data[i + 2] !== b.data[i + 2] ||
      a.data[i + 3] !== b.data[i + 3]
    ) {
      differing += 1;
    }
  }
  return differing;
}

/** Whether two rectangles hold exactly the same pixels. */
export function rectsEqual(a: PixelRect, b: PixelRect): boolean {
  return pixelsDiffering(a, b) === 0;
}

/** `rect` reflected across its vertical axis, column for column. */
export function mirrorRect(rect: PixelRect): PixelRect {
  const data = new Uint8ClampedArray(rect.data.length);
  for (let y = 0; y < rect.height; y += 1) {
    for (let x = 0; x < rect.width; x += 1) {
      const from = (y * rect.width + x) * 4;
      const to = (y * rect.width + (rect.width - 1 - x)) * 4;
      data[to] = rect.data[from];
      data[to + 1] = rect.data[from + 1];
      data[to + 2] = rect.data[from + 2];
      data[to + 3] = rect.data[from + 3];
    }
  }
  return { width: rect.width, height: rect.height, data };
}

/** How many pixels of `rect` are not fully transparent. */
export function paintedPixels(rect: PixelRect): number {
  let painted = 0;
  for (let i = 3; i < rect.data.length; i += 4) {
    if (rect.data[i] !== 0) painted += 1;
  }
  return painted;
}

/**
 * The pixels of a produced image file, decoded by the same canvas library the
 * engine draws with, or `null` when the file is absent or is no image. A PNG
 * has a dozen legal spellings and `specs/assets.md` fixes the picture rather
 * than the spelling, so the file is read off disk and handed to the decoder
 * rather than parsed here.
 */
export async function imagePixels(file: string): Promise<PixelRect | null> {
  let bytes: Buffer;
  try {
    bytes = readFileSync(file);
  } catch {
    return null;
  }
  let image: Image;
  try {
    image = await loadImage(bytes);
  } catch {
    return null;
  }
  const scratch = createCanvas(
    Math.max(1, image.width),
    Math.max(1, image.height),
  );
  const into = scratch.getContext("2d");
  into.drawImage(image, 0, 0);
  const pixels = into.getImageData(0, 0, scratch.width, scratch.height);
  return {
    width: image.width,
    height: image.height,
    data: new Uint8ClampedArray(pixels.data),
  };
}

/* -------------------------------------------------------------------------- */
/* Cues and sounds                                                            */
/* -------------------------------------------------------------------------- */
//
// `specs/ui.md` fixes the fifteen cue names, and the file that specifies each
// event fixes the cue it plays. Under this engine the build declares each by
// name and plays it by name, and the engine announces every play, so what a
// check reads is WHICH cue sounded, without a decoder. "A cue is played by a
// tick or a frame, never by a pose of the debug surface" (specs/ui.md), so a
// scenario arranges, then steps, then reads.

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

/** Every sound the bus started for the cue `name`, oldest first. */
export function soundsOf(h: Harness, name: string): SoundStart[] {
  return h.sounds.filter((sound) => sound.cue === name);
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
export const MEDIA_DIR_ENV = "TCAB_VALIDATION_MEDIA_DIR";

/**
 * The directory the runner stages this project to inside the build's tree.
 *
 * A recording is addressed by the STAGED path of the suite that produced it,
 * `validation/<suite>.test.ts`, because that is the path the review item's
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
 * for many seconds of game time runs to tens of megabytes, a file nobody can
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
 * entries deduplicated. Exported for the suite beside this file.
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
 * always kept, it is the frame the check's sweep stopped at, and takes the
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
    console.warn(`wick: could not write ${destination}: ${String(error)}`);
  }
}

/**
 * Record the frames `act` draws and keep them as the review item's `outputId`
 * output, handing back whatever the scenario returned.
 *
 * Wrap the drive, not the arrangement:
 *
 * ```ts
 * const after = await captureReplay(h, "period", () => h.tick(81));
 * assertEqual(zonesOfKind(after, "slash").length, 1);
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
 * output, for a point whose evidence is one PICTURE rather than a stretch of
 * motion. Call it after the frame that poses the thing under test (a
 * `frameDraw()` or a `tick()` following the arrangement) and before the
 * assertions, so a check that fails still leaves the picture that shows why.
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

/**
 * Keep `canvas` as the review item's `outputId` output, for a point about
 * FILES rather than about a frame the game drew: a sheet's frames laid side
 * by side, an icon set over a checkerboard.
 */
export function captureCanvas(canvas: Canvas, outputId: string): void {
  const destination = mediaDestination(outputId, "png");
  if (destination === null) return;
  try {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, canvas.toBuffer("image/png"));
  } catch (error) {
    console.warn(`wick: could not write ${destination}: ${String(error)}`);
  }
}
