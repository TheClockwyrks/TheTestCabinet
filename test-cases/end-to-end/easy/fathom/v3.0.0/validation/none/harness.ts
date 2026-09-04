// Fathom — the case's half of the validator harness. CASE-PROVIDED.
//
// Every check in this suite is an ordinary vitest test that drives the built site
// IN A REAL BROWSER. There is nothing to import: an engineless run seeds no `src/`
// at all, so the build wrote its own frame loop, its own canvas fit, its own
// keyboard, its own audio, and its own `window.__fathom` — and the only place all
// of that exists is a page that has loaded the bundle. So the project serves
// `dist/`, loads it in Chromium, and reaches the game the way anything reaches it:
// over the surface `specs/instrumentation.md` told the build to install.
//
// THE MACHINERY THAT DOES THAT IS NOT FATHOM'S. Serving the build, connecting to
// the one browser, opening a page per harness, injecting the draw-command
// recorder and the audio probe, bracketing each driven tick around one
// `advance(1)` of the build's surface, reading pixels and draw calls back out,
// and writing the evidence a review point declares — every engineless case needs
// exactly that, and it lives once, in `@test-cabinet/case-harness`, staged beside
// this file as `./case-harness/`. What is left here is what is genuinely
// Fathom's: the shape of its snapshot, the thirty operations its
// `specs/instrumentation.md` requires, and the readings a trench of dark water
// and small amber lights is made of.
//
// The seam is one call. `createCaseHarness` takes the case's TYPES as type
// arguments and the case's VALUES as one object, and hands back the machinery
// with Fathom's names and Fathom's types on it — so the 113 suites next door go
// on importing `createHarness`, `captureReplay` and `startPlaying` from
// `../harness` exactly as they did, and none of them can tell the difference.
//
// IT IS STILL A VITEST PROJECT, AND THAT IS DELIBERATE. The runner locates the
// build output before it chooses between the vitest and browser paths, so `dist/`
// is on disk by the time this project runs. Staying a vitest project is what lets
// the case name ONE script per review item and have it resolve under every engine
// — `validation/fog/unrevealed-black.test.ts` is the same path whichever runtime
// the run selected — and what keeps `format = 2` resolution passing.
//
// WHAT A CHECK READS. The game's own state (through `window.__fathom`'s
// `snapshot`), the ticks the harness itself drove, the operations the build issued
// against its 2D context, the pixels those operations left on the canvas, and the
// sounds the build emitted. Nothing here fabricates an outcome: the fixtures and
// scene helpers next door only ARRANGE the trench through the surface, and the
// real tick the build wrote is what runs from there.
//
// THE CLOCK IS THE SURFACE'S. Nothing outside an engineless build owns its loop,
// so `specs/instrumentation.md` puts the clock on the surface: `setAutoStep(false)`
// takes the game off real time and `advance(ticks)` runs whole ticks. Fathom fixes
// the size of a tick itself — `TICK_HZ` is `120` and `advance` counts in whole
// `TICK_DT`s — so unlike a case that leaves the step to its caller, this harness
// chooses no schedule: a check asks for a number of ticks and gets exactly that
// number. Every harness opens by taking the game off the clock. The one check that
// is ABOUT the loop running itself (`controls/advances-in-real-time`) hands it back
// with `Harness.runFor`.
//
// ADVANCE VERSUS SKIP. Both run real ticks and neither fabricates anything; they
// differ in what they leave behind for a reviewer. `advance` brackets each tick as
// one recorded frame, so a captured section plays back at the rate the game ran
// at. `skip` runs the ticks in one call and closes no frame, for the march to a
// state nobody needs to watch — losing three lives, waiting out a cooldown,
// settling a pose. A section that skipped its setup and advanced its subject
// yields a clip of the subject.
//
// EVERYTHING CROSSING INTO THE PAGE IS ASYNC. That is the whole of the difference
// between a suite here and its counterpart under an engine: `await h.snapshot()`
// rather than `h.snapshot()`, `await h.debug.setMaze(rows)` rather than
// `h.debug.setMaze(rows)`. The scenarios, the tolerances and the assertions are
// the same ones, because they are the case's rather than the runtime's.

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  brightestIn,
  clusterPoints,
  colorDistance,
  createCaseHarness,
  gridPoints,
  meanChannel,
  meanOf,
  mouseGlide,
  mousePress,
  mouseRelease,
  ringPoints,
  rgbOf,
  samplePoints,
  sampleRing,
  touchGlide,
  touchPress,
  touchRelease,
  type Harness as BaseHarness,
  type HarnessOptions,
  type NearSample,
  type Point,
  type Rgb,
  type TimedCue,
  type UntilResult as BaseUntilResult,
} from "./case-harness/index";
import { assertTruthy, fail } from "./assert";
import {
  FATHOM_DEBUG_VERSION,
  STAGE_H,
  STAGE_W,
  TICK_HZ,
  UNBOUND_KEY,
  type Dir,
} from "./constants";
import { type FixtureBoard, type FixtureOps } from "./fixtures";
import { tileCenter, type GridFrame, type Tile } from "./maze";

