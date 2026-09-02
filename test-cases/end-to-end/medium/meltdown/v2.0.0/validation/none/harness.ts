// Meltdown — the shared validator harness. CASE-PROVIDED.
//
// Every check in this suite is an ordinary vitest test that drives the built site
// IN A REAL BROWSER. There is nothing to import: an engineless run seeds no
// `src/` at all, so the build wrote its own frame loop, its own canvas fit, its
// own keyboard and pointer layer, its own audio, its own debug overlay, and its
// own `window.__meltdown` — and the only place any of that exists is a page that
// has loaded the bundle. So the project serves `dist/`, loads it in Chromium, and
// reaches the game the way anything reaches it: over the surface
// `specs/instrumentation.md` told the build to install.
//
// IT IS STILL A VITEST PROJECT, AND THAT IS DELIBERATE. The runner locates the
// build output before it chooses between the vitest and browser paths, so `dist/`
// is on disk by the time this project runs. Staying a vitest project is what lets
// the case name ONE script per review item and have it resolve under all three
// engines — `validation/heat/air-cooling-rate.test.ts` is the same path whichever
// engine the run selected — and what keeps `format = 2` resolution passing.
//
// WHAT A CHECK READS. The game's own state (through `window.__meltdown`'s
// `snapshot`), the frames the harness itself drove, the operations the build
// issued against its 2D context, the pixels they left on the canvas, and the
// sounds it emitted. Nothing here fabricates an outcome: the scenario helpers
// below only ARRANGE the floor through the surface, and the real update the build
// wrote is what runs from there.
//
// THE HARNESS OWNS EVERY COMPOUND SEQUENCE. The debug surface is atomic by
// design — each operation sets one field, reads the state, or moves the clock
// (`guides/authoring/writing-debug-apis-and-validators.md`) — so "open a run with
// one idle Arc and one stationary Mote in front of it" is a helper here, built
// out of those atomic operations, and never an operation on the surface. A check
// that needs only part of a sequence calls the operations it needs: nothing a
// check does not ask for happens.
//
// AND THE HELPERS FIX GEOMETRY, NEVER THRESHOLDS. A helper poses a floor, drives
// a scenario, or reads a value out of a snapshot. Every tolerance a check
// asserts — a number of degrees, a colour distance, a count of tiles — is stated
// in that check, next to the figure `specs/` fixes for it, because a helper that
// carried the tolerance would hide what the check is really asserting. Look for a
// threshold in this file and you will not find one.
//
// THE CLOCK IS THE SURFACE'S. Nothing outside an engineless build owns its loop,
// so `specs/instrumentation.md` puts the clock on the surface: `setAutoStep(false)`
// takes the game off real time and `advance(seconds, frames)` runs whole frames of
// a chosen length. Every harness opens by taking the game off the clock, so a
// check asks for a number of frames and gets exactly that number — no polling, no
// waiting, and no measurement of the machine it ran on.
//
// EXCEPT WHERE THE QUESTION IS ABOUT TIME ITSELF, AND THAT EXCEPTION IS THE
// POINT. A check about whether time passes — whether a pause freezes the floor,
// whether the game advances itself, whether double speed runs twice the game
// time — must be measured on THE CLOCK THE PLAYER'S GAME ACTUALLY RUNS ON, never
// through `advance`. `advance` is instrumentation, and a build is free to gate it
// separately from its own frame loop: a build that holds its pause in the shell
// that drives the clock steps straight through an `advance`-based freeze check
// while its floor is visibly stopped, and — far worse — a build whose pause menu
// opens over a floor that keeps running passes such a check outright. So
// {@link Harness.withOwnClock} hands the clock back to the build and spends real
// windows on it, and every item governed by that rule is written against it.
//
// EVERYTHING CROSSING INTO THE PAGE IS ASYNC. That is the whole of the difference
// between a suite here and its counterpart under an engine: `await h.snapshot()`
// rather than `h.snapshot()`, `await h.debug.setTowerHeat(...)` rather than
// `h.debug.setTowerHeat(...)`. The scenarios, the tolerances, and the assertions
// are the same ones, because they are the case's rather than the runtime's.
//
// ONE SERVER, ONE BROWSER, ONE PAGE PER HARNESS. `globalSetup.ts` starts the
// server and the browser once for the whole project; this module connects to
// them from inside each suite's worker and opens a page per harness, so every
// check drives a build that has just started and no check can be affected by
// what the one before it pressed, placed or muted.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { expect, inject } from "vitest";
import type { Browser, BrowserContext, Page } from "playwright";
import { connectChromium } from "./chromium";
import { fail } from "./assert";
import {
  BINDINGS,
  BUILD_PHASE_TIME,
  OVERLAY_KEY,
  STAGE_H,
  STAGE_W,
  TILE,
  TOWER_DEFS,
  TRIP_TIME,
  UNBOUND_KEY,
  colAt,
  footprintCentre,
  footprintTiles,
  modeFigures,
  rowAt,
  tileCX,
  tileCY,
  type ActionName,
  type BuildZone,
  type DifficultyId,
  type Exhaust,
  type ModeId,
  type Phase,
  type Rect,
  type Rotation,
  type Screen,
  type Side,
  type Speed,
  type SurgeType,
  type Tile,
  type TowerType,
  type Vent,
} from "./constants";

declare module "vitest" {
  export interface ProvidedContext {
    /** Where the built site is served, from `globalSetup.ts`. */
    meltdownUrl: string;
    /** The one Chromium every suite worker connects to. */
    meltdownBrowserWs: string;
  }
}

/* -------------------------------------------------------------------------- */
/* The contract the build owes                                                */
/* -------------------------------------------------------------------------- */

/** The handle an engineless build installs its surface on. */
export const HANDLE = "__meltdown";

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
  // The screen and the run.
  "setScreen",
  "setPhase",
  "setMenuIndex",
  "setMode",
  "setDifficulty",
  "setMoney",
  "setLives",
  "setScore",
  "setWave",
  "setBuildTimer",
  "setWavePending",
  "setSpeed",
  // The world gate.
  "setWaveSpawning",
  // The towers.
  "addTower",
  "removeTower",
  "clearTowers",
  "setTowerHeat",
  "setTowerTripped",
  "setTowerTripTimer",
  "setTowerLevel",
  "setTowerFresh",
  "setTowerFiring",
  "setTowerThermal",
  // Building.
  "setArmed",
  "setPreview",
  "setPreviewRotation",
  "place",
  "setSelected",
  "setHoverShop",
  "upgradeTower",
  "sellTower",
  // The surge.
  "addUnit",
  "removeUnit",
  "clearSurge",
  "setUnitPosition",
  "setUnitHp",
  "setUnitMaxHp",
  "setUnitSlow",
  "setUnitSlowTimer",
  "setUnitMotion",
  // The pointer.
  "pointerDown",
  "pointerMove",
  "pointerUp",
] as const;

/** One placed tower, as a snapshot reports it. */
export interface TowerView {
  id: number;
  type: TowerType;
  /** The footprint's top-left tile. */
  col: number;
  row: number;
  size: number;
  rotation: Rotation;
  level: number;
  /** `0` to `100`; `0` for the Forge and the Sink. */
  heat: number;
  redline: number;
  /** The live damage multiplier; `0` for movers only. */
  heatMult: number;
  /** Per-shot damage at this heat and level; `0` for movers only. */
  damage: number;
  /** The Rime's live slow fraction; `0` on every other tower. */
  slowFactor: number;
  /** The Forge's setpoint or the Sink's per-edge cooling; `0` for emitters. */
  output: number;
  tripped: boolean;
  /** Seconds left on the trip cooldown, else `0`. */
  tripTimer: number;
  /** Has a target and is online this frame; always false while tripped. */
  firing: boolean;
  /** The id of the unit it is firing on. */
  targeting: number | null;
  /** WORLD-oriented radiator faces; empty for movers. */
  radiatorFaces: Side[];
  kills: number;
  damageDealt: number;
  /** Total money spent on this tower, its build cost and every upgrade. */
  spent: number;
  /** What selling it pays right now. */
  refund: number;
  /** What the next level costs; `0` at level 3. */
  upgradeCost: number;
  /** Still refunds in full. */
  fresh: boolean;
  firingEnabled: boolean;
  thermalEnabled: boolean;
}

/** One surge unit, as a snapshot reports it. `x`/`y` is its CENTRE. */
export interface UnitView {
  id: number;
  type: SurgeType;
  x: number;
  y: number;
  /** The tile its centre falls in. */
  col: number;
  row: number;
  hp: number;
  maxHp: number;
  /** Current speed, reflecting any live slow. */
  speed: number;
  /** Its unslowed speed. */
  baseSpeed: number;
  slowed: boolean;
  slowFactor: number;
  slowTimer: number;
  flying: boolean;
  vent: Vent;
  exhaust: Exhaust;
  /** Route length still to travel, in tiles. */
  remaining: number;
  motion: boolean;
}

/** The held preview, as a snapshot reports it. */
export interface BuildView {
  type: TowerType;
  /** The footprint's top-left tile. */
  col: number;
  row: number;
  rotation: Rotation;
  /** Whether that footprint could be placed right now, through the real check. */
  valid: boolean;
}

/** One shop entry's hit rectangle, and the type it arms. */
export interface ShopControl extends Rect {
  type: TowerType;
}

/**
 * Where the build panel put each control, in logical stage units.
 *
 * `specs/hud.md` says what the panel must hold and leaves WHERE entirely to the
 * build, so a scripted scenario taps the rectangle the build reported rather
 * than a layout this project would otherwise have to fix.
 */
export interface ControlsView {
  /** One per entry, in shop order. */
  shop: ShopControl[];
  /** Null when no placement is armed. */
  rotate: Rect | null;
  cancel: Rect | null;
  /** Null when no tower is selected. */
  upgrade: Rect | null;
  sell: Rect | null;
  send: Rect;
  speed: Rect;
  pause: Rect;
  mute: Rect;
}

/** The coming wave the panel previews, or `null` when there is none. */
export interface NextWaveView {
  type: SurgeType;
  count: number;
}

/**
 * The state a snapshot reports, exactly as `specs/instrumentation.md` shapes it.
 *
 * Every field an operation can set is here, which is what makes every pose
 * verifiable by set-then-read. `muted` and `pointer` are the exceptions in the
 * other direction: no operation sets `muted`, and both are the game's own copy
 * of something the runtime owns, refreshed in every update.
 */
export interface MeltdownSnapshot {
  version: number;
  screen: Screen;
  /** The sub-phase of the `playing` screen. */
  phase: Phase;
  /** The highlighted row of the current menu, counted from 0. */
  menuIndex: number;
  mode: ModeId;
  difficulty: DifficultyId;
  money: number;
  lives: number;
  score: number;
  /** The wave this phase belongs to. */
  wave: number;
  /** DERIVED from mode and difficulty. */
  waveCount: number;
  startMoney: number;
  startLives: number;
  interest: boolean;
  /** Seconds left in the current build phase; 0 in the opening phase. */
  buildTimer: number;
  /** Units of this wave still to release. */
  wavePending: number;
  /** DERIVED: `wavePending` plus the live units of the wave being fought. */
  waveRemaining: number;
  nextWave: NextWaveView | null;
  speed: Speed;
  /** The game's copy of the runtime's mute bit. */
  muted: boolean;
  /** The world gate: the run's own release of surge. */
  waveSpawning: boolean;
  /** Who drives the clock. This engine only. */
  autoStep: boolean;
  /** The pointer's own position, in logical stage units, and whether it is down. */
  pointer: { x: number; y: number; down: boolean };
  selected: number | null;
  hoverShop: TowerType | null;
  build: BuildView | null;
  /** Inclusive at both ends; `null` off Bottleneck. */
  buildZone: BuildZone | null;
  /** The cheapest open route from each vent to its opposite exhaust, in tiles. */
  paths: { left: { length: number }; top: { length: number } };
  controls: ControlsView;
  towers: TowerView[];
  surge: UnitView[];
  /** Accumulated simulation time, in seconds. */
  simTime: number;
}

/** The operations a check poses the game through. Every one crosses into the page. */
export interface MeltdownDebugApi {
  // The clock (this engine alone).
  setAutoStep(enabled: boolean): Promise<void>;
  advance(seconds: number, frames?: number): Promise<void>;

  // The core.
  reset(options?: { seed?: number }): Promise<void>;
  snapshot(): Promise<MeltdownSnapshot>;

  // The screen and the run.
  setScreen(screen: Screen): Promise<void>;
  setPhase(phase: Phase): Promise<void>;
  setMenuIndex(n: number): Promise<void>;
  setMode(mode: ModeId): Promise<void>;
  setDifficulty(difficulty: DifficultyId): Promise<void>;
  setMoney(amount: number): Promise<void>;
  setLives(count: number): Promise<void>;
  setScore(n: number): Promise<void>;
  setWave(n: number): Promise<void>;
  setBuildTimer(seconds: number): Promise<void>;
  setWavePending(n: number): Promise<void>;
  setSpeed(speed: Speed): Promise<void>;

  // The world gate.
  setWaveSpawning(enabled: boolean): Promise<void>;

