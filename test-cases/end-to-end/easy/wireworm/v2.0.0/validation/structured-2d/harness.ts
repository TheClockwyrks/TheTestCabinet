// Wireworm — the case's half of the validator harness. CASE-PROVIDED.
//
// Every check in this suite is an ordinary vitest test that runs IN THE SAME
// PROCESS as the build. It imports the engine and the build's own modules,
// creates an engine over a canvas it owns and a clock it chose, and steps the
// game with `engine.advance`. Nothing drives a browser, nothing polls, and no
// wall-clock time passes: a check asks for a number of frames and gets exactly
// that number, at exactly the deltas its clock supplied.
//
//
// A HELPER THAT POSES ANYTHING A READING DERIVES FROM RECONCILES BEFORE IT
// RETURNS. `specs/instrumentation.md` lets a build work a derived reading out at
// the read or keep it as a stored copy, and `reconcile()` is what brings a
// stored copy back into agreement — so `startPlaying`, which poses the level the
// step interval and the worm length follow, ends with the call. A check that
// poses only through the helpers therefore never calls `reconcile` itself; a
// check that poses with `h.debug.set…` directly calls it once before its first
// read or sweep.
//
// THE MACHINERY THAT DOES THAT IS NOT WIREWORM'S. The canvas and its
// draw-command recorder, the debug surface and the stand-in for a missing one,
// the driven frame and the `until` sweep, the key events, the cue stamping, the
// host that serves the seeded art to the engine's loader, and the evidence a
// review item's output is written from — every engine-backed case needs exactly
// that, and it lives once, in `@clockwyrks/case-harness`, staged beside this
// file as `./case-harness/`. What is left HERE is what is genuinely Wireworm's:
// its snapshot and surface types, its tick vocabulary, the pointer event this
// game's menus are driven by, the seeded-sprite comparison its `specs/assets.md`
// requires, and every scenario helper that poses this board.
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
// arranged, and it is the seam the case's specification documents.
// `surface.ts` is that specification as types, and it is the only description
// of the surface this harness reads: the build's own module for it is never
// imported.
//
// WHERE THE SURFACE COMES FROM. Off `engine.debug`, never built here. The game
// instance's `initialize` returns it, the engine holds that same object, and
// reading it back off the engine is the only way a surface reaches a check —
// so a build that returned no surface, or a surface missing an operation, fails
// the checks that reach the game through it, at the moment a check first
// reaches for an operation and never in the `beforeEach` that built the harness.
//
// HOW THE SURFACE IS DRIVEN. Directly, and immediately: under this engine a
// pose acts on the live game at the moment of the call and a reading is built
// at the call (specs/instrumentation.md), so a scenario poses and then reads
// with no frame in between. That is the package's `identityDriver` — the object
// the build returned, untouched. A frame is advanced when the check wants the
// game to RUN — a worm to step, a bolt to travel, a render to happen.
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
// (instrumentation/render-free-core) builds its own harnesses with clocks of
// its own.
//
// SPRITES, HEADLESS. The suite runs in `node`, where `fetch` and
// `createImageBitmap` do not exist, and the game loads its seeded art inside
// `initialize`. Both globals are stood up over the workspace's own `assets/`
// tree when this module loads, through the package's asset host, so every
// build's art arrives exactly as it does in a browser.

import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ConstantClock,
  createEngine,
  type Clock,
  type Engine,
  type GameDefinition,
  type GameInstance,
  type GameState,
  type PointerButton,
  type PointerDevice,
  type SurfaceMetrics,
  type World,
} from "@clockwyrks/structured-2d";
import {
  createEngineCaseHarness,
  identityDriver,
  installAssetHost,
  type AssetFailure,
  type EngineHarness,
  type EngineHarnessOptions,
  type EngineViewport,
  type TimedCue,
  type UntilOptions,
  type UntilResult as BaseUntilResult,
} from "./case-harness/engine/index";
import {
  allInLogical,
  canvasPixels,
  makeReplayCapture,
  pixelsChanged,
  sampleColor as clusterSample,
} from "./case-harness/engine/2d";
import {
  callsTo,
  setsOf,
  type DrawCall as RecordedCall,
  type TextGeometry,
} from "./case-harness/draw-calls";
import {
  drawnText,
  drawnTextLines,
  drawnTextRuns,
  textDraws,
  type TextDraw,
} from "./case-harness/text";
import { colorDistance, type Rgb } from "./case-harness/color";
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
  Edge,
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
  Edge,
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