/* -------------------------------------------------------------------------- */
/* The contract the build owes                                                */
/* -------------------------------------------------------------------------- */

/** The handle an engineless build installs its surface on. */
export const HANDLE = "__fathom";

/**
 * Every operation `specs/instrumentation.md` requires on the surface, including
 * the two clock operations that exist only under this engine.
 *
 * This is the case's list, not the build's: a build that installs a surface
 * missing one of these is held against the specification rather than against its
 * own idea of what it wrote. {@link Harness.surfaceFault} names what is missing
 * and every operation then fails by assertion rather than throwing.
 */
export const REQUIRED_OPS = [
  "setAutoStep",
  "advance",
  "reset",
  "snapshot",
  "menuItemRect",
  "setScreen",
  "setMenuIndex",
  "setTitleIndex",
  "setScore",
  "setLives",
  "setDepth",
  "setMaze",
  "setPlankton",
  "clearPlankton",
  "clearFog",
  "setForagerTile",
  "setForagerDir",
  "setBrightness",
  "setBrightHold",
  "clearPredators",
  "addPredator",
  "setPredatorTile",
  "setPredatorDir",
  "setPredatorState",
  "setPredatorReleased",
  "setPredatorMind",
  "setPredatorTravel",
  "spawnDrifter",
  "clearDrifters",
  "setDrifterMind",
  "setDrifterTravel",
  "setSonarCooldown",
  "setInkCooldown",
] as const;

// The version the surface reports is a figure the specification fixes like every
// other, so it lives in `constants.ts` with the rest and is re-exported here for
// the two instrumentation checks that name it off the surface's own description.
export { FATHOM_DEBUG_VERSION };

/** The seven screens the game is a state machine over (`specs/state.md`). */
export type Screen =
  | "title"
  | "howto"
  | "countdown"
  | "playing"
  | "paused"
  | "cleared"
  | "gameover";

/**
 * A menu item's hit region, as `menuItemRect` reports it
 * (`specs/instrumentation.md`).
 *
 * `x` and `y` are the region's top-left corner and `w` and `h` its size, all in
 * the logical units `specs/overview.md` fixes the stage in.
 */
export interface MenuRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The three hunters. */
export type PredatorKind = "lanternjaw" | "gloamfin" | "flarefish";

/** Where a predator is and what it is doing (`specs/state.md`). */
export type PredatorState = "den" | "wander" | "chase" | "search";

/** The three states a predator may be POSED into: `"search"` is not one of them. */
export type PosablePredatorState = "den" | "wander" | "chase";

/** One predator, as a snapshot reports it. */
export interface PredatorSnapshot {
  kind: PredatorKind;
  x: number;
  y: number;
  tx: number;
  ty: number;
  dir: Dir;
  state: PredatorState;
  released: boolean;
  /** Whether its own mind is running (`specs/state.md`). */
  mind: boolean;
  /** Whether its body carries what its mind decides (`specs/state.md`). */
  travel: boolean;
  speed: number;
  alert: boolean;
  lit: boolean;
  /** The Lanternjaw and the Flarefish; `null` for the Gloamfin. */
  detectRange: number | null;
  /** The Gloamfin; `null` for the others. */
  hearingRange: number | null;
  hearingLock: boolean | null;
  /** The Flarefish; `null` for the others. */
  flareCharging: boolean | null;
  flaring: boolean | null;
  flareRadius: number | null;
}

/** One bonus drifter, as a snapshot reports it. */
export interface DrifterSnapshot {
  x: number;
  y: number;
  tx: number;
  ty: number;
  /**
   * True while its body is being drawn this instant, by the forager's light or
   * by a flare.
   *
   * Its amber mote is a separate drawing and is not what this answers for: the
   * mote is one of the maze's amber lights and shows under its own rule, while
   * `lit` says whether the jellyfish itself is drawn (specs/state.md).
   */
  lit: boolean;
  /** Whether its own mind is running (`specs/state.md`). */
  mind: boolean;
  /** Whether its body carries that wander through the maze (`specs/state.md`). */
  travel: boolean;
}

/** One sonar wavefront in flight, the forager's own and the Gloamfin's alike. */
export interface PulseSnapshot {
  source: "forager" | "gloamfin";
  tint: "cyan" | "violet" | "orange";
  ox: number;
  oy: number;
  /** How far the leading edge has traveled, in corridor steps. */
  front: number;
  /** The furthest it will travel, in the same steps. */
  range: number;
}

