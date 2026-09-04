// Spectra — the shared validator harness. CASE-PROVIDED.
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
// cues the engine broadcast, and — for the presentation checks — the pixels on
// the canvas or the calls the 2D context received. Nothing here fabricates an
// outcome: the scenario helpers below only ARRANGE the game through the debug
// surface, and the real rules the build wrote are what decide every move,
// contact, score and stage transition from there.
//
// WHY THE DEBUG SURFACE RATHER THAN RAW ASSIGNMENT. specs/instrumentation.md
// fixes its operations, so they mean the same thing in every build: `addDrone`
// builds a drone the wave's own rules then fly, `addPlayerBullet` places a shot
// the real collision code resolves, `setResonance` fills the meter the discharge
// spends, and `reset` gives everything back. Posing through it is how a scenario
// is reproducible, and it is the seam the case's specification documents.
// `surface.ts` is that specification as types, and it is the only description of
// the surface this harness reads: the build's own module for it is never
// imported.
//
// WHERE THE SURFACE COMES FROM. Off `engine.debug`, never built here. The game
// instance's `initialize` returns it, the engine holds that same object, and
// reading it back off the engine is the only way a surface reaches a check — so
// a build that returned no surface, or a surface missing an operation, fails the
// checks that reach the game through it. See `readDebugSurface`.
//
// HOW THE SURFACE IS DRIVEN. Directly, and immediately: under this engine a pose
// acts on the live game at the moment of the call and a reading is built at the
// call (specs/instrumentation.md), so a scenario poses and then reads with no
// frame in between. A frame is advanced when the check wants the game to RUN — a
// drone to fly its dive, a bullet to cross a body, a discharge wave to expand, a
// render to happen.
//
// THE HARNESS OWNS EVERY COMPOUND SEQUENCE. The surface is atomic by design:
// each operation sets one field, so "a live, quiet, empty wave at stage 1" is a
// helper here rather than an operation there. A check that needs only part of a
// sequence calls the operations it needs, and nothing it did not ask for
// happens. The helpers fix GEOMETRY — which slot a drone is posed on, where a
// bullet starts, which key is held — and never a threshold: every figure a check
// asserts is stated in that check, derived from what specs/ fixes for it. Look
// for a tolerance in this file and you will not find one.
//
// THE CLOCK IS THE HARNESS'S. `ConstantClock(TICK_MS)` at 100 Hz, so one frame
// is one tick and every duration specs/ fixes is a whole number of frames.
// Spectra mandates no timestep of its own — every rate is per second and
// integrated inside the sub-step loop specs/simulation.md fixes, which is why
// `[instrumentation]` carries no `tick_hz` — so the fixed clock is the SUITE's
// choice. A check that is specifically about the step size
// (instrumentation/deterministic-core) builds its own harnesses with clocks of
// its own, passing {@link HarnessOptions.clock}.
//
// SPRITES, HEADLESS. The suite runs in `node`, where `fetch` and
// `createImageBitmap` do not exist, and the game loads its seeded art inside the
// level's `load`. Both globals are stood up over the workspace's own `assets/`
// tree when this module loads, so every build's art — the four PNGs and the
// drone-burst's particle system — arrives exactly as it does in a browser. See
// `serveSeededAssets`.
//
// ONE VALIDATOR DIRECTORY SERVES BOTH VARIANTS. Nothing in this file names an
// `overload` figure or reaches for `setDroneCharge`: the variant's own suites do
// that, against the constants their own workspace seeds. What is here is what
// `base` and `overload` share, which is everything but the charge.

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
  type RecordedFrame,
  type Recording,
  type Resource,
  type SurfaceMetrics,
  type Viewport,
  type World,
} from "@test-cabinet/structured-2d";
import {
  BINDINGS,
  BURST_SYSTEM,
  FIELD_BOTTOM,
  FIELD_LEFT,
  FIELD_RIGHT,
  FIELD_TOP,
  FLUX_SIZE,
  FORM_CENTER_X,
  LAYOUT,
  OVERLAY_KEY,
  PRISM_SIZE,
  SHARD_SIZE,
  SHIP_H,
  SHIP_W,
  SHIP_Y,
  SPRITES,
  SPRITE_SIZE,
  STAGE_H,
  STAGE_W,
  START_LIVES,
  slotX,
  slotY,
} from "./constants";
import { BACKGROUND, game as build } from "../src/game";
import { assertTruthy, fail } from "./assert";
import { clearBeforeCoveringFills } from "./covered-frames";
import type {
  Band,
  BulletSnapshot,
  BurstSnapshot,
  DischargeSnapshot,
  DroneKind,
  DronePhase,
  DroneSnapshot,
  MenuRect,
  Mode,
  Phase,
  Screen,
  ShipSnapshot,
  SpectraDebugApi,
  SpectraSnapshot,
} from "./surface";

export type {
  Band,
  BulletSnapshot,
  BurstSnapshot,
  DischargeSnapshot,
  DroneKind,
  DronePhase,
  DroneSnapshot,
  MenuRect,
  Mode,
  Phase,
  Screen,
  ShipSnapshot,
  SpectraSnapshot,
};

/** The case's surface, exactly as `surface.ts` specifies it. */
export type SpectraSurface = SpectraDebugApi;

/**
 * The surface as every check drives it.
 *
 * Under this engine the raw surface IS imperative — a pose takes only its own
 * arguments and returns nothing, a reading takes nothing and returns plain data
 * — so no wrapper stands between a check and the object the build returned, and
 * the driver type is the surface type itself. The alias is kept so a check reads
 * the same way it does under an engine whose surface needs driving.
 */
export type SpectraDriver = SpectraSurface;

/**
 * The build's game, typed against the surface the CASE specifies.
 *
 * The build declares its own type for the surface its instance's `initialize`
 * returns — the `D` of its `GameDefinition<D>` — and that type is the build's:
 * what a check holds it to is `surface.ts`, so the definition is cast to the
 * case's `GameDefinition<SpectraSurface>` here and the engine is parameterized
 * with it. A surface that departs from the specification is caught where a check
 * reaches for the missing member, not by the build's own compiler.
 */
const game = build as unknown as GameDefinition<SpectraSurface>;

/* -------------------------------------------------------------------------- */
/* The clock                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The frame the suite steps in, in milliseconds.
 *
 * This is the SUITE's choice, not the game's: the specification deliberately
 * fixes no timestep, because the engine hands the game whatever elapsed time a
 * frame really took and the game divides it into sub-steps of at most
 * `SUBSTEP_MAX`. 100 Hz is chosen because every duration specs/ fixes is then a
 * whole number of frames — `FIRE_INTERVAL` 0.16 s is 16, `FLIP_LOCKOUT` 0.3 s is
 * 30, `FLUX_SHIMMER` 0.4 s is 40, `DISCHARGE_TIME` 0.5 s is 50, `ENTER_GROUP_GAP`
 * 0.6 s is 60, `BURST_DURATION` 0.7 s is 70, `READY_HOLD` 1.3 s is 130,
 * `DIVE_GAP_MIN` 1.4 s is 140, `FLUX_HOLD_L1` 1.6 s is 160, `DIVE_FIRST_DELAY`
 * and `STAGE_INTRO_HOLD` 2 s are 200, `DIVE_GAP_MAX` and `STAGE_CLEARED_HOLD`
 * 2.6 s are 260, `INVERSION_TIME` 5 s is 500, and every stage-scaled figure
 * steps by 0.05 s, which is 5. So a check asks for a duration and gets it
 * exactly, with no rounding of its own to explain.
 *
 * It also sits ABOVE `SUBSTEP_MAX` (1/120 s), so each frame really divides into
 * two sub-steps: the loop specs/simulation.md fixes is exercised rather than
 * bypassed.
 */
export const TICK_HZ = 100;
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
/* The field, in the space the surface speaks                                 */
/* -------------------------------------------------------------------------- */
//
// Every position the surface takes or reports is a CENTER in the fixed
// 1280x720 logical stage (specs/overview.md), and so is every figure below.

/** The ship's lane: its fixed center `y`, and the center of its travel. */
export const SHIP_LANE_Y = SHIP_Y;
export const LANE_CENTER = FORM_CENTER_X;

