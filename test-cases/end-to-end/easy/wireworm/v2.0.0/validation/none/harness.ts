// Wireworm — the case's half of the validator harness. CASE-PROVIDED.
//
// Every check in this suite is an ordinary vitest test that drives the built site
// IN A REAL BROWSER. There is nothing to import: an engineless run seeds no
// `src/` at all, so the build wrote its own frame loop, its own canvas fit, its
// own keyboard, its own audio, its own sprite loading, and its own
// `window.__wireworm` — and the only place any of that exists is a page that has
// loaded the bundle. So the project serves `dist/`, loads it in Chromium, and
// reaches the game the way anything reaches it: over the surface
// `specs/instrumentation.md` told the build to install.
//
// IT IS STILL A VITEST PROJECT, AND THAT IS DELIBERATE. The runner locates the
// build output before it chooses between the vitest and browser paths, so `dist/`
// is on disk by the time this project runs. Staying a vitest project is what lets
// the case name ONE script per review item and have it resolve under all three
// engines — `validation/worm/winds-horizontal.test.ts` is the same path whichever
// engine the run selected — and what keeps `format = 2` resolution passing.
//
// THE MACHINERY THAT DRIVES THE PAGE IS NOT WIREWORM'S. Serving the build,
// connecting to the one browser, opening a page per harness, injecting the
// draw-command recorder and the audio probe, bracketing each driven frame around
// one step of the build's surface, driving the real mouse and the real finger,
// reading pixels and draw calls back out, and writing the evidence a review point
// declares — every engineless case needs exactly that, and it lives once, in
// `@clockwyrks/case-harness`, staged beside this file as `./case-harness/`.
// What is left here is what is genuinely Wireworm's: the shape of its snapshot,
// the operations its `specs/instrumentation.md` requires, the seeded sprite art
// its `specs/assets.md` requires a build to draw from, and the scenarios its
// checks are posed from.
//
// The seam is one call. `createCaseHarness` takes the case's TYPES as type
// arguments and the case's VALUES as one object, and hands back the machinery
// with Wireworm's names and Wireworm's types on it — so the suites next door go
// on importing `createHarness`, `captureReplay`, `captureStill` and `watchCues`
// from `../harness` exactly as they did, and none of them can tell the
// difference.
//
// WHAT A CHECK READS. The game's own state (through `window.__wireworm`'s
// `snapshot`), the frames the harness itself drove, the operations the build
// issued against its 2D context, the bitmaps it handed those operations, the
// pixels they left on the canvas, and the sounds it emitted. Nothing here
// fabricates an outcome: the scenario helpers below only ARRANGE the board
// through the surface, and the real update the build wrote is what runs from
// there.
//
// THE HARNESS OWNS EVERY COMPOUND SEQUENCE. The debug surface is atomic by
// design — each operation sets one field, reads the state, or moves the clock
// (`guides/authoring/writing-debug-apis-and-validators.md`) — so "open a run at
// level 3 with the field cleared" is a helper here, built out of those atomic
// operations, and never an operation on the surface. A check that needs only
// part of a sequence calls the operations it needs: nothing a check does not ask
// for happens.
//
// AND THE HELPERS FIX GEOMETRY, NEVER THRESHOLDS. A helper poses a board, drives
// a scenario, or reads a value out of a snapshot. Every tolerance a check
// asserts — a percentage, a colour distance, a number of units — is stated in
// that check, next to the figure `specs/` fixes for it, because a helper that
// carried the tolerance would hide what the check is really asserting. Look for
// a threshold in this file and you will not find one.
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
// THE CLOCK IS THE SURFACE'S. Nothing outside an engineless build owns its loop,
// so `specs/instrumentation.md` puts the clock on the surface: `setAutoStep(false)`
// takes the game off real time and `advance(seconds, frames)` runs whole frames
// of a chosen length. Every harness opens by taking the game off the clock, so a
// check asks for a number of frames and gets exactly that number — no polling, no
// waiting, and no measurement of the machine it ran on. Nothing here hands the
// loop back: a check that could only be decided by real time passing would
// grade the host it ran on, so no point asks for one.
//
// EVERYTHING CROSSING INTO THE PAGE IS ASYNC. That is the whole of the difference
// between a suite here and its counterpart under an engine: `await h.snapshot()`
// rather than `h.snapshot()`, `await h.debug.setNode(...)` rather than
// `h.debug.setNode(...)`. The scenarios, the tolerances, and the assertions are
// the same ones, because they are the case's rather than the runtime's.

import { createCanvas, loadImage } from "@napi-rs/canvas";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  IDENTITY,
  apply,
  createCaseHarness,
  drawnText,
  drawnTextLines,
  drawnTextRuns,
  imageRef,
  luminance,
  mouseGlide,
  mousePress,
  mouseRelease,
  sampleColor as clusterSample,
  touchGlide,
  touchPress,
  touchRelease,
  textDraws,
  transformed,
  type DrawCall,
  type Harness as BaseHarness,
  type HarnessOptions,
  type Matrix,
  type Rgb,
  type TextDraw,
  type UntilOptions,
  type UntilResult as BaseUntilResult,
} from "./case-harness/index";
import { fail } from "./assert";
import {
  BAND_CX,
  BAND_CY,
  OVERLAY_KEY,
  SPRITE_SHEETS,
  STAGE_H,
  STAGE_W,
  UNBOUND_KEY,
  colAt,
  rowAt,
  tileCX,
  tileCY,
  wormStepInterval,
  type SheetName,
} from "./constants";

/* What the machinery already answers, under the names this project uses. */
export {
  ConstantClock,
  JitterClock,
  SequenceClock,
  closeWorkerBrowser,
  colorDistance,
  drawOps,
  drawnPoints,
  drawnText,
  drawnTextLines,
  drawnTextRuns,
  imageDraws,
  imageRef,
  luminance,
  mouseGlide as mouseTo,
  mousePress,
  mouseRelease,
  retable,
  textDraws,
  thinReplay,
  touchGlide,
  touchPress,
  touchRelease,
  DRAW_METHODS,
  MAX_REPLAY_FRAMES,
  DEFAULT_REPLAY_BACKGROUND as REPLAY_BACKGROUND,
} from "./case-harness/index";

export type {
  Clock,
  DrawCall,
  HarnessOptions,
  ImageDraw,
  ImageRef,
  Matrix,
  Point,
  RecordedOp,
  RecordedState,
  Recording,
  Rgb,
  TextDraw,
  TimedCue,
  UntilOptions,
  Viewport,
} from "./case-harness/index";

/* -------------------------------------------------------------------------- */
/* The contract the build owes                                                */
/* -------------------------------------------------------------------------- */

/** The handle an engineless build installs its surface on. */
export const HANDLE = "__wireworm";

/** The version the surface reports (`WIREWORM_DEBUG_VERSION`). */
export const WIREWORM_DEBUG_VERSION = 1;

/**
 * Every operation `specs/instrumentation.md` requires on the surface under this
 * engine, including the two clock operations that exist only here.
 *
 * The list is the whole of it, in the order the specification states them, so
 * `instrumentation/surface-present` can assert completeness by naming this one
 * constant and a build missing anything is named for exactly what it is missing.
 */