  // The towers.
  addTower(
    type: TowerType,
    col: number,
    row: number,
    rotation?: Rotation,
  ): Promise<void>;
  removeTower(id: number): Promise<void>;
  clearTowers(): Promise<void>;
  setTowerHeat(id: number, heat: number): Promise<void>;
  setTowerTripped(id: number, tripped: boolean): Promise<void>;
  setTowerTripTimer(id: number, seconds: number): Promise<void>;
  setTowerLevel(id: number, level: number): Promise<void>;
  setTowerFresh(id: number, fresh: boolean): Promise<void>;
  setTowerFiring(id: number, enabled: boolean): Promise<void>;
  setTowerThermal(id: number, enabled: boolean): Promise<void>;

  // Building.
  setArmed(type: TowerType | null): Promise<void>;
  setPreview(col: number, row: number): Promise<void>;
  setPreviewRotation(rotation: Rotation): Promise<void>;
  place(): Promise<void>;
  setSelected(id: number | null): Promise<void>;
  setHoverShop(type: TowerType | null): Promise<void>;
  upgradeTower(id: number): Promise<void>;
  sellTower(id: number): Promise<void>;

  // The surge.
  addUnit(type: SurgeType, vent: Vent): Promise<void>;
  removeUnit(id: number): Promise<void>;
  clearSurge(): Promise<void>;
  setUnitPosition(id: number, x: number, y: number): Promise<void>;
  setUnitHp(id: number, hp: number): Promise<void>;
  setUnitMaxHp(id: number, maxHp: number): Promise<void>;
  setUnitSlow(id: number, factor: number): Promise<void>;
  setUnitSlowTimer(id: number, seconds: number): Promise<void>;
  setUnitMotion(id: number, enabled: boolean): Promise<void>;

  // The pointer.
  pointerDown(x: number, y: number): Promise<void>;
  pointerMove(x: number, y: number): Promise<void>;
  pointerUp(): Promise<void>;
}

/* -------------------------------------------------------------------------- */
/* The step schedule                                                          */
/* -------------------------------------------------------------------------- */
//
// The suite chooses the size of a frame, because the specification deliberately
// fixes none: v2.0.0 mandates no fixed timestep, every rate in the game is per
// second and integrated against the game time the frame advances by, and the
// heat model's two-phase rule is what makes a single frame's result exact rather
// than order-dependent. So a build must reach the same place however that time
// was divided, and the check that is ABOUT the division
// (`instrumentation/deterministic-core`) drives the same second as one frame and
// as many.
//
// The default is a steady 120 Hz, for two reasons. It is the rate the two
// engine-backed projects next door drive their `ConstantClock` at, so a figure
// measured under `none` and the same figure measured under an engine were
// measured over the same frame; and every duration `specs/` fixes is a whole
// number of frames at it — `WAVE_SPAWN_INTERVAL` 0.6 s is 72, `SLOW_TIME` 1.5 s
// is 180, `TRIP_TIME` 5 s is 600, and `BUILD_PHASE_TIME` 15 s is 1800. A check
// therefore asks for a duration and gets it exactly, with no rounding of its own
// to explain.

/** A source of frame deltas, in milliseconds. */
export interface Clock {
  /** The next frame's delta, in ms. */
  delta(): number;
}

/** The frame the suite steps in, in milliseconds. */
export const TICK_HZ = 120;
export const TICK_MS = 1000 / TICK_HZ;

/** Every frame the same length. */
export class ConstantClock implements Clock {
  constructor(private readonly ms: number) {}
  delta(): number {
    return this.ms;
  }
}

/** A repeating pattern of steps: what an uneven but predictable display gives. */
export class SequenceClock implements Clock {
  private index = 0;
  constructor(private readonly stepsMs: readonly number[]) {
    if (stepsMs.length === 0) {
      throw new RangeError("SequenceClock needs at least one step, got none");
    }
  }
  delta(): number {
    const step = this.stepsMs[this.index % this.stepsMs.length];
    this.index += 1;
    return step;
  }
}

/**
 * A hash of the seed and the frame index, avalanched so that neighbouring
 * indices — which is all a frame counter ever produces — do not yield
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
 * A seeded draw from a range, indexed by frame: the clock that stands in for a
 * real machine under load. The seed is mandatory, because a claim that a build is
 * delta-time independent is worth making only when the failing case replays.
 */
export class JitterClock implements Clock {
  private index = 0;
  private readonly spanMs: number;
  constructor(
    private readonly minMs: number,
    maxMs: number,
    private readonly seed: number,
  ) {
    if (maxMs < minMs) {
      throw new RangeError(
        `JitterClock needs maxMs >= minMs, got minMs ${minMs} and maxMs ${maxMs}`,
      );
    }
    this.spanMs = maxMs - minMs;
  }
  delta(): number {
    const index = this.index;
    this.index += 1;
    return (
      this.minMs + (hash32(this.seed, index) / 0x1_0000_0000) * this.spanMs
    );
  }
}

/** Seconds of simulated time in `frames` frames of the default clock. */
export function seconds(frames: number): number {
  return frames / TICK_HZ;
}

/** Frames of the default clock covering `duration` seconds. */
export function framesFor(duration: number): number {
  return Math.round(duration * TICK_HZ);
}

/**
 * Frames of the default clock that carry an emitter through exactly `shots`
 * shots at `fireRate`, and no further.
 *
 * The fire clock resolves a shot each time its accumulator REACHES the interval
 * `1 / fireRate` and takes the interval off (`specs/combat.md`), so the number
 * of shots a stretch of game time contains is `floor(elapsed * fireRate)` — a
 * quantity that is ambiguous by one at an exact multiple of the interval, where
 * a build's own accumulation of a hundred floating-point deltas may land a
 * whisker either side. This lands the drive half an interval past the last shot
 * it wants, which is the furthest point from both boundaries, so `shots` is what
 * any conforming accumulator produces.
 *
 * This is geometry, not a tolerance: it says where in the fire cycle the drive
 * stops, not how far a build may miss by. A check measuring the FIRE RATE itself
 * states its own tolerance on its own reading.
 */
export function framesForShots(shots: number, fireRate: number): number {
  return Math.round(((shots + 0.5) / fireRate) * TICK_HZ);
}


/* ---- The long-drive clock ------------------------------------------------- */
//
// A HANDFUL OF POINTS IN THIS PROJECT NEED MINUTES OF GAME TIME. What each reads
// is something held over a long stretch — no unit released while the world gate
// is shut, no countdown started in the opening phase, no heat on a Forge under a
// minute of fire, no offline period that is not a cooldown, no unit's centre out
// of the floor rectangle — and the length of the stretch IS the requirement, so
// it cannot be shortened.
//
// WHAT CAN BE CHOSEN IS HOW FINELY THAT STRETCH IS DICED, AND THE SPECIFICATION
// SAYS SO. `specs/waves.md` mandates no fixed timestep: every rate is per second
// and integrated against the game time a frame advances by, so "an interval of
// game time reaches the same state however it was divided into frames", and
// `instrumentation/deterministic-core` is the point that grades that claim on its
// own. {@link TICK_HZ} is this suite's convenience for stating tolerances in
// frames, not a figure any specification fixes.
//
// AND THE COST OF DICING IT AT `120` Hz IS NOT SMALL HERE EITHER. Every frame
// {@link Harness.advance} runs is a real frame INSIDE THE PAGE — the same update
// the build's own loop runs, followed by its render — so a minute of game time is
// seven thousand two hundred of them, on a browser that is sharing this machine
// with everything else running on it. Under the contention this repository's own
// runner has been measured at, that is the difference between a check that costs
// a minute and one that costs eight, against a per-check ceiling and against the
// runner's cap on the whole run. A point lost to either is a point lost to the
// load on the machine, which is the one thing a validator must never measure.
//
// SO A LONG DRIVE RUNS AT `30` Hz. A frame of a thirtieth of a second is still
// eighteen frames inside one `WAVE_SPAWN_INTERVAL` (`0.6` s), a hundred and fifty
// inside a `TRIP_TIME` cooldown (`5` s), and four hundred and fifty inside a
// `BUILD_PHASE_TIME` (`15` s), so every period these points count is resolved
// many times over — and the drive costs a quarter of what it did. A check whose
// reading has a finer resolution than a thirtieth of a second does NOT use this
// clock: it states its own, as the checks on a fire rate and a spawn cadence do.

/** The clock a check that drives minutes of game time runs on, in frames a second. */
export const DRIVE_HZ = 30;

/** Frames of {@link DRIVE_HZ} covering `duration` seconds of game time, rounded up. */
export function driveFrames(duration: number): number {
  return Math.ceil(duration * DRIVE_HZ);
}

/** Seconds of game time in `frames` frames of {@link DRIVE_HZ}. */
export function driveSeconds(frames: number): number {
  return frames / DRIVE_HZ;
}

/**
 * A harness on the {@link DRIVE_HZ} clock, for a check that needs minutes of game
 * time. Everything else about it is {@link createHarness}'s default.
 */
export function createDriveHarness(
  options: Omit<HarnessOptions, "clock"> = {},
): Promise<Harness> {
  return createHarness({
    ...options,
    clock: new ConstantClock(1000 / DRIVE_HZ),
  });
}

/** A rate in units per second from a displacement measured over `frames` frames. */
export function speedOverFrames(delta: number, frames: number): number {
  return (Math.abs(delta) * TICK_HZ) / frames;
}

/* -------------------------------------------------------------------------- */
/* The harness                                                                */
/* -------------------------------------------------------------------------- */

/** One recorded operation on the 2D context, in the order the render made it. */
export type DrawCall =
  | {
      kind: "call";
      method: string;
      args: unknown[];
      /**
       * For `fillText` and `strokeText`, the run's measured width in the
       * context's own units and the alignment in force, both read off the
       * context at the call. Only that context can say how wide a run is: the
       * width follows from the font, the letter spacing and the direction, none
       * of which the call itself carries. {@link textDraws} turns the pair into
       * the run's span.
       */
      width?: number;
      textAlign?: string;
    }
  | { kind: "set"; property: string; value: unknown };

/** A sound the build emitted, and the frame of the drive it emitted it on. */
export interface TimedCue {
  /** The frame it sounded on, 1-based, as {@link Harness.frame} reports. */
  frame: number;
  /** The frame loop's simulated time at that frame, in milliseconds. */
  t: number;
}