/** The center of the formation slot in column `col`, row `row`, before the sway. */
export function slotCenter(col: number, row: number): { x: number; y: number } {
  return { x: slotX(col), y: slotY(row) };
}

/**
 * The drawn footprint of a drone of `kind`, in logical units.
 *
 * The figure `constants.ts` fixes for that kind, so a check that samples a
 * drone's own body — its colour, its telegraph, the burst it leaves — reads the
 * box the specification says the drone occupies rather than a box of its own
 * invention. It is geometry, not a tolerance: how CLOSE a build's drawn box has
 * to come to it is stated by the check that asks.
 */
export function droneFootprint(kind: DroneKind): number {
  if (kind === "shard") return SHARD_SIZE;
  if (kind === "flux") return FLUX_SIZE;
  return PRISM_SIZE;
}

/** The ship's drawn footprint, in logical units. */
export const SHIP_FOOTPRINT = { w: SHIP_W, h: SHIP_H };

/**
 * Points spread across the empty play field, well clear of both HUD strips and
 * of the formation grid, for a check that needs the ground an element is drawn
 * against.
 *
 * They are inside `[FIELD_LEFT, FIELD_RIGHT] x [FIELD_TOP, FIELD_BOTTOM]` and
 * away from the slots, so a posed formation never stands on one.
 */
export const FIELD_POINTS: readonly { x: number; y: number }[] = [
  { x: FIELD_LEFT + 60, y: FIELD_TOP + 40 },
  { x: FIELD_RIGHT - 60, y: FIELD_TOP + 40 },
  { x: FIELD_LEFT + 60, y: FIELD_BOTTOM - 60 },
  { x: FIELD_RIGHT - 60, y: FIELD_BOTTOM - 60 },
  { x: FORM_CENTER_X, y: FIELD_BOTTOM - 120 },
];

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
 * The workspace the project is staged into, which is where `assets/` and `src/`
 * sit. The project is staged to `<workspace>/validation`, and this harness
 * resolves the build's modules by the same relative paths the build itself uses,
 * so the workspace is one level up from the project root.
 */
const WORKSPACE = join(PROJECT_ROOT, "..");

/** The four seeded silhouettes, by the name `constants.ts` draws each for. */
export type SpriteName = keyof typeof SPRITES;

/** Every seeded sprite's name, in the order `SPRITES` declares them. */
export const SPRITE_NAMES = Object.keys(SPRITES) as SpriteName[];

/**
 * Stand `fetch` and `createImageBitmap` up over the workspace's own `assets/`
 * tree, for the life of this module.
 *
 * The engine's asset loader resolves every path under a fixed root and fetches
 * it, then decodes an image's body with `createImageBitmap` and hands a plain
 * file's body back as a `Blob` (engine docs, assets.md). A Node process has
 * neither global, so a build that loads its art inside the level's `load` would
 * see every file fail and fall back to shapes drawn in code — and the checks
 * about the seeded art would grade a build that draws its sprites perfectly as
 * one that draws none.
 *
 * Installed once, at module load, rather than around each `createHarness`: the
 * art is loaded inside the level's `load`, which the engine awaits before any
 * actor of the level exists, and a build may reload it at any later moment.
 * Nothing else in this process fetches, and each test file gets its own module
 * registry, so what is stood up here is contained to the suite that imported it.
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
 * How far apart two sources are: the mean absolute difference over premultiplied
 * RGBA channels, out of `255`. Sources of different sizes are infinitely far
 * apart, because one cannot be the other.
 */
export function frameDistance(a: Float64Array, b: Float64Array): number {
  if (a.length !== b.length || a.length === 0) return Infinity;
  let total = 0;
  for (let i = 0; i < a.length; i += 1) total += Math.abs(a[i] - b[i]);
  return total / a.length;
}

/**
 * The alpha a pixel must carry to count as PART OF a silhouette.
 *
 * Half opaque. Every seeded PNG is drawn with straight alpha on a transparent
 * `SPRITE_SIZE` square (specs/assets.md), so its interior is at or near full
 * alpha and its edge falls away to nothing; splitting at the half point puts the
 * boundary where the artwork's own edge is and puts every anti-aliased fringe
 * pixel on the side it is nearer to.
 */
const ALPHA_ON = 128;

/**
 * A drawable source's alpha silhouette, resampled to the `SPRITE_SIZE` square
 * every seeded file is drawn on: one byte per pixel, `1` where the source is at
 * least half opaque and `0` where it is not.
 *
 * Resampled rather than compared at its own size, because what a check asks is
 * whether the SHAPE the build blitted is the shape the case provided — a build
 * that tinted the art into a scratch canvas of another size has still drawn the
 * provided silhouette, and one that drew its own polygon has not.
 */
export function silhouetteOf(source: {
  width: number;
  height: number;
}): Uint8Array {
  const canvas = createCanvas(SPRITE_SIZE, SPRITE_SIZE);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
  ctx.drawImage(source as never, 0, 0, SPRITE_SIZE, SPRITE_SIZE);
  const { data } = ctx.getImageData(0, 0, SPRITE_SIZE, SPRITE_SIZE);
  const mask = new Uint8Array(SPRITE_SIZE * SPRITE_SIZE);
  for (let i = 0; i < mask.length; i += 1) {
    mask[i] = data[i * 4 + 3] >= ALPHA_ON ? 1 : 0;
  }
  return mask;
}

/**
 * The fraction of pixels on which two silhouettes agree, from `0` to `1`.
 *
 * The fraction comes back rather than a verdict, so the check that asked states
 * its own bound beside the figure specs/ fixes for it.
 */
export function maskAgreement(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let same = 0;
  for (let i = 0; i < a.length; i += 1) if (a[i] === b[i]) same += 1;
  return same / a.length;
}

const seededImages = new Map<SpriteName, Promise<unknown>>();
const seededMasks = new Map<SpriteName, Promise<Uint8Array>>();
const seededChannels = new Map<SpriteName, Promise<Float64Array>>();

/** One seeded PNG, decoded off the workspace's own `assets/` tree. */
export function seededSprite(name: SpriteName): Promise<{
  width: number;
  height: number;
}> {
  let held = seededImages.get(name);
  if (held === undefined) {
    held = loadImage(join(WORKSPACE, "assets", SPRITES[name]));
    seededImages.set(name, held);
  }
  return held as Promise<{ width: number; height: number }>;
}

/** One seeded PNG's alpha silhouette, decoded once per test file and held. */
export function seededSilhouette(name: SpriteName): Promise<Uint8Array> {
  let held = seededMasks.get(name);
  if (held === undefined) {
    held = seededSprite(name).then(silhouetteOf);
    seededMasks.set(name, held);
  }
  return held;
}

/** One seeded PNG's premultiplied channels, decoded once per test file and held. */
export function seededChannelsOf(name: SpriteName): Promise<Float64Array> {
  let held = seededChannels.get(name);
  if (held === undefined) {
    held = seededSprite(name).then(channelsOf);
    seededChannels.set(name, held);
  }
  return held;
}

/**
 * How much of `name`'s alpha silhouette a drawn source carries, from `0` to `1`.
 *
 * This is the reading specs/assets.md's "drawn from the provided art" is written
 * about: a build may tint the frame, scale it to the drone's footprint, or blit
 * it through a scratch canvas, and every one of those keeps the silhouette. What
 * it cannot do and still match is draw a shape of its own.
 */
export async function silhouetteMatch(
  source: { width: number; height: number },
  name: SpriteName,
): Promise<number> {
  return maskAgreement(silhouetteOf(source), await seededSilhouette(name));
}

/** A seeded sprite and how far a compared source sits from it. */
export interface SpriteMatch {
  name: SpriteName;
  distance: number;
}

/**
 * The seeded sprite a drawn source sits nearest, and how far away it is.
 *
 * The DISTANCE comes back rather than a verdict, so the check that asked states
 * its own bound: identity is what the specification requires of a build that
 * draws from the seeded art, and how much room a canvas round trip leaves is the
 * check's to state beside the sprite it expected.
 */
