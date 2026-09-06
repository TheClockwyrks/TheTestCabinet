// Floe — the shared validator harness. CASE-PROVIDED.
//
// Every check in this suite is an ordinary vitest test that runs IN THE SAME
// PROCESS as the build. It imports the engine and the build's own modules,
// creates an engine over a canvas it owns and a clock it chose, and steps the
// game with `engine.advance`. Nothing drives a browser, nothing polls, and no
// wall-clock time passes: a check asks for a number of frames and gets exactly
// that number, at exactly the deltas its clock supplied.
//
// WHAT IS HERE AND WHAT IS NOT. The machinery of that paragraph — the canvas and
// its draw-command recorder, the debug surface and the stand-in for a missing
// one, the frame sweep, the cue stamping, the pixel and text readings, the
// `fetch` and the image decoder a headless host lacks, and the evidence a review
// item's output is written from — is the shared `@clockwyrks/case-harness`
// package's, staged in beside this file as `./case-harness/`. What stays HERE is
// what is genuinely Floe's: the operations its `specs/instrumentation.md`
// requires, the shape of its snapshot, the way it divides an interval into
// calls, the readings it makes off its own seeded art, and the scenarios its
// checks are posed from.
//
// WHAT A CHECK READS. The game's own state (through the debug surface's
// `snapshot`), the engine's object model — the open world, its game state — the
// events the engine broadcast (the cues), and — for the presentation checks —
// the pixels on the canvas or the calls the 2D context received. Nothing here
// fabricates an outcome: the scenario helpers below only ARRANGE the strait
// through the debug surface, and the real rules the build wrote are what decide
// every hop, every glide and every catch from there.
//
// WHY THE DEBUG SURFACE RATHER THAN RAW ASSIGNMENT. specs/instrumentation.md
// fixes its operations, so they mean the same thing in every build:
// `addVehicle` puts a vehicle the covering rule reads unchanged, `addBear`
// builds a bear the hunt's own routing drives, `setLaneSpeed` sets the figure
// the lane integrates, and `reset` gives everything back. Posing through it is
// how a scenario is reproducible, and it is the seam the case's specification
// documents. `surface.ts` is that specification as types, and it is the only
// description of the surface this harness reads: the build's own module for it
// is never imported.
//
// WHERE THE SURFACE COMES FROM. Off `engine.debug`, never built here. The game
// instance's `initialize` returns it, the engine holds that same object, and
// reading it back off the engine is the only way a surface reaches a check — so
// a build that returned no surface, or a surface missing an operation, fails
// the checks that reach the game through it. The package's `readDebugSurface`
// does that read and stands an `absentSurface` in when there is nothing to read,
// so the fault lands on the points whose checks reach the game through the
// surface rather than on the `beforeEach` that built the harness.
//
// HOW THE SURFACE IS DRIVEN — the IDENTITY strategy, which is what a structured
// engine's state model allows. Under this engine a pose acts on the live game at
// the moment of the call and a reading is built at the call
// (specs/instrumentation.md), so the object the build returned IS what a check
// calls and nothing stands between the two. A scenario poses and then reads with
// no frame in between; a frame is advanced when the check wants the game to RUN —
// a lane to drift, a bear to glide, a timer to drain.
//
// THE HARNESS OWNS EVERY COMPOUND SEQUENCE. The surface is atomic by design:
// each operation sets one field, so "a quiet crossing at level 3" is a helper
// here rather than an operation there. A check that needs only part of a
// sequence calls the operations it needs, and nothing it did not ask for
// happens. The helpers fix GEOMETRY — which tile a bear is posed on, which
// columns a lane's items sit at — and never a threshold: every figure a check
// asserts is stated in that check, derived from what specs/ fixes for it.
//
// THE CLOCK IS THE HARNESS'S. `ConstantClock(TICK_MS)`, one frame to one
// simulation tick at Floe's own `TICK_HZ` of 120, so a duration is a whole
// number of frames on every machine. The fixed step is a rule of the GAME
// (specs/overview.md) rather than of the harness that drives it, which is why
// `[instrumentation]` carries no `tick_hz`: under an engine the clock is the
// engine's, a validator supplies its own, and the size of a step is stated in
// the validator that takes it. A check that is specifically about the step
// (instrumentation/deterministic-core, instrumentation/tick-length) builds its
// own harnesses with clocks of its own, or paces this one with {@link
// FloeModel.pace}.
//
// SPRITES, HEADLESS. The suite runs in `node`, where `fetch` and
// `createImageBitmap` do not exist, and the game loads its seeded art through
// the engine's asset loader. The package's asset host stands both up over the
// workspace's own tree when this module loads, so every build's art arrives
// exactly as it does in a browser. See `serveSeededAssets`.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import {
  ConstantClock,
  createEngine,
  type Engine,
  type GameDefinition,
  type GameInstance,
  type GameState,
  type SurfaceMetrics,
  type World,
} from "@clockwyrks/structured-2d";
import { makeTickMath } from "./case-harness/clock";
import { colorDistance, type Rgb } from "./case-harness/color";
import {
  createEngineCaseHarness,
  identityDriver,
  installAssetHost,
  type AssetFailure,
  type EngineHarness,
  type EngineHarnessOptions,
  type PlayedCue,
  type PointerEventType,
  type TimedCue,
  type UntilOptions,
  type UntilResult,
} from "./case-harness/engine/index";
import {
  allInLogical,
  canvasPixels,
  makeReplayCapture,
  pixelsChanged,
  sampleColor as sampleClusterColor,
  type EnginePointReader,
} from "./case-harness/engine/2d";
import { callsTo, setsOf, type DrawCall } from "./case-harness/draw-calls";
import { IDENTITY, transformed, type Matrix } from "./case-harness/matrix";
import { rectCenter, type Point } from "./case-harness/point";
import {
  drawnText as rawDrawnText,
  drawnTextRuns as sharedTextRuns,
  drewText as spelledText,
  textDraws,
  type TextDraw,
} from "./case-harness/text";
import {
  BAYS,
  BAY_COUNT,
  BEAR_FRAMES,
  BINDINGS,
  CAR_FRAMES,
  CROSSER_FRAMES,
  DOGSLED_FRAMES,
  HOP_COOLDOWN,
  ICE_BOTTOM,
  ICE_TOP,
  LAYOUT,
  PAN_FRAMES,
  PLOW_FRAMES,
  RAFT_FRAMES,
  ROW_BAYS,
  ROW_CAP,
  ROW_MEDIAN,
  ROW_NEAR,
  STAGE_H,
  STAGE_W,
  START_COL,
  START_LIVES,
  TICK_DT,
  TICK_HZ,
  TILE,
  WATER_BOTTOM,
  WATER_TOP,
  colAt,
  crossingTimer,
  rowAt,
  tileCX,
  tileCY,
  tileLeft,
} from "./constants";
import { BACKGROUND, game as build } from "../src/game";
import { fail } from "./assert";
import type {
  BearSnapshot,
  Facing,
  FloeDebugApi,
  FloeItemSnapshot,
  FloeKind,
  FloeSnapshot,
  Footing,
  ItemKind,
  LaneDir,
  LaneSnapshot,
  MenuRect,
  Phase,
  Screen,
  Tile,
  VehicleKind,
  VehicleSnapshot,
} from "./surface";

export type {
  BearSnapshot,
  Facing,
  FloeItemSnapshot,
  FloeKind,
  FloeSnapshot,
  Footing,
  ItemKind,
  LaneDir,
  LaneSnapshot,
  MenuRect,
  Phase,
  Screen,
  Tile,
  VehicleKind,
  VehicleSnapshot,
};

/* The readings this project takes straight off the package, under its names. */
export type { AssetFailure, DrawCall, Matrix, PlayedCue, Point, Rgb, TimedCue };
export {
  callsTo,
  canvasPixels,
  colorDistance,
  pixelsChanged,
  rectCenter,
  setsOf,
};

