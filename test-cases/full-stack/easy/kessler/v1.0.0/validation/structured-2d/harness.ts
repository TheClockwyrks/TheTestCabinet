// Kessler — the shared validator harness. CASE-PROVIDED.
//
// Every check in this project is an ordinary vitest test that runs IN THE SAME
// PROCESS as the build. It imports the engine and the build's own
// `src/game.ts`, creates an engine over a canvas it owns and a clock it chose,
// and steps the game with `engine.advance`. Nothing drives a browser, nothing
// polls, and no wall-clock time passes: a check asks for a number of ticks and
// gets exactly that number.
//
// WHAT A CHECK READS. The game's own state (through the case's `snapshot`),
// the engine's object model — the open world, the game state its mode built,
// its controllers — the engine's frame counter, the cue events it broadcast,
// the draw calls the pipeline issued, and the pixels those calls left on the
// canvas. Nothing here fabricates an outcome: the helpers below only ARRANGE
// the world through the debug surface, and the real ticks the build wrote are
// what run from there. Kessler's collisions are simulation-owned
// (`specs/field.md` decides every contact from the state's own polar figures),
// so no engine collision event is read anywhere: everything comes off the
// debug surface and the world.
//
// WHY THE DEBUG SURFACE RATHER THAN RAW ASSIGNMENT. `specs/instrumentation.md`
// fixes its operations, so they mean the same thing in every build: a pose
// arranges the running game through the same systems play uses, the two driver
// switches hold the game's autonomous consequences still while one behavior is
// watched, and `reset` gives everything back. `surface.ts` is that
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
// THE CLOCK. `ConstantClock(TICK_MS)` — 1000/60 ms per frame — exactly the
// pairing `specs/instrumentation.md` names: one frame consumes exactly one
// tick, because the accumulator receives the same float it compares against
// and consumes, so `engine.advance(n)` is `n` ticks. A check about the
// subdivision of a tick builds a harness with a clock of its own
// ({@link HarnessOptions.clock}).
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
  ConstantClock,
  createEngine,
  PlayerController,
  type CapturedImage,
  type Clock,
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
  STAGE_CX,
  STAGE_CY,
  STAGE_H,
  STAGE_W,
  TICK_MS,
  WAVECLEAR_TICKS,
} from "./constants";
import {
  REQUIRED_OPS,
  type KesslerDebugApi,
  type KesslerSnapshot,
  type MenuItemRect,
  type PodKind,
  type Screen,
} from "./surface";

export type { KesslerDebugApi, KesslerSnapshot, MenuItemRect, PodKind, Screen };
export { REQUIRED_OPS };

/** The case's surface, exactly as `surface.ts` specifies it. */
export type KesslerSurface = KesslerDebugApi;

/**
 * The build's game, typed against the surface the CASE specifies.
 *
 * The build declares its own type for the surface its instance's `initialize`
 * returns; what a check holds it to is `surface.ts`, so the definition is cast
 * to the case's `GameDefinition<KesslerSurface>` here and the engine is
 * parameterized with it. A surface that departs from the specification is
 * caught where a check reaches for the missing member, not by the build's own
 * compiler.
 */
const game = build as unknown as GameDefinition<KesslerSurface>;

/* -------------------------------------------------------------------------- */
/* The step schedule                                                          */
/* -------------------------------------------------------------------------- */
//
// One frame is one tick. `specs/instrumentation.md` states the pairing itself:
// "a scenario pairs a `ConstantClock` of `1000 / 60` milliseconds with
// `engine.advance`, so one frame consumes exactly one tick". The delta each
// frame supplies is the very float the build's accumulator compares against
// and subtracts, so the arithmetic is exact frame after frame — which the
// harness self-test proves against the reference rather than assumes.

/** Frames covering `ticks` whole ticks of simulation time: one for one. */
export const FRAMES_PER_TICK = 1;