export async function nearestSeededSprite(source: {
  width: number;
  height: number;
}): Promise<SpriteMatch> {
  const pixels = channelsOf(source);
  let best: SpriteMatch = { name: SPRITE_NAMES[0], distance: Infinity };
  for (const name of SPRITE_NAMES) {
    const distance = frameDistance(pixels, await seededChannelsOf(name));
    if (distance < best.distance) best = { name, distance };
  }
  return best;
}

/* ---- The seeded drone-burst ----------------------------------------------- */

/** One emitter of the seeded particle system, as much of it as a check reads. */
export interface BurstEmitter {
  name: string;
  emission: {
    mode: string;
    /** Particles for a `burst`, particles per second for a `rate`. */
    count?: number;
    rate?: number;
    /** When a `burst` fires, in milliseconds from the effect's start. */
    atMs?: number;
  };
  lifetimeMs: number;
  lifetimeSpread?: number;
}

/** `assets/drone-burst.json`, as much of it as a check reads. */
export interface BurstSystemFile {
  durationMs: number;
  fps: number;
  field: { width: number; height: number };
  emitters: BurstEmitter[];
}

let burstFile: BurstSystemFile | null = null;

/**
 * The seeded particle system, read off the workspace's own `assets/` tree.
 *
 * The CASE provides this file and specs/assets.md tells the build to play the
 * drone-burst with it, so a check about the burst compares what the game holds
 * against the file's own emitters rather than against a figure invented here.
 */
export function seededBurstSystem(): BurstSystemFile {
  burstFile ??= JSON.parse(
    readFileSync(join(WORKSPACE, "assets", BURST_SYSTEM), "utf8"),
  ) as BurstSystemFile;
  return burstFile;
}

/**
 * How many particles the seeded system's own emitters have alive `at` seconds
 * into the effect.
 *
 * Read straight off the file: a `burst` emitter contributes its whole count from
 * the moment it fires until its particles' mean lifetime is up, and a `rate`
 * emitter contributes what it has emitted since the start, less what has expired.
 * A spread is a spread about that mean and is deliberately ignored, because the
 * mean is what a count is compared against — how far a build may sit from it is
 * stated by the check that asks.
 */
export function expectedLiveParticles(
  system: BurstSystemFile,
  at: number,
): number {
  const ms = at * 1000;
  let live = 0;
  for (const emitter of system.emitters) {
    const life = emitter.lifetimeMs;
    if (emitter.emission.mode === "burst") {
      const fired = emitter.emission.atMs ?? 0;
      if (ms >= fired && ms < fired + life) live += emitter.emission.count ?? 0;
    } else {
      const rate = emitter.emission.rate ?? emitter.emission.count ?? 0;
      const emitted = (rate * Math.min(ms, system.durationMs)) / 1000;
      const expired = (rate * Math.max(0, ms - life)) / 1000;
      live += Math.max(0, emitted - expired);
    }
  }
  return live;
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
 * Where a `fillText`/`strokeText` call put its text, read off the real context at
 * the moment of the call: the current transform, so the anchor can be mapped to
 * logical units whatever transform the pipeline applied, the measured width under
 * the current font, and the alignment that places the run about its anchor.
 */
export interface TextGeometry {
  transform: Matrix;
  width: number;
  textAlign: string;
}

/**
 * One recorded operation on the 2D context, in the order the render made it.
 *
 * `transform` is carried on a `drawImage` call, because the destination
 * rectangle a call carries is stated in whatever space the context held at the
 * time — a build that mirrors, rotates or scales its blit states it in that
 * space — and only the transform maps it back.
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
  /** The clock each frame takes its delta from. Defaults to 100 Hz. */
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
  snapshot: SpectraSnapshot;
}

/**
 * How long a wait on the engine's own frame loop may run before it gives up.
 *
 * The bound on `runUntil`, and it is a bound rather than a measurement: the wait
 * ends the moment the build's own reading says what the check is waiting for, so
 * a quiet host leaves it in a fraction of a second and a host running a hundred
 * other jobs simply takes longer to get there. What reaching this bound means is
 * that the loop never ran, which is the failure the point is looking for.
 */
const FREE_RUN_DEADLINE_MS = 30_000;

/** How often the build is asked what its own loop has done, while it holds the clock. */
const FREE_RUN_POLL_MS = 25;

export interface Harness {
  readonly engine: Engine<SpectraSurface>;
  /**
   * The world currently open, read fresh on every access. Spectra runs in one
   * world for the whole session — every screen is a value of the state's `screen`
   * field — but reading it through the engine keeps a check honest against a
   * build that rebuilt it anyway.
   */
  readonly world: World;
  /**
   * The open world's game state — the live `SpectraState` specs/state.md
   * declares — read fresh on every access. Its arrangement is the build's; what a
   * check asserts is read through `snapshot`.
   */
  readonly state: GameState;
  /** The game instance, the one framework object that outlives every level. */
  readonly instance: GameInstance<SpectraSurface>;
  /**
   * The debug surface the BUILD's instance returned from `initialize`, read off
   * `engine.debug` — see {@link readDebugSurface} — and driven directly: each
   * operation acts on the live game at the moment of the call.
   */
  readonly debug: SpectraDriver;
  /** The real 2D context, for `getImageData`. Draw calls also reach it. */
  readonly ctx: SKRSContext2D;
  /**
   * The surface the engine drew into, holding the last frame that ran.
   *
   * Exposed for {@link captureStill}, which encodes it: a still output is the
   * picture the build actually put on the canvas, and the only place that picture
   * exists is here.
   */
  readonly canvas: Canvas;
  /** Every call and property set the render made, oldest first. */
  readonly calls: DrawCall[];
  /** Every cue the build played, oldest first. */
  readonly cues: PlayedCue[];
  /** Every asset the build failed to load, oldest first. */
  readonly assetFailures: AssetFailure[];

  /** A fresh read of the game's state through the case's `snapshot`. */
  snapshot(): SpectraSnapshot;
  /** Run `frames` frames back to back. */
  advance(frames: number): Promise<void>;
  /** Run whole frames covering `duration` seconds of game time. */
  advanceSeconds(duration: number): Promise<void>;
  /** Advance until `predicate` holds, sampling every `poll` frames. */
  until(
    predicate: (snapshot: SpectraSnapshot) => boolean,
    options?: UntilOptions,
  ): Promise<UntilResult>;
  /**
   * Drive the engine's own frame loop for `ms` of real time, then halt it.
   *
   * NO POINT MAY BE SIZED AGAINST THIS. How many frames a loop covers over a
   * stretch of the wall clock is a fact about the machine, not about the build, so
   * a reading taken across a fixed `ms` reaches further on a quiet host than on a
   * busy one. A point that genuinely needs the build's own clock uses `runUntil`,
   * which ends on the build's own reading passing a floor and simply takes longer
   * on a loaded host; a point that needs game time to pass uses `advance`. This is
   * the raw primitive both of those rest on, kept for a caller that wants the loop
   * running and asserts nothing about how far it got.
   */
  runFor(ms: number): Promise<void>;
  /**
   * Drive the engine's own frame loop until `predicate` holds of what the build
   * reports, then halt it, and hand back the state that ended it.
   *
   * The wait a point about the build's own clock runs. Real time passes and
   * nothing steps the game, exactly as `runFor` leaves it, but what ends the wait
   * is the build's own reading rather than a stretch of the wall clock: how many
   * frames a host's frame callback delivers in a given second is a fact about the
   * machine, so a host running a hundred other jobs makes this wait longer
   * instead of making the build look stopped. `deadlineMs` bounds it, and a build
   * whose loop never runs reaches that bound with the predicate still false.
   */
  runUntil(
    predicate: (snapshot: SpectraSnapshot) => boolean,
    options?: { deadlineMs?: number; pollMs?: number },
  ): Promise<SpectraSnapshot>;

  /** Press a key and leave it down, as a player holding it would. */
  hold(code: string): void;
  /** Release a key held by `hold`. */
  release(code: string): void;
  /**
   * Press and release a key, then run the one frame that delivers its edge.
   *
   * The engine arms an edge when a change takes an action from zero to non-zero
   * and closes the input frame after the frame renders, so a tap between frames
   * arms the edge for exactly the next frame — which this runs.
   */
  tap(code: string): Promise<void>;