/** The case's surface, exactly as `surface.ts` specifies it. */
export type FloeSurface = FloeDebugApi;

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
export type FloeDriver = FloeSurface;

/** The engine this project stands a build up on. */
export type FloeEngine = Engine<FloeSurface>;

/**
 * The build's game, typed against the surface the CASE specifies.
 *
 * The build declares its own type for the surface its instance's `initialize`
 * returns — the `D` of its `GameDefinition<D>` — and that type is the build's:
 * what a check holds it to is `surface.ts`, so the definition is cast to the
 * case's `GameDefinition<FloeSurface>` here and the engine is parameterized
 * with it. A surface that departs from the specification is caught where a
 * check reaches for the missing member, not by the build's own compiler.
 */
const game = build as unknown as GameDefinition<FloeSurface>;

/* -------------------------------------------------------------------------- */
/* The clock                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The frame the suite steps in, in milliseconds: exactly one simulation tick.
 *
 * `specs/overview.md` fixes the game's step at `TICK_DT` (`1/120` s) and says
 * the simulation runs the whole ticks a frame's elapsed time completes. Handing
 * each frame exactly one tick's worth of time therefore makes `advance(n)` run
 * exactly `n` ticks, so a duration is a tick count and the arithmetic a check
 * asserts is the arithmetic `specs/` names.
 *
 * Derived from the build's own `TICK_DT` rather than from the rate, because that
 * is the figure this project's frames have always been the length of.
 */
export const TICK_MS = TICK_DT * 1000;

/**
 * The ticks {@link FloeModel.skip} puts in one frame.
 *
 * Waiting out a cadence the specification measures in tens of seconds is
 * thousands of ticks, and drawing a picture for each of them is most of what it
 * costs. Ten ticks a frame runs the same ticks and skips nine pictures in ten.
 */
export const COARSE_TICKS = 10;

/**
 * How far {@link FloeModel.skipUntil} sweeps when the caller names no ceiling,
 * and how much game time separates two of its readings. Both are in SECONDS of
 * game time, because a coarse sweep is for a wait the specification measures in
 * seconds rather than in ticks.
 *
 * A minute is the longest span any point in this suite watches for, and a
 * quarter of a second is a thirty-second of `FISH_INTERVAL` (`8` s), the longest
 * cadence the specification states — so no arrival is stepped over.
 */
const DEFAULT_SWEEP_SECONDS = 60;
const DEFAULT_SKIP_POLL_SECONDS = 0.25;

/**
 * The package's tick arithmetic, bound to the rate this suite steps at.
 *
 * Only {@link seconds} is taken off it: this project's `ticksFor` rounds to the
 * NEAREST whole tick where the package's rounds up, and that is a difference the
 * suite's figures rest on — see {@link ticksFor}.
 */
const arithmetic = makeTickMath(TICK_HZ);

/** Seconds of simulated time in `ticks` ticks. */
export const seconds = arithmetic.seconds;

/**
 * Whole ticks covering `duration` seconds of game time, rounded to whole.
 *
 * ROUNDED TO THE NEAREST, WHICH IS NOT WHAT THE PACKAGE'S `ticksFor` DOES, and
 * not what this case's `simple-2d` project does either: both round UP. The two
 * projects have disagreed since they were written, and the disagreement is
 * load-bearing here — `HOP_COOLDOWN` (`0.12` s) is `14.4` ticks, so this answers
 * `14` and {@link restHop} waits `15`, where rounding up would wait `16`. So this
 * one stays the case's own.
 */
export function ticksFor(duration: number): number {
  return Math.round(duration * TICK_HZ);
}

/* -------------------------------------------------------------------------- */
/* The strait, in the space the surface speaks                                */
/* -------------------------------------------------------------------------- */

/** A tile's center in stage units, which is what a BODY's pose takes. */
export function tileCenter(c: number, r: number): Point {
  return { x: tileCX(c), y: tileCY(r) };
}

/**
 * The tile a stage point falls on, the inverse of {@link tileCenter}.
 *
 * A point inside the HUD bar answers with a negative row, which is the honest
 * reading of a point that is above the strait rather than on a tile.
 */
export function tileAtPoint(x: number, y: number): Tile {
  return { col: colAt(x), row: rowAt(y) };
}

/** The band a strait row belongs to, as specs/strait.md names the five. */
export type Band = "cap" | "bays" | "water" | "median" | "ice" | "near" | "off";

/** Which of the five bands a row is, or `"off"` for a row off the strait. */
export function bandOf(row: number): Band {
  if (row === ROW_CAP) return "cap";
  if (row === ROW_BAYS) return "bays";
  if (row >= WATER_TOP && row <= WATER_BOTTOM) return "water";
  if (row === ROW_MEDIAN) return "median";
  if (row >= ICE_TOP && row <= ICE_BOTTOM) return "ice";
  if (row === ROW_NEAR) return "near";
  return "off";
}

/** The two columns bay `index` covers, from the case-fixed `BAYS` table. */
export function bayColumns(index: number): readonly [number, number] {
  const pair = BAYS[index];
  if (pair === undefined) {
    fail(`a bay index in 0..${BAY_COUNT - 1}`, index);
  }
  return pair;
}

/** The bay a column of the bay row falls in, or `null` for solid far shore. */
export function bayAtColumn(col: number): number | null {
  const index = BAYS.findIndex((pair) => pair[0] === col || pair[1] === col);
  return index === -1 ? null : index;
}

/**
 * Whether a lane item covers a point on its own row, by the covering rule
 * specs/ice.md fixes for both bands: `x` lies in `[itemX, itemX + TILE * len)`.
 */
export function itemCoversPoint(
  item: { x: number; len: number },
  x: number,
): boolean {
  return x >= item.x && x < item.x + TILE * item.len;
}

/** Whether a lane item covers a tile of its row: that tile's center is covered. */
export function itemCoversTile(
  item: { x: number; len: number },
  col: number,
): boolean {
  return itemCoversPoint(item, tileCX(col));
}

/* -------------------------------------------------------------------------- */
/* The seeded art, served to a headless host                                  */
/* -------------------------------------------------------------------------- */

/**
 * The directory this harness sits in, which is the validator project's root.
 *
 * Taken from this module's own URL rather than from the working directory,
 * because it has to name the same directory wherever the suite is run from. It
 * may never be derived inside the package, which is staged one level deeper than
 * this file, or every produced output would be addressed one directory too far
 * down — silently, because the writers are required not to raise.
 */
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * The workspace the project is staged into, which is where `assets/` and
 * `src/` sit. The project is staged to `<workspace>/validation`, and this
 * harness resolves the build's modules by the same relative paths the build
 * itself uses, so the workspace is one level up from the project root.
 */
const WORKSPACE = join(PROJECT_ROOT, "..");

/**
 * The workspace, served to the engine's loader for the life of this module.
 *
 * The engine's asset loader resolves every path under a fixed root and fetches
 * it, then decodes the body with `createImageBitmap` (engine docs, assets.md).
 * A Node process has neither, so a build that loads its art inside the level's
 * `load` would see every frame fail and fall back to shapes in code — and the
 * presentation checks about the seeded art would grade a build that draws its
 * sprites perfectly as one that draws none.
 *
 * ONE ROOT, AND THE ROOT ORDER IS STATED RATHER THAN DEFAULTED. specs/assets.md
 * seeds the art under `assets/` in the workspace itself, so a page-relative URL
 * is looked for there and nowhere else. The package's default would also look
 * under `public/` and `dist/`, which for this case are either absent or hold a
 * STAGED copy of the same tree — and a root order that answered from the second
 * copy would grade a build on a file it did not just produce.
 *
 * Installed once, at module load, rather than around each `createHarness`: the
 * art is loaded while the engine initializes, and a build may reload it at any
 * later moment. Nothing else in this process fetches, and each test file gets
 * its own module registry, so what is stood up here is contained to the suite
 * that imported it, and nothing takes it back down.
 */