/* The readings the package already carries, under the names this suite says. */
export { canvasPixels, colorDistance, drawnText, pixelsChanged };
export type { AssetFailure, Rgb, TimedCue, UntilOptions };

/** What a sweep found: whether the predicate ever held, and where it stopped. */
export type UntilResult = BaseUntilResult<WirewormSnapshot>;

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

/** The engine this project's checks run the build on. */
export type WirewormEngine = Engine<WirewormSurface>;

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

/**
 * Frames of the default clock covering `duration` seconds, ROUNDED to whole.
 *
 * ROUNDED, NOT ROUNDED UP, which is where this parts company with the package's
 * `ticksFor` and the reason it is stated here rather than taken off the kit.
 * Every duration this suite drives is stated in seconds and read back in frames,
 * and a product like `0.15 * 120` lands a fraction of an ulp either side of
 * `18` — which `Math.ceil` turns into a nineteenth frame and a step no check
 * asked for. `simple-2d`'s harness rounds UP for the opposite reason: its holds
 * are stated as "at least this long". Two spellings of one word, and each suite
 * reads the one its figures were taken under.
 */
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
 * because it has to name the same directory wherever the suite is run from, and
 * it must never come from the package's own module — that is staged one
 * directory deeper, and every replay and still would land one level too far
 * down, silently, because a writer that raised would be blaming the build for
 * the host's problem.
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
 * imported it. Nothing takes it back down; a worker that simply exits leaves it
 * standing, which is what it is for.
 *
 * `roots` is the repository root and nothing else, because specs/assets.md
 * seeds every frame under `assets/` at that root: a build has no say in where
 * the art lives, so there is no second place to look. `onMissing: "upstream"`
 * hands a relative URL no root carries to the platform's own `fetch`, which
 * then rejects it — exactly as a missing file does in a browser, and the engine
 * reports it on `asset:failed`, which the harness collects into
 * {@link EngineHarness.assetFailures}. `nameImageBitmap` is off, because nothing
 * in this process has ever carried a global `ImageBitmap` and naming one would
 * change what the engine's own recorder writes into a replay.
 */
installAssetHost({
  workspaceRoot: WORKSPACE,
  roots: ["."],
  onMissing: "upstream",
  images: true,
  nameImageBitmap: false,
  label: "wireworm",
});

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
/* What a frame drew                                                          */
/* -------------------------------------------------------------------------- */

/**
 * A 2D affine transform, as the context held it at the moment of a call.
 *
 * WIREWORM'S OWN SHAPE, and deliberately not the package's. `./case-harness/
 * matrix`'s `Matrix` is the canvas's `[a, b, c, d, e, f]` TUPLE; this suite's
 * checks read `m.a`, `m.b`, `m.c` and `m.d` off a named record, and the two are
 * the same six numbers under two spellings. Folding them would have rewritten
 * every rendering check's arithmetic for nothing, so the case keeps its own
 * name and {@link matrixOf} is the one place the two meet.
 */
export interface Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

/** The context's own live transform, as this suite reads one. */
function matrixOf(m: Matrix): Matrix {
  return { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f };
}

/**
 * One recorded operation on the 2D context, in the order the render made it.
 *
 * The package's recorded call, plus the one field this case adds to it:
 * {@link Matrix} `transform`, carried on a `drawImage`, because a build draws a
 * leftward worm or corruptor by flipping the horizontal axis about the sprite's
 * center (specs/assets.md) — the destination rectangle a mirrored call carries
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

/**
 * Stamp the transform in force onto every `drawImage` as the recorder records
 * it.
 *
 * TAKEN FROM THE CONTEXT, NEVER RECONSTRUCTED. The package's recorder keeps the
 * transform at a TEXT call (that is what `recorder: { measureText: true }`
 * buys) and leaves a `drawImage` carrying its arguments alone, on the reading
 * that a walk of the operation list recovers the transform — which it does,
 * right up until a build issues something the walk cannot see through, such as
 * a `reset` or a `canvas.width` assignment. Wireworm's rendering points turn on
 * exactly that matrix: `specs/assets.md` requires the cursor's frame drawn
 * UPRIGHT and a leftward worm drawn MIRRORED, and both readings are the matrix
 * the draw was made under. So it is read off the real context, which is what
 * this harness has always done and what a walk can only approximate.
 *
 * The recorder appends through the log's own `push` and does so BEFORE it
 * applies the call to the context, so a stamp taken here is taken at the moment
 * of the call, before anything the call itself could change. Wrapping `push` is
 * the same seam the package's own `boundDrawLog` uses, and this wraps whatever
 * is installed at the moment it runs, so the two compose in either order.
 */