export const REQUIRED_OPS = [
  // The clock (this engine alone).
  "setAutoStep",
  "advance",
  // The core.
  "reset",
  "snapshot",
  "reconcile",
  // The screen and the run.
  "setScreen",
  "setPhase",
  "setPhaseTimer",
  "setMenuIndex",
  "setScore",
  "setLives",
  "setLevel",
  "setReachedLevel",
  "menuItemRect",
  // The world gates.
  "setFoeSpawning",
  "setWormEntry",
  "setCursorContact",
  // The level's draws.
  "setSpawnTimer",
  "setNextFoeEntry",
  "setNextWormEntry",
  // The cursor and its bolts.
  "setCursor",
  "setCursorInvulnerable",
  "setFireCooldown",
  "addBolt",
  "removeBolt",
  "clearBolts",
  // The node field.
  "setNode",
  "clearNode",
  "clearNodes",
  // The worms.
  "addWorm",
  "appendSegment",
  "setWormHeading",
  "setWormDescent",
  "setWormDiving",
  "setWormStepping",
  "setWormBody",
  "removeWorm",
  "clearWorms",
  // The foes.
  "addFoe",
  "setFoeVelocity",
  "setFoeHit",
  "setFoeMind",
  "setFoeTravel",
  "removeFoe",
  "clearFoes",
] as const;

/** The six screens the game moves between (`specs/ui.md`). */
export type Screen =
  | "title"
  | "howto"
  | "playing"
  | "paused"
  | "victory"
  | "gameover";

/** The three sub-phases of the `playing` screen (`specs/progression.md`). */
export type Phase = "banner" | "active" | "respawn";

/** The three support foes (`specs/foes.md`). */
export type FoeKind = "glitch" | "dropper" | "corruptor";

/** The two side edges the level's worm and its edge-entering foes come in at. */
export type Edge = "left" | "right";

/** One tile of the board. */
export interface Tile {
  c: number;
  r: number;
}

/** One node, as a snapshot reports it. */
export interface NodeView {
  c: number;
  r: number;
  charge: number;
}

/** One worm, as a snapshot reports it. `segments[0]` is the head. */
export interface WormView {
  id: number;
  segments: Tile[];
  /** `+1` right, `-1` left. */
  dh: number;
  /** `+1` down, `-1` up. */
  dv: number;
  diving: boolean;
  stepping: boolean;
  body: boolean;
}

/** One foe, as a snapshot reports it. `x`/`y` is its CENTER. */
export interface FoeView {
  id: number;
  kind: FoeKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hit: boolean;
  mind: boolean;
  travel: boolean;
}

/** One bolt in flight, as a snapshot reports it. `x`/`y` is its CENTER. */
export interface BoltView {
  id: number;
  x: number;
  y: number;
}

/** One conducted link of a live discharge: the two tiles it joined. */
export interface ArcView {
  from: Tile;
  to: Tile;
}

/**
 * The state a snapshot reports, exactly as `specs/instrumentation.md` shapes it.
 *
 * Every field an operation can set is here, which is what makes every pose
 * verifiable by set-then-read. `muted` is the exception in the other direction:
 * no operation sets it, and it is a live read of the runtime's own mute bit,
 * reached the way a player reaches it through `KeyM`.
 */
export interface WirewormSnapshot {
  version: number;
  screen: Screen;
  phase: Phase;
  phaseTimer: number;
  menuIndex: number;
  score: number;
  lives: number;
  level: number;
  reachedLevel: number;
  muted: boolean;
  foeSpawning: boolean;
  wormEntry: boolean;
  /** The level's spawner clocks, in seconds left (`specs/foes.md`). */
  glitchTimer: number;
  dropperTimer: number;
  corruptorTimer: number;
  /** The posed draws, each `null` until posed and again once consumed. */
  nextWormEntry: Edge | null;
  nextGlitchEntry: Tile | null;
  nextDropperEntry: Tile | null;
  nextCorruptorEntry: Tile | null;
  wormStepInterval: number;
  wormLength: number;
  cursor: { x: number; y: number; invulnerable: number; contact: boolean };
  fireCooldown: number;
  nodes: NodeView[];
  worms: WormView[];
  foes: FoeView[];
  bolts: BoltView[];
  arcs: ArcView[];
  simTime: number;
}

/** The operations a check poses the game through. Every one crosses into the page. */
/**
 * A menu item's hit region, in the stage's logical units, as `menuItemRect`
 * reports it: `x` and `y` its top-left corner, `w` and `h` its size
 * (`specs/instrumentation.md`).
 */
export interface MenuRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WirewormDebugApi {
  setAutoStep(enabled: boolean): Promise<void>;
  advance(seconds: number, frames?: number): Promise<void>;
  reset(): Promise<void>;
  snapshot(): Promise<WirewormSnapshot>;
  reconcile(): Promise<void>;

  setScreen(screen: Screen): Promise<void>;
  setPhase(phase: Phase): Promise<void>;
  setPhaseTimer(seconds: number): Promise<void>;
  setMenuIndex(index: number): Promise<void>;
  setScore(score: number): Promise<void>;
  setLives(lives: number): Promise<void>;
  setLevel(level: number): Promise<void>;
  setReachedLevel(level: number): Promise<void>;
  menuItemRect(index: number): Promise<MenuRect | null>;

  setFoeSpawning(enabled: boolean): Promise<void>;
  setWormEntry(enabled: boolean): Promise<void>;
  setCursorContact(enabled: boolean): Promise<void>;

  setSpawnTimer(kind: FoeKind, seconds: number): Promise<void>;
  setNextFoeEntry(kind: FoeKind, c: number, r: number): Promise<void>;
  setNextWormEntry(edge: Edge): Promise<void>;

  setCursor(x: number, y: number): Promise<void>;
  setCursorInvulnerable(seconds: number): Promise<void>;
  setFireCooldown(seconds: number): Promise<void>;
  addBolt(x: number, y: number): Promise<void>;
  removeBolt(id: number): Promise<void>;
  clearBolts(): Promise<void>;

  setNode(c: number, r: number, charge: number): Promise<void>;
  clearNode(c: number, r: number): Promise<void>;
  clearNodes(): Promise<void>;

  addWorm(c: number, r: number): Promise<void>;
  appendSegment(id: number, c: number, r: number): Promise<void>;
  setWormHeading(id: number, dh: number): Promise<void>;
  setWormDescent(id: number, dv: number): Promise<void>;
  setWormDiving(id: number, diving: boolean): Promise<void>;
  setWormStepping(id: number, enabled: boolean): Promise<void>;
  setWormBody(id: number, enabled: boolean): Promise<void>;
  removeWorm(id: number): Promise<void>;
  clearWorms(): Promise<void>;

  addFoe(kind: FoeKind, x: number, y: number): Promise<void>;
  setFoeVelocity(id: number, vx: number, vy: number): Promise<void>;
  setFoeHit(id: number, hit: boolean): Promise<void>;
  setFoeMind(id: number, enabled: boolean): Promise<void>;
  setFoeTravel(id: number, enabled: boolean): Promise<void>;
  removeFoe(id: number): Promise<void>;
  clearFoes(): Promise<void>;
}

/* -------------------------------------------------------------------------- */
/* The harness, bound to this case                                            */
/* -------------------------------------------------------------------------- */
//
// THE STEP SCHEDULE. The suite chooses the size of a frame, because the
// specification deliberately fixes none: `specs/instrumentation.md` mandates no
// fixed timestep, every rate is per second and integrated against the elapsed
// time of the frame, and the one clocked quantity — the worm's tile step —
// accumulates that same elapsed time and carries its remainder. So a build must
// reach the same place however that time was divided, and the check that is ABOUT
// the division (`instrumentation/render-free-core`) drives the same second as
// one frame and as sixty.
//
// The default is a steady 100 Hz, for one reason: every duration `specs/` fixes
// is then a whole number of frames. `WORM_STEP_L1` 0.14 s is 14, `FIRE_INTERVAL`
// 0.15 s is 15, `GLITCH_DART_INTERVAL` and `ARC_LIFE` 0.32 s are 32,
// `BANNER_TIME` 1.3 s is 130, `RESPAWN_TIME` 1.4 s is 140, `RESPAWN_INVULN` 2 s
// is 200, and `DROPPER_CHECK_INTERVAL` 2.5 s is 250. A check therefore asks for
// a duration and gets it exactly, with no rounding of its own to explain.

