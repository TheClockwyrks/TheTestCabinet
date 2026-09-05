// Orrery — the case's half of the validator harness, under the STRUCTURED 2D
// engine. CASE-PROVIDED.
//
// Every check in this project is an ordinary vitest test that runs IN THE SAME
// PROCESS as the build. It imports the engine and the build's own `src/game.ts`,
// creates an engine over a canvas it owns and a clock it chose, and steps the game
// with `engine.advance`. Nothing drives a browser, nothing polls, and no
// wall-clock time passes: a check asks for a number of frames and gets exactly
// that number, at exactly the deltas it named.
//
// WHAT A SUITE HOLDS IS ORRERY'S {@link Harness}, NOT THE ENGINE'S. Orrery ships
// three validator projects and one review item's suite is the SAME TEXT in all
// three, so every member below carries the same name, the same arguments and the
// same return shape as `validation/none/harness.ts` and
// `validation/structured-2d/harness.ts` expose. That is why every one of them
// answers a PROMISE even where nothing here has anything to wait for: a suite
// that awaited under one engine and did not under another would be two suites.
//
// THE WORLD IS LIVE, AND THAT IS WHY THE DRIVER IS THIN.
// `specs/instrumentation.md` under this engine has every operation act "on the
// live game at the moment it is called": a pose takes only the arguments its row
// names and returns nothing, and a reading returns plain data. So
// {@link driveSurface} adds exactly one thing — the promise every member of
// {@link OrreryDriver} answers in all three projects — and nothing else stands
// between a check and the object the build returned.
//
// Orrery runs in ONE WORLD for the whole session. The game registers a single
// level, never opens another, and every screen is a value of `state.screen`
// (`specs/state.md`), so `engine.world` and `engine.world.state` are the same
// objects from `initialize` to `destroy` — which is what lets this harness expose
// them as live references rather than as snapshots.
//
// WHERE THE SURFACE COMES FROM. Off `engine.debug`, never built here. The
// instance's `initialize` returns it, the engine keeps that same object, and
// reading it back off the engine is the only way a surface reaches a check — so a
// build that returned no surface, or one missing an operation, fails the checks
// that reach the game through it. `surface.ts` is the specification as types, and
// it is the only description of the surface this project reads: the build's own
// module for it is never imported.
//
// THE PRODUCED FILES REALLY LOAD. A bare Node process cannot fetch or decode one,
// so without help every produced sprite and every cue would fail to load and every
// point about them would fail every build ever written — a fact about Node rather
// than about the build. {@link installAssetHost} supplies the three things a
// browser gives the engine's loader: a `fetch` that reads the file the build
// committed, a `createImageBitmap` that decodes one, and an `AudioContext` that
// decodes a produced `.wav` far enough for the cue to bind. Every request the
// loader makes is recorded and then served, so a check that needs to know WHICH
// file the build asked for reads {@link Harness.assetRequests} and the load still
// succeeds.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import {
  createCanvas,
  Image,
  loadImage,
  type Canvas,
  type SKRSContext2D,
} from "@napi-rs/canvas";
import {
  createEngine,
  type Clock,
  type Engine,
  type GameDefinition,
  type GameInstance,
  type GameState,
  type RecordedFrame,
  type Recording,
  type SurfaceMetrics,
  type World,
} from "@test-cabinet/structured-2d";
import { BACKGROUND, game as build } from "../src/game";
import { fail } from "./assert";
import { INERT_KEY, LAYOUT, STAGE_H, STAGE_W, TICK_HZ } from "./constants";
import type { OrreryDriver } from "./driver";
import type { StagePoint } from "./field";
import { mediaDestination, WORKSPACE } from "./media";
import type { OrrerySnapshot } from "./snapshot";
import { REQUIRED_OPS, type OrrerySurface } from "./surface";
import type { DrawCall, ImageRef } from "./drawing";
import type { Pixel, PixelRect } from "./color";
import { fitViewport, toCss, toDevice, type Viewport } from "./viewport";
import type { TimedCue, UntilOptions, UntilResult } from "./scenario";

export * from "./scenario";
export * from "./media";
export * from "./drawing";
export * from "./color";
export * from "./viewport";
export * from "./snapshot";
export type { OrreryDriver };
export { REQUIRED_OPS };

/** The case's surface, exactly as `surface.ts` specifies it. */
export type OrrerySurfaceOf = OrrerySurface;

/**
 * The build's game definition, typed against the surface the CASE specifies.
 *
 * The build declares its own `OrreryDebugApi`, and that type is the build's: what
 * a check holds it to is `surface.ts`, so the definition is cast here and the
 * engine is parameterized with it. An operation the build spelled differently is
 * caught where a check reaches for it, not by the build's own compiler.
 */
const game = build as unknown as GameDefinition<OrrerySurfaceOf>;

/* -------------------------------------------------------------------------- */
/* Serving the produced tree to the engine's loader                           */
/* -------------------------------------------------------------------------- */

