// Floe — the case's half of the validator harness. CASE-PROVIDED.
//
// Every check in this suite is an ordinary vitest test that drives the built site
// IN A REAL BROWSER. There is nothing to import: an engineless run seeds no
// `src/` at all, so the build wrote its own frame loop, its own canvas fit, its
// own keyboard, its own pointer, its own audio, its own sprite loading, its own
// debug overlay and its own `window.__floe` — and the only place any of that
// exists is a page that has loaded the bundle. So the project serves the produced
// site, loads it in Chromium, and reaches the game the way anything reaches it:
// over the surface `specs/instrumentation.md` told the build to install.
//
// IT IS STILL A VITEST PROJECT, AND THAT IS DELIBERATE. The runner locates the
// build output before it chooses between the vitest and browser paths, so the
// produced site is on disk by the time this project runs. Staying a vitest
// project is what lets the case name ONE script per review item and have it
// resolve under all three engines — `validation/water/floe-carries.test.ts` is
// the same path whichever engine the run selected — and what keeps `format = 2`
// resolution passing.
//
// THE MACHINERY THAT DRIVES THE PAGE IS NOT FLOE'S. Serving the build, connecting
// to the one browser, opening a page per harness, injecting the draw-command
// recorder and the audio probe, bracketing each driven tick around one step of
// the build's surface, driving the real mouse and the real finger, reading pixels
// and draw calls back out, and writing the evidence a review point declares —
// every engineless case needs exactly that, and it lives once, in
// `@test-cabinet/case-harness`, staged beside this file as `./case-harness/`.
// What is left here is what is genuinely Floe's: the operations its
// `specs/instrumentation.md` requires, the shape of its snapshot, the way it
// divides an interval into calls, the readings it makes off its own seeded art,
// and the scenarios its checks are posed from.
//
// The seam is one call. `createCaseHarness` takes the case's TYPES as type
// arguments and the case's VALUES as one object, and hands back the machinery
// with Floe's names and Floe's types on it — so the suites next door go on
// importing `createHarness`, `captureReplay`, `startCrossing` and the tick
// arithmetic from `../harness` exactly as they did.
//
// WHAT A CHECK READS. The game's own state (through `window.__floe`'s
// `snapshot`), the ticks the harness itself drove, the operations the build
// issued against its 2D context, the bitmaps it handed those operations, the
// pixels they left on the canvas, and the sounds it emitted. Nothing here
// fabricates an outcome: the scenario helpers below only ARRANGE the strait
// through the surface, and the real update the build wrote is what runs from
// there.
//
// THE HARNESS OWNS EVERY COMPOUND SEQUENCE. The debug surface is atomic by
// design — each operation poses one field, reads the state, or moves the clock
// (`guides/authoring/writing-debug-apis-and-validators.md`) — so "open a crossing
// at level 3 with the strait cleared" is a helper here, built out of those atomic
// operations, and never an operation on the surface. A check that needs only part
// of a sequence calls the operations it needs: nothing a check does not ask for
// happens.
//
// AND THE HELPERS FIX GEOMETRY, NEVER THRESHOLDS. A helper poses a strait, drives
// a scenario, or reads a value out of a snapshot. Every tolerance a check
// asserts — a fraction of a tile, a colour distance, a number of units — is
// stated in that check, next to the figure `specs/` fixes for it, because a
// helper that carried the tolerance would hide what the check is really
// asserting. Look for a threshold in this file and you will not find one.
//
// THE CLOCK IS THE SURFACE'S. Nothing outside an engineless build owns its loop,
// so `specs/instrumentation.md` puts the clock on the surface: `setAutoStep(false)`
// takes the game off real time and `advance(ticks)` runs whole `TICK_DT` ticks.
// Every harness opens by taking the game off the clock, so a check asks for a
// number of ticks and gets exactly that number — no polling, no waiting, and no
// measurement of the machine it ran on. The one check that is ABOUT the loop
// running itself (`instrumentation/advances-in-real-time`) hands it back with
// `Harness.runFor`.
//
// EVERYTHING CROSSING INTO THE PAGE IS ASYNC. That is the whole of the difference
// between a suite here and its counterpart under an engine: `await h.snapshot()`
// rather than `h.snapshot()`, `await h.debug.setCritterTile(...)` rather than
// `h.debug.setCritterTile(...)`. The scenarios, the tolerances, and the
// assertions are the same ones, because they are the case's rather than the
// runtime's.
//
// ONE SERVER, ONE BROWSER, ONE PAGE PER HARNESS. `globalSetup.ts` starts the
// server and the browser once for the whole project; the shared harness connects
// to them from inside each suite's worker and opens a page per harness, so every
// check drives a build that has just started and no check can be affected by
// what the one before it pressed, opened or muted.

import { createCanvas, loadImage } from "@napi-rs/canvas";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createCaseHarness,
  imageDraws,
  sampleColor,
  type Harness as BaseHarness,
  type HarnessOptions,
  type PixelRect,
  type Rgb,
  type TimedCue,
  type UntilResult as BaseUntilResult,
} from "./case-harness/index";
import { fail } from "./assert";
import {
  BINDINGS,
  COLS,
  HANDLE,
  HOP_COOLDOWN,
  HOP_KEY,
  ICE_ROWS,
  ITEM_LEN,
  OVERLAY_KEY,
  PLOW_W,
  ROWS,
  ROW_NEAR,
  SPRITE_SHEETS,
  SPRITE_TILE,
  STAGE_H,
  STAGE_W,
  START_COL,
  START_LIVES,
  TICK_DT,
  TICK_HZ,
  TILE,
  UNBOUND_KEY,
  WATER_ROWS,
  colAt,
  crossingTimer,
  rowAt,
  tileCX,
  tileCY,
  tileLeft,
  tileTop,
  type Facing,
  type FloeKind,
  type Footing,
  type LaneDir,
  type Phase,
  type Screen,
  type SheetName,
  type VehicleKind,
} from "./constants";
/* -------------------------------------------------------------------------- */
/* The contract the build owes                                                */
/* -------------------------------------------------------------------------- */

/** The version the surface reports (`FLOE_DEBUG_VERSION`). */
export const FLOE_DEBUG_VERSION = 1;

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
  "menuItemRect",
  // The screen and the run.
  "setScreen",
  "setPhase",
  "setPhaseTimer",
  "setMenuIndex",
  "setScore",
  "setLives",
  "setLevel",
  "setReachedLevel",
  "setTimer",
  // The world gates.
  "setBearEmergence",
  "setCatchTest",
  "setFishCadence",
  "setTimerRunning",
  // The critter.
  "addCritter",
  "removeCritter",
  "setCritterTile",
  "setCritterX",
  "setCritterFacing",
  "setHopCooldown",
  "setBestRow",
  // The bears.
  "addBear",
  "removeBear",
  "clearBears",
  "setBearTile",
  "setBearPosition",
  "setBearStep",
  "setBearTarget",
  "setBearSense",
  "setBearRouting",
  "setBearTravel",
  // The lanes.
  "addVehicle",
  "removeVehicle",
  "clearVehicles",
  "setVehicleX",
  "addFloe",
  "removeFloe",
  "clearFloes",
  "setFloeX",
  "setLaneSpeed",
  "setLaneDirection",
  // The bays and the bonus catch.
  "setBay",
  "clearBays",
  "setFishBay",
  "clearFish",
] as const;

/**
 * One menu item's hit region, in logical units: `x`/`y` are its top-left corner
 * and `w`/`h` its size (`specs/instrumentation.md`).
 *
 * NOT part of the snapshot, and deliberately so: the regions are geometry the
 * build laid out rather than run state, and `menuItemRect` is the separate read
 * that reports them.
 */
export interface MenuRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One tile of the strait. */
export interface Tile {
  col: number;
  row: number;
}

/** The critter, as a snapshot reports it. `x`/`y` is its CENTER. */
export interface CritterView {
  present: boolean;
  col: number;
  row: number;
  x: number;
  y: number;
  facing: Facing;
  footing: Footing;
  hopCooldown: number;
  bestRow: number;
}