/** How the stage is mapped onto the canvas: one uniform scale and a letterbox. */
export interface Viewport {
  width: number;
  height: number;
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface HarnessOptions {
  /** The clock each frame takes its delta from. Defaults to 120 Hz. */
  clock?: Clock;
  /** The window's CSS width. Defaults to the logical stage width. */
  cssWidth?: number;
  /** The window's CSS height. Defaults to the logical stage height. */
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
  snapshot: MeltdownSnapshot;
}

/** How far a coarse sweep may run, and how much game time separates two samples. */
export interface SkipOptions {
  maxSeconds?: number;
  pollSeconds?: number;
  /** Frames per second of game time inside each poll. Defaults to 60. */
  hz?: number;
}

/** What a coarse sweep found. */
export interface SkipResult {
  hit: boolean;
  /** Seconds of game time covered before the sample that ended the sweep. */
  elapsed: number;
  snapshot: MeltdownSnapshot;
}

/** What a leg spent on the build's own clock cost, and whether it closed. */
export interface GainResult {
  /** Whether the build's clock gained the seconds asked for before the deadline. */
  reached: boolean;
  /**
   * The real time the leg took.
   *
   * NOT a reading about the build — it is how busy the machine was — so no check
   * asserts on it. What it is for is giving a leg that must be spent in real time
   * (a PAUSED window, which cannot be closed on a gain that must never happen) the
   * same stretch of real time the running leg beside it needed, so the two legs
   * offer a build the same opportunity to be caught however loaded the host is.
   */
  elapsedMs: number;
}

/**
 * The build running itself, handed to a scenario by {@link Harness.withOwnClock}.
 *
 * There is no `advance` here, and there must not be: this is the whole point of
 * the scope. Inside it the game is driving its own frame loop from the wall
 * clock exactly as it does for a player, so what a check spends is REAL time and
 * what it reads is the state that loop produced.
 */
export interface OwnClock {
  /**
   * The state the game was in AT THE INSTANT THE CLOCK WAS HANDED BACK.
   *
   * THE ONE READING A SCENARIO CANNOT TAKE FOR ITSELF, and the reason this field
   * exists rather than a first {@link read}. Handing the clock back and reading
   * the state are two crossings into the page, and between them the build is
   * running itself: on a host that is short of cores that gap is long enough for
   * a posed tower to fire, a walker to move, a countdown to start. A scenario
   * that opens with `await clock.read()` and then asserts the opening state is
   * what it arranged — a heat of exactly zero, say — is asserting that the gap
   * was short, which is a fact about the machine and not about the build.
   *
   * So the snapshot is taken inside the SAME evaluation that calls
   * `setAutoStep(true)`, before the build has run a frame of its own, and every
   * scenario's opening reading comes from here.
   */
  readonly opened: MeltdownSnapshot;
  /** Let the build run itself for `ms` of real time. */
  settle(ms: number): Promise<void>;
  /**
   * Let the build run itself until ITS OWN clock has gained `seconds`, and
   * report whether it got there before `deadlineMs` of real time ran out.
   *
   * THE READING THAT MAKES A REAL WINDOW REPEATABLE. A leg that spends a fixed
   * stretch of wall clock and then asks how far the game got is asking two
   * questions at once — did the build advance itself, and did this machine give
   * its loop enough of a core to do it in — and the second one is not about the
   * build. A host running a hundred other things hands a page's frame callback a
   * fraction of the frames it asks for, and a leg read that way fails a
   * conformant build for the load on the runner that scored it.
   *
   * So the length of the leg is fixed on the BUILD'S clock and the wall clock is
   * demoted to a deadline. `simTime` is what `specs/waves.md` says accumulates
   * the game time every frame advances by, so a leg closed on it covers the same
   * stretch of the game however many frames the host allowed and however long it
   * took — and everything read off the leg (how far a Mote walked, how much heat
   * a tower gained) follows from the game time rather than from the machine.
   *
   * WHAT STILL FAILS, and it is the whole of what this leg was ever asking: a
   * build whose simulation does not advance unless something steps it never
   * gains the seconds and comes back `false` when the deadline runs out. The
   * deadline is the only wall clock left, and it is set so wide that reaching it
   * means the build is not running rather than that the host is busy.
   *
   * Nothing here steps the game: the poll is the build's own `snapshot`, which
   * `specs/instrumentation.md` requires to change nothing, run inside the page
   * while the build's loop drives itself.
   */
  gain(seconds: number, deadlineMs: number): Promise<GainResult>;
  /** Read the game's state. It moves nothing. */
  read(): Promise<MeltdownSnapshot>;
  /**
   * Press a key as a player does, held long enough for the build's own loop to
   * run frames while it is down.
   *
   * {@link Harness.tap} cannot be used in here: it drives a frame with
   * `advance`, which is exactly what a check on this clock must never call. So
   * the key is held for a few real frames instead, which is what makes the press
   * visible to a build that latches the edge in its event handler AND to one
   * that compares held state at the top of each frame.
   */
  press(code: string): Promise<void>;
}

export interface Harness {
  /** The page the build is running in. For a check that needs Playwright itself. */
  readonly page: Page;
  /**
   * The surface the BUILD installed, as operations that cross into the page.
   *
   * Read off `window.__meltdown` and never constructed here — see
   * {@link unexposedSurface}.
   */
  readonly debug: MeltdownDebugApi;
  /**
   * Why the build's surface cannot be driven, or `null` when it can.
   *
   * A fault here is the build's: the surface is missing, or it is missing an
   * operation the specification requires. It says what was found
   * (`window.__meltdown was still absent 10s after the page loaded`), and
   * {@link failSurface} pairs it with what the specification requires. Every
   * operation fails BY ASSERTION with that pair rather than throwing, so a
   * missing surface lands as the verdict of every check that reaches for it —
   * and, crucially, a harness built in a `beforeEach` still comes back, so the
   * fault is reported by the check rather than buried in a hook.
   */
  readonly surfaceFault: string | null;
  /** Everything the page logged to `console.error`, or threw, oldest first. */
  readonly pageErrors: string[];

  /** The frames this harness has driven, 1-based, as a recorded frame counts them. */
  frame(): number;
  /** The simulated time those frames covered, in milliseconds. */
  timeMs(): number;

  /** A fresh read of the game's state through the build's `snapshot`. */
  snapshot(): Promise<MeltdownSnapshot>;
  /** Run `frames` frames back to back, each the length the clock says. */
  advance(frames: number): Promise<void>;
  /** Advance until `predicate` holds, sampling every `poll` frames. */
  until(
    predicate: (snapshot: MeltdownSnapshot) => boolean,
    options?: UntilOptions,
  ): Promise<UntilResult>;
  /**
   * Run `duration` seconds of game time WITHOUT opening a recorded frame.
   *
   * The same real update the loop runs, `hz` frames per second of it, but off
   * camera: no frame boundary is closed, so a capture running across it keeps
   * nothing, and a section that has to sit through a fifteen-second build phase
   * costs a replay nothing. Use it for the wait; use {@link advance} for the
   * part a check is about.
   */
  skip(duration: number, hz?: number): Promise<void>;
  /** {@link skip} until `predicate` holds, sampling every `pollSeconds`. */
  skipUntil(
    predicate: (snapshot: MeltdownSnapshot) => boolean,
    options?: SkipOptions,
  ): Promise<SkipResult>;

  /**
   * Hand the clock back to the BUILD, run `scenario` while it drives itself in
   * real time, and take the clock back however the scenario ends.
   *
   * THIS IS HOW EVERY CHECK ABOUT WHETHER TIME PASSES IS MEASURED, and calling
   * `advance` — or anything built on it, {@link tap} included — inside the
   * scenario defeats the whole exercise. `advance` bottoms out in a debug
   * operation the build is free to gate separately from its own frame loop, so
   * it measures where a build put its gate rather than whether the floor moved.
   * `specs/waves.md` says the floor freezes while paused and runs while it is
   * not; that is a claim about the clock the player is on, and this is that
   * clock.
   *
   * The shape every such check takes is a CONTRAST over windows of the same
   * length, because a frozen floor and a floor that never moved look identical
   * in one window:
   *
   * ```ts
   * const legs = await h.withOwnClock(async (clock) => {
   *   await clock.gain(LEG_SECONDS, LEG_DEADLINE_MS); // the running leg
   *   await clock.press(BINDINGS.pause);
   *   const pressed = await clock.read();             // ONE snapshot, on the press
   *   await clock.settle(pausedMs);                   // the paused leg
   *   return { pressed, settled: await clock.read() };
   * });
   * ```
   *
   * The opening state is {@link OwnClock.opened} and never a `read` of the
   * scenario's own: a first `read` is a round trip taken while the build is
   * already running, so what it reports is how quickly this machine answered.
   *
   * Both legs of the freeze are read off the ONE snapshot taken on the press, so
   * the pair spans the paused window and nothing else; a second round trip there
   * would bill its own latency to the freeze. The windows, and every bound the legs
   * are held to, are the check's own and are stated in the check.
   */
  withOwnClock<T>(scenario: (clock: OwnClock) => Promise<T>): Promise<T>;
  /**
   * Let the build run itself for `ms` of real time, and take the clock back.
   *
   * The one-window form of {@link withOwnClock}, for a check that needs the
   * build's own loop to have run and has nothing to do in the middle of it.
   */
  settle(ms: number): Promise<void>;

  /** Press a key and leave it down, as a player holding it would. */
  hold(code: string): Promise<void>;
  /** Release a key held by {@link hold}. */
  release(code: string): Promise<void>;
  /**
   * Press a key, run the one frame that delivers it, and release it.
   *
   * A press that ran no frame would never reach the game, and a press released
   * before a frame ran would be invisible to a build that reads its keyboard by
   * comparing held state between frames — so the frame goes between the two.
   */
  tap(code: string): Promise<void>;
  /** Hold one or more keys down for `frames` frames, then release them all. */
  holdFor(codes: string | readonly string[], frames: number): Promise<void>;

  /** Run exactly one frame and hand back every operation its render issued. */
  frameCalls(): Promise<DrawCall[]>;
  /** Reflect the surface without invoking it: `typeof` for each name, and the version. */
  probe(
    names: readonly string[],
  ): Promise<{ version: unknown; ops: Record<string, string> }>;

  /** How the stage is mapped onto this harness's canvas. */
  viewport(): Viewport;
  /** Where a logical point lands in the canvas's backing store. */
  device(x: number, y: number): { x: number; y: number };
  /** Where a logical point lands in CSS pixels, for a real mouse. */
  css(x: number, y: number): { x: number; y: number };
  /** The device pixel under a logical point, as `[r, g, b, a]`. */
  pixel(x: number, y: number): Promise<[number, number, number, number]>;
  /** Many logical points at once, in one crossing into the page. */
  pixels(
    points: readonly { x: number; y: number }[],
  ): Promise<[number, number, number, number][]>;
  /** A pixel addressed in the canvas's own backing store, past the fit. */
  devicePixel(x: number, y: number): Promise<[number, number, number, number]>;
  /** The canvas's backing store size, as the build sized it. */
  surface(): Promise<{ width: number; height: number; dpr: number }>;

  /** Give the build a real, browser-trusted gesture, so its audio can open. */
  armAudio(): Promise<void>;
  /** How many sounds the build has emitted since the page loaded, in total. */
  sounds(): Promise<number>;

