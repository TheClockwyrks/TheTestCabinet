// Spectra — the shared validator harness. CASE-PROVIDED.
//
// Every check in this suite is an ordinary vitest test that runs IN THE SAME
// PROCESS as the build. It imports the engine and the build's own modules,
// creates an engine over a canvas it owns and a clock it chose, and steps the
// game with `engine.advance`. Nothing drives a browser, nothing polls, and no
// wall-clock time passes: a check asks for a number of frames and gets exactly
// that number, at exactly the deltas its clock supplied.
//
// RECONCILING AFTER A POSE. A helper here that poses anything a reading derives
// from ends with `reconcile`, so a check that poses through these helpers never
// calls it itself. Spectra's derived readings are `isChallenge`, the four
// stage-scaled figures, `dischargeReady`, `inversionActive`, `ship.alive`, every
// `effectiveBand`, a Flux's `shimmer` and a burst's `particles` — so `startPosed`
// and the drone and bullet poses carry the call. A check that poses with
// `h.debug.set...` DIRECTLY, outside these helpers, calls `reconcile` once itself
// before its first read or sweep. It costs no simulation time, so it never moves
// a measurement that begins at a posed rest state, which is exactly what stepping
// a frame to refresh a reading would do.
//
// WHAT IS HERE AND WHAT IS NOT. The machinery of that paragraph — the engine
// lifecycle, the debug surface and the stand-in for a missing one, the driven
// frame, the sweep, the key and pointer events, the cue stamping, the transport
// a produced file is served over, and the evidence a review item's output is
// written from — is the shared `@clockwyrks/case-harness` package's, staged in
// beside this file as `./case-harness/`. What stays HERE is what is genuinely
// Spectra's: the case's types, the tick rate its suites step at, the sentence a
// missing surface is failed against, the field geometry every reading is stated
// in, the seeded sprite art and the particle system the case itself provides,
// and every scenario helper that poses this game. The kit takes the case's types
// as GENERICS and everything else about it as one config object — including the
// engine itself, which arrives as values (`createEngine`, `ConstantClock`, the
// game definition), because the package names no engine.
//
// AND ONE THING MORE STAYS HERE THAN IN A TYPICAL MIGRATION: THE RECORDER OVER
// THE 2D CONTEXT. See "The recorder this project keeps" below — it records a
// `drawImage`'s transform, which the package's does not, and it must sit ON TOP
// of `./covered-frames`, which nothing in the package can be threaded through.
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
// is arranged the same way in every build, and it is the seam the case's
// specification documents.
// `surface.ts` is that specification as types, and it is the only description of
// the surface this harness reads: the build's own module for it is never
// imported.
//
// WHERE THE SURFACE COMES FROM. Off `engine.debug`, never built here. The game
// instance's `initialize` returns it, the engine holds that same object, and
// reading it back off the engine is the only way a surface reaches a check — so
// a build that returned no surface, or a surface missing an operation, fails the
// checks that reach the game through it. The package's `readDebugSurface` does
// that read and stands an `absentSurface` in when there is nothing to read, so
// the fault lands on the points whose checks reach the game through the surface
// rather than on the `beforeEach` that built the harness.
//
// HOW THE SURFACE IS DRIVEN. Directly — the `identityDriver` strategy. Under
// this engine the raw surface IS imperative, so a pose acts on the live game at
// the moment of the call and a reading is built at the call
// (specs/instrumentation.md), and a scenario poses and then reads with no frame
// in between. A frame is advanced when the check wants the game to RUN — a drone
// to fly its dive, a bullet to cross a body, a discharge wave to expand, a render
// to happen.
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
// (instrumentation/elapsed-time-steps) builds its own harnesses with clocks of
// its own, passing {@link HarnessOptions.clock}.
//
// SPRITES, HEADLESS. The suite runs in `node`, where `fetch` and
// `createImageBitmap` do not exist, and the game loads its seeded art inside the
// level's `load`. The package's asset host stands both globals up over the
// workspace's own tree when this module loads, so every build's art — the four
// PNGs and the drone-burst's particle system — arrives exactly as it does in a
// browser. See the install below.
//
// ONE VALIDATOR DIRECTORY SERVES BOTH VARIANTS. Nothing in this file names an
// `overload` figure or reaches for `setDroneCharge`: the variant's own suites do
// that, against the constants their own workspace seeds. What is here is what
// `base` and `overload` share, which is everything but the charge.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createCanvas,
  loadImage,
  type Canvas,
  type SKRSContext2D,
} from "@napi-rs/canvas";
import {
  ConstantClock,
  createEngine,
  type Clock,
  type Engine,
  type GameDefinition,
  type GameInstance,
  type GameState,
  type SurfaceMetrics,
  type World,
} from "@clockwyrks/structured-2d";
import {
  createEngineCaseHarness,
  identityDriver,
  installAssetHost,
  rasterize,
  type AssetFailure,
  type EngineHarness,
  type EngineHarnessOptions,
  type PlayedCue,
  type PointerEventType,
  type TimedCue,
  type UntilOptions,
  type UntilResult as EngineUntilResult,
} from "./case-harness/engine/index";
import {
  allInLogical,
  canvasPixels as readCanvasPixels,
  makeReplayCapture,
  pixelsChanged as countPixelsChanged,
  sampleColor as sampleClusterColor,
} from "./case-harness/engine/2d";
import { callsTo, setsOf, type TextGeometry } from "./case-harness/draw-calls";
import {
  drawnText,
  drawnTextLines,
  drawnTextRuns,
  type TextDraw,
} from "./case-harness/text";
import { colorDistance, type Rgb } from "./case-harness/color";
import { apply, type Matrix } from "./case-harness/matrix";
import { distance, rectCenter, type Point } from "./case-harness/point";
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