function serveSeededAssets(): void {
  installAssetHost({
    workspaceRoot: WORKSPACE,
    roots: ["."],
    // A path that names no file answers 404, exactly as a missing file does in
    // a browser, and the engine reports it on `asset:failed` — which the
    // harness collects into `Harness.assetFailures`.
    onMissing: "404",
    // The engine's loader decodes a fetched body through `createImageBitmap`,
    // which a bare Node process has none of.
    images: true,
    // The TYPE NAME is deliberately left alone. Defining
    // `globalThis.ImageBitmap` would change what the engine's own recorder
    // captures into a replay — this project has never defined it, and a replay
    // is evidence rather than a verdict, so nothing is gained by moving it here.
    nameImageBitmap: false,
    label: "floe",
  });
}

serveSeededAssets();

/** Each seeded folder under `assets/`, and how many frames it holds. */
export const SPRITE_FOLDERS = {
  crosser: CROSSER_FRAMES,
  bear: BEAR_FRAMES,
  plow: PLOW_FRAMES,
  dogsled: DOGSLED_FRAMES,
  car: CAR_FRAMES,
  pan: PAN_FRAMES,
  raft: RAFT_FRAMES,
} as const;

/** One of the seven seeded folders. */
export type SpriteFolder = keyof typeof SPRITE_FOLDERS;

/** One seeded frame, decoded, with its premultiplied channels ready to compare. */
export interface SeededFrame {
  folder: SpriteFolder;
  index: number;
  width: number;
  height: number;
  /** Premultiplied RGBA, as {@link channelsOf} reads them. */
  pixels: Float64Array;
}

let seeded: Promise<SeededFrame[]> | null = null;

/**
 * Every seeded frame of every folder, read off the workspace's own `assets/`.
 *
 * Decoded once per test file and held, because a presentation check compares a
 * drawn source against all thirty-two of them and there is no reason to decode
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
        frames.push({
          folder,
          index,
          width: image.width,
          height: image.height,
          pixels: channelsOf(image),
        });
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
 * infinitely far apart, because one cannot be the other. Floe's folders are of
 * four different sizes, so this is doing real work rather than standing by.
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
  let best: FrameMatch = { folder: "crosser", index: 0, distance: Infinity };
  for (const frame of await seededFrames()) {
    const distance = frameDistance(pixels, frame.pixels);
    if (distance < best.distance) {
      best = { folder: frame.folder, index: frame.index, distance };
    }
  }
  return best;
}

/* -------------------------------------------------------------------------- */
/* What a frame drew                                                          */
/* -------------------------------------------------------------------------- */

/** One `drawImage` a frame made, with the transform in force at the call. */
export interface ImageCall {
  /** The call's own arguments, the bitmap source first. */
  args: readonly unknown[];
  /** The transform the context held when the call was made. */
  transform: Matrix;
}

/**
 * Every `drawImage` in `calls`, each with the transform in force at it.
 *
 * A build draws a vehicle in a leftward lane by flipping the horizontal axis
 * about the sprite's centre (specs/assets.md), which states that call's
 * destination rectangle in a flipped space — so the arguments alone say nothing
 * about where the sprite landed. The transform is what maps it back, and it is
 * recovered by REPLAYING the frame's own operations: `save`/`restore` stack it,
 * the pipeline issues the world-to-device fit as a `setTransform` the recorder
 * sees, and the build's own `translate`/`scale` are in the same list. So the
 * state in force at a call is recovered exactly from the record, and nothing
 * here has to ask the context a question after the fact.
 *
 * {@link drawnImages} and `presentation/sprites.ts` both walk this, so the two
 * cannot disagree about where a sprite landed.
 */
export function imageCalls(calls: readonly DrawCall[]): ImageCall[] {
  const found: ImageCall[] = [];
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
    if (method === "drawImage") found.push({ args, transform: current });
  }
  return found;
}

/* -------------------------------------------------------------------------- */
/* The harness                                                                */
/* -------------------------------------------------------------------------- */

/** The window a harness reports to the engine, and the clock it steps on. */
export type HarnessOptions = EngineHarnessOptions;

export type { UntilOptions, UntilResult };

/** How far a coarse sweep may run, and how much game time separates two samples. */
export interface SkipOptions {
  maxSeconds?: number;
  pollSeconds?: number;
}

/** What a coarse sweep found. */
export interface SkipResult {
  hit: boolean;
  /** Seconds of game time covered before the sample that ended the sweep. */
  elapsed: number;
  snapshot: FloeSnapshot;
}

/**
 * What this case adds to the package's harness: the engine's own object model,
 * the coarse sweeps a cadence measured in tens of seconds is waited out with,
 * and the pointer path this game's menus are driven through.
 */
export interface FloeModel {
  /**
   * The world currently open, read fresh on every access. Floe runs in one
   * world for the whole session — every screen is a value of the state's
   * `screen` field — but reading it through the engine keeps a check honest
   * against a build that rebuilt it anyway.
   */
  readonly world: World;
  /**
   * The open world's game state — the live `FloeState` specs/state.md
   * declares — read fresh on every access. Its arrangement is the build's; what
   * a check asserts is read through `snapshot`.
   */
  readonly state: GameState;
  /** The game instance, the one framework object that outlives every level. */
  readonly instance: GameInstance<FloeSurface>;

  /** Run the whole ticks covering `duration` seconds of game time. */
  advanceSeconds(duration: number): Promise<void>;
  /**
   * Run `ticks` whole simulation ticks in COARSE frames.
   *
   * The tick-exact companion to {@link skip}, for a wait a check states in
   * TICKS: the coarse stretch runs whole {@link COARSE_TICKS} frames and the
   * leftover runs at one tick a frame, so exactly `ticks` ticks are spent.
   * {@link skip} is this over a duration in seconds, rounded the way
   * {@link ticksFor} rounds.
   */
  skipTicks(ticks: number): Promise<void>;
  /**
   * Cover `duration` seconds of game time in COARSE frames, for waiting out a
   * cadence the specification measures in tens of seconds.
   *
   * The same ticks run — the simulation advances by the whole ticks a frame's
   * elapsed time completes, which is what specs/overview.md fixes and what
   * `instrumentation/deterministic-core` decides — and only the pictures
   * between them are skipped. It leaves the clock at one tick a frame, so what
   * follows steps tick by tick again.
   *
   * Not for a measurement stated per frame or per picture: use
   * {@link advanceSeconds} where each frame has to be a tick.
   */
  skip(duration: number): Promise<void>;
  /** {@link skip} until `predicate` holds, sampling every `pollSeconds`. */
  skipUntil(
    predicate: (snapshot: FloeSnapshot) => boolean,
    options?: SkipOptions,
  ): Promise<SkipResult>;
  /** Put `ticksPerFrame` whole ticks in each frame from here on. */
  pace(ticksPerFrame: number): void;
  /** Drive the engine's own frame loop for `ms` of real time, then halt it. */
  runFor(ms: number): Promise<void>;

  /**
   * Where a logical point lands in CSS pixels: the device point the fit puts it
   * at, divided back by the device pixel ratio.
   *
   * What a pointer or touch gesture is aimed with, because the engine reads a
   * device event's position in CSS pixels from the surface's own origin.
   */
  css(x: number, y: number): Point;
  /**
   * Dispatch one pointer-shaped event at the surface, at a LOGICAL stage point.
   *
   * The engine owns the pointer and listens on the same target its key listeners
   * go on (engine/input.md), so an event dispatched here drives the game exactly
   * as a player's mouse or finger does.
   */
  point(
    type: PointerEventType,
    x: number,
    y: number,
    device?: "mouse" | "touch",
  ): void;
}

