// Wireworm — the shared validator harness. CASE-PROVIDED.
//
// Every check in this suite is an ordinary vitest test that runs IN THE SAME
// PROCESS as the build. It imports the engine and the build's own modules,
// creates an engine over a canvas it owns and a clock it chose, and steps the
// game with `engine.advance`. Nothing drives a browser, nothing polls, and no
// wall-clock time passes: a check asks for a number of frames and gets exactly
// that number, at exactly the deltas its clock supplied.
//
// WHAT A CHECK READS. The game's own state (through the debug surface's
// `snapshot`), the engine's object model — the open world, its game state — the
// events the engine broadcast (the cues), and — for the presentation checks —
// the pixels on the canvas or the calls the 2D context received. Nothing here
// fabricates an outcome: the scenario helpers below only ARRANGE the game
// through the debug surface, and the real rules the build wrote are what decide
// every move from there.
//
// WHY THE DEBUG SURFACE RATHER THAN RAW ASSIGNMENT. specs/instrumentation.md
// fixes its operations, so they mean the same thing in every build: `setNode`
// poses a node the rules apply to unchanged, `addWorm` builds a worm the step
// clock drives, `addBolt` places a bolt the real shot code resolves, and
// `reset` gives everything back. Posing through it is how a scenario is
// reproducible, and it is the seam the case's specification documents.
// `surface.ts` is that specification as types, and it is the only description
// of the surface this harness reads: the build's own module for it is never
// imported.
//
// WHERE THE SURFACE COMES FROM. Off `engine.debug`, never built here. The game
// instance's `initialize` returns it, the engine holds that same object, and
// reading it back off the engine is the only way a surface reaches a check —
// so a build that returned no surface, or a surface missing an operation, fails
// the checks that reach the game through it. See `readDebugSurface`.
//
// HOW THE SURFACE IS DRIVEN. Directly, and immediately: under this engine a
// pose acts on the live game at the moment of the call and a reading is built
// at the call (specs/instrumentation.md), so a scenario poses and then reads
// with no frame in between. A frame is advanced when the check wants the game
// to RUN — a worm to step, a bolt to travel, a render to happen.
//
// THE HARNESS OWNS EVERY COMPOUND SEQUENCE. The surface is atomic by design:
// each operation sets one field, so "live play on an empty, quiet board" is a
// helper here rather than an operation there. A check that needs only part of a
// sequence calls the operations it needs, and nothing it did not ask for
// happens. The helpers fix GEOMETRY — which tile a worm is posed on, where a
// foe is placed — and never a threshold: every figure a check asserts is stated
// in that check, derived from what specs/ fixes for it.
//
// THE CLOCK IS THE HARNESS'S. `ConstantClock(TICK_MS)` at 120 Hz, so one frame
// is one tick and a duration is a whole number of frames on every machine.
// Wireworm mandates no timestep of its own — every rate is per second and
// integrated against the delta the frame hands the game, which is why
// `[instrumentation]` carries no `tick_hz` — so the fixed clock is the SUITE's
// choice. A check that is specifically about the step size
// (instrumentation/deterministic-core) builds its own harnesses with clocks of
// its own.
//
// SPRITES, HEADLESS. The suite runs in `node`, where `fetch` and
// `createImageBitmap` do not exist, and the game loads its seeded art inside
// `initialize`. Both globals are stood up over the workspace's own `assets/`
// tree when this module loads, so every build's art arrives exactly as it does
// in a browser. See `serveSeededAssets`.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import {
  createCanvas,
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
  type GameDefinition,
  type GameInstance,
  type GameState,
  type PathSegment,
  type PointerButton,
  type PointerDevice,
  type RecordedFrame,
  type Recording,
  type Resource,
  type SurfaceMetrics,
  type Viewport,
  type World,
} from "@test-cabinet/structured-2d";
import {
  BINDINGS,
  BOARD_Y,
  CORRUPTOR_FRAMES,
  CURSOR_FRAMES,
  CURSOR_X_MAX,
  CURSOR_X_MIN,
  CURSOR_Y_MAX,
  CURSOR_Y_MIN,
  DROPPER_FRAMES,
  GLITCH_FRAMES,
  LAYOUT,
  NODE_FRAMES,
  STAGE_H,
  STAGE_W,
  TILE,
  WORM_FRAMES,
  tileCX,
  tileCY,
} from "./constants";
import { BACKGROUND, game as build } from "../src/game";
import { fail } from "./assert";
import type {
  ArcSnapshot,
  BoltSnapshot,
  FoeKind,
  FoeSnapshot,
  NodeSnapshot,
  Phase,
  MenuRect,
  Screen,
  Tile,
  WirewormDebugApi,
  WirewormSnapshot,
  WormSnapshot,
} from "./surface";

export type {
  ArcSnapshot,
  BoltSnapshot,
  FoeKind,
  FoeSnapshot,
  MenuRect,
  NodeSnapshot,
  Phase,
  Screen,
  Tile,
  WirewormSnapshot,
  WormSnapshot,
};

/** The case's surface, exactly as `surface.ts` specifies it. */
export type WirewormSurface = WirewormDebugApi;

/**
 * The surface as every check drives it.
 *
 * Under this engine the raw surface IS imperative — a pose takes only its own
 * arguments and returns nothing, a reading takes nothing and returns plain
 * data — so no wrapper stands between a check and the object the build
 * returned, and the driver type is the surface type itself. The alias is kept
 * so a check reads the same way it does under an engine whose surface needs
 * driving.
 */
export type WirewormDriver = WirewormSurface;

/**
 * The build's game, typed against the surface the CASE specifies.
 *
 * The build declares its own type for the surface its instance's `initialize`
 * returns — the `D` of its `GameDefinition<D>` — and that type is the build's:
 * what a check holds it to is `surface.ts`, so the definition is cast to the
 * case's `GameDefinition<WirewormSurface>` here and the engine is parameterized
 * with it. A surface that departs from the specification is caught where a
 * check reaches for the missing member, not by the build's own compiler.
 */
const game = build as unknown as GameDefinition<WirewormSurface>;

/* -------------------------------------------------------------------------- */
/* The clock                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The frame the suite steps in, in milliseconds.
 *
 * This is the SUITE's choice, not the game's: the specification deliberately
 * fixes no timestep, because the engine hands the game whatever elapsed time a
 * frame really took. Fixing it here makes a duration a whole number of frames,
 * so a tolerance can be stated in ticks and mean the same thing on every
 * machine.
 */
export const TICK_HZ = 120;
export const TICK_MS = 1000 / TICK_HZ;

/** Seconds of simulated time in `ticks` frames of the default clock. */
export function seconds(ticks: number): number {
  return ticks / TICK_HZ;
}

/** Frames of the default clock covering `duration` seconds, rounded to whole. */
export function ticksFor(duration: number): number {
  return Math.round(duration * TICK_HZ);
}

/* -------------------------------------------------------------------------- */
/* The board, in the space the surface speaks                                 */
/* -------------------------------------------------------------------------- */

/** The center of the player band, where a run and a respawn place the cursor. */
export const BAND_CX = (CURSOR_X_MIN + CURSOR_X_MAX) / 2;
export const BAND_CY = (CURSOR_Y_MIN + CURSOR_Y_MAX) / 2;

/** A tile's center in logical stage units, which is what the surface takes. */
export function tileCenter(c: number, r: number): { x: number; y: number } {
  return { x: tileCX(c), y: tileCY(r) };
}

/**
 * The tile a logical stage point falls on, the inverse of {@link tileCenter}.
 *
 * A point above the board answers with a negative row, which is the honest
 * reading of a point that is on the HUD rather than on a tile.
 */
export function tileAtPoint(x: number, y: number): Tile {
  return { c: Math.floor(x / TILE), r: Math.floor((y - BOARD_Y) / TILE) };
}

/* -------------------------------------------------------------------------- */
/* The seeded art, served to a headless host                                  */
/* -------------------------------------------------------------------------- */