/** One ink cloud still standing. */
export interface InkCloudSnapshot {
  x: number;
  y: number;
  radius: number;
  remaining: number;
}

/**
 * The state a snapshot reports, as `specs/state.md` documents it.
 *
 * `windowRadius` is the one field the VARIANT decides: the kindle variant carries
 * the outer vision circle and reports its radius `R`, and the base variant has no
 * such circle and no such field. It is declared optional so this one harness
 * serves both workspaces; a kindle check reads it through
 * {@link windowRadius}, which says what the build owes rather than throwing a
 * `TypeError` several ticks later.
 */
export interface FathomSnapshot extends FixtureBoard {
  version: number;
  screen: Screen;
  /**
   * The highlighted item on the menu the current screen shows, counted from `0`
   * over the items `specs/ui.md` lists for that menu.
   *
   * `null` on `"howto"`, `"countdown"`, `"playing"` and `"cleared"`, which show
   * no menu (`specs/state.md`).
   */
  menuIndex: number | null;
  /**
   * The title menu's remembered selection: the index of the item last confirmed
   * there, `0` before any of them has been. Never `null` (`specs/state.md`).
   */
  titleIndex: number;
  depth: number;
  score: number;
  lives: number;
  muted: boolean;
  autoStep: boolean;
  planktonRemaining: number;
  brightness: number;
  brightHold: number;
  visionRadius: number;
  /** The kindle variant alone: `R`, the outer vision circle's radius. */
  windowRadius?: number;
  sonar: { ready: boolean; cooldown: number; range: number };
  ink: { ready: boolean; cooldown: number };
  grid: {
    cols: number;
    rows: number;
    tile: number;
    originX: number;
    originY: number;
  };
  tiles: string[];
  plankton: string[];
  visibility: string[];
  forager: {
    x: number;
    y: number;
    tx: number;
    ty: number;
    dir: Dir;
    moving: boolean;
  };
  drifters: DrifterSnapshot[];
  predators: PredatorSnapshot[];
  pulses: PulseSnapshot[];
  inkClouds: InkCloudSnapshot[];
  simTime: number;
}

/**
 * The kindle variant's outer vision-circle radius, or a failure naming what the
 * variant's `specs/state.md` requires.
 *
 * A build reporting no `windowRadius` under kindle fails by assertion here rather
 * than by arithmetic on `undefined` several lines later, so the point names the
 * fault.
 */
export function windowRadius(snapshot: FathomSnapshot): number {
  if (typeof snapshot.windowRadius !== "number") {
    fail(
      "snapshot() to report the outer vision circle's radius as `windowRadius`; " +
        "see specs/state.md",
      snapshot.windowRadius,
    );
  }
  return snapshot.windowRadius;
}

/** The operations a check poses the game through. Every one crosses into the page. */
export interface FathomDebugApi extends FixtureOps {
  setAutoStep(enabled: boolean): Promise<void>;
  advance(ticks: number): Promise<void>;
  reset(seed?: number): Promise<void>;
  snapshot(): Promise<FathomSnapshot>;
  /**
   * The hit region of item `index` on the menu the current screen shows, and
   * `null` on the four screens that show no menu or for an index that menu does
   * not hold. A pure reading: it changes nothing.
   */
  menuItemRect(index: number): Promise<MenuRect | null>;
  setScreen(s: Screen): Promise<void>;
  /** Highlights item `index` of the current screen's menu, and nothing else. */
  setMenuIndex(index: number): Promise<void>;
  /** Sets the title menu's remembered selection, and nothing else. */
  setTitleIndex(index: number): Promise<void>;
  setScore(points: number): Promise<void>;
  setLives(n: number): Promise<void>;
  setDepth(d: number): Promise<void>;
  setMaze(rows: readonly string[]): Promise<void>;
  setPlankton(tx: number, ty: number, present: boolean): Promise<void>;
  clearPlankton(): Promise<void>;
  clearFog(): Promise<void>;
  setForagerTile(tx: number, ty: number): Promise<void>;
  setForagerDir(dir: Dir): Promise<void>;
  setBrightness(g: number): Promise<void>;
  setBrightHold(seconds: number): Promise<void>;
  clearPredators(): Promise<void>;
  addPredator(kind: PredatorKind, tx: number, ty: number): Promise<void>;
  setPredatorTile(index: number, tx: number, ty: number): Promise<void>;
  setPredatorDir(index: number, dir: Dir): Promise<void>;
  setPredatorState(index: number, value: PosablePredatorState): Promise<void>;
  setPredatorReleased(index: number, released: boolean): Promise<void>;
  setPredatorMind(index: number, enabled: boolean): Promise<void>;
  setPredatorTravel(index: number, enabled: boolean): Promise<void>;
  spawnDrifter(tx: number, ty: number): Promise<void>;
  clearDrifters(): Promise<void>;
  setDrifterMind(index: number, enabled: boolean): Promise<void>;
  setDrifterTravel(index: number, enabled: boolean): Promise<void>;
  setSonarCooldown(seconds: number): Promise<void>;
  setInkCooldown(seconds: number): Promise<void>;
}

