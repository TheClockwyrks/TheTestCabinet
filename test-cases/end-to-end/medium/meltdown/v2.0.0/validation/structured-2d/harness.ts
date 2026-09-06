// Meltdown — the shared validator harness. CASE-PROVIDED, over the shared harness.
//
// Every check in this suite is an ordinary vitest test that runs IN THE SAME
// PROCESS as the build. It imports the engine and the build's own modules,
// creates an engine over a canvas it owns and a clock it chose, and steps the
// game with `engine.advance`. Nothing drives a browser, nothing polls, and no
// wall-clock time passes: a check asks for a number of frames and gets exactly
// that number, at exactly the deltas its clock supplied.
//
// THAT MACHINERY IS THE SHARED PACKAGE'S, NOT THIS CASE'S. The canvas and its
// draw-command recorder, the debug surface and the stand-in for a missing one,
// the driven frame, the sweep, the cue stamping, the pixel and text readings, and
// the evidence a review item's output is written from are the same job in every
// engine-backed case, so they live once in `@clockwyrks/case-harness`, staged
// beside this project at `validation/case-harness/`. The seam is one call:
// `createEngineCaseHarness` takes Meltdown's TYPES as type arguments and
// Meltdown's VALUES as one object — including the engine itself, which arrives as
// values (`createEngine`, `ConstantClock`, the build's game definition), because
// the package names no engine — and hands that machinery back under this case's
// own names.
//
// WHAT IS GENUINELY MELTDOWN'S, AND THEREFORE STILL HERE. The clock the case
// chose ({@link TICK_HZ}, and the coarse {@link DRIVE_HZ} a check that spends
// minutes of game time runs on); the real-time handover the windows below are
// measured on; the floor's own geometry, in the space the surface speaks; the
// readings over the snapshot; the readings over the picture that the package
// spells differently; and every compound sequence the checks share.
//
// WHAT A CHECK READS. The game's own state (through the debug surface's
// `snapshot`), the engine's object model — the open world, its game state — the
// events the engine broadcast (the cues), and — for the presentation and panel
// checks — the pixels on the canvas or the calls the 2D context received.
// Nothing here fabricates an outcome: the scenario helpers below only ARRANGE
// the floor through the debug surface, and the real rules the build wrote are
// what decide every move from there.
//
// WHY THE DEBUG SURFACE RATHER THAN RAW ASSIGNMENT. specs/instrumentation.md
// fixes its operations, so they mean the same thing in every build:
// `setTowerHeat` poses a heat the two-phase model then resolves unchanged,
// `addTower` builds a tower that blocks its footprint and re-paths the floor,
// `addUnit` enters a unit into the same pathing and combat systems the spawner
// uses, and `reset` gives everything back. Posing through it is how a scenario
// is reproducible, and it is the seam the case's specification documents.
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
// HOW THE SURFACE IS DRIVEN. Directly — the package's `identityDriver` strategy,
// which is no wrapper at all. Under this engine a pose acts on the live game at
// the moment of the call and a reading is built at the call
// (specs/instrumentation.md), so a scenario poses and then reads with no frame in
// between. A frame is advanced when the check wants the game to RUN — a unit to
// walk, a tower to fire, heat to resolve, a render to happen.
//
// THE HARNESS OWNS EVERY COMPOUND SEQUENCE. The surface is atomic by design:
// each operation sets one field, so "a run open on an empty, quiet floor" is a
// helper here rather than an operation there. A check that needs only part of a
// sequence calls the operations it needs, and nothing it did not ask for
// happens. The helpers fix GEOMETRY — which tile a tower is posed on, where a
// unit is placed — and never a threshold: every figure a check asserts is stated
// in that check, derived from what specs/ fixes for it. Look for a tolerance in
// this file and you will not find one.
//
// THE CLOCK IS THE HARNESS'S. `ConstantClock(TICK_MS)` at 120 Hz, so one frame
// is one tick and a duration is a whole number of frames on every machine.
// Meltdown mandates no timestep of its own — every rate is per second and
// integrated against the delta the frame hands the game, which is why
// `[instrumentation]` carries no `tick_hz` — so the fixed clock is the SUITE's
// choice. A check that is specifically about the step size
// (heat/two-phase-resolution, instrumentation/deterministic-core) builds its own
// harnesses with clocks of its own.
//
// AND A CHECK ABOUT WHETHER TIME PASSES MEASURES ON THE BUILD'S OWN CLOCK. Never
// through a stepping operation, because a stepping operation is instrumentation
// and the question is about the game. {@link WorldModel.settle} hands the loop
// and a real-time clock back to the build for a window of wall-clock time, and
// {@link windowOfRealTime} brackets that window with the ONE snapshot the reading
// pair is taken from. That is what the pause, resume, own-clock and speed items
// are measured with. See "Windows on the build's own clock" below.

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ConstantClock,
  WallClock,
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
  rasterize,
  type EngineHarness,
  type EngineHarnessOptions,
  type UntilOptions,
  type UntilResult as EngineUntilResult,
} from "./case-harness/engine/index";
import {
  allInLogical,
  canvasPixels as readCanvasPixels,
  makeReplayCapture,
  pixelsChanged as countPixelsChanged,
  sampleColor as sampleCluster,
  type EngineFrameReader,
  type EnginePointReader,
} from "./case-harness/engine/2d";
import { colorDistance, type Rgb } from "./case-harness/color";
import {
  drawnText,
  drawnTextLines,
  drawnTextRuns,
  drewText as spelledText,
  textDraws,
  type TextDraw,
} from "./case-harness/text";
import type { DrawCall } from "./case-harness/draw-calls";
import { BACKGROUND, game as build } from "../src/game";
import { fail } from "./assert";
import {
  BINDINGS,
  BUILD_PHASE_TIME,
  DIFFICULTY_TABLE,
  FLOOR_X0,
  FLOOR_Y0,
  LAYOUT,
  MODE_TABLE,
  STAGE_H,
  STAGE_W,
  TILE,
  TOWER_DEFS,
  footprintCentre,
  tileCX,
  tileCY,
  type ActionName,
} from "./constants";
import type {
  BuildSnapshot,
  ControlRect,
  DifficultyName,
  Face,
  MeltdownDebugApi,
  MeltdownSnapshot,
  MenuRow,
  ModeName,
  Phase,
  Screen,
  ShopControl,
  SnapshotControls,
  SurgeType,
  TowerSnapshot,
  TowerType,
  UnitSnapshot,
  VentName,
  ZoneSnapshot,
} from "./surface";

export type {
  BuildSnapshot,
  ControlRect,
  DifficultyName,
  Face,
  MeltdownSnapshot,
  ModeName,
  Phase,
  Screen,
  ShopControl,
  SnapshotControls,
  SurgeType,
  TowerSnapshot,
  TowerType,
  UnitSnapshot,
  VentName,
  ZoneSnapshot,
};

/* The readings this project takes straight off the package, under its own names:
   a recorded operation, what a frame called and set, a sampled colour, and the
   distance between two of them. */
export type { DrawCall, Rgb };
export { colorDistance };
export { callsTo, setsOf } from "./case-harness/draw-calls";

/* One cue the build played, and a cue stamped with the frame it sounded on. Both
   are the package's, and the stamped one is a superset of the plain one. */
export type { PlayedCue, TimedCue } from "./case-harness/engine/index";

/* How far a sweep may run, and what it found. `UntilResult` is the package's,
   narrowed to this case's snapshot; it carries `frames` and `ticks` as one count
   under two names, and this project's suites read `frames`. */
export type { UntilOptions };
export type UntilResult = EngineUntilResult<MeltdownSnapshot>;

/** The case's surface, exactly as `surface.ts` specifies it. */
export type MeltdownSurface = MeltdownDebugApi;

/**
 * The surface as every check drives it.
 *
 * Under this engine the raw surface IS imperative — a pose takes only its own
 * arguments and returns nothing, a reading takes nothing and returns plain
 * data — so no wrapper stands between a check and the object the build returned,
 * and the driver type is the surface type itself. The alias is kept so a check
 * reads the same way it does under an engine whose surface needs driving.
 */
export type MeltdownDriver = MeltdownSurface;

/** The engine this project stands a build up on. */
export type MeltdownEngine = Engine<MeltdownSurface>;