/**
 * The directory this harness sits in, which is the validator project's root.
 *
 * Taken from this module's own URL rather than from the working directory,
 * because it has to name the same directory wherever the suite is run from.
 */
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * The workspace the project is staged into, which is where `assets/` and
 * `src/` sit. The project is staged to `<workspace>/validation`, and this
 * harness resolves the build's modules by the same relative paths the build
 * itself uses, so the workspace is one level up from the project root.
 */
const WORKSPACE = join(PROJECT_ROOT, "..");

/** Each seeded folder under `assets/`, and how many frames it holds. */
export const SPRITE_FOLDERS = {
  node: NODE_FRAMES,
  worm: WORM_FRAMES,
  cursor: CURSOR_FRAMES,
  glitch: GLITCH_FRAMES,
  dropper: DROPPER_FRAMES,
  corruptor: CORRUPTOR_FRAMES,
} as const;

/** One of the six seeded folders. */
export type SpriteFolder = keyof typeof SPRITE_FOLDERS;

/**
 * Stand `fetch` and `createImageBitmap` up over the workspace's own `assets/`
 * tree, for the life of this module.
 *
 * The engine's asset loader resolves every path under a fixed root and fetches
 * it, then decodes the body with `createImageBitmap` (engine docs, assets.md).
 * A Node process has neither, so a build that loads its art inside `initialize`
 * would see every frame fail and fall back to shapes in code — and the nine
 * checks about the seeded art would grade a build that draws its sprites
 * perfectly as one that draws none.
 *
 * Installed once, at module load, rather than around each `createHarness`: the
 * art is loaded inside `initialize`, and a build may reload it at any later
 * moment. Nothing else in this process fetches, and each test file gets its own
 * module registry, so what is stood up here is contained to the suite that
 * imported it.
 *
 * A path that names no file rejects, exactly as a missing file does in a
 * browser, and the engine reports it on `asset:failed` — which the harness
 * collects into {@link Harness.assetFailures}.
 */
function serveSeededAssets(): void {
  const host = globalThis as unknown as Record<string, unknown>;
  host.fetch = async (url: string): Promise<Response> =>
    new Response(readFileSync(join(WORKSPACE, url)));
  host.createImageBitmap = async (blob: Blob): Promise<unknown> =>
    loadImage(Buffer.from(await blob.arrayBuffer()));
}

serveSeededAssets();

/** One seeded frame, decoded, with its premultiplied channels ready to compare. */
export interface SeededFrame {
  folder: SpriteFolder;
  index: number;
  /** Premultiplied RGBA, as {@link channelsOf} reads them. */
  pixels: Float64Array;
}

let seeded: Promise<SeededFrame[]> | null = null;

/**
 * Every seeded frame of every folder, read off the workspace's own `assets/`.
 *
 * Decoded once per test file and held, because a presentation check compares a
 * drawn source against all twenty-one of them and there is no reason to decode
 * the tree twice.
 */
export function seededFrames(): Promise<SeededFrame[]> {
  seeded ??= (async () => {
    const frames: SeededFrame[] = [];
    for (const folder of Object.keys(SPRITE_FOLDERS) as SpriteFolder[]) {
      for (let index = 0; index < SPRITE_FOLDERS[folder]; index += 1) {
        const image = await loadImage(
          join(WORKSPACE, "assets", folder, `${index}.png`),
        );
        frames.push({ folder, index, pixels: channelsOf(image) });
      }
    }
    return frames;
  })();
  return seeded;
}

/**
 * A drawable source's premultiplied RGBA channels.
 *
 * Premultiplied, because that is what survives a round trip through a canvas
 * intact: drawing a bitmap in multiplies each channel by the pixel's alpha and
 * reading it back divides again, so a partially transparent pixel is quantized
 * twice. Comparing the products compares what both sides actually hold.
 */
export function channelsOf(source: {
  width: number;
  height: number;
}): Float64Array {
  const canvas = createCanvas(source.width, source.height);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, source.width, source.height);
  // The cast is the one this comparison needs: everything handed here is a
  // bitmap this canvas implementation can blit, and the decoders it comes from
  // do not share a nominal type.
  ctx.drawImage(source as never, 0, 0);
  const { data } = ctx.getImageData(0, 0, source.width, source.height);
  const out = new Float64Array(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    out[i] = (data[i] * alpha) / 255;
    out[i + 1] = (data[i + 1] * alpha) / 255;
    out[i + 2] = (data[i + 2] * alpha) / 255;
    out[i + 3] = alpha;
  }
  return out;
}

/**
 * How far apart two frames are: the mean absolute difference over
 * premultiplied RGBA channels, out of `255`. Frames of different sizes are
 * infinitely far apart, because one cannot be the other.
 */
export function frameDistance(a: Float64Array, b: Float64Array): number {
  if (a.length !== b.length || a.length === 0) return Infinity;
  let total = 0;
  for (let i = 0; i < a.length; i += 1) total += Math.abs(a[i] - b[i]);
  return total / a.length;
}

/** A seeded frame and how far the compared source sits from it. */
export interface FrameMatch {
  folder: SpriteFolder;
  index: number;
  distance: number;
}

/**
 * The seeded frame a drawn source sits nearest, and how far away it is.
 *
 * The DISTANCE comes back rather than a verdict, so the check that asked states
 * its own bound: identity is what the specification requires of a build that
 * draws from the seeded art, and how much room a canvas round trip leaves is
 * the check's to state beside the folder it expected.
 */
export async function nearestSeededFrame(source: {
  width: number;
  height: number;
}): Promise<FrameMatch> {
  const pixels = channelsOf(source);
  let best: FrameMatch = { folder: "node", index: 0, distance: Infinity };
  for (const frame of await seededFrames()) {
    const distance = frameDistance(pixels, frame.pixels);
    if (distance < best.distance) {
      best = { folder: frame.folder, index: frame.index, distance };
    }
  }
  return best;
}

/* -------------------------------------------------------------------------- */
/* The harness                                                                */
/* -------------------------------------------------------------------------- */

/** A 2D affine transform, as the context held it at the moment of a call. */
export interface Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

/**
 * Where a `fillText`/`strokeText` call put its text, read off the real context
 * at the moment of the call: the current transform, so the anchor can be mapped
 * to logical units whatever transform the pipeline applied, the measured width
 * under the current font, and the alignment that places the run about its
 * anchor.
 */
export interface TextGeometry {
  transform: Matrix;
  width: number;
  textAlign: string;
}

/**
 * One recorded operation on the 2D context, in the order the render made it.
 *
 * `transform` is carried on a `drawImage` call, because a build draws a
 * leftward worm or corruptor by flipping the horizontal axis about the sprite's
 * center (specs/assets.md): the destination rectangle a mirrored call carries
 * is stated in that flipped space, and only the transform maps it back.
 */
export type DrawCall =
  | {
      kind: "call";
      method: string;
      args: unknown[];
      text?: TextGeometry;
      transform?: Matrix;
    }
  | { kind: "set"; property: string; value: unknown };

/** One cue the build played, as the engine announced it. */
export interface PlayedCue {
  cue: string;
  t: number;
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
  snapshot: WirewormSnapshot;
}

export interface Harness {
  readonly engine: Engine<WirewormSurface>;
  /**
   * The world currently open, read fresh on every access. Wireworm runs in one
   * world for the whole session — every screen is a value of the state's
   * `screen` field — but reading it through the engine keeps a check honest
   * against a build that rebuilt it anyway.
   */
  readonly world: World;
  /**
   * The open world's game state — the live `WirewormState` specs/state.md
   * declares — read fresh on every access. Its arrangement is the build's; what
   * a check asserts is read through `snapshot`.
   */
  readonly state: GameState;
  /** The game instance, the one framework object that outlives every level. */
  readonly instance: GameInstance<WirewormSurface>;
  /**
   * The debug surface the BUILD's instance returned from `initialize`, read
   * off `engine.debug` — see {@link readDebugSurface} — and driven directly:
   * each operation acts on the live game at the moment of the call.
   */
  readonly debug: WirewormDriver;
  /** The real 2D context, for `getImageData`. Draw calls also reach it. */
  readonly ctx: SKRSContext2D;
  /**
   * The surface the engine drew into, holding the last frame that ran.
   *
   * Exposed for {@link captureStill}, which encodes it: a still output is the
   * picture the build actually put on the canvas, and the only place that
   * picture exists is here.
   */
  readonly canvas: Canvas;
  /** Every call and property set the render made, oldest first. */
  readonly calls: DrawCall[];
  /** Every cue the build played, oldest first. */
  readonly cues: PlayedCue[];
  /** Every asset the build failed to load, oldest first. */
  readonly assetFailures: AssetFailure[];