/** This project's own directory, as the media writers address their outputs from. */
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * The workspace the build was produced in: this project's parent.
 *
 * Where the seeded sprite art lives (`assets/<folder>/<n>.png`), which is the one
 * thing outside the page this project reads. Derived from this file's own URL, so
 * it names the same place in both layouts the project lives in — the case's own
 * `validation/none/`, and the `validation/` the runner stages it to inside the
 * build's tree.
 */
export const WORKSPACE_ROOT = resolve(PROJECT_ROOT, "..");

/**
 * The shared harness, with Wireworm's snapshot, Wireworm's surface and
 * Wireworm's stage bound into it.
 *
 * `projectRoot` comes from THIS module and must never come from the package's:
 * the package is staged one directory deeper than this file, and a produced
 * replay or still is addressed by the running suite's path relative to the
 * project root. Taken from the package it would address every output one level
 * too deep — and silently, because a writer that raised on a failed write would
 * be blaming the build for the host's problem, so neither of them raises.
 */
const kit = createCaseHarness<WirewormSnapshot, WirewormDebugApi>({
  slug: "wireworm",
  handle: HANDLE,
  requiredOps: REQUIRED_OPS,
  // `advance(seconds, frames)`: a span of simulated time divided into whole
  // frames, so the suite's clock decides how long a frame is.
  step: { kind: "seconds-frames", op: "advance" },
  stage: { width: STAGE_W, height: STAGE_H },
  tickHz: 100,
  // A GENUINE browser gesture, so the build's audio can open: a build is free to
  // open its audio context from a real DOM event alone (both are conformant), so
  // a gesture delivered any other way would leave a perfectly good build silent.
  // `specs/controls.md` leaves this key bound to nothing, so arming changes no
  // game state.
  arm: { kind: "key", code: UNBOUND_KEY },
  // The text checks read where a run of copy SITS — the HUD readouts held clear
  // of one another, the title and its tagline centred, the menu items stacked —
  // so a text draw carries the width the context measured at it and the alignment
  // in force. Without this a text draw is the point its anchor names and every
  // extent reads as zero.
  measureText: true,
  // A build installs its surface while its entry module runs, so a page that has
  // fired `load` has either installed it already or is not going to, and the wait
  // returns the instant the global appears — a conformant build pays none of this
  // ceiling however high it is set. What the ceiling bounds is the cost of a
  // build that installs its surface later than `load` and then never gets there,
  // which every harness of that build pays once. Fifteen seconds rather than five
  // because this is a deadline on the HOST: the project holds four pages of one
  // browser open at once on a box that is also running a model's build, and a
  // ceiling close to what an idle machine costs fails a conformant build for the
  // load average.
  surfaceTimeoutMs: 15_000,
  projectRoot: PROJECT_ROOT,
});

export const {
  captureReplay,
  captureStill,
  watchCues,
  fitViewport,
  failSurface,
  SURFACE_REQUIREMENT,
  seconds,
  speedOverTicks: speedOverFrames,
  TICK_HZ,
  TICK_MS,
} = kit;

/**
 * Frames of the default clock covering `duration` seconds.
 *
 * ROUNDED, NOT ROUNDED UP, which is the package's `ticksFor` and the reason this
 * is stated here rather than taken from the kit. Every duration `specs/` fixes is
 * a whole number of frames at 100 Hz, and a product like `0.14 * 100` lands a
 * fraction of an ulp above `14` — which `Math.ceil` turns into fifteen frames and
 * a step the check never asked for.
 */
export function framesFor(duration: number): number {
  return Math.round(duration * TICK_HZ);
}

/**
 * Frames of the default clock that carry a worm at `level` through exactly
 * `steps` tile steps, and no further.
 *
 * The worm steps when its accumulator REACHES the level's interval
 * (`specs/worm.md`), so the number of steps a stretch of game time contains is
 * `floor(elapsed / interval)` — a quantity that is ambiguous by one at an exact
 * multiple of the interval, where a build's own accumulation of a hundred
 * floating-point deltas may land a whisker either side. This lands the drive
 * half an interval past the last step it wants, which is the furthest point from
 * both boundaries, so `steps` is what any conforming accumulator produces.
 *
 * This is geometry, not a tolerance: it says where in the step cycle the drive
 * stops, not how far a build may miss by. A check measuring the CADENCE itself
 * (`worm/step-cadence`) states its own tolerance on its own reading.
 */
export function framesForSteps(steps: number, level = 1): number {
  return Math.round((steps + 0.5) * wormStepInterval(level) * TICK_HZ);
}

/**
 * Everything a check reads off one page running this build, plus the one gesture
 * that is Wireworm's own.
 *
 * A bound alias of the shared harness's interface, so every
 * `import { type Harness } from "../harness"` next door goes on naming a harness
 * whose `snapshot()` is a {@link WirewormSnapshot} and whose `debug` is a
 * {@link WirewormDebugApi}.
 */
export type Harness = BaseHarness<WirewormSnapshot, WirewormDebugApi> & {
  /**
   * Give the build a real, browser-trusted gesture, so its audio can open.
   *
   * The package delivers the same gesture at the moment a harness is BUILT, for
   * the case that asks for one there. Wireworm's audio points arm in the middle
   * of their arrangement instead — after the board is posed and before the cues
   * are watched — because what each of them reads is the sounds one scenario
   * made, and a gesture delivered before the pose would be counted against a
   * board that did not exist yet. It is safe at any moment for the same reason
   * it is safe at that one: `specs/controls.md` binds this key to nothing.
   */
  armAudio(): Promise<void>;
};

/** What a sweep found: whether the predicate ever held, and where it stopped. */
export type UntilResult = BaseUntilResult<WirewormSnapshot>;

/**
 * Open a page on the build and take the game off its own clock.
 *
 * The kit's harness with {@link Harness.armAudio} laid over it. Spread rather
 * than wrapped member by member: the cue sinks a `watchCues` attaches to travel
 * with the object, which is what makes a watcher opened on this one fill.
 */
export async function createHarness(
  options: HarnessOptions = {},
): Promise<Harness> {
  const base = await kit.createHarness(options);
  return {
    ...base,
    async armAudio() {
      await base.page.keyboard.press(UNBOUND_KEY);
    },
  };
}

/* -------------------------------------------------------------------------- */
/* The seeded sprite art                                                      */
/* -------------------------------------------------------------------------- */
//
// `specs/assets.md` seeds six folders under `assets/` and requires that the node,
// the worm, the cursor and the three foes are each drawn FROM that folder rather
// than from art of the build's own. What that requires is identity — the bitmap
// handed to a draw IS a seeded frame — so the reading is the bitmap, not the
// pixels it left on the stage: a build is free to tint, scale or glow what it
// blits, and a stage sample would grade the tint rather than the art.
//
// BOTH SIDES OF THE COMPARISON COME OFF THE SHARED RECORDER NOW. The recorder
// gives every bitmap a page identity, and the harness hands back that source's
// own pixels at its natural size (`h.imagePixels`), so the drawn side is read
// through the same channel every other engineless case reads its images through
// and this project keeps no private decode path beside it. What is still read off
// disk is the OTHER side: the frames the case itself seeded, which no build ever
// hands to a draw and which nothing in the page has ever seen.
//
// WHY THERE IS NO `fetch` SHIM HERE. Under an engine, a validator runs the
// build's own module in this node process and the engine's loader reaches for
// `fetch` and `createImageBitmap`, so those two globals have to be stood up over
// the workspace's `assets/` tree. Under THIS engine nothing of the sort happens:
// the build loads its own art in the page, where both globals are the browser's
// real ones. Shimming a global here would stand in for a call nothing makes.