/**
 * The build's game, typed against the surface the CASE specifies.
 *
 * The build declares its own type for the surface its instance's `initialize`
 * returns — the `MeltdownDebugApi` it exports, the `D` of its
 * `GameDefinition<D>` — and that type is the build's: what a check holds it to is
 * `surface.ts`, so the definition is cast to the case's
 * `GameDefinition<MeltdownSurface>` here and the engine is parameterized with it.
 * A surface that departs from the specification is caught where a check reaches
 * for the missing member, not by the build's own compiler.
 */
const game = build as unknown as GameDefinition<MeltdownSurface>;

/* -------------------------------------------------------------------------- */
/* The clock                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The frame the suite steps in, in milliseconds.
 *
 * This is the SUITE's choice, not the game's: the specification deliberately
 * fixes no timestep, because the engine hands the game whatever elapsed time a
 * frame really took and every rate in Meltdown is per second and integrated
 * against it. Fixing it here makes a duration a whole number of frames, so a
 * tolerance can be stated in ticks and mean the same thing on every machine.
 */
export const TICK_HZ = 120;
export const TICK_MS = 1000 / TICK_HZ;

/**
 * Frames of the default clock covering `duration` seconds, rounded to whole.
 *
 * ROUNDED TO NEAREST, WHICH IS NOT WHAT THE PACKAGE'S `ticksFor` DOES: the
 * package rounds UP, so a duration that is not a whole number of frames covers a
 * shade more than it names, and this project's sibling `simple-2d` binds that
 * one. Here the nearest whole frame is what every window in this project was
 * measured under, and `advanceSeconds` divides a span by it — so folding the two
 * would move a window by a frame wherever the arithmetic does not come out even,
 * without anything failing to say so. It stays the case's; see the package
 * README's collision table.
 */
export function ticksFor(duration: number): number {
  return Math.round(duration * TICK_HZ);
}

/* -------------------------------------------------------------------------- */
/* The long-drive clock                                                       */
/* -------------------------------------------------------------------------- */
//
// A HANDFUL OF POINTS IN THIS PROJECT NEED MINUTES OF GAME TIME. What they read
// is a negative held over a long stretch — no unit released while the gate is
// shut, no countdown started in the opening phase, no heat on a Forge under a
// minute of fire, no offline period that is not a cooldown — and the length of
// the stretch IS the requirement, so it cannot be shortened.
//
// WHAT CAN BE CHOSEN IS HOW FINELY THAT STRETCH IS DICED, AND THE SPECIFICATION
// SAYS SO. `specs/waves.md`: every rate is per second and integrated against the
// game time a frame advances by, so "an interval of game time reaches the same
// state however it was divided into frames"; no fixed timestep is mandated
// anywhere, and `instrumentation.deterministic-core` is the point that grades
// that claim on its own. The suite's {@link TICK_HZ} is a convenience for
// stating tolerances in ticks, not a figure any specification fixes.
//
// AND THE COST OF DICING IT AT `120` Hz IS NOT SMALL. Under an engine every
// advanced frame is a real frame: the same update a player's frame runs followed
// by a real render into the canvas. A minute of game time at the suite's clock is
// seven thousand two hundred of them, and on a floor carrying dozens of units
// that is twenty to thirty seconds of one core — which on a runner sharing twenty
// cores between two hundred tasks is four to six minutes of WALL CLOCK, against a
// per-check ceiling. A point lost there is a point lost to the load on the
// machine, which is the one thing a validator must never measure.
//
// SO A LONG DRIVE RUNS AT `30` Hz. A frame of a thirtieth of a second is still
// eighteen frames inside one `WAVE_SPAWN_INTERVAL` (`0.6` s), a hundred and fifty
// inside a `TRIP_TIME` cooldown (`5` s), and four hundred and fifty inside a
// build phase (`15` s), so every period these points count is resolved many times
// over — and the drive costs a quarter of what it did. A check whose reading has a
// finer resolution than a thirtieth of a second does NOT use this clock: it states
// its own, as the checks on a fire rate and a spawn cadence do.

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
 * How often {@link WorldModel.gain} asks whether the build's clock has got there
 * yet: ten times a second.
 *
 * Coarse enough that the poll is not competing for the same starved event loop as
 * the frame callback it is watching, and fine enough that a leg closes within a
 * frame or two of the game time it asked for.
 */
const GAIN_POLL_MS = 100;

/** What a leg spent on the build's own clock cost, and whether it closed. */
export interface GainResult {
  /** Whether the build's clock gained the seconds asked for before the deadline. */
  reached: boolean;
  /**
   * The real time the leg took.
   *
   * NOT a reading about the build — it is how busy the machine was — so no check
   * asserts on it. What it is for is giving a leg that must be spent in real time
   * (a PAUSED window, which cannot be closed on a gain that must never happen)
   * the same stretch of real time the running leg beside it needed, so the two
   * offer a build the same opportunity to be caught however loaded the host is.
   */
  elapsedMs: number;
}

/* -------------------------------------------------------------------------- */
/* The floor, in the space the surface speaks                                 */
/* -------------------------------------------------------------------------- */

/** A point in logical stage units. */
export interface Point {
  x: number;
  y: number;
}

/** One tile of the floor. */
export interface Tile {
  col: number;
  row: number;
}

/** A tile's centre in logical stage units, which is what the surface takes. */
export function tileCenter(col: number, row: number): Point {
  return { x: tileCX(col), y: tileCY(row) };
}

/**
 * The tile a logical stage point falls on, the inverse of {@link tileCenter}.
 *
 * A point on the casing band or the build panel answers with a tile outside the
 * grid, which is the honest reading of a point that is on no tile at all.
 */
export function tileAtPoint(x: number, y: number): Tile {
  return {
    col: Math.floor((x - FLOOR_X0) / TILE),
    row: Math.floor((y - FLOOR_Y0) / TILE),
  };
}

/** The footprint side, in tiles, of a tower of `type`. */
export function sizeOf(type: TowerType): number {
  return TOWER_DEFS[type].size;
}

/**
 * The centre of the footprint a tower of `type` anchored at `(col, row)` covers,
 * in logical stage units. This is the point range is measured from.
 */
export function footprintCenter(
  type: TowerType,
  col: number,
  row: number,
): Point {
  return footprintCentre(col, row, sizeOf(type));
}

/** Every tile a footprint anchored at `(col, row)` with side `size` covers. */
export function footprintTiles(col: number, row: number, size: number): Tile[] {
  const tiles: Tile[] = [];
  for (let dr = 0; dr < size; dr += 1) {
    for (let dc = 0; dc < size; dc += 1) {
      tiles.push({ col: col + dc, row: row + dr });
    }
  }
  return tiles;
}

/** Every tile a placed tower stands on, read off the snapshot it was read from. */
export function tilesOf(tower: TowerSnapshot): Tile[] {
  return footprintTiles(tower.col, tower.row, tower.size);
}