/** Everything a check reads off one engine running one build. */
export type Harness = EngineHarness<FloeSnapshot, FloeDriver, FloeEngine> &
  FloeModel;

/**
 * What the build owes when its surface is missing: the `Expected:` line of the
 * failure every check that reaches for the surface lands on, beside what
 * `engine.debug` was found holding instead.
 *
 * The case's own sentence rather than the package's, because where the surface
 * comes from is this engine's business — from the game instance's `initialize` —
 * and a fault that misdescribed the return would send a reviewer to the wrong
 * line of the build.
 */
const SURFACE_REQUIREMENT =
  "the debug surface src/game.ts's instance returns from initialize, which " +
  "the engine hands back from engine.debug (specs/instrumentation.md)";

/**
 * A `PointerEvent`-shaped event: the engine reads `clientX`, `clientY`,
 * `pointerId`, `pointerType`, `isPrimary`, `button` and `buttons` off one
 * (engine/input.md), and maps the client position into the game's own logical
 * coordinates through the inverse of the viewport it drew with.
 *
 * FLOE'S OWN SHAPE, AND NOT THE PACKAGE'S `DevicePointerEvent`, which is the same
 * event but for one field: it reports `button` `-1` on a MOVE, where this reports
 * `0` on every event of a gesture. This engine's pointer input reads `button` and
 * takes a different path for a move that names no button, so the two are not
 * interchangeable and this case's verdicts were taken under this one. See the
 * package README's collision table.
 */
class PointerDriveEvent extends Event {
  readonly clientX: number;
  readonly clientY: number;
  readonly pointerId = 1;
  readonly pointerType: string;
  readonly isPrimary = true;
  readonly button = 0;
  readonly buttons: number;

  constructor(
    type: PointerEventType,
    x: number,
    y: number,
    pointerType: "mouse" | "touch",
  ) {
    super(type);
    this.clientX = x;
    this.clientY = y;
    this.pointerType = pointerType;
    this.buttons = type === "pointerup" ? 0 : 1;
  }
}

/**
 * The package's engine machinery, bound to Floe on this engine.
 *
 * Where the four engines differ, each is answered here from what THIS engine is:
 *
 *  - `driver` is the identity: this engine's surface is already what a check
 *    calls, so the object the build returned is handed over untouched.
 *  - `toLogical` goes through the world's camera. The camera opens at the
 *    defaults — world and stage coordinates coincide, which is the space every
 *    figure in `constants.ts` is stated in — so the projection is the identity
 *    unless the build moved it, and mapping through it keeps a reading honest
 *    either way.
 *  - `pointerPrecision` is `"device-pixel"`: a gesture lands on the pixel a
 *    reading would sample first, which is what this case's menu points were
 *    decided under.
 *  - `pointerEvent` is {@link PointerDriveEvent}, this case's own shape.
 */
const kit = createEngineCaseHarness<
  FloeSnapshot,
  FloeDriver,
  FloeEngine,
  FloeModel
>({
  slug: "floe",
  projectRoot: PROJECT_ROOT,
  stage: { width: STAGE_W, height: STAGE_H },
  tickHz: TICK_HZ,
  surfaceRequirement: SURFACE_REQUIREMENT,
  // The text readings below place a run about its anchor, so each text call is
  // measured and the transform in force at it is recorded off the real context.
  recorder: { measureText: true },
  defaultClock: () => new ConstantClock(TICK_MS),
  createEngine: ({ canvas, clock, surface }) =>
    createEngine<FloeSurface>({
      canvas,
      width: STAGE_W,
      height: STAGE_H,
      game,
      // The build's own stage background, handed to the engine exactly as the
      // seeded `src/main.ts` hands it (specs/overview.md).
      background: BACKGROUND,
      layout: LAYOUT,
      clock,
      surface: surface as SurfaceMetrics,
    }),
  driver: (_engine, raw) => identityDriver(raw as FloeSurface),
  snapshot: (debug) => debug.snapshot(),
  toLogical: (engine, x, y) => engine.world.camera.worldToLogical({ x, y }),
  pointerPrecision: "device-pixel",
  pointerEvent: (type, x, y, device) =>
    new PointerDriveEvent(type, x, y, (device ?? "mouse") as "mouse" | "touch"),
  extend: (base, engine, initialized) => {
    const pace = (ticksPerFrame: number): void => {
      engine.setClock(new ConstantClock(TICK_MS * ticksPerFrame));
    };

    const skipTicks = async (ticks: number): Promise<void> => {
      const total = Math.max(0, Math.trunc(ticks));
      const coarse = Math.floor(total / COARSE_TICKS);
      if (coarse > 0) {
        pace(COARSE_TICKS);
        try {
          await base.advance(coarse);
        } finally {
          // In a `finally`, and outside the branch, so this always returns the
          // clock to one tick a frame — whatever the count was, and whether or
          // not the coarse stretch ran to the end.
          pace(1);
        }
      } else {
        pace(1);
      }
      await base.advance(total - coarse * COARSE_TICKS);
    };

    const skip = (duration: number): Promise<void> =>
      skipTicks(ticksFor(duration));

    return {
      get world() {
        return engine.world;
      },
      get state() {
        return engine.world.state;
      },
      instance: initialized as GameInstance<FloeSurface>,

      advanceSeconds: (duration: number) => base.advance(ticksFor(duration)),
      skipTicks,
      skip,
      pace,

      async skipUntil(
        predicate: (snapshot: FloeSnapshot) => boolean,
        options: SkipOptions = {},
      ) {
        const maxSeconds = options.maxSeconds ?? DEFAULT_SWEEP_SECONDS;
        const pollSeconds = Math.max(
          seconds(COARSE_TICKS),
          options.pollSeconds ?? DEFAULT_SKIP_POLL_SECONDS,
        );

        // The state as it stands is read first, so a sweep whose condition
        // already holds reports it without spending any game time.
        let snapshot = base.snapshot();
        if (predicate(snapshot)) return { hit: true, elapsed: 0, snapshot };

        let elapsed = 0;
        while (elapsed < maxSeconds) {
          const step = Math.min(pollSeconds, maxSeconds - elapsed);
          await skip(step);
          elapsed += step;
          snapshot = base.snapshot();
          if (predicate(snapshot)) return { hit: true, elapsed, snapshot };
        }
        return { hit: false, elapsed, snapshot };
      },

      async runFor(ms: number) {
        const controller = new AbortController();
        const running = engine.run({ signal: controller.signal });
        await new Promise((resolve) => setTimeout(resolve, ms));
        controller.abort();
        await running;
      },

      css: (x: number, y: number) => {
        const at = base.device(x, y);
        return { x: at.x / base.shape.dpr, y: at.y / base.shape.dpr };
      },
      point: (
        type: PointerEventType,
        x: number,
        y: number,
        device: "mouse" | "touch" = "mouse",
      ) => {
        base.pointer(type, x, y, device);
      },
    };
  },
});

/**
 * Build an engine over a canvas of the harness's own, initialize the build's
 * game, and hand back everything a check reads.
 *
 * The options the kit passes the factory above are the ones the seeded
 * `src/main.ts` passes — the design size, the build's exported `BACKGROUND`, and
 * the four-way layout — so one harness serves every build of this case.
 * Everything else the build decided lives inside `src/game.ts`.
 */
export const createHarness = kit.createHarness;