/** One bear, as a snapshot reports it. `x`/`y` is its CENTER. */
export interface BearView {
  id: number;
  /** The tile it last settled on. */
  col: number;
  row: number;
  /** The tile it is travelling into; equal to `col`/`row` while settled. */
  stepCol: number;
  stepRow: number;
  x: number;
  y: number;
  facing: Facing;
  swimming: boolean;
  target: { col: number; row: number };
  sense: boolean;
  routing: boolean;
  travel: boolean;
}

/** One lane's motion, as a snapshot reports it. */
export interface LaneView {
  row: number;
  dir: LaneDir;
  speed: number;
}

/** One vehicle or one floe, as a snapshot reports it. `x` is its LEFT EDGE. */
export interface ItemView {
  id: number;
  row: number;
  kind: VehicleKind | FloeKind;
  x: number;
  /** Its length, in tiles. It spans `[x, x + TILE * len)` on its row. */
  len: number;
}

/**
 * The state a snapshot reports, exactly as `specs/instrumentation.md` shapes it.
 *
 * Every field an operation can pose is here, which is what makes every pose
 * verifiable by set-then-read. `muted` is the exception in the other direction:
 * no operation sets it, and it is the runtime's own mute bit, reached the way a
 * player reaches it through `KeyM`.
 */
export interface FloeSnapshot {
  version: number;
  screen: Screen;
  phase: Phase;
  phaseTimer: number;
  menuIndex: number;
  level: number;
  reachedLevel: number;
  lives: number;
  score: number;
  timer: number;
  timerMax: number;
  muted: boolean;
  bearEmergence: boolean;
  catchTest: boolean;
  fishCadence: boolean;
  timerRunning: boolean;
  bays: boolean[];
  fishBay: number | null;
  critter: CritterView;
  bears: BearView[];
  iceLanes: LaneView[];
  waterLanes: LaneView[];
  vehicles: ItemView[];
  floes: ItemView[];
  simTime: number;
}

/** The operations a check poses the game through. Every one crosses into the page. */
export interface FloeDebugApi {
  // The clock.
  setAutoStep(enabled: boolean): Promise<void>;
  advance(ticks: number): Promise<void>;

  // The core.
  reset(options?: { seed?: number }): Promise<void>;
  snapshot(): Promise<FloeSnapshot>;
  menuItemRect(index: number): Promise<MenuRect | null>;

  // The screen and the run.
  setScreen(screen: Screen): Promise<void>;
  setPhase(phase: Phase): Promise<void>;
  setPhaseTimer(seconds: number): Promise<void>;
  setMenuIndex(index: number): Promise<void>;
  setScore(score: number): Promise<void>;
  setLives(lives: number): Promise<void>;
  setLevel(level: number): Promise<void>;
  setReachedLevel(level: number): Promise<void>;
  setTimer(seconds: number): Promise<void>;

  // The world gates.
  setBearEmergence(enabled: boolean): Promise<void>;
  setCatchTest(enabled: boolean): Promise<void>;
  setFishCadence(enabled: boolean): Promise<void>;
  setTimerRunning(enabled: boolean): Promise<void>;

  // The critter.
  addCritter(col: number, row: number): Promise<void>;
  removeCritter(): Promise<void>;
  setCritterTile(col: number, row: number): Promise<void>;
  setCritterX(x: number): Promise<void>;
  setCritterFacing(facing: Facing): Promise<void>;
  setHopCooldown(seconds: number): Promise<void>;
  setBestRow(row: number): Promise<void>;

  // The bears.
  addBear(col: number, row: number): Promise<void>;
  removeBear(id: number): Promise<void>;
  clearBears(): Promise<void>;
  setBearTile(id: number, col: number, row: number): Promise<void>;
  setBearPosition(id: number, x: number, y: number): Promise<void>;
  setBearStep(id: number, direction: Facing): Promise<void>;
  setBearTarget(id: number, col: number, row: number): Promise<void>;
  setBearSense(id: number, enabled: boolean): Promise<void>;
  setBearRouting(id: number, enabled: boolean): Promise<void>;
  setBearTravel(id: number, enabled: boolean): Promise<void>;

  // The lanes.
  addVehicle(row: number, kind: VehicleKind, x: number): Promise<void>;
  removeVehicle(id: number): Promise<void>;
  clearVehicles(): Promise<void>;
  setVehicleX(id: number, x: number): Promise<void>;
  addFloe(row: number, kind: FloeKind, x: number): Promise<void>;
  removeFloe(id: number): Promise<void>;
  clearFloes(): Promise<void>;
  setFloeX(id: number, x: number): Promise<void>;
  setLaneSpeed(row: number, speed: number): Promise<void>;
  setLaneDirection(row: number, dir: LaneDir): Promise<void>;

  // The bays and the bonus catch.
  setBay(index: number, filled: boolean): Promise<void>;
  clearBays(): Promise<void>;
  setFishBay(index: number): Promise<void>;
  clearFish(): Promise<void>;
}

/* -------------------------------------------------------------------------- */
/* The clock: how an interval is divided into calls                           */
/* -------------------------------------------------------------------------- */
//
// Floe's timestep is FIXED, and that is the whole difference from the cases whose
// engineless surface takes an elapsed time. `specs/overview.md` fixes
// `TICK_HZ` (120) ticks a second and `specs/instrumentation.md` gives the surface
// `advance(ticks)`, so a suite asks for whole ticks and nothing is rounded on the
// way in: every duration the specification states is a count of ticks, exactly.
//
// What a suite still chooses is HOW an interval is divided into calls, and that
// is what the clocks below supply. `instrumentation/deterministic-core` is the
// item about the division: the same second of game time, driven as one call and
// as a hundred and twenty, must reach the same state, and a jittered division
// must reach it too.

/**
 * The whole ticks covering `duration` seconds.
 *
 * FLOE'S OWN, AND DELIBERATELY NOT THE SHARED HARNESS'S. The kit's `ticksFor`
 * rounds UP; this one rounds to nearest, and a hundred and two call sites in
 * this project were written against that. Taking the kit's would silently move
 * every one of them by a tick, which is exactly the kind of quiet rescale the
 * shared harness refuses to make representable — so the two spellings stay
 * apart and this project binds the one it has always meant.
 *
 * Rounded rather than floored: every duration `specs/` fixes is stated in
 * seconds and the tick is `1/120` s, so a figure like `HOP_COOLDOWN` (`0.12` s)
 * is `14.4` ticks and a check that wants "the cooldown, elapsed" wants the first
 * whole tick at or past it. A check that needs the tick BEFORE a boundary says
 * so itself, with its own arithmetic.
 */
export function ticksFor(duration: number): number {
  return Math.round(duration * TICK_HZ);
}

/** The whole ticks that reach at least `duration` seconds. */
export function ticksPast(duration: number): number {
  return Math.ceil(duration * TICK_HZ - 1e-9);
}

/** A source of call sizes, in whole ticks: how an interval is divided up. */
export interface Clock {
  /** The next call's size, in whole ticks. Always at least one. */
  ticks(): number;
}

/** Every call the same number of ticks. */
export class ConstantClock implements Clock {
  constructor(private readonly size: number) {
    if (!Number.isInteger(size) || size < 1) {
      throw new RangeError(
        `ConstantClock needs a whole size >= 1, got ${size}`,
      );
    }
  }
  ticks(): number {
    return this.size;
  }
}

/** A repeating pattern of call sizes: an uneven but predictable division. */
export class SequenceClock implements Clock {
  private index = 0;
  constructor(private readonly sizes: readonly number[]) {
    if (sizes.length === 0) {
      throw new RangeError("SequenceClock needs at least one size, got none");
    }
  }
  ticks(): number {
    const size = this.sizes[this.index % this.sizes.length];
    this.index += 1;
    return Math.max(1, Math.round(size));
  }
}

/**
 * A hash of the seed and the call index, avalanched so that neighbouring
 * indices — which is all a call counter ever produces — do not yield
 * neighbouring outputs. The constants and the order are the engine's
 * (`packages/simple-2d/src/clocks.ts`), so a seed means the same thing here as
 * it does in the two engine-backed projects next door.
 */
function hash32(seed: number, index: number): number {
  let h =
    (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(index | 0, 0x85ebca6b)) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h, 0x21f0aaad) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 0x735a2d97) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return h >>> 0;
}

/**
 * A seeded draw from a range of call sizes: the division that stands in for a
 * real machine under load. The seed is mandatory, because a claim that a build
 * reaches the same state however the interval was divided is worth making only
 * when the failing division replays.
 */