/**
 * Where a page-relative asset URL is looked for, in order: the repository root
 * first, because `specs/assets.md` puts every produced file under `assets/` at
 * the root and the loader asks for `assets/<path>`; `public/` and `dist/` follow
 * so a build that staged its tree for Vite is still loading its own committed
 * files rather than nothing.
 */
const ASSET_ROOTS = [".", "public", "dist"] as const;

/** Where a fetched body came from, so a decoded image can carry its source. */
const blobSource = new WeakMap<object, string>();

/** Where a decoded image came from, or absent for one the build painted itself. */
const imageSource = new WeakMap<object, string>();

/**
 * Every page-relative URL the build's loader has asked for, oldest first.
 *
 * The transport below records each request and then serves it. Reset as a harness
 * is built, because the shim is installed once per process and a check reads what
 * THIS run of the build reached for.
 */
let requested: string[] = [];

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
 * Enough of a decode to satisfy the engine's `api.audio.load`, which binds a cue
 * name only once its file decodes. Nothing here sounds, so what the samples are
 * worth never reaches a verdict; what matters is that the produced cues BIND,
 * exactly as they do on a page, and the cue bus then announces every play.
 */
function decodeWavChannels(bytes: Uint8Array): {
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
      const channel = frames[c] as Float32Array;
      channel[i] = bits === 16 ? samples.getInt16(offset, true) / 32768 : 0;
    }
  }
  return { sampleRate, channels, frames };
}

let assetHostInstalled = false;

/**
 * Give this process the three things a browser gives the engine's asset loader.
 * Idempotent, and installed the first time a harness is built.
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
    requested.push(url);
    const file = assetFile(url);
    if (file === null) {
      if (platformFetch === undefined) {
        throw new Error(`orrery harness: nothing to fetch "${url}" with`);
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

  // The type name the engine's own recorder looks a drawable source up under. It
  // shadows every `drawImage` a frame issues so a replay can carry the picture the
  // build actually drew, and it recognizes a source by `instanceof` against the
  // host's own constructors — of which a bare Node process has none. Naming the
  // canvas library's decoded image as `ImageBitmap`, which is exactly what
  // `createImageBitmap` hands back here, is what lets a produced sprite reach a
  // recording as its pixels rather than as an opaque marker.
  host.ImageBitmap ??= Image;

  host.createImageBitmap = async (blob: Blob): Promise<ImageBitmap> => {
    const bytes = Buffer.from(await blob.arrayBuffer());
    const image = await loadImage(bytes);
    const from = blobSource.get(blob);
    if (from !== undefined) imageSource.set(image, from);
    return image as unknown as ImageBitmap;
  };

  // A build is free to compose a picture on a scratch canvas of its own before
  // it blits that canvas over the frame — `document.createElement("canvas")` is
  // how a browser hands one out, and a bare Node process has no `document` at
  // all. That is a fact about Node rather than about the build, exactly as the
  // absent `fetch`, `createImageBitmap` and `AudioContext` above are, so the
  // harness supplies the one operation: a canvas backed by the same library the
  // stage itself is drawn on, whose context and pixels the recorder already
  // reads. Nothing else of a document is provided, because nothing else is
  // something the engine's own runtime would give a build either.
  const documented = globalThis as { document?: unknown };
  documented.document ??= {
    createElement(tag: string): unknown {
      if (String(tag).toLowerCase() !== "canvas") {
        throw new Error(
          `orrery harness: this process has no document element "${tag}"`,
        );
      }
      return createCanvas(1, 1);
    },
  };

  host.AudioContext = class {
    readonly currentTime = 0;
    readonly destination = {};
    resume(): Promise<void> {
      return Promise.resolve();
    }
    decodeAudioData(buffer: ArrayBuffer): Promise<AudioBuffer> {
      const { sampleRate, channels, frames } = decodeWavChannels(
        new Uint8Array(buffer),
      );
      const first = frames[0];
      return Promise.resolve({
        sampleRate,
        numberOfChannels: channels,
        length: first?.length ?? 0,
        duration: (first?.length ?? 0) / sampleRate,
        getChannelData: (channel: number): Float32Array =>
          frames[channel] ?? new Float32Array(0),
      } as unknown as AudioBuffer);
    }
  };
}

/* -------------------------------------------------------------------------- */
/* Recording what a frame drew                                                */
/* -------------------------------------------------------------------------- */

/** Every source this process has drawn, by the id the harness gave it. */
const sourcesById = new Map<number, unknown>();

/** The id a source carries, so the same sprite drawn twice is one source. */
const sourceIds = new WeakMap<object, number>();

let nextSourceId = 0;

/** Whether a value is something a canvas can draw. */
function drawable(value: unknown): value is object {
  if (value === null || typeof value !== "object") return false;
  const shaped = value as { width?: unknown; height?: unknown };
  return typeof shaped.width === "number" && typeof shaped.height === "number";
}