/* -------------------------------------------------------------------------- */
/* Evidence capture                                                           */
/* -------------------------------------------------------------------------- */
//
// A review item may declare a `replay` OUTPUT beside its verdict: the frames the
// build itself drew while a check drove it, kept as evidence a reviewer can
// scrub and compare against the reference implementation's. Both writers are the
// package's, bound here to this case's slug and to THIS directory, because the
// project root may never be derived inside the package.
//
// Four properties are what make them usable, and each is deliberate:
//
// 1. THEY RECORD THE SECTION, NOT THE RUN. The recorder is armed around the
//    caller's scenario and disarmed the moment that scenario returns, so what is
//    kept is the part the check is ABOUT and never the setup that got there.
//    ARM IT NARROWLY IN THIS CASE. Floe draws a moving strait: sixteen lanes of
//    items slide every frame, and the critter's and the bears' sprites swap
//    frame by frame, so a recording that spans a whole scenario as well as the
//    moment the check is about grows fast against the recorder's own capture
//    budget, past which a new image records as an opaque marker. A check about
//    a catch arms around the frames the bear is closing over, not around the
//    minute of quiet crossing that set it up.
// 2. THEY ARE EVIDENCE, NEVER A VERDICT. The scenario's own value comes straight
//    back, so a check reads it exactly as it did before capture existed, and a
//    scenario that THROWS still writes what it had recorded before the failure
//    travels on — a failing check is the one whose replay a reviewer most wants.
// 3. THEY WRITE ONLY WHAT THERE IS TO LOOK AT. A capture that closed no frames
//    leaves no file, so the run reports the output absent instead of offering the
//    reviewer a replay of nothing.
// 4. THEY COST NOTHING WHEN NOBODY IS COLLECTING. Outside a run — a developer
//    running this suite from a shell — the media directory is unset, and the
//    whole thing is a no-op that still runs the scenario.

/**
 * Record the frames `scenario` draws and keep them as the review item's
 * `outputId` output, handing back whatever the scenario returned.
 *
 * Wrap the drive, not the arrangement:
 *
 * ```ts
 * await captureReplay(h, "carried", async () => {
 *   h.debug.setLaneSpeed(5, 3.6);
 *   await h.advanceSeconds(1);
 * });
 * ```
 *
 * The assertions stay exactly where they were and read exactly what they did.
 */
export const captureReplay = makeReplayCapture("floe", PROJECT_ROOT);

/**
 * Keep the frame currently on the canvas as the review item's `outputId` output.
 *
 * The companion to {@link captureReplay}, for a point whose evidence is one
 * PICTURE rather than a stretch of motion: the posed strait, the five bays with
 * one filled, the title screen. A recording of a still screen would be the same
 * frame three hundred times over, and a reviewer looking at a layout wants to
 * look at the layout.
 *
 * What is written is whatever the last frame that RAN left behind, so call it
 * after the frame that poses the thing under test — an `advance(1)` following the
 * arrangement — and before the assertions, so a check that fails still leaves the
 * picture that shows why.
 */
export const captureStill = kit.captureStill;

/* -------------------------------------------------------------------------- */
/* Scenario helpers                                                           */
/* -------------------------------------------------------------------------- */
//
// Each of these poses a situation through the debug surface — or the real
// registered actions — and then lets the build's own rules run. They fix only
// arrangement: which tile a bear is posed on, which columns a lane's items sit
// at, which key is held. Every threshold a check asserts is stated in the check
// itself, derived from the figure or rule specs/ states for it.
//
// A check calls the ones it needs and no more. Nothing here is a prerequisite of
// anything else here: a check about the title menu poses no strait, and a check
// about a lane poses no bear.

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
 * the title's highlighted first item, `CROSS`, which is what starts a run and
 * opens `playing` (specs/ui.md) — and a run opens at level 1 with three lives,
 * a score of `0`, five open bays and a fresh crossing (specs/progression.md).
 * No pose on the surface starts a run, and there is not meant to be one: the
 * strait is laid out by the path the menu takes, and that path is what a check
 * about a freshly started run is about.
 *
 * One frame runs, the frame that delivers the key's edge. Everything the run
 * opens with — the sixteen lanes at their level-1 phases, the four world gates
 * on, the timer at `crossingTimer(1)` — is the build's, not the harness's.
 */
export async function startRun(h: Harness, seed?: number): Promise<void> {
  resetTo(h, seed);
  await tapAction(h, "confirm");
}

/**
 * A live crossing on an EMPTY, QUIET strait at `level`, with the critter on the
 * near shore where a fresh crossing puts it.
 *
 * This is the ground almost every mechanical check stands on, and it is a
 * harness sequence rather than a debug operation because the surface is atomic:
 * every line below is one of its operations.
 *
 * THE ORDER IS LOAD-BEARING. `setLevel` RE-LAYS the sixteen lanes by design
 * (specs/instrumentation.md): every vehicle and every floe is replaced by the
 * roster level `n` gives. So the level is set BEFORE the clears, and the clears
 * are what leave the strait empty. A check that calls `setLevel` again after
 * posing puts sixteen lanes of traffic straight back, and clears the two
 * rosters again itself unless the level's own layout is exactly what it reads.
 *
 * EMPTY is safe. A level clears on the hop that fills the last open bay
 * (specs/progression.md), so a strait whose bays were POSED rather than hopped
 * into never clears, and a posed rule runs without the level advancing
 * underneath it.
 *
 * QUIET is the four world gates. With `bearEmergence`, `catchTest`,
 * `fishCadence` and `timerRunning` all off, nothing the scenario did not ask
 * for arrives, catches, appears or expires: no bear emerges behind a critter
 * that has climbed three rows, no incidental touch costs a life, no bonus catch
 * turns up in the bay a scoring check is aiming at, and a scenario that runs
 * thirty seconds of game time does not lose the crossing to the timer.
 *
 * A check whose REQUIREMENT is one of those four turns that one back on itself,
 * and only that one. A check that finds itself needing a gate for any other
 * reason has been mis-posed.
 *
 * The generator is reseeded by the `reset` this opens with, to `seed` where the
 * caller named one and to `DEFAULT_SEED` otherwise. No frame is advanced: every
 * pose here lands at the call.
 */
export function startCrossing(h: Harness, level = 1, seed?: number): void {
  resetTo(h, seed);
  h.debug.setLevel(level);

  h.debug.clearVehicles();
  h.debug.clearFloes();
  h.debug.clearBears();
  h.debug.clearBays();
  h.debug.clearFish();

  h.debug.setBearEmergence(false);
  h.debug.setCatchTest(false);
  h.debug.setFishCadence(false);
  h.debug.setTimerRunning(false);

  h.debug.setScreen("playing");
  h.debug.setPhase("crossing");
  h.debug.setPhaseTimer(0);
  h.debug.setLives(START_LIVES);
  h.debug.setScore(0);
  h.debug.setTimer(crossingTimer(level));
  h.debug.addCritter(START_COL, ROW_NEAR);
}

/**
 * A lane HELD STILL, carrying one item of `kind` on each of `cols`, and their
 * ids in the order given.
 *
 * The lane's speed is set to `0` first, so the items stay exactly on the columns
 * the caller named while it poses the rest of the scenario: a lane the build was
 * still drifting would have carried them off the tiles the check is about before
 * the first frame ran. A check that wants the lane MOVING states the speed it
 * wants — `h.debug.setLaneSpeed(row, 2)` — after this returns, which is where the
 * figure belongs, because the figure is the check's.
 *
 * The roster is chosen from the row's own band (specs/strait.md): an ice-band
 * row takes vehicles and a water-band row takes floes. A row that carries no
 * lane — the cap, the bay row, the median, the near shore — is a mis-posed
 * scenario, and fails here naming the row.
 *
 * Each item is placed with its LEFT EDGE on the column's left edge,
 * `tileLeft(col)`, which is the space the surface takes for a lane item, so an
 * item of length `len` covers `col .. col + len - 1`.
 */