/* -------------------------------------------------------------------------- */
/* The harness, bound to this case                                            */
/* -------------------------------------------------------------------------- */

/**
 * The shared harness, with Fathom's snapshot, Fathom's surface and Fathom's
 * figures bound into it.
 *
 * `projectRoot` comes from THIS module and must never come from the package's:
 * the package is staged one directory deeper than this file, and a produced
 * replay or still is addressed by the running suite's path relative to the
 * project root. Taken from the package it would address every output one level
 * too deep — and silently, because a writer that raised on a failed write would
 * be blaming the build for the host's problem, so neither of them raises.
 */
const kit = createCaseHarness<FathomSnapshot, FathomDebugApi>({
  slug: "fathom",
  handle: HANDLE,
  requiredOps: REQUIRED_OPS,
  // `advance(ticks)`: a number of whole ticks of the build's OWN fixed length.
  // Fathom fixes the timestep itself, so the surface is handed a count and never
  // a duration — a build told a span of seconds instead would integrate one tick
  // of a second.
  step: { kind: "count", op: "advance" },
  stage: { width: STAGE_W, height: STAGE_H },
  tickHz: TICK_HZ,
  // A GENUINE browser gesture, so the build's audio can open: a build is free to
  // open its audio context from a real DOM event alone (both are conformant), so
  // a key delivered any other way would leave a perfectly good build silent.
  // `UNBOUND_KEY` is bound to nothing (specs/controls.md), so arming changes no
  // game state.
  arm: { kind: "key", code: UNBOUND_KEY },
  // Fathom's menus take a finger as well as a mouse and the keyboard
  // (`specs/ui.md`), so the context reports a touchscreen: a contact arrives as
  // `pointerType: "touch"` and `navigator.maxTouchPoints` is non-zero, which is
  // the device a build offering touch controls has to believe it is on. The
  // package defaults it off, and a contact driven on a context without a
  // touchscreen throws rather than arriving as a mouse.
  hasTouch: true,
  // Every text call carries the width it was measured at and the alignment in
  // force, because four points read a run of text as a PLACE rather than as a
  // word: `instrumentation/menu-rect` holds a reported region against the point
  // an item was drawn at, and the `hud/*` points hold each readout inside the
  // strip `specs/ui.md` gives it. It costs one crossing into the page per frame
  // read, and the widths are measured in the page against the build's own loaded
  // fonts, which is the only place they mean anything.
  measureText: true,
  // One animation frame before a pixel is read. `specs/instrumentation.md` has
  // `advance` redraw the canvas, so on a conforming build the picture is already
  // the one the last tick left — but a build that presents on its own frame
  // instead has drawn the same state a moment later, and waiting costs a sample
  // nothing but a frame. The recorder is in manual mode there, so the frame it
  // waits for closes nothing and no recording sees it.
  awaitFrameBeforeRead: true,
  // FIFTEEN SECONDS RATHER THAN THE FIVE A SHORTER CASE ALLOWS, because the
  // ceiling is not really on the build: it is on the host. This project holds
  // four pages of one browser open at once and the machine that runs it is
  // running a model's build under it, so a page can be starved of processor long
  // enough for a perfectly conforming build's entry module to take seconds of
  // wall clock to run. Five seconds was observed to fail such a build once in a
  // suite run; fifteen costs a healthy build nothing, because the poll returns
  // the instant the global appears.
  surfaceTimeoutMs: 15_000,
  projectRoot: dirname(fileURLToPath(import.meta.url)),
});

export const {
  captureReplay,
  captureStill,
  watchCues,
  fitViewport,
  failSurface,
  SURFACE_REQUIREMENT,
  seconds,
  ticks,
  speedOverTicks,
} = kit;

/** One step of a {@link Harness.scan}: the clock, what sounded, and the state. */
export interface ScanReading {
  /** The harness's own tick counter once the step had run. */
  tick: number;
  /** How many sounds the build emitted during it. */
  sounds: number;
  /** The state that step left. */
  snapshot: FathomSnapshot;
}

/**
 * Everything a check reads off one page running this build.
 *
 * The shared harness's interface bound to this case, so every
 * `import { type Harness } from "../harness"` next door goes on naming a harness
 * whose `snapshot()` is a {@link FathomSnapshot} and whose `debug` is a
 * {@link FathomDebugApi} — plus the one reading that is Fathom's own.
 */