/** Frames covering `seconds` of simulation time, rounded up to a whole frame. */
export function secondFrames(seconds: number): number {
  return Math.ceil(seconds * 60 - 1e-9);
}

/* -------------------------------------------------------------------------- */
/* The polar mapping, as the specification fixes it                           */
/* -------------------------------------------------------------------------- */
//
// `specs/overview.md`: `x = 500 + r * cos(theta * PI / 180)`,
// `y = 500 + r * sin(theta * PI / 180)`, angles in `[0, 360)`, `0` along `+x`
// and increasing toward `+y`. `specs/field.md` fixes the wrap-aware offset in
// `[-180, 180)` and the radial/tangential frame at a ball's center.

/** Degrees normalized into `[0, 360)`. */
export function normDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** The wrap-aware signed offset from `fromDeg` to `toDeg`, in `[-180, 180)`. */
export function angularOffset(fromDeg: number, toDeg: number): number {
  return normDeg(toDeg - fromDeg + 180) - 180;
}

/** The stage point at radius `r`, angle `thetaDeg`, under the polar mapping. */
export function polarToXy(
  r: number,
  thetaDeg: number,
): { x: number; y: number } {
  const rad = (thetaDeg * Math.PI) / 180;
  return { x: STAGE_CX + r * Math.cos(rad), y: STAGE_CY + r * Math.sin(rad) };
}

/** The polar reading of a stage point: `r`, and `thetaDeg` in `[0, 360)`. */
export function xyToPolar(
  x: number,
  y: number,
): { r: number; thetaDeg: number } {
  const dx = x - STAGE_CX;
  const dy = y - STAGE_CY;
  return {
    r: Math.hypot(dx, dy),
    thetaDeg: normDeg((Math.atan2(dy, dx) * 180) / Math.PI),
  };
}

/**
 * A velocity from its polar components at angle `thetaDeg`: `vr` along the
 * outward unit radial `n`, `vt` along the unit tangential `t` (`n` rotated by
 * `+90` degrees, so positive `vt` is toward `+theta`).
 */
export function polarVelocity(
  thetaDeg: number,
  vr: number,
  vt: number,
): { vx: number; vy: number } {
  const rad = (thetaDeg * Math.PI) / 180;
  const nx = Math.cos(rad);
  const ny = Math.sin(rad);
  return { vx: vr * nx - vt * ny, vy: vr * ny + vt * nx };
}

/** A velocity's polar components at the stage point `(x, y)`. */
export function velocityPolar(
  x: number,
  y: number,
  vx: number,
  vy: number,
): { vr: number; vt: number } {
  const { thetaDeg } = xyToPolar(x, y);
  const rad = (thetaDeg * Math.PI) / 180;
  const nx = Math.cos(rad);
  const ny = Math.sin(rad);
  return { vr: vx * nx + vy * ny, vt: -vx * ny + vy * nx };
}

/**
 * The center angle of slot `slot`'s target arc on a ring posed at
 * `ringAngleDeg`, in `[0, 360)`.
 *
 * `specs/rings.md`: slot `k` begins at the ring's angle plus `k` slot widths,
 * its target arc begins `2` degrees into the slot and spans the target arc
 * width — so the arc's center sits `2 + arc / 2` degrees into the slot.
 */
export function slotArcCenterDeg(
  ring: number,
  slot: number,
  ringAngleDeg: number,
): number {
  const spec = RING_TABLES[ring - 1];
  return normDeg(
    ringAngleDeg + slot * spec.slotWidthDeg + 2 + spec.targetArcDeg / 2,
  );
}

/** The slot geometry {@link slotArcCenterDeg} reads, from `specs/rings.md`. */
const RING_TABLES = [
  { slotWidthDeg: 30, targetArcDeg: 26 },
  { slotWidthDeg: 22.5, targetArcDeg: 18.5 },
  { slotWidthDeg: 18, targetArcDeg: 14 },
] as const;

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
 * `assets/sprites/planet.png` — and `""` names a source this harness never
 * served (a canvas or image the build made for itself). The rectangle is the
 * axis-aligned box of the destination in DEVICE pixels, mapped through the
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
}