export function poseLane(
  h: Harness,
  row: number,
  kind: ItemKind,
  cols: readonly number[],
): number[] {
  const band = bandOf(row);
  if (band !== "ice" && band !== "water") {
    fail(
      `a row carrying a lane: the ice band ${ICE_TOP}..${ICE_BOTTOM} or the ` +
        `water band ${WATER_TOP}..${WATER_BOTTOM} (specs/strait.md)`,
      `row ${row}, the ${band === "off" ? "strait's edge" : band}`,
    );
  }
  h.debug.setLaneSpeed(row, 0);
  return cols.map((col) =>
    band === "ice"
      ? poseVehicle(h, row, kind as VehicleKind, col)
      : poseFloe(h, row, kind as FloeKind, col),
  );
}

/**
 * One vehicle of `kind` with its LEFT EDGE on column `col` of ice-band `row`,
 * and its id.
 *
 * The id comes off the snapshot's last vehicle, which is where an added one
 * lands (specs/instrumentation.md, Identity). A build whose `addVehicle` added
 * nothing fails here, naming the operation.
 */
export function poseVehicle(
  h: Harness,
  row: number,
  kind: VehicleKind,
  col: number,
): number {
  h.debug.addVehicle(row, kind, tileLeft(col));
  const { vehicles } = h.snapshot();
  if (vehicles.length === 0) {
    fail(
      `addVehicle(${row}, ${JSON.stringify(kind)}, ${tileLeft(col)}) to ` +
        `append a vehicle to the roster (specs/instrumentation.md)`,
      "the vehicle roster is empty",
    );
  }
  return vehicles[vehicles.length - 1].id;
}

/**
 * One floe of `kind` with its LEFT EDGE on column `col` of water-band `row`,
 * and its id. The water band's twin of {@link poseVehicle}.
 */
export function poseFloe(
  h: Harness,
  row: number,
  kind: FloeKind,
  col: number,
): number {
  h.debug.addFloe(row, kind, tileLeft(col));
  const { floes } = h.snapshot();
  if (floes.length === 0) {
    fail(
      `addFloe(${row}, ${JSON.stringify(kind)}, ${tileLeft(col)}) to append ` +
        `a floe to the roster (specs/instrumentation.md)`,
      "the floe roster is empty",
    );
  }
  return floes[floes.length - 1].id;
}

/** The three faculties a bear has, each gated on its own. */
export interface BearFaculties {
  /** Its reading of the critter's tile. */
  sense?: boolean;
  /** Its choice of the next step on settling. */
  routing?: boolean;
  /** Its locomotion. */
  travel?: boolean;
}

/**
 * A bear settled on tile `(col, row)`, and its id.
 *
 * It arrives with all three faculties ON, which is what `addBear` gives it
 * (specs/instrumentation.md). A scenario turns OFF whichever of them its
 * requirement does not exercise, and only those: a check about routing holds
 * `travel` off so the bear reports the step it chose without carrying it out, a
 * check about the glide holds `routing` off so it finishes the step it was
 * given, and a check about the target holds `sense` off so it keeps hunting the
 * tile it was posed with. Only a faculty named in `faculties` is set at all, so
 * nothing a check did not ask for is touched.
 *
 * The per-bear faculties are not the four WORLD gates {@link startCrossing}
 * closes: those belong to the run rather than to any one bear.
 *
 * The id comes off the snapshot's last bear, which is where an added one lands.
 */
export function poseBear(
  h: Harness,
  col: number,
  row: number,
  faculties: BearFaculties = {},
): number {
  h.debug.addBear(col, row);
  const { bears } = h.snapshot();
  if (bears.length === 0) {
    fail(
      `addBear(${col}, ${row}) to append a bear to the roster ` +
        `(specs/instrumentation.md)`,
      "the bear roster is empty",
    );
  }
  const id = bears[bears.length - 1].id;
  if (faculties.sense !== undefined) h.debug.setBearSense(id, faculties.sense);
  if (faculties.routing !== undefined) {
    h.debug.setBearRouting(id, faculties.routing);
  }
  if (faculties.travel !== undefined) {
    h.debug.setBearTravel(id, faculties.travel);
  }
  return id;
}

/* ---- Driving the real input path ------------------------------------------ */

/** An action the game registers, as `constants.ts` names them. */
export type Action = keyof typeof BINDINGS;

/**
 * The action's first bound key, from the case-fixed `BINDINGS` table, pressed
 * and released between frames — the REAL registered-action path, which is the
 * only way the menus move (specs/ui.md).
 *
 * This delivers an EDGE. It moves a menu, confirms, pauses, goes back and
 * mutes; it does NOT hop the critter, because the playing screen reads the four
 * movement actions as HELD (specs/controls.md). Use {@link hop} for a hop.
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
 * The key is down for the whole of the run, so a check that measures a cadence
 * measures exactly `frames` frames of it. The release is in a `finally`, so a
 * scenario that failed mid-hold does not leave the key down for the next one.
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
 * ONE hop request: hold the direction for exactly one frame and let it up.
 *
 * The playing screen reads a movement action as HELD, so a hop is a frame with
 * the key down rather than an edge between frames (specs/controls.md). One frame
 * can carry at most one hop, because an accepted hop sets the cooldown to
 * `HOP_COOLDOWN` (`0.12` s), which is many frames long.
 *
 * The answer is whether the critter's TILE changed, which is what tells an
 * accepted hop from one the rules refused — and from one the cooldown swallowed.
 * The check states which of those it required and why.
 *
 * The release is in a `finally`, so a frame that threw does not leave the key
 * down for the next scenario.
 */
export async function hop(h: Harness, direction: Facing): Promise<boolean> {
  const before = critterTile(h.snapshot());
  holdAction(h, direction);
  try {
    await h.advance(1);
  } finally {
    releaseAction(h, direction);
  }
  const after = critterTile(h.snapshot());
  return after.col !== before.col || after.row !== before.row;
}

/**
 * Wait out the hop cooldown, so the next {@link hop} is offered a critter that
 * may hop again.
 *
 * One frame more than `HOP_COOLDOWN` covers, because the cooldown is reached
 * rather than passed: the critter hops when it has counted down TO zero.
 */
export function restHop(h: Harness): Promise<void> {
  return h.advance(ticksFor(HOP_COOLDOWN) + 1);
}

/**
 * Cross to tile `(col, row)` by REAL HOPS, and the tiles the critter stood on
 * along the way, the starting tile first.
 *
 * For the handful of items that must reach a tile the way a player reaches it.
 * Everything else poses the critter where it wants it, with `addCritter` or
 * `setCritterTile`, and does not pay for the hops.
 *
 * The route is rows first and then columns, each hop separated by the cooldown,
 * so the critter climbs and then slides along. It is not a pathfinder: a hop the
 * rules refuse — a vehicle over the target, a solid stretch of the bay row —
 * fails here naming the tile the critter stopped on, because a check that meant
 * to arrive somewhere and did not has not tested what it set out to test.
 */
export async function crossTo(
  h: Harness,
  col: number,
  row: number,
): Promise<Tile[]> {
  const visited: Tile[] = [critterTile(h.snapshot())];
  const step = async (direction: Facing): Promise<void> => {
    await restHop(h);
    const moved = await hop(h, direction);
    const at = critterTile(h.snapshot());
    if (!moved) {
      fail(
        `a hop ${direction} from (${at.col}, ${at.row}) on the way to ` +
          `(${col}, ${row}) to be accepted (specs/hopping.md)`,
        `the critter stayed on (${at.col}, ${at.row})`,
      );
    }
    visited.push(at);
  };

  let at = critterTile(h.snapshot());
  while (at.row !== row) {
    await step(at.row > row ? "up" : "down");
    at = critterTile(h.snapshot());
  }
  while (at.col !== col) {
    await step(at.col > col ? "left" : "right");
    at = critterTile(h.snapshot());
  }
  return visited;
}