export interface Harness extends BaseHarness<FathomSnapshot, FathomDebugApi> {
  /**
   * Run `ticks` whole ticks in steps of `poll`, and hand back what each step
   * left: the clock, the sounds the build emitted during it, and the state.
   *
   * THE READING THE CADENCE POINTS ARE MADE OF. `specs/progression.md` plays a
   * cue "on the tick its event happens", and `specs/predators/gloamfin.md` times
   * a ping's cadence in seconds, so those checks need a SERIES rather than a
   * final state: what sounded on each step, and what the game looked like when it
   * did. Neither can be read off a batched `advance`, which reaches the same
   * state and says nothing about when inside it anything happened.
   *
   * The sounds come from a cue sink opened for this scan alone, which the shared
   * harness stamps with the tick that emitted each one — so a step's own count is
   * the sounds that arrived while it ran, however many ticks it covered.
   */
  scan(ticks: number, poll?: number): Promise<ScanReading[]>;
}

/**
 * Open a page on this build, with Fathom's own readings bound onto the harness.
 *
 * The shared factory does the work; what is added here is {@link Harness.scan},
 * which is the case's rather than the package's.
 */
export async function createHarness(
  options?: HarnessOptions,
): Promise<Harness> {
  const base = await kit.createHarness(options);
  // ONE CUE SINK PER PAGE, opened on the first scan and kept. A sink attached by
  // `watchCues` cannot be detached, and every later tick pushes into every sink
  // there is, so opening one per call would make a scan in a loop cost more with
  // each turn of it. What a reading reports is the sounds since the LAST reading,
  // so a sink that carries earlier scans' cues is read from where this one starts.
  let played: TimedCue[] | null = null;
  return Object.assign(base, {
    async scan(ticks: number, poll = 1): Promise<ScanReading[]> {
      played ??= kit.watchCues(base);
      const readings: ScanReading[] = [];
      let heard = played.length;
      let covered = 0;
      const stride = Math.max(1, Math.floor(poll));
      while (covered < ticks) {
        const step = Math.min(stride, ticks - covered);
        const snapshot = await base.step(step);
        covered += step;
        readings.push({
          tick: base.tick(),
          sounds: played.length - heard,
          snapshot,
        });
        heard = played.length;
      }
      return readings;
    },
  });
}

/** What a sweep found: whether the predicate ever held, and where it stopped. */
export type UntilResult = BaseUntilResult<FathomSnapshot>;

export type {
  Clock,
  DrawCall,
  HarnessOptions,
  NearSample,
  Pixel,
  Point,
  RecordedFrame,
  RecordedOp,
  RecordedPathSegment,
  RecordedResource,
  RecordedState,
  Recording,
  Rgb,
  TimedCue,
  UntilOptions,
  Viewport,
} from "./case-harness/index";

export {
  callsTo,
  closeWorkerBrowser,
  retable,
  setsOf,
  thinReplay,
  DEFAULT_REPLAY_BACKGROUND as REPLAY_BACKGROUND,
} from "./case-harness/index";

/* ---- Reaching live play --------------------------------------------------- */

/**
 * Reset on a seed and enter live play, through the debug surface alone.
 *
 * `reset` restores every field to its title-screen value and `setScreen` puts
 * the game straight into live play (`specs/instrumentation.md`), so this reaches
 * the board a dive is played on without pressing a menu key: a build with a
 * broken title menu and correct movement must fail the menu points and pass the
 * movement ones. A check that is ABOUT the menus drives them itself and never
 * calls this.
 *
 * The board it leaves is the game's OWN: the maze a reset laid out, a plankton
 * on every corridor tile, and the depth's roster in the den. A check poses the
 * world it is about on top of that, and {@link poseMaze} is what strips this one
 * away.
 *
 * An omitted `seed` takes `DEFAULT_SEED` (`1`), which
 * `specs/instrumentation.md` fixes, so a scenario that turns on the board a
 * build laid out replays exactly either way.
 */
export async function startPlaying(
  h: Harness,
  seed?: number,
): Promise<FathomSnapshot> {
  await h.debug.reset(seed);
  await h.debug.setScreen("playing");
  return h.snapshot();
}

/**
 * Return the game to its title screen: `reset`, and nothing else.
 *
 * `reset` puts every declared field at its title-screen value
 * (`specs/instrumentation.md`), which includes `menuIndex` and `titleIndex` at
 * `0`, so a menu check that opens here knows the selection it starts from
 * without posing one.
 */
export async function openTitle(h: Harness, seed?: number): Promise<void> {
  await h.debug.reset(seed);
}