function stampTransforms(calls: RecordedCall[], ctx: SKRSContext2D): void {
  const append = calls.push.bind(calls) as (...items: RecordedCall[]) => number;
  Object.defineProperty(calls, "push", {
    value: (...items: RecordedCall[]): number => {
      for (const item of items) {
        if (item.kind === "call" && item.method === "drawImage") {
          (item as { transform?: Matrix }).transform = matrixOf(
            ctx.getTransform(),
          );
        }
      }
      return append(...items);
    },
    writable: true,
    configurable: true,
    enumerable: false,
  });
}

/** Every argument list `method` was called with, and every value `property` took. */
export { callsTo, setsOf };

/* -------------------------------------------------------------------------- */
/* What the build owes                                                        */
/* -------------------------------------------------------------------------- */

/**
 * What the build owes when its surface is missing: the `Expected:` line of the
 * failure every check that reaches for the surface lands on, beside what
 * `engine.debug` was found holding instead.
 *
 * The case's own sentence rather than the package's, because how the surface
 * reaches the engine is phrased differently by the two state models, and a
 * fault that misdescribed the return would send a reviewer to the wrong line of
 * the build.
 */
const SURFACE_REQUIREMENT =
  "the debug surface src/game.ts's instance returns from initialize, which " +
  "the engine hands back from engine.debug (specs/instrumentation.md)";

/* -------------------------------------------------------------------------- */
/* The pointer, as the engine is delivered one                                */
/* -------------------------------------------------------------------------- */
//
// The menus take a mouse and a finger as well as the keyboard (`specs/ui.md`),
// and the engine reads both off the same pointer-event stream on the target the
// `surface` option supplies. This suite runs over a canvas with no document
// behind it, so there is no `PointerEvent` constructor to call and no element to
// dispatch from: the engine narrows structurally, reading `clientX`, `clientY`,
// `pointerId`, `pointerType`, `isPrimary`, `button` and `buttons` off whatever
// arrives, so an event carrying those drives the pointer exactly as a hand does.
//
// NEITHER OF THE PACKAGE'S TWO EVENTS IS THIS ONE, and the whole pointer layer
// stays with the case because of it. `PointerPositionEvent` carries a position
// alone, so a check could not tell a finger from a mouse — and `specs/ui.md`
// gives a touch contact a rule of its own, because a finger does not hover.
// `DevicePointerEvent` names a device but fixes its own buttons: the primary
// button on every press and move and none on a release. Wireworm's menus are
// driven with a NAMED button and a held-button mask kept exactly as a browser
// keeps one, so a drag reports the button still down and a check may press a
// secondary button and read that the build ignored it. The event below is that
// third shape, and the gestures around it are this case's.

/** The three pointer events the engine listens for. */
type PointerEventName = "pointerdown" | "pointermove" | "pointerup";

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
 *
 * The CAMERA is deliberately not in this map, where {@link EngineHarness.device}
 * has it: a menu region comes back from `menuItemRect` in the stage's logical
 * units, which is the space the engine's own pointer input maps a client point
 * into, so a gesture aimed at one goes out the way it came in.
 */
function toClient(
  view: EngineViewport,
  dpr: number,
  x: number,
  y: number,
): { x: number; y: number } {
  return {
    x: (view.offsetX + x * view.scale) / dpr,
    y: (view.offsetY + y * view.scale) / dpr,
  };
}

/* -------------------------------------------------------------------------- */
/* The harness                                                                */
/* -------------------------------------------------------------------------- */

/** How a window is asked for. The clock is what a step-size check varies. */
export type HarnessOptions = EngineHarnessOptions;

/** Everything this case's harness carries past the package's neutral contract. */
export interface WirewormExtras {
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

  /** Run whole frames covering `duration` seconds of game time. */
  advanceSeconds(duration: number): Promise<void>;
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
}

