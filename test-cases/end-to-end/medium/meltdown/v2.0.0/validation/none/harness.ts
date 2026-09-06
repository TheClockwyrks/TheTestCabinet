// Meltdown — the shared validator harness. CASE-PROVIDED, over the shared harness.
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
// THAT MACHINERY IS THE SHARED PACKAGE'S, NOT THIS CASE'S. Serving the build,
// holding one browser, bracketing each driven frame around one step of the
// build's surface, recording what it drew, and reading pixels, draw calls and
// sounds back out is the same job in every engineless case, so it lives once in
// `@clockwyrks/case-harness`, staged beside this project at
// `validation/case-harness/`. The seam is one call: `createCaseHarness` takes
// Meltdown's TYPES as type arguments and Meltdown's VALUES as one object, and
// hands back that machinery under this case's own names.
//
// WHAT IS GENUINELY MELTDOWN'S, AND THEREFORE STILL HERE. The contract the build
// owes (the handle, the operations, the snapshot and surface types); the two
// clocks the case chose (`TICK_HZ`, and the coarse {@link DRIVE_HZ} a check that
// spends minutes of game time runs on); the off-camera {@link Harness.coast}, which
// covers a span of game time in frames of its own size; {@link Harness.withOwnClock},
// which hands the loop back to the build for a whole scenario; the readings over
// the snapshot; and every compound sequence the checks share.
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

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright";
import {
  ConstantClock,
  createCaseHarness,
  drawnText,
  drawnTextLines,
  drawnTextRuns,
  luminance,
  restrikes,
  sampleColor,
  textDraws,
  type Clock,
  type DrawCall,
  type Harness as BaseHarness,
  type HarnessOptions,
  type Rgb,
  type TextDraw,
  type UntilResult as BaseUntilResult,
} from "./case-harness/index";
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

/* The readings a check makes off a frame, and the evidence it leaves behind, are
   the shared harness's and are re-exported here so a suite next door goes on
   naming `../harness` for everything it reads. */
export {
  ConstantClock,
  DRAW_METHODS,
  JitterClock,
  SequenceClock,
  callsTo,
  closeWorkerBrowser,
  colorDistance,
  drawOps,
  drawnPoints,
  drawnText,
  drawnTextLines,
  drawnTextRuns,
  luminance,
  sampleColor,
  setsOf,
  textDraws,
  type Clock,
  type DrawCall,
  type HarnessOptions,
  type Recording,
  type Rgb,
  type TextDraw,
  type TimedCue,
  type UntilOptions,
  type Viewport,
} from "./case-harness/index";

/* -------------------------------------------------------------------------- */
/* The contract the build owes                                                */
/* -------------------------------------------------------------------------- */

/** The case this project decides, which prefixes every message the harness prints. */
export const SLUG = "meltdown";

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

/**
 * One row of the current screen's menu, as its hit rectangle in logical stage
 * units.
 *
 * `index` is the row number `menuIndex` counts, so a scenario that reads a row
 * back can say which row it holds without relying on the array's order — and a
 * build that reported them out of order is caught by
 * `screens/menu-rows-reported`.
 */