/* ---- Menus, driven by a real mouse and a real finger ---------------------- */
//
// The menus take a pointer and a touch contact as well as the keyboard
// (`specs/ui.md`), and WHERE a build lays the items out is the build's own — so a
// check asks the build where it put an item, through `menuItemRect`
// (`specs/instrumentation.md`), and drives Chromium's real mouse or a real touch
// contact at that region. Nothing here poses a pointer through the surface: a
// pose would tell the build where the pointer is without making its own input
// layer see a press, a travel and a release the way a hand does, and what those
// checks are about is precisely that the build reads them.
//
// Each part of a gesture runs exactly ONE driven frame, so a caller counting
// frames can add them up. That comes from the shared harness's drivers, and this
// file spells no gesture of its own.

/**
 * Where the build put item `index` of the menu the current screen shows.
 *
 * Fails by assertion when the build reports no region for an item its own menu
 * shows, so the point names that fault rather than dividing by a `null` several
 * lines later. A check that is ABOUT the reading returning `null` — on the four
 * screens that show no menu, or past the end of a menu — calls
 * `h.debug.menuItemRect` directly.
 */
export async function menuRect(h: Harness, index: number): Promise<MenuRect> {
  const rect = await h.debug.menuItemRect(index);
  assertTruthy(
    rect,
    `menuItemRect(${index}) to report the hit region of item ${index} on the ` +
      "menu the current screen shows (specs/instrumentation.md)",
  );
  return rect as MenuRect;
}