/**
 * Everything a check reads off one engine running one build.
 *
 * The package's engine harness — the driven frame, the sweep, the canvas and its
 * recorder, the cues, the keys, the pixel readings — bound to Wireworm's
 * snapshot, Wireworm's surface and Wireworm's engine, with the members that are
 * genuinely this case's laid over it.
 */
export type Harness = EngineHarness<
  WirewormSnapshot,
  WirewormDriver,
  WirewormEngine
> &
  WirewormExtras;

/**
 * The package's engine machinery, bound to Wireworm on this engine.
 *
 * The recorder is asked to MEASURE TEXT and never to INTERN IMAGES. The
 * measurement is what gives a text draw the extent `screens/title-highlight` and
 * the HUD points read it through; interning would replace the bitmap in the
 * record with a reference naming it, and every sprite point in this project
 * identifies a frame by comparing the SOURCE ITSELF against the seeded PNGs
 * ({@link nearestSeededFrame}), so the source has to arrive as the source.
 *
 * `toLogical` is the camera. The camera opens at the defaults — world and
 * logical coordinates coincide, which is the space every figure the specs state
 * is stated in — so the projection is the identity unless the build moved it,
 * and mapping through it keeps `device` and `pixel` honest either way.
 *
 * `pointerEvent` is left alone: this case drives its own pointer, for the
 * reasons stated where {@link PointerEventShim} is declared, and the kit's
 * `h.pointer` is not what any check here calls.
 */
const kit = createEngineCaseHarness<
  WirewormSnapshot,
  WirewormDriver,
  WirewormEngine,
  WirewormExtras
>({
  slug: "wireworm",
  projectRoot: PROJECT_ROOT,
  stage: { width: STAGE_W, height: STAGE_H },
  tickHz: TICK_HZ,
  surfaceRequirement: SURFACE_REQUIREMENT,
  recorder: { measureText: true },
  defaultClock: () => new ConstantClock(TICK_MS),
  createEngine: ({ canvas, clock, surface }) =>
    createEngine<WirewormSurface>({
      canvas,
      width: STAGE_W,
      height: STAGE_H,
      game,
      // The build's own stage background, handed to the engine exactly as the
      // seeded `src/main.ts` hands it (specs/overview.md).
      background: BACKGROUND,
      layout: LAYOUT,
      clock: clock as Clock,
      surface: surface as SurfaceMetrics,
    }),
  driver: (_engine, raw) => identityDriver(raw as WirewormSurface),
  snapshot: (debug) => debug.snapshot(),
  toLogical: (engine, x, y) => engine.world.camera.worldToLogical({ x, y }),
  extend: (base, engine, initialized) => {
    /**
     * The buttons each pointer id currently holds, kept exactly as a browser
     * keeps them: a press adds one, a release drops one, and every event reports
     * the set as it stands once the event has been applied. Without it a move
     * issued in the middle of a drag would report no button held, and the engine
     * would read the contact as no longer down.
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
      options: PointerOptions,
    ): void => {
      const id = options.id ?? 1;
      const point = toClient(base.viewport(), base.shape.dpr, x, y);
      base.events.dispatchEvent(
        new PointerEventShim(type, {
          clientX: point.x,
          clientY: point.y,
          pointerId: id,
          pointerType: options.device ?? "mouse",
          isPrimary: options.primary ?? true,
          button,
          buttons: buttonMask(buttonsOf(id)),
        }),
      );
    };

    /** The frames a pointer helper runs so the build sees what it dispatched. */
    const deliver = (options: PointerOptions): Promise<void> =>
      base.advance(options.frames ?? 1);

    return {
      get world() {
        return engine.world;
      },
      get state() {
        return engine.world.state;
      },
      instance: initialized as GameInstance<WirewormSurface>,

      advanceSeconds: (duration) => base.advance(ticksFor(duration)),

      async movePointer(x, y, options = {}) {
        // `-1` is what a browser puts in `button` for an event about position.
        dispatchPointer("pointermove", x, y, -1, options);
        await deliver(options);
      },
      async pressPointer(x, y, options = {}) {
        const button = options.button ?? "primary";
        buttonsOf(options.id ?? 1).add(button);
        dispatchPointer("pointerdown", x, y, buttonIndexOf(button), options);
        await deliver(options);
      },
      async releasePointer(x, y, options = {}) {
        const button = options.button ?? "primary";
        buttonsOf(options.id ?? 1).delete(button);
        dispatchPointer("pointerup", x, y, buttonIndexOf(button), options);
        await deliver(options);
      },
      async tapPointer(x, y, options = {}) {
        const button = options.button ?? "primary";
        const id = options.id ?? 1;
        buttonsOf(id).add(button);
        dispatchPointer("pointerdown", x, y, buttonIndexOf(button), options);
        buttonsOf(id).delete(button);
        dispatchPointer("pointerup", x, y, buttonIndexOf(button), options);
        await deliver(options);
      },
    };
  },
});