/** A cue the build played, and the frame of the drive it played it on. */
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
// the engine, which resolves each path under `assets/` relative to the page
// the build is served from and fetches it. This project runs in a Node process
// with no page, so the two globals the loader reaches for are stood up over
// the workspace's own `assets/` directory, once, for the life of the process.
//
// AUDIO IS THE ONE THING THIS CANNOT SERVE. `loadAudio` decodes through a Web
// Audio context and this host has none, so every cue's produced `.wav` fails
// to decode here — a fact about the host rather than about the build. So the
// cue points read WHICH cue sounded off the cue bus, and the points that are
// about the FILES read them off disk directly, which is where they live.

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

/** The produced file each served bitmap's bytes came from, by content digest. */
const servedPaths = new Map<string, string>();

/** The produced file each decoded bitmap came from. */
const bitmapPaths = new WeakMap<object, string>();

let hostServed = false;

/** The digest a served file and a decoded blob are matched on. */
function digest(bytes: Uint8Array): string {
  return createHash("sha1").update(bytes).digest("hex");
}

/**
 * Stand `fetch`, `createImageBitmap` and `ImageBitmap` up over the workspace,
 * once. Idempotent and never undone. The wrapper delegates anything carrying
 * a scheme or a leading slash to whatever `fetch` was already there.
 */