/* -------------------------------------------------------------------------- */
/* Reading the snapshot                                                       */
/* -------------------------------------------------------------------------- */
//
// Plain functions over the object `snapshot()` returned, so a check reads what
// it is about without walking a roster by hand. None of them asserts anything:
// a reading that is not there comes back `undefined` or `null`, and what that
// means is the check's to state.

/** The tile the critter is on, as the snapshot derives it from its center. */
export function critterTile(snapshot: FloeSnapshot): Tile {
  return { col: snapshot.critter.col, row: snapshot.critter.row };
}

/** The bear with that id, or `undefined` where no bear carries it. */
export function bearById(
  snapshot: FloeSnapshot,
  id: number,
): BearSnapshot | undefined {
  return snapshot.bears.find((bear) => bear.id === id);
}

/** The vehicle with that id, or `undefined` where no vehicle carries it. */
export function vehicleById(
  snapshot: FloeSnapshot,
  id: number,
): VehicleSnapshot | undefined {
  return snapshot.vehicles.find((item) => item.id === id);
}

/** The floe with that id, or `undefined` where no floe carries it. */
export function floeById(
  snapshot: FloeSnapshot,
  id: number,
): FloeItemSnapshot | undefined {
  return snapshot.floes.find((item) => item.id === id);
}

/** The tile a bear last settled on. */
export function bearTile(bear: BearSnapshot): Tile {
  return { col: bear.col, row: bear.row };
}

/** The tile a bear is travelling into, equal to {@link bearTile} when settled. */
export function bearStepTile(bear: BearSnapshot): Tile {
  return { col: bear.stepCol, row: bear.stepRow };
}

/** Whether a bear is settled: the tile it is entering is the one it is on. */
export function bearSettled(bear: BearSnapshot): boolean {
  return bear.stepCol === bear.col && bear.stepRow === bear.row;
}

/**
 * The lane at strait `row`, from whichever band carries it, or `undefined` for
 * a row that carries no lane.
 */
export function laneAt(
  snapshot: FloeSnapshot,
  row: number,
): LaneSnapshot | undefined {
  return [...snapshot.iceLanes, ...snapshot.waterLanes].find(
    (lane) => lane.row === row,
  );
}

/** Every vehicle on ice-band `row`, in roster order. */
export function vehiclesOn(
  snapshot: FloeSnapshot,
  row: number,
): VehicleSnapshot[] {
  return snapshot.vehicles.filter((item) => item.row === row);
}

/** Every floe on water-band `row`, in roster order. */
export function floesOn(
  snapshot: FloeSnapshot,
  row: number,
): FloeItemSnapshot[] {
  return snapshot.floes.filter((item) => item.row === row);
}

/**
 * The vehicle covering stage point `x` on `row`, by the covering rule, or
 * `undefined` where the ice there is clear.
 */
export function vehicleCovering(
  snapshot: FloeSnapshot,
  row: number,
  x: number,
): VehicleSnapshot | undefined {
  return vehiclesOn(snapshot, row).find((item) => itemCoversPoint(item, x));
}

/**
 * The floe covering stage point `x` on `row`, or `undefined` where that point is
 * open water. The critter's footing on a water row follows exactly this reading
 * of its own center (specs/strait.md).
 */
export function floeCovering(
  snapshot: FloeSnapshot,
  row: number,
  x: number,
): FloeItemSnapshot | undefined {
  return floesOn(snapshot, row).find((item) => itemCoversPoint(item, x));
}

/** The indices of the bays reported filled, left to right. */
export function filledBays(snapshot: FloeSnapshot): number[] {
  return snapshot.bays.flatMap((filled, index) => (filled ? [index] : []));
}

/* -------------------------------------------------------------------------- */
/* The cues                                                                   */
/* -------------------------------------------------------------------------- */

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
export const watchCues = kit.watchCues;

/** Every recorded firing of the cue named `name`, oldest first. */
export const cuesNamed = kit.cuesNamed;

/** Forget every cue recorded so far, so a check reads its own section alone. */
export const clearCues = kit.clearCues;

/* -------------------------------------------------------------------------- */
/* Reading the rendered pixels                                                */
/* -------------------------------------------------------------------------- */

/**
 * The rendered colour at a stage point, averaged over a small cluster.
 *
 * The centre pixel plus four neighbours 4 units out — well inside a `TILE` of
 * `32`, and inside the 32-unit sprite frame a critter or a bear is drawn as — so
 * one stray anti-aliased or outlined pixel cannot swing the reading.
 */
export function sampleColor(h: Harness, x: number, y: number): Rgb {
  return sampleClusterColor(h as EnginePointReader, x, y);
}

/** The rendered colour at the centre of tile `(c, r)`. */
export function sampleTile(h: Harness, c: number, r: number): Rgb {
  const { x, y } = tileCenter(c, r);
  return sampleColor(h, x, y);
}

/* -------------------------------------------------------------------------- */
/* Reading one frame's render                                                 */
/* -------------------------------------------------------------------------- */

/** Every string the frame drew, through `fillText` or `strokeText`. */
export function drawnText(calls: readonly DrawCall[]): string[] {
  return rawDrawnText(calls);
}

/**
 * Whether the frame spelled `text` inside some logical run of text, ignoring
 * case.
 *
 * Substring rather than equality on purpose: the copy a check asserts is the
 * case's own, but how a build presents it is the build's, and a menu entry is
 * commonly drawn with a selection marker or padding around it. Requiring the
 * exact run would fail a screen that shows precisely the right words.
 *
 * And read off the LOGICAL RUNS the frame spells, never off the `fillText`
 * split: this is the package's `drewText` under this case's own name. A build
 * that letter-spaces a heading draws one glyph per call, which is the only
 * portable way to letter-space canvas text, and specs/ui.md fixes the copy a
 * screen shows while leaving its typography to the build. The recorder measures
 * every text call (`recorder: { measureText: true }`), so the shared harness's
 * merge rule (`case-harness/text.ts`) can coalesce side-by-side glyphs on one
 * baseline back into the string they spell. Every raw string is a substring of
 * the run it belongs to, so coalescing can only add a match and never take one
 * away.
 */
export function drewText(calls: readonly DrawCall[], text: string): boolean {
  return spelledText(calls, text);
}

/**
 * The geometry calls a frame made, by name.
 *
 * Enough of a count to compare two frames of the same scene: a frame that drew a
 * splash asked for strictly more of these than the same frame with the water
 * still, whatever shape the build chose to draw it as.
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
 * — and with the camera at its defaults those are stage units. Where a render
 * put its geometry is the direct reading of it: the points along a row are the
 * band ruled across it, and the points around a bay are its mouth. The leading
 * pair of arguments is the position for every method listed, except the curve
 * calls, whose control points come first and whose endpoint is the last pair.
 *
 * READ AS THE CALLS NAMED THEM, and deliberately not through the transform in
 * force — which is what the package's own `drawnPoints` does. Under this engine
 * the transform IS the pipeline's fit, so mapping through it would answer in
 * device pixels where every figure a check states is in stage units.
 *
 * `drawImage` is not in here, because its leading argument is a bitmap rather
 * than a coordinate and a mirrored draw states its rectangle in a flipped
 * space: read those with {@link drawnImages}.
 */
