// Deepcore — the shared validator harness. CASE-PROVIDED.
//
// Every check in this project is an ordinary vitest test that runs IN THE SAME
// PROCESS as the build. It imports the engine and the build's own `src/game.ts`,
// stands an engine up over a canvas it owns and a clock it scripted, and steps
// the game with `engine.advance`. Nothing drives a browser, nothing polls, and no
// wall-clock time passes: a check asks for a number of frames and gets exactly
// that number, at exactly the deltas its clock supplied.
//
// WHAT A CHECK READS. The game's own state (through the debug surface's
// `snapshot` and `tileAt`), the engine's object model — the open world, its game
// state, its actors and its player controllers — the engine's frame counter, the
// operations the build issued against its 2D context, the pixels those operations
// left on the canvas, and the cues the engine announced. Nothing here fabricates
// an outcome: the scenario helpers below only ARRANGE the world through the debug
// surface, and the real ticks the build wrote are what run from there.
//
// WHY THE DEBUG SURFACE RATHER THAN RAW ASSIGNMENT. `specs/instrumentation.md`
// fixes its operations, so they mean the same thing in every build: `clearMine`
// leaves one kind of empty mine, `setMinerTravel(false)` holds the body and
// nothing else, a posed velocity persists across frames, and `reset` gives
// everything back. Posing through it is how a scenario is reproducible, and it is
// the seam the case's specification documents. `surface.ts` is that specification
// as types, and it is the only description of the surface this harness reads: the
// build's own module for it is never imported.
//
// WHERE THE SURFACE COMES FROM. Off `engine.debug`, never built here. The game
// instance's `initialize` returns it, the engine holds that same object, and
// reading it back off the engine is the only way a surface reaches a check — so a
// build that returned no surface, or a surface missing an operation, fails the
// checks that reach the game through it. See {@link readDebugSurface}.
//
// HOW THE SURFACE IS DRIVEN. Directly. Each operation is a method that acts on
// the live world at the moment of the call — the instance holds the engine, and
// `engine.world` is the world open at that moment — so a pose is
// `h.debug.setFuel(40)` and a reading is `h.debug.snapshot()`, with nothing in
// between. Deepcore runs in ONE WORLD for the whole session and every screen is a
// value of `screen`, so a pose that changes the screen lands at the call rather
// than riding a level transition, and a check may pose and read without advancing
// a frame between the two.
//
// WHAT A CHECK MUST NOT READ. The build's own input. Under this engine an armed
// edge is `pressed` once PER PLAYER CONTROLLER, and the call consumes that
// controller's copy — so a check that reads `world.players()[0].input` takes the
// press the build's own controller was going to read, and the build then behaves
// as though the key was never struck. A check that wants to read an action
// directly adds a controller of its own: {@link addObserver}.
//
// THE CLOCK IS THE SUITE'S. `specs/instrumentation.md` deliberately fixes no
// timestep, because every rate in this game is per second and is integrated
// against the elapsed time of the frame: a build must reach the same place
// however that time was divided. The default is a steady 120 Hz, which makes
// every duration the specification states a whole number of frames — the drill's
// 0.125 s hit is 15 of them, the hurt state's 0.4 s is 48, the notice's 1.5 s
// delay is 180 — and that is the unit the tolerances in this project were
// established in. A check that is ABOUT the step size builds harnesses with the
// engine's other clocks, which are re-exported below.
//
// AND EVERY COMPOUND SEQUENCE LIVES HERE. The surface is atomic by design: one
// field or one reading. Opening a scene, holding a faculty, laying a seam,
// standing the miner on a cell, sinking a shaft, reaching a building — none of
// those is an operation, and each of them is several. They are built once here,
// out of the atomic operations, and shared by every validator; a check that needs
// only part of a sequence calls the operations it needs.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import {
  Image,
  createCanvas,
  loadImage,
  type Canvas,
  type SKRSContext2D,
} from "@napi-rs/canvas";
// The engine's recorder decides whether a draw source is a bitmap by matching the
// host's own constructor names, and a name the host does not define never matches.
// Node defines no `ImageBitmap`, so the images this harness draws from -- which are
// `@napi-rs/canvas`'s `Image` -- were recorded as an opaque marker with no pixels
// behind it. Every replay that drew a produced sprite therefore reached a reviewer
// with the sprite missing from it.
//
// Naming that class `ImageBitmap` on the host is the whole fix, and it belongs here
// rather than in the engine: matching by name is the engine's deliberate design, and
// it is correct in the browser it is written for. This harness is the Node-side
// adapter, so supplying the name the host lacks is its job.
(globalThis as Record<string, unknown>).ImageBitmap ??= Image;
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
  type GameDefinition,
  type GameInstance,
  type GameState,
  PlayerController,
  type PathSegment,
  type RecordedFrame,
  type Recording,
  type Resource,
  type SurfaceMetrics,
  type Viewport,
  type World,
} from "@clockwyrks/structured-2d";
import {
  ACTIONS,
  BACKGROUND,
  BANDS,
  CAVE_MOUTH_COL,
  CORE_COL,
  DEFAULT_SEED,
  HUD_H,
  MINER_H,
  MINER_W,
  MINERALS,
  PLAYABLE_COL_MAX,
  PLAYABLE_COL_MIN,
  SPAWN_COL,
  STAGE_H,
  STAGE_W,
  STANDARD_ROWS,
  SURFACE_Y,
  TILE,
  WORLD_SIZE_SCALE,
} from "./constants";
import type { ActionName, Mineral } from "./constants";
import { game as build } from "../src/game";
import { fail } from "./assert";
import type {
  Band,
  BuildingBox,
  CellRef,
  DeepcoreDebugApi,
  DeepcoreSnapshot,
  Facing,
  ItemId,
  Material,
  MinerView,
  Mode,
  Ore,
  Screen,
  TileKind,
  TileRead,
  UpgradeTrack,
  WorldSize,
} from "./surface";

export * from "./surface";

/** The engine's own clocks, so a check about the step size needs no import of its own. */
export {
  ConstantClock,
  JitterClock,
  PacedClock,
  SequenceClock,
  WallClock,
} from "@clockwyrks/structured-2d";
export type { Clock } from "@clockwyrks/structured-2d";
/* -------------------------------------------------------------------------- */
/* The contract the build owes                                                */
/* -------------------------------------------------------------------------- */

/**
 * What `specs/instrumentation.md` requires of the surface: the `Expected:` line
 * of the failure every check that reaches for a missing surface lands on, beside
 * what `engine.debug` was found holding instead.
 */
export const SURFACE_REQUIREMENT =
  "the debug and automation surface src/game.ts's game instance returns from " +
  "initialize, which the engine hands back from engine.debug, carrying every " +
  "operation specs/instrumentation.md requires";

/** Fail the running check on `fault`, paired with what the specification requires. */
export function failSurface(fault: string): never {
  return fail(SURFACE_REQUIREMENT, fault);
}

/* -------------------------------------------------------------------------- */
/* The step schedule                                                          */
/* -------------------------------------------------------------------------- */

/** The frame the suite steps in, in milliseconds. */
export const TICK_HZ = 120;
export const TICK_MS = 1000 / TICK_HZ;

/** Seconds of simulated time in `n` frames of the default clock. */
export function seconds(n: number): number {
  return n / TICK_HZ;
}

/** Frames of the default clock covering `s` seconds, rounded to the nearest. */
export function ticks(s: number): number {
  return Math.max(1, Math.round(s * TICK_HZ));
}

/** A speed in units per second from a displacement measured over `n` frames. */
export function speedOverTicks(delta: number, n: number): number {
  return (Math.abs(delta) * TICK_HZ) / n;
}
/* -------------------------------------------------------------------------- */
/* Reaching the surface                                                       */
/* -------------------------------------------------------------------------- */

/** The case's surface, exactly as `surface.ts` specifies it. */
export type DeepcoreSurface = DeepcoreDebugApi;

/**
 * The surface as every check drives it.
 *
 * Under this engine the raw surface IS imperative — a pose takes only its own
 * arguments and returns nothing, a reading takes only its own arguments and
 * returns plain data — so no wrapper stands between a check and the object the
 * build returned, and the driver type is the surface type itself. The alias is
 * kept so a check reads the same way it does in the projects next door, where the
 * surface needs driving.
 */