function serveWorkspaceAssets(): void {
  if (hostServed) return;
  hostServed = true;
  const host = globalThis as unknown as Record<string, unknown>;
  const inherited = host.fetch as
    | ((input: string, init?: unknown) => Promise<Response>)
    | undefined;

  host.fetch = async (input: unknown, init?: unknown): Promise<Response> => {
    const url = typeof input === "string" ? input : String(input);
    if (SCHEME.test(url) || url.startsWith("/")) {
      if (inherited === undefined) {
        throw new Error(`kessler harness: this host cannot fetch ${url}`);
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
  readonly engine: Engine<KesslerSurface>;
  /**
   * The target the engine reads input off: where a key event and a pointer
   * event are dispatched, as the engine's validator pages describe.
   */
  readonly keys: EventTarget;
  /**
   * The world currently open, read fresh on every access. Kessler runs in ONE
   * level for the whole session (`specs/overview.md`), so this world lives as
   * long as the engine — but it is the engine's live object, so anything that
   * has to survive a later frame is copied rather than kept.
   */
  readonly world: World;
  /** The open world's game state. Its arrangement is the build's; a check reads
   * {@link Harness.snapshot} for anything the specification states. */
  readonly state: GameState;
  /** The game instance, the one framework object that outlives every level. */
  readonly instance: GameInstance<KesslerSurface>;
  /**
   * The debug surface the BUILD's instance returned from `initialize`, read
   * off `engine.debug` — see {@link readDebugSurface} — and driven directly:
   * each operation acts on the live world at the moment of the call.
   */
  readonly debug: KesslerDebugApi;
  /** The real 2D context, for `getImageData`. Draw calls also reach it. */
  readonly ctx: SKRSContext2D;
  /** The surface the engine drew into, holding the last frame that ran. */
  readonly canvas: Canvas;
  /** Every call and property set the render has made since the last clear. */
  readonly calls: DrawCall[];
  /** Every cue the build played since the harness opened, oldest first. */
  readonly cues: TimedCue[];
  /** Every asset the build failed to load, oldest first. */
  readonly assetFailures: AssetFailure[];

  /** Whether the build has the cue `name` looping at this moment. */
  looping(name: string): boolean;

  /** Frames run since the engine started. */
  frame(): number;
  /** The simulated time those frames covered, in milliseconds. */
  timeMs(): number;

  /** A fresh read of the game's state through the case's `snapshot`. */
  snapshot(): KesslerSnapshot;
  /**
   * `debug.reset`, with the seed spelled as a plain argument: the boot state,
   * on `title`, both driver switches on, the pod generator seeded with `seed`
   * (`DEFAULT_SEED` when omitted).
   */
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

  /** Press a key and leave it down, as a player holding it would. */
  holdKey(code: string): void;
  /** Release a key held by {@link Harness.holdKey}. */
  releaseKey(code: string): void;

  /** Forget every call recorded so far, so the next frame stands alone. */
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
  /** The device pixel at radius `r`, angle `thetaDeg`, as `[r, g, b, a]`. */
  pixelPolar(r: number, thetaDeg: number): [number, number, number, number];

  /** Close the world, halt the loop, and drop the engine's listeners. */
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

/**
 * A logical point's device pixel, through the world's camera and the engine's
 * fit. Kessler leaves the camera at rest (`specs/overview.md`), so world and
 * logical coordinates coincide; mapping through the camera anyway keeps the
 * reading honest against a build that moved it.
 */
function toDevice(
  world: World,
  view: Viewport,
  x: number,
  y: number,
): { x: number; y: number } {
  const logical = world.camera.worldToLogical({ x, y });
  return {
    x: Math.round(view.offsetX + logical.x * view.scale),
    y: Math.round(view.offsetY + logical.y * view.scale),
  };
}

/** The methods whose position only means something once the transform applies. */
const PLACED_METHODS = ["drawImage", "fillText", "strokeText"];

/**
 * A proxy that records every call and property set on its way to the real
 * context, so one frame produces both a pixel buffer to sample and a call list
 * to inspect. The transform and smoothing flag are read off the real context
 * at the moment of a PLACED call, because the context is the authority on
 * where any transform the build drew under put it.
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
 * What the build owes when its surface is missing: the `Expected:` line of the
 * failure every check that reaches for the surface lands on.
 */
const SURFACE_REQUIREMENT =
  "the debug surface src/game.ts's instance returns from initialize, which " +
  "the engine hands back from engine.debug (specs/instrumentation.md)";

/**
 * A stand-in for the surface a build never returned: every operation on it
 * fails the check that reached for it, with the missing return named. Keys
 * that belong to the machinery (`then`, `constructor`, symbols) answer
 * `undefined` so the verdict is not buried under formatting noise.
 */
function missingSurface(reason: string): KesslerSurface {
  return new Proxy({} as KesslerSurface, {
    get: (_target, property): unknown => {
      if (typeof property === "symbol") return undefined;
      if (property === "then" || property === "constructor") return undefined;
      return fail(SURFACE_REQUIREMENT, reason);
    },
  });
}

/**
 * The debug surface the BUILD's instance returned from `initialize`, read off
 * the engine that holds it. Deliberately a READ and never a construction: the
 * surface is the build's deliverable, and `engine.debug` is the only way it
 * reaches a check. A return that is no surface is failed by assertion at the
 * moment a check first reaches for an operation on it, not thrown from here —
 * every suite builds its harness in a `beforeEach`, and a throw there would
 * bury the real verdict under the harness's own stack.
 */
function readDebugSurface(engine: Engine<KesslerSurface>): KesslerSurface {
  const surface: unknown = engine.debug;
  if (typeof surface !== "object" || surface === null) {
    return missingSurface(
      `engine.debug holds ${surface === null ? "null" : typeof surface}, ` +
        `not an object`,
    );
  }
  return surface as KesslerSurface;
}

/** Fail the running check because the build's surface is not what it must be. */
export function failSurface(fault: string): never {
  return fail(SURFACE_REQUIREMENT, fault);
}

/**
 * Build an engine over a canvas of the harness's own, initialize the build's
 * game, and hand back everything a check reads.
 *
 * The options passed to the factory are the ones the seeded `src/main.ts`
 * passes — the 1000x1000 design size and the build's exported `BACKGROUND` —
 * plus the clock and the surface metrics a headless run needs. So one harness
 * serves every build of this case, and everything else the build decided
 * lives inside `src/game.ts`.
 */
export async function openHarness(
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

  const engine = createEngine<KesslerSurface>({
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
  // The names looping right now, tracked across the bus's own announcements.
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

  const instance = await engine.initialize();
  const debug = readDebugSurface(engine);

  const dispatch = (type: "keydown" | "keyup", code: string): void => {
    keys.dispatchEvent(new KeyEvent(type, code));
  };

  const harness: Harness = {
    engine,
    keys,
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
    assetFailures,

    looping: (name) => loops.has(name),

    frame: () => engine.frame().count,
    timeMs: () => engine.frame().timeMs,

    snapshot: () => debug.snapshot(),
    reset: (seed) => debug.reset(seed),

    advance: (frames) => engine.advance(frames),

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
    device: (x, y) => toDevice(engine.world, engine.viewport(), x, y),
    pixel: (x, y) => {
      const point = toDevice(engine.world, engine.viewport(), x, y);
      const { data } = ctx.getImageData(point.x, point.y, 1, 1);
      return [data[0], data[1], data[2], data[3]];
    },
    pixelPolar(r, thetaDeg) {
      const { x, y } = polarToXy(r, thetaDeg);
      return this.pixel(x, y);
    },

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
 * Under this engine one frame is one tick (see The step schedule above), so
 * this is `engine.advance(n)` followed by a snapshot.
 */
export async function advanceTicks(
  h: Harness,
  n: number,
): Promise<KesslerSnapshot> {
  await h.advance(n * FRAMES_PER_TICK);
  return h.snapshot();
}

/**
 * Press a key, run the one frame that delivers its edge, and release it.
 *
 * An edge arms the moment the `keydown` is dispatched and the engine closes
 * the input frame after the frame renders, discarding whatever no controller
 * consumed — so a tap that ran no frame would never reach the game.
 * `specs/controls.md` makes every non-rotation action a press EDGE, so one
 * tap is one action however long the key is nominally down. The frame it runs
 * consumes one tick.
 */
export async function tap(h: Harness, code: string): Promise<void> {
  h.holdKey(code);
  await h.advance(1);
  h.releaseKey(code);
}

/**
 * Hold a key down for `ticks` whole ticks of real frames, then release it.
 *
 * How the two rotation actions are driven: `specs/controls.md` reads `left`
 * and `right` as held values, and `specs/deflector-and-ball.md` moves the
 * deflector `270` degrees per second while one is held — so `hold` for `n`
 * ticks moves it `270 * n / 60` degrees.
 */
export async function hold(
  h: Harness,
  code: string,
  ticks: number,
): Promise<KesslerSnapshot> {
  h.holdKey(code);
  try {
    await h.advance(ticks * FRAMES_PER_TICK);
  } finally {
    h.releaseKey(code);
  }
  return h.snapshot();
}

/**
 * Pose an ISOLATED world: a fresh `playing` screen holding no target, no
 * ball, and no pod, with both driver switches off.
 *
 * The arrangement the authoring guide requires of a validator — clear every
 * entity the requirement is not about, then spawn back exactly what it IS
 * about through the surface's atomic poses. The switches are off so neither
 * autonomous consequence (the clearing event, the pod draw) arrives on top of
 * the behavior being watched; a check that is ABOUT one turns it back on with
 * `h.debug.setWaveAdvance(true)` / `setPodSpawn(true)`.
 *
 * `reset` first, so nothing a previous section left is inherited, seeding the
 * pod generator with `seed` when one is named; then the fresh session
 * (`setScreen("playing")` starts one exactly as confirming START does); then
 * the clears, which score nothing, draw nothing, and sound nothing.
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
 * Reach the `playing` screen the way a player does: reset to the title and
 * confirm START with a real key.
 *
 * The REAL path, for the checks that are about the flow into play; a check
 * about anything else poses its screen with {@link poseScene} or
 * {@link isolate} and never touches a menu — a build with a broken title and
 * a working tick must fail the navigation points and pass the others. The
 * entering session has wave 1 laid out and a ball parked on the deflector.
 */
export async function startPlay(
  h: Harness,
  seed?: number,
): Promise<KesslerSnapshot> {
  h.reset(seed);
  // Entry 0 of the title menu is START (specs/screens.md), highlighted on
  // entry, and Enter carries `confirm` (specs/controls.md).
  await tap(h, "Enter");
  return h.snapshot();
}

/**
 * Enter screen `screen` through the surface, exactly as the real transition
 * enters it, and read what it left.
 *
 * A thin name over `debug.setScreen` so a suite says which screen it is
 * posing; it deliberately does NOT reset first, so a check can arrange a
 * session (score, wave, lives) and then pose the screen that shows it. A
 * check that wants a clean slate calls `h.reset()` first or uses
 * {@link isolate}.
 */
export function poseScene(h: Harness, screen: Screen): KesslerSnapshot {
  h.debug.setScreen(screen);
  return h.snapshot();
}

/**
 * Spawn one unparked ball by its polar figures: at radius `r`, angle
 * `thetaDeg`, moving with radial speed `vr` (positive outward) and
 * tangential speed `vt` (positive toward `+theta`).
 *
 * The spelling nearly every contact scenario wants, since every contact in
 * `specs/field.md` is a radius crossing. Pure arithmetic over
 * `debug.spawnBall`; the cap rule is the surface's own.
 */
export function spawnBallPolar(
  h: Harness,
  r: number,
  thetaDeg: number,
  vr: number,
  vt = 0,
): void {
  const { x, y } = polarToXy(r, thetaDeg);
  const { vx, vy } = polarVelocity(thetaDeg, vr, vt);
  h.debug.spawnBall(x, y, vx, vy);
}

/** Spawn one pod by its polar position. It falls radially inward on its own. */
export function spawnPodPolar(
  h: Harness,
  kind: PodKind,
  r: number,
  thetaDeg: number,
): void {
  const { x, y } = polarToXy(r, thetaDeg);
  h.debug.spawnPod(kind, x, y);
}

/** The polar reading of one snapshot ball or pod. */
export function polarOf(body: { x: number; y: number }): {
  r: number;
  thetaDeg: number;
} {
  return xyToPolar(body.x, body.y);
}

/** The count of live targets across all three rings. */
export function targetCount(snapshot: KesslerSnapshot): number {
  return snapshot.rings.reduce((sum, ring) => sum + ring.targets.length, 0);
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
 * Every blit whose center landed within `tolerance` device pixels of the
 * logical stage point `(x, y)` — how a sprite is attributed to the object it
 * was drawn on, since `specs/assets.md` centers each sprite on its object.
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

/** The colour rendered at the logical stage point `(x, y)`. */
export function sampleAt(h: Harness, x: number, y: number): Rgb {
  const [r, g, b] = h.pixel(x, y);
  return { r, g, b };
}

/** The colour rendered at radius `r`, angle `thetaDeg`. */
export function samplePolar(h: Harness, r: number, thetaDeg: number): Rgb {
  const [red, green, blue] = h.pixelPolar(r, thetaDeg);
  return { r: red, g: green, b: blue };
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
// replay of nothing.

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
    console.warn(`kessler: could not write ${destination}: ${String(error)}`);
  }
}

/**
 * Record the frames `act` draws and keep them as the review item's `outputId`
 * output, handing back whatever `act` returned.
 *
 * Wrap the drive, not the arrangement:
 *
 * ```ts
 * const after = await captureReplay(h, "bounce", () => advanceTicks(h, 40));
 * assertEqual(after.balls.length, 1);
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
 * is one PICTURE: which screen the game opened on, what it drew a pod as.
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