/** Seconds of simulated time in `ticks` frames of the default clock. */
export const seconds = kit.seconds;

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
 *
 * ARM IT NARROWLY IN THIS CASE. A live discharge re-jitters its lightning every
 * frame, so those polylines are a fresh operation each time and nothing in them
 * ever dedupes; a recording that spans a whole scenario as well as the
 * detonation it is about grows fast against the recorder's own capture budget,
 * past which a new image records as an opaque marker.
 */
export const captureReplay = makeReplayCapture("wireworm", PROJECT_ROOT);

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
 * media directory is unset and this is a no-op.
 */
export const captureStill = kit.captureStill;

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
  const h = await kit.createHarness(options);
  stampTransforms(h.calls, h.ctx);
  return h;
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
 * `reset()`: the title screen, every declared field at its title-screen value.
 * Every suite's opening move.
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
 * `reset()` for the title screen, then `confirm` on the title's highlighted
 * first item, `DESCEND`, which is what opens a run (specs/ui.md) — and a run
 * opens with the fresh scatter specs/nodes.md lays (specs/progression.md,
 * Starting a run). No pose on the surface starts a run, and there is not meant
 * to be one: the field is laid by the path the menu takes, and that path is
 * what a check about the starting field is about. Each run opened is a fresh
 * draw of that scatter.
 *
 * One frame runs, the frame that delivers the key's edge. A run opens on its
 * `banner` phase, so the level's worm has not entered and level 1 spawns no
 * foe, and what stands on the board when this returns is the starting field
 * alone.
 */