export type DeepcoreDriver = DeepcoreSurface;

/**
 * The build's game, typed against the surface the CASE specifies.
 *
 * The build declares its own type for the surface its instance's `initialize`
 * returns — the `D` of its `GameInstance<D>` — and that type is the build's: what
 * a check holds it to is `surface.ts`, so the definition is cast to the case's
 * `GameDefinition<DeepcoreSurface>` here and the engine is parameterized with it.
 * A surface that departs from the specification is caught where a check reaches
 * for the missing member, not by the build's own compiler.
 */
const game = build as unknown as GameDefinition<DeepcoreSurface>;

/**
 * The debug surface the BUILD's instance returned from `initialize`, read off the
 * engine that holds it.
 *
 * This is deliberately a READ and never a construction. The surface is the
 * build's deliverable: its instance's `initialize` returns it
 * (`specs/instrumentation.md`), the engine keeps that same object, and
 * `engine.debug` is the only way it reaches a check.
 *
 * A return that is no surface — `null`, or something other than an object — is a
 * fault in the BUILD, and it must not present as a fault in the harness. So it is
 * neither thrown from here (every suite builds its harness in a `beforeEach`, and
 * a throw would bury the verdict under the harness's own stack) nor swallowed:
 * {@link missingSurface} stands in and fails, by assertion, at the moment a check
 * first reaches for an operation on it.
 *
 * A build whose `initialize` returned nothing at all never gets this far, because
 * the engine rejects `initialize` itself, naming the missing surface, and the
 * rejection fails the suite's `beforeEach` with the engine's own message. Such a
 * build does not run on the engine under any entry point, so it is not this
 * harness's fault to report — which is why every suite's `afterEach` disposes its
 * harness with `?.`.
 */