/** The distance between two logical points. */
export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** The centre of a control's hit rectangle, which is where a tap lands. */
export function rectCenter(rect: ControlRect): Point {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/* -------------------------------------------------------------------------- */
/* The harness                                                                */
/* -------------------------------------------------------------------------- */

/**
 * What the build owes when its surface is missing: the `Expected:` line of the
 * failure every check that reaches for the surface lands on, beside what
 * `engine.debug` was found holding instead.
 *
 * The case's own sentence rather than the package's, because where the surface
 * comes from is this engine's business: a build whose `initialize` REJECTED never
 * reaches it — the engine's own rejection fails the suite's `beforeEach` with the
 * engine's message, naming the missing surface, which is why every suite's
 * `afterEach` disposes with `?.` — and what is named here is the other fault, a
 * return that is no surface at all.
 */
const SURFACE_REQUIREMENT =
  "the debug surface src/game.ts's instance returns from initialize, which " +
  "the engine hands back from engine.debug (specs/instrumentation.md)";

/**
 * The validator project's own root, taken from this module's own URL rather than
 * from the working directory, because it has to name the same directory in both
 * layouts this file lives in: the case's own `validation/<engine>/`, and the
 * `validation/` the runner stages that directory to inside the build's tree.
 *
 * It is never derived inside the package, which is staged one directory DEEPER
 * than this file: a root taken from there would address every replay and every
 * still one directory too far down, silently, because both writers are required
 * not to raise.
 */
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * The suite's own clock, by the engine it was handed to, so a real-time window
 * can put it back when it closes.
 *
 * The kit builds the engine and the harness for the case, so the case never sees
 * the clock a caller passed — and {@link WorldModel.settle} has to restore it.
 * Keyed on the engine rather than kept in a variable because two harnesses may be
 * under construction at once and a variable would answer for the wrong one.
 */
const suiteClockOf = new WeakMap<object, Clock>();

/**
 * Everything a check reads off one engine running one build, over and above the
 * package's neutral contract.
 *
 * The first three are this engine's own object model, which its simple sibling
 * has none of, and they are getters so each reads FRESH on every access: Meltdown
 * runs in one world for the whole session — every screen is a value of the state's
 * `screen` field — but reading it through the engine keeps a check honest against
 * a build that rebuilt it anyway. The last three are the case's own vocabulary for
 * time.
 */
interface WorldModel {
  /** The world currently open. */
  readonly world: World;
  /**
   * The open world's game state — the live `MeltdownState` specs/state.md
   * declares. Its arrangement is the build's; what a check asserts is read
   * through `snapshot`.
   */
  readonly state: GameState;
  /** The game instance, the one framework object that outlives every level. */
  readonly instance: GameInstance<MeltdownSurface>;
  /** Run whole frames covering `duration` seconds of game time. */
  advanceSeconds(duration: number): Promise<void>;
  /**
   * Hand the frame loop AND a real-time clock back to the build for `ms` of
   * wall-clock time, then take both back.
   *
   * This is the measurement a question about whether time passes is decided on:
   * nothing steps the game, the build's own loop runs it off the host's frame
   * callback against a {@link WallClock}, and what the game does over the window
   * is the game's. See {@link windowOfRealTime}, which brackets it with the
   * snapshots a reading pair comes from.
   *
   * The suite's own clock is restored when the window closes, so a check may
   * step normally on either side of one.
   */
  settle(ms: number): Promise<void>;
  /**
   * Hand the frame loop AND a real-time clock back to the build until ITS OWN
   * clock has gained `seconds`, and report whether it got there before
   * `deadlineMs` of wall clock ran out.
   *
   * THE READING THAT MAKES A REAL WINDOW REPEATABLE, and the form every leg a
   * check actually asserts on should take. {@link WorldModel.settle} spends a
   * fixed stretch of the HOST'S clock, so what a leg covers is however many
   * frames this machine handed the loop, each of them worth at most the
   * `WallClock`'s clamp; on a runner with a hundred other things on it that is a
   * fraction of the game time the window really took, and a leg read that way
   * fails a conformant build for the load on the machine that scored it. Closing
   * the leg on `simTime` — which `specs/waves.md` says accumulates the game time
   * every frame advances by — covers the same stretch of the game however long the
   * host takes to deliver it, so everything read off the leg follows from the game
   * rather than from the runner.
   *
   * Nothing steps the game: the loop is the build's own and the clock is real.
   * What still fails is the only thing such a leg ever asked — a build whose
   * simulation does not advance unless something steps it never gains the seconds
   * and comes back with `reached` false when the deadline runs out.
   *
   * The suite's own clock is restored when the leg closes, exactly as
   * {@link WorldModel.settle} restores it.
   */
  gain(seconds: number, deadlineMs: number): Promise<GainResult>;
}

/**
 * The package's engine machinery, bound to Meltdown on this engine.
 *
 * Three of the config's members are where the four engines really differ, and
 * each is answered here from what THIS one is:
 *
 *  - `driver` is the identity, because a structured engine's surface is already
 *    imperative.
 *  - `toLogical` goes through the world's camera. The camera is never moved or
 *    zoomed in this game — world and logical coordinates coincide, which is the
 *    space every figure in `constants.ts` is stated in — so the projection is the
 *    identity unless the build moved it, and mapping through it keeps every pixel
 *    reading and every raised pointer honest either way.
 *  - `pointerPrecision` is `"exact"`: a raised pointer lands where the caller
 *    asked rather than on the nearest device pixel, which is what this project's
 *    checks have always been decided under — a panel control's centre is commonly
 *    half a unit off a pixel, and rounding it would move the press. The event
 *    itself is the package's `PointerPositionEvent` — the client position and
 *    `isPrimary`, and nothing else — which is what this harness has always
 *    dispatched and what the engine's pointer input reads.
 */
const kit = createEngineCaseHarness<
  MeltdownSnapshot,
  MeltdownDriver,
  MeltdownEngine,
  WorldModel
>({
  slug: "meltdown",
  projectRoot: PROJECT_ROOT,
  stage: { width: STAGE_W, height: STAGE_H },
  tickHz: TICK_HZ,
  surfaceRequirement: SURFACE_REQUIREMENT,
  // The text readings below place a run about its anchor, so each text call is
  // measured and the transform in force at it recorded.
  recorder: { measureText: true },
  defaultClock: () => new ConstantClock(TICK_MS),
  createEngine: ({ canvas, clock, surface }) => {
    const engine = createEngine<MeltdownSurface>({
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
    });
    suiteClockOf.set(engine, clock as Clock);
    return engine;
  },
  driver: (_engine, raw) => identityDriver(raw as MeltdownSurface),
  snapshot: (debug) => debug.snapshot(),
  toLogical: (engine, x, y) => engine.world.camera.worldToLogical({ x, y }),
  pointerPrecision: "exact",
  extend: (base, engine, initialized) => ({
    get world() {
      return engine.world;
    },
    get state() {
      return engine.world.state;
    },
    instance: initialized as GameInstance<MeltdownSurface>,

    advanceSeconds: (duration: number) => base.advance(ticksFor(duration)),

    async settle(ms: number) {
      // A real clock for a real window: the game is handed the elapsed time each
      // frame actually took, exactly as it is in a browser.
      engine.setClock(new WallClock());
      const controller = new AbortController();
      const running = engine.run({ signal: controller.signal });
      try {
        await new Promise((resolve) => setTimeout(resolve, ms));
      } finally {
        controller.abort();
        await running;
        engine.setClock(suiteClockOf.get(engine) as Clock);
      }
    },

    async gain(seconds: number, deadlineMs: number) {
      // The same handover `settle` makes, held open on the BUILD'S clock instead
      // of on the host's.
      engine.setClock(new WallClock());
      const from = base.snapshot().simTime;
      const controller = new AbortController();
      const running = engine.run({ signal: controller.signal });
      const startedMs = Date.now();
      let reached = false;
      try {
        await new Promise<void>((resolve) => {
          const check = (): void => {
            if (base.snapshot().simTime - from >= seconds) {
              reached = true;
              resolve();
              return;
            }
            if (Date.now() - startedMs >= deadlineMs) {
              resolve();
              return;
            }
            setTimeout(check, GAIN_POLL_MS);
          };
          setTimeout(check, GAIN_POLL_MS);
        });
      } finally {
        controller.abort();
        await running;
        engine.setClock(suiteClockOf.get(engine) as Clock);
      }
      return { reached, elapsedMs: Date.now() - startedMs };
    },
  }),
});

/** Everything a check reads off one engine running one build. */
export type Harness = EngineHarness<
  MeltdownSnapshot,
  MeltdownDriver,
  MeltdownEngine
> &
  WorldModel;

/** The window a harness reports to the engine, and the clock it steps on. */
export type HarnessOptions = EngineHarnessOptions;

/** Seconds of simulated time in `ticks` frames of the default clock. */
export const seconds = kit.seconds;

/** Every recorded firing of the cue named `name`, oldest first. */
export const cuesNamed = kit.cuesNamed;

/** Forget every cue recorded so far, so a check reads its own section alone. */
export const clearCues = kit.clearCues;

/**
 * Build an engine over a canvas of the harness's own, initialize the build's
 * game, and hand back everything a check reads.
 *
 * The options the kit passes the factory are the ones the seeded `src/main.ts`
 * passes — the design size, the build's exported `BACKGROUND`, and the four-way
 * layout — so one harness serves every build of this case. Everything else the
 * build decided lives inside `src/game.ts`.
 *
 * Dispose it in an `afterEach`, with `?.`, so a build whose `initialize` rejected
 * fails with the engine's own message rather than with a teardown error on top of
 * it.
 */
export const createHarness = kit.createHarness;

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

/* -------------------------------------------------------------------------- */
/* Evidence capture                                                           */
/* -------------------------------------------------------------------------- */
//
// A review item may declare a `replay` OUTPUT beside its verdict: the frames the
// build itself drew while a check drove it, kept as evidence a reviewer can
// scrub and compare against the reference implementation's. Both writers are the
// package's, bound here to this case's slug and to THIS directory, and four
// properties are what make them usable:
//
// 1. THEY RECORD THE SECTION, NOT THE RUN. The recorder is armed around the
//    caller's scenario and disarmed the moment that scenario returns, so what is
//    kept is the part the check is ABOUT and never the setup that got there.
//    ARM IT NARROWLY. Meltdown redraws a whole floor every frame — fifty by
//    thirty-six tiles of grid, every tower's heat read, every unit's health
//    bar — so a recording that spans a scenario as well as the motion it is
//    about grows fast against the recorder's own capture budget.
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
 * const swept = await captureReplay(h, "cooldown", () =>
 *   h.until((s) => !towerOf(s, id).tripped, { maxFrames: ticksFor(6) }),
 * );
 * ```
 *
 * The assertions stay exactly where they were and read exactly what they did.
 */
export const captureReplay = makeReplayCapture("meltdown", PROJECT_ROOT);

/**
 * Keep the frame currently on the canvas as the review item's `outputId` output.
 *
 * The companion to {@link captureReplay}, for a point whose evidence is one
 * PICTURE rather than a stretch of motion: the maze a placement left behind,
 * which screen the game opened on, what the build panel read. A recording of a
 * still floor would be the same frame three hundred times over.
 *
 * What is written is whatever the last frame that RAN left behind, so call it
 * after the frame that poses the thing under test and before the assertions, so a
 * check that fails still leaves the picture that shows why.
 */
export const captureStill = kit.captureStill;

/* -------------------------------------------------------------------------- */
/* Scenario helpers                                                           */
/* -------------------------------------------------------------------------- */
//
// Each of these poses a situation through the debug surface — or the real
// registered actions and the real pointer — and then lets the build's own rules
// run. They fix only arrangement: which tile a tower stands on, where a unit is
// placed, which key is held. Every threshold a check asserts is stated in the
// check itself, derived from the figure or rule specs/ states for it.
//
// A check calls the ones it needs and no more. Nothing here is a prerequisite of
// anything else here: a check about the title menu poses no floor, and a check
// about a tower's cooling poses no unit.

/**
 * `reset(seed)`: the title screen, a seeded generator, every declared field at
 * its title-screen value, both rosters empty and the world gate back on.
 *
 * No frame is advanced. A pose acts on the live game at the call under this
 * engine (specs/instrumentation.md), so the state is restored when this returns,
 * and a check about what `reset` restores — `simTime` among them — reads a game
 * that has run no frame since.
 */
export function resetTo(h: Harness, seed?: number): void {
  h.debug.reset(seed);
}

/** The money a run on this pair opens with (specs/modes.md). */
export function startMoneyOf(
  mode: ModeName,
  difficulty: DifficultyName,
): number {
  return MODE_TABLE[mode].startMoney ?? DIFFICULTY_TABLE[difficulty].money;
}

/** The lives a run on this mode opens with (specs/modes.md). */
export function startLivesOf(mode: ModeName): number {
  return MODE_TABLE[mode].startLives;
}

/**
 * A run open on an EMPTY, QUIET floor, at wave 1 of its build phase, with the
 * run's figures at what the mode and difficulty give them.
 *
 * This is the ground almost every mechanical check stands on, and it is a harness
 * sequence rather than a debug operation because the surface is atomic: every
 * line below is one of its operations.
 *
 * EMPTY is safe. A wave clears on the transition in which its last unit goes
 * (specs/waves.md), so a phase that never released one never clears, and a posed
 * rule runs without the run advancing underneath it.
 *
 * QUIET is the world gate. With `waveSpawning` off, the build timer's automatic
 * start of the next wave and the spawner's release of its units are both held, so
 * a scenario that spends more than fifteen seconds of game time — every cooling
 * scenario at a low heat, every trip cooldown, every slow expiry — is not invaded
 * by a wave. The timer still counts down and a unit already on the floor still
 * walks: the gate holds the run's own RELEASE of surge and nothing else.
 *
 * A check whose REQUIREMENT is that faculty turns it back on with
 * `h.debug.setWaveSpawning(true)`, and the list of items that do is closed. A
 * check that finds itself needing the gate for any other reason has been
 * mis-posed.
 *
 * The money and lives are computed from the case's own tables in
 * `constants.ts`, never read back off the build's snapshot: whether a build
 * reports the right `startMoney` is `modes.run-opens-with-its-figures`'s
 * requirement, and a helper that seeded from the build's own reading would fail
 * every scenario standing on that purse for a fault belonging to that one item.
 *
 * The generator is left as `reset` seeded it, so a check that wants a particular
 * seed calls {@link resetTo} first — this helper's own `reset` takes the default.
 * No frame is advanced: every pose here lands at the call.
 */
export function startRun(
  h: Harness,
  mode: ModeName = "containment",
  difficulty: DifficultyName = "medium",
): void {
  const { debug } = h;
  debug.reset();
  debug.setMode(mode);
  debug.setDifficulty(difficulty);
  debug.clearTowers();
  debug.clearSurge();
  debug.setScreen("playing");
  debug.setPhase("building");
  debug.setWave(1);
  debug.setBuildTimer(BUILD_PHASE_TIME);
  debug.setWavePending(0);
  debug.setWaveSpawning(false);
  debug.setMoney(startMoneyOf(mode, difficulty));
  debug.setLives(startLivesOf(mode));
  debug.setScore(0);
  debug.setSelected(null);
  debug.setHoverShop(null);
  debug.setArmed(null);
  debug.setSpeed(1);
}

/**
 * One tower of `type`, footprint anchored at `(col, row)`, and its id.
 *
 * The id comes off the snapshot's last tower, which is where an added tower lands
 * (specs/instrumentation.md, Identity). A build whose `addTower` added nothing
 * fails here, naming the operation.
 */
export function poseTower(
  h: Harness,
  type: TowerType,
  col: number,
  row: number,
  rotation = 0,
): number {
  h.debug.addTower(type, col, row, rotation);
  const towers = h.snapshot().towers;
  if (towers.length === 0) {
    fail(
      `addTower(${JSON.stringify(type)}, ${col}, ${row}, ${rotation}) to ` +
        `append a tower to the roster (specs/instrumentation.md)`,
      "the tower roster is empty",
    );
  }
  return towers[towers.length - 1].id;
}

/**
 * A tower whose guns are held off, at a posed heat: the THERMAL-scenario atom.
 *
 * With `firingEnabled` off the tower acquires nothing and fires nothing, so no
 * shot's `heatPerShot` lands in the middle of a measurement, while its thermal
 * model runs exactly as an idle tower's does — it cools, conducts, exchanges with
 * movers, and trips.
 */
export function poseIdleTower(
  h: Harness,
  type: TowerType,
  col: number,
  row: number,
  rotation = 0,
  heat = 0,
): number {
  const id = poseTower(h, type, col, row, rotation);
  h.debug.setTowerFiring(id, false);
  h.debug.setTowerHeat(id, heat);
  return id;
}

/**
 * A tower firing at a heat that cannot drift: the COMBAT-scenario atom.
 *
 * With `thermalEnabled` off the heat holds exactly where it was posed while the
 * tower goes on acquiring targets, firing at its rate, and dealing
 * `baseDamage * heatMultiplier(heat, redline)` at that pinned heat — which is how
 * a damage reading is taken without the multiplier moving under it.
 */
export function posePinnedTower(
  h: Harness,
  type: TowerType,
  col: number,
  row: number,
  heat: number,
  rotation = 0,
): number {
  const id = poseTower(h, type, col, row, rotation);
  h.debug.setTowerThermal(id, false);
  h.debug.setTowerHeat(id, heat);
  return id;
}

/**
 * A tower that is ALREADY tripped, with its cooldown running: the trip atom.
 *
 * Every item about what a tripped tower does poses one this way rather than
 * driving one over its redline, because driving it there would make the item fail
 * whenever targeting, range, the fire clock or the per-shot heat gain is broken —
 * the entanglement the two faculty gates exist to remove. The one item whose
 * requirement is the trip EVENT (`trip/trips-at-100`) reaches it on the real path
 * instead, and so does `audio/trip-cue`.
 *
 * `timer` and `heat` are the caller's, because what a trip opens with is a figure
 * specs/heat.md fixes and the check that asserts it states it.
 */
export function poseTrippedTower(
  h: Harness,
  type: TowerType,
  col: number,
  row: number,
  heat: number,
  timer: number,
  rotation = 0,
): number {
  const id = poseTower(h, type, col, row, rotation);
  h.debug.setTowerTripped(id, true);
  h.debug.setTowerTripTimer(id, timer);
  h.debug.setTowerHeat(id, heat);
  return id;
}

/**
 * A stationary, effectively unkillable target with its centre on tile
 * `(col, row)`, and its id.
 *
 * Motion off, so it does not walk out of range while a reading is taken, and its
 * route is still computed from the tile it stands on. The hp is the caller's: a
 * target a damage reading is taken off wants far more hp than the shots will
 * remove, so the reading is a subtraction rather than a death.
 */
export function poseTarget(
  h: Harness,
  type: SurgeType,
  col: number,
  row: number,
  hp: number,
): number {
  const { x, y } = tileCenter(col, row);
  return poseTargetAt(h, type, x, y, hp);
}

/** {@link poseTarget} at a logical stage point rather than a tile centre. */
export function poseTargetAt(
  h: Harness,
  type: SurgeType,
  x: number,
  y: number,
  hp: number,
): number {
  const id = poseUnit(h, type, "left");
  h.debug.setUnitPosition(id, x, y);
  h.debug.setUnitMotion(id, false);
  h.debug.setUnitMaxHp(id, hp);
  h.debug.setUnitHp(id, hp);
  return id;
}

/**
 * One unit of `type` entered at `vent`, exactly as the spawner enters one, and
 * its id. Motion on, hp as its type and the wave's scaling give it.
 *
 * This is the WALKER: a check about crossing the floor, leaking, or being slowed
 * poses one of these and lets it walk.
 */
export function poseWalker(
  h: Harness,
  type: SurgeType,
  vent: VentName,
): number {
  return poseUnit(h, type, vent);
}

/** `addUnit`, with the id read off the roster it was appended to. */
function poseUnit(h: Harness, type: SurgeType, vent: VentName): number {
  h.debug.addUnit(type, vent);
  const surge = h.snapshot().surge;
  if (surge.length === 0) {
    fail(
      `addUnit(${JSON.stringify(type)}, ${JSON.stringify(vent)}) to append a ` +
        `unit to the roster (specs/instrumentation.md)`,
      "the surge roster is empty",
    );
  }
  return surge[surge.length - 1].id;
}

/**
 * A tower of each of `types` placed against the four faces of the tower `id`,
 * and their ids in the order they were given: north, east, south, west.
 *
 * The four are anchored so each shares a whole face with the centre tower and
 * none shares an edge with another — they meet each other at corners only — so
 * every edge-tile of the centre's perimeter faces a tower and sheds nothing to
 * air. That is the thermal blanket the boxed-in items are about.
 *
 * The centre tower is read off the snapshot for its anchor and its size, so this
 * works for a 2, 3 or 4 tile footprint. The four neighbours are 2x2, which every
 * type in `types` must therefore be; a caller wanting a larger neighbour places
 * it itself.
 */
export function boxIn(
  h: Harness,
  id: number,
  types: readonly [TowerType, TowerType, TowerType, TowerType],
): [number, number, number, number] {
  const centre = towerById(h.snapshot(), id);
  if (centre === undefined) {
    return fail(`a tower with id ${id} on the floor`, "no such tower");
  }
  const { col, row, size } = centre;
  const [north, east, south, west] = types;
  return [
    poseTower(h, north, col, row - sizeOf(north)),
    poseTower(h, east, col + size, row),
    poseTower(h, south, col, row + size),
    poseTower(h, west, col - sizeOf(west), row),
  ];
}

/**
 * Arm a type, hold a rotation, move the preview onto `(col, row)` and commit it —
 * the whole of what a player does to put a tower down, through the surface's own
 * atoms and its one act.
 *
 * The id of the tower `place` committed comes back, or `null` when the footprint
 * was invalid and nothing was built — which is the honest answer for a check
 * about a refused placement. The roster's length is compared across the act, so a
 * commit is told from a refusal by whether a tower arrived rather than by
 * re-reading `build.valid` after the fact.
 */
export function placeAt(
  h: Harness,
  type: TowerType,
  col: number,
  row: number,
  rotation = 0,
): number | null {
  h.debug.setArmed(type);
  h.debug.setPreviewRotation(rotation);
  h.debug.setPreview(col, row);
  const before = h.snapshot().towers.length;
  h.debug.place();
  const towers = h.snapshot().towers;
  if (towers.length <= before) return null;
  return towers[towers.length - 1].id;
}

/* ---- Driving the real input path ------------------------------------------ */

/** An action the game registers, as `constants.ts` names them (specs/controls.md). */
export type Action = ActionName;

/**
 * The action's first bound key, from the case-fixed `BINDINGS` table, pressed and
 * released as a player would press it — the REAL registered-action path, which is
 * the only way the menus move (specs/screens.md).
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
 * Move the pointer to a logical stage point and run the frame that delivers it.
 *
 * A real `pointermove` at the engine's own event target, which is the path the
 * build's preview reads through `input.pointer()` — never the debug surface's
 * `pointerMove`, so a check about what the pointer does is decided on the path a
 * player uses.
 */
export async function movePointerTo(
  h: Harness,
  x: number,
  y: number,
): Promise<void> {
  h.pointer("pointermove", x, y);
  await h.advance(1);
}

/**
 * A press and a release at one logical stage point, a frame apart — one tap, as a
 * player makes it.
 *
 * The press lands, a frame runs so the build resolves it, the release lands, and a
 * frame runs so the build resolves that. Which of place, select and deselect
 * happens is the build's to decide from what is armed (specs/building.md).
 */
export async function pressAt(h: Harness, x: number, y: number): Promise<void> {
  h.pointer("pointerdown", x, y);
  await h.advance(1);
  h.pointer("pointerup", x, y);
  await h.advance(1);
}

/** {@link pressAt} on the centre of a control the panel reported. */
export function tapControl(h: Harness, control: ControlRect): Promise<void> {
  const { x, y } = rectCenter(control);
  return pressAt(h, x, y);
}

/**
 * The rectangle the build reported for row `index` of the current screen's menu,
 * or the failure that it reported none.
 *
 * `specs/screens.md` requires every row of every menu to be a pointer target and
 * has the build report each row's rectangle, so a screen whose menu the build
 * drew but did not report cannot be driven with the pointer at all.
 */
export function menuRow(snapshot: MeltdownSnapshot, index: number): MenuRow {
  const row = snapshot.menu.find((entry) => entry.index === index);
  if (row === undefined) {
    fail(
      `snapshot().menu to hold row ${index} of the ${snapshot.screen} menu, ` +
        `one rectangle per row in row order (specs/screens.md)`,
      snapshot.menu.map((entry) => entry.index),
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
): Promise<MenuRow> {
  const row = menuRow(h.debug.snapshot(), index);
  const at = rectCenter(row);
  await movePointerTo(h, at.x, at.y);
  return row;
}

/** {@link pressAt} on the centre of a reported menu row. */
export async function tapMenuRow(h: Harness, index: number): Promise<void> {
  const at = rectCenter(menuRow(h.debug.snapshot(), index));
  await pressAt(h, at.x, at.y);
}

/** {@link pressAt} on the centre of tile `(col, row)`. */
export function pressTile(h: Harness, col: number, row: number): Promise<void> {
  const { x, y } = tileCenter(col, row);
  return pressAt(h, x, y);
}

/* -------------------------------------------------------------------------- */
/* Windows on the build's own clock                                           */
/* -------------------------------------------------------------------------- */
//
// THE RULE THESE EXIST FOR. Any check about whether time passes is measured on
// the clock the player's game actually runs on, never through the stepping
// operation, because the stepping operation is instrumentation and the question
// is about the game.
//
// Meltdown's own history is why. A pause check that paused the game and then
// stepped it measured WHERE A BUILD PUT ITS PAUSE GATE and not whether the floor
// froze: a build holding the pause in the shell that drives the clock — equally
// legal — stepped straight through the check while its real-time clip showed the
// unit stopping dead, and a build whose pause menu opened over a floor that kept
// running — the actual defect the item exists to catch — passed outright whenever
// the stepping operation happened to be gated.
//
// Under this engine `engine.advance` IS the player's frame loop running against a
// different clock object, so {@link windowOfFrames} is a legitimate reading of
// that rule. {@link windowOfRealTime} is the stronger one, and it is what the
// `waves.pause-*`, `waves.resume-*`, `waves.game-runs-on-its-own-clock` and
// `waves.speed-doubles-the-game-time` items are measured with: the loop and the
// clock go back to the build, a real window of wall-clock time passes, and
// nothing in the suite touches the game while it does.
//
// BOTH READINGS COME FROM ONE SNAPSHOT. The window's `opened` snapshot is taken
// once, after whatever act opened it, so a pair read off it — a unit's position
// and `simTime`, say — spans that window and nothing else. A check that took two
// snapshots would be comparing readings a round trip apart and could not say what
// the interval between them was.

/** One window on the build's own clock, with the snapshot on each side of it. */
export interface ClockWindow {
  /**
   * The ONE snapshot taken as the window opened, after the act that opened it.
   * Every reading of what happened during the window is measured from this.
   */
  opened: MeltdownSnapshot;
  /** The snapshot taken as the window closed. */
  closed: MeltdownSnapshot;
  /** The wall-clock milliseconds the window was left open for, `0` for a stepped one. */
  ms: number;
  /** The frames of the suite's own clock the window spanned, `0` for a real one. */
  frames: number;
}

/**
 * Run `act`, snapshot, step `frames` frames of the suite's clock, snapshot again.
 *
 * The reading a check about a rate takes: the engine's frame loop runs the
 * identical frame a player's frame runs, so what this measures is the game's own
 * advance rather than an instrument's.
 *
 * `act` is optional and runs BEFORE the opening snapshot, so a window opened by a
 * key press spans the press and nothing before it.
 */
export async function windowOfFrames(
  h: Harness,
  frames: number,
  act?: () => void | Promise<void>,
): Promise<ClockWindow> {
  if (act !== undefined) await act();
  const opened = h.snapshot();
  await h.advance(frames);
  return { opened, closed: h.snapshot(), ms: 0, frames };
}

/**
 * Run `act`, snapshot, hand the loop and a real clock back to the build for `ms`
 * of wall-clock time, snapshot again.
 *
 * Nothing steps the game across the window: {@link Harness.settle} runs the
 * build's own loop off the host's frame callback against a `WallClock`, so what
 * the game does is the game's. This is the measurement the pause items rest on,
 * and the running leg of such a pair is what stops a dead floor passing
 * vacuously.
 *
 * The window's length and every tolerance read off it belong to the CHECK: a
 * build may clamp its per-frame delta, may lose a frame to the handover, and may
 * resolve an injected key on its next frame rather than inside the call, so the
 * figures that make room for those are stated where they are asserted.
 */
export async function windowOfRealTime(
  h: Harness,
  ms: number,
  act?: () => void | Promise<void>,
): Promise<ClockWindow> {
  if (act !== undefined) await act();
  const opened = h.snapshot();
  await h.settle(ms);
  return { opened, closed: h.snapshot(), ms, frames: 0 };
}

/** One window on the build's own clock, closed on a gain rather than a stopwatch. */
export interface GainWindow extends ClockWindow {
  /** Whether the build's clock gained the seconds asked for before the deadline. */
  reached: boolean;
}

/**
 * Run `act`, snapshot, hand the loop and a real clock back to the build until ITS
 * OWN clock has gained `seconds`, snapshot again.
 *
 * THE FORM EVERY RUNNING LEG A CHECK ASSERTS ON SHOULD TAKE, and the difference
 * from {@link windowOfRealTime} is only which clock decides when the window
 * closes. Nothing steps the game either way — that is the rule, and it is what
 * makes a pause item mean anything — but a window closed by a STOPWATCH covers
 * however much game time this machine's scheduler allowed the loop to produce,
 * which on a loaded runner is a fraction of what the same build produces idle. A
 * bound read off such a window fails a conformant build for the load on the
 * runner. A window closed on `simTime` covers the stretch of the game it names on
 * any machine, and takes longer on a slow one instead of covering less.
 *
 * `ms` reports the real time it took, which is a fact about the HOST and which
 * nothing asserts on; it is there so a PAUSED window beside it — the one window
 * that cannot be closed on a gain, since the whole claim is that the clock does
 * not move — can be given the same stretch of real time.
 */
export async function windowOfClockGain(
  h: Harness,
  seconds: number,
  deadlineMs: number,
  act?: () => void | Promise<void>,
): Promise<GainWindow> {
  if (act !== undefined) await act();
  const opened = h.snapshot();
  const gained = await h.gain(seconds, deadlineMs);
  return {
    opened,
    closed: h.snapshot(),
    ms: gained.elapsedMs,
    frames: 0,
    reached: gained.reached,
  };
}

/**
 * How far the unit `id` moved across a window, in logical units, or `null` where
 * it was missing from either end of it.
 *
 * `null` rather than `0`, because a unit that left the floor and a unit that
 * stood still are different outcomes and a check that read both as `0` could not
 * tell them apart.
 */
export function travelOf(span: ClockWindow, id: number): number | null {
  const before = unitById(span.opened, id);
  const after = unitById(span.closed, id);
  if (before === undefined || after === undefined) return null;
  return distance({ x: before.x, y: before.y }, { x: after.x, y: after.y });
}

/** The game time the simulation advanced by across a window, in seconds. */
export function clockGain(span: ClockWindow): number {
  return span.closed.simTime - span.opened.simTime;
}

/**
 * How much the tower `id`'s heat changed across a window, or `null` where it was
 * missing from either end of it.
 */
export function heatGain(span: ClockWindow, id: number): number | null {
  const before = towerById(span.opened, id);
  const after = towerById(span.closed, id);
  if (before === undefined || after === undefined) return null;
  return after.heat - before.heat;
}

/* -------------------------------------------------------------------------- */
/* Reading the snapshot                                                       */
/* -------------------------------------------------------------------------- */
//
// Plain functions over the object `snapshot()` returned, so a check reads what it
// is about without walking a roster by hand. None of them asserts anything: a
// reading that is not there comes back `undefined`, and what that means is the
// check's to state.

/** The tower with that id, or `undefined` where no tower carries it. */
export function towerById(
  snapshot: MeltdownSnapshot,
  id: number,
): TowerSnapshot | undefined {
  return snapshot.towers.find((tower) => tower.id === id);
}

/** The unit with that id, or `undefined` where no unit carries it. */
export function unitById(
  snapshot: MeltdownSnapshot,
  id: number,
): UnitSnapshot | undefined {
  return snapshot.surge.find((unit) => unit.id === id);
}

/** The tower whose footprint covers tile `(col, row)`, in roster order. */
export function towerOn(
  snapshot: MeltdownSnapshot,
  col: number,
  row: number,
): TowerSnapshot | undefined {
  return snapshot.towers.find(
    (tower) =>
      col >= tower.col &&
      col < tower.col + tower.size &&
      row >= tower.row &&
      row < tower.row + tower.size,
  );
}

/** Every tile every tower on the floor stands on. */
export function blockedTiles(snapshot: MeltdownSnapshot): Tile[] {
  return snapshot.towers.flatMap(tilesOf);
}

/** Every tower of `type` on the floor, in roster order. */
export function towersOfType(
  snapshot: MeltdownSnapshot,
  type: TowerType,
): TowerSnapshot[] {
  return snapshot.towers.filter((tower) => tower.type === type);
}

/** Every unit of `type` on the floor, in roster order. */
export function unitsOfType(
  snapshot: MeltdownSnapshot,
  type: SurgeType,
): UnitSnapshot[] {
  return snapshot.surge.filter((unit) => unit.type === type);
}

/** The centre of a placed tower's footprint, which is what range is measured from. */
export function centreOf(tower: TowerSnapshot): Point {
  return footprintCentre(tower.col, tower.row, tower.size);
}

/** A unit's centre, as a point. */
export function positionOf(unit: UnitSnapshot): Point {
  return { x: unit.x, y: unit.y };
}

/** The shop entry the panel drew for `type`, or `undefined` where it drew none. */
export function shopEntry(
  snapshot: MeltdownSnapshot,
  type: TowerType,
): ShopControl | undefined {
  return snapshot.controls.shop.find((entry) => entry.type === type);
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
 *
 * A LOOP IS NOT A PLAY, and this project counts firings, so the kit is left at
 * its default subscription of `cue:played` alone.
 */
export const watchCues = kit.watchCues;

/* -------------------------------------------------------------------------- */
/* Reading the rendered pixels                                                */
/* -------------------------------------------------------------------------- */

/**
 * How far out on the axes {@link sampleColor} takes its four neighbours.
 *
 * Three logical units — well inside a 19-unit tile, and inside the smallest
 * footprint a tower is drawn on — so one stray anti-aliased or glow pixel cannot
 * swing the reading. The package's own default is four, which is a fact about the
 * cases it was lifted from rather than about this game's tiles, so the figure is
 * named here and passed.
 */
const SAMPLE_RADIUS = 3;

/**
 * The rendered colour at a logical point, averaged over a small cluster.
 *
 * The package's five-point cluster — the centre pixel and four neighbours
 * {@link SAMPLE_RADIUS} units out on the axes — at this case's own radius.
 */
export function sampleColor(h: Harness, x: number, y: number): Rgb {
  return sampleCluster(h as EnginePointReader, x, y, SAMPLE_RADIUS);
}

/** The rendered colour at the centre of tile `(col, row)`. */
export function sampleTile(h: Harness, col: number, row: number): Rgb {
  const { x, y } = tileCenter(col, row);
  return sampleColor(h, x, y);
}

/** The rendered colour at the centre of a placed tower's footprint. */
export function sampleTower(h: Harness, tower: TowerSnapshot): Rgb {
  const { x, y } = centreOf(tower);
  return sampleColor(h, x, y);
}

/**
 * How bright a colour is, on the 0–255 scale (Rec. 601).
 *
 * A DIFFERENT WEIGHTING FROM THE PACKAGE'S `luminance`, which is Rec. 709
 * (`0.2126r + 0.7152g + 0.0722b`). The two differ by up to a fifth of the scale
 * on a saturated colour, and this project's {@link brightestIn} ranks a
 * rectangle's pixels by it, so folding them would silently pick different pixels
 * out of every mark this suite reads. It stays the case's; see the package
 * README's collision table.
 */
export function luminance(colour: Rgb): number {
  return 0.299 * colour.r + 0.587 * colour.g + 0.114 * colour.b;
}

/** Every device pixel inside a logical rectangle, as `Rgb`s. */
function pixelsIn(
  h: Harness,
  x: number,
  y: number,
  w: number,
  height: number,
): Rgb[] {
  const from = h.device(x, y);
  const to = h.device(x + w, y + height);
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
  return pixels;
}

/** The mean colour of a logical rectangle, over every device pixel in it. */
export function sampleRegion(
  h: Harness,
  x: number,
  y: number,
  w: number,
  height: number,
): Rgb {
  const pixels = pixelsIn(h, x, y, w, height);
  let r = 0;
  let g = 0;
  let b = 0;
  for (const pixel of pixels) {
    r += pixel.r;
    g += pixel.g;
    b += pixel.b;
  }
  return {
    r: r / pixels.length,
    g: g / pixels.length,
    b: b / pixels.length,
  };
}

/**
 * The colour of whatever is BRIGHTEST inside a logical rectangle: the mean of its
 * brightest `fraction` of pixels.
 *
 * {@link sampleRegion} reads the whole rectangle, which is the right reading for
 * a solid body — a tower footprint, the casing band, the panel strip — and the
 * wrong one for a MARK on a field: a heat read drawn as a thin bar across a
 * footprint, a health bar over a unit, a range ring. Averaging those in with the
 * ground behind them reads the ground. This reads the mark instead.
 *
 * The fraction is the caller's, because how much of a rectangle the thing being
 * read fills is a fact about what the check is looking at.
 *
 * A DIFFERENT FUNCTION FROM THE PACKAGE'S `brightestIn`, which picks the single
 * brightest SAMPLE out of a neighbourhood of separately-read points and answers
 * where it was. This one reads a RECTANGLE and answers the mean of a share of it,
 * ranked by this file's own Rec. 601 {@link luminance}. Neither is a version of
 * the other, so it stays the case's; see the package README's collision table.
 */
export function brightestIn(
  h: Harness,
  x: number,
  y: number,
  w: number,
  height: number,
  fraction: number,
): Rgb {
  const pixels = pixelsIn(h, x, y, w, height);
  pixels.sort((a, b) => luminance(b) - luminance(a));
  const taken = Math.max(1, Math.round(pixels.length * fraction));
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < taken; i += 1) {
    r += pixels[i].r;
    g += pixels[i].g;
    b += pixels[i].b;
  }
  return { r: r / taken, g: g / taken, b: b / taken };
}

/**
 * The build's exported `BACKGROUND`, rasterized: the colour the engine clears the
 * whole canvas to each frame (specs/overview.md), read back through the same
 * canvas implementation the harness samples with, so a pixel the game never drew
 * over compares against it exactly.
 *
 * The package's `rasterize` repeats the fill rather than applying it once, so a
 * translucent colour reads as the engine leaves it: the engine composites its
 * clear over the previous frame every frame, which converges on the colour's own
 * channels, and a single fill over a transparent canvas would not.
 */
export function clearColor(): Rgb {
  const [r, g, b] = rasterize(BACKGROUND);
  return { r, g, b };
}

/**
 * The canvas's whole backing store, copied — so a check can hold two frames apart
 * and say whether anything the build drew changed between them.
 */
export function canvasPixels(h: Harness): Uint8ClampedArray {
  return readCanvasPixels(h as EngineFrameReader);
}

/** How many bytes differ between two {@link canvasPixels} captures. */
export const pixelsChanged = countPixelsChanged;

/* -------------------------------------------------------------------------- */
/* Reading one frame's render                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Every string the frame drew, through `fillText` or `strokeText`.
 *
 * The package's reading, which answers the RAW strings one entry per call — what
 * a reader that counts draws, or takes the difference between two frames' text,
 * wants. A reader of COPY wants the merged-run reading beside it,
 * {@link drawnTextLines}: see {@link drewText} for why.
 */
export { drawnText };

/**
 * Every logical run of text the frame spelled, as the strings it spells.
 *
 * The shared harness's reading, re-exported so a suite next door goes on naming
 * `../harness` for everything it reads. Where {@link drawnText} answers the raw
 * `fillText` split, this answers the RUNS those calls spell: a heading drawn a
 * glyph at a time is one entry here and a dozen there. See {@link drewText} for
 * why copy is read off this and never off the split.
 */
export { drawnTextLines };

/**
 * Whether the frame spelled `text` inside some logical run of text, ignoring
 * case.
 *
 * Substring rather than equality on purpose: the copy a check asserts is the
 * case's own, but how a build presents it is the build's, and a readout is
 * commonly drawn with its label, a separator or padding around it. Requiring the
 * exact run would fail a panel that shows precisely the right words.
 *
 * And read off the LOGICAL RUNS the frame spells, never off the `fillText`
 * split. A build that letter-spaces a heading draws one glyph per call, which is
 * the only portable way to letter-space canvas text, and the specification fixes
 * the copy a screen shows while leaving its spacing to the build. The recorder
 * measures every text call (`recorder: { measureText: true }` above), so the
 * shared harness's merge rule (`case-harness/text.ts`) can coalesce side-by-side
 * glyphs on one baseline back into the string they spell. Every raw string is a
 * substring of the run it belongs to, so coalescing can only add a match and
 * never take one away. The package's `drewText`, under the name every check
 * here has always used.
 */
export function drewText(calls: readonly DrawCall[], text: string): boolean {
  return spelledText(calls, text);
}

/**
 * The geometry calls a frame made, by name.
 *
 * Enough of a count to compare two frames of the same scene: a frame that drew a
 * range ring asked for strictly more of these than the same frame without one,
 * whatever shape the build chose to draw it as.
 *
 * THE PACKAGE'S LIST ALSO CARRIES `putImageData`, and this one deliberately does
 * not: a blit of raw pixel data is not geometry the build asked the context to
 * rasterize, and counting it would move every comparison this project makes on a
 * build that composites that way. So the list and the count over it stay the
 * case's; see the package README's collision table.
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
 * its geometry is the direct reading of it: the points along a tile boundary are
 * the grid, and a ring of points about a footprint centre is a range ring. The
 * leading pair of arguments is the position for every method listed, except the
 * curve calls, whose control points come first and whose endpoint is the last
 * pair.
 *
 * A DIFFERENT READING FROM THE PACKAGE'S `drawnPoints`, which maps every point
 * through the transform in force at its call and so answers in DEVICE pixels.
 * That is the right reading under a pipeline the build transforms inside; here
 * the pipeline has already put the context in the game's own space, so applying
 * the transform again would state every point in a space no check speaks. It
 * stays the case's; see the package README's collision table.
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

/**
 * One run of text a frame drew, and the logical x range its glyphs span.
 *
 * The package's `TextDraw`, under this project's own name. It carries the
 * alignment in force at the draw as well, which nothing here reads.
 */
export type TextSpan = TextDraw;

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
 * This is how a check tells the panel's readouts apart from the floor's: a run
 * whose `left` is past the panel's own left edge was drawn on the panel.
 *
 * The OVERLAY's text is in here too when the overlay is up: the engine draws it
 * through the same context, in device pixels under an identity transform, which
 * this mapping carries back to logical units like any other run.
 *
 * ONE ENTRY PER CALL — the package's `textDraws` rather than its `drawnTextRuns`,
 * which coalesces the draws of one logical run into a single wider entry. This is
 * what a check holding a readout clear of a region, or counting the draws a
 * panel made, wants; a check reading COPY wants the runs those draws spell, and
 * takes {@link spelledRuns}. `allInLogical` is the second half of both: the
 * package's text readings answer in CANVAS pixels, because that is where the
 * calls were made, and this maps them back through the engine's own fit into
 * the logical units every check states its expectations in.
 */
export function drawnTextSpans(h: Harness): TextSpan[] {
  return allInLogical(h.viewport(), textDraws(h.calls));
}

/**
 * One logical run of text, and the spans it was spelled from.
 *
 * `parts` is the {@link drawnTextSpans} entries the run coalesced, in reading
 * order — one entry, the span itself, for a run drawn in a single call. A reader
 * that matches a WHOLE TOKEN reads both: see {@link spelledRuns} for why.
 *
 * A run keeps the anchor and the alignment of its first span, as the package's
 * `drawnTextRuns` keeps its first draw's: how the anchor sits in the glyphs it
 * was drawn with, not in the whole run.
 */
export interface TextRun extends TextSpan {
  parts: readonly TextSpan[];
}

/**
 * Every LOGICAL run of text the frame drew, placed in logical units, each with
 * the spans that spelled it.
 *
 * {@link drawnTextSpans} is one entry per call, which is what a reader holding a
 * readout clear of a region wants and what a reader of COPY must never use alone:
 * a build that letter-spaces a menu row draws it a glyph per `fillText`, and a
 * row looked for by its label — `screens/menu`'s `runFor`, a panel readout read
 * by its figure — would be missing from a screen that drew exactly the right
 * words. So the runs are the package's `drawnTextRuns` — the same draws
 * coalesced under the shared merge rule and nothing local
 * (`case-harness/text.ts`): two draws on one baseline, side by side, no further
 * apart than the run's own mean advance allows, are one run spelling both. A run
 * keeps its first draw's anchor and grows to its last draw's right edge. The
 * rule is decided in canvas pixels, where the calls were made, and the runs come
 * back through `allInLogical` exactly as the spans do, because a run carries the
 * same four numbers a draw does.
 *
 * A RUN CAN SPELL MORE THAN ANY OF ITS DRAWS DID, AND NOT ALWAYS WITH A SPACE
 * BETWEEN THEM. The rule joins any gap up to 0.6 of the run's mean advance, and
 * writes a space into the run only where the gap opens past the run's own
 * tracking: a label and its figure drawn as two calls an ordinary word space
 * apart — `WAVE` in one colour, `3/15` in another — come back as the one run
 * `WAVE 3/15`, and two tallies on one baseline, `KILLS 0` and `DEALT 0`, as one
 * run `KILLS 0 DEALT 0`. But a figure set tight against its label, or a gap no
 * wider than the tracking a letter-spaced label already carries, concatenates
 * verbatim into `WAVE3/15`, in which `WAVE` is no longer a whole token. A
 * substring reader still finds its copy there, but a whole-word reader would
 * not, where read call by call it did, and a reader COUNTING readouts finds one
 * run where the panel drew two. So every run also carries the spans it was
 * spelled from, and a reader that matches on a token boundary reads the run
 * AND its parts, while one that counts counts the parts; coalescing then only
 * ever adds a match, which is the guarantee it is here to give.
 *
 * Which spans a run took is recovered from the order the rule documents: it
 * partitions the draws in reading order, down the frame then across it, so the
 * members are consumed in that same order, each matched verbatim against the
 * run's text where it stands, until the text is spelled. A space the rule wrote
 * at a word gap is spelled by no draw and is stepped over; a draw of whitespace
 * alone is in the run verbatim, since the rule writes no space beside one; and
 * a RESTRIKE — the same text struck again where the last draw consumed already
 * stands, an outlined glyph's fill over its stroke — is the glyph the run
 * already spells, folded by the rule under the same test it folds it by
 * ({@link restrikes}), and is passed over without becoming a part. That test
 * is stated in canvas pixels, where the rule decided it, so the walk runs over
 * the draws as the package placed them and only the parts it took are mapped
 * into logical units. Were a run's text ever left unspelled by that walk, every
 * run in the frame would be handed back as its own only part, which is the
 * reading a whole-token reader had before the runs existed; the walk is the
 * rule's own, so that is a guard and not a path the rule takes.
 *
 * NAMED AS THE NONE HARNESS NAMES ITS OWN, AND NOT `drawnTextRuns`. That name is
 * the shared package's — the merge over raw draw calls, answering a `TextDraw[]`
 * in canvas pixels — and this answers a parts-carrying `TextRun[]` in logical
 * units. One name keeps one meaning across the case's three harnesses and the
 * package they are built over.
 */
export function spelledRuns(h: Harness): TextRun[] {
  const view = h.viewport();
  const runs = allInLogical(view, drawnTextRuns(h.calls));
  // The draws in the order the rule walked them, in the canvas pixels it sorted
  // and compared them in; the parts a run takes are placed in logical units.
  const ordered = textDraws(h.calls)
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
    spelled.push({ ...run, parts: allInLogical(view, parts) });
  }
  return spelled;
}

/** How far apart two draws' baselines may sit and still be one glyph struck twice. */
const RESTRIKE_BASELINE_SLACK = 0.75;

/** How far a draw may sit from the one it repeats and still be a restrike of it. */
const RESTRIKE_ANCHOR_SLACK = 0.5;

/**
 * Whether `draw` strikes `last` again where it already stands: the same text at
 * the same anchor, within the slacks the shared merge rule folds a restrike by,
 * both in the canvas pixels the rule compared them in. An outlined glyph is
 * drawn twice, `strokeText` then `fillText`, and the rule keeps the run
 * spelling it once.
 */
function restrikes(draw: TextDraw, last: TextDraw): boolean {
  return (
    draw.text === last.text &&
    Math.abs(draw.y - last.y) <= RESTRIKE_BASELINE_SLACK &&
    Math.abs(draw.left - last.left) <= RESTRIKE_ANCHOR_SLACK
  );
}

/** Forget every draw call recorded so far, so a check reads its own frame alone. */
export function clearCalls(h: Harness): void {
  h.calls.length = 0;
}

/**
 * Run one frame with the call list cleared first, so what comes back is that
 * frame's render and nothing before it.
 *
 * The reading almost every drawing check opens with: pose, then `renderFrame`,
 * then read `h.calls`.
 */
export async function renderFrame(h: Harness): Promise<void> {
  clearCalls(h);
  await h.advance(1);
}

/* -------------------------------------------------------------------------- */
/* The diagnostics overlay                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Toggle the engine's diagnostics overlay and run the frame that draws — or stops
 * drawing — it.
 *
 * The overlay is ENGINE CHROME under this engine: the backtick key (`Backquote`)
 * toggles it through a keydown listener the engine itself owns on the harness's
 * event target, never through a registered action (engine docs,
 * diagnostics.md). It is drawn after the pipeline renders, through the same
 * context this harness records — so with the overlay up, the registered sources'
 * lines land in `h.calls` as ordinary text draws, readable with
 * {@link drawnText} — but AFTER the engine recorder's bracket closes, so none of
 * it appears in a `captureReplay` recording. Capture overlay evidence with
 * {@link captureStill}.
 */
export async function toggleOverlay(h: Harness): Promise<void> {
  h.hold("Backquote");
  h.release("Backquote");
  await h.advance(1);
}