export function drawnPoints(calls: readonly DrawCall[]): Point[] {
  const points: Point[] = [];
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

/** One bitmap a frame blitted, placed in stage units. */
export interface DrawnImage {
  /** The source the build handed the context, for {@link nearestSeededFrame}. */
  source: { width: number; height: number };
  /** The destination rectangle's centre, in stage units. */
  x: number;
  y: number;
  /** The destination rectangle's size, in stage units, always positive. */
  w: number;
  h: number;
  /**
   * Whether the transform at the call flipped the drawing, which is how a
   * vehicle — whose art faces right — is drawn facing the way a leftward lane
   * runs (specs/assets.md). The bear is never mirrored: it carries a frame set
   * per facing.
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
 * Every bitmap the frame blitted, with its destination placed in stage units.
 *
 * A `drawImage` carries its destination in whatever space the context held at
 * the call, and a build draws a vehicle in a leftward lane by flipping the
 * horizontal axis about the sprite's centre (specs/assets.md), which states that
 * rectangle in a flipped space. The transform {@link imageCalls} carries beside
 * the call is what maps it back, so a mirrored sprite and an upright one both
 * report the centre they were drawn on and the mirrored one reports `mirrored`.
 *
 * The three-argument form takes its size from the source's own dimensions, which
 * is what the canvas does with it.
 */
export function drawnImages(h: Harness): DrawnImage[] {
  const view = h.viewport();
  const images: DrawnImage[] = [];
  for (const { args, transform: m } of imageCalls(h.calls)) {
    const source = args[0] as { width?: unknown; height?: unknown } | null;
    if (
      source === null ||
      typeof source !== "object" ||
      typeof source.width !== "number" ||
      typeof source.height !== "number"
    ) {
      continue;
    }

    const numbers = args
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

    // The destination rectangle's centre, through the transform the call was
    // made under and then back through the engine's fit to stage units.
    const localX = dx + dw / 2;
    const localY = dy + dh / 2;
    const deviceX = m[0] * localX + m[2] * localY + m[4];
    const deviceY = m[1] * localX + m[3] * localY + m[5];
    images.push({
      source: source as { width: number; height: number },
      x: (deviceX - view.offsetX) / view.scale,
      y: (deviceY - view.offsetY) / view.scale,
      w: (Math.abs(dw) * Math.hypot(m[0], m[1])) / view.scale,
      h: (Math.abs(dh) * Math.hypot(m[2], m[3])) / view.scale,
      // A negative determinant is a reflection, which is the only way an axis
      // is flipped: a rotation alone leaves it positive.
      mirrored: m[0] * m[3] - m[1] * m[2] < 0,
      transform: m,
    });
  }
  return images;
}

/** One run of text a frame drew, and the stage x range its glyphs span. */
export type TextSpan = TextDraw;

/**
 * Every run of text the frame drew, placed in stage units, ONE PER CALL.
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
 * which this mapping carries back to stage units like any other run.
 */
export function drawnTextSpans(h: Harness): TextSpan[] {
  return allInLogical(h.viewport(), textDraws(h.calls));
}

/* ---- Logical runs of text -------------------------------------------------- */
//
// A build that letter-spaces a heading draws a glyph per `fillText`, which is
// the only portable way to letter-space canvas text, and specs/ui.md fixes the
// COPY a screen shows while leaving its typography to the build. So a check that
// asserts copy reads it off the logical RUN the frame spells, never off the
// `fillText` split that spelled it. The merge is the shared harness's
// (`case-harness/text.ts`): side-by-side draws on one baseline coalesce into the
// string they spell, decided in device pixels where the calls were made, off the
// width and alignment the recorder measured on each text call. Every raw string
// is a substring of the run it belongs to, so coalescing can only add a match.
//
// WHAT STAYS RAW. {@link drawnText} and {@link drawnTextSpans} are untouched:
// the overlay checks diff line SETS off `drawnText` and must not see merged
// text, and a reader that needs each draw's own extent asks a different
// question, since a merged run is wider than any of its members. Every copy
// reader opts in.

/**
 * Every logical run of text the last frame spelled, placed in stage units.
 *
 * The placed companion to the shared harness's `drawnTextLines`: its runs,
 * which it places in device pixels by walking the transform ops the frame
 * recorded — the pipeline's own `setTransform` fit and camera among them, made
 * through this same recorded context every frame — carried back through the
 * engine's fit by the same `allInLogical` {@link drawnTextSpans} uses. A run
 * keeps the placement of its first draw, so a run of one draw comes back exactly
 * as {@link drawnTextSpans} reports it.
 *
 * The frame is whatever `h.calls` currently holds, as with
 * {@link drawnTextSpans}. This is what every copy reader reads:
 * `screens/screens.ts` takes the runs anchored on the strait,
 * `presentation/hud.ts` the runs anchored in the bar, and the items that find a
 * readout by what it says look it up here.
 */
export function drawnTextRuns(h: Harness): TextSpan[] {
  return allInLogical(h.viewport(), sharedTextRuns(h.calls));
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
/* The menus, as a pointer and a finger reach them                            */
/* -------------------------------------------------------------------------- */
//
// specs/ui.md leaves each menu's ARRANGEMENT to the build and requires the build
// to report where it put each item, through `menuItemRect`
// (specs/instrumentation.md). So a check that drives a menu with a pointer asks
// the build where the item is and aims at the middle of the region it named:
// every layout passes, and a build that reports a region it does not answer on is
// the only one that fails.
//
// EACH PART OF A GESTURE RUNS ITS OWN FRAME. A press that ran no frame would
// never reach a build that reads its input once per frame, and a press released
// before a frame ran would be invisible to a build that compares held state
// between frames, so each of the three drives exactly one frame and a check
// counting frames can add them up.

/**
 * The region the build reports for item `index` of the menu on screen.
 *
 * A missing region fails the check that asked for one, with the screen named:
 * specs/instrumentation.md requires a region for every index of the menu the
 * current screen shows, so a `null` here is the build's answer rather than the
 * check's mistake.
 */
export function menuRect(h: Harness, index: number): MenuRect {
  const rect = h.debug.menuItemRect(index);
  if (rect === null) {
    fail(
      `menuItemRect(${index}) to report a region on the ` +
        `${h.snapshot().screen} screen (specs/instrumentation.md)`,
      "null",
    );
  }
  return rect;
}

/**
 * Where each harness's pointer stands, so a release needs no position of its own.
 *
 * A real device lifts where it is; a release that had to be told where it was
 * would let a check lift somewhere the contact never travelled to, which is a
 * gesture no player can make.
 */
const pointerAt = new WeakMap<Harness, Point>();

/** Where the harness's pointer stands, or the stage's top-left before it moved. */
function heldAt(h: Harness): Point {
  return pointerAt.get(h) ?? { x: 0, y: 0 };
}

/** Move the mouse to a logical stage point, and run the frame that reads it. */
export async function mouseGlide(
  h: Harness,
  x: number,
  y: number,
): Promise<void> {
  pointerAt.set(h, { x, y });
  h.point("pointermove", x, y);
  await h.advance(1);
}

/** Press the mouse at a logical stage point, and run the frame that reads it. */
export async function mousePress(
  h: Harness,
  x: number,
  y: number,
): Promise<void> {
  pointerAt.set(h, { x, y });
  h.point("pointerdown", x, y);
  await h.advance(1);
}

/** Release the mouse where it stands, and run the frame that reads it. */
export async function mouseRelease(h: Harness): Promise<void> {
  const at = heldAt(h);
  h.point("pointerup", at.x, at.y);
  await h.advance(1);
}

/** Land a touch contact at a logical stage point, and run the frame that reads it. */
export async function touchPress(
  h: Harness,
  x: number,
  y: number,
): Promise<void> {
  pointerAt.set(h, { x, y });
  h.point("pointerdown", x, y, "touch");
  await h.advance(1);
}

/** Travel the held contact to a logical stage point, and run the frame that reads it. */
export async function touchGlide(
  h: Harness,
  x: number,
  y: number,
): Promise<void> {
  pointerAt.set(h, { x, y });
  h.point("pointermove", x, y, "touch");
  await h.advance(1);
}

/** Lift the contact where it stands, and run the frame that reads it. */
export async function touchRelease(h: Harness): Promise<void> {
  const at = heldAt(h);
  h.point("pointerup", at.x, at.y, "touch");
  await h.advance(1);
}