export interface MenuRowView extends Rect {
  index: number;
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
  /**
   * Every row of the menu the current screen shows, as its hit rectangle in
   * logical stage units, in row order from `0`.
   *
   * `specs/screens.md` leaves where a build draws its menus entirely to the
   * build and requires every row to be a pointer target, so the build reports
   * what it drew and a scenario presses the rectangle it reported. Empty while
   * the screen is `playing`, which shows no menu. A diagnostic read like
   * `controls`: no operation sets it.
   */
  menu: MenuRowView[];
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
  reset(seed?: number): Promise<void>;
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

/** The frame the suite steps in. */
const CASE_TICK_HZ = 120;

/** The case this project decides, bound to the shared harness once. */
const kit = createCaseHarness<MeltdownSnapshot, MeltdownDebugApi>({
  slug: SLUG,
  handle: HANDLE,
  requiredOps: REQUIRED_OPS,
  // `advance(seconds, frames)`: a span of simulated time divided into whole
  // frames, so the suite's clock decides how long a frame is
  // (`specs/instrumentation.md`, The clock).
  step: { kind: "seconds-frames", op: "advance" },
  stage: { width: STAGE_W, height: STAGE_H },
  tickHz: CASE_TICK_HZ,
  // A GENUINE browser gesture, so the build's audio can open: a build is free to
  // open its audio context from a real DOM event alone (both are conformant), so
  // a key delivered any other way would leave a perfectly good build silent.
  // `specs/controls.md` binds this key to nothing, so arming changes no game
  // state and toggles no overlay. Meltdown arms it from the check rather than at
  // the harness's opening — see {@link Harness.armAudio} — so the harness is
  // never opened with `armAudio`.
  arm: { kind: "key", code: UNBOUND_KEY },
  // Every menu and every panel control is reachable by a finger
  // (`specs/controls.md`, Touch), so the context reports a touchscreen: a contact
  // arrives as `pointerType: "touch"` and `navigator.maxTouchPoints` is non-zero,
  // which is the device a build offering touch controls has to believe it is on.
  hasTouch: true,
  // The run's text checks read where a run of text was drawn and how wide it is,
  // which only the drawing context can say, so the recorder measures each run at
  // the call.
  measureText: true,
  // The replay a reviewer watches is composited over black, which is the field
  // `specs/overview.md` puts the reactor floor on.
  replayBackground: "#000",
  // A MINUTE, BECAUSE THIS IS THE ONE PLACE A BUSY MACHINE COULD BE MISREAD AS A
  // BROKEN BUILD. Everything else the harness waits on is stepped, but the
  // surface has to appear on its own: the page navigates, Chromium parses and
  // runs the bundle, and the build initializes, all off frames the host may be
  // handing to a hundred other processes. A ten-second ceiling turned that into
  // `window.__meltdown was still absent 10s after the page loaded` — a sentence
  // about the build, recorded against the build, produced by the runner's load.
  // A conformant build still pays nothing for the longer ceiling, because the
  // wait returns the instant the global is there; what it costs is a slower
  // verdict on a build that really installed no surface, which is a build already
  // failing every point in the project.
  surfaceTimeoutMs: 60_000,
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
  TICK_HZ,
  TICK_MS,
} = kit;

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

/* -------------------------------------------------------------------------- */
/* What this case holds beside the shared harness                             */
/* -------------------------------------------------------------------------- */

/** What a sweep found, over this case's snapshot. */
export type UntilResult = BaseUntilResult<MeltdownSnapshot>;

/** How far a coarse sweep may run, and how much game time separates two samples. */
export interface CoastOptions {
  maxSeconds?: number;
  pollSeconds?: number;
  /** Frames per second of game time inside each poll. Defaults to 60. */
  hz?: number;
}

/** What a coarse sweep found. */
export interface CoastResult {
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

/**
 * Everything a check reads off one page running this build.
 *
 * The shared harness's, with the four things that are Meltdown's own laid over
 * it: the coarse off-camera `coast` and `coastUntil`, which cover a span of GAME
 * TIME in frames of a size the caller chooses; the scope `withOwnClock` opens;
 * and `armAudio`, which this case delivers from the check rather than at the
 * harness's opening.
 */
export type Harness = BaseHarness<MeltdownSnapshot, MeltdownDebugApi> & {
  /**
   * Run `duration` seconds of GAME TIME, diced into `hz` frames a second,
   * WITHOUT opening a recorded frame.
   *
   * The same real update the loop runs, but off camera: no frame boundary is
   * closed, so a capture running across it keeps nothing, and a section that has
   * to sit through a fifteen-second build phase costs a replay nothing. Use it
   * for the wait; use `advance` for the part a check is about.
   *
   * The shared harness's `skip` counts FRAMES of the harness's own clock, which
   * is the same journey at a fixed dicing; this one is stated in the game's own
   * seconds, which is how every duration `specs/` fixes is written, and it
   * chooses how finely to divide them.
   */
  coast(duration: number, hz?: number): Promise<void>;
  /** {@link coast} until `predicate` holds, sampling every `pollSeconds`. */
  coastUntil(
    predicate: (snapshot: MeltdownSnapshot) => boolean,
    options?: CoastOptions,
  ): Promise<CoastResult>;
  /**
   * Hand the clock back to the BUILD, run `scenario` while it drives itself in
   * real time, and take the clock back however the scenario ends.
   *
   * THIS IS HOW EVERY CHECK ABOUT WHETHER TIME PASSES IS MEASURED, and calling
   * `advance` — or anything built on it, `tap` included — inside the scenario
   * defeats the whole exercise. `advance` bottoms out in a debug operation the
   * build is free to gate separately from its own frame loop, so it measures
   * where a build put its gate rather than whether the floor moved.
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
   */
  withOwnClock<T>(scenario: (clock: OwnClock) => Promise<T>): Promise<T>;
  /**
   * Let the build run itself for `ms` of real time, and take the clock back.
   *
   * The one-window form of {@link withOwnClock}, for a check that needs the
   * build's own loop to have run and has nothing to do in the middle of it.
   */
  settle(ms: number): Promise<void>;
  /** Give the build a real, browser-trusted gesture, so its audio can open. */
  armAudio(): Promise<void>;
};

/**
 * A clock the harness can retune for the length of one off-camera coast.
 *
 * {@link Harness.coast} covers a span of GAME TIME in frames of a size it chooses,
 * and the shared harness takes each frame's length from the clock it was opened
 * with — so the size is set here, for the coast's frames alone, and handed back
 * afterwards. That is what keeps the harness's own frame counter, its simulated
 * clock and the frame every sound is stamped with correct across a coast, which a
 * coast driven around the harness could not do.
 */
class CoastClock implements Clock {
  private held: number | null = null;
  constructor(private readonly base: Clock) {}
  delta(): number {
    return this.held ?? this.base.delta();
  }
  hold(ms: number): void {
    this.held = ms;
  }
  release(): void {
    this.held = null;
  }
}

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

/**
 * Load the built site in a browser, take the game off the wall clock, and hand
 * back everything a check reads.
 *
 * The shared harness does all of it; what is added here is the handful of things
 * `specs/` puts on Meltdown rather than on every engineless case.
 *
 * IT NEVER THROWS FOR A BUILD'S FAULT. A missing or incomplete surface comes
 * back as `surfaceFault` over a surface whose every operation fails by
 * assertion, so a suite that builds its harness in a `beforeEach` gets its real
 * verdict from the check rather than a hook failure that names nothing.
 */
export async function createHarness(
  options: HarnessOptions = {},
): Promise<Harness> {
  const clock = new CoastClock(options.clock ?? new ConstantClock(kit.TICK_MS));
  const base = await kit.createHarness({ ...options, clock });
  const page: Page = base.page;
  const handle = base.config.handle;
  const recorder = base.config.recorderGlobal;

  /** Run `duration` seconds of game time over `frames` frames, off camera. */
  const run = async (duration: number, frames: number): Promise<void> => {
    const whole = Math.max(1, Math.round(frames));
    clock.hold((duration * 1000) / whole);
    try {
      await base.skip(whole);
    } finally {
      clock.release();
    }
  };

  let openedAt: MeltdownSnapshot | null = null;
  const ownClock: OwnClock = {
    get opened(): MeltdownSnapshot {
      if (openedAt === null) {
        throw new Error("OwnClock.opened is only readable inside withOwnClock");
      }
      return openedAt;
    },
    settle: (ms) => page.waitForTimeout(ms),
    async gain(secondsWanted, deadlineMs) {
      const from = (await base.snapshot()).simTime;
      const startedMs = Date.now();
      try {
        // Polled INSIDE the page, so waiting costs one crossing however long the
        // wait runs — and so a host that is starving the page's frame callback is
        // not also being asked to service a round trip ten times a second.
        await page.waitForFunction(
          ([name, target]) =>
            (
              window as unknown as Record<
                string,
                { snapshot(): { simTime: number } }
              >
            )[name as string]!.snapshot().simTime >= (target as number),
          [handle, from + secondsWanted] as const,
          { timeout: deadlineMs, polling: OWN_CLOCK_POLL_MS },
        );
        return { reached: true, elapsedMs: Date.now() - startedMs };
      } catch {
        return { reached: false, elapsedMs: Date.now() - startedMs };
      }
    },
    read: () => base.snapshot(),
    async press(code) {
      await page.keyboard.down(code);
      await page.waitForTimeout(PRESS_HOLD_MS);
      await page.keyboard.up(code);
    },
  };

  const withOwnClock = async <T>(
    scenario: (clock: OwnClock) => Promise<T>,
  ): Promise<T> => {
    if (base.surfaceFault !== null) failSurface(base.surfaceFault);
    // Real elapsed time is the one thing a browser's own idea of which page
    // matters can distort. The launch already turns the throttling off; bringing
    // the page forward as well means this does not rest on a flag alone.
    await page.bringToFront().catch(() => undefined);
    // The handover and the opening reading are ONE crossing. A scenario's first
    // statement used to be a `read`, which is a second round trip taken while the
    // build is already running itself — and on a loaded host that gap is long
    // enough for a posed tower to fire and for an opening state a check arranged
    // to have moved before the check saw it. Nothing runs between the
    // `setAutoStep(true)` and the `snapshot()` below, so `clock.opened` is the
    // state the scope opened in on any machine.
    openedAt = (await page.evaluate(
      ([name, rec]) => {
        (window as unknown as Record<string, { setMode(m: string): void }>)[
          rec as string
        ]!.setMode("raf");
        const api = (
          window as unknown as Record<
            string,
            { setAutoStep(on: boolean): void; snapshot(): unknown }
          >
        )[name as string]!;
        api.setAutoStep(true);
        return api.snapshot();
      },
      [handle, recorder] as const,
    )) as MeltdownSnapshot;
    try {
      return await scenario(ownClock);
    } finally {
      // In a `finally`, so a scenario that threw still leaves the clock where
      // every other helper in this file expects to find it.
      await page.evaluate(
        ([name, rec]) => {
          (
            window as unknown as Record<
              string,
              { setAutoStep(on: boolean): void }
            >
          )[name as string]!.setAutoStep(false);
          (window as unknown as Record<string, { setMode(m: string): void }>)[
            rec as string
          ]!.setMode("manual");
        },
        [handle, recorder] as const,
      );
      openedAt = null;
    }
  };

  return Object.assign(base, {
    async coast(duration: number, hz = 60) {
      await run(duration, Math.ceil(duration * hz));
    },

    async coastUntil(
      predicate: (snapshot: MeltdownSnapshot) => boolean,
      coastOptions: CoastOptions = {},
    ): Promise<CoastResult> {
      const maxSeconds = coastOptions.maxSeconds ?? 60;
      const pollSeconds = Math.max(1e-3, coastOptions.pollSeconds ?? 0.5);
      const hz = coastOptions.hz ?? 60;

      let snapshot = await base.snapshot();
      if (predicate(snapshot)) return { hit: true, elapsed: 0, snapshot };

      let elapsed = 0;
      while (elapsed < maxSeconds) {
        const step = Math.min(pollSeconds, maxSeconds - elapsed);
        await run(step, Math.ceil(step * hz));
        snapshot = await base.snapshot();
        elapsed += step;
        if (predicate(snapshot)) return { hit: true, elapsed, snapshot };
      }
      return { hit: false, elapsed, snapshot };
    },

    withOwnClock,

    settle: (ms: number) => withOwnClock((clock) => clock.settle(ms)),

    // A GENUINE browser gesture, not a posed one: a build is free to open its
    // audio context from a real DOM event alone (both are conformant), so a key
    // delivered any other way would leave a perfectly good build silent. The key
    // is bound to nothing (`specs/controls.md` binds every other key it names,
    // and `Backquote`), so arming changes no game state and toggles no overlay.
    armAudio: () => page.keyboard.press(UNBOUND_KEY),
  });
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
/* Reading one frame's render                                                 */
/* -------------------------------------------------------------------------- */
//
// The readings themselves are the shared harness's; what is here is the two
// this case adds. `drewWord` is the stricter sibling of the package's
// `drewText`, for copy a specification names as a WORD; the transform walk is
// what lets a check about where the build drew something read a frame that
// drew it under a translate or a rotate, which every screen in this game does.

/**
 * Whether the frame drew `word` as a STANDALONE token, ignoring case.
 *
 * The stricter sibling of the package's `drewText`, for the copy
 * `specs/screens.md` and `specs/hud.md` require as a word rather than as a
 * substring — a readout's `WAVE` label, or the how-to screen naming a key. A
 * panel reading "waveform" contains `wave` and does not carry the label the
 * specification named.
 *
 * Read off the LOGICAL RUNS the frame spells, as the package's `drewText` is,
 * AND off the raw `fillText` split, and the two are not redundant. A build that
 * letter-spaces its label draws `WAVE` a glyph per call, and no single glyph is
 * the word; the harness measures every text call, so the shared merge rule
 * (`case-harness/text.ts`) folds those glyphs back into the word they spell.
 * But the merge joins any gap up to 0.6 of the run's mean advance and
 * concatenates VERBATIM wherever the gap stays inside the run's own tracking,
 * writing a space only past it: a label and its figure drawn as two calls set
 * tight, or a letter-spaced label whose figure sits one tracking gap along,
 * come back as the one run `WAVE3/15`, in which `WAVE` is no longer a whole
 * token. A substring reader still finds its copy in that; a whole-word reader
 * would lose the match it had call by call. So both readings are taken, and
 * coalescing only ever adds a match.
 */
export function drewWord(calls: readonly DrawCall[], word: string): boolean {
  const pattern = new RegExp(
    `(^|[^A-Za-z0-9])${word.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z0-9]|$)`,
    "i",
  );
  return (
    drawnTextLines(calls).some((line) => pattern.test(line)) ||
    drawnText(calls).some((drawn) => pattern.test(drawn))
  );
}

/**
 * One logical run of text, and the draws it was spelled from.
 *
 * `parts` is the `textDraws` entries the run coalesced, in reading order — one
 * entry, the draw itself, for a run drawn in a single call. A reader that
 * matches a WHOLE TOKEN reads both: see {@link spelledRuns} for why.
 */
export interface TextRun extends TextDraw {
  parts: readonly TextDraw[];
}

/**
 * The shared harness's `drawnTextRuns`, each run carrying the draws that spelled
 * it.
 *
 * The runs are what a reader of COPY wants — a heading letter-spaced a glyph per
 * `fillText` is one run here and a dozen calls — and what a reader of a whole
 * TOKEN cannot use alone, for the reason {@link drewWord} gives: the rule
 * writes a space into a run only where a gap opens past the run's own tracking,
 * so a label drawn one call and its figure the next a word space apart reads
 * `WAVE 3/15`, but a figure set tight against its label, or a gap no wider than
 * a letter-spaced label's tracking, reads `WAVE3/15`, a run `WAVE` is no whole
 * token of. And two readouts on one baseline a word space apart — `KILLS 0` and
 * `DEALT 0` — are one run `KILLS 0 DEALT 0`, which a reader counting readouts
 * counts once. So a run here also names the draws it took; a token reader tests
 * the run and every part, and a counting reader counts the parts. Coalescing
 * then only ever adds a match.
 *
 * Which draws a run took is recovered from the order the shared rule documents:
 * it partitions the frame's draws in reading order, down the frame then across
 * it, so the members are consumed in that same order, each matched verbatim
 * against the run's text where it stands, until the text is spelled. A space
 * the rule wrote at a word gap is spelled by no draw and is stepped over; a
 * draw of whitespace alone is in the run verbatim, since the rule writes no
 * space beside one; and a RESTRIKE — the same text struck again where the last
 * draw consumed already stands, an outlined glyph's fill over its stroke — is
 * the glyph the run already spells, folded by the rule under the one test it
 * folds it by, the package's {@link restrikes}, and is passed over without
 * becoming a part. Were a run's text ever left unspelled by that walk, every
 * run in the frame would be handed back as its own only part, which is the
 * reading a whole-token reader had before the runs existed; the walk above is
 * the rule's own, so that is a guard and not a path the rule takes.
 */
export function spelledRuns(calls: readonly DrawCall[]): TextRun[] {
  const runs = drawnTextRuns(calls);
  const ordered = textDraws(calls)
    .filter((draw) => draw.text.length > 0)
    .sort((a, b) => a.y - b.y || a.left - b.left);

  const spelled: TextRun[] = [];
  let next = 0;
  /** The last draw taken as a part, which a restrike repeats. */
  let last: TextDraw | undefined;
  for (const run of runs) {
    const parts: TextDraw[] = [];
    let at = 0;
    while (at < run.text.length && next < ordered.length) {
      const member = ordered[next];
      if (last !== undefined && restrikes(member, last)) {
        next += 1;
      } else if (run.text.startsWith(member.text, at)) {
        parts.push(member);
        at += member.text.length;
        next += 1;
        last = member;
      } else if (run.text[at] === " ") {
        // A space the rule wrote at a word gap, which no draw spelled.
        at += 1;
      } else {
        break;
      }
    }
    if (at !== run.text.length || parts.length === 0) {
      return runs.map((each) => ({ ...each, parts: [{ ...each }] }));
    }
    spelled.push({ ...run, parts });
  }
  return spelled;
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

/* -------------------------------------------------------------------------- */
/* Reading the picture                                                        */
/* -------------------------------------------------------------------------- */
//
// Sampling and comparing a colour is the shared harness's; the three readings
// here are the ones that need Meltdown's own floor geometry to say WHERE to
// look.

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
export async function tapAction(h: Harness, action: ActionName): Promise<void> {
  await h.tap(BINDINGS[action]);
}

/** Show or hide the read-only debug overlay, through its fixed Backquote binding. */
export async function toggleOverlay(h: Harness): Promise<void> {
  await h.tap(OVERLAY_KEY);
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

/**
 * The rectangle the build reported for row `index` of the current screen's menu,
 * failing the check when it reported none.
 *
 * `specs/screens.md` requires every row of every menu to be a pointer target and
 * `specs/instrumentation.md` has the snapshot report each row's rectangle, so a
 * screen whose menu the build drew but did not report cannot be driven with the
 * pointer at all — which is this failure rather than a missing row.
 */
export function menuRow(
  snapshot: MeltdownSnapshot,
  index: number,
  doing = "the scenario",
): MenuRowView {
  const row = snapshot.menu.find((entry) => entry.index === index);
  if (row === undefined) {
    fail(
      `snapshot().menu to hold row ${index} of the ${snapshot.screen} menu ` +
        `(${doing}, specs/screens.md)`,
      `rows ${JSON.stringify(snapshot.menu.map((entry) => entry.index))}`,
    );
  }
  return row;
}

/**
 * Move the pointer onto the centre of a reported menu row and run the frame that
 * delivers it.
 *
 * Hover alone: `specs/controls.md` says reaching a row and taking it are
 * separate, so this presses nothing.
 */
export async function hoverMenuRow(
  h: Harness,
  index: number,
): Promise<MenuRowView> {
  const row = menuRow(await h.snapshot(), index, "hovering a menu row");
  await h.debug.pointerMove(row.x + row.w / 2, row.y + row.h / 2);
  await h.advance(1);
  return row;
}

/** {@link tapAt} at the centre of a reported menu row. */
export async function tapMenuRow(h: Harness, index: number): Promise<void> {
  const row = menuRow(await h.snapshot(), index, "tapping a menu row");
  await tapAt(h, row.x + row.w / 2, row.y + row.h / 2);
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