/** One seeded frame, as the comparison reads it. */
export interface SeededFrame {
  sheet: SheetName;
  index: number;
  width: number;
  height: number;
  /** Premultiplied RGBA channels, row-major. */
  pixels: Float64Array;
}

/**
 * How far a drawn source's pixels may sit from a seeded frame's, as a mean
 * absolute difference over premultiplied RGBA channels, out of `255`.
 *
 * NOT A LIKENESS TOLERANCE, and so not a threshold a check states: the
 * requirement is identity, and this is room for the one lossy step in reading a
 * bitmap back out of a canvas. A partially transparent pixel is premultiplied on
 * the way in and un-premultiplied on the way out, so it can shift by a unit;
 * comparing on premultiplied channels removes even that, and a DIFFERENT frame
 * of the same sheet measures several units here. A check asserts "drawn from a
 * frame of assets/node/", with no number of its own.
 */
const MATCH_MAX = 1;

/** RGBA bytes as premultiplied channels, which is what survives a canvas intact. */
function premultiplied(data: Uint8ClampedArray): Float64Array {
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
 * A seeded PNG's premultiplied channels, decoded off disk.
 *
 * Premultiplied, because that is what survives a round trip through a canvas
 * intact: drawing a bitmap in multiplies each channel by the pixel's alpha and
 * reading it back divides again, so a partially transparent pixel is quantized
 * twice. Comparing the products compares what both sides actually hold — and the
 * drawn side made exactly this round trip inside the page.
 */
function channelsOfFile(source: {
  width: number;
  height: number;
}): Float64Array {
  const width = Math.max(1, Math.round(source.width));
  const height = Math.max(1, Math.round(source.height));
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, width, height);
  // The cast is the one this comparison needs: what is handed here is a bitmap
  // this canvas implementation can blit, and the decoder it comes from does not
  // share a nominal type with the parameter.
  ctx.drawImage(source as never, 0, 0);
  return premultiplied(ctx.getImageData(0, 0, width, height).data);
}

/**
 * A drawn source's premultiplied channels, optionally cropped to the sub-rect
 * the draw named.
 *
 * The crop is what makes the comparison hold for a build that composed an atlas
 * of its own and blits out of it with the nine-argument `drawImage`: what is
 * compared is then the sub-rect the draw named rather than the sheet behind it.
 */
function channelsOfSource(
  rect: { width: number; height: number; data: Uint8ClampedArray },
  crop?: { x: number; y: number; width: number; height: number },
): Float64Array | null {
  if (crop === undefined) return premultiplied(rect.data);
  const x0 = Math.round(crop.x);
  const y0 = Math.round(crop.y);
  const width = Math.max(1, Math.round(crop.width));
  const height = Math.max(1, Math.round(crop.height));
  if (
    x0 < 0 ||
    y0 < 0 ||
    x0 + width > rect.width ||
    y0 + height > rect.height
  ) {
    return null;
  }
  const cut = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const from = ((y0 + row) * rect.width + x0) * 4;
    cut.set(rect.data.subarray(from, from + width * 4), row * width * 4);
  }
  return premultiplied(cut);
}

/** The mean absolute difference between two channel buffers, out of 255. */
function difference(a: Float64Array, b: Float64Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

let seededFramesPromise: Promise<readonly SeededFrame[]> | null = null;

/**
 * Every seeded frame of every folder `specs/assets.md` lists, read off the
 * workspace's own `assets/` tree.
 *
 * Decoded once per suite worker and shared, because every sprite point in the
 * project wants the same twenty-one frames and decoding them is the one slow
 * thing this module does.
 */
export function seededFrames(): Promise<readonly SeededFrame[]> {
  seededFramesPromise ??= (async () => {
    const frames: SeededFrame[] = [];
    for (const [sheet, spec] of Object.entries(SPRITE_SHEETS)) {
      for (let index = 0; index < spec.frames; index += 1) {
        const image = await loadImage(
          join(WORKSPACE_ROOT, "assets", spec.folder, `${index}.png`),
        );
        frames.push({
          sheet: sheet as SheetName,
          index,
          width: image.width,
          height: image.height,
          pixels: channelsOfFile(image),
        });
      }
    }
    return frames;
  })();
  return seededFramesPromise;
}

/** Every seeded frame a drawn source is pixel-for-pixel identical to. */
function seededMatches(
  frames: readonly SeededFrame[],
  drawn: Float64Array,
): SeededFrame[] {
  return frames.filter(
    (frame) =>
      frame.pixels.length === drawn.length &&
      difference(frame.pixels, drawn) <= MATCH_MAX,
  );
}

/** One `drawImage` a frame issued, as a sprite point reads it. */
export interface Blit {
  /** Where the destination box is centred, in logical stage units. */
  x: number;
  y: number;
  /** The destination box's size, in logical stage units, always positive. */
  width: number;
  height: number;
  /**
   * Whether the box is mirrored on each axis — a negative scale in the transform
   * in force, a negative destination width, or both.
   *
   * `specs/assets.md` requires exactly this of a leftward worm and a leftward
   * corruptor: the art faces right and is drawn mirrored horizontally. Under a
   * rotation these read the sign of the mapped box's corners, which is the
   * mirror only for the upright draws the specification asks for.
   */
  flipX: boolean;
  flipY: boolean;
  /** The source bitmap's own size, before any destination scaling. */
  source: { width: number; height: number };
  /**
   * The transform in force at the call, as `[a, b, c, d, e, f]`.
   *
   * {@link Blit.flipX} and {@link Blit.flipY} read the mapped box's corners,
   * which a reflection reverses and a turn between the quarters does not. The
   * angle is in the matrix itself: an axis-aligned draw carries zero in `b` and
   * `c` whatever scale it was drawn at, and a rotation puts the sine of its angle
   * there.
   */
  transform: Matrix;
  /** The seeded frames this draw's source is identical to; empty when it is none. */
  matches: SeededFrame[];
}

/** One `drawImage` the walk found, before its source has been read back. */
interface PendingBlit {
  id: number;
  crop?: { x: number; y: number; width: number; height: number };
  blit: Omit<Blit, "matches">;
}

/**
 * Run one frame and hand back every `drawImage` it issued, each matched against
 * the seeded art.
 *
 * The frame is an ordinary driven frame and its operations come back through
 * `frameCalls`, which is the self-contained encoding the recorder hands a suite
 * whether or not a capture is running — so this is safe to call inside a
 * {@link captureReplay}, and the recording the capture keeps is untouched by it.
 *
 * The walk is the case's rather than the package's `imageDraws` because of one
 * field: `specs/assets.md` requires the cursor's frame drawn UPRIGHT, and the
 * only reading that answers that is the transform the draw was made under.
 */
export async function blitsOfFrame(h: Harness): Promise<Blit[]> {
  const seeded = await seededFrames();
  const calls = await h.frameCalls();

  const pending: PendingBlit[] = [];
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
    if (method !== "drawImage") continue;
    const image = imageRef(args[0]);
    if (image === null) continue;

    let dx: number;
    let dy: number;
    let dw: number;
    let dh: number;
    if (args.length >= 9) {
      dx = Number(args[5]);
      dy = Number(args[6]);
      dw = Number(args[7]);
      dh = Number(args[8]);
    } else if (args.length >= 5) {
      dx = Number(args[1]);
      dy = Number(args[2]);
      dw = Number(args[3]);
      dh = Number(args[4]);
    } else {
      dx = Number(args[1]);
      dy = Number(args[2]);
      dw = image.width;
      dh = image.height;
    }
    if (![dx, dy, dw, dh].every((n) => Number.isFinite(n))) continue;

    const p0 = apply(current, dx, dy);
    const p1 = apply(current, dx + dw, dy + dh);
    const sub =
      args.length >= 9
        ? {
            x: Number(args[1]),
            y: Number(args[2]),
            width: Number(args[3]),
            height: Number(args[4]),
          }
        : undefined;
    pending.push({
      id: image.id,
      crop:
        sub !== undefined &&
        [sub.x, sub.y, sub.width, sub.height].every((n) => Number.isFinite(n))
          ? sub
          : undefined,
      blit: {
        x: (p0.x + p1.x) / 2,
        y: (p0.y + p1.y) / 2,
        width: Math.abs(p1.x - p0.x),
        height: Math.abs(p1.y - p0.y),
        flipX: p1.x < p0.x,
        flipY: p1.y < p0.y,
        source: { width: image.width, height: image.height },
        transform: current,
      },
    });
  }

  // The pixels of a source are asked for once per bitmap, however many draws name
  // it: a board of forty nodes is forty draws of the same five frames.
  const sources = new Map<
    number,
    { width: number; height: number; data: Uint8ClampedArray } | null
  >();
  const channels = new Map<string, Float64Array | null>();
  const blits: Blit[] = [];
  for (const entry of pending) {
    if (!sources.has(entry.id)) {
      sources.set(entry.id, await h.imagePixels(entry.id));
    }
    const source = sources.get(entry.id) ?? null;
    // A source the page no longer holds carries no pixels; it matches nothing
    // rather than matching everything.
    if (source === null) {
      blits.push({ ...entry.blit, matches: [] });
      continue;
    }
    const key = `${entry.id}|${
      entry.crop === undefined
        ? "*"
        : `${entry.crop.x},${entry.crop.y},${entry.crop.width},${entry.crop.height}`
    }`;
    if (!channels.has(key)) {
      channels.set(key, channelsOfSource(source, entry.crop));
    }
    const drawn = channels.get(key) ?? null;
    blits.push({
      ...entry.blit,
      matches: drawn === null ? [] : seededMatches(seeded, drawn),
    });
  }
  return blits;
}