export class JitterClock implements Clock {
  private index = 0;
  private readonly span: number;
  constructor(
    private readonly min: number,
    max: number,
    private readonly seed: number,
  ) {
    if (min < 1) throw new RangeError(`JitterClock needs min >= 1, got ${min}`);
    if (max < min) {
      throw new RangeError(
        `JitterClock needs max >= min, got min ${min} and max ${max}`,
      );
    }
    this.span = max - min + 1;
  }
  ticks(): number {
    const index = this.index;
    this.index += 1;
    return (
      this.min +
      Math.floor((hash32(this.seed, index) / 0x1_0000_0000) * this.span)
    );
  }
}

/** `total` ticks divided into calls of the sizes `clock` supplies. */
export function divide(total: number, clock: Clock): number[] {
  const calls: number[] = [];
  let left = Math.max(0, Math.trunc(total));
  while (left > 0) {
    const size = Math.min(left, Math.max(1, Math.trunc(clock.ticks())));
    calls.push(size);
    left -= size;
  }
  return calls;
}

/* -------------------------------------------------------------------------- */
/* The harness                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The shared harness, with Floe's snapshot, Floe's surface and Floe's figures
 * bound into it.
 *
 * `projectRoot` comes from THIS module and must never come from the package's:
 * the package is staged one directory deeper than this file, and a produced
 * replay or still is addressed by the running suite's path relative to the
 * project root. Taken from the package it would address every output one level
 * too deep — and silently, because a writer that raised on a failed write would
 * be blaming the build for the host's problem, so neither of them raises.
 */
const kit = createCaseHarness<FloeSnapshot, FloeDebugApi>({
  slug: "floe",
  handle: HANDLE,
  requiredOps: REQUIRED_OPS,
  // `advance(ticks)`: a run of whole ticks of the build's own fixed length.
  // Floe's timestep is FIXED — `specs/overview.md` fixes `TICK_HZ` (120) ticks a
  // second and `specs/instrumentation.md` gives the surface `advance(ticks)` —
  // so the suite asks for whole ticks and nothing is rounded on the way in.
  step: { kind: "count", op: "advance" },
  stage: { width: STAGE_W, height: STAGE_H },
  tickHz: TICK_HZ,
  // A GENUINE browser gesture, so the build's audio can open: a build is free to
  // open its audio context from a real DOM event alone (both are conformant), so
  // a gesture delivered any other way would leave a perfectly good build silent.
  // `specs/controls.md` leaves this key bound to nothing, so arming changes no
  // game state — which is what `controls/unbound-key-does-nothing` grades.
  arm: { kind: "key", code: UNBOUND_KEY },
  // Floe's menus are driven by a finger as well as by a mouse and the keyboard
  // (`specs/ui.md`), so the context reports a touchscreen: a contact arrives as
  // `pointerType: "touch"` and `navigator.maxTouchPoints` is non-zero, which is
  // the device a build offering touch controls has to believe it is on.
  hasTouch: true,
  // EVERY PIXEL READING WAITS FOR A PAINT FIRST. `specs/instrumentation.md` has
  // `advance` leave the canvas showing the state the most recent tick left, and
  // a build that draws inside `advance` has already painted it — but a build
  // that draws only from its own animation frame is equally conformant, and
  // reading its canvas straight after a drive would sample the frame BEFORE the
  // one the check posed. Waiting one animation frame costs a conforming build
  // one frame and is the difference between grading the picture a check made and
  // grading the one before it. Ten of this project's points read pixels.
  awaitFrameBeforeRead: true,
  // A frame's text calls carry their measured width and the alignment in force,
  // because `strait/hud-above-strait` reads where a readout SITS rather than
  // only which strings were drawn.
  measureText: true,
  projectRoot: dirname(fileURLToPath(import.meta.url)),
});

export const {
  fitViewport,
  failSurface,
  SURFACE_REQUIREMENT,
  seconds,
  speedOverTicks,
} = kit;

/**
 * The shared harness's own view of one of ours.
 *
 * A Floe harness IS the object the kit built — `createHarness` below adds this
 * case's four readings to it in place rather than wrapping it — so the writers
 * and the cue reader operate on exactly the harness a check holds. The cast is
 * needed only because this project narrows `skipUntil` to the SECONDS the
 * specification states its cadences in, which is a different option shape from
 * the kit's; nothing else about the two views differs.
 */
function shared(h: Harness): BaseHarness<FloeSnapshot, FloeDebugApi> {
  return h as unknown as BaseHarness<FloeSnapshot, FloeDebugApi>;
}

/** Record the ticks `scenario` drives as the review item's `outputId` output. */
export function captureReplay<T>(
  h: Harness,
  outputId: string,
  scenario: () => T | Promise<T>,
): Promise<T> {
  return kit.captureReplay(shared(h), outputId, scenario);
}

/** Keep the picture on the canvas as the review item's `outputId` output. */
export function captureStill(h: Harness, outputId: string): Promise<void> {
  return kit.captureStill(shared(h), outputId);
}

/**
 * Collect every sound the build emits from now on, stamped with the tick of the
 * drive it sounded on.
 *
 * WHAT IS OBSERVED, AND WHY IT IS THE FAIR READING. `specs/ui.md` requires one
 * cue per event, played on the tick its event happens, and says nothing at all
 * about how a build makes a sound beyond asking it to synthesize with the Web
 * Audio API — under this engine the whole audio layer is the build's. So the
 * shared harness watches the two doors a browser can emit sound through and
 * counts what goes through them, bracketing each driven tick around that count,
 * so a sound is attributed to the tick that produced it. A hop blip made of a
 * tone and a noise burst counts as two, which is why a check asserts that a call
 * sounded rather than how many times.
 *
 * WHAT IS LOST HERE THAT AN ENGINE GIVES. The cue's NAME. Under an engine the
 * game asks the bus for `CUES.hop` by name and the bus announces it, so a build
 * that plays its menu blip on every hop is caught. There is no bus here to ask,
 * so these checks confirm that a sound was emitted and when, and a reviewer
 * decides by ear whether the ten are told apart. That is a real reduction, and
 * the alternative — inferring the cue from the waveform the reference happens to
 * use — would grade builds against an implementation rather than against the
 * specification. NO CHECK IN THIS PROJECT MAY ASSERT A CUE NAME.
 *
 * A sound emitted inside {@link Harness.skip} is attributed to nothing, since a
 * skip closes no recorded tick: run the ticks a cue check reads with
 * {@link Harness.advance}.
 */
export function watchCues(h: Harness): TimedCue[] {
  return kit.watchCues(shared(h));
}

/**
 * The workspace root: the directory the build was produced in.
 *
 * Derived from this file's own URL rather than from the working directory, so it
 * names the same place in both layouts this project lives in — the case's own
 * `validation/none/`, and the `validation/` the runner stages it to inside the
 * build's tree. What reads it is the seeded art below, which is committed beside
 * the build rather than produced by it.
 */
const WORKSPACE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Everything a check reads off one page running this build, plus the seven
 * readings that are Floe's own.
 *
 * The shared harness supplies the rest, so `import { type Harness } from
 * "../harness"` next door goes on naming a harness whose `snapshot()` is a
 * {@link FloeSnapshot} and whose `debug` is a {@link FloeDebugApi}.
 *
 * `advance` and `skip` are RESTATED rather than inherited, because Floe means
 * something of its own by each. `advance(ticks, clock)` divides the interval
 * into calls the way `instrumentation/deterministic-core` varies, and
 * `skip(duration)` takes SECONDS of game time rather than a count of ticks,
 * which is how every cadence in `specs/bays.md` is stated.
 */
export interface Harness extends Omit<
  BaseHarness<FloeSnapshot, FloeDebugApi>,
  "advance" | "skip" | "skipUntil"