/** The middle of a hit region: where a gesture aimed at that item lands. */
export function rectCenter(rect: MenuRect): Point {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/** Move the real mouse onto item `index`, and run the frame that reads it. */
export async function pointerOntoItem(
  h: Harness,
  index: number,
): Promise<void> {
  const at = rectCenter(await menuRect(h, index));
  await mouseGlide(h, at.x, at.y);
}

/** Press and release the real mouse inside item `index`'s region: two frames. */
export async function clickItem(h: Harness, index: number): Promise<void> {
  const at = rectCenter(await menuRect(h, index));
  await mousePress(h, at.x, at.y);
  await mouseRelease(h);
}

/**
 * Press on one item, travel to another, and release there: three driven frames.
 *
 * The two edges fall in different regions, so this confirms nothing — the
 * affordance that lets a player slide off a control to cancel, which
 * `specs/ui.md` states and a check reads back as a screen that did not change.
 */
export async function dragBetweenItems(
  h: Harness,
  from: number,
  to: number,
): Promise<void> {
  const start = rectCenter(await menuRect(h, from));
  const end = rectCenter(await menuRect(h, to));
  await mousePress(h, start.x, start.y);
  await mouseGlide(h, end.x, end.y);
  await mouseRelease(h);
}

/**
 * Land a real touch contact inside item `index`'s region and LEAVE IT DOWN.
 *
 * A confirm takes both of its edges inside one region and the lift is the second
 * of them (`specs/ui.md`), so a gesture that stops at the landing is the one
 * gesture that isolates what the landing alone did.
 */
export async function touchOntoItem(h: Harness, index: number): Promise<void> {
  const at = rectCenter(await menuRect(h, index));
  await touchPress(h, at.x, at.y);
}

/**
 * Land a real touch contact inside item `index`'s region and lift it there.
 *
 * The landing selects the item as well as confirming it, because a finger does
 * not hover (`specs/ui.md`) — which is the difference between this and
 * {@link clickItem}, and the reason both exist.
 */
export async function tapItem(h: Harness, index: number): Promise<void> {
  const at = rectCenter(await menuRect(h, index));
  await touchPress(h, at.x, at.y);
  await touchRelease(h);
}

/**
 * Press and release the real mouse at one point of the stage: two frames.
 *
 * For a screen that carries no item regions. `specs/ui.md` gives a gesture
 * completed on `"howto"` its effect anywhere on the screen rather than over a
 * region the build laid out, so there is nothing to ask `menuItemRect` for.
 */
export async function clickScreenAt(h: Harness, at: Point): Promise<void> {
  await mousePress(h, at.x, at.y);
  await mouseRelease(h);
}

/**
 * Land and lift a real touch contact at one point of the stage: two frames.
 *
 * The counterpart of {@link clickScreenAt} for a finger, and for the same reason.
 */
export async function tapScreenAt(h: Harness, at: Point): Promise<void> {
  await touchPress(h, at.x, at.y);
  await touchRelease(h);
}

/** Land a contact on one item, travel to another, and lift there: confirms nothing. */
export async function touchBetweenItems(
  h: Harness,
  from: number,
  to: number,
): Promise<void> {
  const start = rectCenter(await menuRect(h, from));
  const end = rectCenter(await menuRect(h, to));
  await touchPress(h, start.x, start.y);
  await touchGlide(h, end.x, end.y);
  await touchRelease(h);
}

/* ---- Reading colors ------------------------------------------------------- */
//
// TWO OF THE THREE READINGS BELOW ARE THE SHARED HARNESS'S UNDER FATHOM'S NAME,
// and which one is bound matters. The package ships two ways of reducing a color
// to one number — `luminance`, Rec. 709 weighted, and `meanChannel`, unweighted —
// and two ways of averaging — `meanColor` over a rectangle, and `meanOf` over a
// run of sampled points. Every threshold in this suite was measured against the
// UNWEIGHTED mean of a run of points, so those are the two that are bound here,
// under the names the checks already say. Binding the weighted one instead would
// compile perfectly and rescale every brightness bound in the trench.

export {
  colorDistance,
  rgbOf,
  ringPoints,
  sampleRing,
  meanOf as meanColor,
  meanChannel as luminance,
};

/**
 * How far out from a tile's center the cluster a color is averaged over reaches,
 * in logical units.
 *
 * Four units stays well inside one `TILE` (`32`), so the whole cluster is on the
 * tile it is sampling. A cluster rather than one pixel is what keeps a stray
 * anti-aliased pixel or a hair of dithering from swinging a reading, and it is
 * the same five points the engine-backed harnesses read, so a point can state one
 * threshold and mean the same thing by it under all three.
 */
const TILE_SAMPLE_RADIUS = 4;

/**
 * The mean color at each tile's center, in the order given.
 *
 * Every sample crosses into the page, so the whole set is taken in ONE crossing
 * rather than one per tile.
 */
export async function sampleTiles(
  h: Pick<Harness, "pixels">,
  grid: GridFrame,
  tiles: readonly Tile[],
): Promise<Rgb[]> {
  const clusters = tiles.map((tile) => {
    const center = tileCenter(grid, tile);
    return clusterPoints(center.x, center.y, TILE_SAMPLE_RADIUS);
  });
  const read = await h.pixels(clusters.flat());
  let taken = 0;
  return clusters.map((cluster) => {
    const color = meanOf(read.slice(taken, taken + cluster.length));
    taken += cluster.length;
    return color;
  });
}

/** The mean color at one tile's center, on the board a snapshot reports. */
export async function tileColor(
  h: Pick<Harness, "pixels">,
  snapshot: FixtureBoard,
  tile: Tile,
): Promise<Rgb> {
  const [color] = await sampleTiles(h, snapshot.grid, [tile]);
  return color;
}

/* ---- Reading a mote ------------------------------------------------------- */

/** One sample of a mote's profile: the mean color of a ring about its center. */
export interface MoteSample {
  radius: number;
  color: Rgb;
}

/**
 * The radii, in logical units out from a mote's center, a profile is read at.
 *
 * WHY A PROFILE AND NOT ONE RING. `specs/sensing.md` fixes the mote's color and
 * that it is a single glowing point, and nothing else: not its radius, not how
 * bright its core is, not how fast the glow falls off. A build that draws the
 * light tighter paints an unmistakable amber mote that one fixed ring reads as
 * dark fog, and a build that draws it wider blows that ring out to white. Both
 * are the mote the specification asks for, so "is it warm" is asked of the
 * profile rather than of one arbitrary ring.
 */
export const MOTE_RADII: readonly number[] = [0, 2, 4, 6, 8, 10];

/** How far from a reported position a mote's drawn light may sit, in units. */
export const MOTE_SEARCH = 12;

/**
 * The color is RED-LEANING: the reading `specs/overview.md` gives the two amber
 * lights, "red-leaning and clearly warmer than the water, the rock, and the
 * forager's own light".
 *
 * The one predicate for the whole suite. Every reading of an amber light — the
 * bulb, the drifter, the pair a sonar pulse must leave alone, the light the
 * Kindle circle clips away — asks this and nothing else, so two checks cannot
 * disagree about what amber is. Deliberately a HUE test and nothing more: the
 * palette is the build's, and no figure anywhere fixes how bright an amber mote
 * is or how fast its glow falls off, so a threshold on brightness would fail a
 * build that draws a dimmer light and satisfies every stated requirement.
 */
export function isWarm(color: Rgb): boolean {
  return color.r > color.b;
}

/**
 * The brightest not-cool point within {@link MOTE_SEARCH} of `(x, y)`: a mote's
 * drawn center, wherever on the body the build chose to put it.
 *
 * A mote is drawn on a creature, and where on that creature the light sits is the
 * build's art: one draws the glow on the entity's center, another puts it at the
 * top of the sprite as a bulb on a bell would be. `specs/sensing.md` fixes the
 * light's color and that it is always drawn; it does not fix it to the unit the
 * snapshot reports the creature at. Cool pixels are rejected, so the trench and
 * the forager's own glow cannot be mistaken for one; an amber core that blows out
 * toward white is not, which is why the test is `r >= b` rather than
 * {@link isWarm}.
 *
 * Falls back to `(x, y)` when the neighborhood holds nothing that is not cool, so
 * a build that draws no mote is read exactly where it should have drawn one.
 */
export async function findMote(
  h: Pick<Harness, "pixels">,
  x: number,
  y: number,
): Promise<Point> {
  const samples = await samplePoints(
    h,
    gridPoints(x, y, MOTE_SEARCH, MOTE_FIND_STEP),
  );
  const found = brightestIn(
    samples,
    meanChannel,
    (color) => color.r >= color.b,
  );
  return found === null ? { x, y } : { x: found.x, y: found.y };
}

/** How coarsely {@link findMote} walks a mote's neighborhood, in logical units. */
const MOTE_FIND_STEP = 6;

/** A mote's color profile, innermost first, read about its own drawn center. */
export async function sampleMoteProfile(
  h: Pick<Harness, "pixels">,
  x: number,
  y: number,
): Promise<MoteSample[]> {
  return moteProfileAbout(h, await findMote(h, x, y));
}

/** A mote's color profile read about a center already measured. */
export async function moteProfileAbout(
  h: Pick<Harness, "pixels">,
  center: { x: number; y: number },
): Promise<MoteSample[]> {
  const rings = MOTE_RADII.map((radius) =>
    ringPoints(center.x, center.y, radius),
  );
  const read = await h.pixels(rings.flat());
  let taken = 0;
  return MOTE_RADII.map((radius, index) => {
    const color = meanOf(read.slice(taken, taken + rings[index].length));
    taken += rings[index].length;
    return { radius, color };
  });
}

/**
 * How far apart two motes are drawn: the LARGEST color distance between their
 * samples at the same radius.
 *
 * Comparing like radius with like keeps the reading honest. Two motes drawn
 * identically match at every radius, and one drawn differently — a wider halo, a
 * colder core, a body drawn beneath — separates somewhere in the profile even
 * where it happens to agree on one ring.
 */
export function profileDistance(
  a: readonly MoteSample[],
  b: readonly MoteSample[],
): number {
  let worst = 0;
  for (let i = 0; i < a.length && i < b.length; i += 1) {
    worst = Math.max(worst, colorDistance(a[i].color, b[i].color));
  }
  return worst;
}

/**
 * The brightest WARM sample of a profile, or `null` when none of it reads warm.
 *
 * Brightest, because an amber core is the brightest thing in a dark trench and a
 * check that settled for the dim outer halo would measure the glow's falloff
 * rather than the light. Warm, because that core blows out toward white on a
 * build that draws it hot, and taking the brightest sample without regard to hue
 * would read that blow-out as neutral and call an unmistakable amber mote cold.
 */
export function warmInProfile(
  profile: readonly MoteSample[],
): MoteSample | null {
  let best: MoteSample | null = null;
  for (const sample of profile) {
    if (!isWarm(sample.color)) continue;
    if (best === null || meanChannel(sample.color) > meanChannel(best.color)) {
      best = sample;
    }
  }
  return best;
}

/**
 * How finely {@link brightestNear} walks a mote's neighborhood, in logical units.
 *
 * Three units across the {@link MOTE_SEARCH} reach is 81 samples, fine enough to
 * land inside the halo of a mote a build draws only a few units across, and
 * coarse enough that a check reading two creatures pays for it once.
 */
export const MOTE_STEP = 3;

/**
 * Every pixel within {@link MOTE_SEARCH} of `(x, y)`, on a fixed grid.
 *
 * Read one point at a time rather than averaged, because a mote is small: a
 * cluster average over the whole neighborhood would wash an unmistakable light
 * out to the fog around it.
 */
async function nearSamples(
  h: Pick<Harness, "pixels">,
  x: number,
  y: number,
): Promise<NearSample[]> {
  return samplePoints(h, gridPoints(x, y, MOTE_SEARCH, MOTE_STEP));
}

/** The brightest pixel within {@link MOTE_SEARCH} of `(x, y)`, whatever its hue. */
export async function brightestNear(
  h: Pick<Harness, "pixels">,
  x: number,
  y: number,
): Promise<NearSample> {
  const samples = await nearSamples(h, x, y);
  // The grid always carries its own center, so there is always a brightest.
  return samples.reduce((best, sample) =>
    meanChannel(sample.color) > meanChannel(best.color) ? sample : best,
  );
}

/**
 * The brightest RED-LEANING pixel within {@link MOTE_SEARCH} of `(x, y)`, or
 * `null` where the neighborhood holds none: a creature's amber light, wherever on
 * its body the build chose to draw it.
 *
 * The hue test is {@link isWarm} and nothing more. HOW FAR above the fog it must
 * read is stated by the check, against a fog sample the check took itself.
 */
export async function brightestWarmNear(
  h: Pick<Harness, "pixels">,
  x: number,
  y: number,
): Promise<NearSample | null> {
  return brightestIn(await nearSamples(h, x, y), meanChannel, isWarm);
}