  /** Release anything held, and let the page go. */
  dispose(): Promise<void>;
}

/* ---- The page ------------------------------------------------------------- */

/** The init scripts injected before any of the build's own script runs. */
const INIT_SCRIPTS = ["recorder-init.js", "audio-init.js"] as const;

/** This module's directory: the validator project's root. */
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * How long the surface is waited for before the build is called non-conformant.
 *
 * Generous against a conformant build and cheap against one: the wait is a poll
 * that returns the instant the global appears. Meltdown seeds no assets and the
 * surface goes up "as soon as the game has initialized"
 * (`specs/instrumentation.md`), so a conformant build is here in milliseconds
 * and pays nothing for the ceiling. What the ceiling really bounds is the cost
 * of a build with no surface at all, which pays it once per harness.
 *
 * A MINUTE, BECAUSE THIS IS THE ONE PLACE A BUSY MACHINE COULD BE MISREAD AS A
 * BROKEN BUILD. Everything else this file waits on is stepped, but the surface
 * has to appear on its own: the page navigates, Chromium parses and runs the
 * bundle, and the build initializes, all off frames the host may be handing to a
 * hundred other processes. A ten-second ceiling turned that into
 * `window.__meltdown was still absent 10s after the page loaded` — a sentence
 * about the build, recorded against the build, produced by the runner's load.
 * A conformant build still pays nothing for the longer ceiling, because the wait
 * returns the instant the global is there; what it costs is a slower verdict on
 * a build that really installed no surface, which is a build already failing
 * every point in the project.
 */
const SURFACE_TIMEOUT_MS = 60_000;

/**
 * How often the two waits above ask the page whether the surface is there yet:
 * ten times a second.
 *
 * NOT PLAYWRIGHT'S DEFAULT, WHICH IS THE PAGE'S OWN ANIMATION FRAME. A probe
 * scheduled on `requestAnimationFrame` is scheduled on precisely the thing a
 * loaded host starves, so the one wait in this file that is allowed to conclude
 * something about the build would be the one wait that slows down when the
 * machine is busy. A fixed interval is serviced off the page's timer queue
 * instead, and ten a second is far finer than the hundreds of milliseconds a
 * bundle takes to install its surface.
 */
const SURFACE_POLL_MS = 100;

/**
 * How long the page is given to load the built site: a minute.
 *
 * Playwright's own default is thirty seconds, and it is the same argument as
 * {@link SURFACE_TIMEOUT_MS}: fetching and parsing a bundle off a host running a
 * hundred other things is not a statement about the build, and a navigation that
 * times out fails the harness rather than scoring a point. Stated here rather
 * than left implicit so the figure is one this file chose.
 */
const NAVIGATION_TIMEOUT_MS = 60_000;

/**
 * How often {@link OwnClock.gain} asks the page whether the build's clock has
 * got there yet: ten times a second.
 *
 * Inside the page, so it costs no round trip. Ten a second is fine enough that a
 * leg closes within a frame or two of the game time it asked for, and coarse
 * enough that the poll is not competing with the frame callback it is watching
 * on a machine that is short of both.
 */
const OWN_CLOCK_POLL_MS = 100;

/**
 * How long a key is held down inside {@link Harness.withOwnClock}.
 *
 * Geometry, not a tolerance: it says how a press is delivered, not how far a
 * build may miss by. Inside that scope the build is running its own loop, so a
 * down and an up delivered back to back could fall between two of its frames and
 * be invisible to a build that compares held state at the top of each — a build
 * a real player has no trouble with. A few frames of hold is what makes the
 * press visible however the build reads its keyboard, and the time it costs is
 * spent inside the leg the caller is already measuring.
 */
const PRESS_HOLD_MS = 50;

let browserPromise: Promise<Browser> | null = null;

async function sharedBrowser(): Promise<Browser> {
  browserPromise ??= connectChromium(inject("meltdownBrowserWs"));
  return browserPromise;
}

/**
 * One browser context per WINDOW SHAPE, shared by every harness of that shape in
 * this file, and one PAGE per harness inside it.
 *
 * The split is what the init scripts force and what correctness wants. The
 * recorder and the audio probe are installed on the CONTEXT, so every page it
 * opens is instrumented before a line of the build's script runs, and a context
 * is also where the viewport and the device pixel ratio are fixed — which is the
 * one thing `floor/stage-fit` varies. Everything else about a harness is the
 * page: a fresh one opens on a build that has just started, with no key held, no
 * audio context opened, and the mute preference back off, which is a stronger
 * guarantee than any reset the surface offers, since `reset()` deliberately
 * leaves muting alone.
 *
 * A page per harness rather than a page reused between them, because a check may
 * legitimately hold two harnesses at once — `instrumentation/deterministic-core`
 * runs the same second under two step sizes — and a harness whose page had been
 * taken over by a later one would read someone else's game while looking exactly
 * like it worked.
 */
const contexts = new Map<string, BrowserContext>();

/** Every page this worker opened, so none is left behind in the shared browser. */
const openPages = new Set<Page>();

function shapeKey(cssWidth: number, cssHeight: number, dpr: number): string {
  return `${cssWidth}x${cssHeight}@${dpr}`;
}

/** The context for a window of this shape, opened and instrumented on demand. */
async function contextFor(
  cssWidth: number,
  cssHeight: number,
  dpr: number,
): Promise<BrowserContext> {
  const key = shapeKey(cssWidth, cssHeight, dpr);
  const existing = contexts.get(key);
  if (existing !== undefined) return existing;

  const browser = await sharedBrowser();
  const context = await browser.newContext({
    viewport: { width: cssWidth, height: cssHeight },
    deviceScaleFactor: dpr,
  });
  for (const name of INIT_SCRIPTS) {
    await context.addInitScript(readFileSync(join(PROJECT_ROOT, name), "utf8"));
  }
  contexts.set(key, context);
  return context;
}

/**
 * Shut everything this worker opened.
 *
 * Registered from `setup.ts` as an `afterAll`, so a suite file never has to think
 * about it and a worker cannot leave a page behind in the shared browser.
 *
 * IT IS PER FILE BECAUSE A WORKER IS PER FILE. Vitest's default pool forks a
 * process for each suite file, so this module — the context cache and the
 * connection alike — is built again for every one of them and nothing here can be
 * carried from one file to the next. A revision that kept the context open
 * between files to save rebuilding it was measuring a saving that does not exist:
 * the contexts it left behind were torn down by the browser server the moment the
 * fork disconnected, which is what this function does explicitly and in order.
 */
export async function closeWorkerBrowser(): Promise<void> {
  for (const page of openPages) await page.close().catch(() => undefined);
  openPages.clear();
  for (const context of contexts.values()) {
    await context.close().catch(() => undefined);
  }
  contexts.clear();
  const browser = browserPromise;
  browserPromise = null;
  if (browser !== null) await (await browser).close().catch(() => undefined);
}

/* ---- The surface a build never installed ---------------------------------- */

/**
 * A stand-in for a surface that is missing or incomplete: every operation on it
 * fails the check that reached for it, with the fault named.
 *
 * A proxy rather than a hand-written stub, so that an operation a build was
 * supposed to add but this file never listed still fails as the consequence of
 * the missing install rather than as an undefined that throws a `TypeError`
 * several frames later, in a place that names nothing.
 *
 * Keys that belong to the MACHINERY rather than to a check are answered with
 * `undefined` instead: awaiting a value probes `then`, and vitest's own error
 * formatting probes symbols and `constructor`. Failing those would replace the
 * verdict below with noise from the machinery that was trying to report it.
 */
function unexposedSurface(reason: string): MeltdownDebugApi {
  return new Proxy({} as MeltdownDebugApi, {
    get: (_target, property): unknown => {
      if (typeof property === "symbol") return undefined;
      if (property === "then" || property === "constructor") return undefined;
      return () => failSurface(reason);
    },
  });
}

/**
 * What `specs/instrumentation.md` requires of the surface: the `Expected:` line
 * of the failure a build with no usable surface lands on every check that
 * reaches for it, beside the {@link Harness.surfaceFault} that says what was
 * found.
 */
export const SURFACE_REQUIREMENT =
  `a usable debug and automation surface on window.${HANDLE} as soon as the ` +
  `game has initialized, carrying every operation specs/instrumentation.md ` +
  `requires`;

/**
 * Fail the running check on `fault`, the harness's account of what is wrong
 * with the build's surface, paired with what the specification requires.
 */
export function failSurface(fault: string): never {
  return fail(SURFACE_REQUIREMENT, fault);
}

/**
 * What is wrong with the surface this page installed, or `null` when nothing
 * is: the surface never appeared, or it appeared without an operation the
 * specification requires.
 */
async function readSurfaceFault(page: Page): Promise<string | null> {
  try {
    await page.waitForFunction(
      (handle) =>
        typeof (window as never)[handle] === "object" &&
        (window as never)[handle] !== null,
      HANDLE,
      { timeout: SURFACE_TIMEOUT_MS, polling: SURFACE_POLL_MS },
    );
  } catch {
    return `window.${HANDLE} was still absent ${SURFACE_TIMEOUT_MS / 1000}s after the page loaded`;
  }
  const missing = await page.evaluate(
    ([handle, ops]) => {
      const target = (
        window as unknown as Record<string, Record<string, unknown>>
      )[handle];
      return ops.filter((op) => typeof target[op] !== "function");
    },
    [HANDLE, [...REQUIRED_OPS]] as const,
  );
  if (missing.length > 0) {
    return `window.${HANDLE} is installed but carries no ${missing
      .map((op) => `${op}()`)
      .join(", ")}`;
  }
  return null;
}

/* ---- Building one --------------------------------------------------------- */

/**
 * Load the built site in a browser, take the game off the wall clock, and hand
 * back everything a check reads.
 *
 * The default shape is the stage's own size at one device pixel per CSS pixel,
 * so a logical coordinate and a canvas pixel are the same thing and no check but
 * `floor/stage-fit` has to think about the fit at all.
 *
 * IT NEVER THROWS FOR A BUILD'S FAULT. A missing or incomplete surface comes
 * back as {@link Harness.surfaceFault} over a surface whose every operation
 * fails by assertion, so a suite that builds its harness in a `beforeEach` gets
 * its real verdict from the check rather than a hook failure that names nothing.
 */
export async function createHarness(
  options: HarnessOptions = {},
): Promise<Harness> {
  const cssWidth = options.cssWidth ?? STAGE_W;
  const cssHeight = options.cssHeight ?? STAGE_H;
  const dpr = options.dpr ?? 1;
  const clock = options.clock ?? new ConstantClock(TICK_MS);
  const context = await contextFor(cssWidth, cssHeight, dpr);
  const page = await context.newPage();
  openPages.add(page);

  // Whatever this page throws or logs as an error while THIS harness drives it.
  // The page belongs to one harness, so the log cannot pick up what some other
  // check provoked.
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => {
    pageErrors.push(String(error.message || error));
  });
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });

  await page.goto(inject("meltdownUrl"), {
    waitUntil: "load",
    timeout: NAVIGATION_TIMEOUT_MS,
  });

  const surfaceFault = await readSurfaceFault(page);
  const refuse = (): never => failSurface(surfaceFault ?? "");

  const call = async (operation: string, args: unknown[]): Promise<unknown> => {
    if (surfaceFault !== null) refuse();
    return page.evaluate(
      ([handle, name, rest]) =>
        (
          window as unknown as Record<
            string,
            Record<string, (...a: unknown[]) => unknown>
          >
        )[handle][name](...rest),
      [HANDLE, operation, args] as const,
    );
  };

  const debug =
    surfaceFault !== null
      ? unexposedSurface(surfaceFault)
      : (new Proxy({} as MeltdownDebugApi, {
          get: (_target, property): unknown => {
            if (typeof property === "symbol") return undefined;
            if (property === "then" || property === "constructor")
              return undefined;
            const name = String(property);
            return (...args: unknown[]) => call(name, args);
          },
        }) as MeltdownDebugApi);

  if (surfaceFault === null) {
    // Off the wall clock and back to the title before a check touches anything:
    // from here the game changes only when this harness says so.
    await call("setAutoStep", [false]);
    await call("reset", []);
    // And a recorder over the surface before a check can arm one. A build is
    // free to ask for its 2D context on the frame it first draws rather than
    // while it initializes, so the surface can be installed and answering
    // before any context exists to record — and a `captureReplay` armed in that
    // window arms nothing and writes no evidence for a section that drew.
    await page
      .waitForFunction(
        () =>
          (
            window as unknown as { __meltdownRec: { ready(): boolean } }
          ).__meltdownRec.ready(),
        undefined,
        { timeout: SURFACE_TIMEOUT_MS, polling: SURFACE_POLL_MS },
      )
      .catch(() => undefined);
  }

  const view = fitViewport(cssWidth, cssHeight, dpr);
  const cueSinks: TimedCue[][] = [];
  let frameCount = 0;
  let timeMs = 0;

  /**
   * Run `frames` frames and read the state they left, in one crossing.
   *
   * Each frame is opened and closed around a single `advance(dt, 1)`, all inside
   * one synchronous evaluation, so nothing the page's own animation frame renders
   * can land inside a recorded frame — and so a frame the recorder keeps is
   * exactly one frame the game ran.
   */
  const drive = async (frames: number): Promise<MeltdownSnapshot> => {
    if (surfaceFault !== null) refuse();
    const deltas: number[] = [];
    for (let i = 0; i < frames; i += 1) deltas.push(clock.delta());
    const result = (await page.evaluate(
      ([handle, dts]) => {
        const api = (
          window as unknown as Record<
            string,
            Record<string, (...a: unknown[]) => unknown>
          >
        )[handle];
        const rec = (
          window as unknown as {
            __meltdownRec: Record<string, (...a: unknown[]) => unknown>;
          }
        ).__meltdownRec;
        const audio = (
          window as unknown as { __meltdownAudio: { started(): number } }
        ).__meltdownAudio;
        const sounds: number[] = [];
        for (const dt of dts) {
          const before = audio.started();
          rec.begin();
          api.advance(dt / 1000, 1);
          rec.end(dt);
          sounds.push(audio.started() - before);
        }
        return { snapshot: api.snapshot(), sounds };
      },
      [HANDLE, deltas] as const,
    )) as { snapshot: MeltdownSnapshot; sounds: number[] };

    for (const [index, delta] of deltas.entries()) {
      frameCount += 1;
      timeMs += delta;
      for (let n = 0; n < result.sounds[index]; n += 1) {
        for (const sink of cueSinks)
          sink.push({ frame: frameCount, t: timeMs });
      }
    }
    return result.snapshot;
  };

  /**
   * Run `duration` seconds of game time in `frames` frames, off camera.
   *
   * The same real update, and the same one crossing, but with no frame boundary
   * opened or closed: a capture running across a skip keeps nothing of it. Every
   * sound the skip produced is attributed to the frame it ended on, which is the
   * whole of what a skip can honestly say about when a sound happened.
   */
  const coast = async (
    duration: number,
    frames: number,
  ): Promise<MeltdownSnapshot> => {
    if (surfaceFault !== null) refuse();
    const whole = Math.max(1, Math.round(frames));
    const result = (await page.evaluate(
      ([handle, sec, count]) => {
        const api = (
          window as unknown as Record<
            string,
            Record<string, (...a: unknown[]) => unknown>
          >
        )[handle];
        const audio = (
          window as unknown as { __meltdownAudio: { started(): number } }
        ).__meltdownAudio;
        const before = audio.started();
        api.advance(sec, count);
        return {
          snapshot: api.snapshot(),
          sounds: audio.started() - before,
        };
      },
      [HANDLE, duration, whole] as const,
    )) as { snapshot: MeltdownSnapshot; sounds: number };

    frameCount += whole;
    timeMs += duration * 1000;
    for (let n = 0; n < result.sounds; n += 1) {
      for (const sink of cueSinks) sink.push({ frame: frameCount, t: timeMs });
    }
    return result.snapshot;
  };

  const readPixels = async (
    devicePoints: readonly { x: number; y: number }[],
  ): Promise<[number, number, number, number][]> =>
    page.evaluate(
      (points) => {
        const canvases = Array.from(document.querySelectorAll("canvas"));
        if (canvases.length === 0)
          throw new Error("meltdown: the page has no <canvas>");
        let canvas = canvases[0];
        for (const other of canvases) {
          if (other.width * other.height > canvas.width * canvas.height)
            canvas = other;
        }
        const ctx = canvas.getContext("2d");
        if (ctx === null)
          throw new Error("meltdown: the canvas has no 2D context");
        return points.map((point) => {
          const x = Math.min(
            Math.max(point.x, 0),
            Math.max(canvas.width - 1, 0),
          );
          const y = Math.min(
            Math.max(point.y, 0),
            Math.max(canvas.height - 1, 0),
          );
          const { data } = ctx.getImageData(x, y, 1, 1);
          return [data[0], data[1], data[2], data[3]] as [
            number,
            number,
            number,
            number,
          ];
        });
      },
      devicePoints as { x: number; y: number }[],
    );

  /**
   * The build running itself, for the scope {@link Harness.withOwnClock} opens.
   *
   * Nothing here calls `advance`, and nothing here closes a recorded frame: the
   * recorder is in `"raf"` mode for the whole scope, so the build's own
   * animation frame is what bounds a frame, and a capture running across the
   * scope holds the frames the build drew rather than the frames this harness
   * drove.
   */
  let openedAt: MeltdownSnapshot | null = null;
  const ownClock: OwnClock = {
    get opened(): MeltdownSnapshot {
      if (openedAt === null) {
        throw new Error("OwnClock.opened is only readable inside withOwnClock");
      }
      return openedAt;
    },
    settle: (ms) => page.waitForTimeout(ms),
    async gain(seconds, deadlineMs) {
      if (surfaceFault !== null) refuse();
      const from = (await debug.snapshot()).simTime;
      const startedMs = Date.now();
      try {
        // Polled INSIDE the page, so waiting costs one crossing however long the
        // wait runs — and so a host that is starving the page's frame callback is
        // not also being asked to service a round trip ten times a second.
        await page.waitForFunction(
          ([handle, target]) =>
            (
              window as unknown as Record<
                string,
                { snapshot(): { simTime: number } }
              >
            )[handle].snapshot().simTime >= (target as number),
          [HANDLE, from + seconds] as const,
          { timeout: deadlineMs, polling: OWN_CLOCK_POLL_MS },
        );
        return { reached: true, elapsedMs: Date.now() - startedMs };
      } catch {
        return { reached: false, elapsedMs: Date.now() - startedMs };
      }
    },
    read: () => debug.snapshot(),
    async press(code) {
      await page.keyboard.down(code);
      await page.waitForTimeout(PRESS_HOLD_MS);
      await page.keyboard.up(code);
    },
  };

  /** {@link Harness.withOwnClock}, hoisted so `settle` can reach it too. */
  const withOwnClock = async <T>(
    scenario: (clock: OwnClock) => Promise<T>,
  ): Promise<T> => {
    if (surfaceFault !== null) refuse();
    // Real elapsed time is the one thing a browser's own idea of which page
    // matters can distort. The launch already turns the throttling off;
    // bringing the page forward as well means this does not rest on a flag
    // alone.
    await page.bringToFront().catch(() => undefined);
    // The handover and the opening reading are ONE crossing. A scenario's first
    // statement used to be a `read`, which is a second round trip taken while the
    // build is already running itself — and on a loaded host that gap is long
    // enough for a posed tower to fire and for an opening state a check arranged
    // to have moved before the check saw it. Nothing runs between the
    // `setAutoStep(true)` and the `snapshot()` below, so `clock.opened` is the
    // state the scope opened in on any machine.
    openedAt = (await page.evaluate(
      ([handle]) => {
        (
          window as unknown as { __meltdownRec: { setMode(m: string): void } }
        ).__meltdownRec.setMode("raf");
        const api = (
          window as unknown as Record<
            string,
            { setAutoStep(on: boolean): void; snapshot(): unknown }
          >
        )[handle];
        api.setAutoStep(true);
        return api.snapshot();
      },
      [HANDLE] as const,
    )) as MeltdownSnapshot;
    try {
      return await scenario(ownClock);
    } finally {
      // In a `finally`, so a scenario that threw still leaves the clock where
      // every other helper in this file expects to find it.
      await page.evaluate(
        ([handle]) => {
          (
            window as unknown as Record<
              string,
              { setAutoStep(on: boolean): void }
            >
          )[handle].setAutoStep(false);
          (
            window as unknown as {
              __meltdownRec: { setMode(m: string): void };
            }
          ).__meltdownRec.setMode("manual");
        },
        [HANDLE] as const,
      );
      openedAt = null;
    }
  };

  const harness: Harness = {
    page,
    debug,
    surfaceFault,
    pageErrors,

    frame: () => frameCount,
    timeMs: () => timeMs,

    snapshot: () => debug.snapshot(),

    advance: async (frames) => {
      await drive(frames);
    },

    async until(predicate, untilOptions = {}) {
      const maxFrames = untilOptions.maxFrames ?? 600;
      const poll = Math.max(1, untilOptions.poll ?? 1);

      let snapshot = await this.snapshot();
      if (predicate(snapshot)) return { hit: true, frames: 0, snapshot };

      let frames = 0;
      while (frames < maxFrames) {
        const step = Math.min(poll, maxFrames - frames);
        snapshot = await drive(step);
        frames += step;
        if (predicate(snapshot)) return { hit: true, frames, snapshot };
      }
      return { hit: false, frames, snapshot };
    },

    async skip(duration, hz = 60) {
      await coast(duration, Math.ceil(duration * hz));
    },

    async skipUntil(predicate, skipOptions = {}) {
      const maxSeconds = skipOptions.maxSeconds ?? 60;
      const pollSeconds = Math.max(1e-3, skipOptions.pollSeconds ?? 0.5);
      const hz = skipOptions.hz ?? 60;

      let snapshot = await this.snapshot();
      if (predicate(snapshot)) return { hit: true, elapsed: 0, snapshot };

      let elapsed = 0;
      while (elapsed < maxSeconds) {
        const step = Math.min(pollSeconds, maxSeconds - elapsed);
        snapshot = await coast(step, Math.ceil(step * hz));
        elapsed += step;
        if (predicate(snapshot)) return { hit: true, elapsed, snapshot };
      }
      return { hit: false, elapsed, snapshot };
    },

    withOwnClock,

    settle: (ms) => withOwnClock((clock) => clock.settle(ms)),

    hold: (code) => page.keyboard.down(code),
    release: (code) => page.keyboard.up(code),
    async tap(code) {
      // Down, ONE frame, up. The frame between the two is what makes this a press
      // a build can actually see: an engineless build wrote its own keyboard
      // layer, and the two conformant ways to read a press — latching the edge in
      // the event handler, or comparing held state at the top of each frame —
      // agree only if the key is genuinely held while a frame runs. A down and an
      // up delivered back to back would be invisible to the second, which is a
      // build a real player has no trouble with. `specs/controls.md` reads every
      // action as a press edge that fires once per press, which is exactly what
      // this delivers. Exactly one frame passes either way, so nothing a caller
      // counts moves.
      await page.keyboard.down(code);
      await drive(1);
      await page.keyboard.up(code);
    },
    async holdFor(codes, frames) {
      const keys = typeof codes === "string" ? [codes] : [...codes];
      for (const code of keys) await page.keyboard.down(code);
      try {
        if (frames > 0) await drive(frames);
      } finally {
        for (const code of keys) await page.keyboard.up(code);
      }
    },

    async frameCalls() {
      await drive(1);
      const ops = (await page.evaluate(() =>
        (
          window as unknown as { __meltdownRec: { last(): unknown[] } }
        ).__meltdownRec.last(),
      )) as RecordedOp[];
      return ops.map(toDrawCall);
    },

    probe: (names) =>
      page.evaluate(
        ([handle, wanted]) => {
          const target =
            (window as unknown as Record<string, Record<string, unknown>>)[
              handle
            ] ?? {};
          const ops: Record<string, string> = {};
          for (const name of wanted) ops[name] = typeof target[name];
          return { version: target.version, ops };
        },
        [HANDLE, [...names]] as const,
      ),

    viewport: () => ({ ...view }),
    device: (x, y) => toDevice(view, x, y),
    css: (x, y) => {
      const at = toDevice(view, x, y);
      return { x: at.x / dpr, y: at.y / dpr };
    },
    pixel: async (x, y) => (await readPixels([toDevice(view, x, y)]))[0],
    pixels: (points) => readPixels(points.map((p) => toDevice(view, p.x, p.y))),
    devicePixel: async (x, y) => (await readPixels([{ x, y }]))[0],

    surface: () =>
      page.evaluate(() => {
        const canvases = Array.from(document.querySelectorAll("canvas"));
        if (canvases.length === 0) {
          throw new Error(
            "meltdown: the page has no <canvas>, so the build drew nowhere — " +
              "index.html supplies one and the build is asked not to edit it " +
              "(specs/overview.md)",
          );
        }
        let canvas = canvases[0];
        for (const other of canvases) {
          if (other.width * other.height > canvas.width * canvas.height)
            canvas = other;
        }
        return {
          width: canvas.width,
          height: canvas.height,
          dpr: window.devicePixelRatio,
        };
      }),

    async armAudio() {
      // A GENUINE browser gesture, not a posed one: a build is free to open its
      // audio context from a real DOM event alone (both are conformant), so a key
      // delivered any other way would leave a perfectly good build silent. The
      // key is bound to nothing (specs/controls.md binds every other key it names
      // and `Backquote`), so arming changes no game state and toggles no overlay.
      await page.keyboard.press(UNBOUND_KEY);
    },

    sounds: () =>
      page.evaluate(() =>
        (
          window as unknown as { __meltdownAudio: { started(): number } }
        ).__meltdownAudio.started(),
      ),

    async dispose() {
      // The context stays: it holds the init scripts and the window shape, and the
      // next harness of this shape wants both. The page goes, so nothing this
      // check pressed, opened or muted can reach the next one.
      openPages.delete(page);
      await page.close().catch(() => undefined);
    },
  };

  harnessCues.set(harness, cueSinks);
  return harness;
}