/**
 * Every blit whose source is a frame of `sheet` and whose destination centre is
 * within `within` logical units of `at`.
 *
 * `within` is the caller's, because how close a sprite has to sit to the entity
 * it draws is the check's requirement rather than this helper's — `specs/board.md`
 * says a node is drawn centred on its tile, and the check states how much of a
 * tile it will allow.
 */
export function drawnFrom(
  blits: readonly Blit[],
  sheet: SheetName,
  at: { x: number; y: number },
  within: number,
): Blit[] {
  return blits.filter(
    (blit) =>
      Math.hypot(blit.x - at.x, blit.y - at.y) <= within &&
      blit.matches.some((frame) => frame.sheet === sheet),
  );
}

/** The frame indices of `sheet` that `blits` drew, in the order they were drawn. */
export function frameIndexes(
  blits: readonly Blit[],
  sheet: SheetName,
): number[] {
  return blits.flatMap((blit) =>
    blit.matches
      .filter((frame) => frame.sheet === sheet)
      .map((frame) => frame.index),
  );
}

/* -------------------------------------------------------------------------- */
/* Reading one frame's text                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Every string the frame drew, BOTH as the calls split it and as the logical
 * runs those calls spell.
 *
 * The shared `drewText` reads copy off the logical runs alone, and rightly: a
 * build that letter-spaces a heading draws one glyph per `fillText`, the merge
 * rule (`case-harness/text.ts`) folds those back into the string they spell,
 * and every raw string is a substring of its run. A reader that holds a word or
 * a figure to a BOUNDARY on both sides needs the raw split as well, because a
 * run can also swallow a boundary — a label drawn one space clear of its figure
 * joins it under the same rule. The union can only add a match.
 */
export function drawnTextForms(calls: readonly DrawCall[]): string[] {
  return [...drawnText(calls), ...drawnTextLines(calls)];
}

/**
 * Every text draw the frame made, placed, BOTH as the calls split it and as the
 * logical runs those calls spell: the placed counterpart of
 * {@link drawnTextForms}.
 *
 * For the reader that has to FIND a run of copy on the frame before it can hold
 * it to anything — the HUD label a readout's digits sit beside, the readout that
 * must sit inside the bar. `textDraws` is one entry per call, and a build that
 * letter-spaces its label or its score draws a glyph per call, so no single entry
 * then carries the copy; `drawnTextRuns` folds those back into the run they
 * spell, placed at its first draw and spanning its glyphs. A span holds the copy
 * whole only if the build drew it in one call, and a run only if the run did not
 * swallow a boundary the reader holds, so the union is read and can only add a
 * match. A run of one draw is that draw, and is listed once.
 */
export function textDrawForms(calls: readonly DrawCall[]): TextDraw[] {
  const draws = textDraws(calls);
  const runs = drawnTextRuns(calls).filter(
    (run) => !draws.some((draw) => sameDraw(draw, run)),
  );
  return [...draws, ...runs];
}

/** How far apart two placements of one draw may read, in canvas pixels. */
const SAME_DRAW_SLACK = 1e-3;

/** Whether two draws are one draw read twice: the same text at the same place. */
function sameDraw(a: TextDraw, b: TextDraw): boolean {
  return (
    a.text === b.text &&
    Math.abs(a.y - b.y) <= SAME_DRAW_SLACK &&
    Math.abs(a.left - b.left) <= SAME_DRAW_SLACK &&
    Math.abs(a.right - b.right) <= SAME_DRAW_SLACK
  );
}

/**
 * Whether the frame drew `word` as a STANDALONE token, ignoring case.
 *
 * The stricter sibling of the shared harness's `drewText`, for the copy
 * `specs/ui.md` requires as a word rather than as a substring — the how-to
 * screen's `SPACE`, `ARROWS` and `WASD`. A screen reading "press the spacebar"
 * contains `space` and does not name the key the specification named.
 *
 * Read off {@link drawnTextForms}, so a key name letter-spaced a glyph per call
 * is still the word it spells, and one drawn a space clear of its explanation is
 * still bounded.
 */
export function drewWord(calls: readonly DrawCall[], word: string): boolean {
  const pattern = new RegExp(
    `(^|[^A-Za-z0-9])${word.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z0-9]|$)`,
    "i",
  );
  return drawnTextForms(calls).some((drawn) => pattern.test(drawn));
}

/* -------------------------------------------------------------------------- */
/* Colour                                                                     */
/* -------------------------------------------------------------------------- */
//
// `specs/overview.md` fixes NO PALETTE — the colours, the type and the glow are
// the build's — and states instead what a player must read at a glance: the four
// charge states told apart and reading as a ramp, the worm apart from the board
// and from a node, the cursor apart from its band, the three foes apart from one
// another. So every colour check is a comparison between two things the build
// drew, never against a hex value, and the DISTANCE it demands is the check's own
// figure, stated in the check. Nothing here fixes one.

/**
 * How far out the four neighbours of a colour sample sit, in logical units.
 *
 * Six units: well inside a 32-unit tile and inside the body of a 32-unit sprite,
 * so one stray anti-aliased or glow pixel cannot swing the reading. The shared
 * harness takes the radius from its caller for exactly this reason — what
 * "comfortably inside the body" means is the case's own geometry, and Wireworm's
 * smallest sampled thing is a tile.
 */
const SAMPLE_RADIUS = 6;