/* The readings this project takes straight off the package, under its names. */
export { callsTo, colorDistance, drawnText, setsOf };
export type { AssetFailure, Matrix, PlayedCue, Rgb, TextGeometry, TimedCue };

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

/** The engine this project stands a build up on. */
export type SpectraEngine = Engine<SpectraSurface>;

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

/**
 * Frames of the default clock covering `duration` seconds, ROUNDED TO WHOLE.
 *
 * The case's own, and not the kit's `ticksFor`, which rounds UP. Every duration
 * specs/ fixes lands on a whole frame at 100 Hz so the two agree on all of them,
 * but a check that derives a span of its own — a fraction of a dive gap, a
 * partial shimmer — is stating "the nearest whole frame to this much time", and
 * a ceiling would hand it one frame more for anything above an exact tick. That
 * is a frame of movement, and the checks that measure a rate over a span are
 * sized against the nearest.
 */
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
export function slotCenter(col: number, row: number): Point {
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
export const FIELD_POINTS: readonly Point[] = [
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
 * because it has to name the same directory wherever the suite is run from —
 * and never from the package's, which is staged one directory deeper still, so
 * a root derived there would address every written output one level too far
 * down and silently, because the writers are required not to raise.
 */
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * The workspace the project is staged into, which is where `assets/` and `src/`
 * sit. The project is staged to `<workspace>/validation`, and this harness
 * resolves the build's modules by the same relative paths the build itself uses,
 * so the workspace is one level up from the project root.
 */
const WORKSPACE = dirname(PROJECT_ROOT);

/**
 * Stand `fetch` and `createImageBitmap` up over the workspace's own tree, for
 * the life of this worker.
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
 * actor of the level exists, and a build may reload it at any later moment. The
 * handle is deliberately never given up — this project's shim has always stood
 * for the whole of the worker, and a `dispose` that pulled it down would pull it
 * out from under a second harness the same suite is still driving.
 *
 * THE THREE FIELDS BELOW ARE WHAT THIS PROJECT'S VERDICTS WERE TAKEN UNDER, and
 * each is one field precisely because the cases disagree about it:
 *
 *   - `roots: ["."]`, narrower than the package's `[".", "public", "dist"]`.
 *     The shim this replaces read `join(WORKSPACE, url)` and nothing else, so a
 *     path the committed tree does not carry has never been answered out of a
 *     staged copy under `public/` or `dist/`.
 *   - `onMissing: "upstream"`, because that shim let `readFileSync`'s own error
 *     REJECT the fetch. A path no root carries has therefore always failed as a
 *     rejection rather than as a status, and `"404"` would resolve a response and
 *     send the engine's loader down its other branch. Node's `fetch` refuses the
 *     relative URL, so the rejection is what the loader still meets.
 *   - `nameImageBitmap: false`, which does NOT follow `images` here. Nothing in
 *     this process ever defined `globalThis.ImageBitmap`, and defining it changes
 *     what the ENGINE's own draw-command recorder captures for a blitted sprite —
 *     it recognizes a drawable source by `instanceof` against the host's
 *     constructors — so every replay this project writes would carry a different
 *     picture for a name that decides nothing about the build.
 *
 * `documentElement` and `offscreenCanvas` are the two ways a browser hands out a
 * SCRATCH SURFACE, and they are on here for the reason the `simple-2d` project
 * gives at length: specs/assets.md leaves the BAND ROUTE to the build — the tint
 * may be "composited over the seeded PNG at draw time" or "a per-band copy is
 * baked once at load time" — and the baking route composes on a surface the build
 * asks the platform for, either way it likes. A host that offered neither fails a
 * build that bakes with a `ReferenceError` thrown from inside the level's own
 * `load`, and one that offered only the document's fails a build that reached for
 * the other; both would fail every item in this project on a fact about Node. The
 * two shims hand back the same `@napi-rs/canvas` surface as each other and as the
 * one every reading here rasterizes through, so a variant the build baked is read
 * exactly as a seeded bitmap is and nothing can tell which way it was asked for.
 * The `simple-2d` project supplies both, and a build stood up under one engine
 * must be handed what a build under the other is.
 */
installAssetHost({
  workspaceRoot: WORKSPACE,
  roots: ["."],
  onMissing: "upstream",
  images: true,
  nameImageBitmap: false,
  documentElement: true,
  offscreenCanvas: true,
  label: "spectra",
});

/** The four seeded silhouettes, by the name `constants.ts` draws each for. */
export type SpriteName = keyof typeof SPRITES;

/** Every seeded sprite's name, in the order `SPRITES` declares them. */
export const SPRITE_NAMES = Object.keys(SPRITES) as SpriteName[];

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
    const away = frameDistance(pixels, await seededChannelsOf(name));
    if (away < best.distance) best = { name, distance: away };
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
/* The recorder this project keeps                                            */
/* -------------------------------------------------------------------------- */
//
// The package records every call and property set on its way to the real
// context, and this does the same — with ONE FIELD MORE. A `drawImage` carries
// its destination rectangle in whatever space the context held at the call, so a
// build that mirrors, rotates or scales its blit states that rectangle in a
// transformed space and only the transform maps it back. {@link drawnImages} is
// written on that transform, and the package's recorder keeps one for a TEXT
// call and not for a bitmap one, so a project reading a blit's placement has to
// take it here.
//
// AND IT HAS TO SIT ON TOP OF `./covered-frames`. That module clears the backing
// store before a fill it can prove covers it opaquely, which is what keeps a
// single `captureStill` from costing a minute of filtered re-rasterization — and
// the clear it issues must reach the REAL context under whatever records the
// build's calls, or it would appear in `h.calls` and in every captured replay.
// So this layer is built over `clearBeforeCoveringFills(real)`, which is a
// sandwich nothing in the package can be threaded through: the kit builds its
// canvas and its own recorder in one call, with no seam between them.
//
// Both facts are why {@link createHarness} re-dresses the element the kit hands
// its engine factory. See the note there.

/**
 * One recorded operation on the 2D context, in the order the render made it.
 *
 * The package's own `DrawCall`, plus the `transform` a `drawImage` carries — a
 * strict extension, so every reading the package ships over a recorded call
 * (`callsTo`, `setsOf`, `drawnText`, `drawnTextRuns`) reads this unchanged.
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

/** The transform in force, in the `[a, b, c, d, e, f]` order the package reads. */
function transformOf(ctx: SKRSContext2D): Matrix {
  const m = ctx.getTransform();
  return [m.a, m.b, m.c, m.d, m.e, m.f];
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
          call.text = {
            transform: transformOf(object),
            width: object.measureText(args[0]).width,
            textAlign: object.textAlign,
          };
        }
        if (method === "drawImage") call.transform = transformOf(object);
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

/** Each engine's own call log, so the harness finds it after the kit built it. */
const recorded = new WeakMap<object, DrawCall[]>();

/**
 * Put this project's own recorder on the element the kit built, and answer it.
 *
 * The kit dresses its canvas by ASSIGNING `getContext` as an own property over
 * the class's own method, so deleting that property uncovers the method again
 * and it answers the one real context the canvas caches — the very context the
 * kit's `Harness.ctx` and `Harness.pixel` read through. The element is then
 * re-dressed with the sandwich described above, and what the engine draws through
 * is this project's recorder rather than the kit's. Nothing else about the
 * canvas moves: it is the same surface, holding the same pixels, under the same
 * `getImageData`.
 */
function withOwnRecorder(
  element: HTMLCanvasElement,
  calls: DrawCall[],
): HTMLCanvasElement {
  delete (element as unknown as { getContext?: unknown }).getContext;
  const real = (element as unknown as Canvas).getContext("2d");
  const ctx = recorder(clearBeforeCoveringFills(real), calls);
  return Object.assign(element as unknown as Canvas, {
    getContext: (): SKRSContext2D => ctx,
  }) as unknown as HTMLCanvasElement;
}

/* -------------------------------------------------------------------------- */
/* The harness                                                                */
/* -------------------------------------------------------------------------- */

/** The window a harness reports to the engine, and the clock it steps on. */
export interface HarnessOptions extends EngineHarnessOptions {
  /** The clock each frame takes its delta from. Defaults to 100 Hz. */
  clock?: Clock;
}

/** How far a sweep may run, and how many frames separate two samples. */
export type { UntilOptions };

/** What a sweep found: whether the predicate ever held, and where it stopped. */
export type UntilResult = EngineUntilResult<SpectraSnapshot>;

/**
 * The engine's object model, which this engine has and its simple sibling does
 * not: the open world, the live game state, and the instance that outlives every
 * level.
 *
 * Getters rather than fields, so each reads FRESH on every access. Spectra runs
 * in one world for the whole session — every screen is a value of the state's
 * `screen` field — but reading it through the engine keeps a check honest against
 * a build that rebuilt it anyway.
 */
interface WorldModel {
  readonly world: World;
  readonly state: GameState;
  readonly instance: GameInstance<SpectraSurface>;
}

/** As much of the kit's harness as this project's own shape is built over. */
type BaseHarness = EngineHarness<SpectraSnapshot, SpectraDriver, SpectraEngine>;

/**
 * Everything a check reads off one engine running one build.
 *
 * The kit's harness, minus the two members this case means something else by,
 * plus the four it has always carried and the kit does not:
 *
 *  - {@link Harness.pointer} is ASYNCHRONOUS here and runs the frame that
 *    delivers the gesture. The kit's dispatches and advances nothing, and every
 *    pointer and touch point in this project counts the frames its gesture ran.
 *  - {@link Harness.calls} carries the transform a `drawImage` was made under —
 *    see "The recorder this project keeps" above.
 *  - {@link Harness.advanceSeconds} takes SECONDS of game time. The kit's harness
 *    has no member of that name at all; the one on the ENGINELESS half divides a
 *    span the build itself chooses, which is a different question.
 *  - {@link Harness.css} is where a logical point lands in CSS pixels.
 */
export interface Harness
  extends Omit<BaseHarness, "calls" | "pointer">, WorldModel {
  /** Every call and property set the render made, oldest first. */
  readonly calls: DrawCall[];

  /** Run whole frames covering `duration` seconds of game time. */
  advanceSeconds(duration: number): Promise<void>;
  /** Where a logical point lands in CSS pixels, which is where a gesture goes. */
  css(x: number, y: number): Point;
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
    type: PointerEventType,
    x: number,
    y: number,
    device?: "mouse" | "touch",
  ): Promise<void>;
}

/**
 * A `PointerEvent`-shaped event: the engine reads the position, the pointer's id,
 * whether it is primary, the device that drove it, and the buttons it carries.
 *
 * THE CASE'S OWN, AND NOT `DevicePointerEvent`. The package's device event is the
 * same seven fields and differs in one: its `pointerId` is `1` for every contact,
 * where a finger here gets its own. A structured engine tracks a contact BY that
 * id, so a touch point whose landing and lift shared the mouse's id would be a
 * different gesture reaching the build — see the README's collision table on why
 * two pointer events ship rather than one.
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
    type: PointerEventType,
    at: Point,
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
 * What the build owes when its surface is missing: the `Expected:` line of the
 * failure every check that reaches for the surface lands on, beside what
 * `engine.debug` was found holding instead.
 *
 * The case's own sentence rather than the package's, because where the surface
 * comes from is this engine's business: a build whose `initialize` REJECTED never
 * reaches it — the engine's own rejection fails the suite's `beforeEach` with the
 * engine's message, which is why every suite's `afterEach` disposes with `?.` —
 * and what is named here is the other fault, a return that is no surface at all.
 */
const SURFACE_REQUIREMENT =
  "the debug surface src/game.ts's instance returns from initialize, which " +
  "the engine hands back from engine.debug (specs/instrumentation.md)";

/**
 * The package's engine machinery, bound to Spectra on this engine.
 *
 * Four of the config's members are where the four engines really differ, and each
 * is answered here from what THIS engine is:
 *
 *  - `driver` is the identity, because a structured engine's surface is already
 *    imperative.
 *  - `toLogical` goes through the world's camera. The camera opens at the
 *    defaults — world and logical coordinates coincide, which is the space every
 *    figure in `constants.ts` is stated in — so the projection is the identity
 *    unless the build moved it, and mapping through it keeps every pixel reading
 *    and every raised pointer honest either way.
 *  - `pointerPrecision` is `"device-pixel"`: a raised pointer lands on the same
 *    device pixel a reading would sample, which is what this project's checks
 *    have always been decided under.
 *  - `pointerEvent` raises the case's own {@link PointerDispatch}, for the reason
 *    stated on it.
 *
 * `cueEvents` is left at the package's default of `cue:played` alone, which is
 * what this project has always subscribed: specs/audio.md counts firings, and a
 * loop is not a play.
 */
const kit = createEngineCaseHarness<
  SpectraSnapshot,
  SpectraDriver,
  SpectraEngine,
  WorldModel & { calls: DrawCall[] }
>({
  slug: "spectra",
  projectRoot: PROJECT_ROOT,
  stage: { width: STAGE_W, height: STAGE_H },
  tickHz: TICK_HZ,
  surfaceRequirement: SURFACE_REQUIREMENT,
  defaultClock: () => new ConstantClock(TICK_MS),
  createEngine: ({ canvas, clock, surface }) => {
    // THE ELEMENT THE KIT BUILT, RE-DRESSED. This project's recorder carries one
    // field more than the package's and has to sit over `./covered-frames`, and
    // there is no seam inside `createRecordingCanvas` to thread either through —
    // so the swap happens here, where the case is already the one handing the
    // engine its canvas. See "The recorder this project keeps" above.
    const calls: DrawCall[] = [];
    const engine = createEngine<SpectraSurface>({
      canvas: withOwnRecorder(canvas, calls),
      width: STAGE_W,
      height: STAGE_H,
      game,
      // The build's own stage background, handed to the engine exactly as the
      // seeded `src/main.ts` hands it (specs/overview.md).
      background: BACKGROUND,
      layout: LAYOUT,
      clock,
      surface: surface as SurfaceMetrics,
    });
    recorded.set(engine, calls);
    return engine;
  },
  driver: (_engine, raw) => identityDriver(raw as SpectraSurface),
  snapshot: (debug) => debug.snapshot(),
  toLogical: (engine, x, y) => engine.world.camera.worldToLogical({ x, y }),
  pointerPrecision: "device-pixel",
  pointerEvent: (type, clientX, clientY, device) =>
    new PointerDispatch(
      type,
      { x: clientX, y: clientY },
      device === "touch" ? "touch" : "mouse",
      type !== "pointerup",
    ),
  extend: (_base, engine, initialized) => ({
    get world() {
      return engine.world;
    },
    get state() {
      return engine.world.state;
    },
    instance: initialized as GameInstance<SpectraSurface>,
    calls: callsOf(engine),
  }),
});

/** The call log {@link withOwnRecorder} opened for this engine. */
function callsOf(engine: SpectraEngine): DrawCall[] {
  const calls = recorded.get(engine);
  if (calls === undefined) {
    throw new Error(
      "spectra: this engine was built with no draw-call recorder",
    );
  }
  return calls;
}

/** Seconds of simulated time in `ticks` frames of the default clock. */
export const seconds = kit.seconds;

/**
 * Build an engine over a canvas of the harness's own, initialize the build's
 * game, and hand back everything a check reads.
 *
 * The options the kit passes the factory above are the ones the seeded
 * `src/main.ts` passes — the design size, the build's exported `BACKGROUND`, and
 * the two-button pad layout — so one harness serves every build of this case.
 * Everything else the build decided lives inside `src/game.ts`.
 *
 * The five members this case adds are defined over the kit's harness rather than
 * copied out of it, so `h.snapshot`, `h.advance`, `h.until`, the keyboard and the
 * evidence all stay the package's and only what Spectra means differently is its
 * own.
 */
export async function createHarness(
  options: HarnessOptions = {},
): Promise<Harness> {
  const base = await kit.createHarness(options);
  const raisePointer = base.pointer;
  const dpr = base.shape.dpr;

  return Object.defineProperties(
    base,
    Object.getOwnPropertyDescriptors({
      advanceSeconds: (duration: number): Promise<void> =>
        base.advance(ticksFor(duration)),

      css(x: number, y: number): Point {
        const at = base.device(x, y);
        return { x: at.x / dpr, y: at.y / dpr };
      },

      async pointer(
        type: PointerEventType,
        x: number,
        y: number,
        device: "mouse" | "touch" = "mouse",
      ): Promise<void> {
        raisePointer(type, x, y, device);
        await base.advance(1);
      },
    }),
  ) as unknown as Harness;
}

/* -------------------------------------------------------------------------- */
/* Evidence capture                                                           */
/* -------------------------------------------------------------------------- */
//
// A review item may declare a `replay` OUTPUT beside its verdict: the frames the
// build itself drew while a check drove it, kept as evidence a reviewer can
// scrub and compare against the reference implementation's. Both writers are the
// package's, bound here to this case's slug and to THIS directory — the project
// root may never be derived inside the package, which is staged one level deeper
// than this file, or every output would be addressed one directory too far down.
//
// Four properties are what make them usable, and all four are the package's:
// they record the SECTION rather than the run, they are evidence and never a
// verdict (a scenario that throws still leaves what it recorded, and the
// scenario's own value comes straight back), they write only what there is to
// look at, and they cost nothing when nobody is collecting.
//
// ARM A REPLAY NARROWLY IN THIS CASE. A drone-burst is a simulated particle field
// re-scattered every frame, so its marks are fresh operations each time and
// nothing in them ever dedupes; a recording that spans a whole scenario as well
// as the pop it is about grows fast against the recorder's own capture budget,
// past which a new image records as an opaque marker. A check about a burst, a
// discharge wave or a spray arms around the frames it is alive for.

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
export const captureReplay = makeReplayCapture("spectra", PROJECT_ROOT);

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
 * picture that shows why.
 *
 * The overlay is the one thing a replay cannot carry (see {@link toggleOverlay}),
 * so overlay evidence is captured here.
 */
export const captureStill: (h: Harness, outputId: string) => void =
  kit.captureStill;

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
 * `reset()`: the title screen, every declared field at its title-screen value,
 * and the id counter back at the first id. Every suite's opening move where a
 * fresh title matters.
 *
 * No frame is advanced. A pose acts on the live game at the call under this
 * engine (specs/instrumentation.md), so the state is restored when this returns,
 * and a check about what `reset` restores — `simTime` among them — reads a game
 * that has run no frame since.
 */
export function resetTo(h: Harness): void {
  h.debug.reset();
}

/**
 * A NEW RUN, opened the way a player opens one.
 *
 * `reset()` for the title screen, then `confirm` on
 * the title's highlighted first item — `TITLE_ITEMS[0]`, the mode entry — which
 * is what opens a run (specs/ui.md). No pose on the surface starts a run, and
 * there is not meant to be one: the run opens on its stage intro, and the wave
 * is built as that intro gives way, so the path the menu takes is what a check
 * about the starting wave is about.
 *
 * One frame runs, the frame that delivers the key's edge. The run opens on
 * `stageIntro`, so no drone exists yet when this returns.
 */
export async function startRun(h: Harness): Promise<void> {
  resetTo(h);
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
 * The id counter is left as it stands, so a check that wants a fresh title calls
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

  // The stage, the resonance, the inversion, the phase and the ship's band are
  // all posed above, and the derived figures follow every one of them, so the
  // readings are brought into agreement before anything reads them back.
  h.debug.reconcile();
}

/**
 * Pose a live run PAUSED, with `index` highlighted on the pause menu.
 *
 * The ground the pause menu's pointer and touch points stand on, and the pose
 * `screens/pause-quit` already uses: {@link startPosed} opens a live, empty, quiet
 * wave, and the screen and the highlight are then PLACED rather than walked to.
 * `specs/instrumentation.md` provides `setScreen` and `setMenuIndex` for exactly
 * that, so no menu key is pressed on the way in and the menu keys cannot fail the
 * points that stand here — a build whose `pause` binding or whose menu arrows are
 * broken still has its pointer and its touch graded on this screen, and
 * `controls/pause-escape`, `controls/pause-p` and the `controls` menu-arrow
 * points still decide the keys.
 *
 * One frame is run after the pose, so the screen the gesture then arrives on is
 * the paused screen the build's own code drew.
 */
export async function posePausedMenu(h: Harness, index: number): Promise<void> {
  startPosed(h);
  h.debug.setScreen("paused");
  h.debug.setMenuIndex(index);
  await h.advance(1);
}

/** The lost run the gesture is made from (specs/progression.md). */
const POSED_STAGE = 6;
const POSED_SCORE = 7250;
const POSED_LIVES = 0;

/**
 * Pose a lost run on the game-over screen, with `index` highlighted on its menu.
 *
 * The ground the game-over menu's pointer and touch points stand on, and the pose
 * `screens/game-over-menu-returns` already uses: the run is PLACED lost — the
 * stage it reached, the score it ended on, no lives left — and the screen and the
 * highlight are placed with it. `specs/instrumentation.md` provides `setScreen`
 * and `setMenuIndex` for exactly that, so no life is spent and no menu key is
 * pressed on the way in, and neither the death path nor the menu keys can fail the
 * points that stand here — `progression/game-over-at-zero` still decides the route
 * in, and the `controls` menu-arrow points still decide the keys.
 *
 * There is no live wave to open first, unlike {@link posePausedMenu}: the run is
 * over, so the screen is placed on the field the harness starts with. One frame is
 * run after the pose, so the screen the gesture then arrives on is the game-over
 * screen the build's own code drew.
 */
export async function poseGameOverMenu(
  h: Harness,
  index: number,
): Promise<void> {
  h.debug.setScreen("gameOver");
  h.debug.setStage(POSED_STAGE);
  h.debug.setScore(POSED_SCORE);
  h.debug.setLives(POSED_LIVES);
  h.debug.setMenuIndex(index);
  await h.advance(1);
}

/**
 * The stage the GAME builds, opened at its own stage intro and let through.
 *
 * `setStage(n)` spawns nothing and clears nothing (specs/instrumentation.md), so
 * the stage's wave is built by the game itself as the intro gives way
 * (specs/stages.md). Posing the intro's hold to zero and running one frame is
 * what lets it: the wave that stands when this returns is the wave the build's
 * own layout produced, at whatever bands and slots the build drew.
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
 * Stand the wave the game built where its entrance ends: every drone at its own
 * slot, in phase `formation`, with the entry gate shut behind it.
 *
 * For the items whose requirement is the ASSEMBLED block the build laid out — its
 * composition, its symmetry, the bands it holds — and not the entrance that
 * assembles it. Every drone reports the slot it is bound for from the moment the
 * wave is built (specs/swarm.md, specs/instrumentation.md), and a drone in phase
 * `formation` sits at that slot plus the sway, so posing each drone there is the
 * state its entrance would leave it in, reached without flying the twelve seconds
 * `swarm/assembles` grades. Nothing about the roster is touched: which drones the
 * wave holds, their kinds, their stored bands and their slots are all still the
 * build's. The entry gate is shut so the wave's own release schedule cannot send a
 * drone back out on its way in.
 *
 * Call it after {@link startStage}. It poses and returns; it runs no frame.
 */
export function settleWave(h: Harness): void {
  h.debug.setWaveEntry(false);
  for (const drone of h.snapshot().drones) {
    h.debug.setDronePhase(drone.id, "formation");
    h.debug.setDronePosition(drone.id, drone.slotX, drone.slotY);
  }
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
  slot?: Point;
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
  // The band, the shell and the band clock posed above are what a drone's
  // `effectiveBand` and its `shimmer` follow.
  h.debug.reconcile();
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
  // A bullet's `effectiveBand` follows the band it was placed with.
  h.debug.reconcile();
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
  // A bullet's `effectiveBand` follows the band it was placed with.
  h.debug.reconcile();
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
export function centerOf(entity: Point): Point {
  return { x: entity.x, y: entity.y };
}

/**
 * How far apart two points are, in logical units.
 *
 * The package's `distance`, under the name this project's suites call it by.
 */
export const distanceBetween = distance;

/** The heading of a velocity, in degrees, measuring clockwise from due right. */
export function headingDeg(v: { vx: number; vy: number }): number {
  return (Math.atan2(v.vy, v.vx) * 180) / Math.PI;
}

/* -------------------------------------------------------------------------- */
/* The cues                                                                   */
/* -------------------------------------------------------------------------- */
//
// Every one of these is the kit's. The engine publishes `cue:played`
// synchronously from inside `audio.play`, so the handler runs while the frame
// that played it is still running and `engine.frame().count` is that frame's own
// number — which is what lets a check assert not merely that a cue sounded but
// that it sounded on the frame of the event, and so tells a build that plays a
// cue on the right event apart from one that plays it on every frame, or a frame
// late.

/** Record every cue the build plays from now on, stamped with its frame. */
export const watchCues = kit.watchCues;

/** Every recorded firing of the cue named `name`, oldest first. */
export const cuesNamed = kit.cuesNamed;

/** Forget every cue recorded so far, so a check reads its own section alone. */
export const clearCues = kit.clearCues;

/* -------------------------------------------------------------------------- */
/* Reading the rendered pixels                                                */
/* -------------------------------------------------------------------------- */

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
export const sampleColor = sampleClusterColor;

/**
 * How bright a colour is, on the 0–255 scale (REC. 601).
 *
 * THE CASE'S OWN, AND NOT THE PACKAGE'S `luminance`, which is Rec. 709 weighted.
 * The two differ by up to a third of the scale on a saturated colour, and this
 * project's whole subject is a saturated two-colour palette: {@link litBox} ranks
 * a body's pixels by this, and every legibility figure the presentation checks
 * state was measured against the 601 weighting. Folding them would rescale every
 * one of those figures with nothing to say so.
 */
export function luminance(colour: Rgb): number {
  return 0.299 * colour.r + 0.587 * colour.g + 0.114 * colour.b;
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
 * The package's `rasterize` repeats the fill rather than applying it once so a
 * translucent colour reads as the engine leaves it: the engine composites its
 * clear over the previous frame every frame, which converges on the colour's own
 * channels, and a single fill over a transparent canvas would not.
 */
export function clearColor(): Rgb {
  const [r, g, b] = rasterize(BACKGROUND);
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
export const canvasPixels = readCanvasPixels;

/**
 * How many BYTES differ between two {@link canvasPixels} captures.
 *
 * The package's `pixelsChanged`, which is this reading and not its neighbour: a
 * count of differing BYTES with no tolerance, answering "did the build draw
 * anything different at all". `../color`'s `pixelsDiffering` counts PIXELS that
 * moved by more than a tolerance, and a threshold stated over one is meaningless
 * over the other.
 */
export const pixelsChanged = countPixelsChanged;

/* -------------------------------------------------------------------------- */
/* Reading one frame's render                                                 */
/* -------------------------------------------------------------------------- */

/** Every character with a meaning inside a regular expression, escaped. */
function escapeForPattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whether the frame drew `word` as a STANDALONE token, at word boundaries,
 * ignoring case.
 *
 * The stricter reading the shared harness's `drewText` (`case-harness/text.ts`)
 * deliberately is not, for the checks about copy that NAMES something — a key,
 * a band — where a substring match would accept a screen that never says the
 * word. "CYAN" must not be answered by "CYANOGEN", and "AD" must not be
 * answered by "READY"; the boundaries are what make the difference.
 * Punctuation and spacing around the token are still the build's, because a
 * boundary is not a character. Read off the same logical runs as `drewText`,
 * for the same reason: `CYAN` letter-spaced a glyph per call is still the word.
 */
export function drewWord(calls: readonly DrawCall[], word: string): boolean {
  const pattern = new RegExp(`\\b${escapeForPattern(word.trim())}\\b`, "i");
  return drawnTextLines(calls).some((line) => pattern.test(line));
}

/**
 * The geometry calls a frame made, by name.
 *
 * Enough of a count to compare two frames of the same scene: a frame that drew a
 * discharge wave asked for strictly more of these than the same frame with the
 * wave gone, whatever shape the build chose to draw it as.
 *
 * The case's own list, one entry SHORTER than the package's: `putImageData` is
 * not a drawing this game makes, and counting it would move every comparison a
 * check states over {@link drawOps} for a build that blits its starfield that way.
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
 * THE ARGUMENTS AS WRITTEN, and not the package's `drawnPoints`, which walks the
 * frame's own transform stack and answers where each point LANDED in canvas
 * pixels. Both are honest readings and they are different ones: this project's
 * checks compare a drawn point against a logical figure `constants.ts` fixes, and
 * the package's answers device space.
 *
 * `drawImage` is not in here, because its leading argument is a bitmap rather
 * than a coordinate and a mirrored or rotated draw states its rectangle in a
 * transformed space: read those with {@link drawnImages}.
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

/**
 * One bitmap a frame blitted, placed in logical units.
 *
 * NOT THE PACKAGE'S `ImageDraw`, and the check the README asks for was made
 * field by field. That one names its source by the recorder's `ImageRef` — an id,
 * a natural size and a hash of wherever it came from — and places the destination
 * in CANVAS pixels; this one carries the SOURCE OBJECT itself, because
 * {@link silhouetteMatch} and {@link nearestSeededSprite} rasterize the very
 * bitmap the build handed the context, and places the destination in LOGICAL
 * units, because every figure this project compares one against is a logical
 * figure. Neither field of either could stand in for the other's.
 */
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
  const view = h.viewport();
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
    const at = apply(m, dx + dw / 2, dy + dh / 2);
    images.push({
      source: source as { width: number; height: number },
      x: (at.x - view.offsetX) / view.scale,
      y: (at.y - view.offsetY) / view.scale,
      w: (Math.abs(dw) * Math.hypot(m[0], m[1])) / view.scale,
      h: (Math.abs(dh) * Math.hypot(m[2], m[3])) / view.scale,
      // A negative determinant is a reflection, which is the only way an axis is
      // flipped: a rotation alone leaves it positive.
      mirrored: m[0] * m[3] - m[1] * m[2] < 0,
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

/**
 * One run of text a frame drew, and the logical x range its glyphs span.
 *
 * The package's `TextDraw`, restated in this project's logical units, and a
 * LOGICAL RUN rather than one call: the package's `drawnTextRuns` coalesces a
 * letter-spaced heading into the one entry it spells, and every reader of these
 * looks a run up by the copy it carries before asking where it sits.
 */
export type TextSpan = TextDraw;

/**
 * Every logical run of text the frame drew, placed in logical units.
 *
 * A build may anchor its text through any transform the pipeline or its own
 * drawing applies and align it any way it likes, so the anchor is mapped through
 * the transform the context held at the call and the run is extended about it by
 * its measured width and `textAlign`. Which way a `start`/`end` alignment reads is
 * the page's direction; this game draws no right-to-left text, so they are left
 * and right.
 *
 * COALESCED, never one entry per call. A build that letter-spaces a heading or a
 * readout draws one glyph per `fillText`, which is the only portable way to
 * letter-space canvas text, and no glyph reads as the figure it is part of. So
 * this is the package's `drawnTextRuns`, not its `textDraws`: the merge rule
 * (`case-harness/text.ts`) folds side-by-side glyphs on one baseline back into
 * the run they spell, decided in the canvas's own pixels because the rule is
 * relative, and the merged runs are then carried back through the engine's fit.
 * A run keeps the anchor of its first draw, so a call that stands alone comes
 * back exactly as `textDraws` would place it, and every raw string is a
 * substring of its run, so this can only add a match and never take one away.
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
  return allInLogical(h.viewport(), drawnTextRuns(h.calls));
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
export { rectCenter };

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