/** A stable, short hash of a string, so two sources can be paired by origin. */
function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * The {@link ImageRef} a drawn source carries, minting one the first time it is
 * seen.
 *
 * A source is identified by this id and by its natural size, never by a path: a
 * bundler is free to inline a produced PNG, and that is still the committed file.
 * What settles the question is {@link Harness.imagePixels}, which reads the
 * source's own pixels back.
 */
function refFor(value: object): ImageRef {
  let id = sourceIds.get(value);
  if (id === undefined) {
    nextSourceId += 1;
    id = nextSourceId;
    sourceIds.set(value, id);
    sourcesById.set(id, value);
  }
  const shaped = value as { width: number; height: number };
  const from = imageSource.get(value) ?? null;
  return {
    id,
    kind: "bitmap",
    name: value.constructor?.name ?? "object",
    width: shaped.width,
    height: shaped.height,
    src: from,
    srcHash: from === null ? null : hashString(from),
  };
}

/**
 * A proxy that records every call and property set on its way to the real
 * context, so one frame produces both a pixel buffer to sample and a call list to
 * inspect.
 *
 * A bitmap argument is replaced in the RECORD by its {@link ImageRef} — the real
 * object goes on to the real context untouched — so the list this produces is the
 * same shape the engineless project's injected recorder produces, and
 * `drawing.ts`'s readings work over both.
 */