export async function startRun(h: Harness): Promise<void> {
  resetTo(h);
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
 * No frame is advanced: every pose here lands at the call.
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
  // The level is posed above and the step interval and the worm length follow
  // it, so the readings are brought into agreement before the caller reads them.
  h.debug.reconcile();
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
 * The rendered colour at a logical point, averaged over a small cluster.
 *
 * The centre pixel plus four neighbours 4 units out — well inside a 32-unit tile
 * and inside the 24-unit body a foe or a node is drawn as — so one stray
 * anti-aliased or glow pixel cannot swing the reading. The package takes the
 * radius from its caller for exactly that reason, and four is the radius every
 * reading in this project was taken at.
 */
export function sampleColor(h: Harness, x: number, y: number): Rgb {
  return clusterSample(h, x, y, 4);
}

/** The rendered colour at the centre of tile `(c, r)`. */
export function sampleTile(h: Harness, c: number, r: number): Rgb {
  const { x, y } = tileCenter(c, r);
  return sampleColor(h, x, y);
}

/* -------------------------------------------------------------------------- */
/* Reading one frame's render                                                 */
/* -------------------------------------------------------------------------- */
//
// Copy is read through the shared harness's `drewText` (`case-harness/text`),
// which the screen suites import directly: a substring of the logical runs a
// frame spells, ignoring case, so a letter-spaced heading and a menu entry drawn
// beside its marker both read as the words they show. The text readers below
// are the readings this case needs beyond it.

/**
 * Every string the frame drew, BOTH as the calls split it and as the logical
 * runs those calls spell.
 *
 * For the readers that hold a word or a figure to a boundary on both sides —
 * the how-to screen's key names, the end screens' score — where neither reading
 * alone is enough. A figure letter-spaced a digit per call is whole only in the
 * run it spells, and a label drawn one space clear of its figure is bounded only
 * in the call that drew the figure, because a gap that narrow joins the two into
 * one run. The union can only add a match: every raw string is still here, and
 * every run is a superstring of the calls that spelled it.
 */
export function drawnTextForms(calls: readonly DrawCall[]): string[] {
  return [...drawnText(calls), ...drawnTextLines(calls)];
}

/**
 * The geometry calls a frame made, by name.
 *
 * Enough of a count to compare two frames of the same scene: a frame that drew a
 * discharge asked for strictly more of these than the same frame with the arcs
 * gone, whatever shape the build chose to draw them as.
 *
 * WIREWORM'S OWN LIST, over the package's `DRAW_METHODS`. The package's carries
 * `putImageData` as well, and this one deliberately does not: nothing in this
 * game blits raw pixel data, and a list that named an operation the reference
 * never issues would count something no check here means to count.
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
 * WIREWORM'S OWN, over the package's `drawnPoints`. That reading maps each point
 * through the transform in force at the call, which answers in CANVAS pixels;
 * this one answers in the space the call was issued in, which under this
 * engine's pipeline is the game's own. The two agree only where the pipeline's
 * transform is the identity, so they are different readings and both keep their
 * own name.
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
 * flipped space. The transform stamped beside the call is what maps it back, so
 * a mirrored sprite and an upright one both report the centre they were drawn
 * on and the mirrored one reports `mirrored`.
 *
 * THE CASE'S OWN WALK, over the package's `imageDraws`. That reading identifies
 * a source by the reference the recorder INTERNS for it, and this project's
 * sprite points compare the SOURCE ITSELF against the seeded PNGs, so the bitmap
 * has to reach a check untouched — which is why the recorder is asked not to
 * intern.
 *
 * The three-argument form takes its size from the source's own dimensions, which
 * is what the canvas does with it.
 */
export function drawnImages(h: Harness): DrawnImage[] {
  const view = h.viewport();
  const images: DrawnImage[] = [];
  for (const call of h.calls as readonly DrawCall[]) {
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
export type TextSpan = TextDraw;

/**
 * Every run of text the frame drew, placed in logical units, ONE PER CALL.
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
 *
 * The package's reading answers in CANVAS pixels, because that is where the
 * calls were made, so it is taken back through the engine's own fit into the
 * logical units every figure this suite states is stated in.
 */
export function drawnTextSpans(h: Harness): TextSpan[] {
  return allInLogical(h.viewport(), textDraws(h.calls));
}

/**
 * Every LOGICAL RUN of text the frame drew, placed in logical units.
 *
 * {@link drawnTextSpans} is one span per call, which is the reading for a check
 * that holds each draw's own extent. A build that letter-spaces a menu item or
 * a HUD label draws a glyph per call, so a check that has to FIND the text
 * carrying some copy before it can place it reads these as well: the shared
 * harness's merge rule (`case-harness/text.ts`) folds side-by-side draws on one
 * baseline back into the string they spell, and a run keeps the placement of
 * its first draw and spans its glyphs' extent. The rule is decided in the
 * canvas's own pixels, where the calls were made — the recorder stamps the
 * transform in force beside every text call, the engine's fit included — and
 * the runs are taken back through that fit into logical units here exactly as
 * the spans are.
 */
export function drawnTextRunSpans(h: Harness): TextSpan[] {
  return allInLogical(h.viewport(), drawnTextRuns(h.calls));
}

/**
 * Every span of text the frame drew, BOTH as the calls split it and as the runs
 * those calls spell: the placed counterpart of {@link drawnTextForms}.
 *
 * For the reader that locates copy on the frame — the row a menu item sits on,
 * the label a readout's digits must sit beside, the readout that must sit
 * inside the bar. A span holds the copy whole only if the build drew it in one
 * call, and a run only if the run did not swallow a boundary the reader holds,
 * so neither alone is enough and the union can only add a match. A run of one
 * draw is that draw, and is listed once.
 */
export function drawnTextSpanForms(h: Harness): TextSpan[] {
  const spans = drawnTextSpans(h);
  const runs = drawnTextRunSpans(h).filter(
    (run) => !spans.some((span) => sameSpan(span, run)),
  );
  return [...spans, ...runs];
}

/** How far apart two placements of one draw may read, in logical units. */
const SAME_SPAN_SLACK = 1e-3;

/** Whether two spans are one draw read twice: the same text at the same place. */
function sameSpan(a: TextSpan, b: TextSpan): boolean {
  return (
    a.text === b.text &&
    Math.abs(a.y - b.y) <= SAME_SPAN_SLACK &&
    Math.abs(a.left - b.left) <= SAME_SPAN_SLACK &&
    Math.abs(a.right - b.right) <= SAME_SPAN_SLACK
  );
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