/** The rendered colour at a logical point, averaged over that small cluster. */
export function sampleColor(h: Harness, x: number, y: number): Promise<Rgb> {
  return clusterSample(h, x, y, SAMPLE_RADIUS);
}

/** {@link sampleColor} at a tile's centre. */
export function sampleTile(h: Harness, c: number, r: number): Promise<Rgb> {
  return sampleColor(h, tileCX(c), tileCY(r));
}

/**
 * Tiles a board posed by {@link startPlaying} leaves bare: on the board, clear
 * of the HUD, clear of the player band, and spread across it so no one readout,
 * banner or overlay a build chose to place can cover them all.
 */
export const BARE_TILES: readonly Tile[] = [
  { c: 2, r: 2 },
  { c: 36, r: 3 },
  { c: 5, r: 14 },
  { c: 30, r: 11 },
  { c: 18, r: 16 },
];

/**
 * The bare board's colour: the darkest of {@link BARE_TILES}, sampled off the
 * canvas as it stands.
 *
 * The darkest of several rather than one fixed patch, because `specs/overview.md`
 * makes the board dark and everything on it brighter, but leaves a build free to
 * put a banner, a hint or a watermark anywhere it likes — and a patch something
 * is drawn over reads lighter than one nothing is.
 */
export async function sampleBoard(h: Harness): Promise<Rgb> {
  const samples: Rgb[] = [];
  for (const tile of BARE_TILES) {
    samples.push(await sampleTile(h, tile.c, tile.r));
  }
  return samples.reduce((darkest, sample) =>
    luminance(sample) < luminance(darkest) ? sample : darkest,
  );
}
/* -------------------------------------------------------------------------- */
/* Reading a snapshot                                                         */
/* -------------------------------------------------------------------------- */
//
// Plain readings over the shape `specs/instrumentation.md` fixes. They compute
// nothing a check could not compute itself; they exist so that twenty suites
// spell the same lookup the same way, and so that a lookup that finds nothing
// fails with the entity it wanted named rather than as a `TypeError` two lines
// later.

/** The worm with that id, or `undefined`. */
export function wormById(
  snapshot: WirewormSnapshot,
  id: number,
): WormView | undefined {
  return snapshot.worms.find((worm) => worm.id === id);
}

/** The worm with that id, failing the check with the scenario it needed. */
export function requireWorm(
  snapshot: WirewormSnapshot,
  id: number,
  doing = "the scenario",
): WormView {
  const worm = wormById(snapshot, id);
  if (worm === undefined) {
    fail(
      `worm ${id} still on the board (${doing})`,
      `worms ${JSON.stringify(snapshot.worms.map((w) => w.id))}`,
    );
  }
  return worm;
}

/** The foe with that id, or `undefined`. */
export function foeById(
  snapshot: WirewormSnapshot,
  id: number,
): FoeView | undefined {
  return snapshot.foes.find((foe) => foe.id === id);
}

/** The foe with that id, failing the check with the scenario it needed. */
export function requireFoe(
  snapshot: WirewormSnapshot,
  id: number,
  doing = "the scenario",
): FoeView {
  const foe = foeById(snapshot, id);
  if (foe === undefined) {
    fail(
      `foe ${id} still on the board (${doing})`,
      `foes ${JSON.stringify(snapshot.foes.map((f) => f.id))}`,
    );
  }
  return foe;
}

/** The bolt with that id, or `undefined`. */
export function boltById(
  snapshot: WirewormSnapshot,
  id: number,
): BoltView | undefined {
  return snapshot.bolts.find((bolt) => bolt.id === id);
}

/** Every foe of one kind, in roster order. */
export function foesOfKind(
  snapshot: WirewormSnapshot,
  kind: FoeKind,
): FoeView[] {
  return snapshot.foes.filter((foe) => foe.kind === kind);
}

/**
 * The last entry of a roster: the entity an `add` operation just appended.
 *
 * `specs/instrumentation.md` makes appending the rule precisely so an id is
 * findable without an assignment scheme, and these three are that rule.
 */
export function lastWorm(snapshot: WirewormSnapshot): WormView | undefined {
  return snapshot.worms[snapshot.worms.length - 1];
}

export function lastFoe(snapshot: WirewormSnapshot): FoeView | undefined {
  return snapshot.foes[snapshot.foes.length - 1];
}

export function lastBolt(snapshot: WirewormSnapshot): BoltView | undefined {
  return snapshot.bolts[snapshot.bolts.length - 1];
}

/** A worm's head: the first segment, which leads. */
export function headOf(worm: WormView): Tile {
  return worm.segments[0];
}

/** A worm's tail: the last segment. */
export function tailOf(worm: WormView): Tile {
  return worm.segments[worm.segments.length - 1];
}

/** The node on a tile, or `undefined` when the tile is empty. */
export function nodeAt(
  snapshot: WirewormSnapshot,
  c: number,
  r: number,
): NodeView | undefined {
  return snapshot.nodes.find((node) => node.c === c && node.r === r);
}

/** The charge of the node on a tile, or `null` when the tile is empty. */
export function chargeAt(
  snapshot: WirewormSnapshot,
  c: number,
  r: number,
): number | null {
  return nodeAt(snapshot, c, r)?.charge ?? null;
}

/** How many nodes stand on rows `from` to `to`, both ends in. */
export function nodesInRows(
  snapshot: WirewormSnapshot,
  from: number,
  to: number,
): NodeView[] {
  return snapshot.nodes.filter((node) => node.r >= from && node.r <= to);
}

/** Every tile any worm has a segment on. */
export function segmentTiles(snapshot: WirewormSnapshot): Tile[] {
  return snapshot.worms.flatMap((worm) => worm.segments);
}

/** The tile a centre falls in (`specs/board.md`). */
export function tileOf(x: number, y: number): Tile {
  return { c: colAt(x), r: rowAt(y) };
}

/** Whether two tiles are the same tile. */
export function sameTile(a: Tile, b: Tile): boolean {
  return a.c === b.c && a.r === b.r;
}

/** The Chebyshev distance between two tiles, the way a discharge measures it. */
export function chebyshev(a: Tile, b: Tile): number {
  return Math.max(Math.abs(a.c - b.c), Math.abs(a.r - b.r));
}

/* -------------------------------------------------------------------------- */
/* -------------------------------------------------------------------------- */
/* Scenario helpers                                                           */
/* -------------------------------------------------------------------------- */
//
// EVERY COMPOUND SEQUENCE IN THIS PROJECT LIVES HERE. The debug surface is
// atomic — `specs/instrumentation.md` gives it one operation per field — so
// there is no `startRun`, no `spawnFoe(kind, options)` and no `setWorm({...})`
// to reach for, and there must not be: a patch operation would impose the case's
// own layout on the build. What a check wants instead is a helper, built out of
// those atomic operations, that poses the board and then lets the build's own
// update run from there.
//
// A CHECK TAKES ONLY THE PART IT ASKS FOR. Nothing below does anything a caller
// did not ask for: `startPlaying` clears four rosters, shuts three gates and
// poses a screen, and a check that wants a worm asks for one. A check that needs
// half a sequence calls the operations it needs.
//
// AND NONE OF THEM ASSERTS A VERDICT. A helper fails only when the game is not
// even in the situation the caller's scenario needs, and then with what it
// needed named.