function recorder(target: SKRSContext2D, calls: DrawCall[]): SKRSContext2D {
  return new Proxy(target, {
    get(object, property) {
      const value = Reflect.get(object, property, object) as unknown;
      if (typeof value !== "function") return value;
      return (...args: unknown[]): unknown => {
        const method = String(property);
        calls.push({
          kind: "call",
          method,
          args:
            method === "drawImage" && drawable(args[0])
              ? [{ $src: refFor(args[0]) }, ...args.slice(1)]
              : args,
        });
        return (value as (...rest: unknown[]) => unknown).apply(object, args);
      };
    },
    set(object, property, value) {
      calls.push({ kind: "set", property: String(property), value });
      return Reflect.set(object, property, value, object);
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Driving the surface                                                        */
/* -------------------------------------------------------------------------- */

/**
 * What the build owes when its surface is missing: the `Expected:` line of the
 * failure every check that reaches for the surface lands on.
 */
export const SURFACE_REQUIREMENT =
  "the debug surface src/game.ts's instance returns from initialize, which the " +
  "engine hands back from engine.debug (specs/instrumentation.md)";

/**
 * The surface the BUILD's instance returned from `initialize`, read off the
 * engine.
 *
 * Deliberately a READ and never a construction: the surface is the build's
 * deliverable, and `engine.debug` is the only way it reaches a check. A return
 * that is no surface is a fault in the build and not in this harness, so it is
 * neither thrown from here — every suite builds its harness in a `beforeEach`, and
 * a throw would bury the real verdict under the harness's own stack — nor
 * swallowed: {@link missingSurface} stands in and fails, by assertion, at the
 * moment a check first reaches for an operation.
 */
function readDebugSurface(engine: Engine<OrrerySurfaceOf>): OrrerySurfaceOf {
  const surface: unknown = engine.debug;
  if (typeof surface !== "object" || surface === null) {
    return missingSurface(
      `engine.debug holds ${surface === null ? "null" : typeof surface}, not an object`,
    );
  }
  return surface as OrrerySurfaceOf;
}

/** A stand-in for a surface the build never returned. */
function missingSurface(reason: string): OrrerySurfaceOf {
  return new Proxy({} as OrrerySurfaceOf, {
    get: (_target, property): unknown => {
      if (typeof property === "symbol") return undefined;
      if (property === "then" || property === "constructor") return undefined;
      return fail(SURFACE_REQUIREMENT, reason);
    },
  });
}

/**
 * The one shape a suite calls, over the live game the engine holds.
 *
 * A proxy, and a lazy one, for the same reason {@link missingSurface} is: the
 * member is read off the raw surface at the moment a check reaches for it, so a
 * missing operation fails the check that needed it and never the `beforeEach` that
 * built the harness.
 *
 * Under this engine the raw surface is ALREADY imperative — a pose takes only its
 * own arguments and returns nothing, a reading returns plain data — so the one
 * thing this adds is the promise every member of {@link OrreryDriver} answers in
 * all three projects. `READINGS` is not consulted here for that reason: the two
 * kinds are called identically, and only what they answer differs.
 */
function driveSurface(raw: OrrerySurfaceOf): OrreryDriver {
  return new Proxy({} as OrreryDriver, {
    get: (_target, property): unknown => {
      if (typeof property === "symbol") return undefined;
      if (property === "then" || property === "constructor") return undefined;
      const name = String(property);
      const member = (raw as unknown as Record<string, unknown>)[name];
      if (typeof member !== "function") {
        return member === undefined ? undefined : () => Promise.resolve(member);
      }
      const op = member as (...args: unknown[]) => unknown;
      return (...args: unknown[]): Promise<unknown> =>
        Promise.resolve(op.call(raw, ...args));
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Events a frame raises                                                      */
/* -------------------------------------------------------------------------- */

/** One asset the build asked for and did not get. */
export interface AssetFailure {
  /** The path the build asked the loader for. */
  path: string;
  /** What went wrong, as the engine reported it. */
  reason: string;
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
 * A `PointerEvent`-shaped event: the engine's pointer input reads `clientX`,
 * `clientY` and `isPrimary` structurally, so a plain `Event` carrying them drives
 * it exactly as a browser's does.
 */
class PointerLikeEvent extends Event {
  readonly clientX: number;
  readonly clientY: number;
  readonly isPrimary = true;
  readonly pointerId = 1;
  readonly pointerType = "mouse";
  readonly button: number;
  readonly buttons: number;

  constructor(type: string, clientX: number, clientY: number) {
    super(type);
    this.clientX = clientX;
    this.clientY = clientY;
    this.button = type === "pointermove" ? -1 : 0;
    this.buttons = type === "pointerup" ? 0 : 1;
  }
}

/* -------------------------------------------------------------------------- */
/* The harness                                                                */
/* -------------------------------------------------------------------------- */

/** How a harness opens, and what it steps in by default. */
export interface HarnessOptions {
  /**
   * The length of one frame at the harness's own clock, in milliseconds.
   * Defaults to `1000 / TICK_HZ`. {@link Harness.advanceSeconds} overrides it for
   * the frames it runs, so a check about a fraction of a cycle names the span
   * rather than the frame.
   */
  frameMs?: number;
  /** The element's laid-out CSS width. Defaults to the logical stage width. */
  cssWidth?: number;
  /** The element's laid-out CSS height. Defaults to the logical stage height. */
  cssHeight?: number;
  /** Device pixels per CSS pixel. Defaults to 1, so one device pixel is one unit. */
  dpr?: number;
}

/**
 * Everything a check reads off one engine running this build.
 *
 * THE PORTABLE CORE IS EVERYTHING DOWN TO {@link dispose}, and every member of it
 * carries the same name, arguments and return shape in all three of Orrery's
 * validator projects. Below that sit the members that are this project's alone,
 * because an in-process engine is: {@link engine}, {@link state}, {@link canvas}
 * and {@link ctx}.
 */
export interface Harness {
  /** The surface the BUILD returned, driven over the state the engine holds. */
  readonly debug: OrreryDriver;
  /** Why the build's surface cannot be driven, or `null` when it can. */
  readonly surfaceFault: string | null;
  /** Where `watchCues` attaches: one array per watcher. */
  readonly cues: TimedCue[][];
  /** Every produced file the build asked for and did not get, oldest first. */
  readonly assetFailures: AssetFailure[];
  /**
   * Every produced file the build asked for, oldest first, and each one served.
   *
   * WHAT THE BUILD REACHED FOR is a reading in its own right: a point about
   * which of two committed files the game runs is decided by which of them the
   * build requested, and nothing about the request is interfered with. A path
   * appears here whether its load went on to succeed or not, so a file named
   * here and named in {@link assetFailures} is one the build asked for and did
   * not get.
   */
  assetRequests(): Promise<string[]>;
  /** Everything the runtime reported as an error, oldest first. */
  readonly pageErrors: string[];

  /** The frames this harness has driven, 1-based. */
  frame(): number;
  /** The simulated time those frames covered, in milliseconds. */
  timeMs(): number;

  /** A fresh read of the game's state through the build's `snapshot`. */
  snapshot(): Promise<OrrerySnapshot>;
  /** Run `frames` frames back to back, one at a time. */
  advance(frames?: number): Promise<void>;
  /**
   * Run `frames` whole frames covering exactly `seconds` of game time.
   *
   * The primitive every cycle helper is built on. A run "advances the fraction by
   * `SPEEDS[sim.speed] * dt` cycles" (`specs/simulation.md`), so a span of game
   * time is what names a cycle or a fraction of one exactly, at any speed step and
   * whatever the division.
   */
  advanceSeconds(seconds: number, frames?: number): Promise<void>;
  /** The same drive as {@link advance}, answering the state the frames left. */
  step(frames?: number): Promise<OrrerySnapshot>;
  /**
   * Run `frames` frames in one batched call.
   *
   * The same real frames and the same result; what it saves is the per-frame
   * bookkeeping. Under this engine every frame still reaches a live recording, so
   * a march spends a capture's budget here where under no engine it does not — a
   * difference that reaches the EVIDENCE alone and never a verdict.
   */
  skip(frames?: number): Promise<void>;
  /** Advance until `predicate` holds, sampling every `poll` frames. */
  until(
    predicate: (snapshot: OrrerySnapshot) => boolean,
    options?: UntilOptions,
  ): Promise<UntilResult>;
  /** Run one frame at a time, handing each frame's snapshot to `watch`. */
  stepWatching(
    count: number,
    watch?: (snapshot: OrrerySnapshot, frame: number) => boolean,
  ): Promise<OrrerySnapshot[]>;
  /** Hand the game to the engine's own frame loop for `ms` of real time. */
  runFor(ms: number): Promise<void>;

  /** Press a key and leave it down, as a player holding it would. */
  hold(code: string): Promise<void>;
  /** Release a key held by {@link hold}. */
  release(code: string): Promise<void>;
  /** Press a key, run the one frame that delivers it, and release it. */
  tap(code: string): Promise<OrrerySnapshot>;
  /** Hold `code` for `frames` frames, then release it. */
  holdFor(code: string, frames: number): Promise<OrrerySnapshot>;

  /**
   * Press the REAL pointer at a logical stage point, and run the frame that reads
   * it.
   *
   * The slow sibling of the surface's `pointerDown`, and for the same reason it is
   * under no engine: a pose resolves at the CALL, and a cue is played "on the
   * frame its event happens, from `update`" (`specs/ui.md`), so a check whose
   * subject is what a FRAME did with a player's gesture drives the engine's own
   * pointer input, one frame per sample.
   */
  mousePress(x: number, y: number): Promise<void>;
  /** Move the held pointer to a logical stage point, and run the frame that reads it. */
  mouseGlide(x: number, y: number): Promise<void>;
  /** Release the real pointer, and run the frame that reads it. */
  mouseRelease(): Promise<void>;

  /** Run exactly one frame and hand back every operation its render issued. */
  frameCalls(): Promise<DrawCall[]>;
  /** Every operation the last frame's render issued, without driving one. */
  lastCalls(): Promise<DrawCall[]>;

  /** How the stage is mapped onto this harness's canvas. */
  viewport(): Viewport;
  /** Where a logical point lands in the canvas's backing store. */
  device(x: number, y: number): StagePoint;
  /** Where a logical point lands in CSS pixels. */
  css(x: number, y: number): StagePoint;
  /** The device pixel under a logical point, as `[r, g, b, a]`. */
  pixel(x: number, y: number): Promise<Pixel>;
  /** Many logical points at once. */
  pixels(points: readonly StagePoint[]): Promise<Pixel[]>;
  /** A rectangle of the canvas, addressed in logical units, read back as RGBA. */
  pixelRect(
    x: number,
    y: number,
    width: number,
    height: number,
  ): Promise<PixelRect>;
  /** The RGBA bytes of a source a frame drew, by its `ImageRef` id. */
  imagePixels(id: number): Promise<PixelRect | null>;
  /** The canvas's backing store size. */
  surface(): Promise<{ width: number; height: number; dpr: number }>;

  /**
   * Open the build's audio.
   *
   * Under this engine the unlock is the engine's and a headless process has no
   * gesture to give it, so this raises a real pointer event at a point the editor
   * does not read and lets the engine unlock from it. It changes no game state.
   */
  armAudio(): Promise<void>;
  /** How many cues the build has played since the game stood up, in total. */
  sounds(): Promise<number>;
  /** How many cues are LOOPING now: started by `loop` and not yet stopped. */
  loopingSounds(): Promise<number>;
  /** How many loops have been started, whether or not they are still running. */
  loopStarts(): Promise<number>;
  /** Reflect the surface without invoking it: `typeof` for each name, and `version`. */
  probe(
    names: readonly string[],
  ): Promise<{ version: unknown; ops: Record<string, string> }>;

  /** Close the world, halt the loop, and drop the engine's listeners. */
  dispose(): Promise<void>;

  /* -- This project's own, past the portable core -------------------------- */

  /** The engine this harness built. */
  readonly engine: Engine<OrrerySurfaceOf>;
  /** The world currently open, read fresh on every access. */
  readonly world: World;
  /**
   * The open world's game state — the live `OrreryState` `specs/state.md`
   * declares — read fresh on every access.
   */
  readonly state: GameState;
  /** The game instance, the one framework object that outlives every level. */
  readonly instance: GameInstance<OrrerySurfaceOf> | null;
  /** The surface the engine drew into, holding the last frame that ran. */
  readonly canvas: Canvas;
  /** The real 2D context, for a reading `pixelRect` does not carry. */
  readonly ctx: SKRSContext2D;
}

/** A clock whose frame length this harness retunes between drives. */
class TunableClock implements Clock {
  constructor(private ms: number) {}
  set(ms: number): void {
    this.ms = ms;
  }
  delta(): number {
    return this.ms;
  }
}

/** Which cues are looping now, kept as the bus announces them. */
interface LoopLedger {
  running: Set<string>;
  starts: number;
}

/**
 * Build an engine over a canvas of the harness's own, initialize the build's
 * game, and hand back everything a check reads.
 *
 * The options handed to the factory are the ones the seeded `src/main.ts` hands
 * it — the design size, the build's exported `BACKGROUND`, and the four-way
 * layout — so one harness serves every build of this case. Everything else the
 * build decided lives inside `src/game.ts`.
 */
export async function createHarness(
  options: HarnessOptions = {},
): Promise<Harness> {
  installAssetHost();
  requested = [];

  const frameMs = options.frameMs ?? 1000 / TICK_HZ;
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

  /** The calls the last CLOSED frame's render issued. */
  let lastFrameCalls: DrawCall[] = [];
  /** Where the real pointer was last put, so a release lands where it was held. */
  let lastPointer: StagePoint = { x: 0, y: 0 };

  const events = new EventTarget();
  const metrics: SurfaceMetrics = {
    cssWidth: () => cssWidth,
    cssHeight: () => cssHeight,
    dpr: () => dpr,
    events: () => events,
  };

  const clock = new TunableClock(frameMs);
  const engine = createEngine<OrrerySurfaceOf>({
    canvas: element,
    width: STAGE_W,
    height: STAGE_H,
    game,
    background: BACKGROUND,
    layout: LAYOUT,
    clock,
    surface: metrics,
  });

  // Subscribed BEFORE `initialize`, which is what makes the game's own loading
  // observable: construction runs no game code, so nothing has happened yet.
  const assetFailures: AssetFailure[] = [];
  const pageErrors: string[] = [];
  const cues: TimedCue[][] = [];
  const loops: LoopLedger = { running: new Set(), starts: 0 };
  let played = 0;
  let frameCount = 0;
  let timeMs = 0;
  let framesDrawn = 0;

  const stamp = (cue: string, looping: boolean): void => {
    played += 1;
    // A cue raised from INSIDE the frame the harness is running belongs to that
    // frame, which `framesDrawn` names while a frame is open. One raised between
    // frames belongs to the next one advanced, which is what
    // `specs/ui.md` requires of an edit a pointer pose committed: "an event
    // raised outside one sounds on the next frame advanced rather than at the
    // call".
    const entry: TimedCue = {
      frame: framesDrawn > frameCount ? framesDrawn : frameCount + 1,
      t: timeMs,
      cue,
      looping,
    };
    for (const sink of cues) sink.push(entry);
  };

  engine.events.on("asset:failed", ({ path, reason }) => {
    assetFailures.push({ path, reason });
    pageErrors.push(`asset "${path}": ${reason}`);
  });
  engine.events.on("cue:played", ({ cue }) => stamp(cue, false));
  engine.events.on("cue:looped", ({ cue }) => {
    loops.running.add(cue);
    loops.starts += 1;
    stamp(cue, true);
  });
  engine.events.on("cue:stopped", ({ cue }) => {
    loops.running.delete(cue);
  });

  // A build whose `initialize` throws — because it is unimplemented, or because
  // its own loading raised — is a build no check can drive, and that is a fault
  // to report rather than a hook to fail: the message becomes the surface fault
  // every operation then fails with, so the points whose checks reach the game
  // through the surface carry it and the points that do not are decided on their
  // own merits.
  let surfaceFault: string | null = null;
  let instance: GameInstance<OrrerySurfaceOf> | null = null;
  try {
    instance = await engine.initialize();
  } catch (error) {
    surfaceFault = error instanceof Error ? error.message : String(error);
    pageErrors.push(surfaceFault);
  }
  const raw =
    surfaceFault === null
      ? readDebugSurface(engine)
      : missingSurface(surfaceFault);
  const debug = driveSurface(raw);

  const view = fitViewport(cssWidth, cssHeight, dpr);

  const dispatchKey = (type: "keydown" | "keyup", code: string): void => {
    events.dispatchEvent(new KeyEvent(type, code));
  };
  const dispatchPointer = (
    type: "pointerdown" | "pointermove" | "pointerup",
    x: number,
    y: number,
  ): void => {
    lastPointer = { x, y };
    const at = toCss(view, x, y);
    events.dispatchEvent(new PointerLikeEvent(type, at.x, at.y));
  };

  /**
   * Run one frame, counting it and the time it was worth, and keep the
   * operations its render issued as the last closed frame's.
   */
  const oneFrame = async (ms: number): Promise<void> => {
    framesDrawn = frameCount + 1;
    calls.length = 0;
    await engine.advance(1);
    lastFrameCalls = [...calls];
    frameCount += 1;
    timeMs += ms;
  };

  const advance = async (frames = 1): Promise<void> => {
    const count = Math.max(0, Math.floor(frames));
    for (let i = 0; i < count; i += 1) await oneFrame(clock.delta());
  };

  const readSnapshot = (): Promise<OrrerySnapshot> => debug.snapshot();

  const scratch = createCanvas(1, 1);

  const harness: Harness = {
    debug,
    surfaceFault,
    cues,
    assetFailures,
    assetRequests: () => Promise.resolve([...requested]),
    pageErrors,

    frame: () => frameCount,
    timeMs: () => timeMs,

    snapshot: readSnapshot,
    advance,
    async advanceSeconds(seconds, frames = 1) {
      const count = Math.max(1, Math.floor(frames));
      const ms = (seconds * 1000) / count;
      clock.set(ms);
      try {
        for (let i = 0; i < count; i += 1) await oneFrame(ms);
      } finally {
        clock.set(frameMs);
      }
    },
    async step(frames = 1) {
      await advance(frames);
      return readSnapshot();
    },
    skip: (frames = 1) => advance(frames),

    async until(predicate, untilOptions = {}) {
      const maxFrames = untilOptions.maxFrames ?? 600;
      const poll = Math.max(1, untilOptions.poll ?? 1);
      let snapshot = await readSnapshot();
      if (predicate(snapshot)) return { hit: true, frames: 0, snapshot };
      let frames = 0;
      while (frames < maxFrames) {
        const run = Math.min(poll, maxFrames - frames);
        await advance(run);
        frames += run;
        snapshot = await readSnapshot();
        if (predicate(snapshot)) return { hit: true, frames, snapshot };
      }
      return { hit: false, frames, snapshot };
    },

    async stepWatching(count, watch) {
      const seen: OrrerySnapshot[] = [];
      for (let i = 0; i < count; i += 1) {
        await advance(1);
        const snapshot = await readSnapshot();
        seen.push(snapshot);
        if (watch?.(snapshot, i + 1) === true) break;
      }
      return seen;
    },

    async runFor(ms) {
      const controller = new AbortController();
      const running = engine.run({ signal: controller.signal });
      await new Promise((done) => setTimeout(done, ms));
      controller.abort();
      await running;
    },

    hold: (code) => {
      dispatchKey("keydown", code);
      return Promise.resolve();
    },
    release: (code) => {
      dispatchKey("keyup", code);
      return Promise.resolve();
    },
    async tap(code) {
      // Down, ONE frame, up. The frame between the two is what makes this a press
      // the game can see: the engine closes the input frame after the frame
      // renders and an edge is consumed once.
      dispatchKey("keydown", code);
      await advance(1);
      dispatchKey("keyup", code);
      return readSnapshot();
    },
    async holdFor(code, frames) {
      dispatchKey("keydown", code);
      try {
        await advance(frames);
      } finally {
        dispatchKey("keyup", code);
      }
      return readSnapshot();
    },

    async mousePress(x, y) {
      dispatchPointer("pointerdown", x, y);
      await advance(1);
    },
    async mouseGlide(x, y) {
      dispatchPointer("pointermove", x, y);
      await advance(1);
    },
    async mouseRelease() {
      dispatchPointer("pointerup", lastPointer.x, lastPointer.y);
      await advance(1);
    },

    async frameCalls() {
      await advance(1);
      return [...lastFrameCalls];
    },
    lastCalls: () => Promise.resolve([...lastFrameCalls]),

    viewport: () => ({ ...view }),
    device: (x, y) => toDevice(view, x, y),
    css: (x, y) => toCss(view, x, y),
    pixel: (x, y) => {
      const at = toDevice(view, x, y);
      const { data } = ctx.getImageData(at.x, at.y, 1, 1);
      return Promise.resolve([data[0], data[1], data[2], data[3]] as Pixel);
    },
    pixels: (points) =>
      Promise.resolve(
        points.map((point) => {
          const at = toDevice(view, point.x, point.y);
          const { data } = ctx.getImageData(at.x, at.y, 1, 1);
          return [data[0], data[1], data[2], data[3]] as Pixel;
        }),
      ),
    pixelRect: (x, y, width, height) => {
      const origin = toDevice(view, x, y);
      const wide = Math.max(1, Math.round(width * view.scale));
      const high = Math.max(1, Math.round(height * view.scale));
      const read = ctx.getImageData(origin.x, origin.y, wide, high);
      return Promise.resolve({
        width: read.width,
        height: read.height,
        data: new Uint8ClampedArray(read.data),
      });
    },
    imagePixels: (id) => {
      const source = sourcesById.get(id);
      if (!drawable(source)) return Promise.resolve(null);
      const shaped = source as { width: number; height: number };
      scratch.width = shaped.width;
      scratch.height = shaped.height;
      const into = scratch.getContext("2d");
      into.clearRect(0, 0, shaped.width, shaped.height);
      into.drawImage(source as unknown as Image, 0, 0);
      const read = into.getImageData(0, 0, shaped.width, shaped.height);
      return Promise.resolve({
        width: read.width,
        height: read.height,
        data: new Uint8ClampedArray(read.data),
      });
    },
    surface: () =>
      Promise.resolve({ width: canvas.width, height: canvas.height, dpr }),

    async armAudio() {
      // A KEY rather than a pointer press, and the same one the engineless
      // project uses: `KeyO` is bound to no action in `specs/controls.md`'s whole
      // binding table, so pressing it is inert by specification. A pointer press
      // would not be: "a press anywhere else on the editor screen sets [the
      // focus] to `field`" (`specs/controls.md`), which is a state change a check
      // did not ask for.
      dispatchKey("keydown", INERT_KEY);
      dispatchKey("keyup", INERT_KEY);
      await advance(1);
    },
    sounds: () => Promise.resolve(played),
    loopingSounds: () => Promise.resolve(loops.running.size),
    loopStarts: () => Promise.resolve(loops.starts),
    probe: (names) => {
      const ops: Record<string, string> = {};
      if (surfaceFault !== null) {
        for (const name of names) ops[name] = "undefined";
        return Promise.resolve({ version: undefined, ops });
      }
      const target = engine.debug as unknown as Record<string, unknown>;
      for (const name of names) ops[name] = typeof target[name];
      return Promise.resolve({ version: target.version, ops });
    },

    dispose: () => {
      engine.destroy();
      requested = [];
      return Promise.resolve();
    },

    engine,
    get world() {
      return engine.world;
    },
    get state() {
      return engine.world.state;
    },
    instance,
    canvas,
    ctx,
  };

  return harness;
}

/* -------------------------------------------------------------------------- */
/* Media                                                                      */
/* -------------------------------------------------------------------------- */
//
// Both helpers carry the same name and the same shape in all three projects. Both
// are EVIDENCE, never a verdict: the scenario's own value comes straight back, a
// scenario that throws still leaves what it recorded, and outside a run — the
// media directory unset — the whole thing is a no-op that still runs the scenario.

/** The most frames a written recording holds. */
const MAX_REPLAY_FRAMES = 300;

/**
 * A recording of at most {@link MAX_REPLAY_FRAMES} frames, covering the whole of
 * what was captured.
 *
 * An over-long section is THINNED rather than cut short: every nth frame is kept,
 * each kept frame's `deltaMs` is restated as the time since the frame kept before
 * it, and the last frame is always kept — it is the frame the check's sweep
 * stopped at, and the one a reviewer looks at first.
 *
 * The four tables in front of the recording are carried WHOLE rather than rebuilt
 * over the survivors. A frame names its images, resources, operations and states
 * by index, so keeping the tables intact keeps every surviving frame drawable; the
 * file is larger by whatever only a dropped frame named, and the document a player
 * reads is the same one.
 */
function thinReplay(recording: Recording): Recording {
  const { frames } = recording;
  if (frames.length <= MAX_REPLAY_FRAMES) return recording;

  const stride = Math.ceil(frames.length / MAX_REPLAY_FRAMES);
  const kept: RecordedFrame[] = [];
  const first = frames[0] as RecordedFrame;
  let previousMs = first.timeMs - first.deltaMs;
  const keep = (frame: RecordedFrame): void => {
    kept.push({ ...frame, deltaMs: frame.timeMs - previousMs });
    previousMs = frame.timeMs;
  };
  for (let i = 0; i < frames.length; i += stride) {
    keep(frames[i] as RecordedFrame);
  }
  const last = frames[frames.length - 1] as RecordedFrame;
  if ((kept[kept.length - 1] as RecordedFrame).count !== last.count) {
    if (kept.length >= MAX_REPLAY_FRAMES) {
      const displaced = kept.pop() as RecordedFrame;
      previousMs = displaced.timeMs - displaced.deltaMs;
    }
    keep(last);
  }
  return { ...recording, frames: kept };
}

/**
 * Record the frames `scenario` drives and keep them as the review item's
 * `outputId` output, handing back whatever the scenario returned.
 *
 * Wrap the DRIVE, not the arrangement:
 *
 * ```ts
 * const measured = await captureReplay(h, "carried", () => carryOneMote(h));
 * ```
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
    // In a `finally`, so a scenario that failed still leaves its evidence. A
    // capture that closed no frames writes nothing: a declared output that never
    // turned up is already reported as absent, and that is the truthful reading
    // of a section that drew no frames.
    const recording = h.engine.stopRecording();
    if (recording.frames.length > 0) {
      try {
        mkdirSync(dirname(destination), { recursive: true });
        writeFileSync(
          destination,
          gzipSync(JSON.stringify(thinReplay(recording))),
        );
      } catch (error) {
        console.warn(
          `orrery: could not write ${destination}: ${String(error)}`,
        );
      }
    }
  }
}

/**
 * Keep the picture currently on the canvas as the review item's `outputId`
 * output.
 *
 * What is written is whatever the last frame that RAN left behind, so call it
 * after the frame that poses the thing under test and before the assertions, so a
 * check that fails still leaves the picture that shows why.
 */
export function captureStill(h: Harness, outputId: string): Promise<void> {
  const destination = mediaDestination(outputId, "png");
  if (destination === null) return Promise.resolve();
  try {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, h.canvas.toBuffer("image/png"));
  } catch (error) {
    console.warn(`orrery: could not write ${destination}: ${String(error)}`);
  }
  return Promise.resolve();
}