  /**
   * The event target the surface hands the engine — where the engine's own input
   * system attached its `keydown`/`keyup` listeners, and where the engine's
   * overlay listens for the backtick.
   *
   * {@link hold}, {@link release} and {@link tap} are the named way in; this is
   * for a check that needs to raise an event of its own shape.
   */
  readonly events: EventTarget;

  /** Where a logical point lands in the canvas's backing store. */
  device(x: number, y: number): { x: number; y: number };
  /** Where a logical point lands in CSS pixels, which is where a gesture goes. */
  css(x: number, y: number): { x: number; y: number };
  /**
   * Dispatch one real pointer event at the target the engine listens on, and run
   * the frame that delivers it.
   *
   * The menus take a mouse and a finger as well as the keyboard
   * (`specs/ui.md`), and each part of a gesture runs exactly ONE driven frame,
   * so a caller counting frames can add them up and a build that reads its input
   * once per frame sees every edge.
   */
  pointer(
    type: "pointerdown" | "pointermove" | "pointerup",
    x: number,
    y: number,
    device?: "mouse" | "touch",
  ): Promise<void>;
  /** The device pixel under a logical point, as `[r, g, b, a]`. */
  pixel(x: number, y: number): [number, number, number, number];

  /** Close the world, halt the loop, and drop the engine's listeners. */
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

/**
 * A `PointerEvent`-shaped event: the engine reads the position, the pointer's id,
 * whether it is primary, the device that drove it, and the buttons it carries.
 *
 * Dispatched at the very target the engine attached its own pointer listeners to,
 * so a gesture reaches the build the way a hand's does: the engine maps the
 * position through the same letterboxed fit the game draws under, and the build
 * reads it off the input reader like any other frame's pointer.
 */
class PointerDispatch extends Event {
  readonly clientX: number;
  readonly clientY: number;
  readonly pointerId: number;
  readonly isPrimary = true;
  readonly pointerType: "mouse" | "touch";
  readonly button: number;
  readonly buttons: number;