> {
  /**
   * Run several operations of the build's own surface, in order, in ONE crossing
   * into the page.
   *
   * A POSE IS ARRANGEMENT, NEVER A MEASUREMENT. Each entry is exactly the call
   * `h.debug.<op>(...)` would have made — the build's own operation, the caller's
   * own arguments, in the order written — and the build's rules run from whatever
   * they leave behind, on the next tick, exactly as before. What crossing them
   * together removes is a round trip to the browser per FIELD, and what a round
   * trip costs is a property of how busy the machine is rather than of the build:
   * `startCrossing` alone arranges eighteen of them, and every suite in this
   * project opens with it.
   *
   * Use it for a run of poses with no reading between them. Where a pose's
   * argument comes from a reading — an id the roster has to report first — the
   * reading goes between two calls of this, not inside one.
   */
  poseAll(poses: readonly Pose[]): Promise<void>;
  /**
   * Run `ticks` whole simulation ticks, one recorded tick at a time.
   *
   * `clock` divides the interval into `advance` calls of its own sizes instead,
   * which is what `instrumentation/deterministic-core` varies. Each such call is
   * one crossing into the page and closes no recorded tick, so a capture running
   * across it keeps nothing — a check that wants both a division and a recording
   * is asking two different questions.
   */
  advance(ticks: number, clock?: Clock): Promise<void>;
  /**
   * Run `ticks` ticks ONE AT A TIME and hand back the state each of them left,
   * oldest first — in a single crossing into the page.
   *
   * WHY THIS EXISTS. A tick driven from Node costs a round trip to the browser
   * and back, and reading the state after it costs another; a check that watches
   * four seconds of a bear's glide tick by tick pays nine hundred and sixty of
   * them, and what a round trip costs is not a property of the build but of how
   * busy the machine is. The ticks here are exactly the ticks the loop below
   * would have run — one `advance(1)` each, one `snapshot()` after each, in the
   * same order — and the only thing that changes is that they are asked for
   * together.
   */
  sample(ticks: number): Promise<FloeSnapshot[]>;
  /**
   * {@link sample}, with one operation of the build's own surface run before a
   * tick — `pose(state)` decides which, from the state as it stands.
   *
   * For the checks that have to act BETWEEN ticks: re-committing a bear's step on
   * the tick it settles, say. The decision stays here, in the case's own rules,
   * so this cannot batch a whole run into one crossing.
   */
  sampleWith(
    ticks: number,
    pose: (snapshot: FloeSnapshot) => Pose | null,
  ): Promise<FloeSnapshot[]>;
  /**
   * Run `duration` SECONDS of game time in one call, closing no recorded tick.
   *
   * The same real ticks the loop runs, but off camera: a capture running across
   * it keeps nothing, so a section that has to sit through eight seconds of the
   * bonus catch's cadence costs a replay nothing. Seconds rather than ticks
   * because every cadence `specs/bays.md` states is stated in seconds.
   */
  skip(duration: number): Promise<void>;
  /** {@link skip} until `predicate` holds, sampling every `pollSeconds`. */
  skipUntil(
    predicate: (snapshot: FloeSnapshot) => boolean,
    options?: SkipOptions,
  ): Promise<SkipResult>;
  /** Give the build a real, browser-trusted gesture, so its audio can open. */
  armAudio(): Promise<void>;
}

/** One operation of the build's own surface, as {@link Harness.poseAll} takes it. */
export interface Pose {
  op: string;
  args: readonly unknown[];
}

/** What a sweep found: whether the predicate ever held, and where it stopped. */
export type UntilResult = BaseUntilResult<FloeSnapshot>;

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
 * Open a page on the build, take the game off its own clock, and give it the
 * seven readings that are Floe's own.
 *
 * All seven sit over the shared harness rather than beside it: `poseAll`,
 * `sample`, `sampleWith` and `armAudio` reach the page through the harness's own
 * `page` and its own drive, and `advance`, `skip` and `skipUntil` restate the
 * units the shared pair count in. Nothing here holds state of its own.
 */
export async function createHarness(
  options: HarnessOptions = {},
): Promise<Harness> {
  const base = await kit.createHarness(options);
  // Taken before the seven readings below are put on the object, because three
  // of them are written over the pair they delegate to.
  const driveTicks = base.advance.bind(base);
  const marchTicks = base.skip.bind(base);
  const readState = base.snapshot.bind(base);
  const readStep = base.step.bind(base);
  const watchTicks = base.stepWatching.bind(base);

  /** Run a run of poses of the build's own surface, in order, in one crossing. */
  const poseAll = async (poses: readonly Pose[]): Promise<void> => {
    if (base.surfaceFault !== null) failSurface(base.surfaceFault);
    if (poses.length === 0) return;
    await base.page.evaluate(
      ([handle, ops]) => {
        const api = (
          window as unknown as Record<
            string,
            Record<string, (...a: unknown[]) => unknown>
          >
        )[handle];
        for (const { op, args } of ops) api[op](...args);
      },
      [
        HANDLE,
        poses.map((pose) => ({ op: pose.op, args: [...pose.args] })),
      ] as const,
    );
  };

  // ADDED IN PLACE, NOT WRAPPED. `captureReplay`, `captureStill` and
  // `watchCues` all key on the harness OBJECT the kit built, so a copy of it
  // would collect no cues and write no evidence.
  return Object.assign(base, {
    poseAll,

    async advance(ticks: number, clock?: Clock): Promise<void> {
      const whole = Math.max(0, Math.trunc(ticks));
      if (whole === 0) return;
      if (clock === undefined) {
        await driveTicks(whole);
        return;
      }
      // A divided interval: one call of the build's own `advance` per size the
      // clock hands out, which is the division the point is about.
      for (const size of divide(whole, clock)) await marchTicks(size);
    },

    sample(ticks: number): Promise<FloeSnapshot[]> {
      return watchTicks(Math.max(0, Math.trunc(ticks)));
    },

    async sampleWith(
      ticks: number,
      pose: (snapshot: FloeSnapshot) => Pose | null,
    ): Promise<FloeSnapshot[]> {
      const whole = Math.max(0, Math.trunc(ticks));
      const series: FloeSnapshot[] = [];
      let state = await readState();
      for (let tick = 0; tick < whole; tick += 1) {
        const posed = pose(state);
        if (posed !== null) await poseAll([posed]);
        state = await readStep(1);
        series.push(state);
      }
      return series;
    },

    async skip(duration: number): Promise<void> {
      const whole = Math.max(0, ticksFor(duration));
      if (whole === 0) return;
      await marchTicks(whole);
    },

    async skipUntil(
      predicate: (snapshot: FloeSnapshot) => boolean,
      options: SkipOptions = {},
    ): Promise<SkipResult> {
      const maxSeconds = options.maxSeconds ?? 60;
      const pollSeconds = Math.max(
        TICK_DT,
        options.pollSeconds ?? seconds(ticksFor(0.25)),
      );

      let snapshot = await readState();
      if (predicate(snapshot)) return { hit: true, elapsed: 0, snapshot };

      let elapsed = 0;
      while (elapsed < maxSeconds) {
        const step = Math.min(pollSeconds, maxSeconds - elapsed);
        await marchTicks(Math.max(1, ticksFor(step)));
        snapshot = await readState();
        elapsed += step;
        if (predicate(snapshot)) return { hit: true, elapsed, snapshot };
      }
      return { hit: false, elapsed, snapshot };
    },

    /**
     * A real, browser-trusted key press on a key `specs/controls.md` binds to
     * nothing, which is what opens a build's audio context.
     *
     * A build is free to open its audio from a real DOM event alone, so the
     * gesture has to be a genuine one; the key is the unbound one, so the game
     * state a check has already posed is untouched by it.
     */
    async armAudio(): Promise<void> {
      await base.page.keyboard.press(UNBOUND_KEY);
      await driveTicks(1);
    },
  }) as unknown as Harness;
}

/* ---- What the shared harness reads, under this project's own names --------- */

export type {
  DrawCall,
  PixelRect,
  Recording,
  Rgb,
  TextDraw,
  TimedCue,
  Viewport,
} from "./case-harness/index";

export {
  colorDistance,
  drawnText,
  drewText,
  mouseGlide,
  mousePress,
  mouseRelease,
  sampleColor,
  textDraws,
  touchGlide,
  touchPress,
  touchRelease,
} from "./case-harness/index";

/* ---- The menus, as a pointer and a finger reach them ----------------------- */
//
// `specs/ui.md` leaves each menu's ARRANGEMENT to the build and requires the
// build to report where it put each item, through `menuItemRect`
// (`specs/instrumentation.md`). So a check that drives a menu with a pointer asks
// the build where the item is and aims at the middle of the region it named:
// every layout passes, and a build that reports a region it does not answer on is
// the only one that fails. The gestures themselves are the shared harness's
// `mousePress`/`touchPress` and their neighbours, re-exported above.