/** Where {@link watchCues} attaches, per harness. */
const harnessCues = new WeakMap<Harness, TimedCue[][]>();

/* ---- The fit -------------------------------------------------------------- */

/**
 * How the stage maps onto a surface of this shape, as `specs/overview.md` fixes
 * it: one uniform scale, the whole stage inside, centred, with the leftover
 * split evenly into two letterbox bars.
 *
 * Computed rather than read from the build, deliberately. Under an engine the
 * fit is the engine's and a check can ask it what it derived; here the fit is
 * the build's own work, so asking it would be asking a build to grade itself.
 * Every check but `floor/stage-fit` runs at the stage's own size, where this is
 * the identity and the question does not arise; that one check runs at other
 * shapes and reads the pixels against what the specification says should be
 * there.
 */
export function fitViewport(
  cssWidth: number,
  cssHeight: number,
  dpr: number,
): Viewport {
  const deviceWidth = Math.round(cssWidth * dpr);
  const deviceHeight = Math.round(cssHeight * dpr);
  const scale = Math.min(cssWidth / STAGE_W, cssHeight / STAGE_H) * dpr;
  return {
    width: STAGE_W,
    height: STAGE_H,
    scale,
    offsetX: (deviceWidth - STAGE_W * scale) / 2,
    offsetY: (deviceHeight - STAGE_H * scale) / 2,
  };
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

/* ---- Draw calls ----------------------------------------------------------- */

/** One operation as the injected recorder writes it. */
export type RecordedOp =
  | {
      op: "call";
      method: string;
      args: unknown[];
      width?: number;
      textAlign?: string;
    }
  | { op: "set"; property: string; value: unknown };

function toDrawCall(op: RecordedOp): DrawCall {
  return op.op === "call"
    ? {
        kind: "call",
        method: op.method,
        args: op.args,
        width: op.width,
        textAlign: op.textAlign,
      }
    : { kind: "set", property: op.property, value: op.value };
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
//    kept is the part the check is ABOUT and never the setup that got there.
//    Meltdown gives that its sharpest form: a trip is five seconds of a tower
//    strobing, and a section that sat through a fifteen-second build phase
//    before it would fill the capture budget with the wait. So arm around the
//    cooldown — `captureReplay(h, "id", () => h.advance(framesFor(TRIP_TIME)))`
//    — and put the wait outside it, or off camera entirely with
//    {@link Harness.skip}, which closes no frame at all.
// 2. IT IS EVIDENCE, NEVER A VERDICT. The scenario's own value comes straight
//    back, and a scenario that THROWS still writes what it had recorded before
//    the failure travels on — a failing check is the one whose replay a reviewer
//    most wants. A recording that cannot be written is reported as an output that
//    never turned up, which is a fact about the host rather than about the build.
// 3. IT WRITES ONLY WHAT THERE IS TO LOOK AT. A capture that closed no frames
//    leaves no file, so the run reports the output absent instead of offering the
//    reviewer a replay of nothing.
// 4. IT COSTS NOTHING WHEN NOBODY IS COLLECTING. Outside a run the media
//    directory is unset and the whole thing is a no-op that still runs the
//    scenario, so a check cannot pass in one place and fail in the other.

/** The environment variable the runner names the media directory in. */
const MEDIA_DIR_ENV = "TCAB_VALIDATION_MEDIA_DIR";

/**
 * The directory the runner stages this project to inside the build's tree.
 *
 * A recording is addressed by the STAGED path of the suite that produced it —
 * `validation/heat/air-cooling-rate.test.ts` — because that is the path the
 * review item's declared script resolves to, and so the only name the case's
 * manifest and the runner both already agree on. Stating the prefix here is what
 * keeps that address the same when this suite is run in place against a
 * reference implementation, where the project root is `validation/none/` instead.
 */
const STAGED_PROJECT_DIR = "validation";

/**
 * The most frames a written recording holds.
 *
 * The injected recorder already holds the page's side to twice this, decimating
 * as it fills, so what arrives here is at most a few hundred frames however long
 * the section ran. This is the same cap the engine-backed harnesses write under,
 * so a replay recorded under any of the three engines is the same size of thing.
 */
const MAX_REPLAY_FRAMES = 300;

/**
 * The ground the console's player paints behind a recorded frame.
 *
 * The specification fixes no floor colour: the build paints its own background
 * each frame, and the recorded frames carry that paint. What the player needs is
 * a colour for the canvas under them, and the page the build is served on is
 * painted `#000` by the case's own `index.html`, so that is what a replay says.
 */
export const REPLAY_BACKGROUND = "#000";

/** One frame of a recording, as the console's player reads it. */
export interface RecordedFrame {
  count: number;
  timeMs: number;
  deltaMs: number;
  surface: { width: number; height: number };
  /** Index into the recording's `states` of the state this frame inherited. */
  state: number;
  /**
   * Indices into the recording's `states` of the states saved under this frame,
   * outermost first.
   */
  stack: number[];
  /** Indices into the recording's `ops`, in the order the frame issued them. */
  ops: number[];
  /**
   * Whether part of what this frame inherited was too large for the format to
   * carry, and was cut down to the bound. Present only on a frame that was.
   */
  truncated?: boolean;
}

/** The context state a frame is drawn from, before its own operations. */
export interface RecordedState {
  properties: Record<string, unknown>;
  /** The transform in force, as the canvas's `[a, b, c, d, e, f]`. */
  transform: number[] | null;
  lineDash: number[] | null;
  /** The clip region in force, as the segments that built it, in order. */
  clip: RecordedPathSegment[];
  /** The current path, as the operations issued since the last `beginPath`. */
  path: RecordedPathSegment[];
}

/**
 * One run of path operations, and the transform they were issued under.
 *
 * A path is given in user space, so both the clip and the current path are split
 * into one segment per transform and a player replays each under its own.
 */
export interface RecordedPathSegment {
  transform: number[] | null;
  ops: RecordedOp[];
}

/** A value the context produced, as the recipe that rebuilds it. */
export interface RecordedResource {
  make: { method: string; args: unknown[] };
  then: RecordedOp[];
}

/** One bitmap the recording captured, as the player reads it. */
export interface RecordedImage {
  width: number;
  height: number;
  /** A data URL of the bitmap's pixels, absent when the budget degraded it. */
  src?: string;
}

/**
 * A recording, as the console's player reads it.
 *
 * A frame names its state and its operations by index, and the values those
 * operations draw with — the gradients, the captured images — live in tables the
 * whole recording shares. So every reference a frame makes resolves at whichever
 * frame a reviewer lands on, and each distinct thing is written once.
 */
export interface Recording {
  format: number;
  width: number;
  height: number;
  background: string | null;
  images: RecordedImage[];
  resources: RecordedResource[];
  ops: RecordedOp[];
  states: RecordedState[];
  frames: RecordedFrame[];
}

/**
 * Where the running suite's `outputId` output belongs, or `null` when nothing is
 * collecting media.
 *
 * The suite is the one vitest is currently running rather than one the caller
 * names, because the two must not be able to disagree: a check that named its own
 * path would be free to write its evidence under some other point's address.
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
 * WITH. Tables carried over whole would put operations, gradients and images in
 * the file that no frame asks for — dead weight in a document whose whole point
 * is to say each thing once, and the bulk of it in a game that draws
 * procedurally and so repeats almost nothing between frames.
 *
 * Every entry here is reached from a kept frame, and every reference inside one
 * is rewritten as it is reached, transitively. What is deduplicated is the
 * rewritten entry, so an operation two hundred frames issue identically is
 * written once and named two hundred times.
 *
 * Exported for the suite beside this file, which drives it over a recording a
 * browser cannot deliver: Playwright's serializer drops an own field named
 * `__proto__` on the way out of the page, so handing one to this directly is the
 * only way to check that the rewrite carries it.
 */
export function retable(
  recording: Recording,
  frames: RecordedFrame[],
): Recording {
  const images: RecordedImage[] = [];
  const imageAt = new Map<number, number>();
  const resources: RecordedResource[] = [];
  const resourceAt = new Map<number, number>();
  const ops: RecordedOp[] = [];
  const opAt = new Map<string, number>();
  const states: RecordedState[] = [];
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
    // A recipe's own arguments can only name values made before it, so rewriting
    // it terminates and cannot re-enter this resource.
    const rebuilt: RecordedResource = {
      make: { method: recipe.make.method, args: recipe.make.args.map(value) },
      then: recipe.then.map(operation),
    };
    const index = resources.length;
    resources.push(rebuilt);
    resourceAt.set(source, index);
    return index;
  };

  const value = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(value);
    if (entry === null || typeof entry !== "object") return entry;
    const record = entry as Record<string, unknown>;
    if (typeof record.$img === "number")
      return { $img: takeImage(record.$img) };
    if (typeof record.$res === "number")
      return { $res: takeResource(record.$res) };
    const rewritten: Record<string, unknown> = {};
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

  const operation = (op: RecordedOp): RecordedOp =>
    op.op === "call"
      ? { op: "call", method: op.method, args: op.args.map(value) }
      : { op: "set", property: op.property, value: value(op.value) };

  const segments = (list: RecordedPathSegment[]): RecordedPathSegment[] =>
    list.map((segment) => ({
      transform: segment.transform,
      ops: segment.ops.map(operation),
    }));

  const stateOf = (state: RecordedState): RecordedState => {
    const properties: Record<string, unknown> = {};
    for (const [name, held] of Object.entries(state.properties)) {
      Object.defineProperty(properties, name, {
        value: value(held),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return {
      properties,
      transform: state.transform,
      lineDash: state.lineDash,
      clip: segments(state.clip),
      path: segments(state.path),
    };
  };

  const takeState = (source: number): number =>
    intern(states, stateAt, stateOf(recording.states[source]));

  return {
    ...recording,
    images,
    resources,
    ops,
    states,
    frames: frames.map((frame) => ({
      ...frame,
      state: takeState(frame.state),
      stack: frame.stack.map(takeState),
      ops: frame.ops.map((op) =>
        intern(ops, opAt, operation(recording.ops[op])),
      ),
    })),
  };
}

/**
 * A recording of at most {@link MAX_REPLAY_FRAMES} frames, covering the whole of
 * what was captured, with each kept frame's `deltaMs` restated as the time since
 * the frame kept before it.
 *
 * The restatement is what makes a decimated recording play at the speed the game
 * really ran at: the deltas still sum to the section's elapsed time. The frame
 * `count` is left as it was recorded, so a reader can see that frames were
 * skipped rather than being told a smooth lie. The last frame is always kept
 * whatever the stride lands on — it is the frame the check's sweep stopped at,
 * and the one a reviewer looks at first.
 *
 * Keeping it costs a frame rather than the cap. The stride rounds up, so a
 * section whose length is an exact multiple of the cap strides over exactly that
 * many frames and stops one stride short of the end: the last frame still has to
 * come in, and the cap is a ceiling rather than a target. It takes the place of
 * the final strided frame — the frame nearest it, so the swap opens the smallest
 * gap available anywhere in the section — and is measured from where that frame
 * was measured from, which is what keeps the kept deltas summing to the elapsed
 * time.
 *
 * Exported for the suite beside this file, which reaches it over frame counts a
 * driven section cannot hand it.
 */
export function thinReplay(recording: Recording): Recording {
  const { frames } = recording;
  if (frames.length === 0) return recording;

  const stride = Math.max(1, Math.ceil(frames.length / MAX_REPLAY_FRAMES));
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
 * A capture that closed no frames writes nothing: a file holding an empty frame
 * list would be collected as an output that turned up, and the run would tell the
 * reviewer there is a replay to watch and then open the player on nothing.
 *
 * What lands on disk is gzip rather than raw JSON. A recording is text made
 * almost entirely of numbers and repeated field names, which gzip takes down to a
 * fraction of its size, and every host that serves one declares the encoding so
 * the browser inflates it before the player sees it.
 *
 * Never throws. A file that cannot be written says something about the machine
 * the validators ran on, and failing the point over it would blame the build for
 * the host's problem.
 */
function writeReplay(destination: string, recording: Recording | null): void {
  if (recording === null || recording.frames.length === 0) return;
  try {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, gzipSync(JSON.stringify(thinReplay(recording))));
  } catch (error) {
    console.warn(`meltdown: could not write ${destination}: ${String(error)}`);
  }
}

/**
 * Record the frames `scenario` drives and keep them as the review item's
 * `outputId` output, handing back whatever the scenario returned.
 *
 * Wrap the drive, not the arrangement:
 *
 * ```ts
 * const swept = await captureReplay(h, "discharge", () =>
 *   h.advance(framesFor(ARC_LIFE)),
 * );
 * ```
 *
 * The assertions stay exactly where they were and read exactly what they did.
 */
export async function captureReplay<T>(
  h: Harness,
  outputId: string,
  scenario: () => T | Promise<T>,
): Promise<T> {
  const destination = mediaDestination(outputId, "json.gz");
  if (destination === null) return scenario();

  await h.page.evaluate(
    (design) =>
      (
        window as unknown as { __meltdownRec: { arm(d: unknown): boolean } }
      ).__meltdownRec.arm(design),
    { width: STAGE_W, height: STAGE_H, background: REPLAY_BACKGROUND },
  );
  try {
    return await scenario();
  } finally {
    // In a `finally`, so a scenario that failed still leaves its evidence behind.
    const recording = (await h.page.evaluate(() =>
      (
        window as unknown as { __meltdownRec: { disarm(): unknown } }
      ).__meltdownRec.disarm(),
    )) as Recording | null;
    writeReplay(destination, recording);
  }
}

/**
 * Keep the picture currently on the canvas as the review item's `outputId`
 * output.
 *
 * The companion to {@link captureReplay}, for a point whose evidence is one
 * PICTURE rather than a stretch of motion: which screen the game opened on, how
 * a build drew its four charge states, where the letterbox bars fell.
 *
 * What is written is whatever the last frame that RAN left behind, so call it
 * after the frame that poses the thing under test and before the assertions, so
 * a check that fails still leaves the picture that shows why. Nothing here can
 * change a verdict: outside a run this is a no-op, and a still that cannot be
 * written is reported as an output that never turned up.
 */
export async function captureStill(
  h: Harness,
  outputId: string,
): Promise<void> {
  const destination = mediaDestination(outputId, "png");
  if (destination === null) return;
  try {
    mkdirSync(dirname(destination), { recursive: true });
    await h.page.screenshot({ path: destination, type: "png" });
  } catch (error) {
    console.warn(`meltdown: could not write ${destination}: ${String(error)}`);
  }
}

/* -------------------------------------------------------------------------- */
/* Cues                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Record every sound the build emits from now on, stamped with the frame of the
 * drive it sounded on.
 *
 * WHAT IS OBSERVED, AND WHY IT IS THE FAIR READING. `specs/audio.md` requires
 * one cue per event, raised by the frame that resolves it, and says nothing at all
 * about how a build makes a sound — under this engine the whole audio layer is
 * the build's. So `audio-init.js` watches the two doors a browser can emit sound
 * through (a Web Audio source being `start()`ed, whatever kind it is, and an
 * `<audio>` element being played) and counts what goes through them; the harness
 * brackets each driven frame around that count, so a sound is attributed to the
 * frame that produced it. A blip made of two oscillators counts as two, which is
 * why a check asserts that a frame sounded rather than how many times: the number
 * of sources is the build's business and the specification never fixed it.
 *
 * WHAT IS LOST HERE THAT AN ENGINE GIVES. The cue's NAME. Under an engine the
 * game asks the bus for `CUES.trip` by name and the bus announces it, so a build
 * that plays its menu blip on every shot is caught. There is no bus here to ask,
 * so these checks confirm that a sound was emitted and on which frame, and a
 * reviewer decides by ear whether the ten are told apart. That is a real
 * reduction, and the alternative — inferring the cue from the waveform the
 * reference happens to use — would grade builds against an implementation rather
 * than against the specification. NO CHECK IN THIS PROJECT MAY ASSERT A CUE NAME.
 *
 * A sound emitted inside {@link Harness.skip} is attributed to the frame the skip
 * ended on, since a skip closes no frames of its own: run the frames a cue check
 * reads with {@link Harness.advance}.
 */
export function watchCues(h: Harness): TimedCue[] {
  const played: TimedCue[] = [];
  harnessCues.get(h)?.push(played);
  return played;
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
 * Whether the frame drew `word` as a STANDALONE token, ignoring case.
 *
 * The stricter sibling of {@link drewText}, for the copy `specs/screens.md` and
 * `specs/hud.md` require as a word rather than as a substring — a readout's
 * `WAVE` label, or the how-to screen naming a key. A panel reading "waveform"
 * contains `wave` and does not carry the label the specification named.
 */
export function drewWord(calls: readonly DrawCall[], word: string): boolean {
  const pattern = new RegExp(
    `(^|[^A-Za-z0-9])${word.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z0-9]|$)`,
    "i",
  );
  return drawnText(calls).some((drawn) => pattern.test(drawn));
}

/** One run of text a frame drew, and where it drew it in logical stage units. */
export interface TextDraw {
  text: string;
  /** The anchor the run was drawn at, mapped through the transform in force. */
  x: number;
  y: number;
  /**
   * The horizontal extent of the run's glyphs, in logical stage units.
   *
   * The width the context measured at the call, scaled by the transform in force
   * and laid out about the anchor as the alignment then in force places it. A
   * run whose width the recorder could not read spans its anchor alone, so
   * `left` and `right` are both `x`.
   */
  left: number;
  right: number;
}

/** A 2D affine transform, in the canvas's `[a, b, c, d, e, f]` order. */
export type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function numbers(args: unknown[], count: number): number[] | null {
  const taken = args.slice(0, count);
  return taken.length === count && taken.every((v) => typeof v === "number")
    ? (taken as number[])
    : null;
}

/** Where a user-space point lands once `m` is applied. */
export function applyMatrix(
  m: Matrix,
  x: number,
  y: number,
): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

/**
 * Walk a frame's operations, handing `visit` each one with the transform in
 * force at it.
 *
 * A build is free to draw under a transform — to translate to a tile and draw at
 * the origin, or to draw a rotated footprint under a turn — so the
 * position and the orientation a call names are only what they mean once the
 * transform at that call is applied. This carries `save`/`restore`, `translate`,
 * `scale`, `rotate`, `transform`, `setTransform` and `resetTransform`, starting
 * from `start` (the state the frame inherited) over `stack` (the states saved
 * under it, outermost first).
 */
export function walkTransforms(
  calls: readonly DrawCall[],
  visit: (call: DrawCall, m: Matrix) => void,
  start: Matrix = IDENTITY,
  stack: readonly Matrix[] = [],
): void {
  const saved: Matrix[] = [...stack];
  let current: Matrix = start;
  for (const call of calls) {
    if (call.kind !== "call") {
      visit(call, current);
      continue;
    }
    const { method, args } = call;
    if (method === "save") {
      saved.push(current);
    } else if (method === "restore") {
      current = saved.pop() ?? IDENTITY;
    } else if (method === "translate") {
      const v = numbers(args, 2);
      if (v) current = multiply(current, [1, 0, 0, 1, v[0], v[1]]);
    } else if (method === "scale") {
      const v = numbers(args, 2);
      if (v) current = multiply(current, [v[0], 0, 0, v[1], 0, 0]);
    } else if (method === "rotate") {
      const v = numbers(args, 1);
      if (v) {
        const c = Math.cos(v[0]);
        const sn = Math.sin(v[0]);
        current = multiply(current, [c, sn, -sn, c, 0, 0]);
      }
    } else if (method === "transform") {
      const v = numbers(args, 6);
      if (v) current = multiply(current, v as Matrix);
    } else if (method === "setTransform") {
      const v = numbers(args, 6);
      if (v) current = v as Matrix;
      else if (args.length === 0) current = IDENTITY;
      else if (typeof args[0] === "object" && args[0] !== null) {
        const m = args[0] as Record<string, unknown>;
        const parts = [m.a, m.b, m.c, m.d, m.e, m.f];
        if (parts.every((p) => typeof p === "number"))
          current = parts as Matrix;
      }
    } else if (method === "resetTransform") {
      current = IDENTITY;
    }
    visit(call, current);
  }
}

/**
 * Every run of text the frame drew, with its anchor in logical stage units.
 *
 * At the harness's default shape the canvas is the stage at one pixel per unit,
 * so what comes back is directly comparable with the figures `specs/floor.md`
 * fixes — which is how `hud/*` reads where a readout landed.
 */
export function textDraws(calls: readonly DrawCall[]): TextDraw[] {
  const draws: TextDraw[] = [];
  walkTransforms(calls, (call, m) => {
    if (call.kind !== "call") return;
    if (call.method !== "fillText" && call.method !== "strokeText") return;
    const [text] = call.args;
    const at = numbers(call.args.slice(1), 2);
    if (typeof text !== "string" || at === null) return;
    const anchor = applyMatrix(m, at[0], at[1]);
    // The run's width under the same horizontal scale the anchor took, laid out
    // about the anchor the way the alignment in force places it.
    const width =
      typeof call.width === "number" && Number.isFinite(call.width)
        ? call.width * Math.hypot(m[0], m[1])
        : 0;
    const before =
      call.textAlign === "center"
        ? width / 2
        : call.textAlign === "right" || call.textAlign === "end"
          ? width
          : 0;
    draws.push({
      text,
      ...anchor,
      left: anchor.x - before,
      right: anchor.x - before + width,
    });
  });
  return draws;
}

/** The geometry calls a frame made, by name. */
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
 * Every logical point a frame's drawing calls named, mapped through the
 * transform in force at each.
 *
 * The leading pair of arguments is the position for every method listed, except
 * the curve calls, whose control points come first and whose endpoint is the
 * last pair.
 */
export function drawnPoints(
  calls: readonly DrawCall[],
): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  walkTransforms(calls, (call, m) => {
    if (call.kind !== "call") return;
    const { method, args } = call;
    const push = (x: unknown, y: unknown): void => {
      if (typeof x === "number" && typeof y === "number") {
        points.push(applyMatrix(m, x, y));
      }
    };
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
    } else if (method === "drawImage") {
      // The source comes first, so the destination is the pair after it — or,
      // in the nine-argument form, the pair after the source sub-rect.
      if (args.length >= 9) push(args[5], args[6]);
      else push(args[1], args[2]);
    } else if (method === "quadraticCurveTo") {
      push(args[0], args[1]);
      push(args[2], args[3]);
    } else if (method === "bezierCurveTo") {
      push(args[0], args[1]);
      push(args[2], args[3]);
      push(args[4], args[5]);
    }
  });
  return points;
}

/* -------------------------------------------------------------------------- */
/* Colour                                                                     */
/* -------------------------------------------------------------------------- */
//
// `specs/overview.md` fixes NO PALETTE — the colours, the type and the glow are
// the build's — and states instead, in its legibility table, what a player must
// read at a glance: a tower's heat ramp cold against near-redline, a tripped
// tower against an online one at the same heat, a tower against the floor, the
// surge against both, a valid preview against an invalid one. So every colour
// check is a comparison between two things the build drew, never against a hex
// value, and the DISTANCE it demands is the check's own figure, stated in the
// check. Nothing here fixes one.

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

/** A colour's luminance: the reading a ramp brightens along. */
export function luminance(c: Rgb): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/**
 * The five offsets a colour sample is averaged over, in logical units.
 *
 * The centre plus four neighbours four units out — inside a 19-unit tile with
 * room to spare, and well inside the body of the smallest 2x2 footprint — so one
 * stray anti-aliased or glow pixel cannot swing the reading.
 */
const SAMPLE_OFFSETS: readonly (readonly [number, number])[] = [
  [0, 0],
  [4, 0],
  [-4, 0],
  [0, 4],
  [0, -4],
];

/** The rendered colour at a logical point, averaged over that small cluster. */
export async function sampleColor(
  h: Harness,
  x: number,
  y: number,
): Promise<Rgb> {
  const read = await h.pixels(
    SAMPLE_OFFSETS.map(([dx, dy]) => ({ x: x + dx, y: y + dy })),
  );
  let r = 0;
  let g = 0;
  let b = 0;
  for (const [pr, pg, pb] of read) {
    r += pr;
    g += pg;
    b += pb;
  }
  return { r: r / read.length, g: g / read.length, b: b / read.length };
}

/** {@link sampleColor} at a tile's centre. */
export function sampleTile(h: Harness, col: number, row: number): Promise<Rgb> {
  return sampleColor(h, tileCX(col), tileCY(row));
}

/** {@link sampleColor} at a tower's footprint centre, read off the snapshot. */
export function sampleTower(h: Harness, tower: TowerView): Promise<Rgb> {
  const centre = footprintCentre(tower.col, tower.row, tower.size);
  return sampleColor(h, centre.x, centre.y);
}

/**
 * Tiles a floor posed by {@link startRun} leaves bare: on the floor, clear of
 * every opening and of both straight vent-to-exhaust corridors, and spread
 * across it so no one readout, banner or overlay a build chose to draw over the
 * floor can cover them all.
 */
export const BARE_TILES: readonly Tile[] = [
  { col: 4, row: 4 },
  { col: 44, row: 6 },
  { col: 6, row: 30 },
  { col: 40, row: 31 },
  { col: 15, row: 12 },
];

/**
 * The bare floor's colour: the darkest of {@link BARE_TILES}, sampled off the
 * canvas as it stands.
 *
 * The darkest of several rather than one fixed patch, because the grid is drawn
 * on the floor at all times and a build is free to put a banner, a hint or a
 * zone marking anywhere it likes — and a patch something is drawn over reads
 * lighter than one nothing is.
 */
export async function sampleFloor(h: Harness): Promise<Rgb> {
  const samples: Rgb[] = [];
  for (const tile of BARE_TILES) {
    samples.push(await sampleTile(h, tile.col, tile.row));
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
// nothing a check could not compute itself; they exist so that eighteen groups
// spell the same lookup the same way, and so that a lookup that finds nothing
// fails with the entity it wanted named rather than as a `TypeError` two lines
// later.

/** The tower with that id, or `undefined`. */
export function towerById(
  snapshot: MeltdownSnapshot,
  id: number,
): TowerView | undefined {
  return snapshot.towers.find((tower) => tower.id === id);
}

/** The tower with that id, failing the check with the scenario it needed. */
export function requireTower(
  snapshot: MeltdownSnapshot,
  id: number,
  doing = "the scenario",
): TowerView {
  const tower = towerById(snapshot, id);
  if (tower === undefined) {
    fail(
      `tower ${id} still on the floor (${doing})`,
      `towers ${JSON.stringify(snapshot.towers.map((t) => t.id))}`,
    );
  }
  return tower;
}

/** The surge unit with that id, or `undefined`. */
export function unitById(
  snapshot: MeltdownSnapshot,
  id: number,
): UnitView | undefined {
  return snapshot.surge.find((unit) => unit.id === id);
}

/** The surge unit with that id, failing the check with the scenario it needed. */
export function requireUnit(
  snapshot: MeltdownSnapshot,
  id: number,
  doing = "the scenario",
): UnitView {
  const unit = unitById(snapshot, id);
  if (unit === undefined) {
    fail(
      `unit ${id} still on the floor (${doing})`,
      `surge ${JSON.stringify(snapshot.surge.map((u) => u.id))}`,
    );
  }
  return unit;
}

/**
 * The last entry of a roster: the entity an `add` operation just appended.
 *
 * `specs/instrumentation.md` makes appending the rule precisely so an id is
 * findable without an assignment scheme, and these two are that rule.
 */
export function lastTower(snapshot: MeltdownSnapshot): TowerView | undefined {
  return snapshot.towers[snapshot.towers.length - 1];
}

export function lastUnit(snapshot: MeltdownSnapshot): UnitView | undefined {
  return snapshot.surge[snapshot.surge.length - 1];
}

/** Every tower of one type, in roster order. */
export function towersOfType(
  snapshot: MeltdownSnapshot,
  type: TowerType,
): TowerView[] {
  return snapshot.towers.filter((tower) => tower.type === type);
}

/** Every surge unit of one type, in roster order. */
export function unitsOfType(
  snapshot: MeltdownSnapshot,
  type: SurgeType,
): UnitView[] {
  return snapshot.surge.filter((unit) => unit.type === type);
}

/** The tile a stage centre falls in (`specs/floor.md`). */
export function tileOf(x: number, y: number): Tile {
  return { col: colAt(x), row: rowAt(y) };
}

/** Whether two tiles are the same tile. */
export function sameTile(a: Tile, b: Tile): boolean {
  return a.col === b.col && a.row === b.row;
}

/** Every tile a tower's footprint covers, as the snapshot reports the tower. */
export function towerTiles(tower: TowerView): Tile[] {
  return footprintTiles(tower.col, tower.row, tower.size);
}

/** A tower's footprint centre: the point range and splash are measured from. */
export function towerCentre(tower: TowerView): { x: number; y: number } {
  return footprintCentre(tower.col, tower.row, tower.size);
}

/** The distance between two stage points, in logical units. */
export function distance(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** The distance between two stage points, in TILES: what a range is measured in. */
export function tileDistance(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return distance(a, b) / TILE;
}

/** How far a unit travelled between two readings, in logical units. */
export function travelled(a: UnitView, b: UnitView): number {
  return distance(a, b);
}

/* -------------------------------------------------------------------------- */
/* Scenario helpers                                                           */
/* -------------------------------------------------------------------------- */
//
// EVERY COMPOUND SEQUENCE IN THIS PROJECT LIVES HERE. The debug surface is
// atomic — `specs/instrumentation.md` gives it one operation per field — so
// there is no `startGame(mode, difficulty)`, no `placeTower(type, col, row)` and
// no `setTower(patch)` to reach for, and there must not be: a compound operation
// would decide, inside the build, several things that are several review items.
// What a check wants instead is a helper, built out of those atomic operations,
// that poses the floor and then lets the build's own update run from there.
//
// A CHECK TAKES ONLY THE PART IT ASKS FOR. Nothing below does anything a caller
// did not ask for: `startRun` empties two rosters, shuts the world gate and
// poses a live build phase, and a check that wants a tower asks for one. A check
// that needs half a sequence calls the operations it needs.
//
// THE ATOM AND THE ACT ARE NOT INTERCHANGEABLE. `poseTower` builds a floor
// through `addTower`, which costs nothing and runs no placement check; a check
// ABOUT placing calls `place`, and a check about selling calls `sellTower`. No
// helper here reaches an act on the way to a scenario the act is not about, and
// none of them spends money.
//
// AND NONE OF THEM ASSERTS A VERDICT. A helper fails only when the game is not
// even in the situation the caller's scenario needs — an `addTower` that
// appended nothing — and then with what it needed named.

/**
 * Pose an empty, quiet, live run at a between-wave build phase, ready for a
 * scenario.
 *
 * The sequence, and why each part of it is here:
 *
 *   - THE MODE AND THE DIFFICULTY FIRST, because `waveCount`, `startMoney`,
 *     `startLives`, `interest` and `buildZone` are derived from them
 *     (`specs/modes.md`) and the money and lives posed below are that row's.
 *     Those two figures are computed HERE from the specification's own table,
 *     never read back off the build: a run posed with the build's idea of its
 *     own starting money would be a scenario grading nothing.
 *   - BOTH ROSTERS ARE EMPTIED. `clearTowers`, `clearSurge`. An empty floor is
 *     safe because of the wave-clear rule (`specs/waves.md`): a wave clears on
 *     the transition in which its last unit goes, so a phase that never released
 *     one never clears.
 *   - THE WORLD GATE IS SHUT. Without `setWaveSpawning(false)` the fifteen
 *     seconds of `BUILD_PHASE_TIME` on the clock would auto-start Wave 1, and
 *     the spawner would then release a unit every `WAVE_SPAWN_INTERVAL` — so any
 *     scenario spending more than a second of game time would be invaded. The
 *     gate is the RUN's own faculty rather than any entity's, which is why
 *     shutting it is not "parking something in a harmless corner". THE ITEMS
 *     THAT TURN IT BACK ON ARE THE ITEMS WHOSE REQUIREMENT THE GATE IS; any
 *     other check that finds itself wanting it on has been mis-posed.
 *   - THE SCREEN IS LIVE, at `playing`/`building` on Wave 1 with a full build
 *     timer, which is the phase a player builds a maze in.
 *   - NOTHING IS ARMED, HOVERED OR SELECTED, and the speed is back at 1, so a
 *     check reads the panel the build draws for an idle floor.
 *
 * It poses no tower and no unit: a check adds exactly what its requirement
 * concerns.
 */
export async function startRun(
  h: Harness,
  mode: ModeId = "containment",
  difficulty: DifficultyId = "medium",
): Promise<void> {
  const { debug } = h;
  const figures = modeFigures(mode, difficulty);
  await debug.reset();
  await debug.setMode(mode);
  await debug.setDifficulty(difficulty);
  await debug.clearTowers();
  await debug.clearSurge();
  await debug.setScreen("playing");
  await debug.setPhase("building");
  await debug.setWave(1);
  await debug.setBuildTimer(BUILD_PHASE_TIME);
  await debug.setWavePending(0);
  await debug.setWaveSpawning(false);
  await debug.setMoney(figures.startMoney);
  await debug.setLives(figures.startLives);
  await debug.setScore(0);
  await debug.setSelected(null);
  await debug.setHoverShop(null);
  await debug.setArmed(null);
  await debug.setSpeed(1);
}

/**
 * Add one tower with its footprint's top-left at `(col, row)` and hand back its
 * id.
 *
 * The atom every floor is posed out of: it costs nothing, spends nothing, runs
 * no placement check, blocks its footprint and re-paths exactly as a placed
 * tower does, and starts at heat `0`, level `1`, fresh, with both faculties on
 * (`specs/instrumentation.md`). A check ABOUT placing does not call this.
 *
 * The id is read off the end of the roster, which is where the specification
 * requires an added tower to be.
 */
export async function poseTower(
  h: Harness,
  type: TowerType,
  col: number,
  row: number,
  rotation: Rotation = 0,
): Promise<number> {
  await h.debug.addTower(type, col, row, rotation);
  const added = lastTower(await h.snapshot());
  if (added === undefined) {
    fail(
      "addTower to append a tower to the roster (specs/instrumentation.md)",
      "the tower roster was still empty after addTower",
    );
  }
  return added.id;
}

/**
 * A tower whose GUNS are off and whose thermal model runs: the thermal-scenario
 * atom.
 *
 * `setTowerFiring(id, false)` holds targeting, the shot, its damage and its
 * `heatPerShot`, and nothing else — the tower still cools, conducts, exchanges
 * with a mover, and trips (`specs/instrumentation.md`). That is what makes every
 * `heat.*` and `movers.*` reading a measurement of one flow rather than of a
 * flow racing a gun.
 *
 * The heat is posed AFTER the gate, so nothing can be added to it on the way.
 */
export async function poseIdleTower(
  h: Harness,
  type: TowerType,
  col: number,
  row: number,
  options: { heat?: number; rotation?: Rotation } = {},
): Promise<number> {
  const id = await poseTower(h, type, col, row, options.rotation ?? 0);
  await h.debug.setTowerFiring(id, false);
  await h.debug.setTowerHeat(id, options.heat ?? 0);
  return id;
}

/**
 * A tower firing at a heat that CANNOT DRIFT: the combat-scenario atom.
 *
 * `setTowerThermal(id, false)` holds the tower's part in the heat model while it
 * goes on acquiring targets, firing at its rate, and dealing
 * `baseDamage * heatMultiplier(heat, redline)` at exactly the heat posed here
 * (`specs/instrumentation.md`). Without it every damage reading would be taken
 * while the heat that decides the damage moved underneath it.
 *
 * The heat is an argument rather than an option because a pinned tower without
 * one is meaningless: the heat is the whole reason to pin it.
 */
export async function posePinnedTower(
  h: Harness,
  type: TowerType,
  col: number,
  row: number,
  heat: number,
  rotation: Rotation = 0,
): Promise<number> {
  const id = await poseTower(h, type, col, row, rotation);
  await h.debug.setTowerThermal(id, false);
  await h.debug.setTowerHeat(id, heat);
  return id;
}

/**
 * A tower that is ALREADY tripped, with its cooldown running.
 *
 * Every check about what a tripped tower DOES poses one this way, and the reason
 * is worth stating. The trip cannot be reached with `setTowerHeat(id, 100)`: air
 * cooling is proportional to heat and maximal there, so a tower posed at `100`
 * opens the next frame with a negative change, is written below `100`, and never
 * meets the crossing test `specs/heat.md` states. And driving one over its
 * redline through the real firing path would make every such check fail whenever
 * targeting, range, the fire clock or the per-shot heat gain is broken — the
 * entanglement the two faculty gates exist to remove.
 *
 * So the flag and the cooldown are posed, and the ONE item whose requirement is
 * the trip EVENT (`trip/trips-at-100`) reaches it on the real path instead:
 * an emitter just under `100`, firing, with its thermal model on.
 */
export async function poseTrippedTower(
  h: Harness,
  type: TowerType,
  col: number,
  row: number,
  options: { heat?: number; timer?: number; rotation?: Rotation } = {},
): Promise<number> {
  const id = await poseTower(h, type, col, row, options.rotation ?? 0);
  await h.debug.setTowerTripped(id, true);
  await h.debug.setTowerTripTimer(id, options.timer ?? TRIP_TIME);
  await h.debug.setTowerHeat(id, options.heat ?? 100);
  return id;
}

/**
 * A stationary, effectively unkillable unit standing on tile `(col, row)`, and
 * its id.
 *
 * The target every targeting, range, damage, splash and slow scenario is read
 * against. Motion off is what makes the reading unambiguous: the unit cannot
 * walk out of range while the measurement is taken, and its route is still
 * computed from the tile it stands on, so `remaining` still follows the floor
 * (`specs/instrumentation.md`).
 *
 * The hp is an argument because how much a target must survive is the check's
 * business; the default is far past anything the roster can remove in a
 * scenario, so a check reads hp REMOVED rather than a death it did not ask for.
 * A check about a kill poses the hp its own arithmetic wants.
 */
export async function poseTarget(
  h: Harness,
  type: SurgeType,
  col: number,
  row: number,
  hp = 1e6,
): Promise<number> {
  await h.debug.addUnit(type, "left");
  const added = lastUnit(await h.snapshot());
  if (added === undefined) {
    fail(
      "addUnit to append a unit to the roster (specs/instrumentation.md)",
      "the surge roster was still empty after addUnit",
    );
  }
  const id = added.id;
  await h.debug.setUnitPosition(id, tileCX(col), tileCY(row));
  await h.debug.setUnitMotion(id, false);
  await h.debug.setUnitMaxHp(id, hp);
  await h.debug.setUnitHp(id, hp);
  return id;
}

/**
 * One unit entering at `vent`, walking or flying under its own power, and its
 * id.
 *
 * Nothing is posed beyond the entry: its motion is on, its hp is what its type
 * and the current wave give it, and its exhaust is that vent's fixed opposite.
 * This is what a mazing, pathing, leak or pause scenario runs on.
 */
export async function poseWalker(
  h: Harness,
  type: SurgeType,
  vent: Vent,
): Promise<number> {
  await h.debug.addUnit(type, vent);
  const added = lastUnit(await h.snapshot());
  if (added === undefined) {
    fail(
      "addUnit to append a unit to the roster (specs/instrumentation.md)",
      "the surge roster was still empty after addUnit",
    );
  }
  return added.id;
}

/**
 * Wall in all four faces of the tower `id`, and hand back the four ids in the
 * order N, E, S, W.
 *
 * The thermal-blanket arrangement: an edge-tile facing another tower sheds
 * nothing to air (`specs/heat.md`), so a boxed-in emitter loses heat only
 * through a Sink. The four neighbours are anchored flush with the target along
 * each face and meet each other at the corners alone, so no PLACED tower's own
 * faces overlap and each one's exchange with the target is the full face.
 *
 * The `types` are the caller's, one per face in the same N, E, S, W order,
 * because what stands against a face — an emitter that conducts, a Forge that
 * warms, a Sink that drains — is the scenario's whole subject. Pass types whose
 * footprint is no larger than the target's: a smaller neighbour covers only part
 * of the face and leaves the rest shedding to air, and a larger one would reach
 * around the corner into the neighbour beside it.
 */
export async function boxIn(
  h: Harness,
  id: number,
  types: readonly [TowerType, TowerType, TowerType, TowerType],
): Promise<number[]> {
  const target = requireTower(await h.snapshot(), id, "boxIn");
  const size = target.size;
  const ids: number[] = [];
  const anchors: { type: TowerType; col: number; row: number }[] = [];
  for (const [index, type] of types.entries()) {
    const n = TOWER_DEFS[type].size;
    const side = (["N", "E", "S", "W"] as const)[index];
    if (side === "N") {
      anchors.push({ type, col: target.col, row: target.row - n });
    } else if (side === "E") {
      anchors.push({ type, col: target.col + size, row: target.row });
    } else if (side === "S") {
      anchors.push({ type, col: target.col, row: target.row + size });
    } else {
      anchors.push({ type, col: target.col - n, row: target.row });
    }
  }
  for (const anchor of anchors) {
    ids.push(await poseTower(h, anchor.type, anchor.col, anchor.row));
  }
  return ids;
}

/* ---- The keyboard and the pointer ----------------------------------------- */

/** Press the key `specs/controls.md` binds `action` to. */
export function tapAction(h: Harness, action: ActionName): Promise<void> {
  return h.tap(BINDINGS[action]);
}

/** Show or hide the read-only debug overlay, through its fixed Backquote binding. */
export function toggleOverlay(h: Harness): Promise<void> {
  return h.tap(OVERLAY_KEY);
}

/**
 * A press and a release at one logical stage point, as a player's tap.
 *
 * `specs/controls.md` answers a press and release inside one region as one
 * interaction with that region, so this moves the pointer there first, presses,
 * runs a frame with it down, releases, and runs the frame the release resolves
 * on. The two frames are what make the tap visible to a build that reads
 * `pointer()` inside its update as well as to one that answers the event
 * directly; exactly two pass either way, so nothing a caller counts moves.
 */
export async function tapAt(h: Harness, x: number, y: number): Promise<void> {
  await h.debug.pointerMove(x, y);
  await h.debug.pointerDown(x, y);
  await h.advance(1);
  await h.debug.pointerUp();
  await h.advance(1);
}

/** {@link tapAt} at the centre of a control the panel reported. */
export function tapControl(h: Harness, rect: Rect): Promise<void> {
  return tapAt(h, rect.x + rect.w / 2, rect.y + rect.h / 2);
}

/** {@link tapAt} at a tile's centre. */
export function tapTile(h: Harness, col: number, row: number): Promise<void> {
  return tapAt(h, tileCX(col), tileCY(row));
}

/**
 * A panel control the snapshot reports, failing the check when the build drew
 * none.
 *
 * `rotate`, `cancel`, `upgrade` and `sell` are legitimately `null` when nothing
 * is armed and nothing is selected (`specs/hud.md`), so a scenario that armed a
 * placement and then found no Rotate control has found a missing control rather
 * than a null it should tolerate.
 */
export function requireControl(
  snapshot: MeltdownSnapshot,
  name: "rotate" | "cancel" | "upgrade" | "sell",
  doing = "the scenario",
): Rect {
  const rect = snapshot.controls[name];
  if (rect === null) {
    fail(
      `the panel to report its ${name} control (${doing}, specs/hud.md)`,
      null,
    );
  }
  return rect;
}

/** The shop entry for a tower type, failing the check when the panel has none. */
export function shopControl(
  snapshot: MeltdownSnapshot,
  type: TowerType,
  doing = "the scenario",
): ShopControl {
  const entry = snapshot.controls.shop.find((slot) => slot.type === type);
  if (entry === undefined) {
    fail(
      `a shop entry for the ${type} (${doing}, specs/hud.md)`,
      `shop entries ${JSON.stringify(snapshot.controls.shop.map((s) => s.type))}`,
    );
  }
  return entry;
}