  constructor(
    type: "pointerdown" | "pointermove" | "pointerup",
    at: { x: number; y: number },
    device: "mouse" | "touch",
    held: boolean,
  ) {
    super(type);
    this.clientX = at.x;
    this.clientY = at.y;
    // A mouse keeps one id for the life of the page; a touch contact gets its own.
    this.pointerId = device === "mouse" ? 1 : 2;
    this.pointerType = device;
    // `-1` on a move, which is the browser's own "no button reported here".
    this.button = type === "pointermove" ? -1 : 0;
    this.buttons = held ? 1 : 0;
  }
}

/**
 * A logical point's device pixel, through the world's camera and the engine's
 * fit. The camera opens at the defaults — world and logical coordinates coincide,
 * which is the space every figure in `constants.ts` is stated in — so the
 * projection is the identity unless the build moved it, and mapping through it
 * keeps the reading honest either way.
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
 * context, so one frame produces both a pixel buffer to sample and a call list to
 * inspect.
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
 * The debug surface the BUILD's instance returned from `initialize`, read off the
 * engine that holds it.
 *
 * This is deliberately a READ and never a construction. The surface is the
 * build's deliverable: its instance's `initialize` returns it
 * (specs/instrumentation.md), the engine keeps that same object, and
 * `engine.debug` is the only way it reaches a check. Nothing here could stand in
 * for it, because the build's own module for the surface is never imported.
 *
 * By the time this runs `engine.initialize()` has resolved, which is the one
 * precondition `engine.debug` has: it holds whatever the instance returned. A
 * build whose `initialize` returned `undefined` never gets this far, because the
 * engine rejects `initialize` itself, naming the missing surface, and the
 * rejection fails the suite's `beforeEach` with the engine's own message. Such a
 * build does not run on the engine under any entry point, so it is not this
 * harness's fault to report — which is why every suite's `afterEach` disposes its
 * harness with `?.`: the hook then has nothing to add to that message.
 *
 * What IS decided here is a return that is no surface — a build whose
 * `initialize` returned `null`, or something other than an object. That is a
 * fault in the build and not in this harness, so it must not present as one:
 *
 * - It is NOT thrown from here. Every suite builds its harness in a `beforeEach`,
 *   so a throw at this point would fail the hook and bury the real verdict under
 *   the harness's own stack in the case's own file.
 * - It is NOT swallowed either. {@link missingSurface} stands in for the missing
 *   surface and fails, by assertion, at the moment a check first reaches for an
 *   operation on it — naming the return the build owes.
 *
 * So the harness is built, teardown runs, and the fault lands exactly where
 * specs/instrumentation.md says it should: on the points whose checks reach the
 * game through the surface. A check that needs no surface is decided on its own
 * merits, and `instrumentation/surface-present` names the missing surface
 * outright.
 */
function readDebugSurface(engine: Engine<SpectraSurface>): SpectraSurface {
  const surface: unknown = engine.debug;
  if (typeof surface !== "object" || surface === null) {
    return missingSurface(
      `engine.debug holds ${surface === null ? "null" : typeof surface}, ` +
        `not an object`,
    );
  }
  return surface as SpectraSurface;
}

/**
 * A stand-in for the surface a build never returned: every operation on it fails
 * the check that reached for it, with the missing return named.
 *
 * A proxy rather than a hand-written stub, so a check that reaches for ANY member
 * — an operation this engine's surface carries, or one a future revision adds —
 * reports the missing surface rather than a `TypeError`.
 *
 * Keys that belong to the MACHINERY rather than to a check are answered with
 * `undefined` instead: awaiting the harness probes `then`, and vitest's own error
 * formatting probes symbols and `constructor`. Failing those would replace the
 * verdict below with noise from the machinery that was trying to report it.
 */
function missingSurface(reason: string): SpectraSurface {
  return new Proxy({} as SpectraSurface, {
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
 * The options passed to the factory are the ones the seeded `src/main.ts` passes
 * — the design size, the build's exported `BACKGROUND`, and the two-button pad
 * layout — so one harness serves every build of this case. Everything else the
 * build decided lives inside `src/game.ts`.
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
  // Under the recorder, so the clear it issues is in no draw-call list and in no
  // captured replay: what a check reads is what the build itself drew.
  const recorded = recorder(clearBeforeCoveringFills(ctx), calls);
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

  const engine = createEngine<SpectraSurface>({
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

    async runUntil(predicate, runOptions = {}) {
      const deadline =
        Date.now() + (runOptions.deadlineMs ?? FREE_RUN_DEADLINE_MS);
      const pollMs = Math.max(1, runOptions.pollMs ?? FREE_RUN_POLL_MS);
      const controller = new AbortController();
      const running = engine.run({ signal: controller.signal });
      try {
        let snapshot = debug.snapshot();
        while (!predicate(snapshot) && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, pollMs));
          snapshot = debug.snapshot();
        }
        return snapshot;
      } finally {
        controller.abort();
        await running;
      }
    },

    hold: (code) => dispatch("keydown", code),
    release: (code) => dispatch("keyup", code),
    async tap(code) {
      dispatch("keydown", code);
      dispatch("keyup", code);
      await engine.advance(1);
    },
    events: keys,

    device: (x, y) => toDevice(engine.world, engine.viewport(), x, y),
    css: (x, y) => {
      const at = toDevice(engine.world, engine.viewport(), x, y);
      return { x: at.x / dpr, y: at.y / dpr };
    },
    async pointer(type, x, y, device = "mouse") {
      const at = toDevice(engine.world, engine.viewport(), x, y);
      keys.dispatchEvent(
        new PointerDispatch(
          type,
          { x: at.x / dpr, y: at.y / dpr },
          device,
          type !== "pointerup",
        ),
      );
      await engine.advance(1);
    },
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
//    ARM IT NARROWLY IN THIS CASE. A drone-burst is a simulated particle field
//    re-scattered every frame, so its marks are fresh operations each time and
//    nothing in them ever dedupes; a recording that spans a whole scenario as
//    well as the pop it is about grows fast against the recorder's own capture
//    budget, past which a new image records as an opaque marker. A check about
//    a burst, a discharge wave or a spray arms around the frames it is alive for.
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
 * `validation/swarm/dive-returns.test.ts` — because that is the path the
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
 * a bullet crossing a drone, a shell breaking, a discharge wave expanding, a
 * dive bending toward the ship — are written whole.
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
 * Exported so a check can drive it directly: a recording carrying an own field
 * named `__proto__` is one the engine's recorder writes and this one has to
 * rewrite as a field rather than as a prototype, and no drawing the reference
 * implementation makes produces one, so no capture in this suite reaches that
 * branch on its own.
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
 * what these outputs are named for. A sweep is evidence that the wave flew in
 * group by group, and the flight is spread across the whole of it.
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
 * check's sweep stopped at — the assembled formation, the cleared stage — and it
 * is the one a reviewer looks at first.
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
    console.warn(`spectra: could not write ${destination}: ${String(error)}`);
  }
}

/**
 * Record the frames `scenario` draws and keep them as the review item's
 * `outputId` output, handing back whatever the scenario returned.
 *
 * Wrap the drive, not the arrangement:
 *
 * ```ts
 * await captureReplay(h, "dive", async () => {
 *   h.debug.setDroneTravel(id, true);
 *   await h.advance(ticksFor(1.5));
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
 * PICTURE rather than a stretch of motion: the assembled formation, two drones
 * of opposite bands side by side, the title screen, a HUD strip. A recording of
 * a still screen would be the same frame three hundred times over, and a
 * reviewer looking at a posed field wants to look at the field.
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
    console.warn(`spectra: could not write ${destination}: ${String(error)}`);
  }
}

/* -------------------------------------------------------------------------- */
/* Scenario helpers                                                           */
/* -------------------------------------------------------------------------- */
//
// Each of these poses a situation through the debug surface — or the real
// registered actions — and then lets the build's own rules run. They fix only
// arrangement: which slot a drone stands on, where a bullet starts, which key is
// held. Every threshold a check asserts is stated in the check itself, derived
// from the figure or rule specs/ states for it.
//
// A check calls the ones it needs and no more. Nothing here is a prerequisite of
// anything else here: a check about the title menu poses no wave, and a check
// about a Flux's band clock poses no bullet.

/**
 * `reset({seed})`: the title screen, a seeded generator, every declared field at
 * its title-screen value. Every suite's opening move where the generator matters.
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
 * the title's highlighted first item — `TITLE_ITEMS[0]`, the mode entry — which
 * is what opens a run (specs/ui.md). No pose on the surface starts a run, and
 * there is not meant to be one: the run opens on its stage intro, and the wave
 * is built as that intro gives way, so the path the menu takes is what a check
 * about the starting wave is about.
 *
 * One frame runs, the frame that delivers the key's edge. The run opens on
 * `stageIntro`, so no drone exists yet when this returns.
 */
export async function startRun(h: Harness, seed?: number): Promise<void> {
  resetTo(h, seed);
  await tapAction(h, "confirm");
}

/**
 * Live play on an EMPTY, QUIET field at stage 1, with the ship centred in its
 * lane and able to fire.
 *
 * This is the ground almost every mechanical check stands on, and it is a harness
 * sequence rather than a debug operation because the surface is atomic: every
 * line below is one of its operations.
 *
 * EMPTY is what the isolation rule asks for: the scenario poses the entities its
 * requirement concerns and nothing else stands beside them.
 *
 * QUIET is the four world gates. With `waveEntry`, `diveLaunching`,
 * `stageClearing` and the ship's `contact` all off, nothing the scenario did not
 * ask for arrives, launches, ends the stage, or costs a life: no entry group is
 * released, no formation drone is chosen to dive, no incidental touch empties the
 * field mid-scenario, and destroying the last drone a scenario posed leaves the
 * wave live rather than clearing the stage out from under the reading.
 *
 * Each gate is the WAVE's or the STAGE's own faculty rather than any entity's, so
 * shutting one removes nothing the requirement concerns and parks no bystander in
 * a corner to hold the wave open.
 *
 * A check whose REQUIREMENT is one of those four faculties turns that one back on
 * itself, and only that one. A check that finds itself needing a gate for any
 * other reason has been mis-posed.
 *
 * The generator is left as it stands, so a check that wants a seeded one calls
 * {@link resetTo} first. No frame is advanced: every pose here lands at the call.
 */
export function startPosed(h: Harness): void {
  h.debug.clearDrones();
  h.debug.clearPlayerBullets();
  h.debug.clearEnemyBullets();
  h.debug.clearBursts();
  h.debug.setWaveEntry(false);
  h.debug.setDiveLaunching(false);
  h.debug.setStageClearing(false);
  h.debug.setShipContact(false);
  h.debug.setScreen("inWave");
  h.debug.setPhase("live");
  h.debug.setPhaseTimer(0);
  h.debug.setStage(1);
  h.debug.setShipX(LANE_CENTER);
  h.debug.setShipBand("cyan");
  h.debug.setFireLockout(0);
  h.debug.setFireCooldown(0);
  h.debug.setResonance(0);
  h.debug.setInversion(0);
  h.debug.setLives(START_LIVES);
  h.debug.setScore(0);
  h.debug.setExtraLifeAwarded(false);
  h.debug.setChallengeHits(0);
  h.debug.setDiveClock(0);
}

/**
 * The stage the GAME builds, opened at its own stage intro and let through.
 *
 * `setStage(n)` spawns nothing and clears nothing (specs/instrumentation.md), so
 * the stage's wave is built by the game itself as the intro gives way
 * (specs/stages.md). Posing the intro's hold to zero and running one frame is
 * what lets it: the wave that stands when this returns is the wave the build's
 * own layout produced, at whatever bands and slots its seeded generator drew.
 *
 * ONLY the checks whose requirement IS that wave use this. Everything else poses
 * what it needs on the empty field {@link startPosed} opens, because a built wave
 * brings a whole stage's traffic with it.
 *
 * The three world gates are left exactly as the game has them — on, unless the
 * caller turned one off first — because a wave that cannot enter is not the wave
 * this helper is for.
 */
export async function startStage(h: Harness, stage: number): Promise<void> {
  h.debug.setStage(stage);
  h.debug.setScreen("stageIntro");
  h.debug.setPhase("live");
  h.debug.setPhaseTimer(0);
  await h.advance(1);
}

/**
 * The fields a posed drone may be given beyond its kind and its centre.
 *
 * Everything not named is left exactly as `addDrone` leaves it, with the ONE
 * exception below.
 */
export interface DronePose {
  /** Its stored band. On a Prism, the SHELL's. Defaults to `addDrone`'s cyan. */
  band?: Band;
  /** Its phase. Defaults to `addDrone`'s `"formation"`. */
  phase?: DronePhase;
  /** The centre of its resting formation slot. Defaults to where it was placed. */
  slot?: { x: number; y: number };
  /** Seconds into a Flux's current band window. Defaults to `0`. */
  bandClock?: number;
  /** Whether a Prism's outer shell stands. Defaults to intact. */
  shell?: boolean;
  /** Its locomotion. Defaults OFF. */
  travel?: boolean;
  /** A Flux's band clock. Defaults OFF. */
  oscillation?: boolean;
  /** Its firing. Defaults OFF. */
  fire?: boolean;
}

/**
 * A drone of `kind` with its centre at a logical stage point, and its id.
 *
 * ALL THREE FACULTIES DEFAULT OFF, which is the one departure from what
 * `addDrone` leaves behind. A drone the game itself brought in flies, oscillates
 * and fires; a drone a check posed is a PROP until that check asks for a
 * faculty, so a scenario about a Prism's shell is not joined by the Prism flying
 * out of frame and a scenario about a Flux's colour is not joined by its band
 * turning over mid-measurement. A check whose requirement is one of the three
 * turns that one on, in its own file, where the reader can see it.
 *
 * The id comes off the snapshot's last drone, which is where an added drone
 * lands (specs/instrumentation.md, Identity). A build whose `addDrone` added
 * nothing fails here, naming the operation.
 */
export function poseDrone(
  h: Harness,
  kind: DroneKind,
  x: number,
  y: number,
  pose: DronePose = {},
): number {
  h.debug.addDrone(kind, x, y);
  const drones = h.snapshot().drones;
  if (drones.length === 0) {
    fail(
      `addDrone(${JSON.stringify(kind)}, ${x}, ${y}) to append a drone to ` +
        `the roster (specs/instrumentation.md)`,
      "the drone roster is empty",
    );
  }
  const id = drones[drones.length - 1].id;

  if (pose.band !== undefined) h.debug.setDroneBand(id, pose.band);
  if (pose.phase !== undefined) h.debug.setDronePhase(id, pose.phase);
  if (pose.slot !== undefined) {
    h.debug.setDroneSlot(id, pose.slot.x, pose.slot.y);
  }
  if (pose.bandClock !== undefined) {
    h.debug.setDroneBandClock(id, pose.bandClock);
  }
  if (pose.shell !== undefined) h.debug.setDroneShell(id, pose.shell);
  h.debug.setDroneTravel(id, pose.travel ?? false);
  h.debug.setDroneOscillation(id, pose.oscillation ?? false);
  h.debug.setDroneFire(id, pose.fire ?? false);
  return id;
}

/** One entry of a posed formation: a kind, the slot it rests on, and its pose. */
export interface FormationEntry extends DronePose {
  kind: DroneKind;
  /** The formation column, `0..FORM_COLS-1`. */
  col: number;
  /** The formation row, `0..FORM_ROWS-1`. */
  row: number;
}

/**
 * A formation posed slot by slot, and the ids in the order `spec` names them.
 *
 * Each drone is placed at its slot's own centre — `slotX(col)`, `slotY(row)`,
 * before any sway — with that same point as its resting slot and its phase
 * `"formation"` unless the entry says otherwise. Every faculty is off, as
 * {@link poseDrone} leaves them, so an assembled block holds exactly where it was
 * put until a check asks it to move.
 */
export function poseFormation(
  h: Harness,
  spec: readonly FormationEntry[],
): number[] {
  return spec.map(({ kind, col, row, ...pose }) => {
    const at = slotCenter(col, row);
    return poseDrone(h, kind, at.x, at.y, {
      phase: "formation",
      slot: at,
      ...pose,
    });
  });
}

/** One of the player's bullets in flight, its centre at a point, and its id. */
export function posePlayerBullet(
  h: Harness,
  x: number,
  y: number,
  band: Band,
): number {
  h.debug.addPlayerBullet(x, y, band);
  return lastBulletId(
    h,
    `addPlayerBullet(${x}, ${y}, ${JSON.stringify(band)})`,
  );
}

/** One enemy bullet in flight, its centre at a point, and its id. */
export function poseEnemyBullet(
  h: Harness,
  x: number,
  y: number,
  band: Band,
): number {
  h.debug.addEnemyBullet(x, y, band);
  return lastBulletId(h, `addEnemyBullet(${x}, ${y}, ${JSON.stringify(band)})`);
}

/** The id the last `add*Bullet` appended, or the failure that it appended none. */
function lastBulletId(h: Harness, call: string): number {
  const bullets = h.snapshot().bullets;
  if (bullets.length === 0) {
    fail(
      `${call} to append a bullet to the roster (specs/instrumentation.md)`,
      "the bullet roster is empty",
    );
  }
  return bullets[bullets.length - 1].id;
}

/**
 * A shot sent at a point from `below` units under it, run for `frames` frames,
 * and the id it was given.
 *
 * The distance and the frame count are the CALLER's, because they are what the
 * check is reasoning about: `PLAYER_BULLET_SPEED` and the target's own
 * half-extent are what decide how far a shot has to start and how long it has to
 * fly to cross a body, and stating them here would hide the arithmetic the check
 * rests on. What this fixes is only the geometry — straight up the column the
 * target stands in — and that the bullet is the build's from the moment it is
 * placed: the real collision code is what resolves it.
 *
 * The id comes back so a check can ask whether the shot survived the crossing.
 */
export async function fireAt(
  h: Harness,
  x: number,
  y: number,
  band: Band,
  below: number,
  frames: number,
): Promise<number> {
  const id = posePlayerBullet(h, x, y + below, band);
  await h.advance(frames);
  return id;
}

/**
 * An enemy shot sent down the ship's own column from `above` units over its lane,
 * run for `frames` frames, and the id it was given.
 *
 * The companion to {@link fireAt} for everything aimed AT the ship — the shield,
 * the lives, the resonance an absorb pays. The distance and the frame count are
 * the caller's for the same reason, and the column is the ship's current `x` at
 * the call, so a check that moved the ship first still fires down its lane.
 */
export async function fireAtShip(
  h: Harness,
  band: Band,
  above: number,
  frames: number,
): Promise<number> {
  const id = poseEnemyBullet(h, h.snapshot().ship.x, SHIP_LANE_Y - above, band);
  await h.advance(frames);
  return id;
}

/* ---- Driving the real input path ------------------------------------------ */

/** An action the game registers, as `constants.ts` names them. */
export type Action = keyof typeof BINDINGS;

/**
 * The action's first bound key, from the case-fixed `BINDINGS` table, pressed and
 * released as a player would press it — the REAL registered-action path, which is
 * the only way the menus move and the only way the ship flips or fires
 * (specs/controls.md).
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
 * measures exactly `frames` frames of movement. The release is in a `finally`, so
 * a scenario that failed mid-hold does not leave the key down for the next one.
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
 * Hold two keys down together for `frames` frames and let both up — what a check
 * about two actions at once (moving while firing) drives.
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
// Plain functions over the object `snapshot()` returned, so a check reads what it
// is about without walking a roster by hand. None of them asserts anything: a
// reading that is not there comes back `undefined`, and what that means is the
// check's to state.

/** The drone with that id, or `undefined` where no drone carries it. */
export function droneById(
  snapshot: SpectraSnapshot,
  id: number,
): DroneSnapshot | undefined {
  return snapshot.drones.find((drone) => drone.id === id);
}

/** The bullet with that id, of either kind, or `undefined` where none carries it. */
export function bulletById(
  snapshot: SpectraSnapshot,
  id: number,
): BulletSnapshot | undefined {
  return snapshot.bullets.find((bullet) => bullet.id === id);
}

/** The burst with that id, or `undefined` where none carries it. */
export function burstById(
  snapshot: SpectraSnapshot,
  id: number,
): BurstSnapshot | undefined {
  return snapshot.bursts.find((burst) => burst.id === id);
}

/** Every drone of one kind, in roster order. */
export function dronesOfKind(
  snapshot: SpectraSnapshot,
  kind: DroneKind,
): DroneSnapshot[] {
  return snapshot.drones.filter((drone) => drone.kind === kind);
}

/** Every drone in one phase, in roster order. */
export function dronesInPhase(
  snapshot: SpectraSnapshot,
  phase: DronePhase,
): DroneSnapshot[] {
  return snapshot.drones.filter((drone) => drone.phase === phase);
}

/** The player's bullets, in roster order. One roster holds both kinds. */
export function playerBullets(snapshot: SpectraSnapshot): BulletSnapshot[] {
  return snapshot.bullets.filter((bullet) => bullet.friendly);
}

/** The enemy's bullets, in roster order. */
export function enemyBullets(snapshot: SpectraSnapshot): BulletSnapshot[] {
  return snapshot.bullets.filter((bullet) => !bullet.friendly);
}

/** The last drone in the roster, which is where an added one lands. */
export function lastDrone(
  snapshot: SpectraSnapshot,
): DroneSnapshot | undefined {
  return snapshot.drones[snapshot.drones.length - 1];
}

/** The last bullet in the roster, which is where an added one lands. */
export function lastBullet(
  snapshot: SpectraSnapshot,
): BulletSnapshot | undefined {
  return snapshot.bullets[snapshot.bullets.length - 1];
}

/** The last burst in the roster, which is where a new one lands. */
export function lastBurst(
  snapshot: SpectraSnapshot,
): BurstSnapshot | undefined {
  return snapshot.bursts[snapshot.bursts.length - 1];
}

/** An entity's centre, as the point every drawing and sampling helper takes. */
export function centerOf(entity: { x: number; y: number }): {
  x: number;
  y: number;
} {
  return { x: entity.x, y: entity.y };
}

/** How far apart two points are, in logical units. */
export function distanceBetween(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** The heading of a velocity, in degrees, measuring clockwise from due right. */
export function headingDeg(v: { vx: number; vy: number }): number {
  return (Math.atan2(v.vy, v.vx) * 180) / Math.PI;
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
 * The rendered colour at a logical point, averaged over a small cluster: the
 * centre pixel plus four neighbours `spread` units out, so one stray
 * anti-aliased or glow pixel cannot swing the reading.
 *
 * The default spread is four units, which sits well inside a `SHARD_SIZE` body
 * and inside the ship's hull. A check reading something narrower — a bullet is
 * `PLAYER_BULLET_W` across — passes a spread of its own, taken from the figure
 * `constants.ts` fixes for what it is reading.
 */
export function sampleColor(h: Harness, x: number, y: number, spread = 4): Rgb {
  const offsets: readonly (readonly [number, number])[] = [
    [0, 0],
    [spread, 0],
    [-spread, 0],
    [0, spread],
    [0, -spread],
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

/** How bright a colour is, on the 0–255 scale (Rec. 601). */
export function luminance(colour: Rgb): number {
  return 0.299 * colour.r + 0.587 * colour.g + 0.114 * colour.b;
}

/** Euclidean distance between two colours, 0 to about 441. */
export function colorDistance(a: Rgb, b: Rgb): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

/**
 * The fraction of a box's pixels {@link litBox} reads a colour from: the
 * brightest of them.
 *
 * A twentieth of a `SHARD_SIZE` box is about 39 pixels — a mark a player sees
 * rather than a stray pixel, and small enough that a sparse seeded frame is read
 * by its own lit core rather than by the field around it.
 */
const LIT_FRACTION = 0.05;

/**
 * The device-pixel rectangle a logical box centred on `(x, y)` covers.
 *
 * Mapped through the world's camera and the engine's fit, so a harness built at
 * a different CSS size or device pixel ratio reads the same box.
 */
function deviceBox(
  h: Harness,
  x: number,
  y: number,
  w: number,
  height: number,
): { x: number; y: number; w: number; h: number } {
  const from = h.device(x - w / 2, y - height / 2);
  const to = h.device(x + w / 2, y + height / 2);
  return {
    x: from.x,
    y: from.y,
    w: Math.max(1, to.x - from.x),
    h: Math.max(1, to.y - from.y),
  };
}

/**
 * The colour of whatever is LIT inside a logical box centred on `(x, y)`: the
 * mean of the brightest {@link LIT_FRACTION} of its pixels.
 *
 * {@link sampleColor} reads five points around a centre, which is the right
 * reading for a body drawn as a solid shape — a bullet, the ship's hull, a HUD
 * bar — and the wrong one for a sparse figure. Every seeded frame under `assets/`
 * is a sparse mark on a transparent field: a Prism is a shell around a core with
 * space between them, and a five-point cross through its centre can land wholly
 * on one layer and read the same colour for two states the art draws
 * differently. This reads the mark instead, which is what specs/overview.md's
 * legibility table is written about.
 *
 * On empty field every pixel is the ground, so this reads the ground, and an
 * element and the field behind it are always compared like with like.
 */
export function litBox(
  h: Harness,
  x: number,
  y: number,
  w: number,
  height: number,
): Rgb {
  const box = deviceBox(h, x, y, w, height);
  const { data } = h.ctx.getImageData(box.x, box.y, box.w, box.h);
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

/** {@link litBox} over a drone's own footprint, which is the box it occupies. */
export function litDrone(h: Harness, drone: DroneSnapshot): Rgb {
  const size = droneFootprint(drone.kind);
  return litBox(h, drone.x, drone.y, size, size);
}

/** {@link litBox} over the ship's own footprint. */
export function litShip(h: Harness, x: number): Rgb {
  return litBox(h, x, SHIP_LANE_Y, SHIP_FOOTPRINT.w, SHIP_FOOTPRINT.h);
}

/**
 * The empty field's own colour, read where nothing stands: the mean of the
 * cluster samples at {@link FIELD_POINTS}.
 *
 * Read off the RENDER rather than off `BACKGROUND`, because the field a player
 * sees is what the build drew over the clear — a starfield, a gradient, a grid —
 * and that is what an element has to be legible against.
 */
export function sampleField(h: Harness): Rgb {
  let r = 0;
  let g = 0;
  let b = 0;
  for (const point of FIELD_POINTS) {
    const sample = sampleColor(h, point.x, point.y);
    r += sample.r;
    g += sample.g;
    b += sample.b;
  }
  return {
    r: r / FIELD_POINTS.length,
    g: g / FIELD_POINTS.length,
    b: b / FIELD_POINTS.length,
  };
}

/**
 * The build's exported `BACKGROUND`, rasterized: the colour the engine clears the
 * whole canvas to each frame (specs/overview.md), read back through the same
 * canvas implementation the harness samples with, so a pixel the game never drew
 * over compares against it exactly.
 *
 * The fill is repeated rather than applied once so a translucent colour reads as
 * the engine leaves it: the engine composites its clear over the previous frame
 * every frame, which converges on the colour's own channels, and a single fill
 * over a transparent canvas would not.
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
 * Every pixel inside a logical box centred on `(x, y)`, copied — so a check can
 * hold one region from two moments, or one region under two states, and say how
 * far apart the build drew them.
 */
export function regionPixels(
  h: Harness,
  x: number,
  y: number,
  w: number,
  height: number,
): Uint8ClampedArray {
  const box = deviceBox(h, x, y, w, height);
  return Uint8ClampedArray.from(
    h.ctx.getImageData(box.x, box.y, box.w, box.h).data,
  );
}

/**
 * The mean per-pixel RGB distance between two {@link regionPixels} captures, on
 * the 0-to-441 scale a legibility figure is stated in.
 *
 * Regions of different sizes are infinitely far apart, because one cannot be
 * compared with the other.
 */
export function regionDistance(
  before: Uint8ClampedArray,
  after: Uint8ClampedArray,
): number {
  if (before.length !== after.length || before.length === 0) return Infinity;
  let total = 0;
  const pixels = before.length / 4;
  for (let i = 0; i < before.length; i += 4) {
    total += Math.hypot(
      before[i] - after[i],
      before[i + 1] - after[i + 1],
      before[i + 2] - after[i + 2],
    );
  }
  return total / pixels;
}

/**
 * The fraction of a region's pixels that sit further than `tolerance` from
 * `ground`, from `0` to `1`: how much of a box the build actually PAINTED over
 * the field behind it.
 *
 * The tolerance is the caller's, because how far a pixel has to sit from the
 * ground to count as painted is the reading the check is making. What is fixed
 * here is only the box and the arithmetic.
 */
export function paintedFraction(
  region: Uint8ClampedArray,
  ground: Rgb,
  tolerance: number,
): number {
  if (region.length === 0) return 0;
  const pixels = region.length / 4;
  let painted = 0;
  for (let i = 0; i < region.length; i += 4) {
    const away = Math.hypot(
      region[i] - ground.r,
      region[i + 1] - ground.g,
      region[i + 2] - ground.b,
    );
    if (away > tolerance) painted += 1;
  }
  return painted / pixels;
}

/**
 * The canvas's whole backing store, copied — so a check can hold two frames apart
 * and say whether anything the build drew changed between them.
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

/** Every character with a meaning inside a regular expression, escaped. */
function escapeForPattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whether the frame drew `word` as a STANDALONE token, at word boundaries,
 * ignoring case.
 *
 * The stricter reading {@link drewText} deliberately is not, for the checks about
 * copy that NAMES something — a key, a band — where a substring match would
 * accept a screen that never says the word. "CYAN" must not be answered by
 * "CYANOGEN", and "AD" must not be answered by "READY"; the boundaries are what
 * make the difference. Punctuation and spacing around the token are still the
 * build's, because a boundary is not a character.
 */
export function drewWord(calls: readonly DrawCall[], word: string): boolean {
  const pattern = new RegExp(`\\b${escapeForPattern(word.trim())}\\b`, "i");
  return drawnText(calls).some((drawn) => pattern.test(drawn));
}

/**
 * The geometry calls a frame made, by name.
 *
 * Enough of a count to compare two frames of the same scene: a frame that drew a
 * discharge wave asked for strictly more of these than the same frame with the
 * wave gone, whatever shape the build chose to draw it as.
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
 * component draws, so the coordinates a drawing call carries are the game's own —
 * and with the camera at its defaults those are logical units. Where a render put
 * its geometry is the direct reading of it: the points along a column are the
 * bullet climbing it, and the points spread about a dead drone are its burst. The
 * leading pair of arguments is the position for every method listed, except the
 * curve calls, whose control points come first and whose endpoint is the last
 * pair.
 *
 * `drawImage` is not in here, because its leading argument is a bitmap rather
 * than a coordinate and a mirrored or rotated draw states its rectangle in a
 * transformed space: read those with {@link drawnImages}.
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
  /**
   * The source the build handed the context — the seeded bitmap itself, or a
   * scratch canvas it tinted the bitmap into — for {@link silhouetteMatch} and
   * {@link nearestSeededSprite}.
   */
  source: { width: number; height: number };
  /** The destination rectangle's centre, in logical units. */
  x: number;
  y: number;
  /** The destination rectangle's size, in logical units, always positive. */
  w: number;
  h: number;
  /**
   * Whether the transform at the call flipped the drawing, which is how art that
   * faces one way is drawn facing the other.
   */
  mirrored: boolean;
  /**
   * The transform the context held at the call, which is where a rotation is. A
   * blit drawn upright carries no shear terms whatever scale the engine's fit
   * applied; a turn puts them there.
   */
  transform: Matrix;
}

/**
 * Every bitmap the frame blitted, with its destination placed in logical units.
 *
 * A `drawImage` carries its destination in whatever space the context held at the
 * call, so a build that mirrored, rotated or scaled its blit states that
 * rectangle in a transformed space. The transform recorded beside the call is
 * what maps it back, so every sprite reports the centre it was drawn on whatever
 * the build did to get it there.
 *
 * The three-argument form takes its size from the source's own dimensions, which
 * is what the canvas does with it; the nine-argument form's destination is its
 * last four numbers, so a build that blits a CROP of the seeded art — the way a
 * Prism's bare core is drawn from the inside of its own frame — still reports
 * where that crop landed.
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
    // The destination rectangle's centre, through the transform the call was made
    // under and then back through the engine's fit to logical units.
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
      // A negative determinant is a reflection, which is the only way an axis is
      // flipped: a rotation alone leaves it positive.
      mirrored: m.a * m.d - m.b * m.c < 0,
      transform: m,
    });
  }
  return images;
}

/**
 * Every bitmap the frame blitted whose centre lands within `radius` logical units
 * of a point — the blits drawn ON something, in the order they were made.
 *
 * A check that asks whether an element is drawn from the seeded art reads the
 * first of these; a check that asks whether an element is drawn in CODE asks for
 * this to be empty.
 */
export function imagesNear(
  h: Harness,
  x: number,
  y: number,
  radius: number,
): DrawnImage[] {
  return drawnImages(h).filter(
    (image) => Math.hypot(image.x - x, image.y - y) <= radius,
  );
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
 * drawing applies and align it any way it likes, so the anchor is mapped through
 * the transform the context held at the call and the run is extended about it by
 * its measured width and `textAlign`. Which way a `start`/`end` alignment reads is
 * the page's direction; this game draws no right-to-left text, so they are left
 * and right.
 *
 * This is how the HUD checks decide WHERE a reading was drawn — the score in the
 * top strip, the lives in the bottom one — rather than merely that its characters
 * appeared somewhere.
 *
 * The OVERLAY's text is in here too when the overlay is up: the engine draws it
 * through the same context, in device pixels under an identity transform, which
 * this mapping carries back to logical units like any other run.
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
 * Toggle the engine's diagnostics overlay and run the frame that draws — or stops
 * drawing — it.
 *
 * The overlay is ENGINE CHROME under this engine: `OVERLAY_KEY` toggles it
 * through a keydown listener the engine itself owns on the harness's event
 * target, never through a registered action (engine docs, diagnostics.md). It is
 * drawn after the pipeline renders, through the same context this harness records
 * — so with the overlay up, the registered sources' lines land in `h.calls` as
 * ordinary text draws, readable with {@link drawnText} — but AFTER the engine
 * recorder's bracket closes, so none of it appears in a `captureReplay`
 * recording. Capture overlay evidence with {@link captureStill}.
 */
export async function toggleOverlay(h: Harness): Promise<void> {
  h.hold(OVERLAY_KEY);
  h.release(OVERLAY_KEY);
  await h.advance(1);
}

/* -------------------------------------------------------------------------- */
/* Menus, driven by a real mouse and a real finger                            */
/* -------------------------------------------------------------------------- */
//
// The menus take a pointer and a touch contact as well as the keyboard
// (`specs/ui.md`), and where a build LAYS the items out is the build's own — so a
// check asks the build where it put an item, through `menuItemRect`, and then
// drives a real pointer at that region. Nothing here poses a pointer through the
// surface: a pose would tell the build where the pointer is without making the
// engine's input layer see a press, a travel and a release the way a hand does,
// and what these checks are about is precisely that the build reads them.

/**
 * Where the build put item `index` of the menu the current screen shows.
 *
 * Fails by assertion when the build reports no region for an item its own menu
 * shows, so the point names that fault rather than dividing by a `null` several
 * lines later. A check that is ABOUT the reading returning `null` — on a screen
 * with no menu, or past the end of one — calls `h.debug.menuItemRect` directly.
 */
export function menuRect(h: Harness, index: number): MenuRect {
  const rect = h.debug.menuItemRect(index);
  assertTruthy(
    rect,
    `menuItemRect(${index}) must report the hit region of item ${index} on the ` +
      "menu the current screen shows (specs/instrumentation.md)",
  );
  return rect as MenuRect;
}

/** The middle of a hit region: where a gesture aimed at that item lands. */
export function rectCenter(rect: MenuRect): { x: number; y: number } {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/** Move the pointer onto item `index`, and run the frame that reads it. */
export async function pointerOntoItem(
  h: Harness,
  index: number,
): Promise<void> {
  const at = rectCenter(menuRect(h, index));
  await h.pointer("pointermove", at.x, at.y);
}

/** Press and release the pointer inside item `index`'s region. */
export async function clickItem(h: Harness, index: number): Promise<void> {
  const at = rectCenter(menuRect(h, index));
  await h.pointer("pointermove", at.x, at.y);
  await h.pointer("pointerdown", at.x, at.y);
  await h.pointer("pointerup", at.x, at.y);
}

/**
 * Press on one item, travel to another, and release there.
 *
 * The two edges fall in different regions, so this confirms nothing — the
 * affordance that lets a player slide off a control to cancel, which
 * `specs/ui.md` states and a check reads back as a `menuIndex` that moved and a
 * screen that did not.
 */
export async function dragBetweenItems(
  h: Harness,
  from: number,
  to: number,
): Promise<void> {
  const start = rectCenter(menuRect(h, from));
  const end = rectCenter(menuRect(h, to));
  await h.pointer("pointermove", start.x, start.y);
  await h.pointer("pointerdown", start.x, start.y);
  await h.pointer("pointermove", end.x, end.y);
  await h.pointer("pointerup", end.x, end.y);
}

/** Land a touch contact inside item `index`'s region and leave it down. */
export async function landOnItem(h: Harness, index: number): Promise<void> {
  const at = rectCenter(menuRect(h, index));
  await h.pointer("pointerdown", at.x, at.y, "touch");
}

/**
 * Land a touch contact inside item `index`'s region and lift it there.
 *
 * The landing selects the item as well as confirming it, because a finger does
 * not hover (`specs/ui.md`) — which is the difference between this and
 * {@link clickItem}, and the reason both exist.
 */
export async function tapItem(h: Harness, index: number): Promise<void> {
  const at = rectCenter(menuRect(h, index));
  await h.pointer("pointerdown", at.x, at.y, "touch");
  await h.pointer("pointerup", at.x, at.y, "touch");
}

/** Land a contact on one item, travel to another, and lift there: confirms nothing. */
export async function touchBetweenItems(
  h: Harness,
  from: number,
  to: number,
): Promise<void> {
  const start = rectCenter(menuRect(h, from));
  const end = rectCenter(menuRect(h, to));
  await h.pointer("pointerdown", start.x, start.y, "touch");
  await h.pointer("pointermove", end.x, end.y, "touch");
  await h.pointer("pointerup", end.x, end.y, "touch");
}