  /** A fresh read of the game's state through the case's `snapshot`. */
  snapshot(): WirewormSnapshot;
  /** Run `frames` frames back to back. */
  advance(frames: number): Promise<void>;
  /** Run whole frames covering `duration` seconds of game time. */
  advanceSeconds(duration: number): Promise<void>;
  /** Advance until `predicate` holds, sampling every `poll` frames. */
  until(
    predicate: (snapshot: WirewormSnapshot) => boolean,
    options?: UntilOptions,
  ): Promise<UntilResult>;
  /** Drive the engine's own frame loop for `ms` of real time, then halt it. */
  runFor(ms: number): Promise<void>;

  /** Press a key and leave it down, as a player holding it would. */
  hold(code: string): void;
  /** Release a key held by `hold`. */
  release(code: string): void;
  /**
   * Press and release a key, then run the one frame that delivers its edge.
   *
   * The engine closes the input frame after the frame renders and an edge is
   * consumed once, so a tap between frames arms the edge for exactly the next
   * frame — which this runs.
   */
  tap(code: string): Promise<void>;

  /**
   * The event target the surface hands the engine — where the engine's own
   * input system attached its `keydown`/`keyup` listeners, and where the
   * engine's overlay listens for the backtick.
   *
   * {@link hold}, {@link release} and {@link tap} are the named way in; this is
   * for a check that needs to raise an event of its own shape.
   */
  readonly events: EventTarget;

  /**
   * Move the pointer to a logical point with nothing pressed, then run the frame
   * that reads it. The hover `specs/ui.md` selects a menu item on.
   */
  movePointer(x: number, y: number, options?: PointerOptions): Promise<void>;
  /** Press the pointer at a logical point and leave it down. */
  pressPointer(x: number, y: number, options?: PointerOptions): Promise<void>;
  /** Release a pointer pressed by `pressPointer`, at a logical point. */
  releasePointer(x: number, y: number, options?: PointerOptions): Promise<void>;
  /**
   * Press and release at one logical point, both edges on ONE frame.
   *
   * `specs/ui.md` says a press and the release that follows it may arrive on one
   * frame and that the frame confirms, so this is the ordinary click and the
   * ordinary tap of a finger.
   */
  tapPointer(x: number, y: number, options?: PointerOptions): Promise<void>;

  /** Where a logical point lands in the canvas's backing store. */
  device(x: number, y: number): { x: number; y: number };
  /** The device pixel under a logical point, as `[r, g, b, a]`. */
  pixel(x: number, y: number): [number, number, number, number];

  /** Close the world, halt the loop, and drop the engine's listeners. */
  dispose(): void;
}

/**
 * Which pointer a dispatched event comes from, and what it is holding.
 *
 * The engine reads `pointerType`, `pointerId`, `isPrimary`, `button` and
 * `buttons` off a pointer event and nothing else, so these are exactly the facts
 * a check can vary. `device` is what separates a finger from a mouse:
 * `specs/ui.md` gives a touch contact a rule of its own, because a finger does
 * not hover.
 */
export interface PointerOptions {
  /** Which device drove the event. Defaults to a mouse. */
  device?: PointerDevice;
  /** Which button the event names. Defaults to the primary one. */
  button?: PointerButton;
  /** The pointer's id, so a second contact can be driven beside the first. */
  id?: number;
  /** Whether this is the primary pointer. Defaults to true. */
  primary?: boolean;
  /**
   * Frames advanced after the event, so the frame loop delivers it. Defaults to
   * one; `0` leaves the event undelivered so a second can join it on one frame.
   */
  frames?: number;
}

/* ---- The pointer, as the engine is delivered one --------------------------- */
//
// The menus take a mouse and a finger as well as the keyboard (`specs/ui.md`),
// and the engine reads both off the same pointer-event stream on the target the
// `surface` option supplies. This suite runs over a canvas with no document
// behind it, so there is no `PointerEvent` constructor to call and no element to
// dispatch from: the engine narrows structurally, reading `clientX`, `clientY`,
// `pointerId`, `pointerType`, `isPrimary`, `button` and `buttons` off whatever
// arrives, so an event carrying those drives the pointer exactly as a hand does.

/** The three pointer events the engine listens for. */
type PointerEventName = "pointerdown" | "pointermove" | "pointerup";

/** Exactly the fields the engine's pointer listeners read. */
interface PointerEventFields {
  clientX: number;
  clientY: number;
  pointerId: number;
  pointerType: PointerDevice;
  isPrimary: boolean;
  /** The button the event is ABOUT, as `PointerEvent.button` numbers them. */
  button: number;
  /** Every button held once the event has been applied, as a bit mask. */
  buttons: number;
}

/** A `PointerEvent`-shaped event carrying the seven fields the engine reads. */
class PointerEventShim extends Event {
  readonly clientX: number;
  readonly clientY: number;
  readonly pointerId: number;
  readonly pointerType: PointerDevice;
  readonly isPrimary: boolean;
  readonly button: number;
  readonly buttons: number;

  constructor(type: PointerEventName, fields: PointerEventFields) {
    super(type);
    this.clientX = fields.clientX;
    this.clientY = fields.clientY;
    this.pointerId = fields.pointerId;
    this.pointerType = fields.pointerType;
    this.isPrimary = fields.isPrimary;
    this.button = fields.button;
    this.buttons = fields.buttons;
  }
}

/**
 * The bit each button occupies in `PointerEvent.buttons`, and the order
 * `PointerEvent.button` indexes them in. The two use different numbering, which
 * is why each is written out rather than derived from the other.
 */
const BUTTON_BITS: Readonly<Record<PointerButton, number>> = {
  primary: 1,
  secondary: 2,
  auxiliary: 4,
  back: 8,
  forward: 16,
};

const BUTTON_INDEX: readonly PointerButton[] = [
  "primary",
  "auxiliary",
  "secondary",
  "back",
  "forward",
];

/** The value `PointerEvent.button` carries for a named button. */
function buttonIndexOf(button: PointerButton): number {
  return BUTTON_INDEX.indexOf(button);
}

/** The mask `PointerEvent.buttons` carries for a set of held buttons. */
function buttonMask(held: ReadonlySet<PointerButton>): number {
  let bits = 0;
  for (const button of held) bits |= BUTTON_BITS[button];
  return bits;
}

/**
 * Where a logical point lands in the client coordinates a pointer event carries.
 *
 * The engine maps a pointer position by `((client - origin) * dpr - offset) /
 * scale`, and this harness's surface supplies no origin, so this is that map run
 * backwards. Unrounded, deliberately: a device pixel rounded on the way out
 * lands a fraction of a unit off the point that was asked for, and a menu item's
 * edge is exactly where that fraction decides the reading.
 */