function readDebugSurface(engine: Engine<DeepcoreSurface>): DeepcoreSurface {
  let held: unknown;
  try {
    held = engine.debug;
  } catch (error) {
    return missingSurface(
      `reading engine.debug threw: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (typeof held !== "object" || held === null) {
    return missingSurface(
      `engine.debug holds ${held === null ? "null" : typeof held}, not an object`,
    );
  }
  return held as DeepcoreSurface;
}

/**
 * A stand-in for the surface a build never returned: every operation on it fails
 * the check that reached for it, with the missing return named.
 *
 * A proxy rather than a hand-written stub, so an operation this file does not
 * enumerate still reports the build's missing surface rather than reading as
 * merely absent. Keys that belong to the MACHINERY rather than to a check are
 * answered with `undefined` instead: awaiting the harness probes `then`, and
 * vitest's own error formatting probes symbols and `constructor`.
 */
function missingSurface(reason: string): DeepcoreSurface {
  return new Proxy({} as DeepcoreSurface, {
    get: (_target, property): unknown => {
      if (typeof property === "symbol") return undefined;
      if (property === "then" || property === "constructor") return undefined;
      return failSurface(reason);
    },
  });
}
/* -------------------------------------------------------------------------- */
/* The harness                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Where a `fillText`/`strokeText` call put its text, read off the real context at
 * the moment of the call: the transform in force, the measured width under the
 * current font, and the alignment that places the run about its anchor.
 */
export interface TextGeometry {
  transform: {
    a: number;
    b: number;
    c: number;
    d: number;
    e: number;
    f: number;
  };
  width: number;
  textAlign: string;
}

/** One recorded operation on the 2D context, in the order the render made it. */
export type DrawCall =
  | { kind: "call"; method: string; args: unknown[]; text?: TextGeometry }
  | { kind: "set"; property: string; value: unknown };

/** One cue the build played, as the engine announced it. */
export interface PlayedCue {
  cue: string;
  /** The frame of the drive it sounded on, as `engine.frame().count` reports. */
  frame: number;
  /** The frame loop's simulated time at that frame, in milliseconds. */
  t: number;
  /** `0` while the engine is muted. */
  gain: number;
}

/** One asset the build asked for and did not get. */
export interface AssetFailure {
  path: string;
  reason: string;
}

export interface HarnessOptions {
  /** The clock each frame takes its delta from. Defaults to 120 Hz. */
  clock?: Clock;
  /** The element's laid-out CSS width. Defaults to the logical stage width. */
  cssWidth?: number;
  /** The element's laid-out CSS height. Defaults to the logical stage height. */
  cssHeight?: number;
  /** Device pixels per CSS pixel. Defaults to 1, so one device pixel is one unit. */
  dpr?: number;
  /**
   * Load the PRODUCED files under `assets/` off disk before the game
   * initializes. Defaults to `false`.
   *
   * A Node process has neither `fetch` nor `createImageBitmap`, so by default
   * every sprite the build asks for comes back refused and the build draws its
   * fallbacks — which is exactly what a check about the simulation wants, and it
   * costs nothing. A check about a PRODUCED ASSET needs the real files, and this
   * is what stands them up: see {@link installAssets}.
   */
  assets?: boolean;
  /**
   * Give the game a `localStorage` to save into. Defaults to `false`.
   *
   * Node has none, and `specs/modes.md` requires a build to run without one, so
   * the default is the storage-less host. A check about saving asks for the slot.
   */
  storage?: boolean;
}

/** How far a sweep may run, and how many frames separate two samples. */
export interface UntilOptions {
  maxFrames?: number;
  poll?: number;
}

/** What a sweep found: whether the predicate ever held, and where it stopped. */
export interface UntilResult {
  hit: boolean;
  /** Frames advanced before the sample that ended the sweep. */
  frames: number;
  snapshot: DeepcoreSnapshot;
}

export interface Harness {
  readonly engine: Engine<DeepcoreSurface>;
  /**
   * The world currently open, read fresh on every access.
   *
   * Deepcore opens ONE world and never another, so nothing here travels — but
   * the read is live rather than captured all the same, because what a check
   * holds must be the world the frame it just ran left behind.
   */
  readonly world: World;
  /**
   * The open world's game state, read fresh on every access.
   *
   * Its arrangement is the BUILD's: `specs/instrumentation.md` fixes what the
   * surface reports, not what the state is called, so a check reads the game
   * through {@link Harness.snapshot} and comes here only for the framework's own
   * fields.
   */
  readonly state: GameState;
  /** The game instance, the one framework object that outlives every level. */
  readonly instance: GameInstance<DeepcoreSurface>;
  /**
   * The debug surface the BUILD's instance returned from `initialize`, read off
   * `engine.debug` — see {@link readDebugSurface} — and driven directly: each
   * operation acts on the live world at the moment of the call.
   */
  readonly debug: DeepcoreDriver;
  /** The real 2D context, for `getImageData`. Draw calls also reach it. */
  readonly ctx: SKRSContext2D;
  /** The surface the engine drew into, holding the last frame that ran. */
  readonly canvas: Canvas;
  /** Every call and property set the render made, oldest first. */
  readonly calls: DrawCall[];
  /** Every cue the build played, oldest first. */
  readonly cues: PlayedCue[];
  /** Every loop the build started, oldest first. */
  readonly loops: PlayedCue[];
  /** Every asset the build failed to load, oldest first. */
  readonly assetFailures: AssetFailure[];

  /** The frames this harness has driven, as the engine counts them. */
  frame(): number;
  /** The simulated time those frames covered, in milliseconds. */
  timeMs(): number;

  /** A fresh read of the game's state through the case's `snapshot`. */
  snapshot(): DeepcoreSnapshot;
  /** One cell's state, through the case's `tileAt`. */
  tileAt(col: number, row: number): TileRead;

  /** Run `frames` frames back to back, each the length the clock says. */
  advance(frames: number): Promise<void>;
  /**
   * Run `s` seconds of game time in `frames` whole frames of `s / frames` each.
   *
   * `frames` defaults to the harness clock's own count, so `advanceSeconds(2)` is
   * `advance(240)`. A check about a LONG span names a smaller count instead: the
   * Core Sample's ninety seconds, the notice's eight-second fade, a fuel drain
   * measured over a minute. Every rate in this game is integrated against the
   * frame's delta, so a coarser division reaches the same outcome — and the
   * engine RENDERS every frame it runs, so asking for ninety frames rather than
   * ten thousand is most of what decides how long such a check takes.
   *
   * The harness's own clock is put back afterwards, so a span driven this way
   * leaves the schedule the check opened with.
   */
  advanceSeconds(s: number, frames?: number): Promise<void>;
  /** Advance until `predicate` holds, sampling every `poll` frames. */
  until(
    predicate: (snapshot: DeepcoreSnapshot) => boolean,
    options?: UntilOptions,
  ): Promise<UntilResult>;
  /** Drive the engine's own frame loop for `ms` of real time, then halt it. */
  runFor(ms: number): Promise<void>;

  /** Put a key down and leave it down, as a player holding it would. */
  hold(code: string): void;
  /** Let a key held by {@link Harness.hold} up. */
  release(code: string): void;
  /** Let up every key this harness put down, in the order it put them down. */
  releaseAll(): void;
  /**
   * Put a key down, run the one frame that delivers it, and let it up.
   *
   * A press that ran no frame would never reach the game, and a press released
   * before a frame ran would be invisible to a build that reads a held action
   * rather than an edge — so the frame goes between the two.
   */
  tap(code: string): Promise<void>;

  /**
   * Add a player controller of the harness's own, possessing nothing and doing
   * nothing, and hand it back so a check can read the actions the frame
   * delivered.
   *
   * THE ONE WAY A CHECK READS INPUT. An armed edge is `pressed` once per player
   * controller and the call consumes that controller's copy, so reading
   * `world.players()[0].input` takes the press the BUILD's controller was going
   * to read and the build behaves as though the key was never struck. An
   * observer has a copy of every edge of its own, so reading it changes nothing
   * the build sees.
   *
   * IT IS THE ENGINE'S BARE `PlayerController`, NEVER THE BUILD'S. `addPlayer`
   * builds the mode's own `playerControllerClass` when its options name none,
   * and the build's controller is where the build reads its input and runs its
   * screen machine — so an observer built that way would be a SECOND seat
   * driving the game, moving the menu, resolving the pointer and consuming a
   * press of its own every frame. The engine's own class ticks and does nothing,
   * which is the whole of what an observer is for.
   *
   * It possesses no pawn either, so it adds nothing to the world but a seat at
   * the input.
   */
  addObserver(name?: string): PlayerController;

  /** Put the pointer down at a logical stage point. */
  pointerDown(x: number, y: number): void;
  /** Move the pointer to a logical stage point. */
  pointerMove(x: number, y: number): void;
  /** Let the pointer up at a logical stage point. */
  pointerUp(x: number, y: number): void;
  /** Press and release at a logical stage point, then run the frame that delivers it. */
  click(x: number, y: number): Promise<void>;

  /** Run exactly one frame and hand back every operation its render issued. */
  frameCalls(): Promise<DrawCall[]>;
  /** Reflect the surface without invoking it: `typeof` for each name, and the version. */
  probe(names: readonly string[]): {
    version: unknown;
    ops: Record<string, string>;
  };

  /** How the stage is mapped onto this harness's canvas. */
  viewport(): Viewport;
  /**
   * Where a LOGICAL STAGE point lands in the canvas's backing store.
   *
   * The engine's fit alone, and deliberately not the camera. A logical stage
   * point is what `specs/ui.md` states the status bar and the panels in, and the
   * viewport is the whole of what stands between one and a device pixel.
   *
   * A WORLD point goes through the camera first, and the camera is read off the
   * snapshot rather than off the engine: {@link worldToStage} is that step, and
   * it is the arithmetic `specs/world.md` states rather than a call into the
   * engine, so the reading is of where the specification says a cell is drawn.
   * {@link sampleCell} is the two composed, and is what a terrain check uses.
   */
  device(x: number, y: number): { x: number; y: number };
  /** The device pixel under a logical stage point, as `[r, g, b, a]`. */
  pixel(x: number, y: number): [number, number, number, number];
  /** A pixel addressed in the canvas's own backing store, past the fit. */
  devicePixel(x: number, y: number): [number, number, number, number];

  /** Drop the engine's listeners, release the canvas, and take back any polyfill. */
  dispose(): void;
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

/** A `PointerEvent`-shaped event: the engine reads `clientX`, `clientY`, `isPrimary`. */
class PointerEvt extends Event {
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

/**
 * A proxy that records every call and property set on its way to the real
 * context, so one frame produces both a pixel buffer to sample and a call list to
 * inspect.
 *
 * The set trap writes through with the REAL context as the receiver rather than
 * the proxy, which is what keeps a native accessor working: handed the proxy, it
 * would be invoked on an object that is not the one it was defined for.
 */
function recorder(target: SKRSContext2D, calls: DrawCall[]): SKRSContext2D {
  return new Proxy(target, {
    get(object, property) {
      const value = Reflect.get(object, property, object) as unknown;
      if (typeof value !== "function") return value;
      return (...args: unknown[]): unknown => {
        const method = String(property);
        const call: DrawCall = { kind: "call", method, args };
        if (
          (method === "fillText" || method === "strokeText") &&
          typeof args[0] === "string"
        ) {
          const m = object.getTransform();
          call.text = {
            transform: { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f },
            width: object.measureText(args[0]).width,
            textAlign: object.textAlign,
          };
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

/* ---- The produced files, off disk ----------------------------------------- */

/** The directory this harness sits in, which is the validator project's root. */
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * The build's own project directory: the parent of the validator project.
 *
 * The runner stages `validation/<engine>/` to `validation/` inside the build's
 * tree, so the parent of this file's directory is where `assets/` and `src/` sit,
 * and that is the directory a produced file is addressed from. Taken from this
 * module's URL rather than from the working directory, so it names the same place
 * however the suite was launched.
 */
const WORKSPACE_ROOT = dirname(PROJECT_ROOT);

/** How many live harnesses asked for the asset polyfill. */
let assetHosts = 0;
let heldFetch: unknown;
let heldDecoder: unknown;

/**
 * Stand the produced files up for a Node process, so a build's own loading path
 * runs unchanged.
 *
 * The engine's loader resolves every path under `assets/` and then calls the
 * host's `fetch` and `createImageBitmap` (`engine/assets.md`). Node has neither,
 * so a check about a produced sprite would otherwise read the build's fallback
 * and grade nothing. These two are the whole of what is missing: the fetch reads
 * the file the loader named off disk, relative to the build's own project
 * directory, and the decoder is `@napi-rs/canvas`'s, whose `Image` is what the
 * same canvas draws.
 *
 * Nothing here decides an outcome. A file that is not there answers `404`, which
 * is the same refusal a served page gives, and the build's own fallback handles
 * it exactly as it does in a browser.
 */
export function installAssets(): void {
  assetHosts += 1;
  if (assetHosts > 1) return;
  heldFetch = globalThis.fetch;
  heldDecoder = (globalThis as { createImageBitmap?: unknown })
    .createImageBitmap;

  Object.defineProperty(globalThis, "fetch", {
    value: (input: unknown): Promise<Response> => {
      const path = String(input);
      try {
        const bytes = readFileSync(join(WORKSPACE_ROOT, path));
        return Promise.resolve(new Response(new Uint8Array(bytes)));
      } catch {
        return Promise.resolve(new Response(null, { status: 404 }));
      }
    },
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, "createImageBitmap", {
    value: async (blob: Blob): Promise<ImageBitmap> => {
      const bytes = Buffer.from(await blob.arrayBuffer());
      return (await loadImage(bytes)) as unknown as ImageBitmap;
    },
    configurable: true,
    writable: true,
  });
}

/** Take the asset polyfill away again, once the last harness holding it is gone. */
export function removeAssets(): void {
  if (assetHosts === 0) return;
  assetHosts -= 1;
  if (assetHosts > 0) return;
  Object.defineProperty(globalThis, "fetch", {
    value: heldFetch,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, "createImageBitmap", {
    value: heldDecoder,
    configurable: true,
    writable: true,
  });
}

/* ---- The save slot -------------------------------------------------------- */

/**
 * An in-memory `localStorage`, so the save checks have somewhere to write.
 *
 * Node has none. `specs/modes.md` requires a build to run without one, so the
 * harness's default is the storage-less host and a check about SAVING asks for
 * the slot; the check about a host that refuses storage installs nothing, or
 * installs one that throws.
 */
export function installStorage(): void {
  const held = new Map<string, string>();
  const slot: Storage = {
    getItem: (key: string) => held.get(key) ?? null,
    setItem: (key: string, value: string) => {
      held.set(key, value);
    },
    removeItem: (key: string) => {
      held.delete(key);
    },
    clear: () => held.clear(),
    key: (index: number) => [...held.keys()][index] ?? null,
    get length() {
      return held.size;
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: slot,
    configurable: true,
    writable: true,
  });
}

/**
 * Take the storage slot away again, as a browser that blocks site data does.
 *
 * Unconditional, because it is BOTH the teardown of a harness that asked for a
 * slot and the arrangement a check about a storage-less host poses: a run without
 * storage is a requirement `specs/modes.md` states, and this is how a check
 * reaches it. Each check builds its own harness, so the two never overlap.
 */
export function removeStorage(): void {
  Object.defineProperty(globalThis, "localStorage", {
    value: undefined,
    configurable: true,
    writable: true,
  });
}

/* ---- Building one --------------------------------------------------------- */

/**
 * Stand an engine up over a canvas of the harness's own, initialize the build's
 * game, and hand back everything a check reads.
 *
 * The options passed to the factory are the ones the seeded `src/main.ts`
 * passes — the design size and the build's exported `BACKGROUND` — plus the clock
 * and the surface a headless run needs. NO touch layout is selected, because
 * `src/main.ts` selects none: Deepcore is played with the keyboard and the mouse
 * alone, and its actions are its own rather than a layout's vocabulary.
 */
export async function createHarness(
  options: HarnessOptions = {},
): Promise<Harness> {
  const cssWidth = options.cssWidth ?? STAGE_W;
  const cssHeight = options.cssHeight ?? STAGE_H;
  const dpr = options.dpr ?? 1;
  const clock = options.clock ?? new ConstantClock(TICK_MS);

  if (options.assets) installAssets();
  if (options.storage) installStorage();

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
  const surface: SurfaceMetrics = {
    cssWidth: () => cssWidth,
    cssHeight: () => cssHeight,
    dpr: () => dpr,
    events: () => events,
  };

  const engine = createEngine<DeepcoreSurface>({
    canvas: element,
    width: STAGE_W,
    height: STAGE_H,
    game,
    background: BACKGROUND,
    clock,
    surface,
  });

  // Subscribed BEFORE `initialize`, which is what makes the game's own loading
  // observable: construction runs no game code, so nothing has happened yet.
  const assetFailures: AssetFailure[] = [];
  const cues: PlayedCue[] = [];
  const loops: PlayedCue[] = [];
  engine.events.on("asset:failed", ({ path, reason }) => {
    assetFailures.push({ path, reason });
  });
  engine.events.on("cue:played", ({ cue, t, gain }) => {
    cues.push({ cue, frame: engine.frame().count, t, gain });
  });
  engine.events.on("cue:looped", ({ cue, t, gain }) => {
    loops.push({ cue, frame: engine.frame().count, t, gain });
  });

  const instance = await engine.initialize();
  const debug = readDebugSurface(engine);

  const held: string[] = [];
  const key = (type: "keydown" | "keyup", code: string): void => {
    events.dispatchEvent(new KeyEvent(type, code));
  };
  const pointer = (
    type: "pointerdown" | "pointermove" | "pointerup",
    x: number,
    y: number,
  ): void => {
    events.dispatchEvent(new PointerEvt(type, x, y));
  };

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
    ctx,
    canvas,
    calls,
    cues,
    loops,
    assetFailures,

    frame: () => engine.frame().count,
    timeMs: () => engine.frame().timeMs,

    snapshot: () => debug.snapshot(),
    tileAt: (col, row) => debug.tileAt(col, row),

    advance: (frames) => engine.advance(frames),

    async advanceSeconds(s, frames = ticks(s)) {
      if (!Number.isInteger(frames) || frames < 1) {
        throw new RangeError(
          `advanceSeconds needs a whole number of frames of at least 1, got ${frames}`,
        );
      }
      engine.setClock(new ConstantClock((s * 1000) / frames));
      try {
        await engine.advance(frames);
      } finally {
        engine.setClock(clock);
      }
    },

    async until(predicate, untilOptions = {}) {
      const maxFrames = untilOptions.maxFrames ?? 600;
      const poll = Math.max(1, untilOptions.poll ?? 1);

      let snapshot = debug.snapshot();
      if (predicate(snapshot)) return { hit: true, frames: 0, snapshot };

      let frames = 0;
      while (frames < maxFrames) {
        const step = Math.min(poll, maxFrames - frames);
        await engine.advance(step);
        frames += step;
        snapshot = debug.snapshot();
        if (predicate(snapshot)) return { hit: true, frames, snapshot };
      }
      return { hit: false, frames, snapshot };
    },

    async runFor(ms) {
      const controller = new AbortController();
      const running = engine.run({ signal: controller.signal });
      await new Promise((resolve) => setTimeout(resolve, ms));
      controller.abort();
      await running;
    },

    hold(code) {
      if (!held.includes(code)) held.push(code);
      key("keydown", code);
    },
    release(code) {
      const at = held.indexOf(code);
      if (at >= 0) held.splice(at, 1);
      key("keyup", code);
    },
    releaseAll() {
      for (const code of [...held]) harness.release(code);
    },
    async tap(code) {
      key("keydown", code);
      await engine.advance(1);
      key("keyup", code);
    },

    addObserver: (name = "observer") =>
      engine.world.mode.addPlayer({
        name,
        controller: PlayerController,
        pawn: null,
      }),

    pointerDown: (x, y) => pointer("pointerdown", x, y),
    pointerMove: (x, y) => pointer("pointermove", x, y),
    pointerUp: (x, y) => pointer("pointerup", x, y),
    async click(x, y) {
      pointer("pointermove", x, y);
      pointer("pointerdown", x, y);
      pointer("pointerup", x, y);
      await engine.advance(1);
    },

    async frameCalls() {
      calls.length = 0;
      await engine.advance(1);
      return [...calls];
    },

    probe(names) {
      const ops: Record<string, string> = {};
      const object = debug as unknown as Record<string, unknown>;
      for (const name of names) ops[name] = typeof object[name];
      return { version: object.version, ops };
    },

    viewport: () => engine.viewport(),
    device: (x, y) => toDevice(engine.viewport(), x, y),
    pixel: (x, y) => {
      const point = toDevice(engine.viewport(), x, y);
      return harness.devicePixel(point.x, point.y);
    },
    devicePixel: (x, y) => {
      const { data } = ctx.getImageData(x, y, 1, 1);
      return [data[0], data[1], data[2], data[3]];
    },

    dispose: () => {
      harness.releaseAll();
      engine.destroy();
      if (options.assets) removeAssets();
      if (options.storage) removeStorage();
    },
  };

  return harness;
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
 * `validation/drilling/hits-to-break.test.ts` — because that is the path the review
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
 * few hundred operations, so a section a check drives for half a minute of
 * game time runs to tens of megabytes — a file nobody can serve to a reviewer and
 * nobody wants in a run's artifacts. The cap is what makes `captureReplay` safe to
 * wrap ANY section in: an author arms the recorder around what the check is about
 * and never has to reason about how long that turns out to be.
 *
 * The cap is generous enough that the great majority of this suite's sections —
 * a cut, a fall, a detonation, a panel opened — are written whole.
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
 * what these outputs are named for. A descent is evidence that the mine
 * changed band after band, and the bands are spread across the whole of it.
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
 * check's sweep stopped at — the break, the landing, the blast — and it is the
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
    console.warn(`deepcore: could not write ${destination}: ${String(error)}`);
  }
}

/**
 * Record the frames `scenario` draws and keep them as the review item's
 * `outputId` output, handing back whatever the scenario returned.
 *
 * Wrap the drive, not the arrangement:
 *
 * ```ts
 * const cut = await captureReplay(h, "cut", () => driveCut(h, "down", target));
 * assertEqual(cut.broke, true);
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
 * the status bar reads, how the mine was drawn at depth. A recording of a still
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
export function captureStill(h: Harness, outputId: string): void {
  const destination = mediaDestination(outputId, "png");
  if (destination === null) return;
  try {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, h.canvas.toBuffer("image/png"));
  } catch (error) {
    console.warn(`deepcore: could not write ${destination}: ${String(error)}`);
  }
}

/* -------------------------------------------------------------------------- */
/* World geometry                                                             */
/* -------------------------------------------------------------------------- */
//
// The mine has a coordinate space of its own, in the same logical units as the
// stage, and the viewport is a window onto it. Nothing here reads the build: each
// is the arithmetic `specs/world.md` states, so a check that samples a pixel over
// a tile is sampling where the specification says that tile is drawn.

/** The four bands, shallowest first. */
export const BAND_ORDER: readonly Band[] = BANDS;

/** The Core chamber's row: `round(STANDARD_ROWS * WORLD_SIZE_SCALE)`. */
export function coreRowFor(size: WorldSize): number {
  return Math.round(STANDARD_ROWS * WORLD_SIZE_SCALE[size]);
}

/** `depthFraction(row) = (row - 1) / (coreRow - 1)`: `0` at row 1, `1` at the deepest. */
export function depthFraction(row: number, coreRow: number): number {
  return (row - 1) / (coreRow - 1);
}

/** The row whose depth fraction is `f`, at a mine of `coreRow` rows. */
export function rowAtFraction(f: number, coreRow: number): number {
  return Math.round(1 + f * (coreRow - 1));
}

/** The band index a depth fraction falls in: the mine quarters into four bands. */
export function bandIndexAt(f: number): number {
  return Math.min(3, Math.floor(4 * f));
}

/** The band a depth fraction falls in. */
export function bandAtFraction(f: number): Band {
  return BAND_ORDER[bandIndexAt(f)];
}

/** The band a row falls in, at the mine the snapshot describes. */
export function bandOfRow(snapshot: DeepcoreSnapshot, row: number): Band {
  return bandAtFraction(depthFraction(row, snapshot.coreRow));
}

/** A row well inside `band`, at a mine of `coreRow` rows: the band's midpoint. */
export function rowInBand(band: Band, coreRow: number): number {
  return rowAtFraction((BAND_ORDER.indexOf(band) + 0.5) / 4, coreRow);
}

/** One ore's or gemstone's entry in the mineral table, by id. */
export function mineralOf(ore: Ore): Mineral {
  const entry = MINERALS.find((mineral) => mineral.id === ore);
  if (entry === undefined) {
    fail(`one of the thirteen mineral ids specs/mining.md fixes`, ore);
  }
  return entry;
}

/** The world-space rectangle a cell occupies. */
export function cellRect(
  col: number,
  row: number,
): { x: number; y: number; w: number; h: number } {
  return { x: col * TILE, y: row * TILE, w: TILE, h: TILE };
}

/** The world-space centre of a cell. */
export function cellCenter(col: number, row: number): { x: number; y: number } {
  return { x: col * TILE + TILE / 2, y: row * TILE + TILE / 2 };
}

/** The cell a world point falls in. */
export function cellAt(x: number, y: number): CellRef {
  return { col: Math.floor(x / TILE), row: Math.floor(y / TILE) };
}

/** The world-space centre of the miner's box. */
export function minerCenter(miner: MinerView): { x: number; y: number } {
  return { x: miner.x + MINER_W / 2, y: miner.y + MINER_H / 2 };
}

/** The world `y` of the bottom of the miner's box: its feet. */
export function minerFeet(miner: MinerView): number {
  return miner.y + MINER_H;
}

/** The box `x` that centres the miner on `col`. */
export function minerXOn(col: number): number {
  return col * TILE + (TILE - MINER_W) / 2;
}

/** The box `y` of a miner standing on top of `row`. */
export function minerYOn(row: number): number {
  return row * TILE - MINER_H;
}

/** The box `y` of a miner standing on the camp ground. */
export const CAMP_MINER_Y = SURFACE_Y - MINER_H;

/**
 * Where a world point is drawn on the stage: `(wx - camX, wy - camY + HUD_H)`.
 *
 * The camera is read off the snapshot the caller already has, so the mapping is
 * the one in force at the frame that was sampled.
 */
export function worldToStage(
  snapshot: DeepcoreSnapshot,
  wx: number,
  wy: number,
): { x: number; y: number } {
  return { x: wx - snapshot.camera.x, y: wy - snapshot.camera.y + HUD_H };
}

/** Whether a stage point falls inside the mine viewport rather than the status bar. */
export function inViewport(x: number, y: number): boolean {
  return x >= 0 && x <= STAGE_W && y >= HUD_H && y <= STAGE_H;
}

/** The load fraction the snapshot reports: `loadKg / liftLimitKg`. */
export function loadFraction(snapshot: DeepcoreSnapshot): number {
  return snapshot.cargo.loadKg / snapshot.cargo.liftLimitKg;
}

/** The Core tile's cell at a size, without asking the build where it is. */
export function coreCell(size: WorldSize): CellRef {
  return { col: CORE_COL, row: coreRowFor(size) };
}

/* -------------------------------------------------------------------------- */
/* Cues                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Record every cue the build plays from now on, stamped with the frame of the
 * drive it sounded on.
 *
 * The engine owns the audio bus, so a cue is announced BY NAME
 * (`engine/audio.md`): what a check reads is which of the thirteen names
 * `specs/assets.md` fixes the build asked for, and on which frame — so a build
 * that plays its launch cue on every drill hit is caught rather than merely
 * heard. A muted play still reports, with `gain` at `0`.
 */
export function watchCues(h: Harness): PlayedCue[] {
  const played: PlayedCue[] = [];
  h.engine.events.on("cue:played", ({ cue, t, gain }) => {
    played.push({ cue, frame: h.frame(), t, gain });
  });
  return played;
}

/** Record every loop the build starts from now on, the same way. */
export function watchLoops(h: Harness): PlayedCue[] {
  const started: PlayedCue[] = [];
  h.engine.events.on("cue:looped", ({ cue, t, gain }) => {
    started.push({ cue, frame: h.frame(), t, gain });
  });
  return started;
}

/** Whether `cue` sounded at any point in `played`. */
export function sounded(played: readonly PlayedCue[], cue: string): boolean {
  return played.some((entry) => entry.cue === cue);
}

/* -------------------------------------------------------------------------- */
/* Isolation: opening a scene                                                 */
/* -------------------------------------------------------------------------- */
//
// A validator poses an isolated world: it clears every entity its requirement is
// not about and puts back exactly what it is. In Deepcore that means an empty
// mine — no ore to bank by accident, no gas to detonate under the miner, no lava
// to drain hull while a fuel check runs — and a miner carrying only the faculties
// the requirement exercises. `reset` already leaves the mine empty, the cargo
// empty, the satchel empty and no supplies held, so a scene is that plus the
// screen, the size, and the faculties.

/** How a scene opens. Everything is optional; the defaults are the resting world. */
export interface SceneOptions {
  /** The generator's seed. Defaults to `DEFAULT_SEED`. */
  seed?: number;
  /**
   * The world size.
   *
   * `setWorldSize` RESIZES the mine onto the new depth rather than emptying it
   * (`specs/instrumentation.md`, "Resizing the mine"): shared cells come through
   * untouched, rows past the new Core chamber go with their rows, and rows the
   * old depth did not reach open as an empty mine holds them. A `reset` has just
   * left the grid empty, so the explicit `clearMine` below is what guarantees the
   * scene opens on an empty mine at the size that was named, whichever direction
   * the resize went.
   */
  size?: WorldSize;
  /** The expedition's mode. Defaults to `standard`, as a `reset` leaves it. */
  mode?: Mode;
  /** The screen to open on. Defaults to `in-mine`. */
  screen?: Screen;
  /** Whether the miner's body moves. Defaults to on, as a `reset` leaves it. */
  travel?: boolean;
  /** Whether the miner's drill cuts. Defaults to on, as a `reset` leaves it. */
  drill?: boolean;
}

/**
 * The opening every posed check shares: the world back at its resting value on a
 * named seed, and the screen the check is about.
 *
 * What it leaves is an EMPTY mine — `reset` restores the grid to what `clearMine`
 * leaves — with the miner standing at the camp, tier 1 everywhere, a full tank and
 * hull, no Credits, nothing held, and no notice fired. A check then places exactly
 * what its requirement is about.
 *
 * The engine's mute bit and the save slot are deliberately outside this, because
 * `reset` leaves both alone: a fresh harness is what clears them, and every check
 * builds one.
 */
export function openScene(h: Harness, options: SceneOptions = {}): void {
  h.debug.reset({ seed: options.seed ?? DEFAULT_SEED });
  if (options.size !== undefined) {
    h.debug.setWorldSize(options.size);
    h.debug.clearMine();
  }
  if (options.mode !== undefined) h.debug.setMode(options.mode);
  h.debug.setScreen(options.screen ?? "in-mine");
  if (options.travel !== undefined) h.debug.setMinerTravel(options.travel);
  if (options.drill !== undefined) h.debug.setMinerDrill(options.drill);
}

/**
 * Hold the miner's body still for what follows: gravity, walking, thrust,
 * knockback and collision displacement all move it nowhere.
 *
 * The faculty gate `specs/instrumentation.md` fixes, named for what it is FOR. A
 * check about the drill, about fuel burn, about a hazard's damage or about the
 * cargo does not want the miner falling out of the scenario it was posed in, and
 * everything else about the miner carries on: it still reads as grounded, still
 * starts and holds a cut, still spends fuel, still takes damage, and the camera
 * still follows it.
 */
export function pinMiner(h: Harness): void {
  h.debug.setMinerTravel(false);
}

/**
 * Hold the miner's drill for what follows: no cut starts, none progresses, no
 * cell loses health, nothing is banked, and no drill hit spends fuel.
 *
 * The companion gate. A check about movement, about the camera, about fall impact
 * or about fuel's other drains holds this, so a key held to steer the miner
 * cannot quietly bore a hole through the scenario.
 */
export function pinDrill(h: Harness): void {
  h.debug.setMinerDrill(false);
}

/* -------------------------------------------------------------------------- */
/* Isolation: laying the terrain a check is about                             */
/* -------------------------------------------------------------------------- */

/** Fill a run of cells down one column with one kind. */
export function fillColumn(
  h: Harness,
  col: number,
  fromRow: number,
  toRow: number,
  kind: TileKind,
): void {
  for (let row = fromRow; row <= toRow; row += 1) {
    h.debug.setTile(col, row, kind);
  }
}

/** Fill a run of cells across one row with one kind. */
export function fillRow(
  h: Harness,
  row: number,
  fromCol: number,
  toCol: number,
  kind: TileKind,
): void {
  for (let col = fromCol; col <= toCol; col += 1) {
    h.debug.setTile(col, row, kind);
  }
}

/** Fill a rectangular block of cells with one kind. */
export function fillBlock(
  h: Harness,
  block: { fromCol: number; toCol: number; fromRow: number; toRow: number },
  kind: TileKind,
): void {
  for (let row = block.fromRow; row <= block.toRow; row += 1) {
    fillRow(h, row, block.fromCol, block.toCol, kind);
  }
}

/**
 * A floor across the whole playable width at `row`, so a miner anywhere above it
 * lands rather than falling out of the scenario.
 *
 * `rock` by default, because rock is the kind that yields nothing: a floor of ore
 * would bank a unit the moment a check drilled it, and a floor of gas would end
 * the check in a detonation.
 */
export function layFloor(
  h: Harness,
  row: number,
  kind: TileKind = "rock",
): void {
  fillRow(h, row, PLAYABLE_COL_MIN, PLAYABLE_COL_MAX, kind);
}

/**
 * Lay the camp's ground: `row 1` solid across the playable width, with the cave
 * mouth left open, exactly as generation leaves it.
 *
 * An empty mine is open everywhere, `row 0` included, so a miner posed at the
 * camp falls the moment the first frame runs. Generation leaves `row 1` minable
 * apart from `(CAVE_MOUTH_COL, 1)`, and that is what holds the miner up while it
 * walks the camp — so a scene about the surface, the buildings, or a panel lays
 * it back rather than posing the miner in mid-air and pinning it.
 */
export function layCamp(h: Harness, kind: TileKind = "rock"): void {
  layFloor(h, 1, kind);
  h.debug.setTile(CAVE_MOUTH_COL, 1, "tunnel");
}

/**
 * Open every cell of a block, so a scenario has room to move through it.
 *
 * A cleared mine is already open everywhere, so this is for a scene that laid
 * terrain and now wants a pocket back — the run-up in front of a wall, the space
 * under a miner that must fall.
 */
export function openBlock(
  h: Harness,
  block: { fromCol: number; toCol: number; fromRow: number; toRow: number },
): void {
  fillBlock(h, block, "tunnel");
}

/**
 * Stand the miner on top of the cell `(col, row)`, centred on its column, at rest.
 *
 * THAT CELL IS THE FLOOR UNDERFOOT, and so the cell a held down cut bites into —
 * not the one below it. A check that wants a gas pocket under the drill poses it
 * at `(col, row)` and stands the miner here with the same `row`.
 *
 * The cell the miner's BOX occupies is the one above, so a scene lays its floor
 * at `row` and leaves `row - 1` open.
 */
export function standOn(
  h: Harness,
  col: number,
  row: number,
  facing?: Facing,
): void {
  h.debug.setMinerPosition(minerXOn(col), minerYOn(row));
  h.debug.setMinerVelocity(0, 0);
  if (facing !== undefined) h.debug.setFacing(facing);
}

/** Put the miner's box at a world position, at rest. */
export function placeAt(h: Harness, x: number, y: number): void {
  h.debug.setMinerPosition(x, y);
  h.debug.setMinerVelocity(0, 0);
}

/** Stand the miner on the camp ground at `col`, where it spawns by default. */
export function standAtCamp(
  h: Harness,
  col: number = SPAWN_COL,
  facing?: Facing,
): void {
  standOn(h, col, 1, facing);
}

/**
 * A one-tile shaft down `col`, open from `fromRow` to `toRow`, standing on the
 * solid cell beneath it, with solid walls either side.
 *
 * The scene a climb, a fall, or a sink is measured in: the walls are what stop a
 * miner drifting laterally out of the column, and the floor is what a fall lands
 * on and a down cut bites into.
 */
export function digShaft(
  h: Harness,
  col: number,
  fromRow: number,
  toRow: number,
  wall: TileKind = "rock",
): void {
  fillColumn(h, col, fromRow, toRow, "tunnel");
  fillColumn(h, col - 1, fromRow, toRow, wall);
  fillColumn(h, col + 1, fromRow, toRow, wall);
  h.debug.setTile(col, toRow + 1, wall);
}

/** Put an ore vein at a cell, at its band's full health. */
export function layOre(h: Harness, col: number, row: number, ore: Ore): void {
  h.debug.setOreTile(col, row, ore);
}

/** Put a material node at a cell, at its band's full health. */
export function layMaterial(
  h: Harness,
  col: number,
  row: number,
  material: Material,
): void {
  h.debug.setMaterialTile(col, row, material);
}

/* -------------------------------------------------------------------------- */
/* Isolation: posing the expedition's holdings                                */
/* -------------------------------------------------------------------------- */

/**
 * Pose the cargo bay as exactly the ore listed, and nothing else.
 *
 * `setCargo` sets one ore's count and leaves the rest, so a scene that wants a
 * known load clears the bay first — otherwise it is posing a load on top of
 * whatever the check before it banked.
 */
export function stageCargo(
  h: Harness,
  ore: Partial<Record<Ore, number>>,
): void {
  h.debug.clearCargo();
  for (const [id, count] of Object.entries(ore)) {
    h.debug.setCargo(id as Ore, count as number);
  }
}

/**
 * Load the bay with `ore` until the load fraction is at least `fraction`, and
 * report the fraction reached.
 *
 * One unit of one ore at a time, because the load is whole units of whole ores: a
 * fraction is reached by the unit that crosses it rather than exactly, which is
 * the point of the overload wall — the flag flips on the unit that crosses the
 * limit. The count is derived from the lift limit the snapshot reports, so it
 * follows the jetpack tier the scene posed rather than assuming tier 1.
 */
export function loadToFraction(
  h: Harness,
  fraction: number,
  ore: Ore = "ferron",
): { count: number; fraction: number } {
  h.debug.clearCargo();
  const { cargo } = h.snapshot();
  const count = Math.ceil(
    (fraction * cargo.liftLimitKg) / mineralOf(ore).weightKg,
  );
  h.debug.setCargo(ore, count);
  return { count, fraction: loadFraction(h.snapshot()) };
}

/** Pose the six field-supply counts as exactly what is listed, and nothing else. */
export function stageItems(
  h: Harness,
  items: Partial<Record<ItemId, number>>,
): void {
  h.debug.clearItems();
  for (const [id, count] of Object.entries(items)) {
    h.debug.setItemCount(id as ItemId, count as number);
  }
}

/** Pose upgrade tracks at named tiers, so a check reads one configuration. */
export function stageTiers(
  h: Harness,
  tiers: Partial<Record<UpgradeTrack, number>>,
): void {
  for (const [track, tier] of Object.entries(tiers)) {
    h.debug.setTier(track as UpgradeTrack, tier as number);
  }
}

/* -------------------------------------------------------------------------- */
/* Compound sequences                                                         */
/* -------------------------------------------------------------------------- */
//
// Each of these poses a situation through the debug surface and then lets the
// real simulation run. The geometry and the tolerances they encode are the ones
// the specification established, and they are the same in the projects next door.

/**
 * One key per action, for the sequences that press one.
 *
 * The FIRST code `specs/controls.md` binds to each action, because an action
 * bound to several is satisfied by any of them and a scenario needs one. A check
 * about the bindings presses each of them itself.
 */
export const ACTION_KEY = Object.fromEntries(
  Object.entries(ACTIONS).map(([action, codes]) => [action, codes[0]]),
) as Record<ActionName, string>;

/** A code no action in `ACTIONS` is bound to, for a check about an ignored key. */
export const UNBOUND_KEY = "KeyZ";

/**
 * Open an expedition through the SURFACE alone: the mode, the size, a mine
 * generated from the seed, and the miner standing at the spawn.
 *
 * This is how a check about the MINE reaches its ground without driving the menus
 * — a build with a broken menu and a working world must fail the navigation
 * checks and pass the generation ones. A check about the menus enters with
 * {@link startWithKeys} instead.
 */
export function openExpedition(
  h: Harness,
  options: { seed?: number; size?: WorldSize; mode?: Mode } = {},
): void {
  h.debug.reset({ seed: options.seed ?? DEFAULT_SEED });
  if (options.mode !== undefined) h.debug.setMode(options.mode);
  if (options.size !== undefined) h.debug.setWorldSize(options.size);
  h.debug.generateMine();
  h.debug.setScreen("in-mine");
  standAtCamp(h);
}

/**
 * Start an expedition from the title the way a player does: menu keys only.
 *
 * The title menu leads with `CONTINUE` only while a save exists, so this clears
 * the slot first — otherwise the index every step below counts from moves under
 * it, and a check about the menus would be reading a menu it did not mean to
 * open. `NEW EXPEDITION` then leads, the mode is one step down for Hardcore, and
 * the size is however many steps down its entry sits.
 */
export async function startWithKeys(
  h: Harness,
  options: { mode?: Mode; size?: WorldSize } = {},
): Promise<void> {
  const mode = options.mode ?? "standard";
  const size = options.size ?? "standard";
  h.debug.clearSave();
  h.debug.reset();
  h.debug.setScreen("title");

  const down = ACTION_KEY.down;
  const confirm = ACTION_KEY.activate;

  // title -> mode-select, on `NEW EXPEDITION`, which leads with no save banked.
  await h.tap(confirm);
  // mode-select: STANDARD leads, HARDCORE is one down.
  if (mode === "hardcore") await h.tap(down);
  await h.tap(confirm);
  // size-select: QUICK, STANDARD, MARATHON, in that order.
  const steps = { quick: 0, standard: 1, marathon: 2 }[size];
  for (let i = 0; i < steps; i += 1) await h.tap(down);
  await h.tap(confirm);
}

/**
 * Stand the miner at the building `id`, on the camp ground, and report its
 * footprint.
 *
 * The footprints are the BUILD'S — `specs/world.md` fixes only that each sits on
 * the ground line inside the playable columns, spaced apart — so a check that
 * activates one asks the surface where it is rather than assuming a layout. The
 * miner is centred on the footprint, which is the one spot inside it whatever
 * reach the build gives its buildings.
 */
export function standAtBuilding(h: Harness, id: string): BuildingBox {
  const boxes = h.debug.buildings();
  const box = boxes.find((b) => b.id === id);
  if (box === undefined) {
    fail(
      `a surface building with id "${id}" among the six specs/world.md fixes`,
      `buildings() reported ${boxes.length === 0 ? "none" : boxes.map((b) => b.id).join(", ")}`,
    );
  }
  placeAt(h, box.x + box.w / 2 - MINER_W / 2, CAMP_MINER_Y);
  return box;
}

/** What a driven cut did. */
export interface CutResult {
  /** Whether the target cell broke inside the sweep. */
  broke: boolean;
  /** Frames driven before the sample that saw it break. */
  frames: number;
  /** The cell as it stands at the end of the sweep. */
  tile: TileRead;
  snapshot: DeepcoreSnapshot;
}

/**
 * Hold a direction until the cell it cuts breaks, and report the instant it did.
 *
 * The real drill: the key goes down through the engine's own input, the game's
 * update lands the hits at its own interval and spends its own fuel, and the
 * sweep watches the cell rather than the clock. Sampled every frame, because the
 * frame the cell breaks on is what several checks read.
 *
 * The key is released before this returns, so a caller reads a settled miner
 * rather than one still boring into whatever was behind the cell.
 */
export async function driveCut(
  h: Harness,
  direction: "down" | "left" | "right",
  target: CellRef,
  options: UntilOptions = {},
): Promise<CutResult> {
  const code = ACTION_KEY[direction];
  h.hold(code);
  try {
    // The sweep is over the CELL rather than the snapshot, which is what `until`
    // reads, so the loop is written out here rather than borrowed.
    const maxFrames = options.maxFrames ?? 600;
    const poll = Math.max(1, options.poll ?? 1);
    let frames = 0;
    let tile = h.tileAt(target.col, target.row);
    while (frames < maxFrames && tile.kind !== "tunnel") {
      const step = Math.min(poll, maxFrames - frames);
      await h.advance(step);
      frames += step;
      tile = h.tileAt(target.col, target.row);
    }
    return {
      broke: tile.kind === "tunnel",
      frames,
      tile,
      snapshot: h.snapshot(),
    };
  } finally {
    h.release(code);
  }
}

/** What a held movement did. */
export interface MoveResult {
  /** The miner's box position before the measured window. */
  start: { x: number; y: number };
  /** And after it. */
  end: { x: number; y: number };
  dx: number;
  dy: number;
  snapshot: DeepcoreSnapshot;
}

/**
 * Hold a key for `frames` frames and report how far the miner's box travelled.
 *
 * Nothing here poses a velocity: the key goes down and the game's own movement
 * code moves the miner, so what is measured is the build's walk, thrust or fall
 * rather than an integration the harness did.
 */
export async function driveHold(
  h: Harness,
  code: string,
  frames: number,
  options: { leadFrames?: number } = {},
): Promise<MoveResult> {
  h.hold(code);
  try {
    // With a lead, the key is already down for `leadFrames` before the measured
    // window opens, so the window reads a miner in steady travel rather than the
    // frame the press was first seen on.
    if (options.leadFrames) await h.advance(options.leadFrames);
    const before = h.snapshot().miner;
    await h.advance(frames);
    const after = h.snapshot();
    return {
      start: { x: before.x, y: before.y },
      end: { x: after.miner.x, y: after.miner.y },
      dx: after.miner.x - before.x,
      dy: after.miner.y - before.y,
      snapshot: after,
    };
  } finally {
    h.release(code);
  }
}

/** What a driven fall did. */
export interface FallResult {
  landed: boolean;
  /** The fastest downward speed the sweep saw. */
  impactSpeed: number;
  hullBefore: number;
  hullAfter: number;
  snapshot: DeepcoreSnapshot;
}

/**
 * Drop the miner from `height` world units above the floor at `(col, floorRow)`
 * and run the real physics until it lands, reporting the speed it landed at and
 * the hull it cost.
 *
 * The fall is the game's own: gravity, the terminal speed the load sets, and the
 * impact rule all run from a miner posed at rest in open air.
 */
export async function driveFall(
  h: Harness,
  col: number,
  floorRow: number,
  height: number,
  options: UntilOptions = {},
): Promise<FallResult> {
  placeAt(h, minerXOn(col), minerYOn(floorRow) - height);
  const before = h.snapshot().miner;
  let fastest = 0;
  const swept = await h.until(
    (s) => {
      if (s.miner.vy > fastest) fastest = s.miner.vy;
      return s.miner.grounded;
    },
    { maxFrames: options.maxFrames ?? 900, poll: options.poll ?? 1 },
  );
  // One frame past the first that reads as grounded. A build is free to report a
  // miner about to touch down as grounded — the flag says it is resting on solid
  // ground, and a probe a unit or two ahead of the box is a conformant way to
  // answer that — so the frame the flag first turns on is not necessarily the
  // frame the contact was resolved and the hull was billed on. The extra frame
  // costs a settled miner nothing and is what makes the reading the LANDING
  // rather than the approach to it. The speed is the fastest the sweep saw, which
  // is the speed it arrived at whichever frame resolved it.
  if (swept.hit) await h.advance(1);
  const settled = h.snapshot();
  return {
    landed: swept.hit,
    impactSpeed: fastest,
    hullBefore: before.hull,
    hullAfter: settled.miner.hull,
    snapshot: settled,
  };
}

/* -------------------------------------------------------------------------- */
/* Rendering and colour                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The RGB distance two sampled colours must exceed to count as "clearly apart".
 *
 * `specs/overview.md` requires that a player tells one band's rock from the next,
 * an ore vein from plain rock, a gemstone from an ore, and lava from safe ground,
 * and it deliberately fixes no palette — so distinguishability is the whole of
 * what a visibility check can read, and a number is the only way to read it. 50
 * of the 441 the RGB cube spans: comfortably crossed by two colours a player
 * would call different, and not by two shades of the same one.
 */
export const DISTINCT_MIN = 50;

/** A sampled colour, each channel 0–255. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** The five offsets a colour sample is averaged over, in logical units. */
const SAMPLE_OFFSETS: readonly (readonly [number, number])[] = [
  [0, 0],
  [6, 0],
  [-6, 0],
  [0, 6],
  [0, -6],
];

/**
 * The rendered colour at a logical stage point, averaged over a small cluster.
 *
 * The centre pixel plus four neighbours 6 units out, which at an 80-unit tile
 * stays well inside the cell whatever the build drew there, so one stray
 * anti-aliased or glowing pixel cannot swing the reading.
 */
export function sampleColor(h: Harness, x: number, y: number): Rgb {
  let r = 0;
  let g = 0;
  let b = 0;
  for (const [dx, dy] of SAMPLE_OFFSETS) {
    const [pr, pg, pb] = h.pixel(x + dx, y + dy);
    r += pr;
    g += pg;
    b += pb;
  }
  const n = SAMPLE_OFFSETS.length;
  return { r: r / n, g: g / n, b: b / n };
}

/**
 * The rendered colour over the centre of a WORLD cell, through the camera the
 * snapshot reports.
 *
 * The reading a terrain check takes: pose one cell, drive a frame, and sample
 * where the specification says that cell is drawn.
 */
export function sampleCell(
  h: Harness,
  snapshot: DeepcoreSnapshot,
  col: number,
  row: number,
): Rgb {
  const centre = cellCenter(col, row);
  const at = worldToStage(snapshot, centre.x, centre.y);
  return sampleColor(h, at.x, at.y);
}

/** Euclidean distance between two colours, 0 to about 441. */
export function colorDistance(a: Rgb, b: Rgb): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

/* ---- Reading one frame's render ------------------------------------------- */

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
 * commonly drawn with a selection marker or padding around it. Requiring the
 * exact run would fail a screen that shows precisely the right words.
 */
export function drewText(calls: readonly DrawCall[], text: string): boolean {
  const wanted = text.trim().toLowerCase();
  return drawnText(calls).some((drawn) => drawn.toLowerCase().includes(wanted));
}

/** One run of text a frame drew, placed in logical units. */
export interface TextSpan {
  text: string;
  /** The anchor, in logical units. */
  x: number;
  y: number;
  /** The horizontal extent of the glyphs, in logical units. */
  left: number;
  right: number;
}

/**
 * Every run of text in `calls`, placed in logical units.
 *
 * A build is free to draw under any transform it likes — the pipeline sets the
 * camera's world-to-device transform before a component draws, and a component
 * drawing the status bar takes the camera back out again — so the position a
 * `fillText` names is only where the text landed once the transform in force at
 * that call is applied. The anchor recorded
 * beside the call is the real context's own, so what comes back is where the
 * glyphs actually went, and the run is extended about it by its measured width
 * and `textAlign`. Which way a `start`/`end` alignment reads is the page's
 * direction; this game draws no right-to-left text, so they are left and right.
 */
export function textSpans(
  h: Harness,
  calls: readonly DrawCall[] = h.calls,
): TextSpan[] {
  const view = h.viewport();
  const spans: TextSpan[] = [];
  for (const call of calls) {
    if (call.kind !== "call" || call.text === undefined) continue;
    const [text, ax, ay] = call.args;
    if (typeof text !== "string" || typeof ax !== "number") continue;
    if (typeof ay !== "number") continue;
    const { transform: m, width, textAlign } = call.text;
    // Device-space anchor, then back through the engine's fit to logical units.
    const deviceX = m.a * ax + m.c * ay + m.e;
    const deviceY = m.b * ax + m.d * ay + m.f;
    const x = (deviceX - view.offsetX) / view.scale;
    const y = (deviceY - view.offsetY) / view.scale;
    // The run's width under the same horizontal scale the anchor took.
    const w = (width * Math.hypot(m.a, m.b)) / view.scale;
    const before =
      textAlign === "center"
        ? w / 2
        : textAlign === "right" || textAlign === "end"
          ? w
          : 0;
    spans.push({ text, x, y, left: x - before, right: x - before + w });
  }
  return spans;
}

/**
 * The geometry calls a frame made, by name.
 *
 * Enough of a count to compare two frames of the same scene: a frame that drew a
 * scanner indicator asked for strictly more of these than the same frame with
 * nothing locked, whatever shape the build chose to draw it as.
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

/**
 * Every point a frame's drawing calls named, in the coordinates they were issued
 * in.
 *
 * The leading pair of arguments is the position for every method listed, except
 * the curve calls, whose control points come first and whose endpoint is the last
 * pair. The pipeline sets the camera's transform before a component draws, so
 * these are world units for anything drawn through the camera and stage units for
 * a component that took the camera back out; a check that needs one or the other
 * says which by where it looks.
 */
export function drawnPoints(
  calls: readonly DrawCall[],
): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  const push = (x: unknown, y: unknown): void => {
    if (typeof x === "number" && typeof y === "number") points.push({ x, y });
  };

  for (const call of calls) {
    if (call.kind !== "call") continue;
    const { method, args } = call;
    if (
      method === "arc" ||
      method === "ellipse" ||
      method === "rect" ||
      method === "roundRect" ||
      method === "fillRect" ||
      method === "strokeRect" ||
      method === "moveTo" ||
      method === "lineTo" ||
      method === "drawImage"
    ) {
      push(args[0], args[1]);
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

/**
 * Every image a frame blitted, as `[source, ...arguments]`.
 *
 * A produced sprite reaches the canvas through `drawImage`, and which SOURCE
 * RECTANGLE the call named is how a sprite-sheet cycle is read: the frame index a
 * build is on is `sx / frameWidth`. A build that drew a code fallback instead
 * issued no `drawImage` at all, which is the reading that tells the two apart.
 */
export function imageDraws(calls: readonly DrawCall[]): unknown[][] {
  return callsTo(calls, "drawImage");
}