/**
 * Pose an empty, quiet, live board at `level`, ready for a scenario.
 *
 * The sequence, and why each part of it is here:
 *
 *   - THE FOUR ROSTERS ARE EMPTIED. `clearNodes`, `clearWorms`, `clearFoes`,
 *     `clearBolts`. An empty board is safe because of the level-clear rule
 *     (`specs/progression.md`): a level clears on the step in which the last of
 *     its segments is REMOVED, so a board that never held one is being played
 *     rather than cleared. `progression/empty-board-does-not-clear` is the item
 *     that grades that, and it is what makes every scenario below poseable.
 *   - THE THREE WORLD GATES ARE SHUT. Without `setFoeSpawning(false)` a dropper
 *     arrives on the first `DROPPER_CHECK_INTERVAL` of an empty level-3 board
 *     and glitches arrive every seven to twelve seconds from level 2; without
 *     `setWormEntry(false)` the level's own worm materialises inside a scenario
 *     that never asked for one; without `setCursorContact(false)` a worm on the
 *     floor row or a descending foe costs a life mid-scenario and empties both
 *     rosters. Each gate is the level's own faculty rather than any entity's,
 *     which is why shutting it is not "parking an entity in a harmless corner".
 *     THE ITEMS THAT TURN A GATE BACK ON ARE THE ITEMS WHOSE REQUIREMENT THE
 *     GATE IS; any other check that finds itself wanting one has been mis-posed.
 *   - THE SCREEN IS LIVE. `playing`/`active` with the phase timer at rest, so
 *     the board really is stepping rather than sitting behind a banner.
 *   - THE CURSOR IS PARKED AT THE BAND'S CENTRE, with no invulnerability and no
 *     cooldown, which is where a run and a respawn put it (`specs/progression.md`)
 *     and the one entity no scenario can remove.
 *
 * It poses no worm, no foe, no node and no bolt: a check adds exactly what its
 * requirement concerns.
 */
export async function startPlaying(
  h: Harness,
  options: { level?: number } = {},
): Promise<void> {
  const { debug } = h;
  await debug.clearNodes();
  await debug.clearWorms();
  await debug.clearFoes();
  await debug.clearBolts();
  await debug.setFoeSpawning(false);
  await debug.setWormEntry(false);
  await debug.setCursorContact(false);
  await debug.setScreen("playing");
  await debug.setPhase("active");
  await debug.setPhaseTimer(0);
  await debug.setLevel(options.level ?? 1);
  await debug.setCursor(BAND_CX, BAND_CY);
  await debug.setCursorInvulnerable(0);
  await debug.setFireCooldown(0);
  // The level is posed above and the step interval and the worm length follow
  // it, so the readings are brought into agreement before the caller reads them.
  await debug.reconcile();
}

/**
 * Open a run the way a player does: from a reset title, confirm the highlighted
 * first item, `DESCEND`.
 *
 * The route for a check about what a NEW RUN is — its lives, its level, its
 * score, its starting scatter — none of which any pose can produce, because
 * `setLevel` spawns nothing and `setScore` grants nothing. Nothing here is
 * posed: `reset` is the surface's own, and the rest is a real key through
 * Chromium's input pipeline.
 */
export async function startRunFromTitle(h: Harness): Promise<void> {
  await h.debug.reset();
  await h.debug.setMenuIndex(0);
  await h.tap("Enter");
  await h.advance(1);
}

/** How a worm is laid on the board. */
export interface WormSpec {
  /** The head's tile. */
  c: number;
  r: number;
  /**
   * How many segments the worm carries, the head included. The trailing ones are
   * laid along the same row BEHIND the head, against `dh`, so a worm of length
   * `n` heading right occupies `(c, r)` back to `(c - n + 1, r)`. Pass
   * {@link WormSpec.segments} instead for any other shape.
   */
  length?: number;
  /** An explicit chain, head first, each tile orthogonally adjacent to the last. */
  segments?: readonly Tile[];
  /** `+1` right, `-1` left. Defaults to `+1`, which `addWorm` gives. */
  dh?: number;
  /** `+1` down, `-1` up. Defaults to `+1`. */
  dv?: number;
  diving?: boolean;
  /** The step faculty. Off, the worm holds its tiles and the board runs on. */
  stepping?: boolean;
  /** The body's follow. Off, the head steps and the trailing segments hold. */
  body?: boolean;
}

/**
 * Lay one worm on the board, a segment at a time, and hand back its id.
 *
 * Built from `addWorm` and `appendSegment` because the surface takes no nested
 * layout: a worm is a head and then one tile at a time, so the case never
 * imposes a shape on the build.
 *
 * The two faculties are what let a check pose the isolation its requirement
 * needs. A check on where the HEAD goes poses `body: false`, so one tile moves
 * and the reading is unambiguous. A worm posed purely as an OBSTACLE — a
 * blocker for another worm's step, or a target for a bolt — poses
 * `stepping: false`, so it cannot wander into the scenario.
 */
export async function poseWorm(h: Harness, spec: WormSpec): Promise<number> {
  const dh = spec.dh ?? 1;
  const chain: Tile[] =
    spec.segments !== undefined
      ? [...spec.segments]
      : Array.from({ length: Math.max(1, spec.length ?? 1) }, (_, i) => ({
          c: spec.c - dh * i,
          r: spec.r,
        }));

  await h.debug.addWorm(chain[0].c, chain[0].r);
  const added = lastWorm(await h.snapshot());
  if (added === undefined) {
    fail(
      "addWorm to append a worm to the roster (specs/instrumentation.md)",
      "the worm roster was still empty after addWorm",
    );
  }
  const id = added.id;

  for (const segment of chain.slice(1)) {
    await h.debug.appendSegment(id, segment.c, segment.r);
  }
  await h.debug.setWormHeading(id, dh);
  await h.debug.setWormDescent(id, spec.dv ?? 1);
  if (spec.diving !== undefined) await h.debug.setWormDiving(id, spec.diving);
  if (spec.stepping !== undefined) {
    await h.debug.setWormStepping(id, spec.stepping);
  }
  if (spec.body !== undefined) await h.debug.setWormBody(id, spec.body);
  return id;
}

/** How a foe is put on the board. */
export interface FoeSpec {
  /** Its velocity, in logical units per second. Defaults to the kind's own. */
  vx?: number;
  vy?: number;
  /** The dropper's taken-its-first-bolt flag. */
  hit?: boolean;
  /** Its own behaviour: darting and eating, laying, slamming. */
  mind?: boolean;
  /** Its locomotion. Off, the foe holds its position and its behaviour runs on. */
  travel?: boolean;
}

/**
 * Put one foe on the tile `(c, r)` — its centre on that tile's centre — and hand
 * back its id.
 *
 * The two faculties pair the way `specs/foes.md` makes them pair: a check on
 * what a glitch EATS poses `travel: false` and reads a tile with no motion at
 * all, since a foe acts on the tile its centre occupies; a check on how it
 * TRAVELS poses both on and reads distances. Neither can be disturbed by the
 * other faculty.
 */
export async function poseFoe(
  h: Harness,
  kind: FoeKind,
  c: number,
  r: number,
  spec: FoeSpec = {},
): Promise<number> {
  await h.debug.addFoe(kind, tileCX(c), tileCY(r));
  const added = lastFoe(await h.snapshot());
  if (added === undefined) {
    fail(
      "addFoe to append a foe to the roster (specs/instrumentation.md)",
      "the foe roster was still empty after addFoe",
    );
  }
  const id = added.id;
  if (spec.vx !== undefined || spec.vy !== undefined) {
    await h.debug.setFoeVelocity(id, spec.vx ?? added.vx, spec.vy ?? added.vy);
  }
  if (spec.hit !== undefined) await h.debug.setFoeHit(id, spec.hit);
  if (spec.mind !== undefined) await h.debug.setFoeMind(id, spec.mind);
  if (spec.travel !== undefined) await h.debug.setFoeTravel(id, spec.travel);
  return id;
}

/**
 * Set a run of tiles at once, `[column, row, charge]` each.
 *
 * `setNode` is the atomic operation and this is the loop over it, so a check
 * that poses a cluster reads as the cluster rather than as fifteen calls.
 */