/**
 * The region the build reports for item `index` of the menu on screen.
 *
 * A missing region fails the check that asked for one, with the screen named:
 * `specs/instrumentation.md` requires a region for every index of the menu the
 * current screen shows, so a `null` here is the build's answer rather than the
 * check's mistake.
 */
export async function menuRect(h: Harness, index: number): Promise<MenuRect> {
  const screen = (await h.snapshot()).screen;
  const rect = await h.debug.menuItemRect(index);
  if (rect === null) {
    fail(
      `menuItemRect(${index}) to report a region on the ${screen} screen ` +
        "(specs/instrumentation.md)",
      "null",
    );
  }
  return rect;
}

/** The centre of a reported region: where a gesture aimed at that item lands. */
export function rectCenter(rect: MenuRect): { x: number; y: number } {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}
/* -------------------------------------------------------------------------- */
/* The seeded sprite art                                                      */
/* -------------------------------------------------------------------------- */
//
// `specs/assets.md` seeds seven folders under `assets/` and requires that the
// critter, the bear, the three vehicles and the two floes are each drawn FROM
// their folder rather than from art of the build's own. What that requires is
// identity — the bitmap handed to a draw IS a seeded frame — so the reading is
// the bitmap, not the pixels it left on the stage: a build is free to tint,
// scale or glow what it blits, and a stage sample would grade the tint rather
// than the art.
//
// A REGION RATHER THAN A FRAME, because two of the things drawn are sub-rects.
// `specs/assets.md` makes the three-tile raft the LEFT `96 x 32` of
// `assets/raft/0.png` and the four-tile raft the whole of `assets/raft/1.png`,
// so the seeded side carries both the whole frames and those two named regions,
// and a draw that cropped its source is compared against the region it cropped
// to. {@link SeededFrame.region} is what a check names when the distinction
// matters (`presentation/sprite-raft3` against `presentation/sprite-raft4`) and
// what it ignores when it does not.
//
// WHERE THE FRAMES COME FROM, AND WHY THERE IS NO `fetch` SHIM HERE. Under an
// engine, a validator runs the build's own module in this node process and the
// engine's loader reaches for `fetch` and `createImageBitmap`, so those two
// globals have to be stood up over the workspace's `assets/` tree. Under THIS
// engine nothing of the sort happens: the build loads its own art in the page,
// where both globals are the browser's real ones, and the only thing this
// process loads is the seeded PNGs it compares against — off disk, through
// `@napi-rs/canvas`, which the case seeds for exactly this. Shimming a global
// here would stand in for a call nothing makes.
//
// WHAT THE BUILD DREW comes back through the shared harness: `frameCalls` runs
// one tick and hands over every operation that tick's render issued, `imageDraws`
// picks the `drawImage` calls out of them with the transform in force applied,
// and `Harness.imagePixels` reads a drawn source's OWN bytes back out of the
// page at its natural size. That last one is what an identity comparison needs —
// the bitmap the build handed the draw rather than the corner of the stage it
// landed on.

/** One seeded frame, or a named region of one, as the comparison reads it. */
export interface SeededFrame {
  /** The folder it came from. */
  sheet: SheetName;
  /** The frame index within that folder. */
  index: number;
  /**
   * Which part of the frame this is: `"full"` for the whole of it, or the name
   * `specs/assets.md` gives the sub-rect — `"raft3"` for the left `96 x 32` of
   * `assets/raft/0.png`, `"raft4"` for the whole of `assets/raft/1.png`.
   */
  region: string;
  width: number;
  height: number;
  /** Premultiplied RGBA channels, row-major. */
  pixels: Float64Array;
}

/** One region of one seeded frame the comparison holds. */
interface SeededRegion {
  sheet: SheetName;
  index: number;
  region: string;
  crop?: { x: number; y: number; width: number; height: number };
}

/**
 * Every region the comparison holds: each folder's frames whole, plus the two
 * the two long floes are cut from.
 *
 * The whole of `assets/raft/0.png` is kept as well as its left `96 x 32`, so a
 * build that drew the whole frame where the three-tile art belongs is reported
 * as having drawn `raft` frame `0` region `full` — a legible failure rather than
 * a draw that matched nothing.
 */
function seededRegions(): SeededRegion[] {
  const regions: SeededRegion[] = [];
  for (const [sheet, spec] of Object.entries(SPRITE_SHEETS)) {
    for (let index = 0; index < spec.frames; index += 1) {
      regions.push({ sheet: sheet as SheetName, index, region: "full" });
    }
  }
  regions.push({
    sheet: "raft",
    index: 0,
    region: "raft3",
    crop: { x: 0, y: 0, width: PLOW_W, height: SPRITE_TILE },
  });
  regions.push({ sheet: "raft", index: 1, region: "raft4" });
  return regions;
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
 * frame of assets/crosser/", with no number of its own.
 */
const MATCH_MAX = 1;

/**
 * A drawable source's premultiplied RGBA channels, optionally cropped to a
 * sub-rect.
 *
 * Premultiplied, because that is what survives a round trip through a canvas
 * intact: drawing a bitmap in multiplies each channel by the pixel's alpha and
 * reading it back divides again, so a partially transparent pixel is quantized
 * twice. Comparing the products compares what both sides actually hold.
 *
 * The crop is what makes the comparison hold for a build that composed an atlas
 * of its own and blits out of it with the nine-argument `drawImage`: what is
 * compared is then the sub-rect the draw named rather than the sheet behind it.
 */
function channelsOf(
  source: { width: number; height: number },
  crop?: Crop,
): Float64Array {
  const width = Math.max(1, Math.round(crop?.width ?? source.width));
  const height = Math.max(1, Math.round(crop?.height ?? source.height));
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, width, height);
  // The cast is the one this comparison needs: everything handed here is a
  // bitmap this canvas implementation can blit, and the two decoders it comes
  // from do not share a nominal type.
  if (crop === undefined) {
    ctx.drawImage(source as never, 0, 0);
  } else {
    ctx.drawImage(
      source as never,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      width,
      height,
    );
  }
  return premultiplied(ctx.getImageData(0, 0, width, height).data);
}

/** A sub-rect of a source, in the source's own pixels. */
interface Crop {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The same channels, from the bytes the page handed back for a drawn source. */
function channelsOfRect(rect: PixelRect, crop?: Crop): Float64Array {
  if (crop === undefined) return premultiplied(rect.data);
  const x = Math.max(0, Math.round(crop.x));
  const y = Math.max(0, Math.round(crop.y));
  const width = Math.max(1, Math.round(crop.width));
  const height = Math.max(1, Math.round(crop.height));
  const cut = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const from = ((y + row) * rect.width + x) * 4;
    cut.set(rect.data.subarray(from, from + width * 4), row * width * 4);
  }
  return premultiplied(cut);
}

/** RGBA bytes with each colour channel multiplied by its own alpha. */
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