function toClient(
  view: Viewport,
  dpr: number,
  x: number,
  y: number,
): { x: number; y: number } {
  return {
    x: (view.offsetX + x * view.scale) / dpr,
    y: (view.offsetY + y * view.scale) / dpr,
  };
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
 * A logical point's device pixel, through the world's camera and the engine's
 * fit. The camera opens at the defaults — world and logical coordinates
 * coincide, which is the space every figure the specs state is stated
 * in — so the projection is the identity unless the build moved it, and
 * mapping through it keeps the reading honest either way.
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

/**
 * A proxy that records every call and property set on its way to the real
 * context, so one frame produces both a pixel buffer to sample and a call list
 * to inspect.
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
        if (method === "drawImage") {
          const m = object.getTransform();
          call.transform = { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f };
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

/**
 * The debug surface the BUILD's instance returned from `initialize`, read off
 * the engine that holds it.
 *
 * This is deliberately a READ and never a construction. The surface is the
 * build's deliverable: its instance's `initialize` returns it
 * (specs/instrumentation.md), the engine keeps that same object, and
 * `engine.debug` is the only way it reaches a check. Nothing here could stand
 * in for it, because the build's own module for the surface is never imported.
 *
 * By the time this runs `engine.initialize()` has resolved, which is the one
 * precondition `engine.debug` has: it holds whatever the instance returned. A
 * build whose `initialize` returned `undefined` never gets this far, because
 * the engine rejects `initialize` itself, naming the missing surface, and the
 * rejection fails the suite's `beforeEach` with the engine's own message. Such
 * a build does not run on the engine under any entry point, so it is not this
 * harness's fault to report — which is why every suite's `afterEach` disposes
 * its harness with `?.`: the hook then has nothing to add to that message.
 *
 * What IS decided here is a return that is no surface — a build whose
 * `initialize` returned `null`, or something other than an object. That is a
 * fault in the build and not in this harness, so it must not present as one:
 *
 * - It is NOT thrown from here. Every suite builds its harness in a
 *   `beforeEach`, so a throw at this point would fail the hook and bury the
 *   real verdict under the harness's own stack in the case's own file.
 * - It is NOT swallowed either. {@link missingSurface} stands in for the
 *   missing surface and fails, by assertion, at the moment a check first
 *   reaches for an operation on it — naming the return the build owes.
 *
 * So the harness is built, teardown runs, and the fault lands exactly where
 * specs/instrumentation.md says it should: on the points whose checks reach the
 * game through the surface. A check that needs no surface is decided on its own
 * merits, and `instrumentation/surface-present` names the missing surface
 * outright.
 */
function readDebugSurface(engine: Engine<WirewormSurface>): WirewormSurface {
  const surface: unknown = engine.debug;
  if (typeof surface !== "object" || surface === null) {
    return missingSurface(
      `engine.debug holds ${surface === null ? "null" : typeof surface}, ` +
        `not an object`,
    );
  }
  return surface as WirewormSurface;
}

/**
 * A stand-in for the surface a build never returned: every operation on it
 * fails the check that reached for it, with the missing return named.
 *
 * A proxy rather than a hand-written stub, so a check that reaches for ANY
 * member — an operation this engine's surface carries, or one a future revision
 * adds — reports the missing surface rather than a `TypeError`.
 *
 * Keys that belong to the MACHINERY rather than to a check are answered with
 * `undefined` instead: awaiting the harness probes `then`, and vitest's own
 * error formatting probes symbols and `constructor`. Failing those would
 * replace the verdict below with noise from the machinery that was trying to
 * report it.
 */
function missingSurface(reason: string): WirewormSurface {
  return new Proxy({} as WirewormSurface, {
    get: (_target, property): unknown => {
      if (typeof property === "symbol") return undefined;
      if (property === "then" || property === "constructor") return undefined;
      return fail(SURFACE_REQUIREMENT, reason);
    },
  });
}

/**
 * What the build owes when its surface is missing: the `Expected:` line of the
 * failure every check that reaches for the surface lands on, beside what
 * `engine.debug` was found holding instead.
 */
const SURFACE_REQUIREMENT =
  "the debug surface src/game.ts's instance returns from initialize, which " +
  "the engine hands back from engine.debug (specs/instrumentation.md)";

/**
 * Build an engine over a canvas of the harness's own, initialize the build's
 * game, and hand back everything a check reads.
 *
 * The options passed to the factory are the ones the seeded `src/main.ts`
 * passes — the design size, the build's exported `BACKGROUND`, and the
 * four-way layout — so one harness serves every build of this case. Everything
 * else the build decided lives inside `src/game.ts`.
 */
export async function createHarness(
  options: HarnessOptions = {},
): Promise<Harness> {
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

  const engine = createEngine<WirewormSurface>({
    canvas: element,
    width: STAGE_W,
    height: STAGE_H,
    game,
    // The build's own stage background, handed to the engine exactly as the
    // seeded `src/main.ts` hands it (specs/overview.md).
    background: BACKGROUND,
    layout: LAYOUT,
    clock: options.clock ?? new ConstantClock(TICK_MS),
    surface,
  });

  // Subscribed BEFORE `initialize`, which is what makes the game's own loading
  // observable: construction runs no game code, so nothing has happened yet.
  const assetFailures: AssetFailure[] = [];
  const cues: PlayedCue[] = [];
  engine.events.on("asset:failed", ({ path, reason }) => {
    assetFailures.push({ path, reason });
  });
  engine.events.on("cue:played", ({ cue, t, gain }) => {
    cues.push({ cue, t, gain });
  });

  const instance = await engine.initialize();
  const debug = readDebugSurface(engine);

  const dispatch = (type: "keydown" | "keyup", code: string): void => {
    keys.dispatchEvent(new KeyEvent(type, code));
  };

  /**
   * The buttons each pointer id currently holds, kept exactly as a browser keeps
   * them: a press adds one, a release drops one, and every event reports the set
   * as it stands once the event has been applied. Without it a move issued in
   * the middle of a drag would report no button held, and the engine would read
   * the contact as no longer down.
   */
  const heldButtons = new Map<number, Set<PointerButton>>();
  const buttonsOf = (id: number): Set<PointerButton> => {
    const found = heldButtons.get(id);
    if (found !== undefined) return found;
    const created = new Set<PointerButton>();
    heldButtons.set(id, created);
    return created;
  };

  const dispatchPointer = (
    type: PointerEventName,
    x: number,
    y: number,
    button: number,
    pointerOptions: PointerOptions,
  ): void => {
    const id = pointerOptions.id ?? 1;
    const point = toClient(engine.viewport(), dpr, x, y);
    keys.dispatchEvent(
      new PointerEventShim(type, {
        clientX: point.x,
        clientY: point.y,
        pointerId: id,
        pointerType: pointerOptions.device ?? "mouse",
        isPrimary: pointerOptions.primary ?? true,
        button,
        buttons: buttonMask(buttonsOf(id)),
      }),
    );
  };

  /** The frames a pointer helper runs so the build sees what it dispatched. */
  const deliver = (pointerOptions: PointerOptions): Promise<void> =>
    engine.advance(pointerOptions.frames ?? 1);

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
    assetFailures,

    snapshot: () => debug.snapshot(),

    advance: (frames) => engine.advance(frames),
    advanceSeconds: (duration) => engine.advance(ticksFor(duration)),

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

    hold: (code) => dispatch("keydown", code),
    release: (code) => dispatch("keyup", code),
    async tap(code) {
      dispatch("keydown", code);
      dispatch("keyup", code);
      await engine.advance(1);
    },
    events: keys,

    async movePointer(x, y, pointerOptions = {}) {
      // `-1` is what a browser puts in `button` for an event about position.
      dispatchPointer("pointermove", x, y, -1, pointerOptions);
      await deliver(pointerOptions);
    },
    async pressPointer(x, y, pointerOptions = {}) {
      const button = pointerOptions.button ?? "primary";
      buttonsOf(pointerOptions.id ?? 1).add(button);
      dispatchPointer(
        "pointerdown",
        x,
        y,
        buttonIndexOf(button),
        pointerOptions,
      );
      await deliver(pointerOptions);
    },
    async releasePointer(x, y, pointerOptions = {}) {
      const button = pointerOptions.button ?? "primary";
      buttonsOf(pointerOptions.id ?? 1).delete(button);
      dispatchPointer("pointerup", x, y, buttonIndexOf(button), pointerOptions);
      await deliver(pointerOptions);
    },
    async tapPointer(x, y, pointerOptions = {}) {
      const button = pointerOptions.button ?? "primary";
      const id = pointerOptions.id ?? 1;
      buttonsOf(id).add(button);
      dispatchPointer(
        "pointerdown",
        x,
        y,
        buttonIndexOf(button),
        pointerOptions,
      );
      buttonsOf(id).delete(button);
      dispatchPointer("pointerup", x, y, buttonIndexOf(button), pointerOptions);
      await deliver(pointerOptions);
    },

    device: (x, y) => toDevice(engine.world, engine.viewport(), x, y),
    pixel: (x, y) => {
      const point = toDevice(engine.world, engine.viewport(), x, y);
      const { data } = ctx.getImageData(point.x, point.y, 1, 1);
      return [data[0], data[1], data[2], data[3]];
    },

    dispose: () => engine.destroy(),
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
// how a check produces one, over the engine's own draw-command recorder.
//
// Four properties are what make it usable, and each is deliberate:
//
// 1. IT RECORDS THE SECTION, NOT THE RUN. The recorder is armed around the
//    caller's scenario and disarmed the moment that scenario returns, so what is
//    kept is the part the check is ABOUT and never the setup that got there.
//    ARM IT NARROWLY IN THIS CASE. A live discharge re-jitters its lightning
//    every frame, so those polylines are a fresh operation each time and nothing
//    in them ever dedupes; a recording that spans a whole scenario as well as
//    the detonation it is about grows fast against the recorder's own capture
//    budget, past which a new image records as an opaque marker. A check about
//    the arcs arms around the frames the arcs are alive for.
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
 * `validation/worm/winds-horizontal.test.ts` — because that is the path the
 * review item's declared script resolves to, and so the only name the case's
 * manifest and the runner both already agree on.
 */
const STAGED_PROJECT_DIR = "validation";

/**
 * The most frames a written recording holds.
 *
 * A recording is one JSON operation log per frame, so a section a check drives
 * for half a minute of game time runs to tens of megabytes — a file nobody can
 * serve to a reviewer and nobody wants in a run's artifacts. The cap is what
 * makes `captureReplay` safe to wrap ANY section in: an author arms the
 * recorder around what the check is about and never has to reason about how
 * long that turns out to be.
 *
 * The cap is generous enough that the great majority of this suite's sections —
 * a worm stepping across a few tiles, a bolt climbing the board, a discharge
 * chaining — are written whole.
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
 * whole point is to say each thing once.
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
 * what these outputs are named for. A sweep is evidence that the worm wound tile
 * by tile, and the winding is spread across the whole of it.
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
 * check's sweep stopped at — the split worm, the cleared cluster — and it is the
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
 * frame, which is close to the shape gzip is best at. That is what keeps a run's
 * whole set of recordings to a few megabytes. Every host that serves one declares
 * the encoding, so the browser inflates it before the player sees it, and the
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
    console.warn(`wireworm: could not write ${destination}: ${String(error)}`);
  }
}

/**
 * Record the frames `scenario` draws and keep them as the review item's
 * `outputId` output, handing back whatever the scenario returned.
 *
 * Wrap the drive, not the arrangement:
 *
 * ```ts
 * await captureReplay(h, "split", async () => {
 *   h.debug.addBolt(tileCX(10), tileCY(19));
 *   await h.advance(60);
 * });
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
 * PICTURE rather than a stretch of motion: the posed board, the four charge
 * states side by side, the title screen. A recording of a still screen would be
 * the same frame three hundred times over, and a reviewer looking at a board
 * wants to look at the board.
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
    console.warn(`wireworm: could not write ${destination}: ${String(error)}`);
  }
}

/* -------------------------------------------------------------------------- */
/* Scenario helpers                                                           */
/* -------------------------------------------------------------------------- */
//
// Each of these poses a situation through the debug surface — or the real
// registered actions — and then lets the build's own rules run. They fix only
// arrangement: which tile a worm's head is on, where a foe is placed, which key
// is held. Every threshold a check asserts is stated in the check itself,
// derived from the figure or rule specs/ states for it.
//
// A check calls the ones it needs and no more. Nothing here is a prerequisite of
// anything else here: a check about the title menu poses no board, and a check
// about a worm's step poses no foe.

/**
 * `reset({seed})`: the title screen, a seeded generator, every declared field at
 * its title-screen value. Every suite's opening move.
 *
 * No frame is advanced. A pose acts on the live game at the call under this
 * engine (specs/instrumentation.md), so the state is restored when this returns,
 * and a check about what `reset` restores — `simTime` among them — reads a game
 * that has run no frame since.
 */
export function resetTo(h: Harness, seed?: number): void {
  h.debug.reset(seed === undefined ? undefined : { seed });
}

/**
 * A NEW RUN, opened the way a player opens one.
 *
 * `reset(seed)` for the title screen and a seeded generator, then `confirm` on
 * the title's highlighted first item, `DESCEND`, which is what opens a run
 * (specs/ui.md) — and a run opens with the fresh scatter specs/nodes.md lays
 * (specs/progression.md, Starting a run). No pose on the surface starts a run,
 * and there is not meant to be one: the field is laid by the path the menu
 * takes, and that path is what a check about the starting field is about.
 *
 * One frame runs, the frame that delivers the key's edge. A run opens on its
 * `banner` phase, so the level's worm has not entered and level 1 spawns no
 * foe, and what stands on the board when this returns is the starting field
 * alone.
 */
export async function startRun(h: Harness, seed?: number): Promise<void> {
  resetTo(h, seed);
  await tapAction(h, "confirm");
}

/**
 * Live play on an EMPTY, QUIET board at level 1, with the cursor centred in its
 * band and able to fire.
 *
 * This is the ground almost every mechanical check stands on, and it is a
 * harness sequence rather than a debug operation because the surface is atomic:
 * every line below is one of its operations.
 *
 * EMPTY is safe. A level clears on the step in which the last of its segments is
 * REMOVED (specs/progression.md), so a board that never held one never clears,
 * and a posed rule runs without the level advancing underneath it.
 *
 * QUIET is the three world gates. With `foeSpawning`, `wormEntry` and the
 * cursor's `contact` all off, nothing the scenario did not ask for arrives,
 * enters, or costs a life: no dropper is drawn in by the sparse field this poses,
 * no glitch arrives on its interval, no worm materialises when a banner gives
 * way, and no incidental touch empties both rosters mid-scenario.
 *
 * A check whose REQUIREMENT is one of those three faculties turns that one back
 * on itself, and only that one. A check that finds itself needing a gate for any
 * other reason has been mis-posed.
 *
 * The generator is left as it stands, so a check that wants a seeded one calls
 * {@link resetTo} first. No frame is advanced: every pose here lands at the call.
 */
export function startPlaying(h: Harness): void {
  h.debug.clearNodes();
  h.debug.clearWorms();
  h.debug.clearFoes();
  h.debug.clearBolts();
  h.debug.setFoeSpawning(false);
  h.debug.setWormEntry(false);
  h.debug.setCursorContact(false);
  h.debug.setScreen("playing");
  h.debug.setPhase("active");
  h.debug.setPhaseTimer(0);
  h.debug.setLevel(1);
  h.debug.setCursor(BAND_CX, BAND_CY);
  h.debug.setCursorInvulnerable(0);
  h.debug.setFireCooldown(0);
}

/**
 * A worm laid along `tiles`, head first, and its id.
 *
 * `tiles[0]` is the head and each further tile is appended to the tail end, so
 * the caller writes the worm's shape out in the order the snapshot reports it.
 * The headings are posed after the segments, because a heading is a field of the
 * worm rather than a consequence of its shape.
 *
 * The id comes off the snapshot's last worm, which is where an added worm lands
 * (specs/instrumentation.md, Identity). A build whose `addWorm` added nothing
 * fails here, naming the operation.
 */
export function poseWormPath(
  h: Harness,
  tiles: readonly Tile[],
  dh = 1,
  dv = 1,
): number {
  if (tiles.length === 0) {
    fail("a worm of at least one segment", "no tiles");
  }
  const head = tiles[0];
  h.debug.addWorm(head.c, head.r);
  const worms = h.snapshot().worms;
  if (worms.length === 0) {
    fail(
      `addWorm(${head.c}, ${head.r}) to append a worm to the roster ` +
        `(specs/instrumentation.md)`,
      "the worm roster is empty",
    );
  }
  const added = worms[worms.length - 1];
  for (let index = 1; index < tiles.length; index += 1) {
    h.debug.appendSegment(added.id, tiles[index].c, tiles[index].r);
  }
  h.debug.setWormHeading(added.id, dh);
  h.debug.setWormDescent(added.id, dv);
  return added.id;
}

/**
 * A worm of `length` segments with its head on `(c, r)`, trailing BEHIND the
 * head — away from the direction `dh` points — and its id.
 *
 * The straight-line case of {@link poseWormPath}, which is the shape a level's
 * worm enters in and the shape almost every check poses. A worm whose body bends
 * (one that has just dropped a row) is posed with {@link poseWormPath}.
 */
export function poseWorm(
  h: Harness,
  c: number,
  r: number,
  length = 1,
  dh = 1,
  dv = 1,
): number {
  const tiles: Tile[] = [];
  for (let index = 0; index < length; index += 1) {
    tiles.push({ c: c - dh * index, r });
  }
  return poseWormPath(h, tiles, dh, dv);
}

/**
 * A foe of `kind` with its center on tile `(c, r)`, and its id.
 *
 * It arrives at the kind's own resting velocity with both faculties on
 * (specs/instrumentation.md), so a check that wants it still holds `travel` off
 * and a check that wants it inert holds `mind` off.
 */
export function poseFoe(
  h: Harness,
  kind: FoeKind,
  c: number,
  r: number,
): number {
  const { x, y } = tileCenter(c, r);
  return poseFoePoint(h, kind, x, y);
}

/** A foe of `kind` with its center at a logical stage point, and its id. */
export function poseFoePoint(
  h: Harness,
  kind: FoeKind,
  x: number,
  y: number,
): number {
  h.debug.addFoe(kind, x, y);
  const foes = h.snapshot().foes;
  if (foes.length === 0) {
    fail(
      `addFoe(${JSON.stringify(kind)}, ${x}, ${y}) to append a foe to the ` +
        `roster (specs/instrumentation.md)`,
      "the foe roster is empty",
    );
  }
  return foes[foes.length - 1].id;
}

/** A bolt in flight with its center at a logical stage point, and its id. */
export function poseBolt(h: Harness, x: number, y: number): number {
  h.debug.addBolt(x, y);
  const bolts = h.snapshot().bolts;
  if (bolts.length === 0) {
    fail(
      `addBolt(${x}, ${y}) to append a bolt to the roster ` +
        `(specs/instrumentation.md)`,
      "the bolt roster is empty",
    );
  }
  return bolts[bolts.length - 1].id;
}

/**
 * A bolt climbing the column tile `(c, r)` sits in, its center on that tile's
 * center, and its id. The tile-addressed form of {@link poseBolt}, for a check
 * that aims a shot at something it posed on the grid.
 */
export function poseBoltAtTile(h: Harness, c: number, r: number): number {
  const { x, y } = tileCenter(c, r);
  return poseBolt(h, x, y);
}

/* ---- Driving the real input path ------------------------------------------ */

/** An action the game registers, as specs/controls.md names them. */
export type Action = keyof typeof BINDINGS;

/**
 * The action's first bound key, from the case-fixed `BINDINGS` table, pressed
 * and released as a player would press it — the REAL registered-action path,
 * which is the only way the menus move (specs/ui.md).
 */
export async function tapAction(h: Harness, action: Action): Promise<void> {
  await h.tap(BINDINGS[action][0]);
}

/** Hold the action's first bound key down, as a player holding it would. */
export function holdAction(h: Harness, action: Action): void {
  h.hold(BINDINGS[action][0]);
}

/** Release the action's first bound key. */
export function releaseAction(h: Harness, action: Action): void {
  h.release(BINDINGS[action][0]);
}

/**
 * Hold `code` down for `frames` frames and let it up.
 *
 * The key is down for the whole of the run, so a check that measures a rate
 * measures exactly `frames` frames of movement. The release is in a `finally`,
 * so a scenario that failed mid-hold does not leave the key down for the next
 * one.
 */
export async function holdFor(
  h: Harness,
  code: string,
  frames: number,
): Promise<void> {
  h.hold(code);
  try {
    await h.advance(frames);
  } finally {
    h.release(code);
  }
}

/** {@link holdFor} against an action's first bound key. */
export function holdActionFor(
  h: Harness,
  action: Action,
  frames: number,
): Promise<void> {
  return holdFor(h, BINDINGS[action][0], frames);
}

/**
 * Hold two keys down together for `frames` frames and let both up — the
 * diagonal a check about normalized movement drives.
 */
export async function holdBothFor(
  h: Harness,
  first: string,
  second: string,
  frames: number,
): Promise<void> {
  h.hold(first);
  h.hold(second);
  try {
    await h.advance(frames);
  } finally {
    h.release(first);
    h.release(second);
  }
}

/* -------------------------------------------------------------------------- */
/* Reading the snapshot                                                       */
/* -------------------------------------------------------------------------- */
//
// Plain functions over the object `snapshot()` returned, so a check reads what
// it is about without walking a roster by hand. None of them asserts anything:
// a reading that is not there comes back `undefined`, and what that means is the
// check's to state.

/** The node on tile `(c, r)`, or `undefined` where the tile is empty. */
export function nodeAt(
  snapshot: WirewormSnapshot,
  c: number,
  r: number,
): NodeSnapshot | undefined {
  return snapshot.nodes.find((node) => node.c === c && node.r === r);
}

/**
 * The charge on tile `(c, r)`, or `null` where the tile holds no node.
 *
 * `null` rather than `0`, because an empty tile and an inert node are different
 * states of the field: a bolt clears an inert node to nothing, and a check that
 * read both as `0` could not tell the two apart.
 */
export function chargeAt(
  snapshot: WirewormSnapshot,
  c: number,
  r: number,
): number | null {
  return nodeAt(snapshot, c, r)?.charge ?? null;
}

/** The worm with that id, or `undefined` where no worm carries it. */
export function wormById(
  snapshot: WirewormSnapshot,
  id: number,
): WormSnapshot | undefined {
  return snapshot.worms.find((worm) => worm.id === id);
}

/** The foe with that id, or `undefined` where no foe carries it. */
export function foeById(
  snapshot: WirewormSnapshot,
  id: number,
): FoeSnapshot | undefined {
  return snapshot.foes.find((foe) => foe.id === id);
}

/** The bolt with that id, or `undefined` where no bolt carries it. */
export function boltById(
  snapshot: WirewormSnapshot,
  id: number,
): BoltSnapshot | undefined {
  return snapshot.bolts.find((bolt) => bolt.id === id);
}

/** A worm's head tile, or `undefined` where it has no segments. */
export function headOf(worm: WormSnapshot): Tile | undefined {
  return worm.segments[0];
}

/** A worm's tail tile, or `undefined` where it has no segments. */
export function tailOf(worm: WormSnapshot): Tile | undefined {
  return worm.segments[worm.segments.length - 1];
}

/** The worm holding a segment on tile `(c, r)`, in roster order. */
export function wormOn(
  snapshot: WirewormSnapshot,
  c: number,
  r: number,
): WormSnapshot | undefined {
  return snapshot.worms.find((worm) =>
    worm.segments.some((segment) => segment.c === c && segment.r === r),
  );
}

/** Every tile a worm segment stands on, across every worm on the board. */
export function segmentTiles(snapshot: WirewormSnapshot): Tile[] {
  return snapshot.worms.flatMap((worm) => worm.segments);
}

/** Whether the discharge reported an arc joining two tiles, either way round. */
export function arcJoins(
  snapshot: WirewormSnapshot,
  a: Tile,
  b: Tile,
): boolean {
  const same = (left: Tile, right: Tile): boolean =>
    left.c === right.c && left.r === right.r;
  return snapshot.arcs.some(
    (arc) =>
      (same(arc.from, a) && same(arc.to, b)) ||
      (same(arc.from, b) && same(arc.to, a)),
  );
}

/* -------------------------------------------------------------------------- */
/* The cues                                                                   */
/* -------------------------------------------------------------------------- */

/** A cue the build played, and the frame of the run it played on. */
export interface TimedCue {
  cue: string;
  /** The frame loop's simulated time when it played, in milliseconds. */
  t: number;
  /** The cue's gain: zero while the bus is muted, positive otherwise. */
  gain: number;
  /** The frame it played on, 1-based, as `engine.frame().count` reports. */
  frame: number;
}

/**
 * Record every cue the build plays from now on, stamped with its frame.
 *
 * The engine publishes `cue:played` synchronously from inside `audio.play`, so
 * the handler runs while the frame that played it is still running and
 * `engine.frame().count` is that frame's own number. That is what lets a check
 * assert not merely that a cue sounded but that it sounded on the frame of the
 * event — which is what tells a build that plays a cue on the right event apart
 * from one that plays it on every frame, or a frame late.
 */
export function watchCues(h: Harness): TimedCue[] {
  const played: TimedCue[] = [];
  h.engine.events.on("cue:played", ({ cue, t, gain }) => {
    played.push({ cue, t, gain, frame: h.engine.frame().count });
  });
  return played;
}

/** Every recorded firing of the cue named `name`, oldest first. */
export function cuesNamed(h: Harness, name: string): PlayedCue[] {
  return h.cues.filter((cue) => cue.cue === name);
}

/** Forget every cue recorded so far, so a check reads its own section alone. */
export function clearCues(h: Harness): void {
  h.cues.length = 0;
}

/* -------------------------------------------------------------------------- */
/* Reading the rendered pixels                                                */
/* -------------------------------------------------------------------------- */

/** A sampled colour, each channel 0–255. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * The rendered colour at a logical point, averaged over a small cluster.
 *
 * The centre pixel plus four neighbours 4 units out — well inside a 32-unit tile
 * and inside the 24-unit body a foe or a node is drawn as — so one stray
 * anti-aliased or glow pixel cannot swing the reading.
 */
export function sampleColor(h: Harness, x: number, y: number): Rgb {
  const offsets: readonly (readonly [number, number])[] = [
    [0, 0],
    [4, 0],
    [-4, 0],
    [0, 4],
    [0, -4],
  ];
  let r = 0;
  let g = 0;
  let b = 0;
  for (const [dx, dy] of offsets) {
    const [pr, pg, pb] = h.pixel(x + dx, y + dy);
    r += pr;
    g += pg;
    b += pb;
  }
  return {
    r: r / offsets.length,
    g: g / offsets.length,
    b: b / offsets.length,
  };
}

/** The rendered colour at the centre of tile `(c, r)`. */
export function sampleTile(h: Harness, c: number, r: number): Rgb {
  const { x, y } = tileCenter(c, r);
  return sampleColor(h, x, y);
}

/** How bright a colour is, on the 0–255 scale (Rec. 601). */
export function luminance(colour: Rgb): number {
  return 0.299 * colour.r + 0.587 * colour.g + 0.114 * colour.b;
}

/**
 * How far inside a tile's edges {@link litTile} reads, in logical units.
 *
 * A build is free to rule its board, and any such ruling runs along the tile
 * boundaries, so a box that reached the edges would read the ruling rather than
 * what stands on the tile. Four units of margin on a `TILE` of `32` leaves a
 * `24 x 24` box, which still covers the middle three quarters of the
 * `SPRITE_SIZE` (`32`) frame drawn on it.
 */
const LIT_INSET = 4;

/**
 * The fraction of a tile's pixels {@link litTile} reads a colour from: the
 * brightest of them.
 *
 * A twentieth of a `24 x 24` box is about 29 pixels — a mark a player sees
 * rather than a stray pixel, and small enough that a sparse seeded frame is read
 * by its own lit core rather than by the board around it.
 */
const LIT_FRACTION = 0.05;

/**
 * The colour of whatever is LIT on tile `(c, r)`: the mean of the brightest
 * {@link LIT_FRACTION} of the pixels inside the tile.
 *
 * {@link sampleTile} reads five points around a tile's centre, which is the
 * right reading for a body drawn as a solid shape — a bolt, the cursor's mark,
 * the band — and the wrong one for a sparse figure. Every seeded frame under
 * `assets/` is a sparse mark on a transparent field: the node art is a lit core
 * inside a dark casing, and a five-point cross through its centre can land
 * wholly on the casing and read the same colour for two states the art draws
 * differently. This reads the mark instead, which is what specs/overview.md's
 * legibility table is written about.
 *
 * On bare board every pixel is the ground, so this reads the ground, and an
 * element and the ground behind it are always compared like with like.
 */
export function litTile(h: Harness, c: number, r: number): Rgb {
  const half = TILE / 2 - LIT_INSET;
  const centre = tileCenter(c, r);
  const from = h.device(centre.x - half, centre.y - half);
  const to = h.device(centre.x + half, centre.y + half);
  const { data } = h.ctx.getImageData(
    from.x,
    from.y,
    Math.max(1, to.x - from.x),
    Math.max(1, to.y - from.y),
  );
  const pixels: Rgb[] = [];
  for (let i = 0; i < data.length; i += 4) {
    pixels.push({ r: data[i], g: data[i + 1], b: data[i + 2] });
  }
  pixels.sort((a, b) => luminance(b) - luminance(a));
  const taken = Math.max(1, Math.round(pixels.length * LIT_FRACTION));
  let red = 0;
  let green = 0;
  let blue = 0;
  for (let i = 0; i < taken; i += 1) {
    red += pixels[i].r;
    green += pixels[i].g;
    blue += pixels[i].b;
  }
  return { r: red / taken, g: green / taken, b: blue / taken };
}

/** Euclidean distance between two colours, 0 to about 441. */
export function colorDistance(a: Rgb, b: Rgb): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

/**
 * The build's exported `BACKGROUND`, rasterized: the colour the engine clears
 * the whole canvas to each frame (specs/overview.md), read back through the
 * same canvas implementation the harness samples with, so a pixel the game
 * never drew over compares against it exactly.
 *
 * The fill is repeated rather than applied once so a translucent colour reads
 * as the engine leaves it: the engine composites its clear over the previous
 * frame every frame, which converges on the colour's own channels, and a single
 * fill over a transparent canvas would not.
 */
export function clearColor(): Rgb {
  const probe = createCanvas(1, 1);
  const ctx = probe.getContext("2d");
  ctx.fillStyle = BACKGROUND;
  for (let i = 0; i < 255; i += 1) ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return { r, g, b };
}

/**
 * The canvas's whole backing store, copied — so a check can hold two frames
 * apart and say whether anything the build drew changed between them.
 */
export function canvasPixels(h: Harness): Uint8ClampedArray {
  const { width, height } = h.canvas;
  return Uint8ClampedArray.from(h.ctx.getImageData(0, 0, width, height).data);
}

/** How many bytes differ between two {@link canvasPixels} captures. */
export function pixelsChanged(
  before: Uint8ClampedArray,
  after: Uint8ClampedArray,
): number {
  let changed = 0;
  const length = Math.min(before.length, after.length);
  for (let i = 0; i < length; i += 1) {
    if (before[i] !== after[i]) changed += 1;
  }
  return changed + Math.abs(before.length - after.length);
}

/* -------------------------------------------------------------------------- */
/* Reading one frame's render                                                 */
/* -------------------------------------------------------------------------- */

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

/**
 * The geometry calls a frame made, by name.
 *
 * Enough of a count to compare two frames of the same scene: a frame that drew a
 * discharge asked for strictly more of these than the same frame with the arcs
 * gone, whatever shape the build chose to draw them as.
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
 * Every point a frame's drawing calls named, in the space the game draws in.
 *
 * The pipeline sets the world-to-device transform on the context before a
 * component draws, so the coordinates a drawing call carries are the game's own
 * — and with the camera at its defaults those are logical units. Where a render
 * put its geometry is the direct reading of it: the points along a column are
 * the bolt climbing it, and the points between two tile centres are an arc. The
 * leading pair of arguments is the position for every method listed, except the
 * curve calls, whose control points come first and whose endpoint is the last
 * pair.
 *
 * `drawImage` is not in here, because its leading argument is a bitmap rather
 * than a coordinate and a mirrored draw states its rectangle in a flipped
 * space: read those with {@link drawnImages}.
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
      method === "lineTo"
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

/** One bitmap a frame blitted, placed in logical units. */
export interface DrawnImage {
  /** The source the build handed the context, for {@link nearestSeededFrame}. */
  source: { width: number; height: number };
  /** The destination rectangle's centre, in logical units. */
  x: number;
  y: number;
  /** The destination rectangle's size, in logical units, always positive. */
  w: number;
  h: number;
  /**
   * Whether the transform at the call flipped the drawing, which is how the
   * seeded art — all of which faces right — is drawn facing left
   * (specs/assets.md).
   */
  mirrored: boolean;
  /**
   * The transform the context held at the call, which is where a rotation is.
   * A blit drawn upright carries no shear terms whatever scale the engine's fit
   * applied; a turn puts them there.
   */
  transform: Matrix;
}

/**
 * Every bitmap the frame blitted, with its destination placed in logical units.
 *
 * A `drawImage` carries its destination in whatever space the context held at
 * the call, and a build draws a leftward worm or corruptor by flipping the
 * horizontal axis about the sprite's centre, which states that rectangle in a
 * flipped space. The transform recorded beside the call is what maps it back, so
 * a mirrored sprite and an upright one both report the centre they were drawn
 * on and the mirrored one reports `mirrored`.
 *
 * The three-argument form takes its size from the source's own dimensions, which
 * is what the canvas does with it.
 */
export function drawnImages(h: Harness): DrawnImage[] {
  const view = h.engine.viewport();
  const images: DrawnImage[] = [];
  for (const call of h.calls) {
    if (call.kind !== "call") continue;
    if (call.method !== "drawImage" || call.transform === undefined) continue;
    const source = call.args[0] as { width?: unknown; height?: unknown } | null;
    if (
      source === null ||
      typeof source !== "object" ||
      typeof source.width !== "number" ||
      typeof source.height !== "number"
    ) {
      continue;
    }

    const numbers = call.args
      .slice(1)
      .map((value) => (typeof value === "number" ? value : NaN));
    let dx: number;
    let dy: number;
    let dw: number;
    let dh: number;
    if (numbers.length >= 8) {
      [dx, dy, dw, dh] = numbers.slice(4, 8);
    } else if (numbers.length >= 4) {
      [dx, dy, dw, dh] = numbers.slice(0, 4);
    } else if (numbers.length >= 2) {
      [dx, dy] = numbers.slice(0, 2);
      dw = source.width;
      dh = source.height;
    } else {
      continue;
    }
    if (![dx, dy, dw, dh].every(Number.isFinite)) continue;

    const m = call.transform;
    // The destination rectangle's centre, through the transform the call was
    // made under and then back through the engine's fit to logical units.
    const localX = dx + dw / 2;
    const localY = dy + dh / 2;
    const deviceX = m.a * localX + m.c * localY + m.e;
    const deviceY = m.b * localX + m.d * localY + m.f;
    images.push({
      source: source as { width: number; height: number },
      x: (deviceX - view.offsetX) / view.scale,
      y: (deviceY - view.offsetY) / view.scale,
      w: (Math.abs(dw) * Math.hypot(m.a, m.b)) / view.scale,
      h: (Math.abs(dh) * Math.hypot(m.c, m.d)) / view.scale,
      // A negative determinant is a reflection, which is the only way an axis
      // is flipped: a rotation alone leaves it positive.
      mirrored: m.a * m.d - m.b * m.c < 0,
      transform: m,
    });
  }
  return images;
}

/** One run of text a frame drew, and the logical x range its glyphs span. */
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
 * Every run of text the frame drew, placed in logical units.
 *
 * A build may anchor its text through any transform the pipeline or its own
 * drawing applies and align it any way it likes, so the anchor is mapped
 * through the transform the context held at the call and the run is extended
 * about it by its measured width and `textAlign`. Which way a `start`/`end`
 * alignment reads is the page's direction; this game draws no right-to-left
 * text, so they are left and right.
 *
 * The OVERLAY's text is in here too when the overlay is up: the engine draws
 * it through the same context, in device pixels under an identity transform,
 * which this mapping carries back to logical units like any other run.
 */
export function drawnTextSpans(h: Harness): TextSpan[] {
  const view = h.engine.viewport();
  const spans: TextSpan[] = [];
  for (const call of h.calls) {
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

/* -------------------------------------------------------------------------- */
/* The diagnostics overlay                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Toggle the engine's diagnostics overlay and run the frame that draws — or
 * stops drawing — it.
 *
 * The overlay is ENGINE CHROME under this engine: the backtick key
 * (`Backquote`) toggles it through a keydown listener the engine itself owns on
 * the harness's event target, never through a registered action (engine docs,
 * diagnostics.md). It is drawn after the pipeline renders, through the same
 * context this harness records — so with the overlay up, the registered
 * sources' lines land in `h.calls` as ordinary text draws, readable with
 * {@link drawnText} — but AFTER the engine recorder's bracket closes, so none of
 * it appears in a `captureReplay` recording. Capture overlay evidence with
 * {@link captureStill}.
 */
export async function toggleOverlay(h: Harness): Promise<void> {
  h.hold("Backquote");
  h.release("Backquote");
  await h.advance(1);
}

/* -------------------------------------------------------------------------- */
/* The menus, where the build drew them                                       */
/* -------------------------------------------------------------------------- */
//
// `specs/ui.md` gives every menu screen a mouse and a finger as well as the
// keyboard, and deliberately leaves the LAYOUT to the build: what it fixes is
// that the build reports each item's hit region through `menuItemRect`, and that
// a pointer over that region selects the item. So every helper below asks the
// build where it put the item and then drives the pointer there. Nothing here
// knows a menu coordinate, and a build that lays its menus out any way it likes
// passes.

/**
 * The hit region of item `index` on the menu the current screen shows.
 *
 * `menuItemRect` returns `null` on `playing` and `howto`, which show no menu,
 * and for an index the current menu has no item at. A check that asked for an
 * item it expects to exist gets a failure naming the reading rather than a
 * `TypeError` on the next line.
 */
export function menuRect(h: Harness, index: number): MenuRect {
  const rect = h.debug.menuItemRect(index);
  if (rect === null || rect === undefined) {
    fail(
      `menuItemRect(${index}) to report the hit region of item ${index} on ` +
        `the menu the current screen shows (specs/instrumentation.md)`,
      rect,
    );
  }
  return rect;
}

/** The centre of item `index`'s hit region, in logical units. */
export function menuItemCenter(
  h: Harness,
  index: number,
): { x: number; y: number } {
  const rect = menuRect(h, index);
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/**
 * Move the pointer onto item `index` and run the frame that reads it.
 *
 * The hover `specs/ui.md` selects on: no button is pressed, so what a check
 * reads afterwards is `menuIndex` alone.
 */
export async function pointAtItem(
  h: Harness,
  index: number,
  options: PointerOptions = {},
): Promise<void> {
  const at = menuItemCenter(h, index);
  await h.movePointer(at.x, at.y, options);
}

/**
 * Press and release inside item `index`'s region, both edges on one frame.
 *
 * A press and its release inside ONE region is what confirms (`specs/ui.md`),
 * and a frame may carry both, so this is the ordinary click. Pass
 * `device: "touch"` for the finger's form of the same gesture, whose landing
 * also selects.
 */
export async function clickItem(
  h: Harness,
  index: number,
  options: PointerOptions = {},
): Promise<void> {
  const at = menuItemCenter(h, index);
  await h.tapPointer(at.x, at.y, options);
}

/** {@link clickItem} with a finger: a touch contact landing and lifting. */
export function touchItem(
  h: Harness,
  index: number,
  options: PointerOptions = {},
): Promise<void> {
  return clickItem(h, index, { ...options, device: "touch" });
}

/**
 * Press inside item `from`'s region, travel onto item `to`'s, and release there.
 *
 * The slide-off affordance: a press begun on one item and released on another
 * confirms nothing (`specs/ui.md`). Three driven frames, so the press, the
 * travel and the release are each read.
 */
export async function slideOffItem(
  h: Harness,
  from: number,
  to: number,
  options: PointerOptions = {},
): Promise<void> {
  const start = menuItemCenter(h, from);
  await h.pressPointer(start.x, start.y, options);
  const end = menuItemCenter(h, to);
  await h.movePointer(end.x, end.y, options);
  await h.releasePointer(end.x, end.y, options);
}