export async function poseNodes(
  h: Harness,
  entries: readonly (readonly [number, number, number])[],
): Promise<void> {
  for (const [c, r, charge] of entries) {
    await h.debug.setNode(c, r, charge);
  }
}

/** Set every tile of a rectangle of tiles, both corners in, to one charge. */
export async function poseNodeBlock(
  h: Harness,
  from: Tile,
  to: Tile,
  charge: number,
): Promise<void> {
  for (let r = Math.min(from.r, to.r); r <= Math.max(from.r, to.r); r += 1) {
    for (let c = Math.min(from.c, to.c); c <= Math.max(from.c, to.c); c += 1) {
      await h.debug.setNode(c, r, charge);
    }
  }
}

/**
 * Put one bolt in flight with its centre on the centre of tile `(c, r)`, and
 * hand back its id.
 *
 * It then climbs at `BOLT_SPEED` and resolves through the game's own shot rules,
 * so the tile it is placed on is a tile the caller means it to start INSIDE:
 * pose it a row below the thing the check is shooting at, on a tile that holds
 * nothing, and let it travel.
 */
export async function poseBolt(
  h: Harness,
  c: number,
  r: number,
): Promise<number> {
  await h.debug.addBolt(tileCX(c), tileCY(r));
  const added = lastBolt(await h.snapshot());
  if (added === undefined) {
    fail(
      "addBolt to append a bolt to the roster (specs/instrumentation.md)",
      "the bolt roster was still empty after addBolt",
    );
  }
  return added.id;
}

/**
 * Run the real simulation until the bolt with that id is no longer in flight —
 * it struck something, or it left the top of the board — and report where the
 * game stood at that moment.
 *
 * Sampled every frame by default, because for most of these the frame the bolt
 * resolved on is what is read: the segment that vanished, the node the charge
 * came off, the score the hit paid.
 */
export async function driveBolt(
  h: Harness,
  id: number,
  options: UntilOptions = {},
): Promise<UntilResult> {
  return h.until((snapshot) => boltById(snapshot, id) === undefined, {
    maxFrames: options.maxFrames ?? framesFor(1),
    poll: options.poll ?? 1,
  });
}

/**
 * Pose a bolt one row below `(c, r)` and run it until it resolves.
 *
 * The sequence a shot check runs over and over: a bolt starting on the tile
 * beneath the target, climbing the one tile into it, and the build's own shot
 * rules deciding the rest. The starting tile has to be one the bolt should not
 * resolve against, which on a board posed by {@link startPlaying} is any tile
 * the check has not put something on.
 */
export async function shootTile(
  h: Harness,
  c: number,
  r: number,
  options: UntilOptions = {},
): Promise<UntilResult> {
  const id = await poseBolt(h, c, r + 1);
  return driveBolt(h, id, options);
}

/**
 * Advance the harness's clock far enough for a worm at `level` to take exactly
 * `steps` tile steps.
 *
 * See {@link framesForSteps} for why it stops half an interval past the last
 * step rather than on it.
 */
export async function driveSteps(
  h: Harness,
  steps: number,
  level = 1,
): Promise<void> {
  await h.advance(framesForSteps(steps, level));
}

/** Show or hide the read-only debug overlay, through its fixed Backquote binding. */
export async function toggleOverlay(h: Harness): Promise<void> {
  await h.tap(OVERLAY_KEY);
}

/* -------------------------------------------------------------------------- */
/* Menus, driven by a real mouse and a real finger                            */
/* -------------------------------------------------------------------------- */
//
// The menus take a pointer and a touch contact as well as the keyboard
// (`specs/ui.md`), and where a build LAYS the items out is the build's own — so
// a check asks the build where it put an item, through `menuItemRect`, and then
// drives Chromium's real mouse or a real touch contact at that region. Nothing
// here poses a pointer through the surface: a pose would tell the build where
// the pointer is without making its own input layer see a press, a travel and a
// release the way a hand does, and what these checks are about is precisely that
// the build reads them.
//
// THE GESTURES THEMSELVES ARE THE SHARED HARNESS'S — the held CDP session a
// contact needs, and the one driven frame each part of a gesture runs, are the
// same on every engineless case. What is Wireworm's is where a gesture is aimed:
// at the region the build reported for one of ITS menu items.
//
// EACH PART OF A GESTURE RUNS EXACTLY ONE DRIVEN FRAME, so a caller counting
// frames can add them up. A part that ran no frame would never reach a build
// that reads its input once per frame, and a press released before a frame ran
// would be invisible to one that compares held state between frames.

/**
 * Where the build put item `index` of the menu the current screen shows.
 *
 * Fails by assertion when the build reports no region for an item its own menu
 * shows, so the point names that fault rather than dividing by a `null` several
 * lines later. A check that is ABOUT the reading returning `null` — on
 * `playing`, on `howto`, or past the end of a menu — calls
 * `h.debug.menuItemRect` directly.
 */
export async function menuRect(h: Harness, index: number): Promise<MenuRect> {
  const rect = await h.debug.menuItemRect(index);
  if (rect === null || rect === undefined) {
    fail(
      `menuItemRect(${index}) to report the hit region of item ${index} on ` +
        `the menu the current screen shows (specs/instrumentation.md)`,
      rect,
    );
  }
  return rect;
}

/** The middle of item `index`'s hit region: where a gesture aimed at it lands. */
export async function menuItemCenter(
  h: Harness,
  index: number,
): Promise<{ x: number; y: number }> {
  const rect = await menuRect(h, index);
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/** Move the real mouse onto item `index`, and run the frame that reads it. */
export async function pointAtItem(h: Harness, index: number): Promise<void> {
  const at = await menuItemCenter(h, index);
  await mouseGlide(h, at.x, at.y);
}

/**
 * Press and release the real mouse inside item `index`'s region.
 *
 * Both edges fall in the one region, which is what `specs/ui.md` requires of a
 * confirm. Two driven frames, one for each edge.
 */
export async function clickItem(h: Harness, index: number): Promise<void> {
  const at = await menuItemCenter(h, index);
  await mousePress(h, at.x, at.y);
  await mouseRelease(h);
}

/**
 * Press inside item `from`'s region, travel onto item `to`'s, and release there.
 *
 * The slide-off affordance: two edges in different regions confirm nothing
 * (`specs/ui.md`). Three driven frames.
 */
export async function slideOffItem(
  h: Harness,
  from: number,
  to: number,
): Promise<void> {
  const start = await menuItemCenter(h, from);
  await mousePress(h, start.x, start.y);
  const end = await menuItemCenter(h, to);
  await mouseGlide(h, end.x, end.y);
  await mouseRelease(h);
}

/**
 * Land a real touch contact inside item `index`'s region and lift it there.
 *
 * The landing selects the item as well as confirming it, because a finger does
 * not hover (`specs/ui.md`), which is the difference between this and
 * {@link clickItem}.
 */
export async function touchItem(h: Harness, index: number): Promise<void> {
  const at = await menuItemCenter(h, index);
  await touchPress(h, at.x, at.y);
  await touchRelease(h);
}

/**
 * Land a contact on item `from`, travel onto item `to`, and lift it there.
 *
 * A finger's form of {@link slideOffItem}: the selection follows the contact and
 * nothing is confirmed (`specs/ui.md`).
 */
export async function dragBetweenItems(
  h: Harness,
  from: number,
  to: number,
): Promise<void> {
  const start = await menuItemCenter(h, from);
  await touchPress(h, start.x, start.y);
  const end = await menuItemCenter(h, to);
  await touchGlide(h, end.x, end.y);
  await touchRelease(h);
}