/** The mean absolute difference between two channel buffers, out of 255. */
function difference(a: Float64Array, b: Float64Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

let seededFramesPromise: Promise<readonly SeededFrame[]> | null = null;

/**
 * Every seeded region `specs/assets.md` lists, read off the workspace's own
 * `assets/` tree.
 *
 * Decoded once per suite worker and shared, because every sprite point in the
 * project wants the same thirty-two frames and decoding them is the one slow
 * thing this module does.
 */
export function seededFrames(): Promise<readonly SeededFrame[]> {
  seededFramesPromise ??= (async () => {
    const decoded = new Map<string, Awaited<ReturnType<typeof loadImage>>>();
    const frames: SeededFrame[] = [];
    for (const entry of seededRegions()) {
      const spec = SPRITE_SHEETS[entry.sheet];
      const key = `${spec.folder}/${entry.index}`;
      let image = decoded.get(key);
      if (image === undefined) {
        image = await loadImage(
          join(WORKSPACE_ROOT, "assets", spec.folder, `${entry.index}.png`),
        );
        decoded.set(key, image);
      }
      frames.push({
        sheet: entry.sheet,
        index: entry.index,
        region: entry.region,
        width: entry.crop?.width ?? image.width,
        height: entry.crop?.height ?? image.height,
        pixels: channelsOf(image, entry.crop),
      });
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
   * `specs/assets.md` requires exactly this of a vehicle in a lane whose `dir`
   * is `-1`: each vehicle's art faces right and is drawn mirrored horizontally,
   * so every vehicle faces the way its lane runs. Under a rotation these read
   * the sign of the mapped box's corners, which is the mirror only for the
   * upright draws the specification asks for.
   */
  flipX: boolean;
  flipY: boolean;
  /** The source bitmap's own size, before any destination scaling. */
  source: { width: number; height: number };
  /** The seeded frames this draw's source is identical to; empty when it is none. */
  matches: SeededFrame[];
}

/**
 * Run one tick and hand back every `drawImage` it issued, each matched against
 * the seeded art.
 *
 * The draws come off the shared harness's `frameCalls`, which drives exactly one
 * recorded tick and hands over the operations that tick's render made;
 * `imageDraws` applies the transform in force at each so a sprite drawn under a
 * translate reports where it actually landed. The SOURCE's own bytes come back
 * separately, through `Harness.imagePixels`, because what
 * `specs/assets.md` requires is identity between the bitmap a draw was handed
 * and a seeded frame — not a likeness between the stage and a picture.
 */
export async function blitsOfFrame(h: Harness): Promise<Blit[]> {
  const seeded = await seededFrames();
  const draws = imageDraws(await h.frameCalls());

  // The pixels of a source are read once per bitmap, however many draws name it:
  // a strait of forty vehicles is forty draws of the same five frames.
  const channels = new Map<string, Float64Array | null>();
  const blits: Blit[] = [];
  for (const draw of draws) {
    const crop =
      draw.sx === null ||
      draw.sy === null ||
      draw.sw === null ||
      draw.sh === null
        ? undefined
        : { x: draw.sx, y: draw.sy, width: draw.sw, height: draw.sh };
    const key = `${draw.image.id}|${
      crop === undefined
        ? "*"
        : `${crop.x},${crop.y},${crop.width},${crop.height}`
    }`;
    let drawn = channels.get(key);
    if (drawn === undefined) {
      const rect = await h.imagePixels(draw.image.id);
      // A source the page no longer holds carries no pixels; it matches nothing
      // rather than matching everything.
      drawn = rect === null ? null : channelsOfRect(rect, crop);
      channels.set(key, drawn);
    }
    blits.push({
      x: draw.cx,
      y: draw.cy,
      width: Math.abs(draw.dw),
      height: Math.abs(draw.dh),
      flipX: draw.dw < 0,
      flipY: draw.dh < 0,
      source: { width: draw.image.width, height: draw.image.height },
      matches: drawn === null ? [] : seededMatches(seeded, drawn),
    });
  }
  return blits;
}

/**
 * Every blit whose source is a frame of `sheet` and whose destination centre is
 * within `within` logical units of `at`.
 *
 * `within` is the caller's, because how close a sprite has to sit to the body it
 * draws is the check's requirement rather than this helper's —
 * `specs/assets.md` says a 32 x 32 frame is drawn centred on its subject's own
 * centre, and the check states how much of a tile it will allow.
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

/**
 * Every blit whose source is exactly the named REGION of `sheet` and whose
 * destination centre is within `within` logical units of `at`.
 *
 * The narrower sibling of {@link drawnFrom}, for the two draws
 * `specs/assets.md` cuts out of one frame: `"raft3"` is the left `96 x 32` of
 * `assets/raft/0.png` and `"raft4"` the whole of `assets/raft/1.png`.
 */
export function drawnRegion(
  blits: readonly Blit[],
  sheet: SheetName,
  region: string,
  at: { x: number; y: number },
  within: number,
): Blit[] {
  return blits.filter(
    (blit) =>
      Math.hypot(blit.x - at.x, blit.y - at.y) <= within &&
      blit.matches.some(
        (frame) => frame.sheet === sheet && frame.region === region,
      ),
  );
}

/** Every blit drawn from any frame of `sheet`, in the order they were drawn. */
export function blitsOf(blits: readonly Blit[], sheet: SheetName): Blit[] {
  return blits.filter((blit) =>
    blit.matches.some((frame) => frame.sheet === sheet),
  );
}

/**
 * Where a lane item's art is drawn: the centre of the box spanning its tiles.
 *
 * `specs/assets.md` draws a lane item's frame from its own `x` with its top on
 * its row's top edge, `TILE` units wide per tile it spans, so the box's centre
 * is half its span to the right of its left edge. What {@link drawnFrom} is
 * given for a vehicle or a floe.
 */
export function itemArtCentre(item: { x: number; row: number; len: number }): {
  x: number;
  y: number;
} {
  return {
    x: item.x + (TILE * item.len) / 2,
    y: tileTop(item.row) + TILE / 2,
  };
}

/* -------------------------------------------------------------------------- */
/* Pixels: the two readings that are the strait's own                         */
/* -------------------------------------------------------------------------- */
//
// `specs/overview.md` fixes NO PALETTE — the colours, the type and the look are
// the build's — and what it states instead, that a player can tell the bands, the
// water, the bays and the bodies apart at a glance, is the REVIEWER's to judge. No
// check here holds one thing the build drew against another. A pixel reading
// answers presence and nothing else: that the picture at a point changed when the
// thing the specification puts there was posed or taken away.
//
// The sampling itself — a small cluster averaged, a difference between two
// readings — is the shared harness's `sampleColor` and `colorDistance`,
// re-exported above. What is Floe's is WHERE a reading is taken: a tile of the
// strait, and a row of it read across five columns.

/** {@link sampleColor} at a tile's centre. */
export function sampleTile(h: Harness, col: number, row: number): Promise<Rgb> {
  return sampleColor(h, tileCX(col), tileCY(row));
}

/**
 * The colour of a row, read across five columns spread along it and averaged.
 *
 * How a reading of a whole BAND is taken rather than of one tile of it: a single
 * tile is a poor reading of a strip a build is free to texture, drift or shade,
 * and the columns are spread so no one readout, banner or item a scenario put on
 * the row dominates the average.
 */
export const BAND_COLUMNS: readonly number[] = [4, 12, 20, 28, 36];

/** {@link sampleColor} averaged across {@link BAND_COLUMNS} of one row. */
export async function sampleRow(h: Harness, row: number): Promise<Rgb> {
  let r = 0;
  let g = 0;
  let b = 0;
  for (const col of BAND_COLUMNS) {
    const sample = await sampleTile(h, col, row);
    r += sample.r;
    g += sample.g;
    b += sample.b;
  }
  const count = BAND_COLUMNS.length;
  return { r: r / count, g: g / count, b: b / count };
}

/* -------------------------------------------------------------------------- */
/* Reading a snapshot                                                         */
/* -------------------------------------------------------------------------- */
//
// Plain readings over the shape `specs/instrumentation.md` fixes. They compute
// nothing a check could not compute itself; they exist so that thirteen groups
// of suites spell the same lookup the same way, and so that a lookup that finds
// nothing fails with the entity it wanted named rather than as a `TypeError` two
// lines later.

/** The bear with that id, or `undefined`. */
export function bearById(
  snapshot: FloeSnapshot,
  id: number,
): BearView | undefined {
  return snapshot.bears.find((bear) => bear.id === id);
}

/** The bear with that id, failing the check with the scenario it needed. */
export function requireBear(
  snapshot: FloeSnapshot,
  id: number,
  doing = "the scenario",
): BearView {
  const bear = bearById(snapshot, id);
  if (bear === undefined) {
    fail(
      `bear ${id} still on the strait (${doing})`,
      `bears ${JSON.stringify(snapshot.bears.map((b) => b.id))}`,
    );
  }
  return bear;
}

/** The vehicle with that id, or `undefined`. */
export function vehicleById(
  snapshot: FloeSnapshot,
  id: number,
): ItemView | undefined {
  return snapshot.vehicles.find((item) => item.id === id);
}

/** The floe with that id, or `undefined`. */
export function floeById(
  snapshot: FloeSnapshot,
  id: number,
): ItemView | undefined {
  return snapshot.floes.find((item) => item.id === id);
}

/** The lane item with that id, from either roster, or `undefined`. */
export function itemById(
  snapshot: FloeSnapshot,
  id: number,
): ItemView | undefined {
  return vehicleById(snapshot, id) ?? floeById(snapshot, id);
}

/** The lane item with that id, failing the check with the scenario it needed. */
export function requireItem(
  snapshot: FloeSnapshot,
  id: number,
  doing = "the scenario",
): ItemView {
  const item = itemById(snapshot, id);
  if (item === undefined) {
    fail(
      `lane item ${id} still on the strait (${doing})`,
      `vehicles ${JSON.stringify(
        snapshot.vehicles.map((v) => v.id),
      )}, floes ${JSON.stringify(snapshot.floes.map((f) => f.id))}`,
    );
  }
  return item;
}

/**
 * The last entry of a roster: the entity an `add` operation just appended.
 *
 * `specs/instrumentation.md` makes appending the rule precisely so an id is
 * findable without an assignment scheme, and these three are that rule.
 */
export function lastBear(snapshot: FloeSnapshot): BearView | undefined {
  return snapshot.bears[snapshot.bears.length - 1];
}

export function lastVehicle(snapshot: FloeSnapshot): ItemView | undefined {
  return snapshot.vehicles[snapshot.vehicles.length - 1];
}

export function lastFloe(snapshot: FloeSnapshot): ItemView | undefined {
  return snapshot.floes[snapshot.floes.length - 1];
}

/** The lane on a strait row, from whichever band carries it, or `undefined`. */
export function laneAt(
  snapshot: FloeSnapshot,
  row: number,
): LaneView | undefined {
  return (
    snapshot.iceLanes.find((lane) => lane.row === row) ??
    snapshot.waterLanes.find((lane) => lane.row === row)
  );
}

/** Every lane item on a strait row, from whichever band carries it. */
export function itemsOnRow(snapshot: FloeSnapshot, row: number): ItemView[] {
  return [...snapshot.vehicles, ...snapshot.floes].filter(
    (item) => item.row === row,
  );
}

/**
 * Whether a lane item covers a point on its row (`specs/ice.md`).
 *
 * One rule, read by both bands: an item's reported `x` is its LEFT EDGE and it
 * occupies `[x, x + TILE * len)`.
 */
export function covers(item: ItemView, x: number): boolean {
  return x >= item.x && x < item.x + TILE * item.len;
}

/** Whether a lane item covers a tile of its row: that tile's centre is covered. */
export function coversTile(item: ItemView, col: number): boolean {
  return covers(item, tileCX(col));
}

/** The tile a stage centre falls in (`specs/strait.md`). */
export function tileOf(x: number, y: number): Tile {
  return { col: colAt(x), row: rowAt(y) };
}

/** Whether two tiles are the same tile. */
export function sameTile(a: Tile, b: Tile): boolean {
  return a.col === b.col && a.row === b.row;
}

/** The tile a bear last settled on. */
export function bearTile(bear: BearView): Tile {
  return { col: bear.col, row: bear.row };
}

/** The tile a bear is travelling into; its own tile while it is settled. */
export function bearStepTile(bear: BearView): Tile {
  return { col: bear.stepCol, row: bear.stepRow };
}

/** Whether a bear is settled on a tile rather than between two. */
export function bearSettled(bear: BearView): boolean {
  return bear.col === bear.stepCol && bear.row === bear.stepRow;
}

/** The critter's tile, as the snapshot reports it. */
export function critterTile(snapshot: FloeSnapshot): Tile {
  return { col: snapshot.critter.col, row: snapshot.critter.row };
}

/* -------------------------------------------------------------------------- */
/* Scenario helpers                                                           */
/* -------------------------------------------------------------------------- */
//
// EVERY COMPOUND SEQUENCE IN THIS PROJECT LIVES HERE. The debug surface is
// atomic — `specs/instrumentation.md` gives it one operation per field — so
// there is no `startCrossing`, no `spawnBear(col, row, options)` and no
// `setLane({...})` to reach for on the surface, and there must not be: a patch
// operation would impose the case's own layout on the build. What a check wants
// instead is a helper, built out of those atomic operations, that poses the
// strait and then lets the build's own update run from there.
//
// A CHECK TAKES ONLY THE PART IT ASKS FOR. Nothing below does anything a caller
// did not ask for: `startCrossing` empties four rosters, shuts four gates and
// poses a screen, and a check that wants a bear asks for one. A check that needs
// half a sequence calls the operations it needs.
//
// AND NONE OF THEM ASSERTS A VERDICT. A helper fails only when the game is not
// even in the situation the caller's scenario needs, and then with what it
// needed named.

/**
 * Pose an empty, quiet, live crossing at `level`, ready for a scenario.
 *
 * The sequence, and why each part of it is in this order:
 *
 *   - `reset()`, then `setLevel(level)`. THE ORDER IS LOAD-BEARING: `setLevel`
 *     re-lays the sixteen lanes by design (`specs/instrumentation.md`), so a
 *     `setLevel` after the clears would put sixteen lanes of traffic straight
 *     back onto the strait the clears had just emptied. The level is therefore
 *     an argument here rather than a call a check makes afterwards, so the
 *     ordering cannot be got wrong item by item. An item that DOES change level
 *     after posing re-clears both rosters itself, unless the level's own layout
 *     is the thing it reads.
 *   - THE FOUR ROSTERS ARE EMPTIED. `clearVehicles`, `clearFloes`, `clearBears`,
 *     `clearBays`, and `clearFish` with them. An empty strait is safe because of
 *     the level-clear rule (`specs/bays.md`): a level clears on the HOP that
 *     fills its last open bay, so a strait whose bays were posed rather than
 *     hopped into is being played rather than cleared.
 *     `bays/posed-full-does-not-clear` is the item that grades that, and it is
 *     what makes every scenario below poseable.
 *   - THE FOUR WORLD GATES ARE SHUT. Without `setBearEmergence(false)` a bear
 *     emerges behind a critter three rows up and joins a scenario that never
 *     asked for one; without `setCatchTest(false)` a posed bear standing on the
 *     critter costs a life mid-scenario; without `setFishCadence(false)` a bonus
 *     catch arrives on its own eight-second cadence into a bay a check is
 *     reading; without `setTimerRunning(false)` the crossing timer drains under
 *     a scenario that runs for thirty seconds and takes a life at the end of it.
 *     Each gate is the RUN's own faculty rather than any entity's, which is why
 *     shutting it is not "parking an entity in a harmless corner". THE ITEMS
 *     THAT TURN A GATE BACK ON ARE THE ITEMS WHOSE REQUIREMENT THE GATE IS; any
 *     other check that finds itself wanting one has been mis-posed.
 *   - THE SCREEN IS LIVE. `playing`/`crossing` with the phase timer at rest, so
 *     the strait really is running rather than sitting behind a hold.
 *   - THE RUN IS FRESH. `START_LIVES` lives, no score, and the timer at
 *     `crossingTimer(level)`, which `setLevel` does not touch.
 *   - THE CRITTER IS ON THE NEAR SHORE at `START_COL`, facing `up`, with no hop
 *     cooldown and `bestRow` at `ROW_NEAR`, which is where a fresh crossing puts
 *     it (`specs/progression.md`) and the one body no scenario can remove.
 *
 * It poses no bear, no vehicle, no floe and no bonus catch: a check adds exactly
 * what its requirement concerns.
 */
export async function startCrossing(h: Harness, level = 1): Promise<void> {
  // Eighteen operations of the build's own surface, in this order, in one
  // crossing: nothing here reads the game between them. See
  // {@link Harness.poseAll}.
  await h.poseAll([
    { op: "reset", args: [] },
    { op: "setLevel", args: [level] },
    { op: "clearVehicles", args: [] },
    { op: "clearFloes", args: [] },
    { op: "clearBears", args: [] },
    { op: "clearBays", args: [] },
    { op: "clearFish", args: [] },
    { op: "setBearEmergence", args: [false] },
    { op: "setCatchTest", args: [false] },
    { op: "setFishCadence", args: [false] },
    { op: "setTimerRunning", args: [false] },
    { op: "setScreen", args: ["playing"] },
    { op: "setPhase", args: ["crossing"] },
    { op: "setPhaseTimer", args: [0] },
    { op: "setLives", args: [START_LIVES] },
    { op: "setScore", args: [0] },
    { op: "setTimer", args: [crossingTimer(level)] },
    { op: "addCritter", args: [START_COL, ROW_NEAR] },
  ]);
}

/**
 * Open a run the way a player does: from a reset title, confirm the highlighted
 * first item, `CROSS`.
 *
 * The route for a check about what a NEW RUN is — its lives, its level, its
 * score, its five open bays, its laid-out strait — none of which any pose can
 * produce, because `setLevel` starts no run and `setScore` grants nothing.
 * Nothing here is posed: `reset` is the surface's own, and the rest is a real
 * key through Chromium's input pipeline.
 */
export async function startRunFromTitle(
  h: Harness,
  options: { seed?: number } = {},
): Promise<void> {
  await h.debug.reset(options.seed === undefined ? undefined : options);
  await h.debug.setMenuIndex(0);
  await h.tap(BINDINGS.confirm[0]);
  await h.advance(1);
}

/**
 * Lay a run of lane items along one row, held still, and hand back their ids in
 * the order they were given.
 *
 * The lane is stopped FIRST (`setLaneSpeed(row, 0)`), so the items land where
 * the caller put them and stay there until the check starts the lane itself. A
 * check about motion sets the speed it means to measure; a check about covering,
 * footing or refusal wants the row exactly as it posed it.
 *
 * Each column is a LEFT EDGE at `tileLeft(col)`, which is what the surface
 * takes, and the roster follows from the row's band: rows `ICE_TOP`–`ICE_BOTTOM`
 * carry vehicles and rows `WATER_TOP`–`WATER_BOTTOM` carry floes. A row that
 * carries no lane at all — the shores and the median — is the caller's mistake
 * and is named as one.
 */
export async function poseLane(
  h: Harness,
  row: number,
  kind: VehicleKind | FloeKind,
  cols: readonly number[],
): Promise<number[]> {
  const ice = ICE_ROWS.includes(row);
  const water = WATER_ROWS.includes(row);
  if (!ice && !water) {
    fail(
      `a lane row: ${ICE_ROWS[0]}-${ICE_ROWS[ICE_ROWS.length - 1]} carry ` +
        `vehicles and ${WATER_ROWS[0]}-${WATER_ROWS[WATER_ROWS.length - 1]} ` +
        `carry floes (specs/strait.md)`,
      `row ${row}`,
    );
  }
  if (ice && !(kind in ITEM_LEN && ["plow", "dogsled", "car"].includes(kind))) {
    fail(`a vehicle kind on ice row ${row} (specs/ice.md)`, kind);
  }
  if (water && !["pan", "raft3", "raft4"].includes(kind)) {
    fail(`a floe kind on water row ${row} (specs/water.md)`, kind);
  }

  // The roster is read BEFORE the lane is touched, which is the same count:
  // `setLaneSpeed` moves nothing on and nothing off. That leaves the stop and the
  // adds a single run of poses with no reading between them.
  const posed = await h.snapshot();
  const before = ice ? posed.vehicles.length : posed.floes.length;
  await h.poseAll([
    { op: "setLaneSpeed", args: [row, 0] },
    ...cols.map((col) =>
      ice
        ? { op: "addVehicle", args: [row, kind as VehicleKind, tileLeft(col)] }
        : { op: "addFloe", args: [row, kind as FloeKind, tileLeft(col)] },
    ),
  ]);

  const laid = await h.snapshot();
  const roster = ice ? laid.vehicles : laid.floes;
  if (roster.length !== before + cols.length) {
    fail(
      `${ice ? "addVehicle" : "addFloe"} to append each item to its roster ` +
        `(specs/instrumentation.md)`,
      `the roster went from ${before} to ${roster.length} over ${cols.length} calls`,
    );
  }
  return roster.slice(before).map((item) => item.id);
}

/** Which of a bear's three faculties a scenario holds off, and what it hunts. */
export interface BearPose {
  /** Its reading of the critter's tile. Off, it keeps hunting the posed target. */
  sense?: boolean;
  /** Its choice of the next step. Off, it takes no new step on settling. */
  routing?: boolean;
  /** Its locomotion. Off, its centre and its two tiles hold. */
  travel?: boolean;
  /** The tile it hunts, for a scenario that poses one rather than the critter's. */
  target?: Tile;
}

/**
 * Settle one bear on a tile with the faculties a scenario asks for, and hand
 * back its id.
 *
 * `addBear` gives a bear all three faculties on, hunting its own tile
 * (`specs/instrumentation.md`), so the pose below only turns OFF what the
 * scenario named. That is the whole of the isolation these checks need: a check
 * on ROUTING poses `travel: false` and reads the step the bear chose without it
 * moving; a check on TRAVEL poses `routing: false` and a step of its own, so the
 * bear carries out exactly that step and no route can redirect it; a check on
 * SENSE poses `sense: false` and a target of its own, so the bear hunts a tile
 * the critter is not on.
 */
export async function poseBear(
  h: Harness,
  col: number,
  row: number,
  pose: BearPose = {},
): Promise<number> {
  await h.debug.addBear(col, row);
  const added = lastBear(await h.snapshot());
  if (added === undefined) {
    fail(
      "addBear to append a bear to the roster (specs/instrumentation.md)",
      "the bear roster was still empty after addBear",
    );
  }
  const id = added.id;
  // The id had to be read off the roster first, so the faculties this scenario
  // turns off go over in one crossing after it rather than one apiece.
  await h.poseAll([
    ...(pose.target === undefined
      ? []
      : [
          {
            op: "setBearTarget",
            args: [id, pose.target.col, pose.target.row],
          },
        ]),
    ...(pose.sense === undefined
      ? []
      : [{ op: "setBearSense", args: [id, pose.sense] }]),
    ...(pose.routing === undefined
      ? []
      : [{ op: "setBearRouting", args: [id, pose.routing] }]),
    ...(pose.travel === undefined
      ? []
      : [{ op: "setBearTravel", args: [id, pose.travel] }]),
  ]);
  return id;
}

/**
 * Take one hop the way a player does: hold the direction's key, run the tick
 * that delivers it, release, and run the cooldown out.
 *
 * A REAL PRESS rather than a pose, because a hop is what `specs/hopping.md` is
 * about: the tile it lands on, the facing it takes, the cooldown it sets, the
 * row it scores and the refusals that leave everything as it was are all
 * consequences of the game's own hop, and posing the critter onto a tile would
 * produce none of them.
 *
 * The cooldown is run out afterwards so a caller can hop again immediately.
 * `HOP_COOLDOWN` is `0.12` s, which is not a whole number of ticks, so what runs
 * is the first whole tick at or past it — `ticksPast` — and the critter is
 * therefore free to hop on the very next tick. A check that grades the CADENCE
 * itself drives the ticks by hand and does not use this.
 */
export async function hop(h: Harness, direction: Facing): Promise<void> {
  await h.hold(HOP_KEY[direction]);
  await h.advance(1);
  await h.release(HOP_KEY[direction]);
  await h.advance(ticksPast(HOP_COOLDOWN));
}

/**
 * Hop the critter to a tile by REAL HOPS: along its row first, then up or down
 * its column.
 *
 * For the items that must reach a tile the way a player reaches it — the ones
 * about `bestRow`, the row award, the bear's emergence conditions, or a bay
 * being entered — and for nothing else. A scenario that simply needs the critter
 * somewhere poses it with `addCritter` or `setCritterTile`, which costs no game
 * time at all.
 *
 * It stops early rather than looping forever when a hop is refused, so a check
 * that walked the critter into a wall gets a snapshot showing where it stuck
 * rather than a timeout. Columns first, so a route to the far shore does not
 * arrive under the solid cap before it has lined up with a bay.
 */
export async function crossTo(
  h: Harness,
  col: number,
  row: number,
): Promise<void> {
  const step = async (direction: Facing): Promise<boolean> => {
    const before = critterTile(await h.snapshot());
    await hop(h, direction);
    const after = critterTile(await h.snapshot());
    return !sameTile(before, after);
  };
  for (let guard = 0; guard < COLS + ROWS; guard += 1) {
    const at = critterTile(await h.snapshot());
    if (at.col === col && at.row === row) return;
    const moved =
      at.col !== col
        ? await step(at.col < col ? "right" : "left")
        : await step(at.row > row ? "up" : "down");
    if (!moved) return;
  }
}

/** Show or hide the read-only debug overlay, through its fixed Backquote binding. */
export async function toggleOverlay(h: Harness): Promise<void> {
  await h.tap(OVERLAY_KEY);
}
